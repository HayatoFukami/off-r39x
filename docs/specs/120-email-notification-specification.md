---
spec_id: SPEC-120
title: Email Notification Specification
version: 1.0.0
status: provisional
depends_on:
  - SPEC-000
  - SPEC-010
  - SPEC-020
  - SPEC-030
  - SPEC-050
  - SPEC-060
  - SPEC-070
  - SPEC-090
  - SPEC-100
  - SPEC-110
related_specs:
  - SPEC-040
  - SPEC-080
  - SPEC-130
  - SPEC-140
  - SPEC-150
  - SPEC-160
  - SPEC-170
  - SPEC-180
  - SPEC-200
---

# 120 Email Notification Specification

## 1. 目的

本書は、**off r39'x in 大阪らへん2027** Webシステムの完成形におけるBusiness Email / Notificationの通知種別、Notification Request lifecycle、送信Trigger、Recipient resolution、React Email Template contract、Resend連携、送信worker、delivery attempt、冪等性、retry、provider failure、Business Transactionとの分離、Notification cancellation、Email内link、personal data、Administrator recovery operation、および失敗・recovery境界を定義する。

本書は **Email / Notification contractのCanonical Owner** である。

本書は、`SPEC-030` が定義する `Notification Request` Domainと、`SPEC-100` が定義する `app.notification_requests` を変更しない。Email配送の都合でOrder、Ticket、Karaoke Reservation、Goods購入、Refundその他のBusiness Transactionの確定条件を追加または再定義してはならない。

特に次を不変とする。

- Email配送成功はBusiness ConfirmationのPreconditionではない。
- Email配送失敗を理由に確定済みOrder / Ticket / Reservation / Goods購入をRollbackしない。
- Notification retryは元Business Transactionを再実行しない。
- Email未達でもCustomerはMypageからBusiness Database上の確定済み権利を確認できる。
- Business DatabaseがNotification RequestのSystem of Recordであり、Resendの状態だけからDomain stateを逆算しない。

本書はMVP、Step1、Step2等の実装段階で仕様を分断しない。長期運用される完成システムを対象とする。

---

## 2. 適用範囲

本書は以下へ適用する。

- Business TransactionからのNotification Request生成
- Entry Ticket購入完了通知
- Karaoke Reservation完了通知
- Goods購入完了通知
- Karaoke Reservation取消通知
- Full Refund完了通知
- Notification Requestのclaim / send / retry / cancel
- Business ProfileからSupabase Auth Identityを経由したrecipient Email解決
- recipient Email snapshot
- React EmailによるHTML / plain-text rendering
- Resend Email API
- Resend Webhook
- provider message ID / delivery event correlation
- provider response loss / unknown result
- concurrent worker control
- Administratorによる通知確認・失敗通知retry・未送信通知cancel
- Email delivery support persistence

以下は本書のCanonical Ownerではない。

- Account verification / Password reset等のCredential lifecycle: Supabase Auth / `SPEC-060`
- Order / Stripe / Refundのfinancial lifecycle: `SPEC-070`
- Ticket / QR / Check-in lifecycle: `SPEC-080`
- Karaoke Reservation state / cancellation semantics: `SPEC-090`
- 既存Business tableのphysical schema: `SPEC-100`
- 一般Business API contract: `SPEC-110`
- Admin / Staff画面・操作導線: `SPEC-130`
- Security Control全般・PII retention最終policy: `SPEC-140`
- 共通retry回数・backoff・Runbook: `SPEC-150`
- log / metric / audit event schema: `SPEC-160`
- Test case詳細: `SPEC-170`
- Hosting / Secret配置 / scheduler設定: `SPEC-180`

---

## 3. 依存仕様と優先解釈

本書は以下へ直接依存する。

- `SPEC-000`: Canonical Owner、`depends_on`、Upstream Change Request、未決定事項の決定規則
- `SPEC-010`: System Boundary、Resend責務、`INV-010-01〜10`
- `SPEC-020`: `FR-EML-001〜012`、関連 `FR-AUTH-*`, `FR-MYP-*`, `FR-ADM-*`, `FR-XFN-*`
- `SPEC-030`: Notification Request State、`BR-NTF-001〜006`、`DI-030-008`, `DI-030-012`
- `SPEC-050`: Email CTAが接続する既存Page / Route
- `SPEC-060`: Auth Identity / Business Profile relation、Email verified access boundary、既存Capability
- `SPEC-070`: Business Confirmation、full Refund、Payment failure / recovery境界
- `SPEC-090`: Karaoke Reservation Confirmation / Cancellationの正規条件
- `SPEC-100`: `app.notification_requests`、DB naming / transaction / lock / migration rule
- `SPEC-110`: `/api/v1`、namespace、Hono RPC、Zod、common error、Administrator server operation boundary

`SPEC-040` と `SPEC-080` はFlowおよびTicket表示のTraceabilityに使用する関連仕様であり、本書はそれらのCanonical state / QR contractを再定義しない。

上流仕様との矛盾は確認されなかった。本書は新しいDomain StateまたはOperational Capabilityを追加しない。

---

## 4. Canonical Terms

| Term | 本書での意味 |
|---|---|
| Business Notification | Order / Reservation / Refund等の確定Business Eventから派生するTransactional Email |
| Auth Notification | Supabase Authが所有するAccount verification / Password reset等のCredential lifecycle Email |
| Notification Request | `SPEC-030` の再試行可能なDomain要求。`app.notification_requests` がSystem of Record |
| Notification Type | 同一論理通知の意味・Template contract・Triggerを識別する固定string |
| Business Cause | 同一Business Eventから同一論理Notificationを最大1件にする原因 |
| Business Cause Key | `app.notification_requests.business_cause_key` に保存するUUID |
| Email Delivery Job | 1 Notification Requestに1件対応するEmail配送processing support row。Domain Entityではない |
| Delivery Attempt | Recipient resolution / render / provider requestを追跡する1回の配送処理履歴 |
| Provider Acceptance | Resend Email APIがrequestを受理しprovider email IDを返した、または同等事実を署名検証済みWebhook等で再照合できた状態 |
| Provider Delivery Event | `email.delivered`, `email.bounced` 等、Provider Acceptance後の配送網結果 |
| Recipient Snapshot | 初回provider送信前にSupabase Authからserver-side解決したverified Email addressのsnapshot |
| Provider Idempotency Key | Resendへ同一Provider requestを重複送信しないためのkey |
| Transport Idempotency Key | Administrator HTTP mutation retryを相関する `Idempotency-Key` |
| Unknown Provider Result | Provider requestを開始した可能性があるが、accept / rejectを安全に確定できない状態 |
| Claim Lease | Workerが同一Delivery Jobを同時処理しないための期限付きprocessing ownership |
| Processing State | Email delivery support tableだけに存在する物理処理状態。Notification Domain Stateではない |

---

# Part I — Authentication Notificationとの境界

## 5. Supabase Auth Notification

次はSupabase Authが所有するAuthentication / Credential lifecycleであり、本書のBusiness Notificationへ統合しない。

- Account verification
- Password reset
- Supabase Authが正規に提供するCredential / Session lifecycleに付随する通知

**EML-AUTH-001:** Account verification / Password reset tokenを `app.notification_requests`、`render_context`、React Email Business Templateへ複製してはならない。

**EML-AUTH-002:** Business DatabaseへPassword、password hash、refresh credential、password reset token、email verification tokenを保存してはならない。

**EML-AUTH-003:** `FR-EML-001` はSupabase Auth notificationを利用可能にする要件であり、Resend Business Notification workerがCredential lifecycleのSystem of Recordになることを意味しない。

---

## 6. Business Notification

Business NotificationはHono APIがBusiness Databaseの確定状態を根拠に生成し、Resendへ配送を依頼する。

Business NotificationのrecipientはClient入力Email、Stripe Checkout customer email、URL query、Browser stateから決定しない。

**EML-AUTH-004:** Business Notification recipient authorityは、`recipient_profile_id` → `Business Profile.auth_subject` → Supabase Auth server-side lookupである。

**EML-AUTH-005:** Stripe側のCustomer emailまたはCheckout emailをBusiness Notification recipient authorityへ使用してはならない。

---

# Part II — Notification Request Domain Contract

## 7. Notification Request State

`SPEC-030` のStateをそのまま使用し、新しいDomain Stateを追加しない。

```text
PENDING
SENT
FAILED_RETRYABLE
CANCELED
```

許可遷移も変更しない。

```text
PENDING -> SENT
PENDING -> FAILED_RETRYABLE
FAILED_RETRYABLE -> SENT
FAILED_RETRYABLE -> FAILED_RETRYABLE
PENDING -> CANCELED
FAILED_RETRYABLE -> CANCELED
```

### 7.1 Stateの本書上の意味

| State | Email上の意味 |
|---|---|
| `PENDING` | Notification Requestは永続化済みで、Resend Provider Acceptanceは未確認 |
| `SENT` | Resend Provider Acceptanceが安全に確認され、provider message ID correlationを永続化できた |
| `FAILED_RETRYABLE` | Notificationだけの再処理対象。自動retry可能とは限らず、support state `BLOCKED` の場合は条件修復またはAdministrator recoveryを要する |
| `CANCELED` | Provider Acceptance前に送信不要化した要求。元Business Transactionへ作用しない |

**EML-NTF-001:** `SENT` は「recipient mailboxへ必ず到達した」ことを意味しない。ResendによるProvider Acceptanceを意味する。

**EML-NTF-002:** `email.bounced` / `email.failed` / `email.suppressed` 等のProvider Delivery EventがProvider Acceptance後に到着しても、`SENT` から `FAILED_RETRYABLE` / `CANCELED` へ遷移させない。

理由は、`SPEC-030` に `SENT` からの遷移が存在せず、Resend内部配送結果をBusiness Domain Authorityへ昇格させないためである。

---

## 8. Notification Request generation boundary

### 8.1 正常生成

Order / Reservation等の正規Business Transactionでは、上流仕様のmandatory Domain effectが成立した後、同じBusiness Database transactionの最後のoutbox-like adjunctとして以下を行ってよい。

1. Notification Typeを決定する。
2. source EntityとRecipient Business Profileをserver-sideで決定する。
3. deterministic `business_cause_key` を生成する。
4. non-secret `render_context` snapshotを構築する。
5. `app.notification_requests` をinsertする。
6. 同じtransactionで対応 `app.email_delivery_jobs` をinsertする。
7. transaction commit後にのみworkerから可視化される。

Resend call、Supabase Auth recipient lookup、React Email renderはこのBusiness transaction内で実行しない。

**EML-GEN-001:** Notification Request rowを同じcommit boundaryへ含めることは許可するが、Resend配送成功をBusiness commit条件へ含めてはならない。

**EML-GEN-002:** Notification Request生成のためにStripe / Resend / Supabase Auth network callをBusiness Database transaction内で保持してはならない。

### 8.2 Business Cause Key

`business_cause_key` はapplication固定UUID namespaceを用いるUUIDv5として生成する。

Canonical name input:

```text
<notification_type>:<source_public_ref>:<event_discriminator>
```

`event_discriminator` は本書のNotification Typeごとに固定する。

例:

```text
ENTRY_PURCHASE_CONFIRMED:<order_ref>:CONFIRMED
KARAOKE_RESERVATION_CONFIRMED:<reservation_ref>:CONFIRMED
GOODS_PURCHASE_CONFIRMED:<order_ref>:CONFIRMED
KARAOKE_RESERVATION_CANCELED:<reservation_ref>:CANCELED
ORDER_REFUND_SUCCEEDED:<order_ref>:FULL_REFUND_SUCCEEDED
```

UUID namespace自体はapplication source codeのconstantとして固定し、environmentごとにランダム変更しない。

**EML-GEN-003:** Transport `Idempotency-Key`、Request ID、worker IDを`business_cause_key`へ使用してはならない。

### 8.3 Duplicate generation

生成時は `business_cause_key UNIQUE` を最終防御とする。

既存rowが見つかった場合は次を再照合する。

- `notification_type`
- `recipient_profile_id`
- source Order / Reservation relation
- render context schema version / deterministic context hash

一致する場合は既存Notification Requestへ収束する。

一致しない場合は「同じBusiness Causeへ異なる通知内容を割り当てた」Consistency Failureであり、既存rowを上書きせず、source Order / Reservationを対象とするConsistency Review Caseを作成する。

**EML-GEN-004:** Unique violationをblind retryで2件目へ変換しない。

### 8.4 生成漏れrecovery

既にBusiness Transactionがcommit済みなのに期待されるNotification Requestが存在しないことが検出された場合、source Business stateからNotification Type / Business Cause / render contextを再導出し、同じ `business_cause_key` でNotification Requestだけを補完してよい。

この補完処理は次を行わない。

- Order再確定
- Ticket再発行
- Reservation再確定
- Inventory再更新
- Refund再実行

**EML-GEN-005:** Notification Requestの後追い補完はNotification recoveryであり、元Business Transaction retryではない。

### 8.5 DB failure

Notification Request insertを含むDB transaction自体がcommitできない場合、そのtransactionを成功と偽装しない。これはEmail Provider failureではなくBusiness Database failureであり、上流Business TransactionのDB failure semanticsに従う。

既に元Business Transactionが別の正常commitで成立済みで、Notification Requestだけが欠落したことが後で判明した場合は8.4を使用する。

---

# Part III — Canonical Notification Types

## 9. Notification Type一覧

本仕様でCanonicalに定義するBusiness Notification Typeは次の5種類とする。

| Notification Type | Trigger | Source | Recipient | Template |
|---|---|---|---|---|
| `ENTRY_PURCHASE_CONFIRMED` | Entry Purchase Business Confirmation | Order | Order Customer | `entry-purchase-confirmation` v1 |
| `KARAOKE_RESERVATION_CONFIRMED` | Karaoke Reservation Business Confirmation | Order + Reservation | Reservation Owner | `karaoke-reservation-confirmation` v1 |
| `GOODS_PURCHASE_CONFIRMED` | Goods Purchase Business Confirmation | Order | Order Customer | `goods-purchase-confirmation` v1 |
| `KARAOKE_RESERVATION_CANCELED` | 正規Reservation `CONFIRMED -> CANCELED` commit | Reservation + related Order | Reservation Owner | `karaoke-reservation-cancellation` v1 |
| `ORDER_REFUND_SUCCEEDED` | 正規full Refund Record `SUCCEEDED` | Order | Order Customer | `order-refund-succeeded` v1 |

以下はNotification Typeではない。

- Administratorによるretry / resend: 既存Notification Requestの再処理
- Resend delivery delayed / bounced: Provider Delivery Event
- Supabase Auth verification / password reset: Auth Notification

Goods Handoff完了後Emailは本バージョンでは追加しない。会場で既に対面受け渡しが完了した事実をEmail送信必須要件へ昇格させる上流Requirementがなく、`FR-EML-005` を理由に不要な通知種別を増やさないためである。

---

## 10. `ENTRY_PURCHASE_CONFIRMED`

- **Trigger:** `ENTRY_TICKET_PURCHASE` OrderのBusiness Confirmationが `SPEC-070` に従って成立
- **Business Cause:** `ENTRY_PURCHASE_CONFIRMED:<order_ref>:CONFIRMED`
- **Recipient:** Order Customer Business Profile
- **Source:** `source_order_id = Order`; `source_reservation_id = NULL`
- **Generation:** Business Confirmation transactionのmandatory Ticket issuance成立後
- **Suppression:** Provider Acceptance前でもOrder `CONFIRMED` というhistorical event自体は取消さない。通常は送信対象を維持する
- **Subject:** `【{event_name}】入場チケット購入完了のお知らせ`
- **Template:** `entry-purchase-confirmation` v1
- **CTA:** `/mypage/orders/{order_ref}` (`PG-MYP-004`)
- **Retry:** 同一Notification Request / 同一Business Causeのみ
- **Duplicate prevention:** `business_cause_key UNIQUE`
- **Trace:** `FR-EML-002,006〜011`, `FR-TKT-012〜022`, `BR-NTF-001〜006`, `PAY-CFM-*`, `PG-MYP-004〜007`

Required render context:

```ts
{
  event_name: string;
  order_ref: uuid;
  confirmed_at: isoUtc;
  total: Money;
  entry_items: Array<{
    offering_name: string;
    quantity: positiveInteger;
  }>;
}
```

---

## 11. `KARAOKE_RESERVATION_CONFIRMED`

- **Trigger:** `KARAOKE_PURCHASE` Business ConfirmationでReservation `CONFIRMED` とKaraoke Ticket発行が成立
- **Business Cause:** `KARAOKE_RESERVATION_CONFIRMED:<reservation_ref>:CONFIRMED`
- **Recipient:** Reservation Owner Business Profile
- **Source:** `source_order_id` と `source_reservation_id` の両方を設定
- **Generation:** Reservation / Ticket成立とOrder confirmationのcommit boundary
- **Suppression:** Provider call開始前にReservationが既に `CANCELED` と確認できた場合、未送信confirmationを `CANCELED` とし、`KARAOKE_RESERVATION_CANCELED` の存在を保証する。Provider call開始後または`SENT`後はconfirmationを取消さない
- **Subject:** `【{event_name}】カラオケ予約完了のお知らせ`
- **Template:** `karaoke-reservation-confirmation` v1
- **CTA:** `/mypage/karaoke/{reservation_ref}` (`PG-MYP-009`)
- **Retry:** Reservationを再生成せずNotificationだけをretry
- **Duplicate prevention:** `business_cause_key UNIQUE`
- **Trace:** `FR-EML-003,005〜011`, `FR-KRK-017〜027`, `BR-KRK-*`, `BR-NTF-*`, `KRK-CFM-*`, `PG-MYP-008〜010`

Required render context:

```ts
{
  event_name: string;
  order_ref: uuid;
  reservation_ref: uuid;
  confirmed_at: isoUtc;
  usage_start: isoUtc;
  usage_end: isoUtc;
  total: Money;
  slot_display_name: string | null;
}
```

---

## 12. `GOODS_PURCHASE_CONFIRMED`

- **Trigger:** `GOODS_PURCHASE` OrderのBusiness Confirmation成立
- **Business Cause:** `GOODS_PURCHASE_CONFIRMED:<order_ref>:CONFIRMED`
- **Recipient:** Order Customer Business Profile
- **Source:** `source_order_id = Order`; `source_reservation_id = NULL`
- **Generation:** Goods Allocation commit / Goods purchase entitlement成立後
- **Suppression:** 通常自動suppressionなし。後のRefundは別通知で表現する
- **Subject:** `【{event_name}】グッズ購入完了のお知らせ`
- **Template:** `goods-purchase-confirmation` v1
- **CTA:** `/mypage/orders/{order_ref}` (`PG-MYP-004`)
- **Retry:** Goods在庫 / Handoff stateを再実行しない
- **Duplicate prevention:** `business_cause_key UNIQUE`
- **Trace:** `FR-EML-004,006〜011`, 関連 `FR-GDS-*`, `BR-GDS-*`, `BR-NTF-*`, `PAY-CFM-*`, `PG-MYP-004`, `PG-MYP-011〜012`

Required render context:

```ts
{
  event_name: string;
  order_ref: uuid;
  confirmed_at: isoUtc;
  total: Money;
  goods_items: Array<{
    goods_name: string;
    quantity: positiveInteger;
  }>;
  handoff_instructions: string | null;
}
```

---

## 13. `KARAOKE_RESERVATION_CANCELED`

- **Trigger:** `SPEC-090` の正規Reservation cancellationで `CONFIRMED -> CANCELED` がcommit
- **Business Cause:** `KARAOKE_RESERVATION_CANCELED:<reservation_ref>:CANCELED`
- **Recipient:** Reservation Owner Business Profile
- **Source:** `source_reservation_id` 必須、related Orderが解決可能なら `source_order_id` も設定
- **Generation:** cancellation transactionの正常commit boundary
- **Suppression:** cancellation自体がhistorical eventのため通常suppressionなし
- **Subject:** `【{event_name}】カラオケ予約取消のお知らせ`
- **Template:** `karaoke-reservation-cancellation` v1
- **CTA:** `/mypage/karaoke/{reservation_ref}` (`PG-MYP-009`)
- **Retry:** Reservation / Ticket cancellationを再実行しない
- **Duplicate prevention:** `business_cause_key UNIQUE`
- **Trace:** `FR-EML-005〜011`, `FR-KRK-024〜026`, `FR-ADM-020〜021`, `KRK-CAN-*`, `BR-NTF-*`

Required render context:

```ts
{
  event_name: string;
  reservation_ref: uuid;
  canceled_at: isoUtc;
  usage_start: isoUtc;
  usage_end: isoUtc;
  cancellation_reason_label: string | null;
}
```

`cancellation_reason_label` はserver-side allowlist reason codeから生成した表示文だけを許可し、Administratorの自由記述noteをそのままEmailへ埋め込まない。

---

## 14. `ORDER_REFUND_SUCCEEDED`

- **Trigger:** `SPEC-070` の正規full Refund Recordが `SUCCEEDED`
- **Business Cause:** `ORDER_REFUND_SUCCEEDED:<order_ref>:FULL_REFUND_SUCCEEDED`
- **Recipient:** Order Customer Business Profile
- **Source:** `source_order_id = Order`; Reservationが関連していてもsource Reservation必須とはしない
- **Generation:** Refund RecordのProvider successをBusiness Databaseへ永続化したcommit boundary
- **Suppression:** 通常suppressionなし
- **Subject:** `【{event_name}】返金完了のお知らせ`
- **Template:** `order-refund-succeeded` v1
- **CTA:** `/mypage/orders/{order_ref}` (`PG-MYP-004`)
- **Retry:** Refund API / Stripe refundを再実行しない
- **Duplicate prevention:** 通常full refundが1 Orderにつき最大1件という`SPEC-070`の境界 + `business_cause_key UNIQUE`
- **Trace:** `FR-EML-005〜011`, `FR-ADM-006,020〜021`, `PAY-RFD-*`, `BR-NTF-*`, `PG-MYP-004`

Required render context:

```ts
{
  event_name: string;
  order_ref: uuid;
  refunded_at: isoUtc;
  refunded_total: Money;
}
```

本通知はFinancial Refund完了を通知する。Ticket / Reservation / Goods Handoffの現在状態が同時に取消済みであると推測して本文へ断定してはならない。

---

# Part IV — Recipient Resolution

## 15. Recipient authority

Notification Requestは `recipient_profile_id` を必須とする。

workerは次の順序でrecipientを解決する。

1. `recipient_profile_id` から `app.business_profiles` を取得する。
2. `business_profiles.auth_subject` を取得する。
3. Hono server / workerだけが使用できるSupabase Auth Admin APIでAuth Subjectをlookupする。
4. Auth userのcurrent primary Emailを取得する。
5. Email確認済み状態をserver-sideで確認する。
6. verified Emailが取得できた場合だけRecipient Snapshotとして保存する。

**EML-RCP-001:** Client supplied Email、Profile display field、Stripe Customer Emailをrecipient authorityとして使用しない。

**EML-RCP-002:** Supabase Auth lookupはserver-sideで行い、Service credentialをBrowser / Next.js Clientへ渡さない。

### 15.1 Verified Email

Business Notificationのrecipientに使用できるのは、Supabase Auth上でcurrent Emailが存在し、Email確認済みであることをserver-sideで確認できる場合だけとする。

Email未確認、Email不存在の場合、元Business Transactionは変更せずNotificationを `FAILED_RETRYABLE` とし、Delivery Jobを `BLOCKED` にする。

### 15.2 Recipient Snapshot timing

Recipient Snapshotは**初回Provider callより前、初回worker処理時**に確定する。

- Notification Request生成時にはSupabase Auth network callを行わない。
- 初回worker処理前にUserがEmailを変更し、その新Emailが確認済みなら新しいcurrent Emailをsnapshotする。
- Snapshot確定後の自動retryは同じsnapshotを使用する。

**EML-RCP-003:** 自動retryのたびにcurrent Emailを引き直して宛先を暗黙に変更しない。

理由は、Unknown Provider Result時に「旧addressへ受理済みかもしれない通知」を別addressへ重複送信することを避けるためである。

### 15.3 Email変更後のmanual recovery

Administrator retryは原則 `recipient_mode = "SNAPSHOT"` とする。

`recipient_mode = "CURRENT_VERIFIED"` は以下をすべて満たす場合だけ許可する。

- Notification State = `FAILED_RETRYABLE`
- Delivery Job = `BLOCKED`
- 最終failureが `RECIPIENT_UNAVAILABLE` または `PROVIDER_PERMANENT_RECIPIENT`
- Provider Acceptance済みattemptが存在しない
- Unknown Provider Resultが存在しない
- current Supabase Auth Emailがverified

この場合、JobのRecipient Snapshotをcurrent verified Emailへ更新し、snapshot revisionをincrementしたうえで新しいDelivery Attemptを作る。

**EML-RCP-004:** Unknown Provider Resultがある状態でrecipient snapshotを変更してはならない。

### 15.4 Auth Identity deleted / inaccessible

- Auth Subjectが明確に存在しない: Notification `FAILED_RETRYABLE` + Job `BLOCKED`、failure=`AUTH_IDENTITY_NOT_FOUND`
- Auth Service一時障害: Notification `FAILED_RETRYABLE` + Job `READY`、failure=`AUTH_LOOKUP_TEMPORARY`
- Business Profile row自体が存在しない / relation破損: Notification `FAILED_RETRYABLE` + Job `BLOCKED`、Consistency Review対象

いずれもOrder / Ticket / Reservation / Goods / Refundを変更しない。

---

# Part V — Template Contract

## 16. Template ID / versioning

TemplateはReact Email componentとして次のID / versionを持つ。

```text
entry-purchase-confirmation@1
karaoke-reservation-confirmation@1
goods-purchase-confirmation@1
karaoke-reservation-cancellation@1
order-refund-succeeded@1
```

Template versionはDelivery Job生成時にpinする。

- 既存JobのTemplate versionをdeploy後に自動更新しない。
- 文意・required variables・layout sectionの意味変更はversionをincrementする。
- typo / styleだけの変更でも既存pending jobを別versionへ暗黙migrationしない。
- version migrationを行う場合は明示的なdata migration / recovery operationとする。

**EML-TPL-001:** `notification_type` と `template_id/version` のmappingはserver source codeのexhaustive mapとZod discriminated unionで管理し、未知Typeをdefault Templateへ流さない。

---

## 17. 共通render contract

### 17.1 Required common variables

全Templateは少なくとも次を受ける。

```ts
{
  event_name: string;
  app_base_url: url;
}
```

`app_base_url` はserver-side deployment configurationから得る。`render_context`へ固定保存しなくてよい。

### 17.2 Timestamp formatting

Business contentの日時表示は `Asia/Tokyo` に変換し、次の形式をcanonicalとする。

```text
{YYYY}年{M}月{D}日 {HH}:{mm}（JST）
```

DB / API上のabsolute timestampはUTC ISO 8601を維持する。

### 17.3 Money formatting

- Canonical inputはminor unitのdecimal string / BigInt + ISO currency code。
- floating pointでamountを計算しない。
- currencyのfraction digitを `Intl.NumberFormat('ja-JP', { style: 'currency', currency })` のresolved currency digitsから取得し、BigIntを安全にmajor-unit表記へ変換する。
- 未対応currencyはrender failureとし、推測して`¥`等を付けない。

### 17.4 Missing / invalid context

各Templateの`render_context`をZodでvalidateしてからReact Email renderを行う。

required valueが欠落 / 型不正 / unsupported currency / invalid timestampの場合:

1. Provider callを行わない。
2. Delivery Attemptを `PERMANENT_FAILURE`、failure stage=`RENDER` とする。
3. Notificationを `FAILED_RETRYABLE` とする。
4. Jobを `BLOCKED` とする。
5. source Order / Reservationを対象にConsistency Reviewを作成する。

**EML-TPL-002:** missing contextを空文字、`不明`、架空値へ自動補完して送信しない。

### 17.5 HTML safety

- React Emailの通常text node escapingを使用する。
- user-controlled / operator-controlled stringへ `dangerouslySetInnerHTML` を使用しない。
- URLはserver-sideで既存Routeから構築する。
- arbitrary HTML、Markdown raw HTMLをTemplate variableとして受けない。
- Administrator自由記述noteをそのままEmail本文へ出さない。

---

## 18. Template本文 — Entry Ticket Purchase Confirmation

### 18.1 Subject

```text
【{event_name}】入場チケット購入完了のお知らせ
```

### 18.2 Preheader

```text
入場チケットの購入が完了しました。購入内容はマイページから確認できます。
```

### 18.3 HTML / plain-text共通本文

```text
{event_name} へのお申し込みありがとうございます。
入場チケットの購入が完了しました。

■ ご注文
注文番号: {order_ref}
購入確定日時: {confirmed_at_jst}

■ 購入内容
{entry_items_lines}

合計: {formatted_total}

入場チケットとQRはマイページからご確認ください。
メール内にはQRそのものを掲載していません。

[購入内容を確認する]
{app_base_url}/mypage/orders/{order_ref}

このメールが届かなかった場合でも、購入の成立状態はマイページに表示されるBusiness Database上の状態が基準です。
本メールは送信専用の場合があります。お問い合わせ方法はイベントサイトの案内をご確認ください。
```

`entry_items_lines` は `・{offering_name} × {quantity}` の繰り返しとする。

---

## 19. Template本文 — Karaoke Reservation Confirmation

### 19.1 Subject

```text
【{event_name}】カラオケ予約完了のお知らせ
```

### 19.2 Preheader

```text
カラオケ予約が確定しました。予約時刻とQRはマイページから確認できます。
```

### 19.3 本文

```text
{event_name} のカラオケ予約が完了しました。

■ ご予約
予約番号: {reservation_ref}
利用日時: {usage_start_jst} 〜 {usage_end_jst}
{slot_display_name_line}
注文番号: {order_ref}
購入確定日時: {confirmed_at_jst}
合計: {formatted_total}

当日の受付に使用するKaraoke QRはマイページから表示してください。
QRのraw tokenは本メールには掲載しません。

[予約内容を確認する]
{app_base_url}/mypage/karaoke/{reservation_ref}

予約の現在状態、受付可否、QRの有効性はマイページおよび当日のBusiness Database上の状態が基準です。
```

`slot_display_name` がnullの場合、その行自体を表示しない。

---

## 20. Template本文 — Goods Purchase Confirmation

### 20.1 Subject

```text
【{event_name}】グッズ購入完了のお知らせ
```

### 20.2 Preheader

```text
グッズの購入が完了しました。購入内容と会場受け取り案内をご確認ください。
```

### 20.3 本文

```text
{event_name} のグッズをご購入いただきありがとうございます。
ご注文の購入処理が完了しました。

■ ご注文
注文番号: {order_ref}
購入確定日時: {confirmed_at_jst}

■ 購入内容
{goods_items_lines}

合計: {formatted_total}

■ 受け取りについて
本システムのグッズ履行方式は会場受け取りです。
{handoff_instructions_or_fallback}

[購入内容を確認する]
{app_base_url}/mypage/orders/{order_ref}

購入内容と受け渡しの現在状態はマイページから確認できます。
```

`handoff_instructions` が設定されている場合はserver-side snapshotを表示する。nullの場合は次を表示する。

```text
受け取り場所・時間などの最新案内は、マイページまたはイベントサイトの案内をご確認ください。
```

---

## 21. Template本文 — Karaoke Reservation Cancellation

### 21.1 Subject

```text
【{event_name}】カラオケ予約取消のお知らせ
```

### 21.2 Preheader

```text
カラオケ予約の取消が確定しました。現在状態はマイページから確認できます。
```

### 21.3 本文

```text
{event_name} のカラオケ予約が取り消されました。

■ 対象予約
予約番号: {reservation_ref}
予約していた利用日時: {usage_start_jst} 〜 {usage_end_jst}
取消日時: {canceled_at_jst}
{cancellation_reason_line}

[予約の現在状態を確認する]
{app_base_url}/mypage/karaoke/{reservation_ref}

返金が伴う場合、金融上の返金完了は別途Order / Refundの現在状態に従います。
予約取消メールだけを根拠に返金済みとは判断しないでください。
```

`cancellation_reason_label` がnullの場合は理由行を表示しない。

---

## 22. Template本文 — Full Refund Succeeded

### 22.1 Subject

```text
【{event_name}】返金完了のお知らせ
```

### 22.2 Preheader

```text
対象注文の返金処理が完了しました。注文の現在状態はマイページから確認できます。
```

### 22.3 本文

```text
{event_name} のご注文について、返金処理が完了しました。

■ 返金対象
注文番号: {order_ref}
返金完了日時: {refunded_at_jst}
返金額: {formatted_refunded_total}

[注文の現在状態を確認する]
{app_base_url}/mypage/orders/{order_ref}

このメールは金融上の返金完了をお知らせするものです。
Ticket、Karaoke Reservation、Goods受け渡し等の現在状態は、それぞれマイページに表示されるBusiness Database上の状態をご確認ください。
```

---

# Part VI — Email Link Contract

## 23. Link destination

Email CTAは `SPEC-050` の既存Routeだけを使用する。

| Notification Type | Page | Route |
|---|---|---|
| `ENTRY_PURCHASE_CONFIRMED` | `PG-MYP-004` | `/mypage/orders/{order_ref}` |
| `KARAOKE_RESERVATION_CONFIRMED` | `PG-MYP-009` | `/mypage/karaoke/{reservation_ref}` |
| `GOODS_PURCHASE_CONFIRMED` | `PG-MYP-004` | `/mypage/orders/{order_ref}` |
| `KARAOKE_RESERVATION_CANCELED` | `PG-MYP-009` | `/mypage/karaoke/{reservation_ref}` |
| `ORDER_REFUND_SUCCEEDED` | `PG-MYP-004` | `/mypage/orders/{order_ref}` |

**EML-LNK-001:** Email linkへInternal bigint IDを使用しない。

**EML-LNK-002:** Public Referenceを知ることはAuthorizationではない。Mypage routeは `SPEC-060` / `SPEC-110` のowner-safe lookupを必須とする。

**EML-LNK-003:** QR raw token、Supabase token、Stripe secret、Checkout Session secretをEmail URLへ埋め込まない。

**EML-LNK-004:** `app_base_url` はserver-side deployment configurationから取得し、Client入力hostをそのままEmail linkへ反映しない。

---

# Part VII — Resend Integration

## 24. Resend API boundary

Business Email ProviderはResendとする。

Canonical call boundary:

```text
Email Worker
  -> recipient snapshot / render validation
  -> Resend Email API
  -> provider acceptance result
  -> Business Database persistence
```

Resend API keyはserver-only Secretとする。

### 24.1 Server configuration

以下をserver-only configurationとする。

- `RESEND_API_KEY`: required
- `EMAIL_FROM`: required。Resendで送信可能なverified senderをproject owner / deployment environmentが設定
- `EMAIL_REPLY_TO`: optional。未設定ならReply-To headerを省略
- `RESEND_WEBHOOK_SECRET`: webhook利用時required
- `APP_BASE_URL`: Email CTAのorigin

外部契約事実である実際のsender address / verified domainを本仕様で捏造しない。

**EML-RSD-001:** `EMAIL_FROM` / `EMAIL_REPLY_TO` をClient requestから受け取らない。

### 24.2 Provider request

Resend send requestは少なくとも次を含む。

- `from = EMAIL_FROM`
- `to = [recipient_email_snapshot]`
- `subject`
- React Email render済みHTML
- plain text fallback
- `replyTo = EMAIL_REPLY_TO` when configured
- provider idempotency key
- correlation tags `notification_ref`, `attempt_ref`, `notification_type`

一通知一recipientを基本とし、複数recipientへのbatch sendへ変換しない。

### 24.3 HTTP timeout

Resend Email APIの1回のserver request deadlineは **10秒** とする。

- 10秒以内にProvider Acceptanceを安全に確認できない場合はUnknown Provider Resultとして扱う。
- SDK内部の自動retryへ二重送信防止を委譲しない。
- application retryは本書のProvider Idempotency Keyを使用する。

### 24.4 Provider acceptance

Resendがsuccess responseとprovider email IDを返した場合、Provider Acceptance候補とする。

Business Databaseへのmessage ID / attempt result / Notification `SENT` 永続化が成功して初めてlocal処理を完了とする。

DB persistが失敗した場合は「Providerは受理済みかもしれないがlocal result未保存」であり、Unknown Provider Result recoveryへ進む。

---

## 25. Provider idempotency

ResendのEmail APIが提供するIdempotency Keyを必須利用する。

Canonical key:

```text
r39x-email/<delivery_job_public_ref>/<attempt_no>
```

- 256文字未満
- 1 Delivery Attemptにつき1key
- 同じAttemptのnetwork retry / response loss recoveryは同じkeyを使用
- payload hashが変わる場合は同じkeyを使用しない

**EML-IDM-001:** Same Attempt + same provider keyではrecipient、subject、HTML、text、Fromを変更しない。

**EML-IDM-002:** Providerが同一keyへ異なるpayloadを検出した場合はinternal consistency failureとし、別keyで自動再送しない。

### 25.1 Provider retention safety

SPEC-120 v1.0.0作成時点のResend公開仕様ではEmail API idempotency keyは24時間保持される。

本システムはUnknown Provider Resultのsame-key recoveryを、初回provider callから **23時間以内** に限定する。

23時間を超えてもProvider Acceptanceを確定できない場合:

1. 新しいprovider idempotency keyを作らない。
2. Notificationは `FAILED_RETRYABLE` を維持する。
3. Jobを `BLOCKED` とする。
4. source Order / Reservationを対象に `EMAIL_PROVIDER_RESULT_UNRESOLVED` Consistency Reviewを作成する。
5. Administratorによるblind resendを禁止する。

Providerのidempotency retention契約が変更された場合は、23時間安全cutoffを含む本仕様を再評価する。

---

## 26. Provider response classification

| Provider / Network outcome | Local classification | Notification | Job | Retry |
|---|---|---|---|---|
| 2xx + provider email ID | `ACCEPTED` | `SENT` | `CLOSED` | 不要 |
| 429でrequest未受理が明確 | `RETRYABLE_FAILURE` | `FAILED_RETRYABLE` | `READY` | backoff後、新Attempt可 |
| network timeout / connection reset | `UNKNOWN` | `FAILED_RETRYABLE` | `UNKNOWN_RESULT` | same Attempt / same keyのみ |
| 5xx | `UNKNOWN` | `FAILED_RETRYABLE` | `UNKNOWN_RESULT` | same Attempt / same keyのみ |
| 409 concurrent idempotent request | `UNKNOWN` | `FAILED_RETRYABLE` | `UNKNOWN_RESULT` | same keyを後で再照合 |
| 409 same key different payload | `PERMANENT_FAILURE` | `FAILED_RETRYABLE` | `BLOCKED` | consistency review |
| invalid idempotency key | `PERMANENT_FAILURE` | `FAILED_RETRYABLE` | `BLOCKED` | implementation/config修復後のみ |
| invalid / suppressed recipientをProvider request時に明確拒否 | `PERMANENT_FAILURE` | `FAILED_RETRYABLE` | `BLOCKED` | recipient recovery後manual retry可 |
| other deterministic request validation 4xx | `PERMANENT_FAILURE` | `FAILED_RETRYABLE` | `BLOCKED` | cause修復後のみ |

**EML-RSD-002:** 5xx / timeoutを「送られていない」と仮定して新keyで再送しない。

---

# Part VIII — Resend Webhook

## 27. Webhook採用

本システムはProvider Delivery Eventの追跡とUnknown Provider Resultの補助再照合のためResend Webhookを使用する。

購読対象:

- `email.sent`
- `email.delivered`
- `email.delivery_delayed`
- `email.bounced`
- `email.failed`
- `email.suppressed`
- `email.complained`

`email.opened` / `email.clicked` はBusiness requirementがなくprivacy上不要なため購読しない。

---

## 28. Webhook endpoint

### `API-WHK-EML-001` — Resend Webhook

- **Method:** `POST`
- **Path:** `/api/v1/webhooks/resend`
- **Authentication:** Supabase Authなし。Resend webhook signatureのみ
- **RPC export:** Browser向けHono RPCから除外
- **Body:** raw bodyを署名検証完了前にJSON reserializeしない
- **Headers:** `svix-id`, `svix-timestamp`, `svix-signature`
- **Secret:** `RESEND_WEBHOOK_SECRET`
- **Body limit:** 256 KiB
- **Success:** verified + processed / duplicate / safely ignored = `200`
- **Invalid signature / malformed signature input:** `400`
- **DB temporary failure:** `503` としProvider retryを許可

Resend SDKのwebhook verify helperまたは等価なSvix signature verificationを使用する。

**EML-WHK-001:** raw bodyを `JSON.parse` → `JSON.stringify` した値で署名検証してはならない。

### 28.1 Webhook dedupe

`svix-id` を `provider_event_key` として `app.email_provider_webhook_receipts` にUNIQUE保存する。

duplicate receiptは既存処理結果を返し、Notification / Attemptを重複更新しない。

### 28.2 Correlation

Webhook correlationは次の順で行う。

1. `provider_message_id`
2. provider tags `attempt_ref`
3. provider tags `notification_ref`

複数Job / Attemptへ解決される場合は通常処理せずConsistency Reviewへ送る。

### 28.3 Unknown result reconciliation

Notificationが `PENDING` / `FAILED_RETRYABLE` で、AttemptがUnknown / unresolvedのとき、署名検証済み `email.sent` 等からProvider Acceptanceとprovider message IDを一意に確立できた場合:

- Attemptを `ACCEPTED`
- Notificationを `SENT`
- Jobを `CLOSED`

へ進めてよい。

### 28.4 Post-acceptance delivery event

Notificationが既に `SENT` の場合:

- `email.delivered`: receipt履歴へdelivery timestampを保存
- `email.delivery_delayed`: receipt履歴へ保存
- `email.bounced`: bounce classification / allowlisted reasonを保存
- `email.failed`: delivery failure eventを保存
- `email.suppressed`: suppression eventを保存
- `email.complained`: complaint eventを保存

Notification Domain Stateは変更しない。

---

# Part IX — Delivery Worker / Concurrency

## 29. Worker execution model

Email送信はBrowser request内で同期実行しない。

Railway上のscheduled worker / worker processがHono API codebaseのserver serviceを直接実行する。

Canonical logical operation:

```text
EMAIL-WORKER-001 runEmailDeliveryBatch()
```

本仕様ではpublic / internal HTTP worker endpointを追加しない。これにより`SPEC-110`の`public/self/staff/admin/webhooks` namespaceを維持する。

Deployment上のscheduler command / frequencyは `SPEC-180`、共通retry cadenceは `SPEC-150` が定義する。

---

## 30. Claim primitive

複数workerが同一Jobを同時送信しないため、`app.email_delivery_jobs` をclaimする。

Claim transaction:

1. isolation=`READ COMMITTED`
2. candidate条件:
   - Notification State IN (`PENDING`,`FAILED_RETRYABLE`)
   - Job `processing_state IN ('READY','UNKNOWN_RESULT')`
   - `next_attempt_at IS NULL OR next_attempt_at <= transaction_timestamp()`
3. `ORDER BY next_attempt_at NULLS FIRST, notification_requests.created_at, email_delivery_jobs.id`
4. `FOR UPDATE OF email_delivery_jobs, notification_requests SKIP LOCKED`
5. Jobを `CLAIMED`
6. `claim_token = gen_random_uuid()`
7. `claimed_by = worker instance identifier`
8. `claim_expires_at = transaction_timestamp() + interval '120 seconds'`
9. commit

外部network call前にclaim transactionを閉じる。

**EML-CLM-001:** `FOR UPDATE SKIP LOCKED` を使用し、同一rowでworker同士を長時間blockさせない。

**EML-CLM-002:** Claim Leaseは120秒とし、Resend 10秒request deadlineより十分長くする。

### 30.1 Lock ordering

Email support persistenceで複数rowをlockする場合の順序は次とする。

```text
email_delivery_jobs
-> notification_requests
-> email_delivery_attempts
```

Admin retry / cancel、send result persist、lease recoveryも同順序を使用する。

---

## 31. Crash recovery

### 31.1 Crash after claim / before provider attempt

Job `CLAIMED` のleaseが期限切れし、active attemptに `provider_called_at IS NULL` なら、claimをreleaseして `READY` へ戻し、新workerが処理してよい。`provider_called_at IS NOT NULL` かつProvider Acceptance未確定なら `UNKNOWN_RESULT` へ戻し、同じAttempt / same provider keyのreconciliationだけを許可する。

### 31.2 Crash after provider call marker / before network call

`provider_called_at` はnetwork call直前のshort transactionで記録する。

その直後にcrashした場合、実際には未送信であってもlocal側は「送信開始可能性あり」と扱う。

同じAttempt / same provider idempotency keyで再照合するためduplicate sendは発生しない。

### 31.3 Crash / DB failure after Provider Acceptance

Provider success response後にDB persistできなかった場合、Attemptは`provider_called_at`あり・accept結果未保存となる。

lease expiry後:

- Job `UNKNOWN_RESULT`
- Notification `FAILED_RETRYABLE`
- same Attempt / same provider keyでResendへ再要求

Resendが同一key resultを返したらprovider message IDをpersistし、Notification `SENT`へ収束する。

新Attempt / new provider keyを作成しない。

---

## 32. Canonical send sequence

1. Job claim
2. source suppression predicate評価
3. Recipient Snapshot確認 / 必要ならSupabase Auth lookup
4. render context Zod validation
5. React Email HTML / text render
6. Delivery Attempt作成
7. request payload hash保存
8. `provider_called_at` をDB commit
9. DB transaction外でResend API call
10. Provider response分類
11. short DB transactionでAttempt / Notification / Job更新
12. claim release / close

### 32.1 Suppression before provider call

`KARAOKE_RESERVATION_CONFIRMED` でsource Reservationが既に `CANCELED` の場合のみ、本仕様で定義したsuperseded suppressionを適用できる。

- Provider call未開始: Notification `CANCELED`
- Job `CLOSED`
- cancellation notificationが存在しなければ同じbusiness cause規則で補完

他Notification Typeをsource state変化だけで自動cancelしない。

---

# Part X — Retry Semantics

## 33. Retry classification

本仕様は「何をretryしてよいか」を定義する。具体的な通常backoff sequence /最大自動retry回数は `SPEC-150` がCanonical Ownerとなる。

| Failure | Auto retry | Same Delivery Attempt | New Delivery Attempt | Manual recovery |
|---|---:|---:|---:|---:|
| Auth lookup temporary failure | Yes | No provider call | 次cycleでNew attempt可 | 可 |
| Email missing / unverified | No | - | 条件修復後 | 可 |
| Auth Identity not found | No | - | 原則不可 | review |
| Render context invalid | No | - | context修復後 | review |
| Resend 429 | Yes | No | Yes | 可 |
| Resend network timeout | Yes | **Yes** | No | provider safe window内のみ |
| Resend 5xx | Yes | **Yes** | No | provider safe window内のみ |
| concurrent idempotent request | Yes | **Yes** | No | 不要 |
| invalid idempotent request | No | No | No | consistency review |
| Provider permanent recipient rejection before acceptance | No | No | recipient refresh後のみ | 可 |
| DB failure before provider call | Yes | no provider side effect | 状況に応じ | 可 |
| DB failure after provider call | Yes | **same attempt / same key** | No | safe window超過でreview |
| Notification already `SENT` | No | No | No | resend禁止 |
| Notification `CANCELED` | No | No | No | retry禁止 |

**EML-RTY-001:** Notification retryは元Order / Ticket / Reservation / Goods / Refund operationを呼び直さない。

**EML-RTY-002:** `FAILED_RETRYABLE` は「常に自動retryする」を意味しない。`BLOCKED` support stateでは原因修復まで停止する。

---

# Part XI — Notification Cancellation

## 34. `CANCELED` semantics

`CANCELED` はProvider Acceptance前のNotification Requestを「この論理通知は今後送らない」と確定するDomain Stateである。

### 34.1 Cancel可能state

許可:

- `PENDING -> CANCELED`
- `FAILED_RETRYABLE -> CANCELED`

禁止:

- `SENT -> CANCELED`
- `CANCELED -> *`

### 34.2 Workerとの競合

Admin / suppression cancellationはJob / Notificationをlockし、次のときだけ成立する。

- Job `READY` または `BLOCKED`
- active `CLAIMED` でない
- `UNKNOWN_RESULT` でない
- Provider Acceptance済みAttemptがない

`CLAIMED` / `UNKNOWN_RESULT` では `409 NOTIFICATION_IN_FLIGHT` または `409 NOTIFICATION_PROVIDER_RESULT_UNKNOWN` とし、cancelを成立させない。

**EML-CAN-001:** Providerへ受理された可能性がある通知を「cancelしたから送られていない」と偽装しない。

### 34.3 Source Business cancellationとの関係

source Order / Reservation / Refund state changeとNotification `CANCELED` を自動同一視しない。

例外は本書11章で定義した未送信Karaoke Reservation confirmationのsuperseded suppressionだけである。

Reservation cancellation自体は別の `KARAOKE_RESERVATION_CANCELED` Notification Requestを生成する。

**EML-CAN-002:** Notification cancellationから元Order / Ticket / Reservation / Goods stateを変更しない。

---

# Part XII — Administrator Server Operation

## 35. Capability mapping

新しいCapabilityを追加しない。

- Notification / delivery failure read: `recovery.review`
- failed notification retry / unsent cancel: `recovery.exception.execute`

これは `SPEC-060` の定義どおり、`recovery.exception.execute` をgeneric superuser bypassとして使用するものではない。本章の明示Operationだけに適用する。

Staff RoleにはEmail Notification管理Capabilityを与えない。

---

## 36. Admin API catalog

### `API-ADM-EML-001` — List Notification Requests

- **Method:** `GET`
- **Path:** `/api/v1/admin/notifications`
- **Auth:** Administrator
- **Capability:** `recovery.review`
- **Query allowlist:**
  - `state=PENDING|SENT|FAILED_RETRYABLE|CANCELED`
  - `notification_type=<canonical type>`
  - `processing_state=READY|CLAIMED|UNKNOWN_RESULT|BLOCKED|CLOSED`
  - `limit`, `cursor` per SPEC-110
- **Response:** `notification_ref` = `email_delivery_jobs.public_ref`, notification type, Domain state, processing state, created/sent timestamp, source public refs, last failure class
- **Do not return:** recipient Email全文、render_context全文、Internal ID、Email body全文、Provider response body

### `API-ADM-EML-002` — Notification Detail

- **Method:** `GET`
- **Path:** `/api/v1/admin/notifications/{notification_ref}`
- **Capability:** `recovery.review`
- **Lookup:** `email_delivery_jobs.public_ref` → Notification Request / source public refs
- **Response:** allowlisted operational summary、template id/version、recipient snapshot status (`PRESENT|MISSING`, address masked)、last attempt summary、provider message ID if operationally必要
- **404:** unknown ref

### `API-ADM-EML-003` — Delivery Attempts

- **Method:** `GET`
- **Path:** `/api/v1/admin/notifications/{notification_ref}/delivery-attempts`
- **Capability:** `recovery.review`
- **Response:** attempt ref, attempt no, result, failure stage/class, safe provider error code, provider message ID, timestamps
- **No response:** Email body、full provider body、raw recipient Email

### `API-ADM-EML-004` — Retry Failed Notification

- **Method:** `POST`
- **Path:** `/api/v1/admin/notifications/{notification_ref}/retry`
- **Capability:** `recovery.exception.execute`
- **Idempotency-Key:** required
- **Body:**

```json
{
  "recipient_mode": "SNAPSHOT"
}
```

Zod:

```ts
z.object({
  recipient_mode: z.enum(["SNAPSHOT", "CURRENT_VERIFIED"]).default("SNAPSHOT")
})
```

Preconditions:

- Notification = `FAILED_RETRYABLE`
- Job != `CLAIMED`
- Job != `UNKNOWN_RESULT`
- no accepted provider attempt
- `CURRENT_VERIFIED` は15.3の追加条件を満たす

Effect:

- 元Business Cause / Notification rowを維持
- 必要ならrecipient snapshot revision更新
- Job `READY`
- `next_attempt_at = transaction_timestamp()`
- Provider network callはadmin request内で実行しない

Success:

- `202`
- `result = RETRY_SCHEDULED`

`SENT` は `409 NOTIFICATION_ALREADY_SENT`、`CANCELED` は `409 NOTIFICATION_CANCELED`。

### `API-ADM-EML-005` — Cancel Unsent Notification

- **Method:** `POST`
- **Path:** `/api/v1/admin/notifications/{notification_ref}/cancel`
- **Capability:** `recovery.exception.execute`
- **Idempotency-Key:** required
- **Body:**

```json
{
  "reason": "NO_LONGER_REQUIRED"
}
```

`reason` はallowlisted operational reason codeとし、free textを必須にしない。

Preconditionsは34章に従う。

Success:

- `200`
- Notification `CANCELED`
- Job `CLOSED`
- Business source unchanged

### 36.1 Admin transport idempotency

Admin retry / cancelは `SPEC-110` のTransport Idempotency semanticsを使用する。

- same Principal + Operation ID + normalized fingerprintで同じresultを再利用
- same key / different payloadは `409 IDEMPOTENCY_KEY_REUSED`
- Transport keyが失われてもDomain state / row lockでduplicate effectを防ぐ

---

## 37. Notification API error codes

SPEC-110 common error envelopeを使用し、追加codeは本仕様のNotification operationだけに限定する。

| HTTP | Code | 意味 | retryable |
|---:|---|---|---|
| 409 | `NOTIFICATION_ALREADY_SENT` | `SENT` でretry/cancel不可 | false |
| 409 | `NOTIFICATION_CANCELED` | `CANCELED` でretry不可 | false |
| 409 | `NOTIFICATION_IN_FLIGHT` | worker claim中 | true |
| 409 | `NOTIFICATION_PROVIDER_RESULT_UNKNOWN` | provider acceptance不明でblind mutation不可 | false |
| 409 | `NOTIFICATION_NOT_RETRYABLE_NOW` | repair precondition未成立 | false |
| 422 | `NOTIFICATION_RECIPIENT_UNAVAILABLE` | current verified recipientを安全に取得不能 | false |
| 503 | `EMAIL_PROVIDER_TEMPORARY_FAILURE` | Resend依存一時障害 | true |

Internal provider response body、stack trace、SQLSTATE、Email全文を`details`へ含めない。

---

# Part XIII — Email Delivery Support Persistence

## 38. Canonical ownership

`SPEC-100` が所有する `app.notification_requests` は変更しない。

本書はEmail delivery processingのため次のsupport tableを追加する。

```text
app.email_delivery_jobs
app.email_delivery_attempts
app.email_provider_webhook_receipts
```

これらのProcessing StateはNotification Domain Stateではない。

---

## 39. `app.email_delivery_jobs`

Purpose: 1 Notification Requestに1件対応し、Template pin、recipient snapshot、claim lease、queue stateを保持する。

| Column | Type | Null | Rule |
|---|---|---:|---|
| `id` | bigint identity | No | PK |
| `public_ref` | uuid | No | `gen_random_uuid()`, UNIQUE |
| `notification_request_id` | bigint | No | FK -> `notification_requests(id)` ON DELETE RESTRICT, UNIQUE |
| `provider` | text | No | `RESEND` only |
| `template_id` | text | No | canonical template ID |
| `template_version` | integer | No | `> 0` |
| `recipient_email_snapshot` | text | Yes | first send前にserver-side設定 |
| `recipient_snapshot_revision` | integer | No | default 0, `>= 0` |
| `recipient_snapshot_at` | timestamptz | Yes | snapshot時刻 |
| `processing_state` | text | No | support state |
| `next_attempt_at` | timestamptz | Yes | queue schedule |
| `claim_token` | uuid | Yes | claimed時のみ |
| `claimed_by` | text | Yes | non-secret worker instance ID |
| `claim_expires_at` | timestamptz | Yes | claimed時のみ |
| `last_failure_class` | text | Yes | allowlisted classification |
| `last_error_code` | text | Yes | safe provider/internal code only |
| `created_at` | timestamptz | No | `transaction_timestamp()` |
| `updated_at` | timestamptz | No | repository update |

Processing State:

```text
READY
CLAIMED
UNKNOWN_RESULT
BLOCKED
CLOSED
```

CHECK:

- `CLAIMED` -> `claim_token`, `claimed_by`, `claim_expires_at` all non-null
- non-`CLAIMED` -> claim fields null
- `BLOCKED` / `CLOSED` -> `next_attempt_at IS NULL`
- `recipient_email_snapshot IS NULL` iff `recipient_snapshot_at IS NULL`

Named constraints / indexes:

- `pk_email_delivery_jobs`
- `uq_email_delivery_jobs_public_ref`
- `uq_email_delivery_jobs_notification_request`
- `ck_email_delivery_jobs_provider`
- `ck_email_delivery_jobs_processing_state`
- `ck_email_delivery_jobs_claim_shape`
- `ix_email_delivery_jobs_queue(processing_state, next_attempt_at, id) WHERE processing_state IN ('READY','UNKNOWN_RESULT')`
- `ix_email_delivery_jobs_claim_expiry(claim_expires_at) WHERE processing_state='CLAIMED'`

Normal hard delete禁止。

---

## 40. `app.email_delivery_attempts`

Purpose: recipient / render / provider requestのattempt historyとProvider Idempotency correlationを保持する。

| Column | Type | Null | Rule |
|---|---|---:|---|
| `id` | bigint identity | No | PK |
| `public_ref` | uuid | No | UNIQUE |
| `email_delivery_job_id` | bigint | No | FK -> jobs(id) ON DELETE RESTRICT |
| `attempt_no` | integer | No | `> 0` |
| `result` | text | No | support result |
| `failure_stage` | text | Yes | recipient/render/provider/persistence |
| `failure_class` | text | Yes | allowlisted classification |
| `recipient_email_snapshot` | text | Yes | attempt時の宛先snapshot |
| `recipient_snapshot_revision` | integer | No | job revision copy |
| `provider_idempotency_key` | text | No | UNIQUE |
| `payload_sha256` | text | Yes | rendered request fingerprint |
| `provider_message_id` | text | Yes | Resend email ID, partial UNIQUE |
| `provider_http_status` | integer | Yes | safe numeric status |
| `provider_error_code` | text | Yes | allowlisted code only |
| `started_at` | timestamptz | No | server time |
| `provider_called_at` | timestamptz | Yes | provider call可能性marker |
| `provider_accepted_at` | timestamptz | Yes | acceptance confirmation |
| `finished_at` | timestamptz | Yes | definitive local result |
| `created_at` | timestamptz | No | server time |
| `updated_at` | timestamptz | No | server time |

Result:

```text
PREPARED
ACCEPTED
RETRYABLE_FAILURE
PERMANENT_FAILURE
UNKNOWN
```

Failure Stage:

```text
RECIPIENT_RESOLUTION
RENDER
PROVIDER_REQUEST
PROVIDER_RESPONSE
PERSISTENCE
```

Constraints / indexes:

- `uq_email_delivery_attempts_job_no(email_delivery_job_id, attempt_no)`
- `uq_email_delivery_attempts_provider_idempotency_key(provider_idempotency_key)`
- partial unique `ux_email_delivery_attempts_provider_message_id(provider_message_id) WHERE provider_message_id IS NOT NULL`
- `ix_email_delivery_attempts_job_started(email_delivery_job_id, started_at DESC)`
- `ix_email_delivery_attempts_unknown(provider_called_at) WHERE result='UNKNOWN'`

Email HTML / plain text全文、Provider response body全文を保存しない。

---

## 41. `app.email_provider_webhook_receipts`

Purpose: Resend Webhookの署名検証済みeventをdedupeし、delivery historyを追跡する。

Columns:

- `id bigint identity PK`
- `provider text NOT NULL CHECK (provider='RESEND')`
- `provider_event_key text NOT NULL UNIQUE` — verified `svix-id`
- `email_delivery_attempt_id bigint NULL FK -> email_delivery_attempts(id) ON DELETE RESTRICT`
- `provider_message_id text NULL`
- `event_type text NOT NULL`
- `event_occurred_at timestamptz NOT NULL`
- `processing_result text NOT NULL CHECK IN ('PROCESSED','IGNORED','UNMATCHED')`
- `delivery_detail_code text NULL`
- `payload_sha256 text NOT NULL`
- `received_at timestamptz NOT NULL DEFAULT transaction_timestamp()`
- `processed_at timestamptz NULL`

Indexes:

- `uq_email_provider_webhook_receipts_event_key`
- `ix_email_provider_webhook_receipts_message_time(provider_message_id, event_occurred_at DESC)`
- `ix_email_provider_webhook_receipts_unmatched(received_at) WHERE processing_result='UNMATCHED'`

raw webhook bodyは署名検証中だけmemoryで扱い、通常DBへ全文保存しない。

---

## 42. Migration / transaction rules

SPEC-120 support table migrationは`SPEC-100`のarchitectureに従う。

- schema=`app`
- Internal PK=`bigint GENERATED ALWAYS AS IDENTITY`
- Admin APIでaddressableなJob / AttemptはUUID `public_ref`
- state/result=`text + named CHECK`
- timestamp=`timestamptz`
- historical FK=`ON DELETE RESTRICT`
- normal hard delete禁止
- isolation=`READ COMMITTED`
- explicit row lock
- `40001`, `40P01` だけをstandard transaction retryable SQLSTATEとして扱う
- known unique/constraint loserだけを既存結果へ収束
- Resend / Supabase Auth network call中にDB transactionをopenしない

**EML-DB-001:** `app.notification_requests.state`へProcessing Stateを追加してはならない。

**EML-DB-002:** provider response JSONを`render_context`へ保存しない。

**EML-DB-003:** Recipient Emailは`render_context`ではなくEmail delivery support persistenceへ保存する。

---

# Part XIV — Failure Semantics

## 43. Failure matrix

| Failure | Notification | Job / Attempt | Source Business | Recovery |
|---|---|---|---|---|
| Notification Request generation DB failure before commit | commit成否に従う | 未生成 | upstream DB failure semantics | source state確認後retry |
| committed sourceにNotification Request欠落 | missing | missing | **変更なし** | deterministic causeで通知だけ補完 |
| recipient Auth lookup temporary | `FAILED_RETRYABLE` | `READY` | 変更なし | auto retry |
| recipient missing/unverified | `FAILED_RETRYABLE` | `BLOCKED` | 変更なし | Email確認後manual/current recovery |
| Auth Identity missing | `FAILED_RETRYABLE` | `BLOCKED` | 変更なし | review |
| render failure | `FAILED_RETRYABLE` | `BLOCKED` | 変更なし | context / implementation repair |
| provider temporary 429 | `FAILED_RETRYABLE` | `READY` | 変更なし | backoff |
| provider permanent rejection before acceptance | `FAILED_RETRYABLE` | `BLOCKED` | 変更なし | recipient/config repair |
| provider response unknown | `FAILED_RETRYABLE` | `UNKNOWN_RESULT` | 変更なし | same key reconciliation |
| DB failure before provider call | state維持またはfailed tracking | lease recovery | 変更なし | retry |
| DB failure after provider acceptance | `FAILED_RETRYABLE` until reconciled | `UNKNOWN_RESULT` | 変更なし | same key / webhook |
| duplicate worker | 1 worker only | `SKIP LOCKED` loser skips | 変更なし | none |
| already `SENT` | `SENT` | `CLOSED` | 変更なし | resend禁止 |
| `CANCELED` | `CANCELED` | `CLOSED` | 変更なし | resend禁止 |
| business source inconsistency | state保持 / failed | `BLOCKED` | 変更なし | Consistency Review |

### 43.1 Consistency Review required cases

少なくとも次をConsistency Review対象とする。

- same `business_cause_key` でtype / recipient / source / context不一致
- Provider Idempotency Key payload mismatch
- Unknown Provider Resultがprovider safe windowを超過
- webhook correlationが複数Attemptへ解決
- recipient profile / auth subject relation破損
- render contextとsource entityが論理矛盾
- Notification `CANCELED` なのにProvider Acceptance証拠を後から受信

既存 `app.consistency_review_cases` はNotification Request FKを持たないため、`source_order_id` または`source_reservation_id`を対象FKとして使用し、reason codeにEmail consistency reasonを保存する。Notification Internal IDを`details`へ露出目的で入れず、server-side correlationはJob public ref / source relationで行う。

---

# Part XV — Security / Privacy Boundary

## 44. Secret

Server-only:

- Resend API key
- Resend webhook signing secret
- Supabase Auth Admin / service credential
- Provider idempotency internals that need not beClient visible

Clientへ返さない。

---

## 45. Personal data

Recipient EmailはPIIである。

- `app.email_delivery_jobs.recipient_email_snapshot` に必要最小限保存する。
- delivery attemptへそのattempt時snapshotを履歴としてコピーする。
- Admin APIはdefaultでmasked表示する。
- application logへfull recipient Emailを通常出力しない。
- metric labelへEmailを使用しない。
- Error responseへEmailを含めない。
- Provider webhook raw bodyを通常永続化しない。

normal hard deleteは禁止し、将来のprivacy retention / anonymization policyは `SPEC-140` / `SPEC-160` が本support persistenceを対象に明示する。

---

## 46. Email content data minimization

Templateへ含めてよい情報:

- event name
- Public Reference
- purchase / reservation / refund summary
- userが購入した商品名・数量
- reservation usage time
- server-side configured handoff guidance
- Mypage CTA

含めてはならない情報:

- Password / reset token / verification token
- Supabase access / refresh token
- Stripe secret / payment method secret
- raw QR token
- card data
- Internal bigint ID
- server stack / SQLSTATE
- arbitrary provider response body

---

## 47. Transactional Email / unsubscribe

本仕様の5 Notification Typeは購入・予約・取消・返金に直接関係する**Transactional Email**であり、Marketing subscriptionとは分離する。

- Marketing consentを送信Preconditionにしない。
- 通常のunsubscribe linkを本文へ追加しない。
- Marketing contentを同じTemplateへ混在させない。
- 将来Marketing Emailを追加する場合は、本Business Notification Typeへ便乗せず別Requirement / consent / unsubscribe contractを定義する。

外部法令・Provider policyによりTransactional Emailにも追加header等が必須となる場合は、`SPEC-140` / Provider contract更新で適用する。

---

# Part XVI — Implementation Boundary

## 48. 推奨source organization

```text
src/email/
  notification-types.ts
  generation.ts
  recipient-resolver.ts
  renderer.ts
  provider/
    resend.ts
  worker.ts
  retry-classifier.ts
  webhook.ts
  templates/
    entry-purchase-confirmation-v1.tsx
    karaoke-reservation-confirmation-v1.tsx
    goods-purchase-confirmation-v1.tsx
    karaoke-reservation-cancellation-v1.tsx
    order-refund-succeeded-v1.tsx
  schemas/
    contexts.ts
    provider.ts
src/api/routes/
  admin-notifications.ts
src/api/webhooks/
  resend.ts
```

Business Confirmation serviceはEmail senderを直接callせず、Notification Request generation serviceだけを呼ぶ。

---

## 49. Zod schema boundary

最低限次をZodでruntime validateする。

- notification type discriminated union
- render context per template
- provider webhook event envelope after signature verification
- Admin list query
- Admin retry body
- Admin cancel body
- Notification / Attempt success response

`render_context`はJSONBだからといってunknown objectのままTemplateへ渡さない。

---

# Part XVII — Idempotency Matrix

## 50. Idempotency categories

| Layer | Key / primitive | Meaning |
|---|---|---|
| Domain notification | `business_cause_key UNIQUE` | 同一Business Eventから同一論理Notification Request最大1件 |
| Delivery job | `UNIQUE(notification_request_id)` | 1 Notification Requestに1 Email Job |
| Delivery attempt | `UNIQUE(job_id, attempt_no)` | attempt history重複防止 |
| Provider idempotency | `r39x-email/<job_ref>/<attempt_no>` | 同一Provider requestのresponse loss / retryでduplicate send防止 |
| Provider message | partial UNIQUE `provider_message_id` | 1 provider emailを複数Attemptへbindしない |
| Webhook | UNIQUE verified `svix-id` | Provider event replay重複処理防止 |
| Admin transport | `Idempotency-Key` + Principal + Operation + fingerprint | HTTP retryのduplicate mutation防止 |

**EML-IDM-003:** Client Request IDまたはAdmin Transport keyをDomain Business Causeの唯一keyにしない。

**EML-IDM-004:** Provider Idempotency KeyをNotification `business_cause_key`の代替にしない。

---

# Part XVIII — Traceability

## 51. System Invariant trace

| Invariant | SPEC-120 |
|---|---|
| `INV-010-01` | Email failure / recipient failureでOrder historyを消さない |
| `INV-010-02` | Notification retryからOrder confirmationを呼ばない |
| `INV-010-03` | Notification retryからTicket issuanceを呼ばない |
| `INV-010-04` | Notification retryからKaraoke Slot / Reservationを再確定しない |
| `INV-010-06` | 全failure matrixでBusiness TransactionをRollbackしない |
| `INV-010-07` | Email Provider callをBusiness Confirmation atomicityへ混入しない |
| `INV-010-08` | Email CTAはowner-safe Mypage route、Admin operationはserver-side capability |
| `INV-010-10` | business cause / claim / provider idempotency / webhook dedupe |

---

## 52. Functional Requirement trace

| Requirement | 主な仕様 |
|---|---|
| `FR-EML-001` | Part I Auth Notification分離 |
| `FR-EML-002` | `ENTRY_PURCHASE_CONFIRMED` |
| `FR-EML-003` | `KARAOKE_RESERVATION_CONFIRMED` |
| `FR-EML-004` | `GOODS_PURCHASE_CONFIRMED` |
| `FR-EML-005` | Cancellation / Refund通知を必要最小限追加 |
| `FR-EML-006` | Notification Request generation / worker分離 |
| `FR-EML-007` | Failure matrix / `DI-030-008` |
| `FR-EML-008` | Notification-only retry |
| `FR-EML-009` | Business Cause / Provider / Transport idempotency分離 |
| `FR-EML-010` | `FAILED_RETRYABLE`, support state, provider recovery |
| `FR-EML-011` | CTA / Mypage route、Email非Authority |
| `FR-EML-012` | Template全文 / Provider / retry classification |
| `FR-ADM-001,019〜022` | Admin notification recovery operation / authorization / audit-ready result |
| `FR-XFN-019〜021,024,033` | external failure分離、追跡可能性、secret境界 |

---

## 53. Domain / Page / Auth trace

### Domain

- `BR-NTF-001〜006`
- `DI-030-008 Notification Independence`
- `DI-030-012 Retry-safe Domain Effects`
- related `BR-ORD-*`, `BR-TKT-*`, `BR-KRK-*`, `BR-GDS-*`

### Page / Flow

- `PG-XFN-001` Purchase Status
- `PG-MYP-004` Order Detail
- `PG-MYP-006〜007` Entry Ticket / QR
- `PG-MYP-009〜010` Karaoke Reservation / QR
- `PG-MYP-011〜012` Goods purchase
- related `UF-TKT-*`, `UF-KRK-*`, `UF-GDS-*`, `UF-MYP-*`, `UF-XFN-*`

Email未達時もこれらPageのBusiness Database current stateが利用者向けAuthorityである。

### Authentication

- `AR-SES-*`: server-side Auth verification
- `AR-ID-*`: Auth Subject ↔ Business Profile
- `AR-AZ-*`: high privilege operation authorization
- `AR-ROLE-013〜014`: explicit capability / recovery exception boundary
- `AR-FAIL-*`: Auth service failure時のFail Closed

---

## 54. Payment / Karaoke / Database / API trace

### Payment

- `PAY-CFM-*`: purchase confirmation後のNotification generation
- `PAY-RFD-*`: full Refund `SUCCEEDED` notification
- `PAY-IDM-*`: source Business idempotency
- `PAY-REC-*`: EmailはPayment consistencyを上書きしない

### Karaoke

- `KRK-CFM-*`: Reservation confirmation
- `KRK-CAN-*`: cancellation notification trigger
- Reservation cancellation後もSlot / Ticket ruleはSPEC-090 Authority

### Database

- `DB-XFN-001`
- `app.notification_requests`
- `business_cause_key UNIQUE`
- `ix_notification_requests_pending`
- SPEC-120 support tables / constraints / queue indexes
- `READ COMMITTED`
- `FOR UPDATE SKIP LOCKED`

### API

- `API-IDM-001〜002`
- `API-WHK-EML-001`
- `API-ADM-EML-001〜005`
- SPEC-110 Part XX §62 Notification Request generation boundary
- common request correlation ID / error envelope / Internal ID非公開

---

# Part XIX — Acceptance Criteria

## 55. Acceptance criteria

実装は少なくとも次を満たさなければならない。

1. Notification Request Domain Stateは4状態だけである。
2. Email successをOrder / Ticket / Reservation / Goods / RefundのBusiness Confirmation条件にしない。
3. Resend失敗で確定済みBusiness TransactionをRollbackしない。
4. Notification retryで元Business operationを再実行しない。
5. `business_cause_key UNIQUE`でsame logical notificationを最大1件にする。
6. `email_delivery_jobs.notification_request_id UNIQUE`でJobを1件にする。
7. Worker claimに`FOR UPDATE SKIP LOCKED`と120秒leaseを使用する。
8. Resend network call中にDB transactionをopenしない。
9. Provider call前に`provider_called_at`とProvider Idempotency Keyを永続化する。
10. timeout / 5xx / response lossをUnknown Resultとしてsame keyで再照合する。
11. Unknown Resultでnew provider keyを作らない。
12. Provider safe window超過後にblind resendしない。
13. Resend success後DB commit failureをUnknown Resultとして回復できる。
14. verified webhookからProvider Acceptanceを再照合できる。
15. webhook raw body signature verificationを行う。
16. webhook duplicateをverified `svix-id` uniqueでdedupeする。
17. `SENT`後のbounce等でNotification Domain Stateを逆行させない。
18. RecipientはBusiness Profile → Auth Subject → Supabase Authからserver-side解決する。
19. Client supplied Email / Stripe emailをrecipient authorityにしない。
20. 初回send前にrecipient snapshotを固定し、自動retryで宛先を暗黙変更しない。
21. Unknown Result中にrecipient snapshotを変更しない。
22. render contextをZod validationし、欠落値を架空補完しない。
23. Template versionをJob作成時にpinする。
24. Template本文にQR raw token、Credential token、Stripe secretを含めない。
25. Email CTAはSPEC-050既存Mypage routeを使用する。
26. Internal bigint IDをEmail link / Admin APIへ露出しない。
27. Email body全文 / Provider response body全文を通常log / DB attempt rowへ残さない。
28. Admin readは`recovery.review`、retry/cancelは`recovery.exception.execute`を使用し、新Capabilityを追加しない。
29. Admin retryは`FAILED_RETRYABLE`だけを対象とし、`SENT`を再送しない。
30. Notification cancelはProvider Acceptance前だけであり、source Business stateを変更しない。
31. Email未達でもCustomerがMypageから確定済み権利を確認できる。
32. Provider / DB failureを送信成功として偽装しない。
33. Requirement / Rule / Page / Auth / Payment / Karaoke / Database / APIへTrace可能である。

---

# Part XX — External Provider Contract Note

## 56. Resend contract assumption

SPEC-120 v1.0.0作成時点では、Resend公開仕様に次が存在することを前提とする。

- Email APIのIdempotency Key
- Idempotency Keyのprovider保持期間24時間
- success responseでprovider email IDを取得可能
- webhook signature verificationでraw bodyとSvix headersを使用
- email delivery系Webhook event

これらは本システム所有者が自由に変更できる事実ではない。

Provider仕様が変わった場合、実装が黙ってfallbackしてduplicate send riskを増やしてはならない。Idempotency / signature / provider correlationに影響する変更はSPEC-120の変更対象とする。

---

# Part XXI — 他仕様書との境界

## 57. SPEC-130 Admin / Staff

SPEC-120はNotification admin server operation / capability boundaryまでを定義する。

SPEC-130は以下を定義する。

- Notification list / failed filter UI
- detail / attempt history UI
- retry / recipient refresh confirmation UI
- cancel confirmation UI
- provider unknown / blockedの運用表示

SPEC-130は本書のretry precondition、Domain State、Capability、API pathを変更しない。

## 58. SPEC-140 Security

SPEC-140はSecret配置、PII retention / masking最終policy、CORS / CSRF / rate limit、webhook replay window等のSecurity Controlを定義する。

## 59. SPEC-150 Reliability

SPEC-150は通常retry backoff、worker cadence、max automatic attempt、alert threshold、Runbookを定義する。

ただし次は本書から変更してはならない。

- Unknown Resultはsame provider key
- 23時間provider safe cutoff
- blocked conditionではblind retryしない
- Notification retryでBusiness Transactionを再実行しない

## 60. SPEC-160 Observability

SPEC-160はNotification generation / claim / recipient resolution / render / provider call / webhook / retry / cancelのlog / metric / audit schemaを定義する。

Email body全文、recipient Email全文、Secretを通常logへ出さない本書の境界を弱めてはならない。

---

# Part XXII — 上流仕様変更要求

## 61. Upstream Change Request

なし。

本仕様は既存 `Notification Request` State、`app.notification_requests`、Permission Matrix、Business Confirmation、API namespaceを変更せず具体化できる。
