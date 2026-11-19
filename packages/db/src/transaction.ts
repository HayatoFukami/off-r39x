import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import {
  type DatabaseRetryState,
  isDatabaseRetryable,
  RETRY_POLICIES,
  retryDelay,
  TIMEOUTS,
} from "@off-r39x/reliability";
import type { Pool, PoolClient } from "pg";
import {
  DatabaseUnavailableError,
  isDatabaseUnavailableCode,
  isSqlstate,
  sqlState,
  TransactionDeadlineError,
} from "./errors.ts";
import { type DatabaseLogger, databaseLogger, logDatabase } from "./observability.ts";

// Kept importable from this module for existing deep imports; the definitions live in errors.ts.
export { sqlState, TransactionDeadlineError };
export type TransactionResult<T> = { status: "committed"; value: T } | { status: "commit_unknown" };
function commitAcknowledgementUnknown(error: unknown): boolean {
  const code = sqlState(error);
  // Only an authoritative server SQLSTATE (other than connection/shutdown)
  // proves COMMIT rejected. Node transport errors are never that evidence.
  return (
    error instanceof TransactionDeadlineError ||
    !isSqlstate(code) ||
    code.startsWith("08") ||
    ["57P01", "57P02", "57P03"].includes(code)
  );
}
function isMarkable(error: unknown): error is object {
  return typeof error === "object" && error !== null;
}

/**
 * Hands the callback a client whose query() rejections are recorded as database-originated, so an
 * errno thrown by the callback's own code is not mistaken for a database failure. Only query() is
 * wrapped; every other member comes from the real client (functions bound to it). A query() that
 * does not return a Promise (callback form, submittable) is passed through unmarked, which keeps
 * the conservative 500 outcome.
 */
function observeClient(client: PoolClient, markDbError: (error: unknown) => void): PoolClient {
  return new Proxy(client, {
    get(target, property) {
      // Reflect.get is typed any; keep it unknown and narrow, so no type assertion is needed.
      const member: unknown = Reflect.get(target, property, target);
      if (typeof member !== "function") return member;
      if (property !== "query") return member.bind(target);
      return (...args: unknown[]) => {
        const result: unknown = Reflect.apply(member, target, args);
        if (!(result instanceof Promise)) return result;
        return result.catch((error: unknown) => {
          markDbError(error);
          throw error;
        });
      };
    },
  });
}

/**
 * Callback must contain database work only; no provider side effects. A callback using drizzle must
 * rethrow the `cause` of `DrizzleQueryError` (the driver's error), as `insertAuditEvent` does;
 * wrapped errors defeat retry, unavailability typing and constraint classification.
 */
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
  // True once a retry policy's elapsed budget has shortened the deadline, so a
  // later deadline hit is retry-budget exhaustion rather than the 8 s wall clock.
  let budgetShortened = false;
  const maxAttempts = Math.max(
    RETRY_POLICIES["40001"].maxAttempts,
    RETRY_POLICIES["40P01"].maxAttempts,
    RETRY_POLICIES["55P03"].maxAttempts,
  );
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let client: PoolClient | undefined;
    let discard = false;
    // Set by the deadline timer when it reaches a retry-budget-shortened deadline. It survives
    // an in-flight ROLLBACK, where the caught error is still the original SQLSTATE error.
    let budgetDeadlineReached = false;
    let committing = false;
    // Errors that came out of a database operation of this attempt (connect, internal queries and
    // the callback client's query()). The callback's own throws are never in this set.
    const dbOriginated = new WeakSet<object>();
    const markDbError = (error: unknown) => {
      if (isMarkable(error)) dbOriginated.add(error);
    };
    const fromDb = async <R>(operationPromise: Promise<R>): Promise<R> => {
      try {
        return await operationPromise;
      } catch (error) {
        markDbError(error);
        throw error;
      }
    };
    // Set only by the connection's own error/end events (not by the deadline timer's discard).
    let connectionLost = false;
    let detachConnectionListeners = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const remaining = deadlineAt - performance.now();
      if (remaining <= 0) throw new TransactionDeadlineError();
      const deadline = new Promise<never>((_, reject) => {
        // Node truncates fractional delays, so the timer can fire a fraction of a millisecond
        // before the monotonic deadline. Re-check the clock and re-arm until the deadline has
        // really passed, so the exhaustion check below sees a consistent state (OBS-DB-003).
        const arm = (delayMs: number) => {
          timer = setTimeout(() => {
            const left = deadlineAt - performance.now();
            if (left > 0) return arm(Math.ceil(left));
            if (budgetShortened) budgetDeadlineReached = true;
            discard = true;
            client?.release(true);
            client = undefined;
            reject(new TransactionDeadlineError());
          }, Math.ceil(delayMs));
        };
        arm(remaining);
      });
      const work = async (): Promise<TransactionResult<T>> => {
        const acquiring = performance.now();
        const acquired = await fromDb(pool.connect());
        logDatabase(logger, {
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
          connectionLost = true;
          discard = true;
        };
        const onConnectionEnd = () => {
          connectionLost = true;
          discard = true;
          detachConnectionListeners();
        };
        detachConnectionListeners = () => {
          acquired.removeListener("error", onConnectionError);
          acquired.removeListener("end", onConnectionEnd);
        };
        acquired.on("error", onConnectionError);
        acquired.once("end", onConnectionEnd);
        await fromDb(acquired.query("BEGIN ISOLATION LEVEL READ COMMITTED"));
        await fromDb(
          acquired.query(
            `SET LOCAL statement_timeout = '${TIMEOUTS.statementMs}ms'; SET LOCAL lock_timeout = '${TIMEOUTS.lockMs}ms'; SET LOCAL timezone = 'UTC'`,
          ),
        );
        if (discard || performance.now() >= deadlineAt) throw new TransactionDeadlineError();
        const value = await operation(observeClient(acquired, markDbError));
        // Check the monotonic budget as well as the timer: a callback may keep
        // the event loop busy past expiry before the timer gets its turn.
        if (discard || performance.now() >= deadlineAt) throw new TransactionDeadlineError();
        committing = true;
        await fromDb(acquired.query("COMMIT"));
        return { status: "committed", value };
      };
      const result = await Promise.race([work(), deadline]);
      logDatabase(logger, {
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
        logDatabase(logger, {
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
      const timeout = error instanceof TransactionDeadlineError || code === "57014";
      // Unavailability is judged by origin, not by the discard flag (the deadline timer sets it too):
      // the connection reported loss, or a database operation (connect, transaction control, a query
      // on the callback's client) raised a connect failure, an unavailable-class code, or an error
      // without a server SQLSTATE (no code or a Node errno). The last case does not wait for the
      // connection's error/end event: a driver rejection that carries no SQLSTATE means no server
      // answer was received, so it is unavailable on its own. An errno or codeless error thrown by
      // the callback's own code on a healthy connection is not unavailable.
      const dbRaised = isMarkable(error) && dbOriginated.has(error);
      const unavailable =
        !timeout &&
        (connectionLost ||
          (dbRaised && (!client || !isSqlstate(code) || isDatabaseUnavailableCode(code))));
      if (unavailable) discard = true;
      const constraint = code === "23505" || code === "23P01";
      logDatabase(logger, {
        event_name: timeout
          ? "reliability.timeout.occurred"
          : unavailable
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
        ...(isSqlstate(code) ? { sqlstate: code } : {}),
        duration_ms: Math.floor(performance.now() - start),
      });
      if (client && !discard) {
        try {
          await fromDb(client.query("ROLLBACK"));
        } catch {
          discard = true;
        }
      }
      const exhausted = () =>
        logDatabase(logger, {
          event_name: "reliability.retry.exhausted",
          level: "ERROR",
          result: "FAILED",
          failure_class: "TEMPORARY_FAILURE",
          is_retry: attempt > 1,
          attempt_number: attempt,
          query_name: queryName,
          ...(isSqlstate(code) ? { sqlstate: code } : {}),
          duration_ms: Math.floor(performance.now() - start),
        });
      // A retry attempt cut off by the shortened retry budget is exhaustion too: either the
      // attempt itself hit the deadline, or the timer reached it while ROLLBACK was in flight.
      // Recorded here once; the discard branch below then only rethrows.
      if (
        budgetShortened &&
        ((error instanceof TransactionDeadlineError && performance.now() >= deadlineAt) ||
          (budgetDeadlineReached && isDatabaseRetryable(error)))
      )
        exhausted();
      const policy = isDatabaseRetryable(error) ? RETRY_POLICIES[error.code] : undefined;
      if (!policy || discard) {
        // A connection failure without a SQLSTATE (an errno or no code) is typed here so the API layer
        // answers 503 from the boundary type alone (REL-DB-009). `unavailable` already requires a
        // database origin or a reported connection loss, so an errno thrown by the callback's own
        // code is rethrown as it is. 08xxx / 57P01-03 are rethrown as they are.
        if (unavailable && !isSqlstate(sqlState(error)))
          throw new DatabaseUnavailableError({ cause: error });
        throw error;
      }
      if (attempt >= policy.maxAttempts) {
        exhausted();
        throw error;
      }
      // Retry budgets include all previous attempts and backoff, not just the
      // interval until the next attempt. A later SQLSTATE cannot extend them.
      const budgetAt = start + policy.maxElapsedMs;
      if (budgetAt < deadlineAt) {
        deadlineAt = budgetAt;
        budgetShortened = true;
      }
      const delay = retryDelay(policy, attempt);
      if (performance.now() + delay >= deadlineAt) {
        exhausted();
        throw error;
      }
      if (timer) clearTimeout(timer);
      detachConnectionListeners();
      client?.release();
      client = undefined;
      logDatabase(logger, {
        event_name: "db.transaction.retry_scheduled",
        level: "WARN",
        result: "PENDING",
        is_retry: true,
        attempt_number: attempt + 1,
        query_name: queryName,
        sqlstate: code as DatabaseRetryState,
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
