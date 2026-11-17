import { sql } from "drizzle-orm";
import { char, check, index, jsonb, primaryKey, text, unique, uuid } from "drizzle-orm/pg-core";
import { app } from "./app-schema.ts";
import { internalId, timestamptzNow } from "./common.ts";

// SPEC-160 §33 `app.audit_events` (OBS-AUD-004). Append-only: the runtime role may INSERT only
// (see migrations/0002_audit_events.sql). These declarations exist for types and queries; the DDL
// source of truth is the SQL migration (SPEC-100 §57, DB-MIG-002).

// Allowlists backing the CHECK constraints below (SPEC-160 §32 / §19). Order follows the spec.
export const AUDIT_EVENT_TYPES = [
  "PRIVILEGED_OPERATION",
  "PRIVILEGED_OPERATION_DENIED",
  "BUSINESS_EFFECT",
  "RECOVERY_EXECUTION",
  "SECURITY_SENSITIVE_OPERATION",
  "EMERGENCY_ADMIN_RECOVERY",
] as const;
export const AUDIT_ACTOR_TYPES = [
  "GUEST",
  "AUTHENTICATED_USER",
  "STAFF",
  "ADMINISTRATOR",
  "SYSTEM_WORKER",
  "SCHEDULED_RECONCILIATION",
  "EXTERNAL_PROVIDER",
  "INFRASTRUCTURE_OPERATOR",
] as const;
export const AUDIT_PRECONDITION_RESULTS = [
  "PASSED",
  "FAILED",
  "NOT_APPLICABLE",
  "UNKNOWN",
] as const;
export const AUDIT_RESULTS = [
  "REQUESTED",
  "AUTHORIZED",
  "REJECTED",
  "COMMITTED",
  "NOOP",
  "PENDING",
  "UNKNOWN",
  "FAILED",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];
export type AuditPreconditionResult = (typeof AUDIT_PRECONDITION_RESULTS)[number];
export type AuditResult = (typeof AUDIT_RESULTS)[number];

export const auditEvents = app.table(
  "audit_events",
  {
    id: internalId(),
    auditEventId: uuid("audit_event_id").notNull().defaultRandom(),
    occurredAt: timestamptzNow("occurred_at"),
    auditEventType: text("audit_event_type").notNull(),
    actorType: text("actor_type").notNull(),
    actorRef: text("actor_ref"),
    effectiveRole: text("effective_role"),
    capability: text("capability"),
    operationId: text("operation_id").notNull(),
    operationExecutionId: uuid("operation_execution_id").notNull(),
    targetType: text("target_type"),
    targetRef: text("target_ref"),
    requestId: uuid("request_id"),
    businessCauseRef: text("business_cause_ref"),
    transportIdempotencyFp: char("transport_idempotency_fp", { length: 32 }),
    provider: text("provider"),
    providerEventRef: text("provider_event_ref"),
    providerObjectRef: text("provider_object_ref"),
    providerIdempotencyFp: char("provider_idempotency_fp", { length: 32 }),
    preconditionResult: text("precondition_result").notNull(),
    auditResult: text("audit_result").notNull(),
    failureClass: text("failure_class"),
    reasonCode: text("reason_code"),
    beforeState: text("before_state"),
    afterState: text("after_state"),
    changedFields: text("changed_fields").array().notNull().default(sql`'{}'::text[]`),
    safeChangeSummary: jsonb("safe_change_summary")
      .$type<Readonly<Record<string, string | number>>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    consistencyReviewRef: uuid("consistency_review_ref"),
    recoveryExecutionId: uuid("recovery_execution_id"),
    createdAt: timestamptzNow("created_at"),
  },
  (t) => [
    primaryKey({ name: "pk_audit_events", columns: [t.id] }),
    unique("uq_audit_events_audit_event_id").on(t.auditEventId),
    check(
      "ck_audit_events_audit_event_type",
      sql`${t.auditEventType} IN ('PRIVILEGED_OPERATION','PRIVILEGED_OPERATION_DENIED','BUSINESS_EFFECT','RECOVERY_EXECUTION','SECURITY_SENSITIVE_OPERATION','EMERGENCY_ADMIN_RECOVERY')`,
    ),
    check(
      "ck_audit_events_actor_type",
      sql`${t.actorType} IN ('GUEST','AUTHENTICATED_USER','STAFF','ADMINISTRATOR','SYSTEM_WORKER','SCHEDULED_RECONCILIATION','EXTERNAL_PROVIDER','INFRASTRUCTURE_OPERATOR')`,
    ),
    check(
      "ck_audit_events_precondition_result",
      sql`${t.preconditionResult} IN ('PASSED','FAILED','NOT_APPLICABLE','UNKNOWN')`,
    ),
    check(
      "ck_audit_events_audit_result",
      sql`${t.auditResult} IN ('REQUESTED','AUTHORIZED','REJECTED','COMMITTED','NOOP','PENDING','UNKNOWN','FAILED')`,
    ),
    index("ix_audit_events_occurred_at").on(t.occurredAt.desc()),
    index("ix_audit_events_actor_time")
      .on(t.actorRef, t.occurredAt.desc())
      .where(sql`${t.actorRef} IS NOT NULL`),
    index("ix_audit_events_operation_time").on(t.operationId, t.occurredAt.desc()),
    index("ix_audit_events_target_time")
      .on(t.targetType, t.targetRef, t.occurredAt.desc())
      .where(sql`${t.targetRef} IS NOT NULL`),
    index("ix_audit_events_request").on(t.requestId).where(sql`${t.requestId} IS NOT NULL`),
    index("ix_audit_events_recovery")
      .on(t.recoveryExecutionId)
      .where(sql`${t.recoveryExecutionId} IS NOT NULL`),
    index("ix_audit_events_review")
      .on(t.consistencyReviewRef)
      .where(sql`${t.consistencyReviewRef} IS NOT NULL`),
  ],
);
