import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { isDatabaseRetryable, RETRY_POLICIES, retryDelay, TIMEOUTS } from "@off-r39x/reliability";
import type { Pool, PoolClient } from "pg";
import { type DatabaseLogger, databaseLogger } from "./observability.ts";

export type TransactionResult<T> = { status: "committed"; value: T } | { status: "commit_unknown" };
export class TransactionDeadlineError extends Error {
  constructor() {
    super("Database transaction deadline exceeded");
  }
}
export function sqlState(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}
function commitAcknowledgementUnknown(error: unknown): boolean {
  const code = sqlState(error);
  // Only an authoritative server SQLSTATE (other than connection/shutdown)
  // proves COMMIT rejected. Node transport errors are never that evidence.
  return (
    error instanceof TransactionDeadlineError ||
    !code ||
    !/^[0-9A-Z]{5}$/.test(code) ||
    code === "EPIPE" ||
    code.startsWith("08") ||
    ["57P01", "57P02", "57P03"].includes(code)
  );
}
/** Callback must contain database work only; no provider side effects. */
export async function transaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
  observation: { logger?: DatabaseLogger; queryName?: string } = {},
): Promise<TransactionResult<T>> {
  const logger = observation.logger ?? databaseLogger(pool);
  const queryName = observation.queryName ?? "transaction.database_work";
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(queryName)) throw new Error("Invalid query name");
  const start = performance.now();
  let deadlineAt = start + TIMEOUTS.transactionMs;
  for (
    let attempt = 1;
    attempt <= Math.max(RETRY_POLICIES["40001"].maxAttempts, RETRY_POLICIES["40P01"].maxAttempts);
    attempt++
  ) {
    let client: PoolClient | undefined;
    let discard = false;
    let committing = false;
    let detachConnectionListeners = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const remaining = deadlineAt - performance.now();
      if (remaining <= 0) throw new TransactionDeadlineError();
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          discard = true;
          client?.release(true);
          client = undefined;
          reject(new TransactionDeadlineError());
        }, remaining);
      });
      const work = async (): Promise<TransactionResult<T>> => {
        const acquiring = performance.now();
        const acquired = await pool.connect();
        logger?.log({
          event_name: "db.pool.acquire.completed",
          level: "INFO",
          result: "SUCCESS",
          is_retry: attempt > 1,
          attempt_number: attempt,
          query_name: queryName,
          duration_ms: Math.floor(performance.now() - acquiring),
        });
        if (discard) {
          acquired.release(true);
          throw new TransactionDeadlineError();
        }
        client = acquired;
        // Checked-out clients are not covered by the pool's idle error listener.
        // Keep this listener until physical close for late transport failures.
        const onConnectionError = () => {
          discard = true;
        };
        const onConnectionEnd = () => detachConnectionListeners();
        detachConnectionListeners = () => {
          acquired.removeListener("error", onConnectionError);
          acquired.removeListener("end", onConnectionEnd);
        };
        acquired.on("error", onConnectionError);
        acquired.once("end", onConnectionEnd);
        await acquired.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        await acquired.query(
          `SET LOCAL statement_timeout = '${TIMEOUTS.statementMs}ms'; SET LOCAL lock_timeout = '${TIMEOUTS.lockMs}ms'; SET LOCAL timezone = 'UTC'`,
        );
        if (discard || performance.now() >= deadlineAt) throw new TransactionDeadlineError();
        const value = await operation(acquired);
        // Check the monotonic budget as well as the timer: a callback may keep
        // the event loop busy past expiry before the timer gets its turn.
        if (discard || performance.now() >= deadlineAt) throw new TransactionDeadlineError();
        committing = true;
        await acquired.query("COMMIT");
        return { status: "committed", value };
      };
      const result = await Promise.race([work(), deadline]);
      logger?.log({
        event_name: "db.transaction.completed",
        level: "INFO",
        result: "SUCCESS",
        failure_class: "SUCCESS",
        is_retry: attempt > 1,
        attempt_number: attempt,
        query_name: queryName,
        duration_ms: Math.floor(performance.now() - start),
      });
      return result;
    } catch (error) {
      const code = sqlState(error);
      if (
        committing &&
        code !== "40001" &&
        code !== "40P01" &&
        commitAcknowledgementUnknown(error)
      ) {
        discard = true;
        logger?.log({
          event_name: "reliability.unknown_result.opened",
          level: "ERROR",
          result: "PENDING",
          failure_class: "UNKNOWN_RESULT",
          provider: "NEON_DB",
          is_retry: attempt > 1,
          attempt_number: attempt,
          query_name: queryName,
          duration_ms: Math.floor(performance.now() - start),
        });
        return { status: "commit_unknown" };
      }
      const unavailable =
        !client || !code || code.startsWith("08") || ["57P01", "57P02", "57P03"].includes(code);
      const constraint = code === "23505" || code === "23P01";
      logger?.log({
        event_name: unavailable
          ? "db.availability.failed"
          : constraint
            ? "db.constraint_loser.completed"
            : "db.transaction.completed",
        level: constraint ? "INFO" : "ERROR",
        result: constraint ? "REJECTED" : "FAILED",
        failure_class: constraint ? "CONFLICT_LOSER" : "TEMPORARY_FAILURE",
        is_retry: attempt > 1,
        attempt_number: attempt,
        query_name: queryName,
        ...(code && /^[0-9A-Z]{5}$/.test(code) ? { sqlstate: code } : {}),
        duration_ms: Math.floor(performance.now() - start),
      });
      if (client && !discard) {
        try {
          await client.query("ROLLBACK");
        } catch {
          discard = true;
        }
      }
      const policy = isDatabaseRetryable(error) ? RETRY_POLICIES[error.code] : undefined;
      if (!policy || attempt >= policy.maxAttempts || discard) throw error;
      // Retry budgets include all previous attempts and backoff, not just the
      // interval until the next attempt. A later SQLSTATE cannot extend them.
      deadlineAt = Math.min(deadlineAt, start + policy.maxElapsedMs);
      const delay = retryDelay(policy, attempt);
      if (performance.now() + delay >= deadlineAt) throw error;
      if (timer) clearTimeout(timer);
      detachConnectionListeners();
      client?.release();
      client = undefined;
      logger?.log({
        event_name: "db.transaction.retry_scheduled",
        level: "WARN",
        result: "PENDING",
        is_retry: true,
        attempt_number: attempt + 1,
        query_name: queryName,
        sqlstate: code as "40001" | "40P01",
        failure_class: "TEMPORARY_FAILURE",
      });
      await sleep(delay);
    } finally {
      if (timer) clearTimeout(timer);
      if (!discard) detachConnectionListeners();
      client?.release(discard);
    }
  }
  throw new Error("Transaction retry budget exhausted");
}

export async function withWorkerAdvisoryLock<T>(
  pool: Pool,
  key: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<{ acquired: false } | { acquired: true; value: T }> {
  if (!key || key.length > 200 || key === "r39x:schema-migration")
    throw new Error("Invalid worker lock key");
  const client = await pool.connect();
  let held = false;
  // An acquire acknowledgement can be lost after this session took the lock.
  // Never return an indeterminate lock-owning session to the reusable pool.
  let discard = true;
  try {
    held =
      (await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS acquired", [key])).rows[0]
        .acquired === true;
    discard = false;
    if (!held) return { acquired: false };
    return { acquired: true, value: await operation(client) };
  } finally {
    if (held) {
      try {
        const r = await client.query("SELECT pg_advisory_unlock(hashtext($1)) AS released", [key]);
        discard = r.rows[0].released !== true;
      } catch {
        discard = true;
      }
    }
    client.release(discard);
  }
}
