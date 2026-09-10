---
spec_id: SPEC-050
title: Page and Screen Specification
version: 1.0.0
status: provisional
depends_on:
  - SPEC-000
  - SPEC-020
  - SPEC-030
  - SPEC-040
related_specs:
  - SPEC-010
  - SPEC-060
  - SPEC-070
  - SPEC-080
  - SPEC-090
  - SPEC-100
  - SPEC-110
  - SPEC-120
  - SPEC-130
  - SPEC-140
  - SPEC-150
  - SPEC-160
  - SPEC-170
  - SPEC-200
---

# 050 Page / Screen Specification

## 1. 目的

本書は、**off r39'x in 大阪らへん2027** Webシステムの完成形における、一般利用者向けWeb UIのPage / Screen、URL / Route、Navigation、主要表示情報、主要Action、画面状態、Domain State別表示、User Flow間遷移を定義する。

本書は `SPEC-020 Functional Requirements`、`SPEC-030 Domain Model & Business Rules`、`SPEC-040 User Flows` を変更・弱化せず、それらを実装可能かつE2E test可能なWeb画面へ変換するCanonical Ownerである。`SPEC-010 System Overview` で定義されたActor、System Boundary、System Invariantは、上流仕様から参照される範囲を維持する。

本書がCanonical Ownerとなるのは少なくとも以下である。

- 一般利用者向けPage / Screen一覧と一意なPage ID
- 一般利用者向けURL / Route
- Page間Navigation
- 各Pageの目的、対象Actor、認証要否
- 各Pageの主要Section、表示Fieldの論理的意味、主要Action
- ActionのEnabled / Disabled / Hidden条件
- Loading / Empty / Error / Pending / Success / Recoveryの画面表現
- Order、Ticket、Reservation、Karaoke Slot / Hold、Goods Order Item / HandoffのCanonical Stateに対応する利用者向け表示
- Guestが認証必須操作へ進んだ際の認証要求と利用目的の継続
- Mypageにおける本人所有Dataのみの表示境界
- Browser ReturnとBusiness Database上のBusiness Confirmationの画面上の分離
- Responsive WebおよびAccessibility上の最低要件
- `FR-*`、`BR-*`、`DI-030-*`、`UF-*`、`INV-010-*` へのTraceability

本書はRole Permission Matrix、Session内部形式、Stripe Event別処理、API Endpoint / Request / Response / HTTP Status、QR Token内部形式、Karaoke Hold具体秒数、DB Table / Column / Index、Email Template、Administrator / Staff個別運用画面、Recovery Runbookを定義しない。

## 2. 適用範囲

本書は以下の一般利用者向けUIへ適用する。

- 公開Event情報
- Announcement
- Entry Ticket販売・購入開始
- Karaoke販売案内、対象日、1時間単位空き状況、Slot選択、購入開始
- Goods一覧、Goods購入判断、購入開始
- Account登録、Email確認、Login、Logout、Password reset
- 外部決済へ進む購入試行とBrowser Return後のOrder状態確認
- Mypage Overview、Business Profile、Order、Entry Ticket / QR、Karaoke Reservation / Ticket / QR、Goods / Handoff
- Not Found、Authentication required、Authorization / Ownership failure、外部Service一時障害等の一般利用者向け結果

Administrator / Staff向け個別運用画面は `SPEC-130` がCanonical Ownerである。本書は一般利用者領域とのNavigation / Access boundaryと、Customerが当日受付・Goods Handoffで提示または確認する側のUIだけを扱う。

## 3. 前提・依存仕様

- `SPEC-000 Specification Governance`: Canonical Owner、依存関係、仕様決定、Upstream Change Request、識別子等の最上位規則
- `SPEC-020 Functional Requirements`: `FR-*` のCanonical Owner
- `SPEC-030 Domain Model & Business Rules`: Domain Entity、Canonical State、`BR-*`、`DI-030-*` のCanonical Owner
- `SPEC-040 User Flows`: `UF-*`、Success / Failure / Pending / Retry / Resume / RecoveryのCanonical Owner
- `SPEC-010 System Overview`: Actor、System Boundary、System of Record、`INV-010-*` を確認する関連上流仕様

本書は上流Stateを別のBusiness Stateへ再定義しない。画面上では利用者向け日本語ラベルを使用してよいが、必ず対応Canonical Stateを明示する。

## 4. Canonical UI Terms

| Term | 本書での意味 |
|---|---|
| Page | Browser URL / Routeに対応し、単独でNavigation対象となる一般利用者向け画面 |
| Screen State | 同一Page内でDomain State、取得状態、Action結果等に応じて切り替わる表示状態 |
| Public Reference | URLで使用可能な対象参照値。内部DB識別子をそのままセキュリティ境界にはしない |
| Continuation Intent | Guestが認証前に開始した論理的な利用目的。認証後に安全なRouteへ戻すための情報 |
| Purchase Status Page | 外部Checkout前後を含め、既存OrderのCanonical Stateを確認するPage |
| Business Confirmation | Business Database上でOrder `CONFIRMED` と必須権利生成が成立した状態 |
| Browser Return | 外部決済からBrowserが戻った事実。Business Confirmationではない |
| Ownership-safe Detail | 対象識別子だけで表示せず、認証IdentityとOwner関係のServer-side検証を通過した場合だけ表示する詳細Page |
| Inline Failure | Page全体ではなく、取得失敗またはAction失敗したSection内で示す失敗状態 |

## 5. URL / Route設計原則

### 5.1 Route namespace

一般利用者向けRouteは次のnamespaceを使用する。

- 公開Event情報: `/`, `/announcements/*`
- Entry Ticket: `/entry`
- Karaoke: `/karaoke/*`
- Goods: `/goods/*`
- Authentication / Account: `/account/*`
- 購入状態: `/purchase/orders/*`
- Mypage: `/mypage/*`
- System error surface: unmatched routeまたは認証・認可結果に対応する専用画面

### 5.2 Identifier rule

`{announcement_ref}`、`{slot_ref}`、`{goods_ref}`、`{order_ref}`、`{ticket_ref}`、`{reservation_ref}`、`{goods_item_ref}` は、Browserから対象を参照するための値であり、**知っていること自体を権限根拠にしてはならない**。

- 公開対象EntityのReferenceは公開に適した識別子を使用する。
- Owner限定EntityのReferenceは推測困難性だけに依存せず、Server-side Ownership検証を必須とする。
- 内部DB主キーをそのまま公開するかどうか、Referenceの具体形式は `SPEC-100` / `SPEC-110` と整合させるが、本書のRoute意味は変更しない。
- URL QueryやContinuation IntentにSecret、Credential、QR Token、支払機微情報を含めない。

### 5.3 RouteとAPIの分離

本書のRouteはBrowser NavigationのCanonical定義であり、API Endpoint構造を意味しない。Route名をそのままAPI pathへ複製する必要はない。

## 6. Page ID体系

| Prefix | Category |
|---|---|
| `PG-PUB-*` | 公開Event / Announcement |
| `PG-AUTH-*` | Account / Authentication |
| `PG-TKT-*` | Entry Ticket販売 |
| `PG-KRK-*` | Karaoke販売・Slot選択 |
| `PG-GDS-*` | Goods販売 |
| `PG-MYP-*` | Mypage / Owner限定Data |
| `PG-XFN-*` | Purchase status / Cross-functional / System failure |

同じPageへ複数IDを割り当てず、同じIDを別Pageへ再利用しない。

## 7. Page一覧

| Page ID | Page名 | Route | Primary Actor | Auth | 主なUF |
|---|---|---|---|---|---|
| `PG-PUB-001` | Event Home | `/` | Guest / Authenticated User | 不要 | `UF-PUB-001` |
| `PG-PUB-002` | Announcement List | `/announcements` | Guest / Authenticated User | 不要 | `UF-PUB-001` |
| `PG-PUB-003` | Announcement Detail | `/announcements/{announcement_ref}` | Guest / Authenticated User | 不要 | `UF-PUB-001` |
| `PG-TKT-001` | Entry Ticket Sales | `/entry` | Guest / Authenticated User | 閲覧不要、購入開始は必要 | `UF-PUB-001`, `UF-PUB-002`, `UF-TKT-001` |
| `PG-KRK-001` | Karaoke Sales Guide | `/karaoke` | Guest / Authenticated User | 閲覧不要 | `UF-PUB-001`, `UF-KRK-001` |
| `PG-KRK-002` | Karaoke Day Schedule | `/karaoke/schedule/{date}` | Guest / Authenticated User | 閲覧不要 | `UF-KRK-001` |
| `PG-KRK-003` | Karaoke Slot Detail | `/karaoke/slots/{slot_ref}` | Guest / Authenticated User | 閲覧不要、購入開始は必要 | `UF-PUB-002`, `UF-KRK-001`, `UF-KRK-002` |
| `PG-GDS-001` | Goods List | `/goods` | Guest / Authenticated User | 閲覧不要 | `UF-PUB-001`, `UF-GDS-001` |
| `PG-GDS-002` | Goods Detail / Purchase | `/goods/{goods_ref}` | Guest / Authenticated User | 閲覧不要、購入開始は必要 | `UF-PUB-002`, `UF-GDS-001` |
| `PG-AUTH-001` | Account Registration | `/account/register` | Guest | 不要 | `UF-AUTH-001`, `UF-PUB-002` |
| `PG-AUTH-002` | Email Verification | `/account/email-verification` | Account登録済みUser | 条件依存 | `UF-AUTH-002` |
| `PG-AUTH-003` | Login | `/account/login` | Guest | 不要 | `UF-AUTH-003`, `UF-PUB-002`, `UF-AUTH-007` |
| `PG-AUTH-004` | Password Reset Request | `/account/password-reset` | Guest / Login不能User | 不要 | `UF-AUTH-005`, `UF-AUTH-007` |
| `PG-AUTH-005` | Password Reset Completion | `/account/password-reset/complete` | Reset Flow中User | 認証基盤の正規reset contextを必要とする | `UF-AUTH-005` |
| `PG-XFN-001` | Purchase Status | `/purchase/orders/{order_ref}` | Authenticated User / Customer | 必要 | `UF-TKT-001`, `UF-KRK-002`, `UF-GDS-001`, `UF-XFN-001`, `UF-XFN-003`, `UF-XFN-004` |
| `PG-MYP-001` | Mypage Overview | `/mypage` | Authenticated User / Customer | 必要 | `UF-MYP-001` |
| `PG-MYP-002` | Business Profile | `/mypage/profile` | Authenticated User | 必要 | `UF-AUTH-006`, `UF-MYP-001`, `UF-MYP-002` |
| `PG-MYP-003` | Order List | `/mypage/orders` | Authenticated User | 必要 | `UF-MYP-001` |
| `PG-MYP-004` | Order Detail | `/mypage/orders/{order_ref}` | Authenticated User / Customer | 必要 | `UF-MYP-001`, `UF-MYP-002`, `UF-XFN-001`, `UF-XFN-002`, `UF-XFN-003` |
| `PG-MYP-005` | Entry Ticket List | `/mypage/entry-tickets` | Customer | 必要 | `UF-MYP-001` |
| `PG-MYP-006` | Entry Ticket Detail | `/mypage/entry-tickets/{ticket_ref}` | Customer | 必要 | `UF-MYP-001`, `UF-MYP-002`, `UF-CHK-001` |
| `PG-MYP-007` | Entry QR | `/mypage/entry-tickets/{ticket_ref}/qr` | Customer | 必要 | `UF-MYP-001`, `UF-CHK-001` |
| `PG-MYP-008` | Karaoke Reservation List | `/mypage/karaoke` | Customer | 必要 | `UF-MYP-001`, `UF-KRK-003` |
| `PG-MYP-009` | Karaoke Reservation Detail | `/mypage/karaoke/{reservation_ref}` | Customer | 必要 | `UF-MYP-001`, `UF-MYP-002`, `UF-KRK-003`, `UF-CHK-002` |
| `PG-MYP-010` | Karaoke QR | `/mypage/karaoke/{reservation_ref}/qr` | Customer | 必要 | `UF-MYP-001`, `UF-KRK-003`, `UF-CHK-002` |
| `PG-MYP-011` | Goods Purchase List | `/mypage/goods` | Customer | 必要 | `UF-MYP-001`, `UF-GDS-002` |
| `PG-MYP-012` | Goods Purchase Detail | `/mypage/goods/{goods_item_ref}` | Customer | 必要 | `UF-MYP-001`, `UF-MYP-002`, `UF-GDS-002` |
| `PG-XFN-002` | Not Found | unmatched public/application route | Guest / Authenticated User | 不要 | `UF-PUB-001`, `UF-MYP-002` |
| `PG-XFN-003` | Access Denied / Ownership Failure | authorization failure surface | Authenticated User | 必要 | `UF-MYP-002` |

## 8. Global Navigation

### 8.1 Primary Navigation

全一般利用者向けPageは、ResponsiveなPrimary Navigationから少なくとも以下へ到達可能にする。

- Event: `PG-PUB-001`
- Entry Ticket: `PG-TKT-001`
- Karaoke: `PG-KRK-001`
- Goods: `PG-GDS-001`
- AccountまたはMypage

### 8.2 Guest表示

Guestには以下を表示する。

- Event
- Entry Ticket
- Karaoke
- Goods
- Login
- Account登録

GuestにMypage内の本人Dataリンク、Logout、Administrator / Staff操作を表示しない。ただしUI非表示は認可境界ではない。

### 8.3 Authenticated User表示

Authenticated Userには以下を表示する。

- Event
- Entry Ticket
- Karaoke
- Goods
- Mypage
- Account menu: Profile、Order、Entry Ticket、Karaoke、Goods、Logout

Customerは独立Roleではないため、「Customer roleを持つからNavigationが解禁される」という実装にしない。各購入Dataが0件でもAuthenticated UserはMypage各一覧へ到達でき、Empty Stateを確認できる。

### 8.4 Administrator / Staff境界

一般利用者Navigationに高権限操作を埋め込まない。Administrator / Staff用の運用領域へのEntry Pointを提供する場合、Server-sideで権限が確認されたActorにだけ補助Linkを表示してよいが、運用領域のRoute・画面・Field・Actionは `SPEC-130` が定義する。Link非表示だけをアクセス制御に使用してはならない。

## 9. 共通Page State仕様

### 9.1 Loading

- Main Contentの初回取得中はLoadingであることを明示する。
- Loading表示中に「0件」「売り切れ」「利用不可」「購入失敗」等のBusiness outcomeを仮表示しない。
- Skeleton等を使用してよいが、確定値に見える金額、在庫数、予約日時を仮データで表示しない。
- Action送信中は対象Actionを重複実行しにくい状態にし、「処理中」をテキストでも示す。

### 9.2 Empty

Emptyは**正常取得が成功し、対象Dataが0件であると確認できた場合だけ**使用する。

例:

- Announcementが0件
- 本人Orderが0件
- 本人Entry Ticketが0件
- 選択日の販売対象Slotが0件

取得失敗をEmptyへ変換してはならない。

### 9.3 Error

Errorは少なくとも次を区別する。

- 公開情報取得Failure
- Authentication failure
- Authorization / Ownership failure
- Purchase start failure
- Checkout start failure
- External Service一時障害
- Not Found

Error表示には、失敗した対象、未成立であるBusiness operation、実行可能なRecovery Actionを示す。内部例外、秘密情報、他者Dataの存在確認につながる情報は表示しない。

### 9.4 Pending

Pendingは成功でも失敗でもない。特にOrder `AWAITING_PAYMENT`、Order `REVIEW_REQUIRED`、外部Serviceによる一時的な確認不能をSuccess UIに流用しない。

### 9.5 Success

購入SuccessはOrder `CONFIRMED` とPurposeごとの必須権利成立をBusiness Databaseから取得できた場合だけ表示する。Browser Return、外部Checkout画面の文言、Client保持値だけを根拠にSuccessへ遷移しない。

### 9.6 Retry / Resumeの4分類

| UI Action | 意味 | 新しいOrder等を作るか |
|---|---|---|
| 状態を再確認 | 同一Order / 同一Entityの現在状態を再取得 | 作らない |
| 支払い開始を再試行 | `PREPARED` の同一OrderでCheckout開始だけを再試行 | 新Orderを作らない |
| もう一度購入する | TerminalなOrder後に現在の販売条件から新しいBusiness Attemptを開始 | 新Orderを作る |
| Slotを選び直す | Hold失効・競合後に現在の空き状況から新しいSlot / Holdを取得する | 新Hold、新Orderになり得る |

Button labelと処理意味を混同してはならない。

## 10. Authentication Continuation

### 10.1 Guestが認証必須Actionを開始した場合

GuestがEntry / Karaoke / Goods購入、Mypage等の認証必須Actionを開始した場合、`PG-AUTH-003` Loginまたは `PG-AUTH-001` Account Registrationへ遷移する。

認証要求UIは次を明示する。

- 当該操作にはLoginが必要であること
- LoginまたはAccount登録を選べること
- 認証しない場合は元の公開Pageへ戻れること

### 10.2 Continuation Intent

認証前の利用目的は、Secretや購入権利そのものではなく、**論理的な復帰先**として保持する。

例:

- Entry Ticket購入 → `PG-TKT-001` の対象Offering選択へ復帰
- Karaoke Slot購入 → `PG-KRK-003` の対象Slotへ復帰
- Goods購入 → `PG-GDS-002` の対象Goodsへ復帰
- Mypage → `PG-MYP-001` へ復帰

認証完了後も、販売状態、在庫、Slot、Purchase Limitは再検証する。認証前の表示を購入保証として扱わない。

### 10.3 Unsafe continuationの禁止

Continuation Intentに以下を保存して復元してはならない。

- Clientが決めた決済金額
- Clientが決めたOwner
- 支払成功結果
- 期限切れHoldを復活させる情報
- Authorizationを迂回する他者Data参照

## 11. 公開Page仕様

### 11.1 `PG-PUB-001` Event Home

- **Route:** `/`
- **Primary Actor:** Guest / Authenticated User
- **Authentication:** 不要
- **対応UF:** `UF-PUB-001`
- **Purpose:** Event参加判断に必要な公開情報と主要機能への起点を提供する。
- **Entry Condition:** なし。

**Main Content**

1. Event概要Section
   - Event名称
   - 概要
2. 開催日時Section
   - 設定済み開催日時または開催期間
   - 表示Timezoneは `Asia/Tokyo`
3. 会場・アクセスSection
   - 会場名称
   - 会場案内
   - アクセス情報
4. 注意事項Section
   - 公開中の注意事項
5. FAQ Section
   - `PUBLISHED` FAQのみ
   - 質問と回答
6. 最新Announcement Section
   - `PUBLISHED` Announcementの新しいものを抜粋
   - `PG-PUB-002` への導線
7. Sales Shortcut
   - Entry Ticket
   - Karaoke
   - Goods

**Primary Action**

- Entry Ticketを見る → `PG-TKT-001`
- Karaokeを見る → `PG-KRK-001`
- Goodsを見る → `PG-GDS-001`

**State**

- Loading: Sectionごとに未取得表示。
- Empty: FAQ / Announcementが正常に0件の場合のみ「現在公開中の情報はありません」。
- Error: Event基本情報取得FailureはPage-level error。FAQ / Announcement等の部分取得失敗はSection-level errorにして他の正常Sectionを保持してよい。
- 未設定外部事実: 未設定値を推測表示しない。該当Sectionを「未設定」と断定せず、公開対象として返されていない場合は非表示または運営設定に基づく案内にする。

**Navigation In:** すべての一般利用者向けGlobal Navigation。

**Security Boundary:** `DRAFT` / `ARCHIVED` FAQ / Announcementを表示しない。

**Trace:** `FR-PUB-001〜006`, `FR-PUB-011`, `FR-PUB-013〜014`, `BR-EVT-001〜004`, `BR-XFN-001`, `UF-PUB-001`, `INV-010-08`.

### 11.2 `PG-PUB-002` Announcement List

- **Route:** `/announcements`
- **Actor:** Guest / Authenticated User
- **Auth:** 不要
- **対応UF:** `UF-PUB-001`
- **Purpose:** 公開中Announcementを時系列に閲覧できるようにする。

**Fields:** 公開日、タイトル、短い概要または本文冒頭の要約。`PUBLISHED` のみ。

**Action:** Announcement選択 → `PG-PUB-003`。

**State:** Loading、正常0件Empty、取得Failureを区別する。取得Failureを0件表示にしない。

**Trace:** `FR-PUB-006`, `FR-PUB-013`, `BR-EVT-002`, `UF-PUB-001`, `INV-010-08`.

### 11.3 `PG-PUB-003` Announcement Detail

- **Route:** `/announcements/{announcement_ref}`
- **Actor:** Guest / Authenticated User
- **Auth:** 不要
- **対応UF:** `UF-PUB-001`
- **Purpose:** 1件の公開Announcement全文を表示する。

**Fields:** 公開日、タイトル、本文。

**State:** `PUBLISHED` 対象だけ表示可能。存在しない、公開対象でない、公開停止済み等は公開本文を漏らさず `PG-XFN-002` 相当へ遷移する。取得障害はNot Foundと混同せずFailure表示にする。

**Navigation:** 一覧へ戻る、Event Homeへ戻る。

**Trace:** `FR-PUB-006`, `FR-PUB-013`, `BR-EVT-002`, `UF-PUB-001`, `INV-010-08`.

## 12. Entry Ticket Page

### 12.1 `PG-TKT-001` Entry Ticket Sales

- **Route:** `/entry`
- **Actor:** Guest / Authenticated User
- **Auth:** 閲覧不要、購入開始はAuthenticated Userのみ
- **対応UF:** `UF-PUB-001`, `UF-PUB-002`, `UF-TKT-001`
- **Purpose:** Entry Ticketの購入判断、種別・数量選択、購入開始を行う。

**Main Content / Fields**

- Ticket種別名
- 説明
- Server-sideで返された現在価格と通貨
- 販売期間
- 公開上の販売状態
- 販売可能数量に関する利用者向け情報（公開設定で提供される範囲）
- 1 AccountあたりPurchase Limitに関する案内
- 数量Selector
- 選択数量に基づく表示用合計金額。ただし購入時の権威値はServer-side再計算結果

**Canonical State / Condition別表示**

| 条件 | 利用者向け表示 | Purchase Action |
|---|---|---|
| Sales Period開始前 | 販売開始前 + 設定済み開始日時 | Disabled |
| Sales Period内 + `ENABLED` + capacityあり | 販売中 | GuestはLoginへ、Authenticated UserはEnabled |
| Sales Period終了 | 販売終了 | Disabled |
| Sale Control `SUSPENDED` | 販売停止 | Disabled |
| capacity不足 | 売り切れ / 選択数量を確保不可 | Disabledまたは数量変更を要求 |
| Purchase Limit超過 | 購入上限により購入不可 | Disabled |
| 公開情報取得Failure | 状態を取得できない | Disabled |

**Primary Action**

- `購入手続きへ進む`
  - Guest: `PG-AUTH-003` へ。Continuation IntentとしてEntry購入へ戻す。
  - Authenticated User: Server-side再検証とAllocation / Order作成を開始する。

**Action実行中**

- Buttonを処理中状態にする。
- 「購入条件を確認しています」「購入試行を作成しています」等、未確定表示を行う。
- reload / double clickで複数Orderが無条件に作られない前提でUIも重複送信を抑止する。

**Purchase start result**

- 成功してOrder `PREPARED` が作成された場合、`PG-XFN-001` へ遷移するか、そのOrderに対応するCheckout開始へ進む。外部Checkoutへ移る直前は「支払い画面を準備中」であり、購入成功表示をしない。
- Sales Period / Sale Control / capacity / Purchase Limit再検証失敗: 同Pageで現在結果を表示し、選択を更新可能にする。
- Allocation競合 / 売り切れ: 「表示後に販売可能数が変わった」ことを識別できるFailure。再読込または数量変更。
- Checkout開始前のOrder作成Failure: 外部Checkoutへ進めない。
- Checkout開始失敗かつOrder `PREPARED` が存在: `PG-XFN-001` で同一Order retryを提供する。

**Success導線**

本Page自体は購入成功を確定表示しない。成功後は `PG-XFN-001` または `PG-MYP-004` からEntry Ticket / QRへ進む。

**Trace:** `FR-PUB-007`, `FR-PUB-010`, `FR-PUB-012`, `FR-TKT-001〜010`, `FR-TKT-025〜026`, `FR-XFN-001〜003`, `FR-XFN-016`, `FR-XFN-026〜027`, `BR-SAL-001〜007`, `BR-ORD-001〜004`, `BR-TKT-001〜004`, `DI-030-001`, `DI-030-004`, `DI-030-010〜012`, `UF-PUB-002`, `UF-TKT-001`, `INV-010-01`, `INV-010-08〜10`.

## 13. Karaoke Page

### 13.1 `PG-KRK-001` Karaoke Sales Guide

- **Route:** `/karaoke`
- **Actor:** Guest / Authenticated User
- **Auth:** 不要
- **対応UF:** `UF-PUB-001`, `UF-KRK-001`
- **Purpose:** Karaoke販売条件を説明し、対象日選択へ進める。

**Fields**

- Karaoke販売案内
- 価格と通貨
- Sales Period
- Sale Control由来の公開販売状態
- 利用単位
- 標準利用時間15分 + 整備時間5分で運用される旨。ただしCustomerが予約する利用時刻表示は利用時間を中心にする
- Purchase Limit案内
- 販売対象日一覧

**Actions**

- 対象日を選ぶ → `PG-KRK-002`

**State**

- 販売開始前 / 販売終了 / 販売停止を区別する。
- 販売停止でも既存Reservationが取消されたと表示しない。
- 対象日一覧の取得Failureを「対象日なし」と表示しない。

**Trace:** `FR-PUB-008`, `FR-PUB-010`, `FR-KRK-001〜007`, `BR-KRK-001〜003`, `BR-KRK-012`, `BR-XFN-001〜004`, `DI-030-005`, `UF-KRK-001`, `INV-010-04`.

### 13.2 `PG-KRK-002` Karaoke Day Schedule

- **Route:** `/karaoke/schedule/{date}`
- **Route parameter:** `{date}` は `Asia/Tokyo` の対象日を表すcalendar date。
- **Actor:** Guest / Authenticated User
- **Auth:** 不要
- **対応UF:** `UF-KRK-001`
- **Purpose:** 選択日の1時間単位空き状況と個別Slot候補を表示する。

**Main Content**

- 選択日
- 前後の販売対象日へのNavigation
- `usage_start` を基準とする1時間bucket
- 各bucketの総Slot数
- 各bucketの現在購入候補数
- 個別Slotの利用開始・終了時刻
- Slot state由来の購入可否

**1時間bucket表示**

- 例: `10:00 <= usage_start < 11:00` のSlotは10時台bucketへ属する。
- 同一Slotを複数bucketへ重複表示しない。
- `AVAILABLE` かつ現在販売可能なSlotのみ「選択可能」とする。
- `HELD`: 「現在確保中」等の利用者向け表示。購入不可。
- `SOLD`: 「販売済み」。購入不可。
- `SALES_STOPPED`: 「販売停止」。購入不可。

**Actions**

- Slot選択 → `PG-KRK-003`
- 対象日変更 → 同Pageの別 `{date}`
- 空き状況再読込 → 同Page、read retryのみ

**Loading / Empty / Error**

- Loading中に空き0件と表示しない。
- 正常取得してSlotが0件なら「この日に販売対象の枠はありません」。
- 取得Failureなら「空き状況を取得できません」。

**Trace:** `FR-KRK-002〜006`, `FR-XFN-026`, `BR-KRK-001〜005`, `BR-XFN-001〜004`, `DI-030-005`, `UF-KRK-001`, `INV-010-04`, `INV-010-10`.

### 13.3 `PG-KRK-003` Karaoke Slot Detail

- **Route:** `/karaoke/slots/{slot_ref}`
- **Actor:** Guest / Authenticated User
- **Auth:** 閲覧不要、購入開始は必要
- **対応UF:** `UF-PUB-002`, `UF-KRK-001`, `UF-KRK-002`
- **Purpose:** 具体的なKaraoke Slotを確認し、購入開始する。

**Fields**

- 対象日
- `usage_start` / `usage_end` に基づく利用時刻
- 価格・通貨
- Purchase Limit案内
- 現在のSlot state / Sales条件から導出した購入可否

**State / Action**

| Canonical状態 / 条件 | 表示 | Action |
|---|---|---|
| Slot `AVAILABLE` + Sales条件成立 | 予約購入可能 | Guest: Login、Authenticated: `購入手続きへ進む` |
| Slot `HELD` | 他の購入試行で確保中 | Disabled、空き状況へ戻る |
| Slot `SOLD` | 販売済み | Disabled |
| Slot `SALES_STOPPED` | 販売停止 | Disabled |
| Purchase Limit超過 | 購入上限到達 | Disabled |
| Sales Period外 / 全体停止 | 現在購入不可 | Disabled |

**Purchase start**

1. Guestなら認証へ遷移し、認証後に本Slotへ復帰する。
2. Authenticated UserがActionするとServer-sideでSlot current stateとPurchase Limitを再検証する。
3. Hold取得中は「枠を確保しています」と表示する。
4. Hold競合で失敗した場合、「他の利用者が先に確保したため購入を開始できない」と表示し、`PG-KRK-002` へ戻るActionを出す。
5. Hold `ACTIVE` + Order `PREPARED` が成立後、外部Checkout開始へ進む。
6. Checkout開始失敗は `PG-XFN-001` で同一Order retry可能性を表示する。
7. Hold期限切れ後は同じHoldを再利用せず、「枠の確保期限が切れたため選び直してください」とし `PG-KRK-002` へ戻す。

Hold具体秒数、残り秒数の厳密な算出方法は本書で定義しない。期限表示を行う場合も権威判定はServer-side状態に従う。

**Trace:** `FR-KRK-007〜016`, `FR-XFN-001〜003`, `FR-XFN-014`, `FR-XFN-016`, `FR-XFN-026〜027`, `BR-SAL-001〜007`, `BR-ORD-001〜004`, `BR-KRK-003〜007`, `BR-KRK-010`, `DI-030-001`, `DI-030-005`, `DI-030-010〜012`, `UF-PUB-002`, `UF-KRK-002`, `INV-010-01`, `INV-010-04`, `INV-010-08〜10`.

## 14. Goods Page

### 14.1 `PG-GDS-001` Goods List

- **Route:** `/goods`
- **Actor:** Guest / Authenticated User
- **Auth:** 不要
- **対応UF:** `UF-PUB-001`, `UF-GDS-001`
- **Purpose:** 公開Goodsと購入判断情報を一覧表示する。

**Fields per Goods**

- 商品名称
- 公開説明の短縮表示
- 価格・通貨
- 公開販売状態
- 購入可能 / 不可の理由

**Actions:** Goods選択 → `PG-GDS-002`。

**State:** 販売期間外、販売停止、売り切れを区別する。取得Failureを商品0件と表示しない。

**Trace:** `FR-PUB-009〜010`, `FR-GDS-001〜002`, `BR-GDS-001`, `BR-SAL-003〜005`, `UF-PUB-001`, `UF-GDS-001`, `INV-010-09`.

### 14.2 `PG-GDS-002` Goods Detail / Purchase

- **Route:** `/goods/{goods_ref}`
- **Actor:** Guest / Authenticated User
- **Auth:** 閲覧不要、購入開始は必要
- **対応UF:** `UF-PUB-002`, `UF-GDS-001`
- **Purpose:** Goods詳細、数量選択、購入開始を行う。

**Fields**

- 商品名称
- 公開説明
- 価格・通貨
- Sales Period
- 公開販売状態
- 会場受け取り商品であること
- 数量Selector
- 表示用合計金額

配送先住所、配送業者、配送追跡Fieldを追加しない。

**State / Action**

| 条件 | 表示 | Purchase Action |
|---|---|---|
| 販売中 + 在庫確保可能 | 購入可能 | Guest: Login、Authenticated: Enabled |
| Sales Period外 | 販売期間外 | Disabled |
| Sale Control `SUSPENDED` | 販売停止 | Disabled |
| 在庫0 / 選択数量不足 | 売り切れ / 在庫不足 | Disabledまたは数量変更 |
| 取得Failure | 購入可否を確認できない | Disabled |

**Purchase start / Conflict**

- 購入開始時にServer-sideで販売条件とInventoryを再検証する。
- Inventory競合でAllocationを取得できなければ、「在庫状況が変わり、選択数量を確保できない」と表示する。
- Allocation `HELD` + Order `PREPARED` 後にCheckout開始する。
- Checkout開始失敗は同一 `PREPARED` Orderを `PG-XFN-001` で扱う。
- `PENDING_PAYMENT` Goods Order Itemを受け取り可能と表示しない。

**Trace:** `FR-GDS-001〜008`, `FR-GDS-011`, `FR-GDS-016〜017`, `FR-XFN-001〜003`, `FR-XFN-016`, `FR-XFN-026〜027`, `BR-SAL-001〜008`, `BR-ORD-001〜004`, `BR-GDS-001〜006`, `BR-GDS-009`, `DI-030-001`, `DI-030-006`, `DI-030-010〜012`, `UF-GDS-001`, `INV-010-01`, `INV-010-08〜10`.

## 15. Authentication Page

### 15.1 `PG-AUTH-001` Account Registration

- **Route:** `/account/register`
- **Actor:** Guest
- **Auth:** 不要
- **対応UF:** `UF-AUTH-001`, `UF-PUB-002`
- **Purpose:** Supabase Authを利用するAccount登録を開始する。

**Fields**

- Email address
- Password
- Password確認入力

Passwordの具体Policy、Credential処理、Session構築は `SPEC-060` が定義する。本PageはPasswordをBusiness Databaseへ保存しない。

**Actions**

- Account登録
- Loginへ → `PG-AUTH-003`
- Continuation Intentがある場合は「認証後に元の操作へ戻る」旨を表示

**Success**

- Email確認が必要: `PG-AUTH-002` へ。
- 認証基盤上で利用可能状態まで成立し、上流Rule上許可される場合: Continuation Intentの安全な復帰先へ。

**Failure**

- 入力validation errorは対象Fieldと関連付ける。
- Auth Service rejectionはAccount登録未成立として表示する。
- Auth Service一時障害は「登録を完了できない」とし、購入等を認証済みとして進めない。

**Trace:** `FR-AUTH-001〜003`, `FR-AUTH-008〜009`, `FR-EML-001`, `BR-USR-001`, `DI-030-010`, `UF-AUTH-001`, `UF-AUTH-007`, `INV-010-08`.

### 15.2 `PG-AUTH-002` Email Verification

- **Route:** `/account/email-verification`
- **Actor:** Account登録済みUser
- **Auth:** Email確認Flowの状態による
- **対応UF:** `UF-AUTH-002`
- **Purpose:** Email確認待ち、確認成功、確認失敗を区別する。

**Screen States**

- Confirmation required: 確認Emailの操作が必要であることを表示。
- Verifying: 認証基盤の確認処理中。
- Verified: 確認成功。LoginまたはContinuation先へ。
- Invalid / Expired verification: 確認未成立。確認済みと表示しない。
- Auth Service unavailable: 確認結果を確定できない。再試行可能な障害として表示。

確認失敗を理由に既存Business Profileや確定済み購入を削除したと表示してはならない。

**Trace:** `FR-AUTH-002〜003`, `FR-EML-001`, `BR-USR-001`, `UF-AUTH-002`, `UF-AUTH-007`, `INV-010-08`.

### 15.3 `PG-AUTH-003` Login

- **Route:** `/account/login`
- **Actor:** Guest / 登録済みUser
- **Auth:** 不要
- **対応UF:** `UF-AUTH-003`, `UF-PUB-002`, `UF-AUTH-007`
- **Purpose:** Loginし、必要に応じて認証前の利用目的へ復帰する。

**Fields:** Email address、Password。

**Actions**

- Login
- Password reset → `PG-AUTH-004`
- Account登録 → `PG-AUTH-001`
- 認証を中止して元の公開Pageへ戻る

**Authentication-required variant**

Continuation Intentがある場合、Page上部に「この操作にはLoginが必要」と対象目的を安全な一般名称で示す。対象の価格・在庫・Slot確保を認証前のまま保証しない。

**Failure**

- Credential failure: Login未成立。Business operationへ進めない。
- Auth Service unavailable: 未検証UserをAuthenticated Userとして扱わない。
- 失敗時にCredentialのどの要素が一致したかを不必要に開示しない。

**Success / Navigation Out**

- Continuation Intentあり: 現在状態を再取得した元の論理Pageへ。
- なし: `PG-MYP-001`。

**Trace:** `FR-AUTH-004〜005`, `FR-AUTH-009`, `FR-AUTH-014`, `FR-PUB-012`, `FR-XFN-001〜003`, `BR-USR-001`, `DI-030-010`, `UF-AUTH-003`, `UF-PUB-002`, `UF-AUTH-007`, `INV-010-08`.

### 15.4 `PG-AUTH-004` Password Reset Request

- **Route:** `/account/password-reset`
- **Actor:** Guest / Login不能User
- **Auth:** 不要
- **対応UF:** `UF-AUTH-005`, `UF-AUTH-007`
- **Purpose:** Supabase AuthのPassword resetを開始する。

**Fields:** Email address。

**Action:** Password resetを要求。

**Success:** 認証基盤が要求を受理したことを示す。Account存在の不必要な露呈を避ける具体文言は `SPEC-060` / `SPEC-140` と整合させる。

**Failure:** Auth Service障害時はreset未完了を示す。Business Databaseへ代替Credentialを保存しない。

**Trace:** `FR-AUTH-007〜009`, `FR-EML-001`, `BR-USR-001`, `UF-AUTH-005`, `UF-AUTH-007`, `INV-010-08`.

### 15.5 `PG-AUTH-005` Password Reset Completion

- **Route:** `/account/password-reset/complete`
- **Actor:** 正規Password reset Flow中User
- **Auth:** 認証基盤のreset contextを必要とする
- **対応UF:** `UF-AUTH-005`
- **Purpose:** Passwordを更新し、通常Loginへ復帰する。

**Fields:** New Password、Password確認入力。

**State:** valid reset context / invalid or expired context / submitting / success / service failure。

**Success:** `PG-AUTH-003` へ。Password resetは既存Order / Ticket / Reservation / GoodsのOwnerを変更しない。

**Trace:** `FR-AUTH-007〜009`, `FR-EML-001`, `BR-USR-001`, `BR-USR-006`, `DI-030-010`, `UF-AUTH-005`, `INV-010-08`.

### 15.6 Logout UI

Logoutは専用Pageを持たない。Authenticated UserのAccount menuから実行する。

- Action実行後、認証SessionがLogoutされた結果を受けたら `PG-PUB-001` へ遷移する。
- 既存Order、Ticket、Reservation、Goods購入を削除・取消したように表示しない。
- Logout後にBrowser back等で保護Pageへ戻ろうとした場合は、保護Dataを再表示せずLoginへ遷移する。

Trace: `FR-AUTH-006`, `UF-AUTH-004`, `INV-010-01`, `INV-010-08`.

## 16. Purchase Status Page

### 16.1 `PG-XFN-001` Purchase Status

- **Route:** `/purchase/orders/{order_ref}`
- **Actor:** Authenticated User / Customer
- **Auth:** 必要
- **対応UF:** `UF-TKT-001`, `UF-KRK-002`, `UF-GDS-001`, `UF-XFN-001`, `UF-XFN-003`, `UF-XFN-004`
- **Purpose:** 外部Checkoutへ進む前の既存Order、Browser Return後、Mypageからの再確認を同一Order単位で表示し、Browser ReturnとBusiness Confirmationを分離する。
- **Entry Condition:** Server-side Ownership検証を通過した既存Orderがあること。

### 16.2 Main Fields

- Order purpose: Entry / Karaoke / Goods
- 購入対象の表示名と数量またはSlot日時
- Server-side価格Snapshotに基づく合計金額・通貨
- Canonical Order State
- Order作成時刻
- 現在の利用者向けOutcome
- 確定済みの場合のみ、対応権利への導線
- 利用可能な場合のみReceipt情報への導線
- Notification `FAILED_RETRYABLE` 等が利用者へ通知可能な場合の非阻害Banner

内部Stripe Event名、Webhook ID、内部DB IDを一般利用者向け主要Fieldとして表示しない。

### 16.3 Browser Return

外部Checkoutの成功側・取消側いずれのBrowser Returnでも、最初に同じOrderのBusiness Database stateを取得する。Browser Returnの種類だけで以下を断定してはならない。

- 「支払い完了」
- 「Ticket発行済み」
- 「Reservation確定」
- 「Goods受け取り可能」

### 16.4 Order State別UI

| Canonical Order State | 利用者向けPrimary Label | 表示要件 | Primary / Recovery Action |
|---|---|---|---|
| `PREPARED` | 支払い手続き未開始 / 準備済み | Orderは記録済み、購入確定ではない | 必要Allocation / Holdが有効な場合のみ「支払い画面を開く / 再試行」。無効なら新規購入へ |
| `AWAITING_PAYMENT` | 支払い結果を確認中 | Ticket / Reservation / `FULFILLABLE` を表示しない | 「状態を再確認」。新Orderを作らない |
| `CONFIRMED` | 購入確定 | Purposeごとの確定権利、Order詳細、Receipt導線 | 「購入内容を見る」「Ticket / Reservation / Goodsを見る」 |
| `PAYMENT_FAILED` | 支払い不成立 | 有効権利なし | 「もう一度購入する」= 新Orderを開始 |
| `CANCELED` | 購入手続き取消済み | 有効権利なし | 「もう一度購入する」= 新Order |
| `EXPIRED` | 購入手続き失効 | 有効権利なし | 「もう一度購入する」。Karaokeは新Slot / Hold取得から |
| `REVIEW_REQUIRED` | 購入状態を確認中 | 通常成功と表示しない。未確定権利を有効表示しない | 「状態を再確認」。新権利生成につながるretryを出さない |

### 16.5 Domain-specific `CONFIRMED` content

**Entry**

- Order `CONFIRMED`
- 購入数量分のEntry TicketへのLink
- Entry QRは各Ticket detailから表示

**Karaoke**

- Order `CONFIRMED`
- Reservation `CONFIRMED`
- Reservation日時
- Karaoke TicketへのLink

**Goods**

- Order `CONFIRMED`
- Goods Order Item `FULFILLABLE` または後続の `CANCELED`
- Goods Handoff state
- 会場受け取り導線

### 16.6 Checkout開始失敗

Orderが `PREPARED` のままでCheckout開始だけが失敗した場合:

- 「支払い画面を開始できませんでした。購入は確定していません」と表示する。
- 同一Order retry可能性がある場合だけ「支払い開始を再試行」。
- retry前にAllocation / Holdが無効になった場合、同じOrderを支払待ちへ進めず、Terminal outcomeまたは新規購入案内へ切り替える。

### 16.7 Email failure

Order `CONFIRMED` かつNotificationが `FAILED_RETRYABLE` の場合:

- Success表示を維持する。
- 「購入は確定済みです。確認Emailの送信に失敗または遅延しています。購入内容はこの画面とMypageで確認できます」と非阻害通知する。
- 購入やTicket / Reservation / Goodsを取消表示しない。
- UserにBusiness Transactionの再実行Buttonを出さない。

### 16.8 Ownership failure

他者の `{order_ref}` を指定した場合、Order内容・State・購入者・存在有無の詳細を表示せず `PG-XFN-003` 相当へ遷移する。

**Trace:** `FR-TKT-010〜023`, `FR-KRK-015〜027`, `FR-GDS-007〜015`, `FR-MYP-007〜010`, `FR-EML-002〜011`, `FR-XFN-009〜013`, `FR-XFN-017`, `FR-XFN-019〜021`, `FR-XFN-027〜029`, `FR-XFN-032`, `BR-ORD-001〜012`, `BR-TKT-005〜010`, `BR-KRK-007〜024`, `BR-GDS-004〜013`, `BR-NTF-001〜006`, `DI-030-001〜003`, `DI-030-007〜012`, `UF-XFN-001〜004`, `INV-010-01〜10` のうち当該Purposeに適用されるもの。

## 17. Mypage共通仕様

### 17.1 Authentication / Ownership

全 `PG-MYP-*` はAuthenticated Userのみが利用できる。

- Requestごとに認証IdentityをServer-sideで検証する。
- 認証IdentityからBusiness Profileを一意に解決する。
- 本人がOwner / CustomerであるDataだけを取得・表示する。
- Route上のReferenceを知っていることをAuthorization根拠にしない。
- Owner不一致時は他者Dataを一部でも描画してからErrorへ切り替えてはならない。

### 17.2 Mypage Navigation

Mypage内のLocal Navigationは以下を提供する。

- Overview
- Profile
- Orders
- Entry Tickets
- Karaoke
- Goods

Desktopでは常設Navigation、Mobileでは折りたたみ可能なNavigationを使用してよいが、機能到達性を失わせない。

## 18. Mypage Page仕様

### 18.1 `PG-MYP-001` Mypage Overview

- **Route:** `/mypage`
- **Actor:** Authenticated User / Customer
- **Auth:** 必要
- **対応UF:** `UF-MYP-001`
- **Purpose:** 本人の最新Business stateへ短距離で到達できるDashboardを提供する。

**Sections**

- Account / Profile summary
- 未確定Order summary: `PREPARED`, `AWAITING_PAYMENT`, `REVIEW_REQUIRED`
- 最新Order
- Entry Ticket summary
- Upcoming / current Karaoke Reservation summary
- Goods Handoff `PENDING` summary

**State**

- 個別Sectionは0件Emptyを許可する。
- 一部Section取得失敗を全Dataが存在しない状態として表示しない。
- Email未達でもBusiness Database上の確定Dataを表示する。

**Actions:** 各詳細一覧へ。

**Trace:** `FR-MYP-001〜011`, `FR-EML-011`, `FR-XFN-017`, `BR-USR-001〜006`, `BR-NTF-006`, `DI-030-010`, `UF-MYP-001`, `INV-010-01`, `INV-010-08`.

### 18.2 `PG-MYP-002` Business Profile

- **Route:** `/mypage/profile`
- **Actor:** Authenticated User
- **Auth:** 必要
- **対応UF:** `UF-AUTH-006`, `UF-MYP-001`, `UF-MYP-002`
- **Purpose:** 本人のBusiness ProfileとAccount識別情報を参照し、UI上更新可能なProfile項目を編集する。

**Fields**

- Account email: Supabase Auth Identityに由来する本人確認用表示。Business ProfileのPassword Credentialとして保持しない。
- Display name: Business Profile上の本人向け表示名。更新可能項目とする。
- Profile update status: 未保存 / 保存中 / 保存成功 / validation failure。

本書はPassword変更をBusiness Profile編集として扱わない。Password reset / Credential変更はAuthentication領域へ委譲する。

**Actions**

- Display nameを保存
- Password reset導線が必要な場合は `PG-AUTH-004` へ

**Failure**

- Business Profileを一意に解決できない場合、別Profileへfallbackしない。
- Owner不一致対象をRouteや入力で指定するUIを提供しない。

**Trace:** `FR-AUTH-010〜012`, `FR-MYP-011〜012`, `FR-XFN-002〜003`, `FR-XFN-017`, `BR-USR-001`, `BR-USR-006`, `DI-030-010`, `UF-AUTH-006`, `UF-MYP-002`, `INV-010-08`.

### 18.3 `PG-MYP-003` Order List

- **Route:** `/mypage/orders`
- **Actor:** Authenticated User
- **Auth:** 必要
- **対応UF:** `UF-MYP-001`
- **Purpose:** 本人Order履歴を状態とPurposeが分かる形で一覧表示する。

**Fields per Order**

- Order purpose
- 購入対象要約
- 作成日時
- 合計金額・通貨
- Canonical Order Stateと利用者向けLabel

**State**

すべてのOrder stateを一覧で区別可能にする: `PREPARED`, `AWAITING_PAYMENT`, `CONFIRMED`, `PAYMENT_FAILED`, `CANCELED`, `EXPIRED`, `REVIEW_REQUIRED`。

**Action:** Order選択 → `PG-MYP-004`。

**Trace:** `FR-MYP-007〜008`, `FR-XFN-028〜029`, `BR-ORD-004`, `DI-030-010`, `UF-MYP-001`, `INV-010-01`, `INV-010-08`.

### 18.4 `PG-MYP-004` Order Detail

- **Route:** `/mypage/orders/{order_ref}`
- **Actor:** Authenticated User / Customer
- **Auth:** 必要
- **対応UF:** `UF-MYP-001`, `UF-MYP-002`, `UF-XFN-001`, `UF-XFN-002`, `UF-XFN-003`
- **Purpose:** 自己所有Orderの購入対象、State、購入後権利、Receipt導線を確認する。

**Fields**

- Purpose
- 購入対象明細
- 数量またはKaraoke予約対象Slot
- 購入時価格Snapshotに基づく金額
- Order State
- 作成日時
- `CONFIRMED` 時の関連Ticket / Reservation / Goods item
- Receipt情報への導線（利用可能な場合）
- Notification failureの非阻害表示（該当する場合）

**State / Actions**

`PG-XFN-001` と同じOrder State意味を使用する。`AWAITING_PAYMENT` と `REVIEW_REQUIRED` には「状態を再確認」を提供し、新Orderを自動作成しない。Terminal failure後の「もう一度購入する」はPurposeの販売Pageへ戻り、新Business Attemptを開始する。

**Ownership:** Owner不一致はOrder情報を表示せず `PG-XFN-003` 相当。

**Trace:** `FR-TKT-021〜023`, `FR-MYP-002`, `FR-MYP-007〜010`, `FR-MYP-012`, `FR-EML-011`, `FR-XFN-017`, `BR-USR-003〜006`, `BR-ORD-004〜012`, `BR-NTF-003〜006`, `DI-030-002`, `DI-030-008〜010`, `DI-030-012`, `UF-MYP-001〜002`, `UF-XFN-001〜003`, `INV-010-01〜03`, `INV-010-06〜08`, `INV-010-10`.

### 18.5 `PG-MYP-005` Entry Ticket List

- **Route:** `/mypage/entry-tickets`
- **Actor:** Customer
- **Auth:** 必要
- **対応UF:** `UF-MYP-001`
- **Purpose:** 本人Entry Ticketを現在State付きで一覧表示する。

**Fields per Ticket**

- Ticket種別名
- Ticket State: `VALID` / `USED` / `CANCELED` / `EXPIRED`
- 対応OrderへのLink

**Action:** Ticket選択 → `PG-MYP-006`。

**Empty:** 正常取得0件なら「Entry Ticketはありません」。

**Trace:** `FR-TKT-019〜023`, `FR-MYP-003〜004`, `BR-TKT-007〜010`, `BR-USR-004〜006`, `DI-030-010`, `UF-MYP-001`, `INV-010-05`, `INV-010-08`.

### 18.6 `PG-MYP-006` Entry Ticket Detail

- **Route:** `/mypage/entry-tickets/{ticket_ref}`
- **Actor:** Customer
- **Auth:** 必要
- **対応UF:** `UF-MYP-001`, `UF-MYP-002`, `UF-CHK-001`
- **Purpose:** 1枚のEntry Ticketの現在有効性と利用状態を表示する。

**Fields**

- Ticket種別
- Ticket State
- 対応Order Link
- 受付に使用できるかどうか

**State / Action**

| Ticket State | 表示 | QR Action |
|---|---|---|
| `VALID` | 入場受付に利用可能 | `PG-MYP-007` へEnabled |
| `USED` | 使用済み | QRを通常受付用として開かない |
| `CANCELED` | 取消済み | QRを受付可能として見せない |
| `EXPIRED` | 失効済み | QRを受付可能として見せない |

未確定Orderから本Pageへ有効Ticketを生成・表示しない。

**Trace:** `FR-TKT-019〜024`, `FR-MYP-003〜004`, `FR-XFN-030〜031`, `BR-TKT-007〜010`, `BR-CHK-002`, `DI-030-007`, `DI-030-010`, `UF-MYP-001`, `UF-CHK-001`, `INV-010-05`, `INV-010-08`.

### 18.7 `PG-MYP-007` Entry QR

- **Route:** `/mypage/entry-tickets/{ticket_ref}/qr`
- **Actor:** Customer
- **Auth:** 必要
- **対応UF:** `UF-MYP-001`, `UF-CHK-001`
- **Purpose:** 会場Entry受付で提示するQRとTicket stateを明確に表示する。

**Required UI**

- 「Entry Ticket / 入場受付用」であることをPage titleとQR近傍に明示
- Ticket State
- QR表示領域
- 画面Brightnessを利用者が調整しやすい十分な余白・サイズ
- Ticket detailへ戻るAction

**State**

- `VALID`: QRを受付提示用として表示。
- `USED`: QRを通常受付可能として強調表示せず、「使用済み」を主表示。
- `CANCELED`: QRを受付可能な表示として出さず、「取消済み」。
- `EXPIRED`: QRを受付可能な表示として出さず、「失効済み」。

QR Token形式、生成方式、hash、Scan APIは `SPEC-080` へ委譲する。

**Trace:** `FR-TKT-020`, `FR-KRK-026`, `FR-MYP-004`, `FR-XFN-018`, `BR-TKT-009`, `BR-CHK-001〜006`, `DI-030-007`, `UF-CHK-001`, `INV-010-05`.

### 18.8 `PG-MYP-008` Karaoke Reservation List

- **Route:** `/mypage/karaoke`
- **Actor:** Customer
- **Auth:** 必要
- **対応UF:** `UF-MYP-001`, `UF-KRK-003`
- **Purpose:** 本人Karaoke Reservationを日時・状態付きで一覧表示する。

**Fields per Reservation**

- 対象日
- `usage_start` / `usage_end` に基づく利用時刻
- Reservation State: `CONFIRMED` / `CANCELED`
- Karaoke Ticket State: `VALID` / `USED` / `CANCELED` / `EXPIRED`

Reservationに`USED`という独自Stateを作らず、利用済みはKaraoke Ticket `USED` で表す。

**Action:** Reservation選択 → `PG-MYP-009`。

**Trace:** `FR-KRK-024〜026`, `FR-MYP-005〜006`, `BR-KRK-013〜024`, `DI-030-007`, `DI-030-010`, `UF-MYP-001`, `UF-KRK-003`, `INV-010-05`, `INV-010-08`.

### 18.9 `PG-MYP-009` Karaoke Reservation Detail

- **Route:** `/mypage/karaoke/{reservation_ref}`
- **Actor:** Customer
- **Auth:** 必要
- **対応UF:** `UF-MYP-001`, `UF-MYP-002`, `UF-KRK-003`, `UF-CHK-002`
- **Purpose:** Reservation日時、Reservation / Ticket state、Order / Receipt導線を表示する。

**Fields**

- 対象日
- 利用開始時刻 / 利用終了時刻
- Reservation State
- Karaoke Ticket State
- 対応Order Link
- Receipt導線

**State**

- Reservation `CONFIRMED` + Ticket `VALID`: QR表示Action Enabled。
- Reservation `CONFIRMED` + Ticket `USED`: 利用済み。QR受付Action Disabled。
- Reservation `CANCELED`: 取消済み。Ticketを受付可能として表示しない。
- Ticket `CANCELED` / `EXPIRED`: 現在受付不可を明示。

**Trace:** `FR-KRK-024〜027`, `FR-MYP-005〜008`, `FR-MYP-010`, `BR-KRK-013〜024`, `BR-USR-004〜006`, `DI-030-007`, `DI-030-010`, `UF-KRK-003`, `UF-MYP-001〜002`, `INV-010-05`, `INV-010-08`.

### 18.10 `PG-MYP-010` Karaoke QR

- **Route:** `/mypage/karaoke/{reservation_ref}/qr`
- **Actor:** Customer
- **Auth:** 必要
- **対応UF:** `UF-MYP-001`, `UF-KRK-003`, `UF-CHK-002`
- **Purpose:** Karaoke受付用QRをReservation日時と同時に提示する。

**Required UI**

- 「Karaoke Ticket / Karaoke受付用」をEntry QRと明確に異なるタイトルで表示
- Reservation対象日
- 利用開始 / 終了時刻
- Reservation State
- Karaoke Ticket State
- QR表示領域

**State**

- Reservation `CONFIRMED` + Ticket `VALID`: QRを受付提示用に表示。
- Ticket `USED`: 「使用済み」を主表示し、受付可能QRとして扱わない。
- Reservation `CANCELED` またはTicket `CANCELED`: 「取消済み」。
- Ticket `EXPIRED`: 「失効済み」。

Entry QRと同じPage title、同じ権利名称、同じ補助説明だけに依存しない。権利種別をテキストで常時識別可能にする。

**Trace:** `FR-KRK-024〜026`, `FR-MYP-006`, `FR-XFN-018`, `BR-KRK-021〜024`, `BR-CHK-001〜008`, `DI-030-007`, `UF-CHK-002`, `INV-010-05`, `INV-010-08`.

### 18.11 `PG-MYP-011` Goods Purchase List

- **Route:** `/mypage/goods`
- **Actor:** Customer
- **Auth:** 必要
- **対応UF:** `UF-MYP-001`, `UF-GDS-002`
- **Purpose:** 本人Goods購入と会場受け渡し状態を一覧表示する。

**Fields per item**

- Goods名称
- 数量
- Goods Order Item State: `PENDING_PAYMENT` / `FULFILLABLE` / `CANCELED`
- Goods Handoff State: `PENDING` / `COMPLETED` / `VOID`
- 対応Order State要約

**Display rule**

- `PENDING_PAYMENT`: 「支払未確定・受け取り不可」。
- `FULFILLABLE` + Handoff `PENDING`: 「会場受け取り待ち」。
- Handoff `COMPLETED`: 「受け渡し済み」。
- Item `CANCELED` / Handoff `VOID`: 「取消済み・受け取り不可」。

**Trace:** `FR-GDS-012〜015`, `FR-MYP-009`, `BR-GDS-004〜013`, `DI-030-006`, `DI-030-010`, `DI-030-012`, `UF-GDS-002`, `UF-MYP-001`, `INV-010-07`, `INV-010-08`, `INV-010-10`.

### 18.12 `PG-MYP-012` Goods Purchase Detail

- **Route:** `/mypage/goods/{goods_item_ref}`
- **Actor:** Customer
- **Auth:** 必要
- **対応UF:** `UF-MYP-001`, `UF-MYP-002`, `UF-GDS-002`
- **Purpose:** Goods購入明細と会場Handoff可否・結果を表示する。

**Fields**

- Goods名称
- 数量
- 購入時単価 / 明細金額
- Goods Order Item State
- Goods Handoff State
- 会場受け取りに必要な案内
- 対応Order Link
- Receipt導線

**State / Customer-facing outcome**

| Item / Handoff | 表示 |
|---|---|
| `PENDING_PAYMENT` | 支払未確定。会場受け取り不可 |
| `FULFILLABLE` + `PENDING` | 会場受け取り可能 / 未受け渡し |
| `FULFILLABLE` + `COMPLETED` | 受け渡し済み。二回目受け取り不可 |
| `CANCELED` + `VOID` | 取消済み。受け取り不可 |

`COMPLETED` を通常操作で `PENDING` に戻すActionを一般利用者へ提供しない。

**Email failure:** Order `CONFIRMED` ならEmail未達でも本Pageを受取確認の正本導線として利用できる。

**Trace:** `FR-GDS-012〜015`, `FR-MYP-009〜010`, `FR-EML-011`, `BR-GDS-008〜013`, `BR-NTF-006`, `DI-030-010`, `DI-030-012`, `UF-GDS-002`, `UF-MYP-001〜002`, `INV-010-01`, `INV-010-07〜08`, `INV-010-10`.

## 19. System / Failure Page

### 19.1 `PG-XFN-002` Not Found

- **Route:** unmatched public/application routeのerror surface。固定URLへのredirectを必須としない。
- **Actor:** Guest / Authenticated User
- **Auth:** 不要
- **Purpose:** 存在しない公開Routeまたは公開対象として解決できないResourceに対し、内部情報を漏らさずNavigationを回復する。

**Content**

- 対象Pageを表示できないこと
- Event HomeへのLink
- 必要に応じて前Pageへ戻るLink

取得障害をNot Foundに偽装しない。公開対象でないAnnouncement等は公開内容を漏らさずNot Found相当でよい。

### 19.2 `PG-XFN-003` Access Denied / Ownership Failure

- **Route:** authorization failure surface。固定公開URLへ他者識別子を引き継いでredirectしない。
- **Actor:** Authenticated User
- **Auth:** 必要
- **対応UF:** `UF-MYP-002`
- **Purpose:** 認証済みだが対象操作または対象Dataへの権限が確認できない場合に、他者Dataを開示せず利用を回復する。

**Content**

- 対象を表示または操作できないこと
- Mypageへ戻るAction
- 本人所有一覧へ戻るAction

**Prohibited**

- 他者の氏名、Order State、Ticket State、購入内容を表示しない。
- 「そのOrderは他の利用者のものです」のように対象存在を必要以上に確定しない。
- retry Buttonだけで権限を獲得できるようにしない。

**Trace:** `FR-MYP-012`, `FR-XFN-003`, `FR-XFN-017`, `FR-XFN-025`, `BR-USR-006`, `DI-030-010`, `UF-MYP-002`, `INV-010-08`.

## 20. Domain State → UI State Mapping

### 20.1 Order

| Canonical State | UI分類 | 利用者向け意味 | 有効権利表示 |
|---|---|---|---|
| `PREPARED` | Pending / Retryable | 購入試行は記録済み、支払い未開始 | 不可 |
| `AWAITING_PAYMENT` | Pending | 支払い / Business Database反映待ち | 不可 |
| `CONFIRMED` | Success | 購入確定 | Purposeに応じて可 |
| `PAYMENT_FAILED` | Terminal Failure | 支払不成立 | 不可 |
| `CANCELED` | Terminal | 購入試行取消済み | 不可 |
| `EXPIRED` | Terminal | 購入試行失効 | 不可 |
| `REVIEW_REQUIRED` | Recovery Pending | 自動確定できず確認が必要 | 未確定権利は不可 |

### 20.2 Entry Ticket

| State | UI | QR |
|---|---|---|
| `VALID` | 利用可能 | 表示可 |
| `USED` | 使用済み | 受付可能として表示しない |
| `CANCELED` | 取消済み | 受付可能として表示しない |
| `EXPIRED` | 失効済み | 受付可能として表示しない |

### 20.3 Karaoke Slot / Hold / Reservation / Ticket

| Canonical State | UI |
|---|---|
| Slot `AVAILABLE` | 選択可能候補 |
| Slot `HELD` | 現在確保中・他Customerは購入不可 |
| Slot `SOLD` | 販売済み |
| Slot `SALES_STOPPED` | 販売停止 |
| Hold `ACTIVE` | 購入試行中。Reservation確定ではない |
| Hold `COMMITTED` | 確定購入に使用済み |
| Hold `RELEASED` | 当該確保は終了。再利用不可 |
| Hold `EXPIRED` | 確保期限切れ。新Holdが必要 |
| Reservation `CONFIRMED` | 予約確定 |
| Reservation `CANCELED` | 予約取消済み |
| Karaoke Ticket `VALID` | 受付利用可能 |
| Karaoke Ticket `USED` | 使用済み |
| Karaoke Ticket `CANCELED` | 取消済み |
| Karaoke Ticket `EXPIRED` | 失効済み |

### 20.4 Goods

| Canonical State | UI |
|---|---|
| Goods Order Item `PENDING_PAYMENT` | 支払未確定・受け取り不可 |
| Goods Order Item `FULFILLABLE` | 支払確定済み・Handoff stateに従い受け取り可否表示 |
| Goods Order Item `CANCELED` | 取消済み・受け取り不可 |
| Goods Handoff `PENDING` | 未受け渡し |
| Goods Handoff `COMPLETED` | 受け渡し済み |
| Goods Handoff `VOID` | 受け渡し対象外 |

### 20.5 Notification

| Notification State | UI |
|---|---|
| `PENDING` | 必要なら「確認Email送信処理中」。購入状態へ影響させない |
| `SENT` | 通知送信済みを補助情報として表示してよい |
| `FAILED_RETRYABLE` | 「Email未達の可能性があるが購入は確定済み」。Business successを維持 |
| `CANCELED` | 通知不要化。購入権利には影響しない |

## 21. Pending / Failure / Retry UX Matrix

| Scenario | 主要表示 | 利用者Action | 禁止 |
|---|---|---|---|
| Public information loading | 取得中 | 待機 | Empty / 売り切れ断定 |
| Public information failure | 取得失敗 | 再取得 | 0件へ変換 |
| Authentication failure | Login未成立 | 再入力 / reset | 認証済み継続 |
| Auth Service一時障害 | 認証結果を確認できない | 後で再試行 | 未検証Identityで購入 |
| Purchase start failure | 購入開始未成立 | 条件再確認 / 再選択 | 支払済み表示 |
| Checkout start failure + `PREPARED` | 支払い画面開始失敗 | 同一Order retry | 新Orderを無条件作成 |
| `AWAITING_PAYMENT` | 支払い / 反映待ち | 同一Order状態再確認 | Success表示、新Order生成 |
| Browser Return + `AWAITING_PAYMENT` | Return済みだが未確定 | 状態再確認 | Browser Returnで確定 |
| `PAYMENT_FAILED` | 支払不成立 | 新規購入 | 同Orderを `PREPARED` に戻す |
| 売り切れ | capacity不足 | 数量/Offering再選択 | 確保なしCheckout |
| Slot競合 | Slot取得失敗 | scheduleへ戻る | 同Slotを購入可能表示 |
| Inventory競合 | 在庫確保失敗 | 数量/商品再選択 | 未確保Checkout |
| Purchase Limit超過 | 上限到達 | 購入内容見直し | 並行retryで回避 |
| Hold期限切れ | Slot確保失効 | Slotを選び直す | 同Hold再利用 |
| Email failure | 購入は確定、Email未達 | Mypageで確認 | 購入failure化 |
| `REVIEW_REQUIRED` | 状態確認中 | 同Order状態再確認 | Success表示、新権利生成retry |
| Ownership failure | 対象を表示できない | 本人一覧へ戻る | 他者Data表示 |
| Not Found | Pageを表示できない | Homeへ | 内部情報露呈 |

## 22. Browser Reload / Back / Revisit

- `PG-XFN-001`、`PG-MYP-004` のreloadは同一Orderを再取得し、新Orderを作らない。
- Ticket / QR Pageのreloadは既存Ticketを再取得し、新Ticketを発行しない。
- Karaoke Reservation Pageのreloadは既存Reservation / Ticketを再取得し、新Hold / Reservationを作らない。
- Goods Pageの購入Action以前のreloadはread only。購入開始後はOrder Referenceに基づく既存状態へ復帰できる。
- Browser backで古い「購入可能」「空きあり」「在庫あり」表示へ戻っても、次のwrite operationではServer-side current stateを再検証する。

Trace: `FR-XFN-012`, `FR-XFN-026`, `BR-SAL-005〜007`, `BR-ORD-006〜009`, `DI-030-012`, `INV-010-10`.

## 23. Receipt導線

Receiptは独立した本システム内Canonical Pageを作らず、対象Orderから利用可能なStripe Receipt情報への導線として扱う。

- `PG-XFN-001` `CONFIRMED`
- `PG-MYP-004`
- `PG-MYP-009`
- `PG-MYP-012`

で対応Orderへの導線またはReceipt linkを表示できる。

Receipt linkがまだ利用可能でない場合、Receiptの存在を捏造しない。Stripe側Receiptの具体取得方式、URL寿命、Refund表示等は `SPEC-070` が定義する。

## 24. Responsive仕様

### 24.1 Breakpoint非依存要件

具体px値やCSS frameworkは固定しないが、Mobile / Desktopの両方で次を満たす。

- 公開情報閲覧、Account登録/Login、Entry購入、Karaoke Slot選択、Goods購入、Order状態確認、Mypage、QR表示を完遂可能。
- Responsive変更でPrimary Action、Canonical State、Error / Pending表示を消失させない。
- 表形式情報はMobileでカードまたは横スクロール等へ変換してよいが、State・日時・Actionを欠落させない。
- Karaoke 1時間bucketはMobileでも対象時刻とSlot選択可能数を識別可能にする。
- QR PageはMobile会場提示をPrimary use caseとして、QRを十分な大きさで表示できる領域を確保する。
- Mobile NavigationでMypage各領域へ到達可能にする。

### 24.2 QR表示

- QRの周辺に十分な余白を確保する。
- QR自体だけで権利種別を判断させず、Entry / KaraokeのテキストLabelを併記する。
- 画面狭小時でもReservation日時やTicket StateをQRと同時に確認可能にする。

## 25. Accessibility仕様

- 主要Action、Navigation、Form controlはKeyboard操作可能にする。
- Focus順序をDOM上の論理順序と一致させる。
- Loading / Error / Pending / Success / Ticket stateを色だけで区別しない。Text labelまたはIcon + accessible nameを併用する。
- Form validation errorは対象入力とプログラム上関連付け、送信後にError summaryまたは最初のErrorへ到達可能にする。
- 状態再取得により `AWAITING_PAYMENT -> CONFIRMED` 等が変化した場合、screen reader利用者が変化を認識できる通知領域を設ける。
- LinkはNavigation、ButtonはActionとして使い分ける。
- Dialog / Drawerを使用する場合、開いた際のFocus移動、Focus trap、Escape等の閉じる手段、閉じた後のFocus returnを提供する。
- Disabled Actionは理由を周辺Textで示す。Colorやpointer stateだけに依存しない。
- Heading hierarchyをPage titleから論理的に構成する。
- QR状態が無効な場合、QRを隠すだけでなく「使用済み / 取消済み / 失効済み」をTextで明示する。

## 26. Security / Ownership表示境界

### 26.1 UIはSecurity Boundaryではない

NavigationやButtonをHiddenにしてもAuthorizationが成立したとはみなさない。認証・認可の詳細は `SPEC-060`、API側検証は `SPEC-110` が定義するが、本書の全保護PageはServer-side検証結果に依存する。

### 26.2 他者Dataを先に描画しない

Owner限定PageではData payload取得前にOwnership検証が成立していなければならない。Client側で他者Dataを取得してからHideする実装は禁止する。

### 26.3 Sensitive information

一般利用者Pageへ以下を主要表示しない。

- Password / Credential
- Server-only Secret
- Stripeの機微な決済情報
- QR Token内部値をTextとして露出することを前提としたUI
- 他者のBusiness Profile情報
- Administrator / Staff専用の内部運用情報

## 27. Administrator / Staff画面との境界

SPEC-050では以下だけをCanonicalに定義する。

- 一般利用者領域と運用領域は別Navigation / Access boundaryを持つ。
- 一般利用者PageからAdministrator / Staff専用Actionを実行できるcontrolを提供しない。
- CustomerはEntry QR / Karaoke QR / Goods受け取り情報を提示する側のPageを利用する。
- Staff / AdministratorがQR Scan、Check-in、Goods Handoff更新を行う個別画面は `SPEC-130` のCanonical Owner範囲である。
- `FR-ADM-001`, `FR-ADM-019〜020`, `FR-STF-001`, `FR-STF-016` に関係するUI境界として、一般利用者Pageが高権限操作を肩代わりしない。

## 28. Traceability Matrix — Page to User Flow

| Page | User Flow |
|---|---|
| `PG-PUB-001〜003` | `UF-PUB-001` |
| `PG-TKT-001` | `UF-PUB-001`, `UF-PUB-002`, `UF-TKT-001` |
| `PG-KRK-001〜002` | `UF-KRK-001` |
| `PG-KRK-003` | `UF-PUB-002`, `UF-KRK-001〜002` |
| `PG-GDS-001` | `UF-PUB-001`, `UF-GDS-001` |
| `PG-GDS-002` | `UF-PUB-002`, `UF-GDS-001` |
| `PG-AUTH-001` | `UF-AUTH-001`, `UF-PUB-002` |
| `PG-AUTH-002` | `UF-AUTH-002`, `UF-AUTH-007` |
| `PG-AUTH-003` | `UF-AUTH-003`, `UF-PUB-002`, `UF-AUTH-007` |
| `PG-AUTH-004〜005` | `UF-AUTH-005`, `UF-AUTH-007` |
| Logout Action | `UF-AUTH-004` |
| `PG-XFN-001` | `UF-TKT-001`, `UF-KRK-002`, `UF-GDS-001`, `UF-XFN-001`, `UF-XFN-003〜004` |
| `PG-MYP-001〜012` | `UF-MYP-001`; detail ownership failureは `UF-MYP-002` |
| `PG-MYP-006〜007` | `UF-CHK-001` のCustomer側提示 |
| `PG-MYP-008〜010` | `UF-KRK-003`; `PG-MYP-009〜010` は `UF-CHK-002` のCustomer側提示 |
| `PG-MYP-011〜012` | `UF-GDS-002` のCustomer側確認 |
| `PG-XFN-003` | `UF-MYP-002` |

## 29. Traceability Matrix — Requirement / Rule Coverage

### 29.1 Public

- `FR-PUB-001〜006`, `FR-PUB-011`, `FR-PUB-013〜014` → `PG-PUB-001〜003`
- `FR-PUB-007`, `FR-PUB-010`, `FR-PUB-012` → `PG-TKT-001`
- `FR-PUB-008`, `FR-PUB-010` → `PG-KRK-001〜003`
- `FR-PUB-009〜010` → `PG-GDS-001〜002`
- `BR-EVT-001〜004` → `PG-PUB-001〜003`

### 29.2 Authentication / Ownership

- `FR-AUTH-001〜009`, `FR-AUTH-014` → `PG-AUTH-001〜005` + Logout Action
- `FR-AUTH-010〜012`, `FR-MYP-011〜012` → `PG-MYP-002`
- `FR-XFN-001〜004`, `FR-XFN-017`, `FR-XFN-025` → Authentication Continuation、全保護Page、`PG-XFN-003`
- `BR-USR-001〜007`, `DI-030-010`, `INV-010-08` → 全Mypage / Purchase Status ownership boundary

### 29.3 Entry Ticket

- `FR-TKT-001〜010`, `FR-TKT-025〜026` → `PG-TKT-001`
- `FR-TKT-011〜018` → `PG-XFN-001`
- `FR-TKT-019〜024` → `PG-MYP-004〜007`
- `BR-SAL-*`, `BR-ORD-*`, `BR-TKT-*`, `DI-030-001〜004`, `DI-030-009〜012` → Entry purchase / status / ticket pages

### 29.4 Karaoke

- `FR-KRK-001〜007` → `PG-KRK-001〜002`
- `FR-KRK-008〜016` → `PG-KRK-003`
- `FR-KRK-017〜023`, `FR-KRK-027` → `PG-XFN-001`
- `FR-KRK-024〜026` → `PG-MYP-008〜010`
- `FR-KRK-030` → `PG-KRK-001〜003` の販売停止表示のみ。管理操作は `SPEC-130`
- `BR-KRK-*`, `BR-XFN-001〜004`, `DI-030-003`, `DI-030-005`, `DI-030-007`, `DI-030-009〜012` → Karaoke各Page

### 29.5 Goods

- `FR-GDS-001〜008`, `FR-GDS-011`, `FR-GDS-016〜017` → `PG-GDS-001〜002`
- `FR-GDS-009〜010` → `PG-XFN-001`
- `FR-GDS-012〜015` → `PG-MYP-011〜012`
- `BR-GDS-*`, `DI-030-006`, `DI-030-009〜012` → Goods各Page

### 29.6 Mypage / Notification / Cross-functional

- `FR-MYP-001〜012` → `PG-MYP-001〜012`
- `FR-EML-001` → Authentication pages
- `FR-EML-002〜012` → `PG-XFN-001`, `PG-MYP-004`, `PG-MYP-009`, `PG-MYP-012`
- `FR-XFN-009〜013`, `FR-XFN-019〜021`, `FR-XFN-027〜029`, `FR-XFN-032` → `PG-XFN-001` と共通Pending / Failure UX
- `BR-NTF-001〜006`, `DI-030-008`, `DI-030-012`, `INV-010-06`, `INV-010-10` → Email failure表示とretry分離

### 29.7 Admin / Staff UI境界

- `FR-ADM-001`, `FR-ADM-019〜020` → 一般利用者Navigationから高権限Actionを分離
- `FR-ADM-012` → Karaoke販売停止の利用者側表示だけ
- `FR-ADM-017` → Goods HandoffのCustomer側状態表示だけ
- `FR-ADM-021` → `REVIEW_REQUIRED` のCustomer側表示だけ
- `FR-STF-001〜016` → Entry / Karaoke QRのCustomer提示側まで。本書はStaff個別画面を所有しない

## 30. System Invariant UI Coverage

| Invariant | SPEC-050でのUI具体化 |
|---|---|
| `INV-010-01` 購入情報を失わない | Checkout開始失敗後も `PREPARED` OrderをPurchase Status / Mypageから追跡可能にする |
| `INV-010-02` Orderを二重確定しない | reload / status retryで同じOrderを再取得し、Success時も既存結果を表示する |
| `INV-010-03` Ticketを二重発行しない | Page reloadでTicketを作成せず既存Ticketを表示する |
| `INV-010-04` Karaoke Slotを二重販売しない | `HELD` / `SOLD` を購入不可表示し、競合時に選び直しへ戻す |
| `INV-010-05` QR Ticketを二重利用させない | `USED` / `CANCELED` / `EXPIRED` QRを受付可能表示にしない |
| `INV-010-06` Email失敗で購入確定をRollbackしない | `CONFIRMED` を維持しEmail failureを非阻害Bannerとして表示する |
| `INV-010-07` 決済確定と権利発行を中途半端に残さない | `AWAITING_PAYMENT` / `REVIEW_REQUIRED` をSuccessにしない |
| `INV-010-08` 所有権と権限をServer-sideで検証する | Mypage / Purchase StatusでOwnership-safe Detailを必須化する |
| `INV-010-09` 金額をClient入力だけで確定しない | UI合計は表示用であり購入時Server-side金額を再取得する |
| `INV-010-10` 外部処理の再送に耐える | 状態確認retry、Checkout retry、新規購入をUI上でも分離する |

## 31. E2E観点の最低Page Acceptance

以下は `SPEC-170` のTest Case詳細ではなく、Page specificationとして実装が満たすべき観測可能条件である。

1. GuestがEvent / Announcement / Entry / Karaoke / Goods公開情報を認証なしで閲覧できる。
2. 公開取得FailureがEmpty / 売り切れへ化けない。
3. Guestが購入Actionを選ぶとLogin / Account登録へ進み、認証後に安全な論理目的へ復帰できる。
4. Entry販売Pageが販売開始前、販売中、販売終了、販売停止、売り切れ、Purchase Limit超過を区別できる。
5. Karaoke scheduleが日付、1時間bucket、Slot `AVAILABLE / HELD / SOLD / SALES_STOPPED` を区別できる。
6. Goods Pageが販売期間外、販売停止、売り切れ / 在庫不足を区別できる。
7. Entry / Karaoke / GoodsのCheckout開始失敗後、既存 `PREPARED` Orderを追跡できる。
8. Browser Return直後にOrder `AWAITING_PAYMENT` なら購入Successと表示しない。
9. `CONFIRMED` だけがPurposeに対応する確定権利を表示する。
10. `PAYMENT_FAILED`, `CANCELED`, `EXPIRED`, `REVIEW_REQUIRED` を別Outcomeとして表示する。
11. `AWAITING_PAYMENT` / `REVIEW_REQUIRED` の状態再確認は新Orderを作らない。
12. Terminal Orderから再購入するときは「新規購入」として販売Pageへ戻る。
13. Karaoke Hold失効後は同Holdを再利用せずSlot再選択へ戻る。
14. MypageがProfile、Order、Entry、Karaoke、Goodsへ到達可能である。
15. Mypage Order一覧が7つのCanonical Order Stateを区別できる。
16. Entry / Karaoke Ticketの `VALID / USED / CANCELED / EXPIRED` を区別できる。
17. Entry QRとKaraoke QRを権利種別・画面タイトル・補助情報で混同しにくくする。
18. Goods `PENDING_PAYMENT / FULFILLABLE / CANCELED` とHandoff `PENDING / COMPLETED / VOID` を区別できる。
19. Email failureでも `CONFIRMED` purchaseと権利をMypageで確認できる。
20. 他者Referenceを指定しても他者Dataを描画しない。
21. Mobile / Desktop両方で主要Flowを完遂できる。
22. Keyboard操作、Form error関連付け、非色依存State表示、状態変化通知を満たす。
23. 一般利用者PageにAdministrator / Staff専用操作を混在させない。

## 32. 下流Canonical Ownerとの境界

| SPEC | SPEC-050から委譲する詳細 |
|---|---|
| `SPEC-060 Authentication / Authorization` | Session、cookie / token取扱い、Email確認後Access、Role Assignment、Permission Matrix、AuthN/AuthZ判定詳細 |
| `SPEC-070 Order / Payment` | Stripe Checkout Session、Event別処理、Webhook、Refund、Receipt取得実装、Checkout期限 |
| `SPEC-080 Ticket / QR / Check-in` | QR Token形式、Token lifecycle、Scan API、受付有効期間、Ticket検証詳細 |
| `SPEC-090 Karaoke Reservation` | Hold具体秒数、Slot生成、排他Scope、時間外受付、Hold解放詳細 |
| `SPEC-100 Database Design` | Table / Column / Index / Constraint / Referenceの物理表現 |
| `SPEC-110 API Specification` | Endpoint、Request / Response、HTTP Status、Error code |
| `SPEC-120 Email Notification` | Template全文、通知種別詳細、Provider処理、retry回数 |
| `SPEC-130 Admin / Staff` | 運用Page、Filter、QR Scan UI、Handoff更新UI、例外操作 |
| `SPEC-140 Security` | CSRF / CORS / Secret / Threat model等のSecurity Control詳細 |
| `SPEC-150 Reliability / Error Recovery` | retry回数、Backoff、Consistency Review解消、Runbook |
| `SPEC-160 Observability / Audit Log` | Audit Event、Log / Metric / Trace schema |
| `SPEC-170 Test Specification` | Page / State / Branchごとの具体Test Case |
| `SPEC-200 System Acceptance Criteria` | 完成システム全体の最終Acceptance判定 |

## 33. 実装禁止事項

以下のUI実装を禁止する。

- Browser Returnだけで「購入完了」と表示する
- `AWAITING_PAYMENT` を「支払済み」「予約確定」「受け取り可能」と表示する
- `REVIEW_REQUIRED` を通常Successへ丸める
- 公開取得Failureを0件、売り切れ、未設定等の正常Stateへ変換する
- Guestのまま購入Order / Karaoke Hold / Mypage Data取得を成立させる
- URL Referenceを知っていることだけで他者Dataを表示する
- 他者DataをClientへ取得してからHideする
- `PAYMENT_FAILED` / `CANCELED` / `EXPIRED` の再購入Buttonで同じOrderを `PREPARED` へ戻す
- Hold `EXPIRED` / `RELEASED` 後に同HoldのCheckoutを再開する
- Browser reloadで新Ticket / Reservation / Handoffを生成する
- Entry Ticket `USED / CANCELED / EXPIRED` に通常受付用QRを表示する
- Karaoke Ticket `USED / CANCELED / EXPIRED` に通常受付用QRを表示する
- Reservation `CANCELED` を予約有効として表示する
- Goods `PENDING_PAYMENT` を会場受け取り可能と表示する
- Goods Handoff `COMPLETED` を未受け取りへ通常UIから戻す
- Email failureを購入failureとして表示する
- Notification retryを購入再試行Buttonとして扱う
- Mobile layoutでActionまたは重要Stateを非表示にしてFlow完遂不能にする
- 一般利用者PageへAdministrator / Staff専用操作を配置する

## 34. 受入条件

本仕様書は以下をすべて満たす場合に成立する。

1. 一般利用者向け主要Pageに一意なPage IDとRouteがある。
2. Event概要、開催日時、会場・アクセス、注意事項、FAQ、Announcementを具体化している。
3. Entry / Karaoke / Goods公開販売Pageがある。
4. Karaoke対象日、1時間単位空き状況、個別Slot選択がPageへ割り当てられている。
5. Account登録、Email確認、Login、Password reset開始・完了、Logout後Navigationが定義されている。
6. Guestから認証必須Actionへの遷移と、認証後Continuationが定義されている。
7. Entry Ticket購入の販売条件、数量、購入開始、Checkout開始失敗、Browser Return、7つのOrder State、Ticket / QR、Order / Receipt導線がPageへ対応している。
8. Karaoke購入のSlot 4状態、Hold期限切れ、競合、Purchase Limit、Checkout失敗、Browser Return、Reservation / Ticket state、QR、Order / Receipt導線がPageへ対応している。
9. Goods購入の販売状態、在庫競合、`PENDING_PAYMENT / FULFILLABLE / CANCELED`、Handoff `PENDING / COMPLETED / VOID`、Order / Receipt導線がPageへ対応している。
10. MypageにOverview、Profile、Order一覧 / 詳細、Entry Ticket / QR、Karaoke Reservation / QR、Goods / Handoffがある。
11. Browser ReturnとBusiness Confirmationを分離している。
12. `PREPARED`, `AWAITING_PAYMENT`, `CONFIRMED`, `PAYMENT_FAILED`, `CANCELED`, `EXPIRED`, `REVIEW_REQUIRED` を画面上で区別する。
13. Ticket `VALID / USED / CANCELED / EXPIRED` を画面上で区別する。
14. Slot競合、Inventory競合、Purchase Limit超過、Hold期限切れを異なるFailureとして扱う。
15. Email failureでも購入Successと権利確認を維持する。
16. Retry、同一Order状態確認、新規Business Attemptを混同しない。
17. Ownership failureで他者Dataを表示しない。
18. URL ReferenceをAuthorization根拠にしない。
19. Mobile / Desktopで主要Flowを完遂できる。
20. Accessibility最低要件が定義されている。
21. Administrator / Staff個別画面を `SPEC-130` から奪っていない。
22. Role Permission Matrix、Stripe Event、API Endpoint、QR Token形式、Hold具体秒数、DB物理設計を本書でCanonical定義していない。
23. `FR-*`, `BR-*`, `DI-030-*`, `UF-*`, `INV-010-*` へ追跡可能である。
24. 長期運用される完成システムを対象とし、MVP / Step等でPage仕様を分断していない。
25. `SPEC-000` のCanonical Owner / `depends_on` / Upstream Change Request規則に従っている。

## 35. 上流仕様変更要求

なし。
