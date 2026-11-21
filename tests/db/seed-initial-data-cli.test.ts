import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareFoundationDatabase } from "../harness/db/foundation.ts";
import {
  buildInitialDataInput,
  type InitialDataInput,
  migratorUrl,
  newMarker,
  resetInitialData,
  runSeedCli,
  SEED_ACTOR_REF,
  sensitiveValues,
  waitUntil,
} from "../harness/db/initial-data.ts";

// PR-SEED C1: the command as an operator runs it, in a child process over TLS (SPEC-170 TST-SEED-003 (4),
// TST-SEED-005 (2); SPEC-180 INF-SEED-004, INF-SEED-005, INF-SEC-001; SPEC-160 OBS-LOG-005, TST-UNT-003).
// The commit proxy carries no TLS, so UNKNOWN_RESULT (exit code 3) is produced here without it: a
// test-only deferred trigger holds COMMIT open, the test revokes CONNECT and ends the backend
// (TC-TST-SEED-003-008). The library re-check cases are in seed-initial-data-commit-unknown.test.ts.
// Real PostgreSQL 17, synthetic values only.

const url = process.env.TEST_DATABASE_URL;
if (!url || !process.env.TEST_DATABASE_CA)
  throw new Error("Real PG17 requires TEST_DATABASE_URL and TEST_DATABASE_CA");

vi.setConfig({ testTimeout: 120_000 });

const RESULT_KEYS = [
  "actor_ref",
  "audit_event_ids",
  "counts",
  "created",
  "error_code",
  "operation_execution_id",
  "operation_id",
  "outcome",
  "schema_version",
];
const COMPLETED = "provision.initial_data_seed.completed";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

const counts = async () => ({
  events: (await admin.query("SELECT count(*)::int AS n FROM app.events")).rows[0].n,
  offerings: (await admin.query("SELECT count(*)::int AS n FROM app.entry_ticket_offerings"))
    .rows[0].n,
  audits: (await admin.query("SELECT count(*)::int AS n FROM app.audit_events")).rows[0].n,
});
const EMPTY = { events: 0, offerings: 0, audits: 0 };

function baseEnv(
  input?: InitialDataInput | string,
  overrides: Record<string, string | undefined> = {},
) {
  return {
    APP_ENV: "test",
    MIGRATION_DATABASE_URL: migratorUrl().href,
    INITIAL_DATA_SEED_ACTOR_REF: SEED_ACTOR_REF,
    INITIAL_DATA_SEED_JSON: typeof input === "string" ? input : input && JSON.stringify(input),
    ...overrides,
  };
}

const lines = (text: string) => text.split("\n").filter((line) => line.length > 0);

function resultLine(stdout: string): Record<string, unknown> {
  // INF-SEED-005: stdout carries exactly one JSON line, the business-specific result.
  expect(stdout.endsWith("\n")).toBe(true);
  const rows = lines(stdout);
  expect(rows).toHaveLength(1);
  return JSON.parse(rows[0] as string) as Record<string, unknown>;
}

function logLines(stderr: string): Record<string, unknown>[] {
  return lines(stderr).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function expectNoLeak(output: string, forbidden: readonly string[]) {
  for (const value of forbidden)
    expect(output, `output must not contain ${value.slice(0, 6)}...`).not.toContain(value);
  expect(output).not.toMatch(/\n\s+at /);
  expect(output).not.toMatch(/^\s+at /m);
}

describe("TC-TST-SEED-003-004 exit codes and the CREATED / NOOP distinction (INF-SEED-004, INF-DEP-005)", () => {
  it("TC-TST-SEED-003-004 an empty database: exit 0 and outcome CREATED; the second run: exit 0 and outcome NOOP", async () => {
    const input = buildInitialDataInput({ offeringCount: 2 });
    const first = await runSeedCli(baseEnv(input));
    expect(first.code).toBe(0);
    const created = resultLine(first.stdout);
    expect(created.outcome).toBe("CREATED");
    expect(await counts()).toEqual({ events: 1, offerings: 2, audits: 3 });

    // NOOP must not need the input at all (INF-SEED-002, INF-SEED-004).
    const second = await runSeedCli(baseEnv(undefined));
    expect(second.code).toBe(0);
    expect(resultLine(second.stdout).outcome).toBe("NOOP");
    expect(await counts()).toEqual({ events: 1, offerings: 2, audits: 3 });
    expect(created.outcome).not.toBe(resultLine(second.stdout).outcome);
  });

  it("TC-TST-SEED-003-004 two Events: exit 2 and outcome FAILED; nothing is created or audited", async () => {
    await admin.query(
      "INSERT INTO app.events (name) VALUES ('合成データ 手動イベント 1'), ('合成データ 手動イベント 2')",
    );
    const run = await runSeedCli(baseEnv(buildInitialDataInput()));
    expect(run.code).toBe(2);
    const result = resultLine(run.stdout);
    expect(result.outcome).toBe("FAILED");
    expect(result.error_code).toBe("INITIAL_DATA_EVENT_NOT_UNIQUE");
    expect(await counts()).toEqual({ events: 2, offerings: 0, audits: 0 });
  });

  it("TC-TST-SEED-003-004 rows to create but no input: exit 2, FAILED with INITIAL_DATA_INPUT_MISSING", async () => {
    const run = await runSeedCli(baseEnv(undefined));
    expect(run.code).toBe(2);
    const result = resultLine(run.stdout);
    expect(result).toMatchObject({ outcome: "FAILED", error_code: "INITIAL_DATA_INPUT_MISSING" });
    expect(await counts()).toEqual(EMPTY);
  });

  const invalidConfigurations: [string, Record<string, string | undefined>][] = [
    [
      "a URL whose user is not app_migrator",
      { MIGRATION_DATABASE_URL: "postgresql://postgres@db.invalid:5432/example" },
    ],
    [
      // decodeURIComponent throws on this user name; the command must treat it as invalid
      // configuration (exit 2, one result line), not crash.
      "a URL whose user name has a broken percent-encoding",
      { MIGRATION_DATABASE_URL: "postgresql://app%ZZ@db.invalid:5432/example" },
    ],
    [
      "a URL with another port",
      { MIGRATION_DATABASE_URL: "postgresql://app_migrator@db.invalid:5433/example" },
    ],
    [
      "a URL with a query string",
      {
        MIGRATION_DATABASE_URL: "postgresql://app_migrator@db.invalid:5432/example?sslmode=disable",
      },
    ],
    [
      "a pooler host",
      { MIGRATION_DATABASE_URL: "postgresql://app_migrator@db-pooler.invalid:5432/example" },
    ],
    ["no MIGRATION_DATABASE_URL", { MIGRATION_DATABASE_URL: undefined }],
    [
      "no actor ref",
      {
        INITIAL_DATA_SEED_ACTOR_REF: undefined,
        MIGRATION_DATABASE_URL: "postgresql://app_migrator@db.invalid:5432/example",
      },
    ],
    [
      "an empty actor ref",
      {
        INITIAL_DATA_SEED_ACTOR_REF: "",
        MIGRATION_DATABASE_URL: "postgresql://app_migrator@db.invalid:5432/example",
      },
    ],
    [
      "an actor ref that looks like an e-mail address",
      {
        INITIAL_DATA_SEED_ACTOR_REF: "operator@example.com",
        MIGRATION_DATABASE_URL: "postgresql://app_migrator@db.invalid:5432/example",
      },
    ],
    [
      "an actor ref with a space",
      {
        INITIAL_DATA_SEED_ACTOR_REF: "gha: example",
        MIGRATION_DATABASE_URL: "postgresql://app_migrator@db.invalid:5432/example",
      },
    ],
    [
      "a 129 character actor ref",
      {
        INITIAL_DATA_SEED_ACTOR_REF: "a".repeat(129),
        MIGRATION_DATABASE_URL: "postgresql://app_migrator@db.invalid:5432/example",
      },
    ],
  ];
  for (const [label, overrides] of invalidConfigurations) {
    it(`TC-TST-SEED-003-004 ${label}: exit 2 with CONFIGURATION_INVALID before any connection or row`, async () => {
      // db.invalid never resolves: reaching the connection step would give another error code.
      const run = await runSeedCli(baseEnv(buildInitialDataInput(), overrides));
      expect(run.code).toBe(2);
      const result = resultLine(run.stdout);
      expect(result).toMatchObject({ outcome: "FAILED", error_code: "CONFIGURATION_INVALID" });
      expect(result.audit_event_ids).toEqual([]);
      expect(await counts()).toEqual(EMPTY);
    });
  }

  it("TC-TST-SEED-003-004 an unknown APP_ENV: exit 2, one result line, nothing created", async () => {
    const run = await runSeedCli(baseEnv(buildInitialDataInput(), { APP_ENV: "prod" }));
    expect(run.code).toBe(2);
    expect(resultLine(run.stdout)).toMatchObject({
      outcome: "FAILED",
      error_code: "CONFIGURATION_INVALID",
    });
    expect(await counts()).toEqual(EMPTY);
  });
});

describe("TC-TST-SEED-005-002 stdout and log content, and what they must never contain (INF-SEED-005, INF-SEC-001, OBS-LOG-005, TST-UNT-003)", () => {
  const password = `SEEDPW${randomBytes(8).toString("hex")}`;

  function expectCommonLogFields(
    records: Record<string, unknown>[],
    expected: { result: string; failureClass: string | null; level: string },
  ) {
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record).toMatchObject({
        service: "RECOVERY",
        environment: "test",
        operation_id: "PROVISION.INITIAL_DATA_SEED",
        actor_type: "INFRASTRUCTURE_OPERATOR",
        schema_version: 1,
      });
      expect(typeof record.timestamp).toBe("string");
      expect(typeof record.event_name).toBe("string");
      expect(record.operation_execution_id).toMatch(UUID);
    }
    const completed = records.filter((record) => record.event_name === COMPLETED);
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ result: expected.result, level: expected.level });
    expect(completed[0]?.failure_class ?? null).toBe(expected.failureClass);
    // SPEC-160 section 22: the completion record states which attempt it closes and whether it was a retry.
    const attempt = completed[0]?.attempt_number;
    expect(Number.isInteger(attempt), "attempt_number is an integer").toBe(true);
    expect(attempt as number).toBeGreaterThanOrEqual(1);
    expect(completed[0]?.is_retry).toBe((attempt as number) > 1);
  }

  it("TC-TST-SEED-005-002 CREATED, NOOP and FAILED: result line keys, log fields and result mapping; no input value, URL, password or stack", async () => {
    const marker = newMarker();
    const input = buildInitialDataInput({ marker, offeringCount: 2 });
    const secrets = [
      ...sensitiveValues(input),
      migratorUrl({ password }).href,
      migratorUrl({ password }).href.replace("postgresql://", ""),
      password,
    ];
    const env = (json?: string) =>
      baseEnv(json, { MIGRATION_DATABASE_URL: migratorUrl({ password }).href });

    const created = await runSeedCli(env(JSON.stringify(input)));
    expect(created.code).toBe(0);
    const createdLine = resultLine(created.stdout);
    expect(Object.keys(createdLine).sort()).toEqual(RESULT_KEYS);
    expect(createdLine).toMatchObject({
      schema_version: 1,
      operation_id: "PROVISION.INITIAL_DATA_SEED",
      outcome: "CREATED",
      actor_ref: SEED_ACTOR_REF,
      error_code: null,
      counts: { events: 1, entry_ticket_offerings: 2 },
    });
    expect(createdLine.operation_execution_id).toMatch(UUID);
    const dbEvents = (await admin.query("SELECT public_ref FROM app.events")).rows.map(
      (r) => r.public_ref,
    );
    const dbOfferings = (
      await admin.query("SELECT public_ref FROM app.entry_ticket_offerings")
    ).rows.map((r) => r.public_ref as string);
    expect((createdLine.created as { events: string[] }).events).toEqual(dbEvents);
    expect(
      [
        ...(createdLine.created as { entry_ticket_offerings: string[] }).entry_ticket_offerings,
      ].sort(),
    ).toEqual(dbOfferings.sort());
    const dbAudit = (
      await admin.query("SELECT audit_event_id, operation_execution_id FROM app.audit_events")
    ).rows;
    expect([...(createdLine.audit_event_ids as string[])].sort()).toEqual(
      dbAudit.map((r) => r.audit_event_id as string).sort(),
    );
    expect(new Set(dbAudit.map((r) => r.operation_execution_id))).toEqual(
      new Set([createdLine.operation_execution_id]),
    );
    expectCommonLogFields(logLines(created.stderr), {
      result: "SUCCESS",
      failureClass: "SUCCESS",
      level: "INFO",
    });

    const noop = await runSeedCli(env(undefined));
    expect(noop.code).toBe(0);
    const noopLine = resultLine(noop.stdout);
    expect(Object.keys(noopLine).sort()).toEqual(RESULT_KEYS);
    expect(noopLine).toMatchObject({
      outcome: "NOOP",
      actor_ref: SEED_ACTOR_REF,
      created: { events: [], entry_ticket_offerings: [] },
      counts: { events: 0, entry_ticket_offerings: 0 },
      audit_event_ids: [],
      error_code: null,
    });
    expectCommonLogFields(logLines(noop.stderr), {
      result: "NOOP",
      failureClass: null,
      level: "INFO",
    });

    await resetInitialData(admin);
    await admin.query(
      "INSERT INTO app.events (name) VALUES ('合成データ 手動イベント 1'), ('合成データ 手動イベント 2')",
    );
    const failed = await runSeedCli(env(JSON.stringify(input)));
    expect(failed.code).toBe(2);
    const failedLine = resultLine(failed.stdout);
    expect(Object.keys(failedLine).sort()).toEqual(RESULT_KEYS);
    expect(failedLine).toMatchObject({
      outcome: "FAILED",
      created: { events: [], entry_ticket_offerings: [] },
      counts: { events: 0, entry_ticket_offerings: 0 },
      audit_event_ids: [],
    });
    expectCommonLogFields(logLines(failed.stderr), {
      result: "FAILED",
      failureClass: "CONSISTENCY_FAILURE",
      level: "ERROR",
    });

    for (const run of [created, noop, failed]) {
      expectNoLeak(run.stdout, secrets);
      expectNoLeak(run.stderr, secrets);
    }
  });

  it("TC-TST-SEED-005-002 malformed input: FAILED with an error code only; no input fragment and no parser message", async () => {
    const marker = newMarker();
    const raw = `{"event": ${marker}, "entry_ticket_offerings": [`;
    const run = await runSeedCli(baseEnv(raw));
    expect(run.code).toBe(2);
    expect(resultLine(run.stdout)).toMatchObject({
      outcome: "FAILED",
      error_code: "INITIAL_DATA_INPUT_INVALID",
    });
    expect(await counts()).toEqual(EMPTY);
    const forbidden = [
      marker,
      "Unexpected token",
      "in JSON at position",
      "is not valid JSON",
      "Expected property name",
    ];
    expectNoLeak(run.stdout, forbidden);
    expectNoLeak(run.stderr, forbidden);
    for (const record of logLines(run.stderr))
      expect(record.operation_id).toBe("PROVISION.INITIAL_DATA_SEED");
  });

  it("TC-TST-SEED-005-002 a connection that cannot be made: FAILED(TEMPORARY), no raw exception message, host or URL in the output", async () => {
    // Built from parts: a literal URL with a password would be a (correct) secret-scan finding.
    const target = new URL("postgresql://app_migrator@db.invalid:5432/example");
    target.password = password;
    const unreachable = target.href;
    const run = await runSeedCli(
      baseEnv(buildInitialDataInput(), { MIGRATION_DATABASE_URL: unreachable }),
    );
    expect(run.code).toBe(2);
    expect(resultLine(run.stdout)).toMatchObject({
      outcome: "FAILED",
      error_code: "DATABASE_TEMPORARY_FAILURE",
    });
    const forbidden = [
      password,
      unreachable,
      "db.invalid",
      "ENOTFOUND",
      "getaddrinfo",
      "EAI_AGAIN",
    ];
    expectNoLeak(run.stdout, forbidden);
    expectNoLeak(run.stderr, forbidden);
    for (const record of logLines(run.stderr))
      expect(record).toMatchObject({
        service: "RECOVERY",
        operation_id: "PROVISION.INITIAL_DATA_SEED",
      });
  });
});

// Test-only objects for the UNKNOWN_RESULT case: a deferred constraint trigger sleeps inside COMMIT, so
// COMMIT is sent and not yet acknowledged when the test ends the backend. Dropped after the case.
const COMMIT_SLEEP_SETUP = [
  `CREATE FUNCTION app.seed_probe_commit_sleep() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN PERFORM pg_sleep(30); RETURN NULL; END $$`,
  "GRANT EXECUTE ON FUNCTION app.seed_probe_commit_sleep() TO app_migrator",
  `CREATE CONSTRAINT TRIGGER seed_probe_commit_sleep AFTER INSERT ON app.events
     DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.seed_probe_commit_sleep()`,
];
const COMMIT_SLEEP_TEARDOWN = [
  "DROP TRIGGER IF EXISTS seed_probe_commit_sleep ON app.events",
  "DROP FUNCTION IF EXISTS app.seed_probe_commit_sleep()",
];
const SLEEPING_COMMIT_SQL = `SELECT pid FROM pg_stat_activity
  WHERE datname = current_database() AND usename = 'app_migrator'
    AND wait_event = 'PgSleep' AND query ILIKE 'commit%'`;

describe("TC-TST-SEED-003-008 the public command keeps the stdout and exit code contract (INF-SEED-001, INF-SEED-004, INF-SEED-005)", () => {
  // `pnpm db:seed-initial-data` from the repository root, as an operator or the migration job runs it:
  // stdout is the one result line only, and the exit code is the command's own (0, 2, 3), not pnpm's.
  it("TC-TST-SEED-003-008 (a) CREATED then NOOP: exit 0, stdout is exactly the one result line", async () => {
    const first = await runSeedCli(baseEnv(buildInitialDataInput()), { entry: "public" });
    expect(first.code).toBe(0);
    const created = resultLine(first.stdout);
    expect(Object.keys(created).sort()).toEqual(RESULT_KEYS);
    expect(created.outcome).toBe("CREATED");
    expect(await counts()).toEqual({ events: 1, offerings: 2, audits: 3 });

    const second = await runSeedCli(baseEnv(undefined), { entry: "public" });
    expect(second.code).toBe(0);
    expect(resultLine(second.stdout).outcome).toBe("NOOP");
  });

  it("TC-TST-SEED-003-008 (b) FAILED: exit 2 (not 1), stdout is exactly the one result line", async () => {
    const run = await runSeedCli(baseEnv(undefined), { entry: "public" });
    expect(run.code).toBe(2);
    expect(resultLine(run.stdout)).toMatchObject({
      outcome: "FAILED",
      error_code: "INITIAL_DATA_INPUT_MISSING",
    });
    expect(await counts()).toEqual(EMPTY);
  });

  it("TC-TST-SEED-003-008 (c) UNKNOWN_RESULT: exit 3 (not 1 and not 2), stdout is exactly the one result line, nothing committed", async () => {
    const database = (await admin.query("SELECT current_database() AS name")).rows[0]
      .name as string;
    const quoted = `"${database.replaceAll('"', '""')}"`;
    for (const sql of COMMIT_SLEEP_SETUP) await admin.query(sql);
    let revoked = false;
    try {
      const seeding = runSeedCli(baseEnv(buildInitialDataInput()), { entry: "public" });
      let pid: number | undefined;
      await waitUntil(
        async () => {
          pid = (await admin.query(SLEEPING_COMMIT_SQL)).rows[0]?.pid;
          return pid !== undefined;
        },
        { label: "the command's COMMIT sleeping in the deferred trigger" },
      );
      // No new connection can be made for the re-check (DB-SEED-002 (4)); then the backend ends while
      // COMMIT is in flight, so the command cannot tell whether it committed.
      await admin.query(`REVOKE CONNECT ON DATABASE ${quoted} FROM PUBLIC`);
      revoked = true;
      await admin.query("SELECT pg_terminate_backend($1)", [pid]);
      const run = await seeding;
      expect(run.code).toBe(3);
      expect(resultLine(run.stdout)).toMatchObject({
        outcome: "UNKNOWN_RESULT",
        error_code: "COMMIT_RESULT_UNKNOWN",
      });
    } finally {
      if (revoked) await admin.query(`GRANT CONNECT ON DATABASE ${quoted} TO PUBLIC`);
      for (const sql of COMMIT_SLEEP_TEARDOWN) await admin.query(sql);
    }
    // The backend ended inside COMMIT: nothing was committed, and the next run creates one set.
    expect(await counts()).toEqual(EMPTY);
    const rerun = await runSeedCli(baseEnv(buildInitialDataInput()), { entry: "public" });
    expect(rerun.code).toBe(0);
    expect(resultLine(rerun.stdout).outcome).toBe("CREATED");
    expect(await counts()).toEqual({ events: 1, offerings: 2, audits: 3 });
  });
});
