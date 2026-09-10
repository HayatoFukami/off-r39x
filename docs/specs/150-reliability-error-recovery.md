---
spec_id: SPEC-150
title: Reliability, Error and Recovery
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
  - SPEC-100
  - SPEC-110
  - SPEC-120
  - SPEC-130
  - SPEC-140
related_specs:
  - SPEC-040
  - SPEC-050
  - SPEC-160
  - SPEC-170
  - SPEC-180
  - SPEC-200
---

# 150 Reliability / Error / Recovery

## 1. 目的

本書は、**off r39'x in 大阪らへん2027** Webシステムの完成形におけるReliability Architecture、failure domain、error classification、timeout、retry、backoff、jitter、retry budget、idempotent retry、Database transaction retry、external provider result unknown、reconciliation、Consistency Review、stuck processing検出、scheduled recovery、manual recovery、Administrator recovery operation、graceful degradation、およびRecovery Runbookを定義する。

本書は **Reliability / Retry / Reconciliation / Recovery RunbookのCanonical Owner** である。

本書は上流Canonical Ownerが定義したDomain State、API endpoint、Database schema、Security Control、Payment lifecycle、QR format、Notification lifecycle、Role / Capabilityを変更しない。Reliability都合で上流の禁止遷移を追加許可したり、Provider Result Unknownを成功または失敗へ推測したり、Security Fail Closedを迂回してはならない。

本書はMVP、Step1、Step2等の実装段階でReliabilityを分断しない。長期運用される完成システムを対象とする。

---

## 2. 適用範囲

本書は以下へ適用する。

- Next.js WebからHono APIへの業務Request
- Supabase Auth verification / recipient lookup
- Supabase PostgreSQL connection / statement / transaction / lock
- Stripe Checkout / lookup / Webhook / Payment Confirmation / Refund
- Entry Ticket / Karaoke Ticket / QR token / Check-in
- Karaoke Slot / Hold / Reservation
- Goods Allocation / Inventory / Handoff
- Notification Request / Email Delivery Job / Resend / Resend Webhook
- Administrator / Staff mutationのresponse loss / retry
- scheduled reconciliation / consistency check
- Consistency Review Caseの作成・再評価・解消判定
- Security dependency failureとReliabilityの接続

以下は本書のCanonical Ownerではない。

- Domain State / Business Rule: `SPEC-030`
- Authentication / Authorization / Capability: `SPEC-060`
- Payment / Refund state machine: `SPEC-070`
- QR format / Check-in outcome: `SPEC-080`
- Karaoke時間・Hold・no-resale rule: `SPEC-090`
- Database table / column / constraint: `SPEC-100`
- HTTP endpoint / status / error envelope: `SPEC-110`
- Notification Domain / Processing State / Resend idempotency contract: `SPEC-120`
- Admin / Staff Page / UX contract: `SPEC-130`
- Security Control / secret / replay tolerance / rate limit: `SPEC-140`
- log schema / audit event schema / metric / alert / retention: `SPEC-160`
- scheduler製品、deployment command、backup provider設定: `SPEC-180`

---

## 3. 依存仕様と採用理由

| Spec | 本書が直接利用するCanonical contract |
|---|---|
| `SPEC-000` | Canonical Owner、`depends_on`、Upstream Change Request、未決定事項決定規則 |
| `SPEC-010` | System Boundary、System of Record、`INV-010-01〜10` |
| `SPEC-020` | `FR-AUTH-*`、Payment / Ticket / Karaoke / Goods / Email / Admin / Staff / Cross-functional要件 |
| `SPEC-030` | Domain State、Business Rule、Domain Invariant、Consistency Review Case意味 |
| `SPEC-060` | Auth / Session / Role / Capability、Fail Closed、last Administrator protection |
| `SPEC-070` | Checkout / Payment / Webhook / Refund / Provider Result Unknown / Business Cause |
| `SPEC-080` | QR / Check-in / single-use / Token rotation / Consistency Failure |
| `SPEC-090` | 45分Hold、30分Payment Deadline接続、5分Safety Buffer、no resale、Check-in window |
| `SPEC-100` | Physical state、constraint、`READ COMMITTED`、lock、`40001` / `40P01`、Review table |
| `SPEC-110` | API error contract、idempotency、Webhook / Admin operation boundary |
| `SPEC-120` | Notification / Email Job / Attempt、Resend 10秒deadline、120秒claim、23時間safe cutoff |
| `SPEC-130` | Recovery UI、Consistency Review UI、未反映 `UCR-130-001〜006` |
| `SPEC-140` | Security Fail Closed、300秒Webhook replay tolerance、QR key protection、rate limit |

`SPEC-040` / `SPEC-050` は既存User Flow /一般画面のUX traceに使用する関連仕様であり、本書はそのPage / Routeを再定義しない。

### 3.1 `UCR-130-001〜006` の扱い

`SPEC-130` の `UCR-130-001〜006` は本書作成時点で**未反映**として扱う。本書は、要求中のCapability、Admin API、read contract、indexが既にCanonical化されたと仮定しない。

本書のRecoveryがそれらに依存する場合は、既存Canonical operationだけで実行できる範囲を明示し、不足は本書末尾のUpstream Change Requestで扱う。

---

## 4. Canonical Reliability Terms

| Term | 意味 |
|---|---|
| Failure Domain | 他componentへ不整合を伝播させず隔離すべき障害単位 |
| Business Cause | 同一Domain effectを最大1回へ収束させる業務上の原因 |
| Transport Idempotency Key | HTTP mutation retryの相関key。Domain authorityではない |
| Provider Idempotency Key | Stripe / Resendの同一Provider side effectを再送時に相関するkey |
| Attempt | 同一Business Cause内で追跡される処理試行。上流がAttempt modelを持つ場合はその定義を使用する |
| Result Unknown | side effect開始可能性があるが、成功 / 失敗を安全に断定できないprocessing result |
| Reconciliation | Business DatabaseとProvider Authorityまたは関連Entityを再照合し、安全な既存結果へ収束させる処理 |
| Automatic Repair | 明示的Invariantとcurrent authorityだけから一意に決まる修復を人手なしで適用すること |
| Consistency Review | 自動修復すると二重side effectまたはBusiness Rule破壊の危険がある不整合を追跡する境界 |
| Stuck | 正常処理の期待時間を超えて非terminal processing stateに留まり、scheduled recovery対象となる状態 |
| Retry Budget | 同一Cause / dependencyに許可する自動retry回数・経過時間・layer数の上限 |
| Recovery Success | Authority、Business Database、Domain Invariantが再確認され、追加の推測処理なしで安定状態へ収束したこと |
| Recovery Failure | Retry budget / safe windowを使い切る、または安全な解消を一意に決められずReviewへ移行したこと |

---

## 5. Reliability Rule ID体系

| Prefix | Category |
|---|---|
| `REL-GEN-*` | Reliability general / failure classification |
| `REL-TMO-*` | Timeout / deadline |
| `REL-RTY-*` | Retry / backoff / jitter / retry budget |
| `REL-DB-*` | Database retry / transaction recovery |
| `REL-AUTH-*` | Supabase Auth / Business Profile / Role reliability |
| `REL-PAY-*` | Stripe Checkout / Payment / confirmation |
| `REL-RFD-*` | Refund recovery |
| `REL-TQR-*` | Ticket / QR / Check-in |
| `REL-KRK-*` | Karaoke Slot / Hold / Reservation |
| `REL-GDS-*` | Goods / Inventory / Handoff |
| `REL-EML-*` | Notification / Resend / Email worker |
| `REL-WHK-*` | Stripe / Resend Webhook |
| `REL-REC-*` | Reconciliation / Consistency Review |
| `REL-ADM-*` | Administrator / manual recovery |
| `REL-SEC-*` | Security failure interaction |
| `REL-UX-*` | Reliability outcome →既存UI分類 |

同一Rule IDを別の意味へ再利用してはならない。

---

# Part I — Reliability Architecture

## 6. Reliability Objective

**REL-GEN-001:** Availabilityより、金銭、権利、Role、Inventory、Reservation、Check-in、WebhookのIntegrityを優先する。障害時に安全なAuthorityを確認できないmutationは停止する。

**REL-GEN-002:** 既にBusiness Databaseへ確定済みのOrder、Ticket、Reservation、Goods、Check-in、Refund、Notification historyをdependency failureだけで削除・巻き戻し・Owner変更しない。

**REL-GEN-003:** 外部Provider障害とBusiness Database障害を同一failure domainへまとめない。Provider failureはProvider-side processing recordへ、DB failureはDB transaction resultへ、Security failureはFail Closedへ分類する。

**REL-GEN-004:** recoveryは「元処理を最初から再実行」ではなく、current state、Business Cause、Provider correlation、DB unique / lockを再取得してから不足している安全な処理だけを行う。

**REL-GEN-005:** critical mutationはresponse loss後も同じBusiness Causeへ収束しなければならない。Client `request_id` はcorrelation用途のみでIdempotency Authorityにしない。

## 7. Failure Domain

Canonical failure domainは次とする。

1. Browser / network transport
2. Next.js Web rendering / BFF
3. Hono API process
4. Supabase Auth
5. Business Database / pool
6. Stripe API
7. Stripe Webhook delivery
8. Resend API
9. Resend Webhook delivery
10. Email worker / scheduled reconciliation worker
11. QR cryptographic key / Secret configuration
12. Administrator / Staff operational request

**REL-GEN-006:** あるfailure domainの失敗を、別domainの成功として偽装してはならない。例としてResend failureをOrder failureへ、DB outageをsold outへ、Auth outageをauthorization denialへ変換しない。

---

## 8. Failure Classification

Canonical processing result classは次の7種類とする。これはDomain Stateではない。

```text
SUCCESS
TEMPORARY_FAILURE
PERMANENT_FAILURE
UNKNOWN_RESULT
CONFLICT_LOSER
CONSISTENCY_FAILURE
SECURITY_FAILURE
```

| Class | 自動retry | Business Cause | Provider key | 新Attempt | Manual review | Client表示分類 |
|---|---|---|---|---|---|---|
| `SUCCESS` | No | 同じCauseへ収束 | 同じ成功結果 | No | No | completed / already completed |
| `TEMPORARY_FAILURE` | Budget内でYes | 原則同じ | Provider side effectが同一なら同じ | 明確に未受理と確定した場合のみ可 | budget exhausted時 | retry later |
| `PERMANENT_FAILURE` | No | 同じCauseを保持 | blind再送しない | 原因修復後に上流が許可する場合のみ | 条件付き | permanent failure |
| `UNKNOWN_RESULT` | Blind retry禁止 | 必ず同じ | 必ず同じ。safe window外は再送禁止 | No | 解消不能時Yes | result unknown / pending |
| `CONFLICT_LOSER` | Blind retry不要 | 競合元Causeを保持 | 通常Provider callなし | No | No | conflict / already completed |
| `CONSISTENCY_FAILURE` | 自動repairが一意な場合のみ | 既存Causeを保持 | 新key禁止 | No | 原則Yes | consistency review required |
| `SECURITY_FAILURE` | Security control自体が回復した後だけ再評価 | 元Causeを保持 | Security check前にProvider call禁止 | No | 設定破損時Yes | retry later / access denied |

**REL-GEN-007:** `REVIEW_REQUIRED`、`FAILED_RETRYABLE`、`UNKNOWN_RESULT` Job、HTTP `503`、DB `40001`は別layerの概念であり相互にState renameしてはならない。

**REL-GEN-008:** `UNKNOWN_RESULT`を「たぶん失敗」と扱って新しいBusiness Cause / Provider keyを発行してはならない。

---

# Part II — Timeout / Deadline

## 9. Canonical System-side Timeouts

外部ProviderのSLAを表す値ではなく、**本システムが1回の処理を占有し続けないためのdeadline**として以下を使用する。

| Operation | Deadline / timeout | Exhausted時 |
|---|---:|---|
| Supabase Auth remote verification / user lookup | 3秒 / call | `TEMPORARY_FAILURE`; protected mutationはFail Closed |
| trusted JWKS refresh fetch | 3秒 | refresh 1回で打切り、Fail Closed |
| DB pool connection acquisition | 2秒 | `DATABASE_TEMPORARY_FAILURE` |
| normal DB statement | 5秒 | transaction rollback、retryableか分類 |
| Admin / reconciliation read statement | 10秒 | item failure。全batchを無制限blockしない |
| DB lock wait (`lock_timeout`) | 1秒 | lock conflictとしてtransaction再試行候補 |
| normal Business DB transaction wall clock | 8秒 | rollback / unknown commit判定 |
| Stripe API request | 10秒 | side-effect callは`UNKNOWN_RESULT`、read-only lookupはtemporary failure |
| Resend Email API request | **10秒** (`SPEC-120`維持) | `UNKNOWN_RESULT` |
| Email Job Claim Lease | **120秒** (`SPEC-120`維持) | abandoned claim recovery |
| generic reconciliation item processing | 15秒 | itemのみ延期 / Review判定 |
| Stripe / Resend webhook handler soft budget | 6秒 | retryable処理を早期終了させる |
| Stripe / Resend webhook handler hard deadline | 8秒 | response前に安全なreceipt更新を試行し、未完了は5xx |
| Admin manual recovery HTTP request | 15秒 | final result未確定ならpending / unknownを返し同期waitし続けない |

**REL-TMO-001:** Stripe Checkout Session lifetime / Payment Deadline 30分、Karaoke Hold 45分、Safety Buffer 5分、Resend 23時間safe cutoff、Webhook replay tolerance 300秒は上流値をそのまま使用する。

**REL-TMO-002:** DB transactionをStripe / Resend / Supabase Auth remote call中にopenしたままにしない。

**REL-TMO-003:** timeout発生後にcommit成否またはProvider resultが不明なら`UNKNOWN_RESULT`へ分類し、「timeout = failure」と断定しない。

---

# Part III — Retry / Backoff / Budget

## 10. Common Retry Rule

**REL-RTY-001:** retryは、同じinputを再送してもduplicate side effectが発生しないことをBusiness Cause、Provider idempotency、DB constraint、current stateのいずれかで証明できる場合だけ行う。

**REL-RTY-002:** exponential backoffのcanonical式は次とする。

```text
cap_n = min(max_delay, initial_delay * multiplier^(attempt_no - 1))
delay = random_uniform(0, cap_n)   # full jitter
```

`attempt_no` は初回retryを1とする。

**REL-RTY-003:** 固定backoffを使用するのは、safe read-only reconciliationまたは上流safe cutoffへ近づく長時間確認phaseだけとする。

## 11. Retry Policy Matrix

| Retry class | Initial | Multiplier | Max delay | Jitter | Max automatic attempts | Max elapsed | Exhausted |
|---|---:|---:|---:|---|---:|---:|---|
| DB `40001` | 50ms | 2 | 400ms | full | 4 transaction attempts total | 2s | 503 |
| DB `40P01` | 100ms | 2 | 800ms | full | 4 total | 3s | 503 |
| temporary DB connection acquisition | 100ms | 2 | 500ms | full | 3 connection attempts | 3s | 503 |
| Supabase Auth temporary failure | 100ms | 2 | 500ms | full | 2 remote attempts | 7s | 503 / worker reschedule |
| Stripe Checkout creation, explicit temporary / same-key recovery | 500ms | 2 | 5s | full | initial + 4 same-key attempts | 30s | `UNKNOWN` / Review path |
| Stripe read-only lookup | 250ms | 2 | 2s | full | 4 attempts | 15s | scheduled reconciliation |
| Refund provider write, same-key | 1s | 2 | 5s | full | initial + 2 same-key attempts | 20s | stop provider writes; read-only reconcile |
| Stripe verified webhook internal processing | 5s | 2 | 5m | full | 6 internal attempts | 30m | Review |
| Resend 429 clearly not accepted | 30s | 2 | 10m | full | 8 new Delivery Attempts | 45m | `BLOCKED` / Admin retry |
| Resend 5xx / timeout / connection reset | 30s | 2 | 30m | full, first phase | 8 same-key probes | 4h | long reconciliation phase |
| Resend Unknown long phase | 1h | fixed | 1h | ±10% | 18 same-key probes | 22h from first call | `BLOCKED` before 23h cutoff |
| Notification recipient Auth lookup | 30s | 2 | 15m | full | 10 attempts | 2h | `BLOCKED` if still unavailable |
| abandoned Email claim before provider call | 30s | 2 | 5m | full | 3 recoveries / 15m | 15m | `BLOCKED` + Review |
| Resend webhook DB failure internal retry | 5s | 2 | 5m | full | 6 | 30m | Review |
| reconciliation item transient DB/provider read | 30s | 2 | 10m | full | 6 | 1h | manual/review |

**REL-RTY-004:** Resend `5xx` / timeoutは上流どおり`UNKNOWN_RESULT`であり、新Attempt / 新Provider keyへ進まない。表の「same-key probe」は同じDelivery Attempt / keyを使用する。

**REL-RTY-005:** Refundが`UNKNOWN_RESULT`になった後、write retry budgetを使い切ったら同一Refundを再作成せず、Stripeのread-only authority lookupとWebhookだけで照合する。

## 12. Retry Budget / Storm Prevention

**REL-RTY-006:** 1つのlogical operationで自動retryを行うlayerは最大1層とする。Provider SDK内retryを無効化または0回にし、application retryと二重化しない。

**REL-RTY-007:** Browser mutationはHono側が`retryable=true`を返したことだけを根拠に連続自動再送しない。network loss時の自動再送は最大1回で、同じTransport `Idempotency-Key`を使用する。

**REL-RTY-008:** `429`はimmediate retryしない。`Retry-After`が信頼できるProvider responseとして存在する場合は、その値と本書backoffの**長い方**を使用する。ただしProviderの保証時間とは解釈しない。

**REL-RTY-009:** background retryは`next eligible time`を満たすrowだけをclaimし、同一rowをtight loopで再処理しない。

**REL-RTY-010:** dependency outage中は新しいside-effect retryより、既存Causeのread-only reconciliationを優先する。Security / DB / Auth failure中にProvider writeを先行させない。

---

## 13. Client Retry

**REL-RTY-011:** GET / status readはnetwork / 503に対し250ms、750msの2回までClient再試行してよい。

**REL-RTY-012:** mutation response loss時は次の順序とする。

1. 同じ`Idempotency-Key`を保持する。
2. owner/status readまたはAdmin detail readでcurrent stateを再取得する。
3. already completedなら既存結果を表示する。
4. current stateでmutation未成立が確認でき、APIがretryableなら同じkeyで最大1回再送する。
5. `UNKNOWN_RESULT` / reviewなら新しいCauseを作らず表示をpending / reviewへ切り替える。

**REL-RTY-013:** Check-inはTransport keyよりTicket consume-onceがauthorityであり、response loss後の再scanは既存Check-inへ収束する。

---

# Part IV — Database Reliability

## 14. Transaction Retry Boundary

`SPEC-100` の標準Isolation `READ COMMITTED` とlock orderingを維持する。

**REL-DB-001:** standard automatic transaction retry対象SQLSTATEは`40001`と`40P01`のみとする。

**REL-DB-002:** `23505` / `23P01` / `23514` / `23503`をblind transaction retryしない。constraint名とcurrent stateを再読込し、known idempotent duplicate、known conflict loser、consistency failureのいずれかへ分類する。

**REL-DB-003:** retryするtransactionは同じBusiness Cause、同じnormalized input、同じauthorization principalの再評価結果を使用する。retryごとに新Order / new Hold / new Refund等を作らない。

**REL-DB-004:** transaction retry前に外部Provider callを再実行してはならない。外部callはtransaction外に分離する。

## 15. Commit Result Unknown

**REL-DB-005:** connection lossがCOMMIT送信前と確認できる場合はrollback相当として同じtransactionをbudget内で再試行してよい。

**REL-DB-006:** COMMIT送信後、acknowledgement受領前のconnection lossは`UNKNOWN_RESULT`とする。再試行前にBusiness Cause / unique relation / current stateを新connectionで照合する。

**REL-DB-007:** commit済みである可能性があるmutationに対し、新Business Causeを作らない。

**REL-DB-008:** current stateが既に期待結果ならexisting resultを返す。current stateが未変更と安全に確認できる場合だけ同じCauseでretryする。判定不能ならConsistency Reviewへ送る。

## 16. Pool / Query / Lock Failure

**REL-DB-009:** pool acquisition 2秒超過はDB unavailable扱いとし、empty list、not found、sold outへ変換しない。

**REL-DB-010:** statement timeoutはtransactionをrollbackし、同じstatementを無制限にretryしない。既知の`40001` / `40P01`以外はquery plan / overload / dependency failureとして上位へ返す。

**REL-DB-011:** lock timeoutは一時競合とみなし、Business Causeを維持してtransaction policy内でretryする。ただし4回で終了する。

**REL-DB-012:** runtime failureとmigration failureを分離する。required schema / constraint / extensionが欠ける場合はruntime fallbackせずserviceをReadyにしない。

---

# Part V — Authentication Reliability

## 17. Supabase Auth Verification

**REL-AUTH-001:** Auth verificationが3秒deadlineを超過、JWKS取得不能、issuer / keyを安全に確認不能な場合、protected operationは`SECURITY_FAILURE`またはtemporary auth failureとしてFail Closedにする。

**REL-AUTH-002:** JWKS refreshはtrusted configured endpointへ最大1回だけ行う。refresh失敗後にdecode-only JWT、expired token grace、cached successful roleで続行しない。

**REL-AUTH-003:** Session refresh failureはBrowser / Next.js側で再認証を要求し、Hono APIのprotected mutationを未検証Sessionで継続しない。

## 18. Business Profile Provisioning

**REL-AUTH-004:** parallel profile provisioningは`UNIQUE(auth_subject)` / `INSERT ON CONFLICT`のwinnerへ収束し、duplicate profileを作らない。

**REL-AUTH-005:** temporary DB failureはDB retry policyを使用する。Auth identityが存在するのにBusiness Profile relationが壊れている場合はProfileを推測再作成せずConsistency Reviewとする。

## 19. Role Resolution / Revoke

**REL-AUTH-006:** Role resolution DB failure時はprivileged operationを503でFail Closedにする。Session内cached Roleをfallback authorityにしない。

**REL-AUTH-007:** Role revokeは次Requestからcurrent DB stateを使用する。retry中にRoleがrevokeされた場合、retry前にauthorizationを再評価し、revoke済みならmutationを続けない。

## 20. Initial Administrator Bootstrap / Emergency Recovery

初期Administrator bootstrapおよび「active Administratorが存在しない」緊急復旧は通常`role_assignment.manage` API外で行う。

**REL-AUTH-008:** bootstrap / emergency recoveryは、application Administratorが存在しないときだけ利用できるout-of-band recoveryとする。通常Admin UIのshortcutにしない。

Runbook:

- Trigger: active `ADMINISTRATOR` Role Assignment count = 0、または初回導入時
- Required authority: project-ownerにより承認されたinfrastructure / database privileged operator
- Preconditions: Supabase Auth上の対象Auth Subjectが存在しEmail verified、Business Profileが一意に解決、既存active Administratorが0件
- Locks: `pg_advisory_xact_lock(hashtext('app:active-administrator-set'))`
- Allowed action: 対象Profileへ1件の`ADMINISTRATOR` active Role Assignmentを正規schema制約下で作成
- Forbidden: Client role claim更新だけで権限付与、既存Role history削除、複数bootstrap、constraint無効化
- Success: transaction commit後にactive Administrator count >= 1かつ次protected requestでcurrent Role resolution成功
- Unknown DB commit: new assignmentをblind insertせずactive assignmentを再読込
- Post verification: `role_assignment.manage`通常APIが利用可能、last-admin protectionが有効

実際のprivileged command / credential配置は`SPEC-180`が定義する。

---

# Part VI — Stripe Checkout / Payment Reliability

## 21. Checkout Session Creation Recovery

**REL-PAY-001:** Order / Allocation / HoldのDB commit前にStripe Sessionを作成しない。

**REL-PAY-002:** Stripe call前DB failureならProvider callを行わず、同じpurchase requestのDB transactionだけをretryする。

**REL-PAY-003:** Checkout create timeout / response loss / 5xxは同一Checkout Attempt、同一Order Snapshot、同一Stripe idempotency keyで回復する。

**REL-PAY-004:** `creation_result=UNKNOWN`中は別Attempt / 別keyを作らない。

### 21.1 Automatic same-key schedule

Checkout Attemptが`UNKNOWN`なら、`provider_request_started_at`を起点に次のeligible pointで同じkeyを使用する。

```text
+0.5s
+2s
+7s
+20s
```

初回callを含め最大5 provider invocationとし、各callは10秒deadline、全体30秒を超えて同期処理しない。30秒時点で安全に確定しない場合、Orderは`PREPARED`を保持しscheduled reconciliationへ移す。

### 21.2 Scheduled reconciliation

`creation_result=UNKNOWN`は1分ごとにscanし、Stripe read-only lookup / same-key result recoveryを行う。初回Provider開始から30分で以下へ収束させる。

- Session存在かつBinding可能: Binding永続化と上流preconditionを再評価し、許可される場合`AWAITING_PAYMENT`
- Session非作成 / 再利用不能がAuthorityから明確: `creation_result=FAILED`; Order / Allocation / Holdが有効なら`PAY-CHK-010`に従いnew Attemptを許可
- 判定不能: Order `REVIEW_REQUIRED`可能なら遷移し、Consistency Review作成

**REL-PAY-005:** 30分超過後にUnknown Attemptをblind same-key writeで回し続けない。

## 22. Active Checkout / Double Click / Reload

**REL-PAY-006:** existing Active Checkoutがある場合、double click / reload / retryは既存Bindingを返し、新Sessionを作らない。

**REL-PAY-007:** Customer success redirectはstatus readだけを行い、Payment Confirmationを開始するauthorityにしない。

**REL-PAY-008:** Payment Deadline経過後も、支払成功の可能性をStripe Authorityで否定できるまでAllocation / Holdを解放しない。

## 23. Payment Confirmation Recovery

**REL-PAY-009:** verified Webhookまたはserver-to-server Stripe authorityがpaidを示しても、Order Purpose必須Domain effectを一括commitできない場合、Ticket / Reservation / Goods effectを部分的に作らない。

**REL-PAY-010:** `AWAITING_PAYMENT`でpaidが確認されBusiness Confirmation transactionが`40001` / `40P01`で失敗した場合、同じPayment Business CauseでDB retry policyを使用する。

**REL-PAY-011:** DB retry exhaustion、constraint inconsistency、resource reuseで安全なConfirmationができない場合、Orderを`REVIEW_REQUIRED`へ進められるなら進め、terminal OrderならConsistency Review Caseだけを作成する。

**REL-PAY-012:** late WebhookでPayment completionがPayment Deadline前と確認できても、Allocation / Holdが他取引へ再利用済みならEntitlementを奪い返さずReviewへ送る。

---

# Part VII — Refund Reliability

## 24. Refund Request Recovery

**REL-RFD-001:** Refund Record `REQUESTED`をDBへcommitできない場合はStripe Refundを開始しない。

**REL-RFD-002:** Refund call timeout / response lossは同じRefund Record、同じBusiness Cause、同じStripe idempotency keyを使用する。

**REL-RFD-003:** initial + 2 same-key write attempts、または20秒経過で結果を確定できない場合、Provider writeを停止し、Refundを`REVIEW_REQUIRED`または上流許可stateへ保持してread-only reconciliationへ移す。

**REL-RFD-004:** Provider result unknownで2件目のRefund Record、別idempotency key、別full Refundを発行しない。

## 25. Refund Reconciliation

Refund `REQUESTED` / `PENDING` / `REVIEW_REQUIRED`は2分ごとにscanする。

- 最初の30分: 2分cadence
- 30分〜6時間: 30分cadence
- 6時間超過: automatic provider lookupを停止しmanual review required

Authority照合結果:

- success: same Refund Recordを`SUCCEEDED`
- definitive failure: `FAILED`
- provider object exists but pending: `PENDING`
- amount / currency / correlation mismatch: `REVIEW_REQUIRED` + Case
- no safe conclusion: state保持 + Case

**REL-RFD-005:** Financial Refund `SUCCEEDED`後のTicket / Reservation / Goods cancellation failureはRefundを巻き戻さず、Domain cancellation incomplete Caseを作る。

---

# Part VIII — Webhook Reliability

## 26. Common Webhook Rules

Stripe / Resend共通:

**REL-WHK-001:** raw-body signature verification失敗はretryable Business failureではなく`SECURITY_FAILURE`である。Business Receipt / Domain stateを変更しない。

**REL-WHK-002:** verified Event ID / `svix-id`でdedupeする。duplicate deliveryは既存processed resultへ収束する。

**REL-WHK-003:** handler DB temporary failureでverified receiptを安全にpersistできない場合は5xxを返しProvider retryを許容する。Provider retry回数を外部事実として仮定しない。

**REL-WHK-004:** verified receiptをpersist済みだがBusiness processingだけが一時失敗した場合、Receiptを`FAILED_RETRYABLE`相当へ保存し、内部retry queueへ移す。

**REL-WHK-005:** permanently inconsistent / poison eventは`REVIEW_REQUIRED`へ永続化できた場合、同一eventをProvider retryだけで無限処理させず成功HTTPを返してinternal reviewへ隔離してよい。

## 27. Stripe Webhook Internal Retry

- soft processing budget: 6秒
- hard handler deadline: 8秒
- internal retry: 5秒 initial、×2、cap 5分、full jitter、6 attempts、30分max

**REL-WHK-006:** Stripe Event orderingを信用せず、retry時もcurrent Stripe object authorityとOrder current stateを再評価する。

**REL-WHK-007:** amount / currency mismatch、unresolved Payment Binding、terminal Orderとpaid resultの矛盾はblind retryではなくConsistency Reviewへ送る。

## 28. Resend Webhook Internal Retry

**REL-WHK-008:** Resend Webhook DB temporary failureは同じ`svix-id` receiptへ収束し、5秒 initial、×2、cap5分、6 attempts、30分maxでinternal retryする。

**REL-WHK-009:** unmatched provider email ID / attempt correlationは10分ごとに最大6回、1時間まで再照合し、解決しなければCaseを作る。source Business Transactionは変更しない。

---

# Part IX — Ticket / QR / Check-in Reliability

## 29. QR Provisioning / Display / Rotation

**REL-TQR-001:** QR初回provisionのparallel requestはactive-token partial uniqueをauthorityとし、winnerだけが新Tokenを作成する。loserはexisting Active Tokenを再読込して返す。

**REL-TQR-002:** QR display response loss後のretryはexisting Active Tokenを復号して同じQR payloadを返す。response lossだけを理由にrotationしない。

**REL-TQR-003:** Ticket-specific rotationはTicket rowをlockし、existing Active Token revoke + new Token作成を正規transactionで行う。commit後response lossではretryがcurrent Active Tokenを返し、2回目のrotationを自動実行しない。

## 30. QR Key Unavailable / Migration

**REL-TQR-004:** current HMAC / AEAD keyがmissing、unknown version、duplicate current設定なら`SPEC-140`どおりserviceをReadyにしない。plaintext fallbackは禁止する。

**REL-TQR-005:** rotation migration中はcurrent + allowlisted previous versionだけをreadし、新規writeはcurrent versionだけを使用する。

**REL-TQR-006:** active old-version rowは10分ごとにbatch reconciliation対象とする。1 row 15秒deadline内でlock → old decrypt → new digest / re-encryptを同一DB transactionで行う。

**REL-TQR-007:** AES-GCM authentication failure、lookup digest mismatch、Ticket correlation mismatchでは自動new Token発行を行わず、affected TicketをConsistency Reviewへ送りQR display / scanをFail Closedにする。

## 31. Check-in Response Loss / Concurrency

**REL-TQR-008:** Entry / Karaoke Check-inはTicket row lock + conditional `VALID -> USED` + unique Check-inで1回だけ成立させる。

**REL-TQR-009:** successful commit後HTTP response lossが起きた場合、retry / rescanはTicket `USED`とexisting Check-inを読み、`ALREADY_USED` / existing successful resultへ収束する。新Check-inを作らない。

**REL-TQR-010:** Ticket `USED`なのにCheck-in rowなし、またはCheck-in rowありなのにTicketが`VALID`等の不整合はauto state editせずCaseを作る。

**REL-TQR-011:** raw QR token、decrypted token material、HMAC inputをrecovery log、Consistency Review details、Admin UIへ出さない。

---

# Part X — Karaoke Reliability

## 32. Slot Generation

**REL-KRK-001:** Slot batch generationは上流all-or-nothing transactionを維持し、partial generationを成功として返さない。

**REL-KRK-002:** exact duplicate generation retryはdeterministic candidate / unique relationからexisting Slotをreuseする。GiST exclusion conflictは`CONFLICT_LOSER`であり時間をずらして自動生成し直さない。

## 33. Hold Acquisition / Expiration

**REL-KRK-003:** concurrent Hold取得はSlot row lock + active Hold partial uniqueでwinner 1件へ収束し、loserは`SLOT_UNAVAILABLE`相当とする。

**REL-KRK-004:** Hold expiry sweeperは1分cadenceで`ACTIVE`かつ`hold_expires_at <= now`をscanする。ただし関連Order / CheckoutがProvider Result UnknownならSlotを解放せずPayment reconciliationへ送る。

**REL-KRK-005:** 未支払をauthorityから安全に確認できたHoldのみ`EXPIRED`へ進め、Slotを上流許可stateへ戻す。

## 34. Payment / Reservation Recovery

**REL-KRK-006:** late Stripe paidが検出されHoldがterminal、Slotが他Customerへ再利用済みならSlotを奪い返さず、Order / related entityをReviewへ送る。

**REL-KRK-007:** Reservation confirmation retryは同じOrder Item / Hold / Slot relationを使用し、2件目Reservation / Karaoke Ticketを作らない。

**REL-KRK-008:** Reservation cancellationは`API-ADM-KRK-007`の既存preconditionを維持し、unused Ticketのみ取消し、Slotは`SOLD`のままにする。

**REL-KRK-009:** cancellation / Check-in競合はKaraoke Ticketを最初にlockし、winnerの正規結果だけを保持する。

**REL-KRK-010:** Reliability都合で`SOLD -> AVAILABLE`、`CANCELED -> CONFIRMED`、取消済みSlot resaleを追加しない。

---

# Part XI — Goods Reliability

## 35. Allocation / Inventory

**REL-GDS-001:** Goods Allocation / inventory reservationはInventory row lock、counter constraint、Allocation uniqueを使用し、transaction retryでheld / committed quantityを二重増減しない。

**REL-GDS-002:** payment前Order terminal化に伴うAllocation releaseは`HELD -> RELEASED`のwinnerだけがcounterを戻す。既に`RELEASED`なら既存結果を返す。

**REL-GDS-003:** `COMMITTED` AllocationはRefund存在だけで自動releaseしない。

**REL-GDS-004:** inventory counterとAllocation集計が一致しない場合、counterを集計値でblind overwriteせずConsistency Reviewとする。

## 36. Goods Handoff

**REL-GDS-005:** Handoff `PENDING -> COMPLETED`はGoods Order Item / Handoff rowをlockして一度だけ成立させる。

**REL-GDS-006:** Staff / Admin operationのcommit後response lossはexisting `COMPLETED` resultへ収束し、二重Handoffを作らない。

**REL-GDS-007:** `VOID` / `CANCELED` / non-fulfillable対象はretryで`COMPLETED`へ変えない。

**REL-GDS-008:** completed HandoffをReliability recoveryで`PENDING`へ戻さず、在庫を自動回復しない。

---

# Part XII — Notification / Resend Reliability

## 37. Worker Cadence / Claim

Email workerのlogical poll cadenceを**15秒**とする。scheduler製品は`SPEC-180`へ委譲する。

**REL-EML-001:** `READY` / `UNKNOWN_RESULT`かつ`next_attempt_at <= now`だけをclaim候補とし、`FOR UPDATE SKIP LOCKED`を使用する。

**REL-EML-002:** Claim Leaseは上流どおり120秒。Claim expiry sweeperは30秒cadenceとする。

**REL-EML-003:** `CLAIMED` expiry時、`provider_called_at IS NULL`なら`READY`へ戻す。`provider_called_at IS NOT NULL`かつAcceptance未確定なら`UNKNOWN_RESULT`へ戻しsame Attempt / same keyだけを許可する。

## 38. Recipient Resolution / Rendering

**REL-EML-004:** Auth recipient lookup temporary failureは30秒 initial、×2、cap15分、full jitter、10 attempts / 2hまで自動retryする。

**REL-EML-005:** recipient missing / unverified / Auth Identity missingはblind retryせず`BLOCKED`。current verified recipientへ変更できる条件は`SPEC-120`を維持する。

**REL-EML-006:** rendering failureは`BLOCKED` + Consistency Review。空文字や架空値で送信しない。

## 39. Resend Provider Retry

**REL-EML-007:** Resend 429が「未受理」と明確な場合だけ新Delivery Attempt / new provider keyを作ってよい。30秒 initial、×2、cap10分、8 attempts / 45分を上限とする。

**REL-EML-008:** timeout / reset / 5xx / concurrent-idempotent 409は`UNKNOWN_RESULT`であり、same Delivery Attempt / same Provider Idempotency Keyを使用する。

**REL-EML-009:** Unknown Result same-key recoveryは、最初4時間は30秒 exponential cap30分、最大8 probe、その後は1時間fixed ±10% jitterで最大18 probe、初回provider callから22時間までとする。

**REL-EML-010:** 22時間で未解決なら自動probeを停止し`BLOCKED` + `EMAIL_PROVIDER_RESULT_UNRESOLVED` Caseとする。上流23時間safe cutoffを超えてnew keyを作らない。

**REL-EML-011:** `SENT`をblind resendしない。Provider delivery failure / bounceは`SENT`を`FAILED_RETRYABLE`へ戻さない。

## 40. Notification Request Generation Missing

**REL-EML-012:** committed Business Eventに期待Notification Requestが欠落しているかを5分cadenceで照合する。

**REL-EML-013:** source state、Notification Type、recipient profile、deterministic `business_cause_key`、render contextを上流Ruleから一意に再導出できる場合だけNotification Request / Delivery Jobを補完する。

**REL-EML-014:** 補完時にOrder confirmation、Ticket issuance、Reservation confirmation、Inventory update、Refundを再実行しない。

**REL-EML-015:** same Business Causeに異なるrecipient / render contextが存在する場合は上書きせずConsistency Reviewとする。

---

# Part XIII — Reconciliation / Stuck Detection

## 41. Reconciliation General Rule

**REL-REC-001:** reconciliationはBusiness Databaseを起点に対象rowを選び、必要な場合だけProvider Authorityをserver-to-serverで照合する。Browser stateをauthorityにしない。

**REL-REC-002:** reconciliation batchは1 item 15秒deadline、1 item failureで他itemをrollbackしない。各itemは独立transaction / lock boundaryを持つ。

**REL-REC-003:** automatic repairは「current authorityから結果が一意」で「上流許可transition / constraintをそのまま使用」できる場合だけ実行する。

## 42. Canonical Reconciliation Matrix

| Target | Stuck threshold / cadence | Automatic repair | Detection only / Review |
|---|---|---|---|
| Order `PREPARED` | created 5分超、2分cadence | no-provider-call + resource expiryが明確なら上流terminal処理 | Checkout unknown / resource mismatch |
| Checkout Attempt `UNKNOWN` | immediate、1分cadence、30分max | same-key result / Binding recovery | 30分未解決 |
| Order `AWAITING_PAYMENT` | Payment Deadline + 5分、5分cadence | unpaid authoritativeならexpiry/release | paid + effect impossible |
| Order `REVIEW_REQUIRED` | 15分cadence、2時間 | authorityが一意なら上流許可transition | 2時間未解決 / conflict |
| Stripe Webhook `FAILED_RETRYABLE` | 1分cadence | same event reprocess | 30分 / 6 attempts exhausted |
| Stripe Webhook `REVIEW_REQUIRED` | 15分cadence | authorityだけで一意ならrepair | otherwise manual |
| Refund `REQUESTED/PENDING` | 2分cadence | provider state sync | mismatch / 6h unresolved |
| Refund `REVIEW_REQUIRED` | 30分cadence up to6h | safe authoritative transition | otherwise manual |
| Confirmed Order entitlement completeness | 5分cadence | **No** | missing Ticket / Reservation / Goods effectはCase |
| Ticket / Check-in consistency | 10分cadence | **No** | any atomicity mismatchはCase |
| Karaoke Hold expired | 1分cadence | unpaid certainty時release/expire | payment uncertainty |
| Reservation / Karaoke Ticket relation | 10分cadence | **No** | mismatchはCase |
| Goods Allocation / counter | 10分cadence | terminal HELD releaseだけ | aggregate mismatchはCase |
| Goods Handoff consistency | 10分cadence | already completed convergenceのみ | impossible stateはCase |
| Missing Notification Request | 5分cadence | deterministic補完 | context mismatch |
| Email `UNKNOWN_RESULT` | 15秒worker eligibility + §39 | same-key reconcile | 22h unresolved |
| Expired Email claim | 30秒cadence | §37 recovery | repeated crash budget exhausted |
| unmatched Resend webhook | 10分cadence | correlation foundならapply | 1h unresolved |
| QR key-version migration incomplete | 10分cadence | decrypt+rewrap可能rowのみ | decrypt / digest mismatch |

**REL-REC-004:** `CONFIRMED` Orderに必須Entitlementが欠落する状態は、本来atomic confirmation invariantに反するため、outside-transactionでEntitlementだけを自動生成して正常化しない。

**REL-REC-005:** Ticket `USED` / Check-in mismatch、Inventory aggregate mismatch等、history改ざんを伴う修復は自動化しない。

---

# Part XIV — Consistency Review Case

## 43. Case Reason Classification

`app.consistency_review_cases.reason_code`へ保存するcanonical reason codeを次とする。

```text
AUTH_PROFILE_RELATION_INCONSISTENT
ROLE_ADMIN_SET_INCONSISTENT
PAY_CHECKOUT_RESULT_UNRESOLVED
PAY_BINDING_INCONSISTENT
PAY_CONFIRMATION_INCONSISTENT
PAY_LATE_SUCCESS_RESOURCE_REUSED
REFUND_RESULT_UNRESOLVED
REFUND_DOMAIN_CANCELLATION_INCOMPLETE
WEBHOOK_CORRELATION_UNRESOLVED
TQR_TOKEN_CORRELATION_INCONSISTENT
TQR_KEY_MIGRATION_FAILED
TQR_CHECKIN_STATE_INCONSISTENT
KRK_HOLD_SLOT_INCONSISTENT
KRK_RESERVATION_TICKET_INCONSISTENT
GDS_INVENTORY_COUNTER_INCONSISTENT
GDS_HANDOFF_STATE_INCONSISTENT
EML_NOTIFICATION_CAUSE_INCONSISTENT
EML_PROVIDER_RESULT_UNRESOLVED
EML_RECIPIENT_RELATION_INCONSISTENT
EML_RENDER_CONTEXT_INVALID
EML_WEBHOOK_UNMATCHED
SECURITY_KEY_VERSION_INCONSISTENT
```

**REL-REC-006:** reason codeをDomain Stateとして使用しない。

## 44. Dedupe / Snapshot / Lifecycle

**REL-REC-007:** `dedupe_key`は同一incidentのretryで同じCaseへ収束するdeterministic keyとする。

Canonical form:

```text
r150:<reason_code>:<primary_entity_type>:<primary_public_ref>:<cause_discriminator>
```

`cause_discriminator`は既存immutable Business Cause、Provider Event ID、Refund Record ref、key version等、安全な一意原因を使う。Secret / raw QR / Emailは含めない。

**REL-REC-008:** `details`へ保存するcurrent state snapshotはallowlisted state、public refs、amount / currency、provider status category、timestampだけに限定する。provider raw body、Secret、full Email、raw QR、Internal IDを保存しない。

**REL-REC-009:** `resolved_at IS NULL`をunresolvedとし、Case自体をOrder / Notification等の正常stateへ混ぜない。

**REL-REC-010:** automated recoveryとmanual recoveryは対象Entityを同じlock orderで再取得し、Case作成時snapshotではなくcurrent stateをpreconditionにする。

**REL-REC-011:** Caseがstaleでcurrent stateが既に正規状態へ収束している場合、source stateを変更せずpost-verification後にCaseをresolveしてよい。

**REL-REC-012:** Case resolutionはsource historyを削除しない。Recovery成功後にAuthority + Domain Invariantを再検証してから`resolved_at`を設定する。

**REL-REC-013:** resolved後に別immutable causeで同種障害が再発した場合は新しい`cause_discriminator`で新Caseを作る。同じincidentのretryで新Caseを増やさない。

---

# Part XV — Manual Recovery Runbooks

## 45. Common Manual Recovery Rule

全manual recoveryは次を満たす。

- Actorはverified Administrator
- `recovery.review`でCase / current stateを参照
- mutationが必要なら`recovery.exception.execute`をoperation-specificに使用
- requestごとにcurrent Roleを再評価
- high-risk operationの既存confirmation UIを維持
- external provider call中にDB transactionをopenしない
- generic SQL editor / generic state editor / constraint disableを提供しない
- `Idempotency-Key`対応operationは同じkeyをresponse loss retryでも維持

**REL-ADM-001:** `recovery.exception.execute`は本章に列挙された明示Recoveryまたは上流で既に明示されたRecoveryだけへ適用する。

**REL-ADM-002:** Administrator / Staff mutationのHTTP response loss時は、同じTransport `Idempotency-Key`があるoperationではkeyを維持し、まず対象detail / current stateを再取得する。current stateが既に期待結果ならexisting resultへ収束し、成否不明のまま新key・別target・反対state mutationを自動送信しない。Idempotency-Keyを持たないCheck-in / Handoff等もDomain single-use / conditional transitionをauthorityとしてcurrent stateへ収束する。

## 46. Runbook — Stripe Checkout Unknown

- **Trigger:** Checkout Attempt `creation_result=UNKNOWN`が30分reconciliation後も未解決
- **Required Capability:** `recovery.review`; corrective mutationは`recovery.exception.execute`
- **Precondition:** Order `PREPARED` / `REVIEW_REQUIRED`、same Attempt / Stripe key特定済み
- **Authoritative sources:** Checkout Attempt、Order / Allocation / Hold current state、Stripe server lookup
- **Locks:** Order → Attempt → Allocation/Hold/Slot
- **Allowed action:** existing SessionをBindingして上流preconditionが成立する場合だけActive化、またはProvider非作成が明確ならAttempt failedへ確定
- **Forbidden:** unknownのままnew key / new Session、Hold再生成、Order再作成
- **Business Cause:** existing `(Order, Checkout Attempt)`
- **Success:** exactly 1 Active CheckoutまたはProvider非作成が明確な状態
- **Unknown behavior:** Case unresolved維持
- **Failure:** no mutation、current state保持
- **Post verification:** active Binding <=1、amount/currency一致、Karaoke時間条件一致
- **Case resolution:**上記Invariantが成立しunknownが消えたときのみ

専用Admin recovery mutationは現行`SPEC-110`に不足するため`UCR-150-001`を発行する。

## 47. Runbook — Payment Confirmation Mismatch

- **Trigger:** Stripe paidだがBusiness Confirmation未成立 / Order `REVIEW_REQUIRED`
- **Capability:** `recovery.review` + corrective mutation時`recovery.exception.execute`
- **Authority:** verified Stripe current Payment / Session、Payment Binding、Order snapshot、Allocation / Hold、Ticket / Reservation / Goods current state
- **Locks:** `SPEC-100` Payment Confirmation lock order
- **Allowed:**上流 `REVIEW_REQUIRED -> CONFIRMED` を同じBusiness Confirmation transactionで成立させる、または未支払が確定した場合のみ上流許可terminalへ進める
- **Forbidden:** terminal `CANCELED/EXPIRED/PAYMENT_FAILED -> CONFIRMED`、missing entitlementをtransaction外で個別生成、resource奪回
- **Success:** Orderと全mandatory effectが同一transactionで一致
- **Unknown:** unresolved Case
- **Post verification:** `INV-010-02/03/04/07/10`

専用Admin recovery mutationは`UCR-150-001`対象とする。

## 48. Runbook — Refund Unknown

- **Trigger:** Refund `REVIEW_REQUIRED` / 6時間reconciliation未解決
- **Capability:** `recovery.review` + `recovery.exception.execute`
- **Authority:** existing Refund Record、Order / Payment Binding、Stripe Refund current state
- **Locks:** Refund Record → Order、Domain cancellation時は対象Domain lock order
- **Allowed:** existing Refund Recordへprovider resultをcorrelateして`PENDING/SUCCEEDED/FAILED`へ上流許可transition
- **Forbidden:** 2件目Refund、別keyでfull refund、amount推測、financial success rollback
- **Idempotency:** existing Refund Business Cause / Stripe key
- **Success:** exactly 1 financial outcome safely correlated
- **Unknown:** no write retry、Case unresolved
- **Post verification:** no duplicate live full Refund、amount/currency一致

Result reconciliation専用operationは`UCR-150-001`対象とする。新規Refund開始自体は既存`API-ADM-PAY-001`を使用する。

## 49. Runbook — QR Token Compromise / Rotation

- **Trigger:** Token compromiseが確認済み、またはdecrypt failure rowの明示Recovery
- **Capability:** `recovery.exception.execute`
- **Authority:** Ticket current state、active Token relation、key version configuration
- **Locks:** Ticket row
- **Allowed:** existing `API-ADM-TQR-001`でActive Token revoke + new Token生成
- **Forbidden:** Ticket state / Owner変更、raw token表示、plaintext fallback
- **Success:** active Token exactly 1、新Token current key version、旧Token `REVOKED`
- **Unknown DB commit:** current Active Tokenを再読込し2回目rotationしない
- **Post verification:** old scan=`TOKEN_REVOKED`、new display可、Ticket history unchanged

## 50. Runbook — QR Cryptographic Migration Failure

- **Trigger:** old-version decrypt / digest validation failure
- **Capability:** `recovery.review`; token-specific replacementは`recovery.exception.execute`
- **Authority:** Secret store key versions、QR row metadata、Ticket current state
- **Allowed:** missing legitimate old keyを安全なSecret recoveryで復元後migration再実行、またはaffected Ticketへexisting QR rotationを明示実行
- **Forbidden:** unknown keyをcurrent keyでdecrypt、ciphertext無視、automatic new token、raw token export
- **Success:** affected active row current key versionへ正常化、または明示rotation済み
- **Post verification:** lookup digest / AEAD / Ticket correlation valid

## 51. Runbook — Karaoke Reservation Cancellation

- **Trigger:**上流Normal Cancellation causeを満たす運用上の取消
- **Capability:** `recovery.exception.execute`
- **Authority:** Reservation、Karaoke Ticket、Check-in current state
- **Locks:** Ticket → Reservation
- **Allowed:** existing `API-ADM-KRK-007`
- **Forbidden:** used Ticket cancellation、Slot `SOLD -> AVAILABLE`、Hold再利用
- **Success:** Reservation `CANCELED`、unused Ticket `CANCELED`、Slot `SOLD`
- **Response loss:** current state再読込しexisting cancellation resultを返す

## 52. Runbook — Notification Failed / Blocked

- **Trigger:** Notification `FAILED_RETRYABLE` + Job `BLOCKED`
- **Capability:** `recovery.review` + retry時`recovery.exception.execute`
- **Authority:** Notification / Job / Attempts、current verified recipient when allowed、source Business state
- **Allowed:** existing Admin notification retry with `SNAPSHOT`; `CURRENT_VERIFIED`は`SPEC-120`条件だけ
- **Forbidden:** source Business retry、`SENT` resend、`UNKNOWN_RESULT`中recipient変更
- **Success:** Job `READY` scheduled、または後続Provider Acceptanceで`SENT`
- **Failure:** `BLOCKED`維持

## 53. Runbook — Notification Unknown Result

- **Trigger:** Job `UNKNOWN_RESULT`、22時間automatic probe exhausted
- **Capability:** `recovery.review`; corrective reconciliation mutationは`recovery.exception.execute`
- **Authority:** same Attempt / provider key、Resend provider message correlation、verified webhook receipt
- **Allowed:** same provider resultをlocal persistenceへ反映
- **Forbidden:** new Provider key、recipient変更、blind resend、`SENT` overwrite
- **Success:** Acceptance確定→`SENT/CLOSED`、definitive non-acceptanceが安全に確認され上流が許せばretryable pathへ戻す
- **Unknown:** `BLOCKED` + Case unresolved

現行Admin APIにUnknown Result reconciliation commandが不足するため`UCR-150-001`対象とする。

## 54. Runbook — Missing Notification Request

- **Trigger:** committed source Eventにexpected Business Causeが存在しない
- **Capability:** automatic recovery。manual確認は`recovery.review`
- **Authority:** source Order / Reservation / Refund、Notification Type rule
- **Allowed:** deterministic `business_cause_key`でNotification Request / Jobのみ補完
- **Forbidden:** source transaction再実行、recipientをClient入力で設定
- **Success:** exactly 1 Notification Request / Jobが存在
- **Mismatch:** Case作成し自動補完しない

## 55. Runbook — Consistency Review Recovery

- **Trigger:** unresolved Case
- **Capability:** read=`recovery.review`;明示mutation=`recovery.exception.execute`
- **Precondition:** current source stateを再取得しCase snapshot依存で操作しない
- **Allowed:** Case reasonに対応する本書 /上流の専用Recoveryのみ
- **Forbidden:** mark-fixed only、generic state write、SQL editor、constraint disable
- **Success:** source Authority / Invariantを再検証した後`resolved_at`設定
- **Stale Case:** sourceが既に正規収束済みならmutationなしでresolve可
- **Case recurrence:**新immutable causeなら新Case

## 56. Runbook — Goods Inventory Adjustment / Counter Recovery

- **Trigger:** Inventory operational correctionが必要、または`GDS_INVENTORY_COUNTER_INCONSISTENT` Caseがopen
- **Required Capability:** 通常adjustmentは`goods_inventory.manage`; Consistency Reviewの参照は`recovery.review`
- **Precondition:** Goods / Inventory current rowを再取得し、held / committed Allocation集計とcurrent saleable capacityを確認
- **Authority:** `app.goods_inventory` current counters、Goods Allocation history、confirmed Goods Order Item / Handoff state
- **Locks:** Inventory rowをlockし、関連Allocationを必要な範囲で安定順序で参照
- **Allowed action:** 既存 `POST /api/v1/admin/goods/{goods_ref}/inventory-adjustments` が許可するcapacity adjustmentのみ。adjustment後も`held + committed <= capacity`を満たす
- **Forbidden:** held / committed counter直接編集、Refundだけを根拠に在庫回復、`COMPLETED` Handoffを取り消した扱いにする、allocation history削除
- **Idempotency:** Transport `Idempotency-Key` + current inventory precondition。response loss後はcurrent snapshotを再取得
- **Success:** capacity / held / committed invariant成立、existing allocation / sale history不変
- **Unknown result:**同keyでcurrent stateを再読込し、二重adjustmentを行わない
- **Failure:** counter aggregate自体が不整合ならadjustmentで隠さずCase unresolved維持
- **Post-recovery verification:** allocation aggregate、capacity constraint、Goods Order Item / Handoff整合を再照合
- **Consistency Review resolution:** 原因がcapacity設定だけであり、aggregate historyに矛盾がないことを確認できた場合のみ

## 57. Runbook — Last Administrator Emergency Recovery

§20を使用する。通常`role_assignment.manage` UIからself grant / last-admin revoke protectionを回避しない。

---

# Part XVI — Security Failure Interaction

## 58. Security Failure Matrix

| Failure | Reliability behavior | Forbidden fallback |
|---|---|---|
| Auth verification unavailable | 2 remote attempts内で回復しなければ503 | decode-only JWT |
| Role resolution unavailable | privileged operation停止 | cached Admin Role |
| DB unavailable | mutation停止、Provider write開始禁止 | Client cache authority |
| Webhook signature invalid | 400、Business retry対象外 | unsigned acceptance |
| CSRF failure | 403、mutation未実行 | retry時CSRF skip |
| CORS origin failure | request reject | wildcard credential fallback |
| rate limit exceeded | 429、Domain state unchanged | limiter off / unlimited |
| QR key unavailable | display / scan / migration Fail Closed | plaintext fallback |
| required Secret missing | service not Ready | feature-specific verification bypass |
| Security config invalid | service not Ready | warning-only startup |
| key rotation incomplete | affected operation Fail Closed + reconciliation | unknown key fallback |

**REL-SEC-001:** Security control failureは`SECURITY_FAILURE`として分類し、Security control自体の回復後に元Operationを最初からcurrent authorizationで再評価する。

**REL-SEC-002:** Security failure中に「可用性維持」のためcredential expiry、signature、CSRF、CORS、Role、QR crypto、rate limitをskipしない。

---

# Part XVII — Graceful Degradation

## 59. Dependency Degraded Behavior

| Dependency outage | 利用可能 | 停止 / fail closed |
|---|---|---|
| Supabase Auth | 公開情報read。既にBrowserへ表示済み非secret static UI | protected owner read / purchase / Admin / Staff mutation |
| Business Database |静的公開asset / error page | Order / purchase / status authority / Check-in / Refund / Handoff / Admin mutation |
| Stripe | existing confirmed Business Database read、Ticket display/check-inはDB/QR条件が成立する限り可 | new Checkout、payment-dependent cancel確定、new Refund |
| Resend | Purchase / Reservation / Ticket / Refund本体は継続 | Email sendのみqueue / failed stateへ |
| QR key | QRを必要としないowner order/history read | QR display、QR scan、QR rotation / migration |
| reconciliation worker | foreground safe operationは継続 | stuck自動修復。既存stateは保持しmanual reviewへ |

**REL-GEN-009:** DB unavailable時、Browser / Next.js cacheを購入、Check-in、Refund、Role、InventoryのAuthorityにしない。

**REL-GEN-010:** Resend障害を理由に確定済みBusiness Transactionをrollbackしない。

---

# Part XVIII — Reliability Outcome → UX Boundary

## 60. Canonical UX Classification

HTTP status / error envelope自体は`SPEC-110`を変更しない。Backend reliability resultをUIへ次の意味で渡す。

| UX class | 意味 | User / Operator action |
|---|---|---|
| `retry_now` | temporaryでsame Cause retryが安全 | same Idempotency-Keyで再試行 |
| `retry_later` | provider / dependency一時障害 | current state保持、時間を置く |
| `reload_current_state` | commit / response loss可能性 | status/detail再取得 |
| `already_completed` | prior requestが既にcommit | existing result表示 |
| `conflict` | concurrent winnerが存在 | current state表示、新side effect禁止 |
| `pending` |正常な外部結果待ち | status read |
| `result_unknown` |Provider / commit結果未確定 | blind retry禁止 |
| `consistency_review_required` |自動解決危険 | Admin review |
| `manual_recovery_required` | automatic budget / safe window exhausted | Runbook実行 |
| `permanent_failure` |原因修復なしでは再試行不可 |修正 / 新Business Attempt |

**REL-UX-001:** `result_unknown`をsuccess toast / failed badgeへ変換しない。

**REL-UX-002:** `already_completed`はduplicate side effectを新規実行せず、current authoritative resultを表示する。

**REL-UX-003:** Security failureのdetailへSecret、raw QR、full Email、SQL / provider raw bodyを出さない。

---

# Part XIX — Recovery Success / Failure Criteria

## 61. Success Criteria

Recoveryは少なくとも次を満たした場合だけ成功とする。

1. current authorization / security controlが成立
2. authoritative Provider / Business Database stateが取得済み
3.同じBusiness Causeへ収束
4. duplicate Provider side effectなし
5.上流Domain State transitionだけを使用
6. DB unique / exclusion / conditional update invariant成立
7.必要なcurrent stateをpost-recoveryで再read
8. unresolved Consistency Reviewがある場合はresolution condition成立後のみresolve

## 62. Failure Criteria

次のいずれかでautomatic recoveryを終了する。

- max automatic attempts exhausted
- max elapsed time exhausted
- Provider safe window到達前の保守的cutoff
- Security controlを安全に評価不能
- current stateがCase snapshotと異なりprecondition不成立
- duplicate side effect可能性を排除不能
- authority同士が矛盾
-上流で禁止されたstate transitionが必要
- required Secret / key materialが欠損

**REL-REC-014:** automatic recovery failure後もsource dataを削除せず、必要なCaseを作成してmanual boundaryへ移す。

---

# Part XX — Observability Handoff to SPEC-160

## 63. SPEC-160が観測可能でなければならない意味

SPEC-160は少なくとも次のReliability semanticを観測可能にする。

- failure class (`TEMPORARY`, `UNKNOWN`, `CONSISTENCY`, `SECURITY`等)
- retry scheduled / attempted / exhausted
- DB `40001` / `40P01` retry exhaustion
- pool acquire / statement / lock timeout
- Provider call timeout / result unknown
- Checkout Attempt unknown / recovered / reviewへ移行
- Payment Confirmation recovery成功 /失敗
- Refund result unknown / reconciled / review
- verified Webhook duplicate / retryable / review
- Check-in response loss後existing result convergence
- Karaoke expired Hold cleanup / payment-uncertain Hold
- Goods allocation / counter inconsistency
- Notification missing generation repair
- Email claim expiry / worker repeated crash
- Resend Unknown Result same-key recovery / 22h cutoff
- Consistency Review created / resolved / stale / recurrence
- manual recovery開始 /成功 /失敗
- Security Fail Closedによるoperation停止

ただしlog schema、metric名、label、alert rule、retention、Audit Event schema、correlation field taxonomyは`SPEC-160`がCanonical Ownerである。

**REL-REC-015:** SPEC-160の観測要件を満たすためにSecret、raw QR、Password、token、full Email、不要なPIIをlogへ追加してはならない。

---

# Part XXI — Traceability

## 64. System Invariant Traceability

| Invariant | Reliability protection |
|---|---|
| `INV-010-01` Purchase情報を失わない | Order先行永続化、commit unknown照合、Review保持 |
| `INV-010-02` Order二重確定禁止 | Business Cause、Order lock、confirmation retry |
| `INV-010-03` Ticket二重発行禁止 | issuance unique、confirmed effect completeness review |
| `INV-010-04` Karaoke二重販売禁止 | Hold/Slot lock、unknown payment時release禁止、no resale |
| `INV-010-05` QR二重利用禁止 | Ticket consume-once、response loss convergence |
| `INV-010-06` Email failureでRollback禁止 | Notification-only retry |
| `INV-010-07` Payment / entitlement部分確定禁止 | atomic Business Confirmation、Review boundary |
| `INV-010-08` Server-side ownership / role | Auth Fail Closed、current role re-evaluation |
| `INV-010-09` Client amount非Authority | recoveryでもOrder snapshot / provider exact compare |
| `INV-010-10` external retry耐性 | Provider key、Webhook dedupe、retry budget |

## 65. Upstream Rule Trace

| Reliability group | Primary upstream trace |
|---|---|
| `REL-AUTH-*` | `FR-AUTH-*`, relevant `FR-ADM-*`,`FR-STF-*`, `AR-*`, `SEC-AUTH-*`,`SEC-AZ-*` |
| `REL-PAY-*` | Payment / Ticket / Karaoke / Goods `FR-*`, `BR-ORD-*`, relevant `DI-030-*`, `PAY-CHK-*`,`PAY-WHK-*`,`PAY-CFM-*`,`API-ORD-*`,`DB-PAY-*` |
| `REL-RFD-*` | `FR-ADM-*`,`FR-XFN-*`, `PAY-RFD-*`, `API-ADM-PAY-001`, `DB-PAY-006〜007` |
| `REL-TQR-*` | Ticket / Staff `FR-*`, `BR-CHK-*`, `TQR-*`, `API-*CHECKIN*`, `DB-TQR-*`, `SEC-QR-*` |
| `REL-KRK-*` | `FR-KRK-*`, `BR-KRK-*`, `KRK-*`, `API-ADM-KRK-*`, `DB-KRK-*` |
| `REL-GDS-*` | `FR-GDS-*`,`FR-STF-*`,`FR-ADM-*`, `BR-GDS-*`, Goods API/DB rules |
| `REL-EML-*` | `FR-EML-*`, `BR-NTF-*`, `EML-*`, `API-ADM-EML-*`, email support tables, `SEC-EML-*` |
| `REL-WHK-*` | `PAY-WHK-*`, Resend webhook `EML-*`, `API-WHK-*`, `SEC-PAY-*`,`SEC-EML-*` |
| `REL-REC-*` | `BR-ORD-010`, relevant `DI-030-*`, `DB-XFN-002〜003`, `API-REC-001`, `PG-ADM-022〜023`, `ADM-REC-*` |
| `REL-ADM-*` | `AR-ROLE-014`, `PG-ADM-*`, `ADM-*`, `OPS-*`, existing explicit recovery endpoints |
| `REL-SEC-*` | `SEC-ERR-004〜006`, `SEC-KEY-*`, `SEC-ABU-*`, `SEC-PAY-*`, `SEC-QR-*` |

---

# Part XXII — Reliability Acceptance Criteria

## 66. Acceptance Criteria

実装は少なくとも以下を満たさなければならない。

1. Failure class 7種類をDomain Stateと混同しない。
2. Auth remote call 3秒、DB acquire 2秒、normal statement 5秒、lock 1秒、Stripe 10秒等のsystem-side deadlineが実装される。
3. `40001` / `40P01`を本書回数 / backoffで同Business Cause retryする。
4. constraint violationをblind retryしない。
5. DB commit acknowledgement loss時にnew Business Causeを作らない。
6. Stripe Checkout unknownでsame Attempt / same keyを維持する。
7. unknownのまま別Checkout Sessionを発行しない。
8. Active Checkoutが最大1件へ収束する。
9. Browser success redirectだけでOrderをconfirmしない。
10. verified Webhook duplicateでBusiness effectを再実行しない。
11. Payment paid + internal failureでEntitlementを推測生成しない。
12. Refund unknownで2件目Refundを発行しない。
13. Refund financial successとDomain cancellation failureを分離する。
14. QR初回parallel provisionでActive Tokenが最大1件になる。
15. QR display response lossで自動rotationしない。
16. QR rotation response lossで2回目rotationを自動実行しない。
17. QR key missing時にplaintext fallbackしない。
18. Check-in commit後response lossはexisting Check-inへ収束する。
19. Entry / Karaoke Check-inを2回成立させない。
20. Karaoke Hold expiry workerが1分cadenceで動作し、payment uncertainty時はreleaseしない。
21. late paidでreused Slotを奪い返さない。
22. canceled ReservationのSlotを`AVAILABLE`へ戻さない。
23. Goods retryで在庫を二重減算 / 二重回復しない。
24. Handoff response lossで2回目completionを作らない。
25. Email worker cadence 15秒、claim lease 120秒、expiry sweep 30秒を実装する。
26. Resend 429とUnknown Resultを別policyに分類する。
27. Resend timeout / 5xxでnew provider keyを発行しない。
28. Resend Unknown Resultを22時間でautomatic停止し、23時間cutoffを超えてblind resendしない。
29. Notification retryで元Business Transactionを再実行しない。
30. missing Notification Requestを5分cadenceでdeterministicに補完できる。
31. `SENT` Notificationをblind resendしない。
32. Stripe / Resend webhook signature invalidをretryable Business failureにしない。
33. Security Fail ClosedをAvailability都合でskipしない。
34. cached Administrator RoleをAuth / DB outage fallbackにしない。
35. rate limiter failureをunlimitedへ切り替えない。
36. Business Database unavailable時にClient cacheをAuthorityにしない。
37. Consistency Review `dedupe_key`で同incident Caseを重複作成しない。
38. Review detailsにSecret / raw QR / full Email / provider raw bodyを保存しない。
39. Case resolution前にpost-recovery authority / invariantを再検証する。
40. `recovery.exception.execute`がgeneric SQL / state editorを提供しない。
41. last Administrator emergency recoveryが通常Role Assignment APIと分離される。
42. UCR-130-001〜006を反映済みとして実装しない。
43. automatic repair対象とdetection-only対象が§42のmatrixどおり分離される。
44. confirmed Order entitlement mismatchをoutside-transactionでblind repairしない。
45. retry storm防止としてnested automatic retryが最大1層になる。
46. Client `request_id`をIdempotency Authorityにしない。
47. manual recoveryはcurrent stateを再読込してpreconditionを再評価する。
48. Recovery failureでも既存確定historyを削除しない。
49. SPEC-160が観測可能なReliability semanticをemit可能にするがlog / audit schemaを本書で固定しない。
50. `INV-010-01〜10`、関連`FR-*`、`BR-*`、`DI-030-*`、`AR-*`、`PAY-*`、`TQR-*`、`KRK-*`、`DB-*`、`API-*`、`EML-*`、`ADM-*` / `STF-*` / `OPS-*`、`SEC-*`へ追跡できる。

---

# Part XXIII — Upstream Change Requests

## 67. 上流仕様変更要求

### UCR-150-001

- 対象: `SPEC-110 API Specification`
- 現在の仕様: `API-ADM-REC-001〜002` はConsistency Review readのみを提供し、既存の明示mutationはRefund開始、QR token rotation、Karaoke Normal Cancellation、Notification retry / cancel等に限られる。Checkout Attempt Unknownの再照合、Payment Confirmation mismatchの専用recovery、Refund Result Unknownの結果再照合、Email Unknown Provider Resultの結果反映をAdministratorが明示的に実行するdedicated server operationが定義されていない。
- 要求する変更: `/api/v1/admin`へ、`recovery.exception.execute`を使用する**対象別・precondition固定のRecovery command**を追加する。少なくともCheckout Attempt result reconcile、Order Payment Confirmation reconcile、Refund Result reconcile、Notification Unknown Provider Result reconcile、Consistency Review case re-evaluate / post-verification resolutionの意味を持つoperationをCanonical化する。generic state inputを受けず、arbitrary SQLを受けず、same Business Cause / Provider keyを維持し、current authorityをserver-side取得し、15秒request deadlineを適用し、result unknownをsuccessにせず、raw provider bodyをresponseへ返さないことを最低条件とする。
- 理由: SPEC-150が要求するAdministrator manual recoveryを、Browser direct DB accessや運用者による手作業SQLなしでHono APIへ集約するため。
- 変更しない場合の影響: automated reconciliationで解消不能なCheckout / Payment / Refund / Email Unknown Resultはread-only reviewまでしかapplication UIから実行できず、本書のmanual recoveryを完成システムとして実装できない。
- 影響を受ける可能性がある仕様書: `SPEC-130`, `SPEC-140`, `SPEC-160`, `SPEC-170`, `SPEC-180`, `SPEC-200`

### UCR-150-002

- 対象: `SPEC-130 Admin / Staff Specification`
- 現在の仕様: `PG-ADM-023` は既存明示Recovery Actionだけを表示し、Checkout / Payment / Refund-result / Email Unknown-resultの新しいdedicated recovery commandは存在しない。加えて `UCR-130-001〜006` は未反映であり、本要求はそれらが反映済みであることを前提としない。
- 要求する変更: `UCR-150-001` が `SPEC-110` へCanonical化された場合に限り、`PG-ADM-023` および関連Order / Notification detailへ、そこでCanonical化されたoperationだけをcurrent precondition・required capability・confirmation・pending / unknown result表示付きで接続する。generic recovery buttonは追加しない。
- 理由: manual recoveryをBrowser cacheやprovider dashboardの手作業だけに依存させず、既存Admin UX / authorization境界から安全に実行可能にするため。
- 変更しない場合の影響: Recovery Runbookの一部がapplication UIから実行不能となり、`recovery.exception.execute`の明示operation化が不完全になる。
- 影響を受ける可能性がある仕様書: `SPEC-110`, `SPEC-140`, `SPEC-160`, `SPEC-170`, `SPEC-200`

---

## 68. 最終確認

本仕様は次を意図的に行っていない。

- System Boundaryの変更
- Browser / Next.js WebからBusiness Databaseへの直接更新
- Domain State追加
- Payment / Refund / QR / Notification state machineの再定義
- Provider Result Unknownの成功扱い
- unknown Checkoutで別idempotency key発行
- unknown Refundでduplicate Refund発行
- Webhook signature validation skip
- Ticket / Check-in / Handoff重複成立
- Karaoke sold Slotの再販売
- Notification retryによる元Business Transaction retry
- Resend Unknown Resultでnew Provider key blind resend
- Security Fail Closedの弱化
- `recovery.exception.execute`のgeneric bypass化
- `UCR-130-001〜006`の反映済み仮定
- Audit Event schema / metric / alert taxonomyの先取り
