import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// PR-L2-2 C1: pins the Drizzle declaration of the eight public content / sales tables (SPEC-100
// §13.1-13.4, §15.1-15.3, §38) against the reviewed schema-contract.json and against goldens written by
// hand from those sections and the PostgreSQL 17 notation. Static only: no database. DB enforcement of
// the same tables is TC-DB-ARC-007-004 / TC-DB-STA-002-001 ... on real PostgreSQL 17 (TST-UNT-001,
// TST-GEN-004). The serialisation approach mirrors db-audit-events-schema.test.ts; helpers are
// intentionally copied, not shared. The schema module is read through a string-keyed record so that
// this file type-checks before the tables exist (C1 is committed as a failing test).

const dbPackageJson = new URL("../../packages/db/package.json", import.meta.url);
const contractUrl = new URL("../../packages/db/src/schema-contract.json", import.meta.url);
const dbRequire = createRequire(dbPackageJson);

interface DrizzleColumn {
  name: string;
  notNull: boolean;
  hasDefault: boolean;
  default?: unknown;
  columnType: string;
  generatedIdentity?: { type: string };
  getSQLType(): string;
}
interface DrizzleForeignKey {
  getName(): string;
  onDelete?: string;
  onUpdate?: string;
  reference(): {
    columns: DrizzleColumn[];
    foreignColumns: DrizzleColumn[];
    foreignTable: unknown;
  };
}
interface DrizzleNamedColumns {
  name?: string;
  getName?: () => string;
  columns: DrizzleColumn[];
}
interface DrizzleIndexColumn {
  name: string;
  indexConfig?: { order?: string; nulls?: string };
}
interface DrizzleIndex {
  config: {
    name: string;
    unique: boolean;
    method: string;
    columns: DrizzleIndexColumn[];
    where?: unknown;
  };
}
interface DrizzleTableConfig {
  name: string;
  schema?: string;
  columns: DrizzleColumn[];
  indexes: DrizzleIndex[];
  foreignKeys: DrizzleForeignKey[];
  checks: { name: string; value: unknown }[];
  primaryKeys: DrizzleNamedColumns[];
  uniqueConstraints: DrizzleNamedColumns[];
}
const { getTableConfig, PgDialect } = dbRequire("drizzle-orm/pg-core") as {
  getTableConfig(table: unknown): DrizzleTableConfig;
  PgDialect: new () => { sqlToQuery(query: unknown): { sql: string; params: unknown[] } };
};

type ContractColumn = [
  table: string,
  name: string,
  type: string,
  notNull: boolean,
  identity: string,
  generated: string,
  defaultExpr: string | null,
];
type ContractIndex = [table: string, definition: string, ...flags: boolean[]];
type ContractConstraint = [
  table: string,
  name: string,
  kind: string,
  definition: string,
  ...flags: boolean[],
];
interface SchemaContract {
  tables: [string, ...unknown[]][];
  columns: ContractColumn[];
  indexes: ContractIndex[];
  constraints: ContractConstraint[];
  sequences: [string, ...unknown[]][];
}
const contract = JSON.parse(readFileSync(contractUrl, "utf8")) as SchemaContract;

const loadSchema = async () =>
  (await import("@off-r39x/db/schema")) as unknown as Record<string, unknown>;

// ---- goldens (SPEC-100 §13.1-13.4, §15.1-15.3, §38, §9, §10, §8.3; PostgreSQL 17 notation) ---------

const TSTZ = "timestamp with time zone";
const NOW_DEFAULT = "transaction_timestamp()";

// [name, SQL type in PostgreSQL notation, NOT NULL, identity, default expression] in column order.
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

interface GoldenConstraint {
  name: string;
  kind: "p" | "u" | "f" | "c";
  /** pg_get_constraintdef */
  definition: string;
  /** Raw SQL as declared in Drizzle, compared exactly (no space after the comma in IN lists). */
  declared?: string;
}
interface GoldenIndex {
  name: string;
  /** pg_get_indexdef */
  definition: string;
  /** Drizzle-declared (non primary key / unique) indexes: [column, order]. */
  declared?: [string, string][];
}
interface GoldenTable {
  exportName: string;
  table: string;
  identity: boolean;
  columns: GoldenColumn[];
  constraints: GoldenConstraint[];
  indexes: GoldenIndex[];
  /** The one foreign key of the table, absent for events. */
  foreign?: { name: string; column: string; table: "events" | "goods" };
}

const pk = (table: string, column = "id"): GoldenConstraint => ({
  name: `pk_${table}`,
  kind: "p",
  definition: `PRIMARY KEY (${column})`,
});
const uniqueRef = (table: string): GoldenConstraint => ({
  name: `uq_${table}_public_ref`,
  kind: "u",
  definition: "UNIQUE (public_ref)",
});
const eventFk = (table: string): GoldenConstraint => ({
  name: `fk_${table}_event`,
  kind: "f",
  definition: "FOREIGN KEY (event_id) REFERENCES app.events(id) ON DELETE RESTRICT",
});
const check = (name: string, definition: string, declared: string): GoldenConstraint => ({
  name,
  kind: "c",
  definition,
  declared,
});
const pkIndex = (table: string, column = "id"): GoldenIndex => ({
  name: `pk_${table}`,
  definition: `CREATE UNIQUE INDEX pk_${table} ON app.${table} USING btree (${column})`,
});
const refIndex = (table: string): GoldenIndex => ({
  name: `uq_${table}_public_ref`,
  definition: `CREATE UNIQUE INDEX uq_${table}_public_ref ON app.${table} USING btree (public_ref)`,
});

const PUBLICATION_DEFINITION =
  "CHECK ((state = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text, 'ARCHIVED'::text])))";
const PUBLICATION_DECLARED = "state IN ('DRAFT','PUBLISHED','ARCHIVED')";

// The five CHECKs every sales configuration table carries (SPEC-100 §9, §15).
function salesChecks(table: string): GoldenConstraint[] {
  return [
    check(`ck_${table}_unit_amount`, "CHECK ((unit_amount >= 0))", "unit_amount >= 0"),
    check(
      `ck_${table}_currency`,
      "CHECK (((currency = upper(currency)) AND (currency ~ '^[A-Z]{3}$'::text)))",
      "currency = upper(currency) AND currency ~ '^[A-Z]{3}$'",
    ),
    check(
      `ck_${table}_sale_control_state`,
      "CHECK ((sale_control_state = ANY (ARRAY['ENABLED'::text, 'SUSPENDED'::text])))",
      "sale_control_state IN ('ENABLED','SUSPENDED')",
    ),
    check(`ck_${table}_purchase_limit`, "CHECK ((purchase_limit > 0))", "purchase_limit > 0"),
    check(
      `ck_${table}_sales_period`,
      "CHECK ((sales_starts_at < sales_ends_at))",
      "sales_starts_at < sales_ends_at",
    ),
  ];
}

const GOLDEN_TABLES: GoldenTable[] = [
  {
    exportName: "events",
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
      check("ck_events_name", "CHECK ((char_length(name) > 0))", "char_length(name) > 0"),
      check("ck_events_period", "CHECK ((starts_at < ends_at))", "starts_at < ends_at"),
      check(
        "ck_events_business_timezone",
        "CHECK ((business_timezone = 'Asia/Tokyo'::text))",
        "business_timezone = 'Asia/Tokyo'",
      ),
    ],
    indexes: [pkIndex("events"), refIndex("events")],
  },
  {
    exportName: "faqItems",
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
      check("ck_faq_items_state", PUBLICATION_DEFINITION, PUBLICATION_DECLARED),
    ],
    indexes: [
      pkIndex("faq_items"),
      refIndex("faq_items"),
      {
        name: "ix_faq_items_event_state_sort",
        definition:
          "CREATE INDEX ix_faq_items_event_state_sort ON app.faq_items USING btree (event_id, state, sort_order)",
        declared: [
          ["event_id", "asc"],
          ["state", "asc"],
          ["sort_order", "asc"],
        ],
      },
    ],
    foreign: { name: "fk_faq_items_event", column: "event_id", table: "events" },
  },
  {
    exportName: "announcements",
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
      check("ck_announcements_state", PUBLICATION_DEFINITION, PUBLICATION_DECLARED),
    ],
    indexes: [
      pkIndex("announcements"),
      refIndex("announcements"),
      {
        name: "ix_announcements_event_state_published",
        definition:
          "CREATE INDEX ix_announcements_event_state_published ON app.announcements USING btree (event_id, state, published_at DESC)",
        declared: [
          ["event_id", "asc"],
          ["state", "asc"],
          ["published_at", "desc"],
        ],
      },
    ],
    foreign: { name: "fk_announcements_event", column: "event_id", table: "events" },
  },
  {
    exportName: "sponsorLogos",
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
      check("ck_sponsor_logos_state", PUBLICATION_DEFINITION, PUBLICATION_DECLARED),
      check(
        "ck_sponsor_logos_display_name",
        "CHECK (((char_length(display_name) >= 1) AND (char_length(display_name) <= 200)))",
        "char_length(display_name) BETWEEN 1 AND 200",
      ),
      check(
        "ck_sponsor_logos_image_url",
        "CHECK (((char_length(image_url) >= 1) AND (char_length(image_url) <= 2048)))",
        "char_length(image_url) BETWEEN 1 AND 2048",
      ),
      check(
        "ck_sponsor_logos_link_url",
        "CHECK (((link_url IS NULL) OR ((char_length(link_url) >= 1) AND (char_length(link_url) <= 2048))))",
        "link_url IS NULL OR char_length(link_url) BETWEEN 1 AND 2048",
      ),
      check("ck_sponsor_logos_sort_order", "CHECK ((sort_order >= 0))", "sort_order >= 0"),
      check(
        "ck_sponsor_logos_published_at",
        "CHECK (((state <> 'PUBLISHED'::text) OR (published_at IS NOT NULL)))",
        "state <> 'PUBLISHED' OR published_at IS NOT NULL",
      ),
    ],
    indexes: [
      pkIndex("sponsor_logos"),
      refIndex("sponsor_logos"),
      {
        name: "ix_sponsor_logos_event_state_sort",
        definition:
          "CREATE INDEX ix_sponsor_logos_event_state_sort ON app.sponsor_logos USING btree (event_id, state, sort_order, public_ref)",
        declared: [
          ["event_id", "asc"],
          ["state", "asc"],
          ["sort_order", "asc"],
          ["public_ref", "asc"],
        ],
      },
    ],
    foreign: { name: "fk_sponsor_logos_event", column: "event_id", table: "events" },
  },
  {
    exportName: "entryTicketOfferings",
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
      check(
        "ck_entry_ticket_offerings_sales_capacity",
        "CHECK ((sales_capacity >= 0))",
        "sales_capacity >= 0",
      ),
      check(
        "ck_entry_ticket_offerings_held_quantity",
        "CHECK ((held_quantity >= 0))",
        "held_quantity >= 0",
      ),
      check(
        "ck_entry_ticket_offerings_committed_quantity",
        "CHECK ((committed_quantity >= 0))",
        "committed_quantity >= 0",
      ),
      check(
        "ck_entry_ticket_offerings_capacity",
        "CHECK ((((held_quantity)::bigint + committed_quantity) <= sales_capacity))",
        "held_quantity::bigint + committed_quantity <= sales_capacity",
      ),
      check(
        "ck_entry_ticket_offerings_checkin_window",
        "CHECK ((checkin_opens_at < checkin_closes_at))",
        "checkin_opens_at < checkin_closes_at",
      ),
    ],
    indexes: [pkIndex("entry_ticket_offerings"), refIndex("entry_ticket_offerings")],
    foreign: { name: "fk_entry_ticket_offerings_event", column: "event_id", table: "events" },
  },
  {
    exportName: "karaokeSalesConfigurations",
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
      check(
        "ck_karaoke_sales_configurations_standard_usage_minutes",
        "CHECK ((standard_usage_minutes = 15))",
        "standard_usage_minutes = 15",
      ),
      check(
        "ck_karaoke_sales_configurations_standard_maintenance_minutes",
        "CHECK ((standard_maintenance_minutes = 5))",
        "standard_maintenance_minutes = 5",
      ),
    ],
    indexes: [pkIndex("karaoke_sales_configurations"), refIndex("karaoke_sales_configurations")],
    foreign: { name: "fk_karaoke_sales_configurations_event", column: "event_id", table: "events" },
  },
  {
    exportName: "goods",
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
    foreign: { name: "fk_goods_event", column: "event_id", table: "events" },
  },
  {
    exportName: "goodsInventory",
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
      {
        name: "fk_goods_inventory_goods",
        kind: "f",
        definition: "FOREIGN KEY (goods_id) REFERENCES app.goods(id) ON DELETE RESTRICT",
      },
      check(
        "ck_goods_inventory_saleable_capacity",
        "CHECK ((saleable_capacity >= 0))",
        "saleable_capacity >= 0",
      ),
      check(
        "ck_goods_inventory_held_quantity",
        "CHECK ((held_quantity >= 0))",
        "held_quantity >= 0",
      ),
      check(
        "ck_goods_inventory_committed_quantity",
        "CHECK ((committed_quantity >= 0))",
        "committed_quantity >= 0",
      ),
      check(
        "ck_goods_inventory_capacity",
        "CHECK ((((held_quantity)::bigint + committed_quantity) <= saleable_capacity))",
        "held_quantity::bigint + committed_quantity <= saleable_capacity",
      ),
    ],
    indexes: [pkIndex("goods_inventory", "goods_id")],
    foreign: { name: "fk_goods_inventory_goods", column: "goods_id", table: "goods" },
  },
];

// SPEC-100 §13.1-13.4 / §15 / §38 table sizes, written by hand: 13+10+9+11+18+14+13+5 columns,
// 5+4+4+9+13+10+8+6 constraints and 2+3+3+3+2+2+2+1 indexes.
const SPEC_COLUMN_COUNTS = [13, 10, 9, 11, 18, 14, 13, 5];
const SPEC_CONSTRAINT_COUNTS = [5, 4, 4, 9, 13, 10, 8, 6];
const SPEC_INDEX_COUNTS = [2, 3, 3, 3, 2, 2, 2, 1];
const SPEC_SEQUENCES = [
  "announcements_id_seq",
  "entry_ticket_offerings_id_seq",
  "events_id_seq",
  "faq_items_id_seq",
  "goods_id_seq",
  "karaoke_sales_configurations_id_seq",
  "sponsor_logos_id_seq",
];

// ---- expression helpers (same method as db-audit-events-schema.test.ts) --------------------------

const dialect = new PgDialect();

function serialize(expression: unknown, what: string): string {
  expect(expression, `${what} is declared`).toBeDefined();
  const query = dialect.sqlToQuery(expression);
  expect(query.params, `${what} must not carry bind parameters`).toEqual([]);
  return query.sql;
}

function stripSchemaQualifiers(sqlText: string, table: string, what: string): string {
  const bare = sqlText.replace(new RegExp(`"app"\\."${table}"\\."([a-z_]+)"`, "g"), "$1");
  expect(bare, `${what} has an unrecognised quoted identifier`).not.toContain('"');
  return bare;
}

const literalsInOrder = (expression: string) =>
  [...expression.matchAll(/'([^']*)'/g)].map((match) => match[1] as string);

interface ExpressionTokens {
  columns: string[];
  literals: string[];
  numbers: string[];
  isNull: number;
  isNotNull: number;
}
function tokens(expression: string, columnNames: string[]): ExpressionTokens {
  const literals = literalsInOrder(expression).sort();
  const rest = expression.replace(/'[^']*'/g, " ");
  return {
    columns: columnNames.filter((name) => new RegExp(`\\b${name}\\b`).test(rest)).sort(),
    literals,
    numbers: [...rest.matchAll(/\b\d+\b/g)].map((m) => m[0]).sort(),
    isNull: [...rest.matchAll(/\bIS NULL\b/g)].length,
    isNotNull: [...rest.matchAll(/\bIS NOT NULL\b/g)].length,
  };
}

function contractCheckExpression(definition: string): string {
  const match = /^CHECK \((.*)\)$/.exec(definition);
  if (!match) throw new Error("Unexpected CHECK definition shape in schema-contract.json");
  return (match[1] as string).replaceAll("::text", "");
}

function constraintName(entry: DrizzleNamedColumns): string {
  const name = entry.getName ? entry.getName() : entry.name;
  if (!name) throw new Error("Unnamed constraint in Drizzle declaration (DB-ARC-007)");
  return name;
}

// PostgreSQL's `name` columns sort by byte order (C collation), which equals the UTF-16 order for ASCII.
const byName = <T extends { name: string }>(a: T, b: T) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

// A Drizzle default is either a plain JS literal or SQL. Both are reduced to PostgreSQL's text without casts.
function defaultText(value: unknown, what: string): string {
  if (typeof value === "string") return `'${value}'`;
  if (typeof value === "number") return String(value);
  return serialize(value, what).replaceAll("::text", "");
}

const contractRows = (table: string) => ({
  columns: contract.columns.filter(([name]) => name === table),
  constraints: contract.constraints.filter(([name]) => name === table),
  indexes: contract.indexes.filter(([name]) => name === table),
});

// ---- tests -------------------------------------------------------------------------------------

describe("TC-DB-ARC-007-003 the contract describes the eight public content / sales tables", () => {
  it("TC-DB-ARC-007-003 the hand-written goldens have the SPEC-100 table sizes and 93 / 59 / 18 / 7 in total", () => {
    expect(GOLDEN_TABLES.map((g) => g.columns.length)).toEqual(SPEC_COLUMN_COUNTS);
    expect(GOLDEN_TABLES.map((g) => g.constraints.length)).toEqual(SPEC_CONSTRAINT_COUNTS);
    expect(GOLDEN_TABLES.map((g) => g.indexes.length)).toEqual(SPEC_INDEX_COUNTS);
    expect(SPEC_COLUMN_COUNTS.reduce((a, b) => a + b, 0)).toBe(93);
    expect(SPEC_CONSTRAINT_COUNTS.reduce((a, b) => a + b, 0)).toBe(59);
    expect(SPEC_INDEX_COUNTS.reduce((a, b) => a + b, 0)).toBe(18);
    expect(SPEC_SEQUENCES).toHaveLength(7);
  });

  it("TC-DB-ARC-007-003 the contract lists the eight tables (owner app_migrator, no row security) and seven identity sequences", () => {
    for (const golden of GOLDEN_TABLES) {
      expect(
        contract.tables.find(([name]) => name === golden.table),
        `contract table ${golden.table}`,
      ).toEqual([golden.table, "r", "app_migrator", false]);
    }
    expect(
      contract.sequences
        .filter(([name]) => SPEC_SEQUENCES.includes(name))
        .map(([name, type, owner]) => [name, type, owner]),
    ).toEqual(SPEC_SEQUENCES.map((name) => [name, "bigint", "app_migrator"]));
    // goods_inventory is keyed by goods_id and has no identity column, hence no sequence.
    expect(contract.sequences.map(([name]) => name)).not.toContain("goods_inventory_id_seq");
  });

  for (const golden of GOLDEN_TABLES) {
    it(`TC-DB-ARC-007-003 contract rows of ${golden.table} equal the golden columns, constraints and indexes`, () => {
      const rows = contractRows(golden.table);
      expect(
        rows.columns.map(([, name, type, notNull, identity, generated, defaultExpr]) => [
          name,
          type,
          notNull,
          identity,
          generated,
          defaultExpr,
        ]),
      ).toEqual(
        golden.columns.map(([name, type, notNull, identity, d]) => [
          name,
          type,
          notNull,
          identity,
          "",
          d,
        ]),
      );
      expect(
        rows.constraints.map(([, name, kind, definition]) => [name, kind, definition]),
      ).toEqual(
        [...golden.constraints]
          .sort(byName)
          .map((entry) => [entry.name, entry.kind, entry.definition]),
      );
      for (const [, , , , ...flags] of rows.constraints)
        expect(flags).toEqual([true, false, false]);
      expect(rows.indexes.map(([, definition]) => definition)).toEqual(
        [...golden.indexes].sort(byName).map((entry) => entry.definition),
      );
      for (const [, , ...flags] of rows.indexes) expect(flags).toEqual([true, true, true]);
    });
  }
});

for (const golden of GOLDEN_TABLES) {
  const { table } = golden;
  const load = async () => {
    const schemaModule = await loadSchema();
    const declared = schemaModule[golden.exportName];
    expect(declared, `@off-r39x/db/schema exports ${golden.exportName}`).toBeDefined();
    return { schemaModule, config: getTableConfig(declared) };
  };

  describe(`TC-DB-ARC-007-003 Drizzle declaration of app.${table} matches the contract and the SPEC-100 goldens`, () => {
    it(`TC-DB-ARC-007-003 ${table}: table name and schema name`, async () => {
      const { config } = await load();
      expect(config.name).toBe(table);
      expect(config.schema).toBe("app");
    });

    it(`TC-DB-ARC-007-003 ${table}: columns in order with the golden SQL type and NOT NULL, equal to the contract`, async () => {
      const { config } = await load();
      const actual = config.columns.map((column) => [
        column.name,
        column.getSQLType(),
        column.notNull,
      ]);
      expect(actual).toEqual(golden.columns.map(([name, type, notNull]) => [name, type, notNull]));
      expect(actual).toEqual(
        contractRows(table).columns.map(([, name, type, notNull]) => [name, type, notNull]),
      );
    });

    it(`TC-DB-ARC-007-003 ${table}: identity always on id only (none on goods_inventory)`, async () => {
      const { config } = await load();
      expect(
        config.columns.filter((column) => column.generatedIdentity).map((column) => column.name),
      ).toEqual(golden.identity ? ["id"] : []);
      for (const column of config.columns.filter((c) => c.generatedIdentity)) {
        expect(column.generatedIdentity?.type, `identity of ${column.name}`).toBe("always");
      }
    });

    it(`TC-DB-ARC-007-003 ${table}: defaults are exactly the golden ones and equal the contract`, async () => {
      const { config } = await load();
      const expected = golden.columns.filter(
        ([, , , identity, d]) => identity === "" && d !== null,
      );
      expect(
        config.columns
          .filter((column) => !column.generatedIdentity && column.hasDefault)
          .map((column) => column.name),
      ).toEqual(expected.map(([name]) => name));
      for (const [name, , , , defaultExpr] of expected) {
        const column = config.columns.find((c) => c.name === name);
        const actual = defaultText(column?.default, `default of ${name}`);
        // transaction_timestamp() must not become clock_timestamp() or now(); 0 / 15 / 5 / 'DRAFT' stay literal.
        expect(actual, `default of ${name}`).toBe((defaultExpr as string).replaceAll("::text", ""));
      }
      for (const [, name, , , identity, , contractDefault] of contractRows(table).columns) {
        if (identity !== "") continue;
        expect(contractDefault, `contract default of ${name}`).toBe(
          golden.columns.find(([columnName]) => columnName === name)?.[4],
        );
      }
    });

    it(`TC-DB-ARC-007-003 ${table}: every bigint column is a lossless bigint (PgBigInt64) and nothing else is (DEV-DB-006)`, async () => {
      const { config } = await load();
      for (const [name, type] of golden.columns) {
        const column = config.columns.find((c) => c.name === name);
        if (type === "bigint")
          expect(column?.columnType, `columnType of ${name}`).toBe("PgBigInt64");
        else expect(column?.columnType, `columnType of ${name}`).not.toMatch(/^PgBigInt/);
      }
    });

    it(`TC-DB-ARC-007-003 ${table}: constraint names and kinds equal the golden and the contract`, async () => {
      const { config } = await load();
      const declared = new Map<string, string>();
      const add = (name: string, kind: string) => {
        expect(declared.has(name), `duplicate constraint name ${name}`).toBe(false);
        declared.set(name, kind);
      };
      for (const entry of config.primaryKeys) add(constraintName(entry), "p");
      for (const entry of config.uniqueConstraints) add(constraintName(entry), "u");
      for (const entry of config.foreignKeys) add(entry.getName(), "f");
      for (const entry of config.checks) add(entry.name, "c");
      expect(declared.size).toBe(golden.constraints.length);
      expect([...declared.entries()].sort()).toEqual(
        golden.constraints.map((entry) => [entry.name, entry.kind] as [string, string]).sort(),
      );
      expect([...declared.entries()].sort()).toEqual(
        contractRows(table)
          .constraints.map(([, name, kind]) => [name, kind] as [string, string])
          .sort(),
      );
    });

    it(`TC-DB-ARC-007-003 ${table}: primary key and unique constraint column lists equal the golden definitions`, async () => {
      const { config } = await load();
      const definitions = new Map(golden.constraints.map((c) => [c.name, c.definition]));
      expect(config.primaryKeys).toHaveLength(1);
      for (const entry of config.primaryKeys) {
        expect(definitions.get(constraintName(entry))).toBe(
          `PRIMARY KEY (${entry.columns.map((c) => c.name).join(", ")})`,
        );
      }
      expect(config.uniqueConstraints).toHaveLength(golden.identity ? 1 : 0);
      for (const entry of config.uniqueConstraints) {
        expect(definitions.get(constraintName(entry))).toBe(
          `UNIQUE (${entry.columns.map((c) => c.name).join(", ")})`,
        );
      }
    });

    it(`TC-DB-ARC-007-003 ${table}: CHECK expressions equal the golden exactly and match the contract by column, literals and numbers`, async () => {
      const { config } = await load();
      const columnNames = config.columns.map((c) => c.name);
      const actual: Record<string, string> = {};
      for (const entry of config.checks) {
        actual[entry.name] = stripSchemaQualifiers(
          serialize(entry.value, `CHECK ${entry.name}`),
          table,
          `CHECK ${entry.name}`,
        );
      }
      const goldenChecks = Object.fromEntries(
        golden.constraints.filter((c) => c.kind === "c").map((c) => [c.name, c.declared as string]),
      );
      // (1) exact expression text of every CHECK, so a changed bound, literal or connective fails.
      expect(actual).toEqual(goldenChecks);
      // (2) the contract's normalised definition has the same columns, literals, numbers and NULL tests.
      for (const [, name, kind, definition] of contractRows(table).constraints) {
        if (kind !== "c") continue;
        const expression = contractCheckExpression(definition);
        expect(tokens(actual[name] as string, columnNames), `tokens of ${name}`).toEqual(
          tokens(expression, columnNames),
        );
        expect(
          tokens(expression, columnNames).columns.length,
          `columns of ${name}`,
        ).toBeGreaterThan(0);
      }
    });

    it(`TC-DB-ARC-007-003 ${table}: foreign keys reference the golden parent with ON DELETE RESTRICT`, async () => {
      const { schemaModule, config } = await load();
      const { foreign } = golden;
      if (foreign === undefined) {
        expect(config.foreignKeys).toHaveLength(0);
        return;
      }
      expect(config.foreignKeys).toHaveLength(1);
      const [fk] = config.foreignKeys;
      const reference = fk?.reference();
      expect(fk?.getName()).toBe(foreign.name);
      expect(reference?.columns.map((c) => c.name)).toEqual([foreign.column]);
      expect(reference?.foreignColumns.map((c) => c.name)).toEqual(["id"]);
      expect(reference?.foreignTable).toBe(schemaModule[foreign.table]);
      expect(fk?.onDelete).toBe("restrict");
      // An omitted ON UPDATE is PostgreSQL's NO ACTION, which pg_get_constraintdef leaves out of the contract.
      expect(fk?.onUpdate ?? "no action", `${foreign.name} ON UPDATE`).toBe("no action");
      // The same relation as the contract's pg_get_constraintdef (DB-FK-002: never CASCADE).
      const definition = contractRows(table).constraints.find(
        ([, name]) => name === foreign.name,
      )?.[3];
      expect(definition).toBe(
        `FOREIGN KEY (${foreign.column}) REFERENCES app.${foreign.table}(id) ON DELETE RESTRICT`,
      );
    });

    it(`TC-DB-ARC-007-003 ${table}: declared indexes carry the golden columns and order and equal the contract's pg_get_indexdef`, async () => {
      const { config } = await load();
      const goldenDeclared = golden.indexes.filter((entry) => entry.declared !== undefined);
      expect(config.indexes).toHaveLength(goldenDeclared.length);
      for (const entry of goldenDeclared) {
        const index = config.indexes.find((i) => i.config.name === entry.name);
        expect(index, entry.name).toBeDefined();
        expect(index?.config.unique, `${entry.name} uniqueness`).toBe(false);
        expect(index?.config.method, `${entry.name} method`).toBe("btree");
        expect(index?.config.where, `${entry.name} has no predicate`).toBeUndefined();
        expect(
          index?.config.columns.map((c) => [c.name, c.indexConfig?.order ?? "asc"]),
          `${entry.name} columns`,
        ).toEqual(entry.declared);
        // Rendered the PostgreSQL way, the declaration is the contract's definition.
        // NULLS FIRST / LAST is shown only where it differs from the default (ASC: NULLS LAST, DESC: NULLS FIRST).
        const columns = (index?.config.columns ?? [])
          .map((c) => {
            const desc = c.indexConfig?.order === "desc";
            const nulls = c.indexConfig?.nulls;
            const nullsText =
              desc && nulls === "last"
                ? " NULLS LAST"
                : !desc && nulls === "first"
                  ? " NULLS FIRST"
                  : "";
            return `${c.name}${desc ? " DESC" : ""}${nullsText}`;
          })
          .join(", ");
        const contractDefinition = contractRows(table).indexes.find(([, d]) =>
          d.startsWith(`CREATE INDEX ${entry.name} `),
        )?.[1];
        expect(contractDefinition).toBe(
          `CREATE INDEX ${entry.name} ON app.${table} USING btree (${columns})`,
        );
        expect(contractDefinition).toBe(entry.definition);
      }
    });
  });
}

describe("TC-DB-ARC-007-003 the schema barrel exposes the eight tables by name", () => {
  it("TC-DB-ARC-007-003 each golden export is a table in the app schema and no two exports are the same table", async () => {
    const schemaModule = await loadSchema();
    const names = new Set<string>();
    for (const golden of GOLDEN_TABLES) {
      const declared = schemaModule[golden.exportName];
      expect(declared, `@off-r39x/db/schema exports ${golden.exportName}`).toBeDefined();
      const config = getTableConfig(declared);
      expect(config.schema, golden.exportName).toBe("app");
      names.add(config.name);
    }
    expect([...names].sort()).toEqual(GOLDEN_TABLES.map((g) => g.table).sort());
  });
});
