import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  byFirst,
  GOLDEN_COLUMNS,
  GOLDEN_CONSTRAINTS,
  GOLDEN_INDEXES,
  GOLDEN_SEQUENCE,
  GOLDEN_TABLE_ROW,
  IDEMPOTENCY_TABLE,
} from "../harness/db/idempotency-golden.ts";

// PR-S0-3d C1 (SPEC-100 section 43.1, DB-IDM-001, DB-ARC-007, DB-MIG-002, DEV-DB-006): pins the Drizzle
// declaration of app.idempotency_records against the reviewed schema-contract.json and against goldens
// written by hand from SPEC-100 section 43.1 and the PostgreSQL 17 notation (tests/harness/db/
// idempotency-golden.ts). Static only: no database. Constraints, defaults and the UNIQUE index are
// enforced and checked on real PostgreSQL 17 by TC-DB-IDM-001-001 (TST-UNT-001, TST-GEN-004). The
// serialisation approach mirrors db-public-content-sales-schema.test.ts; helpers are intentionally
// copied. The schema module is read through a string-keyed record so that this file type-checks before
// the table exists (C1 is committed as a failing test).

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
interface DrizzleNamedColumns {
  name?: string;
  getName?: () => string;
  columns: DrizzleColumn[];
}
interface DrizzleIndex {
  config: {
    name: string;
    unique: boolean;
    method: string;
    columns: { name: string; indexConfig?: { order?: string; nulls?: string } }[];
    where?: unknown;
  };
}
interface DrizzleTableConfig {
  name: string;
  schema?: string;
  columns: DrizzleColumn[];
  indexes: DrizzleIndex[];
  foreignKeys: {
    getName(): string;
    onDelete?: string;
    onUpdate?: string;
    reference(): {
      columns: DrizzleColumn[];
      foreignColumns: DrizzleColumn[];
      foreignTable: unknown;
    };
  }[];
  checks: { name: string; value: unknown }[];
  primaryKeys: DrizzleNamedColumns[];
  uniqueConstraints: DrizzleNamedColumns[];
}
const { getTableConfig, PgDialect } = dbRequire("drizzle-orm/pg-core") as {
  getTableConfig(table: unknown): DrizzleTableConfig;
  PgDialect: new () => { sqlToQuery(query: unknown): { sql: string; params: unknown[] } };
};

interface SchemaContract {
  tables: [string, ...unknown[]][];
  columns: [string, string, string, boolean, string, string, string | null][];
  indexes: [string, string, ...boolean[]][];
  constraints: [string, string, string, string, ...boolean[]][];
  sequences: [string, ...unknown[]][];
}
const contract = JSON.parse(readFileSync(contractUrl, "utf8")) as SchemaContract;
const contractRows = {
  columns: contract.columns.filter(([table]) => table === IDEMPOTENCY_TABLE),
  constraints: contract.constraints.filter(([table]) => table === IDEMPOTENCY_TABLE),
  indexes: contract.indexes.filter(([table]) => table === IDEMPOTENCY_TABLE),
};

const loadSchema = async () =>
  (await import("@off-r39x/db/schema")) as unknown as Record<string, unknown>;
async function load() {
  const schemaModule = await loadSchema();
  const declared = schemaModule.idempotencyRecords;
  expect(declared, "@off-r39x/db/schema exports idempotencyRecords").toBeDefined();
  return { schemaModule, config: getTableConfig(declared) };
}

const dialect = new PgDialect();
function serialize(expression: unknown, what: string): string {
  expect(expression, `${what} is declared`).toBeDefined();
  const query = dialect.sqlToQuery(expression);
  expect(query.params, `${what} must not carry bind parameters`).toEqual([]);
  return query.sql;
}
/** Whitespace is not significant in a declaration; the qualifier "app"."idempotency_records". is. */
function bare(sqlText: string, what: string): string {
  const stripped = sqlText
    .replace(/"app"\."idempotency_records"\."([a-z_]+)"/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  expect(stripped, `${what} has an unrecognised quoted identifier`).not.toContain('"');
  return stripped;
}
const constraintName = (entry: DrizzleNamedColumns): string => {
  const name = entry.getName ? entry.getName() : entry.name;
  if (!name) throw new Error("Unnamed constraint in Drizzle declaration (DB-ARC-007)");
  return name;
};

// Declared raw SQL goldens (the approved plan's DDL; PostgreSQL normalises them to the contract notation).
const DECLARED_DEFAULTS: Record<string, string> = {
  result_refs: "'{}'::uuid[]",
  created_at: "transaction_timestamp()",
  expires_at: "transaction_timestamp() + interval '24 hours'",
};
const DECLARED_CHECKS: Record<string, string> = {
  ck_idempotency_records_key_digest: "octet_length(key_digest) = 32",
  ck_idempotency_records_request_digest: "octet_length(request_digest) = 32",
  ck_idempotency_records_expiry: "expires_at = created_at + interval '24 hours'",
  ck_idempotency_records_result_ref: "(result_ref_type IS NULL) = (cardinality(result_refs) = 0)",
};

describe("TC-DB-IDM-001-002 the Drizzle declaration of app.idempotency_records matches the contract and the SPEC-100 goldens", () => {
  it("TC-DB-IDM-001-002 the hand-written golden has the SPEC-100 section 43.1 sizes: nine columns, six constraints, two indexes, one sequence", () => {
    expect(GOLDEN_COLUMNS).toHaveLength(9);
    expect(GOLDEN_CONSTRAINTS).toHaveLength(6);
    expect(GOLDEN_INDEXES).toHaveLength(2);
    expect(GOLDEN_SEQUENCE).toEqual(["idempotency_records_id_seq", "bigint", "app_migrator"]);
    expect(Object.keys(DECLARED_CHECKS).sort()).toEqual(
      GOLDEN_CONSTRAINTS.filter(([, kind]) => kind === "c")
        .map(([name]) => name)
        .sort(),
    );
  });

  it("TC-DB-IDM-001-002 the contract lists the table (owner app_migrator, no row security), its identity sequence, and exactly the golden columns, constraints and indexes", () => {
    expect(contract.tables.filter(([name]) => name === IDEMPOTENCY_TABLE)).toEqual([
      [...GOLDEN_TABLE_ROW],
    ]);
    expect(contract.sequences.filter(([name]) => name === GOLDEN_SEQUENCE[0])).toEqual([
      [...GOLDEN_SEQUENCE],
    ]);
    expect(
      contractRows.columns.map(([, name, type, notNull, identity, generated, defaultExpr]) => [
        name,
        type,
        notNull,
        identity,
        generated,
        defaultExpr,
      ]),
    ).toEqual(
      GOLDEN_COLUMNS.map(([name, type, notNull, identity, defaultExpr]) => [
        name,
        type,
        notNull,
        identity,
        "",
        defaultExpr,
      ]),
    );
    expect(
      contractRows.constraints.map(([, name, kind, definition, ...flags]) => [
        name,
        kind,
        definition,
        ...flags,
      ]),
    ).toEqual([...GOLDEN_CONSTRAINTS].sort(byFirst).map((entry) => [...entry, true, false, false]));
    expect(contractRows.indexes.map(([, definition, ...flags]) => [definition, ...flags])).toEqual(
      [...GOLDEN_INDEXES].sort(byFirst).map(([, definition]) => [definition, true, true, true]),
    );
  });

  it("TC-DB-IDM-001-002 table name and schema name", async () => {
    const { config } = await load();
    expect(config.name).toBe(IDEMPOTENCY_TABLE);
    expect(config.schema).toBe("app");
  });

  it("TC-DB-IDM-001-002 columns: order, SQL type (bytea, uuid[], timestamptz) and NOT NULL equal the golden and the contract", async () => {
    const { config } = await load();
    const actual = config.columns.map((column) => [
      column.name,
      column.getSQLType(),
      column.notNull,
    ]);
    // The Drizzle notation of timestamptz is `timestamp with time zone`, the same as format_type.
    expect(actual).toEqual(GOLDEN_COLUMNS.map(([name, type, notNull]) => [name, type, notNull]));
    expect(actual).toEqual(
      contractRows.columns.map(([, name, type, notNull]) => [name, type, notNull]),
    );
  });

  it("TC-DB-IDM-001-002 identity is ALWAYS on id only", async () => {
    const { config } = await load();
    expect(
      config.columns.filter((column) => column.generatedIdentity).map((column) => column.name),
    ).toEqual(["id"]);
    expect(config.columns.find((column) => column.name === "id")?.generatedIdentity?.type).toBe(
      "always",
    );
  });

  it("TC-DB-IDM-001-002 defaults are exactly result_refs, created_at and expires_at, with the golden SQL (expires_at is a default, not a generated column)", async () => {
    const { config } = await load();
    const withDefault = config.columns.filter(
      (column) => !column.generatedIdentity && column.hasDefault,
    );
    expect(withDefault.map((column) => column.name)).toEqual(Object.keys(DECLARED_DEFAULTS));
    for (const column of withDefault) {
      // transaction_timestamp() must not become clock_timestamp() or now(); 24 hours is not 1 day.
      expect(bare(serialize(column.default, `default of ${column.name}`), column.name)).toBe(
        DECLARED_DEFAULTS[column.name],
      );
    }
    // The contract is the PostgreSQL-normalised form of the same defaults.
    const contractDefaults = Object.fromEntries(
      contractRows.columns
        .filter(([, , , , identity, , defaultExpr]) => identity === "" && defaultExpr !== null)
        .map(([, name, , , , , defaultExpr]) => [name, defaultExpr]),
    );
    expect(contractDefaults).toEqual({
      result_refs: "'{}'::uuid[]",
      created_at: "transaction_timestamp()",
      expires_at: "(transaction_timestamp() + '24:00:00'::interval)",
    });
    // No generated column anywhere (SPEC-100 section 43.1).
    expect(contractRows.columns.every(([, , , , , generated]) => generated === "")).toBe(true);
  });

  it("TC-DB-IDM-001-002 id and principal_profile_id are lossless bigint (PgBigInt64) and no other column is (DEV-DB-006)", async () => {
    const { config } = await load();
    for (const [name, type] of GOLDEN_COLUMNS) {
      const column = config.columns.find((c) => c.name === name);
      if (type === "bigint") expect(column?.columnType, `columnType of ${name}`).toBe("PgBigInt64");
      else expect(column?.columnType, `columnType of ${name}`).not.toMatch(/^PgBigInt/);
    }
    expect(GOLDEN_COLUMNS.filter(([, type]) => type === "bigint").map(([name]) => name)).toEqual([
      "id",
      "principal_profile_id",
    ]);
  });

  it("TC-DB-IDM-001-002 constraint names and kinds equal the golden and the contract: PK, FK and four CHECKs, and the UNIQUE key is an index, not a constraint", async () => {
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
    const expected = GOLDEN_CONSTRAINTS.map(([name, kind]) => [name, kind] as [string, string]);
    expect([...declared.entries()].sort()).toEqual(expected.sort());
    expect(config.uniqueConstraints).toHaveLength(0);
    expect(
      contractRows.constraints.map(([, name, kind]) => [name, kind] as [string, string]).sort(),
    ).toEqual(expected.sort());
  });

  it("TC-DB-IDM-001-002 the primary key is (id) under its golden name", async () => {
    const { config } = await load();
    expect(config.primaryKeys).toHaveLength(1);
    const [entry] = config.primaryKeys;
    expect(constraintName(entry as DrizzleNamedColumns)).toBe("pk_idempotency_records");
    expect(`PRIMARY KEY (${entry?.columns.map((column) => column.name).join(", ")})`).toBe(
      GOLDEN_CONSTRAINTS.find(([name]) => name === "pk_idempotency_records")?.[2],
    );
  });

  it("TC-DB-IDM-001-002 CHECK expressions equal the golden exactly", async () => {
    const { config } = await load();
    const actual: Record<string, string> = {};
    for (const entry of config.checks) {
      actual[entry.name] = bare(
        serialize(entry.value, `CHECK ${entry.name}`),
        `CHECK ${entry.name}`,
      );
    }
    expect(actual).toEqual(DECLARED_CHECKS);
  });

  it("TC-DB-IDM-001-002 the foreign key references business_profiles(id) with ON DELETE RESTRICT and no other action", async () => {
    const { schemaModule, config } = await load();
    expect(config.foreignKeys).toHaveLength(1);
    const [fk] = config.foreignKeys;
    const reference = fk?.reference();
    expect(fk?.getName()).toBe("fk_idempotency_records_principal_profile");
    expect(reference?.columns.map((column) => column.name)).toEqual(["principal_profile_id"]);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual(["id"]);
    expect(reference?.foreignTable).toBe(schemaModule.businessProfiles);
    expect(fk?.onDelete).toBe("restrict");
    expect(fk?.onUpdate ?? "no action", "ON UPDATE").toBe("no action");
    expect(GOLDEN_CONSTRAINTS.find(([name]) => name === fk?.getName())?.[2]).toBe(
      "FOREIGN KEY (principal_profile_id) REFERENCES app.business_profiles(id) ON DELETE RESTRICT",
    );
  });

  it("TC-DB-IDM-001-002 exactly one declared index: the UNIQUE key on (principal_profile_id, operation_id, key_digest), btree, no predicate, equal to the contract's pg_get_indexdef", async () => {
    const { config } = await load();
    expect(config.indexes).toHaveLength(1);
    const [index] = config.indexes;
    expect(index?.config.name).toBe("ux_idempotency_records_principal_operation_key");
    expect(index?.config.unique).toBe(true);
    expect(index?.config.method).toBe("btree");
    expect(index?.config.where, "no predicate").toBeUndefined();
    expect(index?.config.columns.map((c) => [c.name, c.indexConfig?.order ?? "asc"])).toEqual([
      ["principal_profile_id", "asc"],
      ["operation_id", "asc"],
      ["key_digest", "asc"],
    ]);
    const golden = GOLDEN_INDEXES.find(([name]) => name === index?.config.name)?.[1];
    expect(golden).toBe(
      "CREATE UNIQUE INDEX ux_idempotency_records_principal_operation_key ON app.idempotency_records USING btree (principal_profile_id, operation_id, key_digest)",
    );
    expect(contractRows.indexes.map(([, definition]) => definition)).toContain(golden);
  });

  it("TC-DB-IDM-001-002 no declared column can hold a raw key, body, URL, session id, Email or QR (DB-IDM-001)", async () => {
    const { config } = await load();
    const names = config.columns.map((column) => column.name);
    expect(names).toEqual(GOLDEN_COLUMNS.map(([name]) => name));
    for (const name of names.filter((n) => n !== "key_digest")) {
      expect(name, `column ${name}`).not.toMatch(
        /key|body|url|session|email|qr|token|payload|response/,
      );
    }
  });

  it("TC-DB-IDM-001-002 the schema barrel exports idempotencyRecords as a table of the app schema, distinct from every other export", async () => {
    const schemaModule = await loadSchema();
    const declared = schemaModule.idempotencyRecords;
    expect(declared).toBeDefined();
    expect(getTableConfig(declared).schema).toBe("app");
    for (const [name, other] of Object.entries(schemaModule)) {
      if (name !== "idempotencyRecords" && name !== "app") expect(other).not.toBe(declared);
    }
  });
});
