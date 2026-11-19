-- SPEC-100 §13 / §15 / §38 public content and sales tables (PR-L2-2): events, faq_items, announcements,
-- sponsor_logos, entry_ticket_offerings, karaoke_sales_configurations, goods, goods_inventory.
-- Tables only: no rows are created here. No trigger, no function and no change to an existing object.
-- DB-ARC-007: every constraint and index has an explicit name; DB-MIG-002: this SQL is the DDL source of truth.
-- DB-TIM-001: every time column is timestamptz. DB-TIM-002 / DB-TIM-003: created_at / updated_at default to
-- transaction_timestamp(); updated_at is maintained by the repository, not by a trigger.
-- DB-ID-003 / SPEC-100 §7: internal bigint identity id, uuid public_ref (UNIQUE); foreign keys use the internal id.

-- SPEC-100 §13.1 events. The SPEC-100 §13.1 column list has no state column.
-- BR-EVT-001: facts not yet confirmed stay NULL. SPEC-100 §8.3: business_timezone is Asia/Tokyo only.
CREATE TABLE app.events (
 id bigint GENERATED ALWAYS AS IDENTITY,
 public_ref uuid NOT NULL DEFAULT gen_random_uuid(),
 name text NOT NULL,
 summary text,
 starts_at timestamptz,
 ends_at timestamptz,
 business_timezone text NOT NULL DEFAULT 'Asia/Tokyo',
 venue_name text,
 venue_details text,
 access_information text,
 participant_notices text,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CONSTRAINT pk_events PRIMARY KEY (id),
 CONSTRAINT uq_events_public_ref UNIQUE (public_ref),
 CONSTRAINT ck_events_name CHECK (char_length(name) > 0),
 CONSTRAINT ck_events_period CHECK (starts_at < ends_at),
 CONSTRAINT ck_events_business_timezone CHECK (business_timezone = 'Asia/Tokyo')
);

-- SPEC-100 §13.2 faq_items. DB-STA-002: the CHECK allows the Publication State values only.
-- DB-FK-002 / SPEC-100 §11: an Event is never deleted by cascade (ON DELETE RESTRICT).
CREATE TABLE app.faq_items (
 id bigint GENERATED ALWAYS AS IDENTITY,
 public_ref uuid NOT NULL DEFAULT gen_random_uuid(),
 event_id bigint NOT NULL,
 question text NOT NULL,
 answer text NOT NULL,
 state text NOT NULL,
 sort_order integer NOT NULL DEFAULT 0,
 published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CONSTRAINT pk_faq_items PRIMARY KEY (id),
 CONSTRAINT uq_faq_items_public_ref UNIQUE (public_ref),
 CONSTRAINT fk_faq_items_event FOREIGN KEY (event_id) REFERENCES app.events(id) ON DELETE RESTRICT,
 CONSTRAINT ck_faq_items_state CHECK (state IN ('DRAFT','PUBLISHED','ARCHIVED'))
);

-- SPEC-100 §13.3 announcements. DB-STA-002; DB-FK-002.
CREATE TABLE app.announcements (
 id bigint GENERATED ALWAYS AS IDENTITY,
 public_ref uuid NOT NULL DEFAULT gen_random_uuid(),
 event_id bigint NOT NULL,
 title text NOT NULL,
 body text NOT NULL,
 state text NOT NULL,
 published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CONSTRAINT pk_announcements PRIMARY KEY (id),
 CONSTRAINT uq_announcements_public_ref UNIQUE (public_ref),
 CONSTRAINT fk_announcements_event FOREIGN KEY (event_id) REFERENCES app.events(id) ON DELETE RESTRICT,
 CONSTRAINT ck_announcements_state CHECK (state IN ('DRAFT','PUBLISHED','ARCHIVED'))
);

-- SPEC-100 §13.4 sponsor_logos. DB-SAL-002 / BR-EVT-005: display name required; URL shape is validated by the API.
-- DB-STA-002; DB-FK-002. A PUBLISHED logo requires published_at (SPEC-100 §13.4).
CREATE TABLE app.sponsor_logos (
 id bigint GENERATED ALWAYS AS IDENTITY,
 public_ref uuid NOT NULL DEFAULT gen_random_uuid(),
 event_id bigint NOT NULL,
 display_name text NOT NULL,
 image_url text NOT NULL,
 link_url text,
 sort_order integer NOT NULL DEFAULT 0,
 state text NOT NULL DEFAULT 'DRAFT',
 published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CONSTRAINT pk_sponsor_logos PRIMARY KEY (id),
 CONSTRAINT uq_sponsor_logos_public_ref UNIQUE (public_ref),
 CONSTRAINT fk_sponsor_logos_event FOREIGN KEY (event_id) REFERENCES app.events(id) ON DELETE RESTRICT,
 CONSTRAINT ck_sponsor_logos_state CHECK (state IN ('DRAFT','PUBLISHED','ARCHIVED')),
 CONSTRAINT ck_sponsor_logos_display_name CHECK (char_length(display_name) BETWEEN 1 AND 200),
 CONSTRAINT ck_sponsor_logos_image_url CHECK (char_length(image_url) BETWEEN 1 AND 2048),
 CONSTRAINT ck_sponsor_logos_link_url CHECK (link_url IS NULL OR char_length(link_url) BETWEEN 1 AND 2048),
 CONSTRAINT ck_sponsor_logos_sort_order CHECK (sort_order >= 0),
 CONSTRAINT ck_sponsor_logos_published_at CHECK (state <> 'PUBLISHED' OR published_at IS NOT NULL)
);

-- SPEC-100 §15.1 entry_ticket_offerings. SPEC-100 §9: amounts are bigint >= 0, currency is 3 upper-case letters,
-- purchase_limit > 0. DB-STA-002: Sale Control State allows ENABLED / SUSPENDED only. BR-SAL-003: start before end.
-- DI-030-004 / SPEC-100 §19: held + committed <= sales_capacity is the last defence against overselling.
-- The sum is taken in bigint (also for goods_inventory): two integer counters near 2147483647 must be refused by the
-- CHECK (23514, named), not by an integer overflow (22003) raised while evaluating it.
CREATE TABLE app.entry_ticket_offerings (
 id bigint GENERATED ALWAYS AS IDENTITY,
 public_ref uuid NOT NULL DEFAULT gen_random_uuid(),
 event_id bigint NOT NULL,
 name text NOT NULL,
 description text,
 unit_amount bigint NOT NULL,
 currency text NOT NULL,
 sales_starts_at timestamptz NOT NULL,
 sales_ends_at timestamptz NOT NULL,
 sale_control_state text NOT NULL,
 sales_capacity integer NOT NULL,
 held_quantity integer NOT NULL DEFAULT 0,
 committed_quantity integer NOT NULL DEFAULT 0,
 purchase_limit integer NOT NULL,
 checkin_opens_at timestamptz,
 checkin_closes_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CONSTRAINT pk_entry_ticket_offerings PRIMARY KEY (id),
 CONSTRAINT uq_entry_ticket_offerings_public_ref UNIQUE (public_ref),
 CONSTRAINT fk_entry_ticket_offerings_event FOREIGN KEY (event_id) REFERENCES app.events(id) ON DELETE RESTRICT,
 CONSTRAINT ck_entry_ticket_offerings_unit_amount CHECK (unit_amount >= 0),
 CONSTRAINT ck_entry_ticket_offerings_currency CHECK (currency = upper(currency) AND currency ~ '^[A-Z]{3}$'),
 CONSTRAINT ck_entry_ticket_offerings_sale_control_state CHECK (sale_control_state IN ('ENABLED','SUSPENDED')),
 CONSTRAINT ck_entry_ticket_offerings_purchase_limit CHECK (purchase_limit > 0),
 CONSTRAINT ck_entry_ticket_offerings_sales_period CHECK (sales_starts_at < sales_ends_at),
 CONSTRAINT ck_entry_ticket_offerings_sales_capacity CHECK (sales_capacity >= 0),
 CONSTRAINT ck_entry_ticket_offerings_held_quantity CHECK (held_quantity >= 0),
 CONSTRAINT ck_entry_ticket_offerings_committed_quantity CHECK (committed_quantity >= 0),
 CONSTRAINT ck_entry_ticket_offerings_capacity CHECK (held_quantity::bigint + committed_quantity <= sales_capacity),
 CONSTRAINT ck_entry_ticket_offerings_checkin_window CHECK (checkin_opens_at < checkin_closes_at)
);

-- SPEC-100 §15.2 karaoke_sales_configurations. BR-KRK-001: the standard is 15 minutes of use and 5 of maintenance;
-- a setting never changes the standard. SPEC-100 §9; DB-STA-002; BR-SAL-003. Scopes and slots are not part of this table.
CREATE TABLE app.karaoke_sales_configurations (
 id bigint GENERATED ALWAYS AS IDENTITY,
 public_ref uuid NOT NULL DEFAULT gen_random_uuid(),
 event_id bigint NOT NULL,
 name text NOT NULL,
 unit_amount bigint NOT NULL,
 currency text NOT NULL,
 sales_starts_at timestamptz NOT NULL,
 sales_ends_at timestamptz NOT NULL,
 sale_control_state text NOT NULL,
 purchase_limit integer NOT NULL,
 standard_usage_minutes smallint NOT NULL DEFAULT 15,
 standard_maintenance_minutes smallint NOT NULL DEFAULT 5,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CONSTRAINT pk_karaoke_sales_configurations PRIMARY KEY (id),
 CONSTRAINT uq_karaoke_sales_configurations_public_ref UNIQUE (public_ref),
 CONSTRAINT fk_karaoke_sales_configurations_event FOREIGN KEY (event_id) REFERENCES app.events(id) ON DELETE RESTRICT,
 CONSTRAINT ck_karaoke_sales_configurations_unit_amount CHECK (unit_amount >= 0),
 CONSTRAINT ck_karaoke_sales_configurations_currency CHECK (currency = upper(currency) AND currency ~ '^[A-Z]{3}$'),
 CONSTRAINT ck_karaoke_sales_configurations_sale_control_state CHECK (sale_control_state IN ('ENABLED','SUSPENDED')),
 CONSTRAINT ck_karaoke_sales_configurations_purchase_limit CHECK (purchase_limit > 0),
 CONSTRAINT ck_karaoke_sales_configurations_sales_period CHECK (sales_starts_at < sales_ends_at),
 CONSTRAINT ck_karaoke_sales_configurations_standard_usage_minutes CHECK (standard_usage_minutes = 15),
 CONSTRAINT ck_karaoke_sales_configurations_standard_maintenance_minutes CHECK (standard_maintenance_minutes = 5)
);

-- SPEC-100 §15.3 goods. No shipping address, carrier or tracking column exists (SPEC-100 §15.3). SPEC-100 §9; DB-STA-002; BR-SAL-003.
CREATE TABLE app.goods (
 id bigint GENERATED ALWAYS AS IDENTITY,
 public_ref uuid NOT NULL DEFAULT gen_random_uuid(),
 event_id bigint NOT NULL,
 name text NOT NULL,
 description text,
 unit_amount bigint NOT NULL,
 currency text NOT NULL,
 sales_starts_at timestamptz NOT NULL,
 sales_ends_at timestamptz NOT NULL,
 sale_control_state text NOT NULL,
 purchase_limit integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CONSTRAINT pk_goods PRIMARY KEY (id),
 CONSTRAINT uq_goods_public_ref UNIQUE (public_ref),
 CONSTRAINT fk_goods_event FOREIGN KEY (event_id) REFERENCES app.events(id) ON DELETE RESTRICT,
 CONSTRAINT ck_goods_unit_amount CHECK (unit_amount >= 0),
 CONSTRAINT ck_goods_currency CHECK (currency = upper(currency) AND currency ~ '^[A-Z]{3}$'),
 CONSTRAINT ck_goods_sale_control_state CHECK (sale_control_state IN ('ENABLED','SUSPENDED')),
 CONSTRAINT ck_goods_purchase_limit CHECK (purchase_limit > 0),
 CONSTRAINT ck_goods_sales_period CHECK (sales_starts_at < sales_ends_at)
);

-- SPEC-100 §38 goods_inventory. DB-GDS-001: keyed by goods_id, so a Goods row has at most one inventory row.
-- DB-GDS-003 / DI-030-006 / BR-GDS-003: held + committed <= saleable_capacity. Same-transaction creation with Goods
-- is the responsibility of the creating path, not of this table.
CREATE TABLE app.goods_inventory (
 goods_id bigint NOT NULL,
 saleable_capacity integer NOT NULL,
 held_quantity integer NOT NULL DEFAULT 0,
 committed_quantity integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
 CONSTRAINT pk_goods_inventory PRIMARY KEY (goods_id),
 CONSTRAINT fk_goods_inventory_goods FOREIGN KEY (goods_id) REFERENCES app.goods(id) ON DELETE RESTRICT,
 CONSTRAINT ck_goods_inventory_saleable_capacity CHECK (saleable_capacity >= 0),
 CONSTRAINT ck_goods_inventory_held_quantity CHECK (held_quantity >= 0),
 CONSTRAINT ck_goods_inventory_committed_quantity CHECK (committed_quantity >= 0),
 CONSTRAINT ck_goods_inventory_capacity CHECK (held_quantity::bigint + committed_quantity <= saleable_capacity)
);

-- SPEC-100 §13 / §45 indexes for the public read order. DB-IDX-001: no index repeats a PK / UNIQUE column list.
CREATE INDEX ix_faq_items_event_state_sort ON app.faq_items(event_id, state, sort_order);
CREATE INDEX ix_announcements_event_state_published ON app.announcements(event_id, state, published_at DESC);
CREATE INDEX ix_sponsor_logos_event_state_sort ON app.sponsor_logos(event_id, state, sort_order, public_ref);

-- SEC-DB-001 / SEC-DB-003 / SPEC-140 §39 / SPEC-180 §22.2-22.4 / SPEC-100 §53; DB-FK-004: no runtime role may remove rows.
-- Only app_api_runtime gets access, limited to the Operations that exist. goods and karaoke_sales_configurations are
-- read-only for now because no mounted Operation updates them. Sequence privileges are not granted: identity values
-- are generated without them. Workers get no grant here; later migrations add what their jobs need.
REVOKE ALL ON app.events, app.faq_items, app.announcements, app.sponsor_logos,
  app.entry_ticket_offerings, app.karaoke_sales_configurations, app.goods, app.goods_inventory
  FROM PUBLIC, app_runtime, app_api_runtime, app_email_runtime, app_reconciliation_runtime;
GRANT SELECT, INSERT, UPDATE ON app.faq_items, app.announcements, app.sponsor_logos TO app_api_runtime;
GRANT SELECT, UPDATE ON app.events, app.entry_ticket_offerings, app.goods_inventory TO app_api_runtime;
GRANT SELECT ON app.karaoke_sales_configurations, app.goods TO app_api_runtime;
