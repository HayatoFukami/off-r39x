-- PR-GK-1: the Karaoke Exclusive Scope and Slot tables (SPEC-100 §27, §28, §28.1, §45.4). Constraints and
-- indexes carry explicit names (DB-ARC-007); the Scope overlap exclusion is SQL-only DDL (DB-MIG-002, SPEC-100 §57).
-- Times are timestamptz and created_at / updated_at default to transaction_timestamp(); updated_at is maintained
-- by the repository, not by a trigger (DB-TIM-001..003). Internal ids are identity bigint and public_ref is a
-- separate uuid (DB-ID-001..003). No rows are created here, and no trigger, function or existing object changes.
-- Extensions, the app schema and the roles come from 0001 (DB-MIG-001): this file never creates btree_gist.

-- SPEC-100 §27 karaoke_exclusive_scopes. KRK-SCP-001: a Scope is the unit within which Slots must not overlap.
CREATE TABLE app.karaoke_exclusive_scopes (
 id bigint GENERATED ALWAYS AS IDENTITY,
 public_ref uuid NOT NULL DEFAULT gen_random_uuid(),
 event_id bigint NOT NULL,
 name text NOT NULL,
 sort_order integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CONSTRAINT pk_karaoke_exclusive_scopes PRIMARY KEY (id),
 CONSTRAINT uq_karaoke_exclusive_scopes_public_ref UNIQUE (public_ref),
 CONSTRAINT fk_karaoke_exclusive_scopes_event FOREIGN KEY (event_id) REFERENCES app.events(id) ON DELETE RESTRICT
);

-- SPEC-100 §28 karaoke_slots. KRK-SCP-002: every Slot belongs to a Scope. KRK-TIM-001: usage_end (end of use) and
-- cycle_end (end of maintenance) are separate; the 15 + 5 minute standard is a generation concern and is not fixed
-- here. DB-STA-002 / SPEC-030 §13.3: the state allowlist. KRK-GEN-005 / KRK-GEN-009 / INV-010-10: the two UNIQUE
-- constraints make a retried generation converge on the existing row. state has no default: the generator sets it.
CREATE TABLE app.karaoke_slots (
 id bigint GENERATED ALWAYS AS IDENTITY,
 public_ref uuid NOT NULL DEFAULT gen_random_uuid(),
 exclusive_scope_id bigint NOT NULL,
 sales_configuration_id bigint NOT NULL,
 state text NOT NULL,
 usage_start timestamptz NOT NULL,
 usage_end timestamptz NOT NULL,
 cycle_end timestamptz NOT NULL,
 generation_cause_key uuid NOT NULL,
 generation_candidate_no integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CONSTRAINT pk_karaoke_slots PRIMARY KEY (id),
 CONSTRAINT uq_karaoke_slots_public_ref UNIQUE (public_ref),
 CONSTRAINT uq_karaoke_slots_scope_times UNIQUE (exclusive_scope_id, usage_start, usage_end, cycle_end),
 CONSTRAINT uq_karaoke_slots_generation_candidate UNIQUE (generation_cause_key, exclusive_scope_id, generation_candidate_no),
 CONSTRAINT fk_karaoke_slots_exclusive_scope FOREIGN KEY (exclusive_scope_id) REFERENCES app.karaoke_exclusive_scopes(id) ON DELETE RESTRICT,
 CONSTRAINT fk_karaoke_slots_sales_configuration FOREIGN KEY (sales_configuration_id) REFERENCES app.karaoke_sales_configurations(id) ON DELETE RESTRICT,
 CONSTRAINT ck_karaoke_slots_state CHECK (state IN ('AVAILABLE','HELD','SOLD','SALES_STOPPED')),
 CONSTRAINT ck_karaoke_slots_usage_period CHECK (usage_start < usage_end),
 CONSTRAINT ck_karaoke_slots_cycle_end CHECK (usage_end <= cycle_end),
 CONSTRAINT ck_karaoke_slots_generation_candidate_no CHECK (generation_candidate_no >= 0)
);

-- SPEC-100 §45.4 / §8.2: date and hour-bucket queries scan usage_start as a UTC range; no derived date or hour column.
-- DB-IDX-001: only the two indexes §45.4 lists; the PK / UNIQUE / exclusion indexes come from their constraints.
CREATE INDEX ix_karaoke_slots_usage_start ON app.karaoke_slots(usage_start);
CREATE INDEX ix_karaoke_slots_scope_usage ON app.karaoke_slots(exclusive_scope_id, usage_start);

-- SPEC-100 §28.1 / DB-KRK-001..003 / KRK-SCP-003..005 / INV-010-04: no two Slots of one Scope may occupy overlapping
-- [usage_start, cycle_end) ranges. The range runs to cycle_end, so maintenance time is occupied. It is half-open, so
-- cycle_end == next.usage_start is allowed (DB-KRK-002). There is deliberately NO WHERE clause: every Slot State,
-- including SALES_STOPPED, stays in the exclusion, and a state change never legitimises an overlap (DB-KRK-003).
-- Added after the UNIQUE constraints so that an exact duplicate is reported by uq_karaoke_slots_scope_times (23505)
-- before this exclusion (23P01). Depends on btree_gist from 0001 (DB-MIG-001); there is no application fallback.
ALTER TABLE app.karaoke_slots
  ADD CONSTRAINT ex_karaoke_slots_scope_occupancy
  EXCLUDE USING gist (exclusive_scope_id WITH =, tstzrange(usage_start, cycle_end, '[)') WITH &&);

-- SEC-DB-001 / SEC-DB-003 / SPEC-140 §39 / SPEC-180 §22.2-22.4 / SPEC-100 §53; DB-FK-004 / SPEC-100 §12: no runtime role
-- may remove rows. The API reads both tables for the public Karaoke reads (API-PUB-006..009). No mounted Operation writes
-- them: Slot generation / edit / sales stop (API-ADM-KRK-003..006) and Karaoke purchase (API-PUR-KRK-001) are not mounted,
-- and SPEC-110 defines no Scope mutation. Workers get no grant here; the PR that wires their jobs adds what they need.
REVOKE ALL ON app.karaoke_exclusive_scopes, app.karaoke_slots
  FROM PUBLIC, app_runtime, app_api_runtime, app_email_runtime, app_reconciliation_runtime;
GRANT SELECT ON app.karaoke_exclusive_scopes, app.karaoke_slots TO app_api_runtime;
