---
spec_id: SPEC-110
title: API Specification
version: 1.0.0
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
- Staff Goods Handoff
- Administrator read / manage API
- Refund / QR token rotation / consistency review等、上流で既に要求済みのoperation boundary

CORS、CSRF、CSP、rate limit、secret rotationの最終Control値は `SPEC-140`、retry回数 / backoff / Recovery Runbookは `SPEC-150`、Audit event schemaは `SPEC-160` がCanonical Ownerである。

---

## 3. 依存仕様

本書はFrontmatter記載の `SPEC-000`〜`SPEC-100` 全てを直接依存とする。理由は、API contractがSystem Boundary、Requirement、Domain State、User Flow、Page、Auth、Payment、QR、Karaoke、DB transactionを同一server operationへ接続するCanonical Ownerだからである。

上流矛盾は確認されなかったため、本書にUpstream Change Requestは存在しない。

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

- Order / Ticket / Reservation / Goods purchase: `created_at DESC, public_ref DESC`
- Announcement: `published_at DESC, public_ref DESC`
- Karaoke Slot schedule: `usage_start ASC, public_ref ASC`
- Admin review queue: `opened_at ASC, public_ref ASC`

filterはallowlist query parameterだけを受け、任意column名、raw SQL、client sort expressionは受けない。

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
    admin-goods.ts
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
- QR token rotation
- slot generation
- slot state/edit mutation
- goods handoff completion
- role assignment mutation

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
| `API-PUB-001` | `GET /public/event` | Event公開情報 | `FR-PUB-001〜004`, `PG-PUB-001`, `DB-SAL-001` |
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

### API-KRK-SELF-004 — Reservation cancellation boundary

Customer自己取消Capabilityは `SPEC-090 KRK-CAN-001` で追加されていないため、**self cancellation endpointは定義しない**。Administrator / authorized Recoveryのみsection 43の明示operationを使用する。

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

### API-STF-GDS-001 — Complete Goods Handoff

- **Method:** `POST`
- **Path:** `/api/v1/staff/goods-handoffs/{goods_item_ref}/complete`
- **Capability:** `goods_handoff.execute`
- **DB:** Goods Order Item → Handoff `FOR UPDATE`; precondition item=`FULFILLABLE`, handoff=`PENDING`; conditional `PENDING -> COMPLETED`。
- **Constraint:** one Handoff unique。
- **Replay:** already `COMPLETED`なら200 existing completion summary。2件目を作らない。
- **Conflict:** `VOID` / non-fulfillableは409。

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
| `API-ADM-KRK-002` | `GET /admin/karaoke/reservations/{reservation_ref}` | same |
| `API-ADM-GDS-001` | `GET /admin/goods/inventory` | `goods_inventory.manage` |
| `API-ADM-REC-001` | `GET /admin/consistency-reviews` | `recovery.review` |
| `API-ADM-REC-002` | `GET /admin/consistency-reviews/{case_ref}` | `recovery.review` |

Admin responseもInternal PK、QR raw token、Stripe secretを返さない。必要なprovider referenceはallowlisted masked / public operational identifiersだけ。

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

Capabilities `public_content.manage`。

- `POST /admin/announcements`
- `PATCH /admin/announcements/{announcement_ref}`
- `POST /admin/announcements/{announcement_ref}/publish`
- `POST /admin/announcements/{announcement_ref}/archive`
- FAQ同等operation
- Event public fields `PATCH /admin/event`

Publication Stateは`DRAFT/PUBLISHED/ARCHIVED`を上流どおり使用する。mass assignment禁止。

## 47. Goods inventory manage

Capability `goods_inventory.manage`。

- `GET /admin/goods`
- `PATCH /admin/goods/{goods_ref}` allowlisted public/sales fields
- `POST /admin/goods/{goods_ref}/inventory-adjustments`

Inventory mutationはcurrent counterをDB row lock下で再評価し、既存Allocation / committed saleを破壊する負数調整を拒否する。具体的Admin UXはSPEC-130。

## 48. Role Assignment manage

Capability `role_assignment.manage`。

- `GET /admin/role-assignments`
- `POST /admin/role-assignments`
- `POST /admin/role-assignments/{role_assignment_ref}/deactivate`

Bodyはtarget profile public ref + canonical role `STAFF|ADMINISTRATOR`だけ。Client permission unionは受けない。

DB: target assignment `FOR UPDATE`; Administrator set変更時はSPEC-100のadvisory lock; active partial unique。last-administrator protection等 `AR-ROLE-*` を維持する。

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
| Goods Handoff | 1:1 Handoff + conditional `PENDING -> COMPLETED` | existing completion reuse |
| Refund | Refund Record + Stripe idempotency + live full partial unique | same refund recovery |
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
| Public Event | `FR-PUB-*`, `UF-PUB-001`, `PG-PUB-*` | `BR-EVT-*` | - | `DB-SAL-001`, published indexes |
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
| Reservation cancellation | related `FR-ADM-*` | explicit recovery auth | `KRK-CAN-*`,`TQR-CAN-*` | Ticket→Reservation lock, Slot remains SOLD |
| Goods Handoff | `FR-STF-*`,`FR-GDS-*` | `goods_handoff.execute` | `BR-GDS-*` | Item→Handoff lock + one-to-one unique |
| Refund | `FR-ADM-*`,`FR-XFN-*` | `PAY-AZ-*` | `PAY-RFD-*` | Refund unique + Stripe idempotency |
| Consistency Review | `UF-XFN-003` | `recovery.review` | `PAY-REC-*`,`TQR-REC-*`,`KRK-REC-*` | dedupe_key unique + unresolved index |

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

---

# Part XX — 他仕様書との境界

## 62. SPEC-120 Email / Notification

本APIはBusiness Confirmation等のtransaction内または同一commit boundaryで `app.notification_requests` を**同一Business Causeにつき最大1件**作成できる。Email provider、template、delivery attempt、retry schedule、send worker/APIはSPEC-120がCanonicalに定義する。

通知失敗をOrder / Reservation / Ticket確定失敗へ戻してはならない。

## 63. SPEC-130 Admin / Staff

本書はserver operationを定義する。Admin / Staff画面、field配置、operational workflowはSPEC-130。

## 64. SPEC-140 Security

CORS / CSP / CSRF / rate limit / secret controlの最終値はSPEC-140。ただし本書のAuth verification、mass assignment禁止、webhook signature、secret response minimizationを弱化してはならない。

## 65. SPEC-150 Reliability / Recovery

retry count / backoff / queue / operator RunbookはSPEC-150。本書のretryability分類、Business Cause、Consistency Review boundaryを変更してはならない。

---

## 66. 上流仕様変更要求

なし。

本書作成時点で、必須上流仕様間にSPEC-110が解消不能な矛盾は確認されなかった。
