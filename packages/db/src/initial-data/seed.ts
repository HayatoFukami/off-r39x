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
      readonly created: SeedCreated;
      readonly auditEventIds: readonly string[];
    }
  | { readonly outcome: "NOOP"; readonly operationExecutionId: string }
  | {
      readonly outcome: "FAILED";
      readonly operationExecutionId: string;
      readonly failureClass: SeedFailureClass;
      readonly errorCode: string;
    }
  | {
      readonly outcome: "UNKNOWN_RESULT";
      readonly operationExecutionId: string;
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
  /** From `acquireMigrationLock`; its client runs the first attempt. */
  readonly lock: MigrationLock;
  /** A new connected client, for the re-check after an unknown COMMIT result and the retry after it. */
  readonly connect: () => Promise<Client>;
  /** Called at most once, and only when a row has to be created (INF-SEED-002). */
  readonly readInput: () => string | undefined;
  /** An INFRASTRUCTURE_OPERATOR reference (SPEC-160 section 19.1). */
  readonly actorRef: string;
  readonly logger?: { log(event: LogEvent): void };
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

const failed = (
  operationExecutionId: string,
  failureClass: SeedFailureClass,
  errorCode: string,
): SeedOutcome => ({ outcome: "FAILED", operationExecutionId, failureClass, errorCode });

/** SPEC-150 REL-DB-005/006: only a missing or connection-class SQLSTATE leaves COMMIT undecided. */
function commitAcknowledgementUnknown(error: unknown): boolean {
  const code = sqlState(error);
  return !isSqlstate(code) || code.startsWith("08") || ["57P01", "57P02", "57P03"].includes(code);
}

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
    return failed(randomUUID(), "PERMANENT_FAILURE", "CONFIGURATION_INVALID");

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

  const attemptOnce = async (executionId: string): Promise<Attempt> => {
    let commitSent = false;
    let stage: "statement" | "audit" = "statement";
    try {
      await beginSeedTransaction(client);
      const eventIds = await readEventIds(client);
      if (eventIds.length >= 2) {
        await client.query("ROLLBACK");
        return {
          kind: "done",
          outcome: failed(executionId, "CONSISTENCY_FAILURE", "INITIAL_DATA_EVENT_NOT_UNIQUE"),
        };
      }
      if (eventIds.length === 1) {
        const eventId = eventIds[0] as string;
        if (await hasOfferings(client, eventId)) {
          await client.query("ROLLBACK");
          return { kind: "done", outcome: { outcome: "NOOP", operationExecutionId: executionId } };
        }
        plan = { kind: "offerings", eventId };
      } else {
        plan = { kind: "all" };
      }

      const parsed = loadInput();
      if (!parsed.ok) {
        await client.query("ROLLBACK");
        return {
          kind: "done",
          outcome: failed(executionId, "PERMANENT_FAILURE", parsed.errorCode),
        };
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
          const inserted = await insertRow(client, target, row, parentEventId);
          if (target.cardinality === "one") parentEventId = inserted.id;
          if (target.cardinality === "one") created.events.push(inserted.publicRef);
          else created.entry_ticket_offerings.push(inserted.publicRef);
          stage = "audit";
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
      commitSent = true;
      await client.query("COMMIT");
      return {
        kind: "done",
        outcome: { outcome: "CREATED", operationExecutionId: executionId, created, auditEventIds },
      };
    } catch (error) {
      if (commitSent && commitAcknowledgementUnknown(error)) return { kind: "unknown" };
      // Not committed: close the transaction. A connection that cannot even roll back is gone, which
      // proves nothing was committed (REL-DB-005): a temporary failure, to be run again.
      if (!(await succeedsWithin(client.query("ROLLBACK"), CLOSE_WAIT_MS)))
        return {
          kind: "done",
          outcome: failed(executionId, "TEMPORARY_FAILURE", "DATABASE_TEMPORARY_FAILURE"),
        };
      const code = sqlState(error);
      if (isDatabaseRetryable(error)) return { kind: "retry", code: error.code };
      // Rejected by a constraint the validation did not foresee (REL-DB-002): never retried.
      if (isSqlstate(code) && (code.startsWith("23") || code.startsWith("22")))
        return {
          kind: "done",
          outcome: failed(executionId, "PERMANENT_FAILURE", "INITIAL_DATA_CONSTRAINT_REJECTED"),
        };
      if (stage === "audit")
        return {
          kind: "done",
          outcome: failed(
            executionId,
            isConnectionClass(code) ? "TEMPORARY_FAILURE" : "PERMANENT_FAILURE",
            "AUDIT_WRITE_FAILED",
          ),
        };
      return {
        kind: "done",
        outcome: failed(executionId, "TEMPORARY_FAILURE", "UNEXPECTED_INTERNAL_ERROR"),
      };
    }
  };

  /** SPEC-150 section 11 "temporary DB connection acquisition": 3 attempts. */
  const reconnect = async (): Promise<Client | undefined> => {
    const policy = RETRY_POLICIES.databaseConnection;
    for (let n = 1; n <= policy.maxAttempts; n += 1) {
      try {
        const connection = await connect();
        connection.on("error", () => {});
        return connection;
      } catch {
        if (n < policy.maxAttempts) await sleep(retryDelay(policy, n));
      }
    }
    return undefined;
  };

  /** DB-SEED-002 (1)-(4). Resolves undefined when the result cannot be determined (4). */
  const recheck = async (connection: Client, executionId: string): Promise<Recheck | undefined> => {
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
        await sleep(retryDelay(RETRY_POLICIES[error.code], Math.min(n, 3)));
      }
    }
    return undefined;
  };

  try {
    let attemptNumber = 0;
    let retries = 0;
    const startedAt = performance.now();
    for (;;) {
      attemptNumber += 1;
      const executionId = randomUUID();
      const attempt = await attemptOnce(executionId);
      if (attempt.kind === "done") return attempt.outcome;

      if (attempt.kind === "retry") {
        retries += 1;
        const policy = RETRY_POLICIES[attempt.code];
        if (
          attemptNumber >= MAX_ATTEMPTS ||
          retries >= policy.maxAttempts ||
          performance.now() - startedAt >= policy.maxElapsedMs
        )
          return failed(executionId, "TEMPORARY_FAILURE", "DATABASE_TEMPORARY_FAILURE");
        await sleep(retryDelay(policy, retries));
        continue;
      }

      // COMMIT was sent and its acknowledgement was lost: the result is unknown (REL-DB-006).
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
        errorCode: "COMMIT_RESULT_UNKNOWN",
      };
      // The original connection is abandoned as it is: nothing more is sent on it.
      await closeOwned();
      const reconnected = await reconnect();
      if (reconnected === undefined) return unknown;
      ownedConnection = reconnected;
      const checked = await recheck(reconnected, executionId);
      if (checked === undefined) return unknown;

      if (checked.kind === "created") {
        log({
          ...common,
          event_name: "reliability.unknown_result.resolved",
          level: "INFO",
          result: "SUCCESS",
          failure_class: "SUCCESS",
        });
        return {
          outcome: "CREATED",
          operationExecutionId: executionId,
          created: checked.created,
          auditEventIds: checked.auditEventIds,
        };
      }
      if (checked.kind === "complete") {
        log({
          ...common,
          event_name: "reliability.unknown_result.resolved",
          level: "INFO",
          result: "NOOP",
          failure_class: null,
        });
        return { outcome: "NOOP", operationExecutionId: executionId };
      }
      // Not committed (DB-SEED-002 (3)): take the migration lock again on the new connection, then
      // start over with a new execution id. The attempt counts against the same budget.
      log({
        ...common,
        event_name: "reliability.unknown_result.resolved",
        level: "WARN",
        result: "FAILED",
        failure_class: "TEMPORARY_FAILURE",
      });
      if (attemptNumber >= MAX_ATTEMPTS)
        return failed(executionId, "TEMPORARY_FAILURE", "DATABASE_TEMPORARY_FAILURE");
      try {
        ownedLock = await acquireMigrationLock(reconnected);
      } catch (error) {
        return failed(
          executionId,
          "TEMPORARY_FAILURE",
          error instanceof MigrationLockTimeoutError
            ? "MIGRATION_LOCK_TIMEOUT"
            : "DATABASE_TEMPORARY_FAILURE",
        );
      }
      client = reconnected;
    }
  } finally {
    await closeOwned();
  }
}
