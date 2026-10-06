---
spec_id: SPEC-110
title: API Specification
version: 1.1.1
status: provisional
depends_on:
  - SPEC-000
  - SPEC-010
  - SPEC-020
  - SPEC-030
  - SPEC-040
  - SPEC-050
  - SPEC-060
  - SPEC-070
  - SPEC-080
  - SPEC-090
  - SPEC-100
related_specs:
  - SPEC-120
  - SPEC-130
  - SPEC-140
  - SPEC-150
  - SPEC-160
  - SPEC-170
  - SPEC-180
  - SPEC-200
---

# 110 API Specification

## 1. 目的

本書は、**off r39'x in 大阪らへん2027** Webシステムの完成形におけるHono API contractとserver operation boundaryを定義する。

本書は、`SPEC-010` で固定された **Next.js / Vercel → Hono / Railway → Supabase PostgreSQL** のBusiness operation経路、Hono RPC、Zod、Supabase Auth、Stripe Checkout / Webhook、Drizzle ORM / `pg` を維持し、`SPEC-020`〜`SPEC-100` が定義したRequirement、Domain State、User Flow、Page、Authentication / Authorization、Payment、Ticket / QR / Check-in、Karaoke、Database physical invariantをHTTP / RPC contractへ具体化するCanonical Ownerである。

本書は次をCanonicalに定義する。

- API base path / versioning / route namespace
- Hono route organization / RPC export boundary
- request / response / error schema
- Zod runtime validation
- Authentication / Authorization middleware ordering
- owner-safe lookup
- Public Reference wire semantics
- purchase start / checkout / order status
- Stripe Webhook raw-body processing
- Ticket / QR / Check-in operation
- Karaoke / Goods operation
- Administrator / Staff server operation
- transport idempotencyとDomain idempotencyの境界
- DB transaction / row lock / constraint利用方法
- HTTP status / retryability / consistency review representation
- Page / Flow / Requirement / Rule / DBへのTraceability

本書は上流State、Business Rule、期限、QR Payload、Capability、DB physical constraintを変更しない。

---

## 2. 適用範囲

対象はRailway上のHono APIである。Browser / Next.js WebはBusiness Databaseを直接更新せず、業務更新は本APIへ集約する。

本書は次を含む。

- Public read API
- authenticated principal / Business Profile API
- owner向けOrder / Ticket / Reservation / Goods API
- Entry / Karaoke / Goods purchase start
- Checkout activation / resume
- pre-payment cancel
- Stripe Webhook
- Staff Entry / Karaoke Check-in
- Staff Goods Handoff target preview / completion
- Administrator read / manage API
- Entry Ticket Offering / Karaoke Sales Configurationの販売条件管理
- Administrator Goods Handoff read / explicit completion command
- Administrator authoritative read（Order / Entry Ticket / Karaoke Slot / Exclusive Scope / Reservation / Goods / Goods Handoff / Role Assignment / Consistency Review / Event / FAQ / Announcement）
- Administrator operation-specific manual recovery command
- Refund / QR token rotation / consistency review等、上流で既に要求済みのoperation boundary

CORS、CSRF、CSP、rate limit、secret rotationの最終Control値は `SPEC-140`、retry回数 / backoff / Recovery Runbookは `SPEC-150`、Audit event schemaは `SPEC-160` がCanonical Ownerである。

---

## 3. 依存仕様

本書はFrontmatter記載の `SPEC-000`〜`SPEC-100` を直接依存とし、`SPEC-130` / `SPEC-150` を強く関連する仕様として参照する。API contractはSystem Boundary、Requirement、Domain State、User Flow、Page、Auth、Payment、QR、Karaoke、DB transactionを同一server operationへ接続するCanonical Ownerであり、Administrator販売条件管理、Goods Handoff、authoritative read、manual recoveryのbusiness semanticsは `SPEC-130` / `SPEC-150` がCanonicalに所有する。`SPEC-130` / `SPEC-150` はAPI contractのCanonical Ownerとして本書を参照し、本書はそれらのbusiness semantics、Domain State、Transition、Capabilityを変更しない（相互関係は循環依存ではなく、business semantics ownerとAPI contract ownerの分離として扱う）。

`SPEC-130` がCanonicalに所有するAdministrator / Staff operation semantics、`SPEC-150` がCanonicalに所有するManual Recovery RunbookのPrecondition / Allowed action / Forbidden actionを、本書はHTTP / RPC contractへ写像する。本書はそれらのbusiness semantics、Domain State、Transition、Capabilityを変更しない。

上流矛盾は確認されなかった。既知のUCRが要求するAPI contractは、本改訂でAPI Canonical Ownerの範囲においてcanonical化した（§66参照）。

---

## 4. Canonical API Terms

| Term | 意味 |
|---|---|
| API Resource | HTTP / Hono RPC上で公開する論理resource。DB table名とは独立 |
| Operation ID | API operationを一意に識別する永続名 |
| Public Reference | Browser / APIに出すUUID。Internal IDではなくAuthorization credentialでもない |
| Principal | Server-side verified Auth Subject、必要なBusiness Profile、Role Assignmentから構成する認可主体 |
| Owner-safe Lookup | Public Referenceとverified Profile relationを同じquery条件または同一transaction内で検証するlookup |
| Transport Idempotency Key | HTTP retryを相関するClient supplied key。Domain Business Causeの代替ではない |
| Business Cause | 上流で定義済みの重複Domain effect防止原因 |
| Conflict Loser | 正常な並行競合でDomain effectを得なかったrequest |
| Consistency Review | 通常成功・通常競合へ安全に分類できない不整合 |
| Temporary Failure | retryにより解消し得るAuth / DB / Stripe / API依存障害 |

---

# Part I — API Base Design

## 5. API base path / versioning

Canonical base pathは次とする。

```text
/api/v1
```

- Major contract break時だけ `/api/v2` を追加する。
- additive field追加は同一major versionで許可する。
-既存fieldの意味変更、required field削除、State rename、error code意味変更を同一majorで行わない。
- Hono RPCのTypeScript型versionとHTTP path major versionを一致させる。

**API-BASE-001:** Browser routeとAPI routeを同一体系とみなさない。

## 6. Namespace

```text
/api/v1/public/*
/api/v1/self/*
/api/v1/staff/*
/api/v1/admin/*
/api/v1/webhooks/stripe
```

意味:

- `public`: Authentication不要。公開可能DataだけをServer-side filter。
- `self`: Email verified authenticated principalを基本とし、owner relationを強制。
- `staff`: active `STAFF` Role + operation-specific Capability。
- `admin`: active `ADMINISTRATOR` Role + operation-specific Capability。
- `webhooks`: provider authentication専用。Supabase Authを要求しない。

`/webhooks/stripe` は通常RPC client exportから除外する。

## 7. REST naming / HTTP method

- resource名は複数形・lowercase・kebab-case path segmentを使用する。
- read: `GET`
- create / command: `POST`
- partial mutable configuration: `PATCH`
- Business historyへの`DELETE`は提供しない。
- State transitionは意味を明示するcommand subresourceを使用する。

例:

```text
POST /self/purchases/entry
POST /self/orders/{order_ref}/checkout
POST /self/orders/{order_ref}/cancel
POST /staff/check-ins/entry
POST /admin/karaoke/slots/{slot_ref}/stop-sales
```

## 8. JSON field naming / nullability

JSON field名は `snake_case` とする。

- optional field: payloadに存在しなくてよい。
- nullable field: `null` を明示的に許可する。
- schema上optionalとnullableを混同しない。
- responseで未取得を `null` へ偽装しない。

## 9. Public Reference wire format

Public Referenceはlowercase canonical UUID stringとして返す。

Zod:

```ts
z.string().uuid()
```

Internal `bigint` PKはHTTP / RPC responseへ出さない。

## 10. Time / date wire format

Absolute timestamp:

```text
YYYY-MM-DDTHH:mm:ss.sssZ
```

- UTC `Z` 形式をcanonical responseとする。
- requestでoffset付きISO 8601を許可するoperationでも、serverでinstantへ正規化する。

Date-only:

```text
YYYY-MM-DD
```

Karaoke業務日解釈は `Asia/Tokyo`。

## 11. Money wire representation

DB `bigint` amountは**decimal string**で返す。

```json
{
  "amount": "3500",
  "currency": "JPY"
}
```

Zod:

```ts
z.object({
  amount: z.string().regex(/^(0|[1-9][0-9]*)$/),
  currency: z.string().regex(/^[A-Z]{3}$/)
})
```

理由はJavaScript JSON numberのsafe integer範囲へBusiness amountを依存させないためである。Clientからpurchase amount / currencyは受け取らない。

## 12. Pagination / sort / filtering

Owner / Admin listはcursor paginationを使用する。

Query:

```text
limit=1..100   default 30
cursor=<opaque base64url cursor>
```

Cursorはsort key + Public Referenceをserver-signed / opaqueにencodeし、Internal IDを露出しない。

Canonical sort:

- Owner Order / Karaoke Reservation / Goods Order Item list: `created_at DESC, public_ref DESC`
- Owner Entry Ticket list / Admin Entry Ticket list: `issued_at DESC, public_ref DESC`（`app.entry_tickets.issued_at`）
- Announcement: `published_at DESC, public_ref DESC`
- Karaoke Slot schedule: `usage_start ASC, public_ref ASC`
- Admin review queue: `opened_at ASC, public_ref ASC`

各Admin listのcomplete canonical sort tupleは §48.3 をCanonicalとし、本節とは矛盾しない。Sort modeを持つlistは §48.3 のallowlist modeだけを使用する。

filterはallowlist query parameterだけを受け、任意column名、raw SQL、client sort expressionは受けない。

**API-QRY-001:** 各Admin listのquery parameterは §48.3 のZod schemaで固定する。未知query parameterは`400 VALIDATION_FAILED`とし、無視しない。

**API-QRY-002:** sortはoperationごとのcanonical sortだけを使用し、Clientから任意sort key / directionを受けない。

**API-QRY-003:** Clientは全件取得してBrowser側でfilterしてはならない。Filter / Paginationはserver-side queryとして実行する。

**API-QRY-004:** `cursor`はopaqueとして扱い、Filter変更時はcursorを破棄して先頭pageを再取得する。offset paginationは提供しない。

Response:

```json
{
  "items": [],
  "page": {
    "next_cursor": null,
    "has_more": false
  }
}
```

## 13. Request size boundary

通常JSON request bodyは **64 KiB** を上限とする。

- QR scan bodyは4 KiB以下。
- webhookはStripe raw bodyとして **1 MiB** を上限とする。
- 超過は `413 PAYLOAD_TOO_LARGE`。
- file upload APIは本仕様に定義しない。

---

# Part II — Hono RPC / Zod Organization

## 14. Route module organization

推奨かつCanonicalなsource organization:

```text
src/api/
  app.ts
  rpc.ts
  middleware/
    request-context.ts
    auth.ts
    principal.ts
    capability.ts
    idempotency.ts
  schemas/
    common.ts
    errors.ts
    public.ts
    profile.ts
    orders.ts
    tickets.ts
    karaoke.ts
    goods.ts
    staff.ts
    admin.ts
  routes/
    public.ts
    self-profile.ts
    self-orders.ts
    self-tickets.ts
    self-karaoke.ts
    self-goods.ts
    staff-checkin.ts
    staff-goods.ts
    admin-orders.ts
    admin-tickets.ts
    admin-karaoke.ts
    admin-sales.ts
    admin-goods.ts
    admin-handoffs.ts
    admin-content.ts
    admin-roles.ts
    admin-recovery.ts
  webhooks/
    stripe.ts
  services/
  repositories/
```

## 15. RPC export

`src/api/rpc.ts` は `/api/v1/public`, `/api/v1/self`, `/api/v1/staff`, `/api/v1/admin` のHono app typeをexportする。

Stripe Webhook routeはraw body preservationとprovider signature verificationが必要なため、通常Browser RPC client typeから除外する。

## 16. Zod runtime validation

全path params、query params、JSON body、主要success response、common error responseをZod schemaで定義する。

TypeScript compile-time typeだけでruntime validationを代替しない。

Discriminated unionを次に使用する。

- `OrderStatusResponse.state`
- `CheckInResponse.outcome`
- purchase / checkout resultの`result`
- public availabilityの`availability`
- common operation conflictの`code`

---

# Part III — Request Context / Error Contract

## 17. Request correlation ID

全requestに `request_id` を付与する。

- incoming `X-Request-Id` がcanonical UUIDなら採用してよい。
- 無効 / 欠落ならserver生成UUIDを使用する。
- response header `X-Request-Id` とJSON error `request_id`を一致させる。
- Request IDをDomain idempotency keyにしない。

## 18. Transport idempotency input

mutationのうちretryで二重side effectが問題となるoperationはHeaderを受ける。

```text
Idempotency-Key: <16..128 ASCII chars>
```

対象:

- purchase start
- checkout start / resume
- pre-payment cancel
- refund request
- refund result reconcile
- QR token rotation
- slot generation
- slot state/edit mutation
- goods handoff completion（Staff / Administrator「Administrative Handoff Completion」の双方）
- entry ticket offering / karaoke sales configuration / goods sales configuration mutation
- goods inventory adjustment
- public content create / update / publish / archive / restore-draft
- role assignment mutation
- checkout attempt result reconcile
- payment confirmation reconcile
- notification unknown result reconcile
- consistency review post-verification resolve

Check-inはHeaderを受けてもよいが、Ticket consume-onceがCanonical idempotencyでありHeaderを必須にしない。

Transport key replay時は、同じPrincipal + Operation ID + normalized request fingerprintに一致する場合だけ同じtransport resultを返してよい。異なるpayloadで同じkeyを再利用した場合は `409 IDEMPOTENCY_KEY_REUSED`。

**API-IDM-001:** Transport idempotency recordが失われても、Domain Business Cause / DB unique relationでcritical duplicateを防止できなければならない。

## 19. Common success envelope

単一resource:

```json
{
  "data": {},
  "meta": {
    "request_id": "uuid"
  }
}
```

listも同じ`data`内に`items/page`を持つ。

## 20. Common error envelope

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Requested resource was not found.",
    "request_id": "uuid",
    "retryable": false,
    "details": null
  }
}
```

`details`はallowlisted validation detail等だけを返す。SQLSTATE、stack trace、Internal ID、Stripe secret、raw QR tokenを含めない。

## 21. Canonical error mapping

| HTTP | Code | 意味 | Retryable |
|---:|---|---|---|
| 400 | `MALFORMED_REQUEST` | JSON / syntax / unsupported format | No |
| 400 | `VALIDATION_FAILED` | Zod / field validation | No |
| 401 | `AUTHENTICATION_REQUIRED` | credentialなし / invalid session | 条件付き |
| 403 | `EMAIL_VERIFICATION_REQUIRED` | verified email必須 | No |
| 403 | `AUTHORIZATION_DENIED` | Role / Capability不足 | No |
| 404 | `RESOURCE_NOT_FOUND` | not foundまたはowner mismatchを秘匿 | No |
| 409 | `STATE_CONFLICT` | current stateがoperation precondition不一致 | No |
| 409 | `SOLD_OUT` | Entry capacity不足 | No |
| 409 | `SLOT_UNAVAILABLE` | Karaoke hold / sold / stop / overlap競合 | No |
| 409 | `SLOT_GENERATION_OVERLAP` | Slot batch generationの非同一overlap / all-or-nothing失敗 | No |
| 409 | `INVENTORY_UNAVAILABLE` | Goods inventory不足 | No |
| 409 | `PURCHASE_LIMIT_EXCEEDED` | limit超過 | No |
| 409 | `IDEMPOTENCY_KEY_REUSED` | transport key payload mismatch | No |
| 410 | `BUSINESS_OPPORTUNITY_EXPIRED` | sales / hold / payment opportunity expiry | No |
| 422 | `DOMAIN_RULE_VIOLATION` | syntactically validだがBusiness Rule不成立 | No |
| 422 | `OUTSIDE_CHECKIN_WINDOW` | Karaoke通常受付時間外 | No |
| 424 | `STRIPE_TEMPORARY_FAILURE` | Stripe依存の一時失敗 | Yes |
| 503 | `DATABASE_TEMPORARY_FAILURE` | DB unavailable / retryable tx failure exhausted | Yes |
| 503 | `AUTH_SERVICE_TEMPORARY_FAILURE` | identityを安全に検証不能 | Yes |
| 503 | `TEMPORARY_UNAVAILABLE` | その他安全に判定不能 | Yes |
| 409 | `CONSISTENCY_REVIEW_REQUIRED` | 通常競合でなくreview必要 | No |
| 500 | `INTERNAL_ERROR` | 予期しない内部失敗 | 条件付き |

Known DB constraint loserは一律500にしない。`23505` / `23P01`等はconstraint名とcurrent stateを再読込し、既知の競合 / idempotent duplicateへ分類する。未知constraint violationは`INTERNAL_ERROR`か`CONSISTENCY_REVIEW_REQUIRED`として内部監視対象にする。

## 22. Ownership information disclosure

Owner限定resourceで、Public Referenceが存在しない場合と別Ownerに属する場合はどちらも `404 RESOURCE_NOT_FOUND` とする。

`403` は「対象resourceの存在確認を伴わないoperation-level capability denial」に使用する。これによりPublic Referenceを知るだけで他者Data存在を確認できない。

---

# Part IV — Authentication / Principal

## 23. Supabase Auth input

Protected APIはSupabase Auth access tokenを次で受領する。

```text
Authorization: Bearer <access-token>
```

Next.js Webがserver-to-serverでforwardする場合も同じsemanticを使用する。Client supplied `user_id`, `profile_id`, `role`, `permission`, `customer`はPrincipal構築に使用しない。

## 24. Verification ordering

Protected operationは `AR-AZ-*` を次の順で実装する。

1. Public / protected判定
2. token presence / verification
3. Email verified check
4. Auth Subject取得
5. Business Profile resolution / provisioning requirement判定
6. owner relation（self operation）
7. Role Assignment + Capability（staff/admin operation）
8. Domain precondition
9. mutation

Fail Closedとする。

## 25. Profile provisioning

### API-AUTH-001 — Get current principal

- **Method:** `GET`
- **Path:** `/api/v1/self/principal`
- **Actor:** Authenticated User
- **Auth:** required, email verified
- **Capability:** authenticated principal construction
- **Transaction:** read only
- **Response 200:** `auth_subject`そのものはClientへ必須表示しない。`profile_ref`, `capabilities`のうちUI navigationに必要なallowlisted capability、`has_staff_role`, `has_administrator_role`を返してよい。
- **Security:** capability responseはUI補助であり後続request authorizationのAuthorityではない。
- **Trace:** `AR-AUTH-*`, `AR-SES-*`, `AR-ID-*`, `AR-ROLE-*`, `FR-AUTH-*`.

### API-AUTH-002 — Get current Business Profile

- **Method:** `GET`
- **Path:** `/api/v1/self/profile`
- **Capability:** `profile.self.read`
- **Lookup:** verified Auth Subject → `app.business_profiles.auth_subject`
- **Response:** `profile_ref`と上流で正規に存在するprofile fieldsのみ。
- **Trace:** `PG-MYP-002`, `UF-AUTH-006`, `AR-OWN-*`, `DB-ID-002`.

### API-AUTH-003 — Provision current Business Profile

- **Method:** `POST`
- **Path:** `/api/v1/self/profile/provision`
- **Auth:** required, email verified
- **Body:** `{}`
- **DB primitive:** `INSERT ... ON CONFLICT (auth_subject)` + existing row reselect, `READ COMMITTED`。
- **Success:** `200` if existing, `201` if newly created。
- **Idempotency:** Domain key=`auth_subject`。Transport key不要。
- **Trace:** `AR-ID-004`, `DB-TXN matrix: Business Profile provisioning`.

### API-AUTH-004 — Update current Business Profile

- **Method:** `PATCH`
- **Path:** `/api/v1/self/profile`
- **Capability:** `profile.self.update`
- **Body:** allowlisted profile fields only。Clientからowner / auth_subject / roleを受けない。
- **DB:** owner rowをAuth Subject relationで更新。mass assignment禁止。
- **Response:** updated profile。

---

# Part V — Public API

## 26. Public operation catalog

| Operation ID | Method / Path | 主なResponse | Trace |
|---|---|---|---|
| `API-PUB-001` | `GET /public/event` | Event公開情報 | `FR-PUB-001〜004`, `PG-PUB-001`, `app.events`, `uq_events_public_ref` |
| `API-PUB-002` | `GET /public/faqs` | `PUBLISHED` FAQ | `FR-PUB-005`, `UF-PUB-001` |
| `API-PUB-003` | `GET /public/announcements` | Published list | `FR-PUB-006` |
| `API-PUB-004` | `GET /public/announcements/{announcement_ref}` | Published detail | `PG-PUB-003` |
| `API-PUB-005` | `GET /public/entry-offerings` | Entry sale data | `FR-PUB-007`, `FR-TKT-001〜002` |
| `API-PUB-006` | `GET /public/karaoke/sales` | Karaoke sales guide | `FR-PUB-008`, `KRK-AVL-*` |
| `API-PUB-007` | `GET /public/karaoke/days/{date}/buckets` | 1-hour buckets | `PG-KRK-002`, `KRK-AVL-*` |
| `API-PUB-008` | `GET /public/karaoke/days/{date}/slots` | slots | `UF-KRK-001` |
| `API-PUB-009` | `GET /public/karaoke/slots/{slot_ref}` | Slot detail / availability | `PG-KRK-003` |
| `API-PUB-010` | `GET /public/goods` | Goods list | `FR-PUB-009` |
| `API-PUB-011` | `GET /public/goods/{goods_ref}` | Goods detail | `PG-GDS-002` |

Public queryは`DRAFT` / `ARCHIVED`を返さない。availability query failureは空き0へ変換せず`503 TEMPORARY_UNAVAILABLE`。

## 27. Karaoke public availability schema

```json
{
  "slot_ref": "uuid",
  "usage_start": "2027-...Z",
  "usage_end": "2027-...Z",
  "availability": "AVAILABLE|UNAVAILABLE",
  "unavailable_reason": "HELD|SOLD|SALES_STOPPED|SALES_CLOSED|PAYMENT_WINDOW_TOO_SHORT|null"
}
```

Public responseでは他Customer、Hold owner、Order、Reservation情報を返さない。

1-hour bucketは`Asia/Tokyo`の`usage_start`で集約し、取得失敗時に`available_count: 0`を返して成功扱いしない。

---

# Part VI — Purchase / Order / Checkout

## 28. Purchase start common request contract

全purchase startは:

- `Authorization` required
- email verified
- Business Profile required
- Capability `purchase.start`
- `Idempotency-Key` required
- Client price / currency / owner / payment result禁止

### API-PUR-ENTRY-001 — Entry purchase start

- **Method:** `POST`
- **Path:** `/api/v1/self/purchases/entry`
- **Body:**

```json
{
  "offering_ref": "uuid",
  "quantity": 1
}
```

- **Zod:** `offering_ref.uuid()`, `quantity.int().min(1)`。上限はDomain settingをserver-side評価。
- **Owner resolution:** token → profile。bodyにprofileなし。
- **Domain preconditions:** sale enabled、Sales Period、capacity、Purchase Limit。
- **DB transaction A:** `READ COMMITTED`; Profile `FOR UPDATE` → Offering `FOR UPDATE`; capacity counter検査; Entry Allocation `HELD`; Order `PREPARED`; Order Item snapshot。`capacity CHECK`, allocation uniqueがfallback。
- **External call:** transaction A commit後にStripe Checkout Session。
- **Checkout orchestration:** section 29。
- **Success:** `201` new Order、またはidempotent replay `200`。`order_ref`, `state`, `checkout`を返す。
- **Conflict:** sold out / limit / sales periodは409/410。
- **Trace:** `FR-TKT-003〜010,025〜026`, `BR-SAL-*`, `BR-ORD-*`, `PAY-CHK-*`, `DB-TXN Entry allocation + Order create`, `INV-010-03,10`.

### API-PUR-KRK-001 — Karaoke purchase start / Hold acquire

- **Method:** `POST`
- **Path:** `/api/v1/self/purchases/karaoke`
- **Body:** `{ "slot_ref": "uuid" }`
- **DB transaction A:** Profile `FOR UPDATE` → Slot `FOR UPDATE`; current availability/time predicate; create Hold `ACTIVE` (`hold_expires_at=acquired+45m` generated); Slot conditional `AVAILABLE -> HELD`; Order `PREPARED`; item snapshot。
- **Constraint:** `ux_karaoke_holds_slot_active`, slot state conditional update, `ex_karaoke_slots_scope_occupancy`。
- **Payment eligibility before Stripe:** payment deadline=Session success+30m must satisfy `<= hold_expires_at - 5m` and `<= usage_end`。
- **Concurrency loser:** `409 SLOT_UNAVAILABLE`。
- **Trace:** `FR-KRK-007〜018`, `KRK-HLD-*`, `KRK-PAY-*`, `DB-KRK-*`, `INV-010-04`.

### API-PUR-GDS-001 — Goods purchase start

- **Method:** `POST`
- **Path:** `/api/v1/self/purchases/goods`
- **Body:** `{ "goods_ref": "uuid", "quantity": 1 }`
- **DB transaction A:** Profile `FOR UPDATE` → Goods Inventory `FOR UPDATE`; sale / inventory / limit検査; Goods Allocation `HELD`; Order `PREPARED`; Goods Order Item `PENDING_PAYMENT` + snapshot。
- **Constraint:** inventory CHECK, allocation unique。
- **Trace:** `FR-GDS-*`, `BR-GDS-*`, `DB-TXN Goods allocation + Order create`.

## 29. Checkout activation orchestration

### API-CHK-001 — Start / resume checkout

- **Method:** `POST`
- **Path:** `/api/v1/self/orders/{order_ref}/checkout`
- **Capability:** `orders.self.read` + purchase continuation authorization
- **Auth:** owner-safe Order lookup
- **Body:** `{}`
- **Idempotency-Key:** required

処理:

1. owner-safeでOrder取得。
2. `CONFIRMED`等terminalならnew Checkoutを作らずstate conflict。
3. Active Checkoutが存在し使用可能ならそのcheckout URLをreuse。
4. `PREPARED`ならCheckout Attemptを一意Business Causeとして作成 / recovery。
5. DB transactionを閉じる。
6. Stripe Sessionを**DB transaction外**で作成。同Attemptでは同じStripe idempotency key。
7. response loss / timeoutでは別keyで新Sessionを作らず同Attemptをretry。
8. Stripe成功後、DB transaction BでOrder `FOR UPDATE` → Attempt `FOR UPDATE`; KaraokeならHold / Slotもlock。
9. exact amount/currency、Session created instant + 30分deadline、Karaoke時間条件を再検証。
10. Payment Bindingを保存しactive partial uniqueで最大1件。
11. Order `PREPARED -> AWAITING_PAYMENT` conditional update。
12. commit後だけCheckout URLをClientへ返す。

Stripe成功後にbinding persistenceが失敗した場合、そのSessionを未追跡のActive Checkoutとして返さない。同じAttempt / Stripe idempotency keyでrecoveryし、必要ならOrder `REVIEW_REQUIRED` / Consistency Reviewへ送る。

**Response 200:**

```json
{
  "data": {
    "order_ref": "uuid",
    "state": "AWAITING_PAYMENT",
    "checkout": {
      "url": "https://checkout.stripe.com/...",
      "payment_deadline": "...Z",
      "reused": false
    }
  }
}
```

Stripe Session ID自体をBrowserへ必要以上に露出しない。URLはそのCustomerが遷移するために必要な期間だけ返す。

Trace: `PAY-CHK-001〜013`, `DB-PAY-*`, `ux_payment_bindings_order_active`, `DB-TXN Checkout Binding + Order AWAITING_PAYMENT`.

## 30. Pre-payment cancel

### API-ORD-002 — Cancel pre-payment Order

- **Method:** `POST`
- **Path:** `/api/v1/self/orders/{order_ref}/cancel`
- **Auth:** owner-safe
- **Body:** `{}`
- **Precondition:** `PREPARED` or `AWAITING_PAYMENT`; authoritative payment success不明時はblind cancelしない。
- **DB:** Order `FOR UPDATE` → Allocation/Inventory or Hold/Slot。`HELD/ACTIVE`だけreleaseしcounter/stateを条件更新。Karaokeはpayment uncertaintyならSlotを販売へ戻さず`REVIEW_REQUIRED`。
- **Success:** canceled current Order summary。
- **Idempotency:** terminal `CANCELED` replayは200 existing result。
- **Trace:** `PAY-FLR-*`, `KRK-HLD-*`, `DB-TXN Payment failure / cancel / expiry resource release`.

## 31. Owner Order APIs

### API-ORD-001 — Order list

`GET /api/v1/self/orders`

Capability `orders.self.read`。Profile relationをquery条件へ含む。

### API-ORD-003 — Order detail / Purchase Status

`GET /api/v1/self/orders/{order_ref}`

Response must include:

```json
{
  "order_ref": "uuid",
  "purpose": "ENTRY_TICKET_PURCHASE|KARAOKE_PURCHASE|GOODS_PURCHASE",
  "state": "PREPARED|AWAITING_PAYMENT|CONFIRMED|PAYMENT_FAILED|CANCELED|EXPIRED|REVIEW_REQUIRED",
  "total": {"amount":"...","currency":"JPY"},
  "items": [],
  "outcome": "PENDING|CONFIRMED|TERMINAL_FAILURE|REVIEW_REQUIRED",
  "receipt": {"url": "..."},
  "entitlements": {
    "entry_ticket_refs": [],
    "reservation_ref": null,
    "goods_item_refs": []
  }
}
```

`receipt.url`は取得可能な安全なStripe receipt情報だけ。`AWAITING_PAYMENT` pollingはOrder / Checkout / Ticket / Reservationを作成しない。

`REVIEW_REQUIRED`はHTTP 200のresource stateとしてreadできるが、`outcome=REVIEW_REQUIRED`としSuccess purchaseへ見せない。

Trace: `PAY-BRW-*`, `UF-XFN-001,003`, `PG-XFN-001`, `PG-MYP-003〜004`.

---

# Part VII — Stripe Webhook

## 32. Webhook route boundary

### API-WHK-001 — Receive Stripe webhook

- **Method:** `POST`
- **Path:** `/api/v1/webhooks/stripe`
- **Auth:** Supabase Auth不要
- **Provider auth:** Stripe signature mandatory
- **Body:** raw bytes。JSON middlewareで先にconsume / reserializeしてはならない。
- **Size:** max 1 MiB

処理順:

1. raw body取得。
2. Stripe signature header取得。
3. configured endpoint secretで署名検証。
4. invalid signatureは`400 WEBHOOK_SIGNATURE_INVALID`。Receiptを正規Eventとして作らない。
5. verified Stripe Event IDで`app.webhook_receipts` dedupe。
6. `PROCESSED/IGNORED`ならBusiness effectを再実行せず200。
7. `FAILED_RETRYABLE`は同Event / Business Causeとしてreprocess。
8. Payment BindingをStripe Session ID等のserver-side relationから解決。
9. metadata/client referenceはcross-checkのみ。
10. current Stripe authorityをserver-to-serverで必要に応じ再取得し、event orderingを信用しない。
11. amount/currency/environment/payment timeを検証。
12. PurposeごとのBusiness Confirmation transactionを実行。
13. Receipt processing resultをDomain transactionと矛盾しない形で確定。

### 32.1 Business Confirmation transaction

- Entry: Order → Allocation → Offering locks; Allocation `HELD -> COMMITTED`; Ticket `(order_item, issuance_ordinal)` unique; Order → `CONFIRMED`。
- Karaoke: Order → Hold → Slot locks; Hold `ACTIVE -> COMMITTED`; Reservation order-item/slot/hold uniqueness; Slot `SOLD`; Karaoke Ticket reservation unique; Order → `CONFIRMED`。
- Goods: Order → Allocation → Inventory → Goods Order Item; Allocation commit; Goods Order Item `PENDING_PAYMENT -> FULFILLABLE`; Handoff 1:1作成; Order → `CONFIRMED`。

全て`READ COMMITTED` + explicit locks + conditional update + DB unique/check fallback。

### 32.2 Webhook processing result / HTTP result

| Processing result | HTTP | Provider retry |
|---|---:|---|
| `PROCESSED` | 200 | 不要 |
| `IGNORED` | 200 | 不要 |
| duplicate processed/ignored | 200 | 不要 |
| `FAILED_RETRYABLE` | 500 | Stripe retryを促す |
| `REVIEW_REQUIRED` | 200 | 同じEvent再送だけで自動解決を期待しない |

`REVIEW_REQUIRED`でProvider retryを無限に誘発しない。内部Consistency Reviewを永続化し運用へ接続する。

Trace: `PAY-WHK-*`, `PAY-CFM-*`, `DB-PAY-005`, `app.webhook_receipts`, `INV-010-02,07,10`.

---

# Part VIII — Entry Ticket / QR

## 33. Owner Entry Ticket endpoints

### API-TKT-001 — Entry Ticket list

`GET /api/v1/self/entry-tickets`

Capability `tickets.self.read`; owner profile relation。Order `CONFIRMED`で正規発行済みTicketだけ。

### API-TKT-002 — Entry Ticket detail

`GET /api/v1/self/entry-tickets/{ticket_ref}`

Owner-safe query。Response: `ticket_ref`, state, offering summary, issuance ordinalの公開不要な内部意味は漏らさない、check-in summary if used。

### API-TKT-003 — Entry QR display / provisioning

- **Method:** `GET`
- **Path:** `/api/v1/self/entry-tickets/{ticket_ref}/qr`
- **Auth:** owner-safe
- **Precondition:** Ticket `VALID`
- **DB:** Ticket current stateを確認。Active QR Tokenがなければinitial provisioning Business Causeでtransactionを実行。active partial unique `ux_qr_tokens_entry_active`がfallback。
- **Token:** keyed digest lookup + protected material。Clientへ返すのはQR payloadのみ。
- **Response:** `{ ticket_ref, qr_payload: "r39x1.ent.<43>", state:"VALID" }`
- **Terminal state:** `USED/CANCELED/EXPIRED`は409 `STATE_CONFLICT`。有効QRとして返さない。
- **Logs:** qr_payload / raw tokenを通常logへ出さない。

Trace: `TQR-TKT-*`, `TQR-TOK-*`, `TQR-DSP-*`, `DB-QR-*`, `ux_qr_tokens_entry_active`.

---

# Part IX — Karaoke Owner API

## 34. Reservation endpoints

### API-KRK-SELF-001 — Reservation list

`GET /api/v1/self/karaoke-reservations`

Capability `karaoke.self.read`; owner relation。

### API-KRK-SELF-002 — Reservation detail

`GET /api/v1/self/karaoke-reservations/{reservation_ref}`

Response: reservation ref/state, usage `[usage_start, usage_end)`, Slot ref, Ticket ref if issued, cancellation result if applicable。`cycle_end`はCustomer利用時間として表示しない。

### API-KRK-SELF-003 — Karaoke QR

`GET /api/v1/self/karaoke-reservations/{reservation_ref}/qr`

- owner-safe Reservation + Ticket lookup
- Reservation `CONFIRMED`, Ticket `VALID`
- Active Karaoke Token initial provisioning with `ux_qr_tokens_karaoke_active`
- payload `r39x1.krk.<43>`
- Ticket expiration cutoff=`usage_end`

### Reservation cancellation boundary（HTTP operationなし）

Customer自己取消Capabilityは `SPEC-090 KRK-CAN-001` で追加されていないため、**self cancellation endpointを定義しない**。したがって本節にOperation IDを割り当てず、self cancellation operationは存在しない。Administrator / authorized Recoveryのみsection 43の明示operationを使用する。Staff preview / Admin HandoffのOperation ID inventoryは §41 / §48.4 を参照する。

---

# Part X — Goods Owner API

## 35. Goods purchase resource

### API-GDS-SELF-001 — Goods Order Item list

`GET /api/v1/self/goods-order-items`

Capability `goods.self.read`; owner-safe。

### API-GDS-SELF-002 — Goods Order Item detail

`GET /api/v1/self/goods-order-items/{goods_item_ref}`

Response:

```json
{
  "goods_item_ref":"uuid",
  "state":"PENDING_PAYMENT|FULFILLABLE|CANCELED",
  "goods": {"goods_ref":"uuid","name":"..."},
  "quantity":1,
  "unit_price":{"amount":"...","currency":"JPY"},
  "handoff": {"state":"PENDING|COMPLETED|VOID","completed_at":null}
}
```

`PENDING_PAYMENT`を受け渡し可能として表示しない。

---

# Part XI — Staff Check-in / Handoff

## 36. QR input validation

Request body:

```json
{
  "qr_payload": "r39x1.ent.<43-char-token>"
}
```

Zod boundary:

- string length <= 128
- exact ASCII format
- version=`r39x1`
- purpose=`ent` or `krk`
- token=`[A-Za-z0-9_-]{43}`

Raw tokenはerror details / log / analyticsへ出さない。lookup前にpurposeをparseするが、purpose marker単独をTicket type authorityにしない。

## 37. Entry Check-in

### API-STF-CHK-001

- **Method:** `POST`
- **Path:** `/api/v1/staff/check-ins/entry`
- **Auth:** verified Identity + active `STAFF`
- **Capability:** `entry_checkin.execute`
- **Body:** QR payload
- **Transaction:** Entry Ticket `FOR UPDATE`; conditional `VALID -> USED`; Entry Check-in insert; Ticket unique Check-in constraint。

処理順:

1. Identity verification
2. STAFF role lookup
3. capability evaluation
4. QR format
5. keyed digest lookup
6. Token lifecycle
7. `ent` purpose + Entry Ticket type
8. Ticket current state
9. Ticket row `FOR UPDATE`
10. state再検証
11. `VALID -> USED`
12. Check-in insert
13. commit
14. outcome

## 38. Karaoke Check-in

### API-STF-CHK-002

`POST /api/v1/staff/check-ins/karaoke`

Capability `karaoke_checkin.execute`。

Entry共通処理に加えて:

- purpose=`krk`
- Ticket `FOR UPDATE` → Reservation row
- Reservation `CONFIRMED`
- current instant ∈ `[usage_start - 10m, usage_end)`
- cutoff=`usage_end`
- cancellation / check-in raceはTicket rowを最初にlockして直列化

## 39. Canonical Check-in response

HTTP bodyは**常にCanonical outcome名をrenameせず**返す。

```json
{
  "data": {
    "outcome": "CHECKED_IN",
    "ticket": {
      "ticket_ref": "uuid",
      "type": "ENTRY"
    },
    "check_in": {
      "checked_in_at": "...Z"
    }
  }
}
```

Outcome mapping:

| Outcome | HTTP | Mutation |
|---|---:|---|
| `CHECKED_IN` | 200 | 初回commit |
| `ALREADY_USED` | 200 | なし。既存Check-in summary |
| `MALFORMED_QR` | 400 | なし |
| `UNKNOWN_TOKEN` | 404 | なし |
| `WRONG_PURPOSE` | 422 | なし |
| `TOKEN_REVOKED` | 410 | なし |
| `TICKET_CANCELED` | 409 | なし |
| `TICKET_EXPIRED` | 410 | Check-inなし |
| `RESERVATION_CANCELED` | 409 | なし |
| `OUTSIDE_CHECKIN_WINDOW` | 422 | なし |
| `AUTHENTICATION_FAILED` | 401 | なし |
| `AUTHORIZATION_DENIED` | 403 | なし |
| `TEMPORARY_UNAVAILABLE` | 503 | なし |
| `CONSISTENCY_REVIEW_REQUIRED` | 409 | なし |

`ALREADY_USED`はHTTP 200だが`outcome`を必ず保持し、2回目の成功として`CHECKED_IN`へ変換しない。

Known response loss retryはTicket `USED` + exactly one Check-inを再取得して`ALREADY_USED`を返す。

## 40. Staff Goods Handoff

### API-STF-GDS-002 — Resolve Goods Handoff target (preview)

- **Method:** `GET`
- **Path:** `/api/v1/staff/goods-handoffs/{goods_item_ref}`
- **Auth:** verified Identity + active `STAFF`
- **Capability:** `goods_handoff.execute`
- **Lookup:** `goods_item_ref` = Goods Order Item Public Reference。Internal ID / Email / Customer指定検索を行わない（`AR-ROLE-015`）。
- **Transaction:** read only
- **Response 200:** `goods_item_ref`（uuid, non-null）, `goods_name`（text, non-null）, `quantity`（integer > 0, non-null）, `goods_order_item_state`（`PENDING_PAYMENT|FULFILLABLE|CANCELED`, non-null）, `handoff_ref`（uuid, non-null）, `handoff_state`（`PENDING|COMPLETED|VOID`, non-null）, `customer_profile_ref`（uuid, non-null; `app.goods_order_items.customer_profile_id` → `app.business_profiles.public_ref`）。raw Email、Internal ID、raw QR token、Customer全Order履歴、unrelated Ticket / Karaoke / Goods履歴を返さない。
- **Purpose:** mutation前の対象確認。本readはcompletionを成立させず、confirmationの代替ではない。
- **404:** unknown ref。候補検索へfallbackしない。
- **Trace:** `FR-STF-*`, `FR-GDS-014〜015`, `PG-STF-006`, `AR-ROLE-015`, `STF-GDS-005`, `SPEC-130 §49.1`.

### API-STF-GDS-001 — Complete Goods Handoff

- **Method:** `POST`
- **Path:** `/api/v1/staff/goods-handoffs/{goods_item_ref}/complete`
- **Capability:** `goods_handoff.execute`
- **DB:** Goods Order Item → Handoff `FOR UPDATE`; precondition item=`FULFILLABLE`, handoff=`PENDING`; conditional `PENDING -> COMPLETED`。
- **Constraint:** one Handoff unique。
- **Replay:** already `COMPLETED`なら200 existing completion summary。2件目を作らない。
- **Conflict:** `VOID` / non-fulfillableは409。

本operationはStaffの通常completionであり、§48.4 `API-ADM-HOF-003` の `Administrative Handoff Completion` とCapability・Actor・audit contextを分離する（`AR-ROLE-013,015`, `STF-GDS-004`）。

---

# Part XII — Administrator API

## 41. Administrator read catalog

| Operation ID | Method / Path | Capability |
|---|---|---|
| `API-ADM-ORD-001` | `GET /admin/orders` | `orders.manage.read` |
| `API-ADM-ORD-002` | `GET /admin/orders/{order_ref}` | `orders.manage.read` |
| `API-ADM-TKT-001` | `GET /admin/entry-tickets` | `tickets.manage.read` |
| `API-ADM-TKT-002` | `GET /admin/entry-tickets/{ticket_ref}` | `tickets.manage.read` |
| `API-ADM-KRK-001` | `GET /admin/karaoke/reservations` | `karaoke_reservations.manage.read` |
| `API-ADM-KRK-002` | `GET /admin/karaoke/reservations/{reservation_ref}` | `karaoke_reservations.manage.read` |
| `API-ADM-KRK-008` | `GET /admin/karaoke/slots` | `karaoke_slots.manage` |
| `API-ADM-KRK-009` | `GET /admin/karaoke/slots/{slot_ref}` | `karaoke_slots.manage` |
| `API-ADM-KRK-010` | `GET /admin/karaoke/exclusive-scopes` | `karaoke_slots.manage` |
| `API-ADM-KRK-011` | `GET /admin/karaoke/exclusive-scopes/{scope_ref}` | `karaoke_slots.manage` |
| `API-ADM-ENT-SALES-001` | `GET /admin/entry-offerings` | `entry_sales.manage` |
| `API-ADM-ENT-SALES-002` | `GET /admin/entry-offerings/{offering_ref}` | `entry_sales.manage` |
| `API-ADM-KRK-SALES-001` | `GET /admin/karaoke/sales-configurations` | `karaoke_sales.manage` |
| `API-ADM-KRK-SALES-002` | `GET /admin/karaoke/sales-configurations/{sales_configuration_ref}` | `karaoke_sales.manage` |
| `API-ADM-GDS-001` | `GET /admin/goods/inventory` | `goods_inventory.manage` |
| `API-ADM-GDS-002` | `GET /admin/goods` | `goods_inventory.manage` |
| `API-ADM-GDS-003` | `GET /admin/goods/{goods_ref}` | `goods_inventory.manage` |
| `API-ADM-HOF-001` | `GET /admin/goods-handoffs` | `goods_handoff.manage` |
| `API-ADM-HOF-002` | `GET /admin/goods-handoffs/{handoff_ref}` | `goods_handoff.manage` |
| `API-ADM-CNT-001` | `GET /admin/event` | `public_content.manage` |
| `API-ADM-CNT-003` | `GET /admin/faqs` | `public_content.manage` |
| `API-ADM-CNT-004` | `GET /admin/faqs/{faq_ref}` | `public_content.manage` |
| `API-ADM-CNT-009` | `GET /admin/announcements` | `public_content.manage` |
| `API-ADM-CNT-010` | `GET /admin/announcements/{announcement_ref}` | `public_content.manage` |
| `API-ADM-ROL-001` | `GET /admin/role-assignments` | `role_assignment.manage` |
| `API-ADM-REC-001` | `GET /admin/consistency-reviews` | `recovery.review` |
| `API-ADM-REC-002` | `GET /admin/consistency-reviews/{case_ref}` | `recovery.review` |

Admin responseもInternal PK、QR raw token、Stripe secretを返さない。必要なprovider referenceはallowlisted masked / public operational identifiersだけ。

Admin read operationはPublic Referenceだけをaddressable IDとして使用し、operation-specific CapabilityをRequestごとにServer-side再評価する。read Capabilityは対応するmutation Capabilityを含意しない（`AR-ROLE-017`）。

**API-ADM-READ-001:** 上表および §46〜§48 に列挙した全Admin method / pathは、それぞれexactly 1つのcanonical `API-*` Operation IDを持つ。1 routeに複数IDを付けず、1 IDを複数routeへ使い回さない。Log / Audit / MetricはこのIDをexactに使用する。

**API-ADM-READ-002:** Authoritative readはserver-side queryとして実行し、Public APIのpublished viewやClient cacheで代用してはならない。特に`DRAFT` / `ARCHIVED` content、Admin KPI / inventory counter、Slot / Scope current stateはAdmin read operationだけが返す。

**API-ADM-READ-003:** 各Admin listのqueryは §48.3 の対応schemaを使用する。`API-ADM-ORD-001`→`orderListQuery`, `API-ADM-TKT-001`→`entryTicketListQuery`, `API-ADM-KRK-001`→`karaokeReservationListQuery`, `API-ADM-KRK-008`→`karaokeSlotListQuery`, `API-ADM-GDS-002`→`goodsListQuery`, `API-ADM-HOF-001`→`goodsHandoffListQuery`, `API-ADM-ROL-001`→`roleAssignmentListQuery`, `API-ADM-REC-001`→`consistencyReviewListQuery`, `API-ADM-CNT-003`→`faqListQuery`, `API-ADM-CNT-009`→`announcementListQuery`, `API-ADM-ENT-SALES-001`→`entryOfferingListQuery`, `API-ADM-KRK-SALES-001`→`karaokeSalesConfigListQuery`。

## 42. Karaoke Slot manage

### API-ADM-KRK-003 — Generate Slots

- **POST** `/api/v1/admin/karaoke/slots/generate`
- **Capability:** `karaoke_slots.manage`
- **Idempotency-Key:** required
- **Body:** scope refs[], `window_start`, `window_end`, `template="STANDARD"`
- **Zod:** non-empty scopes; timestamps; `window_start < window_end`
- **DB:** scope rows Internal ID ascending `FOR UPDATE`; deterministic candidates; exact-match rows reuse; non-identical overlap anywhere -> rollback all。
- **Constraint:** exact identity unique + GiST `ex_karaoke_slots_scope_occupancy`。
- **Success:** generated refs + reused refs。
- **Conflict:** `409 SLOT_GENERATION_OVERLAP`。
- **Trace:** `KRK-GEN-001〜009`, `DB-TXN Slot batch generation`.

### API-ADM-KRK-004 — Stop sales

`POST /api/v1/admin/karaoke/slots/{slot_ref}/stop-sales`

Slot `FOR UPDATE`; only upper-spec permitted state transitions。Existing Hold / Soldを破壊しない。

### API-ADM-KRK-005 — Resume sales

`POST /api/v1/admin/karaoke/slots/{slot_ref}/resume-sales`

Only state/preconditions allowed by `KRK-EDT-*`; overlap / time predicateを再検査。

### API-ADM-KRK-006 — Edit Slot

`PATCH /api/v1/admin/karaoke/slots/{slot_ref}`

Allowlist fields: up-stream permitted scope/time/sales configuration relation only。Slot `FOR UPDATE`; GiST exclusion fallback。Held / sold / historical integrityを破るeditは禁止。

### API-ADM-KRK-008 — Slot list

- **Method:** `GET`
- **Path:** `/api/v1/admin/karaoke/slots`
- **Auth:** verified Identity + active `ADMINISTRATOR`
- **Capability:** `karaoke_slots.manage`
- **Query:** §48.3 `karaokeSlotListQuery` allowlist。`usage_date`は`Asia/Tokyo`業務日としてserver-side解釈する。
- **Transaction:** read only
- **Response 200:** list envelope。各itemは`slot_ref`, `state`, `exclusive_scope_ref`, `sales_configuration_ref`, `usage_start`, `usage_end`, `cycle_end`を含む。Internal ID、Hold owner、Customer identityを返さない。
- **Sort:** `usage_start ASC, public_ref ASC`。
- **Trace:** `FR-ADM-009`, `PG-ADM-007`, `KRK-SCP-*`, `DB-KRK-*`.

### API-ADM-KRK-009 — Slot detail

- **Method:** `GET`
- **Path:** `/api/v1/admin/karaoke/slots/{slot_ref}`
- **Capability:** `karaoke_slots.manage`
- **Lookup:** `slot_ref` Public Reference。Internal ID lookupを試行しない。
- **Response 200:** `slot_ref`（uuid, non-null）, `state`（`AVAILABLE|HELD|SOLD|SALES_STOPPED`, non-null）, `exclusive_scope_ref`（uuid, non-null）, `sales_configuration_ref`（uuid, non-null）, `usage_start` / `usage_end` / `cycle_end`（timestamp, non-null）, `hold_ref`（uuid, nullable）, `hold_state`（`ACTIVE|COMMITTED|RELEASED|EXPIRED`, nullable）, `reservation_ref`（uuid, nullable）, `reservation_state`（`CONFIRMED|CANCELED`, nullable）。Customer identity / Order内容 / raw Email / Internal IDを返さない。
- **404:** unknown ref。
- **Trace:** `FR-ADM-009,011`, `PG-ADM-009`, `KRK-EDT-*`.

### API-ADM-KRK-010 — Exclusive Scope list

- **Method:** `GET`
- **Path:** `/api/v1/admin/karaoke/exclusive-scopes`
- **Capability:** `karaoke_slots.manage`
- **Query:** `{ limit, cursor }` allowlist。
- **Response 200:** list envelope。各itemは`scope_ref`, `name`, `sort_order`を含む。ScopeはDomain Stateを持たないためstate fieldを返さない。
- **Sort:** `sort_order ASC, public_ref ASC`。
- **Trace:** `FR-ADM-010`, `PG-ADM-008`, `KRK-SCP-*`, `DB-KRK-*`.

### API-ADM-KRK-011 — Exclusive Scope detail

- **Method:** `GET`
- **Path:** `/api/v1/admin/karaoke/exclusive-scopes/{scope_ref}`
- **Capability:** `karaoke_slots.manage`
- **Response 200:** `scope_ref`, `name`, `sort_order`。
- **404:** unknown ref。Slot generationは既存 `API-ADM-KRK-003` を使用し、本書はScopeのmutationを定義しない。
- **Trace:** `FR-ADM-010`, `PG-ADM-008`.

## 43. Reservation cancellation / recovery boundary

### API-ADM-KRK-007 — Cancel Reservation

- **POST** `/api/v1/admin/karaoke/reservations/{reservation_ref}/cancel`
- **Capability:** 通常管理画面から自由取消を許すCapabilityは上流で独立定義されていないため、`recovery.exception.execute` が**SPEC-090で許可されたNormal Cancellation causeとして明示された運用文脈に限り**使用可能。
- **DB lock:** Karaoke Ticket `FOR UPDATE` → Reservation。
- **Precondition:** Reservation `CONFIRMED`; common Ticket cancellation rule。
- **Effects:** Reservation `CANCELED`; unused Ticket `CANCELED`; Slot remains `SOLD`; Hold remains `COMMITTED`; no resale。
- **Idempotency:** existing cancellation result reuse。

本endpointをgeneric cancellation / invariant bypassとして利用してはならない。SPEC-130 / 150が具体的なUI / Runbookを定義する。

## 44. Refund

### API-ADM-PAY-001 — Request full refund

- **POST** `/api/v1/admin/orders/{order_ref}/refund`
- **Auth:** Administrator
- **Capability:** `recovery.exception.execute`。Refundは上流 `PAY-AZ-*` のauthorized payment operationとしてのみ許可。
- **Body:** `{ "reason": "<allowlisted operational reason>" }`
- **Idempotency-Key:** required
- **Precondition:** eligible confirmed payment, no succeeded/live duplicate full refund。
- **DB phase A:** create/reuse Refund Record Business Cause; unique / `ux_refund_records_order_live_full`。
- **External:** Stripe full refund outside DB transaction, same Stripe idempotency key on retry。
- **DB phase B:** persist provider result。Financial Refund successはDomain cancellation成功と分離。
- **Response:** Refund Record public operational summary。Provider result unknown -> review, not duplicate refund。
- **Trace:** `PAY-RFD-*`, `PAY-AZ-*`, `DB-PAY-*`.

## 45. QR token rotation recovery

### API-ADM-TQR-001

- **POST** `/api/v1/admin/tickets/{ticket_ref}/qr-token/rotate`
- **Capability:** `recovery.exception.execute`
- **Use:** confirmed compromise / authorized recovery only。
- **DB:** Ticket row lock; existing Active Token revoke; new token generate; active partial unique。
- **No effect:** Ticket state/owner/Order/Check-in history unchanged。
- **Old scan:** `TOKEN_REVOKED`。
- **Security:** new raw tokenをAdmin responseへ返さない。Owner QR endpointから取得させる。

## 46. Public content manage

Capability `public_content.manage`。Event / FAQ / AnnouncementのAdmin read / mutationはすべて本CapabilityをRequestごとにServer-side評価する。Publication Stateは`DRAFT|PUBLISHED|ARCHIVED`を使用し、許可Transitionは`SPEC-030 §8.2`のState Machineだけとする。

```text
DRAFT -> PUBLISHED
PUBLISHED -> DRAFT
PUBLISHED -> ARCHIVED
DRAFT -> ARCHIVED
ARCHIVED -> DRAFT
```

Publication commandは`POST .../{command}`の命令subresourceとし、任意State値の `PATCH` で代替しない。mass assignment禁止。`DRAFT` / `ARCHIVED` をpublic responseへ出さない。

### API-ADM-CNT-001 — Read Event public fields

- **Method:** `GET`
- **Path:** `/api/v1/admin/event`
- **Capability:** `public_content.manage`
- **Transaction:** read only
- **Response 200:** `event_ref`, `name`, `summary`, `starts_at`, `ends_at`, `venue_name`, `venue_details`, `access_information`, `participant_notices`, `business_timezone`, `updated_at`。未設定のnullable外部事実は`null`のまま返し、推測値で埋めない。
- **Trace:** `FR-ADM-018`, `PG-ADM-018`, `BR-EVT-001`, `app.events`, `uq_events_public_ref`.

### API-ADM-CNT-002 — Update Event public fields

- **Method:** `PATCH`
- **Path:** `/api/v1/admin/event`
- **Capability:** `public_content.manage`
- **Idempotency-Key:** required
- **Body allowlist:** `name`, `summary`, `starts_at`, `ends_at`, `venue_name`, `venue_details`, `access_information`, `participant_notices`, `expected_updated_at`（optional optimistic precondition）。
- **Zod:** strict object。`starts_at < ends_at` when both non-null。`business_timezone` / Internal ID / stateは受け取らない。
- **Conflicts:** `expected_updated_at`不一致または同時更新検出時は`409 STATE_CONFLICT`。Clientは最新値を再取得し、local変更を自動再送しない。
- **Response 200:** updated Event public fields（`API-ADM-CNT-001`と同形）。
- **Transaction:** single Event row update。External callなし。既存Order / Ticket / Reservation / Goods権利を変更しない。
- **Audit:** changed field names、event ref、result。
- **Trace:** `FR-ADM-018,020`, `BR-EVT-001,003,004`, `ADM-CNT-001`, `app.events`, `uq_events_public_ref`.

### API-ADM-CNT-003 — FAQ list

- **Method:** `GET`
- **Path:** `/api/v1/admin/faqs`
- **Capability:** `public_content.manage`
- **Query:** §48.3 `faqListQuery`。
- **Response 200:** list envelope。各itemは`faq_ref`, question summary, `state`, `sort_order`, `published_at`, `updated_at`。`DRAFT|PUBLISHED|ARCHIVED`をAdmin authorization後に返す。
- **Sort:** `sort_order ASC, public_ref ASC`。
- **Trace:** `FR-ADM-018`, `PG-ADM-019`.

### API-ADM-CNT-004 — FAQ detail

- **Method:** `GET`
- **Path:** `/api/v1/admin/faqs/{faq_ref}`
- **Capability:** `public_content.manage`
- **Response 200:** `faq_ref`, question, answer, `state`, `sort_order`, `published_at`, `updated_at`。
- **404:** unknown ref。
- **Trace:** `FR-ADM-018`, `PG-ADM-019`.

### API-ADM-CNT-005 — Create FAQ draft

- **Method:** `POST`
- **Path:** `/api/v1/admin/faqs`
- **Capability:** `public_content.manage`
- **Idempotency-Key:** required
- **Body allowlist:** `question`, `answer`。strict object。`state`は受け取らず、serverが`DRAFT`で作成する。
- **Success:** `201` newly created draft。
- **Trace:** `FR-ADM-018`, `PG-ADM-019`, `BR-EVT-002`.

### API-ADM-CNT-006 — Update FAQ

- **Method:** `PATCH`
- **Path:** `/api/v1/admin/faqs/{faq_ref}`
- **Capability:** `public_content.manage`
- **Idempotency-Key:** required
- **Body allowlist:** `question`, `answer`, `sort_order`。`state` / Internal IDは受け取らない。`state`変更はcommand operationを使用する。
- **Precondition:** current stateがedit可能。`ARCHIVED`の直接`PUBLISHED`化は行わない。
- **Conflict:** `409 STATE_CONFLICT`。
- **Response 200:** updated FAQ（`API-ADM-CNT-004`と同形）。
- **Trace:** `FR-ADM-018,020`, `PG-ADM-019`.

### API-ADM-CNT-007 — Publish FAQ

- `POST /api/v1/admin/faqs/{faq_ref}/publish`
- **Capability:** `public_content.manage`; **Idempotency-Key:** required
- **Precondition:** current `DRAFT`。`PUBLISHED` replayは200 existing result。`ARCHIVED`から直接publishしない。
- **Effect:** `DRAFT -> PUBLISHED`; `published_at`をserverが設定。既存Order / Ticket / Reservation / Goods権利を変更しない。
- **Conflict:** 上記以外のcurrent stateは`409 STATE_CONFLICT`。
- **Response 200:** updated FAQ（Publication Stateを含む）。
- **Trace:** `FR-ADM-018`, `BR-EVT-002,003`, `ADM-CNT-001`.

### API-ADM-CNT-008 — Archive FAQ

- `POST /api/v1/admin/faqs/{faq_ref}/archive`
- **Capability:** `public_content.manage`; **Idempotency-Key:** required
- **Precondition:** current `DRAFT|PUBLISHED`。`ARCHIVED` replayは200 existing result。
- **Effect:** `-> ARCHIVED`。publicから除外。
- **Response 200:** updated FAQ（`state=ARCHIVED`）。
- **Trace:** `FR-ADM-018`, `BR-EVT-002`.

### API-ADM-CNT-009 — Announcement list

- **Method:** `GET`
- **Path:** `/api/v1/admin/announcements`
- **Capability:** `public_content.manage`
- **Query:** §48.3 `announcementListQuery`。
- **Response 200:** list envelope。各itemは`announcement_ref`, `title`, `state`, `published_at`, `updated_at`。Admin authorization後に`DRAFT|PUBLISHED|ARCHIVED`を返す。
- **Sort:** `published_at DESC, public_ref DESC`。
- **Trace:** `FR-ADM-018`, `PG-ADM-020`.

### API-ADM-CNT-010 — Announcement detail

- **Method:** `GET`
- **Path:** `/api/v1/admin/announcements/{announcement_ref}`
- **Capability:** `public_content.manage`
- **Response 200:** `announcement_ref`, `title`, `body`, `state`, `published_at`, `updated_at`。
- **404:** unknown ref。
- **Trace:** `FR-ADM-018`, `PG-ADM-020`.

### API-ADM-CNT-011 — Create Announcement draft

- `POST /api/v1/admin/announcements`
- **Capability:** `public_content.manage`; **Idempotency-Key:** required
- **Body allowlist:** `title`, `body`。serverが`DRAFT`で作成。`state`は受け取らない。
- **Success:** `201`。
- **Trace:** `FR-ADM-018`, `PG-ADM-020`.

### API-ADM-CNT-012 — Update Announcement

- `PATCH /api/v1/admin/announcements/{announcement_ref}`
- **Capability:** `public_content.manage`; **Idempotency-Key:** required
- **Body allowlist:** `title`, `body`。`state`変更はcommand operationを使用する。
- **Conflict:** `409 STATE_CONFLICT`。
- **Response 200:** updated Announcement（`API-ADM-CNT-010`と同形）。
- **Trace:** `FR-ADM-018,020`, `PG-ADM-020`.

### API-ADM-CNT-013 — Publish Announcement

- `POST /api/v1/admin/announcements/{announcement_ref}/publish`
- **Capability:** `public_content.manage`; **Idempotency-Key:** required
- **Precondition:** current `DRAFT`。`PUBLISHED` replayは200 existing result。`ARCHIVED`から直接publishしない。
- **Effect:** `DRAFT -> PUBLISHED`; `published_at`をserverが設定。
- **Response 200:** updated Announcement（Publication Stateを含む）。
- **Trace:** `FR-ADM-018`, `BR-EVT-002,003`.

### API-ADM-CNT-014 — Archive Announcement

- `POST /api/v1/admin/announcements/{announcement_ref}/archive`
- **Capability:** `public_content.manage`; **Idempotency-Key:** required
- **Precondition:** current `DRAFT|PUBLISHED`。`ARCHIVED` replayは200 existing result。
- **Effect:** `-> ARCHIVED`。
- **Response 200:** updated Announcement（`state=ARCHIVED`）。
- **Trace:** `FR-ADM-018`, `BR-EVT-002`.

### API-ADM-CNT-015 — Restore FAQ to draft

- `POST /api/v1/admin/faqs/{faq_ref}/restore-draft`
- **Capability:** `public_content.manage`; **Idempotency-Key:** required
- **Precondition:** current `PUBLISHED|ARCHIVED`。`DRAFT` replayは200 existing result。
- **Effect:** `PUBLISHED|ARCHIVED -> DRAFT`（`SPEC-030 §8.2`）。`DRAFT`はpublicへ出さない。
- **Forbidden:** `ARCHIVED -> PUBLISHED` をdirect actionとして提供しない。
- **Response 200:** updated FAQ（`state=DRAFT`）。
- **Trace:** `FR-ADM-018`, `BR-EVT-002`.

### API-ADM-CNT-016 — Restore Announcement to draft

- `POST /api/v1/admin/announcements/{announcement_ref}/restore-draft`
- **Capability:** `public_content.manage`; **Idempotency-Key:** required
- **Precondition:** current `PUBLISHED|ARCHIVED`。`DRAFT` replayは200 existing result。
- **Effect:** `PUBLISHED|ARCHIVED -> DRAFT`。
- **Response 200:** updated Announcement（`state=DRAFT`）。
- **Trace:** `FR-ADM-018`, `BR-EVT-002`.

Content safety: raw HTML / scriptをAdmin preview / detailでtrustedとして実行しない。sanitization contractは`SPEC-140`。

## 47. Goods inventory manage

Capability `goods_inventory.manage`。Goods Inventory mutationはcurrent counterをDB row lock下で再評価し、既存Allocation / committed saleを破壊する調整を拒否する。

### API-ADM-GDS-001 — Read Goods inventory snapshot

- `GET /api/v1/admin/goods/inventory`
- **Capability:** `goods_inventory.manage`
- **Response 200:** list envelope。各itemは`goods_ref`, `saleable_capacity`, `held_quantity`, `committed_quantity`, `updated_at`。
- **Trace:** `FR-ADM-016`, `PG-ADM-013`.

### API-ADM-GDS-002 — Admin Goods list

- **Method:** `GET`
- **Path:** `/api/v1/admin/goods`
- **Capability:** `goods_inventory.manage`
- **Query:** §48.3 `goodsListQuery`。`goods_ref` / `sale_control_state`だけをallowlistし、任意sort / 非上流enumを受けない。
- **Response 200:** list envelope。各itemは`goods_ref`, `name`, `unit_price`, `sale_control_state`, sales period, `purchase_limit`, `saleable_capacity`, `held_quantity`, `committed_quantity`。
- **Sort:** server canonical goods list order。Clientから任意sortを送らない。
- **Trace:** `FR-ADM-016`, `PG-ADM-013`.

### API-ADM-GDS-003 — Admin Goods detail

- `GET /api/v1/admin/goods/{goods_ref}`
- **Capability:** `goods_inventory.manage`
- **Response 200:** `goods_ref`, `name`, `description`, `unit_price`, `sales_starts_at`, `sales_ends_at`, `sale_control_state`, `purchase_limit`, inventory counters, `updated_at`。
- **404:** unknown ref。
- **Trace:** `FR-ADM-016`, `PG-ADM-014`.

### API-ADM-GDS-004 — Update Goods public / sales fields

- `PATCH /api/v1/admin/goods/{goods_ref}`
- **Capability:** `goods_inventory.manage`; **Idempotency-Key:** required
- **Body allowlist:** `name`, `description`, `unit_amount`, `currency`, `sales_starts_at`, `sales_ends_at`, `sale_control_state`（`ENABLED|SUSPENDED`）, `purchase_limit`, `expected_updated_at`（optional）。
- **Forbidden:** Inventory counter（`saleable_capacity` / `held_quantity` / `committed_quantity`）を同PATCHへ混在させない。Inventory変更は`API-ADM-GDS-005`を使用する。
- **DB:** Goods row `FOR UPDATE`; conditional update; `sales_starts_at < sales_ends_at` CHECK fallback。
- **Conflicts:** `409 STATE_CONFLICT` / `422 DOMAIN_RULE_VIOLATION`。
- **Effect:** 新規purchase判定へ反映し、既存Order Item price snapshotへ遡及しない（`BR-SAL-002`）。
- **Response 200:** updated Goods（`API-ADM-GDS-003`と同形）。
- **Trace:** `FR-ADM-016,020`, `BR-SAL-001,002,004,008`, `PG-ADM-014`.

### API-ADM-GDS-005 — Inventory adjustment

- `POST /api/v1/admin/goods/{goods_ref}/inventory-adjustments`
- **Capability:** `goods_inventory.manage`; **Idempotency-Key:** required
- **Body:** `{ "adjustment": <signed integer>, "expected_updated_at": "<optional>" }`。held / committed counterの直接編集値、Client-supplied reason code、free textは受け取らない。
- **Zod:** `adjustment`はnon-zero signed integer、`expected_updated_at`はoptional datetime。strict object。`reason_code`はbody / queryに存在しない。
- **Reason code:** serverが `reason_code = ADMINISTRATIVE_CAPACITY_ADJUSTMENT` を導出する（`SPEC-160 §28.1` / `OBS-GDS-004,005`）。Clientは選択・指定できず、free text・代替code・future reason enumを提供しない。新しいbusiness purpose / Capability / Domain State / UI制御を追加しない。
- **Precondition:** adjustment後も `held_quantity + committed_quantity <= saleable_capacity`。既存Allocation / committed sale / `COMPLETED` Handoffを破壊しない。
- **DB:** Inventory row `FOR UPDATE`; current counter再評価; conditional update; CHECK fallback。
- **Conflicts:** 負数 / 既存確定分を下回る調整は`422 DOMAIN_RULE_VIOLATION`。concurrent updateは`409 STATE_CONFLICT`。Clientは自動再送しない。
- **Transaction:** single DB transaction。External callなし。
- **Audit / same transaction:** 同一DB transactionで `goods.inventory_adjustment.completed` Audit Eventへ concrete Operation ID `API-ADM-GDS-005`、fixed `reason_code=ADMINISTRATIVE_CAPACITY_ADJUSTMENT`、signed adjustment quantity、safe before/after counters、resultを永続化する。Audit insert失敗時はBusiness transactionをrollbackし成功を返さない（`SPEC-160 §35 / §36 / §37`, `OBS-GDS-002`）。
- **Response 200:** `goods_ref`, `saleable_capacity`, `held_quantity`, `committed_quantity`, `updated_at`。
- **Trace:** `FR-ADM-016`, `BR-SAL-008`, `DB-GDS-001,003,004`, `SPEC-150 §56`, `SPEC-160 §28.1`, `OBS-GDS-002,004,005`.

## 48. Role Assignment manage

Capability `role_assignment.manage`。

### API-ADM-ROL-001 — Role Assignment list

- `GET /api/v1/admin/role-assignments`
- **Capability:** `role_assignment.manage`
- **Query:** §48.3 `roleAssignmentListQuery`。
- **Response 200:** list envelope。各itemは`role_assignment_ref`, target profile public ref, `role`（`STAFF|ADMINISTRATOR`）, `state`（`ACTIVE|REVOKED`）, granted / revoked time, safe actor summary。
- **Trace:** `FR-ADM-001`, `PG-ADM-021`, `DB-AUTH-002`.

### API-ADM-ROL-002 — Grant Role Assignment

- `POST /api/v1/admin/role-assignments`
- **Capability:** `role_assignment.manage`; **Idempotency-Key:** required
- **Body:** `{ "target_profile_ref": "uuid", "role": "STAFF|ADMINISTRATOR" }`。strict object。Client permission union / capability checkbox値は受け取らない。
- **DB:** target Profile relationを解決; assignment `FOR UPDATE`; Administrator set変更時は`SPEC-100`のadvisory lock; active partial unique `ux_role_assignments_profile_role_active`。
- **Conflicts:** duplicate active assignmentは2件目を作らず既存result / `409 STATE_CONFLICT`。self `ADMINISTRATOR` grant / last-administrator loss / target mismatchは通常操作で成立させない（`AR-ROLE-004〜009`）。
- **Response 201:** created assignment summary（new）、または200 existing active assignment（replay）。
- **Audit:** assignment ref、target profile ref、role、result。
- **Trace:** `FR-ADM-001`, `AR-ROLE-004〜015`, `ADM-ROL-001〜003`, `DB-AUTH-002`.

### API-ADM-ROL-003 — Deactivate Role Assignment

- `POST /api/v1/admin/role-assignments/{role_assignment_ref}/deactivate`
- **Capability:** `role_assignment.manage`; **Idempotency-Key:** required
- **Precondition:** current `ACTIVE`。already `REVOKED` replayは200 existing result。
- **Effects:** assignment `ACTIVE -> REVOKED`; 次privileged requestからCapability失効。Session / ownership data自体は削除しない。
- **Forbidden:** self `ADMINISTRATOR` revoke / last active Administrator lossを通常UIで成立させない。
- **Conflicts:** `409 STATE_CONFLICT` / `403 AUTHORIZATION_DENIED`。
- **Response 200:** updated assignment summary（`state=REVOKED`）、またはreplay existing result。
- **Audit:** assignment ref、target profile ref、role、from / to state、result。
- **Trace:** `FR-ADM-001`, `AR-ROLE-004〜015`, `DB-AUTH-002`.

## 48.1 Entry Ticket Offering manage

Capability `entry_sales.manage`（`SPEC-060 AR-ROLE-016〜018`）。通常Administrator operationであり、`tickets.manage.read` / `recovery.exception.execute` を代替authorityとして使用しない。`SPEC-130 §31`のoperational fields / safety semanticsをHTTPへ写像する。

### API-ADM-ENT-SALES-001 — Entry Ticket Offering list

- `GET /api/v1/admin/entry-offerings`
- **Auth:** verified Identity + active `ADMINISTRATOR`; **Capability:** `entry_sales.manage`
- **Query:** §48.3 `entryOfferingListQuery`。
- **Response 200:** list envelope。各itemは`offering_ref`, `name`, `unit_price`, sales period, `sale_control_state`, `sales_capacity`, `held_quantity`, `committed_quantity`, `purchase_limit`。
- **Sort:** `created_at DESC, public_ref DESC`。
- **Trace:** `FR-ADM-014`, `PG-ADM-006`.

### API-ADM-ENT-SALES-002 — Entry Ticket Offering detail

- `GET /api/v1/admin/entry-offerings/{offering_ref}`
- **Capability:** `entry_sales.manage`
- **Response 200:** `offering_ref`, `name`, `description`, `unit_price`, `sales_starts_at`, `sales_ends_at`, `sale_control_state`, `sales_capacity`, `held_quantity`, `committed_quantity`, `purchase_limit`, `checkin_opens_at`, `checkin_closes_at`, `updated_at`。
- **404:** unknown ref。`held_quantity` / `committed_quantity`はread-only counter。
- **Trace:** `FR-ADM-014`, `PG-ADM-006`, `SPEC-130 §31.1`.

### API-ADM-ENT-SALES-003 — Update Entry Ticket Offering sales conditions

- `PATCH /api/v1/admin/entry-offerings/{offering_ref}`
- **Auth:** verified Identity + active `ADMINISTRATOR`; **Capability:** `entry_sales.manage`
- **Idempotency-Key:** required
- **Body allowlist:** `name`, `description`, `unit_amount`, `currency`, `sales_starts_at`, `sales_ends_at`, `sale_control_state`（`ENABLED|SUSPENDED`）, `sales_capacity`, `purchase_limit`, `checkin_opens_at`, `checkin_closes_at`, `expected_updated_at`（optional）。
- **Zod:** strict object。`held_quantity` / `committed_quantity` / Internal ID / Event ID / Client price authorityを受け取らない。`sales_starts_at < sales_ends_at`、`checkin_opens_at < checkin_closes_at`（both non-null）。
- **Preconditions / conflicts:** `sales_capacity >= held_quantity + committed_quantity` をserver-sideで再評価。違反は`422 DOMAIN_RULE_VIOLATION`。concurrent updateは`409 STATE_CONFLICT`。`BR-SAL-008`を維持。
- **DB:** Offering row `FOR UPDATE`; counter / current period再評価; conditional update; `held + committed <= sales_capacity` CHECK fallback。
- **Effect:** 新規purchase判定へ反映。既存Order Item snapshotを遡及変更しない（`BR-SAL-002`）。
- **Transaction:** single DB transaction。External callなし。
- **Response 200:** updated Offering（`API-ADM-ENT-SALES-002`と同形、read-only counterを含む）。
- **Audit:** offering ref、changed field names、result。
- **Trace:** `FR-ADM-014,020`, `BR-SAL-001,002,004,008`, `SPEC-130 §31.2`, `app.entry_ticket_offerings`, `held_quantity + committed_quantity <= sales_capacity` CHECK.

## 48.2 Karaoke Sales Configuration manage

Capability `karaoke_sales.manage`（`SPEC-060 AR-ROLE-016〜018`）。`karaoke_slots.manage`とは独立であり、本節のoperationをSlot individual state editorとして使用しない（`ADM-KRK-009` / `AR-ROLE-017`）。`SPEC-130 §32`をHTTPへ写像する。

### API-ADM-KRK-SALES-001 — Karaoke Sales Configuration list

- `GET /api/v1/admin/karaoke/sales-configurations`
- **Capability:** `karaoke_sales.manage`
- **Query:** §48.3 `karaokeSalesConfigListQuery`。
- **Response 200:** list envelope。各itemは`sales_configuration_ref`, `name`, `unit_price`, sales period, `sale_control_state`, `purchase_limit`。
- **Sort:** `created_at DESC, public_ref DESC`。
- **Trace:** `FR-ADM-015`, `PG-ADM-012`.

### API-ADM-KRK-SALES-002 — Karaoke Sales Configuration detail

- `GET /api/v1/admin/karaoke/sales-configurations/{sales_configuration_ref}`
- **Capability:** `karaoke_sales.manage`
- **Response 200:** `sales_configuration_ref`, `name`, `unit_price`, `sales_starts_at`, `sales_ends_at`, `sale_control_state`, `purchase_limit`, `standard_usage_minutes`（=15 read-only）, `standard_maintenance_minutes`（=5 read-only）, `updated_at`。
- **404:** unknown ref。
- **Trace:** `FR-ADM-015`, `PG-ADM-012`, `SPEC-130 §32.1`.

### API-ADM-KRK-SALES-003 — Update Karaoke Sales Configuration sales conditions

- `PATCH /api/v1/admin/karaoke/sales-configurations/{sales_configuration_ref}`
- **Capability:** `karaoke_sales.manage`; **Idempotency-Key:** required
- **Body allowlist:** `name`, `unit_amount`, `currency`, `sales_starts_at`, `sales_ends_at`, `sale_control_state`（`ENABLED|SUSPENDED`）, `purchase_limit`, `expected_updated_at`（optional）。
- **Zod:** strict object。`standard_usage_minutes` / `standard_maintenance_minutes` / Slot state / Internal IDを受け取らず、送信された場合は`400 VALIDATION_FAILED`。
- **Preconditions:** `sales_starts_at < sales_ends_at`。current Slot / Hold / Reservation / Ticket / Order snapshotを暗黙変更しない。
- **Conflicts:** `409 STATE_CONFLICT` / `422 DOMAIN_RULE_VIOLATION`。
- **DB:** Sales Configuration row `FOR UPDATE`; conditional update。
- **Effect:** 新規availability / purchase startへ反映。標準15 + 5 cycleをAdmin UIから変更しない。
- **Response 200:** updated Sales Configuration（`API-ADM-KRK-SALES-002`と同形、15 / 5 read-onlyを含む）。
- **Audit:** sales_configuration ref、changed field names、result。
- **Trace:** `FR-ADM-015,020`, `BR-SAL-001,002,004`, `SPEC-130 §32.2`, `ADM-KRK-009`.

## 48.3 Administrator list query allowlist

各Admin listは以下のZod schemaのallowlist queryだけを受け、strict（`.strict()`相当）で未知parameterを拒否する。`sort` / `order_by` / raw SQL / offset / arbitrary columnは定義しない。日時rangeは`from` inclusion / `to` inclusionとし、serverで`Asia/Tokyo`業務日をinstantへ正規化する。Public Reference boundはすべて`z.string().uuid()`。

各schemaは単一のcomplete canonical sort tupleを持ち、その全sort keyは`SPEC-100`に実在するcolumn / `SPEC-130`が定義した意味からなる。`cursor`は選択されたsort modeのsort key + `public_ref`をserver-signedにencodeし、modeを切り替えた場合はcursorを破棄して先頭pageを再取得する。

共通:

```ts
const pageQuery = {
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).max(512).optional(),
};
```

### 48.3.1 Order (`API-ADM-ORD-001`, `orderListQuery`)

```ts
z.object({
  order_ref: z.string().uuid().optional(),
  purpose: z.enum(["ENTRY_TICKET_PURCHASE", "KARAOKE_PURCHASE", "GOODS_PURCHASE"]).optional(),
  state: z.enum(["PREPARED", "AWAITING_PAYMENT", "CONFIRMED", "PAYMENT_FAILED", "CANCELED", "EXPIRED", "REVIEW_REQUIRED"]).optional(),
  refund_state: z.enum(["REQUESTED", "PENDING", "SUCCEEDED", "FAILED", "REVIEW_REQUIRED"]).optional(),
  customer_profile_ref: z.string().uuid().optional(),
  created_from: z.string().datetime().optional(),
  created_to: z.string().datetime().optional(),
  ...pageQuery,
}).strict();
```

Sort: `created_at DESC, public_ref DESC`。

### 48.3.2 Entry Ticket (`API-ADM-TKT-001`, `entryTicketListQuery`)

```ts
z.object({
  ticket_ref: z.string().uuid().optional(),
  state: z.enum(["VALID", "USED", "CANCELED", "EXPIRED"]).optional(),
  offering_ref: z.string().uuid().optional(),
  order_ref: z.string().uuid().optional(),
  owner_profile_ref: z.string().uuid().optional(),
  checkin: z.enum(["USED", "UNUSED"]).optional(),
  issued_from: z.string().datetime().optional(),
  issued_to: z.string().datetime().optional(),
  ...pageQuery,
}).strict();
```

Sort: `issued_at DESC, public_ref DESC`（`app.entry_tickets.issued_at`）。

### 48.3.3 Karaoke Slot (`API-ADM-KRK-008`, `karaokeSlotListQuery`)

```ts
z.object({
  state: z.enum(["AVAILABLE", "HELD", "SOLD", "SALES_STOPPED"]).optional(),
  exclusive_scope_ref: z.string().uuid().optional(),
  sales_configuration_ref: z.string().uuid().optional(),
  usage_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  usage_from: z.string().datetime().optional(),
  usage_to: z.string().datetime().optional(),
  ...pageQuery,
}).strict();
```

Sort: `usage_start ASC, public_ref ASC`。

### 48.3.4 Karaoke Reservation (`API-ADM-KRK-001`, `karaokeReservationListQuery`)

```ts
z.object({
  reservation_ref: z.string().uuid().optional(),
  state: z.enum(["CONFIRMED", "CANCELED"]).optional(),
  slot_ref: z.string().uuid().optional(),
  order_ref: z.string().uuid().optional(),
  customer_profile_ref: z.string().uuid().optional(),
  usage_from: z.string().datetime().optional(),
  usage_to: z.string().datetime().optional(),
  ticket_state: z.enum(["VALID", "USED", "CANCELED", "EXPIRED"]).optional(),
  order: z.enum(["CREATED_DESC", "USAGE_START_ASC"]).default("CREATED_DESC"),
  ...pageQuery,
}).strict();
```

Sort tuple（modeごとに厳密に対応。`usage_from` / `usage_to`は`app.karaoke_reservations.usage_start_snapshot`を範囲評価する）:

- `CREATED_DESC`（default）: `created_at DESC, public_ref DESC`（`app.karaoke_reservations.created_at`）。新規予約作成順。`SPEC-130 §51.4` default。
- `USAGE_START_ASC`: `usage_start_snapshot ASC, public_ref ASC`（`app.karaoke_reservations.usage_start_snapshot`）。Schedule-specific view。`SPEC-130 §51.4` schedule view。

`cursor`は`order` modeへbindし、mode変更時はcursorを破棄する。

### 48.3.5 Goods (`API-ADM-GDS-002`, `goodsListQuery`)

```ts
z.object({
  goods_ref: z.string().uuid().optional(),
  sale_control_state: z.enum(["ENABLED", "SUSPENDED"]).optional(),
  ...pageQuery,
}).strict();
```

Sort: `created_at DESC, public_ref DESC`（`app.goods.created_at`）。Clientからの任意name sortは受けない。

### 48.3.6 Goods Handoff (`API-ADM-HOF-001`, `goodsHandoffListQuery`)

```ts
z.object({
  handoff_ref: z.string().uuid().optional(),
  state: z.enum(["PENDING", "COMPLETED", "VOID"]).optional(),
  goods_ref: z.string().uuid().optional(),
  customer_profile_ref: z.string().uuid().optional(),
  created_from: z.string().datetime().optional(),
  created_to: z.string().datetime().optional(),
  completed_from: z.string().datetime().optional(),
  completed_to: z.string().datetime().optional(),
  ...pageQuery,
}).strict();
```

Sort: `created_at DESC, public_ref DESC`。

### 48.3.7 Role Assignment (`API-ADM-ROL-001`, `roleAssignmentListQuery`)

```ts
z.object({
  role: z.enum(["STAFF", "ADMINISTRATOR"]).optional(),
  state: z.enum(["ACTIVE", "REVOKED"]).optional(),
  target_profile_ref: z.string().uuid().optional(),
  granted_from: z.string().datetime().optional(),
  granted_to: z.string().datetime().optional(),
  ...pageQuery,
}).strict();
```

Sort: `granted_at DESC, public_ref DESC`。

### 48.3.8 Consistency Review (`API-ADM-REC-001`, `consistencyReviewListQuery`)

`reason_category`は`SPEC-150 §43`のcanonical reason codeだけをallowlistする。

```ts
z.object({
  resolution: z.enum(["UNRESOLVED", "RESOLVED", "ALL"]).default("UNRESOLVED"),
  reason_category: z.enum([
    "AUTH_PROFILE_RELATION_INCONSISTENT", "ROLE_ADMIN_SET_INCONSISTENT",
    "PAY_CHECKOUT_RESULT_UNRESOLVED", "PAY_BINDING_INCONSISTENT",
    "PAY_CONFIRMATION_INCONSISTENT", "PAY_LATE_SUCCESS_RESOURCE_REUSED",
    "REFUND_RESULT_UNRESOLVED", "REFUND_DOMAIN_CANCELLATION_INCOMPLETE",
    "WEBHOOK_CORRELATION_UNRESOLVED", "TQR_TOKEN_CORRELATION_INCONSISTENT",
    "TQR_KEY_MIGRATION_FAILED", "TQR_CHECKIN_STATE_INCONSISTENT",
    "KRK_HOLD_SLOT_INCONSISTENT", "KRK_RESERVATION_TICKET_INCONSISTENT",
    "GDS_INVENTORY_COUNTER_INCONSISTENT", "GDS_HANDOFF_STATE_INCONSISTENT",
    "EML_NOTIFICATION_CAUSE_INCONSISTENT", "EML_PROVIDER_RESULT_UNRESOLVED",
    "EML_RECIPIENT_RELATION_INCONSISTENT", "EML_RENDER_CONTEXT_INVALID",
    "EML_WEBHOOK_UNMATCHED", "SECURITY_KEY_VERSION_INCONSISTENT",
  ]).optional(),
  related_resource_ref: z.string().uuid().optional(),
  opened_from: z.string().datetime().optional(),
  opened_to: z.string().datetime().optional(),
  ...pageQuery,
}).strict();
```

Sort: `opened_at ASC, public_ref ASC`（`app.consistency_review_cases.opened_at`）。`resolution`はphysical predicate（`resolved_at IS NULL` / `IS NOT NULL` / 全件）の選択でありDomain Stateではない。sort tupleは全resolution値で同一。

### 48.3.9 FAQ list (`API-ADM-CNT-003`, `faqListQuery`)

```ts
z.object({
  state: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  ...pageQuery,
}).strict();
```

Sort: `sort_order ASC, public_ref ASC`（`app.faq_items.sort_order`、`ix_faq_items_event_state_sort`）。

### 48.3.10 Announcement list (`API-ADM-CNT-009`, `announcementListQuery`)

```ts
z.object({
  state: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  ...pageQuery,
}).strict();
```

Sort: `published_at DESC, public_ref DESC`（`app.announcements.published_at`、`ix_announcements_event_state_published`）。`SPEC-110 §12`のAnnouncement canonical sortを維持する。

### 48.3.11 Entry Ticket Offering list (`API-ADM-ENT-SALES-001`, `entryOfferingListQuery`)

```ts
z.object({
  sale_control_state: z.enum(["ENABLED", "SUSPENDED"]).optional(),
  ...pageQuery,
}).strict();
```

Sort: `created_at DESC, public_ref DESC`（`app.entry_ticket_offerings.created_at`）。

### 48.3.12 Karaoke Sales Configuration list (`API-ADM-KRK-SALES-001`, `karaokeSalesConfigListQuery`)

```ts
z.object({
  sale_control_state: z.enum(["ENABLED", "SUSPENDED"]).optional(),
  ...pageQuery,
}).strict();
```

Sort: `created_at DESC, public_ref DESC`（`app.karaoke_sales_configurations.created_at`）。

Notification Admin listは`SPEC-120 §36`のquery allowlistを使用する。

## 48.4 Goods Handoff manage

### API-ADM-HOF-001 — Admin Goods Handoff list

- `GET /api/v1/admin/goods-handoffs`
- **Auth:** verified Identity + active `ADMINISTRATOR`; **Capability:** `goods_handoff.manage`
- **Query:** §48.3 `goodsHandoffListQuery`
- **Response 200:** list envelope。各itemは`handoff_ref`（uuid, non-null）, `goods_item_ref`（uuid, non-null）, `goods_name`（text, non-null）, `quantity`（integer > 0, non-null）, `handoff_state`（`PENDING|COMPLETED|VOID`, non-null）, `goods_order_item_state`（`PENDING_PAYMENT|FULFILLABLE|CANCELED`, non-null）, `order_ref`（uuid, non-null; `app.orders.public_ref`）, `customer_profile_ref`（uuid, non-null; `app.business_profiles.public_ref`）, `created_at`（timestamp, non-null）, `completed_at`（timestamp, nullable）, `completion_actor`（nullable; `null` or `{ "profile_ref": uuid, "role": "STAFF"|"ADMINISTRATOR" }`）。`completion_actor`はpresent時のみ`completed_by_profile_id` / `completed_role_assignment_id`から導出する。raw Email、Internal ID、Auth Subject、raw QR token、unrelated Customer historyを返さない。
- **Sort:** `created_at DESC, public_ref DESC`。
- **Trace:** `FR-ADM-017`, `PG-ADM-015`, `SPEC-130 §30.1`, `ADM-GDS-014,016`.

### API-ADM-HOF-002 — Admin Goods Handoff detail

- `GET /api/v1/admin/goods-handoffs/{handoff_ref}`
- **Auth:** active `ADMINISTRATOR`; **Capability:** `goods_handoff.manage`
- **Response 200:** `handoff_ref`（uuid, non-null）, `handoff_state`（`PENDING|COMPLETED|VOID`, non-null）, `created_at`（timestamp, non-null）, `completed_at`（timestamp, nullable）, `goods_item_ref`（uuid, non-null）, `goods_order_item_state`（`PENDING_PAYMENT|FULFILLABLE|CANCELED`, non-null）, `goods_name`（text, non-null）, `quantity`（integer > 0, non-null）, `order_ref`（uuid, non-null）, `customer_profile_ref`（uuid, non-null）, `completion_actor`（nullable; `null` or `{ "profile_ref": uuid, "role": "STAFF"|"ADMINISTRATOR" }`）, `command_available`（boolean, non-null; server current preconditionの候補表示のみ）。
- **No response:** 任意State編集用のfield、raw Email、Internal ID、Auth Subject、raw QR token、unrelated history。
- **404:** unknown ref。
- **Trace:** `FR-ADM-017`, `PG-ADM-016`, `SPEC-130 §30.2`, `ADM-GDS-014,016`.

### API-ADM-HOF-003 — Administrative Handoff Completion

- **Method:** `POST`
- **Path:** `/api/v1/admin/goods-handoffs/{handoff_ref}/complete`
- **Auth:** verified Identity + active `ADMINISTRATOR`
- **Capability:** `goods_handoff.manage`（`goods_handoff.execute` ではない。`AR-ROLE-013,015` / `ADM-GDS-005`）
- **Idempotency-Key:** required
- **Body:** `{}`。Handoff State値、任意target state、`PENDING|COMPLETED|VOID` inputを受け取らない。
- **Precondition:** server current Handoff `PENDING` かつ Goods Order Item `FULFILLABLE`（`BR-GDS-010`）。unresolved inconsistencyでcurrent authorityを安全に確定できない場合は成立させない。
- **DB:** Goods Order Item → Handoff `FOR UPDATE`; conditional `PENDING -> COMPLETED`; `completed_by_profile_id` / active `ADMINISTRATOR` role assignment / `completed_at`を完了記録として設定; 1:1 Handoff uniqueをfallbackとする。
- **Effects:** 対象Handoffを一度だけ`PENDING -> COMPLETED`。completion actor / timeを追跡可能にする。既存Order / Payment / Customer ownership / sales configuration / Inventory counterを本commandだけで変更しない。`COMPLETED`はTerminal。
- **Replay:** already `COMPLETED`は新規completionを成立させず、200 existing completion summaryを返す（`ADM-GDS-008,013`）。
- **Conflicts:** Handoff `VOID`またはItem non-fulfillableは`409 STATE_CONFLICT`。stale / conflict時はcurrent detailをreloadし、Clientは自動再送しない。
- **Forbidden:** direct `PENDING -> VOID`、`COMPLETED -> PENDING|VOID`、undo / reopen / reset、generic state editor、Staff通常completionの権限借用（`ADM-GDS-006,009〜011`）。
- **Response 200:** `handoff_ref`（uuid, non-null）, `handoff_state`（`COMPLETED`, non-null）, `goods_order_item_state`（non-null）, `completed_at`（timestamp, non-null）, `completion_actor`（`{ "profile_ref": uuid, "role": "STAFF"|"ADMINISTRATOR" }`, non-null）。raw Email、Internal ID、Auth Subjectを返さない。
- **Audit:** handoff ref, goods item ref, before / after state, result（`OPS-AUD-*`）。
- **Trace:** `FR-ADM-017,020`, `BR-GDS-010〜013`, `AR-ROLE-013,015`, `AR-AZ-015`, `SPEC-130 §30.4`, `ADM-GDS-005〜016`.

## 48.5 Administrator recovery commands

`recovery.exception.execute`は本節に列挙したoperation-specific commandまたは上流で明示済みのRecoveryだけに使用し、generic state mutation / arbitrary SQL / constraint disableを提供しない（`AR-ROLE-014`, `REL-ADM-001`）。全commandは`recovery.review`でcurrent stateを参照したうえで実行し、Requestごとにcurrent Role / Capabilityを再評価する。共通条件:

- `Idempotency-Key` required。same Business Cause / Provider keyを維持し、new key / new target / 反対state mutationを自動送信しない。
- current authorityをserver-sideで取得し、Case / browser snapshotをpreconditionにしない。
- external provider call中にDB transactionをopenしない。Admin manual recovery HTTP requestは15秒以内にfinal resultを返し、確定不能ならpending / unknownを返して同期waitしない。
- result unknownをsuccessへ変換しない。raw provider body / Secret / raw QR / full Emailをresponse / logへ返さない。
- 15秒 / deadline超過または未知のauthorityは`409 CONSISTENCY_REVIEW_REQUIRED`または`503 TEMPORARY_UNAVAILABLE`。
- Audit Eventはconcrete Operation IDを保持する（`OBS-AUD-011`）。

SPEC-150 Manual Recovery Runbookとの対応:

| SPEC-150 Runbook | Canonical operation |
|---|---|
| §46 Stripe Checkout Unknown | `API-ADM-REC-003` |
| §47 Payment Confirmation Mismatch | `API-ADM-REC-004` |
| §48 Refund Unknown | `API-ADM-REC-005` |
| §49 QR Token Compromise / Rotation | `API-ADM-TQR-001`（既存） |
| §51 Karaoke Reservation Cancellation | `API-ADM-KRK-007`（既存） |
| §52 Notification Failed / Blocked | `API-ADM-EML-004/005`（SPEC-120） |
| §53 Notification Unknown Result | `API-ADM-REC-006` |
| §55 Consistency Review Recovery | `API-ADM-REC-007` およびCase reasonに対応するoperation-specific recovery |
| §56 Goods Inventory Adjustment / Counter Recovery | `API-ADM-GDS-005` |
| §57 Last Administrator Emergency Recovery | `SPEC-150 §20` / `SPEC-180`（通常Role Assignment APIの外） |

### API-ADM-REC-003 — Reconcile unknown Checkout Attempt

- **Method:** `POST`
- **Path:** `/api/v1/admin/recovery/checkout-attempts/{checkout_attempt_ref}/reconcile`
- **Auth:** active `ADMINISTRATOR`; **Capability:** `recovery.exception.execute`
- **Body:** `{}`
- **Precondition:** Checkout Attempt `creation_result=UNKNOWN` unresolved、Order `PREPARED|REVIEW_REQUIRED`、same `(Order, Checkout Attempt)` / Stripe idempotency keyを特定済み。
- **Locks:** Order → Checkout Attempt → Allocation / Hold / Slot（`SPEC-100` lock order）。
- **Allowed:** existing SessionをBindingして上流preconditionが成立する場合だけOrderを`AWAITING_PAYMENT`へ進める、またはProvider非作成が明確な場合だけAttemptを`FAILED`へ確定する。Stripe照合はDB transaction外。
- **Forbidden:** unknownのままnew key / new Session / Hold再生成 / Order再作成。Case snapshot依存の状態変更。
- **Success:** exactly 1 active CheckoutまたはProvider非作成が明確な状態。
- **Unknown:** mutationなし、Case unresolved維持。successを返さない。
- **Response 200:** Checkout Attempt / Order current safe state summary（`checkout_attempt_ref`, `order_ref`, `creation_result`, Order state, active / reused flag）。new Session URL / provider bodyは返さない。
- **Post verification:** active Binding <= 1、amount / currency一致、Karaoke時間条件一致。
- **Trace:** `REL-REC-010〜013`, `PAY-CHK-*`, `SPEC-150 §46`.

### API-ADM-REC-004 — Reconcile Payment Confirmation mismatch

- **Method:** `POST`
- **Path:** `/api/v1/admin/recovery/orders/{order_ref}/reconcile-payment-confirmation`
- **Auth:** active `ADMINISTRATOR`; **Capability:** `recovery.exception.execute`
- **Body:** `{}`
- **Precondition:** verified Stripe current paid authorityとBusiness Confirmation未成立、またはOrder `REVIEW_REQUIRED`。same Business Cause / Payment Binding。
- **Transaction / Locks:** `API-WHK-001 §32.1` のPurpose別Business Confirmation transactionをそのまま再利用する。Entry: Order → Allocation → Offering; Karaoke: Order → Hold → Slot; Goods: Order → Allocation → Inventory → Goods Order Item（`SPEC-100 §48` Payment Confirmation行）。本operation専用の別lock順序を定義せず、同じEntitlement・同じtransactionで確定する。
- **Allowed:** 上流`REVIEW_REQUIRED -> CONFIRMED`を同じBusiness Confirmation transaction（`API-WHK-001 §32.1`）で成立させる、または未支払が確定した場合だけ上流許可terminalへ進める。
- **Forbidden:** terminal `CANCELED|EXPIRED|PAYMENT_FAILED -> CONFIRMED`、missing entitlementをtransaction外で個別生成、resource奪回。amount / currency / environment不一致のまま確定しない。
- **Idempotency:** existing Order / payment binding / entitlement uniques。
- **Unknown:** mutationなし、Case unresolved維持。
- **Response 200:** Order current state、state transition result、entitlement summary safe refs。provider raw bodyを返さない。
- **Post verification:** `INV-010-02,03,04,07,10`。
- **Trace:** `PAY-CFM-*`, `SPEC-150 §47`.

### API-ADM-REC-005 — Reconcile Refund result

- **Method:** `POST`
- **Path:** `/api/v1/admin/recovery/orders/{order_ref}/refund-result-reconcile`
- **Auth:** active `ADMINISTRATOR`; **Capability:** `recovery.exception.execute`
- **Body:** `{}`
- **Precondition:** current live full Refund Recordが`REQUESTED|PENDING|REVIEW_REQUIRED`、same Refund Business Cause / Stripe idempotency key / `stripe_refund_id`を特定済み。
- **Locks:** Refund Record → Order。Domain cancellationを伴う場合は対象Domain lock order。
- **Allowed:** existing Refund Recordへverified Stripe current resultをcorrelateし、`PENDING|SUCCEEDED|FAILED`へ上流許可transition。Financial Refund resultとDomain cancellation resultを分離する（`DB-PAY-007`）。
- **Forbidden:** 2件目Refund、別keyでfull refund、amount推測、financial success rollback。
- **Idempotency:** existing Refund Record / Stripe key。Refund `SUCCEEDED` replayは200 existing result。
- **Unknown:** no write retry、Case unresolved維持。
- **Response 200:** Refund Record public operational summary（refund state, amount, currency, provider result category）。raw provider body / Secretを返さない。
- **Post verification:** no duplicate live full Refund、amount / currency一致。
- **Trace:** `PAY-RFD-*`, `DB-PAY-006,007`, `SPEC-150 §48`.

### API-ADM-REC-006 — Reconcile Notification unknown provider result

- **Method:** `POST`
- **Path:** `/api/v1/admin/recovery/notifications/{notification_ref}/reconcile`
- **Auth:** active `ADMINISTRATOR`; **Capability:** `recovery.exception.execute`
- **Body:** `{}`
- **Precondition:** Delivery Job `UNKNOWN_RESULT`、same Attempt / provider key / `business_cause_key`、verified webhook receiptまたはResend server authorityで結果を相関できる。
- **Provider lookup:** Resend server-to-server照合またはverified webhook receiptの解決はDB transaction外で行う。provider network call中にDB transactionをopenしない。
- **Locks / revalidation:** lookup後に`SPEC-120 §30.1`のcanonical local lock order `email_delivery_jobs -> notification_requests -> email_delivery_attempts`でcurrent stateを再取得・再検証してからconditional persistenceする。Case / browser snapshotをpreconditionにしない。
- **Allowed:** same provider resultをlocal persistenceへ反映し、`SENT` / `CLOSED`へ、またはdefinitive non-acceptanceが安全に確認され上流が許す場合だけretryable pathへ戻す。
- **Forbidden:** new provider key、recipient変更、blind resend、`SENT` overwrite、元Business Transaction再実行。
- **Idempotency:** same Attempt / provider key。Source Order / Reservation stateを変更しない。
- **Errors:** `SPEC-120 §37`のNotification error codeを使用。`409 NOTIFICATION_PROVIDER_RESULT_UNKNOWN`等でblind mutationを拒否する。
- **Response 200:** Notification Domain / Processing State safe summary（`notification_ref`, `state`, `processing_state`, safe provider correlation）。Email本文 / provider body / recipient全文を返さない。
- **Trace:** `EML-*`, `SPEC-150 §53`.

### API-ADM-REC-007 — Post-verification resolve Consistency Review case

- **Method:** `POST`
- **Path:** `/api/v1/admin/recovery/consistency-reviews/{case_ref}/resolve`
- **Auth:** active `ADMINISTRATOR`; **Capability:** `recovery.exception.execute`
- **Body:** `{}`。target state / source state値、任意free-text noteを受け取らない。`app.consistency_review_cases.resolution_note` は本operationでは設定せず`NULL`のままとする。
- **Precondition:** Case unresolved。source Entityを同じlock orderで再取得し、Case作成時snapshotではなくcurrent stateをpreconditionにする（`REL-REC-010`）。Caseがstaleでcurrent stateが既に正規状態へ収束済み、または対応するoperation-specific recoveryが完了し、Authority + Domain Invariantの再検証が成立する場合だけ。
- **Allowed:** post-verification後に`resolved_at`を設定する。source historyを削除しない。Case reasonに対応する上流専用Recoveryを代替しない。
- **Forbidden:** mark-fixed only、generic state write、arbitrary SQL、constraint disable、browserだけでresolvedにする操作。
- **Idempotency:** already resolved replayは200 existing result。同じincidentのretryで新Caseを増やさない。
- **Errors:** 再検証不成立は`409 CONSISTENCY_REVIEW_REQUIRED`。
- **Response 200:** `case_ref`, `resolved_at`。Internal IDs / source history / free-text noteを返さない。
- **Trace:** `REL-REC-010〜013`, `DB-XFN-002,003`, `SPEC-150 §55`.

---

# Part XIII — Consistency Review / Recovery Read

## 49. Consistency Review representation

Order `REVIEW_REQUIRED`はOrder resource state。Cross-entity unresolved issueは`app.consistency_review_cases`で追跡する。

Client向け一般Order status:

```json
{
  "state": "REVIEW_REQUIRED",
  "outcome": "REVIEW_REQUIRED",
  "support_reference": null
}
```

一般Userへ内部reason code / provider identifiersを返さない。

Administrator `recovery.review` responseは`case_ref`, opened_at, allowlisted reason category, related public refsを返せるが、Internal IDsは返さない。

Consistency Review readは §48.3 `consistencyReviewListQuery` を使用し、defaultは`resolution=UNRESOLVED`（`resolved_at IS NULL`相当）とする。Post-verification resolutionは §48.5 `API-ADM-REC-007` だけが提供し、mark-fixed only / generic state writeを提供しない。

**API-REC-001:** `recovery.exception.execute` は「任意SQL」「任意state変更」「constraint無効化」を提供しない。各Recovery endpointを明示的なOperation ID / precondition / transactionとして実装する。

---

# Part XIV — Database Failure / Retry Boundary

## 50. SQLSTATE mapping

- `40001`, `40P01`: transaction-level retryable。SPEC-150の回数 / backoff内で同Business Causeをretry。exhausted -> `503 DATABASE_TEMPORARY_FAILURE`。
- `23505`: constraint名を分類。Known idempotent duplicateはexisting resultへ収束、known capacity/active unique loserは409、unknownは500/review。
- `23514`:通常はimplementation/domain invariant mismatch。Client validation errorへ安易に変換しない。
- `23503`: stale reference / implementation raceを安全に分類できる場合のみ404/409。それ以外500。
- `23P01`: Karaoke overlap known conflictは409 `SLOT_UNAVAILABLE` / `SLOT_GENERATION_OVERLAP`; blind retry禁止。

## 51. Database unavailable

Connection failure / timeout等でtransaction commitの成否が不明な場合:

- partial successを返さない。
- new Business Causeを作らない。
- response `503 DATABASE_TEMPORARY_FAILURE`。
- Client retry時はsame Idempotency-Key + Domain Business Cause lookupで既存commit有無を再判定。

DB outageを「sold out」「unknown token」「empty list」に変換しない。

---

# Part XV — Idempotency Matrix

## 52. Domain idempotency

| Business Cause | Canonical key / primitive | API behavior |
|---|---|---|
| Purchase start | transport key + normalized request, but Domain allocation/order relation authoritative | replay existing Order |
| Checkout Attempt | `(Order, Checkout Attempt)` + Stripe idempotency key | same Session result recovery |
| Webhook | Stripe Event ID unique | processed/ignored replay |
| Payment Confirmation | Order / payment binding + state + entitlement uniques | no double confirmation |
| Entry Ticket issuance | `(Order Item, issuance ordinal)` unique | existing Ticket reuse |
| Slot generation | batch cause + deterministic candidate; exact unique | exact existing reuse |
| Karaoke Hold | Slot active partial unique + Order relation | one active winner |
| Reservation | Order Item / Slot / Hold unique | existing Reservation reuse |
| Karaoke Ticket | Reservation unique | existing Ticket reuse |
| Check-in | Ticket single-use + Check-in ticket unique | `ALREADY_USED` |
| Goods Allocation commit | allocation conditional state | no double inventory commit |
| Goods Handoff completion（Staff / Administrator） | 1:1 Handoff + conditional `PENDING -> COMPLETED` | existing completion reuse、second completionなし |
| Entry Ticket Offering update | transport key + Offering current row / counter precondition | replay existing configuration state |
| Karaoke Sales Configuration update | transport key + Configuration current row precondition | replay existing configuration state |
| Goods sales / public field update / Inventory adjustment | transport key + current counter precondition + CHECK | no double adjustment |
| Public content command | transport key + current Publication State conditional update | existing command result reuse |
| Role Assignment mutation | transport key + active partial unique / advisory lock | existing assignment reuse |
| Refund | Refund Record + Stripe idempotency + live full partial unique | same refund recovery |
| Refund result reconcile | existing Refund Record + Stripe key | exactly 1 financial outcome |
| Checkout Attempt reconcile | same `(Order, Checkout Attempt)` + Stripe idempotency key | same Session / Attempt result |
| Payment Confirmation reconcile | Order / payment binding + state + entitlement uniques | no double confirmation |
| Notification unknown result reconcile | same Attempt / provider key + `business_cause_key` | same provider result、new provider keyなし |
| Consistency Review resolve | `case_ref` + `resolved_at` conditional + `dedupe_key` | existing resolved result reuse |
| Notification Request | `business_cause_key UNIQUE` | SPEC-120 reuses same request |

**API-IDM-002:** Client Request ID / Idempotency-Keyだけを唯一のDomain idempotency keyにしない。

---

# Part XVI — Security Boundary

## 53. API input trust

次をClient authorityとして使用禁止。

- user ID / auth subject
- profile ID / owner
- role / permission / Customer flag
- price / currency / subtotal / total
- inventory / capacity / availability
- payment success / refund success
- Order state / Ticket state / Reservation state
- QR token lifecycle

## 54. Mass assignment

PATCH/POSTはoperationごとにZod objectを`strict()`相当で定義し、未知fieldを拒否する。DB row objectをそのままrequest bodyへspreadしない。

## 55. Response minimization

- Public: PUBLISHED / sellable decisionに必要な範囲。
- Self:本人所有resourceだけ。
- Staff:受付 / Handoff判断に必要な最小summary。
- Admin:operationに必要な業務情報。Secretsなし。

Public ReferenceはAuthorizationではない。

## 56. QR / Stripe secret logging

禁止:

- raw QR payload / token
- encrypted QR material
- token lookup digest
- Authorization Bearer token
- Stripe webhook signature secret
- Stripe Secret Key
- complete Checkout URLの不用意なstructured log

Request ID、Operation ID、Public Reference、safe provider object IDの限定使用はSPEC-160へ委譲する。

---

# Part XVII — Endpoint Traceability Matrix

## 57. Major operation traceability

| Operation | FR / Flow / Page | Auth / Domain | Payment / TQR / KRK | DB primitive |
|---|---|---|---|---|
| Public Event | `FR-PUB-*`, `UF-PUB-001`, `PG-PUB-*` | `BR-EVT-*` | - | `app.events`, `uq_events_public_ref` |
| Profile provision | `FR-AUTH-*`, `UF-AUTH-*` | `AR-ID-*` | - | `UNIQUE(auth_subject)`, ON CONFLICT |
| Entry purchase | `FR-TKT-*`, `UF-TKT-001`, `PG-TKT-001` | `BR-SAL-*`,`BR-ORD-*` | `PAY-CHK-*` | Profile→Offering locks, allocation/capacity |
| Karaoke purchase | `FR-KRK-*`, `UF-KRK-002`, `PG-KRK-003` | `BR-KRK-*` | `KRK-HLD-*`,`KRK-PAY-*` | Profile→Slot lock, active Hold unique, GiST |
| Goods purchase | `FR-GDS-*`, `UF-GDS-001`, `PG-GDS-002` | `BR-GDS-*` | `PAY-CHK-*` | Profile→Inventory lock |
| Order status | `FR-MYP-*`, `UF-XFN-*`, `PG-XFN-001` | `AR-OWN-*` | `PAY-BRW-*` | owner-safe query |
| Webhook | `FR-XFN-*` | `BR-ORD-*`,`DI-030-*` | `PAY-WHK-*`,`PAY-CFM-*` | Event ID unique + confirmation transaction |
| Entry QR | `FR-TKT-*`, `PG-MYP-007` | `AR-OWN-*` | `TQR-TOK-*`,`TQR-DSP-*` | active token partial unique |
| Karaoke QR | `FR-KRK-*`, `PG-MYP-010` | `AR-OWN-*` | `TQR-*`,`KRK-CFM-*` | Reservation/Ticket relation + active unique |
| Entry Check-in | `FR-STF-*`, `UF-CHK-001` | `AR-ROLE-*`,`BR-CHK-*` | `TQR-CHK-*`,`TQR-IDM-*` | Ticket FOR UPDATE + Check-in unique |
| Karaoke Check-in | `FR-STF-*`, `UF-CHK-002` | `AR-ROLE-*`,`BR-CHK-*` | `TQR-CHK-*`,`KRK-CHK-*` | Ticket→Reservation lock + time predicate |
| Slot generation | `FR-KRK-*`,`FR-ADM-*` | `karaoke_slots.manage` | `KRK-GEN-*` | Scope locks + exact unique + GiST |
| Slot / Exclusive Scope read | `FR-ADM-009〜010`, `PG-ADM-007〜009` | `karaoke_slots.manage` | `KRK-SCP-*`,`KRK-EDT-*` | Slot / Scope public_ref lookup, scope usage index |
| Reservation cancellation | related `FR-ADM-*` | explicit recovery auth | `KRK-CAN-*`,`TQR-CAN-*` | Ticket→Reservation lock, Slot remains SOLD |
| Goods Handoff（Staff / Administrator） | `FR-STF-*`,`FR-GDS-*`,`FR-ADM-017` | `goods_handoff.execute` / `goods_handoff.manage` | `BR-GDS-*` | Item→Handoff lock + one-to-one unique |
| Entry Ticket Offering manage | `FR-ADM-014`, `PG-ADM-006` | `entry_sales.manage` | `BR-SAL-*` | Offering FOR UPDATE + capacity CHECK |
| Karaoke Sales Configuration manage | `FR-ADM-015`, `PG-ADM-012` | `karaoke_sales.manage` | `BR-SAL-*` | Configuration FOR UPDATE |
| Admin Goods read / update / inventory adjustment | `FR-ADM-016`, `PG-ADM-013〜014` | `goods_inventory.manage` | `BR-SAL-008` | Goods / Inventory FOR UPDATE + counter CHECK |
| Admin content manage | `FR-ADM-018`, `PG-ADM-018〜020` | `public_content.manage` | `BR-EVT-*` | Publication State conditional update |
| Role Assignment read | `FR-ADM-001`, `PG-ADM-021` | `role_assignment.manage` | - | `ux_role_assignments_profile_role_active` |
| Refund | `FR-ADM-*`,`FR-XFN-*` | `PAY-AZ-*` | `PAY-RFD-*` | Refund unique + Stripe idempotency |
| Checkout Attempt reconcile | `FR-ADM-021`, `UF-XFN-003` | `recovery.exception.execute` | `PAY-CHK-*` | same `(Order, Attempt)` / Stripe key |
| Payment Confirmation reconcile | `FR-ADM-021`, `UF-XFN-003` | `recovery.exception.execute` | `PAY-CFM-*` | payment confirmation lock order + entitlement uniques |
| Refund result reconcile | `FR-ADM-021`, `UF-XFN-003` | `recovery.exception.execute` | `PAY-RFD-*` | Refund Record → Order lock |
| Notification unknown result reconcile | `FR-ADM-021`, `FR-EML-*` | `recovery.exception.execute` | `EML-*` | same Attempt / provider key |
| Consistency Review | `UF-XFN-003`, `FR-ADM-021` | `recovery.review` / `recovery.exception.execute`（resolve） | `PAY-REC-*`,`TQR-REC-*`,`KRK-REC-*` | dedupe_key unique + unresolved index |

全critical mutationは `INV-010-01〜10`、`DI-030-001〜012` の関連Invariantを維持し、DB constraintをapplication-only checkで代替しない。

---

# Part XVIII — Hono Handler / Service / Repository Boundary

## 58. Handler responsibility

Route handlerは次だけを行う。

1. path/query/body Zod parse
2. middlewareで構築済みPrincipal取得
3. request context / idempotency context取得
4. service呼出し
5. Domain result → HTTP response mapping

Handlerへraw SQL、Stripe business orchestration、Role判定を分散させない。

## 59. Service responsibility

Serviceはoperation-specificに:

- authorization precondition再確認
- Domain Rule
- transaction orchestration
- external call分割
- Business Cause idempotency
- consistency review creation

を所有する。

## 60. Repository responsibility

RepositoryはSPEC-100のphysical schema / lock primitiveを明示的に実装する。

例:

```text
acquireEntryAllocationAndCreateOrder()
acquireKaraokeHoldAndCreateOrder()
bindCheckoutAndAwaitPayment()
confirmEntryPurchase()
confirmKaraokePurchase()
confirmGoodsPurchase()
consumeEntryTicket()
consumeKaraokeTicket()
completeGoodsHandoff()
completeAdministrativeGoodsHandoff()
updateEntryOfferingSalesConditions()
updateKaraokeSalesConfiguration()
adjustGoodsInventory()
reconcileCheckoutAttempt()
reconcilePaymentConfirmation()
reconcileRefundResult()
reconcileNotificationUnknownResult()
resolveConsistencyReviewCase()
```

「汎用save(entity)」だけでcritical lock orderingを隠さない。

---

# Part XIX — Acceptance Criteria

## 61. API acceptance

実装は少なくとも次を満たさなければならない。

1. `/api/v1`とnamespaceが一貫している。
2. Hono RPC / Zodを使用し、webhook raw routeをRPCから分離する。
3. Browser / Next.js WebがBusiness DBを直接writeしない。
4. Internal bigint IDをwireへ出さない。
5. Moneyはdecimal string + ISO currency。
6. Protected operationごとにSupabase AuthをServer-side verifyする。
7. owner mismatchとnot foundをself APIで404へ統一する。
8. Staff / AdminはRole + CapabilityをRequestごとに再評価する。
9. Purchase startはClient price / owner / payment resultを信用しない。
10. Stripe network call中にDB transactionをopenしない。
11. Active Checkout最大1件をpartial uniqueとservice logicの両方で守る。
12. Browser ReturnはOrder state readだけでBusiness Confirmation triggerにしない。
13. Webhook raw bodyを保持し署名検証する。
14. Event ID dedupeとcurrent Stripe authority revalidationを行う。
15. Entry / Goods capacityはSPEC-100 row lock / counter constraintを使用する。
16. Karaoke Holdは45分、Payment 30分、Safety Buffer 5分を変更しない。
17. Karaoke overlapはGiST exclusionを必須fallbackとして使用する。
18. cancellation後Slotを`AVAILABLE`へ戻さない。
19. QR Payload `r39x1.ent|krk.<43>`を変更しない。
20. QR lookupはkeyed digestを使用しraw tokenをlogしない。
21. Check-inはTicket row lock + conditional transition + unique Check-inでsingle-useを守る。
22. Check-inをpreview/approveの二段階Client authorityに分けない。
23. Check-in outcome名をSPEC-080からrenameしない。
24. `40001/40P01`だけを標準retryable DB transaction errorとし、constraint violationをblind retryしない。
25. `REVIEW_REQUIRED` / Consistency Reviewを通常成功に見せない。
26. Polling / reloadで新Order / Ticket / Reservation / Handoffを作らない。
27. Transport Idempotency KeyとDomain Business Causeを分離する。
28. Known concurrency loserを500へ一律変換しない。
29. DB outageをempty / sold out / unknown tokenに偽装しない。
30. Critical endpointからRequirement / Rule / Flow / Page / DB primitiveへ追跡可能である。
31. Entry Ticket Offering / Karaoke Sales Configuration mutationはそれぞれ`entry_sales.manage` / `karaoke_sales.manage`をrequired Capabilityとし、`tickets.manage.read` / `karaoke_slots.manage` / `recovery.exception.execute`を代替authorityにしない。
32. Sales configuration mutationはheld + committed counterをClient authorityにせず、capacity / period invariantをserver-sideで再評価する。
33. Admin Sales Configuration operationをSlot individual state editorとして使用しない。
34. `Administrative Handoff Completion`は`goods_handoff.manage`だけを必要とし、`goods_handoff.execute`を借用しない。server current `PENDING` + `FULFILLABLE`の場合だけ一度だけ成立する。
35. Admin Goods Handoffはgeneric state editorを提供せず、direct VOID / undo / reopen / reset / `COMPLETED -> PENDING|VOID`を成立させない。
36. Staff Goods Handoff previewは対象受け渡しに必要な最小情報だけを返し、raw Email / Internal ID / raw QR token / unrelated historyを返さない。
37. 各Admin listは§48.3のallowlist queryだけを受け、任意sort / raw filter / client-side全件filterを提供しない。
38. Admin authoritative readは`DRAFT` / `ARCHIVED` content、current counters、Slot / Scope current stateをPublic APIと区別して返す。
39. 全canonical method / pathはexactly 1つの`API-*` Operation IDを持ち、Log / Audit / MetricがそのIDをexactに参照できる。
40. Recoveryは本仕様§48.5または上流で明示されたoperation-specific commandだけを使用し、generic state mutation / arbitrary SQL / constraint disableを提供しない。
41. Recovery commandはsame Business Cause / Provider keyを維持し、result unknownをsuccessへ変換せず、raw provider bodyを返さない。
42. Notification unknown result reconcileはsame Attempt / provider keyだけを反映し、new provider key / recipient変更 / blind resendを行わない。
43. Consistency Review resolutionはpost-verificationなしのmark-fixedを提供せず、source historyを削除しない。
44. `API-ADM-GDS-005` Inventory adjustmentはClientからreason code / free textを受け取らず、serverがfixed `ADMINISTRATIVE_CAPACITY_ADJUSTMENT`を導出し、same-transaction Audit Eventへsigned adjustment quantity / safe before/after counters / resultと共に永続化する（`SPEC-160 §28.1`, `OBS-GDS-002,004,005`）。

---

# Part XX — 他仕様書との境界

## 62. SPEC-120 Email / Notification

本APIはBusiness Confirmation等のtransaction内または同一commit boundaryで `app.notification_requests` を**同一Business Causeにつき最大1件**作成できる。Email provider、template、delivery attempt、retry schedule、send worker、Admin Notificationの `API-ADM-EML-*` operationはSPEC-120がCanonicalに定義する。`API-ADM-REC-006` はSPEC-120のUnknown Result persistence境界を変更せず、same Attempt / provider keyの結果反映だけを行う。

通知失敗をOrder / Reservation / Ticket確定失敗へ戻してはならない。

## 63. SPEC-130 Admin / Staff

本書はserver operationを定義する。Admin / Staff画面、field配置、operational workflow、Capability表示条件、filter semantics、confirmation / stale / response loss UXはSPEC-130。本書のquery allowlist（§48.3）、Admin Goods Handoff command（§48.4）、recovery command（§48.5）はSPEC-130の§30 / §31 / §32 / §51 / §53〜56をHTTPへ写像し、そのbusiness semanticsを変更しない。

`goods_handoff.manage` / `goods_handoff.execute`、`entry_sales.manage` / `karaoke_sales.manage`、`karaoke_slots.manage`の分離はSPEC-060 / SPEC-130を変更しない。Administrator → Staff inheritanceを作らない。

## 64. SPEC-140 Security

CORS / CSP / CSRF / rate limit / secret controlの最終値はSPEC-140。ただし本書のAuth verification、mass assignment禁止、webhook signature、secret response minimizationを弱化してはならない。Admin content preview / detailはraw HTMLをtrustedとして実行しない。

## 65. SPEC-150 Reliability / Recovery

retry count / backoff / queue / operator RunbookはSPEC-150。本書§48.5はSPEC-150 §45〜§57のoperation-specific precondition / allowed action / forbidden actionをHTTPへ写像し、retryability分類、Business Cause、Consistency Review boundaryを変更しない。Notification retry / cancelはSPEC-120の `API-ADM-EML-004/005` を使用する。

---

## 66. 上流仕様変更要求

本改訂はAPI Canonical Ownerの範囲で、次の既知UCRが要求するcontractをcanonical化した。UCR提案をそのまま実装contractとして採用したのではなく、`SPEC-060` / `SPEC-130` / `SPEC-150` のcanonical semanticsへ接続したcontractとして定義した。

| UCR | 対象 | 本改訂での扱い |
|---|---|---|
| `UCR-130-001` | `SPEC-060` | 前提Capability `entry_sales.manage` / `karaoke_sales.manage` は既存canonical。本書はそのAPI contractを定義 |
| `UCR-130-002` | `SPEC-110` | §48.1 / §48.2 でEntry Ticket Offering / Karaoke Sales Configurationのlist / detail / allowlisted updateをcanonical化 |
| `UCR-130-003` | `SPEC-110` | §40 `API-STF-GDS-002`、§48.4 `API-ADM-HOF-001〜003` でStaff preview / Admin read / explicit completionをcanonical化 |
| `UCR-130-004` | `SPEC-110` | §48.3 でAdmin list query allowlistをcanonical化 |
| `UCR-130-006` | `SPEC-110` | §41 / §46〜§48 でmissing Admin read（Slot / Scope / Goods / Event / FAQ / Announcement）をcanonical化 |
| `UCR-150-001` | `SPEC-110` | §48.5 `API-ADM-REC-003〜007` でoperation-specific recovery commandをcanonical化 |
| `UCR-170-001` | `SPEC-110` | §41 / §46〜§48 の全canonical routeへ一意な`API-*` Operation IDを付与 |

以下は本仕様のAPI contract範囲外であり、要求元仕様の改訂で扱う。

- `UCR-130-005`（operational index）: `SPEC-100` のCanonical Owner範囲。本書§48.3のquery contractを前提に、実query plan / selectivityの証拠後に判断する。
- `UCR-150-002`（recovery page wiring）: `SPEC-130` のCanonical Owner範囲。§48.5のoperationがCanonical化された後、`SPEC-130` がcurrent precondition / capability / confirmation付きで接続する。

本書作成時点で、必須上流仕様間にSPEC-110が解消不能な矛盾は確認されなかった。

### 未反映のUCR（`SPEC-050` v1.1.0 / `SPEC-030` v1.1.0 に伴う要求）

以下は本書へ未反映の上流仕様変更要求であり、`DEV-GEN-001` に従い、本書のCanonical Owner本文へ反映されるまで実装契約として扱わない。

### UCR-110-001

- 対象: SPEC-110（関連: SPEC-100）
- 現在の仕様: 次の項目が定義されていない。
  1. Cartからの購入開始（複数Item、All-or-Nothing、不成立Itemの識別、Purposeの `ENTRY_GOODS_PURCHASE` を含む決定）。`API-PUR-ENTRY-001` と `API-PUR-GDS-001` はそれぞれ1 ItemのRequestだけを受ける。
  2. `API-ORD-003` の `purpose` に `ENTRY_GOODS_PURCHASE`（`SPEC-030` §11.2）がない。
  3. Sponsor Logoの公開取得（`SPEC-030` §8.4、`FR-PUB-015`）。
  4. 認証済み閲覧者ごとのPurchase Limit到達（`SPEC-050` §12.1 / §13.3 / §14A.1 が購入不可として表示するため）。
  5. `API-ORD-003` のNotification通知表示（`SPEC-050` §16.2 / §16.7）。
- 要求する変更: 上記を、Operation IDまたは既存Operationの応答fieldとして定義する。1〜3は `SPEC-030` §26.1 が下流整合事項として既に挙げている。
- 理由: `SPEC-050` v1.1.0 と `SPEC-030` v1.1.0 の要件をAPIで満たすため。
- 変更しない場合の影響: UI mockのportのうち該当methodを実api-clientへ置き換えられない。UI mockは該当methodを「Operation IDなし」と明示して実装する。
- 影響を受ける可能性がある仕様書: SPEC-100, SPEC-120, SPEC-130, SPEC-170
