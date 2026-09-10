---
spec_id: SPEC-090
title: Karaoke Reservation Specification
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
related_specs:
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

# 090 Karaoke Reservation Specification

## 1. 目的

本書は、**off r39'x in 大阪らへん2027** Webシステムの完成形におけるKaraoke Slot、排他Scope、Slot生成、空き状況、Karaoke Hold、Hold期限、並行購入、Order / Stripe Checkoutとの接続、Karaoke Reservation確定・取消、Karaoke Ticketとの接続、通常Karaoke Check-in時間条件、Slot編集・販売停止、および失敗・retry・recovery境界を定義する。

本書は `SPEC-010`〜`SPEC-080` の上流仕様を変更または弱化せず、そこで確定したSystem Boundary、Functional Requirement、Domain State、User Flow、Page / Route、Authentication / Authorization、Order / Payment、Ticket / QR / Check-inのRuleを、Karaoke Reservation領域の実装可能かつ追跡可能なRuleへ具体化するCanonical Ownerである。

本書がCanonical Ownerとなるのは少なくとも以下である。

- Karaoke排他Scopeの論理モデル
- Karaoke Slotの時間モデルの具体化
- Slot batch generation semantics
- Slot availabilityのDomain判定
- Karaoke Holdの具体期限、期限起点、expiry / release semantics
- HoldとStripe Checkout 30分Payment Deadlineの時間整合
- 同一Slotへのconcurrent Hold / purchaseのwinner / loser
- Slot / Hold state transitionの具体条件
- Reservationの成立条件、Cardinality、Customer / Slot correlation
- Reservation cancellation
- cancellation後のSlot resale policy
- Slot editing safety
- Karaoke通常Check-in window
- `SPEC-080` へ渡すKaraoke Check-in time predicate / Ticket expiration cutoff
- Payment Confirmation / Ticket / Check-inとの接続
- Hold / Slot / Reservation / Ticket correlation不整合のConsistency Review境界

本書は、MVP、Step1、Step2等の実装フェーズで仕様を分断しない。長期運用される完成システムを対象とする。

---

## 2. 適用範囲

本書は以下へ適用する。

- 公開対象のKaraoke Slot
- Karaoke排他Scope
- AdministratorによるKaraoke Slot一括生成
- `PG-KRK-001〜003` に必要な販売案内・1時間bucket・個別Slot可否
- Authenticated UserによるKaraoke購入開始
- Karaoke Hold取得、維持、expiry、release、commit
- `KARAOKE_PURCHASE` Order / Stripe Checkoutとの接続
- 権威あるPayment successからのReservation / Karaoke Ticket確定
- `PG-MYP-008〜010` に必要なReservation / Ticket情報
- Reservation cancellation
- Slot販売停止・再開・編集
- `UF-CHK-002` / `SPEC-080` が使用する通常Karaoke Check-in時間条件
- Karaoke Ticket expiration cutoff
- Auth / Database / Payment障害時のKaraoke権利保全
- Hold / Slot / Reservation / TicketのConsistency Failure

本書は以下をCanonicalには定義しない。

- Authentication / Session / Ownership / Role / Permission Matrix: `SPEC-060`
- 一般利用者向けPage / Route / UI Layout: `SPEC-050`
- Order / Stripe / Refund financial lifecycle: `SPEC-070`
- Karaoke Ticket / QR Token / Check-in atomicity: `SPEC-080`
- DB Table / Column / Constraint / Index / Transaction SQL / isolation level: `SPEC-100`
- API Endpoint / Request / Response / HTTP Status: `SPEC-110`
- Email / Notification: `SPEC-120`
- Administrator / Staff個別画面: `SPEC-130`
- Security Control全般: `SPEC-140`
- Recovery Runbook / retry回数 / backoff / operator手順: `SPEC-150`
- Audit Event schema / log field: `SPEC-160`
- Test case詳細: `SPEC-170`

---

## 3. 前提・依存仕様

本書は以下へ直接依存する。

- `SPEC-000`: Canonical Owner、`depends_on`、情報源優先順位、Upstream Change Request、正式仕様生成規則
- `SPEC-010`: System Boundary、Business Database、Karaoke二重販売防止Invariant、`Asia/Tokyo` の上位境界、`INV-010-*`
- `SPEC-020`: `FR-KRK-*`、関連 `FR-MYP-*`、`FR-ADM-*`、`FR-STF-*`、`FR-XFN-*`
- `SPEC-030`: Karaoke Slot / Hold / Reservation / Karaoke Ticket State Machine、`BR-KRK-*`、`BR-CHK-*`、`DI-030-*`
- `SPEC-040`: `UF-KRK-001〜003`、`UF-CHK-002`、Pending / Failure / Retry / Recovery Flow
- `SPEC-050`: `PG-KRK-001〜003`、`PG-MYP-008〜010`、1時間bucket、State別表示境界
- `SPEC-060`: Authentication、Ownership、`karaoke_slots.manage`、`karaoke_reservations.manage.read`、`karaoke_checkin.execute`、fail-closed rule
- `SPEC-070`: Checkout Session作成成功時点から30分のPayment Deadline、Business Confirmation、failure / cancel / expiry、Refund、Consistency Review境界
- `SPEC-080`: Karaoke Ticket / QR、single-use、purpose separation、Karaoke Check-in time predicate interface、Ticket expiration / cancellation境界

本書は上流State、Role、Capability、Page ID、Order / Refund意味、QR Token形式を再定義しない。

---

## 4. Canonical Terms

| Term | 本書での意味 |
|---|---|
| Karaoke Exclusive Scope | 同一時刻に最大1 Customerだけが排他的に占有できるKaraoke運用上の論理リソース単位 |
| Karaoke Slot | 1つのKaraoke Exclusive Scope上に生成される、Customer利用時間と整備時間を持つ販売単位 |
| `usage_start` | CustomerがKaraoke利用を開始できる時刻 |
| `usage_end` | CustomerのKaraoke利用時間が終了する時刻 |
| `cycle_end` | 整備時間を含む排他的占有が終了する時刻 |
| Usage Interval | Customerへ表示する利用区間 `[usage_start, usage_end)` |
| Occupancy Interval | 排他制約に使用する占有区間 `[usage_start, cycle_end)` |
| Slot Generation Window | Slot一括生成で候補Slotを配置する `[window_start, window_end)` の業務時間範囲 |
| Slot Availability | その時点で新規購入候補として扱えるかをServer-side current stateから導出した結果 |
| Karaoke Hold | 支払確定前に1 Customerの1購入試行へ1 Slotを排他的に確保するEntity |
| Hold Acquired At | Hold `ACTIVE` とSlot `HELD` がBusiness Databaseへ原子的に成立した時刻 |
| Hold Expires At | `hold_acquired_at + 45分`。Holdの通常支払権利のhard cutoff |
| Hold Payment Eligibility | Paymentが当該Holdを根拠にBusiness Confirmationへ進めるかを、Hold state、時刻、Payment completion時刻、Slot correlationから評価するpredicate |
| Hold Safety Buffer | Payment Deadline後もSlotを直ちに解放せず権威結果を照合するため、Checkout activation時にHold側へ残す5分の時間余裕 |
| Karaoke Reservation | 支払確定で成立した、1 Customerが1 Slotを利用する確定済み権利 |
| Slot Resale | 確定Reservation取消後に同一Slotを新しいCustomerへ再販売可能に戻すこと |
| Normal Cancellation | System Invariantを維持した正規のReservation取消Domain operation |
| Normal Check-in Window | 通常Staff CapabilityでKaraoke Check-inを成立させられる半開区間 |
| Consistency Review | 自動更新では安全に正常化できない相関不整合を、既存確定Dataを保持したままReview対象へ送る境界 |

`Karaoke Exclusive Scope` は物理的な「部屋」という名称に固定しない。1つの部屋、1台の独立機材、1つの受付運用レーン等、**同時利用を1 Customerへ制限すべき最小の独立サービス単位**を1 Scopeとして設定する。物理名称・会場実態は外部事実であり、本書は具体数を捏造しない。

---

## 5. Rule ID体系

本書のNormative Ruleは以下のPrefixを使用する。

| Prefix | Category |
|---|---|
| `KRK-SCP-*` | Exclusive Scope / occupancy |
| `KRK-TIM-*` | Slot time model / timezone |
| `KRK-GEN-*` | Slot batch generation |
| `KRK-AVL-*` | Availability / 1-hour bucket |
| `KRK-HLD-*` | Hold acquisition / expiry / release |
| `KRK-PAY-*` | Hold / Checkout / Payment Deadline integration |
| `KRK-CFM-*` | Reservation / Ticket confirmation |
| `KRK-CAN-*` | Reservation cancellation / resale |
| `KRK-EDT-*` | Slot edit / sales stop |
| `KRK-CHK-*` | Normal Karaoke Check-in time predicate |
| `KRK-IDM-*` | Idempotency / concurrency |
| `KRK-REC-*` | Failure / consistency / recovery boundary |
| `KRK-AZ-*` | Authentication / Authorization接続 |

同一Rule IDを別の意味へ再利用しない。

---

# Part I — Karaoke Slot / Exclusive Scope

## 6. Karaoke Exclusive Scope

### 6.1 Scopeの意味

Karaoke Slotは必ず**ちょうど1つ**の `Karaoke Exclusive Scope` へ所属する。

同一Scopeでは、同一時刻に複数Customerへ利用権または将来利用可能な販売枠を重ねて成立させてはならない。

**KRK-SCP-001:** Karaoke Exclusive Scopeは、同時利用を1 Customerへ制限すべき最小の論理リソース単位として定義する。

**KRK-SCP-002:** 各Karaoke Slotは1つのExclusive Scopeへ所属し、Scope未設定のSlotを販売可能状態へ置いてはならない。

**KRK-SCP-003:** 同一Scope内のSlot overlap判定にはCustomer利用時間だけでなく整備時間を含むOccupancy Interval `[usage_start, cycle_end)` を使用する。

### 6.2 Scope overlap invariant

2つのSlot `A`, `B` が同一Scopeへ属する場合、次を満たさなければならない。

```text
A.cycle_end <= B.usage_start
or
B.cycle_end <= A.usage_start
```

境界が一致することは許可する。

```text
A.cycle_end == B.usage_start  # overlapしない
```

**KRK-SCP-004:** 同一Scopeについて、既存の `AVAILABLE` / `HELD` / `SOLD` / `SALES_STOPPED` Slotはすべてoverlap検査対象とする。`SALES_STOPPED` は将来販売再開可能であり、`SOLD` は確定履歴であるため、いずれも重複Slot作成の根拠から除外しない。

**KRK-SCP-005:** Slot stateを変更することで、既存の重複した時間定義を正当化してはならない。overlapはSlot時間とScopeそのものに対するInvariantとして維持する。

Trace: `FR-KRK-005〜006`, `FR-KRK-021`, `FR-KRK-028〜030`, `BR-KRK-001〜002`, `BR-XFN-003`, `DI-030-005`, `INV-010-04`.

---

## 7. Slot time model

### 7.1 3時刻

各Slotは次を満たす。

```text
usage_start < usage_end <= cycle_end
```

- Customer利用時間: `[usage_start, usage_end)`
- 排他的占有区間: `[usage_start, cycle_end)`

**KRK-TIM-001:** `usage_end` はCustomerが利用できる終端であり、`cycle_end` は整備時間を含む排他占有の終端である。両者をUI、availability、overlap、check-inで混同してはならない。

### 7.2 標準Slot

標準Slotは以下とする。

```text
usage_end = usage_start + 15分
cycle_end = usage_end + 5分
```

したがって標準cycleは20分である。

**KRK-TIM-002:** 標準Slotは「利用15分 + 整備5分」の20分cycleとして生成する。

**KRK-TIM-003:** Customerへ予約利用時刻として表示するのは `[usage_start, usage_end)` であり、整備5分をCustomer利用時間へ含めて表示してはならない。

### 7.3 Business timezone

Business timezoneは **`Asia/Tokyo`** とする。

- Slot生成入力の業務日・時刻
- `PG-KRK-002` の対象日
- 1時間bucket
- Check-in window表示
- Administrator運用上の日時判断

は `Asia/Tokyo` を基準に解釈する。

**KRK-TIM-004:** 業務上のcalendar date / hourをUTC hour等へ読み替えて1時間bucketを生成してはならない。

保存形式、absolute instant、DB type、wire formatは `SPEC-100` / `SPEC-110` が定義する。

---

# Part II — Slot Generation / Availability

## 8. Slot batch generation

### 8.1 Generation input

標準Slot一括生成は、少なくとも次の論理入力を受ける。

1. 対象 `Karaoke Exclusive Scope` 1件以上
2. `window_start`
3. `window_end`
4. Slot template = standard (`usage=15分`, `maintenance=5分`)
5. 適用するKaraoke販売Configurationへの論理関連

`window_start` / `window_end` は `Asia/Tokyo` の業務時刻として解釈し、必ず `window_start < window_end` とする。日付をまたぐWindowを許可する。

**KRK-GEN-001:** Slot生成はAdministratorの `karaoke_slots.manage` に接続するServer-side operationであり、Clientが生成済みSlotの正当性を自己申告して成立させてはならない。

### 8.2 Standard generation algorithm

各Scopeについて、`n = 0, 1, 2, ...` とし、候補を以下で生成する。

```text
usage_start(n) = window_start + 20分 * n
usage_end(n)   = usage_start(n) + 15分
cycle_end(n)   = usage_start(n) + 20分
```

次を満たす候補だけを生成対象とする。

```text
usage_start(n) >= window_start
cycle_end(n) <= window_end
```

**KRK-GEN-002:** `window_end` を越える不完全な最終cycleは生成しない。端数時間を短縮Slotへ変換しない。

**KRK-GEN-003:** Window開始時刻を00分・20分・40分等へ勝手に丸めない。生成anchorは入力された `window_start` そのものとする。

### 8.3 Initial state

新規Slotは既存State Machineどおり `AVAILABLE` で生成する。

```text
[*] -> AVAILABLE
```

**KRK-GEN-004:** Batch生成時に新規Stateを導入せず、直接 `SALES_STOPPED` / `HELD` / `SOLD` で作成しない。

販売全体が `SUSPENDED` であっても、生成されたSlotのDomain stateは `AVAILABLE` でよい。公開上の購入可否はSale Controlを含むavailability predicateでfalseとなる。

### 8.4 Duplicate / retry semantics

Slot生成の1候補の論理同一性は、少なくとも次の組で判定可能でなければならない。

```text
(exclusive_scope, usage_start, usage_end, cycle_end)
```

**KRK-GEN-005:** 同一のgeneration requestをretryした場合、完全一致する既存Slotは既存結果として再利用し、2件目を生成しない。

**KRK-GEN-006:** 候補と完全一致しない既存Slotが同一Scope内でOccupancy Intervalを重複させる場合、そのcandidateを別Slotとして追加してはならない。

**KRK-GEN-007:** Batch内に非同一overlap conflictが1件でも存在する場合、通常の一括生成は**all-or-nothing**で失敗させる。競合しない候補だけを部分生成して、利用者が期待しない穴あきbatchを通常結果として残さない。

**KRK-GEN-008:** Exact-matchの既存SlotはStateにかかわらず上書きしない。Retryを理由に `HELD` / `SOLD` / `SALES_STOPPED` を `AVAILABLE` へ戻してはならない。

### 8.5 Generation Business Cause

**KRK-GEN-009:** Slot生成retryのBusiness Causeは、同一Administrator operationとして相関可能なbatch requestと、その中のdeterministic candidateで構成する。API idempotency keyやDB constraintの物理表現は `SPEC-100` / `SPEC-110` が定義する。

Trace: `FR-KRK-005〜006`, `FR-KRK-028`, `FR-ADM-009〜010`, `FR-XFN-014`, `FR-XFN-024`, `BR-KRK-001〜002`, `DI-030-005`, `DI-030-012`, `INV-010-04`, `INV-010-10`.

---

## 9. Slot availability

### 9.1 Public Slot state availability

Slot state単独では、次のとおり扱う。

| Slot State | 新規購入候補 |
|---|---|
| `AVAILABLE` | 他条件成立時のみYes |
| `HELD` | No |
| `SOLD` | No |
| `SALES_STOPPED` | No |

**KRK-AVL-001:** `HELD` / `SOLD` / `SALES_STOPPED` を空きとして返してはならない。

### 9.2 Server-side purchase candidate predicate

新規Karaoke購入候補となるには少なくとも以下をすべて満たす。

1. Slot State = `AVAILABLE`
2. Karaoke Sale Control = `ENABLED`
3. Server current timeがKaraoke Sales Period `[starts_at, ends_at)` 内
4. 同一Scope overlap invariantが成立している
5. `usage_end` までに30分のStripe Payment Deadlineを収められる時点である
6. Authenticated User固有判定ではPurchase Limitを満たす
7. correlation不整合またはConsistency Review対象として販売隔離されていない

本書では「支払可能期間がCustomer利用終了後へ延びる新規Checkout」を許可しない。

```text
latest_checkout_created_at = usage_end - 30分
```

購入開始時点ではStripe Session作成遅延を考慮し、少なくとも:

```text
server_now < latest_checkout_created_at
```

を要求する。さらに実際のCheckout Session作成成功後に `payment_deadline <= usage_end` を再検証する。

**KRK-AVL-002:** 公開表示が `AVAILABLE` であっても購入開始時にcurrent stateを再検証し、古いread結果を権威値にしない。

**KRK-AVL-003:** Purchase LimitはActor固有Ruleである。Guest向け空き表示だけを根拠に、その後のAuthenticated Userの購入可否を保証しない。

### 9.3 1時間bucket

`PG-KRK-002` の1時間bucketは `usage_start` が `Asia/Tokyo` で属するhourへ**1回だけ**分類する。

例:

```text
10:00 <= usage_start < 11:00  -> 10時台bucket
```

Slotの `usage_end` または `cycle_end` が次hourへ入っても別bucketへ重複表示しない。

**KRK-AVL-004:** bucketの「現在購入候補数」は、取得時点のServer-side availability predicateを満たすSlotだけを数える。

**KRK-AVL-005:** availability取得Failureを「空き0件」として返さない。

Trace: `FR-KRK-001〜009`, `PG-KRK-001〜003`, `UF-KRK-001`, `BR-KRK-003`, `BR-KRK-005`, `BR-KRK-012`, `DI-030-005`, `INV-010-04`, `INV-010-08`.

---

# Part III — Karaoke Hold

## 10. Hold acquisition

### 10.1 Purchase start transaction

Karaoke purchase startでは、`SPEC-060` のAuthentication / Business Profile resolution / `purchase.start` authorizationを成功させた後、Business Database上で少なくとも次を一つの整合したtransactionとして成立させる。

1. Slot current stateを取得
2. Slot = `AVAILABLE` を再検証
3. Sales Period / Sale Control / latest purchase cutoffを再検証
4. Purchase Limitを、確定Reservation + 同一Profileの `ACTIVE` Holdを含めて再検証
5. 同一Slotの `ACTIVE` Hold不存在を排他的に確認
6. Karaoke Holdを `ACTIVE` で作成
7. Slot `AVAILABLE -> HELD`
8. 1 Slotだけを対象にOrder / Karaoke Order Itemを `PREPARED` で作成
9. Hold / Slot / Order / Order Item / Customerの相関を永続化
10. Server-side価格SnapshotをOrder Itemへ確定

**KRK-HLD-001:** Holdだけ成立してOrderが追跡不能、またはOrderだけ成立してSlotを排他確保できていない状態をPurchase startの通常結果としてCommitしない。

**KRK-HLD-002:** Transaction failure時はSlot、Hold、Orderの当該試行による変更をCommitせず、Stripe Checkoutを作成しない。

### 10.2 Concurrent winner / loser

**KRK-HLD-003:** 同一Slotへの並行purchase startでは、Business Databaseの排他制御下で `AVAILABLE -> HELD` と `ACTIVE` Hold作成をCommitできた最大1要求をWinnerとする。

**KRK-HLD-004:** LoserはSlot競合結果となり、同一Slotの `ACTIVE` Hold、`PREPARED` Order、Reservationを新規成立させない。

**KRK-HLD-005:** Winner / LoserはClient timestamp、button click順、Staff / Customer priorityではなく、Business Database上の原子的なcurrent-state transition結果で決める。

### 10.3 Hold duration

Holdの通常有効時間は**取得成功時点から45分**とする。

```text
hold_expires_at = hold_acquired_at + 45分
```

Holdの通常有効区間は:

```text
[hold_acquired_at, hold_expires_at)
```

である。

**KRK-HLD-006:** `hold_acquired_at` はClient request開始時刻、Page表示時刻、Stripe Session作成時刻ではなく、Hold `ACTIVE` + Slot `HELD` がBusiness DatabaseへCommitしたServer-side時刻を起点とする。

**KRK-HLD-007:** Hold具体期限は45分とし、Page reloadやCheckout retryを理由に同じHoldの `hold_acquired_at` を再設定して期限を延長しない。

### 10.4 Hold payment eligibility

Holdを支払確定権利として使用できるには、少なくとも次を満たす。

- Hold State = `ACTIVE`
- Slot State = `HELD`
- Slotが当該Holdに一意に対応
- Hold Customer = Order Customer
- Hold Order / Order Item = Payment対象Order / Item
- 権威あるPayment completionがHold通常有効区間内に発生
- Checkout側のPayment Deadline条件を満たす
- Slotが別Customerへ再利用されていない

**KRK-HLD-008:** `RELEASED` / `EXPIRED` Holdを再び `ACTIVE` として使用しない。

**KRK-HLD-009:** `COMMITTED` Holdは既存確定Reservationの履歴相関であり、新しいOrderの支払確定権利として再利用しない。

---

## 11. Hold release / expiry

### 11.1 `RELEASED`

通常、以下をHold `ACTIVE -> RELEASED` の原因とする。

- Customerの支払前明示cancelが `PAY-FLR-*` に従い権威的に成立
- Order `PAYMENT_FAILED` が `PAY-FLR-007〜008` に従い成立
- Provider側支払可能性を安全に終了できたその他の明示release原因

**KRK-HLD-010:** `RELEASED` 成立と同じBusiness Database transactionで、対応Slotがまだ当該Holdの `HELD` であることを確認し、Slot `HELD -> AVAILABLE` を成立させる。

### 11.2 `EXPIRED`

以下をHold `ACTIVE -> EXPIRED` の時間由来原因とする。

- Hold hard cutoff到達後、成功Paymentがないことを安全に確定できた
- Stripe Checkout / Payment Deadline expiryが `PAY-FLR-003〜004` に従い成立し、時間切れとして資源解放する

**KRK-HLD-011:** `EXPIRED` 成立時も、対応Slotが当該Holdの `HELD` であることを確認し、他の安全上の禁止条件がなければSlot `HELD -> AVAILABLE` を同一transactionで成立させる。

### 11.3 Release / expiry idempotency

**KRK-HLD-012:** Hold release / expiryのBusiness CauseはHoldそのものへ結び付け、retry時はcurrent Hold stateを再評価する。

| Current Hold State | release retry | expiry retry |
|---|---|---|
| `ACTIVE` | 正規条件を満たせば `RELEASED` | 正規条件を満たせば `EXPIRED` |
| `RELEASED` | 既存結果を返す | state変更しない |
| `EXPIRED` | state変更しない | 既存結果を返す |
| `COMMITTED` | releaseしない | expireしない |

**KRK-HLD-013:** `COMMITTED` Holdへ遅れてPayment failure / expiry相当通知が到着してもSlot / Reservationを巻き戻さない。Payment authority不整合なら `PAY-REC-*` / Consistency Reviewへ送る。

### 11.4 Sales stopとの関係

Slot `HELD` から `SALES_STOPPED` への通常遷移は存在しない。

**KRK-HLD-014:** Slotが `HELD` の間、per-slot販売停止要求だけを理由にHoldをreleaseしない。

Karaoke販売全体のSale Controlを `SUSPENDED` にすることは既存Holdを取消さない。Holdが後にrelease / expireした場合、Slot stateは既存State Machineどおり `AVAILABLE` へ戻るが、Sale Controlが `SUSPENDED` のためpublic availabilityはfalseとなる。

Trace: `FR-KRK-009〜016`, `FR-XFN-014`, `FR-XFN-026〜028`, `BR-KRK-003〜007`, `BR-ORD-009`, `DI-030-001`, `DI-030-005`, `DI-030-012`, `UF-KRK-002`, `INV-010-01`, `INV-010-04`, `INV-010-10`.

---

# Part IV — Hold / Checkout / Payment Deadline

## 12. Checkout activation time rules

### 12.1 Upstream Payment Deadline

`SPEC-070` のStripe Checkout Payment Deadlineは、**Checkout Session作成成功時点から30分**である。本書はこれを変更しない。

```text
payment_deadline = checkout_session_created_at + 30分
```

### 12.2 Hold Safety Buffer

本書はHoldとPayment Deadlineの間に**5分の安全余裕**を要求する。

CheckoutをCustomerが利用可能なActive Checkoutとして確立するには:

```text
payment_deadline <= hold_expires_at - 5分
```

を満たさなければならない。

45分Holdであるため、通常、同一Holdに対するCheckout Session作成成功はHold取得から10分以内でなければこの条件を満たさない。

**KRK-PAY-001:** Hold残存時間がPayment Deadlineまで届かないOrderを `AWAITING_PAYMENT` へ進めない。

**KRK-PAY-002:** 本書ではさらに5分Safety Bufferを要求し、Payment Deadline直後にHoldを再販売可能へ解放する設計を避ける。

Safety BufferはStripeの30分Payment Deadlineを延長しない。Customerの支払可能時間は `SPEC-070` の30分のままである。

### 12.3 Usage-end cutoff

CheckoutをActive化するには、実際のPayment DeadlineがCustomer利用終了より後になってはならない。

```text
payment_deadline <= usage_end
```

**KRK-PAY-003:** 支払可能期間が `usage_end` を越える新規Karaoke CheckoutをCustomerへ提示しない。

これにより標準15分Slotでは、Checkout Sessionは遅くとも `usage_start - 15分` までに作成成功する必要がある。

### 12.4 Checkout開始前 / 後の二段階検証

Stripe call前:

1. Order = `PREPARED`
2. Hold = `ACTIVE`
3. Slot = 当該Holdの `HELD`
4. current time < `hold_expires_at`
5. Hold残存時間が30分 + 5分Safety Bufferを満たす見込み
6. `usage_end` まで30分Payment Deadlineを収める見込み

を再評価する。

Stripe Session作成成功後:

1. Stripeの実際のSession作成時刻
2. 実際のPayment Deadline
3. `hold_expires_at`
4. `usage_end`

を使ってexact conditionを再評価する。

**KRK-PAY-004:** exact condition成立とPayment Binding永続化が成功した場合だけOrder `PREPARED -> AWAITING_PAYMENT` を許可する。

### 12.5 Stripe Sessionは作成されたが時間条件を満たさない場合

Stripe Session作成成功後にexact conditionを満たさない場合:

1. SessionをCustomerへActive Checkoutとして返さない。
2. Provider側で当該Sessionの支払可能性を終了させる。
3. 終了を権威的に確認できた場合、同一Holdで新Sessionを作る時間条件がまだ成立するならOrder `PREPARED` のまま新しいCheckout Attemptを許可できる。
4. 時間条件がもう成立しないならOrderを `EXPIRED`、Holdを `EXPIRED`、Slotを `AVAILABLE` へ正規に収束させる。
5. Provider側終了結果が不明ならHold / Slotを解放せず、Orderを `REVIEW_REQUIRED` へ送りConsistency Review対象とする。

**KRK-PAY-005:** Customerへ一度も提示していないStripe Sessionであっても、Provider上で支払可能性が残るか不明なままSlotを再販売してはならない。

---

## 13. Checkout generation failure / retry

### 13.1 `PREPARED` Order + `ACTIVE` Hold

Stripe Checkout作成だけが失敗した場合:

- Orderを削除しない。
- Orderは `PREPARED` に留める。
- Holdは時間・state条件を満たす限り `ACTIVE` のまま保持する。
- Slotは `HELD` のまま保持する。
- Reservation / Karaoke Ticketを作らない。

**KRK-PAY-006:** Network timeout / response loss等でStripe Session作成結果が不明な場合、`PAY-CHK-008〜010` に従い同一Checkout Attempt / idempotency causeで結果を回復し、別Sessionを無条件に作らない。

**KRK-PAY-007:** 同一 `PREPARED` OrderのCheckout retryで新しいHoldを作らない。

**KRK-PAY-008:** Retry時に `payment_deadline <= hold_expires_at - 5分` または `payment_deadline <= usage_end` を満たせなくなった場合、そのOrderを `AWAITING_PAYMENT` へ進めない。

### 13.2 Hold terminal後

**KRK-PAY-009:** Hold `EXPIRED` / `RELEASED` 後に同じHoldや同じ `PREPARED` Orderを再決済へ戻さない。再購入はcurrent availabilityを再評価し、新しいHold + 新しいOrderを作るNew Business Attemptとする。

### 13.3 Browser Return

**KRK-PAY-010:** Browser ReturnはSlot `SOLD`、Hold `COMMITTED`、Reservation `CONFIRMED`、Ticket `VALID` のTriggerではない。`PG-XFN-001` はBusiness Database上の同じOrderを参照する。

Trace: `PAY-CHK-001〜013`, `PAY-BRW-001〜003`, `UF-KRK-002`, `PG-KRK-003`, `PG-XFN-001`, `FR-KRK-013〜017`, `FR-KRK-027`, `FR-XFN-027〜029`, `INV-010-01`, `INV-010-04`, `INV-010-07`, `INV-010-10`.

---

# Part V — Payment Confirmation / Reservation

## 14. Karaoke Business Confirmation

### 14.1 Confirmation precondition

`SPEC-070 PAY-CFM-*` を変更せず、Karaoke Business Confirmationでは少なくとも次を確認する。

1. Order Purpose = `KARAOKE_PURCHASE`
2. Order CustomerがServer-sideで確定済み
3. Order Itemは1つのKaraoke Slotだけを対象
4. Holdが当該Order / Order Itemへ一意に対応
5. Hold Customer = Order Customer
6. Hold Slot = Order Item Slot
7. HoldがPayment completion時点で支払確定条件を満たしていた
8. Slot = 当該Holdの `HELD`
9. Slotが別Customerへ再利用されていない
10. authoritative Stripe Payment resultがOrder / amount / currency / deadlineへ正規にcorrelate
11. 同一Karaoke Order Itemに既存Reservationが0件または同一Business Causeの正規1件
12. 同一Reservationに既存Karaoke Ticketが0件または同一Business Causeの正規1件

### 14.2 Atomic effects

正常Confirmationでは、Business Database上で可能な範囲を同一transactionとして次を一貫して成立させる。

```text
Hold:        ACTIVE -> COMMITTED
Slot:        HELD -> SOLD
Reservation: [*] -> CONFIRMED
Ticket:      [*] -> VALID
Order:       AWAITING_PAYMENT -> CONFIRMED
```

`SPEC-070` が許可するRecovery経路では `REVIEW_REQUIRED -> CONFIRMED` も上流Ruleに従って使用できる。

**KRK-CFM-001:** Slot `HELD -> SOLD`、Hold `ACTIVE -> COMMITTED`、Reservation `CONFIRMED`、Karaoke Ticket `VALID`、Order `CONFIRMED` を中途半端な通常結果として残さない。

**KRK-CFM-002:** Reservation CustomerはOrder Customer、Reservation SlotはHold Slot、Karaoke Ticket OwnerはReservation Customerと一致させる。

**KRK-CFM-003:** 同一Karaoke Order ItemからReservationは最大1件、同一ReservationからKaraoke Ticketは最大1件とする。

**KRK-CFM-004:** retryで既に同じBusiness CauseのReservation / Ticketが正規に存在する場合、それを再利用し2件目を生成しない。

### 14.3 Reservation利用済み状態

Reservation Stateは上流どおり:

```text
CONFIRMED
CANCELED
```

だけを使用する。

**KRK-CFM-005:** Reservationへ `USED` stateを追加しない。利用済みはKaraoke Ticket `USED` およびKaraoke Check-inから導出する。

### 14.4 Delayed payment success

Payment Webhook処理時刻が遅れていても、権威あるPayment completionが:

- Stripe Payment Deadline内
- Hold通常有効区間内

に成立していたことを検証でき、Hold / Slotがまだ当該取引に排他的に保持されている場合、Webhookの遅延だけを理由に失敗へ変換しない。

ただし:

**KRK-CFM-006:** Holdが既に `EXPIRED` / `RELEASED`、Slotが `AVAILABLE` / `HELD` by another Hold / `SOLD` by another Reservation、または排他関係を安全に証明できない場合、Payment successだけを根拠にSlotを奪い返さない。

**KRK-CFM-007:** 上記不整合では、Orderが許可する場合 `REVIEW_REQUIRED`、Terminal OrderならConsistency Review Caseとし、通常成功を表示しない。

**KRK-CFM-008:** Recoveryで「今はSlotが空いて見える」ことだけを理由に、expired Holdを復活させてReservationを自動生成しない。

Trace: `FR-KRK-017〜027`, `BR-KRK-008〜009`, `BR-KRK-013〜021`, `DI-030-002〜003`, `DI-030-005`, `DI-030-009`, `DI-030-012`, `PAY-CFM-001〜005`, `PAY-CFM-008〜009`, `TQR-TKT-005〜008`, `TQR-CAN-007〜009`, `INV-010-02〜04`, `INV-010-07〜08`, `INV-010-10`.

---

# Part VI — Reservation Cancellation / Resale

## 15. Reservation cancellation policy

### 15.1 Customer self-cancellation

現行上流RequirementはCustomer自己操作によるReservation取消を要求していない。

**KRK-CAN-001:** Customer向け自己取消Capabilityを本仕様で追加しない。

Reservation cancellationは、`SPEC-060` / `SPEC-070` / `SPEC-130` / `SPEC-150` により明示的に認可されたServer-side運用またはRecovery workflowから呼び出されるDomain operationとして扱う。`karaoke_reservations.manage.read` や `karaoke_slots.manage` の参照・Slot管理権限だけではCancellation mutationを許可しない。

### 15.2 Normal cancellation precondition

Normal Cancellationは少なくとも以下をすべて満たす場合だけ成立する。

1. Reservation = `CONFIRMED`
2. Reservation / Slot / Order / Hold / Ticketのcorrelationが一意で整合
3. Order = `CONFIRMED`
4. Slot = `SOLD`
5. 対応Hold = `COMMITTED`
6. Karaoke Ticketが一意に存在
7. Karaoke Ticket = `VALID`
8. Karaoke Check-inが存在しない
9. 既存Consistency Review対象として自動mutation禁止でない
10. Authorizationが上流仕様どおり成立

**KRK-CAN-002:** Karaoke Ticketが `USED` の場合、通常Reservation cancellationを成立させない。

**KRK-CAN-003:** Karaoke Ticketが `EXPIRED` の場合も、既存Ticket State Machineに `EXPIRED -> CANCELED` が存在しないためNormal Cancellationへ進めない。必要な業務対応はConsistency Review / Recoveryへ送る。

**KRK-CAN-004:** Reservation `CONFIRMED` なのにTicketが既に `CANCELED`、Ticket欠落、複数Ticket等のcorrelation不整合がある場合、通常Cancellationで帳尻を合わせずConsistency Reviewへ送る。

### 15.3 Atomic cancellation effect

Normal Cancellationでは同一Business Database transactionで少なくとも次を成立させる。

```text
Reservation: CONFIRMED -> CANCELED
Karaoke Ticket: VALID -> CANCELED
```

維持するもの:

```text
Slot: SOLD のまま
Hold: COMMITTED のまま
Order: CONFIRMED のまま
Check-in: 存在しないまま
```

**KRK-CAN-005:** Reservation取消とKaraoke Ticket `VALID -> CANCELED` を中途半端にCommitしない。

**KRK-CAN-006:** 取消済みReservation、Ticket、Order、Hold、Slot correlation履歴を削除しない。

### 15.4 Cancellation idempotency

- Reservation `CANCELED` + Ticket `CANCELED`: 既存取消結果を返す。
- Reservation `CONFIRMED` + Ticket `VALID`: 正規Cancellationを試行可能。
- Reservation `CONFIRMED` + Ticket `USED` / `EXPIRED` / `CANCELED`: 正常な新規Cancellation成功にしない。
- Reservation `CANCELED` + Ticket `VALID` / `USED` / `EXPIRED`: 不整合としてReview。

**KRK-CAN-007:** retryを理由に2回目のCancellation effectを生成しない。

### 15.5 Cancellation vs Check-in concurrency

**KRK-CAN-008:** CancellationとKaraoke Check-inが競合した場合、Ticket `VALID` を共通preconditionとしてDatabase transactionのcommit結果でwinnerを決める。

- Check-inが先にCommit: Ticket `USED`; Cancellationはprecondition failureとなり成立しない。
- Cancellationが先にCommit: Ticket `CANCELED`; Check-inは受付不能となる。

先に成立したterminal effectを削除・巻き戻して後続要求をwinnerにしない。

---

## 16. Slot resale policy

本システムでは、**確定Reservationの取消後に同一Slotを再販売しない**。

採用理由:

- `SPEC-030` の通常Karaoke Slot State Machineでは `SOLD -> AVAILABLE` が存在しない。
- 二重販売防止と履歴保持を最優先できる。
- Refund / cancellation / resaleの複合競合を通常運用へ持ち込まない。
- canceled Reservationの元Slotと新Customer権利を同一Slot Entityへ重ねる追加State /履歴モデルを不要にする。

**KRK-CAN-009:** Reservation `CONFIRMED -> CANCELED` 後も対応Slotは `SOLD` のまま維持する。

**KRK-CAN-010:** Reservation cancellation後もHoldは `COMMITTED` のまま履歴相関を維持する。

**KRK-CAN-011:** Ticket cancellationだけでSlotを `AVAILABLE` へ戻さない。

**KRK-CAN-012:** Karaoke Ticket expirationだけでSlotを `AVAILABLE` へ戻さない。

**KRK-CAN-013:** Reservation cancellation後のSlotを1時間bucketの購入候補数へ戻さない。

**KRK-CAN-014:** Cancelled ReservationによるPurchase Limit消費を自動回復しない。上流Domainに別の明示的回復Operationが追加されない限り、確定購入履歴として計数を維持する。

将来Slot resaleを導入する場合、現行 `SOLD` terminal semanticsを変更する必要があるため、`SPEC-030` へのUpstream Change Requestを先に行い、Reservation履歴保持、排他Invariant、Ticket状態、Purchase Limit、Refund、Auditまで一体で再定義しなければならない。本バージョンではresaleを実装してはならない。

---

## 17. Refundとの分離

Financial Refundは `SPEC-070` がCanonical Ownerである。

**KRK-CAN-015:** Refund `SUCCEEDED` だけを根拠にReservation、Karaoke Ticket、Slotを直接変更しない。

Refund成功後に正規Domain cancellationが要求された場合、本章のpreconditionを再評価する。

**KRK-CAN-016:** Refund成功 + Ticket `VALID` + cancellation precondition成立時だけ、正規Cancellationを実行できる。

**KRK-CAN-017:** Refund成功後にTicket `USED` / `EXPIRED` / correlation failure等でCancellationが安全に成立しない場合、Refund成功を巻き戻さず、Reservation / Ticket / Slot履歴を破壊せず `PAY-RFD-007` のConsistency Reviewへ送る。

Trace: `BR-KRK-017〜018`, `TQR-CAN-010〜019`, `PAY-RFD-001〜007`, `UF-KRK-003`, `PG-MYP-008〜010`, `FR-KRK-024〜026`, `FR-ADM-020〜021`, `INV-010-04〜05`, `INV-010-07〜08`, `INV-010-10`.

---

# Part VII — Slot Editing / Sales Stop

## 18. Attribute classification

Slot属性を、権利影響の観点で次の2Categoryへ分類する。

### 18.1 Rights-affecting attributes

少なくとも以下は権利影響属性である。

- `exclusive_scope`
- `usage_start`
- `usage_end`
- `cycle_end`
- 新規購入条件へ影響するSlot固有販売Configuration関連

### 18.2 Non-rights-affecting metadata

Reservation日時、排他Scope、Customer、Order amount、Check-in可否等の権利意味を変えない表示補助・運用メタデータはnon-rights-affectingとして扱える。

具体Fieldは `SPEC-100` / `SPEC-130` が定義する。本書は不要なFieldを新規要求しない。

---

## 19. State別編集境界

| Slot State | Rights-affecting edit | Non-rights-affecting edit | Sales stop / resume |
|---|---|---|---|
| `AVAILABLE` | 条件付き可 | 可 | `AVAILABLE -> SALES_STOPPED` 可 |
| `SALES_STOPPED` | 条件付き可 | 可 | `SALES_STOPPED -> AVAILABLE` 可 |
| `HELD` | 不可 | 権利意味を変えない範囲のみ可 | per-slot state変更不可 |
| `SOLD` | 不可 | 権利意味を変えない範囲のみ可 | 不可 |

### 19.1 `AVAILABLE`

**KRK-EDT-001:** `AVAILABLE` Slotの時間 / Scope変更は、変更後に `usage_start < usage_end <= cycle_end` と同一Scope overlap invariantを満たす場合だけ許可する。

**KRK-EDT-002:** 編集transaction中に別RequestがHoldを取得した場合、staleな「AVAILABLE」前提で権利影響属性を上書きしない。current state conflictとして編集を失敗させる。

### 19.2 `SALES_STOPPED`

**KRK-EDT-003:** `SALES_STOPPED` Slotは新規Holdを持たない未販売Slotとして、`AVAILABLE` と同じ権利影響属性を条件付き編集可能とする。編集後もStateは `SALES_STOPPED` のまま維持する。

### 19.3 `HELD`

**KRK-EDT-004:** `HELD` SlotのScope、利用時刻、cycle、価格・購入条件等を通常編集しない。

**KRK-EDT-005:** `HELD` Slotへper-slot `SALES_STOPPED` を直接適用しない。既存Holdを奪わず、必要なら全体Sale Controlの `SUSPENDED` またはHold解消後の明示操作を使用する。

### 19.4 `SOLD`

**KRK-EDT-006:** `SOLD` SlotのScope、`usage_start`、`usage_end`、`cycle_end`、Reservation Customer、Reservation Slot relationを通常編集しない。

**KRK-EDT-007:** `SOLD` Slotを通常編集で `AVAILABLE` / `SALES_STOPPED` にしない。

### 19.5 Sales stop semantics

**KRK-EDT-008:** `SALES_STOPPED` は新規Holdを禁止するが、既存Hold / Reservation / Ticketを自動取消ししない。

**KRK-EDT-009:** `AVAILABLE -> SALES_STOPPED` とHold acquisitionが競合した場合、Database current-state transitionのwinnerだけをCommitする。Sales stopが先ならHoldは作れず、Holdが先ならSlotは `HELD` のためper-slot stopは失敗する。

Trace: `FR-KRK-028〜031`, `FR-ADM-009〜015`, `BR-KRK-011〜012`, `DI-030-005`, `AR-ROLE-*`, `INV-010-04`, `INV-010-07〜08`, `INV-010-10`.

---

# Part VIII — Karaoke Check-in Time Window

## 20. Authoritative normal check-in window

通常Karaoke Check-in windowはReservation / Slotの `usage_start` / `usage_end` から次のとおり算出する。

```text
checkin_opens_at  = usage_start - 10分
checkin_closes_at = usage_end
```

通常受付可能区間は半開区間:

```text
[checkin_opens_at, checkin_closes_at)
```

とする。

標準Slotでは:

```text
usage_start - 10分 から usage_end直前まで受付可
usage_end と同時刻以降は受付不可
cycle_endまでの整備5分は受付可能時間に含めない
```

**KRK-CHK-001:** `server_now == checkin_opens_at` は通常受付可とする。

**KRK-CHK-002:** `server_now == checkin_closes_at` は通常受付不可とする。

**KRK-CHK-003:** 受付開始前は `OUTSIDE_CHECKIN_WINDOW` とし、Ticket / Reservation stateを変更しない。

**KRK-CHK-004:** 受付終了後は通常Karaoke Check-inを成立させない。

### 20.1 Full predicate

`SPEC-080` が利用するauthoritative normal predicateは少なくとも次をすべて満たす場合にtrueとする。

```text
reservation.state == CONFIRMED
and ticket.state == VALID
and checkin_opens_at <= server_now
and server_now < checkin_closes_at
and reservation/slot/ticket correlation is consistent
```

Staff Authorization、QR purpose、Token state、single-use、既存Check-in不存在は `SPEC-080` が追加評価する。

**KRK-CHK-005:** Reservation = `CANCELED` の場合、時刻条件だけが成立していてもnormal predicateはfalseとする。

**KRK-CHK-006:** `USED` / `CANCELED` / `EXPIRED` Ticketを時間条件だけで受付可能へ戻さない。

### 20.2 Ticket expiration cutoff

Karaoke Ticketのauthoritative expiration cutoffは:

```text
expires_at = checkin_closes_at = usage_end
```

とする。

**KRK-CHK-007:** `server_now >= usage_end` かつTicketが未使用 `VALID` の場合、そのTicketは通常受付には無効であり、`SPEC-080 TQR-CAN-003` の正規expiration処理により `VALID -> EXPIRED` とする。

**KRK-CHK-008:** Expiration反映Jobが未実行でDB上 `VALID` のままでも、`server_now >= usage_end` ならnormal check-in predicateをfalseとする。

**KRK-CHK-009:** Ticket expirationでReservationを `CANCELED` にせず、Slotを再販売可能へ戻さない。

### 20.3 Staff capability

通常Karaoke Check-inは `SPEC-060` の verified Identity + active `STAFF` + `karaoke_checkin.execute` を要求する。

**KRK-CHK-010:** `karaoke_checkin.execute` に時間外overrideを暗黙に含めない。

**KRK-CHK-011:** Administrator Roleだけでも通常Check-in時間条件を迂回できない。AdministratorがCheck-inを行うには上流どおり `STAFF` Roleも必要であり、それでもnormal time predicateは適用する。

**KRK-CHK-012:** 時間外例外を将来導入する場合、通常Check-inとは別の明示的Recovery / exception operationとして `SPEC-060` / `SPEC-130` / `SPEC-150` が対象・認可・Invariant保持条件を定義しなければならない。本書は通常Staffへ例外権限を追加しない。

### 20.4 Single-use / purpose separation

本書は以下を再定義しない。

- Customer QR / Ticket single-use
- Entry / Karaoke purpose separation
- QR Token形式
- Check-in atomicity
- concurrent Scan winner / loser
- already-used retry

これらは `SPEC-080` をそのまま適用する。

Trace: `FR-STF-008〜015`, `FR-KRK-024〜026`, `UF-CHK-002`, `PG-MYP-009〜010`, `BR-KRK-022〜024`, `BR-CHK-001〜008`, `AR-AZ-014`, `AR-ROLE-012`, `TQR-CHK-011〜016`, `TQR-CAN-003〜005`, `DI-030-007`, `DI-030-010`, `DI-030-012`, `INV-010-05`, `INV-010-08`, `INV-010-10`.

---

# Part IX — Idempotency / Concurrency

## 21. Business Cause一覧

| Operation | Logical Business Cause | Duplicate effect禁止 |
|---|---|---|
| Slot generation | batch request + deterministic candidate | 同一candidate Slotの重複生成 |
| Hold acquisition | 1 purchase-start attempt for 1 Customer + 1 Slot | 同一Slotの複数 `ACTIVE` Hold |
| Hold release / expiry | Hold | terminal transitionの二重作用 |
| Checkout generation | `SPEC-070` の `(Order, Checkout Attempt)` | 複数Active Checkout |
| Payment confirmation | `SPEC-070` の `(Order, authoritative Stripe payment result)` | Reservation / Ticket / Slot Soldの重複 |
| Reservation cancellation | Reservation + authorized cancellation cause | 複数cancel effect |
| Karaoke Check-in | `SPEC-080` のTicket単位Business Cause | 複数Check-in |

**KRK-IDM-001:** Client request IDだけをDomain idempotencyの唯一の根拠にしない。Business DatabaseのSlot / Hold / Order / Reservation / Ticket current stateと一意関係を必ず評価する。

**KRK-IDM-002:** 同一Slotに対するHold acquisition、sales stop、Slot editが競合する場合、すべてstale stateを上書きせずcurrent state transitionへ収束させる。

**KRK-IDM-003:** Payment confirmationとHold release / expiryが競合する場合、Payment authorityとcurrent Hold / Slot stateを同一の競合制御下で評価し、Slot `SOLD` と `AVAILABLE` を双方Commitしない。

**KRK-IDM-004:** Reservation cancellationとCheck-inの競合は `KRK-CAN-008` / `TQR-IDM-009〜011` に従う。

**KRK-IDM-005:** retryでHold / Reservation / TicketのOwner、Slot、時間を別Entityへ差し替えて成功させない。

---

# Part X — Failure / Recovery

## 22. Failure classification

| Failure | 正常なKaraoke結果 | Data preservation / recovery boundary |
|---|---|---|
| Slot競合 | LoserはHold / Orderを成立させない | current availability再取得 |
| Hold生成transaction failure | Hold / Slot / Orderを部分Commitしない | 同じ購入操作をcurrent stateからretry |
| Hold expiry | 支払成功なしを安全に確認後 `EXPIRED`; Slot `AVAILABLE` | 同Hold再利用禁止 |
| Hold release | `RELEASED`; Slot `AVAILABLE` | idempotentに既存結果再利用 |
| Checkout開始failure | `PREPARED` + `ACTIVE` Holdを条件付き維持 | `PAY-CHK-*` で同Attempt回復 |
| Payment未完了 | `AWAITING_PAYMENT`; Reservation / Ticketなし | 同Order status確認 |
| Payment failure | `PAYMENT_FAILED`; Hold `RELEASED`; Slot `AVAILABLE` | 再購入は新Hold / 新Order |
| Browser Return済み / Webhook未反映 | 成功確定しない | 同Order `AWAITING_PAYMENT` 等を表示 |
| Payment success / Hold expiry競合 | expired Holdから通常確定しない | authority再照合、必要ならReview |
| Hold / Slot correlation不整合 | 通常確定・解放しない | Consistency Review |
| Slot / Reservation二重関係 | 2件目を正規化しない | Consistency Review |
| Reservation / Ticket relation不整合 | Ticketを推測生成・取消しない | Consistency Review |
| cancellation / Check-in競合 | DB commit winnerのみ成立 | terminal結果を維持 |
| Auth Service障害 | protected mutationをFail Closed | 既存Data保持 |
| Business Database障害 | 新規確定を行わない | retry / Review、既存Data保持 |

---

## 23. Hold expiry finalization and Payment uncertainty

Hold hard cutoffへ到達しただけで、Stripe側の支払可能性が未確認の `AWAITING_PAYMENT` Orderを即座に再販売可能へしてはならない。

Checkout activation時に5分Safety Bufferを確保しているため、通常はPayment DeadlineがHold hard cutoffより先に到来する。

Hold expiry finalizationでは:

1. Order / Payment Binding / Sessionを解決する。
2. Stripe authorityからPayment Deadline内の成功Payment有無を確認する。
3. 成功Paymentがある場合、Payment completionがHold有効区間内であり、Hold / Slotがまだ当該取引に保持されているならBusiness Confirmationを試行する。
4. 成功Paymentがなく、Provider上で今後当該Sessionから成功し得ないことを確認できた場合、Order / Hold / Slotを正規expiryへ進める。
5. Stripe API障害、結果不明、correlation不整合等で安全に判定できない場合、Slotを再販売しない。

**KRK-REC-001:** Payment不確実性がある間、Holdの通常支払権利としての期限は延長しないが、二重販売防止のためSlot lockを破棄してはならない。必要に応じOrderを `REVIEW_REQUIRED` とし、Hold / Slotの既存相関をRecoveryまで保持する。

これは新しいHold Stateを追加するものではない。通常購入・新Checkout・新Paymentを許可する意味でのHold validityは期限切れであり、既存Payment authorityを安全に判定するための保全措置である。

**KRK-REC-002:** 上記保全中に新しいCustomerへ同Slotを販売しない。

---

## 24. Payment success after Hold terminal

**KRK-REC-003:** Holdが既に `EXPIRED` / `RELEASED` へCommitした後にPayment successが検出された場合、Holdを `ACTIVE` に戻さない。

**KRK-REC-004:** Slotが `AVAILABLE` でまだ他Customerに取られていなくても、expired / released Holdを自動復活させてReservationを作成しない。

**KRK-REC-005:** Slotが別Customerの `HELD` / `SOLD` なら、いかなる場合も後発Payment successでSlotを奪い返さない。

結果は `PAY-CFM-009`, `PAY-REC-001〜004` に従い `REVIEW_REQUIRED` / Consistency Reviewとする。必要なrefund / operator procedureは `SPEC-150` が定義する。

---

## 25. Correlation consistency rules

通常状態では少なくとも以下を満たす。

### 25.1 `AVAILABLE`

- 当該Slotに `ACTIVE` Holdが存在しない。
- 当該Slotを占有する有効な `CONFIRMED` Reservationが存在しない。

### 25.2 `SALES_STOPPED`

- 当該Slotに `ACTIVE` Holdが存在しない。
- 当該Slotを占有する有効なReservationが存在しない。
- 新規Holdを許可しない。

### 25.3 `HELD`

- 同一Slotに `ACTIVE` Holdがちょうど1件。
- Hold Customer / Slot / Order correlationが一意。
- Reservationは未確定。

### 25.4 `SOLD`

- 対応 `COMMITTED` Holdが一意に追跡可能。
- 対応Reservationが最大1件。
- Reservationは `CONFIRMED` または、Normal Cancellation後は `CANCELED`。
- 対応Orderは `CONFIRMED`。
- 対応Karaoke Ticketは最大1件。

**KRK-REC-006:** Slot `HELD` なのに `ACTIVE` Holdが0件 / 複数件、Slot `SOLD` なのにReservationが欠落 / 複数、ReservationとHold Slotが不一致、ReservationとTicket Ownerが不一致等を検出した場合、通常成功として補正しない。

**KRK-REC-007:** Correlation failureを解消するため、既存Reservation、Ticket、Check-in、Payment、Hold、Slot履歴を削除して再生成しない。

**KRK-REC-008:** 安全に自動解決できない場合、Consistency Review Caseとして追跡する。Case schemaは `SPEC-100`、Runbookは `SPEC-150`、Audit Event schemaは `SPEC-160` が定義する。

---

## 26. Auth Service outage

**KRK-REC-009:** Auth Identityを安全に検証できない場合、新しいKaraoke purchase start、Administrator Slot mutation、Reservation cancellation、Staff Check-inを成立させない。

**KRK-REC-010:** Auth Service障害を理由に、既存Hold / Slot / Order / Reservation / Ticketを削除・取消・Owner変更しない。

Payment Webhookは一般利用者Sessionではなく `SPEC-070` のStripe signatureを外部送信元検証に使用するため、Auth Service障害だけでWebhook受信自体を拒否する必要はない。ただしDomain Confirmationで必要な内部Customer correlationはBusiness Database上の既存関係から安全に解決できなければならない。

---

## 27. Business Database outage

**KRK-REC-011:** Business Database current stateを安全に取得・更新できない場合、新しいHold、Slot mutation、Reservation confirmation、Reservation cancellation、Ticket expiration、Karaoke Check-inを成功確定しない。

**KRK-REC-012:** Database障害時にClient cache、公開availability、Stripe Browser Return、QR画像だけを根拠にKaraoke権利を確定しない。

**KRK-REC-013:** Database transaction結果がresponse loss等で不明な場合、retryで新しいBusiness Causeを作る前に既存Hold / Order / Reservation / Ticketを再照合する。

---

## 28. Recovery delegation

本書はRecovery時の**安全な境界**を定義するが、以下は `SPEC-150` へ委譲する。

- retry回数
- backoff
- reconciliation interval
- Operator確認手順
- Stripe API再照合手順
- Consistency Review CaseのSLA
- 返金・補償の運用Runbook
- emergency exception procedure

**KRK-REC-014:** Recovery Runbookは、本書のSlot exclusivity、expired Hold再利用禁止、Ticket single-use、Ownership、Payment authorityを弱化してはならない。

---

# Part XI — Authorization Boundary

## 29. Operation authorization mapping

本書はCapabilityを追加せず `SPEC-060` を参照する。

| Operation | Required authorization boundary |
|---|---|
| Public Karaoke sales / availability read | `public.read` |
| Karaoke purchase start | verified Authenticated User + `purchase.start` + Business Profile |
| Self Reservation / Ticket read | Ownership Path + `karaoke.self.read` |
| Slot generation / permitted edit / sales stop / resume | active `ADMINISTRATOR` + `karaoke_slots.manage` |
| Reservation operational read | active `ADMINISTRATOR` + `karaoke_reservations.manage.read` |
| Normal Karaoke Check-in | active `STAFF` + `karaoke_checkin.execute` |
| Cancellation / exception mutation | `SPEC-060` / `SPEC-070` / `SPEC-130` / `SPEC-150` で対象Operationに明示されたauthorization。read / slot-manage権限だけでは不可 |

**KRK-AZ-001:** UI表示、Client role claim、Client user ID、Slot referenceをAuthorization根拠にしない。

**KRK-AZ-002:** `ADMINISTRATOR` Roleは `STAFF` を継承せず、`karaoke_slots.manage` はKaraoke Check-in権限を含まない。

**KRK-AZ-003:** `karaoke_checkin.execute` は時間外override、Reservation cancellation、Slot editを含まない。

**KRK-AZ-004:** Administrator authorization成功もOverlap Invariant、Hold State Machine、Payment Confirmation、Ticket single-useを迂回する根拠にしない。

Trace: `AR-OWN-*`, `AR-ROLE-*`, `AR-AZ-012`, `AR-AZ-014`, `AR-FAIL-*`, `FR-ADM-001`, `FR-ADM-019〜020`, `FR-STF-001`, `FR-STF-008〜016`, `INV-010-08`.

---

# Part XII — System of Record / Downstream Boundaries

## 30. System of Record

Karaoke Slot、Hold、Reservation、Karaoke Ticket、Order correlation、Check-inの業務現在状態はBusiness DatabaseをSystem of Recordとする。

StripeはPayment Authorityであるが、Stripe上のPayment successだけをKaraoke Reservationとして直接表示しない。

**KRK-REC-015:** Customer / Staff / Administratorが参照するKaraoke現在状態はBusiness Database上のcurrent stateと本書のauthoritative time predicateから導出する。

---

## 31. `SPEC-100 Database Design` への委譲

`SPEC-100` は本書から少なくとも以下を物理設計へ具体化する。

- Exclusive ScopeのTable / key
- Slotのtime columns / timezone保存形式
- `[usage_start, cycle_end)` overlap防止Constraint / exclusion strategy
- Slot State constraint
- Hold State / `hold_acquired_at` / `hold_expires_at`
- 同一Slot `ACTIVE` Hold最大1件のConstraint / index
- Hold / Order / Order Item / Customer / Slot correlation FK / unique constraint
- ReservationのOrder Item / Slot cardinality
- Karaoke TicketのReservation cardinality
- cancellation後履歴保持
- Check-in time predicateに必要なquery field
- `AVAILABLE -> HELD` / `HELD -> SOLD` / release / cancellation transaction boundary
- concurrent lock / isolation design
- generation idempotency / overlap conflict strategy
- Consistency Review Caseとのrelation

本書はSQL、constraint syntax、index method、transaction isolation levelを固定しない。

---

## 32. `SPEC-110 API Specification` への委譲

`SPEC-110` は本書から少なくとも以下をAPI Contractへ具体化する。

- Karaoke sales guide / dates / schedule / Slot detail read
- 1時間bucket response
- purchase start
- Hold / checkout status
- Admin Slot generation / edit / sales stop / resume
- Reservation self read / admin read
- authorized cancellation triggerを持つ場合のcontract
- Staff Karaoke Check-in request / result
- conflict / expired / outside-window / review-requiredのHTTP / error contract
- idempotency key / public referenceのwire semantics

本書はEndpoint path、HTTP Status、Zod schemaを固定しない。

---

## 33. `SPEC-130 Admin / Staff Specification` への委譲

`SPEC-130` は以下を定義する。

- Slot一括生成画面
- Exclusive Scope選択UI
- Slot edit UI
- sales stop / resume UI
- Reservation検索 / 詳細
- Hold / Payment / Ticket / Check-in相関表示
- Staff Karaoke QR scan UI
- `OUTSIDE_CHECKIN_WINDOW` 等の受付結果表示
- authorized cancellation / recovery operationをUIへ出す場合の確認フロー

本書は個別画面を追加しない。

---

## 34. `SPEC-150 Reliability / Recovery` への委譲

`SPEC-150` は以下を定義する。

- Hold expiry scheduler / reconciliation cadence
- Checkout / Webhook retry
- Payment authority再照合
- overdue Hold safety quarantineのRunbook
- Consistency Reviewの解消手順
- delayed payment + expired Holdのoperator procedure
- Database deadlock / transient error retry
- Auth / Stripe / DB outage recovery
- cancellation / check-in競合時の運用確認

---

## 35. `SPEC-160 Observability / Audit` への委譲

`SPEC-160` は以下のAudit Event schemaを定義する。

- Slot generation
- Slot generation conflict
- Slot edit
- sales stop / resume
- Hold acquired / released / expired / committed
- Hold contention
- Checkout start / failure correlation
- Reservation confirmed / canceled
- Karaoke Ticket issued / canceled / expired
- Karaoke Check-in success / rejection
- Consistency Review creation / resolution

本書はevent field、retention、log transportを固定しない。

---

# Part XIII — Traceability

## 36. Rule Group -> Functional Requirement

| SPEC-090 Rule Group | 主なFunctional Requirement |
|---|---|
| `KRK-SCP-*`, `KRK-TIM-*` | `FR-KRK-002〜006`, `FR-KRK-021`, `FR-KRK-028〜030`, `FR-XFN-014` |
| `KRK-GEN-*` | `FR-KRK-028〜030`, `FR-ADM-009〜012`, `FR-XFN-014`, `FR-XFN-024` |
| `KRK-AVL-*` | `FR-KRK-001〜009`, `FR-XFN-026`, `FR-PUB-008`, `FR-PUB-010` |
| `KRK-HLD-*` | `FR-KRK-009〜016`, `FR-XFN-014`, `FR-XFN-027〜028` |
| `KRK-PAY-*` | `FR-KRK-013〜017`, `FR-KRK-027`, `FR-XFN-009〜012`, `FR-XFN-021`, `FR-XFN-027〜029` |
| `KRK-CFM-*` | `FR-KRK-017〜027`, `FR-MYP-005〜008`, `FR-MYP-010`, `FR-XFN-012〜014`, `FR-XFN-021` |
| `KRK-CAN-*` | `FR-KRK-024〜026`, `FR-ADM-020〜021`, `FR-XFN-020〜021`, `FR-XFN-024` |
| `KRK-EDT-*` | `FR-KRK-028〜031`, `FR-ADM-009〜015`, `FR-ADM-019〜020` |
| `KRK-CHK-*` | `FR-STF-008〜015`, `FR-KRK-024〜026`, `FR-KRK-032`, `FR-XFN-015`, `FR-XFN-018`, `FR-XFN-030〜031` |
| `KRK-REC-*` | `FR-AUTH-014`, `FR-ADM-021`, `FR-XFN-020〜021`, `FR-XFN-024〜025`, `FR-XFN-032` |

---

## 37. Rule Group -> Domain Rule / Invariant

| Topic | Upstream trace |
|---|---|
| Time / occupancy | `BR-KRK-001〜002`, `BR-XFN-003`, `DI-030-005` |
| Purchase start / Hold | `BR-KRK-003〜007`, `BR-KRK-010`, `BR-ORD-009`, `DI-030-001`, `DI-030-005`, `DI-030-012` |
| Confirmation | `BR-KRK-008〜009`, `BR-KRK-013〜021`, `DI-030-002〜003`, `DI-030-005`, `DI-030-009`, `DI-030-012` |
| Cancellation | `BR-KRK-017〜018`, `BR-KRK-024`, `DI-030-007`, `DI-030-009〜010`, `DI-030-012` |
| Check-in | `BR-KRK-022〜024`, `BR-CHK-001〜008`, `DI-030-007`, `DI-030-010`, `DI-030-012` |
| Ownership / authority | `BR-USR-001`, `BR-USR-003〜007`, `DI-030-010〜011` |
| Cross-functional retry | `BR-SAL-*`, `BR-ORD-*`, `BR-XFN-*`, `DI-030-012` |

本書は `DI-030-001〜005`, `DI-030-007`, `DI-030-009〜012` を変更しない。

---

## 38. Rule Group -> User Flow / Page

| SPEC-090 Topic | User Flow | Page |
|---|---|---|
| Sales / availability / bucket | `UF-KRK-001` | `PG-KRK-001〜002` |
| Slot detail / purchase start | `UF-KRK-002` | `PG-KRK-003` |
| Payment pending / retry / review | `UF-KRK-002`, `UF-XFN-001`, `UF-XFN-003〜004` | `PG-XFN-001` |
| Reservation / Ticket confirmation | `UF-KRK-002`, `UF-MYP-001〜002` | `PG-MYP-008〜010` |
| Cancellation result | `UF-KRK-003`, `UF-MYP-001〜002` | `PG-MYP-008〜010` |
| Karaoke Check-in | `UF-CHK-002` | `PG-MYP-009〜010` のCustomer提示側 |

`PG-KRK-002` の1時間bucketは `usage_start` 基準を維持する。

---

## 39. Rule Group -> Authentication / Authorization

本書の主要Operationは次へ追跡する。

- Purchase / ownership: 関連 `AR-OWN-*`, `AR-AZ-*`, `AR-FAIL-*`
- Slot management: `AR-ROLE-*`, `karaoke_slots.manage`
- Reservation admin read: `karaoke_reservations.manage.read`
- Karaoke Check-in: `AR-ROLE-001〜005`, `AR-ROLE-012`, `AR-ROLE-015`, `AR-AZ-014`, `AR-FAIL-*`, `karaoke_checkin.execute`
- Recovery / privileged mutation: `AR-ROLE-014` および対象specで明示された `recovery.exception.execute` 境界

特に `AR-AZ-012`, `AR-AZ-014` を含むServer-side authorizationをUI表示で代替しない。

---

## 40. Rule Group -> Payment

| SPEC-090 Topic | Payment trace |
|---|---|
| Hold residual time / Checkout activation | `PAY-CHK-006〜013` |
| Browser Return | `PAY-BRW-001〜003` |
| Confirmation | `PAY-CFM-001〜005`, `PAY-CFM-008〜009` |
| cancel / expiry / failure release | `PAY-FLR-001〜008` |
| concurrency / retry | `PAY-IDM-001〜009` |
| Refund / cancellation | `PAY-RFD-001〜007` |
| Consistency Review | `PAY-REC-001〜004` |

本書はCheckout Session 30分Payment Deadlineを変更しない。

---

## 41. Rule Group -> Ticket / QR / Check-in

| SPEC-090 Topic | Ticket / QR trace |
|---|---|
| Karaoke Ticket source / cardinality | `TQR-TKT-005〜010` |
| Customer Reservation / QR display | `TQR-DSP-*` のKaraoke関連Rule |
| Normal Check-in | `TQR-CHK-001〜016` |
| concurrency / rescan | `TQR-IDM-001〜011` |
| Ticket expiration | `TQR-CAN-003〜005` |
| Payment source | `TQR-CAN-006〜009` |
| Reservation / Ticket cancellation | `TQR-CAN-010〜019` |
| Auth / DB / correlation failure | `TQR-REC-001〜014` |

本書はEntry / Karaoke purpose separation、QR Token、Ticket single-use、Check-in atomicityを変更しない。

---

## 42. Rule Group -> System Invariant

| System Invariant | SPEC-090での具体化 |
|---|---|
| `INV-010-01` 購入情報を失わない | Hold / Orderを追跡可能にし、Checkout failureでOrderを削除しない |
| `INV-010-02` Orderを二重確定しない | Payment Business Causeとcurrent stateで1回だけConfirmation |
| `INV-010-03` Ticketを二重発行しない | ReservationごとにKaraoke Ticket最大1件 |
| `INV-010-04` Karaoke枠を二重販売しない | Exclusive Scope overlap禁止、Slot最大1 ACTIVE Hold / Reservation、expired Holdで奪い返さない |
| `INV-010-05` QR Ticketを二重利用させない | `SPEC-080` single-use / check-in atomicityをそのまま適用 |
| `INV-010-07` 決済確定と権利発行を中途半端に残さない | Hold COMMITTED + Slot SOLD + Reservation + Ticket + Orderを一貫確定 |
| `INV-010-08` 所有権と権限をServer-sideで検証 | Customer / Admin / Staff operationをServer-side authorization |
| `INV-010-09` 金額をClient入力だけで確定しない | Order Item server-side price snapshotを利用 |
| `INV-010-10` 外部処理の再送に耐える | generation / Hold / Checkout / confirmation / cancellation / check-inをBusiness Causeで冪等化 |

---

## 43. Required upstream trace coverage

本仕様全体として、少なくとも次の上流ID群を直接またはRule Group経由で追跡する。個々のRuleへ機械的に1対1対応させることは要求しないが、下流実装・Testは当該IDへ遡れること。

- Functional Requirements: `FR-KRK-001〜032`, 関連 `FR-MYP-*`, `FR-ADM-*`, `FR-STF-008〜015`, `FR-XFN-*`
- Domain Rules: `BR-KRK-001〜024`, 関連 `BR-SAL-*`, `BR-ORD-*`, `BR-USR-*`, `BR-CHK-*`
- Domain Invariants: `DI-030-001〜005`, `DI-030-007`, `DI-030-009〜012`
- User Flows: `UF-KRK-001〜003`, `UF-MYP-001〜002`, `UF-CHK-002`, `UF-XFN-001`, `UF-XFN-003〜004`
- Pages: `PG-KRK-001〜003`, `PG-XFN-001`, `PG-MYP-008〜010`
- Authentication / Authorization: 関連 `AR-OWN-*`, `AR-ROLE-*`, `AR-AZ-012`, `AR-AZ-014`, `AR-FAIL-*`
- Payment: 関連 `PAY-CHK-*`, `PAY-CFM-*`, `PAY-FLR-*`, `PAY-IDM-*`, `PAY-RFD-*`, `PAY-REC-*`
- Ticket / QR / Check-in: 関連 `TQR-TKT-*`, `TQR-DSP-*`, `TQR-CHK-*`, `TQR-IDM-*`, `TQR-CAN-*`, `TQR-REC-*`
- System Invariants: `INV-010-01〜05`, `INV-010-07〜10`

---

# Part XIV — Acceptance Criteria

## 44. Slot / generation acceptance

1. `usage_start < usage_end <= cycle_end` を常に満たす。
2. 標準Slotが利用15分 + 整備5分で生成される。
3. Customer表示時間と排他占有区間を分離する。
4. Business timezoneが `Asia/Tokyo` である。
5. 同一Exclusive ScopeのOccupancy Intervalを重複生成しない。
6. Batch retryでexact duplicate Slotを増やさない。
7. 非同一overlap conflictがあるbatchを部分成功させない。
8. 新規Slotは `AVAILABLE` から開始する。
9. `PG-KRK-002` の1時間bucketは `usage_start` 基準で1回だけ分類する。
10. `HELD` / `SOLD` / `SALES_STOPPED` を空きとして数えない。

## 45. Hold / Checkout acceptance

1. Purchase startでServer-side current Slot stateを再検証する。
2. 同一Slotに `ACTIVE` Holdは最大1件。
3. Hold取得、Slot `HELD`、Order `PREPARED` の部分Commitを通常結果にしない。
4. Hold期限は取得成功から45分。
5. `hold_acquired_at` をretryでリセットしない。
6. Checkout SessionのPayment Deadlineは作成成功から30分。
7. Active Checkout化にはPayment DeadlineまでのHold残存時間を要求する。
8. さらにHold側へ5分Safety Bufferを残す。
9. Payment Deadlineが `usage_end` を越えるCheckoutをActive化しない。
10. `PREPARED` + `ACTIVE` HoldのCheckout生成failureは同Order / Holdを条件付きretryする。
11. `EXPIRED` / `RELEASED` Holdを再利用しない。
12. Payment failure / cancel / expiryによるreleaseを冪等にする。

## 46. Confirmation acceptance

1. Browser ReturnをReservation確定根拠にしない。
2. Hold / Customer / Slot correlationを確認する。
3. Slotが対応Holdの `HELD` であることを確認する。
4. Hold `ACTIVE -> COMMITTED` とSlot `HELD -> SOLD` を成立させる。
5. Karaoke Order ItemからReservation最大1件。
6. ReservationからKaraoke Ticket最大1件。
7. Reservation / Ticket Customer = Order Customer。
8. Reservation Slot = Hold Slot。
9. Order `CONFIRMED` と必須Karaoke権利を部分Commitしない。
10. Payment successがHold terminal後に検出されてもSlotを奪い返さない。
11. 遅延Webhook / correlation不整合を通常成功にしない。

## 47. Cancellation / resale acceptance

1. Reservation cancellationは正規preconditionを持つ。
2. Ticket `USED` の通常Cancellationを拒否する。
3. Ticket `EXPIRED` もNormal Cancellationへ進めない。
4. Reservation `CONFIRMED -> CANCELED` とTicket `VALID -> CANCELED` を一貫Commitする。
5. Refund `SUCCEEDED` だけでReservation / Ticketを自動取消ししない。
6. Ticket cancellationだけでSlotを再販売しない。
7. Cancelled Reservation後もSlot `SOLD`、Hold `COMMITTED` を維持する。
8. 本バージョンでは確定Reservation cancellation後のSlot resaleを行わない。
9. Cancelled Reservation / Ticket / Order / Hold / Slot履歴を削除しない。

## 48. Slot edit acceptance

1. `AVAILABLE` / `SALES_STOPPED` の権利影響属性はoverlap invariantを再検証して編集できる。
2. `HELD` / `SOLD` の権利影響属性を通常編集しない。
3. `SALES_STOPPED` は既存Hold / Reservationを自動取消ししない。
4. `SOLD -> AVAILABLE` を通常編集で行わない。
5. concurrent Hold / sales stop / editでstale stateを上書きしない。

## 49. Check-in acceptance

1. `checkin_opens_at = usage_start - 10分`。
2. `checkin_closes_at = usage_end`。
3. windowは `[checkin_opens_at, checkin_closes_at)`。
4. open境界は受付可、close境界は受付不可。
5. `usage_end` 後の未使用Ticketはauthoritativeにexpiredとして扱う。
6. Reservation `CANCELED` は受付不可。
7. 通常Staff Capabilityだけで時間外受付を成功させない。
8. Entry / Karaoke purpose separationを維持する。
9. Ticket single-use / atomic Check-inを `SPEC-080` のまま維持する。

## 50. Failure / recovery acceptance

1. Auth Service障害で新規protected mutationを成立させない。
2. Business Database障害でClient cacheを根拠にKaraoke権利を確定しない。
3. 既存確定Reservation / Ticket / Paymentを障害の副作用で削除しない。
4. Hold / Slot / Reservation / Ticket correlation不整合を推測修復しない。
5. Payment uncertainty中にSlotを別Customerへ再販売しない。
6. Consistency Reviewを通常成功表示しない。
7. Recovery Runbookを `SPEC-150` へ委譲する。
8. Audit Event schemaを `SPEC-160` へ委譲する。

---

# Part XV — 禁止事項

## 51. 実装上の禁止事項

以下を禁止する。

- 利用時間 `[usage_start, usage_end)` と排他占有 `[usage_start, cycle_end)` を同一視する
- 同一Exclusive ScopeでoverlapするSlotを作る
- `SALES_STOPPED` Slotを空きとして数える
- `HELD` Slotに2件目の `ACTIVE` Holdを作る
- Hold取得時刻をretryで更新して45分を実質延長する
- Payment Deadlineまで届かないHoldでOrderを `AWAITING_PAYMENT` にする
- 5分Safety Bufferを満たさないKaraoke CheckoutをActive化する
- `usage_end` 後まで支払可能な新規Karaoke CheckoutをCustomerへ提示する
- `RELEASED` / `EXPIRED` Holdを再利用する
- Browser ReturnをReservation確定根拠にする
- Payment successだけでexpired Holdを復活させる
- Payment successだけで他CustomerからSlotを奪い返す
- 同一Order Itemから2件目のReservationを作る
- 同一Reservationから2件目のKaraoke Ticketを作る
- Reservationへ `USED` stateを追加する
- Ticket `USED` を通常Reservation cancellationへ進める
- Refund成功だけでReservation / Ticket / Slotを自動変更する
- Ticket cancellationだけでSlot resaleを成立させる
- canceled Reservation後にSlotを `AVAILABLE` へ戻す
- `HELD` / `SOLD` Slotの時間・Scopeを通常編集する
- `SALES_STOPPED` を既存Hold / Reservation取消のshortcutにする
- `karaoke_checkin.execute` を時間外overrideとして扱う
- `usage_end` 後の `VALID` 表示だけを根拠にCheck-inを成功させる
- Auth / DB障害時にfail-openする
- correlation不整合を既存Data削除・再生成で隠す
- API Endpoint / HTTP Statusを本書で固定する
- DB Table / Column / SQL / Indexを本書で固定する
- Administrator / Staff個別画面を本書で定義する
- Recovery Runbookを本書で定義する
- Audit Event schemaを本書で定義する

---

# Part XVI — AI実装エージェントへの必須解釈

## 52. 実装時の優先解釈

AI実装エージェントは本書を実装するとき、少なくとも次を明示的なInvariantとして扱わなければならない。

1. Slotの排他性はScope + `[usage_start, cycle_end)` で判定する。
2. 20分cycleのうちCustomer利用は15分だけである。
3. 1時間bucketは `usage_start` だけで決める。
4. Slot `AVAILABLE` と「現在購入可能」は同義ではない。
5. Hold取得とOrder追跡を部分Commitしない。
6. Hold TTLは45分、Payment Deadlineは30分、Hold Safety Bufferは5分である。
7. Checkout activationには `payment_deadline <= hold_expires_at - 5分` を要求する。
8. Checkout activationには `payment_deadline <= usage_end` も要求する。
9. Hold terminal後のPayment successは通常Confirmationへ進めない。
10. Business ConfirmationはSlot / Hold / Reservation / Ticket / Orderを一貫確定する。
11. Reservation利用済みはTicket / Check-inから導出する。
12. Normal CancellationはTicket `VALID` の未使用Reservationに限る。
13. canceled ReservationのSlotは `SOLD` のままで再販売しない。
14. Normal Check-in windowは `[usage_start - 10分, usage_end)`。
15. Ticket expiration cutoffは `usage_end`。
16. Staffの通常Check-in権限は時間条件を迂回しない。
17. Auth / DB / Payment不整合では権利を推測して作成・削除しない。
18. 物理DB設計は `SPEC-100`、APIは `SPEC-110`、運用画面は `SPEC-130`、Runbookは `SPEC-150`、Audit schemaは `SPEC-160` に従う。

---

## 53. 上流仕様変更要求

なし。

本仕様で採用した「Reservation cancellation後はSlot resaleを行わず `SOLD` を維持する」方針は、`SPEC-030` の既存State Machineと整合し、新しいState / transitionを要求しない。
