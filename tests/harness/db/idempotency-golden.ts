// PR-S0-3d test harness: the hand-written goldens of app.idempotency_records (SPEC-100 section 43.1,
// DB-IDM-001 to DB-IDM-003, section 45.6) in the PostgreSQL 17 catalog notation (format_type,
// pg_get_expr, pg_get_constraintdef, pg_get_indexdef). They are written from the specification and the
// approved plan decisions, never derived from schema-contract.json or from the migration, so the
// contract, the Drizzle declaration and the live catalog are each checked against them. No database and
// no production import: both the unit test of the Drizzle declaration and the real PG17 test use this.

export const IDEMPOTENCY_TABLE = "idempotency_records";

const TSTZ = "timestamp with time zone";

/** [name, format_type, attnotnull, attidentity, pg_get_expr(default)] in attnum order (section 43.1). */
export type GoldenColumn = [
  name: string,
  type: string,
  notNull: boolean,
  identity: string,
  defaultExpr: string | null,
];
export const GOLDEN_COLUMNS: readonly GoldenColumn[] = [
  ["id", "bigint", true, "a", null],
  ["principal_profile_id", "bigint", true, "", null],
  ["operation_id", "text", true, "", null],
  ["key_digest", "bytea", true, "", null],
  ["request_digest", "bytea", true, "", null],
  ["result_ref_type", "text", false, "", null],
  ["result_refs", "uuid[]", true, "", "'{}'::uuid[]"],
  ["created_at", TSTZ, true, "", "transaction_timestamp()"],
  ["expires_at", TSTZ, true, "", "(transaction_timestamp() + '24:00:00'::interval)"],
];

/** [conname, contype, pg_get_constraintdef]. The UNIQUE key is an index, not a constraint (plan C2). */
export type GoldenConstraint = [name: string, kind: string, definition: string];
export const GOLDEN_CONSTRAINTS: readonly GoldenConstraint[] = [
  ["pk_idempotency_records", "p", "PRIMARY KEY (id)"],
  [
    "fk_idempotency_records_principal_profile",
    "f",
    "FOREIGN KEY (principal_profile_id) REFERENCES app.business_profiles(id) ON DELETE RESTRICT",
  ],
  ["ck_idempotency_records_key_digest", "c", "CHECK ((octet_length(key_digest) = 32))"],
  ["ck_idempotency_records_request_digest", "c", "CHECK ((octet_length(request_digest) = 32))"],
  [
    "ck_idempotency_records_expiry",
    "c",
    "CHECK ((expires_at = (created_at + '24:00:00'::interval)))",
  ],
  [
    "ck_idempotency_records_result_ref",
    "c",
    "CHECK (((result_ref_type IS NULL) = (cardinality(result_refs) = 0)))",
  ],
];

/** [index name, pg_get_indexdef]. Exactly these two: no index besides PK and the UNIQUE key (DB-IDX-001). */
export type GoldenIndex = [name: string, definition: string];
export const GOLDEN_INDEXES: readonly GoldenIndex[] = [
  [
    "pk_idempotency_records",
    "CREATE UNIQUE INDEX pk_idempotency_records ON app.idempotency_records USING btree (id)",
  ],
  [
    "ux_idempotency_records_principal_operation_key",
    "CREATE UNIQUE INDEX ux_idempotency_records_principal_operation_key ON app.idempotency_records USING btree (principal_profile_id, operation_id, key_digest)",
  ],
];

export const GOLDEN_SEQUENCE = ["idempotency_records_id_seq", "bigint", "app_migrator"] as const;
/** [relname, relkind, owner, relrowsecurity] as schema-contract.json lists a table. */
export const GOLDEN_TABLE_ROW = [IDEMPOTENCY_TABLE, "r", "app_migrator", false] as const;

// PostgreSQL's `name` columns sort by byte order, which equals the UTF-16 order for ASCII.
export const byFirst = <T extends readonly [string, ...unknown[]]>(a: T, b: T) =>
  a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
