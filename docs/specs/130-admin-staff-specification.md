---
spec_id: SPEC-130
title: Admin and Staff Specification
version: 1.0.0
status: provisional
depends_on:
  - SPEC-000
  - SPEC-020
  - SPEC-030
  - SPEC-060
  - SPEC-070
  - SPEC-080
  - SPEC-090
  - SPEC-100
  - SPEC-110
  - SPEC-120
related_specs:
  - SPEC-010
  - SPEC-040
  - SPEC-050
  - SPEC-140
  - SPEC-150
  - SPEC-160
  - SPEC-170
  - SPEC-180
  - SPEC-200
---

# 130 Admin / Staff Specification

## 1. 目的

本書は、**off r39'x in 大阪らへん2027** Webシステムの完成形におけるAdministrator / Staff向けWeb UI、Page / Route、Navigation、Role / Capability別の表示・操作境界、運用検索・Filter・一覧・詳細、確認Dialog、状態表示、失敗・retry・recovery導線を定義する。

本書は **Administrator / Staffの運用画面・操作フロー・運用上の画面契約のCanonical Owner** である。

本書は、上流Canonical Ownerが既に定義した以下を変更しない。

- Domain Entity / State / Business Rule
- Authentication / Authorization / Role / Capability
- Stripe Payment / Refund lifecycle
- Ticket / QR / Check-in outcome
- Karaoke Slot / Hold / Reservation rule
- Business Database physical schema / constraint / transaction primitive
- Hono API endpoint / request / response / error contract
- Notification Request / Email delivery processing state

本書がCanonicalに決定するのは、既存server operationをAdministrator / Staffが安全に利用するためのPage構成、Route、画面状態、表示Field、Filter、Action availability、確認・結果表示、再読込・競合・障害時のUXである。

本書はMVP、Step1、Step2等の実装フェーズで仕様を分断しない。長期運用される完成システムを対象とする。

---

## 2. 適用範囲

本書は次の運用領域へ適用する。

### 2.1 Administrator

- Admin Dashboard / operational overview
- Order list / detail
- Payment / Refund状態確認
- full Refund request
- Entry Ticket list / detail
- QR token rotation recovery
- Entry Ticket販売条件管理
- Karaoke Slot schedule / generation / edit / sales stop / resume
- Karaoke販売条件管理
- Karaoke Reservation list / detail / Normal Cancellation recovery
- Goods list / detail / sales configuration / Inventory
- Goods Handoff状態確認・許可されたAdministrator operation
- Event public information / FAQ / Announcement管理
- Role Assignment管理
- Consistency Review list / detail
- Email Notification list / detail / delivery attempts / retry / cancel

### 2.2 Staff

- Staff landing
- Entry QR scan / manual scanner input / result
- Karaoke QR scan / manual scanner input / result
- Goods Handoff target resolution / completion / result

### 2.3 本書が定義しないもの

- 一般利用者向けPage / Route: `SPEC-050`
- Capabilityそのもの: `SPEC-060`
- Payment / Refundの状態遷移: `SPEC-070`
- QR Payload / Check-in atomicity: `SPEC-080`
- Karaoke Slot / ReservationのDomain rule: `SPEC-090`
- DB table / column / index: `SPEC-100`
- API endpoint / HTTP status / Zod schema: `SPEC-110`
- Email worker / template / retry algorithm: `SPEC-120`
- CSRF / CSP / secret storage / session securityの最終control: `SPEC-140`
- 共通retry回数 / backoff / Runbook: `SPEC-150`
- Audit Event schema / log retention: `SPEC-160`
- Test case catalog: `SPEC-170`
- Hosting / deployment / secret配置: `SPEC-180`

---

## 3. 依存仕様とCanonical Owner境界

本書は次へ直接依存する。

| Spec | 本書が直接利用するCanonical contract |
|---|---|
| `SPEC-000` | Canonical Owner、`depends_on`、Upstream Change Request、1ファイル1チャット、正式仕様と実装範囲の分離 |
| `SPEC-020` | `FR-ADM-001〜022`、`FR-STF-001〜016`、関連 `FR-*` |
| `SPEC-030` | Domain State、Publication State、Goods Handoff、Consistency Review、`BR-*`、`DI-030-*` |
| `SPEC-060` | Authentication / Authorization、Operational Role、Capability Matrix、Staff最小Customer情報、Role Assignment rule |
| `SPEC-070` | Order / Payment / Refund、full refund only、provider result unknown、`PAY-*` |
| `SPEC-080` | Ticket / QR / Check-in outcome、QR rotation、Staff受付情報境界、`TQR-*` |
| `SPEC-090` | Karaoke Slot / Reservation / Normal Cancellation / no resale / check-in window、`KRK-*` |
| `SPEC-100` | Public Reference、physical state、index / transaction / lock / constraint primitive、`DB-*` |
| `SPEC-110` | `/api/v1`、`admin/staff` namespace、server operation、cursor pagination、error contract、`API-*` |
| `SPEC-120` | Notification Domain State、Processing State、Admin notification API、retry / cancel rule、`EML-*` |

`SPEC-010`, `SPEC-040`, `SPEC-050` はSystem Invariant / User Flow / 一般利用者Page境界のTraceability上強く関連するが、本書の入力として直接再定義しないため `related_specs` とする。

### 3.1 上流不足の扱い

本書作成時点で、`SPEC-020` / `SPEC-060` が要求する一部Administrator / Staff UIを完成させるために必要なserver operationまたはquery contractが `SPEC-110` に十分定義されていない領域を確認した。

本書はその不足を画面都合で別endpointとして発明しない。第36章のUpstream Change Requestに記録し、対象UCRがCanonical upstreamへ反映されるまで、該当mutation / previewを実装済みとして扱ってはならない。

---

## 4. Canonical Terms

| Term | 本書での意味 |
|---|---|
| Admin Shell | `/admin/*` 共通Navigation / guard / operational layout |
| Staff Shell | `/staff/*` 共通Navigation / guard / scan-oriented layout |
| Operational Summary | raw provider payloadやInternal IDを含まない、運用判断に必要なallowlisted情報 |
| Source Current State | mutation直前にHono API / Business Databaseから再取得・再検証された現在状態 |
| Action Eligibility | Role / Capabilityだけでなくcurrent Domain state、provider state、consistency stateを含む操作可否 |
| High-risk Action | Refund、Reservation cancellation、QR rotation、Inventory adjustment、Role mutation、Notification retry/cancel等の誤操作・外部side effect影響が大きい操作 |
| Pending Result | server operationは受理されたが外部Providerまたはworkerの最終結果が未確定の状態 |
| Unknown Result | Provider callの結果を安全に成功/失敗へ分類できない状態。成功表示してはならない |
| Conflict Loser | 並行処理でcurrent state preconditionを失い、Domain effectを得なかった要求 |
| Access Denied State | Authenticationは成立したがrequired Role / Capabilityがないため、protected dataを表示しない画面状態 |
| Minimal Staff Data | 受付・Handoff対象の判定に必要な範囲だけのCustomer関連情報 |
| Operational Public Reference | Admin / Staff URL・表示・入力で使用可能なUUID Public Reference。Internal bigint IDではない |

---

## 5. Rule ID体系

本書のNormative Ruleは次のPrefixを使用する。

| Prefix | Category |
|---|---|
| `ADM-ROU-*` | Route / Navigation / guard |
| `ADM-UI-*` | Admin共通画面contract |
| `ADM-DASH-*` | Dashboard |
| `ADM-ORD-*` | Order / Payment / Refund |
| `ADM-TKT-*` | Entry Ticket / QR recovery |
| `ADM-KRK-*` | Karaoke Slot / Reservation |
| `ADM-GDS-*` | Goods / Inventory / Handoff |
| `ADM-CNT-*` | Public Content |
| `ADM-ROL-*` | Role Assignment |
| `ADM-REC-*` | Consistency Review / Recovery |
| `ADM-EML-*` | Email Notification operation |
| `STF-ROU-*` | Staff route / navigation |
| `STF-CHK-*` | Entry / Karaoke scan UX |
| `STF-GDS-*` | Staff Goods Handoff |
| `OPS-LST-*` | Search / Filter / Pagination |
| `OPS-ACT-*` | High-risk action / confirmation |
| `OPS-ERR-*` | Error / failure UX |
| `OPS-SEC-*` | Admin / Staff UI security/privacy boundary |
| `OPS-AUD-*` | Audit readiness |

同一Rule IDを別の意味へ再利用してはならない。

---

# Part I — Route / Role / Navigation

## 6. Canonical Route Namespace

AdministratorとStaffのRoute namespaceを次とする。

```text
/admin/*
/staff/*
```

一般利用者Pageと同一namespaceへ混在させない。

**ADM-ROU-001:** Administrator Pageは `/admin/*` に配置し、一般Customer向け `/mypage/*` や公開RouteをAdmin mutation UIへ流用しない。

**STF-ROU-001:** Staff Pageは `/staff/*` に配置し、Admin Pageへ受付UIを混在させない。

**ADM-ROU-002:** URLへInternal bigint ID、Stripe secret identifier、QR raw token、Resend secret、Supabase credentialを含めてはならない。Entity detail routeはPublic Referenceだけを使用する。

## 7. Authentication / Authorization guard

保護PageはServer-sideで現在のSession / Principalを確認し、Navigation補助として `GET /api/v1/self/principal` のallowlisted capability情報を利用してよい。

ただしPage guardは最終Authorization boundaryではない。

**ADM-ROU-003:** Admin mutation / readは各Hono APIがRequestごとにactive `ADMINISTRATOR` Role + required Capabilityを再評価しなければならない。

**STF-ROU-002:** Staff mutationは各Hono APIがRequestごとにactive `STAFF` Role + required Capabilityを再評価しなければならない。

**ADM-ROU-004:** `ADMINISTRATOR` は `STAFF` を自動継承しない。Administratorだけを持つActorへEntry / Karaoke Check-inまたはStaff Goods Handoff navigationを表示しない。

**STF-ROU-003:** 同一Actorが `STAFF` と `ADMINISTRATOR` の両Roleを持つ場合は両Shellへ移動できるが、各ActionはそのnamespaceのCapabilityで独立評価する。

## 8. RoleなしActorがURLを直接入力した場合

### 8.1 未認証

未認証Actorが `/admin/*` または `/staff/*` を直接入力した場合:

1. protected dataを取得しない。
2. `SPEC-060` のAuthentication Gateへ遷移する。
3. Continuation Intentは同一originの安全なpathだけを保持する。
4. login成功後もRole / Capabilityを再評価する。
5. required Roleがなければ元protected pageへ入れない。

### 8.2 認証済みだがRole / Capability不足

- Admin: `PG-ADM-026` `/admin/access-denied`
- Staff: `PG-STF-008` `/staff/access-denied`

へ遷移する。

Access Denied画面は対象resourceの存在、件数、Customer情報、provider referenceを表示しない。

**ADM-ROU-005:** Role不足を404 data page、empty list、0件Dashboardへ偽装しない。

**STF-ROU-004:** Role不足をQR invalid outcomeへ変換しない。`AUTHORIZATION_DENIED` とTicket/QRの業務結果は別物である。

## 9. Admin Navigation

Admin ShellのPrimary Navigationは次の順序とする。

1. Overview
2. Orders
3. Entry Tickets
4. Karaoke
5. Goods
6. Public Content
7. Role Assignments
8. Consistency Reviews
9. Notifications

Navigation itemは対応Capabilityがない場合は非表示とする。ただし非表示はauthorizationの代替ではない。

| Navigation | Capability |
|---|---|
| Overview | active `ADMINISTRATOR` + 少なくとも1 Admin capability |
| Orders | `orders.manage.read` |
| Entry Tickets | `tickets.manage.read` |
| Karaoke Slots | `karaoke_slots.manage` |
| Karaoke Reservations | `karaoke_reservations.manage.read` |
| Goods | `goods_inventory.manage` または `goods_handoff.manage` |
| Public Content | `public_content.manage` |
| Role Assignments | `role_assignment.manage` |
| Consistency Reviews | `recovery.review` |
| Notifications | `recovery.review` |

`recovery.exception.execute` はNavigation categoryを単独で作らない。各明示Recovery Actionの中でのみ利用する。

## 10. Staff Navigation

Staff Shellは操作速度を優先し、Primary Navigationを次の4項目とする。

1. Staff Home
2. Entry Check-in
3. Karaoke Check-in
4. Goods Handoff

対応Capabilityがない項目は非表示とする。

**STF-ROU-005:** Staff ShellにOrder管理、Customer履歴検索、Role管理、Refund、Notification recovery、Public Content管理へのNavigationを出さない。

---

# Part II — Page Catalog

## 11. Administrator Page Catalog

| Page ID | Route | Primary Actor | Required Role / Capability | Purpose |
|---|---|---|---|---|
| `PG-ADM-001` | `/admin` | Administrator | `ADMINISTRATOR` | Operational overview |
| `PG-ADM-002` | `/admin/orders` | Administrator | `orders.manage.read` | Order list / filter |
| `PG-ADM-003` | `/admin/orders/{order_ref}` | Administrator | `orders.manage.read` | Order / Payment / Refund detail |
| `PG-ADM-004` | `/admin/entry-tickets` | Administrator | `tickets.manage.read` | Entry Ticket list |
| `PG-ADM-005` | `/admin/entry-tickets/{ticket_ref}` | Administrator | `tickets.manage.read` | Ticket / Check-in / QR operational detail |
| `PG-ADM-006` | `/admin/sales/entry` | Administrator | management capability per UCR-130-001 | Entry Ticket Offering sales configuration |
| `PG-ADM-007` | `/admin/karaoke/slots` | Administrator | `karaoke_slots.manage` | Slot schedule / list |
| `PG-ADM-008` | `/admin/karaoke/slots/generate` | Administrator | `karaoke_slots.manage` | Slot batch generation |
| `PG-ADM-009` | `/admin/karaoke/slots/{slot_ref}` | Administrator | `karaoke_slots.manage` | Slot detail / edit / stop / resume |
| `PG-ADM-010` | `/admin/karaoke/reservations` | Administrator | `karaoke_reservations.manage.read` | Reservation list |
| `PG-ADM-011` | `/admin/karaoke/reservations/{reservation_ref}` | Administrator | `karaoke_reservations.manage.read` | Reservation detail / allowed recovery |
| `PG-ADM-012` | `/admin/sales/karaoke` | Administrator | management capability per UCR-130-001 | Karaoke sales configuration |
| `PG-ADM-013` | `/admin/goods` | Administrator | `goods_inventory.manage` | Goods / Inventory list |
| `PG-ADM-014` | `/admin/goods/{goods_ref}` | Administrator | `goods_inventory.manage` | Goods detail / inventory adjustment |
| `PG-ADM-015` | `/admin/goods-handoffs` | Administrator | `goods_handoff.manage` | Handoff list / status |
| `PG-ADM-016` | `/admin/goods-handoffs/{handoff_ref}` | Administrator | `goods_handoff.manage` | Handoff detail / permitted admin operation |
| `PG-ADM-017` | `/admin/content` | Administrator | `public_content.manage` | Content management landing |
| `PG-ADM-018` | `/admin/content/event` | Administrator | `public_content.manage` | Event public fields |
| `PG-ADM-019` | `/admin/content/faqs` | Administrator | `public_content.manage` | FAQ list / edit |
| `PG-ADM-020` | `/admin/content/announcements` | Administrator | `public_content.manage` | Announcement list / edit |
| `PG-ADM-021` | `/admin/role-assignments` | Administrator | `role_assignment.manage` | Assignment list / grant / revoke |
| `PG-ADM-022` | `/admin/consistency-reviews` | Administrator | `recovery.review` | unresolved review list |
| `PG-ADM-023` | `/admin/consistency-reviews/{case_ref}` | Administrator | `recovery.review` | review detail / explicit recovery links |
| `PG-ADM-024` | `/admin/notifications` | Administrator | `recovery.review` | Notification list |
| `PG-ADM-025` | `/admin/notifications/{notification_ref}` | Administrator | `recovery.review` | Notification detail / attempts / recovery |
| `PG-ADM-026` | `/admin/access-denied` | Authenticated User | none | Admin access denied |

`PG-ADM-006`, `PG-ADM-012`, `PG-ADM-015`, `PG-ADM-016` は上流API不足を第36章UCRへ記録する。Page contract自体は完成システムの必要画面として本書が所有するが、UCR解決前にBrowserからDBへ直接アクセスして穴埋めしてはならない。

## 12. Staff Page Catalog

| Page ID | Route | Primary Actor | Required Role / Capability | Purpose |
|---|---|---|---|---|
| `PG-STF-001` | `/staff` | Staff | active `STAFF` | Staff landing |
| `PG-STF-002` | `/staff/check-in/entry` | Staff | `entry_checkin.execute` | Entry scan / manual input |
| `PG-STF-003` | `/staff/check-in/entry/result` | Staff | `entry_checkin.execute` | Entry result |
| `PG-STF-004` | `/staff/check-in/karaoke` | Staff | `karaoke_checkin.execute` | Karaoke scan / manual input |
| `PG-STF-005` | `/staff/check-in/karaoke/result` | Staff | `karaoke_checkin.execute` | Karaoke result |
| `PG-STF-006` | `/staff/goods-handoff` | Staff | `goods_handoff.execute` | Handoff target / confirmation |
| `PG-STF-007` | `/staff/goods-handoff/result` | Staff | `goods_handoff.execute` | Handoff completion result |
| `PG-STF-008` | `/staff/access-denied` | Authenticated User | none | Staff access denied |

Result routeへQR raw tokenをquery / path / persisted URL stateとして載せてはならない。Result dataは直前API responseのtransient view stateとして扱い、refresh時は対応scan / handoff start pageへ戻す。

---

# Part III — Common Admin UI Contract

## 13. Admin Shell state

各Admin Pageは最低限次の状態を区別する。

| UI State | Meaning | Required behavior |
|---|---|---|
| `LOADING` | 初回 / filter変更後のread中 | stale mutation buttonを有効化しない |
| `READY` | current data取得成功 | current stateに応じてaction評価 |
| `EMPTY` | resource collection自体が0件 | 正常な0件として表示 |
| `NO_RESULTS` | filter条件に一致0件 | Filter解除導線を表示 |
| `PENDING` | server / provider / worker最終結果待ち | successと表示しない |
| `BLOCKED` | current state / processing support stateによりaction不可 | reasonと必要な次Actionを表示 |
| `REVIEW` | Consistency Reviewが必要 | 通常成功へ混ぜない |
| `ERROR_RETRYABLE` | DB / Auth / provider一時障害 | retry / reload導線 |
| `ERROR_TERMINAL` | validation / permission / terminal conflict | retry連打を促さず理由表示 |

**ADM-UI-001:** `503` / DB failure / Auth Service failureを `EMPTY` または `NO_RESULTS` へ変換してはならない。

**ADM-UI-002:** API responseがcurrent stateを返した場合、Browser側cache値よりserver responseを優先する。

**ADM-UI-003:** mutation成功後は対象detailまたはlistをrevalidateし、Client側でDomain Stateを推測して書き換えない。

## 14. Detail Page common layout

Admin detail Pageは原則次のsection順を使用する。

1. Resource Header
   - resource type
   - Public Reference
   - canonical state
   - primary timestamps
2. Operational Summary
3. Related Resources
4. Provider / external correlation summary where allowed
5. History / attempts / check-in / handoff summary
6. Available Actions
7. Review / failure panel when applicable

Internal bigint IDは表示しない。

**ADM-UI-004:** Related resource linkはPublic Reference routeへ遷移し、Database foreign key値をURLへ出さない。

## 15. Common mutation sequence

高リスクか否かを問わず、stateful mutationは次を共通とする。

1. Button click時点でlocal displayed stateを確認。
2. 必要なconfirmationを表示。
3. submit直前に対象resource detailを再取得するか、API側のcurrent state validationを必ず前提にする。
4. mutation requestを1回送る。
5. submit中は同Actionのduplicate clickを抑止する。
6. responseをcanonical outcome / error codeとして解釈する。
7. success / scheduled / pending / unknown / conflict / deniedを区別する。
8. current detailを再取得する。

UI側でstate transitionを先行確定するoptimistic mutationは、Refund、Reservation cancellation、QR rotation、Inventory adjustment、Slot mutation、Role mutation、Notification retry/cancelには使用しない。

---

# Part IV — Administrator Dashboard

## 16. `PG-ADM-001` Admin Dashboard

### 16.1 Entry condition

- verified session
- active `ADMINISTRATOR`
- 少なくとも1つのAdmin capability

### 16.2 Dashboard方針

Dashboardは運用入口であり、Observability metric dashboardではない。`SPEC-160` が所有するmetrics / alerts / logsを先取りしない。

`SPEC-110` に全体集計専用endpointが存在しないため、Dashboardは既存list APIの小さなpreview requestから **attention presence** を構成し、正確な全件countを捏造しない。

各previewは `limit` を小さくして取得し、`has_more=true` の場合は「複数件あり」と表示して対象listへ遷移する。総件数をClientで全pagination走査して算出しない。

### 16.3 Dashboard cards

Capabilityに応じて次を表示する。

| Card | Data source | Display |
|---|---|---|
| Orders requiring review | `API-ADM-ORD-001` のreview filter（UCR-130-004 query contract） | なし / あり / 複数あり |
| Recent confirmed orders | `API-ADM-ORD-001` | recent preview |
| Upcoming Karaoke | `API-ADM-KRK-001` + Slot page read contract | upcoming preview |
| Pending Goods Handoff | Admin Handoff read contract（UCR-130-003） | pending presence |
| Consistency Reviews | `API-ADM-REC-001` | unresolved presence |
| Failed / blocked notifications | `API-ADM-EML-001` | `FAILED_RETRYABLE`, `BLOCKED`, `UNKNOWN_RESULT` presence |

### 16.4 Failure

Dashboardはcard単位でpartial failureを区別してよい。ただし取得失敗cardを0件表示にしない。

**ADM-DASH-001:** Dashboardに表示される数値はserver responseが明示的に総件数を返す場合だけexact countとして表示する。そうでなければpresence / previewで表現する。

**ADM-DASH-002:** `REVIEW_REQUIRED`, Consistency Review, Notification `UNKNOWN_RESULT` を通常成功cardへ混ぜない。

---

# Part V — Order / Payment / Refund Operation

## 17. `PG-ADM-002` Order List

### 17.1 Visible fields

各rowは少なくとも次を表示する。

- `order_ref`
- Order Purpose
- Order State
- created time
- confirmed time where applicable
- amount / currency
- Customer operational summary
- Refund Record presence / state summary
- Consistency Review indication when applicable

Customer operational summaryは、運用に必要な識別用表示だけとし、Staff向け境界とは異なるAdmin用summaryとして扱う。Password、Auth credential、全履歴をrow内に展開しない。

### 17.2 Actions

List rowから許可するActionはdetail遷移のみとする。Refundをlist rowの1-click actionにしない。

### 17.3 Empty / no-result

- `EMPTY`: Orderが存在しない。
- `NO_RESULTS`: Filter条件に一致しない。
- read failure: retryable error panel。

**ADM-ORD-001:** Order Stateを任意select boxで直接変更するgeneric state editorを作らない。

## 18. `PG-ADM-003` Order Detail

### 18.1 API mapping

- read: `API-ADM-ORD-002` `GET /api/v1/admin/orders/{order_ref}`
- full refund: `API-ADM-PAY-001` `POST /api/v1/admin/orders/{order_ref}/refund`

### 18.2 Main sections

1. Order
   - public ref
   - purpose
   - state
   - created / confirmed / terminal time
   - amount / currency
2. Customer
   - allowlisted operational profile summary
3. Purchase Items
   - item name snapshot
   - quantity
   - unit / line amount where returned by API
4. Payment
   - allowlisted Checkout / Payment correlation summary
   - payment completion time
   - receipt availability
   - provider result state
5. Entitlements
   - related Entry Tickets, Karaoke Reservation / Ticket, Goods Order Item / Handoff public refs and current states
6. Refund
   - Refund Record state
   - requested / provider update / success / failed timestamps
7. Review
   - `REVIEW_REQUIRED` or related Consistency Review indication
8. Actions

### 18.3 Refund eligibility display

Refund button is visible only when Actor has `recovery.exception.execute` and Order purpose/state could be refund-eligible. Button enabled判定はUIのbest-effortであり、最終判定はAPIで行う。

最低限、UIは次の場合にdisabledまたはhiddenとする。

- Order != `CONFIRMED`
- existing full Refund `SUCCEEDED`
- live Refund `REQUESTED|PENDING|REVIEW_REQUIRED`
- used Entry Ticketが確認済み
- used Karaoke Ticketが確認済み
- completed Goods Handoffが確認済み
- unresolved consistency issueが表示済み

UIがeligibleと表示していてもsubmit時にserver precondition failureになり得る。

## 19. Full Refund Action

### 19.1 Confirmation Dialog

Dialogは次を表示する。

- Action: Full Refund
- Order Public Reference
- Order Purpose
- current Order State
- full refund amount / currency（server read値）
- 現在のRefund state
- cancellation対象となり得るentitlement summary
- 「partial amountは指定できない」こと
- 「Stripe結果が不明な場合は成功表示しない」こと
- 「Financial RefundとDomain cancellationは別であり、後段不整合はConsistency Reviewになる」こと

free-form amount inputを提供しない。

### 19.2 Submit

- `Idempotency-Key` 必須
- reasonはAPI allowlistから選択する
- submit中duplicate click禁止
- current stateをAPIが再検証

### 19.3 Result mapping

| Result | UI |
|---|---|
| Refund `REQUESTED` | 「返金要求を記録」しfinal success扱いしない |
| Refund `PENDING` | 「Stripe結果待ち」 |
| Refund `SUCCEEDED` | Financial refund成功。Domain cancellation結果も別表示 |
| Refund `FAILED` | 返金未成立。再操作可否はcurrent state再取得後に判定 |
| Refund `REVIEW_REQUIRED` | Provider result unknown / correlation issueとしてReview表示 |
| `409 STATE_CONFLICT` | stale state。detail再読込 |
| `409 CONSISTENCY_REVIEW_REQUIRED` | Reviewへ誘導 |
| `424 STRIPE_TEMPORARY_FAILURE` | 未確定結果を成功にせず、同Business Causeの状態確認へ |
| `503 DATABASE_TEMPORARY_FAILURE` | transaction resultを推測せず再読込 |

**ADM-ORD-002:** `REQUESTED`, `PENDING`, `REVIEW_REQUIRED` を「返金済み」に表示しない。

**ADM-ORD-003:** Provider call result unknown時に新しいRefund requestを別Idempotency-Keyで作るよう促さない。

**ADM-ORD-004:** `orders.manage.read` だけを持つAdministratorへRefund buttonを表示しない。

Trace: `FR-ADM-002〜006,019〜022`, `PAY-RFD-001〜007`, `PAY-AZ-006〜007`, `API-ADM-ORD-001〜002`, `API-ADM-PAY-001`, `DB-PAY-*`, `INV-010-01,07,08,10`.

---

# Part VI — Entry Ticket Operation

## 20. `PG-ADM-004` Entry Ticket List

### 20.1 Visible fields

- `ticket_ref`
- Ticket State
- offering summary
- owner / Customer operational summary
- related `order_ref`
- issued time
- validity period if configured
- Check-in status
- check-in time when used
- QR status summary (`ACTIVE_TOKEN_PRESENT`, `NO_ACTIVE_TOKEN`, `REVOKED_HISTORY_PRESENT`等、raw tokenを含まない)

QR status summaryの具体response field追加が必要な場合は `SPEC-110` のallowlisted response追加として扱い、本書からDBを直接読まない。

### 20.2 Actions

- detailへ遷移
- listからQR rotationを直接実行しない

## 21. `PG-ADM-005` Entry Ticket Detail

### 21.1 API mapping

- read: `API-ADM-TKT-002`
- rotation: `API-ADM-TQR-001`

### 21.2 Main sections

1. Ticket public ref / State / issued time
2. Owner summary
3. Related Order / Offering
4. Check-in
   - used / unused
   - checked-in time
   - Staff operational reference if returned safely
5. QR operational summary
   - active token exists
   - revoked historical token exists
   - last rotation time if available
   - raw token / encrypted material / digestは非表示
6. Recovery Action

## 22. QR Token Rotation Recovery

### 22.1 Visibility / eligibility

Actionはactive `ADMINISTRATOR` + `recovery.exception.execute` のActorにだけ表示する。

通常表示 / page reload / 別device利用を理由にrotation buttonを推奨しない。利用目的は **confirmed or reasonably suspected token compromise recovery** に限定する。

通常Actionをdisabledとする最低条件:

- Ticket `USED`
- Ticket `CANCELED`
- Ticket `EXPIRED`
- current relation consistencyを安全に確認できない

### 22.2 Confirmation Dialog

表示:

- Ticket Public Reference
- current Ticket State
- Owner summary
- current QR operational status
- 旧QRが `TOKEN_REVOKED` になること
- Ticket State / Owner / Order / Check-in historyは変わらないこと
- 新しいraw QR tokenはAdminへ表示されず、Ownerの正規QR表示経路から取得すること

### 22.3 Result

- success: 「QR token rotation completed」+ current safe summary
- conflict: current Ticket state再読込
- consistency review: Reviewへ遷移
- DB temporary failure: rotation成否を推測せずdetail再読込

**ADM-TKT-001:** Admin画面へQR raw tokenを表示しない。

**ADM-TKT-002:** generic Ticket state editorを提供しない。

**ADM-TKT-003:** QR rotation成功をTicket再発行として表示しない。

Trace: `FR-ADM-007〜008,019〜022`, `TQR-TKT-*`, `TQR-TOK-015〜020`, `API-ADM-TKT-001〜002`, `API-ADM-TQR-001`, `INV-010-03,05,08,10`.

---

# Part VII — Karaoke Operation

## 23. `PG-ADM-007` Karaoke Slot Schedule / List

### 23.1 Display model

Schedule表示の業務Timezoneは `Asia/Tokyo` とする。

各Slotは次を表示する。

- `slot_ref`
- Exclusive Scope public ref / display name if available
- `usage_start`
- `usage_end`
- `cycle_end`
- Slot State `AVAILABLE|HELD|SOLD|SALES_STOPPED`
- sales configuration summary
- related Reservation presence when sold

Customer利用時間 `[usage_start, usage_end)` と整備を含むOccupancy `[usage_start, cycle_end)` を視覚上区別する。

### 23.2 Schedule range

default表示は `Asia/Tokyo` の当日から近未来の運用範囲を開始点とする。過去Slotへ切替可能とし、upcoming / pastを混同しない。

Exact day / range filterは第31章で定義する。

**ADM-KRK-001:** `SOLD` Slotを空きに見せない。

**ADM-KRK-002:** `HELD` Slotを編集可能な未販売Slotとして扱わない。

## 24. `PG-ADM-008` Slot Generation

### 24.1 Input

`API-ADM-KRK-003` のbody contractのみを使う。

- Exclusive Scope refs: 1件以上
- `window_start`
- `window_end`
- template = `STANDARD`

UI上で標準15分利用 + 5分整備を表示し、任意分数inputを提供しない。

### 24.2 Preview

Clientは入力windowから候補時刻を**表示目的だけ**でpreviewしてよいが、生成可否・overlapのAuthorityにしてはならない。serverがdeterministic candidate / exact match / overlapを再評価する。

### 24.3 Confirmation

- 対象Scope
- window
- expected standard cycle
- all-or-nothing生成
- exact-matchは既存Slot再利用
- non-identical overlapが1件でもあれば全体失敗

を表示する。

### 24.4 Result

- generated refs
- reused exact-match refs
- `409 SLOT_GENERATION_OVERLAP`: 生成0件として扱い、conflict対象を安全に表示できる範囲で示す
- idempotency replay: 同じ結果を再利用

**ADM-KRK-003:** partial successを通常結果として表示しない。

**ADM-KRK-004:** exact-match retryで既存Slot Stateが変化したように表示しない。

## 25. `PG-ADM-009` Slot Detail / Edit

### 25.1 Action availability

| Slot State | Edit rights-affecting | Stop sales | Resume sales |
|---|---|---|---|
| `AVAILABLE` | 条件付き可 | 可 | 不可 |
| `SALES_STOPPED` | 条件付き可 | 不可 | 可 |
| `HELD` | 不可 | per-slot不可 | 不可 |
| `SOLD` | 不可 | 不可 | 不可 |

### 25.2 Edit fields

`API-ADM-KRK-006` がallowlistする上流許可fieldだけを表示する。

- Exclusive Scope relation
- `usage_start`
- `usage_end`
- `cycle_end`
- sales configuration relation

non-rights metadataがAPIで提供される場合は別sectionとする。

### 25.3 Stop / Resume

- stop: `API-ADM-KRK-004`
- resume: `API-ADM-KRK-005`

Confirmationはcurrent Slot ref / state / time / scopeを表示する。

`HELD`へ遷移済みの場合、古い `AVAILABLE` UIからstopをsubmitしても409 conflictとしてreloadする。

**ADM-KRK-005:** `SOLD -> AVAILABLE` をUI actionとして提供しない。

**ADM-KRK-006:** `HELD` / `SOLD` のrights-affecting fieldをenabled inputとして表示しない。

## 26. `PG-ADM-010` Karaoke Reservation List

各row:

- reservation ref
- `CONFIRMED|CANCELED`
- Customer summary
- usage start / end
- Slot ref / Scope summary
- Order ref
- Karaoke Ticket state
- Check-in status
- cancellation time if canceled

upcoming / pastを `usage_start` / `usage_end` に基づいて区別する。

## 27. `PG-ADM-011` Reservation Detail / Normal Cancellation

### 27.1 Read sections

- Reservation state
- Customer
- Slot / Scope / usage time
- Order
- Hold summary (`COMMITTED` expected for confirmed history)
- Karaoke Ticket state
- Check-in presence / time
- related Refund summary
- related Consistency Review

### 27.2 Normal Cancellation Action

Actionは次をすべて満たす場合だけ候補表示する。

- Actor has `recovery.exception.execute`
- Reservation `CONFIRMED`
- Ticket `VALID`
- Check-inなし
- Slot `SOLD`
- Hold `COMMITTED`
- Order `CONFIRMED`
- unresolved inconsistencyが画面上確認されない

最終preconditionは `API-ADM-KRK-007` が再評価する。

### 27.3 Confirmation

Dialog:

- Reservation Public Reference
- usage time
- Customer summary
- Ticket current state
- Slot current state
- 「ReservationはCANCELEDになる」
- 「未使用Karaoke TicketはCANCELEDになる」
- **「SlotはSOLDのまま。再販売されない」**
- 「OrderはCONFIRMEDのまま」
- Refundとは別Operationであること

### 27.4 Result

- success: Reservation `CANCELED`, Ticket `CANCELED`, Slot `SOLD`
- already canceled + consistent: existing cancellation result
- Ticket `USED`: cancellation不可
- Ticket `EXPIRED`: cancellation不可 / recovery review
- state/correlation conflict: reviewまたはreload

**ADM-KRK-007:** Cancellation成功後にSlotを空き一覧へ戻さない。

**ADM-KRK-008:** `karaoke_reservations.manage.read` だけではCancel Actionを表示しない。

Trace: `FR-ADM-009〜015,019〜022`, `KRK-GEN-*`, `KRK-CAN-*`, `KRK-EDT-*`, `API-ADM-KRK-001〜007`, `DB-KRK-*`, `INV-010-04,05,07,08,10`.

---

# Part VIII — Goods / Inventory / Handoff

## 28. `PG-ADM-013` Goods List / Inventory

### 28.1 API mapping

- goods read: `GET /api/v1/admin/goods`
- inventory read: `API-ADM-GDS-001` `GET /api/v1/admin/goods/inventory`

### 28.2 Row fields

- `goods_ref`
- name
- sales control state
- sales period
- unit amount / currency
- purchase limit
- saleable capacity
- held quantity
- committed quantity
- derived remaining capacity where API safely provides / Client computes from exact returned counters

### 28.3 Derived inventory

Client may display:

```text
remaining = saleable_capacity - held_quantity - committed_quantity
```

only when3値を同一successful response snapshotから取得した場合に限る。mutation inputとしてこのderived値を送らない。

**ADM-GDS-001:** Inventory current quantityをClient表示値だけで更新しない。

## 29. `PG-ADM-014` Goods Detail / Inventory Adjustment

### 29.1 Goods edit

`PATCH /api/v1/admin/goods/{goods_ref}` のallowlisted public / sales fieldsだけを編集する。

- name / description where API allows
- unit amount / currency where API allows
- sales period
- `ENABLED|SUSPENDED`
- purchase limit

Inventoryは同PATCHへ混在させず、専用Inventory Adjustment commandを使用する。

### 29.2 Inventory Adjustment

`POST /api/v1/admin/goods/{goods_ref}/inventory-adjustments`

UIはserver contractが定義するadjustment valueだけを送信し、held / committed counterの直接編集inputを提供しない。

Confirmation:

- Goods public ref / name
- current saleable capacity
- held quantity
- committed quantity
- requested adjustment
- adjustment後も `held + committed <= capacity` が必要であること
- existing committed sale / allocationを破壊しないこと

Conflict時はcurrent inventoryをreloadし、入力を自動再送しない。

## 30. Admin Goods Handoff

### 30.1 `PG-ADM-015` List

完成システムでは次を表示する。

- handoff ref
- goods item ref
- Goods name / quantity
- Handoff State `PENDING|COMPLETED|VOID`
- Goods Order Item State
- Customer operational summary
- created time
- completed time

API contract不足は `UCR-130-003` で解消する。

### 30.2 `PG-ADM-016` Detail

- Handoff public ref
- Goods item public ref
- Goods / quantity
- Customer summary
- Order ref
- item state
- handoff state
- completion actor / timeのsafe summary

`goods_handoff.manage` により許可されるmutationはUpstream APIで明示されたものだけ表示する。generic `PENDING/COMPLETED/VOID` state editorは作らない。

**ADM-GDS-002:** `COMPLETED` HandoffをPENDINGへ戻すUIを提供しない。

**ADM-GDS-003:** Refund aloneを理由にInventoryを自動回復表示しない。

**ADM-GDS-004:** Goods Handoff complete済みOrderを通常refund eligibleとして表示しない。

Trace: `FR-ADM-016〜017,019〜022`, `BR-GDS-001〜013`, `DB-GDS-*`, `API-ADM-GDS-*`, `INV-010-07,08,10`.

---

# Part IX — Sales Configuration Management

## 31. `PG-ADM-006` Entry Ticket Sales Configuration

### 31.1 Purpose

`FR-ADM-014` を満たすため、AdministratorはEntry Ticket Offeringごとの運用変更可能な販売条件を管理する。

表示・編集対象は `SPEC-100 app.entry_ticket_offerings` と上流Domain contractに存在するfieldのうち、Admin operationとして許可されたものだけとする。

最低限のoperational fields:

- Offering Public Reference
- name / description
- unit amount / currency
- sales starts / ends
- sale control `ENABLED|SUSPENDED`
- sales capacity
- held quantity
- committed quantity
- purchase limit
- check-in opens / closes where configured

### 31.2 Safety

- held / committed counterはread-only
- sales capacityをheld + committed未満へ変更できない
- current sale state / periodはserver-sideで再評価
- existing confirmed Order / Ticket snapshotを編集により書き換えない
- price変更は新規purchase判定へ反映し、既存Order snapshotへ遡及しない

### 31.3 API boundary

`SPEC-110` にEntry Offering用Admin mutation contractが存在しないため、UI implementationは `UCR-130-002` のCanonical化を前提とする。BrowserからBusiness Databaseを直接更新してはならない。

## 32. `PG-ADM-012` Karaoke Sales Configuration

### 32.1 Visible / editable fields

- Sales Configuration Public Reference
- name
- unit amount / currency
- sales starts / ends
- sale control `ENABLED|SUSPENDED`
- purchase limit
- standard usage minutes = 15（read-only）
- standard maintenance minutes = 5（read-only）

15 / 5の標準cycleをAdmin UIから任意値へ変更するinputは作らない。

### 32.2 Effects

Configuration変更は新規availability / purchase startへ反映する。既存Hold、Reservation、Ticket、Order snapshotを暗黙変更しない。

### 32.3 API boundary

`SPEC-110` のAdmin Karaoke Sales Configuration mutation contract不足は `UCR-130-002` へ記録する。

**ADM-KRK-009:** Sales Configuration編集をSlot individual state editorとして利用しない。

Trace: `FR-ADM-014〜015,019〜020`, `BR-SAL-*`, `KRK-AVL-*`, `DB-SAL-*`, `INV-010-04,07〜10`.

---

# Part X — Public Content Management

## 33. Content Management Overview

`PG-ADM-017` はEvent / FAQ / Announcementへの入口とする。

Publication Stateは上流どおり次だけを使用する。

```text
DRAFT
PUBLISHED
ARCHIVED
```

## 34. `PG-ADM-018` Event Public Fields

### 34.1 API

`PATCH /api/v1/admin/event`

### 34.2 Fields

API allowlistに従い、少なくとも次の上流存在fieldを扱う。

- event name
- summary
- starts_at / ends_at
- venue name
- venue details
- access information
- participant notices

外部事実が未確定のnullable fieldを推測値で埋めない。

### 34.3 Unsaved changes

編集dirty stateがある状態でAdmin Shell内の別Routeへ遷移しようとした場合、Browser内confirmationを表示する。Browser unload APIの挙動だけに依存せず、save / discard / stayの明示Actionを提供する。

### 34.4 Concurrent update

APIがcurrent state conflictを返した場合:

- server最新値を再取得
- local変更を自動上書き送信しない
- Adminに「別更新が先に成立した」ことを表示
- 再適用する場合は最新値上で手動確認後に再submit

## 35. `PG-ADM-019` FAQ Management

APIは `SPEC-110` が「FAQ同等operation」として定義するAdmin operationを使用する。

一覧:

- FAQ public ref
- question summary
- Publication State
- sort order where returned
- published time
- updated time

編集:

- question
- answer
- state transitionはcommand actionとして扱う
- arbitrary HTMLをraw renderしない

Actions:

- create draft
- edit draft / allowed state
- publish
- archive

`ARCHIVED -> PUBLISHED` をdirect actionとして提供せず、Domain State Machineに従い一度`DRAFT`へ戻す必要がある場合はその正規operationだけを使用する。

## 36. `PG-ADM-020` Announcement Management

API mapping:

- `POST /admin/announcements`
- `PATCH /admin/announcements/{announcement_ref}`
- `POST /admin/announcements/{announcement_ref}/publish`
- `POST /admin/announcements/{announcement_ref}/archive`

一覧:

- announcement ref
- title
- state
- published_at
- updated_at

編集:

- title
- body
- allowed publication command

### 36.1 Preview

Previewは必要とする。ただしPreviewは公開判定ではない。

- 編集中contentをAdmin-only rendererで表示
- production public URLへDRAFTを露出しない
- dangerous raw HTMLを無加工renderしない
- preview成功をpublish成功と扱わない

### 36.2 Publish / Archive confirmation

Publish / Archiveはconfirmation dialogを要求する。

Dialog:

- resource ref
- current state
- target command
- public visibility effect
- unsaved local editがある場合は先にsaveを要求

**ADM-CNT-001:** 公開内容変更だけで既存Order / Ticket / Reservation / Goods権利を変更しない。

**ADM-CNT-002:** `DRAFT` / `ARCHIVED` をpublic contentとして表示しない。

**ADM-CNT-003:** raw HTML / scriptをAdmin previewでtrust済みとして実行しない。

Trace: `FR-ADM-018〜020,022`, `BR-EVT-001〜004`, `API-ADM-CNT operations`, `DB-SAL-001`, `INV-010-07,08`.

---

# Part XI — Role Assignment Management

## 37. `PG-ADM-021` Role Assignment List

### 37.1 API mapping

- `GET /api/v1/admin/role-assignments`
- `POST /api/v1/admin/role-assignments`
- `POST /api/v1/admin/role-assignments/{role_assignment_ref}/deactivate`

### 37.2 Visible fields

- Role Assignment Public Reference
- target Business Profile Public Reference
- Role `STAFF|ADMINISTRATOR`
- State `ACTIVE|REVOKED`
- granted time
- revoked time
- grant/revoke actor summary where API safely returns

Capability checkbox一覧は表示しない。CapabilityはRole Matrixから導出されるread-only explanationとして表示してよい。

## 38. Role Grant

### 38.1 Target resolution

Role grant inputは `target_profile_ref` をcanonical targetとする。

Target Profileは、対象本人が自身のProfileから確認できるPublic Referenceを運用者へ伝達する方式を基本とする。Admin UIは任意EmailからBusiness Profileを検索する機能を勝手に追加しない。

入力:

- target profile public ref
- role `STAFF|ADMINISTRATOR`

### 38.2 Confirmation

- target profile ref
- role
- role capability summary
- grant後の権限影響
- Admin自身のProfile refとtargetが同一の場合は通常grantを拒否すること

### 38.3 Duplicate active assignment

同一Profile + Roleのactive assignmentが既に存在する場合:

- 2件目を作らない
- `409` / existing resultに応じて「already active」と表示
- duplicateをerror recoveryとして再作成しない

## 39. Role Revoke / Deactivate

### 39.1 Visibility

`ACTIVE` assignmentだけにDeactivate Actionを表示する。

### 39.2 Prohibited dangerous operation

- 自身の `ADMINISTRATOR` Assignmentを通常UIからrevokeしない
- 自身へ新しい `ADMINISTRATOR` Assignmentを通常UIからgrantしない
- 最後のactive Administratorを失わせない

### 39.3 Confirmation

- assignment ref
- target profile ref
- role
- current state
- next privileged requestから権限が失効すること
- Session / Customer ownership data自体は消えないこと

### 39.4 Concurrent mutation

Role list表示後に別Adminが変更していた場合、API current state / advisory lock / partial unique結果をAuthorityとする。

- already revoked: existing result / no second effect
- last Administrator protection: blocked
- duplicate grant: existing assignment state表示
- target mismatch / stale ref: not found

**ADM-ROL-001:** Permissionを個別checkboxで自由編集するUIを作らない。

**ADM-ROL-002:** Client role claimをgrant target / authorization authorityにしない。

**ADM-ROL-003:** `role_assignment.manage` をgeneric capability editorとして扱わない。

Trace: `FR-ADM-001,019〜022`, `AR-ROLE-004〜015`, `API Role Assignment manage`, `DB-AUTH-002`, `INV-010-08,10`.

---

# Part XII — Consistency Review

## 40. `PG-ADM-022` Consistency Review List

### 40.1 API

`API-ADM-REC-001` `GET /api/v1/admin/consistency-reviews`

### 40.2 Default scope

Defaultは `resolved_at IS NULL` に相当するunresolved caseだけを表示する。

### 40.3 Row fields

- `case_ref`
- allowlisted reason category
- opened time
- related resource public refs
- oldest-first ordering
- recovery action availability indicator

`details jsonb`全文、SQLSTATE、provider raw bodyを表示しない。

## 41. `PG-ADM-023` Consistency Review Detail

### 41.1 API

`API-ADM-REC-002` `GET /api/v1/admin/consistency-reviews/{case_ref}`

### 41.2 Main sections

- Case public ref
- opened time
- reason category
- related Order / Checkout / Refund / Slot / Hold / Reservation / Ticket / Goods resource links
- safe operational details
- related current state summary
- allowed explicit recovery actions

### 41.3 Action boundary

`recovery.review` はreadだけを許可する。

Mutationは、上流で明示Operationとして既に存在し、そのOperation-specific preconditionを満たす場合だけAction buttonを表示する。

例:

- full Refund operation
- QR token rotation
- Normal Reservation cancellation
- Notification retry / cancel

「任意SQL」「任意state change」「mark fixedだけ」「constraint disable」は提供しない。

### 41.4 Resolved indication

Caseが他operationにより解消済みと再取得で判明した場合はread-only resolved indicationへ切り替える。BrowserだけでresolvedにするActionは、上流APIが定義しない限り提供しない。

**ADM-REC-001:** Consistency ReviewをOrder/Notificationの正常成功badgeへ混ぜない。

**ADM-REC-002:** `recovery.exception.execute` はReview画面から任意mutationを生成する権限ではない。

Trace: `FR-ADM-021〜022`, `BR-ORD-010`, `PAY-REC-*`, `TQR-REC-*`, `KRK-REC-*`, `API-REC-001`, `DB-XFN-002〜003`, `INV-010-01,07,08,10`.

---

# Part XIII — Email Notification Operation

## 42. `PG-ADM-024` Notification List

### 42.1 API

`API-ADM-EML-001` `GET /api/v1/admin/notifications`

### 42.2 Filters

Canonical API allowlistをそのまま使用する。

- Domain State
  - `PENDING`
  - `SENT`
  - `FAILED_RETRYABLE`
  - `CANCELED`
- Notification Type
- Processing State
  - `READY`
  - `CLAIMED`
  - `UNKNOWN_RESULT`
  - `BLOCKED`
  - `CLOSED`
- cursor / limit

### 42.3 Visible fields

- notification ref
- Notification Type
- Domain State
- Processing State
- created time
- sent time
- source Order / Reservation ref
- last failure class
- recipient masked summary only

Email全文、recipient Email全文、render_context全文、provider bodyをrowへ表示しない。

### 42.4 Priority presentation

次をattention priorityとして先に識別可能にする。

1. `UNKNOWN_RESULT`
2. `BLOCKED`
3. `FAILED_RETRYABLE + READY`
4. `PENDING + READY`
5. terminal / closed history

ただしdefault sortはAPI cursor contractを維持し、Clientが任意sort expressionを送らない。

## 43. `PG-ADM-025` Notification Detail

### 43.1 API mapping

- detail: `API-ADM-EML-002`
- attempts: `API-ADM-EML-003`
- retry: `API-ADM-EML-004`
- cancel: `API-ADM-EML-005`

### 43.2 Detail fields

- Notification Type
- Domain State
- Processing State
- Template ID / version
- source resource links
- provider correlation summary
- recipient snapshot state `PRESENT|MISSING`
- masked recipient snapshot
- recipient snapshot revision
- last failure / block reason
- last attempt summary
- attempt history

Attempt history:

- attempt ref
- attempt no
- result `PREPARED|ACCEPTED|RETRYABLE_FAILURE|PERMANENT_FAILURE|UNKNOWN`
- failure stage
- failure class
- safe provider status / error code
- provider message ID when operationally allowed
- started / provider called / accepted / finished time

### 43.3 Retry default

Retry ActionはNotification `FAILED_RETRYABLE` だけに候補表示する。

Default body:

```json
{
  "recipient_mode": "SNAPSHOT"
}
```

Precondition UI:

- `FAILED_RETRYABLE`
- Job != `CLAIMED`
- Job != `UNKNOWN_RESULT`
- Provider Acceptance済みattemptなし

`SENT` / `CANCELED` へRetry buttonを出さない。

### 43.4 `CURRENT_VERIFIED` retry

`CURRENT_VERIFIED` optionは次をすべて満たす場合だけ表示する。

- Notification `FAILED_RETRYABLE`
- Processing State `BLOCKED`
- last failure = `RECIPIENT_UNAVAILABLE` または `PROVIDER_PERMANENT_RECIPIENT`
- Provider Acceptance済みattemptなし
- Unknown Provider Resultなし

さらにserverがcurrent Supabase Auth Email verifiedを確認できる必要がある。

Confirmationでは:

- snapshot revisionが更新される可能性
- current verified recipientへ宛先が変わること
- raw Email addressはmasked表示
- Unknown Result中は実行不可

を表示する。

### 43.5 Retry result

`202 RETRY_SCHEDULED` は次の文言上の意味とする。

> 再送処理をスケジュールしました。送信済みではありません。

Provider Acceptanceを確認するまで`SENT`表示にしない。

### 43.6 Cancel

Cancel候補:

- Notification `PENDING|FAILED_RETRYABLE`
- Job `READY|BLOCKED`
- active `CLAIMED`でない
- `UNKNOWN_RESULT`でない
- Provider Acceptance済みattemptなし

Confirmation:

- Notification ref / type
- source ref
- current Domain / Processing State
- 「source Order / Reservation / Refund stateは変更しない」
- 「Provider受理済みまたは受理不明の通知はcancelできない」

### 43.7 Error interpretation

| Code | UI |
|---|---|
| `NOTIFICATION_ALREADY_SENT` | SENT表示へrefresh。Retry/Cancel不可 |
| `NOTIFICATION_CANCELED` | CANCELED表示。Retry不可 |
| `NOTIFICATION_IN_FLIGHT` | worker処理中。blind retry/cancel不可 |
| `NOTIFICATION_PROVIDER_RESULT_UNKNOWN` | provider結果不明。reconciliation待ち。blind resend不可 |
| `NOTIFICATION_NOT_RETRYABLE_NOW` | failure原因修復が必要 |
| `NOTIFICATION_RECIPIENT_UNAVAILABLE` | recipient recovery条件不足 |
| `EMAIL_PROVIDER_TEMPORARY_FAILURE` | Provider障害。Domain stateを成功へ変えない |

**ADM-EML-001:** `SENT` Notificationのmanual resend UIを作らない。

**ADM-EML-002:** `UNKNOWN_RESULT` から新しいprovider attemptをblind作成するUIを作らない。

**ADM-EML-003:** Notification retryで元Order / Reservation / Refund operationを再実行しない。

**ADM-EML-004:** Notification cancellationでsource Business stateを変更しない。

**ADM-EML-005:** recipient Email全文 / Email body全文 / provider response body全文を通常Admin UIへ表示しない。

Trace: `FR-EML-006〜012`, `FR-ADM-021〜022`, `EML-RCP-*`, `EML-RTY-*`, `EML-CAN-*`, `API-ADM-EML-001〜005`, `INV-010-06,08,10`.

---

# Part XIV — Staff Operation

## 44. `PG-STF-001` Staff Landing

Staff Homeは各Capabilityごとの大きな操作入口だけを表示する。

- Entry Check-in
- Karaoke Check-in
- Goods Handoff

表示しないもの:

- Customer検索
- Order履歴
- Refund
- Ticket管理
- Slot管理
- Role管理
- Email管理
- Consistency Review

**STF-ROU-006:** Staff landingは当日運用の操作入口であり、Administrator dashboardの縮小版にしない。

## 45. Scan input boundary

Entry / Karaoke共通で次の2入力方式を許可する。

1. Camera scan
2. Manual scanner / keyboard-wedge input

### 45.1 Camera

- Browser camera APIでQR payload stringを取得する。
- Browserはpayloadを業務Authorityとして解釈しない。
- raw payloadをlocalStorage、analytics、URL、error logへ保存しない。
- exact payloadを対応Hono APIへPOSTする。

### 45.2 Manual scanner

- dedicated input fieldへscannerが文字列を入力する。
- operatorによるpasteも許可してよい。
- submit時にleading/trailing UI whitespaceを除去してよいが、QR本体を再構成・補正しない。
- input history autocompleteを無効化する。
- result表示後にraw inputをclearする。

### 45.3 Duplicate scan suppression

同一scan payloadについてrequestがin-flightの間は2件目を送らない。

result表示中はscan captureをlockし、Staffが「次をスキャン」を選択した時だけ新しいscan受付へ戻す。

これはUX-level duplicate suppressionであり、Ticket consume-once atomicityの代替ではない。

**STF-CHK-001:** QR payloadをClient-side判定だけで`CHECKED_IN`にしない。

**STF-CHK-002:** Camera decode成功をCheck-in成功として表示しない。

## 46. `PG-STF-002` Entry Check-in

### 46.1 API

`API-STF-CHK-001` `POST /api/v1/staff/check-ins/entry`

### 46.2 Processing state

1. `READY_TO_SCAN`
2. `SCANNING`
3. `SUBMITTING`
4. canonical result

`SUBMITTING`中は次scanを受け付けない。

### 46.3 Minimal visible target data

APIがsuccessful token resolution後に返す範囲で:

- Ticket Public Reference
- type = Entry
- Ticket current state / outcome
- Check-in time if applicable
- already-used time if applicable
- Offering summary if API returns it

Business Profileに氏名・電話等のCanonical fieldが存在しないため、本書はStaff用に新しいCustomer personal fieldを追加しない。Customer全Order履歴、他Ticket、Karaoke、Goods、Emailを表示しない。

## 47. `PG-STF-004` Karaoke Check-in

### 47.1 API

`API-STF-CHK-002` `POST /api/v1/staff/check-ins/karaoke`

### 47.2 Minimal visible target data

- Ticket Public Reference
- type = Karaoke
- Reservation public ref where response permits
- usage start / end
- Ticket / Reservation state必要summary
- Check-in time / already-used time
- canonical outcome

無関係なOrder / Entry / Goods履歴を表示しない。

## 48. Canonical Check-in outcome presentation

Outcome名は変更しない。

| Outcome | Staff headline | Mutation interpretation | Next action |
|---|---|---|---|
| `CHECKED_IN` | 受付完了 | 初回Check-in成立 | 次をスキャン |
| `ALREADY_USED` | 使用済み | 新規Check-inなし | 既存利用時刻確認、次へ |
| `MALFORMED_QR` | QR形式不正 | なし | QR再提示 / 入力確認 |
| `UNKNOWN_TOKEN` | 未登録QR | なし | 対象QR確認 |
| `WRONG_PURPOSE` | 受付種類が違います | なし | Entry/Karaoke正しい受付へ |
| `TOKEN_REVOKED` | 旧QRは無効 | なし | Customerに最新QR表示を依頼 |
| `TICKET_CANCELED` | 取消済み | なし | 受付不可 |
| `TICKET_EXPIRED` | 有効期限切れ | なし | 受付不可 |
| `RESERVATION_CANCELED` | 予約取消済み | なし | 受付不可 |
| `OUTSIDE_CHECKIN_WINDOW` | 受付時間外 | なし | 予約時刻を確認。通常Staff overrideなし |
| `AUTHENTICATION_FAILED` | 再認証が必要 | なし | Authentication Gate |
| `AUTHORIZATION_DENIED` | 受付権限なし | なし | Staff access denied |
| `TEMPORARY_UNAVAILABLE` | 一時的に確認できません | なし | 状態確定せず再試行 |
| `CONSISTENCY_REVIEW_REQUIRED` | 運営確認が必要 | なし | Check-inを続行せず管理者へ引継ぎ |

### 48.1 Visual distinction

`CHECKED_IN` と `ALREADY_USED` は同じ成功色・同じ文言にしない。

- `CHECKED_IN`: 新規受付成功
- `ALREADY_USED`: terminal informational result

**STF-CHK-003:** `ALREADY_USED` を2回目の `CHECKED_IN` として表示しない。

**STF-CHK-004:** `OUTSIDE_CHECKIN_WINDOW` に「強制受付」Buttonを表示しない。現行Capabilityに時間外overrideは存在しない。

**STF-CHK-005:** `CONSISTENCY_REVIEW_REQUIRED` でTicket stateをClient側補正しない。

## 49. `PG-STF-006` Goods Handoff Target / Confirmation

### 49.1 Target input

Canonical targetはGoods Order Item Public Referenceとする。Internal IDを入力しない。

完成システムでは、StaffがPublic Referenceを入力 / scan相当で取得した後、**mutation前に対象Handoff summaryをserver-sideでresolve**し、次を確認できるようにする。

- Goods Item Public Reference
- Goods name
- quantity
- Goods Order Item state
- Handoff `PENDING|COMPLETED|VOID`
- Customerの最小operational reference

この事前確認read operationは `SPEC-110` に不足しているため `UCR-130-003` へ記録する。

### 49.2 Completion confirmation

`PENDING` + Item `FULFILLABLE` の場合だけComplete buttonを候補表示する。

Dialog:

- goods item ref
- goods / quantity
- handoff current state
- 「完了後は通常PENDINGへ戻せない」
- target再確認

### 49.3 Completion API

`API-STF-GDS-001` `POST /api/v1/staff/goods-handoffs/{goods_item_ref}/complete`

### 49.4 Result

- first completion: completed result
- already `COMPLETED`: existing completion summary。二回目の完了とは表示しない
- `VOID`: handoff不可
- item non-fulfillable: state conflict
- `503`: completion成否を推測せず、targetを再resolve

**STF-GDS-001:** StaffへInventory adjustment、Goods sales edit、Customer order historyを表示しない。

**STF-GDS-002:** Completion retryで2件目のHandoffを作ったように表示しない。

**STF-GDS-003:** `COMPLETED` をUIだけでPENDINGへ戻さない。

Trace: `FR-STF-001〜016`, relevant `FR-GDS-*`, `AR-ROLE-012〜015`, `TQR-CHK-*`, `TQR-OUT-*`, `KRK-CHK-*`, `BR-CHK-*`, `BR-GDS-010〜013`, `API-STF-CHK-001〜002`, `API-STF-GDS-001`, `INV-010-05,08,10`.

---

# Part XV — Search / Filter / Pagination

## 50. Common list contract

全Admin listは `SPEC-110` のcursor paginationを使用する。

```text
limit=1..100
cursor=<opaque cursor>
```

Default `limit` はAPI default 30を使用する。

**OPS-LST-001:** offset paginationを別途追加しない。

**OPS-LST-002:** Clientから任意column名、SQL、sort expressionを送らない。

**OPS-LST-003:** Filter変更時はcursorを破棄して先頭pageから再取得する。

**OPS-LST-004:** cursorはopaqueとして扱い、ClientでInternal ID等へdecodeして表示しない。

## 51. Canonical operational filter requirements

`SPEC-110` が各Admin listの詳細query allowlistを完全には定義していないため、本章は**UIに必要なfilter semantics**をCanonicalに決定し、API query contract追加を `UCR-130-004` へ要求する。

### 51.1 Order

| Filter | Type | UI default |
|---|---|---|
| exact Order Ref | UUID | unset |
| Purpose | canonical enum | all |
| Order State | canonical enum | all |
| Refund State | canonical Refund enum | all |
| Customer Profile Ref | exact UUID | unset |
| created from / to | timestamp/date range | unset |

Default sort: newest created first, Public Reference tie-breaker。

### 51.2 Entry Ticket

| Filter | Type |
|---|---|
| exact Ticket Ref | UUID |
| Ticket State | `VALID|USED|CANCELED|EXPIRED` |
| Offering Ref | UUID |
| Order Ref | UUID |
| Owner Profile Ref | UUID |
| Check-in | `USED|UNUSED` operational predicate |
| issued from / to | range |

Default sort: newest issued first, Ticket Public Reference tie-breaker。

### 51.3 Karaoke Slot

| Filter | Type |
|---|---|
| Slot State | `AVAILABLE|HELD|SOLD|SALES_STOPPED` |
| Exclusive Scope Ref | UUID |
| Sales Configuration Ref | UUID |
| usage date | `Asia/Tokyo` date |
| usage from / to | timestamp range |

Default sort: `usage_start ASC`, Public Reference tie-breaker。

### 51.4 Karaoke Reservation

| Filter | Type |
|---|---|
| Reservation State | `CONFIRMED|CANCELED` |
| exact Reservation Ref | UUID |
| Slot Ref | UUID |
| Order Ref | UUID |
| Customer Profile Ref | UUID |
| usage from / to | range |
| Ticket State | canonical Ticket State |

Default sort: newest reservation creation first。Schedule-specific viewはusage start ascending。

### 51.5 Goods

| Filter | Type |
|---|---|
| exact Goods Ref | UUID |
| Sale Control | `ENABLED|SUSPENDED` |
| sales period status | derived allowlisted category |
| inventory attention | `LOW_OR_ZERO_AVAILABLE` operational predicate if API canonicalized |

Default sort: server canonical goods list order。任意name sortをClientから送らない。

### 51.6 Goods Handoff

| Filter | Type |
|---|---|
| Handoff State | `PENDING|COMPLETED|VOID` |
| exact Handoff Ref | UUID |
| Goods Ref | UUID |
| Customer Profile Ref | UUID |
| created from / to | range |
| completed from / to | range |

Default sort: newest created first。

### 51.7 Role Assignment

| Filter | Type |
|---|---|
| Role | `STAFF|ADMINISTRATOR` |
| State | `ACTIVE|REVOKED` |
| target Profile Ref | UUID |
| granted from / to | range |

Default sort: newest granted first。

### 51.8 Consistency Review

| Filter | Type |
|---|---|
| resolution | unresolved by default; resolved/history if upstream API supports |
| reason category | allowlisted category |
| related resource Public Ref | exact UUID |
| opened from / to | range |

Default sort: unresolved oldest first (`opened_at ASC`)。

### 51.9 Notification

API canonical filterを使用する。

- Domain State
- Notification Type
- Processing State
- cursor / limit

Default sortはAPIが返すcanonical orderを使用する。追加の任意sortは作らない。

## 52. Empty / No-result state

- Filter未適用かつ0件: `EMPTY`
- 1つ以上Filter適用かつ0件: `NO_RESULTS`
- API failure: `ERROR_RETRYABLE|ERROR_TERMINAL`

**OPS-LST-005:** 503 / timeoutをNo-resultsへ変換しない。

---

# Part XVI — Destructive / High-risk Action UX

## 53. High-risk action catalog

次は必ず明示confirmationを要求する。

- Full Refund
- Reservation cancellation
- QR token rotation
- Inventory adjustment
- Slot generation
- Slot rights-affecting edit
- Slot stop / resume
- Public content publish / archive
- Role grant / revoke
- Notification cancel
- Notification retry with `CURRENT_VERIFIED`
- `recovery.exception.execute` を用いる全operation

## 54. Confirmation Dialog contract

High-risk Dialogは最低限:

1. Action name
2. Target resource type
3. Target Public Reference
4. current state
5. affected resource summary
6. irreversible / external side effect summary
7. expected post-condition
8. explicit Cancel / Confirm

を表示する。

### 54.1 Typed confirmation

Public Reference全文の再入力等のtyped confirmationは標準必須としない。誤入力自体が新しい事故要因となるため、target summaryと明示Confirmを標準とする。

ただしRole grantのtarget Profile Ref入力はoperation本体の必須入力であり、confirmationにも再表示する。

## 55. Submitting / duplicate click

- submit開始後、同Action buttonをdisabled
- Abort / route changeしてもserver request結果を勝手に取消済みとみなさない
- response loss時はresource detailを再取得
- new Idempotency-Keyでblind再送しないoperationはそのBusiness Causeを維持

## 56. Success / Pending / Unknown / Failure

| Class | UI semantics |
|---|---|
| Success | serverがcanonical final effectを確認 |
| Scheduled | worker / async処理を予約しただけ |
| Pending | provider final result待ち |
| Unknown | provider result不明。新規side effect禁止 |
| Conflict | current state再取得が必要 |
| Denied | authorization不足。resource state変更なし |
| Review | automatic safe resolution不可 |
| Temporary Failure | success/failureを推測しない |

**OPS-ACT-001:** confirmation dialogをserver-side authorizationの代替にしない。

**OPS-ACT-002:** `Idempotency-Key`をDomain Business Causeの代替にしない。

**OPS-ACT-003:** stateful high-risk operationへoptimistic success表示を使用しない。

### 56.1 Post-action navigation

| Action | Success / accepted navigation | Conflict / failure navigation |
|---|---|---|
| Full Refund | `PG-ADM-003` に留まりRefund sectionを再取得 | 同Order detailを再取得。Reviewならrelated caseへ |
| QR rotation | `PG-ADM-005` に留まりQR safe summaryを再取得 | Ticket detailへ戻りcurrent state表示 |
| Slot generation | `PG-ADM-007` へ遷移し対象window / scope filterを適用 | `PG-ADM-008` に入力を保持しconflict表示 |
| Slot edit / stop / resume | `PG-ADM-009` でcurrent Slot再取得 | 同detailでstate conflict表示 |
| Reservation cancellation | `PG-ADM-011` でReservation/Ticket/Slotを再取得 | 同detail。Review必要ならcase link |
| Inventory adjustment | `PG-ADM-014` でinventory snapshot再取得 | 同detailでcurrent counters再表示 |
| Publish / archive | 対象editor/listでserver state再取得 | local unsaved dataを自動上書きせずconflict表示 |
| Role grant / revoke | `PG-ADM-021` listを再取得 | listを再取得しduplicate / last-admin / stale state表示 |
| Notification retry / cancel | `PG-ADM-025` detailを再取得 | 同detailでcanonical Notification / Processing State表示 |
| Staff Check-in | result pageへtransient遷移 | canonical outcome result page。Auth denialのみgateへ |
| Goods Handoff completion | `PG-STF-007` resultへ | target pageへ戻りserver summary再resolve |

---

# Part XVII — Error / Failure UX

## 57. Common API error mapping

| HTTP / Code | Admin / Staff UI behavior |
|---|---|
| `401 AUTHENTICATION_REQUIRED` / check-in `AUTHENTICATION_FAILED` | protected dataをclearしAuthentication Gateへ |
| `403 EMAIL_VERIFICATION_REQUIRED` | verification requirement表示。operation未成立 |
| `403 AUTHORIZATION_DENIED` | Access Denied。resource dataを追加取得しない |
| `404 RESOURCE_NOT_FOUND` | resource not found / owner-safe hidden。Internal lookupを試行しない |
| `409 STATE_CONFLICT` | current state reload。操作不可理由を表示 |
| `409 IDEMPOTENCY_KEY_REUSED` | 同key別payload conflict。新しい操作として勝手に継続しない |
| `409 SLOT_UNAVAILABLE` | current Slot reload。古いavailabilityを破棄 |
| `409 SLOT_GENERATION_OVERLAP` | batch全体未生成として表示 |
| `409 INVENTORY_UNAVAILABLE` | inventory reload |
| `409 CONSISTENCY_REVIEW_REQUIRED` | Reviewへ誘導。通常成功にしない |
| `410 BUSINESS_OPPORTUNITY_EXPIRED` | expired state表示。復活Buttonを出さない |
| `422 DOMAIN_RULE_VIOLATION` | field validationではなくBusiness Rule failureとして表示 |
| `422 OUTSIDE_CHECKIN_WINDOW` | Staffは時間外受付不可 |
| `424 STRIPE_TEMPORARY_FAILURE` | payment/provider resultを成功にしない |
| `503 DATABASE_TEMPORARY_FAILURE` | 0件表示にしない。mutationは成否再確認 |
| `503 AUTH_SERVICE_TEMPORARY_FAILURE` | fail closed。role/identityをcacheで代替しない |
| `503 TEMPORARY_UNAVAILABLE` | retry可能な一時障害。state不変を推測しない |
| `500 INTERNAL_ERROR` | generic safe error + request_id。stack trace非表示 |

## 58. 409 operational interpretation

409は一律「サーバーエラー」と表示しない。

- stale state: reload
- concurrent loser: current winner state表示
- duplicate idempotent effect: existing resultへ収束
- consistency issue: Review
- last Administrator protection: operation blocked
- notification in flight / unknown: blind action禁止

### 58.1 Owner / target resolution failure

Owner-safe self resourceでは、存在しないPublic Referenceと他Owner resourceを上流APIどおり同じ `404 RESOURCE_NOT_FOUND` として扱い、UIから存在差を推測しない。

Admin / Staffのexplicit target resolutionでは次を区別する。

- Role grant target Profile Refが解決不能: target not foundとしてmutation未成立。Email等から別Profileを推測しない。
- Goods Handoff target refが解決不能: Handoff operation未成立。Customer全体検索へfallbackしない。
- QR tokenがunknown: `UNKNOWN_TOKEN`。Customer / Ticket候補検索へfallbackしない。
- source relationが複数 / 不整合: `CONSISTENCY_REVIEW_REQUIRED`。最も近そうなrowを選ばない。

**OPS-ERR-004:** target resolution failureを別Customer / resourceの自動候補提示で補完しない。

## 59. Provider result unknown

Stripe / Resend等の外部Provider callで結果不明が明示された場合:

- success toast禁止
- failure terminal toastも禁止
- `Pending / Unknown Result` panel表示
- same resourceのcanonical status readへ誘導
- duplicate external side effectを作る新規Actionをdisabled

**OPS-ERR-001:** 外部Service障害をBusiness successへ偽装しない。

**OPS-ERR-002:** DB outageをzero countへ偽装しない。

**OPS-ERR-003:** unknown resultをretryable generic errorだけに潰さない。

---

# Part XVIII — Security / Privacy Boundary for Admin / Staff UI

## 60. Identifier / Secret non-disclosure

Admin / Staff UIで次を表示・URL化・Client log送信してはならない。

- Internal bigint ID
- Supabase service role credential
- Supabase Auth password / password hash / refresh credential
- password reset token / email verification token
- Stripe secret key
- raw card data / CVC / Payment Method secret
- Resend API key / webhook signing secret
- QR raw token（Staff scan input中のtransient値を除き、result / historyには残さない）
- QR token protection key / digest / encrypted material
- Database credential / Railway secret
- server stack trace / raw SQL

**OPS-SEC-001:** Public ReferenceはAuthorization credentialではない。Admin / Staff APIはRole / Capabilityを別途検証する。

## 61. Admin PII display

Administratorは運用上必要なCustomer summaryを参照できるが、一覧では最小化する。

- Email全文をlistへ常時表示しない。
- Notification recipientはmasked addressのみ。
- Email body全文を通常画面へ保存・表示しない。
- provider response body全文を表示しない。
- Auth Subject UUIDを通常運用識別子として表示しない。
- Stripe billing payload等、Order運用に不要なpayment PIIを表示しない。

Admin detailでCustomer identity確認が必要な場合も、`SPEC-110` がallowlistするfieldだけを表示する。

## 62. Staff PII boundary

現行Canonical Business Profileに氏名・電話・住所fieldは定義されていないため、Staff UIはそれらを新規要求しない。

Staffへ表示可能なdefault情報:

- Ticket / Reservation / Goods Item Public Reference
- canonical state / outcome
- usage / check-in / completion time
- offering / goods name / quantity
- Customer Profile Public Referenceのoperationally必要な短縮表示（APIが返す場合）

表示不可:

- Customer全Order history
- 他Ticket / Karaoke / Goods history
- Role Assignment history
- Email address
- profile edit history
- payment provider details

**OPS-SEC-002:** Staffが任意Customer Profile Refを入力してCustomer全履歴を検索するUIを作らない。

## 63. HTML / Content safety boundary

Public Content preview / detailはuser-editable contentをdangerous raw HTMLとしてそのまま実行しない。

- React / rendererの通常escapingを維持
- raw HTML supportが将来必要な場合は `SPEC-140` のsanitization contractが先に必要
- script / event handler / javascript URLをAdmin previewで実行しない

## 64. Client persistence

次をlocalStorage / session replay / analytics payloadへ永続化しない。

- QR raw payload
- full Notification recipient
- provider raw response
- secrets
- privileged mutation request bodyの機微値

Filterの非機微なquery stateはURL queryへ保存してよいが、Customer Emailやraw tokenをfilter queryにしない。

Trace: `FR-STF-016`, `FR-XFN-004,017,033`, `AR-ROLE-015`, `TQR-SEC-*`, `EML-SEC-*`, `DB-ID-*`, `API common error / disclosure boundary`.

---

# Part XIX — Audit Readiness

## 65. Audit-ready operation requirement

本書はAudit Event schemaを定義しない。`SPEC-160` がCanonical Ownerである。

ただし次のActionは、Hono APIから将来のAudit layerへ少なくとも **Actor、Operation ID、Target Public Reference、request correlation、result classification** を渡せる境界として実装しなければならない。

| Action | Audit significance | Minimum target context |
|---|---|---|
| Full Refund request | financial | Order ref, Refund ref/result |
| Reservation cancellation | entitlement destructive | Reservation ref, Ticket ref, Slot ref |
| QR token rotation | credential-like entitlement recovery | Ticket ref, rotation result; raw tokenなし |
| Inventory adjustment | quantity / sales capacity | Goods ref, before/after safe counters |
| Slot generation | bulk schedule | scope refs, window, generated/reused result |
| Slot edit | rights-affecting | Slot ref, changed field names, result |
| Slot stop / resume | sales control | Slot ref, from/to state |
| Public content publish / archive | public visibility | Content ref, from/to Publication State |
| Role grant / revoke | privilege | Assignment ref, target profile ref, Role, result |
| Notification retry | communication recovery | Notification ref, recipient mode, scheduled/result |
| Notification recipient refresh | PII destination change | Notification ref, snapshot revision; Email plaintext不要 |
| Notification cancel | communication suppression | Notification ref, result |
| Recovery exception execution | privileged recovery | explicit Operation ID, target refs, result |
| Staff Entry / Karaoke Check-in | entitlement consumption | Ticket ref, outcome |
| Staff Goods Handoff completion | fulfillment | Goods item/handoff ref, outcome |

**OPS-AUD-001:** UI success toastだけをAudit記録の代替にしない。

**OPS-AUD-002:** Audit contextへQR raw token、Password、Secret、full provider bodyを渡さない。

**OPS-AUD-003:** denied / conflict / unknown resultも重要Actionではresult classificationとして追跡可能にする。

---

# Part XX — Page / API Operation Mapping

## 66. Administrator mapping

| Page | Read operation | Mutation operation | Capability |
|---|---|---|---|
| `PG-ADM-001` | existing Admin lists / previews | none | per-card capability |
| `PG-ADM-002` | `API-ADM-ORD-001` | none | `orders.manage.read` |
| `PG-ADM-003` | `API-ADM-ORD-002` | `API-ADM-PAY-001` | read + `recovery.exception.execute` for refund |
| `PG-ADM-004` | `API-ADM-TKT-001` | none | `tickets.manage.read` |
| `PG-ADM-005` | `API-ADM-TKT-002` | `API-ADM-TQR-001` | read + `recovery.exception.execute` for rotation |
| `PG-ADM-006` | UCR-130-002 requested API | UCR-130-002 requested API | UCR-130-001 requested capability |
| `PG-ADM-007` | UCR-130-006 requested Slot list/detail read | `API-ADM-KRK-004/005` from detail | `karaoke_slots.manage` |
| `PG-ADM-008` | scope/config references | `API-ADM-KRK-003` | `karaoke_slots.manage` |
| `PG-ADM-009` | Slot detail | `API-ADM-KRK-004〜006` | `karaoke_slots.manage` |
| `PG-ADM-010` | `API-ADM-KRK-001` | none | `karaoke_reservations.manage.read` |
| `PG-ADM-011` | `API-ADM-KRK-002` | `API-ADM-KRK-007` | read + `recovery.exception.execute` for cancel |
| `PG-ADM-012` | UCR-130-002 requested API | UCR-130-002 requested API | UCR-130-001 requested capability |
| `PG-ADM-013` | `GET /admin/goods`, `API-ADM-GDS-001` | none | `goods_inventory.manage` |
| `PG-ADM-014` | UCR-130-006 requested Goods detail read | `PATCH /admin/goods/{goods_ref}`, inventory adjustment | `goods_inventory.manage` |
| `PG-ADM-015〜016` | UCR-130-003 requested read | UCR-130-003 explicit allowed command | `goods_handoff.manage` |
| `PG-ADM-018` | UCR-130-006 requested Admin Event read | `PATCH /admin/event` | `public_content.manage` |
| `PG-ADM-019` | UCR-130-006 requested FAQ list/detail read | FAQ create/edit/publish/archive | `public_content.manage` |
| `PG-ADM-020` | UCR-130-006 requested Announcement list/detail read | create/edit/publish/archive | `public_content.manage` |
| `PG-ADM-021` | `GET /admin/role-assignments` | create/deactivate | `role_assignment.manage` |
| `PG-ADM-022` | `API-ADM-REC-001` | none | `recovery.review` |
| `PG-ADM-023` | `API-ADM-REC-002` | explicit linked recovery operation only | review + operation-specific capability |
| `PG-ADM-024` | `API-ADM-EML-001` | none | `recovery.review` |
| `PG-ADM-025` | `API-ADM-EML-002〜003` | `API-ADM-EML-004〜005` | review + `recovery.exception.execute` |

## 67. Staff mapping

| Page | API | Capability |
|---|---|---|
| `PG-STF-002〜003` | `API-STF-CHK-001` | `entry_checkin.execute` |
| `PG-STF-004〜005` | `API-STF-CHK-002` | `karaoke_checkin.execute` |
| `PG-STF-006` preview | UCR-130-003 requested read | `goods_handoff.execute` |
| `PG-STF-006〜007` completion | `API-STF-GDS-001` | `goods_handoff.execute` |

**ADM-UI-005:** Page mappingに存在しないHono endpointをBrowserから推測して呼び出さない。

**ADM-UI-006:** UCR対象PageをSupabase direct queryで仮実装しない。

---

# Part XXI — Traceability

## 68. Functional Requirements Traceability

### 68.1 Administrator

| Requirement | Primary SPEC-130 trace |
|---|---|
| `FR-ADM-001` | §§6〜10, Page guard, server-side capability mapping |
| `FR-ADM-002` | `PG-ADM-002` |
| `FR-ADM-003` | `PG-ADM-003` |
| `FR-ADM-004` | §§50〜51.1 |
| `FR-ADM-005` | Order/Ticket/Reservation/Goods operational summaries |
| `FR-ADM-006` | §§18〜19 |
| `FR-ADM-007` | `PG-ADM-004〜005` |
| `FR-ADM-008` | §51.2 |
| `FR-ADM-009` | `PG-ADM-007〜009`, §51.3 |
| `FR-ADM-010` | `PG-ADM-008` |
| `FR-ADM-011` | `PG-ADM-009` |
| `FR-ADM-012` | stop/resume §§25.3 |
| `FR-ADM-013` | `PG-ADM-010〜011`, §51.4 |
| `FR-ADM-014` | `PG-ADM-006`, UCR-130-001/002 |
| `FR-ADM-015` | `PG-ADM-012`, UCR-130-001/002 |
| `FR-ADM-016` | `PG-ADM-013〜014` |
| `FR-ADM-017` | `PG-ADM-015〜016`, UCR-130-003 |
| `FR-ADM-018` | `PG-ADM-017〜020` |
| `FR-ADM-019` | §§7〜8, server-side authorization |
| `FR-ADM-020` | action eligibility / current state / no generic state editor |
| `FR-ADM-021` | Dashboard, Consistency Review, Notification recovery |
| `FR-ADM-022` | §§65, high-risk action audit readiness |

### 68.2 Staff

| Requirement | Primary SPEC-130 trace |
|---|---|
| `FR-STF-001` | Staff Shell / guard |
| `FR-STF-002` | `PG-STF-002`, scan input |
| `FR-STF-003` | Entry API current-state outcome |
| `FR-STF-004` | `CHECKED_IN` result |
| `FR-STF-005` | invalid outcome matrix |
| `FR-STF-006` | `ALREADY_USED` distinct result |
| `FR-STF-007` | in-flight suppression + server atomicity |
| `FR-STF-008` | `PG-STF-004` |
| `FR-STF-009` | Karaoke minimal reservation/time data |
| `FR-STF-010` | Karaoke `CHECKED_IN` result |
| `FR-STF-011` | canonical failure outcomes |
| `FR-STF-012` | `ALREADY_USED` |
| `FR-STF-013` | duplicate suppression + server atomicity |
| `FR-STF-014` | `WRONG_PURPOSE` |
| `FR-STF-015` | no time-window override UI |
| `FR-STF-016` | §62 Staff PII boundary |

## 69. System Invariant Traceability

| Invariant | SPEC-130 enforcement |
|---|---|
| `INV-010-01` | Order / provider failureをUIで削除・成功偽装しない |
| `INV-010-02` | Order state generic editorなし、Webhook/Payment current state尊重 |
| `INV-010-03` | Ticket再発行UIなし、QR rotationとTicket発行を分離 |
| `INV-010-04` | Slot overlap/current state、Cancellation後SOLD維持 |
| `INV-010-05` | canonical Check-in outcomes、ALREADY_USED区別 |
| `INV-010-06` | Notification failureをBusiness rollbackに接続しない |
| `INV-010-07` | Refund / cancellation / inventory / handoffの中途半端成功表示禁止 |
| `INV-010-08` | API authorization、Public Ref非credential、Staff data最小化 |
| `INV-010-09` | price / amount / inventoryをClient権威値にしない |
| `INV-010-10` | Idempotency-Key + current state + canonical replay result |

## 70. Cross-spec rule trace

### Authentication

- `AR-ROLE-004〜015`: Role Assignment / capability / no inheritance
- `AR-AZ-*`: operation-level authorization
- `AR-FAIL-*`: fail closed

### Payment

- `PAY-RFD-001〜007`: full Refund only / provider unknown / Domain cancellation分離
- `PAY-AZ-006〜007`: read capability != mutation authority

### Ticket / QR

- `TQR-TOK-015〜020`: compromise rotation
- `TQR-OUT-*`: canonical Check-in outcomes
- `TQR-REC-*`: consistency boundary

### Karaoke

- `KRK-GEN-*`: exact-match / all-or-nothing generation
- `KRK-CAN-*`: Normal Cancellation / no Slot resale
- `KRK-EDT-*`: state別 edit / stop / resume
- `KRK-CHK-*`: normal check-in window

### Database

- Public Ref / Internal ID separation: `DB-ID-*`
- Role advisory lock / active unique: `DB-AUTH-*`
- Refund unique / idempotency: `DB-PAY-*`
- Slot GiST / lock / unique: `DB-KRK-*`
- Goods counter / Handoff one-to-one: `DB-GDS-*`
- Review case: `DB-XFN-*`

### API

- Base `/api/v1`
- namespace `admin/staff`
- cursor pagination
- common error envelope
- `API-STF-CHK-001〜002`
- `API-STF-GDS-001`
- `API-ADM-ORD-*`, `API-ADM-TKT-*`, `API-ADM-KRK-*`, `API-ADM-GDS-*`, `API-ADM-PAY-001`, `API-ADM-TQR-001`, `API-ADM-REC-*`
- `API-ADM-EML-001〜005`

### Email

- Notification State `PENDING|SENT|FAILED_RETRYABLE|CANCELED`
- Processing State `READY|CLAIMED|UNKNOWN_RESULT|BLOCKED|CLOSED`
- `EML-RCP-*`, `EML-RTY-*`, `EML-CAN-*`

---

# Part XXII — Acceptance Conditions

## 71. SPEC-130 acceptance checklist

本仕様に従う実装は少なくとも次を満たさなければならない。

1. `/admin/*` と `/staff/*` が一般利用者Routeから論理分離される。
2. Admin / Staff Page guardが存在し、Hono API authorizationを代替しない。
3. `ADMINISTRATOR` は `STAFF` を自動継承しない。
4. Role / CapabilityをClient申告値から決めない。
5. Internal bigint IDをURL / UIへ露出しない。
6. Browser / Next.js WebからBusiness Databaseを直接更新しない。
7. Order / Ticket / Reservation / Goods / NotificationのDomain Stateをgeneric editorで変更しない。
8. Refundはfull refund onlyであり、partial amount inputが存在しない。
9. Refund result unknownをsuccess表示しない。
10. Entry Ticket detailにQR raw tokenを表示しない。
11. QR rotationはcompromise recoveryに限定し、Ticket Stateを変更しない。
12. Karaoke `SOLD -> AVAILABLE` actionが存在しない。
13. Reservation cancellation後もSlotを`SOLD`として表示する。
14. Staff Check-in outcomeをrenameしない。
15. `ALREADY_USED`を`CHECKED_IN`として表示しない。
16. `OUTSIDE_CHECKIN_WINDOW`に通常Staff overrideを提供しない。
17. StaffへCustomer全履歴を表示しない。
18. Goods Inventory mutationでClient表示counterをAuthorityにしない。
19. Role Assignment UIでpermission checkbox editorを提供しない。
20. self Administrator revoke / last Administrator lossを通常UIで成立させない。
21. Consistency Reviewを通常成功へ混ぜない。
22. `recovery.exception.execute`をgeneric superuser bypassとして利用しない。
23. Notification Domain State / Processing Stateを変更しない。
24. `SENT` Notificationへretry UIを提供しない。
25. `UNKNOWN_RESULT` Notificationをblind resend / cancelしない。
26. `202 RETRY_SCHEDULED`を`SENT`として表示しない。
27. DB / Stripe / Resend / Auth failureをempty / successへ変換しない。
28. High-risk actionにconfirmation / submitting / result classificationがある。
29. important mutationがAudit-ready contextを持つ。
30. UCRが必要な領域を非Canonical direct DB accessや仮endpointで穴埋めしない。

---

# Part XXIII — Upstream Change Requests

## 72. UCR-130-001 — Sales management Capability不足

- **対象:** `SPEC-060 Authentication / Authorization`
- **現在の仕様:** `FR-ADM-014` はEntry Ticket販売条件管理、`FR-ADM-015` はKaraoke販売条件管理を要求する。一方、現行Capability Matrixには `tickets.manage.read` と `karaoke_slots.manage` は存在するが、Entry Ticket Offeringの販売条件mutationを許可するCapability、およびKaraoke Sales Configurationの価格・販売期間・購入制限mutationを明示するCapabilityが存在しない。`recovery.exception.execute` はgeneric管理権限として使用できない。
- **要求する変更:** 通常Administrator operationとして、少なくとも次の2Capabilityを追加し、active `ADMINISTRATOR` のみAllowとする。
  - `entry_sales.manage`: Entry Ticket Offeringの上流許可販売条件管理
  - `karaoke_sales.manage`: Karaoke Sales Configurationの上流許可販売条件管理
- **理由:** read-only capabilityをmutationへ拡張解釈するとCapability名とPermission Matrixの意味を破壊する。`recovery.exception.execute`を通常設定管理へ流用することもAR-ROLE-014に違反する。
- **変更しない場合の影響:** `PG-ADM-006` / `PG-ADM-012` のmutationを安全に認可できず、`FR-ADM-014〜015` を完成システムとして満たせない。
- **影響を受ける可能性がある仕様書:** `SPEC-110`, `SPEC-130`, `SPEC-140`, `SPEC-160`, `SPEC-170`。

## 73. UCR-130-002 — Entry / Karaoke Sales Configuration Admin API不足

- **対象:** `SPEC-110 API Specification`
- **前提:** `UCR-130-001` のCapabilityが `SPEC-060` へCanonical化されること。
- **現在の仕様:** Public read APIはEntry Offering / Karaoke Sales Guideを持つが、`FR-ADM-014〜015` を満たすAdmin sales configuration read / update operationがAdmin API catalogに定義されていない。
- **要求する変更:** `/api/v1/admin` namespaceへ、次の意味を持つ明示的server operationを追加する。正確なOperation ID / Zod schemaはSPEC-110がCanonical化する。
  - Entry Ticket Offering list/detail read
  - Entry Ticket Offering allowlisted sales field update
  - Karaoke Sales Configuration list/detail read
  - Karaoke Sales Configuration allowlisted sales field update
- **最低限のmutation rule:** Client price / counterをAuthorityにしない、existing Order snapshotを変更しない、held + committed > capacityとなる変更を拒否、standard Karaoke 15+5はread-only、Idempotency / current state conflict contractを明示する。
- **推奨route shape（SPEC-110採否対象）:**
  - `GET /api/v1/admin/entry-offerings`
  - `GET/PATCH /api/v1/admin/entry-offerings/{offering_ref}`
  - `GET /api/v1/admin/karaoke/sales-configurations`
  - `GET/PATCH /api/v1/admin/karaoke/sales-configurations/{sales_configuration_ref}`
- **理由:** SPEC-130がAPI Canonical Ownerを越えてendpointを発明せず、Browser direct DB更新なしでFRを満たすため。
- **変更しない場合の影響:** `PG-ADM-006`, `PG-ADM-012` はread-only説明画面にしかできず、正式要件を満たさない。
- **影響を受ける可能性がある仕様書:** `SPEC-060`, `SPEC-100`, `SPEC-130`, `SPEC-140`, `SPEC-160`, `SPEC-170`。

## 74. UCR-130-003 — Goods Handoff operational read / Admin manage API不足

- **対象:** `SPEC-110 API Specification`
- **現在の仕様:** Staffには `POST /staff/goods-handoffs/{goods_item_ref}/complete` があるが、completion前のtarget summary readがなく、Administratorの `goods_handoff.manage` に対応するlist/detail/許可mutation APIが定義されていない。
- **要求する変更:** 新Capabilityは追加せず、既存 `goods_handoff.execute` / `goods_handoff.manage` に次を接続する。
  - Staff: Goods Item Public Referenceから、completion前に最小Handoff target summaryを取得するread operation
  - Administrator: Goods Handoff list / detail read
  - Administrator: `SPEC-030` / `SPEC-060` が許可する範囲だけの明示command。generic state editは禁止
- **Staff response boundary:** Goods name / quantity / item state / Handoff state / minimal Customer operational referenceのみ。Customer全履歴を返さない。
- **理由:** Staffが誤対象を確認せず不可逆completionを直接実行するUXを避け、`FR-ADM-017` と `goods_handoff.manage` を実装可能にするため。
- **変更しない場合の影響:** `PG-STF-006` の事前確認、`PG-ADM-015〜016` が安全に実装できない。
- **影響を受ける可能性がある仕様書:** `SPEC-100`, `SPEC-130`, `SPEC-140`, `SPEC-160`, `SPEC-170`。

## 75. UCR-130-004 — Admin list filter query contract明示不足

- **対象:** `SPEC-110 API Specification`
- **現在の仕様:** cursor paginationとallowlist filter原則は定義されるが、多くのAdmin list operationで具体的query parameter schemaが固定されていない。
- **要求する変更:** 本書§51で定義したoperational filter semanticsを、各既存list endpointのZod allowlist queryへ具体化する。任意column / raw SQL / arbitrary sortは導入しない。
- **特に必要:** Order, Entry Ticket, Karaoke Slot, Karaoke Reservation, Goods, Goods Handoff, Role Assignment, Consistency Reviewのexact ref / state / date-range / relation-ref filter。
- **理由:** `FR-ADM-004,008,009,013` 等をAI実装時に推測させず、ClientとAPIでfilter contractを一致させるため。
- **変更しない場合の影響:** UI filterを実装してもAPI contract上非Canonicalとなるか、Client-side全件filterという誤実装を招く。
- **影響を受ける可能性がある仕様書:** `SPEC-100`, `SPEC-130`, `SPEC-140`, `SPEC-170`。

## 76. UCR-130-005 — Operational query index追加

- **対象:** `SPEC-100 Database Design`
- **前提:** `UCR-130-003〜004` および `UCR-130-006` のquery/read contractがSPEC-110へCanonical化されること。
- **現在の仕様:** Admin Order用state/purpose index、Karaoke Reservation state/time、pending Handoff、unresolved Review等はあるが、SPEC-130でCanonical化した全Admin filterを安定したcursor queryで支えるindexは網羅されていない。
- **要求する変更:** 実際のquery planとselectivityを確認したうえで、少なくとも次のoperational access patternを支えるnamed indexを追加する。
  - Entry Ticket: `(state, issued_at DESC)` と必要なrelation lookup
  - Karaoke Slot: `(state, usage_start)` / Scope + timeは既存indexを再利用
  - Goods Handoff: `(state, created_at DESC)`（pending partialだけでなくhistory filter用）
  - Role Assignment: `(state, role, granted_at DESC)` または同等cursor-supporting index
  - Consistency Review: reason category + opened timeが高頻度運用queryになる場合のcomposite index
  - Notification Admin search: `SPEC-120` support table / Notification Requestでstate/type/processing state filterを支えるindexを、既存queue indexと重複しない形で追加
- **理由:** 長期運用のAdmin listで全件scan / Client-side filterを標準化せず、cursor paginationを安定させるため。
- **変更しない場合の影響:** Data量増加時にAdmin運用queryが不安定になり、DB load / timeoutが運用障害化する可能性がある。
- **影響を受ける可能性がある仕様書:** `SPEC-110`, `SPEC-120`, `SPEC-130`, `SPEC-150`, `SPEC-160`, `SPEC-170`, `SPEC-180`。

---

## 77. UCR-130-006 — Admin read contract completeness

- **対象:** `SPEC-110 API Specification`
- **現在の仕様:** Administrator mutation endpointは一部定義されているが、SPEC-130の直接URL再訪・state再取得・安全なconfirmationに必要なAdmin read operationが不足している。具体的にはKaraoke Slot list/detail、Slot generationで選択するExclusive Scope read、Goods detail、Admin Event current value、DRAFT/ARCHIVEDを含むFAQ / Announcement list/detailが明示されていない。Public APIは公開済み情報だけを返すためAdmin編集状態のAuthorityとして代用できない。
- **要求する変更:** 既存Capabilityを使用し、少なくとも次のread operationをSPEC-110へ追加する。
  - `karaoke_slots.manage`: Karaoke Slot list / detail、およびSlot generationに必要なExclusive Scopeのallowlisted list/read
  - `goods_inventory.manage`: Goods detail read
  - `public_content.manage`: Admin Event current read、FAQ list/detail、Announcement list/detail（`DRAFT|PUBLISHED|ARCHIVED`をAdmin authorization後に取得可能）
- **最低限のresponse rule:** Public Referenceのみをaddressable IDとし、Internal ID、raw QR token、secret、provider raw bodyを返さない。listはSPEC-110 cursor paginationを使用し、filterはUCR-130-004のallowlistに従う。
- **理由:** High-risk mutation前後のcurrent state再取得、direct URL reload、unsaved/concurrent edit recoveryをBrowser cacheやPublic APIだけに依存させないため。
- **変更しない場合の影響:** `PG-ADM-007〜009`, `PG-ADM-014`, `PG-ADM-018〜020` をCanonical APIだけで完成実装できず、state確認・競合UX・DRAFT編集が不完全になる。
- **影響を受ける可能性がある仕様書:** `SPEC-100`, `SPEC-130`, `SPEC-140`, `SPEC-160`, `SPEC-170`。

---

## 78. 最終確認

本書は次を意図的に追加していない。

- Administrator generic superuser
- Administrator → Staff role inheritance
- Customer Operational Role
- arbitrary state editor
- partial refund
- sold Karaoke Slotのresale
- Check-in override capability
- Email SENT resend
- Unknown Provider Result blind retry
- raw QR token display
- Client-authoritative inventory / price / role
- direct Business Database mutation from Web

Upstream Change Requestを除き、添付された上流仕様間のState / Rule / API contractを無言で変更していない。
