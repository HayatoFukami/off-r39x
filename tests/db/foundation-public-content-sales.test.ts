import { readFile } from "node:fs/promises";
import { Client, type Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, runMigrations } from "../../packages/db/src/index.ts";
import { migrationIdentities } from "../../packages/db/src/migrations.ts";
import { catalogQuery, requiredCatalog } from "../../packages/db/src/schema-contract.ts";
import { installSyntheticDirectory, prepareFoundationDatabase } from "../harness/db/foundation.ts";

// PR-L2-2 C1: the eight public content / sales tables of migration 0003 on a real PostgreSQL 17
// (SPEC-100 §13.1-13.4, §15.1-15.3, §38; SPEC-170 §22-§23, TST-DB-001, TST-DB-005). Constraints,
// identity, foreign keys and privileges are never proven by a fake (TST-GEN-004, DEV-TST-003).
// The catalog goldens below are written by hand from SPEC-100 and the PostgreSQL 17 normalised
// notation; they are not derived from schema-contract.json or from the migration.
// Every violating row breaks exactly one constraint (PostgreSQL evaluates CHECK constraints in name
// order and reports the first failure), and every assertion checks the SQLSTATE and the constraint
// name together. All data is synthetic.

const url = process.env.TEST_DATABASE_URL;
const caPath = process.env.TEST_DATABASE_CA;
if (!url || !caPath) throw new Error("Real PG17 requires TEST_DATABASE_URL and TEST_DATABASE_CA");

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// An id no identity sequence of this test database reaches.
const ABSENT_ID = "9223372036854775807";
const T0 = "2030-01-01T00:00:00Z";
const T1 = "2030-01-02T00:00:00Z";

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

// ---- goldens (SPEC-100 §13.1-13.4, §15.1-15.3, §38, §9, §10, §8.3; PostgreSQL 17 notation) ---------

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
const eventIdColumn: GoldenColumn = ["event_id", "bigint", true, "", null];
const createdAtColumn: GoldenColumn = ["created_at", TSTZ, true, "", NOW_DEFAULT];
const updatedAtColumn: GoldenColumn = ["updated_at", TSTZ, true, "", NOW_DEFAULT];
const text = (name: string, notNull: boolean): GoldenColumn => [name, "text", notNull, "", null];
const tstz = (name: string, notNull: boolean): GoldenColumn => [name, TSTZ, notNull, "", null];
const bigintCol = (name: string): GoldenColumn => [name, "bigint", true, "", null];
const integer = (name: string, defaultExpr: string | null = null): GoldenColumn => [
  name,
  "integer",
  true,
  "",
  defaultExpr,
];

// [conname, contype, pg_get_constraintdef]
type GoldenConstraint = [name: string, kind: string, definition: string];
const pk = (table: string, column = "id"): GoldenConstraint => [
  `pk_${table}`,
  "p",
  `PRIMARY KEY (${column})`,
];
const uniqueRef = (table: string): GoldenConstraint => [
  `uq_${table}_public_ref`,
  "u",
  "UNIQUE (public_ref)",
];
const eventFk = (table: string): GoldenConstraint => [
  `fk_${table}_event`,
  "f",
  "FOREIGN KEY (event_id) REFERENCES app.events(id) ON DELETE RESTRICT",
];
const ck = (name: string, definition: string): GoldenConstraint => [name, "c", definition];
const PUBLICATION_STATE =
  "CHECK ((state = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text, 'ARCHIVED'::text])))";

// [index name, pg_get_indexdef]
type GoldenIndex = [name: string, definition: string];
const pkIndex = (table: string, column = "id"): GoldenIndex => [
  `pk_${table}`,
  `CREATE UNIQUE INDEX pk_${table} ON app.${table} USING btree (${column})`,
];
const refIndex = (table: string): GoldenIndex => [
  `uq_${table}_public_ref`,
  `CREATE UNIQUE INDEX uq_${table}_public_ref ON app.${table} USING btree (public_ref)`,
];

function salesChecks(table: string): GoldenConstraint[] {
  return [
    ck(`ck_${table}_unit_amount`, "CHECK ((unit_amount >= 0))"),
    ck(
      `ck_${table}_currency`,
      "CHECK (((currency = upper(currency)) AND (currency ~ '^[A-Z]{3}$'::text)))",
    ),
    ck(
      `ck_${table}_sale_control_state`,
      "CHECK ((sale_control_state = ANY (ARRAY['ENABLED'::text, 'SUSPENDED'::text])))",
    ),
    ck(`ck_${table}_purchase_limit`, "CHECK ((purchase_limit > 0))"),
    ck(`ck_${table}_sales_period`, "CHECK ((sales_starts_at < sales_ends_at))"),
  ];
}

interface GoldenTable {
  table: string;
  identity: boolean;
  columns: GoldenColumn[];
  constraints: GoldenConstraint[];
  indexes: GoldenIndex[];
}
const GOLDEN_TABLES: GoldenTable[] = [
  {
    table: "events",
    identity: true,
    columns: [
      idColumn,
      publicRefColumn,
      text("name", true),
      text("summary", false),
      tstz("starts_at", false),
      tstz("ends_at", false),
      ["business_timezone", "text", true, "", "'Asia/Tokyo'::text"],
      text("venue_name", false),
      text("venue_details", false),
      text("access_information", false),
      text("participant_notices", false),
      createdAtColumn,
      updatedAtColumn,
    ],
    constraints: [
      pk("events"),
      uniqueRef("events"),
      ck("ck_events_name", "CHECK ((char_length(name) > 0))"),
      ck("ck_events_period", "CHECK ((starts_at < ends_at))"),
      ck("ck_events_business_timezone", "CHECK ((business_timezone = 'Asia/Tokyo'::text))"),
    ],
    indexes: [pkIndex("events"), refIndex("events")],
  },
  {
    table: "faq_items",
    identity: true,
    columns: [
      idColumn,
      publicRefColumn,
      eventIdColumn,
      text("question", true),
      text("answer", true),
      text("state", true),
      integer("sort_order", "0"),
      tstz("published_at", false),
      createdAtColumn,
      updatedAtColumn,
    ],
    constraints: [
      pk("faq_items"),
      uniqueRef("faq_items"),
      eventFk("faq_items"),
      ck("ck_faq_items_state", PUBLICATION_STATE),
    ],
    indexes: [
      pkIndex("faq_items"),
      refIndex("faq_items"),
      [
        "ix_faq_items_event_state_sort",
        "CREATE INDEX ix_faq_items_event_state_sort ON app.faq_items USING btree (event_id, state, sort_order)",
      ],
    ],
  },
  {
    table: "announcements",
    identity: true,
    columns: [
      idColumn,
      publicRefColumn,
      eventIdColumn,
      text("title", true),
      text("body", true),
      text("state", true),
      tstz("published_at", false),
      createdAtColumn,
      updatedAtColumn,
    ],
    constraints: [
      pk("announcements"),
      uniqueRef("announcements"),
      eventFk("announcements"),
      ck("ck_announcements_state", PUBLICATION_STATE),
    ],
    indexes: [
      pkIndex("announcements"),
      refIndex("announcements"),
      [
        "ix_announcements_event_state_published",
        "CREATE INDEX ix_announcements_event_state_published ON app.announcements USING btree (event_id, state, published_at DESC)",
      ],
    ],
  },
  {
    table: "sponsor_logos",
    identity: true,
    columns: [
      idColumn,
      publicRefColumn,
      eventIdColumn,
      text("display_name", true),
      text("image_url", true),
      text("link_url", false),
      integer("sort_order", "0"),
      ["state", "text", true, "", "'DRAFT'::text"],
      tstz("published_at", false),
      createdAtColumn,
      updatedAtColumn,
    ],
    constraints: [
      pk("sponsor_logos"),
      uniqueRef("sponsor_logos"),
      eventFk("sponsor_logos"),
      ck("ck_sponsor_logos_state", PUBLICATION_STATE),
      ck(
        "ck_sponsor_logos_display_name",
        "CHECK (((char_length(display_name) >= 1) AND (char_length(display_name) <= 200)))",
      ),
      ck(
        "ck_sponsor_logos_image_url",
        "CHECK (((char_length(image_url) >= 1) AND (char_length(image_url) <= 2048)))",
      ),
      ck(
        "ck_sponsor_logos_link_url",
        "CHECK (((link_url IS NULL) OR ((char_length(link_url) >= 1) AND (char_length(link_url) <= 2048))))",
      ),
      ck("ck_sponsor_logos_sort_order", "CHECK ((sort_order >= 0))"),
      ck(
        "ck_sponsor_logos_published_at",
        "CHECK (((state <> 'PUBLISHED'::text) OR (published_at IS NOT NULL)))",
      ),
    ],
    indexes: [
      pkIndex("sponsor_logos"),
      refIndex("sponsor_logos"),
      [
        "ix_sponsor_logos_event_state_sort",
        "CREATE INDEX ix_sponsor_logos_event_state_sort ON app.sponsor_logos USING btree (event_id, state, sort_order, public_ref)",
      ],
    ],
  },
  {
    table: "entry_ticket_offerings",
    identity: true,
    columns: [
      idColumn,
      publicRefColumn,
      eventIdColumn,
      text("name", true),
      text("description", false),
      bigintCol("unit_amount"),
      text("currency", true),
      tstz("sales_starts_at", true),
      tstz("sales_ends_at", true),
      text("sale_control_state", true),
      integer("sales_capacity"),
      integer("held_quantity", "0"),
      integer("committed_quantity", "0"),
      integer("purchase_limit"),
      tstz("checkin_opens_at", false),
      tstz("checkin_closes_at", false),
      createdAtColumn,
      updatedAtColumn,
    ],
    constraints: [
      pk("entry_ticket_offerings"),
      uniqueRef("entry_ticket_offerings"),
      eventFk("entry_ticket_offerings"),
      ...salesChecks("entry_ticket_offerings"),
      ck("ck_entry_ticket_offerings_sales_capacity", "CHECK ((sales_capacity >= 0))"),
      ck("ck_entry_ticket_offerings_held_quantity", "CHECK ((held_quantity >= 0))"),
      ck("ck_entry_ticket_offerings_committed_quantity", "CHECK ((committed_quantity >= 0))"),
      ck(
        "ck_entry_ticket_offerings_capacity",
        "CHECK ((((held_quantity)::bigint + committed_quantity) <= sales_capacity))",
      ),
      ck(
        "ck_entry_ticket_offerings_checkin_window",
        "CHECK ((checkin_opens_at < checkin_closes_at))",
      ),
    ],
    indexes: [pkIndex("entry_ticket_offerings"), refIndex("entry_ticket_offerings")],
  },
  {
    table: "karaoke_sales_configurations",
    identity: true,
    columns: [
      idColumn,
      publicRefColumn,
      eventIdColumn,
      text("name", true),
      bigintCol("unit_amount"),
      text("currency", true),
      tstz("sales_starts_at", true),
      tstz("sales_ends_at", true),
      text("sale_control_state", true),
      integer("purchase_limit"),
      ["standard_usage_minutes", "smallint", true, "", "15"],
      ["standard_maintenance_minutes", "smallint", true, "", "5"],
      createdAtColumn,
      updatedAtColumn,
    ],
    constraints: [
      pk("karaoke_sales_configurations"),
      uniqueRef("karaoke_sales_configurations"),
      eventFk("karaoke_sales_configurations"),
      ...salesChecks("karaoke_sales_configurations"),
      ck(
        "ck_karaoke_sales_configurations_standard_usage_minutes",
        "CHECK ((standard_usage_minutes = 15))",
      ),
      ck(
        "ck_karaoke_sales_configurations_standard_maintenance_minutes",
        "CHECK ((standard_maintenance_minutes = 5))",
      ),
    ],
    indexes: [pkIndex("karaoke_sales_configurations"), refIndex("karaoke_sales_configurations")],
  },
  {
    table: "goods",
    identity: true,
    columns: [
      idColumn,
      publicRefColumn,
      eventIdColumn,
      text("name", true),
      text("description", false),
      bigintCol("unit_amount"),
      text("currency", true),
      tstz("sales_starts_at", true),
      tstz("sales_ends_at", true),
      text("sale_control_state", true),
      integer("purchase_limit"),
      createdAtColumn,
      updatedAtColumn,
    ],
    constraints: [pk("goods"), uniqueRef("goods"), eventFk("goods"), ...salesChecks("goods")],
    indexes: [pkIndex("goods"), refIndex("goods")],
  },
  {
    table: "goods_inventory",
    identity: false,
    columns: [
      bigintCol("goods_id"),
      integer("saleable_capacity"),
      integer("held_quantity", "0"),
      integer("committed_quantity", "0"),
      updatedAtColumn,
    ],
    constraints: [
      pk("goods_inventory", "goods_id"),
      [
        "fk_goods_inventory_goods",
        "f",
        "FOREIGN KEY (goods_id) REFERENCES app.goods(id) ON DELETE RESTRICT",
      ],
      ck("ck_goods_inventory_saleable_capacity", "CHECK ((saleable_capacity >= 0))"),
      ck("ck_goods_inventory_held_quantity", "CHECK ((held_quantity >= 0))"),
      ck("ck_goods_inventory_committed_quantity", "CHECK ((committed_quantity >= 0))"),
      ck(
        "ck_goods_inventory_capacity",
        "CHECK ((((held_quantity)::bigint + committed_quantity) <= saleable_capacity))",
      ),
    ],
    indexes: [pkIndex("goods_inventory", "goods_id")],
  },
];

const TABLES = GOLDEN_TABLES.map((g) => g.table);
const IDENTITY_TABLES = GOLDEN_TABLES.filter((g) => g.identity).map((g) => g.table);
const PUBLICATION_TABLES = ["faq_items", "announcements", "sponsor_logos"] as const;
const SALES_TABLES = ["entry_ticket_offerings", "karaoke_sales_configurations", "goods"] as const;
// Child tables of events (every table except events itself and goods_inventory).
const EVENT_CHILD_TABLES = [...PUBLICATION_TABLES, ...SALES_TABLES] as const;

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

async function countRows(table: string): Promise<number> {
  return (await admin.query(`SELECT count(*)::int AS count FROM app.${table}`)).rows[0].count;
}

async function expectNothingCommitted(tables: readonly string[] = TABLES) {
  for (const table of tables) expect(await countRows(table), `${table} rows`).toBe(0);
}

// ---- synthetic row factories (valid by default; overrides break one rule at a time) --------------

const eventRow = (o: Row = {}): Row => ({ name: "合成イベント", ...o });
const faqRow = (eventId: string, o: Row = {}): Row => ({
  event_id: eventId,
  question: "合成の質問",
  answer: "合成の回答",
  state: "DRAFT",
  ...o,
});
const announcementRow = (eventId: string, o: Row = {}): Row => ({
  event_id: eventId,
  title: "合成のお知らせ",
  body: "合成の本文",
  state: "DRAFT",
  ...o,
});
const sponsorRow = (eventId: string, o: Row = {}): Row => ({
  event_id: eventId,
  display_name: "合成協賛",
  image_url: "https://logo.example.com/synthetic.png",
  ...o,
});
const salesBase = (eventId: string): Row => ({
  event_id: eventId,
  unit_amount: 1234,
  currency: "JPY",
  sales_starts_at: T0,
  sales_ends_at: T1,
  sale_control_state: "ENABLED",
  purchase_limit: 4,
});
const entryRow = (eventId: string, o: Row = {}): Row => ({
  ...salesBase(eventId),
  name: "合成入場券",
  sales_capacity: 10,
  ...o,
});
const karaokeRow = (eventId: string, o: Row = {}): Row => ({
  ...salesBase(eventId),
  name: "合成カラオケ",
  ...o,
});
const goodsRow = (eventId: string, o: Row = {}): Row => ({
  ...salesBase(eventId),
  name: "合成グッズ",
  ...o,
});
const inventoryRow = (goodsId: string, o: Row = {}): Row => ({
  goods_id: goodsId,
  saleable_capacity: 10,
  ...o,
});

type RowFactory = (eventId: string, o?: Row) => Row;
const FACTORIES: Record<(typeof EVENT_CHILD_TABLES)[number], RowFactory> = {
  faq_items: faqRow,
  announcements: announcementRow,
  sponsor_logos: sponsorRow,
  entry_ticket_offerings: entryRow,
  karaoke_sales_configurations: karaokeRow,
  goods: goodsRow,
};
const SALES_FACTORIES = [
  ["entry_ticket_offerings", entryRow],
  ["karaoke_sales_configurations", karaokeRow],
  ["goods", goodsRow],
] as const;

// ---- TC-DB-ARC-007-004 --------------------------------------------------------------------------

describe("TC-DB-ARC-007-004 migration 0003 and the catalog of the eight tables (real PostgreSQL 17)", () => {
  it("TC-DB-ARC-007-004 the journal lists 0001, 0002 and 0003 exactly once each with the source hashes, and a second run changes nothing", async () => {
    const identities = await migrationIdentities();
    const read = async () =>
      (await admin.query("SELECT version, source_hash FROM app.schema_migrations ORDER BY version"))
        .rows;
    const before = await read();
    expect(before.map((row) => row.version).slice(0, 3)).toEqual([
      "0001_foundation",
      "0002_audit_events",
      "0003_public_content_sales",
    ]);
    expect(new Set(before.map((row) => row.version)).size).toBe(before.length);
    expect(before).toHaveLength(identities.length);
    expect(before.map((row) => [row.version, row.source_hash])).toEqual(
      identities.map((identity) => [identity.version, identity.hash]),
    );

    await admin.query("SET ROLE app_migrator");
    try {
      await runMigrations(admin);
    } finally {
      await admin.query("RESET ROLE");
    }
    expect(await read()).toEqual(before);
  });

  it("TC-DB-ARC-007-004 0001 and 0002 are byte for byte the committed files (DB-MIG-003) and 0003 only creates the eight tables", async () => {
    const identities = await migrationIdentities();
    const hashOf = (name: string) => identities.find((i) => i.name === name)?.hash;
    // Pinned from the committed history: an applied migration is never edited.
    expect(hashOf("0001_foundation.sql")).toBe(
      "8be0243f1a20c66feddef29f21f805be6fc4d6ca6b78e6994e520189de3cf8bd",
    );
    expect(hashOf("0002_audit_events.sql")).toBe(
      "7cc76ebe922de728c6965bc4734583b99aaa13bd74119e03e5c244281001409f",
    );
    const third = identities.find((i) => i.name === "0003_public_content_sales.sql");
    expect(third, "0003_public_content_sales.sql exists").toBeDefined();

    // Static evidence only: nothing outside the eight new tables is touched (not a readiness check of an old build).
    const sqlText = (third?.sql ?? "")
      .split(/\r?\n/)
      .map((line) => line.replace(/--.*$/, ""))
      .join("\n");
    const referenced = [...sqlText.matchAll(/\bapp\.([a-z_]+)/g)].map((m) => m[1]);
    expect([...new Set(referenced)].sort()).toEqual([...TABLES].sort());
    for (const forbidden of [
      /\bALTER\b/i,
      /\bDROP\b/i,
      /\bTRUNCATE\b/i,
      /\bDELETE\s+FROM\b/i,
      /\bCREATE\s+(OR\s+REPLACE\s+)?(TRIGGER|FUNCTION|EXTENSION|ROLE|SCHEMA)\b/i,
      /\bOWNER\s+TO\b/i,
      /\bROW\s+LEVEL\s+SECURITY\b/i,
    ]) {
      expect(sqlText, `0003 must not contain ${forbidden}`).not.toMatch(forbidden);
    }
    expect([...sqlText.matchAll(/\bCREATE\s+TABLE\b/gi)]).toHaveLength(8);
    // Only the three SPEC-100 §13 indexes are created separately (PK / UNIQUE indexes come from constraints).
    expect(
      [...sqlText.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+([a-z_]+)/gi)].map((m) => m[1]).sort(),
    ).toEqual([
      "ix_announcements_event_state_published",
      "ix_faq_items_event_state_sort",
      "ix_sponsor_logos_event_state_sort",
    ]);
  });

  it("TC-DB-ARC-007-004 columns of the eight tables equal the SPEC-100 goldens in attnum order", async () => {
    expect(GOLDEN_TABLES.map((g) => g.columns.length)).toEqual([13, 10, 9, 11, 18, 14, 13, 5]);
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

  it("TC-DB-ARC-007-004 constraints of the eight tables equal the goldens by name, kind and definition (59 in total)", async () => {
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
      ).toEqual([...golden.constraints].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
      for (const row of rows) {
        expect([row.convalidated, row.condeferrable, row.condeferred], row.conname).toEqual([
          true,
          false,
          false,
        ]);
      }
    }
    expect(total).toBe(59);
  });

  it("TC-DB-ARC-007-004 exactly 18 valid indexes equal the goldens, with only the three SPEC-100 section 13 indexes besides PK and UNIQUE", async () => {
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
      ).toEqual([...golden.indexes].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
      expect(rows.every((r) => r.indisvalid && r.indisready && r.indislive)).toBe(true);
    }
    expect(total).toBe(18);
  });

  it("TC-DB-ARC-007-004 owner is app_migrator, row level security is off, there are seven identity sequences and no timestamp without time zone", async () => {
    const tables = (
      await admin.query(
        `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity, c.relforcerowsecurity, c.relkind
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app' AND c.relname = ANY($1) ORDER BY c.relname`,
        [TABLES],
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
        [IDENTITY_TABLES.map((table) => `${table}_id_seq`)],
      )
    ).rows;
    expect(sequences.map((s) => [s.relname, s.type, s.owner])).toEqual(
      IDENTITY_TABLES.map((table) => `${table}_id_seq`)
        .sort()
        .map((name) => [name, "bigint", "app_migrator"]),
    );
    expect(sequences).toHaveLength(7);
    // DB-TIM-001: every *_at column of the eight tables is timestamptz; none is timestamp without time zone.
    const timeColumns = (
      await admin.query(
        `SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod) AS type
           FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app' AND c.relname = ANY($1) AND a.attnum > 0 AND NOT a.attisdropped
            AND (a.attname LIKE '%\\_at' OR format_type(a.atttypid, a.atttypmod) LIKE 'timestamp%')`,
        [TABLES],
      )
    ).rows;
    expect(timeColumns.length).toBeGreaterThan(0);
    for (const column of timeColumns) {
      expect(column.type, `${column.relname}.${column.attname}`).toBe(TSTZ);
    }
  });

  it("TC-DB-ARC-007-004 the live catalog equals requiredCatalog, checked directly and not through readiness", async () => {
    const live = (await admin.query(catalogQuery)).rows[0].catalog;
    expect(live).toEqual(requiredCatalog);
    // The contract is not vacuous: it must describe all eight tables.
    const liveTables = live.tables.map((row: unknown[]) => row[0]);
    for (const table of TABLES) expect(liveTables).toContain(table);
  });

  it("TC-DB-ARC-007-004 public_ref is a database generated v4 UUID; a duplicate public_ref or id is a unique violation named by its constraint; identity is ALWAYS", async () => {
    await inRolledBackTransaction(async () => {
      const eventId = await insertRow("events", eventRow());
      const rows: Record<string, Row> = {
        events: eventRow(),
        faq_items: faqRow(eventId),
        announcements: announcementRow(eventId),
        sponsor_logos: sponsorRow(eventId),
        entry_ticket_offerings: entryRow(eventId),
        karaoke_sales_configurations: karaokeRow(eventId),
        goods: goodsRow(eventId),
      };
      for (const table of IDENTITY_TABLES) {
        const row = rows[table] as Row;
        const [statement, values] = insertStatement(table, row, "id, public_ref");
        const created = (await admin.query(statement, values)).rows[0];
        expect(created.public_ref, `${table} public_ref`).toMatch(UUID_V4);

        // The same public_ref again: SQLSTATE 23505 on uq_<table>_public_ref.
        expectViolation(
          await tryInsert(table, { ...row, public_ref: created.public_ref }),
          "23505",
          `uq_${table}_public_ref`,
          `${table} duplicate public_ref`,
        );
        // The same id again with OVERRIDING SYSTEM VALUE: SQLSTATE 23505 on pk_<table>.
        const columns = Object.keys(row).filter((column) => row[column] !== undefined);
        expectViolation(
          await attempt(
            `INSERT INTO app.${table}(id, ${columns.join(", ")}) OVERRIDING SYSTEM VALUE VALUES ($1, ${columns.map((_, i) => `$${i + 2}`).join(", ")})`,
            [created.id, ...columns.map((column) => row[column])],
          ),
          "23505",
          `pk_${table}`,
          `${table} duplicate id`,
        );
        // GENERATED ALWAYS: an explicit id without OVERRIDING SYSTEM VALUE is refused (428C9).
        const refused = await attempt(
          `INSERT INTO app.${table}(id, ${columns.join(", ")}) VALUES ($1, ${columns.map((_, i) => `$${i + 2}`).join(", ")})`,
          [ABSENT_ID, ...columns.map((column) => row[column])],
        );
        expect(refused?.code, `${table} explicit id`).toBe("428C9");
      }
    });
    await expectNothingCommitted();
  });
});

// ---- TC-DB-STA-002-001 --------------------------------------------------------------------------

describe("TC-DB-STA-002-001 state allowlist CHECK constraints (real PostgreSQL 17)", () => {
  it("TC-DB-STA-002-001 faq_items, announcements and sponsor_logos accept DRAFT, PUBLISHED and ARCHIVED and reject near misses with 23514 by name", async () => {
    await inRolledBackTransaction(async () => {
      const eventId = await insertRow("events", eventRow());
      for (const table of PUBLICATION_TABLES) {
        const build = FACTORIES[table];
        for (const state of ["DRAFT", "PUBLISHED", "ARCHIVED"]) {
          // published_at is set so that the sponsor_logos PUBLISHED rule is not the thing under test.
          await expectAccepted(
            table,
            build(eventId, { state, published_at: T0 }),
            `${table} state=${state}`,
          );
        }
        for (const state of ["", "draft", "PUBLISHEDX", "ENABLED", "UNKNOWN_VALUE"]) {
          await expectRejected(
            table,
            build(eventId, { state, published_at: T0 }),
            "23514",
            `ck_${table}_state`,
            `${table} state='${state}'`,
          );
        }
      }
    });
    await expectNothingCommitted();
  });

  it("TC-DB-STA-002-001 the sale control state of the three sales tables accepts ENABLED and SUSPENDED and rejects near misses with 23514 by name", async () => {
    await inRolledBackTransaction(async () => {
      const eventId = await insertRow("events", eventRow());
      for (const [table, build] of SALES_FACTORIES) {
        for (const state of ["ENABLED", "SUSPENDED"]) {
          await expectAccepted(
            table,
            build(eventId, { sale_control_state: state }),
            `${table} sale_control_state=${state}`,
          );
        }
        for (const state of ["", "enabled", "DRAFT", "SALES_STOPPED"]) {
          await expectRejected(
            table,
            build(eventId, { sale_control_state: state }),
            "23514",
            `ck_${table}_sale_control_state`,
            `${table} sale_control_state='${state}'`,
          );
        }
      }
    });
    await expectNothingCommitted();
  });

  it("TC-DB-STA-002-001 sponsor_logos defaults to DRAFT while the other states and the sale control state have no default (23502)", async () => {
    await inRolledBackTransaction(async () => {
      const eventId = await insertRow("events", eventRow());
      const [statement, values] = insertStatement("sponsor_logos", sponsorRow(eventId), "state");
      expect((await admin.query(statement, values)).rows[0].state).toBe("DRAFT");

      await expectRejected(
        "faq_items",
        faqRow(eventId, { state: undefined }),
        "23502",
        "state",
        "faq_items state omitted",
      );
      await expectRejected(
        "announcements",
        announcementRow(eventId, { state: undefined }),
        "23502",
        "state",
        "announcements state omitted",
      );
      for (const [table, build] of SALES_FACTORIES) {
        await expectRejected(
          table,
          build(eventId, { sale_control_state: undefined }),
          "23502",
          "sale_control_state",
          `${table} sale_control_state omitted`,
        );
        // An explicit NULL is the same violation as an omission.
        await expectRejected(
          table,
          build(eventId, { sale_control_state: null }),
          "23502",
          "sale_control_state",
          `${table} sale_control_state NULL`,
        );
      }
    });
    await expectNothingCommitted();
  });
});

// ---- TC-DB-TIM-001-001 --------------------------------------------------------------------------

describe("TC-DB-TIM-001-001 time ordering CHECK constraints and transaction_timestamp() defaults (real PostgreSQL 17)", () => {
  it("TC-DB-TIM-001-001 events.starts_at < ends_at is enforced only when both are set", async () => {
    await inRolledBackTransaction(async () => {
      await expectAccepted(
        "events",
        eventRow({ starts_at: T0, ends_at: T1 }),
        "events starts before ends",
      );
      await expectAccepted(
        "events",
        eventRow({
          starts_at: "2030-01-01T00:00:00.000000Z",
          ends_at: "2030-01-01T00:00:00.000001Z",
        }),
        "events one microsecond apart",
      );
      for (const [label, starts, ends] of [
        ["equal", T0, T0],
        ["reversed", T1, T0],
      ] as const) {
        await expectRejected(
          "events",
          eventRow({ starts_at: starts, ends_at: ends }),
          "23514",
          "ck_events_period",
          `events ${label}`,
        );
      }
      // Facts that are not yet decided stay NULL (BR-EVT-001).
      await expectAccepted("events", eventRow({ starts_at: T0 }), "events only starts_at");
      await expectAccepted("events", eventRow({ ends_at: T0 }), "events only ends_at");
      await expectAccepted("events", eventRow(), "events neither");
    });
    await expectNothingCommitted();
  });

  it("TC-DB-TIM-001-001 sales_starts_at < sales_ends_at is enforced on the three sales tables and both bounds are required", async () => {
    await inRolledBackTransaction(async () => {
      const eventId = await insertRow("events", eventRow());
      for (const [table, build] of SALES_FACTORIES) {
        await expectAccepted(
          table,
          build(eventId, {
            sales_starts_at: "2030-01-01T00:00:00.000000Z",
            sales_ends_at: "2030-01-01T00:00:00.000001Z",
          }),
          `${table} one microsecond apart`,
        );
        for (const [label, starts, ends] of [
          ["equal", T0, T0],
          ["reversed", T1, T0],
        ] as const) {
          await expectRejected(
            table,
            build(eventId, { sales_starts_at: starts, sales_ends_at: ends }),
            "23514",
            `ck_${table}_sales_period`,
            `${table} ${label}`,
          );
        }
        for (const column of ["sales_starts_at", "sales_ends_at"]) {
          await expectRejected(
            table,
            build(eventId, { [column]: undefined }),
            "23502",
            column,
            `${table} ${column} omitted`,
          );
        }
      }
    });
    await expectNothingCommitted();
  });

  it("TC-DB-TIM-001-001 the entry check-in window opens before it closes when both are set", async () => {
    await inRolledBackTransaction(async () => {
      const eventId = await insertRow("events", eventRow());
      await expectAccepted(
        "entry_ticket_offerings",
        entryRow(eventId, { checkin_opens_at: T0, checkin_closes_at: T1 }),
        "window open before close",
      );
      for (const [label, opens, closes] of [
        ["equal", T0, T0],
        ["reversed", T1, T0],
      ] as const) {
        await expectRejected(
          "entry_ticket_offerings",
          entryRow(eventId, { checkin_opens_at: opens, checkin_closes_at: closes }),
          "23514",
          "ck_entry_ticket_offerings_checkin_window",
          `window ${label}`,
        );
      }
      await expectAccepted(
        "entry_ticket_offerings",
        entryRow(eventId, { checkin_opens_at: T0 }),
        "only opens",
      );
      await expectAccepted(
        "entry_ticket_offerings",
        entryRow(eventId, { checkin_closes_at: T0 }),
        "only closes",
      );
      await expectAccepted("entry_ticket_offerings", entryRow(eventId), "neither");
    });
    await expectNothingCommitted();
  });

  it("TC-DB-TIM-001-001 created_at and updated_at default to the transaction's transaction_timestamp(), not to the statement time", async () => {
    await inRolledBackTransaction(async () => {
      const eventId = await insertRow("events", eventRow());
      const goodsId = await insertRow("goods", goodsRow(eventId));
      const rows: Record<string, Row> = {
        events: eventRow(),
        faq_items: faqRow(eventId),
        announcements: announcementRow(eventId),
        sponsor_logos: sponsorRow(eventId),
        entry_ticket_offerings: entryRow(eventId),
        karaoke_sales_configurations: karaokeRow(eventId),
        goods: goodsRow(eventId),
        goods_inventory: inventoryRow(goodsId),
      };
      for (const table of TABLES) {
        // A pause between the transaction start and the INSERT separates the clocks: a default of
        // clock_timestamp() or statement_timestamp() would differ from transaction_timestamp().
        await admin.query("SELECT pg_sleep(0.02)");
        const columns = table === "goods_inventory" ? ["updated_at"] : ["created_at", "updated_at"];
        const [statement, values] = insertStatement(
          table,
          rows[table] as Row,
          columns
            .map((column) => `${column} = transaction_timestamp() AS ${column}_equal`)
            .join(", "),
        );
        expect(
          (await admin.query(statement, values)).rows[0],
          `${table} default timestamps`,
        ).toEqual(Object.fromEntries(columns.map((column) => [`${column}_equal`, true])));
      }
    });
    await expectNothingCommitted();
  });
});

// ---- TC-DB-005-001 ------------------------------------------------------------------------------

// A value like sales_capacity = -1 also breaks the capacity CHECK (held + committed >= 0 > -1), so the
// two cannot be told apart by one INSERT. The sibling is dropped inside a rolled back transaction, so that
// the constraint under test is the only one left to fire.
async function onlyViolation(
  siblingToDrop: string,
  table: string,
  build: () => Promise<Row>,
): Promise<PgError | undefined> {
  return inRolledBackTransaction(async () => {
    const row = await build();
    await admin.query("SET LOCAL ROLE app_migrator");
    await admin.query(`ALTER TABLE app.${table} DROP CONSTRAINT ${siblingToDrop}`);
    return tryInsert(table, row);
  });
}

describe("TC-DB-005-001 amount, currency, purchase limit and counter CHECK constraints (real PostgreSQL 17)", () => {
  it("TC-DB-005-001 unit_amount is a lossless bigint >= 0, currency is three upper case letters and purchase_limit > 0 on all three sales tables", async () => {
    await inRolledBackTransaction(async () => {
      const eventId = await insertRow("events", eventRow());
      for (const [table, build] of SALES_FACTORIES) {
        await expectAccepted(table, build(eventId, { unit_amount: 0 }), `${table} unit_amount 0`);
        // Above 2^53: a float column would round this value.
        const [statement, values] = insertStatement(
          table,
          build(eventId, { unit_amount: "9007199254740993" }),
          "unit_amount::text AS amount",
        );
        expect((await admin.query(statement, values)).rows[0].amount, `${table} bigint`).toBe(
          "9007199254740993",
        );
        await expectRejected(
          table,
          build(eventId, { unit_amount: -1 }),
          "23514",
          `ck_${table}_unit_amount`,
          `${table} unit_amount -1`,
        );

        await expectAccepted(table, build(eventId, { currency: "JPY" }), `${table} currency JPY`);
        for (const currency of ["jpy", "Jpy", "JP", "JPYY", "JP1", ""]) {
          await expectRejected(
            table,
            build(eventId, { currency }),
            "23514",
            `ck_${table}_currency`,
            `${table} currency '${currency}'`,
          );
        }

        await expectAccepted(
          table,
          build(eventId, { purchase_limit: 1 }),
          `${table} purchase_limit 1`,
        );
        for (const purchaseLimit of [0, -1]) {
          await expectRejected(
            table,
            build(eventId, { purchase_limit: purchaseLimit }),
            "23514",
            `ck_${table}_purchase_limit`,
            `${table} purchase_limit ${purchaseLimit}`,
          );
        }
        // integer, not bigint: one above the 32 bit range is a numeric overflow (22003).
        expect(
          (await tryInsert(table, build(eventId, { purchase_limit: 2147483648 })))?.code,
          `${table} purchase_limit overflow`,
        ).toBe("22003");

        for (const column of ["unit_amount", "currency", "purchase_limit", "name"]) {
          await expectRejected(
            table,
            build(eventId, { [column]: undefined }),
            "23502",
            column,
            `${table} ${column} omitted`,
          );
        }
      }
    });
    await expectNothingCommitted();
  });

  it("TC-DB-005-001 entry_ticket_offerings counters are >= 0 and default to 0; sales_capacity >= 0", async () => {
    await inRolledBackTransaction(async () => {
      const eventId = await insertRow("events", eventRow());
      await expectAccepted(
        "entry_ticket_offerings",
        entryRow(eventId, { sales_capacity: 0 }),
        "capacity 0",
      );
      const [statement, values] = insertStatement(
        "entry_ticket_offerings",
        entryRow(eventId),
        "held_quantity, committed_quantity",
      );
      expect((await admin.query(statement, values)).rows[0]).toEqual({
        held_quantity: 0,
        committed_quantity: 0,
      });
      // With a capacity of 10, only the counter's own CHECK is broken (-1 + 0 <= 10 holds).
      await expectRejected(
        "entry_ticket_offerings",
        entryRow(eventId, { held_quantity: -1 }),
        "23514",
        "ck_entry_ticket_offerings_held_quantity",
        "held_quantity -1",
      );
      await expectRejected(
        "entry_ticket_offerings",
        entryRow(eventId, { committed_quantity: -1 }),
        "23514",
        "ck_entry_ticket_offerings_committed_quantity",
        "committed_quantity -1",
      );
      await expectRejected(
        "entry_ticket_offerings",
        entryRow(eventId, { sales_capacity: undefined }),
        "23502",
        "sales_capacity",
        "sales_capacity omitted",
      );
      // sales_capacity = -1 always breaks the capacity CHECK as well; PostgreSQL reports one of the two.
      const both = await tryInsert(
        "entry_ticket_offerings",
        entryRow(eventId, { sales_capacity: -1 }),
      );
      expect(both?.code, "capacity -1").toBe("23514");
      expect(
        ["ck_entry_ticket_offerings_capacity", "ck_entry_ticket_offerings_sales_capacity"],
        "capacity -1 names one of the two",
      ).toContain(both?.constraint);
    });
    // The sibling dropped (in a rolled back transaction), sales_capacity >= 0 is the only violation.
    expectViolation(
      await onlyViolation(
        "ck_entry_ticket_offerings_capacity",
        "entry_ticket_offerings",
        async () => entryRow(await insertRow("events", eventRow()), { sales_capacity: -1 }),
      ),
      "23514",
      "ck_entry_ticket_offerings_sales_capacity",
      "sales_capacity -1 alone",
    );
    await expectNothingCommitted();
  });

  it("TC-DB-005-001 goods_inventory counters are >= 0 and default to 0; saleable_capacity >= 0", async () => {
    await inRolledBackTransaction(async () => {
      const eventId = await insertRow("events", eventRow());
      const goods = async () => insertRow("goods", goodsRow(eventId));
      await expectAccepted(
        "goods_inventory",
        inventoryRow(await goods(), { saleable_capacity: 0 }),
        "capacity 0",
      );
      const [statement, values] = insertStatement(
        "goods_inventory",
        inventoryRow(await goods()),
        "held_quantity, committed_quantity",
      );
      expect((await admin.query(statement, values)).rows[0]).toEqual({
        held_quantity: 0,
        committed_quantity: 0,
      });
      await expectRejected(
        "goods_inventory",
        inventoryRow(await goods(), { held_quantity: -1 }),
        "23514",
        "ck_goods_inventory_held_quantity",
        "held_quantity -1",
      );
      await expectRejected(
        "goods_inventory",
        inventoryRow(await goods(), { committed_quantity: -1 }),
        "23514",
        "ck_goods_inventory_committed_quantity",
        "committed_quantity -1",
      );
      await expectRejected(
        "goods_inventory",
        inventoryRow(await goods(), { saleable_capacity: undefined }),
        "23502",
        "saleable_capacity",
        "saleable_capacity omitted",
      );
      const both = await tryInsert(
        "goods_inventory",
        inventoryRow(await goods(), { saleable_capacity: -1 }),
      );
      expect(both?.code, "capacity -1").toBe("23514");
      expect(
        ["ck_goods_inventory_capacity", "ck_goods_inventory_saleable_capacity"],
        "capacity -1 names one of the two",
      ).toContain(both?.constraint);
    });
    expectViolation(
      await onlyViolation("ck_goods_inventory_capacity", "goods_inventory", async () =>
        inventoryRow(await insertRow("goods", goodsRow(await insertRow("events", eventRow()))), {
          saleable_capacity: -1,
        }),
      ),
      "23514",
      "ck_goods_inventory_saleable_capacity",
      "saleable_capacity -1 alone",
    );
    await expectNothingCommitted();
  });
});

// ---- TC-DB-005-002 / TC-DB-GDS-003-001: the capacity CHECK as the last defence -------------------

interface CapacityTarget {
  table: string;
  capacityColumn: string;
  constraint: string;
  key: string;
  create(eventId: string, capacity: number, held: number, committed: number): Promise<string>;
}
const entryCapacity: CapacityTarget = {
  table: "entry_ticket_offerings",
  capacityColumn: "sales_capacity",
  constraint: "ck_entry_ticket_offerings_capacity",
  key: "id",
  create: (eventId, capacity, held, committed) =>
    insertRow(
      "entry_ticket_offerings",
      entryRow(eventId, {
        sales_capacity: capacity,
        held_quantity: held,
        committed_quantity: committed,
      }),
    ),
};
const goodsCapacity: CapacityTarget = {
  table: "goods_inventory",
  capacityColumn: "saleable_capacity",
  constraint: "ck_goods_inventory_capacity",
  key: "goods_id",
  create: async (eventId, capacity, held, committed) => {
    const goodsId = await insertRow("goods", goodsRow(eventId));
    await admin.query(
      "INSERT INTO app.goods_inventory(goods_id, saleable_capacity, held_quantity, committed_quantity) VALUES ($1, $2, $3, $4)",
      [goodsId, capacity, held, committed],
    );
    return goodsId;
  },
};

async function counters(target: CapacityTarget, id: string) {
  return (
    await admin.query(
      `SELECT ${target.capacityColumn} AS capacity, held_quantity AS held, committed_quantity AS committed
         FROM app.${target.table} WHERE ${target.key} = $1`,
      [id],
    )
  ).rows[0];
}

// Creates a parent chain and one counter row inside a savepoint; resolves to the violation, if any.
async function createAttempt(
  target: CapacityTarget,
  eventId: string,
  capacity: number,
  held: number,
  committed: number,
): Promise<PgError | undefined> {
  await admin.query("SAVEPOINT capacity_attempt");
  try {
    await target.create(eventId, capacity, held, committed);
    await admin.query("RELEASE SAVEPOINT capacity_attempt");
    return undefined;
  } catch (error) {
    await admin.query("ROLLBACK TO SAVEPOINT capacity_attempt");
    return error as PgError;
  }
}

const INT_MAX = 2147483647;

async function capacityBoundaries(target: CapacityTarget) {
  await inRolledBackTransaction(async () => {
    const eventId = await insertRow("events", eventRow());
    for (const [capacity, held, committed] of [
      [10, 4, 6],
      [0, 0, 0],
      [10, 0, 10],
      [10, 10, 0],
      [1, 1, 0],
      [INT_MAX, INT_MAX, 0],
      [INT_MAX, 0, INT_MAX],
    ] as const) {
      expect(
        await createAttempt(target, eventId, capacity, held, committed),
        `(${capacity}, ${held}, ${committed}) must be accepted`,
      ).toBeUndefined();
    }
    for (const [capacity, held, committed] of [
      [10, 5, 6],
      [10, 0, 11],
      [10, 11, 0],
      [0, 1, 0],
      [0, 0, 1],
      // held + committed exceeds the integer maximum: refused by the CHECK in bigint, not by an overflow (22003).
      [INT_MAX, INT_MAX, 1],
      [INT_MAX, 1, INT_MAX],
      [INT_MAX, INT_MAX, INT_MAX],
    ] as const) {
      expectViolation(
        await createAttempt(target, eventId, capacity, held, committed),
        "23514",
        target.constraint,
        `(${capacity}, ${held}, ${committed})`,
      );
    }
  });
  await expectNothingCommitted();
}

async function capacityUpdates(target: CapacityTarget) {
  await inRolledBackTransaction(async () => {
    const eventId = await insertRow("events", eventRow());
    const id = await target.create(eventId, 10, 4, 6);
    const full = { capacity: 10, held: 4, committed: 6 };
    expect(await counters(target, id)).toEqual(full);
    const update = (set: string) =>
      attempt(`UPDATE app.${target.table} SET ${set} WHERE ${target.key} = $1`, [id]);

    for (const [label, set] of [
      ["held +1", "held_quantity = held_quantity + 1"],
      ["committed +1", "committed_quantity = committed_quantity + 1"],
      [`${target.capacityColumn} = 9`, `${target.capacityColumn} = 9`],
    ] as const) {
      expectViolation(await update(set), "23514", target.constraint, label);
      expect(await counters(target, id), `${label}: values unchanged`).toEqual(full);
    }

    // Confirmation moves quantity from held to committed in one UPDATE: the sum is unchanged.
    expect(
      await update(
        "held_quantity = held_quantity - 1, committed_quantity = committed_quantity + 1",
      ),
    ).toBeUndefined();
    expect(await counters(target, id)).toEqual({ capacity: 10, held: 3, committed: 7 });
    // Release frees one unit (3 + 7 -> 2 + 7); two units cannot then be held again but exactly one can.
    expect(await update("held_quantity = held_quantity - 1")).toBeUndefined();
    expectViolation(
      await update("held_quantity = held_quantity + 2"),
      "23514",
      target.constraint,
      "held +2 over the remaining unit",
    );
    expect(await counters(target, id)).toEqual({ capacity: 10, held: 2, committed: 7 });
    expect(await update("held_quantity = held_quantity + 1")).toBeUndefined();
    expect(await counters(target, id)).toEqual({ capacity: 10, held: 3, committed: 7 });
  });
  await expectNothingCommitted();
}

// A full row at the integer maximum: one more unit is a capacity violation (23514), not an integer overflow.
async function capacityAtIntegerMaximum(target: CapacityTarget) {
  await inRolledBackTransaction(async () => {
    const eventId = await insertRow("events", eventRow());
    const id = await target.create(eventId, INT_MAX, INT_MAX, 0);
    const full = { capacity: INT_MAX, held: INT_MAX, committed: 0 };
    for (const set of ["committed_quantity = 1", "committed_quantity = committed_quantity + 1"]) {
      expectViolation(
        await attempt(`UPDATE app.${target.table} SET ${set} WHERE ${target.key} = $1`, [id]),
        "23514",
        target.constraint,
        set,
      );
      expect(await counters(target, id), `${set}: values unchanged`).toEqual(full);
    }
  });
  await expectNothingCommitted();
}

describe("TC-DB-005-002 held + committed <= sales_capacity on app.entry_ticket_offerings (real PostgreSQL 17)", () => {
  it("TC-DB-005-002 (capacity, held, committed): (10, 4, 6) is accepted and (10, 5, 6) is rejected with 23514 by name", () =>
    capacityBoundaries(entryCapacity));

  it("TC-DB-005-002 a full offering refuses every UPDATE that would oversell and keeps its values; moving held to committed is accepted", () =>
    capacityUpdates(entryCapacity));

  it("TC-DB-005-002 at held = sales_capacity = 2147483647 one more committed unit is refused by the capacity CHECK (23514), not by an integer overflow", () =>
    capacityAtIntegerMaximum(entryCapacity));
});

describe("TC-DB-GDS-003-001 held + committed <= saleable_capacity on app.goods_inventory (real PostgreSQL 17)", () => {
  it("TC-DB-GDS-003-001 (capacity, held, committed): (10, 4, 6) is accepted and (10, 5, 6) is rejected with 23514 by name", () =>
    capacityBoundaries(goodsCapacity));

  it("TC-DB-GDS-003-001 a full inventory row refuses every UPDATE that would oversell and keeps its values; moving held to committed is accepted", () =>
    capacityUpdates(goodsCapacity));

  it("TC-DB-GDS-003-001 at held = saleable_capacity = 2147483647 one more committed unit is refused by the capacity CHECK (23514), not by an integer overflow", () =>
    capacityAtIntegerMaximum(goodsCapacity));
});

// ---- TC-DB-005-003 ------------------------------------------------------------------------------

describe("TC-DB-005-003 event name and timezone, undecided facts, and the Karaoke standard minutes (real PostgreSQL 17)", () => {
  it("TC-DB-005-003 events.name must not be empty and business_timezone is Asia/Tokyo only, by default", async () => {
    await inRolledBackTransaction(async () => {
      await expectRejected("events", eventRow({ name: "" }), "23514", "ck_events_name", "name ''");
      await expectAccepted("events", eventRow({ name: "あ" }), "name of one character");
      await expectRejected(
        "events",
        eventRow({ name: undefined, summary: "合成の概要" }),
        "23502",
        "name",
        "name omitted",
      );

      const [statement, values] = insertStatement("events", eventRow(), "business_timezone");
      expect((await admin.query(statement, values)).rows[0].business_timezone).toBe("Asia/Tokyo");
      await expectAccepted("events", eventRow({ business_timezone: "Asia/Tokyo" }), "Asia/Tokyo");
      for (const zone of ["UTC", "asia/tokyo", "Asia/Tokyo ", "Asia/Seoul", ""]) {
        await expectRejected(
          "events",
          eventRow({ business_timezone: zone }),
          "23514",
          "ck_events_business_timezone",
          `business_timezone '${zone}'`,
        );
      }
      await expectRejected(
        "events",
        eventRow({ business_timezone: null }),
        "23502",
        "business_timezone",
        "business_timezone NULL",
      );
    });
    await expectNothingCommitted();
  });

  it("TC-DB-005-003 external facts that are not decided stay NULL and nothing is invented", async () => {
    await inRolledBackTransaction(async () => {
      const [statement, values] = insertStatement(
        "events",
        eventRow(),
        "summary, starts_at, ends_at, venue_name, venue_details, access_information, participant_notices",
      );
      expect((await admin.query(statement, values)).rows[0]).toEqual({
        summary: null,
        starts_at: null,
        ends_at: null,
        venue_name: null,
        venue_details: null,
        access_information: null,
        participant_notices: null,
      });
    });
    await expectNothingCommitted();
  });

  it("TC-DB-005-003 Karaoke standard usage is 15 minutes and maintenance is 5 minutes, by default and by CHECK", async () => {
    await inRolledBackTransaction(async () => {
      const eventId = await insertRow("events", eventRow());
      const [statement, values] = insertStatement(
        "karaoke_sales_configurations",
        karaokeRow(eventId),
        "standard_usage_minutes, standard_maintenance_minutes",
      );
      expect((await admin.query(statement, values)).rows[0]).toEqual({
        standard_usage_minutes: 15,
        standard_maintenance_minutes: 5,
      });
      await expectAccepted(
        "karaoke_sales_configurations",
        karaokeRow(eventId, { standard_usage_minutes: 15, standard_maintenance_minutes: 5 }),
        "explicit 15 / 5",
      );
      for (const minutes of [14, 16]) {
        await expectRejected(
          "karaoke_sales_configurations",
          karaokeRow(eventId, { standard_usage_minutes: minutes }),
          "23514",
          "ck_karaoke_sales_configurations_standard_usage_minutes",
          `usage ${minutes}`,
        );
      }
      for (const minutes of [4, 6]) {
        await expectRejected(
          "karaoke_sales_configurations",
          karaokeRow(eventId, { standard_maintenance_minutes: minutes }),
          "23514",
          "ck_karaoke_sales_configurations_standard_maintenance_minutes",
          `maintenance ${minutes}`,
        );
      }
      // smallint, not integer: one above the 16 bit range is a numeric overflow (22003).
      expect(
        (
          await tryInsert(
            "karaoke_sales_configurations",
            karaokeRow(eventId, { standard_usage_minutes: 32768 }),
          )
        )?.code,
      ).toBe("22003");
    });
    await expectNothingCommitted();
  });
});

// ---- TC-DB-SAL-002-001 --------------------------------------------------------------------------

describe("TC-DB-SAL-002-001 sponsor logo text length, order and publication CHECK constraints (real PostgreSQL 17)", () => {
  const longUrl = (length: number) => "https://logo.example.com/".padEnd(length, "a");

  it("TC-DB-SAL-002-001 display_name is 1 to 200 characters counted as code points", async () => {
    await inRolledBackTransaction(async () => {
      const eventId = await insertRow("events", eventRow());
      await expectRejected(
        "sponsor_logos",
        sponsorRow(eventId, { display_name: "" }),
        "23514",
        "ck_sponsor_logos_display_name",
        "display_name ''",
      );
      await expectAccepted(
        "sponsor_logos",
        sponsorRow(eventId, { display_name: "a" }),
        "1 character",
      );
      // Multibyte and astral characters count once each: 200 are accepted, 201 are refused.
      for (const unit of ["あ", "𠮷"]) {
        await expectAccepted(
          "sponsor_logos",
          sponsorRow(eventId, { display_name: unit.repeat(200) }),
          `200 x ${unit}`,
        );
        await expectRejected(
          "sponsor_logos",
          sponsorRow(eventId, { display_name: unit.repeat(201) }),
          "23514",
          "ck_sponsor_logos_display_name",
          `201 x ${unit}`,
        );
      }
      await expectRejected(
        "sponsor_logos",
        sponsorRow(eventId, { display_name: undefined }),
        "23502",
        "display_name",
        "display_name omitted",
      );
    });
    await expectNothingCommitted();
  });

  it("TC-DB-SAL-002-001 image_url is required with 1 to 2048 characters; link_url is optional with the same bound", async () => {
    await inRolledBackTransaction(async () => {
      const eventId = await insertRow("events", eventRow());
      await expectRejected(
        "sponsor_logos",
        sponsorRow(eventId, { image_url: "" }),
        "23514",
        "ck_sponsor_logos_image_url",
        "image_url ''",
      );
      await expectAccepted(
        "sponsor_logos",
        sponsorRow(eventId, { image_url: longUrl(2048) }),
        "image_url 2048",
      );
      await expectRejected(
        "sponsor_logos",
        sponsorRow(eventId, { image_url: longUrl(2049) }),
        "23514",
        "ck_sponsor_logos_image_url",
        "image_url 2049",
      );
      await expectRejected(
        "sponsor_logos",
        sponsorRow(eventId, { image_url: undefined }),
        "23502",
        "image_url",
        "image_url omitted",
      );

      await expectAccepted("sponsor_logos", sponsorRow(eventId), "link_url omitted (NULL)");
      await expectAccepted(
        "sponsor_logos",
        sponsorRow(eventId, { link_url: null }),
        "link_url NULL",
      );
      await expectAccepted(
        "sponsor_logos",
        sponsorRow(eventId, { link_url: longUrl(2048) }),
        "link_url 2048",
      );
      await expectAccepted("sponsor_logos", sponsorRow(eventId, { link_url: "h" }), "link_url 1");
      await expectRejected(
        "sponsor_logos",
        sponsorRow(eventId, { link_url: "" }),
        "23514",
        "ck_sponsor_logos_link_url",
        "link_url ''",
      );
      await expectRejected(
        "sponsor_logos",
        sponsorRow(eventId, { link_url: longUrl(2049) }),
        "23514",
        "ck_sponsor_logos_link_url",
        "link_url 2049",
      );
    });
    await expectNothingCommitted();
  });

  it("TC-DB-SAL-002-001 sort_order is >= 0 and defaults to 0; PUBLISHED requires published_at while DRAFT and ARCHIVED do not forbid it", async () => {
    await inRolledBackTransaction(async () => {
      const eventId = await insertRow("events", eventRow());
      const [statement, values] = insertStatement(
        "sponsor_logos",
        sponsorRow(eventId),
        "sort_order",
      );
      expect((await admin.query(statement, values)).rows[0].sort_order).toBe(0);
      await expectAccepted("sponsor_logos", sponsorRow(eventId, { sort_order: 0 }), "sort_order 0");
      await expectRejected(
        "sponsor_logos",
        sponsorRow(eventId, { sort_order: -1 }),
        "23514",
        "ck_sponsor_logos_sort_order",
        "sort_order -1",
      );

      await expectRejected(
        "sponsor_logos",
        sponsorRow(eventId, { state: "PUBLISHED", published_at: undefined }),
        "23514",
        "ck_sponsor_logos_published_at",
        "PUBLISHED without published_at",
      );
      await expectRejected(
        "sponsor_logos",
        sponsorRow(eventId, { state: "PUBLISHED", published_at: null }),
        "23514",
        "ck_sponsor_logos_published_at",
        "PUBLISHED with NULL published_at",
      );
      await expectAccepted(
        "sponsor_logos",
        sponsorRow(eventId, { state: "PUBLISHED", published_at: T0 }),
        "PUBLISHED with published_at",
      );
      for (const state of ["DRAFT", "ARCHIVED"]) {
        await expectAccepted(
          "sponsor_logos",
          sponsorRow(eventId, { state }),
          `${state} without published_at`,
        );
        await expectAccepted(
          "sponsor_logos",
          sponsorRow(eventId, { state, published_at: T0 }),
          `${state} with published_at`,
        );
      }
      // The same transition as an UPDATE: publishing without a time is refused and the row stays DRAFT.
      const id = await insertRow("sponsor_logos", sponsorRow(eventId));
      expectViolation(
        await attempt("UPDATE app.sponsor_logos SET state = 'PUBLISHED' WHERE id = $1", [id]),
        "23514",
        "ck_sponsor_logos_published_at",
        "publish without published_at",
      );
      expect(
        (await admin.query("SELECT state FROM app.sponsor_logos WHERE id = $1", [id])).rows[0]
          .state,
      ).toBe("DRAFT");
    });
    await expectNothingCommitted();
  });
});

// ---- TC-DB-GDS-001-001 --------------------------------------------------------------------------

describe("TC-DB-GDS-001-001 one inventory row per Goods, keyed by goods_id (real PostgreSQL 17)", () => {
  it("TC-DB-GDS-001-001 a second inventory row for a Goods is 23505 pk_goods_inventory and an absent Goods is 23503 fk_goods_inventory_goods", async () => {
    await inRolledBackTransaction(async () => {
      const eventId = await insertRow("events", eventRow());
      const goodsId = await insertRow("goods", goodsRow(eventId));
      // The DB cannot require the row: a Goods without inventory is stored (creation is another PR's duty).
      expect(await countRows("goods_inventory")).toBe(0);
      await expectAccepted("goods_inventory", inventoryRow(goodsId), "first inventory row");
      await expectRejected(
        "goods_inventory",
        inventoryRow(goodsId, { saleable_capacity: 99 }),
        "23505",
        "pk_goods_inventory",
        "second inventory row",
      );
      expect(
        (
          await admin.query(
            "SELECT count(*)::int AS count FROM app.goods_inventory WHERE goods_id = $1",
            [goodsId],
          )
        ).rows[0].count,
      ).toBe(1);
      await expectRejected(
        "goods_inventory",
        inventoryRow(ABSENT_ID),
        "23503",
        "fk_goods_inventory_goods",
        "absent goods_id",
      );
      await expectRejected(
        "goods_inventory",
        inventoryRow(goodsId, { goods_id: undefined }),
        "23502",
        "goods_id",
        "goods_id omitted",
      );
    });
    await expectNothingCommitted();
  });

  it("TC-DB-GDS-001-001 a Goods that has inventory cannot be deleted (23503) and both rows stay", async () => {
    await inRolledBackTransaction(async () => {
      const eventId = await insertRow("events", eventRow());
      const goodsId = await insertRow("goods", goodsRow(eventId));
      await admin.query(...insertStatement("goods_inventory", inventoryRow(goodsId)));
      expectViolation(
        await attempt("DELETE FROM app.goods WHERE id = $1", [goodsId]),
        "23503",
        "fk_goods_inventory_goods",
        "delete goods with inventory",
      );
      expect(await countRows("goods")).toBe(1);
      expect(await countRows("goods_inventory")).toBe(1);
    });
    await expectNothingCommitted();
  });
});

// ---- TC-DB-FK-002-001 ---------------------------------------------------------------------------

describe("TC-DB-FK-002-001 event foreign keys restrict deletes and never cascade (real PostgreSQL 17)", () => {
  it("TC-DB-FK-002-001 all eight foreign keys are ON DELETE RESTRICT and ON UPDATE NO ACTION", async () => {
    const rows = (
      await admin.query(
        `SELECT conrelid::regclass::text AS child, conname, confrelid::regclass::text AS parent, confdeltype, confupdtype
           FROM pg_constraint WHERE contype = 'f' AND conrelid = ANY($1::regclass[]) ORDER BY conname`,
        [TABLES.map((table) => `app.${table}`)],
      )
    ).rows;
    expect(rows.map((r) => [r.conname, r.child, r.parent, r.confdeltype, r.confupdtype])).toEqual(
      [
        ...EVENT_CHILD_TABLES.map((table) => [`fk_${table}_event`, `app.${table}`, "app.events"]),
        ["fk_goods_inventory_goods", "app.goods_inventory", "app.goods"],
      ]
        .sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1))
        .map(([name, child, parent]) => [name, child, parent, "r", "a"]),
    );
  });

  it("TC-DB-FK-002-001 an absent event_id is 23503 by name and an omitted event_id is 23502 on all six child tables", async () => {
    await inRolledBackTransaction(async () => {
      for (const table of EVENT_CHILD_TABLES) {
        const build = FACTORIES[table];
        await expectRejected(
          table,
          build(ABSENT_ID),
          "23503",
          `fk_${table}_event`,
          `${table} absent event`,
        );
        await expectRejected(
          table,
          build("1", { event_id: undefined }),
          "23502",
          "event_id",
          `${table} event_id omitted`,
        );
      }
    });
    await expectNothingCommitted();
  });

  it("TC-DB-FK-002-001 deleting an event that has a child row is refused with 23503 and neither the event nor the child is lost", async () => {
    await inRolledBackTransaction(async () => {
      for (const table of EVENT_CHILD_TABLES) {
        const eventId = await insertRow("events", eventRow());
        await insertRow(table, FACTORIES[table](eventId));
        expectViolation(
          await attempt("DELETE FROM app.events WHERE id = $1", [eventId]),
          "23503",
          `fk_${table}_event`,
          `delete event with ${table}`,
        );
        expect(
          (
            await admin.query("SELECT count(*)::int AS count FROM app.events WHERE id = $1", [
              eventId,
            ])
          ).rows[0].count,
          `${table}: event stays`,
        ).toBe(1);
        expect(
          (
            await admin.query(
              `SELECT count(*)::int AS count FROM app.${table} WHERE event_id = $1`,
              [eventId],
            )
          ).rows[0].count,
          `${table}: child stays`,
        ).toBe(1);
      }
    });
    await expectNothingCommitted();
  });
});

// ---- TC-SEC-DB-001-001 --------------------------------------------------------------------------

describe("TC-SEC-DB-001-001 runtime privileges on the eight tables (real PostgreSQL 17)", () => {
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

  // The approved privilege table (plan U-1, SPEC-140 §39, SPEC-180 §22.2): app_api_runtime only.
  // goods and karaoke_sales_configurations are SELECT only because no mounted Operation updates them.
  const API_GRANTS: Record<string, readonly string[]> = {
    events: ["SELECT", "UPDATE"],
    faq_items: ["SELECT", "INSERT", "UPDATE"],
    announcements: ["SELECT", "INSERT", "UPDATE"],
    sponsor_logos: ["SELECT", "INSERT", "UPDATE"],
    entry_ticket_offerings: ["SELECT", "UPDATE"],
    karaoke_sales_configurations: ["SELECT"],
    goods: ["SELECT"],
    goods_inventory: ["SELECT", "UPDATE"],
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

  it("TC-SEC-DB-001-001 has_table_privilege of the four roles equals the approved table: no DELETE or TRUNCATE anywhere, and nothing for the workers", async () => {
    expect(Object.keys(API_GRANTS).sort()).toEqual([...TABLES].sort());
    for (const table of TABLES) {
      expect(await tablePrivileges("app_api_runtime", table), `api ${table}`).toEqual(
        only(API_GRANTS[table] ?? []),
      );
      for (const role of ["app_email_runtime", "app_reconciliation_runtime", "app_runtime"]) {
        expect(await tablePrivileges(role, table), `${role} ${table}`).toEqual(only([]));
      }
    }
  });

  it("TC-SEC-DB-001-001 no column of the eight tables has an ACL of its own, and has_column_privilege of every role equals the table-level grants", async () => {
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
    const COLUMN_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "REFERENCES"] as const;
    // One round trip: every (table, column, role, privilege) combination is evaluated in SQL.
    const effective = (
      await admin.query(
        `SELECT c.relname AS table_name, a.attname AS column_name, r.role_name, p.privilege,
                has_column_privilege(r.role_name, c.oid, a.attnum, p.privilege) AS allowed
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          CROSS JOIN unnest($2::text[]) AS r(role_name)
          CROSS JOIN unnest($3::text[]) AS p(privilege)
          WHERE n.nspname = 'app' AND c.relname = ANY($1) AND a.attnum > 0 AND NOT a.attisdropped`,
        [[...TABLES], [...ROLES], [...COLUMN_PRIVILEGES]],
      )
    ).rows as {
      table_name: string;
      column_name: string;
      role_name: string;
      privilege: string;
      allowed: boolean;
    }[];
    const columnCount = GOLDEN_TABLES.reduce((total, golden) => total + golden.columns.length, 0);
    expect(effective.length, "combinations evaluated").toBe(
      columnCount * ROLES.length * COLUMN_PRIVILEGES.length,
    );
    // Each entry names the table, column, role and privilege that deviates from the table-level grants.
    const deviations = effective
      .filter((row) => {
        const granted =
          row.role_name === "app_api_runtime" ? (API_GRANTS[row.table_name] ?? []) : [];
        return row.allowed !== granted.includes(row.privilege);
      })
      .map(
        (row) =>
          `${row.role_name} ${row.table_name}.${row.column_name} ${row.privilege}=${row.allowed}`,
      );
    expect(deviations, "column privileges that differ from the table-level grants").toEqual([]);
  });

  it("TC-SEC-DB-001-001 the ACL names only the owner and app_api_runtime, never PUBLIC, and no role has a privilege on the identity sequences", async () => {
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
    for (const table of IDENTITY_TABLES) {
      for (const role of ROLES) {
        expect(
          (
            await admin.query(
              "SELECT has_sequence_privilege($1, $2, 'USAGE,SELECT,UPDATE') AS allowed",
              [role, `app.${table}_id_seq`],
            )
          ).rows[0].allowed,
          `${role} ${table}_id_seq`,
        ).toBe(false);
      }
    }
  });

  describe("actual statements", () => {
    // Committed synthetic rows that the runtime roles act on; removed again at the end (fixture cleanup).
    const seeded: { event?: string } = {};
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
      const eventId = await insertRow("events", eventRow());
      seeded.event = eventId;
      await insertRow("entry_ticket_offerings", entryRow(eventId));
      await insertRow("karaoke_sales_configurations", karaokeRow(eventId));
      const goodsId = await insertRow("goods", goodsRow(eventId));
      await admin.query(...insertStatement("goods_inventory", inventoryRow(goodsId)));
    });

    afterAll(async () => {
      // Administrator cleanup of this test's own rows, children first.
      for (const table of [
        "goods_inventory",
        "goods",
        "karaoke_sales_configurations",
        "entry_ticket_offerings",
      ]) {
        await admin.query(`DELETE FROM app.${table}`);
      }
      await admin.query("DELETE FROM app.events");
    });

    it("TC-SEC-DB-001-001 app_api_runtime can INSERT and UPDATE the content tables, and UPDATE events, offerings and inventory, inside a transaction it rolls back", async () => {
      const api = await poolOf("app_api_runtime").connect();
      try {
        await api.query("BEGIN");
        const eventId = seeded.event as string;
        for (const table of PUBLICATION_TABLES) {
          const [statement, values] = insertStatement(table, FACTORIES[table](eventId));
          // No RETURNING: the INSERT needs only the INSERT privilege.
          expect((await api.query(statement, values)).rowCount, `${table} insert`).toBe(1);
          expect(
            (await api.query(`UPDATE app.${table} SET updated_at = transaction_timestamp()`))
              .rowCount,
            `${table} update`,
          ).toBe(1);
        }
        expect(
          (await api.query("UPDATE app.events SET summary = '合成の概要'")).rowCount,
          "events update",
        ).toBe(1);
        expect(
          (
            await api.query(
              "UPDATE app.entry_ticket_offerings SET held_quantity = held_quantity + 1",
            )
          ).rowCount,
          "offering update",
        ).toBe(1);
        expect(
          (await api.query("UPDATE app.goods_inventory SET held_quantity = held_quantity + 1"))
            .rowCount,
          "inventory update",
        ).toBe(1);
        for (const table of TABLES) {
          expect((await api.query(`SELECT 1 FROM app.${table}`)).rowCount, `${table} select`).toBe(
            1,
          );
        }
      } finally {
        await api.query("ROLLBACK");
        api.release();
      }
      // The rolled back transaction left nothing of the INSERTs behind.
      await expectNothingCommitted(PUBLICATION_TABLES);
    });

    it("TC-SEC-DB-001-001 app_api_runtime is refused INSERT on the five read-mostly tables, UPDATE on goods and Karaoke, and DELETE / TRUNCATE on all eight with 42501", async () => {
      const before = await snapshot();
      const api = poolOf("app_api_runtime");
      const eventId = seeded.event as string;
      const goodsId = (await admin.query("SELECT id FROM app.goods LIMIT 1")).rows[0].id as string;
      const inserts: [string, Row][] = [
        ["events", eventRow()],
        ["entry_ticket_offerings", entryRow(eventId)],
        ["karaoke_sales_configurations", karaokeRow(eventId)],
        ["goods", goodsRow(eventId)],
        ["goods_inventory", inventoryRow(goodsId)],
      ];
      for (const [table, row] of inserts) {
        const [statement, values] = insertStatement(table, row);
        await expect(api.query(statement, values), `${table} INSERT`).rejects.toMatchObject({
          code: "42501",
        });
      }
      for (const table of ["goods", "karaoke_sales_configurations"]) {
        await expect(
          api.query(`UPDATE app.${table} SET name = '合成の変更'`),
          `${table} UPDATE`,
        ).rejects.toMatchObject({
          code: "42501",
        });
      }
      for (const table of TABLES) {
        await expect(
          api.query(`DELETE FROM app.${table} WHERE false`),
          `${table} DELETE`,
        ).rejects.toMatchObject({
          code: "42501",
        });
        await expect(api.query(`TRUNCATE app.${table}`), `${table} TRUNCATE`).rejects.toMatchObject(
          {
            code: "42501",
          },
        );
      }
      // The refusals changed nothing.
      expect(await snapshot()).toEqual(before);
    });

    it("TC-SEC-DB-001-001 app_email_runtime and app_reconciliation_runtime are refused SELECT, INSERT, UPDATE and DELETE on all eight tables with 42501", async () => {
      const before = await snapshot();
      const eventId = seeded.event as string;
      const goodsId = (await admin.query("SELECT id FROM app.goods LIMIT 1")).rows[0].id as string;
      const inserts: [string, Row][] = [
        ["events", eventRow()],
        ["faq_items", faqRow(eventId)],
        ["announcements", announcementRow(eventId)],
        ["sponsor_logos", sponsorRow(eventId)],
        ["entry_ticket_offerings", entryRow(eventId)],
        ["karaoke_sales_configurations", karaokeRow(eventId)],
        ["goods", goodsRow(eventId)],
        ["goods_inventory", inventoryRow(goodsId)],
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
