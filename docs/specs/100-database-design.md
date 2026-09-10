---
spec_id: SPEC-100
title: Database Design
version: 1.0.0
status: provisional
depends_on:
  - SPEC-000
  - SPEC-010
  - SPEC-020
  - SPEC-030
  - SPEC-060
  - SPEC-070
  - SPEC-080
  - SPEC-090
related_specs:
  - SPEC-050
  - SPEC-110
  - SPEC-120
  - SPEC-130
  - SPEC-140
  - SPEC-150
  - SPEC-160
  - SPEC-170
  - SPEC-180
  - SPEC-200
---

# 100 Database Design

## 1. 目的

本書は、**off r39'x in 大阪らへん2027** Webシステムの完成形におけるBusiness Databaseの物理設計を定義する。

Business Databaseは `SPEC-010` のとおり **Supabase PostgreSQL** とし、Hono APIがDrizzle ORM / `pg` を介して業務更新を行う。本書は `SPEC-030` のDomain Entity / State / Cardinality、`SPEC-060` のAuthentication / Authorization、`SPEC-070` のOrder / Payment / Refund、`SPEC-080` のTicket / QR / Check-in、`SPEC-090` のKaraoke Slot / Hold / Reservationを変更せず、PostgreSQL table、column、type、PK、FK、UNIQUE、CHECK、EXCLUDE、Index、transaction、lock、migrationへ具体化する。

本書はDatabase physical designのCanonical Ownerである。API endpoint、HTTP status、Email lifecycle、Admin / Staff画面、Security Control全般、Recovery Runbook、Audit Event taxonomy、Test case、Deployment環境は各下流Canonical Ownerへ委譲する。

本書はMVP、Step1、Step2等の実装段階でschemaを分断しない。長期運用される完成システムを対象とする。

---

## 2. 依存仕様と優先解釈

本書は次へ直接依存する。

- `SPEC-000`: Canonical Owner、`depends_on`、Upstream Change Request、未決定事項の決定規則
- `SPEC-010`: Supabase PostgreSQL / Hono API / Supabase Auth / StripeのSystem Boundary、System of Record、`INV-010-01〜10`
- `SPEC-020`: `FR-AUTH-*`, `FR-TKT-*`, `FR-KRK-*`, `FR-GDS-*`, `FR-MYP-*`, `FR-ADM-*`, `FR-STF-*`, `FR-XFN-*`
- `SPEC-030`: Domain Entity、State Machine、Cardinality、`BR-*`, `DI-030-001〜012`
- `SPEC-060`: Auth Subject ↔ Business Profile、Role Assignment、Ownership / Role authorization、`AR-*`
- `SPEC-070`: Order / Checkout / Payment Binding / Webhook / Refund / idempotency、`PAY-*`
- `SPEC-080`: Ticket / QR Token / Check-in / single-use / cancellation、`TQR-*`
- `SPEC-090`: Karaoke Exclusive Scope / Slot / Hold / Reservation / cancellation / time predicate、`KRK-*`

`SPEC-050` はPublic Reference、Owner-safe lookup、Karaoke日付 / 1時間bucket、Mypage query patternを理解する関連仕様とする。本書はPage / Route自体を定義しない。

上流State、Business Rule、期限、QR Payload、Role、CapabilityをDB都合で変更してはならない。

---

## 3. Canonical Database Terms

| Term | 本書での意味 |
|---|---|
| Internal ID | DB内部のjoin / FKに使用する非公開識別子。`bigint GENERATED ALWAYS AS IDENTITY` |
| Public Reference | Browser / API境界でEntityを参照するための推測困難なUUID。Authorization credentialではない |
| Business Schema | 本システムが所有するPostgreSQL schema `app` |
| Auth Subject | Supabase Auth Identityを一意に参照するUUID。Business DatabaseはCredentialを保持しない |
| Business Cause Key | retryで同一Business operationを識別する、業務効果の重複防止用の永続key |
| Historical Row | financial / entitlement / payment / check-in / role history等、通常運用でhard deleteしないrow |
| Current-state Row | 現在Stateを保持し、条件付きUPDATEで遷移させるrow |
| Constraint Fallback | API validation / row lockが漏れた場合でもcritical invariantを破らせないDB constraint |
| Owner-safe Query | Public Referenceだけでなくverified Business Profileとのrelationを同一query条件へ含める参照 |

---

# Part I — Database Architecture

## 4. Database authority

**DB-ARC-001:** Business DatabaseはSupabase PostgreSQLである。

**DB-ARC-002:** Browser / Next.js WebからBusiness Schemaを直接更新してはならない。業務更新主体はHono APIである。

**DB-ARC-003:** API validation / authorization / Domain validationとDB Constraintは相互代替ではない。APIはBusiness Ruleを評価し、DBはcritical invariantの最終防御を行う。

**DB-ARC-004:** Supabase AuthはIdentity / CredentialのSystem of Recordであり、`app` schemaはPassword、password hash、refresh credentialその他Supabase Auth内部Credentialを保存しない。

**DB-ARC-005:** Stripeは外部Payment Authorityであり、`app` schemaはcard number、CVC、raw payment method secretを保存しない。

**DB-ARC-006:** DB transactionをStripe / Resend等のnetwork call中に長時間openしない。外部処理の結果不明はCheckout Attempt、Webhook Receipt、Refund Record等の追跡rowで表現し、Business ConfirmationだけをDB内atomic transactionとして成立させる。

Trace: `INV-010-01`, `INV-010-07〜10`, `BR-ORD-001〜010`, `PAY-CHK-*`, `PAY-CFM-*`.

## 5. PostgreSQL schema / naming

本システム所有tableは `app` schemaへ配置する。

```text
app.events
app.business_profiles
app.orders
app.karaoke_slots
...
```

`public` schemaへBusiness tableを作成しない。Supabase管理schema `auth`, `storage` 等へ本システムのmigrationでtableを追加しない。

Naming convention:

- table: plural `snake_case`
- column: singular `snake_case`
- PK: `id`
- Public Reference: `public_ref`
- FK: `<entity>_id`
- timestamp: `*_at`
- calendar date: `*_date`
- boolean: `is_*`
- amount: `*_amount`
- quantity: `*_quantity`
- state: `state`

Constraint / index naming:

| Kind | Prefix | Example |
|---|---|---|
| Primary Key | `pk_` | `pk_orders` |
| Foreign Key | `fk_` | `fk_orders_customer_profile` |
| Unique Constraint | `uq_` | `uq_orders_public_ref` |
| Check Constraint | `ck_` | `ck_orders_state` |
| Exclusion Constraint | `ex_` | `ex_karaoke_slots_scope_occupancy` |
| Normal Index | `ix_` | `ix_orders_customer_created` |
| Unique Index / partial unique | `ux_` | `ux_karaoke_holds_slot_active` |

**DB-ARC-007:** Constraint / index名はmigrationで明示し、PostgreSQL自動命名へ依存しない。

## 6. PostgreSQL extensions

次をschema migrationで有効化する。

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

- `pgcrypto`: `gen_random_uuid()` によるPublic Reference生成に使用する。
- `btree_gist`: Karaoke Slot exclusion constraintで `bigint =` と `tstzrange &&` を同一GiST constraintへ組み合わせる。

**DB-MIG-001:** `btree_gist` を利用できない環境へapplication-only overlap checkでfallbackしてはならない。Extensionが有効化できない場合はmigration failureとし、`SPEC-180` の環境要件として解消する。

---

# Part II — Common Physical Types

## 7. Primary Key / Public Reference

### 7.1 Internal ID

全主要Business tableのPKは次とする。

```sql
id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY
```

DrizzleではJavaScript `number` へ暗黙変換せず、`bigint` modeまたはlosslessなstring / BigInt mappingを使用する。

### 7.2 Public Reference

Browser / API境界で直接参照され得るEntityには次を持たせる。

```sql
public_ref uuid NOT NULL DEFAULT gen_random_uuid()
```

各tableで `UNIQUE(public_ref)` を付与する。UUIDは内部PKと別物であり、FKには原則Internal IDを使用する。

Public Referenceを持つ主要Entity:

- Event
- FAQ Item
- Announcement
- Business Profile
- Role Assignment
- Entry Ticket Offering
- Karaoke Sales Configuration
- Goods
- Order
- Checkout Attempt
- Karaoke Exclusive Scope
- Karaoke Slot
- Karaoke Hold
- Karaoke Reservation
- Entry Ticket
- Karaoke Ticket
- Goods Order Item
- Goods Handoff
- Consistency Review Case

Payment Binding、Webhook Receipt、QR Token等、Clientへ直接addressableにしないsupport rowはPublic Referenceを必須としない。

**DB-ID-001:** Public Referenceを知っていることだけではAuthorizationを成立させない。

**DB-ID-002:** Owner向けdetail queryは `public_ref` と `customer_profile_id / owner_profile_id` を同一Server-side query条件へ含めるか、同一transaction内でOwner relationを検証する。

**DB-ID-003:** Public ReferenceをFKとして多用せず、内部relationはInternal IDで構成する。

Trace: `BR-USR-001〜007`, `AR-OWN-001〜008`, `INV-010-08`.

## 8. Time / timezone

### 8.1 Absolute timestamp

業務上の瞬間を表すcolumnは `timestamp with time zone` (`timestamptz`) とする。

対象例:

- Event start / end
- Sales Period
- Order / payment timestamps
- Slot `usage_start`, `usage_end`, `cycle_end`
- Hold timestamps
- Check-in timestamps
- Refund timestamps

PostgreSQL session / Hono DB connection timezoneは `UTC` を使用する。`timestamptz`の値はabsolute instantとして扱い、表示時に `Asia/Tokyo` へ変換する。

### 8.2 Business calendar date

「何日」というcalendar date自体がDomain valueの場合は `date` を使う。absolute timestampを00:00 UTCへ変換してdateの代替にしない。

Karaokeの日付 / 1時間bucket queryではHono APIが `Asia/Tokyo` の対象日境界をUTC instantへ変換し、`usage_start >= :day_start AND usage_start < :day_end` でqueryする。DBへ冗長なUTC-derived `slot_date` を保存しない。

### 8.3 Business timezone

Eventは `business_timezone text NOT NULL DEFAULT 'Asia/Tokyo'` を持ち、現行仕様では:

```sql
CHECK (business_timezone = 'Asia/Tokyo')
```

とする。これは外部設定で任意timezoneへ変更可能にするためのfieldではなく、業務解釈を明示するためのphysical markerである。

### 8.4 Half-open interval

Sales Period、Karaoke usage、occupancy、check-in windowは上流どおり開始包含・終了非包含 `[start, end)` としてqueryする。

**DB-TIM-001:** `timestamp without time zone` をSales Period、Slot、Payment Deadline、Check-in成立時刻へ使用しない。

**DB-TIM-002:** `created_at` のdefaultは `transaction_timestamp()` とし、Client timestampを権威値にしない。

**DB-TIM-003:** mutable rowの `updated_at` はHono repositoryが同一UPDATE文で `transaction_timestamp()` へ更新する。Business logicを隠す汎用updated-at triggerは採用しない。

Trace: `BR-XFN-001〜004`, `KRK-TIM-*`, `KRK-CHK-*`.

## 9. Money / currency / quantity

Money:

- amount: `bigint`
- currency: `text`
- floating pointは禁止

Canonical CHECK:

```sql
CHECK (unit_amount >= 0)
CHECK (total_amount >= 0)
CHECK (currency = upper(currency))
CHECK (currency ~ '^[A-Z]{3}$')
```

Purchase quantity / capacity / inventoryは `integer` とする。

```sql
CHECK (quantity > 0)
CHECK (capacity >= 0)
CHECK (purchase_limit > 0)
```

Order Itemの `line_total_amount` は:

```sql
GENERATED ALWAYS AS (unit_amount * quantity::bigint) STORED
```

とする。

**DB-MNY-001:** Order totalはHono APIがtransaction内でOrder Itemのgenerated line totalを合計して保存し、Checkout生成前およびPayment Confirmation時に再照合する。

**DB-MNY-002:** Stripe `amount_total` / currencyは保存済みOrder snapshotとexact comparisonする。

Trace: `BR-SAL-001〜002`, `BR-ORD-003`, `DI-030-011`, `PAY-ORD-005〜009`.

## 10. State representation

PostgreSQL native enumは採用しない。Stateは `text NOT NULL` + named `CHECK` constraintで表現する。

採用理由:

1. 上流State名をそのまま保存できる。
2. enum value削除・renameに伴うmigration難度を避ける。
3. expand / contract migrationを行いやすい。
4. Drizzle側はTypeScript literal union、DB側はCHECKで二重に制約できる。

**DB-STA-001:** 上流に存在しないDomain StateをDB enum代替として追加してはならない。

**DB-STA-002:** DB CHECKは「許可値」を守る。状態遷移自体はHono serviceが `UPDATE ... WHERE state = :expected` のconditional updateで守り、state transition triggerへBusiness Logicを隠さない。

Processing support tableにDomain Stateではない物理結果分類を置く場合、本書で明示的に「processing result」と分類し、Order / Ticket等のDomain Stateと混同しない。

---

# Part III — Foreign Key / Retention Policy

## 11. Foreign Key policy

原則:

- `ON UPDATE NO ACTION`
- historical / financial / entitlement relationは `ON DELETE RESTRICT` または既定の `NO ACTION`
- Business Profile削除を理由にOrder / Ticket / Reservation / Payment / Check-inへ`CASCADE DELETE`しない
- Event削除を理由に販売 / Order historyへcascadeしない

**DB-FK-001:** Internal PKは通常更新しない。

**DB-FK-002:** confirmed financial / entitlement / check-in historyへ到達するFKはcascade deleteを使用しない。

**DB-FK-003:** account privacy対応が必要な場合も、history rowをcascade deleteするのではなく、後続Security / Audit / Recovery仕様に従う匿名化またはidentity detachを追加migrationで行える構造とする。

## 12. Hard delete policy

通常業務でhard deleteを許可しないEntity:

- Business Profile
- Role Assignment history
- Order / Order Item
- Entry / Goods Allocation
- Checkout Attempt
- Payment Binding
- processed Webhook Receipt
- Refund Record
- Entry Ticket / Karaoke Ticket
- Karaoke Slot / Hold / Reservation
- QR Token history
- Entry / Karaoke Check-in
- Goods Order Item / Goods Handoff
- Notification Request
- Consistency Review Case

Event / FAQ / Announcementも通常運用ではstate (`DRAFT` / `PUBLISHED` / `ARCHIVED`) によって管理し、hard deleteを通常操作として提供しない。

**DB-FK-004:** Migration / test fixture cleanup等の管理外手順を除き、Business APIは上記tableへDELETEを発行しない。

---

# Part IV — Table Design

## 13. Public / Event tables

### 13.1 `app.events`

Purpose: Event rootと公開上の外部事実を保持する。

| Column | Type | Null | Default / Rule |
|---|---|---:|---|
| `id` | bigint identity | No | PK |
| `public_ref` | uuid | No | `gen_random_uuid()`, UNIQUE |
| `name` | text | No | non-empty |
| `summary` | text | Yes | - |
| `starts_at` | timestamptz | Yes | 外部事実未確定を許容 |
| `ends_at` | timestamptz | Yes | `starts_at < ends_at` when both set |
| `business_timezone` | text | No | `Asia/Tokyo` only |
| `venue_name` | text | Yes | - |
| `venue_details` | text | Yes | - |
| `access_information` | text | Yes | - |
| `participant_notices` | text | Yes | - |
| `created_at` | timestamptz | No | `transaction_timestamp()` |
| `updated_at` | timestamptz | No | `transaction_timestamp()` |

Indexes: `uq_events_public_ref`.

Delete: normal hard delete禁止。

Trace: `FR-PUB-001〜004`, `FR-PUB-011`, `BR-EVT-001〜004`.

### 13.2 `app.faq_items`

Columns:

- `id bigint identity PK`
- `public_ref uuid NOT NULL UNIQUE`
- `event_id bigint NOT NULL FK -> events(id) ON DELETE RESTRICT`
- `question text NOT NULL`
- `answer text NOT NULL`
- `state text NOT NULL CHECK IN ('DRAFT','PUBLISHED','ARCHIVED')`
- `sort_order integer NOT NULL DEFAULT 0`
- `published_at timestamptz NULL`
- `created_at`, `updated_at timestamptz NOT NULL`

Index: `ix_faq_items_event_state_sort(event_id, state, sort_order)`.

### 13.3 `app.announcements`

Columns:

- `id bigint identity PK`
- `public_ref uuid NOT NULL UNIQUE`
- `event_id bigint NOT NULL FK`
- `title text NOT NULL`
- `body text NOT NULL`
- `state text NOT NULL CHECK IN ('DRAFT','PUBLISHED','ARCHIVED')`
- `published_at timestamptz NULL`
- `created_at`, `updated_at`

Index: `ix_announcements_event_state_published(event_id, state, published_at DESC)`.

**DB-SAL-001:** Public queryは `PUBLISHED` のみ返し、DRAFT / ARCHIVEDをClient filterへ委譲しない。

---

## 14. Identity / Authorization tables

### 14.1 `app.business_profiles`

Purpose: Supabase Auth IdentityとBusiness Database上の本人 / Ownerの1:1対応。

| Column | Type | Null | Rule |
|---|---|---:|---|
| `id` | bigint identity | No | PK |
| `public_ref` | uuid | No | UNIQUE |
| `auth_subject` | uuid | No | UNIQUE |
| `created_at` | timestamptz | No | server timestamp |
| `updated_at` | timestamptz | No | server timestamp |

本書の必須上流仕様にBusiness Profileのユーザー編集FieldはCanonicalに列挙されていないため、推測で氏名・電話・住所等を追加しない。後続で正式なprofile fieldがCanonical化された場合は通常のschema evolutionで追加する。

`auth.users` へのDB FKは張らない。理由:

- Supabase Authは別System of Record / managed schemaである。
- Auth Identity削除・privacy operationがfinancial historyをcascade / RESTRICTで巻き込むことを避ける。
- Hono APIが検証済みAuth Subjectだけをprovisioning入力にする。

Business DB側の1:1は `UNIQUE(auth_subject)` で最終防御する。

**DB-AUTH-001:** Profile provisioningは `INSERT ... ON CONFLICT (auth_subject) DO NOTHING` 後に同じAuth Subjectでselectし、parallel requestを1 Profileへ収束させる。

Trace: `FR-AUTH-009〜013`, `BR-USR-001〜002`, `AR-ID-001〜006`.

### 14.2 `app.role_assignments`

Columns:

- `id bigint identity PK`
- `public_ref uuid NOT NULL UNIQUE`
- `profile_id bigint NOT NULL FK -> business_profiles(id) ON DELETE RESTRICT`
- `role text NOT NULL CHECK IN ('STAFF','ADMINISTRATOR')`
- `state text NOT NULL CHECK IN ('ACTIVE','REVOKED')`
- `granted_by_profile_id bigint NULL FK -> business_profiles(id) ON DELETE RESTRICT`
- `revoked_by_profile_id bigint NULL FK -> business_profiles(id) ON DELETE RESTRICT`
- `granted_at timestamptz NOT NULL DEFAULT transaction_timestamp()`
- `revoked_at timestamptz NULL`
- `created_at timestamptz NOT NULL DEFAULT transaction_timestamp()`

CHECK:

```text
state = ACTIVE  -> revoked_at IS NULL AND revoked_by_profile_id IS NULL
state = REVOKED -> revoked_at IS NOT NULL
```

Partial unique:

```sql
CREATE UNIQUE INDEX ux_role_assignments_profile_role_active
ON app.role_assignments(profile_id, role)
WHERE state = 'ACTIVE';
```

Historyは保持し、revoke時もDELETEしない。

最後のAdministrator喪失防止は単一row CHECKでは表現できない。Role revoke transactionはglobal logical resourceにtransaction-scoped advisory lockを取り、active Administrator countを再評価してからconditional updateする。

```text
pg_advisory_xact_lock(hashtext('app:active-administrator-set'))
```

**DB-AUTH-002:** Supabase Auth metadata / Client role claimをRole Assignment tableへ自動同期してauthorityにしない。

Trace: `AR-ROLE-004〜013`, `INV-010-08`.

---

## 15. Sales Configuration tables

### 15.1 `app.entry_ticket_offerings`

Columns:

- `id bigint identity PK`
- `public_ref uuid NOT NULL UNIQUE`
- `event_id bigint NOT NULL FK -> events(id)`
- `name text NOT NULL`
- `description text NULL`
- `unit_amount bigint NOT NULL CHECK >= 0`
- `currency text NOT NULL`
- `sales_starts_at timestamptz NOT NULL`
- `sales_ends_at timestamptz NOT NULL`
- `sale_control_state text NOT NULL CHECK IN ('ENABLED','SUSPENDED')`
- `sales_capacity integer NOT NULL CHECK >= 0`
- `held_quantity integer NOT NULL DEFAULT 0 CHECK >= 0`
- `committed_quantity integer NOT NULL DEFAULT 0 CHECK >= 0`
- `purchase_limit integer NOT NULL CHECK > 0`
- `checkin_opens_at timestamptz NULL`
- `checkin_closes_at timestamptz NULL`
- `created_at`, `updated_at timestamptz NOT NULL`

CHECK:

```text
sales_starts_at < sales_ends_at
held_quantity + committed_quantity <= sales_capacity
checkin_opens_at < checkin_closes_at, when both non-null
```

`held_quantity` / `committed_quantity` はcapacityのcurrent aggregate counterであり、Allocation historyの代替ではない。変更はAllocation transactionと同時に行う。

### 15.2 `app.karaoke_sales_configurations`

Columns:

- `id bigint identity PK`
- `public_ref uuid NOT NULL UNIQUE`
- `event_id bigint NOT NULL FK`
- `name text NOT NULL`
- `unit_amount bigint NOT NULL CHECK >= 0`
- `currency text NOT NULL`
- `sales_starts_at`, `sales_ends_at timestamptz NOT NULL`
- `sale_control_state text NOT NULL CHECK IN ('ENABLED','SUSPENDED')`
- `purchase_limit integer NOT NULL CHECK > 0`
- `standard_usage_minutes smallint NOT NULL DEFAULT 15 CHECK = 15`
- `standard_maintenance_minutes smallint NOT NULL DEFAULT 5 CHECK = 5`
- `created_at`, `updated_at`

標準batch generationは必ず15分利用 + 5分整備を使用する。例外Slotを許容する場合でもSlot自身の3時刻で表現し、この設定値を改変して標準自体を変更しない。

### 15.3 `app.goods`

Columns:

- `id bigint identity PK`
- `public_ref uuid NOT NULL UNIQUE`
- `event_id bigint NOT NULL FK`
- `name text NOT NULL`
- `description text NULL`
- `unit_amount bigint NOT NULL CHECK >= 0`
- `currency text NOT NULL`
- `sales_starts_at`, `sales_ends_at timestamptz NOT NULL`
- `sale_control_state text NOT NULL CHECK IN ('ENABLED','SUSPENDED')`
- `purchase_limit integer NOT NULL CHECK > 0`
- `created_at`, `updated_at`

No shipping address / carrier / tracking columns are added.

Trace: `BR-SAL-001〜008`, `BR-TKT-001〜004`, `BR-KRK-001〜003`, `BR-GDS-001〜003`.

---

# Part V — Order / Allocation

## 16. `app.orders`

Columns:

| Column | Type | Null | Rule |
|---|---|---:|---|
| `id` | bigint identity | No | PK |
| `public_ref` | uuid | No | UNIQUE |
| `purchase_cause_key` | uuid | No | UNIQUE, purchase-start retry correlation |
| `customer_profile_id` | bigint | No | FK Business Profile |
| `purpose` | text | No | allowed 3 values |
| `state` | text | No | canonical Order State |
| `currency` | text | No | snapshot |
| `total_amount` | bigint | No | `>= 0` |
| `confirmed_at` | timestamptz | Yes | CONFIRMED時のみ設定 |
| `terminal_at` | timestamptz | Yes | PAYMENT_FAILED / CANCELED / EXPIRED時 |
| `created_at` | timestamptz | No | server timestamp |
| `updated_at` | timestamptz | No | server timestamp |

Purpose CHECK:

```text
ENTRY_TICKET_PURCHASE
KARAOKE_PURCHASE
GOODS_PURCHASE
```

State CHECK:

```text
PREPARED
AWAITING_PAYMENT
CONFIRMED
PAYMENT_FAILED
CANCELED
EXPIRED
REVIEW_REQUIRED
```

Additional unique keys for composite FK:

```text
UNIQUE (id, purpose)
UNIQUE (id, purpose, currency)
UNIQUE (id, customer_profile_id)
```

CHECK:

- `state = 'CONFIRMED'` -> `confirmed_at IS NOT NULL`
- `state <> 'CONFIRMED'` -> `confirmed_at IS NULL`
- `state IN ('PAYMENT_FAILED','CANCELED','EXPIRED')` -> `terminal_at IS NOT NULL`

`REVIEW_REQUIRED` はterminal timestampを要求しない。

**DB-ORD-001:** Customer、Purpose、currency、total amountはOrder作成後の通常operationで変更しない。Hono repositoryはstate / timestamps等、許可columnだけを更新する。

## 17. `app.order_items`

1 Orderは1 Purposeのみである。nullable FK集合を曖昧に放置せず、Purposeとpurchase sourceの組合せをCHECKで完全に制約する。

Columns:

- `id bigint identity PK`
- `order_id bigint NOT NULL`
- `purpose text NOT NULL`
- `line_no integer NOT NULL CHECK > 0`
- `quantity integer NOT NULL CHECK > 0`
- `unit_amount bigint NOT NULL CHECK >= 0`
- `currency text NOT NULL`
- `line_total_amount bigint GENERATED ALWAYS AS (unit_amount * quantity::bigint) STORED`
- `item_name_snapshot text NOT NULL`
- `entry_offering_id bigint NULL FK -> entry_ticket_offerings`
- `karaoke_slot_id bigint NULL FK -> karaoke_slots`
- `goods_id bigint NULL FK -> goods`
- `created_at timestamptz NOT NULL`

Composite FK:

```text
(order_id, purpose, currency) -> orders(id, purpose, currency)
```

Source CHECK:

```text
ENTRY_TICKET_PURCHASE:
  entry_offering_id IS NOT NULL
  karaoke_slot_id IS NULL
  goods_id IS NULL

KARAOKE_PURCHASE:
  entry_offering_id IS NULL
  karaoke_slot_id IS NOT NULL
  goods_id IS NULL
  quantity = 1

GOODS_PURCHASE:
  entry_offering_id IS NULL
  karaoke_slot_id IS NULL
  goods_id IS NOT NULL
```

Unique:

- `UNIQUE(order_id, line_no)`
- `UNIQUE(id, order_id)`
- `UNIQUE(id, purpose)`
- `UNIQUE(id, order_id, purpose)`
- `UNIQUE(id, order_id, purpose, karaoke_slot_id)` for Hold composite FK

**DB-ORD-002:** Karaoke OrderはHono purchase-start transactionでOrder Item countを1件に固定する。`quantity=1` とsource CHECKはDBで守る。2件目のKaraoke Order Item挿入はservice transactionで拒否し、confirmation時にも1件であることを再検証する。

**DB-ORD-003:** Order totalとOrder Item合計のcross-row equalityはCheckout作成前・confirmation時のtransaction preconditionとして再計算する。DBは各line totalとcurrency/purpose一致をconstraintで保証する。

Trace: `BR-ORD-001〜012`, `PAY-ORD-003〜009`, `DI-030-001〜003`, `DI-030-011〜012`.

## 18. `app.entry_sales_allocations`

Columns:

- `id bigint identity PK`
- `order_item_id bigint NOT NULL UNIQUE`
- `order_id bigint NOT NULL`
- `purpose text NOT NULL DEFAULT 'ENTRY_TICKET_PURCHASE' CHECK = 'ENTRY_TICKET_PURCHASE'`
- `offering_id bigint NOT NULL`
- `quantity integer NOT NULL CHECK > 0`
- `state text NOT NULL CHECK IN ('HELD','COMMITTED','RELEASED')`
- `held_at timestamptz NOT NULL DEFAULT transaction_timestamp()`
- `committed_at timestamptz NULL`
- `released_at timestamptz NULL`

Composite FK:

```text
(order_item_id, order_id, purpose) -> order_items(id, order_id, purpose)
```

また、order itemの `entry_offering_id` と一致することを保証するため、order_itemsに `UNIQUE(id, entry_offering_id)` を置き:

```text
(order_item_id, offering_id) -> order_items(id, entry_offering_id)
```

を設定する。

State/timestamp CHECK:

- HELD: committed/released NULL
- COMMITTED: committed_at NOT NULL, released_at NULL
- RELEASED: released_at NOT NULL, committed_at NULL

Entry purchase start transactionはoffering rowをlockし、`held_quantity + committed_quantity + requested <= sales_capacity` を確認してcounterとAllocationを同時Commitする。

**DB-ENT-001:** `COMMITTED` / `RELEASED` Allocationを `HELD` へ戻さない。conditional updateでState transitionを行う。

## 19. Entry capacity physical invariant

Entry Ticket capacityは次の二層で守る。

1. `entry_ticket_offerings` rowを `FOR UPDATE` してserialized counter update。
2. `CHECK (held_quantity + committed_quantity <= sales_capacity)` をfinal defenseとする。

Acquire:

```text
lock Business Profile
lock Entry Ticket Offering
validate Purchase Limit
insert Order + Order Item
increment offering.held_quantity
insert Allocation HELD
commit
```

Confirmation:

```text
lock Order
lock Allocation
lock Offering
HELD -> COMMITTED が実際に1回成立した場合だけ
  held_quantity -= quantity
  committed_quantity += quantity
Entry Tickets発行
Order CONFIRMED
commit
```

Release:

```text
HELD -> RELEASED が実際に1回成立した場合だけ
held_quantity -= quantity
```

**DB-ENT-002:** counterをAllocation INSERT/UPDATEと別transactionで変更しない。

**DB-ENT-003:** Entry Ticket cancellation / Refundだけではcommitted quantityを自動減算しない。Capacity recoveryは上流Cancellation policyが明示的に許可する専用transactionでのみ行う。

Trace: `BR-TKT-002〜006`, `DI-030-004`, `FR-TKT-025〜026`.

---

# Part VI — Payment Persistence

## 20. `app.checkout_attempts`

Checkout AttemptはDomain Order Stateとは別のPayment-side processing recordである。

Columns:

- `id bigint identity PK`
- `public_ref uuid NOT NULL UNIQUE`
- `order_id bigint NOT NULL FK -> orders(id)`
- `attempt_no integer NOT NULL CHECK > 0`
- `stripe_idempotency_key text NOT NULL UNIQUE`
- `creation_result text NOT NULL CHECK IN ('PENDING','SUCCEEDED','FAILED','UNKNOWN')`
- `provider_request_started_at timestamptz NULL`
- `provider_response_at timestamptz NULL`
- `last_error_code text NULL`
- `created_at timestamptz NOT NULL`
- `updated_at timestamptz NOT NULL`

`creation_result` はStripe Session生成呼出しの物理処理結果であり、Order Domain Stateではない。

Unique: `UNIQUE(order_id, attempt_no)`.

**DB-PAY-001:** Network timeout / response loss時は同じCheckout Attemptと同じ `stripe_idempotency_key` を再利用する。

## 21. `app.payment_bindings`

Columns:

- `id bigint identity PK`
- `order_id bigint NOT NULL FK`
- `checkout_attempt_id bigint NOT NULL UNIQUE FK`
- `stripe_checkout_session_id text NOT NULL UNIQUE`
- `stripe_payment_intent_id text NULL UNIQUE`
- `stripe_charge_id text NULL UNIQUE`
- `checkout_session_created_at timestamptz NOT NULL`
- `payment_deadline_at timestamptz GENERATED ALWAYS AS (checkout_session_created_at + interval '30 minutes') STORED`
- `payment_completed_at timestamptz NULL`
- `amount_total bigint NOT NULL CHECK >= 0`
- `currency text NOT NULL`
- `is_active boolean NOT NULL DEFAULT true`
- `bound_at timestamptz NOT NULL DEFAULT transaction_timestamp()`
- `deactivated_at timestamptz NULL`
- `stripe_receipt_url text NULL`

Partial unique:

```sql
CREATE UNIQUE INDEX ux_payment_bindings_order_active
ON app.payment_bindings(order_id)
WHERE is_active;
```

CHECK:

```text
is_active = true  -> deactivated_at IS NULL
is_active = false -> deactivated_at IS NOT NULL
```

`checkout_attempt_id -> order_id` equalityはtransactionで検証し、必要に応じcomposite FK用 `checkout_attempts UNIQUE(id, order_id)` を設定して:

```text
(checkout_attempt_id, order_id) -> checkout_attempts(id, order_id)
```

とする。

**DB-PAY-002:** Stripe Checkout Session、PaymentIntent、Chargeの各external IDは複数Orderへbindできない。

**DB-PAY-003:** 1 OrderにCustomerが使用可能なActive Checkoutは最大1件。

**DB-PAY-004:** Payment Bindingのamount / currencyはOrder snapshotとbinding transaction内で一致確認する。

Trace: `PAY-CHK-004〜012`, `PAY-WHK-014〜015`, `PAY-IDM-001〜005`.

## 22. `app.webhook_receipts`

Columns:

- `id bigint identity PK`
- `stripe_event_id text NOT NULL UNIQUE`
- `event_type text NOT NULL`
- `stripe_object_id text NULL`
- `stripe_account_id text NULL`
- `livemode boolean NOT NULL`
- `processing_state text NOT NULL CHECK IN ('RECEIVED','PROCESSED','IGNORED','FAILED_RETRYABLE','REVIEW_REQUIRED')`
- `payload_sha256 bytea NOT NULL CHECK octet_length(payload_sha256) = 32`
- `canonical_snapshot jsonb NOT NULL`
- `received_at timestamptz NOT NULL DEFAULT transaction_timestamp()`
- `processed_at timestamptz NULL`
- `last_error_code text NULL`
- `updated_at timestamptz NOT NULL`

Payload retention decision:

- Webhook署名検証用raw request bodyはrequest処理中にのみ使用する。
- Business DatabaseへStripe Event全文を無差別に保存しない。
- `canonical_snapshot` にはretry / correlationに必要なevent ID/type、object IDs、status、amount、currency、provider timestamps等の最小snapshotを保存する。
- customer billing address、card-related object payload等、Payment reconciliationに不要なfieldは保存しない。
- 原文が必要なRecoveryはStripe APIによるserver-to-server照合を利用する。

**DB-PAY-005:** Receipt `PROCESSED` / `IGNORED` とDomain effectは、可能な範囲で同一DB transactionの最終commitとして成立させる。Domain transaction rollback時にReceiptだけをPROCESSEDへしない。

Indexes:

```text
UNIQUE stripe_event_id
ix_webhook_receipts_retry(received_at) WHERE processing_state IN ('FAILED_RETRYABLE','REVIEW_REQUIRED')
```

Trace: `PAY-WHK-003〜013`, `PAY-IDM-003〜005`, `INV-010-10`.

## 23. `app.refund_records`

Columns:

- `id bigint identity PK`
- `order_id bigint NOT NULL FK -> orders(id)`
- `business_cause_key uuid NOT NULL UNIQUE`
- `stripe_idempotency_key text NOT NULL UNIQUE`
- `stripe_refund_id text NULL UNIQUE`
- `state text NOT NULL CHECK IN ('REQUESTED','PENDING','SUCCEEDED','FAILED','REVIEW_REQUIRED')`
- `requested_amount bigint NOT NULL CHECK > 0`
- `currency text NOT NULL`
- `is_full_refund boolean NOT NULL`
- `requested_by_profile_id bigint NOT NULL FK -> business_profiles(id)`
- `requested_at timestamptz NOT NULL DEFAULT transaction_timestamp()`
- `provider_updated_at timestamptz NULL`
- `succeeded_at timestamptz NULL`
- `failed_at timestamptz NULL`
- `updated_at timestamptz NOT NULL`

Partial unique for normal full refund:

```sql
CREATE UNIQUE INDEX ux_refund_records_order_live_full
ON app.refund_records(order_id)
WHERE is_full_refund
  AND state IN ('REQUESTED','PENDING','SUCCEEDED','REVIEW_REQUIRED');
```

`FAILED` はProvider上のterminal failureであるため、上流の正規authorizationが新しいRefund Business Causeを作る場合に限り別Recordを許容する。`SUCCEEDED` full refundがあるOrderへ2件目のfull refundはpartial uniqueにより禁止する。

**DB-PAY-006:** Refund amount / currencyはOrder / Payment BindingからServer-sideで導出し、Client amountを保存しない。

**DB-PAY-007:** Refund `SUCCEEDED` とDomain cancellationを同じstateへ統合しない。Domain cancellation failureでもRefund RecordをFAILEDへ巻き戻さない。

Trace: `PAY-RFD-001〜007`, `PAY-IDM-008〜009`.

---

# Part VII — Entry Ticket / QR / Check-in

## 24. `app.entry_tickets`

Columns:

- `id bigint identity PK`
- `public_ref uuid NOT NULL UNIQUE`
- `order_id bigint NOT NULL`
- `order_item_id bigint NOT NULL`
- `order_purpose text NOT NULL DEFAULT 'ENTRY_TICKET_PURCHASE' CHECK = 'ENTRY_TICKET_PURCHASE'`
- `owner_profile_id bigint NOT NULL`
- `issuance_ordinal integer NOT NULL CHECK > 0`
- `state text NOT NULL CHECK IN ('VALID','USED','CANCELED','EXPIRED')`
- `valid_from timestamptz NULL`
- `valid_until timestamptz NULL`
- `issued_at timestamptz NOT NULL DEFAULT transaction_timestamp()`
- `state_changed_at timestamptz NOT NULL DEFAULT transaction_timestamp()`

Composite FKs:

```text
(order_item_id, order_id, order_purpose) -> order_items(id, order_id, purpose)
(order_id, owner_profile_id) -> orders(id, customer_profile_id)
```

Unique:

```text
UNIQUE(order_item_id, issuance_ordinal)
```

CHECK: `valid_from < valid_until` when both set.

**DB-TQR-001:** Entry Ticket発行transactionはOrder Item quantity `N` に対しordinal `1..N` を使用し、既存 `(order_item_id, ordinal)` があればretryでは再利用する。Ordinalがquantity以下であることとN件揃うことはconfirmation transactionで検証する。

## 25. `app.qr_tokens`

QR TokenはEntry / Karaoke Ticketのどちらか1件だけへ属するcontrolled polymorphic relationとする。

Columns:

- `id bigint identity PK`
- `format_version text NOT NULL CHECK = 'r39x1'`
- `purpose text NOT NULL CHECK IN ('ENTRY','KARAOKE')`
- `entry_ticket_id bigint NULL FK -> entry_tickets(id) ON DELETE RESTRICT`
- `karaoke_ticket_id bigint NULL FK -> karaoke_tickets(id) ON DELETE RESTRICT`
- `lifecycle_state text NOT NULL CHECK IN ('ACTIVE','REVOKED')`
- `lookup_digest bytea NOT NULL UNIQUE CHECK octet_length(lookup_digest) = 32`
- `protected_token_material bytea NOT NULL`
- `protection_key_version integer NOT NULL CHECK > 0`
- `issued_at timestamptz NOT NULL DEFAULT transaction_timestamp()`
- `revoked_at timestamptz NULL`

CHECK:

```text
purpose='ENTRY'    -> entry_ticket_id IS NOT NULL AND karaoke_ticket_id IS NULL
purpose='KARAOKE'  -> entry_ticket_id IS NULL AND karaoke_ticket_id IS NOT NULL
ACTIVE             -> revoked_at IS NULL
REVOKED            -> revoked_at IS NOT NULL
```

Partial unique:

```sql
CREATE UNIQUE INDEX ux_qr_tokens_entry_active
ON app.qr_tokens(entry_ticket_id)
WHERE lifecycle_state='ACTIVE' AND entry_ticket_id IS NOT NULL;

CREATE UNIQUE INDEX ux_qr_tokens_karaoke_active
ON app.qr_tokens(karaoke_ticket_id)
WHERE lifecycle_state='ACTIVE' AND karaoke_ticket_id IS NOT NULL;
```

`lookup_digest` はServer-only protection secretによるHMAC-SHA-256結果。`protected_token_material` はapplication側で暗号化したopaque envelopeであり、algorithm / nonce等のenvelope detailは `SPEC-140` / `SPEC-180` に委譲する。

**DB-TQR-002:** QR Token平文をBusiness Database columnへ保存しない。

**DB-TQR-003:** TokenがREVOKEDでもhistorical Ticket correlationを保持し、hard deleteしない。

**DB-TQR-004:** TicketがUSED / CANCELED / EXPIREDでもToken rowを削除する必要はない。受付Authorityはcurrent Ticket stateである。

Trace: `TQR-TOK-001〜020`, `TQR-REC-004〜006`.

## 26. `app.entry_checkins`

Columns:

- `id bigint identity PK`
- `entry_ticket_id bigint NOT NULL UNIQUE FK -> entry_tickets(id) ON DELETE RESTRICT`
- `staff_profile_id bigint NOT NULL FK -> business_profiles(id)`
- `staff_role_assignment_id bigint NOT NULL FK -> role_assignments(id)`
- `checked_in_at timestamptz NOT NULL DEFAULT transaction_timestamp()`
- `created_at timestamptz NOT NULL DEFAULT transaction_timestamp()`

Check-in rowはImmutable Business Event。UPDATE / DELETEをBusiness APIから行わない。

成功transaction:

1. Ticket row `FOR UPDATE`。
2. current state / expiry predicateを再評価。
3. `UPDATE entry_tickets SET state='USED' ... WHERE id=? AND state='VALID'`。
4. 1 row更新できた場合だけCheck-in INSERT。
5. unique `entry_ticket_id` がsecondary defense。
6. Commit。

**DB-TQR-005:** Ticket updateまたはCheck-in insertのどちらかが失敗すればtransaction全体をrollbackする。

**DB-TQR-006:** retryでTicketがUSEDの場合は既存Check-inをselectし、新しいrowを作らない。

Trace: `BR-CHK-001〜006`, `TQR-IDM-001〜011`, `DI-030-007`.

---

# Part VIII — Karaoke

## 27. `app.karaoke_exclusive_scopes`

Columns:

- `id bigint identity PK`
- `public_ref uuid NOT NULL UNIQUE`
- `event_id bigint NOT NULL FK -> events(id)`
- `name text NOT NULL`
- `sort_order integer NOT NULL DEFAULT 0`
- `created_at`, `updated_at timestamptz NOT NULL`

Exclusive Scopeはhard deleteしない。使用停止のDomain Stateは上流に存在しないため、本書で独自Stateを追加しない。

## 28. `app.karaoke_slots`

Columns:

- `id bigint identity PK`
- `public_ref uuid NOT NULL UNIQUE`
- `exclusive_scope_id bigint NOT NULL FK -> karaoke_exclusive_scopes(id)`
- `sales_configuration_id bigint NOT NULL FK -> karaoke_sales_configurations(id)`
- `state text NOT NULL CHECK IN ('AVAILABLE','HELD','SOLD','SALES_STOPPED')`
- `usage_start timestamptz NOT NULL`
- `usage_end timestamptz NOT NULL`
- `cycle_end timestamptz NOT NULL`
- `generation_cause_key uuid NOT NULL`
- `generation_candidate_no integer NOT NULL CHECK >= 0`
- `created_at`, `updated_at timestamptz NOT NULL`

CHECK:

```sql
CHECK (usage_start < usage_end);
CHECK (usage_end <= cycle_end);
```

標準15+5を全SlotへDB CHECKで固定しない。理由は `SPEC-030` / `SPEC-090` が例外的な明示3時刻Slotを許容しており、critical invariantは順序とoverlapであるためである。標準batch generation serviceのみ15+5を強制する。

Idempotency unique:

```text
UNIQUE(exclusive_scope_id, usage_start, usage_end, cycle_end)
UNIQUE(generation_cause_key, exclusive_scope_id, generation_candidate_no)
```

### 28.1 Scope overlap exclusion

同一Scopeの全Slot Stateを対象に、Occupancy Interval `[usage_start, cycle_end)` の重複を禁止する。

```sql
ALTER TABLE app.karaoke_slots
ADD CONSTRAINT ex_karaoke_slots_scope_occupancy
EXCLUDE USING gist (
  exclusive_scope_id WITH =,
  tstzrange(usage_start, cycle_end, '[)') WITH &&
);
```

Predicateは付けない。`AVAILABLE`, `HELD`, `SOLD`, `SALES_STOPPED` のすべてがconstraint対象である。

**DB-KRK-001:** Application read-before-writeだけでoverlapを防止しない。

**DB-KRK-002:** `cycle_end == next.usage_start` は `[)` によりoverlapしない。

**DB-KRK-003:** Slot State変更でExclusion対象から外す実装をしない。

Trace: `KRK-SCP-001〜005`, `KRK-TIM-001〜004`, `DI-030-005`, `INV-010-04`.

## 29. Slot generation support

`generation_cause_key` はAdministratorの1 batch requestを表すBusiness Cause。Candidate番号は各Scopeのdeterministic candidate順序を表す。

Batch generation transaction:

1. 対象Scope rowsをInternal ID昇順で `FOR UPDATE`。
2. `window_start < window_end` を確認。
3. 15+5のcandidateをdeterministicに生成。
4. exact-match Slotは既存rowとしてresolve。
5. 非同一overlapはExclusion constraint / pre-checkでconflict。
6. 1件でも非同一conflictがあればtransaction全体rollback。
7. 新規Slotは `AVAILABLE` でinsert。

**DB-KRK-004:** exact-match retryは既存Slot Stateを変更しない。

**DB-KRK-005:** partial batch commitを通常結果にしない。

Trace: `KRK-GEN-001〜009`, `INV-010-10`.

## 30. `app.karaoke_holds`

Columns:

- `id bigint identity PK`
- `public_ref uuid NOT NULL UNIQUE`
- `order_id bigint NOT NULL`
- `order_item_id bigint NOT NULL UNIQUE`
- `order_purpose text NOT NULL DEFAULT 'KARAOKE_PURCHASE' CHECK = 'KARAOKE_PURCHASE'`
- `customer_profile_id bigint NOT NULL`
- `slot_id bigint NOT NULL`
- `state text NOT NULL CHECK IN ('ACTIVE','COMMITTED','RELEASED','EXPIRED')`
- `hold_acquired_at timestamptz NOT NULL DEFAULT transaction_timestamp()`
- `hold_expires_at timestamptz GENERATED ALWAYS AS (hold_acquired_at + interval '45 minutes') STORED`
- `committed_at timestamptz NULL`
- `released_at timestamptz NULL`
- `expired_at timestamptz NULL`
- `created_at timestamptz NOT NULL DEFAULT transaction_timestamp()`
- `updated_at timestamptz NOT NULL`

Composite FKs:

```text
(order_item_id, order_id, order_purpose, slot_id)
  -> order_items(id, order_id, purpose, karaoke_slot_id)

(order_id, customer_profile_id)
  -> orders(id, customer_profile_id)
```

Partial unique:

```sql
CREATE UNIQUE INDEX ux_karaoke_holds_slot_active
ON app.karaoke_holds(slot_id)
WHERE state='ACTIVE';
```

`UNIQUE(order_item_id)` は同一Karaoke Order ItemのCheckout retryで新Holdを生成させない。

State timestamp CHECK:

- ACTIVE: committed/released/expired NULL
- COMMITTED: committed_at NOT NULL
- RELEASED: released_at NOT NULL
- EXPIRED: expired_at NOT NULL

**DB-KRK-006:** 45分はDB generated columnで固定し、APIが任意 `hold_expires_at` をinsertしない。

**DB-KRK-007:** 同一SlotのACTIVE Hold最大1件はpartial uniqueで守る。

Trace: `KRK-HLD-001〜012`, `BR-KRK-004〜007`.

## 31. Karaoke Hold acquire transaction

Isolation: `READ COMMITTED` + explicit locks + constraints。

Lock order:

1. `business_profiles` Customer row `FOR UPDATE`
2. `karaoke_slots` target row `FOR UPDATE`
3. referenced sales configuration row `FOR SHARE`

Then:

- Slot `AVAILABLE` / sale predicates / purchase limit再評価
- Order `PREPARED` insert
- Karaoke Order Item insert (`quantity=1`)
- Hold `ACTIVE` insert
- Slot conditional `AVAILABLE -> HELD`
- commit

Purchase Limitは同一Profileのconfirmed Reservation + ACTIVE Holdをqueryする。全purchase-start pathがProfile rowを先にlockするため、同一Customerのparallel purchase limit bypassを防ぐ。

Slot競合はrow lock + conditional update + partial uniqueにより最大1 winnerへ収束する。

**DB-KRK-008:** Loser transactionはHold / Order / Itemを部分Commitしない。

## 32. Checkout activation DB condition

Payment Binding永続化 + Order `AWAITING_PAYMENT` transactionではOrder / Hold / Slotをlockし、generated `payment_deadline_at` に対して:

```text
payment_deadline_at <= hold_expires_at - interval '5 minutes'
payment_deadline_at <= slot.usage_end
```

を再評価する。

これらはcross-table ruleであるためDB CHECKへ隠さず、同一transactionのpreconditionとして実装する。Payment Bindingの30分およびHoldの45分自体はgenerated columnでDB固定する。

**DB-KRK-009:** condition不成立ならOrderをAWAITING_PAYMENTへ更新せず、BindingをactiveとしてCustomerへ返さない。

**DB-KRK-010:** Stripe Session終了結果が不明ならSlot/Holdを解放せず、上流どおりREVIEW_REQUIRED / Consistency Reviewへ送れるrow関係を保持する。

Trace: `KRK-PAY-001〜010`, `PAY-CHK-006〜013`.

## 33. `app.karaoke_reservations`

Columns:

- `id bigint identity PK`
- `public_ref uuid NOT NULL UNIQUE`
- `order_id bigint NOT NULL`
- `order_item_id bigint NOT NULL`
- `hold_id bigint NOT NULL`
- `customer_profile_id bigint NOT NULL`
- `slot_id bigint NOT NULL`
- `state text NOT NULL CHECK IN ('CONFIRMED','CANCELED')`
- `usage_start_snapshot timestamptz NOT NULL`
- `usage_end_snapshot timestamptz NOT NULL`
- `confirmed_at timestamptz NOT NULL DEFAULT transaction_timestamp()`
- `canceled_at timestamptz NULL`
- `created_at`, `updated_at timestamptz NOT NULL`

Unique:

```text
UNIQUE(order_item_id)
UNIQUE(slot_id)
UNIQUE(hold_id)
UNIQUE(id, customer_profile_id)
```

Karaoke Holdにcomposite uniqueを設け:

```text
UNIQUE(id, order_id, order_item_id, customer_profile_id, slot_id)
```

Reservationから:

```text
(hold_id, order_id, order_item_id, customer_profile_id, slot_id)
  -> karaoke_holds(id, order_id, order_item_id, customer_profile_id, slot_id)
```

これによりReservation Customer = Hold Customer、Reservation Slot = Hold Slot、Order Item correlationをDB FKで保証する。

CHECK:

```text
usage_start_snapshot < usage_end_snapshot
state='CONFIRMED' -> canceled_at IS NULL
state='CANCELED'  -> canceled_at IS NOT NULL
```

**DB-KRK-011:** 同一Karaoke Order Item / Slot / HoldからReservation最大1件。

**DB-KRK-012:** ReservationにUSED stateを追加しない。

**DB-KRK-013:** cancellation後もrowを保持し、Slot / Holdを削除・再利用しない。

## 34. `app.karaoke_tickets`

Columns:

- `id bigint identity PK`
- `public_ref uuid NOT NULL UNIQUE`
- `reservation_id bigint NOT NULL UNIQUE`
- `owner_profile_id bigint NOT NULL`
- `state text NOT NULL CHECK IN ('VALID','USED','CANCELED','EXPIRED')`
- `expires_at timestamptz NOT NULL`
- `issued_at timestamptz NOT NULL DEFAULT transaction_timestamp()`
- `state_changed_at timestamptz NOT NULL DEFAULT transaction_timestamp()`

Composite FK:

```text
(reservation_id, owner_profile_id)
  -> karaoke_reservations(id, customer_profile_id)
```

`expires_at` はconfirmation時にReservation `usage_end_snapshot` と同値を保存する。cross-table equalityはconfirmation transactionで検証する。

**DB-KRK-014:** Reservation 1 → Karaoke Ticket最大1件は`UNIQUE(reservation_id)`で守る。

**DB-KRK-015:** Ticket Owner = Reservation Customerをcomposite FKで守る。

Trace: `KRK-CFM-001〜005`, `TQR-TKT-005〜010`, `DI-030-003`.

## 35. Karaoke Business Confirmation transaction

Isolation: `READ COMMITTED` + row locks + unique constraints。

Lock order:

1. Order `FOR UPDATE`
2. Karaoke Hold `FOR UPDATE`
3. Karaoke Slot `FOR UPDATE`

Precondition:

- Order purpose/state
- authoritative Payment Binding / amount/currency/deadline
- Hold ACTIVE and Payment completion eligibility
- Slot HELD by same Hold
- no existing conflicting Reservation / Ticket

Atomic effects:

```text
Hold ACTIVE -> COMMITTED
Slot HELD -> SOLD
Reservation insert CONFIRMED
Karaoke Ticket insert VALID
Order AWAITING_PAYMENT|REVIEW_REQUIRED -> CONFIRMED
```

Constraint fallback:

- Hold order item UNIQUE
- Slot ACTIVE Hold partial unique
- Reservation order item UNIQUE
- Reservation slot UNIQUE
- Ticket reservation UNIQUE

**DB-KRK-016:** いずれかがconstraint violation / precondition failureならtransaction全体rollbackし、OrderをCONFIRMEDにしない。

## 36. Reservation cancellation / Check-in race

Cancellation transaction lock order:

1. Karaoke Ticket `FOR UPDATE`
2. Karaoke Reservation `FOR UPDATE`

Check-in transactionも同じTicket rowを最初に `FOR UPDATE` する。

Cancellation winner:

```text
Ticket VALID -> CANCELED
Reservation CONFIRMED -> CANCELED
Slot remains SOLD
Hold remains COMMITTED
```

Check-in winner:

```text
Ticket VALID -> USED
Karaoke Check-in insert
Reservation remains CONFIRMED
```

**DB-KRK-017:** Ticket `VALID` を共通preconditionとし、両方を成功させない。

**DB-KRK-018:** Reservation cancellationでSlot `SOLD -> AVAILABLE` を実行しない。

**DB-KRK-019:** Reservation cancellationでHold `COMMITTED` を変更しない。

Trace: `KRK-CAN-002〜017`, `TQR-IDM-009〜011`, `INV-010-04〜05`.

## 37. `app.karaoke_checkins`

Columns:

- `id bigint identity PK`
- `karaoke_ticket_id bigint NOT NULL UNIQUE FK -> karaoke_tickets(id)`
- `staff_profile_id bigint NOT NULL FK -> business_profiles(id)`
- `staff_role_assignment_id bigint NOT NULL FK -> role_assignments(id)`
- `checked_in_at timestamptz NOT NULL DEFAULT transaction_timestamp()`
- `created_at timestamptz NOT NULL DEFAULT transaction_timestamp()`

Karaoke time predicateはquery時にReservation snapshot / Ticket expires_atを使用し:

```text
checkin_opens_at = usage_start_snapshot - interval '10 minutes'
checkin_closes_at = usage_end_snapshot
checkin_opens_at <= transaction_timestamp()
transaction_timestamp() < checkin_closes_at
```

を評価する。

DBへ冗長な `checkin_opens_at` / `checkin_closes_at` を保存しない。上流のauthoritative sourceがReservation time snapshotであるためである。

**DB-KRK-020:** `server_now >= usage_end_snapshot` ならDB上TicketがまだVALIDでもCheck-in transactionを成功させない。必要なら同transactionまたは別正規expiration operationでVALID -> EXPIREDを条件付き更新する。

Trace: `KRK-CHK-001〜012`, `TQR-CHK-011〜016`.

---

# Part IX — Goods

## 38. `app.goods_inventory`

1 Goods → 1 Inventory row。

Columns:

- `goods_id bigint PRIMARY KEY FK -> goods(id) ON DELETE RESTRICT`
- `saleable_capacity integer NOT NULL CHECK >= 0`
- `held_quantity integer NOT NULL DEFAULT 0 CHECK >= 0`
- `committed_quantity integer NOT NULL DEFAULT 0 CHECK >= 0`
- `updated_at timestamptz NOT NULL`

CHECK:

```text
held_quantity + committed_quantity <= saleable_capacity
```

**DB-GDS-001:** Inventory rowはGoods作成と同じtransactionで1件作成し、欠落を通常状態にしない。

## 39. `app.goods_order_items`

Goods Order Itemはbase `order_items` の1:1 fulfillment extensionである。

Columns:

- `order_item_id bigint PRIMARY KEY`
- `public_ref uuid NOT NULL UNIQUE`
- `order_id bigint NOT NULL`
- `order_purpose text NOT NULL DEFAULT 'GOODS_PURCHASE' CHECK = 'GOODS_PURCHASE'`
- `customer_profile_id bigint NOT NULL`
- `goods_id bigint NOT NULL`
- `state text NOT NULL CHECK IN ('PENDING_PAYMENT','FULFILLABLE','CANCELED')`
- `created_at`, `updated_at timestamptz NOT NULL`

Composite FKs:

```text
(order_item_id, order_id, order_purpose) -> order_items(id, order_id, purpose)
(order_id, customer_profile_id) -> orders(id, customer_profile_id)
(order_item_id, goods_id) -> order_items(id, goods_id)
```

**DB-GDS-002:** Goods Order Item Customer = Order CustomerをDB relationで保証する。

## 40. `app.goods_sales_allocations`

Columns:

- `id bigint identity PK`
- `goods_order_item_id bigint NOT NULL UNIQUE FK -> goods_order_items(order_item_id)`
- `goods_id bigint NOT NULL`
- `quantity integer NOT NULL CHECK > 0`
- `state text NOT NULL CHECK IN ('HELD','COMMITTED','RELEASED')`
- `held_at timestamptz NOT NULL`
- `committed_at timestamptz NULL`
- `released_at timestamptz NULL`

Goods Order Itemに `UNIQUE(order_item_id, goods_id)` を置き、composite FKでGoods一致を保証する。

Inventory acquire / commit / releaseはEntry capacityと同様にInventory rowを`FOR UPDATE`し、counterとAllocation Stateを同一transactionで変更する。

**DB-GDS-003:** `held_quantity + committed_quantity <= saleable_capacity` をCHECKで守り、parallel purchaseで負数 / over-saleを許さない。

**DB-GDS-004:** Allocation commit/releaseのcounter更新は `state='HELD'` のconditional updateが1件更新できた場合だけ実行する。

## 41. `app.goods_handoffs`

1 Goods Order Item → 1 Goods Handoff。

Columns:

- `id bigint identity PK`
- `public_ref uuid NOT NULL UNIQUE`
- `goods_order_item_id bigint NOT NULL UNIQUE FK -> goods_order_items(order_item_id)`
- `state text NOT NULL CHECK IN ('PENDING','COMPLETED','VOID')`
- `completed_by_profile_id bigint NULL FK -> business_profiles(id)`
- `completed_role_assignment_id bigint NULL FK -> role_assignments(id)`
- `completed_at timestamptz NULL`
- `voided_at timestamptz NULL`
- `created_at timestamptz NOT NULL`
- `updated_at timestamptz NOT NULL`

CHECK:

- PENDING: completed/voided timestamps NULL
- COMPLETED: completed actor + completed_at required, voided_at NULL
- VOID: voided_at required, completed_at NULL

Goods purchase start transactionでGoods Order ItemとHandoff `PENDING` を同時作成し、1:1欠落を通常状態にしない。

Handoff completion:

1. Goods Order Item / Handoffをlock。
2. Item `FULFILLABLE` + Handoff `PENDING` を確認。
3. `PENDING -> COMPLETED` conditional update。
4. retryでは既存COMPLETED rowを返す。

**DB-GDS-005:** completed HandoffをUPDATE / DELETEしてPENDINGへ戻さない。

Trace: `BR-GDS-001〜013`, `DI-030-006`, `INV-010-10`.

---

# Part X — Cross-functional persistence

## 42. `app.notification_requests`

SPEC-030 Notification Requestの現時点の永続境界だけを定義し、Email provider / template / retry backoffはSPEC-120へ委譲する。

Columns:

- `id bigint identity PK`
- `business_cause_key uuid NOT NULL UNIQUE`
- `notification_type text NOT NULL`
- `recipient_profile_id bigint NOT NULL FK -> business_profiles(id)`
- `source_order_id bigint NULL FK -> orders(id)`
- `source_reservation_id bigint NULL FK -> karaoke_reservations(id)`
- `state text NOT NULL CHECK IN ('PENDING','SENT','FAILED_RETRYABLE','CANCELED')`
- `render_context jsonb NOT NULL DEFAULT '{}'::jsonb`
- `created_at timestamptz NOT NULL`
- `sent_at timestamptz NULL`
- `updated_at timestamptz NOT NULL`

CHECK: source OrderまたはReservationの少なくとも一方が存在する。

`render_context` は通知再生成に必要な非secret snapshotだけを保持し、provider-specific delivery responseを先取りしない。

**DB-XFN-001:** Notification retryは同じ `business_cause_key` rowを更新し、元Order / Reservationを再確定しない。

Trace: `BR-NTF-001〜006`, `DI-030-008`, `INV-010-06`.

## 43. `app.consistency_review_cases`

Domain上の正常Stateを増やさず、人手 / Recoveryへ送る不整合を追跡するsupport table。

Columns:

- `id bigint identity PK`
- `public_ref uuid NOT NULL UNIQUE`
- `dedupe_key text NOT NULL UNIQUE`
- `reason_code text NOT NULL`
- `order_id bigint NULL FK`
- `checkout_attempt_id bigint NULL FK`
- `payment_binding_id bigint NULL FK`
- `refund_record_id bigint NULL FK`
- `karaoke_slot_id bigint NULL FK`
- `karaoke_hold_id bigint NULL FK`
- `karaoke_reservation_id bigint NULL FK`
- `entry_ticket_id bigint NULL FK`
- `karaoke_ticket_id bigint NULL FK`
- `goods_order_item_id bigint NULL FK`
- `details jsonb NOT NULL DEFAULT '{}'::jsonb`
- `opened_at timestamptz NOT NULL DEFAULT transaction_timestamp()`
- `resolved_at timestamptz NULL`
- `resolution_note text NULL`

CHECK: 対象FKの少なくとも1つがnon-null。

本書はCaseの業務State enumを追加しない。`resolved_at IS NULL` がphysical unresolved predicateである。

Partial index:

```sql
CREATE INDEX ix_consistency_review_cases_unresolved
ON app.consistency_review_cases(opened_at)
WHERE resolved_at IS NULL;
```

**DB-XFN-002:** `dedupe_key` は同一不整合のretryでCaseを重複作成しないためHono serviceがdeterministicに生成する。

**DB-XFN-003:** Review解消時も原因となったPayment / Ticket / Check-in / Reservation historyを削除しない。

Trace: `BR-ORD-010`, `PAY-REC-*`, `TQR-REC-*`, `KRK-REC-*`.

## 44. Audit persistence boundary

SPEC-160のAudit Event taxonomyを本書で先取りしないため、generic audit tableは**SPEC-100では作成しない**。

この決定は「後で決める」ではなく、責務分離として次をCanonicalとする。

- 各Business Event tableはactor / source / timestamp / immutable relationを保持する。
- Role Assignment、Check-in、Refund、Payment、Handoff等のsource identifiersはSPEC-160が後続append-only audit tableから参照できる。
- SPEC-160は後方互換migrationで専用audit tableを追加する。
- 現行Business tableへprovider log / HTTP log等を混在させない。

---

# Part XI — Index Design

## 45. Required indexes

PK / UNIQUE constraintにより自動生成されるindexは重複して追加しない。

### 45.1 Identity / Owner

| Query | Index |
|---|---|
| Auth Subject → Profile | `UNIQUE business_profiles(auth_subject)` |
| Active role lookup | `ux_role_assignments_profile_role_active` |
| Customer → Order | `ix_orders_customer_created(customer_profile_id, created_at DESC)` |
| Customer → Entry Ticket | `ix_entry_tickets_owner_issued(owner_profile_id, issued_at DESC)` |
| Customer → Karaoke Reservation | `ix_karaoke_reservations_customer_time(customer_profile_id, usage_start_snapshot DESC)` |
| Customer → Goods Order Item | `ix_goods_order_items_customer_created(customer_profile_id, created_at DESC)` |

### 45.2 Order / Payment

| Query | Index |
|---|---|
| Order → Order Item | `UNIQUE(order_id, line_no)` |
| Order → Checkout Attempts | `ix_checkout_attempts_order_attempt(order_id, attempt_no DESC)` |
| Order → Payment Binding history | `ix_payment_bindings_order_bound(order_id, bound_at DESC)` |
| Active Checkout | `ux_payment_bindings_order_active` |
| Stripe Session | `UNIQUE(stripe_checkout_session_id)` |
| Stripe PaymentIntent | `UNIQUE(stripe_payment_intent_id)` |
| Stripe Event | `UNIQUE(stripe_event_id)` |
| Stripe Refund | `UNIQUE(stripe_refund_id)` |
| Webhook retry | partial `ix_webhook_receipts_retry` |

### 45.3 Entry

- `ix_entry_allocations_offering_state(offering_id, state)`
- `ix_entry_tickets_order_item(order_item_id)` is不要 because `UNIQUE(order_item_id, issuance_ordinal)` supports the prefix lookup.
- Ticket Public Reference unique index.
- Check-in Ticket unique index.

### 45.4 Karaoke

| Query | Index |
|---|---|
| Date / schedule | `ix_karaoke_slots_usage_start(usage_start)` |
| Scope chronological | `ix_karaoke_slots_scope_usage(exclusive_scope_id, usage_start)` |
| Scope overlap | GiST exclusion backing index |
| Active Hold by Slot | `ux_karaoke_holds_slot_active` |
| Active Holds by Customer / purchase limit | `ix_karaoke_holds_customer_active(customer_profile_id, slot_id) WHERE state='ACTIVE'` |
| Reservation by Slot | `UNIQUE(slot_id)` |
| Reservation → Ticket | `UNIQUE(karaoke_tickets.reservation_id)` |
| Admin Reservation search | `ix_karaoke_reservations_state_time(state, usage_start_snapshot DESC)` |

`PG-KRK-002` の日付 + 1時間bucketは `usage_start` のUTC range scanを使用し、Tokyo local hourへのbucket分類はSQL expressionまたはservice layerで行う。専用hour columnは保存しない。

### 45.5 QR / Check-in

- `UNIQUE(qr_tokens.lookup_digest)`
- partial active-token indexes 2件
- `UNIQUE(entry_checkins.entry_ticket_id)`
- `UNIQUE(karaoke_checkins.karaoke_ticket_id)`

### 45.6 Goods / Cross-functional

- `ix_goods_allocations_goods_state(goods_id, state)`
- `ix_goods_handoffs_pending(created_at) WHERE state='PENDING'`
- `ix_notification_requests_pending(created_at) WHERE state IN ('PENDING','FAILED_RETRYABLE')`
- `ix_consistency_review_cases_unresolved`

### 45.7 Admin Order search

- `ix_orders_admin_state_created(state, created_at DESC)`
- `ix_orders_admin_purpose_created(purpose, created_at DESC)`

Email / free-text search用のGIN / trigram indexはSPEC-130で実際のsearch contractが決まるまで追加しない。不要なwrite amplificationを避ける。

**DB-IDX-001:** Public ReferenceのUNIQUE indexと同一columnのnormal indexを重複作成しない。

---

# Part XII — Transaction / Concurrency Design

## 46. Default isolation / lock policy

通常Business TransactionはPostgreSQL `READ COMMITTED` を使用し、競合するlogical resourceをexplicit row lockする。

採用理由:

- critical resourceが明確なため、全transactionをSERIALIZABLEにする必要がない。
- row lock + conditional update + UNIQUE / CHECK / EXCLUDEでwinnerを明確にできる。
- unnecessary serialization failureを減らせる。

`SERIALIZABLE` は下流実装が複数predicateを安全にrow lockできない新しいtransactionを追加するときのみ使用し、本書の標準pathでは必須としない。

Retryable PostgreSQL error:

- `40001` serialization failure
- `40P01` deadlock detected

Constraint result:

- `23505` unique violation
- `23514` check violation
- `23503` foreign key violation
- `23P01` exclusion violation

Constraint violationは原則Business conflict / implementation defectとして分類し、blind retryしない。既知のidempotent duplicate / concurrency loserである場合だけcurrent rowを再読込して既存結果へ収束する。

**DB-TXN-001:** retry回数 / backoffはSPEC-150が定義する。

## 47. Lock ordering

Deadlockを減らすため、同一種類rowを複数lockする場合Internal ID昇順とし、cross-entity operationは以下の順を原則とする。

```text
Business Profile
  -> Sales resource / Inventory / Slot
  -> Order
  -> Order Item / Allocation / Hold
  -> Reservation / Ticket
  -> Check-in / Handoff
```

Payment confirmationのように既存Orderがrootのoperationは:

```text
Order -> Allocation/Hold -> Capacity/Inventory/Slot -> Entitlement
```

とする。各operationの具体順は次表を優先する。

## 48. Business Transaction matrix

| Transaction | Locks / primitive | Isolation | Constraint fallback / retry behavior |
|---|---|---|---|
| Business Profile provisioning | `UNIQUE(auth_subject)`, `INSERT ON CONFLICT` | READ COMMITTED | parallel insertは同Profileを再select |
| Role Assignment update | target assignment `FOR UPDATE`; Administrator set変更時advisory lock | READ COMMITTED | active partial unique; deadlock retryable |
| Entry allocation + Order create | Profile `FOR UPDATE` → Offering `FOR UPDATE` | READ COMMITTED | capacity CHECK; allocation unique; rollbackでcounter/order残さない |
| Karaoke Hold + Slot HELD + Order PREPARED | Profile `FOR UPDATE` → Slot `FOR UPDATE` | READ COMMITTED | partial active Hold unique; slot conditional update; Exclusion constraint |
| Goods allocation + Order create | Profile `FOR UPDATE` → Inventory `FOR UPDATE` | READ COMMITTED | inventory CHECK; allocation unique |
| Checkout Binding + Order AWAITING_PAYMENT | Order `FOR UPDATE` → Attempt `FOR UPDATE`; KaraokeはHold/Slotもlock | READ COMMITTED | active binding partial unique; 30m generated deadline; exact Karaoke time predicate |
| Entry Business Confirmation | Order → Allocation → Offering locks | READ COMMITTED | ticket `(item, ordinal)` unique; allocation conditional commit; all rollback on failure |
| Karaoke Business Confirmation | Order → Hold → Slot locks | READ COMMITTED | Reservation item/slot unique; Ticket reservation unique |
| Goods Business Confirmation | Order → Allocation → Inventory → Goods Order Item | READ COMMITTED | inventory CHECK; allocation conditional commit |
| Payment failure / cancel / expiry resource release | Order → Allocation/Inventory or Hold/Slot | READ COMMITTED | release only from HELD/ACTIVE; counter update only winner |
| Reservation cancellation | Karaoke Ticket → Reservation | READ COMMITTED | common Ticket VALID precondition; Slot remains SOLD |
| Entry Check-in | Entry Ticket `FOR UPDATE` | READ COMMITTED | Ticket unique Check-in; conditional VALID->USED |
| Karaoke Check-in | Karaoke Ticket `FOR UPDATE` → Reservation row | READ COMMITTED | unique Check-in; time predicate; cancellation race serialized by Ticket lock |
| Goods Handoff | Goods Order Item → Handoff `FOR UPDATE` | READ COMMITTED | one Handoff unique; PENDING conditional update |
| Slot sales stop / edit | Slot `FOR UPDATE` | READ COMMITTED | current state rule + exclusion on time/scope edit |
| Slot batch generation | Scope rows ascending `FOR UPDATE` | READ COMMITTED | exact unique + exclusion; all-or-nothing |

## 49. Database temporary failure / partial commit

**DB-TXN-002:** Pure Business Database mutationは上表の単一transaction境界でall-or-nothingとする。

**DB-TXN-003:** Stripe network callをDB transactionへ含めない。外部side effectが先に発生してDB binding保存に失敗した場合、Checkout Attemptを `UNKNOWN` / Order `PREPARED` または上流に従う `REVIEW_REQUIRED` で追跡し、同じStripe idempotency keyで結果回復する。

**DB-TXN-004:** DB commit成功後のHTTP response lossはtransactionをrollbackしない。retryはBusiness Cause / unique relationから既存結果を返す。

---

# Part XIII — Query / Authorization Support

## 50. Owner-safe query primitives

下流SPEC-110は少なくとも次を直接実装可能である。

### 50.1 Current Profile

```text
business_profiles.auth_subject = verified_supabase_subject
```

unique constraintにより0..1件。0件はprovisioning、複数はDB上不可能。

### 50.2 Owner Order detail

```text
orders.public_ref = :order_ref
AND orders.customer_profile_id = :verified_profile_id
```

### 50.3 Owner Entry Ticket

```text
entry_tickets.public_ref = :ticket_ref
AND entry_tickets.owner_profile_id = :verified_profile_id
```

### 50.4 Owner Karaoke Reservation

```text
karaoke_reservations.public_ref = :reservation_ref
AND karaoke_reservations.customer_profile_id = :verified_profile_id
```

### 50.5 Owner Goods Order Item

```text
goods_order_items.public_ref = :goods_item_ref
AND goods_order_items.customer_profile_id = :verified_profile_id
```

**DB-SEC-001:** Public Reference lookup後にClient側でOwner filterする設計を禁止する。

## 51. QR lookup primitive

1. Payload format / purposeをSPEC-080どおりvalidation。
2. token componentからServer-only secretでHMAC-SHA-256 digest生成。
3. `qr_tokens.lookup_digest` unique lookup。
4. stored purpose / target FK / Ticket typeをcross-check。
5. Ticket rowをcheck-in transactionでlock。

Digest lookupはB-tree unique indexを使用し、Token plaintext searchをしない。

## 52. Admin / recovery query support

- Order: state / purpose / created_at indexes
- Payment: Order → Binding / Attempt、Stripe external unique IDs
- Reservation: state / usage time / Customer
- Handoff: pending partial index
- Review: unresolved partial index

Admin / Staffが何を表示できるかはSPEC-130、Recovery手順はSPEC-150が定義する。DB indexの存在はAuthorizationを付与しない。

---

# Part XIV — Security Boundary

## 53. Database access / RLS decision

本システムではBusiness Schema `app` に対する一般利用者RLS authorizationを**採用しない**。

理由:

- `SPEC-010` の業務アクセス主体はHono APIである。
- Browser / Next.js WebはBusiness Databaseへ直接接続しない。
- `SPEC-060` のAuthorization Principal / Role Assignment / Owner ruleをHono APIへ集約する。

代わりに:

```text
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated;
```

相当の権限制御を行い、Hono API用の専用DB roleだけへ必要privilegeを与える。Supabaseの`anon` / `authenticated` roleをBusiness tableの直接read/write主体にしない。

RLSを「念のため」有効化してauthorization logicを二重実装しない。将来Browser direct DB accessを導入する場合はSystem Boundary変更であり、SPEC-010 / SPEC-060の変更が先に必要である。

**DB-SEC-002:** Hono API DB roleが高権限であっても、Client role claimをそのままDB roleへ写像しない。

## 54. Sensitive data

- Password / refresh credential: 保存禁止
- Stripe card data: 保存禁止
- Stripe secret / webhook secret: Business tableへ保存禁止
- QR token plaintext: 保存禁止
- QR protected material: `bytea` opaque encrypted envelope
- QR lookup: keyed digest
- Public Reference: security boundaryではない
- Staff/Admin role: Role Assignment tableがauthority

Least privilegeのため、QR token table、Payment tablesはPublic content queryから独立したtableとする。

---

# Part XV — Drizzle ORM Organization

## 55. Schema file organization

推奨構成:

```text
packages/db/
  src/
    schema/
      app-schema.ts
      common.ts
      public-content.ts
      identity.ts
      sales.ts
      orders.ts
      payments.ts
      entry-tickets.ts
      karaoke.ts
      goods.ts
      cross-functional.ts
      relations.ts
      index.ts
    transactions/
      profile.ts
      purchase-entry.ts
      purchase-karaoke.ts
      purchase-goods.ts
      payment-confirmation.ts
      checkin.ts
      handoff.ts
  drizzle/
    0001_extensions_and_app_schema.sql
    0002_core_tables.sql
    0003_constraints_and_indexes.sql
    ...
```

`app-schema.ts`:

```text
pgSchema('app')
```

を1回定義し、各tableは同じschema objectから生成する。

`common.ts` はID、public ref、timestamps、currency等の小さなhelperだけを持つ。Domain Stateをgeneric abstractionで隠さない。

## 56. Drizzle type mapping

- `bigint`: BigInt/lossless mode
- `uuid`: string UUID type
- `timestamptz`: timezone-aware Date / ISO conversion at repository boundary
- `date`: calendar date string
- `jsonb`: typed unknown / dedicated interface after runtime validation
- `bytea`: Buffer / Uint8Array
- State `text`: TypeScript literal union + DB CHECK

Drizzle relation declarationはquery convenienceであり、FK constraintの代替ではない。

## 57. SQL-only DDL

Drizzleの宣言だけに依存せず、次はmigration SQLをCanonicalとする。

- `CREATE EXTENSION btree_gist`
- Karaoke `EXCLUDE USING gist`
- partial unique indexes
- partial operational indexes
- composite constraint namesの明示
- schema / privilege REVOKE / GRANT
- Drizzleが当該versionで安全に表現できないgenerated column / CHECK

SQL-only DDLにはcommentで関連 `DB-*` / upstream Rule IDを記載する。

**DB-MIG-002:** Drizzle schemaとSQL-only migrationが同じconstraintを二重生成しない。

## 58. Database trigger policy

Business state transitionをDB triggerへ隠さない。

本仕様では次のためのBusiness triggerを採用しない。

- Order confirmation
- Inventory counter mutation
- Slot state mutation
- Ticket cancellation
- Check-in creation
- Notification generation

これらはHono service transactionで明示実行する。

Critical invariantはCHECK / UNIQUE / FK / EXCLUDE / partial uniqueとrow lockで防御する。

`updated_at` triggerも採用しない。

---

# Part XVI — Migration / Schema Evolution

## 59. Migration naming / ordering

Migration fileはDrizzleのmonotonic numeric prefixを保持し、意味のあるsnake_case名を付ける。

```text
0001_extensions_and_app_schema.sql
0002_public_identity_sales.sql
0003_orders_payments.sql
0004_ticket_qr_checkin.sql
0005_karaoke_constraints.sql
0006_goods_cross_functional.sql
```

実際の採番はrepositoryの最新migration番号から継続する。

新規環境では次順序を守る。

1. Extensions
2. `app` schema / privilege baseline
3. referenced parent tables
4. child tables
5. composite UNIQUE target constraints
6. FK
7. CHECK
8. partial indexes
9. GiST exclusion
10. privilege finalization

## 60. Evolution principles

Production schema evolutionはexpand → backfill → validate → contractを原則とする。

- 新column: nullable / safe defaultでexpand
- backfill: bounded batch
- `NOT NULL`: backfill完了後
- 大規模FK / CHECK: 必要なら `NOT VALID` で追加し後から `VALIDATE CONSTRAINT`
- index: production sizeに応じ `CREATE INDEX CONCURRENTLY` を利用
- rename: add new → dual read/writeが必要なら下流仕様と調整 → backfill → old remove
- destructive drop: downstream referenceがないことを確認した別migration

**DB-MIG-003:** confirmed financial / entitlement / check-in historyを失うdestructive migrationを通常deploymentへ含めない。

**DB-MIG-004:** State名変更・削除を単なるDB migrationで行わない。上流Canonical Owner変更が先である。

**DB-MIG-005:** migration rollbackはproduction dataを消すdown migrationへ依存せず、forward-fix migrationを基本とする。

## 61. Constraint rollout

既存dataへcritical constraintを追加する場合:

1. invariant scan queryを実行
2. violationがあればConsistency Review / data repair計画へ送る
3. 修復後constraint追加
4. constraintを有効化

Karaoke exclusionやactive Hold unique等を、既存違反を無視してapplication-onlyへ退避しない。

---

# Part XVII — Canonical DB Rules Summary

## 62. Critical physical invariants

| DB Rule | Physical guarantee | Main upstream trace |
|---|---|---|
| DB-ID-001〜003 | Internal ID / Public Ref分離、Owner-safe lookup | `AR-OWN-*`, `INV-010-08` |
| DB-AUTH-001 | Auth Subject → Business Profile最大1 | `AR-ID-*`, `BR-USR-001` |
| DB-AUTH-002 | RoleはBusiness DB authority | `AR-ROLE-*` |
| DB-MNY-001〜002 | integer money / Stripe exact comparison | `BR-SAL-*`, `PAY-ORD-*`, `INV-010-09` |
| DB-ORD-001〜003 | Order purpose / source / snapshot integrity | `BR-ORD-*`, `DI-030-001〜003` |
| DB-ENT-001〜003 | Entry capacity / ticket source idempotency | `BR-TKT-*`, `DI-030-004` |
| DB-PAY-001〜007 | Active Checkout, Stripe IDs, Event / Refund dedupe | `PAY-CHK-*`, `PAY-WHK-*`, `PAY-IDM-*`, `PAY-RFD-*` |
| DB-TQR-001〜006 | Ticket source unique、QR active cardinality、Check-in max1 | `TQR-*`, `DI-030-007` |
| DB-KRK-001〜020 | Slot overlap、Hold max1、45m/5m/30m、Reservation/Ticket cardinality、no resale | `KRK-*`, `DI-030-005` |
| DB-GDS-001〜005 | Inventory non-negative、allocation / handoff exactly-once | `BR-GDS-*`, `DI-030-006` |
| DB-XFN-001〜003 | Notification independence / Review retention | `BR-NTF-*`, `PAY-REC-*`, `TQR-REC-*`, `KRK-REC-*` |
| DB-TXN-001〜004 | partial commit防止 / response loss retry | `DI-030-009`, `DI-030-012`, `INV-010-07`, `INV-010-10` |

## 63. System Invariant traceability

| System Invariant | Database protection |
|---|---|
| `INV-010-01` Purchase情報を失わない | Order先行永続化、RESTRICT retention、Checkout Attempt / Review Case |
| `INV-010-02` Order二重確定禁止 | Order row lock + conditional state update + entitlement unique keys |
| `INV-010-03` Ticket二重発行禁止 | Entry `(order_item, ordinal)` unique、Karaoke `reservation_id` unique |
| `INV-010-04` Karaoke二重販売禁止 | GiST exclusion、Slot row lock、ACTIVE Hold partial unique、Reservation `slot_id` unique |
| `INV-010-05` QR Ticket二重利用禁止 | Ticket row lock + conditional VALID→USED + Check-in Ticket unique |
| `INV-010-06` Email失敗でrollbackしない | Notification Request分離 |
| `INV-010-07` Payment / entitlement部分確定禁止 | Purpose別Business Confirmation single transaction |
| `INV-010-08` Ownership / Role server-side | Auth Subject unique、Owner FK、Role Assignment table、owner indexes |
| `INV-010-09` Client price不採用 | DB price snapshot / integer amount / composite currency relation |
| `INV-010-10` external retry耐性 | Business Cause keys、Stripe unique IDs、Webhook event unique、partial uniques |

## 64. Functional Requirement traceability

- `FR-AUTH-*`: `business_profiles`, `role_assignments`, owner-safe relations
- `FR-TKT-*`: `entry_ticket_offerings`, `entry_sales_allocations`, `orders`, `order_items`, `entry_tickets`, `qr_tokens`, `entry_checkins`
- `FR-KRK-001〜032`: Karaoke sales config / scope / slots / holds / reservations / tickets / check-ins / GiST constraint
- `FR-GDS-*`: `goods`, `goods_inventory`, `goods_order_items`, `goods_sales_allocations`, `goods_handoffs`
- `FR-MYP-*`: Public Reference unique indexes + Customer / Owner indexes
- `FR-ADM-*`: state/time/admin search indexes、Role Assignment、Review Case relation
- `FR-STF-*`: Role Assignment、QR digest lookup、immutable Check-in / Handoff
- `FR-XFN-*`: transaction atomicity、Business Cause uniqueness、Review / Notification persistence

## 65. Domain Rule / Invariant traceability

| Group | Primary physical owner |
|---|---|
| `BR-USR-*` | Business Profile / Owner composite FK |
| `BR-SAL-*` | sales config + snapshot columns + capacity/inventory locks |
| `BR-ORD-*` | orders / order_items / purchase cause / conditional transition |
| `BR-TKT-*` | allocation counters + unique issuance unit |
| `BR-KRK-001〜024` | scope / exclusion / holds / reservation / ticket / no-resale transaction |
| `BR-GDS-*` | inventory counters / allocations / handoff unique |
| `BR-CHK-*` | ticket lock + check-in unique |
| `BR-XFN-*` | timestamptz / Asia-Tokyo interpretation / range semantics |
| `DI-030-001〜012` | Sections 16〜49のconstraint / transaction |

## 66. Authorization / Payment / Ticket / Karaoke traceability

- `AR-ID-*`: `business_profiles.auth_subject UNIQUE`
- `AR-OWN-*`: direct Owner / Customer FK + indexed owner-safe lookup
- `AR-ROLE-*`: `role_assignments`, active partial unique, last-admin advisory lock
- `AR-AZ-*`, `AR-FAIL-*`: DB accessはHono roleへ限定し、fail-closed queryを可能にする
- `PAY-ORD-*`: Order snapshot / purpose / amount fields
- `PAY-CHK-*`: Checkout Attempt / Binding / active partial unique / generated 30m deadline
- `PAY-WHK-*`: Event ID unique / processing state / minimal snapshot
- `PAY-CFM-*`: purpose-specific atomic confirmation transactions
- `PAY-FLR-*`: allocation/hold release conditional transitions
- `PAY-IDM-*`: Business Cause / external ID uniqueness
- `PAY-RFD-*`: Refund Record + live full refund partial unique
- `PAY-REC-*`: Review Case correlation
- `TQR-TKT-*`, `TQR-TOK-*`, `TQR-DSP-*`: Ticket / QR schema and owner relations
- `TQR-CHK-*`, `TQR-IDM-*`: immutable Check-in and Ticket lock
- `TQR-CAN-*`, `TQR-REC-*`: terminal state retention / Review relation
- `KRK-SCP-*`, `KRK-TIM-*`: Slot time / exclusion
- `KRK-GEN-*`: generation cause + exact unique + batch transaction
- `KRK-AVL-*`: `usage_start` indexes / current state query
- `KRK-HLD-*`: Hold generated expiry + partial unique
- `KRK-PAY-*`: generated Payment deadline + cross-table activation predicate
- `KRK-CFM-*`: confirmation unique relations
- `KRK-CAN-*`: cancellation transaction / no resale
- `KRK-EDT-*`: Slot row lock + exclusion
- `KRK-CHK-*`: reservation time snapshot / ticket expiry
- `KRK-IDM-*`, `KRK-REC-*`: current-state locks / Review relation
- `KRK-AZ-*`: Role/Owner table relations supporting Hono authorization

---

# Part XVIII — Acceptance Criteria

## 67. Database acceptance

実装は少なくとも以下を満たさなければならない。

1. Business tableは`app` schemaに存在し、Browser/Supabase `anon` / `authenticated` roleへ直接write権限を与えない。
2. Internal PKとPublic Referenceを分離する。
3. Auth SubjectはBusiness Profileへ最大1件だけ対応する。
4. Role AssignmentはACTIVE/REVOKED履歴を保持し、同一Profile/RoleのACTIVEは最大1件。
5. Moneyはinteger minimum unitでありfloating pointを使用しない。
6. absolute timeは`timestamptz`、business calendar dateは`date`で分離する。
7. Stateは上流名をそのままtext+CHECKで保存する。
8. Order Purposeとpurchase sourceの不一致をDB CHECK / composite FKで拒否する。
9. Order / confirmed entitlement / payment / webhook / refund / check-in historyをcascade deleteしない。
10. Entry capacityはrow lock + counter CHECK + allocation historyでover-saleを防ぐ。
11. Entry Ticketは `(Order Item, issuance ordinal)` で重複発行不可。
12. Stripe Session / PaymentIntent / Chargeは複数Orderへbind不可。
13. 1 OrderのActive Checkoutは最大1件。
14. Stripe Event IDは一意で、Webhook再送で二重効果を出さない。
15. 正常full refundは同一Orderへ重複してactive/succeededにできない。
16. QR digestは一意で、TicketごとのACTIVE Tokenは最大1件。
17. QR Token plaintextを保存しない。
18. Entry / Karaoke Check-inはTicketごとに最大1件。
19. Check-inはTicket `VALID -> USED` と同一transaction。
20. 同一Karaoke Scopeの `[usage_start, cycle_end)` overlapをGiST exclusionで拒否する。
21. Karaoke Slotは `usage_start < usage_end <= cycle_end`。
22. 同一SlotのACTIVE Holdは最大1件。
23. Hold expiryはDB上でacquired+45分として固定する。
24. Payment deadlineはBinding上でSession created+30分として固定する。
25. Karaoke Active CheckoutはPayment DeadlineがHold expiry-5分以下かつusage_end以下の場合だけ成立する。
26. Karaoke ReservationはOrder Item / Slot / Holdごとに最大1件。
27. Karaoke TicketはReservationごとに最大1件。
28. Reservation Customer / SlotはHold correlationと一致する。
29. Reservation cancellation後もSlotはSOLD、HoldはCOMMITTEDのまま。
30. CancellationとCheck-inはTicket VALIDを共通preconditionとして最大1winnerへ収束する。
31. Goods Inventoryはnegative / over-capacityにならない。
32. Goods HandoffはGoods Order Itemごとに最大1件で、COMPLETED retryは二重完了しない。
33. pure DB Business Transaction失敗時に部分Commitを残さない。
34. Deadlock / serialization failureをretryable DB errorとして識別可能。
35. Drizzleで表現できないEXCLUDE / partial index / privilege等をversioned SQL migrationで管理する。
36. Migrationが上流State / Business Ruleを独自変更しない。
37. Consistency ReviewがPayment / Hold / Reservation / Ticket / Goodsを相関して追跡できる。
38. SPEC-110がowner-safe detail、purchase start、status、availability、webhook、QR lookup、atomic check-in、admin search、recovery lookupを推測なしで実装できる。

---

## 68. 実装上の禁止事項

以下を禁止する。

- Browser / Next.jsからBusiness Databaseへ直接write
- Public ReferenceをAuthorization credentialとして使用
- Client user IDをOwner FKとして採用
- Supabase Auth metadataをOperational Role authorityとして使用
- PostgreSQL native enumへ上流Stateを閉じ込める
- float / double precisionでPayment amountを保存
- Stripe Event ID uniquenessなしでWebhook処理
- Stripe Session IDを複数Orderへ関連付け
- Karaoke overlapをSELECT後INSERTだけで防止
- ACTIVE Hold unique constraintなしでSlot競合を処理
- Reservation / Ticket / Check-in unique constraintなしでretryを処理
- QR Token平文を保存
- Check-inをTicket updateと別transactionでinsert
- Reservation cancellationでSlotをAVAILABLEへ戻す
- payment uncertainty中にKaraoke Slotを再販売
- financial Refund成功をDomain cancellation成功と同一視
- confirmed historyへ`ON DELETE CASCADE`
- DB triggerへOrder confirmation / Check-in / Inventory Business Logicを隠す
- SQL-only constraintをDrizzle schema外の手作業DB設定として管理
- MigrationでState名や30分/45分/5分等の上流Ruleを無断変更

---

## 69. 下流仕様へのPhysical Boundary

### SPEC-110 API Specification

利用可能なprimitive:

- Auth Subject -> Business Profile unique resolution
- Owner-safe public_ref lookup
- purchase cause key persistence
- capacity / inventory / slot lock transaction
- Checkout Attempt / Payment Binding persistence
- webhook Event idempotency
- Order confirmation transaction
- slot availability / 1-hour query indexes
- QR digest lookup
- Ticket lock + atomic Check-in
- admin / recovery indexes

API route、request/response、HTTP status、Hono RPC / Zod schemaはSPEC-110が定義する。

### SPEC-120 Email / Notification

`notification_requests` を現在のDomain persistenceとして使用し、provider / template / delivery attempt schemaはSPEC-120が必要に応じて追加する。

### SPEC-130 Admin / Staff

Role / owner / search index / mutation transactionを利用する。画面・検索filterの最終契約はSPEC-130が定義する。

### SPEC-140 Security

QR encryption key / HMAC key、DB credential、secret storage、encryption algorithm / rotation、network policyを定義する。

### SPEC-150 Reliability / Recovery

Retry count、backoff、reconciliation、Review Case解消Runbookを定義する。

### SPEC-160 Observability / Audit

本書のBusiness row IDs / actor / timestampsを参照可能なappend-only audit persistenceを追加する。Audit taxonomyはSPEC-160がCanonical Ownerである。

---

## 70. 上流仕様変更要求

なし。

本書の物理設計は、添付された `SPEC-000`, `SPEC-010`, `SPEC-020`, `SPEC-030`, `SPEC-060`, `SPEC-070`, `SPEC-080`, `SPEC-090` のState、Cardinality、期限、System Boundary、Business Ruleを変更せず具体化できる。
