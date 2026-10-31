CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA app AUTHORIZATION app_migrator;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE TABLE app.business_profiles (
 id bigint GENERATED ALWAYS AS IDENTITY,
 public_ref uuid NOT NULL DEFAULT gen_random_uuid(),
 auth_subject uuid NOT NULL,
 display_name text,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CONSTRAINT pk_business_profiles PRIMARY KEY (id),
 CONSTRAINT uq_business_profiles_public_ref UNIQUE (public_ref),
 CONSTRAINT uq_business_profiles_auth_subject UNIQUE (auth_subject),
 CONSTRAINT ck_business_profiles_display_name CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 80)
);
CREATE TABLE app.role_assignments (
 id bigint GENERATED ALWAYS AS IDENTITY,
 public_ref uuid NOT NULL DEFAULT gen_random_uuid(),
 profile_id bigint NOT NULL,
 role text NOT NULL,
 state text NOT NULL,
 granted_by_profile_id bigint,
 revoked_by_profile_id bigint,
 granted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CONSTRAINT pk_role_assignments PRIMARY KEY (id),
 CONSTRAINT uq_role_assignments_public_ref UNIQUE (public_ref),
 CONSTRAINT fk_role_assignments_profile FOREIGN KEY (profile_id) REFERENCES app.business_profiles(id) ON DELETE RESTRICT,
 CONSTRAINT fk_role_assignments_granted_by_profile FOREIGN KEY (granted_by_profile_id) REFERENCES app.business_profiles(id) ON DELETE RESTRICT,
 CONSTRAINT fk_role_assignments_revoked_by_profile FOREIGN KEY (revoked_by_profile_id) REFERENCES app.business_profiles(id) ON DELETE RESTRICT,
 CONSTRAINT ck_role_assignments_role CHECK (role IN ('STAFF','ADMINISTRATOR')),
 CONSTRAINT ck_role_assignments_state CHECK (state IN ('ACTIVE','REVOKED')),
 CONSTRAINT ck_role_assignments_revocation CHECK ((state = 'ACTIVE' AND revoked_at IS NULL AND revoked_by_profile_id IS NULL) OR (state = 'REVOKED' AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX ux_role_assignments_profile_role_active ON app.role_assignments(profile_id, role) WHERE state = 'ACTIVE';
ALTER TABLE app.business_profiles OWNER TO app_migrator;
ALTER TABLE app.role_assignments OWNER TO app_migrator;
GRANT USAGE ON SCHEMA app TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON app.business_profiles, app.role_assignments TO app_api_runtime;
GRANT USAGE ON SEQUENCE app.business_profiles_id_seq, app.role_assignments_id_seq TO app_api_runtime;
REVOKE ALL ON app.business_profiles, app.role_assignments FROM PUBLIC, app_email_runtime, app_reconciliation_runtime;
