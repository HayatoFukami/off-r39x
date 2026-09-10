---
spec_id: SPEC-160
title: Observability and Audit Log
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
  - SPEC-150
related_specs:
  - SPEC-040
  - SPEC-050
  - SPEC-170
  - SPEC-180
  - SPEC-200
---

# 160 Observability / Audit Log

## 1. 目的

本書は、**off r39'x in 大阪らへん2027** Webシステムの完成形におけるApplication Log、Metric、Dashboard、Alert、Audit Event、Request / Operation / Business Cause Correlation、Security / Reliability observability、Retention、Redaction、Sampling、およびIncident Investigation contractを定義する。

本書は **Application Log / Metric / Alert / Audit Event / Correlation / Observability ContractのCanonical Owner** である。

本書は上流Canonical Ownerが定義したDomain State、API endpoint、Database schema、Authentication / Authorization、Payment / Refund lifecycle、QR format、Notification lifecycle、Administrator / Staff operation、Security Control、Reliability / Retry / Reconciliation / Recovery ruleを変更しない。Observability都合で次を行ってはならない。

- `request_id` をBusiness CauseまたはIdempotency Authorityへ昇格する。
- retry回数、timeout、backoff、reconciliation cadence、Recovery Runbookを再定義する。
- Provider Result Unknownを成功または失敗へ推測する。
- Application LogやMetricをBusiness DatabaseのSystem of Recordへ昇格する。
- raw QR、Credential、Secret、不要なPIIを「調査のため」という理由で記録する。
- Audit Event欠落を通常Application Logで代替する。
- Security Fail ClosedをAvailability向上のためskipする。
- `recovery.exception.execute` をgeneric superuser、任意state editor、任意SQL実行権限として扱う。
- `UCR-130-001〜006`、`UCR-150-001〜002`を反映済みと仮定する。

本書はMVP、Step1、Step2等の実装フェーズでObservabilityを分断しない。長期運用される完成システムを対象とする。

---

## 2. 適用範囲

本書は次へ適用する。

- Next.js Web / Vercel
- Hono API / Railway
- Supabase Authとのserver-side verification / lookup
- Supabase PostgreSQL / Drizzle ORM / `pg`
- Stripe Checkout / Payment / Refund / Stripe Webhook
- Entry Ticket / Karaoke Ticket / QR / Check-in
- Karaoke Slot / Hold / Reservation
- Goods / Inventory / Allocation / Handoff
- Notification Request / Email Delivery Job / Delivery Attempt / Resend
- Resend Webhook
- Administrator / Staff privileged operation
- scheduled reconciliation / automatic repair / stuck detection
- Consistency Review / manual recovery
- Security Fail Closed / abuse / configuration failure
- Audit Event persistenceとAudit data access
- incident investigationに必要なcorrelation

本書は次をCanonicalには定義しない。

- Monitoring SaaS、log backend、metric backend、collector、agent、dashboard製品の選定
- Vercel / Railway / Supabase / external observability productのdeployment wiring
- scheduler製品、alert delivery product、on-call destinationの具体設定
- Provider自身のSLA、log保存保証、monitoring productの保証値
- retry / reconciliation cadence / Recovery Runbookそのもの

これらのInfrastructure具体化は `SPEC-180` が担当する。ただし、何をどのfield、metric、Audit Event、alert conditionとして観測するかは本書で固定する。

---

## 3. 依存仕様と採用理由

| Spec | 本書が直接利用するCanonical contract |
|---|---|
| `SPEC-000` | Canonical Owner、`depends_on`、情報源優先順位、Upstream Change Request、AI実装容易性、1ファイル1チャット |
| `SPEC-010` | System Boundary、System of Record、Actor、`INV-010-01〜10` |
| `SPEC-020` | `FR-AUTH-*`、Payment / Ticket / Karaoke / Goods、`FR-EML-*`、`FR-ADM-*`、`FR-STF-*`、`FR-XFN-*` |
| `SPEC-030` | Domain Entity / State / Business Rule / `DI-030-*`、Consistency Review Caseの意味 |
| `SPEC-060` | Authentication / Authorization、Role / Capability、last Administrator protection、`recovery.exception.execute`境界 |
| `SPEC-070` | Checkout Attempt、Payment Binding、Stripe Webhook、Refund、Provider Result Unknown、Business Cause |
| `SPEC-080` | Ticket / QR / Check-in、QR Token保護、single-use / conflict loser |
| `SPEC-090` | Karaoke Slot / Hold / Reservation、期限・no-resale・time predicate |
| `SPEC-100` | physical schema、Public Reference、Payment / Webhook / Refund / Review persistence、§44 Audit persistence delegation |
| `SPEC-110` | API Operation ID、`request_id`、HTTP error、idempotency、Admin / Staff server operation |
| `SPEC-120` | Notification / Email Job / Attempt / Resend idempotency / webhook / Unknown Result |
| `SPEC-130` | Admin / Staff operation、Audit-ready context、Recovery UI、未反映 `UCR-130-001〜006` |
| `SPEC-140` | Secret / PII / raw QR redaction、Provider data boundary、Security Fail Closed、abuse control |
| `SPEC-150` | failure class、timeout、retry、reconciliation、stuck、Consistency Review、Recovery Runbook、未反映 `UCR-150-001〜002` |

`SPEC-040` / `SPEC-050` はUser Flow /一般利用者Pageのincident contextとして関連するが、Observability contractの直接定義元ではないため `related_specs` とする。

### 3.1 未反映UCRの扱い

`UCR-130-001〜006` および `UCR-150-001〜002` は本書作成時点で未反映として扱う。

- UCRだけに存在するCapability、API、Admin UIを既存Canonical operationとして記録しない。
- 現在存在するOperation IDには本書のAudit / Log contractを適用する。
- 将来上流Canonical Ownerへ追加された明示Recovery command、Admin read / mutationにも、本書の同一Audit / Log / Metric contractを適用する。
- `recovery.exception.execute` を理由に、未存在のgeneric recovery operationを本書から新設しない。

### 3.2 Audit tableの委譲

`SPEC-100 §44 Audit persistence boundary` は、generic audit tableを先取りせず、**SPEC-160が後方互換migrationで専用append-only audit tableを追加する**ことを明示している。本書の `app.audit_events` はこの限定委譲に基づく。その他の既存Business tableのState / Column / Constraintを本書から変更しない。

---

## 4. Canonical Terms

| Term | 意味 |
|---|---|
| Application Log | runtime diagnosis、request processing、dependency、retry、performance、worker execution等を追跡するmachine-readable event |
| Audit Event | 誰が、どの権限で、どのServer operationを、何へ実行し、認可・precondition・Business effectがどうなったかをappend-onlyで記録するsecurity / operational record |
| Metric | bounded-cardinality labelで集約されるCounter / Histogram / Gauge |
| Alert | Metricまたはbounded event aggregateが本書の条件を満たしたことを運用者へ通知可能にするsignal |
| `request_id` | 1 HTTP requestのcorrelation ID。Business Cause / Idempotency Authorityではない |
| Operation ID | `SPEC-110` のAPI Operation ID、または本書で定義するbounded internal operation key |
| Operation Execution ID | 1回のserver operation / worker item実行を表すUUID。retryごとに別値 |
| Business Cause | 上流仕様が定義する、同じDomain effectを最大1回へ収束させる原因 |
| Correlation Fingerprint | replay可能なIdempotency Key等をrawで記録せず安全に同一性だけ確認するHMAC fingerprint |
| Provider Reference | Stripe / Resendのallowlisted non-secret operational identifier |
| Consistency Review Reference | `app.consistency_review_cases.public_ref` |
| Recovery Execution ID | 1回のautomatic / manual recovery executionを一意に識別するUUID |
| Security Event | Security Controlの拒否、Fail Closed、abuse、configuration failure等を表す観測event |
| Observability Failure | log sink、metric exporter、Audit persistence、alert delivery、dashboard等の観測component自身のfailure |

---

## 5. Rule ID体系

| Prefix | Category |
|---|---|
| `OBS-GEN-*` | Observability general / architecture |
| `OBS-LOG-*` | Structured Application Log |
| `OBS-COR-*` | Request / operation / business / provider correlation |
| `OBS-AUD-*` | Audit Event / persistence / access |
| `OBS-MET-*` | Metric / cardinality |
| `OBS-ALT-*` | Alert / noise control |
| `OBS-DB-*` | Database observability |
| `OBS-AUTH-*` | Authentication / Authorization observability |
| `OBS-PAY-*` | Stripe / Payment / Refund observability |
| `OBS-TQR-*` | Ticket / QR / Check-in observability |
| `OBS-KRK-*` | Karaoke observability |
| `OBS-GDS-*` | Goods / Inventory / Handoff observability |
| `OBS-EML-*` | Notification / Resend observability |
| `OBS-WHK-*` | Webhook observability |
| `OBS-REC-*` | Retry / reconciliation / recovery observability |
| `OBS-SEC-*` | Security / redaction / sampling / environment |

同一Rule IDを別の意味へ再利用してはならない。

---

# Part I — Observability Architecture

## 6. Observability Objective

**OBS-GEN-001:** Observabilityは、System of Recordを置換せず、Business Database / Provider Authority / Auth Authorityのcurrent stateとevent historyを安全に調査できる補助契約として実装する。

**OBS-GEN-002:** 1つのincidentについて、少なくとも `request_id`、Operation ID、Business Cause、target Public Reference、Provider Reference、Consistency Review Reference、Recovery Execution IDの該当値を辿れる構造にする。

**OBS-GEN-003:** Observabilityのためのside effectがBusiness invariantを弱化してはならない。Security / authorization / signature / DB constraintをskipしてlogだけ成功させるfallbackは禁止する。

**OBS-GEN-004:** Application Log、Metric、Audit Eventは用途を分離する。Metricはaggregation、Application Logはruntime diagnosis、Audit Eventはprivileged / security-sensitive Business operationの長期追跡を担う。

**OBS-GEN-005:** Observability dataはProduction / nonproductionで物理またはlogical datasetを分離し、Production dataをdevelopment datasetへ複製しない。

**OBS-GEN-006:** ProviderのSLAや外部monitoring productの保存保証を本仕様の保証値として扱わない。本書のretention値は本システム側の運用policyである。

## 7. Logical emission points

Canonical emission pointを次とする。

1. HTTP request context確立時
2. Authentication / Principal resolution完了時
3. authorization / ownership / capability判定時
4. Server operation開始・終了時
5. DB transaction / statement / lock / retry時
6. Provider request開始前・結果判定後
7. Webhook署名判定・receipt dedupe・processing完了時
8. Domain effect commit後
9. worker claim / attempt / release / stuck判定時
10. reconciliation item開始・結果判定時
11. Consistency Review open / dedupe / resolve / recurrence時
12. automatic / manual recovery開始・終了時
13. Security Fail Closed / configuration failure時
14. Audit Event persistence時

Applicationコードは各layerで自由文を出すのではなく、本書のevent schemaを通す。

---

# Part II — Correlation Contract

## 8. `request_id`

`SPEC-110` の規則を維持する。

- 型: UUID string
- HTTP requestでは必須
- incoming `X-Request-Id` がcanonical UUIDなら採用可能
- 欠落 / 無効ならHono APIが生成
- response `X-Request-Id` とerror envelopeの `request_id` と一致
- background workerでは原則 `null`
- Next.js WebがBrowser requestを起点にHono APIを呼ぶ場合、Webは有効な既存UUIDを引き継ぐか新規UUIDを生成して `X-Request-Id` としてforwardし、Hono APIのvalidationを受ける。同じ論理HTTP chainのWeb/API logは同じ `request_id` で相関可能にする。

**OBS-COR-001:** `request_id` はcorrelation専用であり、Business Cause、Transport Idempotency Key、Provider Idempotency Key、DB unique authorityへ使用しない。

## 9. Operation correlation

### 9.1 `operation_id`

- API: `SPEC-110` の `API-*` Operation IDをexactに使用する。
- Resend Admin API: `SPEC-120` が定義した `API-ADM-EML-*` を使用する。
- 非HTTP内部処理は次のbounded internal keyだけを使用する。

```text
WORKER.EMAIL.DELIVERY
WORKER.EMAIL.CLAIM_RECOVERY
WORKER.KARAOKE.HOLD_EXPIRY
RECON.ORDER.PREPARED
RECON.CHECKOUT.UNKNOWN
RECON.ORDER.AWAITING_PAYMENT
RECON.ORDER.REVIEW_REQUIRED
RECON.STRIPE_WEBHOOK
RECON.REFUND
RECON.ENTITLEMENT_COMPLETENESS
RECON.TICKET_CHECKIN
RECON.KARAOKE_RELATION
RECON.GOODS_INVENTORY
RECON.GOODS_HANDOFF
RECON.NOTIFICATION_MISSING
RECON.RESEND_UNKNOWN
RECON.RESEND_WEBHOOK
RECON.QR_KEY_MIGRATION
RECOVERY.AUTOMATIC
RECOVERY.MANUAL
RECOVERY.ADMIN_BOOTSTRAP
```

**OBS-COR-002:** internal keyはAPI contractを新設するものではない。Metric / Logでbounded operationを識別するためだけに使用する。

### 9.2 `operation_execution_id`

- 型: UUIDv4
- 各server operation / worker item / reconciliation item開始時に生成
- 同一HTTP request内でも複数independent operationがあれば別ID
- retry attemptごとに新しいexecution ID
- Business Causeはretryで維持

**OBS-COR-003:** `operation_execution_id` をretry authorityにしない。

## 10. Business Cause correlation

上流でBusiness Cause / Business Cause Keyが永続化される処理では、safeな既存UUID / Public Referenceを `business_cause_ref` として記録する。

- 型: string, 1..128
- UUIDの場合はcanonical lowercase
- raw keyがSecret / replay可能値の場合は直接記録せず§11のfingerprintを使う
- Business Causeが存在しないpure readでは `null`

**OBS-COR-004:** Application Logが新しいBusiness Causeを生成してはならない。

## 11. Idempotency Keyの安全なfingerprint

Transport `Idempotency-Key`、Stripe idempotency key、Resend Provider Idempotency Keyは通常log / Audit Eventへrawで保存しない。

Canonical fingerprint:

```text
HMAC-SHA-256(key = OBS_CORRELATION_HMAC_KEY,
            message = <domain> || 0x00 || UTF8(raw_value))
truncate first 16 bytes
lowercase hex encode
```

出力は32文字のlowercase hexとする。

Domain separation string:

```text
r39x/obs/v1/transport-idempotency
r39x/obs/v1/stripe-idempotency
r39x/obs/v1/resend-idempotency
r39x/obs/v1/network-source
r39x/obs/v1/auth-subject
```

`OBS_CORRELATION_HMAC_KEY` はProduction / nonproductionで別keyを使用し、Secretとして `SPEC-140` のkey managementへ従う。raw input、HMAC key、intermediate digestをlogしない。

Fields:

- `transport_idempotency_fp`
- `provider_idempotency_fp`
- `correlation_key_version`

`correlation_key_version` はbounded integerであり、Secretではない。

**OBS-COR-005:** fingerprintは同一値のcorrelationにのみ使用し、認可、Idempotency判定、Provider retry authority、Business Cause生成に使用しない。

**OBS-COR-006:** fingerprint key rotation後、過去fingerprintを再計算するためraw idempotency keyを保存してはならない。cross-version correlationが必要なBusiness recordでは既存DB relationを使用する。

## 12. Provider correlation

Application Log / Audit Eventのrestricted datasetでは、既に上流DBへ永続化される次のProvider identifierをexact valueで記録してよい。

### Stripe

- Stripe Event ID
- Checkout Session ID
- PaymentIntent ID
- Charge ID
- Refund ID

### Resend / Svix

- Resend provider message ID
- verified `svix-id` / provider event key

禁止:

- Stripe secret key / webhook signing secret
- Payment Method secret、card number、CVC
- provider response body全文
- raw webhook body
- Resend API key / webhook secret

**OBS-COR-007:** Provider Referenceはlog / auditのdrill-down用であり、Metric label、alert grouping key、Client-facing error detailへ使用しない。

**OBS-COR-008:** Provider identifierが未確定のUnknown Resultでは、存在を推測せず `null` とし、Checkout Attempt / Refund Record / Email Delivery AttemptのPublic Referenceで追跡する。

## 13. Consistency / Recovery correlation

- `consistency_review_ref`: `app.consistency_review_cases.public_ref`
- `recovery_execution_id`: UUIDv4、manual / automatic recovery 1実行につき1件
- `recovery_kind`: bounded enum / operation-specific key

同一Caseを再評価する複数Recoveryは別 `recovery_execution_id` を持つ。

**OBS-COR-009:** resolved Caseの再発が `SPEC-150` 上別immutable causeで新Caseになる場合、observabilityも新Case refへ切り替え、過去Caseを上書きしない。

---

# Part III — Structured Application Log

## 14. Log serialization

Application Logは1 event = 1 JSON objectのstructured logとする。

- UTF-8
- timestampはUTC RFC 3339 milliseconds (`YYYY-MM-DDTHH:mm:ss.sssZ`)
- field名は `snake_case`
- `null` とfield欠落をschema上区別する
- free-form multiline messageをPrimary contractにしない
- event-specific fieldはZod等のruntime schemaでallowlist validationする

**OBS-LOG-001:** Production Application Logへrequest body / response bodyを自動dumpするmiddlewareを使用しない。

**OBS-LOG-002:** SQL全文、bind parameter、JWT payload全文、provider error object全文を自動serializeしない。

## 15. Common log fields

| Field | Type | Required | Rule |
|---|---|---:|---|
| `timestamp` | RFC3339 string | Yes | UTC milliseconds |
| `level` | `DEBUG\|INFO\|WARN\|ERROR` | Yes | §17 |
| `event_name` | string | Yes | §16 naming、3..96 chars |
| `service` | enum | Yes | `WEB\|API\|EMAIL_WORKER\|RECONCILIATION_WORKER\|RECOVERY` |
| `environment` | enum | Yes | `production\|staging\|development\|test` |
| `deployment_ref` | string/null | No | deployment release identifier、Secret禁止 |
| `request_id` | UUID/null | Conditional | HTTP requestでは必須 |
| `operation_id` | string/null | Conditional | server operationが存在すれば必須 |
| `operation_execution_id` | UUID/null | Conditional | operation executionで必須 |
| `actor_type` | enum | Yes | §19 |
| `actor_ref` | string/null | Conditional | safe identifierのみ |
| `target_type` | bounded string/null | No | §20 |
| `target_ref` | string/null | No | Public Reference優先 |
| `result` | enum | Yes | `SUCCESS\|REJECTED\|FAILED\|PENDING\|NOOP` |
| `failure_class` | REL class/null | Conditional | non-successで分類可能なら必須 |
| `error_code` | bounded safe string/null | No | raw exception message禁止 |
| `duration_ms` | integer/null | No | 0以上 |
| `attempt_number` | integer/null | No | 1以上 |
| `is_retry` | boolean | Yes | 初回false |
| `business_cause_ref` | string/null | No | §10 |
| `transport_idempotency_fp` | hex32/null | No | §11 |
| `provider` | `STRIPE\|RESEND\|SUPABASE_AUTH\|SUPABASE_DB`/null | No | bounded |
| `provider_event_ref` | string/null | No | §12 |
| `provider_object_ref` | string/null | No | §12 |
| `provider_idempotency_fp` | hex32/null | No | §11 |
| `consistency_review_ref` | UUID/null | No | Public Reference |
| `recovery_execution_id` | UUID/null | No | recovery時 |
| `query_name` | bounded string/null | No | §26 stable repository operation |
| `http_method` | enum/null | No | HTTP時 |
| `http_route` | bounded route template/null | No | raw URL禁止 |
| `http_status` | integer/null | No | HTTP response時 |
| `schema_version` | integer | Yes | 初期 `1` |

`REL class` は次のexact valueを使用する。

```text
SUCCESS
TEMPORARY_FAILURE
PERMANENT_FAILURE
UNKNOWN_RESULT
CONFLICT_LOSER
CONSISTENCY_FAILURE
SECURITY_FAILURE
```

`result=SUCCESS` では `failure_class=SUCCESS` としてよい。non-successで `failure_class` を推測できないunexpected errorは `PERMANENT_FAILURE` ではなくsafe internal classification `TEMPORARY_FAILURE` または `CONSISTENCY_FAILURE` を無理に付けず、`error_code=UNEXPECTED_INTERNAL_ERROR` とし、最終分類前のeventでは `failure_class=null` を許可する。operation終了eventでは必ず分類する。

## 16. Event naming

Canonical pattern:

```text
<domain>.<subject>.<action>
```

- lowercase ASCII
- segmentは `a-z0-9_`
- 3〜5 segmentsを推奨
- outcome、ID、Email、URL、exception nameをevent nameへ埋め込まない
- outcomeは `result` / `failure_class` / `error_code` に格納

例:

```text
http.request.completed
auth.verification.completed
authorization.decision.completed
db.transaction.completed
db.transaction.retry_scheduled
payment.checkout.provider_call
payment.confirmation.completed
refund.provider_call
webhook.stripe.received
webhook.resend.completed
ticket.issuance.completed
qr.rotation.completed
checkin.entry.completed
karaoke.hold.completed
goods.handoff.completed
email.delivery.provider_call
reconciliation.item.completed
consistency_review.lifecycle.changed
recovery.execution.completed
security.fail_closed.triggered
observability.audit.write_failed
```

**OBS-LOG-003:** dynamic resource referenceやerror messageを `event_name` に連結しない。

## 17. Log level

| Level | Production常時 | Semantics |
|---|---|---|
| `DEBUG` | No | local diagnosis / temporary targeted debug。通常Production streamへ常時出さない |
| `INFO` | Yes | normal mutation success、重要read summary、Conflict Loser / idempotent convergence、retry scheduling、reconciliation start/end、recovery success |
| `WARN` | Yes | retryable failure、Provider Result Unknown、authorization / security rejection、stuck detection、webhook duplicate anomaly、degraded dependency |
| `ERROR` | Yes | unexpected internal error、Consistency Failure、retry exhausted、Security Configuration invalid、audit write failure、recovery failure |

Canonical classification:

| Situation | Level |
|---|---|
| normal successful high-value mutation | `INFO` |
| normal successful high-volume read | `INFO` subject to sampling |
| expected `CONFLICT_LOSER` | `INFO` |
| `TEMPORARY_FAILURE` before retry budget exhausted | `WARN` |
| `UNKNOWN_RESULT` | `WARN` |
| retry exhausted | `ERROR` |
| `CONSISTENCY_FAILURE` | `ERROR` |
| ordinary authorization / CSRF / signature rejection | `WARN` |
| Security Configuration invalid / required Secret unavailable | `ERROR` |
| unexpected internal exception | `ERROR` |
| automatic / manual recovery success | `INFO` |
| manual recovery failure | `ERROR` |

**OBS-LOG-004:** Secret / PII redactionはlevelに関係なく同じ規則を適用する。

## 18. Error Object / Stack Trace

Productionでは次をCanonicalとする。

- expected Domain / Security / Provider failure: `error_code` + normalized categoryだけ。stack traceは通常保存しない。
- unexpected internal `ERROR`: restricted error datasetにsanitized stack traceを保存してよい。
- stack trace最大16 KiB、cause chain最大5階層。
- local variable dump、request body、response body、headers、Cookie、Authorization、SQL bind valueをstack trace metadataへ付けない。
- raw SQL error textは保存せず、SQLSTATE、named constraint、`query_name`、normalized DB categoryを保存する。
- raw Provider error objectは保存せず、HTTP status、allowlisted provider error code、request phaseのみ保存する。

NonproductionでもProduction Secret / Production PII / Production QR protected materialを投入しない。development/testではstack traceを常時利用してよいがredaction規則は同じである。

**OBS-LOG-005:** stack traceをClient error envelopeまたはnormal alert payloadへ転送しない。

---

# Part IV — Actor / Target Representation

## 19. Actor representation

`actor_type` は次のbounded enumとする。

```text
GUEST
AUTHENTICATED_USER
STAFF
ADMINISTRATOR
SYSTEM_WORKER
SCHEDULED_RECONCILIATION
EXTERNAL_PROVIDER
INFRASTRUCTURE_OPERATOR
```

### 19.1 Actor ref

- `GUEST`: `actor_ref=null`
- `AUTHENTICATED_USER` / `STAFF` / `ADMINISTRATOR`: Business Profile `public_ref`を優先
- Business Profile未解決だがAuth Subject correlationが必要なsecurity event: raw Auth Subjectではなく§11 `r39x/obs/v1/auth-subject` fingerprint
- `SYSTEM_WORKER`: bounded worker role (`email-worker`, `recovery-worker`等)。instance hostnameをactor identityにしない
- `SCHEDULED_RECONCILIATION`: bounded reconciliation key
- `EXTERNAL_PROVIDER`: `STRIPE` または `RESEND`。Provider webhookを人間Actorとして扱わない
- `INFRASTRUCTURE_OPERATOR`: emergency bootstrap等、`SPEC-150` が認めるout-of-band operationだけ。deployment環境が提供するstable non-secret audit subjectを使用し、個人Email等を直接入れない

**OBS-COR-010:** Role / CapabilityはActor Typeの名前だけから推測せず、Audit Eventでは実際に評価されたRole / Capabilityを別fieldへ保存する。

## 20. Target representation

`target_type` は少なくとも次をbounded registryとして使用する。

```text
ORDER
CHECKOUT_ATTEMPT
REFUND
ENTRY_TICKET
KARAOKE_TICKET
ENTRY_CHECKIN
KARAOKE_CHECKIN
KARAOKE_SLOT
KARAOKE_HOLD
KARAOKE_RESERVATION
GOODS
GOODS_ALLOCATION
GOODS_HANDOFF
NOTIFICATION_REQUEST
EMAIL_DELIVERY_JOB
EMAIL_DELIVERY_ATTEMPT
ROLE_ASSIGNMENT
CONSISTENCY_REVIEW
PUBLIC_CONTENT
SECURITY_CONFIGURATION
WEBHOOK_RECEIPT
```

`target_ref` はPublic Referenceを持つEntityではPublic Referenceを使用する。Public Referenceを持たないsupport rowは、直接addressable targetとせず、親のPublic Reference + bounded subtypeで追跡する。Internal bigint IDを通常log correlationへ使用しない。

**OBS-COR-011:** metric labelへ `target_ref` を使用しない。


# Part V — Domain / Reliability Application Events

## 21. Common result logging

Every server operation completion event MUST allow the following investigation tuple without relying on free-form text:

```text
operation_id
operation_execution_id
actor_type / actor_ref
target_type / target_ref
result
failure_class
error_code
business_cause_ref
provider / provider reference when relevant
consistency_review_ref when relevant
recovery_execution_id when relevant
```

**OBS-LOG-006:** If an upstream operation already has a canonical outcome/state, Observability MUST record that exact semantic and MUST NOT invent a replacement state.

## 22. Reliability event catalog

The following application event names are canonical minimum emission points for `SPEC-150` semantics.

| Event name | Required when | Key additional fields |
|---|---|---|
| `reliability.timeout.occurred` | a canonical system-side deadline is exceeded | `operation_id`, `duration_ms`, `provider/query_name`, `failure_class` |
| `reliability.retry.scheduled` | automatic retry is scheduled | `attempt_number`, `business_cause_ref`, `error_code` |
| `reliability.retry.attempted` | retry starts | `attempt_number`, `is_retry=true` |
| `reliability.retry.exhausted` | retry budget is exhausted | `attempt_number`, `failure_class` |
| `reliability.retry_budget.exhausted` | cause-level retry budget is exhausted | `operation_id`, `business_cause_ref` |
| `reliability.unknown_result.opened` | `UNKNOWN_RESULT` begins | target/provider refs, `attempt_number` |
| `reliability.unknown_result.resolved` | authority determines the result | `result`, `duration_ms`, provider refs |
| `reliability.stuck.detected` | `SPEC-150` stuck predicate becomes true | `target_type`, `target_ref`, `duration_ms` as age |
| `reconciliation.run.started` | one reconciliation run starts | `operation_id`, `operation_execution_id` |
| `reconciliation.item.completed` | each item is processed | target, result/failure, repair classification |
| `reconciliation.run.completed` | run ends | aggregate counts only |
| `recovery.automatic.completed` | automatic repair is attempted | `recovery_execution_id`, target, result |
| `consistency_review.lifecycle.changed` | open/dedupe/resolve/recurrence | `consistency_review_ref`, `error_code=reason_code`, lifecycle action |
| `recovery.manual.started` | manual recovery command accepted for execution | `recovery_execution_id`, target, actor |
| `recovery.manual.completed` | manual recovery finishes or becomes unknown | result/failure/provider refs |
| `security.fail_closed.triggered` | Security Control blocks an operation because safe evaluation is impossible or rejects it | control category, operation, failure class |

**OBS-REC-001:** Retry count, backoff, jitter, cadence and Runbook are read from `SPEC-150`; this table only defines observability emission.

**OBS-REC-002:** `UNKNOWN_RESULT` open/resolve events MUST be unsampled and MUST carry the same Business Cause and Attempt reference used by upstream processing.

**OBS-REC-003:** A `CONFLICT_LOSER` is a normal concurrency outcome and MUST NOT be promoted to a paging alert merely because it is a non-winner.

**OBS-REC-004:** Consistency Review dedupe MUST emit a lifecycle event pointing to the existing Case rather than pretending that a new Case was created.

## 23. Database observability

Canonical Database events:

```text
db.pool.acquire.completed
db.statement.completed
db.transaction.completed
db.transaction.retry_scheduled
db.lock_wait.completed
db.constraint_loser.completed
db.availability.failed
db.migration.failed
```

Required semantics:

- pool acquisition duration and acquisition timeout
- active and waiting connection aggregate where the runtime/driver can expose it
- stable `query_name`, never raw SQL as the primary identifier
- statement duration
- transaction duration
- lock wait duration
- SQLSTATE `40001`
- SQLSTATE `40P01`
- known constraint loser (`23505`, `23P01`, named constraint)
- statement timeout / lock timeout / pool timeout
- transaction retry attempt and exhaustion
- runtime DB unavailable distinct from migration failure

Canonical `query_name` uses a stable repository operation key, examples:

```text
orders.find_owner_detail
orders.lock_for_confirmation
checkout_attempts.find_unknown
role_assignments.revoke_active
entry_tickets.consume
karaoke_holds.acquire
karaoke_holds.expire
goods_inventory.lock_for_adjustment
email_jobs.claim_ready
consistency_reviews.find_unresolved
```

`query_name` MUST be source-controlled, bounded, and not generated from SQL text.

**OBS-DB-001:** Production logs MUST NOT unconditionally record SQL text, bind parameters, connection strings, or ORM object dumps.

**OBS-DB-002:** SQLSTATE MAY be logged because it is a bounded technical code, but raw database error detail/hint/context is not a normal log field.

**OBS-DB-003:** `40001` / `40P01` MUST be separately countable from constraint losers and from DB unavailability.

**OBS-DB-004:** A commit acknowledgement loss classified by `SPEC-150` as result unknown MUST emit `reliability.unknown_result.opened`, not merely `db.transaction.failed`.

## 24. Authentication / Authorization observability

Canonical events:

```text
auth.verification.completed
auth.jwks_refresh.completed
auth.email_verified_resolution.completed
auth.business_profile_resolution.completed
authorization.role_resolution.completed
authorization.decision.completed
authorization.last_admin_protection.triggered
auth.emergency_admin_recovery.completed
```

At minimum, the following safe reason codes MUST be observable:

```text
AUTHENTICATION_REQUIRED
INVALID_CREDENTIAL
EXPIRED_CREDENTIAL
AUTH_SERVICE_UNAVAILABLE
JWKS_REFRESH_FAILED
EMAIL_VERIFIED_STATE_UNAVAILABLE
BUSINESS_PROFILE_UNRESOLVED
BUSINESS_PROFILE_INCONSISTENT
ROLE_RESOLUTION_UNAVAILABLE
AUTHORIZATION_DENIED
CAPABILITY_DENIED
OWNERSHIP_MISMATCH
LAST_ADMINISTRATOR_PROTECTION
EMERGENCY_ADMIN_RECOVERY
```

Rules:

**OBS-AUTH-001:** Token contents, full JWT payload, Cookie, Email, Password, reset/verification token MUST NOT be logged.

**OBS-AUTH-002:** Public-facing authentication failure logs MUST not distinguish account existence in a way that enables enumeration. Internal `error_code` MAY distinguish infrastructure failure from invalid credential only when the upstream authority already safely knows that distinction.

**OBS-AUTH-003:** Ownership mismatch uses the same owner-safe external response semantics as `SPEC-110`; internal logs MAY use `OWNERSHIP_MISMATCH` with actor/target safe refs when those refs are already authorized to the server process.

**OBS-AUTH-004:** Last Administrator protection activation is both an Application Security Event and an Audit Event for the authenticated privileged attempt.

**OBS-AUTH-005:** Emergency Administrator recovery MUST use `INFRASTRUCTURE_OPERATOR`, `RECOVERY.ADMIN_BOOTSTRAP`, a Recovery Execution ID, and a required Audit Event; it MUST NOT masquerade as a normal Administrator UI request.

## 25. Stripe / Payment / Refund observability

Canonical events:

```text
payment.checkout.attempt_created
payment.checkout.provider_call
payment.checkout.binding_completed
payment.webhook.received
payment.webhook.processing_completed
payment.confirmation.completed
payment.order.review_required
refund.request.created
refund.provider_call
refund.reconciliation.completed
```

Required observations:

- Checkout Attempt creation and `public_ref`
- same-key Checkout create retry
- Checkout Result Unknown open/age/resolve
- Active Checkout Binding establishment
- Stripe Webhook receipt and verified Event ID
- duplicate verified webhook
- Payment Binding unresolved
- amount / currency mismatch
- Business Confirmation success
- Business Confirmation retry/failure
- Order `REVIEW_REQUIRED`
- Refund request / Provider call / Provider Result Unknown
- Refund success / definitive failure / review
- scheduled reconciliation and manual recovery

**OBS-PAY-001:** `stripe_checkout_session_id`, `stripe_payment_intent_id`, `stripe_charge_id`, `stripe_event_id`, and `stripe_refund_id` MAY appear in restricted Application Log/Audit records when present in canonical DB records. They MUST NOT be metric labels or normal external alert payload fields.

**OBS-PAY-002:** Card data, CVC, Payment Method secret, Stripe Secret, raw webhook body and full Stripe object MUST never be emitted.

**OBS-PAY-003:** Amount/currency mismatch MUST emit `CONSISTENCY_FAILURE` and the safe expected/observed amount+currency values MAY be stored because they are business values, not card data. Raw Stripe payload is still forbidden.

**OBS-PAY-004:** Checkout/Refund Result Unknown age MUST be derived from existing canonical timestamps; Observability MUST NOT create a new timeout semantic.

**OBS-PAY-005:** Refund Provider success and downstream Domain cancellation status MUST be represented separately so incident investigation can determine whether money was returned while entitlement cleanup remained incomplete.

## 26. Ticket / QR / Check-in observability

Canonical events:

```text
ticket.issuance.completed
qr.provisioning.completed
qr.rotation.completed
qr.migration.completed
qr.validation.completed
checkin.entry.completed
checkin.karaoke.completed
ticket.consistency_check.completed
```

Required observations:

- Ticket issuance and duplicate issuance prevention/convergence
- initial QR provision
- QR rotation and key version
- QR cryptographic migration
- decrypt authentication failure / digest inconsistency / key unavailable
- malformed / wrong-purpose / revoked QR
- Entry / Karaoke Check-in
- already-used / duplicate scan
- parallel conflict loser
- response-loss convergence to existing Check-in
- Ticket / Check-in inconsistency and Consistency Review

**OBS-TQR-001:** Raw QR payload, raw QR token, decrypted token material, QR digest input, QR HMAC input MUST NOT appear in log, Audit Event, Metric label, alert payload or dashboard.

**OBS-TQR-002:** QR token hash/digest stored for security validation MUST NOT be repurposed as an observability correlation identifier. Ticket Public Reference and QR key version are sufficient.

**OBS-TQR-003:** `qr.validation.completed` logs outcome category only, such as `VALID`, `MALFORMED`, `WRONG_PURPOSE`, `TOKEN_REVOKED`, `ALREADY_USED`, `KEY_UNAVAILABLE`; it MUST NOT echo scanner input.

**OBS-TQR-004:** Check-in winner and conflict loser MUST share the Ticket Public Reference and check-in type, while only the winner is associated with the committed Check-in result. A loser MUST not be counted as a second successful Check-in.

**OBS-TQR-005:** QR key unavailable / cryptographic inconsistency MUST emit `SECURITY_FAILURE` or `CONSISTENCY_FAILURE` according to `SPEC-150` and be unsampled.

## 27. Karaoke observability

Canonical events:

```text
karaoke.slot_generation.completed
karaoke.hold.completed
karaoke.hold.expiry_completed
karaoke.reservation.confirmation_completed
karaoke.reservation.cancellation_completed
karaoke.checkin_window.rejected
karaoke.consistency_check.completed
```

Required observations:

- Slot generation, reused exact candidates, duplicate/exclusion conflict
- Hold acquired / conflict loser / expired / released
- stuck Hold and payment-uncertain Hold
- late payment and resource reuse conflict
- Reservation confirmation
- Reservation cancellation
- canceled Reservation with Slot remaining `SOLD`
- Karaoke Ticket mismatch
- normal check-in window violation
- Consistency Review

**OBS-KRK-001:** Slot/Hold/Reservation Public References are log/audit correlation fields only and MUST NOT be metric labels.

**OBS-KRK-002:** A canceled Reservation whose Slot correctly remains `SOLD` is a normal success and MUST NOT be flagged as inventory leakage.

**OBS-KRK-003:** A normal Hold conflict loser is INFO and contributes to a bounded outcome metric; it is not itself a paging alert.

## 28. Goods observability

Canonical events:

```text
goods.allocation.completed
goods.inventory_reservation.completed
goods.allocation_release.completed
goods.purchase_confirmation.completed
goods.inventory_consistency.completed
goods.inventory_adjustment.completed
goods.handoff.completed
```

Required observations:

- Goods Allocation / inventory reservation / release
- purchase confirmation
- inventory counter mismatch
- authorized inventory adjustment
- Handoff completion
- duplicate / parallel Handoff convergence
- response loss convergence
- `VOID` / non-fulfillable conflict
- Refund financial result distinct from Goods lifecycle
- Consistency Review

**OBS-GDS-001:** Goods Public Reference, Customer ref, Order ref MUST NOT be Metric labels.

**OBS-GDS-002:** Inventory adjustment Audit Event MUST preserve safe before/after counters and adjustment reason code, but MUST NOT store a full row JSON snapshot.

**OBS-GDS-003:** Handoff idempotent replay that returns existing completion is `SUCCESS`/`NOOP` semantic and MUST not increment the successful-completion business effect twice.

## 29. Notification / Resend observability

Canonical events:

```text
notification.request.generated
notification.request.missing_detected
email.job.state_changed
email.job.claim_expired
email.delivery.attempt_created
email.delivery.recipient_resolution_completed
email.delivery.render_completed
email.delivery.provider_call
email.unknown.cutoff_warning
email.provider_acceptance.completed
webhook.resend.received
webhook.resend.processing_completed
notification.state_changed
notification.manual_retry.completed
notification.manual_reconciliation.completed
```

Required observations:

- Notification Request generation / missing generation detection / repair
- Email Job `READY` / `CLAIMED` / `UNKNOWN_RESULT` / `BLOCKED` / `CLOSED`
- claim expiry
- Delivery Attempt and attempt number
- recipient resolution failure
- rendering failure
- Resend 429
- Resend 5xx
- network timeout / reset
- Provider Acceptance and provider message ID
- verified Resend webhook and `svix-id`
- unmatched webhook
- Unknown Result age
- same-key recovery
- 23-hour safe cutoff approach / exceedance without redefining it; `email.unknown.cutoff_warning` uses bounded `cutoff_state=APPROACHING|EXCEEDED`
- Notification `SENT` / `FAILED_RETRYABLE` / `CANCELED`
- manual retry / manual reconciliation

**OBS-EML-001:** Recipient Email full value MUST NOT appear in normal logs, Metrics, normal alerts or dashboards.

**OBS-EML-002:** Admin-facing incident correlation MAY use the Notification Request, Email Delivery Job and Delivery Attempt Public References plus masked Email produced by the `SPEC-140` masking algorithm. The masked Email MUST NOT be a metric label.

**OBS-EML-003:** Resend Provider Idempotency Key is logged only via `provider_idempotency_fp` and the exact same key semantics from `SPEC-120` are preserved.

**OBS-EML-004:** `UNKNOWN_RESULT` MUST preserve the same Delivery Attempt and key fingerprint. A new Attempt is not created by Observability.

**OBS-EML-005:** Safe-cutoff warning MUST use age derived from `provider_called_at`; it does not alter the 23-hour cutoff or `SPEC-150` worker cadence.

## 30. Webhook observability

Stripe and Resend share the following event semantics:

```text
webhook.<provider>.received
webhook.<provider>.signature_verified
webhook.<provider>.duplicate
webhook.<provider>.processing_completed
webhook.<provider>.permanent_rejection
webhook.<provider>.correlation_failed
```

Required fields for verified requests:

- provider
- provider event reference
- request ID / operation execution ID
- event type (bounded provider event name)
- duplicate boolean / result
- processing duration
- processing result
- safe rejection reason including `SIGNATURE_INVALID|TIMESTAMP_REJECTED|REPLAY_REJECTED` where upstream verification can distinguish it without trusting payload content
- safe correlation target
- failure class / safe error code

For signature failure, `provider_event_ref` is not trusted and MUST NOT be copied from the unverified body/header as an authoritative identifier.

**OBS-WHK-001:** Signature value, signing secret and raw body MUST never be logged.

**OBS-WHK-002:** Verified duplicate receipt is observable but MUST not re-run Business effect.

**OBS-WHK-003:** Handler DB failure / timeout / retry / final processed / ignored / permanently inconsistent outcomes MUST be distinct.

### 30.1 Invalid webhook traffic aggregation

To prevent attack traffic from producing unbounded logs while preserving security signal:

1. Every rejection increments `r39x_webhook_receipts_total{provider,result="signature_rejected"}`.
2. Per provider + rejection reason, the first **20** rejected requests in each rolling 1-minute local aggregation bucket emit individual `WARN` security events.
3. Further rejected requests in that bucket do not emit individual event records; instead one `webhook.<provider>.rejection_aggregate` event is emitted at bucket close with `rejected_count`.
4. This is **aggregation, not sampling**. Counts are preserved in Metrics and the aggregate event.
5. Raw source IP is not logged. If source correlation is needed, security-only `network_source_fp` MAY use §11 HMAC with `r39x/obs/v1/network-source`; it is retained under Security Log policy and never used as a Metric label.

**OBS-WHK-004:** Aggregation MUST not suppress a transition to Security Configuration invalid, required Secret unavailable, or a verified event that reaches `CONSISTENCY_FAILURE`.


# Part VI — Audit Event

## 31. Application LogとAudit Eventの分離

Application LogとAudit Eventは別record classとする。

| Aspect | Application Log | Audit Event |
|---|---|---|
| Primary purpose | runtime diagnosis / performance / dependency / retry | privileged and security-sensitive operation accountability |
| Storage semantics | external/log sinkを想定、samplingあり | Business Database append-only persistence |
| Sampling | §47で一部可 | **禁止** |
| Retention | §48 | §48のAudit retention |
| Business mutation dependency | 通常は非blocking | §36のrequired operationではblocking / transactional |
| Free-form detail | 禁止、schema allowlist | 禁止、schema allowlist |
| PII / Secret | redaction必須 | redaction必須 |

**OBS-AUD-001:** Application Logの存在をAudit Event persistence成功の代替にしてはならない。

**OBS-AUD-002:** Audit Eventをlog sampling、log ingestion quota、dashboard retentionに依存させて失ってはならない。

## 32. Audit Event ID / event model

Audit Eventは1件ごとに独立したimmutable recordとする。

Canonical `audit_event_type`:

```text
PRIVILEGED_OPERATION
PRIVILEGED_OPERATION_DENIED
BUSINESS_EFFECT
RECOVERY_EXECUTION
SECURITY_SENSITIVE_OPERATION
EMERGENCY_ADMIN_RECOVERY
```

Canonical `audit_result`:

```text
REQUESTED
AUTHORIZED
REJECTED
COMMITTED
NOOP
PENDING
UNKNOWN
FAILED
```

Canonical `precondition_result`:

```text
PASSED
FAILED
NOT_APPLICABLE
UNKNOWN
```

**OBS-AUD-003:** Audit Eventの`result`はDomain Stateではない。Order/Ticket/Notification等のStateをrenameしない。

## 33. `app.audit_events` physical persistence

`SPEC-100 §44` の限定委譲に基づき、Business Schema `app` に次のappend-only tableを追加する。

### 33.1 Columns

| Column | Type | Null | Rule |
|---|---|---:|---|
| `id` | bigint identity | No | PK。通常log / client / dashboardへ露出しない |
| `audit_event_id` | uuid | No | `gen_random_uuid()`, UNIQUE |
| `occurred_at` | timestamptz | No | `transaction_timestamp()` |
| `audit_event_type` | text | No | §32 allowlist CHECK |
| `actor_type` | text | No | §19 allowlist CHECK |
| `actor_ref` | text | Yes | safe Public Reference / safe operator ref / fingerprint only |
| `effective_role` | text | Yes | `STAFF\|ADMINISTRATOR` only when evaluated |
| `capability` | text | Yes | upstream canonical capability only |
| `operation_id` | text | No | existing API Operation ID or bounded internal recovery key |
| `operation_execution_id` | uuid | No | one execution instance |
| `target_type` | text | Yes | §20 registry |
| `target_ref` | text | Yes | Public Reference / safe logical ref |
| `request_id` | uuid | Yes | HTTP operation when present |
| `business_cause_ref` | text | Yes | safe cause reference |
| `transport_idempotency_fp` | char(32) | Yes | §11 fingerprint |
| `provider` | text | Yes | `STRIPE\|RESEND\|SUPABASE_AUTH\|SUPABASE_DB` |
| `provider_event_ref` | text | Yes | allowlisted exact provider event ID |
| `provider_object_ref` | text | Yes | allowlisted operational provider object ID |
| `provider_idempotency_fp` | char(32) | Yes | §11 fingerprint |
| `precondition_result` | text | No | §32 allowlist |
| `audit_result` | text | No | §32 allowlist |
| `failure_class` | text | Yes | `SPEC-150` class |
| `reason_code` | text | Yes | bounded safe reason only |
| `before_state` | text | Yes | allowlisted state only |
| `after_state` | text | Yes | allowlisted state only |
| `changed_fields` | text[] | No | default empty; field-name allowlist only |
| `safe_change_summary` | jsonb | No | default `{}`; operation-specific allowlist |
| `consistency_review_ref` | uuid | Yes | Case Public Reference |
| `recovery_execution_id` | uuid | Yes | recovery correlation |
| `created_at` | timestamptz | No | same as insert transaction time |

Indexes:

```text
pk_audit_events
uq_audit_events_audit_event_id
ix_audit_events_occurred_at(occurred_at DESC)
ix_audit_events_actor_time(actor_ref, occurred_at DESC) WHERE actor_ref IS NOT NULL
ix_audit_events_operation_time(operation_id, occurred_at DESC)
ix_audit_events_target_time(target_type, target_ref, occurred_at DESC) WHERE target_ref IS NOT NULL
ix_audit_events_request(request_id) WHERE request_id IS NOT NULL
ix_audit_events_recovery(recovery_execution_id) WHERE recovery_execution_id IS NOT NULL
ix_audit_events_review(consistency_review_ref) WHERE consistency_review_ref IS NOT NULL
```

`safe_change_summary` MAY contain only values explicitly allowed in §35. It MUST NOT become a generic row dump.

### 33.2 Append-only enforcement

- Application runtime may `INSERT` only.
- Runtime may not `UPDATE` or `DELETE` audit rows.
- Normal Administrator / Staff roles do not receive direct table access.
- Normal application feature must not hard delete Audit Events.
- Retention purge, when due, is a separate infrastructure-controlled operation and MUST itself emit operational security evidence; implementation wiring belongs to `SPEC-180`.

**OBS-AUD-004:** `UPDATE app.audit_events` and ad-hoc row correction are prohibited. Incorrectly emitted events remain and a compensating/correction Audit Event MAY be appended with reference to the prior `audit_event_id` in an allowlisted `reason_code`, never by mutating history.

## 34. Audit actor / role / capability contract

For authenticated Admin / Staff operations, Audit Event MUST contain:

- `actor_type=ADMINISTRATOR` or `STAFF`
- `actor_ref=Business Profile public_ref`
- actual `effective_role` used by authorization
- exact required canonical `capability`
- exact server `operation_id`
- target Public Reference when applicable
- `request_id`
- `operation_execution_id`
- authorization/precondition result
- business result

For a denied privileged operation:

- if a verified Business Profile exists, record safe actor ref
- if denial occurs before safe identity resolution, use Application Security Event rather than inventing an Audit actor
- target existence MUST not be exposed solely to produce Audit detail

**OBS-AUD-005:** UI button click is not Audit Authority. Audit Event is emitted by the server-side operation after current Authentication / Authorization evaluation.

## 35. Before / after allowlist

Full row before/after JSON MUST NOT be stored.

Canonical safe change summary:

| Operation | Allowed before/after detail |
|---|---|
| Role grant/revoke | role, assignment state, target profile public ref |
| Refund | Refund Record state, requested amount/currency, provider result category |
| QR rotation | key version, token relation state `ACTIVE/REVOKED`; raw token/digest absent |
| Reservation cancellation | Reservation state, Ticket state, Slot state (`SOLD` remains) |
| Inventory adjustment | held/committed/available safe counters, signed adjustment quantity, reason code |
| Goods Handoff | `PENDING -> COMPLETED`, quantity, Goods Item ref |
| Check-in | Ticket state transition and check-in purpose/outcome only |
| Public Content | Publication State and changed field names; body content not copied |
| Notification retry/cancel | Notification Domain State, Job Processing State, Attempt number/snapshot revision; Email absent |
| Consistency Review recovery | Case reason code, unresolved/resolved state, related public refs |
| Slot mutation | state/time field names, old/new safe timestamps where relevant |
| Emergency Admin recovery | active Administrator count before/after, target profile public ref |

**OBS-AUD-006:** Public Content body, Email body, full recipient Email, QR material, provider raw payload, Session material and secrets MUST NOT be put in `safe_change_summary`.

## 36. Audit persistence failure boundary

### 36.1 Local high-risk mutation

For a high-risk mutation whose Business effect commits in one Business Database transaction, the required final `BUSINESS_EFFECT` / `PRIVILEGED_OPERATION` Audit Event MUST be inserted in the **same transaction** as the local Business effect.

This applies at minimum to:

- Role Assignment grant/revoke
- QR token rotation local state change
- Karaoke Reservation cancellation local state change
- Goods Inventory adjustment
- Goods Handoff completion
- Entry Check-in
- Karaoke Check-in
- Public Content publish/archive
- Notification cancel local state change
- any future explicit Recovery command whose corrective mutation is fully local

If Audit insert fails, the Business transaction MUST roll back and the operation MUST NOT report success.

**OBS-AUD-007:** This requirement adds an append-only side record to the same transaction but does not change upstream Domain State, lock order, authorization, or business preconditions.

### 36.2 External Provider side effect

For operations such as Refund or Provider recovery that contain an external side effect outside a DB transaction:

1. Before Provider call, persist/reuse the canonical processing record and a `REQUESTED` Audit Event in the same local transaction.
2. Execute Provider call outside the DB transaction per upstream rules.
3. Persist Provider result and final Audit Event in the same local result transaction.
4. If step 3 fails after Provider may have succeeded, do **not** roll back or repeat the Provider side effect blindly. Classify according to `SPEC-150` as Unknown / reconciliation-required and emit Application Log evidence if available.

**OBS-AUD-008:** Audit persistence failure after a possible Provider side effect MUST never cause a new Refund, Checkout, Resend Attempt or new Provider Idempotency Key.

### 36.3 Rejection / denial

Authenticated privileged operation rejection SHOULD persist a `PRIVILEGED_OPERATION_DENIED` Audit Event in a short dedicated DB transaction when Business Database is available.

If the Database itself is unavailable:

- the operation remains denied / failed closed
- no Business mutation is allowed
- the inability to persist the denial Audit Event is an `ERROR` Observability Failure and increments the audit-write-failure metric
- the system MUST NOT weaken authorization to make the Audit Event writable

### 36.4 Application Log sink failure

Application Log sink failure does not by itself roll back ordinary Business mutation if required Audit persistence succeeded. Audit-required mutation is governed by Audit DB persistence, not external log ingestion availability.

## 37. Required Audit operations

The following MUST be auditable for success, authenticated rejection, and important failure where the server can safely identify the actor/target.

| Operation / effect | Audit target | Required correlation |
|---|---|---|
| Role Assignment create / revoke | Role Assignment + target Profile | actor role/capability, request, before/after |
| last Administrator protection rejection | Role Assignment / target Profile | reason `LAST_ADMINISTRATOR_PROTECTION` |
| full Refund request | Order + Refund | Business Cause, Transport/Provider fingerprints, Stripe Refund ref when known |
| full Refund provider result | Refund | provider result, Unknown/reconciled state |
| QR token rotation | Entry/Karaoke Ticket | old/new key version/state; no token |
| Karaoke Reservation cancellation | Reservation | Ticket + Slot safe state refs |
| Goods Inventory adjustment | Goods | before/after counters + reason |
| Goods Handoff completion | Goods Handoff / Item | Staff/Admin actor, outcome |
| Entry Check-in | Entry Ticket | Staff actor, outcome, check-in ref if available |
| Karaoke Check-in | Karaoke Ticket | Staff actor, outcome, time-window result |
| Public Content publish/archive | Public Content | Publication State before/after |
| Notification retry | Notification Request / Email Job | attempt number, snapshot revision, result |
| Notification cancel | Notification Request | Domain/processing state result |
| Consistency Review manual recovery | Case + primary target | Case reason, Recovery Execution ID, recovery kind |
| automatic repair that changes Business state | repaired target + Case when present | `SYSTEM_WORKER`, Recovery Execution ID, recovery kind, post-verification result |
| explicit `recovery.exception.execute` | exact target | exact recovery command, never generic |
| emergency Administrator bootstrap/recovery | target Profile / Role Assignment | Infrastructure operator ref, active admin count before/after |
| security-sensitive configuration operation owned by this system | Security Configuration | changed setting names only, never secret values |

When `UCR-150-001/002` operations are later Canonicalized, each newly explicit Recovery command automatically becomes a required Audit target under this rule.

**OBS-AUD-009:** Automatic repair that changes Business state MUST append a `RECOVERY_EXECUTION` Audit Event with `actor_type=SYSTEM_WORKER`; read-only reconciliation/no-op checks remain Application Log/Metric only.

**OBS-AUD-011:** `recovery.exception.execute` Audit Event MUST identify the concrete recovery kind / Operation ID. Storing only `capability=recovery.exception.execute` is insufficient.

## 38. Audit data access

Audit data is not a normal Customer, Staff or generic Administrator feature.

- `STAFF` has no Audit dataset read access.
- `ADMINISTRATOR` role alone does not grant direct audit-table access.
- Application Admin UI MAY show operation-local audit summary only if a future upstream API/UX spec explicitly adds it; this specification does not invent that endpoint.
- Full Audit dataset access is restricted to project-owner-authorized incident/security operators through infrastructure-controlled read-only access defined in `SPEC-180`.
- Read-only access MUST not include DB credentials capable of modifying Business state.
- Audit export, if operationally necessary, follows `SPEC-140` support-copy rule and is access restricted with maximum 7-day temporary copy retention.

**OBS-AUD-010:** Incident tooling MUST display masked/allowlisted fields and MUST not bypass this rule by exposing the raw table through a generic SQL console to ordinary Administrators.

---

# Part VII — Metric Specification

## 39. Metric naming / types

Canonical prefix is:

```text
r39x_
```

Naming rules:

- Counter: suffix `_total`
- Histogram: base unit suffix such as `_seconds`
- Gauge: semantic noun without `_total`; use `_current` or `_oldest_age_seconds` where clarity requires
- snake_case only
- label names snake_case
- all metric labels MUST be bounded enums or source-controlled operation/route/query registries

Metric types:

- `Counter`: monotonically increasing event count
- `Histogram`: observed duration distribution
- `Gauge`: current queue/count/age state

## 40. Metric cardinality boundary

Allowed label dimensions are limited to these bounded registries where relevant:

```text
environment
service
route          # route template only
method
operation      # Operation ID / internal bounded key
domain
result
failure_class
provider
purpose
state
processing_state
reason_category
query_name
status_class
control
recovery_kind
```

Forbidden metric labels:

```text
request_id
operation_execution_id
order_ref
ticket_ref
reservation_ref
user/profile/auth subject
email
provider event/message/session/refund ID
idempotency key or fingerprint
raw error message
raw URL
raw QR
network fingerprint
arbitrary exception class
consistency_review_ref
recovery_execution_id
```

**OBS-MET-001:** `error_code` may be represented only through a finite source-controlled `reason_category`; arbitrary provider/application error strings MUST NOT become labels.

## 41. Canonical histogram buckets

These buckets are system-side observability choices, not Provider SLA.

```text
HTTP request seconds:
0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 15

DB pool acquisition seconds:
0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2

DB statement seconds:
0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10

DB transaction seconds:
0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8

Provider call seconds:
0.1, 0.25, 0.5, 1, 2, 5, 10, 15

Webhook handler seconds:
0.05, 0.1, 0.25, 0.5, 1, 2, 4, 6, 8
```

## 42. Canonical metric catalog

For **every** metric below, forbidden labels are exactly the high-cardinality/sensitive list in §40; there are no per-metric exceptions.

| Metric name | Type | Unit | Description / observe condition | Allowed labels | Cardinality expectation |
|---|---|---|---|---|---|
| `r39x_http_requests_total` | Counter | requests | every completed HTTP request | `environment,service,route,method,status_class` | bounded route registry |
| `r39x_http_request_duration_seconds` | Histogram | seconds | HTTP wall time | `environment,service,route,method` | bounded |
| `r39x_api_failures_total` | Counter | failures | API operation ends non-success excluding normal 4xx validation unless security/domain tracked elsewhere | `environment,operation,domain,failure_class` | bounded operation registry |
| `r39x_authentication_failures_total` | Counter | failures | auth required/invalid/expired/unavailable | `environment,result,reason_category` | <= 16 reason categories |
| `r39x_authorization_denials_total` | Counter | denials | capability/ownership/last-admin denial | `environment,operation,reason_category` | bounded |
| `r39x_db_pool_acquire_duration_seconds` | Histogram | seconds | every pool checkout | `environment,service,result` | low |
| `r39x_db_pool_acquire_failures_total` | Counter | failures | acquire timeout/error | `environment,service,reason_category` | low |
| `r39x_db_pool_connections` | Gauge | connections | current pool aggregate | `environment,service,state` where `state=active|idle|waiting` | exactly 3 states/service |
| `r39x_db_statement_duration_seconds` | Histogram | seconds | repository statement duration | `environment,query_name,result` | source-controlled query registry |
| `r39x_db_transaction_duration_seconds` | Histogram | seconds | transaction wall time | `environment,operation,result` | bounded |
| `r39x_db_transaction_retries_total` | Counter | retries | retry due to `40001`,`40P01`, lock timeout | `environment,operation,reason_category` | low |
| `r39x_db_unavailable_total` | Counter | failures | DB unavailable / connection class failure | `environment,service` | low |
| `r39x_provider_calls_total` | Counter | calls | Stripe/Resend/Auth provider calls | `environment,provider,operation,result` | bounded |
| `r39x_provider_call_duration_seconds` | Histogram | seconds | provider call wall time | `environment,provider,operation,result` | bounded |
| `r39x_payment_unknown_results_total` | Counter | transitions | Checkout/Payment unknown opened or resolved | `environment,operation,result` | low |
| `r39x_payment_unknown_current` | Gauge | items | current unresolved payment/checkout unknown items | `environment,operation` | low |
| `r39x_refund_unknown_results_total` | Counter | transitions | Refund unknown opened/resolved | `environment,result` | low |
| `r39x_refund_unknown_current` | Gauge | items | unresolved Refund unknown/review requiring provider resolution | `environment,state` | bounded state |
| `r39x_webhook_receipts_total` | Counter | events | Stripe/Resend received incl duplicate/rejected | `environment,provider,result` | low |
| `r39x_webhook_processing_duration_seconds` | Histogram | seconds | verified webhook processing duration | `environment,provider,result` | low |
| `r39x_checkin_outcomes_total` | Counter | attempts | Entry/Karaoke check-in outcomes | `environment,purpose,result` | bounded outcomes |
| `r39x_karaoke_holds_current` | Gauge | holds | current hold operational categories | `environment,state` | bounded |
| `r39x_karaoke_hold_recoveries_total` | Counter | operations | expiry/release/stuck recovery outcomes | `environment,result` | low |
| `r39x_goods_handoff_outcomes_total` | Counter | attempts | Handoff completed/already completed/conflict/failure | `environment,result` | bounded |
| `r39x_goods_inventory_consistency_failures_total` | Counter | failures | inventory counter/allocation mismatch | `environment,reason_category` | low |
| `r39x_notification_requests_current` | Gauge | requests | Notification Requests by Domain State | `environment,state` | 4 states |
| `r39x_email_jobs_current` | Gauge | jobs | Email Jobs by Processing State | `environment,processing_state` | 5 states |
| `r39x_email_provider_calls_total` | Counter | calls | Resend provider attempts | `environment,result` | bounded |
| `r39x_email_unknown_current` | Gauge | attempts | unresolved Resend unknown result | `environment,state` | low |
| `r39x_notification_missing_total` | Counter | detections | missing Notification Request detection / repair | `environment,result` | low |
| `r39x_reconciliation_runs_total` | Counter | runs | reconciliation run completed | `environment,operation,result` | bounded |
| `r39x_reconciliation_items_total` | Counter | items | individual item result | `environment,operation,result,failure_class` | bounded |
| `r39x_reconciliation_last_success_unixtime` | Gauge | unix seconds | last successful run time per reconciliation key | `environment,operation` | bounded |
| `r39x_stuck_processing_current` | Gauge | items | items satisfying `SPEC-150` stuck predicate | `environment,domain,reason_category` | bounded |
| `r39x_consistency_reviews_unresolved` | Gauge | cases | unresolved Case count | `environment,reason_category` | canonical reason categories |
| `r39x_consistency_review_oldest_age_seconds` | Gauge | seconds | oldest unresolved Case age | `environment,reason_category` | canonical reason categories |
| `r39x_manual_recovery_total` | Counter | executions | manual recovery finished | `environment,recovery_kind,result` | bounded recovery registry |
| `r39x_security_fail_closed_total` | Counter | events | Security Fail Closed / rejection requiring security signal | `environment,control,operation` | bounded |
| `r39x_audit_events_total` | Counter | events | successfully persisted Audit Events | `environment,audit_event_type,audit_result` | low |
| `r39x_audit_write_failures_total` | Counter | failures | Audit persistence failure | `environment,operation,reason_category` | bounded |

### 42.1 Gauge computation

Current-state Gauges SHOULD be generated from bounded scheduled queries or in-memory maintained state that is periodically reconciled against Business Database. They MUST NOT require one label series per row.

**OBS-MET-002:** Gauge source query failure MUST not silently publish zero. Exporter must retain last-known sample only if the backend supports staleness semantics and MUST separately increment failure metrics; dashboard must display data freshness.

**OBS-MET-003:** `r39x_reconciliation_last_success_unixtime` is used to detect missing runs without redefining the cadence itself.


## 43. Alert-support metrics

The following additional Gauges/Counters are canonical because specific alert rules require age/health signals without high-cardinality labels.

| Metric name | Type | Unit | Labels | Meaning |
|---|---|---|---|---|
| `r39x_payment_unknown_oldest_age_seconds` | Gauge | seconds | `environment,operation` | oldest unresolved Checkout/Payment unknown age |
| `r39x_refund_unknown_oldest_age_seconds` | Gauge | seconds | `environment,state` | oldest unresolved Refund provider-result age |
| `r39x_email_unknown_oldest_age_seconds` | Gauge | seconds | `environment` | oldest Resend Unknown Result age |
| `r39x_email_claim_expired_total` | Counter | events | `environment,result` | claim lease expirations / recovery result |
| `r39x_qr_security_failures_total` | Counter | events | `environment,reason_category` | key unavailable, decrypt auth failure, digest mismatch |
| `r39x_notification_missing_current` | Gauge | requests | `environment` | detected source events still missing expected Notification Request |
| `r39x_alert_delivery_failures_total` | Counter | failures | `environment,reason_category` | configured alert delivery pipeline failure |
| `r39x_observability_export_failures_total` | Counter | failures | `environment,component` | log/metric export failure excluding Audit DB persistence |

---

# Part VIII — Dashboard Contract

## 44. Dashboard general rules

All Production dashboards MUST visibly show:

- environment
- data freshness / last successful collection time
- selected time range
- aggregation interval
- active alert state

Dashboards MUST NOT show raw QR, full Email, Secret, Authorization/Cookie, provider raw payload, arbitrary request/response body, or Internal bigint ID.

Default time windows are operational defaults, not retention limits.

## 45. Required dashboard views

| Dashboard | Primary purpose | Required panels | Default time window | Breakdown | Drill-down |
|---|---|---|---|---|---|
| **System Health** | overall service/integrity health | request rate, 5xx rate, p95 latency, DB availability, provider failures, unresolved Reviews, stuck count, active alerts | 6h | service/domain/provider | Application Logs / Reliability dashboard |
| **API / Database** | request and DB bottleneck/failure | route request rate, p50/p95/p99 HTTP, API failure class, pool acquire p95/failures, statement/transaction p95, `40001`,`40P01`, lock timeout | 6h | route/operation/query_name | request log by `request_id`, DB event by operation execution |
| **Authentication / Authorization** | auth reliability and denial/anomaly | auth failures by reason, Auth Service unavailable, JWKS failures, authorization denial by operation/reason, last-admin protection | 24h | reason/operation | security logs / audit for authenticated privileged attempt |
| **Stripe / Payment / Refund** | financial flow integrity | Checkout provider calls, unknown current/age, webhook outcomes, confirmation failures, Review cases, Refund states/unknown age | 24h | payment operation/result/reason | Order/Attempt/Refund refs in restricted logs/audit |
| **Ticket / Check-in** | entitlement and event-day acceptance | issuance outcomes, QR security failures, Entry/Karaoke check-in outcomes, already-used/conflict, consistency failures | 6h | purpose/outcome | Ticket public ref / Audit Event |
| **Karaoke** | slot/hold/reservation integrity | Slot generation result, Hold current states, expiry recovery, payment-uncertain holds, Reservation cancellation, Karaoke consistency | 24h | result/state/reason | Slot/Hold/Reservation restricted log correlation |
| **Goods** | allocation/inventory/handoff integrity | purchase/allocation outcomes, inventory consistency failure, adjustment count, Handoff outcomes, unresolved Review | 24h | result/reason | Goods/Handoff Audit Event |
| **Notification / Email** | business notification delivery processing | Notification Domain State, Job Processing State, provider calls, claim expiry, Unknown current/age, missing notification, unmatched webhook | 24h | state/result | Notification/Job/Attempt public refs |
| **Webhook** | external event ingestion health/security | received, verified, duplicate, signature rejected, processing p95, failed/review/unmatched | 6h | provider/result | verified event/provider ref or security aggregate |
| **Reliability / Recovery** | retry/reconciliation/manual recovery health | retry/exhausted, stuck, reconciliation last success, run/item outcomes, Review unresolved/age, manual recovery outcomes | 24h | operation/failure class/recovery kind | Case ref / Recovery Execution ID |
| **Security / Privileged Operation** | security fail-closed and accountability | security fail closed, signature/CSRF/auth anomalies, privileged denials, Audit write failures, Audit event count/result | 24h | control/operation/audit type | restricted Security Logs / Audit Event |

**OBS-GEN-007:** Dashboard drill-down links MAY carry `request_id`, public refs, Audit Event ID, Consistency Review ref or Recovery Execution ID inside the restricted observability UI. They MUST NOT be embedded into public application URLs or metric labels.

---

# Part IX — Alert Contract

## 46. Alert severity / evaluation semantics

Canonical severities:

```text
CRITICAL  integrity/security or broad availability risk requiring immediate operator attention
HIGH      sustained or aging production failure requiring prompt investigation
MEDIUM    anomaly/degradation requiring investigation but not immediate paging
```

Alert rules are evaluated only for `production` unless explicitly enabled for staging validation. Development/test never pages Production operators.

For rate-based alerts, a window MUST meet both rate/threshold and minimum-event-count where specified.

### 46.1 Dedupe / cooldown

- Dedupe key: `environment + alert_rule_id + bounded_dimension_set`
- Opening notification: once when condition becomes true
- Repeat notification: at most once every **60 minutes** while unresolved for `CRITICAL`, every **4 hours** for `HIGH`, no automatic repeat for `MEDIUM`
- Resolve notification: once when condition is false for one full evaluation window
- Same alert MUST NOT page separately per request/entity/provider event ID
- A severity escalation bypasses cooldown once

**OBS-ALT-038:** Normal `CONFLICT_LOSER`, verified duplicate webhook, idempotent already-completed response, or ordinary single invalid QR scan MUST NOT page by itself.

## 47. Canonical alert rules

| Alert ID | Condition | Window / minimum | Severity |
|---|---|---|---|
| `OBS-ALT-001` API sustained 5xx | HTTP 5xx rate >= **5%** | 10m and >=100 requests | HIGH |
| `OBS-ALT-002` API severe outage | HTTP 5xx rate >= **20%** | 5m and >=50 requests | CRITICAL |
| `OBS-ALT-003` DB unavailable / pool failure | `db_unavailable + pool acquire failure >=3` | 2m | CRITICAL |
| `OBS-ALT-004` DB retry exhaustion | transaction retry exhausted >=5 | 10m | HIGH |
| `OBS-ALT-005` Auth verification unavailable | Auth Service/JWKS availability failures >=5 | 5m | HIGH |
| `OBS-ALT-006` Stripe provider degradation | Stripe `TEMPORARY_FAILURE` or `UNKNOWN_RESULT` rate >=20% | 5m and >=10 Stripe calls | HIGH |
| `OBS-ALT-007` Payment Unknown aging | oldest unresolved Checkout/Payment unknown > **10m** | 2 consecutive 1m evaluations | HIGH |
| `OBS-ALT-008` Payment Unknown terminal aging | oldest unresolved Checkout unknown >= **30m** | 1 evaluation | CRITICAL |
| `OBS-ALT-009` Refund Unknown aging | oldest unresolved Refund provider result > **30m** | 2 consecutive 5m evaluations | HIGH |
| `OBS-ALT-010` Refund manual-boundary aging | Refund provider result unresolved >= **6h** | 1 evaluation | CRITICAL |
| `OBS-ALT-011` Stripe webhook processing failure | verified Stripe webhook `FAILED_RETRYABLE` >=5 | 5m | HIGH |
| `OBS-ALT-012` Webhook consistency failure | any verified Stripe/Resend webhook enters Review/Consistency Failure | 1 event | HIGH |
| `OBS-ALT-013` QR key unavailable / crypto failure | any `KEY_UNAVAILABLE`, decrypt auth failure, digest mismatch | 1 event | CRITICAL |
| `OBS-ALT-014` Security configuration invalid | Production service not Ready due required security config/Secret/key failure | 1 readiness evaluation | CRITICAL |
| `OBS-ALT-015` Check-in consistency abnormal | any Ticket/Check-in atomicity Consistency Failure | 1 event | HIGH; 3 in 10m -> CRITICAL |
| `OBS-ALT-016` Karaoke stuck / unreleased | stuck/payment-uncertain Hold count >=1 continuously | 10m after upstream stuck predicate is true | HIGH |
| `OBS-ALT-017` Karaoke reconciliation failure | same Karaoke reconciliation operation fails 3 consecutive runs | within `max(3 × upstream cadence, 10m)` | HIGH |
| `OBS-ALT-018` Inventory inconsistency | unresolved Goods inventory counter inconsistency >=1 | continuous 5m | HIGH |
| `OBS-ALT-019` Email claim expiry anomaly | claim expiry >=5 | 10m | HIGH |
| `OBS-ALT-020` Resend Unknown aging | oldest Email Unknown > **1h** | 2 consecutive 5m evaluations | HIGH |
| `OBS-ALT-021` Resend cutoff risk | oldest Email Unknown >= **21h** | 1 evaluation | CRITICAL |
| `OBS-ALT-022` Missing Notification Request | missing current >=1 | continuous 10m | HIGH |
| `OBS-ALT-023` Consistency Review aging | oldest unresolved Case > **2h** | continuous 10m | HIGH |
| `OBS-ALT-024` Consistency Review severe aging | oldest unresolved Case > **6h** | 1 evaluation | CRITICAL |
| `OBS-ALT-025` Reconciliation worker missing | `now - last_success > max(3 × upstream cadence, 5m)` | 2 consecutive 1m evaluations | HIGH |
| `OBS-ALT-026` Manual recovery repeated failure | same `recovery_kind` failure >=3 | 30m | HIGH |
| `OBS-ALT-027` Webhook signature rejection anomaly | signature rejected >=50 | 5m | HIGH Security |
| `OBS-ALT-028` Authentication failure spike | invalid/expired/auth-required failures >=100 | 5m | MEDIUM Security |
| `OBS-ALT-029` Authorization denial spike | denials >=25 | 5m | MEDIUM Security |
| `OBS-ALT-030` CSRF rejection spike | CSRF rejections >=20 | 5m | HIGH Security |
| `OBS-ALT-031` Rate-limit activation spike | HTTP 429 >=100 OR >=20% of requests | 5m, rate branch requires >=100 requests | MEDIUM Security |
| `OBS-ALT-032` QR invalid/revoked anomaly | invalid/wrong-purpose/revoked scan outcomes >=20 | 5m | MEDIUM Security |
| `OBS-ALT-033` Privileged operation denial anomaly | authenticated Admin/Staff privileged denials >=10 | 10m | HIGH Security |
| `OBS-ALT-034` Last Administrator protection | protection activation >=1 | 1 event | MEDIUM Security |
| `OBS-ALT-035` Audit persistence failure | any required Audit Event insert failure for high-risk operation | 1 event | CRITICAL |
| `OBS-ALT-036` Observability export degraded | log/metric export failures >=10 | 10m | MEDIUM |
| `OBS-ALT-037` Alert delivery failure | configured alert delivery failure >=1 | 1 event | HIGH; delivery via independent infrastructure signal per SPEC-180 |

### 47.1 Alert payload

Normal alert payload MUST contain only:

- alert rule ID / severity
- environment / service/domain
- bounded operation/provider/reason category
- aggregate count/rate/age
- dashboard/log query reference generated by observability infrastructure

It MUST NOT contain raw Email, QR, token, Secret, provider raw body, request body, stack trace, Internal ID, or individual Provider Event ID.

**OBS-ALT-039:** Entity-level investigation references are resolved after operator enters the restricted dashboard/log system; they are not pushed into broad alert destinations by default.

---

# Part X — Sampling / Redaction / Retention

## 48. Sampling

Canonical Production sampling policy:

| Event class | Sampling |
|---|---|
| Audit Event | 100%, never sampled |
| `ERROR` | 100% |
| `WARN` | 100%, except §30.1 invalid-webhook aggregation which preserves aggregate counts |
| `UNKNOWN_RESULT` | 100% |
| `CONSISTENCY_FAILURE` | 100% |
| `SECURITY_FAILURE` | 100% semantic preservation; attack-volume events may use deterministic aggregation, not sample-drop |
| Consistency Review open/dedupe/resolve/recurrence | 100% |
| manual / automatic recovery | 100% |
| Payment / Refund provider-result inconsistency | 100% |
| QR crypto failure | 100% |
| last Administrator protection / emergency recovery | 100% |
| successful high-risk mutation / Check-in / Handoff | 100% |
| normal successful API mutation | 100% |
| normal successful high-volume read INFO log | deterministic **5%** |
| HTTP Metrics | 100% request count, no sampling |
| Production DEBUG | disabled by default |

Deterministic read sampling uses a stable non-secret hash of `request_id` solely to choose sample membership; it MUST NOT alter request behavior. A canonical implementation is SHA-256 of UUID bytes and sample when unsigned first 16-bit value modulo 100 is `< 5`.

Emergency Production DEBUG may be enabled per service for at most **60 minutes** per activation and at **10%** sampling, with all redaction unchanged. Enabling DEBUG MUST itself produce a Security/Operational event. Exact configuration mechanism is `SPEC-180`.

**OBS-SEC-001:** Sampling MUST NOT be applied before determining whether an event belongs to an unsampled critical class.

## 49. Redaction / Sensitive Data allowlist

The logging model is allowlist-based. If a field is not defined by the common schema or event-specific schema, it is not emitted.

The following MUST NOT appear in Application Log, Metric, normal alert payload, dashboard, Audit Event, or Consistency Review detail:

```text
Password
password hash
access token
refresh token
Session token
Authorization header
Cookie header/value
CSRF secret/token
Supabase service credential
Database password / connection string
Stripe secret key
Stripe webhook signing secret
Resend API key
Resend webhook signing secret
HMAC key
AES/AEAD key
raw QR token
raw QR payload
QR plaintext protected material
QR digest/HMAC input
full provider webhook raw body
card number
CVC
Payment Method secret
password reset token
email verification token
full provider response body
```

### 49.1 Personal Data

- full Email is not recorded in normal logs/Audit/Metrics/alerts.
- Notification operational UI/log correlation uses Notification/Job/Attempt refs and, where required, `SPEC-140` masked Email.
- Auth Subject is not used as normal actor identifier; Business Profile Public Reference is preferred.
- If Auth Subject correlation is required before Profile resolution, use §11 HMAC fingerprint.
- Names, addresses, phone numbers are not added because current Domain does not Canonically define them.
- raw IP is not normal log context. Optional security-only network fingerprint may be used as §30.1.

**OBS-SEC-002:** A restricted Audit/Incident view does not waive redaction. It receives more correlation identifiers, not raw credentials.

## 50. Retention policy

The following are system operational policy values, not legal retention claims and not external provider guarantees.

| Data class | Production retention | Notes |
|---|---:|---|
| sampled normal Application `INFO` logs | **30 days** | high-volume runtime diagnosis |
| Production `DEBUG` logs | **7 days** | temporary diagnosis only |
| `WARN` / `ERROR` error logs incl sanitized stack traces | **90 days** | incident diagnosis |
| Security Event logs | **180 days** | abuse / fail-closed investigation |
| Audit Events | **730 days** | operational/security accountability; separate from financial Business history |
| Metrics | **400 days** | long-term trend and seasonal comparison |
| Alert state / incident metadata | **730 days** | rule, open/resolve, aggregate evidence; no raw payload |
| temporary support export / screenshot / extracted PII | **7 days maximum** | `SPEC-140` minimum boundary |

Retention expiry MUST NOT delete Business Database financial/entitlement/check-in history whose retention is owned by upstream Database/Domain policy.

If law, contract, organizational policy or provider capability later requires longer/shorter retention, the relevant specification is versioned; this document does not fabricate such external obligations.

**OBS-SEC-003:** Audit Event retention is independent of Application Log retention and sampling.

---

# Part XI — Environment Separation

## 51. Production / nonproduction isolation

Production and nonproduction MUST separate at minimum:

- log stream/dataset
- metric tenant/dimension and alert evaluation
- alert routing
- dashboards
- Audit Event data
- Provider identifiers
- `OBS_CORRELATION_HMAC_KEY`
- Security Event dataset

Canonical environment values are `production`, `staging`, `development`, `test`.

**OBS-SEC-004:** Production Business rows, raw PII, QR protected material, Session material or Production Secret MUST NOT be copied into development/test observability data.

**OBS-SEC-005:** Nonproduction provider identifiers MUST not be correlated with Production as if they refer to the same Payment/Email operation.

**OBS-SEC-006:** Production alerts MUST not be triggered by staging/test metrics due to missing environment filter.

---

# Part XII — Observability Failure Boundary

## 52. Failure classes

| Failure | Business behavior | Required observability behavior |
|---|---|---|
| Application log sink unavailable | ordinary Business operation MAY continue if Security/Business/Audit requirements succeed | local bounded buffering if infrastructure supports; increment export failure; no secret fallback file |
| Metric exporter unavailable | Business operation continues | export failure metric/event when possible; dashboard freshness becomes stale |
| Audit persistence failure | §36: high-risk local mutation fails/rolls back; provider two-phase follows Unknown boundary | `ERROR`, audit-write failure metric/alert |
| Alert delivery failure | Business operation continues; security controls unchanged | record delivery failure in independent infra health signal; `SPEC-180` wiring |
| Dashboard unavailable | Business operation continues | logs/metrics/audit remain collected; dashboard is not authority |
| Observability correlation HMAC key unavailable | raw key MUST NOT be logged as fallback | omit optional fingerprint, emit Security/Observability failure; operation authority remains upstream Business/Provider keys |

**OBS-GEN-008:** Observability failure never authorizes Browser/Next.js direct Business Database writes, unsigned webhooks, cached roles, plaintext QR fallback, or duplicate Provider calls.

## 53. Log sink buffering boundary

Product-specific buffering is delegated to `SPEC-180`, but the logical boundary is fixed:

- Application process MUST not hold unbounded memory to preserve logs.
- Disk fallback MUST not write secrets/PII or expose a new durable store without `SPEC-180` security review.
- Backpressure from log export MUST not hold DB transactions or provider calls open beyond upstream deadlines.
- Audit Events are not routed through this lossy path; they persist in Business Database.

## 54. Alert delivery failure

Because an alert cannot reliably report failure of its own only delivery path, `SPEC-180` MUST wire alert-pipeline health to an infrastructure-level independent health signal or destination. SPEC-160 defines the event/metric semantics but not the product.

**OBS-ALT-040:** Alert delivery failure MUST NOT disable alert rule evaluation or Security Control to reduce noise.

---

# Part XIII — Incident Investigation Contract

## 55. Investigation entry points

Incident investigation SHOULD begin with one of these safe references:

```text
request_id
Order public_ref
Checkout Attempt public_ref
Refund record / operational public ref where available
Ticket public_ref
Karaoke Reservation / Hold / Slot public_ref
Goods / Handoff public_ref
Notification Request / Email Job / Attempt public_ref
Consistency Review public_ref
Audit Event ID
Recovery Execution ID
allowlisted Provider Reference
```

The system MUST not require raw QR, raw Idempotency Key, full Email, Password, Session, or Secret to investigate an incident.

## 56. Required investigation answers

### 56.1 Order purchase → Payment Confirmation

Given an Order Public Reference, an authorized operator can determine:

1. purchase-start Operation / request correlation
2. Checkout Attempt(s) and which Attempt became active
3. Provider call result or Unknown transition
4. Stripe Checkout / Event correlation if known
5. verified webhook receipt / duplicate status
6. Business Confirmation transaction result/retry
7. final Order state and any Consistency Review

### 56.2 Checkout Result Unknown

Can determine:

- exact Checkout Attempt Public Reference
- Business Cause
- same provider-idempotency fingerprint across retries
- Unknown opened time / age
- reconciliation executions
- resolved authority result or Case transition

### 56.3 Refund

Can determine separately:

- who requested Refund and with which Capability
- Refund Business Cause / provider-key fingerprint
- whether Stripe result is success/failure/unknown
- Stripe Refund ID if known
- whether local Refund Record persisted result
- whether downstream Domain cancellation completed or has a Case

### 56.4 Webhook duplicate

Can determine:

- provider
- verified Provider Event Reference
- first receipt processing result
- later duplicate receipt count/time
- whether Business effect was skipped on duplicate

### 56.5 Ticket / QR / Check-in

Can determine:

- when Ticket was issued
- QR initial provision and key version
- authorized QR rotation history without raw token
- Check-in winner
- conflict loser / already-used outcome
- response-loss convergence to existing result
- Ticket/Check-in consistency Case if any

### 56.6 Karaoke Hold

Can determine:

- Slot/Hold refs
- Hold acquired / conflict / expiry/release times
- payment-uncertain state
- late payment/reused resource issue
- Reservation confirmation/cancellation
- Slot remained `SOLD` after cancellation

### 56.7 Goods Inventory adjustment

Can determine:

- authorized actor/profile ref
- effective Role/Capability
- Goods target ref
- before/after safe counters
- adjustment reason
- resulting consistency state

### 56.8 Notification not sent

Can determine:

- whether expected Notification Request exists
- Domain State
- Email Job Processing State
- recipient resolution result without revealing full Email
- render result
- Delivery Attempt(s)
- provider call/Acceptance/Unknown state
- claim expiry / retry / cutoff age
- verified Resend webhook correlation
- manual retry/reconciliation Audit Event

### 56.9 Consistency Review / Recovery

Can determine:

- reason code
- primary target Public Reference
- Business/Provider cause correlation
- Case opened/deduped/resolved/recurrence history
- every Recovery Execution ID
- actor/capability for manual recovery
- recovery result and post-verification evidence category

### 56.10 Security Fail Closed

Can determine:

- control category
- affected operation
- service/environment
- safe reason code
- whether Business/Provider side effect was prevented
- relevant Audit Event for authenticated privileged attempts

**OBS-GEN-009:** Investigation tooling MUST use correlation to retrieve more records; it MUST NOT solve missing correlation by broadening logs to include credentials or full request bodies.

---

# Part XIV — Traceability

## 57. System Invariant traceability

| System Invariant | Observability protection |
|---|---|
| `INV-010-01` | Order/Attempt/Provider/Review correlation preserves investigation of purchase persistence |
| `INV-010-02` | Business Cause + confirmation attempt/transaction events show duplicate prevention |
| `INV-010-03` | Ticket issuance event + target ref + duplicate convergence |
| `INV-010-04` | Slot/Hold/Reservation events + conflict/stuck/recovery metrics |
| `INV-010-05` | Check-in outcome/winner/loser Audit and metrics |
| `INV-010-06` | Notification failure/retry separated from Order confirmation |
| `INV-010-07` | Payment confirmation / entitlement completeness / Consistency Review observability |
| `INV-010-08` | actor/role/capability Audit + authorization/security events |
| `INV-010-09` | payment mismatch logs safe expected/observed amount/currency, no Client authority |
| `INV-010-10` | idempotency fingerprints, webhook duplicate, retry/unknown/reconciliation tracking |

## 58. Upstream rule traceability

| OBS group | Primary upstream trace |
|---|---|
| `OBS-GEN-*`, `OBS-COR-*` | `INV-010-*`, `FR-XFN-*`, `DI-030-*`, `API-*`, `REL-GEN-*` |
| `OBS-AUTH-*` | `FR-AUTH-*`, relevant `FR-ADM-*`,`FR-STF-*`, `AR-*`, `SEC-AUTH-*`,`SEC-AZ-*`, `REL-AUTH-*` |
| `OBS-PAY-*` | Payment/Ticket/Karaoke/Goods `FR-*`, `BR-ORD-*`, relevant `DI-030-*`, `PAY-*`, `DB-PAY-*`, `API-PUR-*`,`API-CHK-*`,`API-WHK-*`,`API-ADM-PAY-*`, `SEC-PAY-*`, `REL-PAY-*`,`REL-RFD-*` |
| `OBS-TQR-*` | Ticket/Staff `FR-*`, `BR-TKT-*`,`BR-CHK-*`, `TQR-*`, `DB-TQR-*`, Check-in/Ticket APIs, `SEC-QR-*`, `REL-TQR-*` |
| `OBS-KRK-*` | `FR-KRK-*`, `BR-KRK-*`, `KRK-*`, Karaoke API/DB rules, `REL-KRK-*` |
| `OBS-GDS-*` | `FR-GDS-*`,`FR-STF-*`,`FR-ADM-*`, `BR-GDS-*`, Goods API/DB rules, `REL-GDS-*` |
| `OBS-EML-*` | `FR-EML-*`, `BR-NTF-*`, `EML-*`, email support tables, `API-ADM-EML-*`, `SEC-EML-*`, `REL-EML-*` |
| `OBS-WHK-*` | `PAY-WHK-*`, Resend webhook `EML-*`, `API-WHK-*`, `SEC-PAY-*`,`SEC-EML-*`, `REL-WHK-*` |
| `OBS-REC-*` | `BR-ORD-010`, relevant `DI-030-*`, `DB-XFN-*`, `API-REC-*`, `ADM-REC-*`, `REL-REC-*`,`REL-ADM-*` |
| `OBS-AUD-*` | `FR-ADM-022`, `FR-XFN-024`, `AR-ROLE-*`, `PG-ADM-*`,`PG-STF-*`, `ADM-*`,`STF-*`,`OPS-AUD-*`, `SEC-ADM-*`, `REL-ADM-*` |
| `OBS-SEC-*` | `SEC-*`, `REL-SEC-*`, `FR-XFN-*` |

### 58.1 Admin / Staff Page trace

Audit events are triggered by server operation, not Page click, but the following UI families are traceable:

- `PG-ADM-*` high-risk actions → corresponding `API-*` Operation ID → `OBS-AUD-*`
- `PG-STF-*` Check-in/Handoff → `API-STF-*` → `OBS-AUD-*`
- `OPS-ACT-*` / `OPS-AUD-*` → authorization/precondition/business-result fields
- `ADM-REC-*` → Consistency Review / Recovery Execution correlation

Unreflected `UCR-130-*` page/API capabilities remain non-Canonical until upstream reflection.

---

# Part XV — Acceptance Criteria

## 59. Observability Acceptance Criteria

Implementation MUST satisfy all of the following.

1. Every HTTP request has a valid `request_id` and returns the same ID in the response boundary required by `SPEC-110`.
2. `request_id` is never used as Business Cause or Idempotency Authority.
3. Every server operation has a bounded Operation ID and one Operation Execution ID.
4. Transport/Stripe/Resend Idempotency Keys are never normally logged raw.
5. Idempotency correlation fingerprint uses HMAC-SHA-256, domain separation, 16-byte truncation and lowercase hex.
6. Correlation HMAC key is environment-separated and never logged.
7. Internal bigint IDs are absent from normal log/audit correlation and Client-facing observability context.
8. Public References are preferred for addressable Business entities.
9. Stripe Event/Checkout/PaymentIntent/Charge/Refund IDs are allowed only in restricted logs/audit, never metric labels.
10. Resend provider message ID / verified Svix event ID are allowed only in restricted logs/audit, never metric labels.
11. Structured Application Log uses allowlisted JSON schema and event naming rules.
12. Request/response bodies are not dumped wholesale.
13. SQL text/bind parameters are not dumped wholesale.
14. Raw provider error objects/webhook bodies are not dumped.
15. DEBUG is disabled by default in Production and emergency DEBUG obeys time/sampling limits.
16. `UNKNOWN_RESULT`, `CONSISTENCY_FAILURE`, `SECURITY_FAILURE`, Review lifecycle and recovery events are unsampled.
17. High-volume successful reads use deterministic 5% sampling only after critical-class evaluation.
18. Invalid webhook floods use aggregation and full metric count rather than unlimited individual log emission.
19. Application Log and Audit Event are separate persistence classes.
20. `app.audit_events` exists as an append-only table under the explicit `SPEC-100 §44` delegation.
21. Application runtime cannot UPDATE/DELETE Audit Events.
22. Audit Event contains actor, role/capability, operation, target, request correlation, precondition and result when applicable.
23. Audit Event does not contain full row before/after JSON.
24. Role Assignment create/revoke is auditable.
25. last Administrator protection denial is auditable.
26. full Refund request/result is auditable without duplicate Provider side effects.
27. QR rotation is auditable without raw QR/token/digest.
28. Karaoke Reservation cancellation is auditable and records that Slot remains `SOLD` where relevant.
29. Goods Inventory adjustment is auditable with safe before/after counters.
30. Goods Handoff completion is auditable.
31. Entry/Karaoke Check-in is auditable and conflict loser does not become second business effect.
32. Public Content publish/archive is auditable without copying content body.
33. Notification retry/cancel is auditable without full Email.
34. Consistency Review manual recovery is auditable with Recovery Execution ID.
35. `recovery.exception.execute` Audit identifies the exact recovery command, not only the capability.
36. Emergency Administrator recovery is auditable as `INFRASTRUCTURE_OPERATOR` and is not normal Admin UI activity.
37. Required local high-risk Audit insert is in the same Business DB transaction as the Business effect.
38. Required Audit persistence failure rolls back local high-risk mutation and does not report success.
39. Provider-side effect followed by Audit/result persistence failure becomes Unknown/reconciliation per upstream rules and does not blind-retry.
40. Audit failure is itself metric/alert visible.
41. Failure classes exactly match `SPEC-150` semantics and are not Domain State.
42. DB `40001`, `40P01`, pool timeout, statement timeout, lock timeout and constraint loser are separately observable.
43. Auth required/invalid/expired/unavailable/JWKS/profile/role/authz/ownership/last-admin cases are distinguishable without token or Email disclosure.
44. Checkout Attempt creation/retry/unknown/binding/confirmation/review is traceable.
45. Refund unknown/reconciliation/domain-cancellation separation is traceable.
46. Webhook verified duplicate/permanent rejection/correlation failure/DB failure/timeout/processing result is traceable.
47. Ticket issuance, QR provision/rotation/key version/migration/crypto failure and Check-in outcomes are traceable without raw QR.
48. Karaoke Slot/Hold/Reservation/cancellation/stuck/payment uncertainty is traceable.
49. Goods Allocation/Inventory/Handoff/adjustment/consistency is traceable.
50. Notification generation/missing repair/Job state/Attempt/Resend/Webhook/Unknown/cutoff/manual recovery is traceable.
51. Metric names/types/units/allowed labels match §§39–43.
52. Metric labels never contain request/entity/user/Email/provider-event/raw URL/raw error/raw QR identifiers.
53. Every required dashboard in §45 is implementable from canonical metrics/logs/audit.
54. Every required alert in §47 has concrete threshold/window/minimum/cooldown semantics.
55. Normal Conflict Loser/idempotent duplicate does not page by itself.
56. Security alert semantics remain distinct from ordinary application failure alerts.
57. Raw QR/token/Password/Session/Access Token/Secret/Authorization/Cookie/card data never enter log/audit/metric/alert/dashboard.
58. Full recipient Email never enters normal logs/metrics/alerts/dashboard/audit.
59. Stack trace is restricted, sanitized, capped and never sent to Client/normal alert payload.
60. Retention is 30d INFO, 7d DEBUG, 90d WARN/ERROR, 180d Security, 730d Audit, 400d Metrics, 730d alert/incident metadata, 7d temporary support copy.
61. Production/nonproduction datasets, alerts, Audit and correlation keys are separated.
62. Log/Metric/Dashboard failure does not weaken Security or Business invariants.
63. Audit persistence failure obeys §36.
64. Alert delivery failure is itself observable through an independent infrastructure health path defined by `SPEC-180`.
65. Incident investigation questions in §56 can be answered without Secret/raw QR/unnecessary PII.
66. Retry counts/timeouts/reconciliation cadence/Runbooks are referenced from `SPEC-150` and not redefined.
67. `UCR-130-001〜006` and `UCR-150-001〜002` are not treated as reflected.
68. Future Canonical explicit Recovery commands inherit the same Audit/Log contract automatically.
69. `INV-010-01〜10` and relevant `FR-*`,`BR-*`,`DI-030-*`,`AR-*`,`PAY-*`,`TQR-*`,`KRK-*`,`DB-*`,`API-*`,`EML-*`,`ADM-*`,`STF-*`,`OPS-*`,`SEC-*`,`REL-*` are traceable through §57–58.
70. No unresolved implementation-choice placeholder remains in the normative contract.

---

# Part XVI — Upstream Change Requests

## 60. 上流仕様変更要求

本仕様書の作成時点で、新規Upstream Change Requestは発行しない。

理由:

- `SPEC-100 §44` がSPEC-160による専用append-only Audit table追加を明示的に委譲している。
- Audit/Event/Metric/Alert/Retention/Correlationは上流から本仕様へ明示委譲されている。
- 本書は既存Domain State、API endpoint、Capability、retry/reconciliation ruleを追加・変更していない。
- `UCR-130-001〜006`、`UCR-150-001〜002`が未反映であることを維持し、存在しないoperationを発明していない。

将来 `UCR-150-001` によりRecovery endpointが `SPEC-110` へ追加された場合、本書の `OBS-AUD-011`、`OBS-REC-*`、Correlation、Metric、Alert contractをそのOperation IDへ適用するだけであり、SPEC-160側でgeneric Recovery APIを追加しない。

---

## 61. 最終確認

本仕様は次を意図的に行っていない。

- System Boundaryの変更
- Event Bus /別System of Recordの追加
- Browser / Next.js WebからBusiness Databaseへの直接業務更新
- `request_id` のIdempotency Authority化
- raw Idempotency Keyの通常log保存
- raw QR / Token / Credential / Secretの記録
- Email全文の通常観測dataへの保存
- Provider raw body / response全文の保存
- Domain State / Payment / QR / Notification lifecycleの再定義
- retry回数 / timeout / reconciliation cadence / Runbookの再定義
- `UNKNOWN_RESULT` の成功/失敗推測
- normal Conflict Loserのpaging化
- Metric labelへのhigh-cardinality identifier導入
- Audit EventのApplication Log sampling依存
- `recovery.exception.execute` のgeneric superuser化
- 未反映UCRの反映済み仮定

