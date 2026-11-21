-- SPEC-100 §43.1 app.idempotency_records: the replay record of Transport Idempotency (SPEC-110 §18.1, UCR-110-003).
-- Table only: no row is created here. No trigger, no function and no change to an existing object.
-- DB-ARC-007: every constraint and index has an explicit name; DB-MIG-002: this SQL is the DDL source of truth.
-- DB-IDM-001: only digests and references are stored. There is no column for a raw Idempotency-Key, a request or
-- response body, a Checkout URL, a Stripe Session ID, an Email address or a QR value.
-- DB-ID-003 / SPEC-100 §7: internal bigint identity id; foreign keys use the internal id.
CREATE TABLE app.idempotency_records (
 id bigint GENERATED ALWAYS AS IDENTITY,
 principal_profile_id bigint NOT NULL,
 operation_id text NOT NULL,
 key_digest bytea NOT NULL,
 request_digest bytea NOT NULL,
 result_ref_type text,
 result_refs uuid[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 -- API-IDM-008 / DB-IDM-003: expires_at is a plain column, not a generated column; the CHECK below keeps it
 -- exactly 24 hours after created_at, including when an expired row is reused in place.
 expires_at timestamptz NOT NULL DEFAULT transaction_timestamp() + interval '24 hours',
 CONSTRAINT pk_idempotency_records PRIMARY KEY (id),
 -- DB-FK-002 / SPEC-100 §11: a Business Profile is never removed by cascade (ON DELETE RESTRICT).
 CONSTRAINT fk_idempotency_records_principal_profile FOREIGN KEY (principal_profile_id) REFERENCES app.business_profiles(id) ON DELETE RESTRICT,
 -- DB-IDM-001 / API-IDM-005: key and request digests are SHA-256 values of 32 bytes.
 CONSTRAINT ck_idempotency_records_key_digest CHECK (octet_length(key_digest) = 32),
 CONSTRAINT ck_idempotency_records_request_digest CHECK (octet_length(request_digest) = 32),
 -- API-IDM-008: a record is valid for 24 hours from created_at.
 CONSTRAINT ck_idempotency_records_expiry CHECK (expires_at = created_at + interval '24 hours'),
 -- API-IDM-007: the result is a type and references together, or neither. The set of result_ref_type values
 -- belongs to each Operation (SPEC-100 §43.1), so no value list is enforced here.
 CONSTRAINT ck_idempotency_records_result_ref CHECK ((result_ref_type IS NULL) = (cardinality(result_refs) = 0))
);

-- API-IDM-005 / DB-IDM-002 / SPEC-100 §5 and §45.6: the UNIQUE key is a unique index (ux_ prefix). It also serves
-- the lookup, so no further index is created (DB-IDX-001).
CREATE UNIQUE INDEX ux_idempotency_records_principal_operation_key
  ON app.idempotency_records (principal_profile_id, operation_id, key_digest);

-- SEC-DB-001 / SPEC-180 §22.2 / DB-IDM-003: only app_api_runtime gets access, and it cannot remove rows.
-- Expired rows are reused by an UPDATE; there is no purge. Sequence privileges are not granted: identity values
-- are generated without them. Workers get no grant: recovery commands that need a record are API Operations.
REVOKE ALL ON app.idempotency_records
  FROM PUBLIC, app_runtime, app_api_runtime, app_email_runtime, app_reconciliation_runtime;
GRANT SELECT, INSERT, UPDATE ON app.idempotency_records TO app_api_runtime;
