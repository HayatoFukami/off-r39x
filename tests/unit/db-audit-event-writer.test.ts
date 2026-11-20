import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  type AuditEventInput,
  defineAuditChange,
  insertAuditEvent,
} from "../../packages/db/src/audit-events.ts";
import { sqlState } from "../../packages/db/src/transaction.ts";

// PR-S0-4 C1: the Audit writer insertAuditEvent and the per-operation change spec
// (SPEC-160 OBS-AUD-006 / §35 / §19.1 / §33.1; OBS-AUD-008 at writer level only).
// A fake pg client records what the writer sends. Nothing here proves a database constraint
// (TST-UNT-001): those are TC-OBS-AUD-004-002 / TC-DB-008-001 on real PostgreSQL 17.
// Redaction negatives (Email, raw QR, token, Secret shapes) are assembled at run time so that no
// credential-shaped literal sits in the source (TST-UNT-003, secret-scan).

const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${n.toString(16).padStart(2, "0")}`;
const UPPER_UUID = "0000000A-0000-4000-8000-00000000000A";
const FP = "0123456789abcdef0123456789abcdef";
const emailLike = "audit-probe@example.com";
const qrLike = ["r39x1", "ent", "A".repeat(43)].join(".");
const jwtLike = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJwcm9iZSJ9", "c2lnbmF0dXJl"].join(".");
const secretLike = ["sk", "test", "x".repeat(24)].join("_");
const spaced = "has space";
const long129 = "a".repeat(129);

// A synthetic spec for tests only; it is not a canonical operation spec (O-5).
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

const VALID: AuditEventInput = {
  auditEventType: "PRIVILEGED_OPERATION",
  actorType: "STAFF",
  actorRef: uuid(1),
  effectiveRole: "STAFF",
  capability: "audit.probe",
  operationId: "API-ADM-ROL-001",
  operationExecutionId: uuid(2),
  preconditionResult: "PASSED",
  auditResult: "COMMITTED",
};

type Sent = { sql: string; params: unknown[] };
function fake(impl?: (config: unknown, params?: unknown[]) => Promise<unknown>) {
  const query = vi.fn(
    impl ?? (async (_config: unknown, _params?: unknown[]) => ({ rows: [], rowCount: 1 })),
  );
  const client = { query } as unknown as PoolClient;
  const sent = (): Sent[] =>
    query.mock.calls.map(([config, params]) => ({
      sql: typeof config === "string" ? config : (config as { text: string }).text,
      params: (params as unknown[] | undefined) ?? [],
    }));
  return { client, query, sent };
}

// Covers both an async rejection and a synchronous throw.
const settle = (run: () => Promise<unknown>) =>
  Promise.resolve()
    .then(run)
    .then(
      () => undefined,
      (error: unknown) => error ?? new Error("rejected without a reason"),
    );

async function expectRejected(label: string, override: Record<string, unknown>, leak?: string) {
  const { client, query } = fake();
  const error = await settle(() =>
    insertAuditEvent(client, { ...VALID, ...override } as unknown as AuditEventInput),
  );
  expect(error, `${label} must be rejected`).toBeInstanceOf(Error);
  expect(query, `${label} must not reach the database`).not.toHaveBeenCalled();
  if (leak)
    expect((error as Error).message, `${label} must not echo the input`).not.toContain(leak);
}

async function expectAccepted(label: string, override: Record<string, unknown>) {
  const { client, query, sent } = fake();
  const error = await settle(() =>
    insertAuditEvent(client, { ...VALID, ...override } as unknown as AuditEventInput),
  );
  expect(error, `${label} must be accepted`).toBeUndefined();
  expect(query, `${label} sends exactly one statement`).toHaveBeenCalledTimes(1);
  return sent()[0] as Sent;
}

const jsonParams = (params: unknown[]) =>
  params.flatMap((value) => {
    if (typeof value !== "string") return [];
    try {
      return [JSON.parse(value) as unknown];
    } catch {
      return [];
    }
  });

describe("TC-OBS-AUD-006-001 writer input checks (rejections reach no database)", () => {
  it("TC-OBS-AUD-006-001 actor_ref is checked per actor_type (SPEC-160 §19.1)", async () => {
    const cases: [string, Record<string, unknown>, string?][] = [
      ["GUEST with a value", { actorType: "GUEST", actorRef: uuid(1) }, uuid(1)],
      ["STAFF with an Email", { actorType: "STAFF", actorRef: emailLike }, "audit-probe"],
      ["STAFF with a QR shape", { actorType: "STAFF", actorRef: qrLike }, "r39x1"],
      ["STAFF with a space", { actorType: "STAFF", actorRef: spaced }, spaced],
      ["STAFF with an uppercase UUID", { actorType: "STAFF", actorRef: UPPER_UUID }, UPPER_UUID],
      ["STAFF with null", { actorType: "STAFF", actorRef: null }],
      ["STAFF with no value", { actorType: "STAFF", actorRef: undefined }],
      [
        "ADMINISTRATOR with an Email",
        { actorType: "ADMINISTRATOR", actorRef: emailLike },
        "audit-probe",
      ],
      ["ADMINISTRATOR with null", { actorType: "ADMINISTRATOR", actorRef: null }],
      [
        "AUTHENTICATED_USER with an Email",
        { actorType: "AUTHENTICATED_USER", actorRef: emailLike },
        "audit-probe",
      ],
      [
        "AUTHENTICATED_USER with an uppercase fingerprint",
        { actorType: "AUTHENTICATED_USER", actorRef: FP.toUpperCase() },
        FP.toUpperCase(),
      ],
      [
        "AUTHENTICATED_USER with a 31 character fingerprint",
        { actorType: "AUTHENTICATED_USER", actorRef: FP.slice(1) },
        FP.slice(1),
      ],
      ["AUTHENTICATED_USER with null", { actorType: "AUTHENTICATED_USER", actorRef: null }],
      [
        "SYSTEM_WORKER with uppercase",
        { actorType: "SYSTEM_WORKER", actorRef: "Email-Worker" },
        "Email-Worker",
      ],
      [
        "SYSTEM_WORKER with a dot",
        { actorType: "SYSTEM_WORKER", actorRef: "email.worker" },
        "email.worker",
      ],
      [
        "SYSTEM_WORKER with an Email",
        { actorType: "SYSTEM_WORKER", actorRef: emailLike },
        "audit-probe",
      ],
      ["SYSTEM_WORKER with null", { actorType: "SYSTEM_WORKER", actorRef: null }],
      [
        "SCHEDULED_RECONCILIATION with a dot",
        { actorType: "SCHEDULED_RECONCILIATION", actorRef: "Recon.Key" },
        "Recon.Key",
      ],
      [
        "SCHEDULED_RECONCILIATION with null",
        { actorType: "SCHEDULED_RECONCILIATION", actorRef: null },
      ],
      [
        "EXTERNAL_PROVIDER with NEON_DB",
        { actorType: "EXTERNAL_PROVIDER", actorRef: "NEON_DB" },
        "NEON_DB",
      ],
      [
        "EXTERNAL_PROVIDER lowercase",
        { actorType: "EXTERNAL_PROVIDER", actorRef: "stripe" },
        "stripe",
      ],
      ["EXTERNAL_PROVIDER with null", { actorType: "EXTERNAL_PROVIDER", actorRef: null }],
      [
        "INFRASTRUCTURE_OPERATOR with an Email",
        { actorType: "INFRASTRUCTURE_OPERATOR", actorRef: emailLike },
        "audit-probe",
      ],
      [
        "INFRASTRUCTURE_OPERATOR with a QR shape",
        { actorType: "INFRASTRUCTURE_OPERATOR", actorRef: qrLike },
        "r39x1",
      ],
      [
        "INFRASTRUCTURE_OPERATOR with null",
        { actorType: "INFRASTRUCTURE_OPERATOR", actorRef: null },
      ],
    ];
    for (const [label, override, leak] of cases) await expectRejected(label, override, leak);
  });

  it("TC-OBS-AUD-006-001 actor_ref accepts the bounded forms of every actor_type", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["GUEST null", { actorType: "GUEST", actorRef: null }],
      ["GUEST omitted", { actorType: "GUEST", actorRef: undefined }],
      ["AUTHENTICATED_USER UUID", { actorType: "AUTHENTICATED_USER", actorRef: uuid(3) }],
      ["AUTHENTICATED_USER fingerprint", { actorType: "AUTHENTICATED_USER", actorRef: FP }],
      ["STAFF UUID", { actorType: "STAFF", actorRef: uuid(4) }],
      ["ADMINISTRATOR fingerprint", { actorType: "ADMINISTRATOR", actorRef: FP }],
      ["SYSTEM_WORKER", { actorType: "SYSTEM_WORKER", actorRef: "email-worker" }],
      [
        "SCHEDULED_RECONCILIATION",
        { actorType: "SCHEDULED_RECONCILIATION", actorRef: "stripe-recon:daily_1" },
      ],
      ["EXTERNAL_PROVIDER STRIPE", { actorType: "EXTERNAL_PROVIDER", actorRef: "STRIPE" }],
      ["EXTERNAL_PROVIDER RESEND", { actorType: "EXTERNAL_PROVIDER", actorRef: "RESEND" }],
      [
        "INFRASTRUCTURE_OPERATOR",
        { actorType: "INFRASTRUCTURE_OPERATOR", actorRef: "ops_bootstrap-1" },
      ],
    ];
    for (const [label, override] of cases) await expectAccepted(label, override);
  });

  it("TC-OBS-AUD-006-001 reference text fields reject Email, QR, token, URL, whitespace, empty and over-long values", async () => {
    const bad: [string, string][] = [
      ["Email", emailLike],
      ["QR shape", qrLike],
      ["token shape", jwtLike],
      ["URL", "https://example.com/path"],
      ["whitespace", spaced],
      ["empty", ""],
      ["129 characters", long129],
    ];
    for (const field of [
      "targetRef",
      "businessCauseRef",
      "providerEventRef",
      "providerObjectRef",
    ]) {
      for (const [label, value] of bad)
        await expectRejected(`${field} with ${label}`, { [field]: value }, value || undefined);
      await expectAccepted(`${field} with 128 characters`, { [field]: "a".repeat(128) });
    }
  });

  it("TC-OBS-AUD-006-001 operation_id accepts an API Operation ID or a SPEC-160 §9.1 internal key and nothing else", async () => {
    // SPEC-160 §9.1: SPEC-110 API-* IDs exactly, plus this bounded internal key list.
    const internalKeys = [
      "WORKER.EMAIL.DELIVERY",
      "WORKER.EMAIL.CLAIM_RECOVERY",
      "WORKER.KARAOKE.HOLD_EXPIRY",
      "RECON.ORDER.PREPARED",
      "RECON.CHECKOUT.UNKNOWN",
      "RECON.ORDER.AWAITING_PAYMENT",
      "RECON.ORDER.REVIEW_REQUIRED",
      "RECON.STRIPE_WEBHOOK",
      "RECON.REFUND",
      "RECON.ENTITLEMENT_COMPLETENESS",
      "RECON.TICKET_CHECKIN",
      "RECON.KARAOKE_RELATION",
      "RECON.GOODS_INVENTORY",
      "RECON.GOODS_HANDOFF",
      "RECON.NOTIFICATION_MISSING",
      "RECON.RESEND_UNKNOWN",
      "RECON.RESEND_WEBHOOK",
      "RECON.QR_KEY_MIGRATION",
      "RECOVERY.AUTOMATIC",
      "RECOVERY.MANUAL",
      "RECOVERY.ADMIN_BOOTSTRAP",
      "PROVISION.INITIAL_DATA_SEED",
    ];
    expect(internalKeys).toHaveLength(22);
    const apiIds = [
      "API-ADM-ROL-001",
      "API-ADM-CNT-007",
      "API-ADM-ENT-SALES-003",
      "API-ADM-KRK-SALES-003",
      "API-ADM-EML-001",
      "API-AUTH-001",
    ];
    for (const operationId of [...apiIds, ...internalKeys])
      await expectAccepted(`operationId ${operationId}`, { operationId });

    const bad: [string, unknown][] = [
      ["Email", emailLike],
      ["QR shape", qrLike],
      ["token shape", jwtLike],
      ["URL", "https://example.com/path"],
      ["whitespace", spaced],
      ["empty", ""],
      ["129 characters", long129],
      ["an API ID in lowercase", "api-adm-cnt-007"],
      ["an API ID with a trailing space", "API-ADM-CNT-007 "],
      ["a bare prefix", "API-"],
      ["a key outside the §9.1 list", "RECOVERY.UNKNOWN"],
      ["a §9.1 key with a suffix", "RECON.REFUND.EXTRA"],
      ["a §9.1 key in lowercase", "recon.refund"],
      ["a partial §9.1 key", "WORKER.EMAIL"],
      ["a free label", "audit_probe_operation"],
      ["omitted", undefined],
      ["null", null],
      ["a number", 1],
    ];
    for (const [label, value] of bad)
      await expectRejected(
        `operationId with ${label}`,
        { operationId: value },
        typeof value === "string" && value.length > 0 ? value : undefined,
      );
  });

  it("TC-OBS-AUD-006-001 UUID fields reject anything that is not a lowercase UUID", async () => {
    const bad: [string, string][] = [
      ["a non-UUID", "not-a-uuid"],
      ["an uppercase UUID", UPPER_UUID],
      ["a UUID without hyphens", uuid(5).replaceAll("-", "")],
      ["a QR shape", qrLike],
      ["an Email", emailLike],
      ["empty", ""],
    ];
    for (const field of [
      "operationExecutionId",
      "requestId",
      "consistencyReviewRef",
      "recoveryExecutionId",
    ]) {
      for (const [label, value] of bad)
        await expectRejected(`${field} with ${label}`, { [field]: value }, value || undefined);
    }
    await expectRejected("operationExecutionId omitted", { operationExecutionId: undefined });
    await expectRejected("operationExecutionId null", { operationExecutionId: null });
  });

  it("TC-OBS-AUD-006-001 idempotency fingerprints must be 32 lowercase hex characters", async () => {
    const bad: [string, string][] = [
      ["31 characters", FP.slice(1)],
      ["33 characters", `${FP}0`],
      ["uppercase", FP.toUpperCase()],
      ["non-hex", "g".repeat(32)],
      ["empty", ""],
      ["a QR shape", qrLike],
    ];
    for (const field of ["transportIdempotencyFp", "providerIdempotencyFp"]) {
      for (const [label, value] of bad)
        await expectRejected(`${field} with ${label}`, { [field]: value }, value || undefined);
      await expectAccepted(`${field} valid`, { [field]: FP });
    }
  });

  it("TC-OBS-AUD-006-001 reason_code and capability keep their bounded formats", async () => {
    for (const value of ["lower_case", spaced, "", "1STARTS_WITH_DIGIT", "A".repeat(97), emailLike])
      await expectRejected(
        `reasonCode ${value.length} chars`,
        { reasonCode: value },
        value || undefined,
      );
    await expectAccepted("reasonCode 96 characters", { reasonCode: "A".repeat(96) });
    await expectAccepted("reasonCode ordinary", { reasonCode: "SYNTHETIC_REASON_1" });

    for (const value of [
      "Role.Manage",
      ".leading.dot",
      "trailing.",
      "nodot",
      "has space.x",
      emailLike,
      `${"a".repeat(30)}.${"b".repeat(34)}`,
    ])
      await expectRejected(`capability ${value.length} chars`, { capability: value }, value);
    await expectAccepted("capability with 64 characters", {
      capability: `${"a".repeat(30)}.${"b".repeat(33)}`,
    });
  });

  it("TC-OBS-AUD-006-001 enumerated fields reject values outside their allowlist", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["auditEventType", { auditEventType: "UNKNOWN" }],
      ["auditEventType lowercase", { auditEventType: "business_effect" }],
      ["actorType", { actorType: "ROBOT" }],
      ["preconditionResult", { preconditionResult: "MAYBE" }],
      ["auditResult", { auditResult: "DONE" }],
      ["effectiveRole", { effectiveRole: "OWNER" }],
      ["effectiveRole lowercase", { effectiveRole: "staff" }],
      ["provider", { provider: "PAYPAL" }],
      ["failureClass", { failureClass: "BROKEN" }],
      ["targetType", { targetType: "SECRET_TABLE" }],
    ];
    for (const [label, override] of cases) await expectRejected(label, override);
    // Every allowed value of the writer-only lists is accepted.
    await expectAccepted("provider", { provider: "NEON_DB" });
    await expectAccepted("effectiveRole", { effectiveRole: "ADMINISTRATOR" });
    await expectAccepted("failureClass", { failureClass: "UNKNOWN_RESULT" });
    await expectAccepted("targetType", { targetType: "WEBHOOK_RECEIPT" });
  });

  it("TC-OBS-AUD-006-001 a change that is not issued by a change spec is refused at run time", async () => {
    const genuine = probe.change({ beforeState: "ACTIVE", summary: { active_count: 1 } });
    const forged = {
      beforeState: "ACTIVE",
      afterState: null,
      changedFields: [],
      summary: { note: emailLike },
    };
    for (const [label, value] of [
      ["a cast plain object", forged],
      ["a spread copy of a genuine change", { ...genuine }],
      ["a JSON round trip of a genuine change", JSON.parse(JSON.stringify(genuine))],
      ["a string", "ACTIVE"],
      ["an empty object", {}],
      ["an array", []],
      ["a number", 1],
    ] as const)
      await expectRejected(label, { change: value }, emailLike);
    // A genuine change, null and no change at all are the only accepted forms.
    await expectAccepted("genuine change", { change: genuine });
    await expectAccepted("null change", { change: null });
    await expectAccepted("omitted change", { change: undefined });
  });

  it("TC-OBS-AUD-006-001 a change is accepted only for the operations its spec was defined for (SPEC-160 §35)", async () => {
    const genuine = probe.change({
      beforeState: "ACTIVE",
      afterState: "REVOKED",
      summary: { role: "ADMINISTRATOR" },
    });
    // The Role operation's change is refused for another API operation, an internal key and a
    // second Role operation the spec does not list, and none of them reaches the database.
    for (const operationId of ["API-ADM-CNT-007", "RECOVERY.ADMIN_BOOTSTRAP", "API-ADM-ROL-002"])
      await expectRejected(
        `a Role change for ${operationId}`,
        { operationId, targetType: "PUBLIC_CONTENT", change: genuine },
        "ADMINISTRATOR",
      );
    await expectAccepted("the operation the change was issued for", { change: genuine });

    // A spec may list several operations; each of them, and only they, accept its changes.
    const shared = defineAuditChange({
      operationIds: ["API-ADM-ROL-002", "RECOVERY.ADMIN_BOOTSTRAP"],
      states: ["ACTIVE", "REVOKED"],
      fields: ["state"],
      summary: {},
    });
    const sharedChange = shared.change({ afterState: "REVOKED", changedFields: ["state"] });
    await expectAccepted("first listed operation", {
      operationId: "API-ADM-ROL-002",
      change: sharedChange,
    });
    await expectAccepted("second listed operation", {
      operationId: "RECOVERY.ADMIN_BOOTSTRAP",
      change: sharedChange,
    });
    await expectRejected("an operation the shared spec does not list", {
      operationId: "API-ADM-ROL-001",
      change: sharedChange,
    });
  });
});

describe("TC-OBS-AUD-006-001 defineAuditChange and change() (OBS-AUD-006, SPEC-160 §35)", () => {
  const baseSpec = {
    operationIds: ["API-ADM-ROL-001"],
    states: ["ACTIVE", "REVOKED"],
    fields: ["role", "state"],
    summary: { role: { kind: "enum", values: ["STAFF", "ADMINISTRATOR"] } },
  };
  const define = (override: Record<string, unknown>) =>
    defineAuditChange({ ...baseSpec, ...override } as never);

  it("TC-OBS-AUD-006-001 a spec definition is refused for malformed states, fields, summary keys and value kinds", () => {
    const cases: [string, Record<string, unknown>, string?][] = [
      ["a lowercase state", { states: ["active"] }, "active"],
      ["a state with a symbol", { states: ["A@B"] }, "A@B"],
      ["a duplicated state", { states: ["ACTIVE", "ACTIVE"] }],
      ["an uppercase field", { fields: ["Role"] }, "Role"],
      ["a field with a space", { fields: [spaced] }, spaced],
      ["a duplicated field", { fields: ["role", "role"] }],
      ["an uppercase summary key", { summary: { Role: { kind: "count" } } }, "Role"],
      ["a summary key with a space", { summary: { [spaced]: { kind: "count" } } }, spaced],
      [
        "an enum value with @",
        { summary: { role: { kind: "enum", values: [emailLike] } } },
        "audit-probe",
      ],
      [
        "a lowercase enum value",
        { summary: { role: { kind: "enum", values: ["staff"] } } },
        "staff",
      ],
      ["a free text kind", { summary: { note: { kind: "text" } } }, "text"],
      ["a missing kind", { summary: { note: {} } }],
      ["no operationIds", { operationIds: undefined }],
      ["an empty operationIds", { operationIds: [] }],
      ["an operationIds that is not an array", { operationIds: "API-ADM-ROL-001" }],
      ["a duplicated operation ID", { operationIds: ["API-ADM-ROL-001", "API-ADM-ROL-001"] }],
      ["a free label as operation ID", { operationIds: ["audit_probe_operation"] }, "audit_probe"],
      ["an Email as operation ID", { operationIds: [emailLike] }, "audit-probe"],
      ["a key outside the §9.1 list", { operationIds: ["RECOVERY.UNKNOWN"] }, "RECOVERY.UNKNOWN"],
      ["a non-string operation ID", { operationIds: [1] }],
    ];
    for (const [label, override, leak] of cases) {
      let caught: unknown;
      try {
        define(override);
      } catch (error) {
        caught = error;
      }
      expect(caught, `${label} must be refused`).toBeInstanceOf(Error);
      if (leak)
        expect((caught as Error).message, `${label} must not echo the input`).not.toContain(leak);
    }
    expect(() => define({})).not.toThrow();
  });

  it("TC-OBS-AUD-006-001 change() refuses states, fields, keys and values the spec does not allow", () => {
    const cases: [string, Record<string, unknown>, string?][] = [
      ["an unknown beforeState", { beforeState: "DELETED" }, "DELETED"],
      ["an unknown afterState", { afterState: "active" }, "active"],
      ["an unknown field", { changedFields: ["body"] }, "body"],
      ["a duplicated field", { changedFields: ["state", "state"] }],
      ["an undeclared summary key", { summary: { note: emailLike } }, "audit-probe"],
      ["an enum value outside the spec", { summary: { role: "OWNER" } }, "OWNER"],
      ["an enum Email", { summary: { role: emailLike } }, "audit-probe"],
      ["a publicRef QR shape", { summary: { target_profile_ref: qrLike } }, "r39x1"],
      ["a publicRef Email", { summary: { target_profile_ref: emailLike } }, "audit-probe"],
      ["a publicRef uppercase UUID", { summary: { target_profile_ref: UPPER_UUID } }, UPPER_UUID],
      ["a negative count", { summary: { active_count: -1 } }],
      ["a fractional count", { summary: { active_count: 1.5 } }],
      ["a NaN count", { summary: { active_count: Number.NaN } }],
      ["an unsafe count", { summary: { active_count: 2 ** 53 } }],
      ["a string count", { summary: { active_count: "1" } }],
      ["a fractional delta", { summary: { delta: 0.5 } }],
      ["an unsafe delta", { summary: { delta: -(2 ** 53) } }],
      ["an object value", { summary: { role: { nested: "STAFF" } } }],
      ["an array value", { summary: { role: ["STAFF"] } }],
      ["a null value", { summary: { role: null } }],
    ];
    for (const [label, input, leak] of cases) {
      let caught: unknown;
      try {
        probe.change(input as never);
      } catch (error) {
        caught = error;
      }
      expect(caught, `${label} must be refused`).toBeInstanceOf(Error);
      if (leak)
        expect((caught as Error).message, `${label} must not echo the input`).not.toContain(leak);
    }
  });

  it("TC-OBS-AUD-006-001 change() builds a frozen, flat value from the allowed parts only", () => {
    const summary = {
      role: "STAFF" as const,
      target_profile_ref: uuid(6),
      active_count: 0,
      delta: -1,
    };
    const change = probe.change({
      beforeState: "ACTIVE",
      afterState: "REVOKED",
      changedFields: ["role", "state"],
      summary,
    });
    expect(change).toMatchObject({
      beforeState: "ACTIVE",
      afterState: "REVOKED",
      changedFields: ["role", "state"],
      summary: { role: "STAFF", target_profile_ref: uuid(6), active_count: 0, delta: -1 },
    });
    expect(Object.isFrozen(change)).toBe(true);
    // Later edits of the caller's object do not reach the issued change.
    (summary as { role: string }).role = "ADMINISTRATOR";
    expect(change.summary).toMatchObject({ role: "STAFF" });
    // Undefined values are dropped, and everything omitted is empty or null.
    const sparse = probe.change({ summary: { role: "STAFF", delta: undefined } } as never);
    expect(sparse.summary).toEqual({ role: "STAFF" });
    expect(sparse.beforeState).toBeNull();
    expect(sparse.afterState).toBeNull();
    expect([...sparse.changedFields]).toEqual([]);
    const empty = probe.change({});
    expect(empty.summary).toEqual({});
    // Boundary values are accepted: count 0, signed extremes.
    expect(() =>
      probe.change({ summary: { active_count: 0, delta: Number.MAX_SAFE_INTEGER } }),
    ).not.toThrow();
    expect(() => probe.change({ summary: { delta: Number.MIN_SAFE_INTEGER } })).not.toThrow();
  });
});

describe("TC-OBS-AUD-006-001 accepted events reach the database as one bound INSERT", () => {
  it("TC-OBS-AUD-006-001 sends exactly one insert into app.audit_events, with no RETURNING, BEGIN or COMMIT", async () => {
    const { client, query, sent } = fake();
    await expect(insertAuditEvent(client, VALID)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
    const { sql, params } = sent()[0] as Sent;
    expect(sql).toMatch(/^insert into "app"\."audit_events"/i);
    expect(sql).not.toMatch(/\breturning\b/i);
    expect(sql).not.toMatch(/\bbegin\b/i);
    expect(sql).not.toMatch(/\bcommit\b/i);
    expect(sql).not.toMatch(/\brollback\b/i);
    // Values are bound, never spliced into the statement (DEV-DB-005).
    for (const value of [VALID.operationId, VALID.operationExecutionId, VALID.actorRef]) {
      expect(sql).not.toContain(value as string);
      expect(params).toContain(value);
    }
    // The database owns identity and time: the writer sends no timestamp or generated id (DB-TIM-002).
    expect(params.some((value) => value instanceof Date)).toBe(false);
    expect(params).not.toContainEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    // The writer owns neither the connection nor the transaction.
    expect(Object.keys(client)).toEqual(["query"]);
  });

  it("TC-OBS-AUD-006-001 persists a change as its summary JSON and field list, or an empty one when there is none", async () => {
    const summary = {
      role: "STAFF" as const,
      target_profile_ref: uuid(7),
      active_count: 1,
      delta: -1,
    };
    const withChange = await expectAccepted("change", {
      change: probe.change({
        beforeState: "ACTIVE",
        afterState: "REVOKED",
        changedFields: ["state"],
        summary,
      }),
    });
    expect(jsonParams(withChange.params)).toContainEqual(summary);
    expect(withChange.params).toEqual(expect.arrayContaining(["ACTIVE", "REVOKED"]));
    expect(
      withChange.params.some((value) =>
        Array.isArray(value)
          ? value.includes("state")
          : typeof value === "string" && value.startsWith("{") && value.includes("state"),
      ),
    ).toBe(true);

    for (const override of [{ change: null }, { change: undefined }, {}]) {
      const bare = await expectAccepted("no change", override);
      expect(jsonParams(bare.params)).toContainEqual({});
      expect(bare.params).not.toContain("ACTIVE");
    }
  });

  it("TC-OBS-AUD-006-001 a fully populated event binds every field", async () => {
    const { params } = await expectAccepted("full", {
      targetType: "ROLE_ASSIGNMENT",
      targetRef: uuid(8),
      requestId: uuid(9),
      businessCauseRef: "cause_probe_1",
      transportIdempotencyFp: FP,
      provider: "STRIPE",
      providerEventRef: "evt_probe_1",
      providerObjectRef: "obj_probe_1",
      providerIdempotencyFp: FP,
      failureClass: "SUCCESS",
      reasonCode: "PROBE_REASON",
      consistencyReviewRef: uuid(10),
      recoveryExecutionId: uuid(11),
    });
    expect(params).toEqual(
      expect.arrayContaining([
        "PRIVILEGED_OPERATION",
        "STAFF",
        uuid(1),
        "audit.probe",
        "API-ADM-ROL-001",
        uuid(2),
        "ROLE_ASSIGNMENT",
        uuid(8),
        uuid(9),
        "cause_probe_1",
        FP,
        "STRIPE",
        "evt_probe_1",
        "obj_probe_1",
        "PASSED",
        "COMMITTED",
        "SUCCESS",
        "PROBE_REASON",
        uuid(10),
        uuid(11),
      ]),
    );
  });

  it("TC-OBS-AUD-006-001 unknown input properties never reach the statement or its parameters", async () => {
    const leaks = { rawBody: qrLike, recipient: emailLike, token: secretLike, row_dump: jwtLike };
    const { client, query, sent } = fake();
    const outcome = await insertAuditEvent(client, {
      ...VALID,
      ...leaks,
    } as unknown as AuditEventInput).then(
      () => "accepted",
      () => "rejected",
    );
    if (outcome === "rejected") expect(query).not.toHaveBeenCalled();
    const serialised = JSON.stringify(sent());
    for (const value of Object.values(leaks)) expect(serialised).not.toContain(value);
  });
});

describe("TC-OBS-AUD-006-001 database errors propagate unchanged (OBS-AUD-008 writer level, DEV-OBS-006)", () => {
  it("TC-OBS-AUD-006-001 a rejected INSERT is rethrown as the very same error object, with one attempt and no retry", async () => {
    for (const code of ["42501", "23514", "40001", "40P01", "55P03"]) {
      const failure = Object.assign(new Error("synthetic-private-message"), { code });
      const { client, query } = fake(async () => {
        throw failure;
      });
      const caught = await settle(() => insertAuditEvent(client, VALID));
      // Drizzle wraps driver errors in DrizzleQueryError (cause = the driver error); the writer must
      // hand the original back so SQLSTATE based classification in transaction() keeps working.
      expect(caught, code).toBe(failure);
      expect(sqlState(caught), code).toBe(code);
      expect(query, code).toHaveBeenCalledTimes(1);
    }
  });

  it("TC-OBS-AUD-006-001 an error without a SQLSTATE is also returned as the same object", async () => {
    const failure = new Error("synthetic-connection-lost");
    const { client, query } = fake(async () => {
      throw failure;
    });
    expect(await settle(() => insertAuditEvent(client, VALID))).toBe(failure);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("TC-OBS-AUD-006-001 type level: the compiler also refuses unsafe change input (checked by pnpm typecheck)", () => {
  it("TC-OBS-AUD-006-001 each @ts-expect-error line is a type error and is also refused at run time", async () => {
    const { client } = fake();
    const send = (event: Partial<AuditEventInput>) =>
      insertAuditEvent(client, { ...VALID, ...event });
    const plain = { beforeState: null, afterState: null, changedFields: [], summary: {} };

    // @ts-expect-error a summary key that the spec does not declare
    expect(() => probe.change({ summary: { unknown_key: 1 } })).toThrow();
    // @ts-expect-error an enum value outside the declared values
    expect(() => probe.change({ summary: { role: "OWNER" } })).toThrow();
    // @ts-expect-error a count must be a number
    expect(() => probe.change({ summary: { active_count: "1" } })).toThrow();
    // @ts-expect-error a state that the spec does not declare
    expect(() => probe.change({ beforeState: "DELETED" })).toThrow();
    // @ts-expect-error a field that the spec does not declare
    expect(() => probe.change({ changedFields: ["body"] })).toThrow();
    // @ts-expect-error a plain object is not an issued AuditChange
    await expect(send({ change: plain })).rejects.toThrow();
    // @ts-expect-error an audit_event_type outside the allowlist
    await expect(send({ auditEventType: "UNKNOWN" })).rejects.toThrow();
    await expect(
      insertAuditEvent(client, {
        ...VALID,
        operationId: "API-ADM-CNT-007",
        // @ts-expect-error a change issued for another operation is not accepted for this one
        change: probe.change({ afterState: "REVOKED" }),
      }),
    ).rejects.toThrow();
    const freeText = {
      operationIds: ["API-ADM-ROL-001"],
      states: [],
      fields: [],
      summary: { n: { kind: "text" } },
    } as const;
    // @ts-expect-error a free text summary kind cannot be declared
    expect(() => defineAuditChange(freeText)).toThrow();
    const noValues = {
      operationIds: ["API-ADM-ROL-001"],
      states: [],
      fields: [],
      summary: { n: { kind: "enum", values: [] } },
    } as const;
    // @ts-expect-error an enum needs at least one value
    const declareEmptyEnum = () => defineAuditChange(noValues);
    expect(typeof declareEmptyEnum).toBe("function");
  });
});
