import { readFile } from "node:fs/promises";
import { Client, type Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, runMigrations } from "../../packages/db/src/index.ts";
import { migrationIdentities } from "../../packages/db/src/migrations.ts";
import { catalogQuery, requiredCatalog } from "../../packages/db/src/schema-contract.ts";
import { installSyntheticDirectory, prepareFoundationDatabase } from "../harness/db/foundation.ts";

// PR-GK-1 C1: the two Karaoke tables of migration 0004 (app.karaoke_exclusive_scopes and
// app.karaoke_slots) on a real PostgreSQL 17 (SPEC-100 §27, §28, §28.1, §45.4; SPEC-170 §22-§24, §61,
// TST-DB-001, TST-DB-004, TST-DB-005, TST-KRK-001, TST-CON-001). Constraints, the exclusion constraint,
// identity, foreign keys, concurrency and privileges are never proven by a fake (TST-GEN-004,
// DEV-TST-003). The catalog goldens below are written by hand from SPEC-100 and the PostgreSQL 17
// normalised notation; they are not derived from schema-contract.json or from the migration.
// Every violating row breaks exactly one constraint, and every assertion checks the SQLSTATE and the
// constraint name together. All data is synthetic. Times are built from the base instant T with
// microsecond precision, so that a 1 microsecond overlap and a 0 microsecond adjacency are both exact.

const url = process.env.TEST_DATABASE_URL;
const caPath = process.env.TEST_DATABASE_CA;
if (!url || !caPath) throw new Error("Real PG17 requires TEST_DATABASE_URL and TEST_DATABASE_CA");

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// An id no identity sequence of this test database reaches.
const ABSENT_ID = "9223372036854775807";
const SALES_START = "2030-01-01T00:00:00Z";
const SALES_END = "2030-01-02T00:00:00Z";
const EXCLUSION = "ex_karaoke_slots_scope_occupancy";
const SCOPE = "karaoke_exclusive_scopes";
const SLOT = "karaoke_slots";
const TABLES = [SCOPE, SLOT] as const;
const SLOT_STATES = ["AVAILABLE", "HELD", "SOLD", "SALES_STOPPED"] as const;

// T = 2030-01-01T01:00:00Z. at(minutes, microseconds) is T plus that offset, in ISO notation with six
// fractional digits (a JS Date holds only milliseconds, so the remainder is appended as text).
const T_MS = Date.parse("2030-01-01T01:00:00Z");
function at(minutes: number, microseconds = 0): string {
  const total = minutes * 60_000_000 + microseconds;
  const ms = Math.floor(total / 1000);
  const rest = total - ms * 1000;
  const iso = new Date(T_MS + ms).toISOString().replace("Z", "");
  return `${iso}${String(rest).padStart(3, "0")}Z`;
}

type RuntimeRole = "app_api_runtime" | "app_email_runtime" | "app_reconciliation_runtime";
const RUNTIME_SERVICES = [
  ["app_api_runtime", "api"],
  ["app_email_runtime", "email-worker"],
  ["app_reconciliation_runtime", "reconciliation-worker"],
] as const;

let admin: Client;
const runtimes = new Map<RuntimeRole, ReturnType<typeof createDatabase>>();
const poolOf = (role: RuntimeRole): Pool => {
  const runtime = runtimes.get(role);
  if (!runtime) throw new Error(`runtime pool ${role} is not open`);
  return runtime.pool;
};

beforeAll(async () => {
  admin = new Client({ connectionString: url });
  await admin.connect();
  await prepareFoundationDatabase(admin);
  await installSyntheticDirectory(admin);
  const ca = await readFile(caPath as string, "utf8");
  for (const [role, service] of RUNTIME_SERVICES) {
    const runtimeUrl = new URL(url as string);
    runtimeUrl.username = role;
    runtimeUrl.password = "";
    runtimeUrl.search = "";
    runtimes.set(
      role,
      createDatabase({ connectionString: runtimeUrl.href, environment: "test", service, ca }),
    );
  }
});

afterAll(async () => {
  for (const runtime of runtimes.values()) await runtime.close();
  await admin?.end();
});

// ---- goldens (SPEC-100 §27, §28, §28.1, §45.4, §9, §10, §8.3; PostgreSQL 17 notation) -------------

const TSTZ = "timestamp with time zone";
const NOW_DEFAULT = "transaction_timestamp()";

// [name, format_type, attnotnull, attidentity, pg_get_expr(default)] in attnum order.
type GoldenColumn = [
  name: string,
  type: string,
  notNull: boolean,
  identity: string,
  defaultExpr: string | null,
];
const idColumn: GoldenColumn = ["id", "bigint", true, "a", null];
const publicRefColumn: GoldenColumn = ["public_ref", "uuid", true, "", "gen_random_uuid()"];
const createdAtColumn: GoldenColumn = ["created_at", TSTZ, true, "", NOW_DEFAULT];
const updatedAtColumn: GoldenColumn = ["updated_at", TSTZ, true, "", NOW_DEFAULT];
const tstz = (name: string): GoldenColumn => [name, TSTZ, true, "", null];
const bigintCol = (name: string): GoldenColumn => [name, "bigint", true, "", null];

// [conname, contype, pg_get_constraintdef]
type GoldenConstraint = [name: string, kind: string, definition: string];
// [index name, pg_get_indexdef]
type GoldenIndex = [name: string, definition: string];
const byFirst = (a: [string, ...unknown[]], b: [string, ...unknown[]]) =>
  a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;

interface GoldenTable {
  table: string;
  columns: GoldenColumn[];
  constraints: GoldenConstraint[];
  indexes: GoldenIndex[];
}
const SLOT_UNIQUE_TIMES = "exclusive_scope_id, usage_start, usage_end, cycle_end";
const SLOT_UNIQUE_CANDIDATE = "generation_cause_key, exclusive_scope_id, generation_candidate_no";
const GOLDEN_TABLES: GoldenTable[] = [
  {
    table: SCOPE,
    columns: [
      idColumn,
      publicRefColumn,
      bigintCol("event_id"),
      ["name", "text", true, "", null],
      ["sort_order", "integer", true, "", "0"],
      createdAtColumn,
      updatedAtColumn,
    ],
    constraints: [
      [`pk_${SCOPE}`, "p", "PRIMARY KEY (id)"],
      [`uq_${SCOPE}_public_ref`, "u", "UNIQUE (public_ref)"],
      [
        `fk_${SCOPE}_event`,
        "f",
        "FOREIGN KEY (event_id) REFERENCES app.events(id) ON DELETE RESTRICT",
      ],
    ],
    indexes: [
      [`pk_${SCOPE}`, `CREATE UNIQUE INDEX pk_${SCOPE} ON app.${SCOPE} USING btree (id)`],
      [
        `uq_${SCOPE}_public_ref`,
        `CREATE UNIQUE INDEX uq_${SCOPE}_public_ref ON app.${SCOPE} USING btree (public_ref)`,
      ],
    ],
  },
  {
    table: SLOT,
    columns: [
      idColumn,
      publicRefColumn,
      bigintCol("exclusive_scope_id"),
      bigintCol("sales_configuration_id"),
      ["state", "text", true, "", null],
      tstz("usage_start"),
      tstz("usage_end"),
      tstz("cycle_end"),
      ["generation_cause_key", "uuid", true, "", null],
      ["generation_candidate_no", "integer", true, "", null],
      createdAtColumn,
      updatedAtColumn,
    ],
    constraints: [
      [`pk_${SLOT}`, "p", "PRIMARY KEY (id)"],
      [`uq_${SLOT}_public_ref`, "u", "UNIQUE (public_ref)"],
      [`uq_${SLOT}_scope_times`, "u", `UNIQUE (${SLOT_UNIQUE_TIMES})`],
      [`uq_${SLOT}_generation_candidate`, "u", `UNIQUE (${SLOT_UNIQUE_CANDIDATE})`],
      [
        `fk_${SLOT}_exclusive_scope`,
        "f",
        `FOREIGN KEY (exclusive_scope_id) REFERENCES app.${SCOPE}(id) ON DELETE RESTRICT`,
      ],
      [
        `fk_${SLOT}_sales_configuration`,
        "f",
        "FOREIGN KEY (sales_configuration_id) REFERENCES app.karaoke_sales_configurations(id) ON DELETE RESTRICT",
      ],
      [
        `ck_${SLOT}_state`,
        "c",
        "CHECK ((state = ANY (ARRAY['AVAILABLE'::text, 'HELD'::text, 'SOLD'::text, 'SALES_STOPPED'::text])))",
      ],
      [`ck_${SLOT}_usage_period`, "c", "CHECK ((usage_start < usage_end))"],
      [`ck_${SLOT}_cycle_end`, "c", "CHECK ((usage_end <= cycle_end))"],
      [`ck_${SLOT}_generation_candidate_no`, "c", "CHECK ((generation_candidate_no >= 0))"],
      [
        EXCLUSION,
        "x",
        "EXCLUDE USING gist (exclusive_scope_id WITH =, tstzrange(usage_start, cycle_end, '[)'::text) WITH &&)",
      ],
    ],
    indexes: [
      [
        EXCLUSION,
        `CREATE INDEX ${EXCLUSION} ON app.${SLOT} USING gist (exclusive_scope_id, tstzrange(usage_start, cycle_end, '[)'::text))`,
      ],
      [
        "ix_karaoke_slots_scope_usage",
        `CREATE INDEX ix_karaoke_slots_scope_usage ON app.${SLOT} USING btree (exclusive_scope_id, usage_start)`,
      ],
      [
        "ix_karaoke_slots_usage_start",
        `CREATE INDEX ix_karaoke_slots_usage_start ON app.${SLOT} USING btree (usage_start)`,
      ],
      [`pk_${SLOT}`, `CREATE UNIQUE INDEX pk_${SLOT} ON app.${SLOT} USING btree (id)`],
      [
        `uq_${SLOT}_generation_candidate`,
        `CREATE UNIQUE INDEX uq_${SLOT}_generation_candidate ON app.${SLOT} USING btree (${SLOT_UNIQUE_CANDIDATE})`,
      ],
      [
        `uq_${SLOT}_public_ref`,
        `CREATE UNIQUE INDEX uq_${SLOT}_public_ref ON app.${SLOT} USING btree (public_ref)`,
      ],
      [
        `uq_${SLOT}_scope_times`,
        `CREATE UNIQUE INDEX uq_${SLOT}_scope_times ON app.${SLOT} USING btree (${SLOT_UNIQUE_TIMES})`,
      ],
    ],
  },
];
const ALL_CONSTRAINT_NAMES = GOLDEN_TABLES.flatMap((g) => g.constraints.map(([name]) => name));
const SEQUENCES = TABLES.map((table) => `${table}_id_seq`);

// ---- helpers: one transaction per scenario, one savepoint per attempt ---------------------------

interface PgError {
  code?: string;
  constraint?: string;
  column?: string;
}
type Row = Record<string, unknown>;

async function inRolledBackTransaction<T>(run: () => Promise<T>): Promise<T> {
  await admin.query("BEGIN");
  try {
    return await run();
  } finally {
    await admin.query("ROLLBACK");
  }
}

// A failed statement never poisons the next one: it is undone to its own savepoint.
async function attempt(statement: string, values: unknown[] = []): Promise<PgError | undefined> {
  await admin.query("SAVEPOINT attempt");
  try {
    await admin.query(statement, values);
    await admin.query("RELEASE SAVEPOINT attempt");
    return undefined;
  } catch (error) {
    await admin.query("ROLLBACK TO SAVEPOINT attempt");
    return error as PgError;
  }
}

// Table and column names come from fixed test literals; every value is a bind parameter. An
// undefined value omits the column so that its DEFAULT or NOT NULL behaviour is exercised.
function insertStatement(table: string, row: Row, returning?: string): [string, unknown[]] {
  const columns = Object.keys(row).filter((column) => row[column] !== undefined);
  return [
    `INSERT INTO app.${table}(${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})${returning ? ` RETURNING ${returning}` : ""}`,
    columns.map((column) => row[column]),
  ];
}

const tryInsert = (table: string, row: Row) => attempt(...insertStatement(table, row));

async function insertRow(table: string, row: Row): Promise<string> {
  const [statement, values] = insertStatement(table, row, "id");
  return (await admin.query(statement, values)).rows[0].id as string;
}

function expectViolation(error: PgError | undefined, code: string, name: string, label: string) {
  expect(error, `${label}: must be rejected`).toBeDefined();
  expect(error?.code, `${label}: SQLSTATE`).toBe(code);
  // A NOT NULL violation names the column; every other class names the constraint.
  expect(code === "23502" ? error?.column : error?.constraint, `${label}: ${name}`).toBe(name);
}

async function expectAccepted(table: string, row: Row, label: string) {
  expect(await tryInsert(table, row), `${label}: must be accepted`).toBeUndefined();
}

async function expectRejected(table: string, row: Row, code: string, name: string, label: string) {
  expectViolation(await tryInsert(table, row), code, name, label);
}

// An exact repeat of (Scope, usage_start, usage_end, cycle_end) violates both uq_karaoke_slots_scope_times and
// ex_karaoke_slots_scope_occupancy. PostgreSQL checks the indexes in OID order, and a REINDEX CONCURRENTLY gives the
// UNIQUE index a new OID, so which of the two reports it is not a stable contract. The test pins only that the row
// is refused by one of them; the generation service resolves an exact match against the existing row first
// (SPEC-100 §29 step 4) instead of relying on the SQLSTATE.
async function expectExactRepeatRejected(table: string, row: Row, label: string) {
  const error = await tryInsert(table, row);
  expect(error, `${label}: must be rejected`).toBeDefined();
  expect(
    [
      ["23505", "uq_karaoke_slots_scope_times"],
      ["23P01", EXCLUSION],
    ].some(([code, name]) => error?.code === code && error?.constraint === name),
    `${label}: 23505 uq_karaoke_slots_scope_times or 23P01 ${EXCLUSION}, got ${error?.code} ${error?.constraint}`,
  ).toBe(true);
}

async function expectUpdateRejected(
  statement: string,
  values: unknown[],
  code: string,
  name: string,
  label: string,
) {
  expectViolation(await attempt(statement, values), code, name, label);
}

async function countRows(table: string, where = "true", values: unknown[] = []): Promise<number> {
  return (
    await admin.query(`SELECT count(*)::int AS count FROM app.${table} WHERE ${where}`, values)
  ).rows[0].count;
}

async function expectNothingCommitted(tables: readonly string[] = TABLES) {
  for (const table of tables) expect(await countRows(table), `${table} rows`).toBe(0);
}

// ---- synthetic row factories (valid by default; overrides break one rule at a time) --------------

// Every slot row gets its own generation_cause_key, so that two rows of a scenario never meet in
// uq_karaoke_slots_generation_candidate unless the case asks for it.
let causeCounter = 0;
const nextCause = () =>
  `00000000-0000-4000-8000-${(0xc10000 + ++causeCounter).toString(16).padStart(12, "0")}`;

const eventRow = (o: Row = {}): Row => ({ name: "合成イベント", ...o });
const configRow = (eventId: string, o: Row = {}): Row => ({
  event_id: eventId,
  name: "合成カラオケ",
  unit_amount: 1234,
  currency: "JPY",
  sales_starts_at: SALES_START,
  sales_ends_at: SALES_END,
  sale_control_state: "ENABLED",
  purchase_limit: 4,
  ...o,
});
const scopeRow = (eventId: string, o: Row = {}): Row => ({
  event_id: eventId,
  name: "合成スコープA",
  ...o,
});
const slotRow = (scopeId: string, configId: string, o: Row = {}): Row => ({
  exclusive_scope_id: scopeId,
  sales_configuration_id: configId,
  state: "AVAILABLE",
  usage_start: at(0),
  usage_end: at(15),
  cycle_end: at(20),
  generation_cause_key: nextCause(),
  generation_candidate_no: 0,
  ...o,
});

interface Seed {
  eventId: string;
  configId: string;
  scope1: string;
  scope2: string;
  slot: (scopeId: string, o?: Row) => Row;
  newScope: (name: string) => Promise<string>;
}
// Event, sales configuration and two Scopes, inside a transaction that the scenario rolls back.
async function withSeed<T>(run: (seed: Seed) => Promise<T>): Promise<T> {
  const result = await inRolledBackTransaction(async () => {
    const eventId = await insertRow("events", eventRow());
    const configId = await insertRow("karaoke_sales_configurations", configRow(eventId));
    const scope1 = await insertRow(SCOPE, scopeRow(eventId, { name: "合成スコープA" }));
    const scope2 = await insertRow(SCOPE, scopeRow(eventId, { name: "合成スコープB" }));
    return run({
      eventId,
      configId,
      scope1,
      scope2,
      slot: (scopeId, o = {}) => slotRow(scopeId, configId, o),
      newScope: (name) => insertRow(SCOPE, scopeRow(eventId, { name })),
    });
  });
  await expectNothingCommitted();
  return result;
}

const scopeCount = (scopeId: string) => countRows(SLOT, "exclusive_scope_id = $1", [scopeId]);

// ---- TC-DB-ARC-007-006 --------------------------------------------------------------------------

describe("TC-DB-ARC-007-006 migration 0004 and the catalog of the two Karaoke tables (real PostgreSQL 17)", () => {
  it("TC-DB-ARC-007-006 the journal lists 0001 to 0004 exactly once each with the source hashes, and a second run changes nothing", async () => {
    const identities = await migrationIdentities();
    const read = async () =>
      (await admin.query("SELECT version, source_hash FROM app.schema_migrations ORDER BY version"))
        .rows;
    const before = await read();
    expect(before.map((row) => row.version).slice(0, 4)).toEqual([
      "0001_foundation",
      "0002_audit_events",
      "0003_public_content_sales",
      "0004_karaoke_scopes_slots",
    ]);
    expect(new Set(before.map((row) => row.version)).size).toBe(before.length);
    expect(before).toHaveLength(identities.length);
    expect(before.map((row) => [row.version, row.source_hash])).toEqual(
      identities.map((identity) => [identity.version, identity.hash]),
    );
    // Pinned from the committed history: an applied migration is never edited (DB-MIG-003).
    const hashOf = (name: string) => identities.find((i) => i.name === name)?.hash;
    expect(hashOf("0001_foundation.sql")).toBe(
      "8be0243f1a20c66feddef29f21f805be6fc4d6ca6b78e6994e520189de3cf8bd",
    );
    expect(hashOf("0002_audit_events.sql")).toBe(
      "7cc76ebe922de728c6965bc4734583b99aaa13bd74119e03e5c244281001409f",
    );
    expect(hashOf("0003_public_content_sales.sql")).toBe(
      "cdf90998b2fccab719bb67ca6b41ff1b3988f3c742694fc2433b1ace445398c4",
    );

    await admin.query("SET ROLE app_migrator");
    try {
      await runMigrations(admin);
    } finally {
      await admin.query("RESET ROLE");
    }
    expect(await read()).toEqual(before);
  });

  it("TC-DB-ARC-007-006 0004 only creates the two tables, the two section 45.4 indexes and one ADD CONSTRAINT for the exclusion, with no predicate", async () => {
    const identities = await migrationIdentities();
    const fourth = identities.find((i) => i.name === "0004_karaoke_scopes_slots.sql");
    expect(fourth, "0004_karaoke_scopes_slots.sql exists").toBeDefined();

    // Static evidence only: nothing outside the two new tables is touched.
    const sqlText = (fourth?.sql ?? "")
      .split(/\r?\n/)
      .map((line) => line.replace(/--.*$/, ""))
      .join("\n");
    const referenced = [...sqlText.matchAll(/\bapp\.([a-z_]+)/g)].map((m) => m[1]);
    expect([...new Set(referenced)].sort()).toEqual([
      "events",
      "karaoke_exclusive_scopes",
      "karaoke_sales_configurations",
      "karaoke_slots",
    ]);
    // events and karaoke_sales_configurations appear only as foreign key targets.
    expect(
      sqlText.replace(/\bREFERENCES\s+app\.(events|karaoke_sales_configurations)\b/g, ""),
    ).not.toMatch(/\bapp\.(events|karaoke_sales_configurations)\b/);
    for (const forbidden of [
      /\bDROP\b/i,
      /\bTRUNCATE\b/i,
      /\bDELETE\s+FROM\b/i,
      /\bCREATE\s+(OR\s+REPLACE\s+)?(TRIGGER|FUNCTION|EXTENSION|ROLE|SCHEMA)\b/i,
      /\bOWNER\s+TO\b/i,
      /\bROW\s+LEVEL\s+SECURITY\b/i,
      /\bWHERE\b/i,
    ]) {
      expect(sqlText, `0004 must not contain ${forbidden}`).not.toMatch(forbidden);
    }
    expect([...sqlText.matchAll(/\bCREATE\s+TABLE\b/gi)]).toHaveLength(2);
    // Exactly one ALTER, and it adds the exclusion to the table created in the same file (SPEC-100 §28.1, §59).
    expect([...sqlText.matchAll(/\bALTER\b/gi)]).toHaveLength(1);
    expect(sqlText).toMatch(
      /ALTER\s+TABLE\s+app\.karaoke_slots\s+ADD\s+CONSTRAINT\s+ex_karaoke_slots_scope_occupancy\s+EXCLUDE\s+USING\s+gist/i,
    );
    // Only the two SPEC-100 section 45.4 indexes are created separately.
    expect(
      [...sqlText.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+([a-z_]+)/gi)].map((m) => m[1]).sort(),
    ).toEqual(["ix_karaoke_slots_scope_usage", "ix_karaoke_slots_usage_start"]);
  });

  it("TC-DB-ARC-007-006 columns of the two tables equal the SPEC-100 goldens in attnum order (7 + 12)", async () => {
    expect(GOLDEN_TABLES.map((g) => g.columns.length)).toEqual([7, 12]);
    for (const golden of GOLDEN_TABLES) {
      const rows = (
        await admin.query(
          `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull,
                  a.attidentity, a.attgenerated, pg_get_expr(d.adbin, d.adrelid) AS default_expr
             FROM pg_attribute a
             LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
            ORDER BY a.attnum`,
          [`app.${golden.table}`],
        )
      ).rows;
      expect(
        rows.map((r) => [
          r.attname,
          r.type,
          r.attnotnull,
          r.attidentity,
          r.attgenerated,
          r.default_expr,
        ]),
        golden.table,
      ).toEqual(
        golden.columns.map(([name, type, notNull, identity, defaultExpr]) => [
          name,
          type,
          notNull,
          identity,
          "",
          defaultExpr,
        ]),
      );
    }
  });

  it("TC-DB-ARC-007-006 constraints equal the goldens by name, kind and definition (3 + 11), and the exclusion has no predicate", async () => {
    let total = 0;
    for (const golden of GOLDEN_TABLES) {
      const rows = (
        await admin.query(
          `SELECT conname, contype, pg_get_constraintdef(oid) AS definition, convalidated, condeferrable, condeferred
             FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY conname`,
          [`app.${golden.table}`],
        )
      ).rows;
      total += rows.length;
      expect(
        rows.map((r) => [r.conname, r.contype, r.definition]),
        golden.table,
      ).toEqual([...golden.constraints].sort(byFirst));
      for (const row of rows) {
        expect([row.convalidated, row.condeferrable, row.condeferred], row.conname).toEqual([
          true,
          false,
          false,
        ]);
      }
    }
    expect(total).toBe(14);

    // DB-KRK-003 / KRK-SCP-004: no WHERE clause, so every Slot State is inside the exclusion.
    const exclusion = (
      await admin.query(
        `SELECT pg_get_constraintdef(c.oid) AS definition, i.indpred IS NULL AS no_predicate,
                am.amname AS method, ic.relname AS index_name
           FROM pg_constraint c
           JOIN pg_index i ON i.indexrelid = c.conindid
           JOIN pg_class ic ON ic.oid = c.conindid
           JOIN pg_am am ON am.oid = ic.relam
          WHERE c.conname = $1 AND c.contype = 'x'`,
        [EXCLUSION],
      )
    ).rows;
    expect(exclusion).toHaveLength(1);
    expect(exclusion[0].definition).not.toMatch(/\bWHERE\b/i);
    expect(exclusion[0].no_predicate, "indpred of the exclusion's index").toBe(true);
    expect(exclusion[0].method).toBe("gist");
    expect(exclusion[0].index_name).toBe(EXCLUSION);
  });

  it("TC-DB-ARC-007-006 exactly 9 valid indexes equal the goldens (2 + 7), with only the two SPEC-100 section 45.4 indexes besides PK, UNIQUE and the exclusion", async () => {
    let total = 0;
    for (const golden of GOLDEN_TABLES) {
      const rows = (
        await admin.query(
          `SELECT x.relname AS name, pg_get_indexdef(i.indexrelid) AS definition,
                  i.indisvalid, i.indisready, i.indislive
             FROM pg_index i JOIN pg_class x ON x.oid = i.indexrelid
            WHERE i.indrelid = $1::regclass ORDER BY x.relname`,
          [`app.${golden.table}`],
        )
      ).rows;
      total += rows.length;
      expect(
        rows.map((r) => [r.name, r.definition]),
        golden.table,
      ).toEqual([...golden.indexes].sort(byFirst));
      expect(rows.every((r) => r.indisvalid && r.indisready && r.indislive)).toBe(true);
    }
    expect(total).toBe(9);
  });

  it("TC-DB-ARC-007-006 owner is app_migrator, row level security is off, there are two identity sequences and no timestamp without time zone", async () => {
    const tables = (
      await admin.query(
        `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity, c.relforcerowsecurity, c.relkind
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app' AND c.relname = ANY($1) ORDER BY c.relname`,
        [[...TABLES]],
      )
    ).rows;
    expect(tables.map((t) => t.relname)).toEqual([...TABLES].sort());
    for (const table of tables) {
      expect(
        [table.owner, table.relrowsecurity, table.relforcerowsecurity, table.relkind],
        table.relname,
      ).toEqual(["app_migrator", false, false, "r"]);
    }
    const sequences = (
      await admin.query(
        `SELECT c.relname, format_type(s.seqtypid, NULL) AS type, pg_get_userbyid(c.relowner) AS owner
           FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app' AND c.relname = ANY($1) ORDER BY c.relname`,
        [SEQUENCES],
      )
    ).rows;
    expect(sequences.map((s) => [s.relname, s.type, s.owner])).toEqual(
      [...SEQUENCES].sort().map((name) => [name, "bigint", "app_migrator"]),
    );
    // DB-TIM-001: every time column of the two tables is timestamptz.
    const timeColumns = (
      await admin.query(
        `SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod) AS type
           FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app' AND c.relname = ANY($1) AND a.attnum > 0 AND NOT a.attisdropped
            AND (a.attname LIKE '%\\_at' OR a.attname LIKE '%\\_start' OR a.attname LIKE '%\\_end'
                 OR format_type(a.atttypid, a.atttypmod) LIKE 'timestamp%')`,
        [[...TABLES]],
      )
    ).rows;
    expect(timeColumns.map((c) => `${c.relname}.${c.attname}`).sort()).toEqual([
      "karaoke_exclusive_scopes.created_at",
      "karaoke_exclusive_scopes.updated_at",
      "karaoke_slots.created_at",
      "karaoke_slots.cycle_end",
      "karaoke_slots.updated_at",
      "karaoke_slots.usage_end",
      "karaoke_slots.usage_start",
    ]);
    for (const column of timeColumns) {
      expect(column.type, `${column.relname}.${column.attname}`).toBe(TSTZ);
    }
  });

  it("TC-DB-ARC-007-006 the live catalog equals requiredCatalog, checked directly and not through readiness", async () => {
    const live = (await admin.query(catalogQuery)).rows[0].catalog;
    expect(live).toEqual(requiredCatalog);
    // The contract is not vacuous: it must describe both tables and the exclusion.
    const liveTables = live.tables.map((row: unknown[]) => row[0]);
    for (const table of TABLES) expect(liveTables).toContain(table);
    const liveConstraints = live.constraints.map((row: unknown[]) => row[1]);
    for (const name of ALL_CONSTRAINT_NAMES) expect(liveConstraints).toContain(name);
  });

  it("TC-DB-ARC-007-006 public_ref is a database generated v4 UUID; a duplicate public_ref or id is a unique violation named by its constraint; identity is ALWAYS", async () => {
    await inRolledBackTransaction(async () => {
      const eventId = await insertRow("events", eventRow());
      const configId = await insertRow("karaoke_sales_configurations", configRow(eventId));
      const scopeId = await insertRow(SCOPE, scopeRow(eventId));
      // The duplicate rows differ from the original in every other unique value, so each one breaks
      // only the constraint under test.
      const rows: [string, Row, Row][] = [
        [SCOPE, scopeRow(eventId), scopeRow(eventId, { name: "合成スコープC" })],
        [
          SLOT,
          slotRow(scopeId, configId),
          slotRow(scopeId, configId, {
            usage_start: at(600),
            usage_end: at(615),
            cycle_end: at(620),
          }),
        ],
      ];
      for (const [table, row, other] of rows) {
        const [statement, values] = insertStatement(table, row, "id, public_ref");
        const created = (await admin.query(statement, values)).rows[0];
        expect(created.public_ref, `${table} public_ref`).toMatch(UUID_V4);

        expectViolation(
          await tryInsert(table, { ...other, public_ref: created.public_ref }),
          "23505",
          `uq_${table}_public_ref`,
          `${table} duplicate public_ref`,
        );
        const columns = Object.keys(other).filter((column) => other[column] !== undefined);
        const list = columns.map((_, i) => `$${i + 2}`).join(", ");
        expectViolation(
          await attempt(
            `INSERT INTO app.${table}(id, ${columns.join(", ")}) OVERRIDING SYSTEM VALUE VALUES ($1, ${list})`,
            [created.id, ...columns.map((column) => other[column])],
          ),
          "23505",
          `pk_${table}`,
          `${table} duplicate id`,
        );
        // GENERATED ALWAYS: an explicit id without OVERRIDING SYSTEM VALUE is refused (428C9).
        const refused = await attempt(
          `INSERT INTO app.${table}(id, ${columns.join(", ")}) VALUES ($1, ${list})`,
          [ABSENT_ID, ...columns.map((column) => other[column])],
        );
        expect(refused?.code, `${table} explicit id`).toBe("428C9");
      }
    });
    await expectNothingCommitted();
  });

  it("TC-DB-ARC-007-006 dropping btree_gist is refused with 2BP01 because the exclusion depends on it, and nothing is lost", async () => {
    await inRolledBackTransaction(async () => {
      const refused = await attempt("DROP EXTENSION btree_gist");
      expect(refused?.code, "DROP EXTENSION btree_gist (RESTRICT)").toBe("2BP01");
      expect(
        (
          await admin.query(
            "SELECT count(*)::int AS count FROM pg_extension WHERE extname = 'btree_gist'",
          )
        ).rows[0].count,
      ).toBe(1);
      expect(
        (
          await admin.query("SELECT count(*)::int AS count FROM pg_constraint WHERE conname = $1", [
            EXCLUSION,
          ])
        ).rows[0].count,
      ).toBe(1);
    });
  });
});

// ---- TC-KRK-001-001 -----------------------------------------------------------------------------

describe("TC-KRK-001-001 Slot time ordering CHECK constraints, required columns and transaction_timestamp() defaults (real PostgreSQL 17)", () => {
  it("TC-KRK-001-001 usage_start < usage_end <= cycle_end: standard, no maintenance, non standard and 1 microsecond slots are accepted", async () => {
    await withSeed(async (seed) => {
      const cases: [string, Row][] = [
        ["standard 15 + 5", {}],
        ["no maintenance (usage_end = cycle_end)", { usage_end: at(15), cycle_end: at(15) }],
        // SPEC-100 §28: the standard 15 + 5 length is not fixed by a DB CHECK.
        ["30 minutes of use + 10 minutes of maintenance", { usage_end: at(30), cycle_end: at(40) }],
        ["shortest use (1 microsecond)", { usage_end: at(0, 1), cycle_end: at(0, 1) }],
      ];
      for (const [label, overrides] of cases) {
        const scopeId = await seed.newScope(`合成スコープ ${label}`);
        await expectAccepted(SLOT, seed.slot(scopeId, overrides), label);
      }
    });
  });

  it("TC-KRK-001-001 usage_start must be before usage_end and usage_end must not exceed cycle_end, each refused with 23514 by name", async () => {
    await withSeed(async (seed) => {
      const cases: [string, Row, string][] = [
        [
          "usage_start = usage_end",
          { usage_start: at(15), usage_end: at(15), cycle_end: at(20) },
          "ck_karaoke_slots_usage_period",
        ],
        [
          // A reversed pair is 23514, not a range construction error (22000): CHECKs run before the exclusion.
          "usage_start > usage_end",
          { usage_start: at(30), usage_end: at(15), cycle_end: at(20) },
          "ck_karaoke_slots_usage_period",
        ],
        [
          "usage_end = cycle_end + 1 microsecond",
          { usage_start: at(0), usage_end: at(20, 1), cycle_end: at(20) },
          "ck_karaoke_slots_cycle_end",
        ],
      ];
      const scopeId = await seed.newScope("合成スコープ order");
      for (const [label, overrides, name] of cases) {
        await expectRejected(SLOT, seed.slot(scopeId, overrides), "23514", name, label);
      }
      expect(await scopeCount(scopeId)).toBe(0);
    });
  });

  it("TC-KRK-001-001 each of usage_start, usage_end, cycle_end, generation_cause_key and generation_candidate_no is required (23502); a Scope needs a name and defaults sort_order to 0", async () => {
    await withSeed(async (seed) => {
      for (const column of [
        "usage_start",
        "usage_end",
        "cycle_end",
        "generation_cause_key",
        "generation_candidate_no",
      ]) {
        await expectRejected(
          SLOT,
          seed.slot(seed.scope1, { [column]: undefined }),
          "23502",
          column,
          `omitted ${column}`,
        );
      }
      expect(await scopeCount(seed.scope1)).toBe(0);

      await expectRejected(
        SCOPE,
        scopeRow(seed.eventId, { name: undefined }),
        "23502",
        "name",
        "omitted Scope name",
      );
      const scopeId = await insertRow(
        SCOPE,
        scopeRow(seed.eventId, { name: "合成スコープ default" }),
      );
      expect(
        (await admin.query(`SELECT sort_order FROM app.${SCOPE} WHERE id = $1`, [scopeId])).rows[0]
          .sort_order,
      ).toBe(0);
    });
  });

  it("TC-KRK-001-001 created_at and updated_at default to the transaction's transaction_timestamp(), not to the statement time, on both tables", async () => {
    await inRolledBackTransaction(async () => {
      // Distinguishes transaction_timestamp() from statement_timestamp() / clock_timestamp().
      await admin.query("SELECT pg_sleep(0.05)");
      const eventId = await insertRow("events", eventRow());
      const configId = await insertRow("karaoke_sales_configurations", configRow(eventId));
      const check = "created_at = transaction_timestamp() AND updated_at = transaction_timestamp()";
      const later = "created_at < statement_timestamp()";
      const [scopeStatement, scopeValues] = insertStatement(
        SCOPE,
        scopeRow(eventId),
        `${check} AS same, ${later} AS older`,
      );
      const scope = await admin.query(scopeStatement, scopeValues);
      expect(scope.rows[0], "Scope defaults").toEqual({ same: true, older: true });
      const scopeId = (
        await admin.query(`SELECT id FROM app.${SCOPE} WHERE event_id = $1`, [eventId])
      ).rows[0].id as string;
      const [slotStatement, slotValues] = insertStatement(
        SLOT,
        slotRow(scopeId, configId),
        `${check} AS same, ${later} AS older`,
      );
      const slot = await admin.query(slotStatement, slotValues);
      expect(slot.rows[0], "Slot defaults").toEqual({ same: true, older: true });
    });
    await expectNothingCommitted();
  });
});

// ---- TC-INV-010-04-001 --------------------------------------------------------------------------

describe("TC-INV-010-04-001 KARAOKE_GIST_OVERLAP_REJECT: the same Scope never holds overlapping occupancy (real PostgreSQL 17)", () => {
  // A = [T, T+15m usage, T+20m cycle_end) in AVAILABLE, in Scope S1.
  it("TC-INV-010-04-001 a slot that touches A at either end is accepted: cycle_end == next usage_start does not overlap under [) (DB-KRK-002)", async () => {
    await withSeed(async (seed) => {
      await expectAccepted(SLOT, seed.slot(seed.scope1), "A");
      await expectAccepted(
        SLOT,
        seed.slot(seed.scope1, { usage_start: at(20), usage_end: at(35), cycle_end: at(40) }),
        "after A: usage_start = A.cycle_end",
      );
      await expectAccepted(
        SLOT,
        seed.slot(seed.scope1, { usage_start: at(-20), usage_end: at(-5), cycle_end: at(0) }),
        "before A: cycle_end = A.usage_start",
      );
      expect(await scopeCount(seed.scope1)).toBe(3);
    });
  });

  it("TC-INV-010-04-001 any overlap of A's occupancy in the same Scope is refused with 23P01 naming the exclusion, down to 1 microsecond", async () => {
    await withSeed(async (seed) => {
      await expectAccepted(SLOT, seed.slot(seed.scope1), "A");
      const overlaps: [string, Row][] = [
        [
          "1 microsecond into A's end",
          { usage_start: at(20, -1), usage_end: at(35), cycle_end: at(40) },
        ],
        [
          "1 microsecond into A's start",
          { usage_start: at(-20), usage_end: at(-5), cycle_end: at(0, 1) },
        ],
        // A's usage ends at T+15m but its maintenance runs to T+20m (KRK-SCP-003).
        [
          "inside A's maintenance time",
          { usage_start: at(17), usage_end: at(32), cycle_end: at(37) },
        ],
        ["containing A", { usage_start: at(-5), usage_end: at(30), cycle_end: at(40) }],
        ["contained in A", { usage_start: at(2), usage_end: at(5), cycle_end: at(8) }],
      ];
      for (const [label, overrides] of overlaps) {
        await expectRejected(SLOT, seed.slot(seed.scope1, overrides), "23P01", EXCLUSION, label);
        expect(await scopeCount(seed.scope1), `${label}: rows after the refusal`).toBe(1);
      }
    });
  });

  it("TC-INV-010-04-001 another Scope may hold the same three times: the exclusion is per Scope", async () => {
    await withSeed(async (seed) => {
      await expectAccepted(SLOT, seed.slot(seed.scope1), "A in S1");
      await expectAccepted(SLOT, seed.slot(seed.scope2), "same three times in S2");
      expect(await scopeCount(seed.scope1)).toBe(1);
      expect(await scopeCount(seed.scope2)).toBe(1);
    });
  });

  it("TC-INV-010-04-001 every pair of Slot States overlaps: 4 states of A by 4 states of B are all refused with 23P01 (KRK-SCP-004, no predicate)", async () => {
    await withSeed(async (seed) => {
      for (const stateOfA of SLOT_STATES) {
        // A is rebuilt in every state, in a Scope of its own so that the pairs do not interfere.
        const scopeId = await seed.newScope(`合成スコープ ${stateOfA}`);
        await expectAccepted(SLOT, seed.slot(scopeId, { state: stateOfA }), `A ${stateOfA}`);
        for (const stateOfB of SLOT_STATES) {
          await expectRejected(
            SLOT,
            seed.slot(scopeId, {
              state: stateOfB,
              usage_start: at(20, -1),
              usage_end: at(35),
              cycle_end: at(40),
            }),
            "23P01",
            EXCLUSION,
            `A ${stateOfA} / B ${stateOfB}`,
          );
        }
        expect(await scopeCount(scopeId), `${stateOfA}: rows after 4 refusals`).toBe(1);
      }
    });
  });

  it("TC-INV-010-04-001 a slot with the same three times as A in the same Scope is refused by uq_karaoke_slots_scope_times or the exclusion, without pinning which one", async () => {
    await withSeed(async (seed) => {
      await expectAccepted(SLOT, seed.slot(seed.scope1), "A");
      // The generation_cause_key differs so that uq_karaoke_slots_generation_candidate is not the one that fires.
      await expectExactRepeatRejected(SLOT, seed.slot(seed.scope1), "same three times");
      expect(await scopeCount(seed.scope1)).toBe(1);
    });
  });
});

// ---- TC-KRK-001-002 -----------------------------------------------------------------------------

describe("TC-KRK-001-002 changing a Slot's state or times with UPDATE never takes it out of the exclusion (DB-KRK-003, real PostgreSQL 17)", () => {
  // S1: A [T, T+20m), B [T+20m, T+40m). S2: C [T+10m, T+30m), which overlaps both A and B if it moves to S1.
  async function seedSlots(seed: Seed) {
    const a = await insertRow(SLOT, seed.slot(seed.scope1));
    const b = await insertRow(
      SLOT,
      seed.slot(seed.scope1, { usage_start: at(20), usage_end: at(35), cycle_end: at(40) }),
    );
    const c = await insertRow(
      SLOT,
      seed.slot(seed.scope2, { usage_start: at(10), usage_end: at(25), cycle_end: at(30) }),
    );
    return { a, b, c };
  }
  const valuesOf = async (id: string) =>
    (
      await admin.query(
        `SELECT state, exclusive_scope_id::text AS scope,
                to_char(usage_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS usage_start,
                to_char(usage_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS usage_end,
                to_char(cycle_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS cycle_end
           FROM app.${SLOT} WHERE id = $1`,
        [id],
      )
    ).rows[0];

  it("TC-KRK-001-002 AVAILABLE -> HELD -> SOLD -> SALES_STOPPED -> AVAILABLE all succeed, and after each one a slot overlapping A by 1 microsecond is still refused", async () => {
    await withSeed(async (seed) => {
      const { a } = await seedSlots(seed);
      for (const state of ["HELD", "SOLD", "SALES_STOPPED", "AVAILABLE"]) {
        // A row never conflicts with itself, so changing only the state is accepted.
        expect(
          await attempt(`UPDATE app.${SLOT} SET state = $1 WHERE id = $2`, [state, a]),
          `A -> ${state}`,
        ).toBeUndefined();
        expect((await valuesOf(a)).state).toBe(state);
        // D reaches only into A: A is [T, T+20m) and nothing else of S1 starts before T+20m.
        await expectRejected(
          SLOT,
          seed.slot(seed.scope1, { usage_start: at(-20), usage_end: at(-5), cycle_end: at(0, 1) }),
          "23P01",
          EXCLUSION,
          `D while A is ${state}`,
        );
      }
    });
  });

  it("TC-KRK-001-002 moving B's times into A is refused with 23P01 and leaves B unchanged; so is changing the state in the same UPDATE", async () => {
    await withSeed(async (seed) => {
      const { b } = await seedSlots(seed);
      const before = await valuesOf(b);
      const shifted = [at(20, -1), at(35, -1), at(40, -1), b];
      await expectUpdateRejected(
        `UPDATE app.${SLOT} SET usage_start = $1, usage_end = $2, cycle_end = $3 WHERE id = $4`,
        shifted,
        "23P01",
        EXCLUSION,
        "B shifted 1 microsecond earlier",
      );
      expect(await valuesOf(b)).toEqual(before);
      await expectUpdateRejected(
        `UPDATE app.${SLOT} SET state = 'SALES_STOPPED', usage_start = $1, usage_end = $2, cycle_end = $3 WHERE id = $4`,
        shifted,
        "23P01",
        EXCLUSION,
        "B stopped and shifted in one UPDATE",
      );
      expect(await valuesOf(b)).toEqual(before);
    });
  });

  it("TC-KRK-001-002 moving C into S1 where it overlaps A and B is refused with 23P01 and C stays in S2", async () => {
    await withSeed(async (seed) => {
      const { c } = await seedSlots(seed);
      const before = await valuesOf(c);
      await expectUpdateRejected(
        `UPDATE app.${SLOT} SET exclusive_scope_id = $1 WHERE id = $2`,
        [seed.scope1, c],
        "23P01",
        EXCLUSION,
        "C moved into S1",
      );
      expect(await valuesOf(c)).toEqual(before);
      expect((await valuesOf(c)).scope).toBe(seed.scope2);
    });
  });

  it("TC-KRK-001-002 a move that keeps B adjacent to A (a longer B, then B shifted later) is accepted", async () => {
    await withSeed(async (seed) => {
      const { b } = await seedSlots(seed);
      // B keeps usage_start = A.cycle_end and only grows later.
      expect(
        await attempt(`UPDATE app.${SLOT} SET usage_end = $1, cycle_end = $2 WHERE id = $3`, [
          at(40),
          at(45),
          b,
        ]),
        "B longer",
      ).toBeUndefined();
      // Then the whole of B moves later: no longer adjacent, still not overlapping.
      expect(
        await attempt(
          `UPDATE app.${SLOT} SET usage_start = $1, usage_end = $2, cycle_end = $3 WHERE id = $4`,
          [at(25), at(40), at(45), b],
        ),
        "B shifted later",
      ).toBeUndefined();
    });
  });

  it("TC-KRK-001-002 an UPDATE that breaks the time order is refused by the CHECK (23514), not by the exclusion, and A is unchanged", async () => {
    await withSeed(async (seed) => {
      const { a } = await seedSlots(seed);
      const before = await valuesOf(a);
      await expectUpdateRejected(
        `UPDATE app.${SLOT} SET usage_end = $1 WHERE id = $2`,
        [at(20, 1), a],
        "23514",
        "ck_karaoke_slots_cycle_end",
        "A.usage_end beyond cycle_end",
      );
      expect(await valuesOf(a)).toEqual(before);
    });
  });
});

// ---- TC-CON-001-001 -----------------------------------------------------------------------------

describe("TC-CON-001-001 two connections cannot both place an overlapping slot, though neither sees the other's row (DB-KRK-001, real PostgreSQL 17)", () => {
  const OVERLAP_COUNT = `SELECT count(*)::int AS count FROM app.${SLOT}
    WHERE exclusive_scope_id = $1 AND tstzrange(usage_start, cycle_end, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`;

  async function waitUntilBlockedOnLock(pid: number) {
    // Barrier: Y's INSERT is inside the exclusion check and waits for X's transaction (a Lock wait).
    // Polling a database condition, never a fixed sleep (TST-CON-001).
    const deadline = Date.now() + 10_000;
    for (;;) {
      const waiting = (
        await admin.query(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'",
          [pid],
        )
      ).rowCount;
      if (waiting) return;
      if (Date.now() > deadline) throw new Error("connection Y never waited on a lock");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  async function race(outcomeOfX: "COMMIT" | "ROLLBACK", scopeId: string, configId: string) {
    const x = new Client({ connectionString: url });
    const y = new Client({ connectionString: url });
    await x.connect();
    await y.connect();
    try {
      const rowA = slotRow(scopeId, configId); // [T, T+15m, T+20m)
      const rowB = slotRow(scopeId, configId, {
        usage_start: at(10),
        usage_end: at(25),
        cycle_end: at(30),
      });
      // X: no overlap is visible, A is inserted and left uncommitted.
      await x.query("BEGIN");
      expect((await x.query(OVERLAP_COUNT, [scopeId, at(0), at(20)])).rows[0].count).toBe(0);
      await x.query(...insertStatement(SLOT, rowA));
      // Y: X's row is invisible, so the read-before-write check also finds no overlap.
      await y.query("SET statement_timeout = '10s'");
      await y.query("BEGIN");
      const yPid = (await y.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      expect((await y.query(OVERLAP_COUNT, [scopeId, at(10), at(30)])).rows[0].count).toBe(0);
      const insertOfB = y.query(...insertStatement(SLOT, rowB)).then(
        () => undefined,
        (error: PgError) => error,
      );
      await waitUntilBlockedOnLock(yPid);
      await x.query(outcomeOfX);
      const failure = await insertOfB;
      await y.query("ROLLBACK");
      return failure;
    } finally {
      await x.end();
      await y.end();
    }
  }

  it("TC-CON-001-001 X holds A uncommitted, Y's overlapping B waits and is refused with 23P01 once X commits; only A remains", async () => {
    const eventId = await insertRow("events", eventRow());
    const configId = await insertRow("karaoke_sales_configurations", configRow(eventId));
    const scopeId = await insertRow(SCOPE, scopeRow(eventId, { name: "合成スコープ S9" }));
    try {
      expectViolation(
        await race("COMMIT", scopeId, configId),
        "23P01",
        EXCLUSION,
        "Y after X COMMIT",
      );
      expect(await scopeCount(scopeId), "only A is stored").toBe(1);
      expect(
        (
          await admin.query(
            `SELECT to_char(usage_start AT TIME ZONE 'UTC', 'HH24:MI') AS t FROM app.${SLOT} WHERE exclusive_scope_id = $1`,
            [scopeId],
          )
        ).rows,
      ).toEqual([{ t: "01:00" }]);
    } finally {
      await admin.query(`DELETE FROM app.${SLOT} WHERE exclusive_scope_id = $1`, [scopeId]);
      await admin.query(`DELETE FROM app.${SCOPE} WHERE id = $1`, [scopeId]);
      await admin.query("DELETE FROM app.karaoke_sales_configurations WHERE id = $1", [configId]);
      await admin.query("DELETE FROM app.events WHERE id = $1", [eventId]);
    }
    await expectNothingCommitted();
  });

  it("TC-CON-001-001 when X rolls back instead, Y waits for X's outcome and its B is accepted (the DB does not refuse on an uncommitted row)", async () => {
    const eventId = await insertRow("events", eventRow());
    const configId = await insertRow("karaoke_sales_configurations", configRow(eventId));
    const scopeId = await insertRow(SCOPE, scopeRow(eventId, { name: "合成スコープ S9" }));
    try {
      const failure = await race("ROLLBACK", scopeId, configId);
      expect(failure, "Y's INSERT after X ROLLBACK").toBeUndefined();
      // Y rolled back itself, so nothing is stored either.
      expect(await scopeCount(scopeId)).toBe(0);
    } finally {
      await admin.query(`DELETE FROM app.${SLOT} WHERE exclusive_scope_id = $1`, [scopeId]);
      await admin.query(`DELETE FROM app.${SCOPE} WHERE id = $1`, [scopeId]);
      await admin.query("DELETE FROM app.karaoke_sales_configurations WHERE id = $1", [configId]);
      await admin.query("DELETE FROM app.events WHERE id = $1", [eventId]);
    }
    await expectNothingCommitted();
  });
});

// ---- TC-KRK-001-003 -----------------------------------------------------------------------------

describe("TC-KRK-001-003 the UNIQUE constraints and the candidate number behind idempotent generation (real PostgreSQL 17)", () => {
  // The reuse of an exact match (DB-KRK-004) and all-or-nothing batches (DB-KRK-005) are the generation
  // service's job; this case shows only the physical uniqueness.
  const CAUSE = "00000000-0000-4000-8000-0000000000c1";

  it("TC-KRK-001-003 the same (cause, Scope, candidate number) cannot be used twice, but another Scope or another number can", async () => {
    await withSeed(async (seed) => {
      const base = { generation_cause_key: CAUSE, generation_candidate_no: 0 };
      await expectAccepted(SLOT, seed.slot(seed.scope1, base), "first");
      await expectRejected(
        SLOT,
        seed.slot(seed.scope1, {
          ...base,
          usage_start: at(60),
          usage_end: at(75),
          cycle_end: at(80),
        }),
        "23505",
        "uq_karaoke_slots_generation_candidate",
        "same cause, Scope and number",
      );
      await expectAccepted(
        SLOT,
        seed.slot(seed.scope2, base),
        "same cause and number in another Scope",
      );
      await expectAccepted(
        SLOT,
        seed.slot(seed.scope1, {
          generation_cause_key: CAUSE,
          generation_candidate_no: 1,
          usage_start: at(60),
          usage_end: at(75),
          cycle_end: at(80),
        }),
        "same cause and Scope, number + 1",
      );
      expect(await scopeCount(seed.scope1)).toBe(2);
      expect(await scopeCount(seed.scope2)).toBe(1);
    });
  });

  it("TC-KRK-001-003 candidate number 0 is accepted and -1 is refused with 23514 by name", async () => {
    await withSeed(async (seed) => {
      await expectAccepted(
        SLOT,
        seed.slot(seed.scope1, { generation_candidate_no: 0 }),
        "number 0",
      );
      await expectRejected(
        SLOT,
        seed.slot(seed.scope1, {
          generation_candidate_no: -1,
          usage_start: at(60),
          usage_end: at(75),
          cycle_end: at(80),
        }),
        "23514",
        "ck_karaoke_slots_generation_candidate_no",
        "number -1",
      );
      expect(await scopeCount(seed.scope1)).toBe(1);
    });
  });

  it("TC-KRK-001-003 the same three times are accepted in another Scope, while in the same Scope they are refused", async () => {
    await withSeed(async (seed) => {
      await expectAccepted(SLOT, seed.slot(seed.scope1), "S1");
      await expectAccepted(SLOT, seed.slot(seed.scope2), "same three times in S2");
      await expectExactRepeatRejected(SLOT, seed.slot(seed.scope2), "same three times again in S2");
    });
  });
});

// ---- TC-DB-STA-002-002 --------------------------------------------------------------------------

describe("TC-DB-STA-002-002 Slot State allowlist CHECK constraint (real PostgreSQL 17)", () => {
  it("TC-DB-STA-002-002 AVAILABLE, HELD, SOLD and SALES_STOPPED are accepted; near misses are refused with 23514 by name; state has no default (23502)", async () => {
    await withSeed(async (seed) => {
      let hour = 0;
      const times = () => {
        hour += 1;
        return {
          usage_start: at(hour * 60),
          usage_end: at(hour * 60 + 15),
          cycle_end: at(hour * 60 + 20),
        };
      };
      for (const state of SLOT_STATES) {
        await expectAccepted(SLOT, seed.slot(seed.scope1, { state, ...times() }), `state=${state}`);
      }
      for (const state of [
        "",
        "available",
        "RELEASED",
        "ENABLED",
        "SALES_STOPPED ",
        "UNKNOWN_VALUE",
      ]) {
        await expectRejected(
          SLOT,
          seed.slot(seed.scope1, { state, ...times() }),
          "23514",
          "ck_karaoke_slots_state",
          `state=${JSON.stringify(state)}`,
        );
      }
      await expectRejected(
        SLOT,
        seed.slot(seed.scope1, { state: undefined, ...times() }),
        "23502",
        "state",
        "omitted state",
      );
      expect(await scopeCount(seed.scope1)).toBe(4);
    });
  });
});

// ---- TC-DB-FK-002-002 ---------------------------------------------------------------------------

describe("TC-DB-FK-002-002 Karaoke foreign keys restrict deletes and never cascade (real PostgreSQL 17)", () => {
  it("TC-DB-FK-002-002 the three foreign keys are ON DELETE RESTRICT and ON UPDATE NO ACTION", async () => {
    const rows = (
      await admin.query(
        `SELECT conname, confdeltype, confupdtype FROM pg_constraint
          WHERE contype = 'f' AND conrelid = ANY($1::regclass[]) ORDER BY conname`,
        [[`app.${SCOPE}`, `app.${SLOT}`]],
      )
    ).rows;
    expect(rows.map((r) => [r.conname, r.confdeltype, r.confupdtype])).toEqual([
      ["fk_karaoke_exclusive_scopes_event", "r", "a"],
      ["fk_karaoke_slots_exclusive_scope", "r", "a"],
      ["fk_karaoke_slots_sales_configuration", "r", "a"],
    ]);
  });

  it("TC-DB-FK-002-002 an absent parent is 23503 by name and an omitted parent id is 23502", async () => {
    await withSeed(async (seed) => {
      await expectRejected(
        SCOPE,
        scopeRow(ABSENT_ID),
        "23503",
        "fk_karaoke_exclusive_scopes_event",
        "absent event_id",
      );
      await expectRejected(
        SLOT,
        seed.slot(ABSENT_ID),
        "23503",
        "fk_karaoke_slots_exclusive_scope",
        "absent exclusive_scope_id",
      );
      await expectRejected(
        SLOT,
        slotRow(seed.scope1, ABSENT_ID),
        "23503",
        "fk_karaoke_slots_sales_configuration",
        "absent sales_configuration_id",
      );
      await expectRejected(
        SCOPE,
        scopeRow(seed.eventId, { event_id: undefined }),
        "23502",
        "event_id",
        "omitted event_id",
      );
      await expectRejected(
        SLOT,
        seed.slot(seed.scope1, { exclusive_scope_id: undefined }),
        "23502",
        "exclusive_scope_id",
        "omitted exclusive_scope_id",
      );
      await expectRejected(
        SLOT,
        seed.slot(seed.scope1, { sales_configuration_id: undefined }),
        "23502",
        "sales_configuration_id",
        "omitted sales_configuration_id",
      );
      expect(await countRows(SCOPE)).toBe(2);
      expect(await countRows(SLOT)).toBe(0);
    });
  });

  it("TC-DB-FK-002-002 deleting a Scope with a slot, a sales configuration with a slot, or an Event with a Scope is refused with 23503 and neither side is lost", async () => {
    await withSeed(async (seed) => {
      // A second Event that has only a Scope, so that the Event's refusal names the Scope's foreign key.
      const lonelyEvent = await insertRow("events", eventRow({ name: "合成イベント2" }));
      await insertRow(SCOPE, scopeRow(lonelyEvent, { name: "合成スコープ lonely" }));
      await insertRow(SLOT, seed.slot(seed.scope1));

      const cases: [string, string, string, string][] = [
        [
          "Scope with a slot",
          `DELETE FROM app.${SCOPE} WHERE id = $1`,
          seed.scope1,
          "fk_karaoke_slots_exclusive_scope",
        ],
        [
          "sales configuration with a slot",
          "DELETE FROM app.karaoke_sales_configurations WHERE id = $1",
          seed.configId,
          "fk_karaoke_slots_sales_configuration",
        ],
        [
          "Event with a Scope",
          "DELETE FROM app.events WHERE id = $1",
          lonelyEvent,
          "fk_karaoke_exclusive_scopes_event",
        ],
      ];
      for (const [label, statement, id, name] of cases) {
        expectViolation(await attempt(statement, [id]), "23503", name, label);
      }
      expect(await countRows(SCOPE, "id = $1", [seed.scope1]), "Scope stays").toBe(1);
      expect(await scopeCount(seed.scope1), "slot stays").toBe(1);
      expect(await countRows("karaoke_sales_configurations", "id = $1", [seed.configId])).toBe(1);
      expect(await countRows("events", "id = $1", [lonelyEvent]), "Event stays").toBe(1);
      expect(await countRows(SCOPE, "event_id = $1", [lonelyEvent]), "its Scope stays").toBe(1);
    });
  });
});

// ---- TC-SEC-DB-001-002 --------------------------------------------------------------------------

describe("TC-SEC-DB-001-002 runtime privileges on the two Karaoke tables (real PostgreSQL 17)", () => {
  const PRIVILEGES = [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "REFERENCES",
    "TRIGGER",
    "MAINTAIN",
  ] as const;
  const ROLES = [
    "app_api_runtime",
    "app_email_runtime",
    "app_reconciliation_runtime",
    "app_runtime",
  ] as const;

  // The approved privilege table (plan U-2, SPEC-140 §39, SPEC-180 §22.2): app_api_runtime reads both
  // tables for the public Karaoke reads. No mounted Operation writes them and SPEC-110 defines no Scope
  // mutation, so there is no INSERT / UPDATE, and no role may DELETE. When generation or Hold is
  // mounted, the PR that mounts it adds the grant it needs.
  const API_GRANTS: Record<string, readonly string[]> = {
    karaoke_exclusive_scopes: ["SELECT"],
    karaoke_slots: ["SELECT"],
  };

  async function tablePrivileges(role: string, table: string) {
    const result: Record<string, boolean> = {};
    for (const privilege of PRIVILEGES) {
      result[privilege] = (
        await admin.query("SELECT has_table_privilege($1, $2, $3) AS allowed", [
          role,
          `app.${table}`,
          privilege,
        ])
      ).rows[0].allowed;
    }
    return result;
  }
  const only = (granted: readonly string[]) =>
    Object.fromEntries(PRIVILEGES.map((privilege) => [privilege, granted.includes(privilege)]));

  it("TC-SEC-DB-001-002 has_table_privilege of the four roles equals the approved table: API SELECT only, no DELETE or TRUNCATE anywhere, nothing for the workers", async () => {
    for (const table of TABLES) {
      expect(await tablePrivileges("app_api_runtime", table), `api ${table}`).toEqual(
        only(API_GRANTS[table] ?? []),
      );
      for (const role of ["app_email_runtime", "app_reconciliation_runtime", "app_runtime"]) {
        expect(await tablePrivileges(role, table), `${role} ${table}`).toEqual(only([]));
      }
    }
  });

  it("TC-SEC-DB-001-002 no column has an ACL of its own, the table ACL never names PUBLIC, and no role has a privilege on the two identity sequences", async () => {
    const withAcl = (
      await admin.query(
        `SELECT c.relname || '.' || a.attname AS column_name
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app' AND c.relname = ANY($1) AND a.attnum > 0
            AND NOT a.attisdropped AND a.attacl IS NOT NULL`,
        [[...TABLES]],
      )
    ).rows;
    expect(withAcl, "columns with a column-level ACL").toEqual([]);
    for (const table of TABLES) {
      const acl = (
        await admin.query(
          `SELECT e.grantee = 0 AS is_public,
                  CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END AS grantee_name,
                  e.privilege_type
             FROM pg_class c, aclexplode(c.relacl) e WHERE c.oid = $1::regclass`,
          [`app.${table}`],
        )
      ).rows;
      expect(
        acl.some((entry) => entry.is_public),
        `${table} ACL has PUBLIC`,
      ).toBe(false);
      expect(
        acl
          .filter((entry) => entry.grantee_name !== "app_migrator")
          .map((entry) => `${entry.grantee_name}:${entry.privilege_type}`)
          .sort(),
        table,
      ).toEqual(
        (API_GRANTS[table] ?? []).map((privilege) => `app_api_runtime:${privilege}`).sort(),
      );
    }
    for (const sequence of SEQUENCES) {
      for (const role of ROLES) {
        expect(
          (
            await admin.query(
              "SELECT has_sequence_privilege($1, $2, 'USAGE,SELECT,UPDATE') AS allowed",
              [role, `app.${sequence}`],
            )
          ).rows[0].allowed,
          `${role} ${sequence}`,
        ).toBe(false);
      }
    }
  });

  describe("actual statements", () => {
    // Committed synthetic rows that the runtime roles act on; removed again at the end (fixture cleanup).
    const seeded: { event?: string; config?: string; scope?: string } = {};
    const snapshot = async () =>
      (
        await Promise.all(
          TABLES.map(
            async (table) =>
              (
                await admin.query(
                  `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]') AS rows FROM app.${table} t`,
                )
              ).rows[0].rows,
          ),
        )
      ).map((rows, i) => [TABLES[i], rows]);

    beforeAll(async () => {
      seeded.event = await insertRow("events", eventRow());
      seeded.config = await insertRow("karaoke_sales_configurations", configRow(seeded.event));
      seeded.scope = await insertRow(SCOPE, scopeRow(seeded.event));
      await insertRow(SLOT, slotRow(seeded.scope, seeded.config));
    });

    afterAll(async () => {
      // Administrator cleanup of this test's own rows, children first.
      await admin.query(`DELETE FROM app.${SLOT}`);
      await admin.query(`DELETE FROM app.${SCOPE}`);
      await admin.query("DELETE FROM app.karaoke_sales_configurations");
      await admin.query("DELETE FROM app.events");
    });

    it("TC-SEC-DB-001-002 app_api_runtime can SELECT both tables", async () => {
      const api = poolOf("app_api_runtime");
      for (const table of TABLES) {
        expect((await api.query(`SELECT 1 FROM app.${table}`)).rowCount, `${table} select`).toBe(1);
      }
    });

    it("TC-SEC-DB-001-002 app_api_runtime is refused INSERT, UPDATE, DELETE, TRUNCATE and SELECT ... FOR UPDATE on both tables with 42501, and nothing changes", async () => {
      const before = await snapshot();
      const api = poolOf("app_api_runtime");
      const inserts: [string, Row][] = [
        [SCOPE, scopeRow(seeded.event as string, { name: "合成スコープ denied" })],
        [
          SLOT,
          slotRow(seeded.scope as string, seeded.config as string, {
            usage_start: at(60),
            usage_end: at(75),
            cycle_end: at(80),
          }),
        ],
      ];
      for (const [table, row] of inserts) {
        const [statement, values] = insertStatement(table, row);
        await expect(api.query(statement, values), `${table} INSERT`).rejects.toMatchObject({
          code: "42501",
        });
      }
      for (const table of TABLES) {
        for (const statement of [
          `UPDATE app.${table} SET updated_at = transaction_timestamp()`,
          `DELETE FROM app.${table} WHERE false`,
          `TRUNCATE app.${table}`,
          // Locking a row needs the UPDATE privilege: with SELECT only, a lock query is refused.
          `SELECT 1 FROM app.${table} FOR UPDATE`,
        ]) {
          await expect(api.query(statement), `${table}: ${statement}`).rejects.toMatchObject({
            code: "42501",
          });
        }
      }
      expect(await snapshot()).toEqual(before);
    });

    it("TC-SEC-DB-001-002 app_email_runtime and app_reconciliation_runtime are refused SELECT, INSERT, UPDATE and DELETE on both tables with 42501", async () => {
      const before = await snapshot();
      const inserts: [string, Row][] = [
        [SCOPE, scopeRow(seeded.event as string, { name: "合成スコープ denied" })],
        [SLOT, slotRow(seeded.scope as string, seeded.config as string)],
      ];
      for (const role of ["app_email_runtime", "app_reconciliation_runtime"] as const) {
        const pool = poolOf(role);
        for (const table of TABLES) {
          for (const statement of [
            `SELECT 1 FROM app.${table}`,
            `UPDATE app.${table} SET updated_at = transaction_timestamp()`,
            `DELETE FROM app.${table} WHERE false`,
          ]) {
            await expect(pool.query(statement), `${role}: ${statement}`).rejects.toMatchObject({
              code: "42501",
            });
          }
        }
        for (const [table, row] of inserts) {
          const [insertText, insertValues] = insertStatement(table, row);
          await expect(
            pool.query(insertText, insertValues),
            `${role} ${table} INSERT`,
          ).rejects.toMatchObject({ code: "42501" });
        }
      }
      expect(await snapshot()).toEqual(before);
    });
  });
});
