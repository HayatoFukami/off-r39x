import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import type { LogEvent } from "@off-r39x/observability";
import { isDatabaseRetryable, RETRY_POLICIES, retryDelay, TIMEOUTS } from "@off-r39x/reliability";
import type { Client } from "pg";
import { insertAuditEventReturningId } from "../audit-events.ts";
import { isSqlstate, sqlState } from "../errors.ts";
import {
  acquireMigrationLock,
  invalidateMigrationLock,
  isActiveMigrationLock,
  type MigrationLock,
  MigrationLockTimeoutError,
} from "../migration-lock.ts";
import { type InitialDataInput, type InputRow, parseInitialDataInput } from "./input.ts";
import {
  INITIAL_DATA_AUDIT_CHANGE,
  INITIAL_DATA_TARGETS,
  type InitialDataTarget,
} from "./targets.ts";

// Initial data seeding (SPEC-100 section 13.5 DB-SEED-001..007, SPEC-180 section 45.3 INF-SEED-001..006,
// SPEC-160 OBS-AUD-014). One transaction per attempt: lock, count, (read input), insert, Audit, COMMIT.
// Every value is a bind parameter; table and column names come from `targets.ts`. This module never
// updates or deletes a row, never logs a value from the input, and never retries an unknown result
// blindly: after a lost COMMIT acknowledgement it re-checks on a new connection (DB-SEED-002).

export const SEED_OPERATION_ID = "PROVISION.INITIAL_DATA_SEED";
const SEED_XACT_LOCK = "SELECT pg_advisory_xact_lock(hashtext('app:initial-data-seed'))";
const SAFE_REF = /^[A-Za-z0-9_:-]{1,128}$/;
/** SPEC-150 section 11 (55P03 row): the seed transactions of one command run, re-check retries included. */
const MAX_ATTEMPTS = RETRY_POLICIES["55P03"].maxAttempts;
const CLOSE_WAIT_MS = 3000;

export type SeedFailureClass = "TEMPORARY_FAILURE" | "PERMANENT_FAILURE" | "CONSISTENCY_FAILURE";
export type SeedCreated = {
  readonly events: readonly string[];
  readonly entry_ticket_offerings: readonly string[];
};
export type SeedOutcome =
  | {
      readonly outcome: "CREATED";
      readonly operationExecutionId: string;
      readonly attemptNumber: number;
      readonly created: SeedCreated;
      readonly auditEventIds: readonly string[];
    }
  | {
      readonly outcome: "NOOP";
      readonly operationExecutionId: string;
      readonly attemptNumber: number;
    }
  | {
      readonly outcome: "FAILED";
      readonly operationExecutionId: string;
      readonly attemptNumber: number;
      readonly failureClass: SeedFailureClass;
      readonly errorCode: string;
    }
  | {
      readonly outcome: "UNKNOWN_RESULT";
      readonly operationExecutionId: string;
      readonly attemptNumber: number;
      readonly errorCode: "COMMIT_RESULT_UNKNOWN";
    };

/** INF-SEED-004: 0 for CREATED and NOOP, 2 for FAILED, 3 for UNKNOWN_RESULT (never 1, the Node crash code). */
export function outcomeExitCode(outcome: SeedOutcome): 0 | 2 | 3 {
  switch (outcome.outcome) {
    case "CREATED":
    case "NOOP":
      return 0;
    case "FAILED":
      return 2;
    case "UNKNOWN_RESULT":
      return 3;
  }
}

/** INF-SEED-005 and SPEC-160 section 17: the common log `result`, `failure_class` and level of an outcome. */
export function outcomeLogFields(outcome: SeedOutcome): {
  result: "SUCCESS" | "NOOP" | "FAILED" | "PENDING";
  failure_class: SeedFailureClass | "SUCCESS" | "UNKNOWN_RESULT" | null;
  level: "INFO" | "WARN" | "ERROR";
} {
  switch (outcome.outcome) {
    case "CREATED":
      return { result: "SUCCESS", failure_class: "SUCCESS", level: "INFO" };
    case "NOOP":
      return { result: "NOOP", failure_class: null, level: "INFO" };
    case "FAILED":
      return { result: "FAILED", failure_class: outcome.failureClass, level: "ERROR" };
    case "UNKNOWN_RESULT":
      return { result: "PENDING", failure_class: "UNKNOWN_RESULT", level: "WARN" };
  }
}

export type SeedOptions = {
  /**
   * From `acquireMigrationLock`; its client runs the first attempt. If that attempt's COMMIT result
   * becomes unknown, the client is ended and the handle is invalidated (`release()` then returns
   * false and sends no SQL), whatever the final outcome. Do not use the client after the seed.
   */
  readonly lock: MigrationLock;
  /** A new connected client, for the re-check after an unknown COMMIT result and the retry after it. */
  readonly connect: () => Promise<Client>;
  /** Called at most once, and only when a row has to be created (INF-SEED-002). */
  readonly readInput: () => string | undefined;
  /** An INFRASTRUCTURE_OPERATOR reference (SPEC-160 section 19.1). */
  readonly actorRef: string;
  readonly logger?: { log(event: LogEvent): void };
  /** Wall clock of one seed transaction in ms (SPEC-150 section 9: 8000). Overridable for tests. */
  readonly transactionDeadlineMs?: number;
};

type Plan = { readonly kind: "all" } | { readonly kind: "offerings"; readonly eventId: string };
type Attempt =
  | { readonly kind: "done"; readonly outcome: SeedOutcome }
  | { readonly kind: "retry"; readonly code: "40001" | "40P01" | "55P03" }
  | { readonly kind: "unknown" };
type Recheck =
  | { readonly kind: "created"; readonly created: SeedCreated; readonly auditEventIds: string[] }
  | { readonly kind: "complete" }
  | { readonly kind: "uncommitted" };

export const failedOutcome = (
  operationExecutionId: string,
  attemptNumber: number,
  failureClass: SeedFailureClass,
  errorCode: string,
): SeedOutcome => ({
  outcome: "FAILED",
  operationExecutionId,
  attemptNumber,
  failureClass,
  errorCode,
});

/**
 * Failure class and error code of an attempt that was rolled back (plan v1.2 section 6). Retryable
 * SQLSTATEs and an unknown COMMIT result are handled before this. An Audit stage failure is always
 * AUDIT_WRITE_FAILED (temporary for a connection-class SQLSTATE or none, else permanent); a statement
 * stage 23xxx is INITIAL_DATA_CONSTRAINT_REJECTED (permanent, REL-DB-002); anything else is unexpected
 * and safe to run again.
 */
export function classifySeedFailure(
  stage: "statement" | "audit",
  sqlstate: string | undefined,
): { failureClass: SeedFailureClass; errorCode: string } {
  if (stage === "audit")
    return {
      failureClass: isConnectionClass(sqlstate) ? "TEMPORARY_FAILURE" : "PERMANENT_FAILURE",
      errorCode: "AUDIT_WRITE_FAILED",
    };
  if (sqlstate?.startsWith("23"))
    return { failureClass: "PERMANENT_FAILURE", errorCode: "INITIAL_DATA_CONSTRAINT_REJECTED" };
  return { failureClass: "TEMPORARY_FAILURE", errorCode: "UNEXPECTED_INTERNAL_ERROR" };
}

/** SPEC-150 REL-DB-005/006: only a missing or connection-class SQLSTATE leaves COMMIT undecided. */
function commitAcknowledgementUnknown(error: unknown): boolean {
  const code = sqlState(error);
  return !isSqlstate(code) || code.startsWith("08") || ["57P01", "57P02", "57P03"].includes(code);
}

class DeadlineExceeded extends Error {}

const isConnectionClass = (code: string | undefined): boolean =>
  isSqlstate(code) && (code.startsWith("08") || code.startsWith("57P0"));

/** Resolves true when `work` succeeds within `ms`; false on failure or timeout. Never rejects. */
async function succeedsWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function beginSeedTransaction(client: Client): Promise<void> {
  await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  await client.query(
    `SET LOCAL statement_timeout = '${TIMEOUTS.statementMs}ms'; SET LOCAL lock_timeout = '${TIMEOUTS.lockMs}ms'; SET LOCAL timezone = 'UTC'`,
  );
  await client.query(SEED_XACT_LOCK);
}

async function readEventIds(client: Client): Promise<string[]> {
  const result = await client.query("SELECT id, public_ref FROM app.events ORDER BY id LIMIT 2");
  return result.rows.map((row) => String(row.id));
}

async function hasOfferings(client: Client, eventId: string): Promise<boolean> {
  const result = await client.query(
    "SELECT EXISTS (SELECT 1 FROM app.entry_ticket_offerings WHERE event_id = $1) AS present",
    [eventId],
  );
  return result.rows[0]?.present === true;
}

async function insertRow(
  client: Client,
  target: InitialDataTarget,
  row: InputRow,
  parentEventId: string | undefined,
): Promise<{ id: string; publicRef: string; fields: string[] }> {
  const columns: string[] = [];
  const placeholders: string[] = [];
  const values: (string | number)[] = [];
  if (target.condition === "noChildrenOf" && parentEventId !== undefined) {
    columns.push("event_id");
    values.push(parentEventId);
    placeholders.push(`$${values.length}::bigint`);
  }
  // A column without a value is left out so that the database writes NULL (no guessed value).
  const fields: string[] = [];
  for (const column of target.columns) {
    const value = row[column.name];
    if (value === null || value === undefined) continue;
    columns.push(column.name);
    values.push(value);
    const cast =
      column.kind === "integer"
        ? `::${column.sqlType}`
        : column.kind === "timestamp"
          ? "::timestamptz"
          : "";
    placeholders.push(`$${values.length}${cast}`);
    fields.push(column.name);
  }
  for (const fixed of target.fixed) {
    columns.push(fixed.name);
    placeholders.push(fixed.sql);
    fields.push(fixed.name);
  }
  const result = await client.query(
    `INSERT INTO ${target.table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id, public_ref`,
    values,
  );
  const inserted = result.rows[0];
  if (inserted === undefined) throw new Error("Row was not returned");
  return { id: String(inserted.id), publicRef: String(inserted.public_ref), fields };
}

export async function seedInitialData(options: SeedOptions): Promise<SeedOutcome> {
  // A handle that acquireMigrationLock did not issue, or that was released: no SQL, no input read.
  if (!isActiveMigrationLock(options.lock)) throw new Error("Active migration lock required");
  const { actorRef, readInput, connect } = options;
  if (!SAFE_REF.test(actorRef))
    return failedOutcome(randomUUID(), 1, "PERMANENT_FAILURE", "CONFIGURATION_INVALID");
  const deadlineMs = options.transactionDeadlineMs ?? TIMEOUTS.transactionMs;

  const log = (event: LogEvent) => {
    try {
      options.logger?.log(event);
    } catch {
      // Logging is not business authority.
    }
  };

  let client: Client = options.lock.client;
  // The connection (and its migration lock) this run opened itself after an unknown COMMIT result.
  let ownedConnection: Client | undefined;
  let ownedLock: MigrationLock | undefined;
  // Cleanup, not business work: unlock and end on the connection this run opened. On a connection
  // that is already gone these fail fast and the failure is ignored. The caller's own connection and
  // lock handle are never touched here.
  const closeOwned = async () => {
    const lock = ownedLock;
    const connection = ownedConnection;
    ownedLock = undefined;
    ownedConnection = undefined;
    if (lock) await succeedsWithin(lock.release(), CLOSE_WAIT_MS);
    if (connection) await succeedsWithin(connection.end(), CLOSE_WAIT_MS);
  };

  let parsedInput: ReturnType<typeof parseInitialDataInput> | undefined;
  const loadInput = () => {
    parsedInput ??= parseInitialDataInput(readInput());
    return parsedInput;
  };

  // What the attempt in flight was creating, for the re-check after a lost COMMIT acknowledgement.
  let plan: Plan = { kind: "all" };

  const attemptOnce = async (executionId: string, attemptNumber: number): Promise<Attempt> => {
    const fail = (failureClass: SeedFailureClass, errorCode: string): Attempt => ({
      kind: "done",
      outcome: failedOutcome(executionId, attemptNumber, failureClass, errorCode),
    });
    let commitSent = false;
    let stage: "statement" | "audit" = "statement";
    const startedAt = performance.now();
    // Checked before every statement that writes (N-4), not only before COMMIT.
    const checkDeadline = () => {
      if (performance.now() - startedAt >= deadlineMs) throw new DeadlineExceeded();
    };
    try {
      await beginSeedTransaction(client);
      const eventIds = await readEventIds(client);
      if (eventIds.length >= 2) {
        await client.query("ROLLBACK");
        return fail("CONSISTENCY_FAILURE", "INITIAL_DATA_EVENT_NOT_UNIQUE");
      }
      if (eventIds.length === 1) {
        const eventId = eventIds[0] as string;
        if (await hasOfferings(client, eventId)) {
          await client.query("ROLLBACK");
          return {
            kind: "done",
            outcome: { outcome: "NOOP", operationExecutionId: executionId, attemptNumber },
          };
        }
        plan = { kind: "offerings", eventId };
      } else {
        plan = { kind: "all" };
      }

      const parsed = loadInput();
      if (!parsed.ok) {
        await client.query("ROLLBACK");
        return fail("PERMANENT_FAILURE", parsed.errorCode);
      }
      const data: InitialDataInput = parsed.value;

      const created: { events: string[]; entry_ticket_offerings: string[] } = {
        events: [],
        entry_ticket_offerings: [],
      };
      const auditEventIds: string[] = [];
      let parentEventId = plan.kind === "offerings" ? plan.eventId : undefined;
      for (const target of INITIAL_DATA_TARGETS) {
        // An existing Event is never touched; the input's `event` was validated but is not used.
        if (target.cardinality === "one" && plan.kind !== "all") continue;
        const rows = target.cardinality === "one" ? [data.event] : data.entry_ticket_offerings;
        for (const row of rows) {
          stage = "statement";
          checkDeadline();
          const inserted = await insertRow(client, target, row, parentEventId);
          if (target.cardinality === "one") parentEventId = inserted.id;
          if (target.cardinality === "one") created.events.push(inserted.publicRef);
          else created.entry_ticket_offerings.push(inserted.publicRef);
          stage = "audit";
          checkDeadline();
          auditEventIds.push(
            await insertAuditEventReturningId(client, {
              auditEventType: "BUSINESS_EFFECT",
              actorType: "INFRASTRUCTURE_OPERATOR",
              actorRef,
              operationId: SEED_OPERATION_ID,
              operationExecutionId: executionId,
              targetType: target.auditTargetType,
              targetRef: inserted.publicRef,
              preconditionResult: "PASSED",
              auditResult: "COMMITTED",
              change: INITIAL_DATA_AUDIT_CHANGE.change({
                afterState: target.afterState,
                changedFields: inserted.fields,
              }),
            }),
          );
        }
      }
      stage = "statement";
      // Wall clock (SPEC-150 section 9), checked before COMMIT rather than only by a timer: a
      // synchronous callback can block the event loop past the deadline. Not yet sent: roll back.
      checkDeadline();
      const remainingMs = deadlineMs - (performance.now() - startedAt);
      commitSent = true;
      const committed = client.query("COMMIT").then(() => "ok" as const);
      committed.catch(() => {});
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const settled = await Promise.race([
          committed,
          new Promise<"late">((resolve) => {
            timer = setTimeout(() => resolve("late"), remainingMs);
          }),
        ]);
        // COMMIT is sent and not acknowledged in time: the result is unknown, never a plain failure.
        if (settled === "late") return { kind: "unknown" };
      } finally {
        if (timer) clearTimeout(timer);
      }
      return {
        kind: "done",
        outcome: {
          outcome: "CREATED",
          operationExecutionId: executionId,
          attemptNumber,
          created,
          auditEventIds,
        },
      };
    } catch (error) {
      if (commitSent && commitAcknowledgementUnknown(error)) return { kind: "unknown" };
      // Not committed: close the transaction. A connection that cannot even roll back is gone, which
      // proves nothing was committed (REL-DB-005): a temporary failure, to be run again.
      if (!(await succeedsWithin(client.query("ROLLBACK"), CLOSE_WAIT_MS)))
        return fail("TEMPORARY_FAILURE", "DATABASE_TEMPORARY_FAILURE");
      if (error instanceof DeadlineExceeded)
        return fail("TEMPORARY_FAILURE", "DATABASE_TEMPORARY_FAILURE");
      if (isDatabaseRetryable(error)) return { kind: "retry", code: error.code };
      const code = sqlState(error);
      const { failureClass, errorCode } = classifySeedFailure(
        stage,
        isSqlstate(code) ? code : undefined,
      );
      return fail(failureClass, errorCode);
    }
  };

  /** SPEC-150 section 11 "temporary DB connection acquisition": 3 attempts within 3 seconds. */
  const reconnect = async (): Promise<Client | undefined> => {
    const policy = RETRY_POLICIES.databaseConnection;
    const startedAt = performance.now();
    for (let n = 1; n <= policy.maxAttempts; n += 1) {
      try {
        const connection = await connect();
        connection.on("error", () => {});
        return connection;
      } catch {
        const elapsed = performance.now() - startedAt;
        if (n >= policy.maxAttempts || elapsed >= policy.maxElapsedMs) break;
        await sleep(Math.min(retryDelay(policy, n), policy.maxElapsedMs - elapsed));
      }
    }
    return undefined;
  };

  /** DB-SEED-002 (1)-(4). Resolves undefined when the result cannot be determined (4). */
  const recheck = async (connection: Client, executionId: string): Promise<Recheck | undefined> => {
    const startedAt = performance.now();
    for (let n = 1; n <= MAX_ATTEMPTS; n += 1) {
      try {
        await beginSeedTransaction(connection);
        const audit = await connection.query(
          "SELECT audit_event_id, target_type, target_ref FROM app.audit_events WHERE operation_id = $1 AND operation_execution_id = $2",
          [SEED_OPERATION_ID, executionId],
        );
        let verdict: Recheck;
        if (audit.rows.length > 0) {
          const refs = (type: string) =>
            audit.rows
              .filter((row) => row.target_type === type)
              .map((row) => String(row.target_ref));
          verdict = {
            kind: "created",
            created: {
              events: refs("PUBLIC_CONTENT"),
              entry_ticket_offerings: refs("ENTRY_TICKET_OFFERING"),
            },
            auditEventIds: audit.rows.map((row) => String(row.audit_event_id)),
          };
        } else {
          // Another run may have completed meanwhile. An Event alone is not proof of success.
          let eventId: string | undefined;
          if (plan.kind === "offerings") eventId = plan.eventId;
          else {
            const eventIds = await readEventIds(connection);
            if (eventIds.length === 1) eventId = eventIds[0];
          }
          verdict =
            eventId !== undefined && (await hasOfferings(connection, eventId))
              ? { kind: "complete" }
              : { kind: "uncommitted" };
        }
        await connection.query("ROLLBACK");
        return verdict;
      } catch (error) {
        const closed = await succeedsWithin(connection.query("ROLLBACK"), CLOSE_WAIT_MS);
        if (!closed || !isDatabaseRetryable(error) || n >= MAX_ATTEMPTS) return undefined;
        const policy = RETRY_POLICIES[error.code];
        const elapsed = performance.now() - startedAt;
        if (elapsed >= policy.maxElapsedMs) return undefined;
        await sleep(retryDelay(policy, Math.min(n, policy.maxAttempts - 1)));
      }
    }
    return undefined;
  };

  try {
    let attemptNumber = 0;
    let retries = 0;
    const budgetStartedAt = performance.now();
    // Time spent waiting for the migration lock is not part of the retry budget (SPEC-180 section 24).
    let lockWaitMs = 0;
    for (;;) {
      attemptNumber += 1;
      const executionId = randomUUID();
      if (attemptNumber > 1)
        log({
          event_name: "reliability.retry.attempted",
          level: "INFO",
          result: "PENDING",
          is_retry: true,
          operation_id: SEED_OPERATION_ID,
          operation_execution_id: executionId,
          attempt_number: attemptNumber,
          provider: "NEON_DB",
        });
      const attempt = await attemptOnce(executionId, attemptNumber);
      if (attempt.kind === "done") return attempt.outcome;

      if (attempt.kind === "retry") {
        retries += 1;
        const policy = RETRY_POLICIES[attempt.code];
        const elapsed = performance.now() - budgetStartedAt - lockWaitMs;
        if (
          attemptNumber >= MAX_ATTEMPTS ||
          retries >= policy.maxAttempts ||
          elapsed >= policy.maxElapsedMs
        )
          return failedOutcome(
            executionId,
            attemptNumber,
            "TEMPORARY_FAILURE",
            "DATABASE_TEMPORARY_FAILURE",
          );
        await sleep(retryDelay(policy, retries));
        continue;
      }

      // COMMIT was sent and its acknowledgement was lost: the result is unknown (REL-DB-006).
      const unknownAt = performance.now();
      const common = {
        is_retry: attemptNumber > 1,
        operation_id: SEED_OPERATION_ID,
        operation_execution_id: executionId,
        attempt_number: attemptNumber,
        provider: "NEON_DB",
      } as const;
      log({
        ...common,
        event_name: "reliability.unknown_result.opened",
        level: "WARN",
        result: "PENDING",
        failure_class: "UNKNOWN_RESULT",
        error_code: "COMMIT_RESULT_UNKNOWN",
      });
      const unknown: SeedOutcome = {
        outcome: "UNKNOWN_RESULT",
        operationExecutionId: executionId,
        attemptNumber,
        errorCode: "COMMIT_RESULT_UNKNOWN",
      };
      // Abandon the connection that lost the result, before the re-check and any retry. It may still
      // be alive (the deadline timer fired while COMMIT was in flight), and its session holds the
      // migration lock: a retry would wait for that lock. Invalidate the lock handle (the caller's
      // release() then sends nothing) and end the client; with a query in flight pg destroys the
      // socket, so the backend ends and drops its session lock. No unlock is sent on it. A late
      // COMMIT that takes effect is found by the re-check (1); an uncommitted one is retried (3).
      const lostClient = client;
      invalidateMigrationLock(ownedLock ?? options.lock);
      if (ownedConnection === lostClient) {
        ownedLock = undefined;
        ownedConnection = undefined;
      }
      await succeedsWithin(lostClient.end(), CLOSE_WAIT_MS);
      const reconnected = await reconnect();
      if (reconnected === undefined) return unknown;
      ownedConnection = reconnected;
      const checked = await recheck(reconnected, executionId);
      if (checked === undefined) return unknown;
      const resolved = () => ({
        ...common,
        event_name: "reliability.unknown_result.resolved" as const,
        duration_ms: Math.round(performance.now() - unknownAt),
      });

      if (checked.kind === "created") {
        log({ ...resolved(), level: "INFO", result: "SUCCESS", failure_class: "SUCCESS" });
        return {
          outcome: "CREATED",
          operationExecutionId: executionId,
          attemptNumber,
          created: checked.created,
          auditEventIds: checked.auditEventIds,
        };
      }
      if (checked.kind === "complete") {
        log({ ...resolved(), level: "INFO", result: "NOOP", failure_class: null });
        return { outcome: "NOOP", operationExecutionId: executionId, attemptNumber };
      }
      // Not committed (DB-SEED-002 (3)): take the migration lock again on the new connection, then
      // start over with a new execution id. The attempt counts against the same budget.
      log({
        ...resolved(),
        level: "WARN",
        result: "FAILED",
        failure_class: "TEMPORARY_FAILURE",
      });
      if (attemptNumber >= MAX_ATTEMPTS)
        return failedOutcome(
          executionId,
          attemptNumber,
          "TEMPORARY_FAILURE",
          "DATABASE_TEMPORARY_FAILURE",
        );
      const lockStartedAt = performance.now();
      try {
        ownedLock = await acquireMigrationLock(reconnected);
      } catch (error) {
        return failedOutcome(
          executionId,
          attemptNumber,
          "TEMPORARY_FAILURE",
          error instanceof MigrationLockTimeoutError
            ? "MIGRATION_LOCK_TIMEOUT"
            : "DATABASE_TEMPORARY_FAILURE",
        );
      } finally {
        lockWaitMs += performance.now() - lockStartedAt;
      }
      client = reconnected;
    }
  } finally {
    await closeOwned();
  }
}
