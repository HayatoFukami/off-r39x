import { readFile } from "node:fs/promises";
import { Client, type Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AuditEventInput,
  defineAuditChange,
  insertAuditEvent,
} from "../../packages/db/src/audit-events.ts";
import { createDatabase, transaction } from "../../packages/db/src/index.ts";
import { catalogQuery, requiredCatalog } from "../../packages/db/src/schema-contract.ts";
import { installSyntheticDirectory, prepareFoundationDatabase } from "../harness/db/foundation.ts";

// PR-S0-4 C1: app.audit_events on a real PostgreSQL 17 (SPEC-160 §33, SPEC-170 TST-DB-008/009).
// Constraints, privileges and same-transaction atomicity are never proven by a fake
// (TST-GEN-004, DEV-TST-003). The catalog goldens below are written by hand from SPEC-160 §33.1 and
// the PostgreSQL 17 normalised notation; they are not derived from schema-contract.json.

const url = process.env.TEST_DATABASE_URL;
const caPath = process.env.TEST_DATABASE_CA;
if (!url || !caPath) throw new Error("Real PG17 requires TEST_DATABASE_URL and TEST_DATABASE_CA");

// Synthetic identifiers only. The last two hex digits make each case's execution id distinct.
const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${n.toString(16).padStart(2, "0")}`;
const FINGERPRINT = "0123456789abcdef0123456789abcdef";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Raw QR and Secret shaped negatives are assembled at run time so no literal sits in the source.
const emailLike = "audit-probe@example.com";

const AUDIT_EVENT_TYPES = [
  "PRIVILEGED_OPERATION",
  "PRIVILEGED_OPERATION_DENIED",
  "BUSINESS_EFFECT",
  "RECOVERY_EXECUTION",
  "SECURITY_SENSITIVE_OPERATION",
  "EMERGENCY_ADMIN_RECOVERY",
];
const ACTOR_TYPES = [
  "GUEST",
  "AUTHENTICATED_USER",
  "STAFF",
  "ADMINISTRATOR",
  "SYSTEM_WORKER",
  "SCHEDULED_RECONCILIATION",
  "EXTERNAL_PROVIDER",
  "INFRASTRUCTURE_OPERATOR",
];
const PRECONDITION_RESULTS = ["PASSED", "FAILED", "NOT_APPLICABLE", "UNKNOWN"];
const AUDIT_RESULTS = [
  "REQUESTED",
  "AUTHORIZED",
  "REJECTED",
  "COMMITTED",
  "NOOP",
  "PENDING",
  "UNKNOWN",
  "FAILED",
];

// [name, format_type, attnotnull, attidentity, attgenerated, pg_get_expr(default)] in attnum order.
type GoldenColumn = [string, string, boolean, string, string, string | null];
const GOLDEN_COLUMNS: GoldenColumn[] = [
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

// [conname, contype, pg_get_constraintdef] ordered by conname.
const GOLDEN_CONSTRAINTS: [string, string, string][] = [
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

// [index name, pg_get_indexdef] ordered by index name. Valid, ready and live are asserted separately.
const GOLDEN_INDEXES: [string, string][] = [
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

// The six NOT NULL columns without a default: the smallest legal row (SPEC-160 §33.1).
const REQUIRED_COLUMNS = [
  "audit_event_type",
  "actor_type",
  "operation_id",
  "operation_execution_id",
  "precondition_result",
  "audit_result",
] as const;
type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];

function requiredRow(executionId: string): Record<RequiredColumn, string> {
  return {
    audit_event_type: "PRIVILEGED_OPERATION",
    actor_type: "STAFF",
    operation_id: "audit_probe_operation",
    operation_execution_id: executionId,
    precondition_result: "PASSED",
    audit_result: "COMMITTED",
  };
}

function insertStatement(row: Partial<Record<RequiredColumn, string>>): [string, string[]] {
  // Column names come from the fixed REQUIRED_COLUMNS tuple; every value is a bind parameter.
  const columns = REQUIRED_COLUMNS.filter((column) => row[column] !== undefined);
  return [
    `INSERT INTO app.audit_events(${columns.join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
    columns.map((column) => row[column] as string),
  ];
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

async function auditRows(executionId: string) {
  return (
    await admin.query("SELECT * FROM app.audit_events WHERE operation_execution_id = $1", [
      executionId,
    ])
  ).rows;
}

async function profileCount(authSubject: string): Promise<number> {
  return (
    await admin.query(
      "SELECT count(*)::int AS count FROM app.business_profiles WHERE auth_subject = $1",
      [authSubject],
    )
  ).rows[0].count;
}

describe("TC-OBS-AUD-004-001 app.audit_events catalog (real PostgreSQL 17)", () => {
  it("TC-OBS-AUD-004-001 columns equal the SPEC-160 §33.1 golden in attnum order", async () => {
    const rows = (
      await admin.query(
        `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull,
                a.attidentity, a.attgenerated, pg_get_expr(d.adbin, d.adrelid) AS default_expr
           FROM pg_attribute a
           LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = 'app.audit_events'::regclass AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attnum`,
      )
    ).rows;
    expect(GOLDEN_COLUMNS).toHaveLength(30);
    expect(
      rows.map((r) => [
        r.attname,
        r.type,
        r.attnotnull,
        r.attidentity,
        r.attgenerated,
        r.default_expr,
      ]),
    ).toEqual(GOLDEN_COLUMNS);
  });

  it("TC-OBS-AUD-004-001 constraints equal the golden by name, kind and definition", async () => {
    const rows = (
      await admin.query(
        `SELECT conname, contype, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint WHERE conrelid = 'app.audit_events'::regclass ORDER BY conname`,
      )
    ).rows;
    expect(rows.map((r) => [r.conname, r.contype, r.definition])).toEqual(GOLDEN_CONSTRAINTS);
  });

  it("TC-OBS-AUD-004-001 exactly nine valid indexes equal the golden definitions", async () => {
    const rows = (
      await admin.query(
        `SELECT x.relname AS name, pg_get_indexdef(i.indexrelid) AS definition,
                i.indisvalid, i.indisready, i.indislive
           FROM pg_index i JOIN pg_class x ON x.oid = i.indexrelid
          WHERE i.indrelid = 'app.audit_events'::regclass ORDER BY x.relname`,
      )
    ).rows;
    expect(rows).toHaveLength(9);
    expect(rows.map((r) => [r.name, r.definition])).toEqual(GOLDEN_INDEXES);
    expect(rows.every((r) => r.indisvalid && r.indisready && r.indislive)).toBe(true);
  });

  it("TC-OBS-AUD-004-001 owner is app_migrator, RLS is off and the journal lists both migrations", async () => {
    const table = (
      await admin.query(
        "SELECT pg_get_userbyid(relowner) AS owner, relrowsecurity FROM pg_class WHERE oid = 'app.audit_events'::regclass",
      )
    ).rows[0];
    expect(table).toEqual({ owner: "app_migrator", relrowsecurity: false });
    expect(
      (await admin.query("SELECT version FROM app.schema_migrations ORDER BY version")).rows.map(
        (row) => row.version,
      ),
    ).toEqual(["0001_foundation", "0002_audit_events"]);
  });

  it("TC-OBS-AUD-004-001 the live catalog equals requiredCatalog, checked directly and not through readiness", async () => {
    const live = (await admin.query(catalogQuery)).rows[0].catalog;
    expect(live).toEqual(requiredCatalog);
    // The contract is not vacuous: it must describe this table.
    expect(live.tables.map((row: unknown[]) => row[0])).toContain("audit_events");
  });
});

describe("TC-OBS-AUD-004-002 allowlist CHECK constraints (real PostgreSQL 17)", () => {
  const checks = [
    ["audit_event_type", AUDIT_EVENT_TYPES],
    ["actor_type", ACTOR_TYPES],
    ["precondition_result", PRECONDITION_RESULTS],
    ["audit_result", AUDIT_RESULTS],
  ] as const;

  // Every attempt runs in its own transaction that is always rolled back, so nothing is committed
  // and a failed statement never poisons the next one.
  async function attempt(row: Partial<Record<RequiredColumn, string>>) {
    const [text, values] = insertStatement(row);
    await admin.query("BEGIN");
    try {
      await admin.query(text, values);
      return undefined;
    } catch (error) {
      return error as { code?: string; constraint?: string; column?: string };
    } finally {
      await admin.query("ROLLBACK");
    }
  }
  const executionId = uuid(0x21);

  it("TC-OBS-AUD-004-002 every allowed value is accepted and every near miss is rejected with SQLSTATE 23514 by name", async () => {
    const before = (await admin.query("SELECT count(*)::int AS count FROM app.audit_events"))
      .rows[0].count;
    expect(checks.map(([, allowed]) => allowed.length)).toEqual([6, 8, 4, 8]);
    for (const [column, allowed] of checks) {
      for (const value of allowed) {
        const error = await attempt({ ...requiredRow(executionId), [column]: value });
        expect(error, `${column}=${value} must be accepted`).toBeUndefined();
      }
      const first = allowed[0] as string;
      for (const value of ["", first.toLowerCase(), `${first}S`, "UNKNOWN_VALUE"]) {
        const error = await attempt({ ...requiredRow(executionId), [column]: value });
        expect(error?.code, `${column}='${value}'`).toBe("23514");
        expect(error?.constraint, `${column}='${value}'`).toBe(`ck_audit_events_${column}`);
      }
    }
    expect(
      (await admin.query("SELECT count(*)::int AS count FROM app.audit_events")).rows[0].count,
    ).toBe(before);
  });

  it("TC-OBS-AUD-004-002 omitting any of the six NOT NULL columns without a default fails with SQLSTATE 23502", async () => {
    for (const column of REQUIRED_COLUMNS) {
      const row: Partial<Record<RequiredColumn, string>> = requiredRow(executionId);
      delete row[column];
      const error = await attempt(row);
      expect(error?.code, `omitted ${column}`).toBe("23502");
      expect(error?.column, `omitted ${column}`).toBe(column);
    }
    expect(await auditRows(executionId)).toHaveLength(0);
  });
});

describe("TC-DB-009-001 runtime privileges on app.audit_events (real PostgreSQL 17)", () => {
  const TABLE_PRIVILEGES = [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "REFERENCES",
    "TRIGGER",
  ] as const;

  async function tablePrivileges(role: string) {
    const result: Record<string, boolean> = {};
    for (const privilege of TABLE_PRIVILEGES) {
      result[privilege] = (
        await admin.query("SELECT has_table_privilege($1, 'app.audit_events', $2) AS allowed", [
          role,
          privilege,
        ])
      ).rows[0].allowed;
    }
    return result;
  }
  const none = Object.fromEntries(TABLE_PRIVILEGES.map((p) => [p, false]));

  it("TC-DB-009-001 only app_api_runtime has INSERT; no runtime role or PUBLIC has any other privilege", async () => {
    expect(await tablePrivileges("app_api_runtime")).toEqual({ ...none, INSERT: true });
    expect(await tablePrivileges("app_email_runtime")).toEqual(none);
    expect(await tablePrivileges("app_reconciliation_runtime")).toEqual(none);
    expect(await tablePrivileges("app_runtime")).toEqual(none);
    // PUBLIC (grantee 0) holds nothing, and the ACL names only the owner and app_api_runtime (INSERT).
    const acl = (
      await admin.query(
        `SELECT e.grantee = 0 AS is_public,
                CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END AS grantee_name,
                e.privilege_type
           FROM pg_class c, aclexplode(c.relacl) e WHERE c.oid = 'app.audit_events'::regclass`,
      )
    ).rows;
    expect(acl.some((entry) => entry.is_public)).toBe(false);
    expect(
      acl
        .filter((entry) => entry.grantee_name !== "app_migrator")
        .map((entry) => [entry.grantee_name, entry.privilege_type]),
    ).toEqual([["app_api_runtime", "INSERT"]]);
  });

  it("TC-DB-009-001 no role has any privilege on the identity sequence app.audit_events_id_seq", async () => {
    for (const role of [
      "app_api_runtime",
      "app_email_runtime",
      "app_reconciliation_runtime",
      "app_runtime",
    ]) {
      expect(
        (
          await admin.query(
            "SELECT has_sequence_privilege($1, 'app.audit_events_id_seq', 'USAGE,SELECT,UPDATE') AS allowed",
            [role],
          )
        ).rows[0].allowed,
        role,
      ).toBe(false);
    }
  });

  it("TC-DB-009-001 app_api_runtime inserts without RETURNING but cannot RETURNING, SELECT, UPDATE, DELETE or TRUNCATE", async () => {
    const executionId = uuid(0x31);
    const api = poolOf("app_api_runtime");
    const [text, values] = insertStatement(requiredRow(executionId));
    // The identity column is filled without any privilege on its sequence (D-1).
    expect((await api.query(text, values)).rowCount).toBe(1);

    await expect(api.query(`${text} RETURNING id`, values)).rejects.toMatchObject({
      code: "42501",
    });
    await expect(api.query("SELECT 1 FROM app.audit_events")).rejects.toMatchObject({
      code: "42501",
    });
    await expect(api.query("UPDATE app.audit_events SET reason_code = 'X'")).rejects.toMatchObject({
      code: "42501",
    });
    await expect(api.query("DELETE FROM app.audit_events")).rejects.toMatchObject({
      code: "42501",
    });
    await expect(api.query("TRUNCATE app.audit_events")).rejects.toMatchObject({
      code: "42501",
    });

    // The refused UPDATE / DELETE did not change history: the row is still there, untouched.
    const rows = await auditRows(executionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason_code).toBeNull();
  });

  it("TC-DB-009-001 app_email_runtime and app_reconciliation_runtime are refused the same INSERT with SQLSTATE 42501", async () => {
    for (const [role, n] of [
      ["app_email_runtime", 0x32],
      ["app_reconciliation_runtime", 0x33],
    ] as const) {
      const executionId = uuid(n);
      const [text, values] = insertStatement(requiredRow(executionId));
      await expect(poolOf(role).query(text, values), role).rejects.toMatchObject({
        code: "42501",
      });
      expect(await auditRows(executionId), role).toHaveLength(0);
    }
  });
});

describe("TC-DB-008-001 audit INSERT is atomic with the business write (real PostgreSQL 17)", () => {
  const validEvent = (executionId: string): AuditEventInput => ({
    auditEventType: "PRIVILEGED_OPERATION",
    actorType: "STAFF",
    actorRef: uuid(0x40),
    effectiveRole: "STAFF",
    capability: "audit.probe",
    operationId: "API-ADM-ROL-001",
    operationExecutionId: executionId,
    preconditionResult: "PASSED",
    auditResult: "COMMITTED",
  });
  const writeProfile = (client: PoolClient, authSubject: string) =>
    client.query("INSERT INTO app.business_profiles(auth_subject) VALUES ($1)", [authSubject]);

  it("TC-DB-008-001 (i) success commits both rows under one transaction_timestamp()", async () => {
    const authSubject = uuid(0x41);
    const executionId = uuid(0x42);
    let calls = 0;
    const result = await transaction(poolOf("app_api_runtime"), async (client) => {
      calls++;
      await writeProfile(client, authSubject);
      await insertAuditEvent(client, validEvent(executionId));
    });
    expect(result).toMatchObject({ status: "committed" });
    expect(calls).toBe(1);
    expect(await profileCount(authSubject)).toBe(1);
    expect(await auditRows(executionId)).toHaveLength(1);
    const timing = (
      await admin.query(
        `SELECT a.occurred_at = a.created_at AS audit_times_equal,
                a.occurred_at = p.created_at AS same_transaction_as_profile
           FROM app.audit_events a, app.business_profiles p
          WHERE a.operation_execution_id = $1 AND p.auth_subject = $2`,
        [executionId, authSubject],
      )
    ).rows[0];
    expect(timing).toEqual({ audit_times_equal: true, same_transaction_as_profile: true });
  });

  it("TC-DB-008-001 (ii) FP.AUDIT.INSERT_FAILURE: a refused audit INSERT leaves no business write and no retry", async () => {
    const authSubject = uuid(0x43);
    const executionId = uuid(0x44);
    let calls = 0;
    // Fault injection by privilege change in the test only; production has no fault hook (TST-FLT-002).
    await admin.query("REVOKE INSERT ON app.audit_events FROM app_api_runtime");
    try {
      await expect(
        transaction(poolOf("app_api_runtime"), async (client) => {
          calls++;
          await writeProfile(client, authSubject);
          await insertAuditEvent(client, validEvent(executionId));
        }),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await admin.query("GRANT INSERT ON app.audit_events TO app_api_runtime");
    }
    expect(
      (
        await admin.query(
          "SELECT has_table_privilege('app_api_runtime', 'app.audit_events', 'INSERT') AS allowed",
        )
      ).rows[0].allowed,
    ).toBe(true);
    expect(calls).toBe(1);
    expect(await profileCount(authSubject)).toBe(0);
    expect(await auditRows(executionId)).toHaveLength(0);
  });

  it("TC-DB-008-001 (iii) a writer validation failure rolls the business write back without echoing the input", async () => {
    const authSubject = uuid(0x45);
    const executionId = uuid(0x46);
    const rejected = await transaction(poolOf("app_api_runtime"), async (client) => {
      await writeProfile(client, authSubject);
      await insertAuditEvent(client, {
        ...validEvent(executionId),
        actorType: "STAFF",
        actorRef: emailLike,
      } as unknown as AuditEventInput);
    }).catch((error: unknown) => error);
    // transaction() must reject; a committed or commit_unknown result would be a failure here.
    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).not.toContain("audit-probe");
    expect(await profileCount(authSubject)).toBe(0);
    expect(await auditRows(executionId)).toHaveLength(0);
  });

  it("TC-DB-008-001 (iv) a CHECK violation (23514) rolls the business write back", async () => {
    const authSubject = uuid(0x47);
    const executionId = uuid(0x48);
    const rejected = await transaction(poolOf("app_api_runtime"), async (client) => {
      await writeProfile(client, authSubject);
      await client.query(
        `INSERT INTO app.audit_events(audit_event_type, actor_type, operation_id, operation_execution_id, precondition_result, audit_result)
         VALUES ('NOT_IN_ALLOWLIST', 'STAFF', 'audit_probe_operation', $1, 'PASSED', 'COMMITTED')`,
        [executionId],
      );
    }).catch((error: unknown) => error);
    expect(rejected).toMatchObject({
      code: "23514",
      constraint: "ck_audit_events_audit_event_type",
    });
    expect(await profileCount(authSubject)).toBe(0);
    expect(await auditRows(executionId)).toHaveLength(0);
  });
});

describe("TC-OBS-AUD-006-002 writer persists every column and the change summary (real PostgreSQL 17)", () => {
  const probe = defineAuditChange({
    operationIds: ["API-ADM-ROL-001"],
    states: ["ACTIVE", "REVOKED"],
    fields: ["role", "state"],
    summary: {
      role: { kind: "enum", values: ["STAFF", "ADMINISTRATOR"] },
      target_profile_ref: { kind: "publicRef" },
      active_count: { kind: "count" },
      delta: { kind: "integer" },
    },
  });

  it("TC-OBS-AUD-006-002 a fully populated event and a minimal event are stored as written", async () => {
    const fullId = uuid(0x51);
    const minimalId = uuid(0x52);
    const targetProfileRef = uuid(0x53);
    const full: AuditEventInput = {
      auditEventType: "PRIVILEGED_OPERATION",
      actorType: "STAFF",
      actorRef: uuid(0x54),
      effectiveRole: "STAFF",
      capability: "audit.probe",
      operationId: "API-ADM-ROL-001",
      operationExecutionId: fullId,
      targetType: "ROLE_ASSIGNMENT",
      targetRef: uuid(0x55),
      requestId: uuid(0x56),
      businessCauseRef: "cause_probe_1",
      transportIdempotencyFp: FINGERPRINT,
      provider: "STRIPE",
      providerEventRef: "evt_probe_1",
      providerObjectRef: "obj_probe_1",
      providerIdempotencyFp: FINGERPRINT,
      preconditionResult: "PASSED",
      auditResult: "COMMITTED",
      failureClass: "SUCCESS",
      reasonCode: "PROBE_REASON",
      change: probe.change({
        beforeState: "ACTIVE",
        afterState: "REVOKED",
        changedFields: ["state"],
        summary: {
          role: "STAFF",
          target_profile_ref: targetProfileRef,
          active_count: 1,
          delta: -1,
        },
      }),
      consistencyReviewRef: uuid(0x57),
      recoveryExecutionId: uuid(0x58),
    };
    const minimal: AuditEventInput = {
      auditEventType: "BUSINESS_EFFECT",
      actorType: "SYSTEM_WORKER",
      actorRef: "email-worker",
      operationId: "WORKER.EMAIL.DELIVERY",
      operationExecutionId: minimalId,
      preconditionResult: "NOT_APPLICABLE",
      auditResult: "NOOP",
    };
    // The runtime role has no SELECT privilege, so the writer must not need RETURNING.
    const result = await transaction(poolOf("app_api_runtime"), async (client) => {
      await insertAuditEvent(client, full);
      await insertAuditEvent(client, minimal);
    });
    expect(result).toMatchObject({ status: "committed" });

    const [row] = await auditRows(fullId);
    expect(row).toMatchObject({
      audit_event_type: "PRIVILEGED_OPERATION",
      actor_type: "STAFF",
      actor_ref: full.actorRef,
      effective_role: "STAFF",
      capability: "audit.probe",
      operation_id: "API-ADM-ROL-001",
      operation_execution_id: fullId,
      target_type: "ROLE_ASSIGNMENT",
      target_ref: full.targetRef,
      request_id: full.requestId,
      business_cause_ref: "cause_probe_1",
      transport_idempotency_fp: FINGERPRINT,
      provider: "STRIPE",
      provider_event_ref: "evt_probe_1",
      provider_object_ref: "obj_probe_1",
      provider_idempotency_fp: FINGERPRINT,
      precondition_result: "PASSED",
      audit_result: "COMMITTED",
      failure_class: "SUCCESS",
      reason_code: "PROBE_REASON",
      before_state: "ACTIVE",
      after_state: "REVOKED",
      changed_fields: ["state"],
      safe_change_summary: {
        role: "STAFF",
        target_profile_ref: targetProfileRef,
        active_count: 1,
        delta: -1,
      },
      consistency_review_ref: full.consistencyReviewRef,
      recovery_execution_id: full.recoveryExecutionId,
    });

    // jsonb checks run in the database: an object whose values are only strings and numbers.
    const summary = (
      await admin.query(
        `SELECT jsonb_typeof(safe_change_summary) AS kind,
                safe_change_summary = $2::jsonb AS equal,
                (SELECT bool_and(jsonb_typeof(e.value) IN ('string', 'number'))
                   FROM jsonb_each(safe_change_summary) AS e) AS flat
           FROM app.audit_events WHERE operation_execution_id = $1`,
        [
          fullId,
          JSON.stringify({
            role: "STAFF",
            target_profile_ref: targetProfileRef,
            active_count: 1,
            delta: -1,
          }),
        ],
      )
    ).rows[0];
    expect(summary).toEqual({ kind: "object", equal: true, flat: true });

    const [bare] = await auditRows(minimalId);
    expect(bare).toMatchObject({
      before_state: null,
      after_state: null,
      changed_fields: [],
      safe_change_summary: {},
      actor_ref: "email-worker",
      effective_role: null,
      target_type: null,
      reason_code: null,
    });

    // Both ids are DB-generated v4 UUIDs, distinct; time defaults are one transaction_timestamp().
    expect(row.audit_event_id).toMatch(UUID_V4);
    expect(bare.audit_event_id).toMatch(UUID_V4);
    expect(row.audit_event_id).not.toBe(bare.audit_event_id);
    const times = (
      await admin.query(
        `SELECT bool_and(occurred_at = created_at) AS equal_each, count(DISTINCT occurred_at)::int AS instants
           FROM app.audit_events WHERE operation_execution_id IN ($1, $2)`,
        [fullId, minimalId],
      )
    ).rows[0];
    expect(times).toEqual({ equal_each: true, instants: 1 });
  });
});
