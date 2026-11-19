import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// PR-GK-1 C1: pins the Drizzle declaration of the two Karaoke tables of migration 0004
// (app.karaoke_exclusive_scopes and app.karaoke_slots; SPEC-100 §27, §28, §28.1, §45.4) against the
// reviewed schema-contract.json and against goldens written by hand from those sections and the
// PostgreSQL 17 notation. Static only: no database. DB enforcement of the same tables is
// TC-DB-ARC-007-006 / TC-INV-010-04-001 ... on real PostgreSQL 17 (TST-UNT-001, TST-GEN-004).
// The exclusion constraint ex_karaoke_slots_scope_occupancy is SQL-only (SPEC-100 §57, DB-MIG-002): it
// must be in the contract and must not be declared a second time in Drizzle. The serialisation approach
// mirrors db-public-content-sales-schema.test.ts; helpers are intentionally copied, not shared. The schema
// module is read through a string-keyed record so that this file type-checks before the tables exist
// (C1 is committed as a failing test). All data is synthetic.

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

// ---- goldens (SPEC-100 §27, §28, §28.1, §45.4, §9, §10, §8.3; PostgreSQL 17 notation) -------------

const TSTZ = "timestamp with time zone";
const NOW_DEFAULT = "transaction_timestamp()";
const EXCLUSION_NAME = "ex_karaoke_slots_scope_occupancy";

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
const createdAtColumn: GoldenColumn = ["created_at", TSTZ, true, "", NOW_DEFAULT];
const updatedAtColumn: GoldenColumn = ["updated_at", TSTZ, true, "", NOW_DEFAULT];
const tstz = (name: string): GoldenColumn => [name, TSTZ, true, "", null];
const bigintCol = (name: string): GoldenColumn => [name, "bigint", true, "", null];

interface GoldenConstraint {
  name: string;
  /** x (EXCLUDE) exists only in the contract and in SQL. */
  kind: "p" | "u" | "f" | "c" | "x";
  /** pg_get_constraintdef */
  definition: string;
  /** Raw SQL as declared in Drizzle, compared exactly (no space after the comma in IN lists). */
  declared?: string;
}
interface GoldenIndex {
  name: string;
  /** pg_get_indexdef */
  definition: string;
  /** Drizzle-declared (non primary key / unique / exclusion) indexes: [column, order]. */
  declared?: [string, string][];
}
interface GoldenTable {
  exportName: string;
  table: string;
  columns: GoldenColumn[];
  constraints: GoldenConstraint[];
  indexes: GoldenIndex[];
  /** [constraint name, column, referenced export name, referenced table] */
  foreign: [name: string, column: string, exportName: string, table: string][];
  /** UNIQUE column lists by constraint name (public_ref included). */
  uniques: Record<string, string[]>;
}

const pk = (table: string): GoldenConstraint => ({
  name: `pk_${table}`,
  kind: "p",
  definition: "PRIMARY KEY (id)",
});
const uniqueConstraint = (name: string, columns: string[]): GoldenConstraint => ({
  name,
  kind: "u",
  definition: `UNIQUE (${columns.join(", ")})`,
});
const fk = (name: string, column: string, parent: string): GoldenConstraint => ({
  name,
  kind: "f",
  definition: `FOREIGN KEY (${column}) REFERENCES app.${parent}(id) ON DELETE RESTRICT`,
});
const check = (name: string, definition: string, declared: string): GoldenConstraint => ({
  name,
  kind: "c",
  definition,
  declared,
});
const pkIndex = (table: string): GoldenIndex => ({
  name: `pk_${table}`,
  definition: `CREATE UNIQUE INDEX pk_${table} ON app.${table} USING btree (id)`,
});
const uniqueIndex = (table: string, name: string, columns: string[]): GoldenIndex => ({
  name,
  definition: `CREATE UNIQUE INDEX ${name} ON app.${table} USING btree (${columns.join(", ")})`,
});

const SCOPE = "karaoke_exclusive_scopes";
const SLOT = "karaoke_slots";

const GOLDEN_TABLES: GoldenTable[] = [
  {
    exportName: "karaokeExclusiveScopes",
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
      pk(SCOPE),
      uniqueConstraint(`uq_${SCOPE}_public_ref`, ["public_ref"]),
      fk(`fk_${SCOPE}_event`, "event_id", "events"),
    ],
    indexes: [pkIndex(SCOPE), uniqueIndex(SCOPE, `uq_${SCOPE}_public_ref`, ["public_ref"])],
    foreign: [[`fk_${SCOPE}_event`, "event_id", "events", "events"]],
    uniques: { [`uq_${SCOPE}_public_ref`]: ["public_ref"] },
  },
  {
    exportName: "karaokeSlots",
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
      pk(SLOT),
      uniqueConstraint(`uq_${SLOT}_public_ref`, ["public_ref"]),
      uniqueConstraint(`uq_${SLOT}_scope_times`, [
        "exclusive_scope_id",
        "usage_start",
        "usage_end",
        "cycle_end",
      ]),
      uniqueConstraint(`uq_${SLOT}_generation_candidate`, [
        "generation_cause_key",
        "exclusive_scope_id",
        "generation_candidate_no",
      ]),
      fk(`fk_${SLOT}_exclusive_scope`, "exclusive_scope_id", SCOPE),
      fk(
        `fk_${SLOT}_sales_configuration`,
        "sales_configuration_id",
        "karaoke_sales_configurations",
      ),
      check(
        `ck_${SLOT}_state`,
        "CHECK ((state = ANY (ARRAY['AVAILABLE'::text, 'HELD'::text, 'SOLD'::text, 'SALES_STOPPED'::text])))",
        "state IN ('AVAILABLE','HELD','SOLD','SALES_STOPPED')",
      ),
      check(
        `ck_${SLOT}_usage_period`,
        "CHECK ((usage_start < usage_end))",
        "usage_start < usage_end",
      ),
      check(`ck_${SLOT}_cycle_end`, "CHECK ((usage_end <= cycle_end))", "usage_end <= cycle_end"),
      check(
        `ck_${SLOT}_generation_candidate_no`,
        "CHECK ((generation_candidate_no >= 0))",
        "generation_candidate_no >= 0",
      ),
      {
        name: EXCLUSION_NAME,
        kind: "x",
        definition:
          "EXCLUDE USING gist (exclusive_scope_id WITH =, tstzrange(usage_start, cycle_end, '[)'::text) WITH &&)",
      },
    ],
    indexes: [
      {
        name: EXCLUSION_NAME,
        definition: `CREATE INDEX ${EXCLUSION_NAME} ON app.${SLOT} USING gist (exclusive_scope_id, tstzrange(usage_start, cycle_end, '[)'::text))`,
      },
      {
        name: "ix_karaoke_slots_scope_usage",
        definition: `CREATE INDEX ix_karaoke_slots_scope_usage ON app.${SLOT} USING btree (exclusive_scope_id, usage_start)`,
        declared: [
          ["exclusive_scope_id", "asc"],
          ["usage_start", "asc"],
        ],
      },
      {
        name: "ix_karaoke_slots_usage_start",
        definition: `CREATE INDEX ix_karaoke_slots_usage_start ON app.${SLOT} USING btree (usage_start)`,
        declared: [["usage_start", "asc"]],
      },
      pkIndex(SLOT),
      uniqueIndex(SLOT, `uq_${SLOT}_generation_candidate`, [
        "generation_cause_key",
        "exclusive_scope_id",
        "generation_candidate_no",
      ]),
      uniqueIndex(SLOT, `uq_${SLOT}_public_ref`, ["public_ref"]),
      uniqueIndex(SLOT, `uq_${SLOT}_scope_times`, [
        "exclusive_scope_id",
        "usage_start",
        "usage_end",
        "cycle_end",
      ]),
    ],
    foreign: [
      [`fk_${SLOT}_exclusive_scope`, "exclusive_scope_id", "karaokeExclusiveScopes", SCOPE],
      [
        `fk_${SLOT}_sales_configuration`,
        "sales_configuration_id",
        "karaokeSalesConfigurations",
        "karaoke_sales_configurations",
      ],
    ],
    uniques: {
      [`uq_${SLOT}_public_ref`]: ["public_ref"],
      [`uq_${SLOT}_scope_times`]: ["exclusive_scope_id", "usage_start", "usage_end", "cycle_end"],
      [`uq_${SLOT}_generation_candidate`]: [
        "generation_cause_key",
        "exclusive_scope_id",
        "generation_candidate_no",
      ],
    },
  },
];

// SPEC-100 §27 / §28 / §28.1 / §45.4 sizes, written by hand: 7 + 12 columns, 3 + 11 constraints (the
// exclusion is the 11th of karaoke_slots) and 2 + 7 indexes (PK, three UNIQUE, the exclusion's GiST
// index and the two section 45.4 indexes on karaoke_slots).
const SPEC_COLUMN_COUNTS = [7, 12];
const SPEC_CONSTRAINT_COUNTS = [3, 11];
const SPEC_INDEX_COUNTS = [2, 7];
const SPEC_SEQUENCES = ["karaoke_exclusive_scopes_id_seq", "karaoke_slots_id_seq"];

// ---- expression helpers (same method as db-public-content-sales-schema.test.ts) -------------------

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

interface ExpressionTokens {
  columns: string[];
  literals: string[];
  numbers: string[];
}
function tokens(expression: string, columnNames: string[]): ExpressionTokens {
  const literals = [...expression.matchAll(/'([^']*)'/g)].map((m) => m[1] as string).sort();
  const rest = expression.replace(/'[^']*'/g, " ");
  return {
    columns: columnNames.filter((name) => new RegExp(`\\b${name}\\b`).test(rest)).sort(),
    literals,
    numbers: [...rest.matchAll(/\b\d+\b/g)].map((m) => m[0]).sort(),
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

describe("TC-DB-ARC-007-005 the contract describes the two Karaoke tables", () => {
  it("TC-DB-ARC-007-005 the hand-written goldens have the SPEC-100 table sizes (7 + 12 columns, 3 + 11 constraints, 2 + 7 indexes, 2 sequences)", () => {
    expect(GOLDEN_TABLES.map((g) => g.columns.length)).toEqual(SPEC_COLUMN_COUNTS);
    expect(GOLDEN_TABLES.map((g) => g.constraints.length)).toEqual(SPEC_CONSTRAINT_COUNTS);
    expect(GOLDEN_TABLES.map((g) => g.indexes.length)).toEqual(SPEC_INDEX_COUNTS);
    expect(SPEC_SEQUENCES).toHaveLength(2);
  });

  it("TC-DB-ARC-007-005 the contract lists both tables (owner app_migrator, no row security) and both identity sequences", () => {
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
  });

  it("TC-DB-ARC-007-005 the contract has exactly one EXCLUDE constraint, on karaoke_slots, and no predicate on it or on its index", () => {
    const exclusions = contract.constraints.filter(([, , kind]) => kind === "x");
    expect(exclusions.map(([table, name]) => [table, name])).toEqual([[SLOT, EXCLUSION_NAME]]);
    expect(exclusions[0]?.[3] ?? "").not.toMatch(/\bWHERE\b/i);
    const index = contract.indexes.find(
      ([table, definition]) => table === SLOT && definition.includes(EXCLUSION_NAME),
    );
    expect(index, "the exclusion's backing index is in the contract").toBeDefined();
    expect(index?.[1]).not.toMatch(/\bWHERE\b/i);
  });

  for (const golden of GOLDEN_TABLES) {
    it(`TC-DB-ARC-007-005 contract rows of ${golden.table} equal the golden columns, constraints and indexes`, () => {
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
  const declaredKinds = golden.constraints.filter((c) => c.kind !== "x");
  const load = async () => {
    const schemaModule = await loadSchema();
    const declared = schemaModule[golden.exportName];
    expect(declared, `@off-r39x/db/schema exports ${golden.exportName}`).toBeDefined();
    return { schemaModule, config: getTableConfig(declared) };
  };

  describe(`TC-DB-ARC-007-005 Drizzle declaration of app.${table} matches the contract and the SPEC-100 goldens`, () => {
    it(`TC-DB-ARC-007-005 ${table}: table name and schema name`, async () => {
      const { config } = await load();
      expect(config.name).toBe(table);
      expect(config.schema).toBe("app");
    });

    it(`TC-DB-ARC-007-005 ${table}: columns in order with the golden SQL type and NOT NULL, equal to the contract`, async () => {
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

    it(`TC-DB-ARC-007-005 ${table}: identity always on id only`, async () => {
      const { config } = await load();
      expect(
        config.columns.filter((column) => column.generatedIdentity).map((column) => column.name),
      ).toEqual(["id"]);
      expect(config.columns.find((c) => c.name === "id")?.generatedIdentity?.type).toBe("always");
    });

    it(`TC-DB-ARC-007-005 ${table}: defaults are exactly the golden ones (state and generation columns have none) and equal the contract`, async () => {
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
        // transaction_timestamp() must not become clock_timestamp() or now().
        expect(defaultText(column?.default, `default of ${name}`), `default of ${name}`).toBe(
          defaultExpr as string,
        );
      }
      for (const [, name, , , identity, , contractDefault] of contractRows(table).columns) {
        if (identity !== "") continue;
        expect(contractDefault, `contract default of ${name}`).toBe(
          golden.columns.find(([columnName]) => columnName === name)?.[4],
        );
      }
    });

    it(`TC-DB-ARC-007-005 ${table}: every bigint column is a lossless bigint (PgBigInt64) and nothing else is (DEV-DB-006)`, async () => {
      const { config } = await load();
      for (const [name, type] of golden.columns) {
        const column = config.columns.find((c) => c.name === name);
        if (type === "bigint")
          expect(column?.columnType, `columnType of ${name}`).toBe("PgBigInt64");
        else expect(column?.columnType, `columnType of ${name}`).not.toMatch(/^PgBigInt/);
      }
    });

    it(`TC-DB-ARC-007-005 ${table}: constraint names and kinds equal the golden and the contract without the EXCLUDE constraint`, async () => {
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
      expect(declared.size).toBe(declaredKinds.length);
      expect([...declared.entries()].sort()).toEqual(
        declaredKinds.map((entry) => [entry.name, entry.kind] as [string, string]).sort(),
      );
      expect([...declared.entries()].sort()).toEqual(
        contractRows(table)
          .constraints.filter(([, , kind]) => kind !== "x")
          .map(([, name, kind]) => [name, kind] as [string, string])
          .sort(),
      );
    });

    it(`TC-DB-ARC-007-005 ${table}: the exclusion constraint is not declared in Drizzle in any form (DB-MIG-002, SPEC-100 section 57)`, async () => {
      const { config } = await load();
      const names = [
        ...config.primaryKeys.map(constraintName),
        ...config.uniqueConstraints.map(constraintName),
        ...config.foreignKeys.map((entry) => entry.getName()),
        ...config.checks.map((entry) => entry.name),
        ...config.indexes.map((entry) => entry.config.name),
      ];
      expect(names).not.toContain(EXCLUSION_NAME);
      expect(
        config.indexes.map((entry) => entry.config.method),
        "no GiST index is declared",
      ).not.toContain("gist");
    });

    it(`TC-DB-ARC-007-005 ${table}: primary key and unique constraint column lists equal the golden definitions`, async () => {
      const { config } = await load();
      expect(config.primaryKeys).toHaveLength(1);
      expect(constraintName(config.primaryKeys[0] as DrizzleNamedColumns)).toBe(`pk_${table}`);
      expect(config.primaryKeys[0]?.columns.map((c) => c.name)).toEqual(["id"]);
      expect(
        Object.fromEntries(
          config.uniqueConstraints.map((entry) => [
            constraintName(entry),
            entry.columns.map((c) => c.name),
          ]),
        ),
      ).toEqual(golden.uniques);
    });

    it(`TC-DB-ARC-007-005 ${table}: CHECK expressions equal the golden exactly and match the contract by column, literals and numbers`, async () => {
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
      // (2) the contract's normalised definition has the same columns, literals and numbers.
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

    it(`TC-DB-ARC-007-005 ${table}: foreign keys reference the golden parents with ON DELETE RESTRICT`, async () => {
      const { schemaModule, config } = await load();
      expect(config.foreignKeys.map((entry) => entry.getName()).sort()).toEqual(
        golden.foreign.map(([name]) => name).sort(),
      );
      for (const [name, column, parentExport, parentTable] of golden.foreign) {
        const entry = config.foreignKeys.find((candidate) => candidate.getName() === name);
        const reference = entry?.reference();
        expect(
          reference?.columns.map((c) => c.name),
          name,
        ).toEqual([column]);
        expect(
          reference?.foreignColumns.map((c) => c.name),
          name,
        ).toEqual(["id"]);
        expect(reference?.foreignTable, name).toBe(schemaModule[parentExport]);
        expect(entry?.onDelete, name).toBe("restrict");
        // An omitted ON UPDATE is PostgreSQL's NO ACTION, which pg_get_constraintdef leaves out of the contract.
        expect(entry?.onUpdate ?? "no action", `${name} ON UPDATE`).toBe("no action");
        // The same relation as the contract's pg_get_constraintdef (DB-FK-002: never CASCADE).
        expect(
          contractRows(table).constraints.find(([, constraint]) => constraint === name)?.[3],
        ).toBe(`FOREIGN KEY (${column}) REFERENCES app.${parentTable}(id) ON DELETE RESTRICT`);
      }
    });

    it(`TC-DB-ARC-007-005 ${table}: declared indexes carry the golden columns and order and equal the contract's pg_get_indexdef`, async () => {
      const { config } = await load();
      const goldenDeclared = golden.indexes.filter((entry) => entry.declared !== undefined);
      expect(config.indexes.map((i) => i.config.name).sort()).toEqual(
        goldenDeclared.map((entry) => entry.name).sort(),
      );
      for (const entry of goldenDeclared) {
        const index = config.indexes.find((i) => i.config.name === entry.name);
        expect(index?.config.unique, `${entry.name} uniqueness`).toBe(false);
        expect(index?.config.method, `${entry.name} method`).toBe("btree");
        expect(index?.config.where, `${entry.name} has no predicate`).toBeUndefined();
        expect(
          index?.config.columns.map((c) => [c.name, c.indexConfig?.order ?? "asc"]),
          `${entry.name} columns`,
        ).toEqual(entry.declared);
        const columns = (index?.config.columns ?? []).map((c) => c.name).join(", ");
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

describe("TC-DB-ARC-007-005 the schema barrel exposes the two Karaoke tables by name", () => {
  it("TC-DB-ARC-007-005 each golden export is a table in the app schema and no two exports are the same table", async () => {
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
