import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// PR-S0-2 C1: pins the public surface of packages/db and the Drizzle declarations of the two
// foundation tables. Static only: no database connection, no environment variables. DB
// enforcement of the same constraints is covered on real PostgreSQL 17 by
// TC-DB-FOUNDATION-001 / TC-DB-FOUNDATION-009 (TST-UNT-001, TST-GEN-004). The expectations are
// read from the reviewed schema-contract.json, not hand-copied, so a drift between the Drizzle
// declaration and the contract fails here. Everything is addressed through package names, so a
// later file reorganisation inside packages/db (schema/index.ts, schema/identity.ts) must not
// require changing this file.

const dbPackageJson = new URL("../../packages/db/package.json", import.meta.url);
const contractUrl = new URL("../../packages/db/src/schema-contract.json", import.meta.url);

// tests does not depend on drizzle-orm; resolve the copy that packages/db declares.
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
interface DrizzleIndex {
  config: {
    name: string;
    unique: boolean;
    columns: DrizzleColumn[];
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

// schema-contract.json row shapes (packages/db/src/schema-contract.json).
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
  schemas: [string, string][];
  constraints: ContractConstraint[];
}
const contract = JSON.parse(readFileSync(contractUrl, "utf8")) as SchemaContract;

// The error classification added in S0-3a adds three runtime exports:
// classifyDatabaseError, DatabaseUnavailableError and isDatabaseUnavailableCode; L2-1a adds
// createCurrentProfileRepository (13 -> 17).
const EXPECTED_ROOT_EXPORTS = [
  "DatabaseUnavailableError",
  "TransactionDeadlineError",
  "checkReadiness",
  "classifyDatabaseError",
  "computeMigrationSetHash",
  "createCurrentProfileRepository",
  "createDatabase",
  "createPrincipalRepository",
  "insertAuditEvent",
  "installBaselineRoles",
  "installIdentityDirectory",
  "isDatabaseUnavailableCode",
  "migrationIdentity",
  "runMigrations",
  "sqlState",
  "transaction",
  "withWorkerAdvisoryLock",
];

describe("TC-DEV-DB-001-001 db package public surface", () => {
  it("TC-DEV-DB-001-001 @off-r39x/db/schema exports exactly app and the eleven table declarations by name", async () => {
    const schemaModule = await import("@off-r39x/db/schema");

    // (1) no helper or extra name leaks through the barrel (DEV-DB-001).
    expect(Object.keys(schemaModule).sort()).toEqual([
      "announcements",
      "app",
      "auditEvents",
      "businessProfiles",
      "entryTicketOfferings",
      "events",
      "faqItems",
      "goods",
      "goodsInventory",
      "karaokeSalesConfigurations",
      "roleAssignments",
      "sponsorLogos",
    ]);

    // (2) the shared pgSchema object is the "app" schema.
    expect((schemaModule.app as unknown as { schemaName: string }).schemaName).toBe("app");

    // (3) all tables live in that same schema, and the contract agrees.
    const profiles = getTableConfig(schemaModule.businessProfiles);
    const roles = getTableConfig(schemaModule.roleAssignments);
    const audit = getTableConfig(schemaModule.auditEvents);
    expect(profiles.schema).toBe("app");
    expect(roles.schema).toBe("app");
    expect(audit.schema).toBe("app");
    expect(profiles.schema).toBe(
      (schemaModule.app as unknown as { schemaName: string }).schemaName,
    );
    expect(contract.schemas.map(([name]) => name)).toContain("app");
  });

  it("TC-DEV-DB-001-001 @off-r39x/db root exports exactly the 17 runtime names", async () => {
    const rootModule = await import("@off-r39x/db");

    // (4) runtime exports only; type-only exports are erased and out of scope. Importing the
    // package must not open a connection: createDatabase is never called here.
    expect(Object.keys(rootModule).sort()).toEqual(EXPECTED_ROOT_EXPORTS);
    expect(EXPECTED_ROOT_EXPORTS).toHaveLength(17);
    // The schema is intentionally not part of the root surface.
    expect(rootModule).not.toHaveProperty("businessProfiles");
    expect(rootModule).not.toHaveProperty("roleAssignments");
    expect(rootModule).not.toHaveProperty("auditEvents");
    expect(rootModule).not.toHaveProperty("app");
  });
});

const IDENTITY_TYPE: Record<string, string | undefined> = {
  "": undefined,
  a: "always",
  d: "byDefault",
};

function constraintName(entry: DrizzleNamedColumns): string {
  const name = entry.getName ? entry.getName() : entry.name;
  if (!name) throw new Error("Unnamed constraint in Drizzle declaration (DB-ARC-007)");
  return name;
}

function columnList(columns: DrizzleColumn[]): string {
  return columns.map((column) => column.name).join(", ");
}

// Expression comparison (default / CHECK / partial-index predicate).
//
// Drizzle keeps raw `sql` fragments as SQL objects; PgDialect().sqlToQuery() is the serializer
// that renders them into DDL. It is the one Drizzle internal this test depends on (a public
// export of drizzle-orm/pg-core in 0.45; the SQL object itself is reached through the untyped
// `default`, `checks[].value` and `indexes[].config.where` fields). It qualifies column
// references as "app"."<table>"."<column>"; stripSchemaQualifiers() reduces them to the bare
// column name and fails on any other quoting, so the golden strings below stay readable.
//
// The golden values are the expressions of the pre-refactor packages/db/src/schema/profiles.ts
// (origin/dev), copied verbatim apart from that qualifier normalisation. They are compared for
// exact equality, so a change of function (transaction_timestamp() -> clock_timestamp()), literal,
// operator, column or predicate fails here. schema-contract.json holds the PostgreSQL-normalised
// form (pg_get_constraintdef / pg_get_expr), which cannot be string-equal to the raw SQL for
// CHECKs, so CHECKs are additionally compared with the contract by token: referenced columns,
// string literals, numbers and IS [NOT] NULL tests. Defaults and the partial-index predicate are
// the same text in both forms (apart from the ::text cast) and are compared with the contract
// exactly.
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

const GOLDEN_DEFAULTS: Record<string, Record<string, string>> = {
  business_profiles: {
    public_ref: "gen_random_uuid()",
    created_at: "transaction_timestamp()",
    updated_at: "transaction_timestamp()",
  },
  role_assignments: {
    public_ref: "gen_random_uuid()",
    granted_at: "transaction_timestamp()",
    created_at: "transaction_timestamp()",
  },
};

const GOLDEN_CHECKS: Record<string, Record<string, string>> = {
  business_profiles: {
    ck_business_profiles_display_name:
      "display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 80",
  },
  role_assignments: {
    ck_role_assignments_role: "role IN ('STAFF','ADMINISTRATOR')",
    ck_role_assignments_state: "state IN ('ACTIVE','REVOKED')",
    ck_role_assignments_revocation:
      "(state = 'ACTIVE' AND revoked_at IS NULL AND revoked_by_profile_id IS NULL) OR (state = 'REVOKED' AND revoked_at IS NOT NULL)",
  },
};

const GOLDEN_PARTIAL_INDEX_WHERE = "state = 'ACTIVE'";

// The contract side is pinned independently of the Drizzle side. The token comparison below only
// proves that the two sides agree on columns, literals, numbers and NULL tests, so a contract-only
// edit that keeps those (char_length -> octet_length, >= -> <, OR -> AND) would otherwise pass.
// These are the pg_get_constraintdef / pg_get_indexdef strings of the reviewed schema-contract.json,
// compared for exact equality by name. A deliberate change to a CHECK or to the partial index must
// update the contract, the Drizzle declaration, the migration and this golden together.
const GOLDEN_CONTRACT_CHECK_DEFINITIONS: Record<string, Record<string, string>> = {
  business_profiles: {
    ck_business_profiles_display_name:
      "CHECK (((display_name IS NULL) OR ((char_length(display_name) >= 1) AND (char_length(display_name) <= 80))))",
  },
  role_assignments: {
    ck_role_assignments_role: "CHECK ((role = ANY (ARRAY['STAFF'::text, 'ADMINISTRATOR'::text])))",
    ck_role_assignments_state: "CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'REVOKED'::text])))",
    ck_role_assignments_revocation:
      "CHECK ((((state = 'ACTIVE'::text) AND (revoked_at IS NULL) AND (revoked_by_profile_id IS NULL)) OR ((state = 'REVOKED'::text) AND (revoked_at IS NOT NULL))))",
  },
};

const GOLDEN_CONTRACT_PARTIAL_INDEX_DEFINITION =
  "CREATE UNIQUE INDEX ux_role_assignments_profile_role_active ON app.role_assignments USING btree (profile_id, role) WHERE (state = 'ACTIVE'::text)";

interface ExpressionTokens {
  columns: string[];
  literals: string[];
  numbers: string[];
  isNull: number;
  isNotNull: number;
}

function tokens(expression: string, columnNames: string[]): ExpressionTokens {
  const literals = [...expression.matchAll(/'([^']*)'/g)].map((m) => m[1] as string).sort();
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

describe("TC-DB-ARC-007-001 Drizzle declarations match schema-contract.json", () => {
  const cases = [
    { exportName: "businessProfiles", table: "business_profiles", columns: 6, constraints: 4 },
    { exportName: "roleAssignments", table: "role_assignments", columns: 10, constraints: 8 },
  ] as const;

  for (const expected of cases) {
    describe(`TC-DB-ARC-007-001 ${expected.table}`, () => {
      const load = async () => {
        const schemaModule = await import("@off-r39x/db/schema");
        return { schemaModule, config: getTableConfig(schemaModule[expected.exportName]) };
      };
      const contractColumns = contract.columns.filter(([table]) => table === expected.table);
      const contractConstraints = contract.constraints.filter(
        ([table]) => table === expected.table,
      );
      const contractIndexes = contract.indexes.filter(([table]) => table === expected.table);

      it("TC-DB-ARC-007-001 contract sizes are the reviewed ones (guards against empty comparisons)", () => {
        expect(contract.tables.map(([name]) => name)).toContain(expected.table);
        expect(contractColumns).toHaveLength(expected.columns);
        expect(contractConstraints).toHaveLength(expected.constraints);
      });

      it("TC-DB-ARC-007-001 table name and schema name", async () => {
        const { config } = await load();
        expect(config.name).toBe(expected.table);
        expect(config.schema).toBe("app");
      });

      it("TC-DB-ARC-007-001 columns: order, SQL type and NOT NULL equal the contract", async () => {
        const { config } = await load();
        expect(config.columns).toHaveLength(expected.columns);
        expect(config.columns.map((c) => [c.name, c.getSQLType(), c.notNull])).toEqual(
          contractColumns.map(([, name, type, notNull]) => [name, type, notNull]),
        );
      });

      it("TC-DB-ARC-007-001 columns: identity always only where the contract says so", async () => {
        const { config } = await load();
        const identityColumns = contractColumns.filter(([, , , , identity]) => identity !== "");
        expect(identityColumns.map(([, name]) => name)).toEqual(["id"]);
        for (const [, name, , , identity] of contractColumns) {
          const column = config.columns.find((c) => c.name === name);
          expect(column, `column ${name}`).toBeDefined();
          expect(column?.generatedIdentity?.type, `identity of ${name}`).toBe(
            IDENTITY_TYPE[identity],
          );
        }
      });

      it("TC-DB-ARC-007-001 columns: a default exists exactly where the contract has one", async () => {
        const { config } = await load();
        const withDefault: string[] = [];
        for (const [, name, , , identity, , defaultExpr] of contractColumns) {
          if (identity !== "") continue;
          const column = config.columns.find((c) => c.name === name);
          expect(column, `column ${name}`).toBeDefined();
          expect(column?.hasDefault, `default of ${name}`).toBe(defaultExpr !== null);
          if (defaultExpr !== null) withDefault.push(name);
        }
        // Not an empty comparison: both tables carry public_ref and at least one timestamp default.
        expect(withDefault).toContain("public_ref");
        expect(withDefault).toContain("created_at");
        if (expected.table === "business_profiles") {
          expect(withDefault).toEqual(["public_ref", "created_at", "updated_at"]);
        } else {
          expect(withDefault).toEqual(["public_ref", "granted_at", "created_at"]);
        }
      });

      it("TC-DB-ARC-007-001 columns: default SQL expressions equal the golden and the contract", async () => {
        const { config } = await load();
        const golden = GOLDEN_DEFAULTS[expected.table] as Record<string, string>;
        const actual: Record<string, string> = {};
        for (const column of config.columns) {
          if (column.generatedIdentity || !column.hasDefault) continue;
          actual[column.name] = serialize(column.default, `default of ${column.name}`);
        }
        // (1) exact expression text, e.g. transaction_timestamp() must not become clock_timestamp().
        expect(actual).toEqual(golden);
        // (2) the same text as the reviewed contract.
        for (const [, name, , , identity, , defaultExpr] of contractColumns) {
          if (identity !== "") continue;
          expect(defaultExpr, `contract default of ${name}`).toBe(actual[name] ?? null);
        }
      });

      it("TC-DB-ARC-007-001 columns: bigint IDs and FKs stay in lossless bigint mode (DEV-DB-006)", async () => {
        const { config } = await load();
        const bigintColumns = contractColumns
          .filter(([, , type]) => type === "bigint")
          .map(([, name]) => name);
        if (expected.table === "business_profiles") {
          expect(bigintColumns).toEqual(["id"]);
        } else {
          expect(bigintColumns).toEqual([
            "id",
            "profile_id",
            "granted_by_profile_id",
            "revoked_by_profile_id",
          ]);
        }
        for (const column of config.columns) {
          if (bigintColumns.includes(column.name)) {
            // drizzle-orm 0.45: mode "bigint" is PgBigInt64; mode "number" would be PgBigInt53.
            expect(column.columnType, `columnType of ${column.name}`).toBe("PgBigInt64");
          } else {
            expect(column.columnType, `columnType of ${column.name}`).not.toMatch(/^PgBigInt/);
          }
        }
      });

      it("TC-DB-ARC-007-001 constraints: names and kinds equal the contract (DB-ARC-007)", async () => {
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

        expect(declared.size).toBe(expected.constraints);
        expect([...declared.entries()].sort()).toEqual(
          contractConstraints.map(([, name, kind]) => [name, kind] as [string, string]).sort(),
        );
      });

      it("TC-DB-ARC-007-001 constraints: the contract CHECK definitions equal the golden by name", () => {
        const contractChecks = Object.fromEntries(
          contractConstraints
            .filter(([, , kind]) => kind === "c")
            .map(([, name, , definition]) => [name, definition]),
        );
        // Exact pg_get_constraintdef text per name: octet_length, a flipped comparison, AND for OR
        // or a changed literal in the contract alone fails here, independent of the Drizzle side.
        expect(contractChecks).toEqual(
          GOLDEN_CONTRACT_CHECK_DEFINITIONS[expected.table] as Record<string, string>,
        );
      });

      it("TC-DB-ARC-007-001 constraints: CHECK expressions equal the golden and match the contract tokens", async () => {
        const { config } = await load();
        const golden = GOLDEN_CHECKS[expected.table] as Record<string, string>;
        const columnNames = config.columns.map((c) => c.name);
        const actual: Record<string, string> = {};
        for (const check of config.checks) {
          actual[check.name] = stripSchemaQualifiers(
            serialize(check.value, `CHECK ${check.name}`),
            expected.table,
            `CHECK ${check.name}`,
          );
        }
        // (1) exact expression text: TRUE, a changed literal or operator, or a swapped column fails.
        expect(actual).toEqual(golden);
        // (2) the contract's PostgreSQL-normalised definition has the same columns, literals,
        // numbers and NULL tests (it differs in parentheses, casts and IN -> = ANY(ARRAY[...])).
        const contractChecks = contractConstraints.filter(([, , kind]) => kind === "c");
        expect(contractChecks.map(([, name]) => name).sort()).toEqual(Object.keys(golden).sort());
        for (const [, name, , definition] of contractChecks) {
          const declared = tokens(actual[name] as string, columnNames);
          expect(declared.columns.length, `columns of ${name}`).toBeGreaterThan(0);
          expect(declared, `tokens of ${name}`).toEqual(
            tokens(contractCheckExpression(definition), columnNames),
          );
        }
      });

      it("TC-DB-ARC-007-001 primary key and unique constraint column lists equal the contract definitions", async () => {
        const { config } = await load();
        const definitions = new Map(contractConstraints.map(([, name, , def]) => [name, def]));
        expect(config.primaryKeys).toHaveLength(1);
        for (const entry of config.primaryKeys) {
          expect(definitions.get(constraintName(entry))).toBe(
            `PRIMARY KEY (${columnList(entry.columns)})`,
          );
        }
        expect(config.uniqueConstraints.length).toBeGreaterThan(0);
        for (const entry of config.uniqueConstraints) {
          expect(definitions.get(constraintName(entry))).toBe(
            `UNIQUE (${columnList(entry.columns)})`,
          );
        }
      });

      it("TC-DB-ARC-007-001 indexes: only declared partial unique indexes, present in the contract", async () => {
        const { config } = await load();
        if (expected.table === "business_profiles") {
          expect(config.indexes).toHaveLength(0);
          return;
        }
        expect(config.indexes).toHaveLength(1);
        const [index] = config.indexes;
        expect(index?.config.name).toBe("ux_role_assignments_profile_role_active");
        expect(index?.config.unique).toBe(true);
        expect(index?.config.columns.map((c) => c.name)).toEqual(["profile_id", "role"]);
        expect(index?.config.where, "partial index predicate").toBeDefined();
        const definition = contractIndexes.find(([, def]) =>
          def.includes(" ux_role_assignments_profile_role_active "),
        )?.[1];
        // Exact pg_get_indexdef text: uniqueness, columns, method and predicate of the contract.
        expect(definition).toBe(GOLDEN_CONTRACT_PARTIAL_INDEX_DEFINITION);
      });

      it("TC-DB-ARC-007-001 indexes: the partial-index predicate equals the golden and the contract", async () => {
        const { config } = await load();
        if (expected.table === "business_profiles") {
          expect(config.indexes).toHaveLength(0);
          return;
        }
        const [index] = config.indexes;
        const where = stripSchemaQualifiers(
          serialize(index?.config.where, "partial index predicate"),
          expected.table,
          "partial index predicate",
        );
        // (1) exact predicate text: `state = 'REVOKED'` or a changed condition fails.
        expect(where).toBe(GOLDEN_PARTIAL_INDEX_WHERE);
        // (2) the contract's pg_get_indexdef predicate is the same text plus the ::text cast.
        const definition = contractIndexes.find(([, def]) =>
          def.includes(" ux_role_assignments_profile_role_active "),
        )?.[1];
        const predicate = /\sWHERE \((.*)\)$/.exec(definition ?? "")?.[1];
        expect(predicate, "contract predicate").toBeDefined();
        expect((predicate as string).replaceAll("::text", "")).toBe(where);
      });
    });
  }

  it("TC-DB-ARC-007-001 role_assignments foreign keys reference business_profiles(id) with ON DELETE RESTRICT", async () => {
    const schemaModule = await import("@off-r39x/db/schema");
    const config = getTableConfig(schemaModule.roleAssignments);
    const contractForeignKeys = new Map(
      contract.constraints
        .filter(([table, , kind]) => table === "role_assignments" && kind === "f")
        .map(([, name, , def]) => [name, def]),
    );

    const actual = config.foreignKeys.map((fk) => {
      const ref = fk.reference();
      return {
        name: fk.getName(),
        columns: ref.columns.map((c) => c.name),
        foreignColumns: ref.foreignColumns.map((c) => c.name),
        foreignTableIsBusinessProfiles: ref.foreignTable === schemaModule.businessProfiles,
        onDelete: fk.onDelete,
      };
    });
    expect(actual).toEqual([
      {
        name: "fk_role_assignments_profile",
        columns: ["profile_id"],
        foreignColumns: ["id"],
        foreignTableIsBusinessProfiles: true,
        onDelete: "restrict",
      },
      {
        name: "fk_role_assignments_granted_by_profile",
        columns: ["granted_by_profile_id"],
        foreignColumns: ["id"],
        foreignTableIsBusinessProfiles: true,
        onDelete: "restrict",
      },
      {
        name: "fk_role_assignments_revoked_by_profile",
        columns: ["revoked_by_profile_id"],
        foreignColumns: ["id"],
        foreignTableIsBusinessProfiles: true,
        onDelete: "restrict",
      },
    ]);
    expect(contractForeignKeys.size).toBe(3);
    for (const fk of actual) {
      expect(contractForeignKeys.get(fk.name)).toBe(
        `FOREIGN KEY (${fk.columns.join(", ")}) REFERENCES app.business_profiles(id) ON DELETE RESTRICT`,
      );
    }
  });

  it("TC-DB-ARC-007-001 business_profiles has no foreign keys and the contract declares exactly the app tables of migrations 0001-0003", async () => {
    const schemaModule = await import("@off-r39x/db/schema");
    expect(getTableConfig(schemaModule.businessProfiles).foreignKeys).toHaveLength(0);
    expect(
      contract.tables.map(([name]) => name).filter((name) => name !== "schema_migrations"),
    ).toEqual([
      "announcements",
      "audit_events",
      "business_profiles",
      "entry_ticket_offerings",
      "events",
      "faq_items",
      "goods",
      "goods_inventory",
      "karaoke_sales_configurations",
      "role_assignments",
      "sponsor_logos",
    ]);
  });
});
