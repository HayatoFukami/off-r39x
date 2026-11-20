import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedInitialData } from "../../packages/db/src/initial-data/seed.ts";
import {
  acquireMigrationLock,
  MigrationPrincipalError,
} from "../../packages/db/src/migration-lock.ts";
import { prepareFoundationDatabase } from "../harness/db/foundation.ts";
import {
  barrier,
  buildInitialDataInput,
  connectAs,
  disallowedStatements,
  endQuietly,
  firstIndex,
  type InitialDataInput,
  insertedTables,
  recordStatements,
  resetInitialData,
  runSeed,
  SEED_ACTOR_REF,
  sensitiveValues,
  shape,
  snapshotSeededTables,
} from "../harness/db/initial-data.ts";

// PR-SEED C1 on a real PostgreSQL 17 (SPEC-170 §22.1 TST-SEED-001..005; SPEC-100 §13.5 DB-SEED-001..005;
// SPEC-180 §45.3 INF-SEED-002..005; SPEC-160 OBS-AUD-014). Constraints, locks, privileges and
// same-transaction atomicity are never proven by a fake (TST-GEN-004, DEV-TST-003). Synthetic values only.

const url = process.env.TEST_DATABASE_URL;
if (!url || !process.env.TEST_DATABASE_CA)
  throw new Error("Real PG17 requires TEST_DATABASE_URL and TEST_DATABASE_CA");

// Eight-way concurrency and lock waits take seconds by design; a stall must still fail.
vi.setConfig({ testTimeout: 60_000 });

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EVENT_FULL_FIELDS = [
  "name",
  "summary",
  "starts_at",
  "ends_at",
  "venue_name",
  "venue_details",
  "access_information",
  "participant_notices",
  "business_timezone",
];
const OFFERING_FULL_FIELDS = [
  "name",
  "description",
  "unit_amount",
  "currency",
  "sales_starts_at",
  "sales_ends_at",
  "sales_capacity",
  "purchase_limit",
  "checkin_opens_at",
  "checkin_closes_at",
  "sale_control_state",
  "held_quantity",
  "committed_quantity",
];
const OFFERING_MINIMAL_FIELDS = OFFERING_FULL_FIELDS.filter(
  (field) => !["description", "checkin_opens_at", "checkin_closes_at"].includes(field),
);

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
const sortedSet = (values: Iterable<string>) => [...values].sort();

async function insertManualEvent(name = "合成データ 手動イベント"): Promise<string> {
  return (await admin.query("INSERT INTO app.events (name) VALUES ($1) RETURNING id::text", [name]))
    .rows[0].id;
}
async function insertManualOffering(eventId: string, name = "合成データ 手動入場券") {
  await admin.query(
    `INSERT INTO app.entry_ticket_offerings
       (event_id, name, unit_amount, currency, sales_starts_at, sales_ends_at, sale_control_state,
        sales_capacity, purchase_limit)
     VALUES ($1, $2, 100, 'JPY', '2030-01-01T00:00:00Z', '2030-02-01T00:00:00Z', 'SUSPENDED', 10, 2)`,
    [eventId, name],
  );
}

describe("TC-TST-SEED-001-001 an empty database is seeded (DB-SEED-001, 003, 004; INF-SEED-004)", () => {
  it("TC-TST-SEED-001-001 CREATED: one Event, every Offering, fixed values, DB-generated public_ref", async () => {
    const input = buildInitialDataInput({ offeringCount: 3 });
    const run = await runSeed({ input });
    const outcome = shape(run.outcome);
    expect(outcome.outcome).toBe("CREATED");
    expect(run.reads()).toBe(1);

    const [event, ...rest] = await events();
    expect(rest).toHaveLength(0);
    const rows = await offerings();
    expect(rows).toHaveLength(3);

    expect(event.business_timezone).toBe("Asia/Tokyo");
    expect(event.name).toBe(input.event.name);
    expect(event.summary).toBe(input.event.summary);
    expect(event.venue_name).toBe(input.event.venue_name);
    expect(event.venue_details).toBe(input.event.venue_details);
    expect(event.access_information).toBe(input.event.access_information);
    expect(event.participant_notices).toBe(input.event.participant_notices);
    expect(event.starts_at.getTime()).toBe(Date.parse(input.event.starts_at as string));
    expect(event.ends_at.getTime()).toBe(Date.parse(input.event.ends_at as string));
    expect(event.created_at.getTime()).toBe(event.updated_at.getTime());

    rows.forEach((row, index) => {
      const wanted = input.entry_ticket_offerings[index] as Record<string, unknown>;
      expect(row.event_id).toBe(event.id);
      expect(row.name).toBe(wanted.name);
      expect(row.description).toBe(wanted.description);
      expect(row.unit_amount).toBe(String(wanted.unit_amount));
      expect(row.currency).toBe(wanted.currency);
      expect(row.sales_capacity).toBe(wanted.sales_capacity);
      expect(row.purchase_limit).toBe(wanted.purchase_limit);
      expect(row.sales_starts_at.getTime()).toBe(Date.parse(wanted.sales_starts_at as string));
      expect(row.sales_ends_at.getTime()).toBe(Date.parse(wanted.sales_ends_at as string));
      expect(row.checkin_opens_at.getTime()).toBe(Date.parse(wanted.checkin_opens_at as string));
      expect(row.checkin_closes_at.getTime()).toBe(Date.parse(wanted.checkin_closes_at as string));
      expect(row.sale_control_state).toBe("SUSPENDED");
      expect(row.held_quantity).toBe(0);
      expect(row.committed_quantity).toBe(0);
      expect(row.created_at.getTime()).toBe(row.updated_at.getTime());
    });

    const refs = [event.public_ref, ...rows.map((row) => row.public_ref)] as string[];
    for (const ref of refs) expect(ref).toMatch(UUID_V4);
    expect(new Set(refs).size).toBe(refs.length);
    const inputText = JSON.stringify(input);
    for (const ref of refs) expect(inputText).not.toContain(ref);

    expect(outcome.created?.events).toEqual([event.public_ref]);
    expect(sortedSet(outcome.created?.entry_ticket_offerings ?? [])).toEqual(
      sortedSet(rows.map((row) => row.public_ref)),
    );
  });

  it("TC-TST-SEED-001-001 a minimal input leaves every omitted nullable column NULL (no guessed value)", async () => {
    const input = buildInitialDataInput({ variant: "minimal", offeringCount: 1 });
    expect(shape((await runSeed({ input })).outcome).outcome).toBe("CREATED");
    const [event] = await events();
    const [offering] = await offerings();
    for (const column of [
      "summary",
      "starts_at",
      "ends_at",
      "venue_name",
      "venue_details",
      "access_information",
      "participant_notices",
    ])
      expect(event[column], `events.${column}`).toBeNull();
    for (const column of ["description", "checkin_opens_at", "checkin_closes_at"])
      expect(offering[column], `entry_ticket_offerings.${column}`).toBeNull();
    expect(event.business_timezone).toBe("Asia/Tokyo");
    expect(offering.sale_control_state).toBe("SUSPENDED");
  });
});

describe("TC-TST-SEED-001-003 created rows are readable by the API runtime role (database privilege only)", () => {
  it("TC-TST-SEED-001-003 app_api_runtime can SELECT the seeded Event and Offerings (not an API check)", async () => {
    await runSeed({ input: buildInitialDataInput() });
    const runtime = await connectAs("app_api_runtime");
    try {
      const seenEvents = (await runtime.query("SELECT public_ref FROM app.events")).rows;
      const seenOfferings = (
        await runtime.query("SELECT public_ref, sale_control_state FROM app.entry_ticket_offerings")
      ).rows;
      expect(seenEvents.map((row) => row.public_ref)).toEqual(
        (await events()).map((r) => r.public_ref),
      );
      expect(sortedSet(seenOfferings.map((row) => row.public_ref))).toEqual(
        sortedSet((await offerings()).map((row) => row.public_ref)),
      );
      expect(seenOfferings.every((row) => row.sale_control_state === "SUSPENDED")).toBe(true);
    } finally {
      await endQuietly(runtime);
    }
  });
});

describe("TC-TST-SEED-002-001 a second run is NOOP (DB-SEED-001, INF-SEED-004, REL-DB-007)", () => {
  it("TC-TST-SEED-002-001 NOOP changes no row, no updated_at and no Audit Event, and never reads the input", async () => {
    expect(shape((await runSeed({ input: buildInitialDataInput() })).outcome).outcome).toBe(
      "CREATED",
    );
    const before = await snapshotSeededTables(admin);
    const run = await runSeed({ input: buildInitialDataInput() });
    expect(shape(run.outcome).outcome).toBe("NOOP");
    expect(run.reads()).toBe(0);
    expect(await snapshotSeededTables(admin)).toEqual(before);
    expect(before.events).toHaveLength(1);
    expect(before.audit).toHaveLength(3);
  });
});

describe("TC-TST-SEED-002-002 operational changes are never reverted (DB-SEED-001)", () => {
  it("TC-TST-SEED-002-002 a changed Event name, Offering price and ENABLED state survive a re-run", async () => {
    await runSeed({ input: buildInitialDataInput() });
    await admin.query(
      "UPDATE app.events SET name = '合成データ 変更後の名称', updated_at = transaction_timestamp()",
    );
    await admin.query(
      `UPDATE app.entry_ticket_offerings
          SET unit_amount = 4242, sale_control_state = 'ENABLED', updated_at = transaction_timestamp()`,
    );
    const before = await snapshotSeededTables(admin);
    const run = await runSeed({ input: buildInitialDataInput() });
    expect(shape(run.outcome).outcome).toBe("NOOP");
    expect(await snapshotSeededTables(admin)).toEqual(before);
    expect((await events())[0].name).toBe("合成データ 変更後の名称");
    for (const row of await offerings()) {
      expect(row.unit_amount).toBe("4242");
      expect(row.sale_control_state).toBe("ENABLED");
    }
  });
});

describe("TC-TST-SEED-002-003 only missing Offerings are created, never topped up (DB-SEED-001, OBS-AUD-014)", () => {
  it("TC-TST-SEED-002-003 an existing Event with no Offering gets only the Offerings; the Event is untouched", async () => {
    const eventId = await insertManualEvent();
    const eventBefore = (await snapshotSeededTables(admin)).events;
    const run = await runSeed({ input: buildInitialDataInput({ offeringCount: 2 }) });
    const outcome = shape(run.outcome);
    expect(outcome.outcome).toBe("CREATED");
    expect(run.reads()).toBe(1);
    expect(outcome.created?.events).toEqual([]);
    expect(outcome.created?.entry_ticket_offerings).toHaveLength(2);
    expect((await snapshotSeededTables(admin)).events).toEqual(eventBefore);
    const rows = await offerings();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.event_id).toBe(eventId);
      expect(row.sale_control_state).toBe("SUSPENDED");
    }
    const written = await audits();
    expect(written).toHaveLength(2);
    expect(written.every((row) => row.target_type === "ENTRY_TICKET_OFFERING")).toBe(true);
    expect(sortedSet(written.map((row) => row.target_ref))).toEqual(
      sortedSet(rows.map((row) => row.public_ref)),
    );
  });

  it("TC-TST-SEED-002-003 one existing Offering and a three-Offering input: NOOP, the count stays 1", async () => {
    const eventId = await insertManualEvent();
    await insertManualOffering(eventId);
    const before = await snapshotSeededTables(admin);
    const run = await runSeed({ input: buildInitialDataInput({ offeringCount: 3 }) });
    expect(shape(run.outcome).outcome).toBe("NOOP");
    expect(run.reads()).toBe(0);
    expect(await snapshotSeededTables(admin)).toEqual(before);
    expect(await offerings()).toHaveLength(1);
  });
});

describe("TC-TST-SEED-002-004 two or more Events fail the command (DB-SEED-001, API-RLC-007)", () => {
  it("TC-TST-SEED-002-004 FAILED with CONSISTENCY_FAILURE; nothing created or updated; the input is not read", async () => {
    await insertManualEvent("合成データ 手動イベント 1");
    await insertManualEvent("合成データ 手動イベント 2");
    const before = await snapshotSeededTables(admin);
    const run = await runSeed({ input: buildInitialDataInput() });
    const outcome = shape(run.outcome);
    expect(outcome.outcome).toBe("FAILED");
    expect(outcome.failureClass).toBe("CONSISTENCY_FAILURE");
    expect(outcome.errorCode).toBe("INITIAL_DATA_EVENT_NOT_UNIQUE");
    expect(run.reads()).toBe(0);
    expect(await snapshotSeededTables(admin)).toEqual(before);
    expect(await counts()).toEqual({ events: 2, offerings: 0, audits: 0 });
  });
});

describe("TC-TST-SEED-002-005 N concurrent commands create one set (DB-SEED-002, INF-SEED-003, INF-DB-008, INV-010-07)", () => {
  it("TC-TST-SEED-002-005 eight barrier-started runs: one CREATED, seven NOOP, one set of rows and Audit Events", async () => {
    const parties = 8;
    const arrive = barrier(parties);
    const input = buildInitialDataInput({ offeringCount: 2 });
    const runs = await Promise.all(
      Array.from({ length: parties }, () =>
        runSeed({
          input,
          openMain: async () => {
            const client = await connectAs("app_migrator");
            await arrive();
            return client;
          },
        }),
      ),
    );
    const outcomes = runs.map((run) => shape(run.outcome));
    expect(outcomes.filter((o) => o.outcome === "CREATED")).toHaveLength(1);
    expect(outcomes.filter((o) => o.outcome === "NOOP")).toHaveLength(parties - 1);
    // Lazy input (INF-SEED-002): only the run that creates rows reads it.
    expect(runs.reduce((sum, run) => sum + run.reads(), 0)).toBe(1);
    expect(await counts()).toEqual({ events: 1, offerings: 2, audits: 3 });
    const created = outcomes.find((o) => o.outcome === "CREATED");
    const executionIds = new Set((await audits()).map((row) => row.operation_execution_id));
    expect([...executionIds]).toEqual([created?.operationExecutionId]);
  });
});

describe("TC-TST-SEED-003-002 validation failure rolls everything back (DB-SEED-003, DB-TXN-002, REL-DB-002)", () => {
  it("TC-TST-SEED-003-002 three Offerings, only the second invalid: FAILED, no Event, no Offering, no Audit Event", async () => {
    const input = buildInitialDataInput({
      offeringCount: 3,
      offering: (index) => (index === 1 ? { sales_capacity: -1 } : {}),
    });
    const run = await runSeed({ input });
    const outcome = shape(run.outcome);
    expect(outcome.outcome).toBe("FAILED");
    expect(outcome.failureClass).toBe("PERMANENT_FAILURE");
    expect(outcome.errorCode).toBe("INITIAL_DATA_INPUT_INVALID");
    expect(await counts()).toEqual({ events: 0, offerings: 0, audits: 0 });
  });

  it("TC-TST-SEED-003-002 a row the DB CHECK refuses after the Event and first Offerings were inserted rolls all of them back, with no retry", async () => {
    // The last defence (DB-SEED-003): a CHECK the command's validation does not know about.
    await admin.query(
      "ALTER TABLE app.entry_ticket_offerings ADD CONSTRAINT ck_seed_probe CHECK (name NOT LIKE '%FORCEFAIL%')",
    );
    try {
      const input = buildInitialDataInput({
        offeringCount: 3,
        offering: (index) => (index === 2 ? { name: "合成データ FORCEFAIL" } : {}),
      });
      const run = await runSeed({ input });
      const outcome = shape(run.outcome);
      expect(outcome.outcome).toBe("FAILED");
      expect(outcome.failureClass).toBe("PERMANENT_FAILURE");
      expect(outcome.errorCode).toBe("INITIAL_DATA_CONSTRAINT_REJECTED");
      expect(await counts()).toEqual({ events: 0, offerings: 0, audits: 0 });
      // REL-DB-002: a constraint violation is not retried (one attempt inserted the Event once).
      expect(insertedTables(run.statements).filter((t) => t === "app.events")).toHaveLength(1);
    } finally {
      await admin.query("ALTER TABLE app.entry_ticket_offerings DROP CONSTRAINT ck_seed_probe");
    }
    const left = (
      await admin.query(
        "SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'ck_seed_probe'",
      )
    ).rows[0].n;
    expect(left).toBe(0);
  });
});

describe("TC-TST-SEED-003-003 FP.AUDIT.INSERT_FAILURE rolls the whole seed back (DB-SEED-005, OBS-AUD-007)", () => {
  it("TC-TST-SEED-003-003 a refused Audit INSERT: FAILED(AUDIT_WRITE_FAILED), no row, no Audit Event, one attempt", async () => {
    // Fault injection by privilege change in the test only; production has no fault hook (TST-FLT-002).
    await admin.query("REVOKE INSERT ON app.audit_events FROM app_migrator");
    let run: Awaited<ReturnType<typeof runSeed>>;
    try {
      run = await runSeed({ input: buildInitialDataInput() });
    } finally {
      await admin.query("GRANT INSERT ON app.audit_events TO app_migrator");
    }
    expect(
      (
        await admin.query(
          "SELECT has_table_privilege('app_migrator', 'app.audit_events', 'INSERT') AS allowed",
        )
      ).rows[0].allowed,
    ).toBe(true);
    const outcome = shape(run.outcome);
    expect(outcome.outcome).toBe("FAILED");
    expect(outcome.errorCode).toBe("AUDIT_WRITE_FAILED");
    // 42501 is neither a connection class (08) nor an operator shutdown (57P0x): permanent.
    expect(outcome.failureClass).toBe("PERMANENT_FAILURE");
    expect(await counts()).toEqual({ events: 0, offerings: 0, audits: 0 });
    // No retry: the Event INSERT was issued exactly once.
    expect(insertedTables(run.statements).filter((t) => t === "app.events")).toHaveLength(1);
  });
});

describe("TC-TST-SEED-003-005 decision order (INF-SEED-002, INF-SEED-004, DB-SEED-002)", () => {
  it("TC-TST-SEED-003-005 (a) with rows to skip, a missing or malformed input is never read: NOOP", async () => {
    expect(shape((await runSeed({ input: buildInitialDataInput() })).outcome).outcome).toBe(
      "CREATED",
    );
    const before = await snapshotSeededTables(admin);
    for (const input of [undefined, "{not json", ""]) {
      const run = await runSeed({ input });
      expect(shape(run.outcome).outcome).toBe("NOOP");
      expect(run.reads()).toBe(0);
    }
    expect(await snapshotSeededTables(admin)).toEqual(before);
  });

  it("TC-TST-SEED-003-005 (b) with rows to create, a missing or malformed input is FAILED and creates nothing", async () => {
    const missing = await runSeed({ input: undefined });
    expect(shape(missing.outcome)).toMatchObject({
      outcome: "FAILED",
      failureClass: "PERMANENT_FAILURE",
      errorCode: "INITIAL_DATA_INPUT_MISSING",
    });
    expect(missing.reads()).toBe(1);
    const malformed = await runSeed({ input: "{not json" });
    expect(shape(malformed.outcome)).toMatchObject({
      outcome: "FAILED",
      failureClass: "PERMANENT_FAILURE",
      errorCode: "INITIAL_DATA_INPUT_INVALID",
    });
    expect(malformed.reads()).toBe(1);
    expect(await counts()).toEqual({ events: 0, offerings: 0, audits: 0 });
  });

  it("TC-TST-SEED-003-005 (b) an existing Event also needs a valid input to create the Offerings", async () => {
    await insertManualEvent();
    const run = await runSeed({ input: "{not json" });
    expect(shape(run.outcome)).toMatchObject({
      outcome: "FAILED",
      errorCode: "INITIAL_DATA_INPUT_INVALID",
    });
    expect(await counts()).toEqual({ events: 1, offerings: 0, audits: 0 });
  });

  it("TC-TST-SEED-003-005 (c) pg_advisory_xact_lock is issued before the first read of app.events", async () => {
    for (const input of [buildInitialDataInput(), undefined]) {
      const run = await runSeed({ input });
      const lock = firstIndex(
        run.statements,
        /pg_advisory_xact_lock\(hashtext\('app:initial-data-seed'\)\)/i,
      );
      const read = firstIndex(run.statements, /\bfrom\s+app\.events\b/i);
      expect(lock, "xact lock statement").toBeGreaterThanOrEqual(0);
      expect(read, "app.events SELECT").toBeGreaterThanOrEqual(0);
      expect(lock).toBeLessThan(read);
      await resetInitialData(admin);
    }
  });
});

describe("TC-TST-SEED-004-001 one Audit Event per created row, in the same transaction (OBS-AUD-014, DB-SEED-005)", () => {
  it("TC-TST-SEED-004-001 columns, target, target_ref, after_state, occurred_at and the returned Audit Event IDs", async () => {
    const run = await runSeed({ input: buildInitialDataInput({ offeringCount: 2 }) });
    const outcome = shape(run.outcome);
    expect(outcome.outcome).toBe("CREATED");
    const [event] = await events();
    const rows = await offerings();
    const written = await audits();
    expect(written).toHaveLength(1 + rows.length);
    expect(sortedSet(outcome.auditEventIds ?? [])).toEqual(
      sortedSet(written.map((row) => row.audit_event_id)),
    );
    for (const row of written) {
      expect(row).toMatchObject({
        audit_event_type: "BUSINESS_EFFECT",
        actor_type: "INFRASTRUCTURE_OPERATOR",
        actor_ref: SEED_ACTOR_REF,
        operation_id: "PROVISION.INITIAL_DATA_SEED",
        operation_execution_id: outcome.operationExecutionId,
        precondition_result: "PASSED",
        audit_result: "COMMITTED",
      });
    }
    const eventAudit = written.filter((row) => row.target_type === "PUBLIC_CONTENT");
    expect(eventAudit).toHaveLength(1);
    expect(eventAudit[0].target_ref).toBe(event.public_ref);
    expect(eventAudit[0].occurred_at.getTime()).toBe(event.created_at.getTime());
    const offeringAudit = written.filter((row) => row.target_type === "ENTRY_TICKET_OFFERING");
    expect(sortedSet(offeringAudit.map((row) => row.target_ref))).toEqual(
      sortedSet(rows.map((row) => row.public_ref)),
    );
    for (const audit of offeringAudit) {
      const row = rows.find((candidate) => candidate.public_ref === audit.target_ref);
      expect(audit.after_state).toBe("SUSPENDED");
      expect(audit.occurred_at.getTime()).toBe(row?.created_at.getTime());
    }
  });
});

describe("TC-TST-SEED-004-002 NOOP and a rolled-back FAILED add no Audit Event (OBS-AUD-014, OBS-AUD-009)", () => {
  it("TC-TST-SEED-004-002 the Audit count is unchanged by NOOP, by two Events, and by invalid input", async () => {
    await runSeed({ input: buildInitialDataInput() });
    const created = (await audits()).length;
    expect(created).toBe(3);
    expect(shape((await runSeed({ input: buildInitialDataInput() })).outcome).outcome).toBe("NOOP");
    expect((await audits()).length).toBe(created);

    await resetInitialData(admin);
    await insertManualEvent("合成データ 手動イベント 1");
    await insertManualEvent("合成データ 手動イベント 2");
    expect(shape((await runSeed({ input: buildInitialDataInput() })).outcome).outcome).toBe(
      "FAILED",
    );
    expect((await audits()).length).toBe(0);

    await resetInitialData(admin);
    expect(shape((await runSeed({ input: "{not json" })).outcome).outcome).toBe("FAILED");
    expect((await audits()).length).toBe(0);
  });
});

describe("TC-TST-SEED-004-003 an Audit Event carries field names, never values (OBS-AUD-014, OBS-AUD-006)", () => {
  async function expectNoValues(input: InitialDataInput) {
    const leaked = [...sensitiveValues(input), "JPY", "Asia/Tokyo"];
    const texts = (await admin.query("SELECT a::text AS text FROM app.audit_events a")).rows.map(
      (row) => row.text as string,
    );
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) for (const value of leaked) expect(text).not.toContain(value);
  }

  it("TC-TST-SEED-004-003 a full input: changed_fields is exactly the plan's field names and safe_change_summary is empty", async () => {
    const input = buildInitialDataInput({ offeringCount: 2 });
    expect(shape((await runSeed({ input })).outcome).outcome).toBe("CREATED");
    for (const row of await audits()) {
      expect(row.safe_change_summary).toEqual({});
      expect(sortedSet(row.changed_fields)).toEqual(
        sortedSet(row.target_type === "PUBLIC_CONTENT" ? EVENT_FULL_FIELDS : OFFERING_FULL_FIELDS),
      );
    }
    await expectNoValues(input);
  });

  it("TC-TST-SEED-004-003 a minimal input: omitted nullable columns are not listed", async () => {
    const input = buildInitialDataInput({ variant: "minimal", offeringCount: 1 });
    expect(shape((await runSeed({ input })).outcome).outcome).toBe("CREATED");
    for (const row of await audits()) {
      expect(row.safe_change_summary).toEqual({});
      expect(sortedSet(row.changed_fields)).toEqual(
        sortedSet(
          row.target_type === "PUBLIC_CONTENT"
            ? ["name", "business_timezone"]
            : OFFERING_MINIMAL_FIELDS,
        ),
      );
    }
    await expectNoValues(input);
  });
});

describe("TC-TST-SEED-005-004 SQL range and privileges (INF-SEED-003, SEC-DB-001, INF-AUD-001)", () => {
  it("TC-TST-SEED-005-004 the statement classifier flags everything outside the allowed forms", () => {
    expect(
      disallowedStatements([
        "BEGIN ISOLATION LEVEL READ COMMITTED",
        "SET LOCAL statement_timeout = '5000ms'; SET LOCAL lock_timeout = '1000ms'; SET LOCAL timezone = 'UTC'",
        "SELECT pg_advisory_xact_lock(hashtext('app:initial-data-seed'))",
        "SELECT id, public_ref FROM app.events ORDER BY id LIMIT 2",
        "SELECT EXISTS (SELECT 1 FROM app.entry_ticket_offerings WHERE event_id = $1)",
        'insert into "app"."audit_events" ("a") values ($1) returning "audit_event_id"',
        "INSERT INTO app.events (name) VALUES ($1) RETURNING id, public_ref",
        "COMMIT",
        "ROLLBACK",
        "SELECT current_user AS role",
        "SELECT pg_advisory_lock(hashtext('r39x:schema-migration'))",
        "SELECT pg_advisory_unlock(hashtext('r39x:schema-migration'))",
      ]),
    ).toEqual([]);
    for (const bad of [
      "UPDATE app.events SET name = 'x'",
      "DELETE FROM app.events",
      "TRUNCATE app.events",
      "CREATE TABLE app.extra (id int)",
      "ALTER TABLE app.events ADD COLUMN x int",
      "DROP TABLE app.events",
      "GRANT SELECT ON app.events TO PUBLIC",
      "REVOKE ALL ON app.events FROM PUBLIC",
      "INSERT INTO app.faq_items (question) VALUES ($1)",
      "INSERT INTO app.events (name) VALUES ($1) ON CONFLICT (id) DO UPDATE SET name = $1",
      "SELECT * FROM app.schema_migrations",
      "SELECT * FROM pg_locks",
      "SELECT pg_advisory_lock(hashtext('app:other'))",
      "SELECT 1 FROM app.events FOR UPDATE",
      "COPY app.events FROM STDIN",
    ])
      expect(disallowedStatements([bad]), bad).toHaveLength(1);
  });

  it("TC-TST-SEED-005-004 (a) CREATED, NOOP and FAILED issue only the allowed statements, and an INSERT only into the three tables", async () => {
    const created = await runSeed({ input: buildInitialDataInput() });
    expect(shape(created.outcome).outcome).toBe("CREATED");
    const noop = await runSeed({ input: buildInitialDataInput() });
    expect(shape(noop.outcome).outcome).toBe("NOOP");
    await resetInitialData(admin);
    await insertManualEvent("合成データ 手動イベント 1");
    await insertManualEvent("合成データ 手動イベント 2");
    const failed = await runSeed({ input: buildInitialDataInput() });
    expect(shape(failed.outcome).outcome).toBe("FAILED");
    for (const [label, run] of [
      ["CREATED", created],
      ["NOOP", noop],
      ["FAILED", failed],
    ] as const) {
      expect(run.statements.length, label).toBeGreaterThan(0);
      expect(disallowedStatements(run.statements), label).toEqual([]);
    }
    expect(insertedTables(noop.statements)).toEqual([]);
    expect(insertedTables(failed.statements)).toEqual([]);
    expect(sortedSet(new Set(insertedTables(created.statements)))).toEqual([
      "app.audit_events",
      "app.entry_ticket_offerings",
      "app.events",
    ]);
  });

  it("TC-TST-SEED-005-004 (b) the runtime roles cannot INSERT an Event or an Offering (42501)", async () => {
    for (const role of ["app_api_runtime", "app_email_runtime", "app_reconciliation_runtime"]) {
      const client = await connectAs(role);
      try {
        await expect(
          client.query("INSERT INTO app.events (name) VALUES ('合成データ 拒否されるイベント')"),
          `${role} events`,
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          client.query(
            `INSERT INTO app.entry_ticket_offerings
               (event_id, name, unit_amount, currency, sales_starts_at, sales_ends_at,
                sale_control_state, sales_capacity, purchase_limit)
             VALUES (1, '合成データ 拒否される入場券', 100, 'JPY', '2030-01-01T00:00:00Z',
                     '2030-02-01T00:00:00Z', 'SUSPENDED', 10, 2)`,
          ),
          `${role} entry_ticket_offerings`,
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await endQuietly(client);
      }
    }
    expect(await counts()).toEqual({ events: 0, offerings: 0, audits: 0 });
  });

  it("TC-TST-SEED-005-004 (c) a runtime role connection cannot take the migration lock and sends no INSERT", async () => {
    const statements: string[] = [];
    const client = recordStatements(await connectAs("app_api_runtime"), statements);
    try {
      await expect(acquireMigrationLock(client)).rejects.toBeInstanceOf(MigrationPrincipalError);
    } finally {
      await endQuietly(client);
    }
    expect(insertedTables(statements)).toEqual([]);
    // After the current_user check nothing else (in particular no advisory lock) is sent.
    expect(statements.some((text) => /pg_advisory/i.test(text))).toBe(false);
    expect(await counts()).toEqual({ events: 0, offerings: 0, audits: 0 });
  });

  it("TC-TST-SEED-005-004 (d) a handle that was never issued by acquireMigrationLock is refused before any SQL", async () => {
    const statements: string[] = [];
    const client = recordStatements(await connectAs("app_migrator"), statements);
    let reads = 0;
    try {
      const forged = { client, release: async () => true };
      const result = await seedInitialData({
        lock: forged as never,
        connect: () => connectAs("app_migrator"),
        readInput: () => {
          reads += 1;
          return JSON.stringify(buildInitialDataInput());
        },
        actorRef: SEED_ACTOR_REF,
      }).then(
        (value: unknown) => ({ value }),
        (error: unknown) => ({ error }),
      );
      if ("value" in result) expect(shape(result.value).outcome).toBe("FAILED");
      else expect(result.error).toBeInstanceOf(Error);
    } finally {
      await endQuietly(client);
    }
    expect(statements).toEqual([]);
    expect(reads).toBe(0);
    expect(await counts()).toEqual({ events: 0, offerings: 0, audits: 0 });
  });

  it("TC-TST-SEED-005-004 (d) a handle that was already released is refused before any SQL", async () => {
    const statements: string[] = [];
    const client = recordStatements(await connectAs("app_migrator"), statements);
    let reads = 0;
    try {
      const lock = await acquireMigrationLock(client);
      await lock.release();
      const sent = statements.length;
      const result = await seedInitialData({
        lock,
        connect: () => connectAs("app_migrator"),
        readInput: () => {
          reads += 1;
          return JSON.stringify(buildInitialDataInput());
        },
        actorRef: SEED_ACTOR_REF,
      }).then(
        (value: unknown) => ({ value }),
        (error: unknown) => ({ error }),
      );
      if ("value" in result) expect(shape(result.value).outcome).toBe("FAILED");
      else expect(result.error).toBeInstanceOf(Error);
      expect(statements.length).toBe(sent);
    } finally {
      await endQuietly(client);
    }
    expect(reads).toBe(0);
    expect(await counts()).toEqual({ events: 0, offerings: 0, audits: 0 });
  });
});
