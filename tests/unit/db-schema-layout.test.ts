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
  checks: { name: string }[];
  primaryKeys: DrizzleNamedColumns[];
  uniqueConstraints: DrizzleNamedColumns[];
}
const { getTableConfig } = dbRequire("drizzle-orm/pg-core") as {
  getTableConfig(table: unknown): DrizzleTableConfig;
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

const EXPECTED_ROOT_EXPORTS = [
  "TransactionDeadlineError",
  "checkReadiness",
  "computeMigrationSetHash",
  "createDatabase",
  "createPrincipalRepository",
  "installBaselineRoles",
  "installIdentityDirectory",
  "migrationIdentity",
  "runMigrations",
  "sqlState",
  "transaction",
  "withWorkerAdvisoryLock",
];

describe("TC-DEV-DB-001-001 db package public surface", () => {
  it("TC-DEV-DB-001-001 @off-r39x/db/schema exports exactly app, businessProfiles and roleAssignments", async () => {
    const schemaModule = await import("@off-r39x/db/schema");

    // (1) no helper or extra name leaks through the barrel (DEV-DB-001).
    expect(Object.keys(schemaModule).sort()).toEqual([
      "app",
      "businessProfiles",
      "roleAssignments",
    ]);

    // (2) the shared pgSchema object is the "app" schema.
    expect((schemaModule.app as unknown as { schemaName: string }).schemaName).toBe("app");

    // (3) both tables live in that same schema, and the contract agrees.
    const profiles = getTableConfig(schemaModule.businessProfiles);
    const roles = getTableConfig(schemaModule.roleAssignments);
    expect(profiles.schema).toBe("app");
    expect(roles.schema).toBe("app");
    expect(profiles.schema).toBe(
      (schemaModule.app as unknown as { schemaName: string }).schemaName,
    );
    expect(contract.schemas.map(([name]) => name)).toContain("app");
  });

  it("TC-DEV-DB-001-001 @off-r39x/db root exports exactly the 12 runtime names", async () => {
    const rootModule = await import("@off-r39x/db");

    // (4) runtime exports only; type-only exports are erased and out of scope. Importing the
    // package must not open a connection: createDatabase is never called here.
    expect(Object.keys(rootModule).sort()).toEqual(EXPECTED_ROOT_EXPORTS);
    expect(EXPECTED_ROOT_EXPORTS).toHaveLength(12);
    // The schema is intentionally not part of the root surface.
    expect(rootModule).not.toHaveProperty("businessProfiles");
    expect(rootModule).not.toHaveProperty("roleAssignments");
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
        expect(definition).toBeDefined();
        expect(definition).toContain("CREATE UNIQUE INDEX");
        expect(definition).toContain(
          "USING btree (profile_id, role) WHERE (state = 'ACTIVE'::text)",
        );
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

  it("TC-DB-ARC-007-001 business_profiles has no foreign keys and no declared tables beyond the two", async () => {
    const schemaModule = await import("@off-r39x/db/schema");
    expect(getTableConfig(schemaModule.businessProfiles).foreignKeys).toHaveLength(0);
    expect(
      contract.tables.map(([name]) => name).filter((name) => name !== "schema_migrations"),
    ).toEqual(["business_profiles", "role_assignments"]);
  });
});
