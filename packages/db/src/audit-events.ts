import { DrizzleQueryError } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_EVENT_TYPES,
  AUDIT_PRECONDITION_RESULTS,
  AUDIT_RESULTS,
  type AuditActorType,
  type AuditEventType,
  type AuditPreconditionResult,
  type AuditResult,
  auditEvents,
} from "./schema/audit.ts";

// Audit Event writer (SPEC-160 §33, §35, §36.1; OBS-AUD-004 / 006 / 007).
// It appends one row to app.audit_events inside the caller's transaction. It never opens a
// connection or a transaction, never retries, never reads the row back (the runtime role has no
// SELECT) and never logs (OBS-AUD-001). Every value is checked before anything reaches the database,
// and a rejection names only a fixed field, never the offending value (TST-UNT-003).

// Allowlists that SPEC-160 §33.1 / SPEC-150 §8 / SPEC-160 §20 give but no CHECK constraint enforces.
// The writer is the enforcement point for these columns (the CHECK allowlists live in ./schema/audit.ts).
export const AUDIT_EFFECTIVE_ROLES = ["STAFF", "ADMINISTRATOR"] as const;
export const AUDIT_PROVIDERS = ["STRIPE", "RESEND", "NEON_AUTH", "NEON_DB"] as const;
export const AUDIT_FAILURE_CLASSES = [
  "SUCCESS",
  "TEMPORARY_FAILURE",
  "PERMANENT_FAILURE",
  "UNKNOWN_RESULT",
  "CONFLICT_LOSER",
  "CONSISTENCY_FAILURE",
  "SECURITY_FAILURE",
] as const;
export const AUDIT_TARGET_TYPES = [
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
] as const;

export type AuditEffectiveRole = (typeof AUDIT_EFFECTIVE_ROLES)[number];
export type AuditProvider = (typeof AUDIT_PROVIDERS)[number];
export type AuditFailureClass = (typeof AUDIT_FAILURE_CLASSES)[number];
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

// Formats. Each pattern must match the whole value. None of them admits ".", "/", "@" or
// whitespace in a reference, which rejects Email addresses, URLs, raw QR strings (they contain ".")
// and JWT / Session tokens (also "."), as well as free text, before the value is stored.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FINGERPRINT = /^[0-9a-f]{32}$/; // SPEC-160 §11
const SAFE_REF = /^[A-Za-z0-9_:-]{1,128}$/;
const REASON_CODE = /^[A-Z][A-Z0-9_]{0,95}$/;
const CAPABILITY = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;
const CAPABILITY_MAX_LENGTH = 64;
const STATE_TOKEN = /^[A-Z][A-Z0-9_]{0,63}$/;
const FIELD_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const WORKER_KEY = /^[a-z][a-z0-9-]{0,63}$/;
const RECONCILIATION_KEY = /^[a-z][a-z0-9_:-]{0,63}$/;

const rejectField = (field: string): never => {
  throw new Error(`Invalid audit event field: ${field}`);
};
const rejectSpec = (part: string): never => {
  throw new Error(`Invalid audit change spec: ${part}`);
};
const rejectChange = (part: string): never => {
  throw new Error(`Invalid audit change: ${part}`);
};

// ---- per-operation change specs (OBS-AUD-006, SPEC-160 §35) ------------------------------------
//
// before_state, after_state, changed_fields and safe_change_summary may only be produced by a
// change spec declared for one operation. A spec can declare four kinds of summary value and no
// free text, so no spec can let a body, Email address, QR, token or Secret reach those columns.

/** The only value kinds a summary entry can declare. There is deliberately no free-text kind. */
export type AuditSummaryValueSpec =
  | { readonly kind: "enum"; readonly values: readonly [string, ...string[]] }
  | { readonly kind: "publicRef" } // lowercase UUID
  | { readonly kind: "count" } // safe integer, 0 or more
  | { readonly kind: "integer" }; // safe integer, signed

type SummaryValue<V extends AuditSummaryValueSpec> = V extends {
  readonly kind: "enum";
  readonly values: readonly (infer E)[];
}
  ? E
  : V extends { readonly kind: "publicRef" }
    ? string
    : number;

declare const auditChangeBrand: unique symbol;

/** A value issued by `defineAuditChange(...).change(...)`. Plain objects do not type-check as one. */
export type AuditChange = {
  readonly [auditChangeBrand]: true;
  readonly beforeState: string | null;
  readonly afterState: string | null;
  readonly changedFields: readonly string[];
  readonly summary: Readonly<Record<string, string | number>>;
};

// A cast cannot forge an issued change: the writer accepts only objects registered here.
const issuedChanges = new WeakSet<object>();

const hasDuplicates = (values: readonly string[]): boolean =>
  new Set(values).size !== values.length;

/**
 * Declares which states, field names and summary entries one operation may record. The spec is
 * validated and frozen here; `change()` then builds the only values the writer accepts.
 * No operation spec is registered yet (SPEC-160 §35 does not name the summary keys).
 */
export function defineAuditChange<
  const S extends string,
  const F extends string,
  const V extends Record<string, AuditSummaryValueSpec>,
>(spec: { readonly states: readonly S[]; readonly fields: readonly F[]; readonly summary: V }) {
  const input = spec as {
    states?: unknown;
    fields?: unknown;
    summary?: unknown;
  } | null;
  if (typeof input !== "object" || input === null) return rejectSpec("spec");
  const { states, fields, summary } = input;
  if (!Array.isArray(states)) return rejectSpec("states");
  if (!Array.isArray(fields)) return rejectSpec("fields");
  if (typeof summary !== "object" || summary === null || Array.isArray(summary))
    return rejectSpec("summary");

  const allowedStates: string[] = [];
  for (const state of states) {
    if (typeof state !== "string" || !STATE_TOKEN.test(state)) rejectSpec("states");
    allowedStates.push(state as string);
  }
  if (hasDuplicates(allowedStates)) rejectSpec("states");

  const allowedFields: string[] = [];
  for (const field of fields) {
    if (typeof field !== "string" || !FIELD_NAME.test(field)) rejectSpec("fields");
    allowedFields.push(field as string);
  }
  if (hasDuplicates(allowedFields)) rejectSpec("fields");

  const entries = new Map<string, Readonly<AuditSummaryValueSpec>>();
  for (const [key, declared] of Object.entries(summary as Record<string, unknown>)) {
    if (!FIELD_NAME.test(key)) rejectSpec("summary");
    const value = declared as { kind?: unknown; values?: unknown } | null;
    if (typeof value !== "object" || value === null) return rejectSpec("summary");
    switch (value.kind) {
      case "enum": {
        const values = value.values;
        if (
          !Array.isArray(values) ||
          values.length === 0 ||
          !values.every((v) => typeof v === "string" && STATE_TOKEN.test(v)) ||
          hasDuplicates(values)
        )
          return rejectSpec("summary");
        entries.set(
          key,
          Object.freeze({
            kind: "enum",
            values: Object.freeze([...values]) as unknown as readonly [string, ...string[]],
          }),
        );
        break;
      }
      case "publicRef":
      case "count":
      case "integer":
        entries.set(key, Object.freeze({ kind: value.kind }));
        break;
      default:
        return rejectSpec("summary");
    }
  }

  const frozenStates: readonly string[] = Object.freeze(allowedStates);
  const frozenFields: readonly string[] = Object.freeze(allowedFields);

  const matchesState = (value: unknown): value is string | null =>
    value === null || (typeof value === "string" && frozenStates.includes(value));

  const matchesSummaryValue = (declared: AuditSummaryValueSpec, value: unknown): boolean => {
    switch (declared.kind) {
      case "enum":
        return typeof value === "string" && declared.values.includes(value);
      case "publicRef":
        return typeof value === "string" && UUID.test(value);
      case "count":
        return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
      case "integer":
        return typeof value === "number" && Number.isSafeInteger(value);
    }
  };

  return {
    change(change: {
      beforeState?: S | null;
      afterState?: S | null;
      changedFields?: readonly F[];
      summary?: { readonly [K in keyof V]?: SummaryValue<V[K]> };
    }): AuditChange {
      const beforeState = change.beforeState ?? null;
      const afterState = change.afterState ?? null;
      if (!matchesState(beforeState)) return rejectChange("beforeState");
      if (!matchesState(afterState)) return rejectChange("afterState");

      const changedFields: string[] = [];
      for (const field of change.changedFields ?? []) {
        if (typeof field !== "string" || !frozenFields.includes(field))
          return rejectChange("changedFields");
        changedFields.push(field);
      }
      if (hasDuplicates(changedFields)) return rejectChange("changedFields");

      const resultSummary: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(change.summary ?? {})) {
        if (value === undefined) continue;
        const declared = entries.get(key);
        if (declared === undefined || !matchesSummaryValue(declared, value))
          return rejectChange("summary");
        resultSummary[key] = value as string | number;
      }

      const issued = Object.freeze({
        beforeState,
        afterState,
        changedFields: Object.freeze(changedFields),
        summary: Object.freeze(resultSummary),
      }) as unknown as AuditChange;
      issuedChanges.add(issued);
      return issued;
    },
  };
}

// ---- writer -------------------------------------------------------------------------------------

export type AuditEventInput = {
  readonly auditEventType: AuditEventType;
  readonly actorType: AuditActorType;
  readonly operationId: string;
  readonly operationExecutionId: string;
  readonly preconditionResult: AuditPreconditionResult;
  readonly auditResult: AuditResult;
  readonly actorRef?: string | null;
  readonly capability?: string | null;
  readonly targetRef?: string | null;
  readonly requestId?: string | null;
  readonly businessCauseRef?: string | null;
  readonly effectiveRole?: AuditEffectiveRole | null;
  readonly targetType?: AuditTargetType | null;
  readonly transportIdempotencyFp?: string | null;
  readonly provider?: AuditProvider | null;
  readonly providerEventRef?: string | null;
  readonly providerObjectRef?: string | null;
  readonly providerIdempotencyFp?: string | null;
  readonly failureClass?: AuditFailureClass | null;
  readonly reasonCode?: string | null;
  readonly change?: AuditChange | null;
  readonly consistencyReviewRef?: string | null;
  readonly recoveryExecutionId?: string | null;
};

const isString = (value: unknown): value is string => typeof value === "string";

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (isString(value) && (allowed as readonly string[]).includes(value)) return value as T;
  return rejectField(field);
}
function optionalOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T | null {
  return value === undefined || value === null ? null : oneOf(value, allowed, field);
}
function matching(value: unknown, pattern: RegExp, field: string): string {
  if (isString(value) && pattern.test(value)) return value;
  return rejectField(field);
}
function optionalMatching(value: unknown, pattern: RegExp, field: string): string | null {
  return value === undefined || value === null ? null : matching(value, pattern, field);
}

// SPEC-160 §19.1: actor_ref is bounded per actor_type and is never an Email address or credential.
function actorRefFor(actorType: AuditActorType, value: unknown): string | null {
  const ref = value === undefined ? null : value;
  if (actorType === "GUEST") return ref === null ? null : rejectField("actorRef");
  if (!isString(ref)) return rejectField("actorRef");
  switch (actorType) {
    case "AUTHENTICATED_USER":
    case "STAFF":
    case "ADMINISTRATOR":
      return UUID.test(ref) || FINGERPRINT.test(ref) ? ref : rejectField("actorRef");
    case "SYSTEM_WORKER":
      return matching(ref, WORKER_KEY, "actorRef");
    case "SCHEDULED_RECONCILIATION":
      return matching(ref, RECONCILIATION_KEY, "actorRef");
    case "EXTERNAL_PROVIDER":
      return ref === "STRIPE" || ref === "RESEND" ? ref : rejectField("actorRef");
    case "INFRASTRUCTURE_OPERATOR":
      return matching(ref, SAFE_REF, "actorRef");
  }
}

/**
 * Appends one `app.audit_events` row on the caller's transaction.
 *
 * Call it with the client that `transaction()` passes to its callback. A client from a separate
 * connection, or one in autocommit mode, does not give the atomicity of SPEC-160 §36.1: the audit row
 * and the business write must commit or roll back together, so an INSERT failure must propagate and
 * abort the caller's transaction.
 *
 * The writer sends exactly one parameterised INSERT: no BEGIN / COMMIT, no RETURNING (the runtime
 * role has no SELECT), no retry and no log. `audit_event_id`, `occurred_at` and `created_at` are
 * assigned by the database (DB-TIM-002). A failure from PostgreSQL is rethrown as the driver's own
 * error object so that SQLSTATE based handling in `transaction()` keeps working.
 */
export async function insertAuditEvent(client: PoolClient, event: AuditEventInput): Promise<void> {
  if (typeof event !== "object" || event === null) return rejectField("event");

  const auditEventType = oneOf(event.auditEventType, AUDIT_EVENT_TYPES, "auditEventType");
  const actorType = oneOf(event.actorType, AUDIT_ACTOR_TYPES, "actorType");
  const actorRef = actorRefFor(actorType, event.actorRef);
  const effectiveRole = optionalOneOf(event.effectiveRole, AUDIT_EFFECTIVE_ROLES, "effectiveRole");
  const capability = optionalMatching(event.capability, CAPABILITY, "capability");
  if (capability !== null && capability.length > CAPABILITY_MAX_LENGTH)
    return rejectField("capability");
  const operationId = matching(event.operationId, SAFE_REF, "operationId");
  const operationExecutionId = matching(event.operationExecutionId, UUID, "operationExecutionId");
  const targetType = optionalOneOf(event.targetType, AUDIT_TARGET_TYPES, "targetType");
  const targetRef = optionalMatching(event.targetRef, SAFE_REF, "targetRef");
  const requestId = optionalMatching(event.requestId, UUID, "requestId");
  const businessCauseRef = optionalMatching(event.businessCauseRef, SAFE_REF, "businessCauseRef");
  const transportIdempotencyFp = optionalMatching(
    event.transportIdempotencyFp,
    FINGERPRINT,
    "transportIdempotencyFp",
  );
  const provider = optionalOneOf(event.provider, AUDIT_PROVIDERS, "provider");
  const providerEventRef = optionalMatching(event.providerEventRef, SAFE_REF, "providerEventRef");
  const providerObjectRef = optionalMatching(
    event.providerObjectRef,
    SAFE_REF,
    "providerObjectRef",
  );
  const providerIdempotencyFp = optionalMatching(
    event.providerIdempotencyFp,
    FINGERPRINT,
    "providerIdempotencyFp",
  );
  const preconditionResult = oneOf(
    event.preconditionResult,
    AUDIT_PRECONDITION_RESULTS,
    "preconditionResult",
  );
  const auditResult = oneOf(event.auditResult, AUDIT_RESULTS, "auditResult");
  const failureClass = optionalOneOf(event.failureClass, AUDIT_FAILURE_CLASSES, "failureClass");
  const reasonCode = optionalMatching(event.reasonCode, REASON_CODE, "reasonCode");
  const consistencyReviewRef = optionalMatching(
    event.consistencyReviewRef,
    UUID,
    "consistencyReviewRef",
  );
  const recoveryExecutionId = optionalMatching(
    event.recoveryExecutionId,
    UUID,
    "recoveryExecutionId",
  );

  const change = event.change ?? null;
  if (change !== null && !(typeof change === "object" && issuedChanges.has(change)))
    return rejectField("change");

  // Only the known keys are copied, so an unknown input property can never reach the statement.
  const row = {
    auditEventType,
    actorType,
    actorRef,
    effectiveRole,
    capability,
    operationId,
    operationExecutionId,
    targetType,
    targetRef,
    requestId,
    businessCauseRef,
    transportIdempotencyFp,
    provider,
    providerEventRef,
    providerObjectRef,
    providerIdempotencyFp,
    preconditionResult,
    auditResult,
    failureClass,
    reasonCode,
    beforeState: change === null ? null : change.beforeState,
    afterState: change === null ? null : change.afterState,
    changedFields: change === null ? [] : [...change.changedFields],
    safeChangeSummary: change === null ? {} : { ...change.summary },
    consistencyReviewRef,
    recoveryExecutionId,
  };

  try {
    await drizzle(client).insert(auditEvents).values(row);
  } catch (error) {
    // drizzle-orm wraps driver errors in DrizzleQueryError, whose message carries the SQL text and
    // the bound values and whose SQLSTATE sits on `cause`. Hand back the driver's own error so the
    // caller can classify it (`sqlState`) and so bound values do not leave through the message.
    if (error instanceof DrizzleQueryError && error.cause !== undefined) throw error.cause;
    throw error;
  }
}
