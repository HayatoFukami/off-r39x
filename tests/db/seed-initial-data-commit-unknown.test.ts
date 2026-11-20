import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { outcomeExitCode, outcomeLogFields } from "../../packages/db/src/initial-data/seed.ts";
import {
  type CommitProxyMode,
  startCommitAcknowledgementDropProxy,
} from "../harness/db/commit-proxy.ts";
import { prepareFoundationDatabase } from "../harness/db/foundation.ts";
import {
  buildInitialDataInput,
  connectAs,
  disallowedStatements,
  endQuietly,
  type InitialDataInput,
  insertedTables,
  type RecordedLog,
  resetInitialData,
  runSeed,
  SEED_ACTOR_REF,
  shape,
  snapshotSeededTables,
  waitUntil,
} from "../harness/db/initial-data.ts";

// PR-SEED C1: COMMIT whose result is unknown (SPEC-170 TST-SEED-006, Fault Point
// FP.DB.AFTER_COMMIT_SENT_BEFORE_ACK; SPEC-100 DB-SEED-002; SPEC-150 REL-DB-005..008; SPEC-160 OBS-DB-004).
// The re-check runs through the library function: the commit proxy cannot carry TLS, so the CLI (which
// requires TLS) cannot be driven into UNKNOWN_RESULT here. Real PostgreSQL 17, synthetic values only.

const url = process.env.TEST_DATABASE_URL;
if (!url || !process.env.TEST_DATABASE_CA)
  throw new Error("Real PG17 requires TEST_DATABASE_URL and TEST_DATABASE_CA");

// Lock-budget scenarios wait several seconds by design (SPEC-150 section 11); a stall must still fail.
vi.setConfig({ testTimeout: 60_000 });

const OPENED = "reliability.unknown_result.opened";
const RESOLVED = "reliability.unknown_result.resolved";
const SEED_TABLES = ["app.audit_events", "app.entry_ticket_offerings", "app.events"];
const LOCK_WAIT_SQL = `SELECT count(*)::int AS n FROM pg_stat_activity
  WHERE datname = current_database() AND pid <> pg_backend_pid()
    AND wait_event_type = 'Lock' AND wait_event = 'advisory'
    AND query ILIKE '%pg_advisory_xact_lock%'`;

let admin: Client;
beforeAll(async () => {
  admin = new Client({ connectionString: url });
  await admin.connect();
  await prepareFoundationDatabase(admin);
});
afterAll(async () => {
  await admin?.end();
});
beforeEach(async () => {
  await resetInitialData(admin);
});

const events = async () => (await admin.query("SELECT * FROM app.events ORDER BY id")).rows;
const offerings = async () =>
  (await admin.query("SELECT * FROM app.entry_ticket_offerings ORDER BY id")).rows;
const audits = async () => (await admin.query("SELECT * FROM app.audit_events ORDER BY id")).rows;
const counts = async () => ({
  events: (await events()).length,
  offerings: (await offerings()).length,
  audits: (await audits()).length,
});
const named = (logs: RecordedLog[], name: string) => logs.filter((log) => log.event_name === name);

async function insertManualEvent(): Promise<string> {
  return (
    await admin.query(
      "INSERT INTO app.events (name) VALUES ('合成データ 手動イベント') RETURNING id::text",
    )
  ).rows[0].id;
}

/** Seed whose original connection goes through the fault proxy; re-check and retries connect directly. */
async function seedThroughProxy(
  mode: CommitProxyMode,
  options: {
    input?: InitialDataInput;
    connect?: (wrap: <T extends Client>(client: T) => T) => Promise<Client>;
    statements?: string[];
    logs?: RecordedLog[];
  } = {},
) {
  const proxy = await startCommitAcknowledgementDropProxy(new URL(url as string), { mode });
  const statements = options.statements ?? [];
  const logs = options.logs ?? [];
  try {
    const run = await runSeed({
      input: options.input ?? buildInitialDataInput(),
      openMain: () => connectAs("app_migrator", proxy.url),
      connect: options.connect,
      statements,
      logs,
    });
    return { run, statements, logs, fired: proxy.fired() };
  } finally {
    await proxy.close();
  }
}

describe("TC-TST-SEED-006-001 COMMIT took effect, acknowledgement lost (DB-SEED-002 (1), REL-DB-006, REL-DB-007, OBS-DB-004)", () => {
  it("TC-TST-SEED-006-001 the re-check finds this run's Audit Event: CREATED, one set of rows, opened then resolved(SUCCESS)", async () => {
    const { run, logs, fired } = await seedThroughProxy("drop_ack");
    const outcome = shape(run.outcome);
    expect(fired).toBe(1);
    expect(outcome.outcome).toBe("CREATED");
    expect(await counts()).toEqual({ events: 1, offerings: 2, audits: 3 });
    const written = await audits();
    expect(new Set(written.map((row) => row.operation_execution_id))).toEqual(
      new Set([outcome.operationExecutionId]),
    );
    expect([...(outcome.auditEventIds ?? [])].sort()).toEqual(
      written.map((row) => row.audit_event_id as string).sort(),
    );
    const [event] = await events();
    expect(outcome.created?.events).toEqual([event.public_ref]);
    expect([...(outcome.created?.entry_ticket_offerings ?? [])].sort()).toEqual(
      (await offerings()).map((row) => row.public_ref as string).sort(),
    );
    const opened = named(logs, OPENED);
    const resolved = named(logs, RESOLVED);
    expect(opened).toHaveLength(1);
    expect(resolved).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      level: "WARN",
      result: "PENDING",
      failure_class: "UNKNOWN_RESULT",
      operation_id: "PROVISION.INITIAL_DATA_SEED",
      operation_execution_id: outcome.operationExecutionId,
    });
    expect(resolved[0]).toMatchObject({ result: "SUCCESS" });
    expect(logs.indexOf(opened[0] as RecordedLog)).toBeLessThan(
      logs.indexOf(resolved[0] as RecordedLog),
    );
  });
});

describe("TC-TST-SEED-006-002 another run created the rows meanwhile (DB-SEED-002 (2), REL-DB-008)", () => {
  it("TC-TST-SEED-006-002 uncommitted here, complete elsewhere: NOOP, the other run's rows untouched, no Audit Event of ours", async () => {
    const ours = buildInitialDataInput();
    const theirs = buildInitialDataInput();
    let other: Awaited<ReturnType<typeof runSeed>> | undefined;
    let connects = 0;
    const { run, logs, fired } = await seedThroughProxy("drop_request", {
      input: ours,
      connect: async (wrap) => {
        connects += 1;
        if (connects === 1) {
          // Before the re-check connection is handed back, a different run completes its seed.
          other = await runSeed({ input: theirs, actorRef: "gha:example-repo:other" });
        }
        return wrap(await connectAs("app_migrator"));
      },
    });
    expect(fired).toBe(1);
    expect(shape(other?.outcome).outcome).toBe("CREATED");
    expect(shape(run.outcome).outcome).toBe("NOOP");
    expect(await counts()).toEqual({ events: 1, offerings: 2, audits: 3 });
    const [event] = await events();
    expect(event.name).toBe(theirs.event.name);
    expect(event.name).not.toBe(ours.event.name);
    const written = await audits();
    expect(new Set(written.map((row) => row.operation_execution_id))).toEqual(
      new Set([shape(other?.outcome).operationExecutionId]),
    );
    expect(new Set(written.map((row) => row.actor_ref))).toEqual(
      new Set(["gha:example-repo:other"]),
    );
    expect(named(logs, OPENED)).toHaveLength(1);
    expect(named(logs, RESOLVED)[0]).toMatchObject({ result: "NOOP" });
  });
});

describe("TC-TST-SEED-006-003 COMMIT never took effect: re-check, then retry (DB-SEED-002 (3), REL-DB-005, REL-DB-006)", () => {
  it("TC-TST-SEED-006-003 the retry runs on a fresh connection with a fresh execution id and creates one set", async () => {
    const statements: string[] = [];
    const { run, logs, fired } = await seedThroughProxy("drop_request", { statements });
    const outcome = shape(run.outcome);
    expect(fired).toBe(1);
    expect(outcome.outcome).toBe("CREATED");
    expect(await counts()).toEqual({ events: 1, offerings: 2, audits: 3 });
    const opened = named(logs, OPENED);
    expect(opened).toHaveLength(1);
    const firstAttemptId = opened[0]?.operation_execution_id as string;
    expect(firstAttemptId).toMatch(/^[0-9a-f-]{36}$/);
    expect(outcome.operationExecutionId).not.toBe(firstAttemptId);
    const written = await audits();
    expect(new Set(written.map((row) => row.operation_execution_id))).toEqual(
      new Set([outcome.operationExecutionId]),
    );
    expect(written.some((row) => row.operation_execution_id === firstAttemptId)).toBe(false);
    expect(named(logs, RESOLVED)[0]).toMatchObject({
      result: "FAILED",
      failure_class: "TEMPORARY_FAILURE",
    });
    // The Event INSERT was issued twice in total (attempt 1 on the lost connection, attempt 2 on the new
    // one), and the migration lock was taken again on the new connection (INF-SEED-003).
    expect(insertedTables(statements).filter((table) => table === "app.events")).toHaveLength(2);
    expect(
      statements.filter((text) =>
        /pg_advisory_lock\(hashtext\('r39x:schema-migration'\)\)/i.test(text),
      ),
    ).toHaveLength(2);
    expect(disallowedStatements(statements)).toEqual([]);
  });
});

describe("TC-TST-SEED-006-004 Event exists, only Offerings were being created (DB-SEED-002 (3-1))", () => {
  it("TC-TST-SEED-006-004 an existing Event is not proof of success: 0 Offerings means uncommitted, so retry", async () => {
    const eventId = await insertManualEvent();
    const eventBefore = (await snapshotSeededTables(admin)).events;
    const { run, logs, fired } = await seedThroughProxy("drop_request");
    const outcome = shape(run.outcome);
    expect(fired).toBe(1);
    expect(outcome.outcome).toBe("CREATED");
    expect(outcome.created?.events).toEqual([]);
    expect(outcome.created?.entry_ticket_offerings).toHaveLength(2);
    expect((await snapshotSeededTables(admin)).events).toEqual(eventBefore);
    const rows = await offerings();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.event_id === eventId)).toBe(true);
    const written = await audits();
    expect(written).toHaveLength(2);
    expect(written.every((row) => row.target_type === "ENTRY_TICKET_OFFERING")).toBe(true);
    expect(named(logs, RESOLVED)[0]).toMatchObject({
      result: "FAILED",
      failure_class: "TEMPORARY_FAILURE",
    });
  });
});

describe("TC-TST-SEED-006-005 the re-check starts while the original COMMIT is in progress (DB-SEED-002 (3-2), REL-DB-006)", () => {
  it("TC-TST-SEED-006-005 the re-check waits on the xact lock, then sees the committed rows: CREATED, not a false uncommitted", async () => {
    const proxy = await startCommitAcknowledgementDropProxy(new URL(url as string), {
      mode: "hold_request",
    });
    const logs: RecordedLog[] = [];
    const statements: string[] = [];
    const seeding = runSeed({
      input: buildInitialDataInput(),
      openMain: () => connectAs("app_migrator", proxy.url),
      statements,
      logs,
    });
    let run: Awaited<typeof seeding>;
    try {
      try {
        await waitUntil(async () => (await admin.query(LOCK_WAIT_SQL)).rows[0].n > 0, {
          label: "the re-check connection waiting for pg_advisory_xact_lock",
        });
        expect(proxy.fired()).toBe(1);
        // The original transaction is still open: nothing is visible yet.
        expect(await counts()).toEqual({ events: 0, offerings: 0, audits: 0 });
      } finally {
        await proxy.releaseCommit();
      }
      run = await seeding;
    } finally {
      await seeding.catch(() => {});
      await proxy.close();
    }
    const outcome = shape(run.outcome);
    expect(outcome.outcome).toBe("CREATED");
    expect(await counts()).toEqual({ events: 1, offerings: 2, audits: 3 });
    const opened = named(logs, OPENED)[0];
    expect(opened?.operation_execution_id).toBe(outcome.operationExecutionId);
    const written = await audits();
    expect(new Set(written.map((row) => row.operation_execution_id))).toEqual(
      new Set([outcome.operationExecutionId]),
    );
    expect(named(logs, RESOLVED)[0]).toMatchObject({ result: "SUCCESS" });
  });
});

/** (a) COMMIT succeeded but no new connection can be made for the re-check. */
async function connectionFailureScenario() {
  let attempts = 0;
  const result = await seedThroughProxy("drop_ack", {
    connect: async () => {
      attempts += 1;
      throw new Error("synthetic connection failure");
    },
  });
  return { ...result, attempts };
}

/** (b) COMMIT never happened and another session holds the seed xact lock beyond the retry budget. */
async function lockHeldScenario() {
  const holder = new Client({ connectionString: url });
  await holder.connect();
  let held = false;
  try {
    const result = await seedThroughProxy("drop_request", {
      connect: async (wrap) => {
        if (!held) {
          held = true;
          // Waits for the dead original backend to release its lock, then holds it for the whole re-check.
          await holder.query("BEGIN");
          await holder.query("SELECT pg_advisory_xact_lock(hashtext('app:initial-data-seed'))");
        }
        return wrap(await connectAs("app_migrator"));
      },
    });
    return result;
  } finally {
    await holder.query("ROLLBACK").catch(() => {});
    await endQuietly(holder);
  }
}

describe("TC-TST-SEED-006-006 the re-check also fails (DB-SEED-002 (4), INF-SEED-004, OBS-AUD-014, REL-DB-007)", () => {
  it("TC-TST-SEED-006-006 (a) no connection for the re-check: UNKNOWN_RESULT, exit code 3, committed rows and Audit Events stay", async () => {
    const { run, logs, statements, attempts, fired } = await connectionFailureScenario();
    const outcome = shape(run.outcome);
    expect(fired).toBe(1);
    expect(outcome.outcome).toBe("UNKNOWN_RESULT");
    expect(outcome.errorCode).toBe("COMMIT_RESULT_UNKNOWN");
    expect(outcomeExitCode(run.outcome as never)).toBe(3);
    expect(outcomeLogFields(run.outcome as never)).toMatchObject({
      result: "PENDING",
      failure_class: "UNKNOWN_RESULT",
      level: "WARN",
    });
    // SPEC-150 §11 temporary DB connection acquisition: 3 connection attempts.
    expect(attempts).toBe(3);
    // The committed rows and Audit Events are neither deleted nor repaired, and nothing is added.
    expect(await counts()).toEqual({ events: 1, offerings: 2, audits: 3 });
    expect(named(logs, OPENED)).toHaveLength(1);
    expect(named(logs, OPENED)[0]).toMatchObject({
      result: "PENDING",
      failure_class: "UNKNOWN_RESULT",
    });
    expect(insertedTables(statements).every((table) => SEED_TABLES.includes(table))).toBe(true);
    // Only the original attempt's INSERTs exist: no second Event, no Review Case, no extra Audit Event.
    expect(insertedTables(statements).filter((table) => table === "app.events")).toHaveLength(1);
    expect(insertedTables(statements).filter((table) => table === "app.audit_events")).toHaveLength(
      3,
    );
  });

  it("TC-TST-SEED-006-006 (b) the xact lock stays held past the budget: UNKNOWN_RESULT, nothing created, no extra Audit Event", async () => {
    const { run, logs, statements, fired } = await lockHeldScenario();
    const outcome = shape(run.outcome);
    expect(fired).toBe(1);
    expect(outcome.outcome).toBe("UNKNOWN_RESULT");
    expect(outcome.errorCode).toBe("COMMIT_RESULT_UNKNOWN");
    expect(outcomeExitCode(run.outcome as never)).toBe(3);
    // The COMMIT was never sent, so the lost transaction left nothing behind either.
    expect(await counts()).toEqual({ events: 0, offerings: 0, audits: 0 });
    expect(named(logs, OPENED)).toHaveLength(1);
    expect(insertedTables(statements).every((table) => SEED_TABLES.includes(table))).toBe(true);
    expect(insertedTables(statements).filter((table) => table === "app.events")).toHaveLength(1);
  });
});

describe("TC-TST-SEED-006-007 re-running after recovery (INF-SEED-004, REL-DB-007)", () => {
  it("TC-TST-SEED-006-007 (a) after an UNKNOWN_RESULT whose COMMIT had taken effect, the same command is NOOP and nothing duplicates", async () => {
    expect(shape((await connectionFailureScenario()).run.outcome).outcome).toBe("UNKNOWN_RESULT");
    const before = await snapshotSeededTables(admin);
    const rerun = await runSeed({ input: buildInitialDataInput(), actorRef: SEED_ACTOR_REF });
    expect(shape(rerun.outcome).outcome).toBe("NOOP");
    expect(rerun.reads()).toBe(0);
    expect(await snapshotSeededTables(admin)).toEqual(before);
    expect(await counts()).toEqual({ events: 1, offerings: 2, audits: 3 });
  });

  it("TC-TST-SEED-006-007 (b) after an UNKNOWN_RESULT with nothing committed, the same command creates one set, without duplicates", async () => {
    expect(shape((await lockHeldScenario()).run.outcome).outcome).toBe("UNKNOWN_RESULT");
    expect(await counts()).toEqual({ events: 0, offerings: 0, audits: 0 });
    const rerun = await runSeed({ input: buildInitialDataInput() });
    expect(shape(rerun.outcome).outcome).toBe("CREATED");
    expect(await counts()).toEqual({ events: 1, offerings: 2, audits: 3 });
    const again = await runSeed({ input: buildInitialDataInput() });
    expect(shape(again.outcome).outcome).toBe("NOOP");
    expect(await counts()).toEqual({ events: 1, offerings: 2, audits: 3 });
  });
});
