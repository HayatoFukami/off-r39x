import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  AUDIT_EFFECTIVE_ROLES,
  AUDIT_FAILURE_CLASSES,
  AUDIT_PROVIDERS,
  AUDIT_TARGET_TYPES,
} from "../../packages/db/src/audit-events.ts";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_EVENT_TYPES,
  AUDIT_PRECONDITION_RESULTS,
  AUDIT_RESULTS,
} from "../../packages/db/src/schema/audit.ts";

// PR-S0-4 C1: pins the Drizzle declaration of app.audit_events (SPEC-160 §33) against the reviewed
// schema-contract.json and against goldens written by hand from SPEC-160 §33.1 / §32 / §19 and the
// PostgreSQL 17 notation. Static only: no database. DB enforcement of the same table is
// TC-OBS-AUD-004-001/002 and TC-DB-009-001 on real PostgreSQL 17 (TST-UNT-001, TST-GEN-004).
// The serialisation approach mirrors db-schema-layout.test.ts; helpers are intentionally copied, not shared.

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
interface DrizzleIndexColumn {
  name: string;
  indexConfig?: { order?: string };
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
  foreignKeys: unknown[];
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
const TABLE = "audit_events";
const contractColumns = contract.columns.filter(([table]) => table === TABLE);
const contractConstraints = contract.constraints.filter(([table]) => table === TABLE);
const contractIndexes = contract.indexes.filter(([table]) => table === TABLE);

const load = async () => {
  const schemaModule = await import("@off-r39x/db/schema");
  return getTableConfig(schemaModule.auditEvents);
};

// ---- goldens (SPEC-160 §33.1, §32, §19; PostgreSQL 17 notation) --------------------------------

// [name, SQL type in PostgreSQL notation, NOT NULL, identity, generated, default] in column order.
const GOLDEN_COLUMNS: [string, string, boolean, string, string, string | null][] = [
  ["id", "bigint", true, "a", "", null],
  ["audit_event_id", "uuid", true, "", "", "gen_random_uuid()"],
  ["occurred_at", "timestamp with time zone", true, "", "", "transaction_timestamp()"],
  ["audit_event_type", "text", true, "", "", null],
  ["actor_type", "text", true, "", "", null],
  ["actor_ref", "text", false, "", "", null],
  ["effective_role", "text", false, "", "", null],
  ["capability", "text", false, "", "", null],
  ["operation_id", "text", true, "", "", null],
  ["operation_execution_id", "uuid", true, "", "", null],
  ["target_type", "text", false, "", "", null],
  ["target_ref", "text", false, "", "", null],
  ["request_id", "uuid", false, "", "", null],
  ["business_cause_ref", "text", false, "", "", null],
  ["transport_idempotency_fp", "character(32)", false, "", "", null],
  ["provider", "text", false, "", "", null],
  ["provider_event_ref", "text", false, "", "", null],
  ["provider_object_ref", "text", false, "", "", null],
  ["provider_idempotency_fp", "character(32)", false, "", "", null],
  ["precondition_result", "text", true, "", "", null],
  ["audit_result", "text", true, "", "", null],
  ["failure_class", "text", false, "", "", null],
  ["reason_code", "text", false, "", "", null],
  ["before_state", "text", false, "", "", null],
  ["after_state", "text", false, "", "", null],
  ["changed_fields", "text[]", true, "", "", "'{}'::text[]"],
  ["safe_change_summary", "jsonb", true, "", "", "'{}'::jsonb"],
  ["consistency_review_ref", "uuid", false, "", "", null],
  ["recovery_execution_id", "uuid", false, "", "", null],
  ["created_at", "timestamp with time zone", true, "", "", "transaction_timestamp()"],
];

// Drizzle names fixed-length character columns char(n); PostgreSQL's format_type spells it
// character(n). This is the only spelling difference between the two sides.
const DRIZZLE_TO_PG_TYPE: Record<string, string> = { "char(32)": "character(32)" };

const GOLDEN_DEFAULT_COLUMNS = [
  "audit_event_id",
  "occurred_at",
  "changed_fields",
  "safe_change_summary",
  "created_at",
];

const AUDIT_EVENT_TYPE_VALUES = [
  "PRIVILEGED_OPERATION",
  "PRIVILEGED_OPERATION_DENIED",
  "BUSINESS_EFFECT",
  "RECOVERY_EXECUTION",
  "SECURITY_SENSITIVE_OPERATION",
  "EMERGENCY_ADMIN_RECOVERY",
];
const ACTOR_TYPE_VALUES = [
  "GUEST",
  "AUTHENTICATED_USER",
  "STAFF",
  "ADMINISTRATOR",
  "SYSTEM_WORKER",
  "SCHEDULED_RECONCILIATION",
  "EXTERNAL_PROVIDER",
  "INFRASTRUCTURE_OPERATOR",
];
const PRECONDITION_RESULT_VALUES = ["PASSED", "FAILED", "NOT_APPLICABLE", "UNKNOWN"];
const AUDIT_RESULT_VALUES = [
  "REQUESTED",
  "AUTHORIZED",
  "REJECTED",
  "COMMITTED",
  "NOOP",
  "PENDING",
  "UNKNOWN",
  "FAILED",
];

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(",");
// Raw SQL as declared (compared exactly, in the style of identity.ts: no space after the comma).
const GOLDEN_CHECKS: Record<string, string> = {
  ck_audit_events_audit_event_type: `audit_event_type IN (${quoted(AUDIT_EVENT_TYPE_VALUES)})`,
  ck_audit_events_actor_type: `actor_type IN (${quoted(ACTOR_TYPE_VALUES)})`,
  ck_audit_events_precondition_result: `precondition_result IN (${quoted(PRECONDITION_RESULT_VALUES)})`,
  ck_audit_events_audit_result: `audit_result IN (${quoted(AUDIT_RESULT_VALUES)})`,
};
const GOLDEN_CHECK_LITERALS: Record<string, string[]> = {
  ck_audit_events_audit_event_type: AUDIT_EVENT_TYPE_VALUES,
  ck_audit_events_actor_type: ACTOR_TYPE_VALUES,
  ck_audit_events_precondition_result: PRECONDITION_RESULT_VALUES,
  ck_audit_events_audit_result: AUDIT_RESULT_VALUES,
};

// pg_get_constraintdef text of the reviewed contract, pinned independently of the Drizzle side.
const GOLDEN_CONTRACT_CONSTRAINTS: [string, string, string][] = [
  [
    "ck_audit_events_actor_type",
    "c",
    "CHECK ((actor_type = ANY (ARRAY['GUEST'::text, 'AUTHENTICATED_USER'::text, 'STAFF'::text, 'ADMINISTRATOR'::text, 'SYSTEM_WORKER'::text, 'SCHEDULED_RECONCILIATION'::text, 'EXTERNAL_PROVIDER'::text, 'INFRASTRUCTURE_OPERATOR'::text])))",
  ],
  [
    "ck_audit_events_audit_event_type",
    "c",
    "CHECK ((audit_event_type = ANY (ARRAY['PRIVILEGED_OPERATION'::text, 'PRIVILEGED_OPERATION_DENIED'::text, 'BUSINESS_EFFECT'::text, 'RECOVERY_EXECUTION'::text, 'SECURITY_SENSITIVE_OPERATION'::text, 'EMERGENCY_ADMIN_RECOVERY'::text])))",
  ],
  [
    "ck_audit_events_audit_result",
    "c",
    "CHECK ((audit_result = ANY (ARRAY['REQUESTED'::text, 'AUTHORIZED'::text, 'REJECTED'::text, 'COMMITTED'::text, 'NOOP'::text, 'PENDING'::text, 'UNKNOWN'::text, 'FAILED'::text])))",
  ],
  [
    "ck_audit_events_precondition_result",
    "c",
    "CHECK ((precondition_result = ANY (ARRAY['PASSED'::text, 'FAILED'::text, 'NOT_APPLICABLE'::text, 'UNKNOWN'::text])))",
  ],
  ["pk_audit_events", "p", "PRIMARY KEY (id)"],
  ["uq_audit_events_audit_event_id", "u", "UNIQUE (audit_event_id)"],
];

// pg_get_indexdef text of the reviewed contract (SPEC-160 §33.1 indexes), by index name.
const GOLDEN_CONTRACT_INDEXES: [string, string][] = [
  [
    "ix_audit_events_actor_time",
    "CREATE INDEX ix_audit_events_actor_time ON app.audit_events USING btree (actor_ref, occurred_at DESC) WHERE (actor_ref IS NOT NULL)",
  ],
  [
    "ix_audit_events_occurred_at",
    "CREATE INDEX ix_audit_events_occurred_at ON app.audit_events USING btree (occurred_at DESC)",
  ],
  [
    "ix_audit_events_operation_time",
    "CREATE INDEX ix_audit_events_operation_time ON app.audit_events USING btree (operation_id, occurred_at DESC)",
  ],
  [
    "ix_audit_events_recovery",
    "CREATE INDEX ix_audit_events_recovery ON app.audit_events USING btree (recovery_execution_id) WHERE (recovery_execution_id IS NOT NULL)",
  ],
  [
    "ix_audit_events_request",
    "CREATE INDEX ix_audit_events_request ON app.audit_events USING btree (request_id) WHERE (request_id IS NOT NULL)",
  ],
  [
    "ix_audit_events_review",
    "CREATE INDEX ix_audit_events_review ON app.audit_events USING btree (consistency_review_ref) WHERE (consistency_review_ref IS NOT NULL)",
  ],
  [
    "ix_audit_events_target_time",
    "CREATE INDEX ix_audit_events_target_time ON app.audit_events USING btree (target_type, target_ref, occurred_at DESC) WHERE (target_ref IS NOT NULL)",
  ],
  ["pk_audit_events", "CREATE UNIQUE INDEX pk_audit_events ON app.audit_events USING btree (id)"],
  [
    "uq_audit_events_audit_event_id",
    "CREATE UNIQUE INDEX uq_audit_events_audit_event_id ON app.audit_events USING btree (audit_event_id)",
  ],
];

// The seven Drizzle-declared indexes: [name, [column, order], partial predicate column].
const GOLDEN_DECLARED_INDEXES: [string, [string, string][], string | null][] = [
  ["ix_audit_events_occurred_at", [["occurred_at", "desc"]], null],
  [
    "ix_audit_events_actor_time",
    [
      ["actor_ref", "asc"],
      ["occurred_at", "desc"],
    ],
    "actor_ref",
  ],
  [
    "ix_audit_events_operation_time",
    [
      ["operation_id", "asc"],
      ["occurred_at", "desc"],
    ],
    null,
  ],
  [
    "ix_audit_events_target_time",
    [
      ["target_type", "asc"],
      ["target_ref", "asc"],
      ["occurred_at", "desc"],
    ],
    "target_ref",
  ],
  ["ix_audit_events_request", [["request_id", "asc"]], "request_id"],
  ["ix_audit_events_recovery", [["recovery_execution_id", "asc"]], "recovery_execution_id"],
  ["ix_audit_events_review", [["consistency_review_ref", "asc"]], "consistency_review_ref"],
];

// Values written by hand from SPEC-160 §33.1, SPEC-150 §8 and SPEC-160 §20.
const SPEC_EFFECTIVE_ROLES = ["STAFF", "ADMINISTRATOR"];
const SPEC_PROVIDERS = ["STRIPE", "RESEND", "NEON_AUTH", "NEON_DB"];
const SPEC_FAILURE_CLASSES = [
  "SUCCESS",
  "TEMPORARY_FAILURE",
  "PERMANENT_FAILURE",
  "UNKNOWN_RESULT",
  "CONFLICT_LOSER",
  "CONSISTENCY_FAILURE",
  "SECURITY_FAILURE",
];
const SPEC_TARGET_TYPES = [
  "ORDER",
  "CHECKOUT_ATTEMPT",
  "REFUND",
  "ENTRY_TICKET",
  "KARAOKE_TICKET",
  "ENTRY_CHECKIN",
  "KARAOKE_CHECKIN",
  "KARAOKE_SLOT",
  "KARAOKE_HOLD",
  "KARAOKE_RESERVATION",
  "GOODS",
  "GOODS_ALLOCATION",
  "GOODS_HANDOFF",
  "NOTIFICATION_REQUEST",
  "EMAIL_DELIVERY_JOB",
  "EMAIL_DELIVERY_ATTEMPT",
  "ROLE_ASSIGNMENT",
  "CONSISTENCY_REVIEW",
  "PUBLIC_CONTENT",
  "SECURITY_CONFIGURATION",
  "WEBHOOK_RECEIPT",
];

// ---- expression helpers (same method as db-schema-layout.test.ts) ------------------------------

const dialect = new PgDialect();

function serialize(expression: unknown, what: string): string {
  expect(expression, `${what} is declared`).toBeDefined();
  const query = dialect.sqlToQuery(expression);
  expect(query.params, `${what} must not carry bind parameters`).toEqual([]);
  return query.sql;
}

function stripSchemaQualifiers(sqlText: string, what: string): string {
  const bare = sqlText.replace(new RegExp(`"app"\\."${TABLE}"\\."([a-z_]+)"`, "g"), "$1");
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

// ---- tests -------------------------------------------------------------------------------------

describe("TC-DB-ARC-007-002 Drizzle declaration of app.audit_events matches the contract and the SPEC-160 goldens", () => {
  it("TC-DB-ARC-007-002 the contract describes the audit_events table, sequence and 30/6/9 catalog rows", () => {
    expect(contract.tables.map(([name]) => name)).toContain(TABLE);
    expect(contract.tables.find(([name]) => name === TABLE)).toEqual([
      TABLE,
      "r",
      "app_migrator",
      false,
    ]);
    expect(contract.sequences.find(([name]) => name === "audit_events_id_seq")).toEqual([
      "audit_events_id_seq",
      "bigint",
      "app_migrator",
    ]);
    // The contract rows equal the hand-written golden, so a contract-only edit fails here.
    expect(GOLDEN_COLUMNS).toHaveLength(30);
    expect(
      contractColumns.map(([, name, type, notNull, identity, generated, defaultExpr]) => [
        name,
        type,
        notNull,
        identity,
        generated,
        defaultExpr,
      ]),
    ).toEqual(GOLDEN_COLUMNS);
    expect(
      contractConstraints.map(([, name, kind, definition]) => [name, kind, definition]),
    ).toEqual(GOLDEN_CONTRACT_CONSTRAINTS);
    expect(contractIndexes).toHaveLength(9);
    expect(contractIndexes.map(([, definition]) => definition)).toEqual(
      GOLDEN_CONTRACT_INDEXES.map(([, definition]) => definition),
    );
    for (const [, , ...flags] of contractIndexes) expect(flags).toEqual([true, true, true]);
    for (const [, , , , ...flags] of contractConstraints)
      expect(flags).toEqual([true, false, false]);
  });

  it("TC-DB-ARC-007-002 table name and schema name", async () => {
    const config = await load();
    expect(config.name).toBe(TABLE);
    expect(config.schema).toBe("app");
  });

  it("TC-DB-ARC-007-002 columns: order, name and NOT NULL equal the contract; SQL type equals it through the char(n) mapping", async () => {
    const config = await load();
    expect(config.columns).toHaveLength(30);
    expect(
      config.columns.map((column) => [
        column.name,
        DRIZZLE_TO_PG_TYPE[column.getSQLType()] ?? column.getSQLType(),
        column.notNull,
      ]),
    ).toEqual(contractColumns.map(([, name, type, notNull]) => [name, type, notNull]));
  });

  it("TC-DB-ARC-007-002 columns: identity always on id only", async () => {
    const config = await load();
    for (const [, name, , , identity] of contractColumns) {
      const column = config.columns.find((c) => c.name === name);
      expect(column, `column ${name}`).toBeDefined();
      expect(column?.generatedIdentity?.type, `identity of ${name}`).toBe(
        identity === "a" ? "always" : undefined,
      );
    }
    expect(
      config.columns.filter((column) => column.generatedIdentity).map((column) => column.name),
    ).toEqual(["id"]);
  });

  it("TC-DB-ARC-007-002 columns: exactly five defaults, with the golden expressions that equal the contract", async () => {
    const config = await load();
    const withDefault = config.columns
      .filter((column) => !column.generatedIdentity && column.hasDefault)
      .map((column) => column.name);
    expect(withDefault).toEqual(GOLDEN_DEFAULT_COLUMNS);
    const actual: Record<string, string> = {};
    for (const column of config.columns) {
      if (column.generatedIdentity || !column.hasDefault) continue;
      actual[column.name] = serialize(column.default, `default of ${column.name}`);
    }
    // (1) exact expression text: transaction_timestamp() must not become clock_timestamp(), '{}' must stay empty.
    expect(actual).toEqual({
      audit_event_id: "gen_random_uuid()",
      occurred_at: "transaction_timestamp()",
      changed_fields: "'{}'::text[]",
      safe_change_summary: "'{}'::jsonb",
      created_at: "transaction_timestamp()",
    });
    // (2) the same text as the reviewed contract; every other column has no default there either.
    for (const [, name, , , identity, , defaultExpr] of contractColumns) {
      if (identity !== "") continue;
      expect(defaultExpr, `contract default of ${name}`).toBe(actual[name] ?? null);
    }
  });

  it("TC-DB-ARC-007-002 columns: id is a lossless bigint (PgBigInt64) and nothing else is bigint (DEV-DB-006)", async () => {
    const config = await load();
    for (const column of config.columns) {
      if (column.name === "id") expect(column.columnType).toBe("PgBigInt64");
      else expect(column.columnType, `columnType of ${column.name}`).not.toMatch(/^PgBigInt/);
    }
  });

  it("TC-DB-ARC-007-002 constraints: names and kinds (1 primary key, 1 unique, 4 check, no foreign key) equal the contract", async () => {
    const config = await load();
    const declared = new Map<string, string>();
    const add = (name: string, kind: string) => {
      expect(declared.has(name), `duplicate constraint name ${name}`).toBe(false);
      declared.set(name, kind);
    };
    for (const entry of config.primaryKeys) add(constraintName(entry), "p");
    for (const entry of config.uniqueConstraints) add(constraintName(entry), "u");
    for (const entry of config.checks) add(entry.name, "c");
    expect(config.foreignKeys).toHaveLength(0);
    expect([...declared.values()].sort()).toEqual(["c", "c", "c", "c", "p", "u"]);
    expect([...declared.entries()].sort()).toEqual(
      contractConstraints.map(([, name, kind]) => [name, kind] as [string, string]).sort(),
    );
    expect(
      config.primaryKeys.map((entry) => `PRIMARY KEY (${entry.columns.map((c) => c.name)})`),
    ).toEqual(["PRIMARY KEY (id)"]);
    expect(
      config.uniqueConstraints.map((entry) => `UNIQUE (${entry.columns.map((c) => c.name)})`),
    ).toEqual(["UNIQUE (audit_event_id)"]);
  });

  it("TC-DB-ARC-007-002 constraints: CHECK expressions equal the golden exactly and match the contract by column, literals and order", async () => {
    const config = await load();
    const columnNames = config.columns.map((c) => c.name);
    const actual: Record<string, string> = {};
    for (const check of config.checks) {
      actual[check.name] = stripSchemaQualifiers(
        serialize(check.value, `CHECK ${check.name}`),
        `CHECK ${check.name}`,
      );
    }
    // (1) exact expression text, including the order of the allowed values.
    expect(actual).toEqual(GOLDEN_CHECKS);
    // (2) the literals equal the exported allowlist constants in the same order.
    expect(literalsInOrder(actual.ck_audit_events_audit_event_type as string)).toEqual([
      ...AUDIT_EVENT_TYPES,
    ]);
    expect(literalsInOrder(actual.ck_audit_events_actor_type as string)).toEqual([
      ...AUDIT_ACTOR_TYPES,
    ]);
    expect(literalsInOrder(actual.ck_audit_events_precondition_result as string)).toEqual([
      ...AUDIT_PRECONDITION_RESULTS,
    ]);
    expect(literalsInOrder(actual.ck_audit_events_audit_result as string)).toEqual([
      ...AUDIT_RESULTS,
    ]);
    // (3) the contract's normalised definition has the same column and literals (also in order).
    const contractChecks = contractConstraints.filter(([, , kind]) => kind === "c");
    expect(contractChecks.map(([, name]) => name).sort()).toEqual(
      Object.keys(GOLDEN_CHECKS).sort(),
    );
    for (const [, name, , definition] of contractChecks) {
      const expression = contractCheckExpression(definition);
      expect(tokens(actual[name] as string, columnNames), `tokens of ${name}`).toEqual(
        tokens(expression, columnNames),
      );
      expect(literalsInOrder(expression), `literal order of ${name}`).toEqual(
        GOLDEN_CHECK_LITERALS[name],
      );
    }
  });

  it("TC-DB-ARC-007-002 the exported allowlist constants equal the hand-written SPEC-160 §32 / §19 lists", () => {
    expect([...AUDIT_EVENT_TYPES]).toEqual(AUDIT_EVENT_TYPE_VALUES);
    expect([...AUDIT_ACTOR_TYPES]).toEqual(ACTOR_TYPE_VALUES);
    expect([...AUDIT_PRECONDITION_RESULTS]).toEqual(PRECONDITION_RESULT_VALUES);
    expect([...AUDIT_RESULTS]).toEqual(AUDIT_RESULT_VALUES);
  });

  it("TC-DB-ARC-007-002 indexes: seven declared ix_audit_events_* with the golden columns, order and partial predicates", async () => {
    const config = await load();
    expect(config.indexes).toHaveLength(7);
    const byName = new Map(config.indexes.map((index) => [index.config.name, index]));
    expect([...byName.keys()].sort()).toEqual(GOLDEN_DECLARED_INDEXES.map(([name]) => name).sort());
    let partial = 0;
    for (const [name, columns, predicateColumn] of GOLDEN_DECLARED_INDEXES) {
      const index = byName.get(name);
      expect(index, name).toBeDefined();
      expect(index?.config.unique, `${name} uniqueness`).toBe(false);
      expect(index?.config.method, `${name} method`).toBe("btree");
      expect(
        index?.config.columns.map((c) => [c.name, c.indexConfig?.order ?? "asc"]),
        `${name} columns`,
      ).toEqual(columns);
      if (predicateColumn === null) {
        expect(index?.config.where, `${name} has no predicate`).toBeUndefined();
        continue;
      }
      partial++;
      const where = stripSchemaQualifiers(
        serialize(index?.config.where, `${name} predicate`),
        `${name} predicate`,
      );
      expect(where, `${name} predicate`).toBe(`${predicateColumn} IS NOT NULL`);
    }
    expect(partial).toBe(5);
  });

  it("TC-DB-ARC-007-002 indexes: each declared index is the contract's pg_get_indexdef, which equals the SPEC-160 §33.1 golden", async () => {
    const config = await load();
    const contractByName = new Map(
      contractIndexes.map(([, definition]) => [
        /^CREATE (?:UNIQUE )?INDEX (\S+) /.exec(definition)?.[1],
        definition,
      ]),
    );
    expect(contractIndexes).toHaveLength(9);
    // (1) the contract's nine definitions equal the golden exactly, by name.
    expect([...contractByName.entries()].sort()).toEqual([...GOLDEN_CONTRACT_INDEXES].sort());
    // (2) the primary key and the unique constraint are the two unique indexes of the contract.
    expect(contractByName.get("pk_audit_events")).toBe(
      "CREATE UNIQUE INDEX pk_audit_events ON app.audit_events USING btree (id)",
    );
    expect(contractByName.get("uq_audit_events_audit_event_id")).toBe(
      "CREATE UNIQUE INDEX uq_audit_events_audit_event_id ON app.audit_events USING btree (audit_event_id)",
    );
    // (3) the Drizzle declaration, rendered the PostgreSQL way, is the contract's definition.
    for (const index of config.indexes) {
      const columns = index.config.columns
        .map((c) => `${c.name}${c.indexConfig?.order === "desc" ? " DESC" : ""}`)
        .join(", ");
      const where =
        index.config.where === undefined
          ? ""
          : ` WHERE (${stripSchemaQualifiers(serialize(index.config.where, "predicate"), "predicate")})`;
      expect(contractByName.get(index.config.name), index.config.name).toBe(
        `CREATE INDEX ${index.config.name} ON app.${TABLE} USING btree (${columns})${where}`,
      );
    }
  });

  it("TC-DB-ARC-007-002 the writer-only allowlists equal the hand-written SPEC-160 §33.1 / SPEC-150 §8 / SPEC-160 §20 lists", () => {
    expect([...AUDIT_EFFECTIVE_ROLES]).toEqual(SPEC_EFFECTIVE_ROLES);
    expect([...AUDIT_PROVIDERS]).toEqual(SPEC_PROVIDERS);
    expect([...AUDIT_FAILURE_CLASSES]).toEqual(SPEC_FAILURE_CLASSES);
    expect([...AUDIT_TARGET_TYPES]).toEqual(SPEC_TARGET_TYPES);
    expect(SPEC_TARGET_TYPES).toHaveLength(21);
  });
});
