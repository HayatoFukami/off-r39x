-- SPEC-160 §33 app.audit_events (OBS-AUD-004). SPEC-100 §44 delegates the generic audit table to SPEC-160.
-- Append-only: no UPDATE path, no DELETE path and no correction path are created here.
CREATE TABLE app.audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY,
 audit_event_id uuid NOT NULL DEFAULT gen_random_uuid(),
 occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 audit_event_type text NOT NULL,
 actor_type text NOT NULL,
 actor_ref text,
 effective_role text,
 capability text,
 operation_id text NOT NULL,
 operation_execution_id uuid NOT NULL,
 target_type text,
 target_ref text,
 request_id uuid,
 business_cause_ref text,
 transport_idempotency_fp char(32),
 provider text,
 provider_event_ref text,
 provider_object_ref text,
 provider_idempotency_fp char(32),
 precondition_result text NOT NULL,
 audit_result text NOT NULL,
 failure_class text,
 reason_code text,
 before_state text,
 after_state text,
 changed_fields text[] NOT NULL DEFAULT '{}'::text[],
 safe_change_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
 consistency_review_ref uuid,
 recovery_execution_id uuid,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CONSTRAINT pk_audit_events PRIMARY KEY (id),
 CONSTRAINT uq_audit_events_audit_event_id UNIQUE (audit_event_id),
 -- SPEC-160 §32 / §19 allowlist; DB-STA-002 (allowed values only); DB-ARC-007
 CONSTRAINT ck_audit_events_audit_event_type CHECK (audit_event_type IN ('PRIVILEGED_OPERATION','PRIVILEGED_OPERATION_DENIED','BUSINESS_EFFECT','RECOVERY_EXECUTION','SECURITY_SENSITIVE_OPERATION','EMERGENCY_ADMIN_RECOVERY')),
 CONSTRAINT ck_audit_events_actor_type CHECK (actor_type IN ('GUEST','AUTHENTICATED_USER','STAFF','ADMINISTRATOR','SYSTEM_WORKER','SCHEDULED_RECONCILIATION','EXTERNAL_PROVIDER','INFRASTRUCTURE_OPERATOR')),
 CONSTRAINT ck_audit_events_precondition_result CHECK (precondition_result IN ('PASSED','FAILED','NOT_APPLICABLE','UNKNOWN')),
 CONSTRAINT ck_audit_events_audit_result CHECK (audit_result IN ('REQUESTED','AUTHORIZED','REJECTED','COMMITTED','NOOP','PENDING','UNKNOWN','FAILED'))
);
-- SPEC-160 §33.1 indexes; SPEC-100 §57 (partial indexes are defined by this SQL)
CREATE INDEX ix_audit_events_occurred_at ON app.audit_events(occurred_at DESC);
CREATE INDEX ix_audit_events_actor_time ON app.audit_events(actor_ref, occurred_at DESC) WHERE actor_ref IS NOT NULL;
CREATE INDEX ix_audit_events_operation_time ON app.audit_events(operation_id, occurred_at DESC);
CREATE INDEX ix_audit_events_target_time ON app.audit_events(target_type, target_ref, occurred_at DESC) WHERE target_ref IS NOT NULL;
CREATE INDEX ix_audit_events_request ON app.audit_events(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX ix_audit_events_recovery ON app.audit_events(recovery_execution_id) WHERE recovery_execution_id IS NOT NULL;
CREATE INDEX ix_audit_events_review ON app.audit_events(consistency_review_ref) WHERE consistency_review_ref IS NOT NULL;
-- OBS-AUD-004 / SPEC-160 §33.2 / INF-AUD-001 / SEC-DB-001; SPEC-100 §53
-- The API runtime may only append. No runtime role may read, change or remove rows.
REVOKE ALL ON app.audit_events FROM PUBLIC, app_runtime, app_api_runtime, app_email_runtime, app_reconciliation_runtime;
GRANT INSERT ON app.audit_events TO app_api_runtime;
