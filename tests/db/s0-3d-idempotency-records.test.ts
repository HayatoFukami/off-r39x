import { readFile } from "node:fs/promises";
import { Client, type Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, runMigrations } from "../../packages/db/src/index.ts";
import { migrationIdentities } from "../../packages/db/src/migrations.ts";
import { catalogQuery, requiredCatalog } from "../../packages/db/src/schema-contract.ts";
import { prepareFoundationDatabase } from "../harness/db/foundation.ts";
import {
  claimInput,
  claimInTransaction,
  digest,
  hex,
  insertProfile,
  installSyntheticBusiness,
  OPERATION_ID,
  OTHER_OPERATION_ID,
  profileLockingEffect,
  recordCount,
  recordRows,
  ref,
  resetRecords,
} from "../harness/db/idempotency.ts";
import {
  byFirst,
  GOLDEN_COLUMNS,
  GOLDEN_CONSTRAINTS,
  GOLDEN_INDEXES,
  GOLDEN_SEQUENCE,
  GOLDEN_TABLE_ROW,
  IDEMPOTENCY_TABLE,
} from "../harness/db/idempotency-golden.ts";

// PR-S0-3d C1 (SPEC-100 section 43.1, SPEC-110 section 18.1, SPEC-170 sections 22 and 28.1): the table
// app.idempotency_records, its constraints, its single UNIQUE index, its privileges and the Principal /
// Operation scoping of the key, on a real PostgreSQL 17. DB constraints are never proven by a fake
// (TST-GEN-004, DEV-TST-003). The catalog goldens come from tests/harness/db/idempotency-golden.ts, which
// is written by hand from SPEC-100 and the PostgreSQL 17 notation; they are not derived from
// schema-contract.json or from the migration. Every violating row breaks exactly one constraint, and each
// assertion checks the SQLSTATE and the constraint name together. The migration is found by its
// `_idempotency_records.sql` suffix, not by its number (the number is decided at merge time). Synthetic
// data only.

const url = process.env.TEST_DATABASE_URL;
const caPath = process.env.TEST_DATABASE_CA;
if (!url || !caPath) throw new Error("Real PG17 requires TEST_DATABASE_URL and TEST_DATABASE_CA");

const T = `app.${IDEMPOTENCY_TABLE}`;
const PROFILE_A = ref(0xa1);
const PROFILE_B = ref(0xa2);
const SERVICES = [
  ["app_api_runtime", "api"],
  ["app_email_runtime", "email-worker"],
  ["app_reconciliation_runtime", "reconciliation-worker"],
] as const;

let admin: Client;
let profileA: string;
let profileB: string;
const pools = new Map<string, ReturnType<typeof createDatabase>>();
const poolOf = (role: string): Pool => {
  const opened = pools.get(role);
  if (!opened) throw new Error(`pool ${role} is not open`);
  return opened.pool;
};

beforeAll(async () => {
  admin = new Client({ connectionString: url });
  await admin.connect();
  await prepareFoundationDatabase(admin);
  await installSyntheticBusiness(admin);
  profileA = await insertProfile(admin, PROFILE_A);
  profileB = await insertProfile(admin, PROFILE_B);
  const ca = await readFile(caPath as string, "utf8");
  for (const [role, service] of SERVICES) {
    const runtimeUrl = new URL(url as string);
    runtimeUrl.username = role;
    runtimeUrl.password = "";
    runtimeUrl.search = "";
    pools.set(
      role,
      createDatabase({ connectionString: runtimeUrl.href, environment: "test", service, ca }),
    );
  }
});
afterAll(async () => {
  for (const opened of pools.values()) await opened.close();
  await admin?.end();
});
beforeEach(async () => {
  await resetRecords(admin);
});

interface PgError {
  code?: string;
  constraint?: string;
  column?: string;
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
async function inRolledBackTransaction<T>(run: () => Promise<T>): Promise<T> {
  await admin.query("BEGIN");
  try {
    return await run();
  } finally {
    await admin.query("ROLLBACK");
  }
}
function expectViolation(error: PgError | undefined, code: string, name: string, label: string) {
  expect(error, `${label}: must be rejected`).toBeDefined();
  expect(error?.code, `${label}: SQLSTATE`).toBe(code);
  expect(code === "23502" ? error?.column : error?.constraint, `${label}: ${name}`).toBe(name);
}

const KEY = digest("synthetic-idem-key-records-0001");
const REQUEST = digest("synthetic-request-records-0001");
/** A valid row, as bound parameters: principal, operation, key digest, request digest (the rest default). */
const insertValid = (
  principal: string,
  overrides: { key?: Uint8Array; request?: Uint8Array } = {},
): [string, unknown[]] => [
  `INSERT INTO ${T}(principal_profile_id, operation_id, key_digest, request_digest) VALUES ($1::bigint, $2, $3, $4)`,
  [
    principal,
    OPERATION_ID,
    Buffer.from(overrides.key ?? KEY),
    Buffer.from(overrides.request ?? REQUEST),
  ],
];

// ---- TC-DB-IDM-001-001 ---------------------------------------------------------------------------

describe("TC-DB-IDM-001-001 migration and catalog of app.idempotency_records (real PostgreSQL 17)", () => {
  it("TC-DB-IDM-001-001 the journal lists the idempotency_records migration once with its source hash, 0001 to 0003 are unchanged, and a second run changes nothing", async () => {
    const identities = await migrationIdentities();
    const found = identities.filter((identity) =>
      identity.name.endsWith("_idempotency_records.sql"),
    );
    expect(found, "exactly one *_idempotency_records.sql migration").toHaveLength(1);
    const mine = found[0];
    expect(mine?.name).toMatch(/^\d{4}_idempotency_records\.sql$/);
    const read = async () =>
      (await admin.query("SELECT version, source_hash FROM app.schema_migrations ORDER BY version"))
        .rows;
    const before = await read();
    expect(before.filter((row) => row.version === mine?.version)).toEqual([
      { version: mine?.version, source_hash: mine?.hash },
    ]);
    expect(new Set(before.map((row) => row.version)).size).toBe(before.length);
    expect(before.map((row) => [row.version, row.source_hash])).toEqual(
      identities.map((identity) => [identity.version, identity.hash]),
    );
    // DB-MIG-005: merged migrations are never edited. Pinned from the committed history.
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

  it("TC-DB-IDM-001-001 the migration only creates the table and its UNIQUE index, with no destructive SQL, row, trigger or function (DB-MIG-002, DB-ARC-007)", async () => {
    const identities = await migrationIdentities();
    const mine = identities.find((identity) => identity.name.endsWith("_idempotency_records.sql"));
    expect(mine, "the idempotency_records migration exists").toBeDefined();
    const sqlText = (mine?.sql ?? "")
      .split(/\r?\n/)
      .map((line) => line.replace(/--.*$/, ""))
      .join("\n");
    const referenced = [...sqlText.matchAll(/\bapp\.([a-z_]+)/g)].map((m) => m[1]);
    expect([...new Set(referenced)].sort()).toEqual(["business_profiles", IDEMPOTENCY_TABLE]);
    for (const forbidden of [
      /\bALTER\b/i,
      /\bDROP\b/i,
      /\bTRUNCATE\b/i,
      /\bDELETE\s+FROM\b/i,
      /\bINSERT\s+INTO\b/i,
      /\bUPDATE\b\s+app\./i,
      /\bCREATE\s+(OR\s+REPLACE\s+)?(TRIGGER|FUNCTION|PROCEDURE|EXTENSION|ROLE|SCHEMA)\b/i,
      /\bOWNER\s+TO\b/i,
      /\bROW\s+LEVEL\s+SECURITY\b/i,
    ]) {
      expect(sqlText, `the migration must not contain ${forbidden}`).not.toMatch(forbidden);
    }
    expect([...sqlText.matchAll(/\bCREATE\s+TABLE\b/gi)]).toHaveLength(1);
    expect(
      [...sqlText.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+([a-z_]+)/gi)].map((m) => m[1]),
    ).toEqual(["ux_idempotency_records_principal_operation_key"]);
  });

  it("TC-DB-IDM-001-001 the nine columns equal the SPEC-100 section 43.1 golden in attnum order (name, type, NOT NULL, identity, default)", async () => {
    const rows = (
      await admin.query(
        `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull,
                a.attidentity, a.attgenerated, pg_get_expr(d.adbin, d.adrelid) AS default_expr
           FROM pg_attribute a
           LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attnum`,
        [T],
      )
    ).rows;
    expect(GOLDEN_COLUMNS).toHaveLength(9);
    expect(
      rows.map((r) => [
        r.attname,
        r.type,
        r.attnotnull,
        r.attidentity,
        r.attgenerated,
        r.default_expr,
      ]),
    ).toEqual(
      GOLDEN_COLUMNS.map(([name, type, notNull, identity, defaultExpr]) => [
        name,
        type,
        notNull,
        identity,
        // expires_at is a plain column with a default, never a generated column (section 43.1).
        "",
        defaultExpr,
      ]),
    );
  });

  it("TC-DB-IDM-001-001 the six constraints equal the golden by name, kind and definition, and are validated and not deferrable", async () => {
    const rows = (
      await admin.query(
        `SELECT conname, contype, pg_get_constraintdef(oid) AS definition, convalidated, condeferrable, condeferred
           FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY conname`,
        [T],
      )
    ).rows;
    expect(rows.map((r) => [r.conname, r.contype, r.definition])).toEqual(
      [...GOLDEN_CONSTRAINTS].sort(byFirst),
    );
    expect(GOLDEN_CONSTRAINTS).toHaveLength(6);
    for (const row of rows) {
      expect([row.convalidated, row.condeferrable, row.condeferred], row.conname).toEqual([
        true,
        false,
        false,
      ]);
    }
  });

  it("TC-DB-IDM-001-001 exactly two valid indexes exist, PK and the UNIQUE key, with no additional index (DB-IDX-001, section 45.6)", async () => {
    const rows = (
      await admin.query(
        `SELECT x.relname AS name, pg_get_indexdef(i.indexrelid) AS definition,
                i.indisvalid, i.indisready, i.indislive, i.indisunique
           FROM pg_index i JOIN pg_class x ON x.oid = i.indexrelid
          WHERE i.indrelid = $1::regclass ORDER BY x.relname`,
        [T],
      )
    ).rows;
    expect(rows.map((r) => [r.name, r.definition])).toEqual([...GOLDEN_INDEXES].sort(byFirst));
    expect(rows.every((r) => r.indisvalid && r.indisready && r.indislive && r.indisunique)).toBe(
      true,
    );
  });

  it("TC-DB-IDM-001-001 owner is app_migrator, row level security is off, there is no trigger of its own, the id sequence matches, and every time column is timestamptz", async () => {
    const table = (
      await admin.query(
        `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity, c.relforcerowsecurity, c.relkind
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app' AND c.relname = $1`,
        [IDEMPOTENCY_TABLE],
      )
    ).rows;
    expect(
      table.map((t) => [t.relname, t.owner, t.relrowsecurity, t.relforcerowsecurity, t.relkind]),
    ).toEqual([[IDEMPOTENCY_TABLE, GOLDEN_TABLE_ROW[2], false, false, "r"]]);
    const sequences = (
      await admin.query(
        `SELECT c.relname, format_type(s.seqtypid, NULL) AS type, pg_get_userbyid(c.relowner) AS owner
           FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app' AND c.relname = $1`,
        [GOLDEN_SEQUENCE[0]],
      )
    ).rows;
    expect(sequences.map((s) => [s.relname, s.type, s.owner])).toEqual([[...GOLDEN_SEQUENCE]]);
    // User triggers: none (the foreign key's own triggers are internal).
    expect(
      (
        await admin.query(
          "SELECT tgname FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal",
          [T],
        )
      ).rows,
    ).toEqual([]);
    const timeColumns = (
      await admin.query(
        `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type
           FROM pg_attribute a
          WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND (a.attname LIKE '%\\_at' OR format_type(a.atttypid, a.atttypmod) LIKE 'timestamp%')
          ORDER BY a.attnum`,
        [T],
      )
    ).rows;
    expect(timeColumns.map((c) => [c.attname, c.type])).toEqual([
      ["created_at", "timestamp with time zone"],
      ["expires_at", "timestamp with time zone"],
    ]);
  });

  it("TC-DB-IDM-001-001 the live catalog equals requiredCatalog and the contract lists the table, its sequence and nothing the golden does not", async () => {
    const live = (await admin.query(catalogQuery)).rows[0].catalog;
    expect(live).toEqual(requiredCatalog);
    // The contract is not vacuous: it describes this table exactly as the hand-written golden does.
    const contract = requiredCatalog as unknown as {
      tables: unknown[][];
      columns: unknown[][];
      constraints: unknown[][];
      indexes: unknown[][];
      sequences: unknown[][];
    };
    const mine = (rows: unknown[][]) => rows.filter((row) => row[0] === IDEMPOTENCY_TABLE);
    expect(mine(contract.tables)).toEqual([[...GOLDEN_TABLE_ROW]]);
    expect(mine(contract.columns).map((r) => r.slice(1))).toEqual(
      GOLDEN_COLUMNS.map(([name, type, notNull, identity, defaultExpr]) => [
        name,
        type,
        notNull,
        identity,
        "",
        defaultExpr,
      ]),
    );
    expect(mine(contract.constraints).map((r) => r.slice(1))).toEqual(
      [...GOLDEN_CONSTRAINTS]
        .sort(byFirst)
        .map(([name, kind, def]) => [name, kind, def, true, false, false]),
    );
    expect(mine(contract.indexes).map((r) => r.slice(1))).toEqual(
      [...GOLDEN_INDEXES].sort(byFirst).map(([, def]) => [def, true, true, true]),
    );
    expect(contract.sequences.filter((row) => row[0] === GOLDEN_SEQUENCE[0])).toEqual([
      [...GOLDEN_SEQUENCE],
    ]);
  });

  it("TC-DB-IDM-001-001 no column can hold a raw key, body, URL, session id, Email or QR: only digests, references and times are stored (DB-IDM-001)", async () => {
    const names = GOLDEN_COLUMNS.map(([name]) => name);
    // key_digest is the SHA-256 of the key (32 bytes, enforced below); every other name is checked.
    for (const name of names.filter((n) => n !== "key_digest")) {
      expect(name, `column ${name}`).not.toMatch(
        /key|body|url|session|email|qr|token|payload|response/,
      );
    }
    const live = (
      await admin.query(
        "SELECT a.attname FROM pg_attribute a WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum",
        [T],
      )
    ).rows.map((r) => r.attname);
    expect(live).toEqual(names);
  });

  it("TC-DB-IDM-001-001 a row written through the claim primitive holds no raw key, request body or Email marker in any column (DB-IDM-001)", async () => {
    const KEY_MARKER = "synthetic-idem-key-marker-0001";
    const BODY_MARKER = "synthetic-body-marker-0001";
    const pool = poolOf("app_api_runtime");
    const done = await profileLockingEffect(pool, {
      ...claimInput(PROFILE_A, KEY_MARKER, BODY_MARKER),
      causeKey: ref(0x501),
      label: "synthetic-label",
    });
    expect(done.status).toBe("committed");
    const json = JSON.stringify(
      (await admin.query(`SELECT row_to_json(r) AS j FROM ${T} r`)).rows.map((row) => row.j),
    );
    expect(json).toContain("SYNTHETIC_EFFECT");
    for (const marker of [KEY_MARKER, BODY_MARKER, "synthetic-label", "@", "http"]) {
      expect(json, `row text must not contain ${marker}`).not.toContain(marker);
    }
    expect(await recordCount(admin)).toBe(1);
  });

  it("TC-DB-IDM-001-001 a key digest or request digest of 31 or 33 bytes is refused with 23514 by its constraint name; 32 bytes is accepted", async () => {
    await inRolledBackTransaction(async () => {
      for (const length of [0, 31, 33]) {
        const wrong = Buffer.alloc(length, 1);
        expectViolation(
          await attempt(...insertValid(profileA, { key: wrong })),
          "23514",
          "ck_idempotency_records_key_digest",
          `key digest ${length} bytes`,
        );
        expectViolation(
          await attempt(...insertValid(profileA, { request: wrong })),
          "23514",
          "ck_idempotency_records_request_digest",
          `request digest ${length} bytes`,
        );
      }
      expect(await attempt(...insertValid(profileA)), "32 bytes").toBeUndefined();
    });
    expect(await recordCount(admin)).toBe(0);
  });

  it("TC-DB-IDM-001-001 expires_at and created_at default to the transaction's transaction_timestamp() and 24 hours later, and no other expiry is accepted on INSERT or UPDATE (ck_idempotency_records_expiry)", async () => {
    await inRolledBackTransaction(async () => {
      await admin.query(...insertValid(profileA));
      const defaults = (
        await admin.query(
          `SELECT created_at = transaction_timestamp() AS created_is_txn,
                  expires_at = transaction_timestamp() + interval '24 hours' AS expires_is_24h,
                  result_ref_type IS NULL AS no_type, cardinality(result_refs) = 0 AS no_refs
             FROM ${T}`,
        )
      ).rows[0];
      expect(defaults).toEqual({
        created_is_txn: true,
        expires_is_24h: true,
        no_type: true,
        no_refs: true,
      });
      // Not the statement time: created_at stays the transaction's time while the clock advances.
      await admin.query("SELECT pg_sleep(0.05)");
      await admin.query(
        ...insertValid(profileA, { key: digest("synthetic-idem-key-records-0002") }),
      );
      expect(
        (await admin.query(`SELECT count(DISTINCT created_at)::int AS n FROM ${T}`)).rows[0].n,
      ).toBe(1);

      for (const [label, expiry] of [
        ["23 hours", "created_at + interval '23 hours'"],
        ["25 hours", "created_at + interval '25 hours'"],
        ["created_at itself", "created_at"],
        [
          "24 hours less 1 microsecond",
          "created_at + interval '24 hours' - interval '1 microsecond'",
        ],
      ] as const) {
        expectViolation(
          await attempt(`UPDATE ${T} SET expires_at = ${expiry}`),
          "23514",
          "ck_idempotency_records_expiry",
          `UPDATE expires_at ${label}`,
        );
      }
      expectViolation(
        await attempt(
          `INSERT INTO ${T}(principal_profile_id, operation_id, key_digest, request_digest, expires_at)
           VALUES ($1::bigint, $2, $3, $4, transaction_timestamp() + interval '25 hours')`,
          [
            profileA,
            OPERATION_ID,
            Buffer.from(digest("synthetic-idem-key-records-0003")),
            Buffer.from(REQUEST),
          ],
        ),
        "23514",
        "ck_idempotency_records_expiry",
        "INSERT expires_at 25 hours",
      );
      // created_at moved without moving expires_at is refused as well.
      expectViolation(
        await attempt(`UPDATE ${T} SET created_at = created_at - interval '1 hour'`),
        "23514",
        "ck_idempotency_records_expiry",
        "UPDATE created_at alone",
      );
      // Both moved together keep the 24 hours and are accepted (this is how an expired row is reused).
      expect(
        await attempt(
          `UPDATE ${T} SET created_at = created_at - interval '1 hour', expires_at = expires_at - interval '1 hour'`,
        ),
        "both moved",
      ).toBeUndefined();
    });
  });

  it("TC-DB-IDM-001-001 result_ref_type and result_refs are both unset or both set: one without the other is 23514 ck_idempotency_records_result_ref", async () => {
    await inRolledBackTransaction(async () => {
      expectViolation(
        await attempt(
          `INSERT INTO ${T}(principal_profile_id, operation_id, key_digest, request_digest, result_ref_type)
           VALUES ($1::bigint, $2, $3, $4, 'SYNTHETIC_EFFECT')`,
          [profileA, OPERATION_ID, Buffer.from(KEY), Buffer.from(REQUEST)],
        ),
        "23514",
        "ck_idempotency_records_result_ref",
        "type without refs",
      );
      expectViolation(
        await attempt(
          `INSERT INTO ${T}(principal_profile_id, operation_id, key_digest, request_digest, result_refs)
           VALUES ($1::bigint, $2, $3, $4, ARRAY[$5::uuid])`,
          [profileA, OPERATION_ID, Buffer.from(KEY), Buffer.from(REQUEST), ref(0x601)],
        ),
        "23514",
        "ck_idempotency_records_result_ref",
        "refs without type",
      );
      expect(
        await attempt(
          `INSERT INTO ${T}(principal_profile_id, operation_id, key_digest, request_digest, result_ref_type, result_refs)
           VALUES ($1::bigint, $2, $3, $4, 'SYNTHETIC_EFFECT', ARRAY[$5::uuid, $6::uuid])`,
          [profileA, OPERATION_ID, Buffer.from(KEY), Buffer.from(REQUEST), ref(0x601), ref(0x602)],
        ),
        "type with two refs",
      ).toBeUndefined();
      // UPDATE: clearing only the type, or only the refs, of a set record is refused.
      expectViolation(
        await attempt(`UPDATE ${T} SET result_ref_type = NULL`),
        "23514",
        "ck_idempotency_records_result_ref",
        "UPDATE type to NULL",
      );
      expectViolation(
        await attempt(`UPDATE ${T} SET result_refs = '{}'`),
        "23514",
        "ck_idempotency_records_result_ref",
        "UPDATE refs to empty",
      );
    });
  });

  it("TC-DB-IDM-001-001 the same Principal, Operation and key digest twice is 23505 on ux_idempotency_records_principal_operation_key; an absent Profile is 23503 and a referenced Profile cannot be deleted (RESTRICT)", async () => {
    await inRolledBackTransaction(async () => {
      expect(await attempt(...insertValid(profileA))).toBeUndefined();
      expectViolation(
        await attempt(
          ...insertValid(profileA, { request: digest("synthetic-request-records-0002") }),
        ),
        "23505",
        "ux_idempotency_records_principal_operation_key",
        "duplicate unique key (another request digest)",
      );
      expectViolation(
        await attempt(...insertValid("9223372036854775807")),
        "23503",
        "fk_idempotency_records_principal_profile",
        "absent Profile",
      );
      expectViolation(
        await attempt("DELETE FROM app.business_profiles WHERE id = $1::bigint", [profileA]),
        "23503",
        "fk_idempotency_records_principal_profile",
        "delete of a referenced Profile",
      );
      expect(
        (
          await admin.query(
            "SELECT count(*)::int AS n FROM app.business_profiles WHERE id = $1::bigint",
            [profileA],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    expect(await recordCount(admin)).toBe(0);
  });

  it("TC-DB-IDM-001-001 a missing principal, operation or digest is 23502 on its own column", async () => {
    await inRolledBackTransaction(async () => {
      const full = {
        principal_profile_id: profileA,
        operation_id: OPERATION_ID,
        key_digest: Buffer.from(KEY),
        request_digest: Buffer.from(REQUEST),
      };
      for (const omitted of Object.keys(full) as (keyof typeof full)[]) {
        const present = (Object.keys(full) as (keyof typeof full)[]).filter((c) => c !== omitted);
        expectViolation(
          await attempt(
            `INSERT INTO ${T}(${present.join(", ")}) VALUES (${present.map((_, i) => `$${i + 1}`).join(", ")})`,
            present.map((column) => full[column]),
          ),
          "23502",
          omitted,
          `omitted ${omitted}`,
        );
      }
    });
  });
});

// ---- TC-DB-IDM-003-001 ---------------------------------------------------------------------------

describe("TC-DB-IDM-003-001 runtime privileges on app.idempotency_records (real PostgreSQL 17)", () => {
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
  const API_GRANTS = ["SELECT", "INSERT", "UPDATE"];

  async function tablePrivileges(role: string) {
    const result: Record<string, boolean> = {};
    for (const privilege of PRIVILEGES) {
      result[privilege] = (
        await admin.query("SELECT has_table_privilege($1, $2, $3) AS allowed", [role, T, privilege])
      ).rows[0].allowed;
    }
    return result;
  }
  const only = (granted: readonly string[]) =>
    Object.fromEntries(PRIVILEGES.map((privilege) => [privilege, granted.includes(privilege)]));

  it("TC-DB-IDM-003-001 has_table_privilege: app_api_runtime has SELECT, INSERT and UPDATE only (no DELETE, TRUNCATE, REFERENCES, TRIGGER); the workers, app_runtime and PUBLIC have nothing", async () => {
    expect(await tablePrivileges("app_api_runtime")).toEqual(only(API_GRANTS));
    for (const role of ["app_email_runtime", "app_reconciliation_runtime", "app_runtime"]) {
      expect(await tablePrivileges(role), role).toEqual(only([]));
    }
    const acl = (
      await admin.query(
        `SELECT e.grantee = 0 AS is_public,
                CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END AS grantee_name,
                e.privilege_type
           FROM pg_class c, aclexplode(c.relacl) e WHERE c.oid = $1::regclass`,
        [T],
      )
    ).rows;
    expect(
      acl.some((entry) => entry.is_public),
      "ACL has PUBLIC",
    ).toBe(false);
    expect(
      acl
        .filter((entry) => entry.grantee_name !== "app_migrator")
        .map((entry) => `${entry.grantee_name}:${entry.privilege_type}`)
        .sort(),
    ).toEqual(API_GRANTS.map((privilege) => `app_api_runtime:${privilege}`).sort());
  });

  it("TC-DB-IDM-003-001 no column has an ACL of its own, and has_column_privilege of every role equals the table-level grants", async () => {
    const withAcl = (
      await admin.query(
        `SELECT a.attname FROM pg_attribute a
          WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL`,
        [T],
      )
    ).rows;
    expect(withAcl, "columns with a column-level ACL").toEqual([]);
    const COLUMN_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "REFERENCES"] as const;
    const effective = (
      await admin.query(
        `SELECT a.attname AS column_name, r.role_name, p.privilege,
                has_column_privilege(r.role_name, a.attrelid, a.attnum, p.privilege) AS allowed
           FROM pg_attribute a
          CROSS JOIN unnest($2::text[]) AS r(role_name)
          CROSS JOIN unnest($3::text[]) AS p(privilege)
          WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped`,
        [T, [...ROLES], [...COLUMN_PRIVILEGES]],
      )
    ).rows as { column_name: string; role_name: string; privilege: string; allowed: boolean }[];
    expect(effective).toHaveLength(GOLDEN_COLUMNS.length * ROLES.length * COLUMN_PRIVILEGES.length);
    const deviations = effective
      .filter((row) => {
        const granted = row.role_name === "app_api_runtime" ? API_GRANTS : [];
        return row.allowed !== granted.includes(row.privilege);
      })
      .map((row) => `${row.role_name} ${row.column_name} ${row.privilege}=${row.allowed}`);
    expect(deviations).toEqual([]);
  });

  it("TC-DB-IDM-003-001 no role has a privilege on the identity sequence (identity needs none), and no purge function, job or role exists in the app schema (DB-IDM-003)", async () => {
    for (const role of ROLES) {
      expect(
        (
          await admin.query(
            "SELECT has_sequence_privilege($1, $2, 'USAGE,SELECT,UPDATE') AS allowed",
            [role, `app.${GOLDEN_SEQUENCE[0]}`],
          )
        ).rows[0].allowed,
        `${role} sequence`,
      ).toBe(false);
    }
    const functions = (
      await admin.query(
        `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'app' AND p.proname ~* '(purge|prune|clean|expire|reap|idempot|delete)'`,
      )
    ).rows;
    expect(functions, "purge-like functions in app").toEqual([]);
    const roles = (
      await admin.query(
        "SELECT rolname FROM pg_roles WHERE rolname ~* '(purge|prune|clean|idempot)'",
      )
    ).rows;
    expect(roles, "purge-like roles").toEqual([]);
  });

  it("TC-DB-IDM-003-001 app_api_runtime can INSERT, SELECT and UPDATE a record in a transaction it rolls back, and is refused DELETE and TRUNCATE with 42501", async () => {
    const api = await poolOf("app_api_runtime").connect();
    try {
      await api.query("BEGIN");
      const id = (
        await api.query(
          `INSERT INTO ${T}(principal_profile_id, operation_id, key_digest, request_digest)
           VALUES ($1::bigint, $2, $3, $4) RETURNING id::text AS id`,
          [profileA, OPERATION_ID, Buffer.from(KEY), Buffer.from(REQUEST)],
        )
      ).rows[0].id as string;
      expect((await api.query(`SELECT id FROM ${T} WHERE id = $1::bigint`, [id])).rowCount).toBe(1);
      expect(
        (
          await api.query(
            `UPDATE ${T} SET result_ref_type = 'SYNTHETIC_EFFECT', result_refs = ARRAY[$2::uuid] WHERE id = $1::bigint`,
            [id, ref(0x701)],
          )
        ).rowCount,
      ).toBe(1);
      for (const statement of [
        `DELETE FROM ${T}`,
        `DELETE FROM ${T} WHERE id = ${id}`,
        `TRUNCATE ${T}`,
      ]) {
        await api.query("SAVEPOINT denied");
        await expect(api.query(statement), statement).rejects.toMatchObject({ code: "42501" });
        await api.query("ROLLBACK TO SAVEPOINT denied");
      }
      await api.query("ROLLBACK");
    } finally {
      api.release();
    }
    expect(await recordCount(admin)).toBe(0);
  });

  it("TC-DB-IDM-003-001 app_email_runtime and app_reconciliation_runtime are refused SELECT, INSERT, UPDATE and DELETE with 42501", async () => {
    for (const role of ["app_email_runtime", "app_reconciliation_runtime"]) {
      for (const statement of [
        `SELECT id FROM ${T}`,
        `INSERT INTO ${T}(principal_profile_id, operation_id, key_digest, request_digest) VALUES (1, 'API-ORD-002', '\\x00'::bytea, '\\x00'::bytea)`,
        `UPDATE ${T} SET result_ref_type = NULL`,
        `DELETE FROM ${T}`,
      ]) {
        await expect(poolOf(role).query(statement), `${role}: ${statement}`).rejects.toMatchObject({
          code: "42501",
        });
      }
    }
    expect(await recordCount(admin)).toBe(0);
  });
});

// ---- TC-API-IDM-005-004 --------------------------------------------------------------------------

describe("TC-API-IDM-005-004 the key is scoped to Principal and Operation ID (API-IDM-005, real PostgreSQL 17)", () => {
  it("TC-API-IDM-005-004 the same key digest under another Principal or another Operation ID is a separate first record and never reused", async () => {
    const pool = poolOf("app_api_runtime");
    const SAME_KEY = "synthetic-idem-key-scope-0001";
    const REQUEST_A = "synthetic-request-scope-a";
    const REQUEST_B = "synthetic-request-scope-b";

    // The same key digest everywhere; the request differs so that a wrong scope would show as `reused`.
    expect(await claimInTransaction(pool, claimInput(PROFILE_A, SAME_KEY, REQUEST_A))).toEqual({
      status: "first",
    });
    expect(
      await claimInTransaction(pool, claimInput(PROFILE_B, SAME_KEY, REQUEST_B)),
      "another Principal",
    ).toEqual({ status: "first" });
    expect(
      await claimInTransaction(
        pool,
        claimInput(PROFILE_A, SAME_KEY, REQUEST_B, OTHER_OPERATION_ID),
      ),
      "another Operation ID",
    ).toEqual({ status: "first" });
    expect(
      await claimInTransaction(
        pool,
        claimInput(PROFILE_B, SAME_KEY, REQUEST_A, OTHER_OPERATION_ID),
      ),
      "another Principal and Operation ID",
    ).toEqual({ status: "first" });

    const rows = await recordRows(admin);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.key_digest))).toEqual(new Set([hex(digest(SAME_KEY))]));
    expect(rows.map((row) => [row.principal_profile_id, row.operation_id]).sort()).toEqual(
      [
        [profileA, OPERATION_ID],
        [profileB, OPERATION_ID],
        [profileA, OTHER_OPERATION_ID],
        [profileB, OTHER_OPERATION_ID],
      ].sort(),
    );

    // Each scope still judges its own request: the same request replays, another request is reused.
    expect(await claimInTransaction(pool, claimInput(PROFILE_A, SAME_KEY, REQUEST_A))).toEqual({
      status: "replay",
      result: null,
    });
    expect(await claimInTransaction(pool, claimInput(PROFILE_B, SAME_KEY, REQUEST_A))).toEqual({
      status: "reused",
    });
    expect(await recordCount(admin)).toBe(4);
  });
});
