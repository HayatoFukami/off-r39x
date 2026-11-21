-- Test-only synthetic backward-compatible expand (SPEC-180 INF-HLT-006). Never copy into packages/db/migrations.
CREATE TABLE app.synthetic_expand_items (
  id bigint GENERATED ALWAYS AS IDENTITY CONSTRAINT pk_synthetic_expand_items PRIMARY KEY,
  note text CONSTRAINT ck_synthetic_expand_items_note CHECK (note IS NULL OR length(note) <= 64)
);
REVOKE ALL ON app.synthetic_expand_items FROM PUBLIC;
ALTER TABLE app.business_profiles ADD COLUMN synthetic_expand_note text;
CREATE INDEX ix_business_profiles_synthetic_expand_note ON app.business_profiles (synthetic_expand_note);
