---
spec_id: SPEC-170
title: Test Specification
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
  - SPEC-110
  - SPEC-120
  - SPEC-130
  - SPEC-140
  - SPEC-150
  - SPEC-160
related_specs:
  - SPEC-180
  - SPEC-190
  - SPEC-200
---

# 170 Test Specification

## 1. 目的

本書は、**off r39'x in 大阪らへん2027** Webシステムの完成形に対するTest Architecture、Test Level、Test Responsibility、Test Case Contract、Test Data / Fixture、Provider Test Double、Fault Injection、Concurrency Test、Coverage、Flaky Test Policy、および上流Canonical RuleへのTraceabilityを定義する。

本書は **Test Architecture / Test Responsibility / Test Case Contract / Test Data / Fixture / Provider Test Double / Fault Injection / Concurrency Test / Coverage / TraceabilityのCanonical Owner** である。

本書は上流Canonical Ownerが定義したDomain State、Business Rule、API endpoint、Database schema、Authentication / Authorization、Payment / Refund、Ticket / QR / Check-in、Karaoke、Goods、Notification、Administrator / Staff、Security、Reliability、Observability / Auditを変更しない。Testを容易にする目的で次を行ってはならない。

- Browser / Next.js WebからBusiness Databaseを直接更新するTest-only architectureを本番経路の代替として扱う。
- Unit fakeだけでPostgreSQL constraint、transaction race、lock semantics、Provider resultを保証済みとみなす。
- E2Eだけでcritical invariantを保証済みとみなす。
- ProductionのCSPRNG、QR cryptography、Authentication、Webhook signature、CSRF、Authorization、DB constraintをTest都合で弱化する。
- `request_id` をIdempotency AuthorityまたはBusiness Causeへ昇格する。
- Provider `UNKNOWN_RESULT`を成功または失敗へ推測する。
- `CONFLICT_LOSER`を内部障害へ読み替える。
- Product retryとTest runner retryを混同する。
- Production Secret、Production Provider credential、Production Business dataをTestへ使用する。
- `UCR-130-001〜006` または `UCR-150-001〜002` のみで要求されているAPI / Capability / UIを現行Canonical機能としてTestする。

本書はMVP、Step1、Step2、初期リリース等の実装段階でTest responsibilityを分断しない。長期運用される完成システムを対象とする。

---

## 2. System Boundary

Test対象のSystem Boundaryは上流どおり次とする。

```text
Browser
  -> Next.js Web / Vercel
  -> Hono API / Railway
  -> Supabase PostgreSQL

Authentication = Supabase Auth
Payment = Stripe Checkout / Webhook
Email Provider = Resend
Email Rendering = React Email
ORM / Driver = Drizzle ORM / pg
Web <-> API = Hono RPC
Runtime Validation = Zod
Business updates = Hono API only
```

Business DatabaseはOrder / Ticket / Reservation / Goods / Check-in / Notification RequestのSystem of Recordである。Test harnessは別System of Recordを導入してはならない。

---

## 3. 依存仕様と採用理由

| Spec | SPEC-170が直接利用するCanonical contract |
|---|---|
| `SPEC-000` | Canonical Owner、`depends_on`、正式仕様と実装範囲の分離、Upstream Change Request、AI実装容易性 |
| `SPEC-010` | System Boundary、Actor、System of Record、`INV-010-01〜10` |
| `SPEC-020` | `FR-*`。機能要件単位のTest coverage対象 |
| `SPEC-030` | Domain State、`BR-*`、`DI-030-*`。state transition / invariant / property test入力 |
| `SPEC-040` | `UF-*`。Browser journey / pending / retry / recovery outcome入力 |
| `SPEC-050` | `PG-*`、Route、Screen State。一般利用者E2E入力 |
| `SPEC-060` | `AR-*`、Role / Capability / Ownership / last Administrator / Fail Closed |
| `SPEC-070` | `PAY-*`、Checkout / Payment / Webhook / Refund / Business Cause / Provider result unknown |
| `SPEC-080` | `TQR-*`、QR format / protection boundary / consume-once / check-in concurrency |
| `SPEC-090` | `KRK-*`、15分利用 + 5分整備、45分Hold、30分Payment Deadline、5分Safety Buffer、no resale、check-in window |
| `SPEC-100` | `DB-*`、physical schema、named constraint、`READ COMMITTED`、lock / advisory lock / `SKIP LOCKED` / migration |
| `SPEC-110` | `API-*`、route / method / Operation ID、Hono RPC、Zod、HTTP status、error envelope、idempotency |
| `SPEC-120` | `EML-*`、Notification / Email Job / Attempt、Resend、120秒claim、23時間safe cutoff、Resend webhook |
| `SPEC-130` | `ADM-*` / `STF-*` / `OPS-*`、Admin / Staff routeとUX、未反映 `UCR-130-001〜006` |
| `SPEC-140` | `SEC-*`、Security Control、Fail Closed、CSRF/CORS/XSS/headers、Secret、QR crypto、Webhook replay、rate limit |
| `SPEC-150` | `REL-*`、failure class、timeout、retry/backoff/jitter/budget、unknown result、reconciliation、recovery、未反映 `UCR-150-001〜002` |
| `SPEC-160` | `OBS-*`、structured log、correlation、Audit Event、Metric、Alert、Sampling、Retention、Redaction |

`SPEC-180` は本書をdeployment gateへ接続する下流仕様、`SPEC-190` は本書をAI開発手順へ接続する下流仕様、`SPEC-200` は本書のTest evidenceをsystem acceptanceへ接続する下流仕様である。

### 3.1 未反映UCR

本書作成時点では次を未反映として扱う。

- `UCR-130-001〜006`
- `UCR-150-001〜002`

よって、これらだけに存在するsales management Capability、追加Admin read/mutation、Goods Handoff preview/manage、追加Recovery command、Recovery UI actionは現行Test catalogへ「実装済みoperation」として登録しない。対象Canonical Ownerへ将来反映された場合、本書の該当Test groupとTraceability manifestへTest Caseを追加する。

### 3.2 SPEC-110 Operation ID不足

`SPEC-110` はAPI Operation IDをCanonical correlation keyと定義する一方、現行§46〜48のPublic Content manage、Goods inventory manage、Role Assignment manageの一部routeには個別Operation IDが付与されていない。本書はOperation IDを発明せず、§79に `UCR-170-001` として記録する。反映前もmethod + path + capability contractのTestは必須だが、Operation IDベースの完全Traceabilityは当該routeに限りUCR解消後に満たす。

---

# Part I — Test Architecture

## 4. Canonical Terms

| Term | 意味 |
|---|---|
| Test Rule | 本書の `TST-*` で識別するNormative test requirement |
| Test Case | 実行可能な1つの検証。`TC-*` IDを持つ |
| SUT | 当該Test levelで直接検証するSystem Under Test |
| Real Component | Test中に本物の実装 / engine / protocol semanticsを使うcomponent |
| Test Double | Provider contract surfaceを再現するfake / stub / simulator。Provider内部実装の模倣ではない |
| Fault Point | Test専用hookにより特定failureを決定論的に発生させる境界 |
| Deterministic Clock | Testから現在時刻とtimer advanceを制御できるclock abstraction |
| Business Cause | 上流が定義する、同一Domain effectを最大1回に収束させる原因 |
| Critical Test | System Invariant、money、entitlement、authorization、security、concurrency、recovery、audit atomicityを検証するTest |
| Gating Suite | Merge / deployment可否を決定するTest group |
| Provider Contract Smoke | nonproduction credentialを使いProvider contractの最小surfaceを確認する分離suite |
| Flaky | 同一code / fixture / seedで、原因となる仕様上の非決定性なしにpass/failが変動するTest |

## 5. Rule ID体系

| Prefix | Category |
|---|---|
| `TST-GEN-*` | Test general / architecture |
| `TST-UNT-*` | Unit Test |
| `TST-INT-*` | Integration Test |
| `TST-API-*` | API contract |
| `TST-DB-*` | Database / migration / transaction / constraint |
| `TST-E2E-*` | Browser E2E |
| `TST-AUTH-*` | Authentication / Authorization |
| `TST-PAY-*` | Payment / Refund |
| `TST-TQR-*` | Ticket / QR / Check-in |
| `TST-KRK-*` | Karaoke |
| `TST-GDS-*` | Goods |
| `TST-EML-*` | Notification / Resend |
| `TST-SEC-*` | Security |
| `TST-REL-*` | Reliability / retry / unknown result |
| `TST-REC-*` | Reconciliation / recovery |
| `TST-OBS-*` | Log / Metric / Alert / Audit Event |
| `TST-CON-*` | Concurrency / race |
| `TST-IDM-*` | Idempotency |
| `TST-PRV-*` | Provider integration / simulator / smoke |
| `TST-DAT-*` | Test data / fixture / clock / randomness |
| `TST-FLT-*` | Fault injection |
| `TST-COV-*` | Coverage |
| `TST-TRC-*` | Traceability |
| `TST-FLK-*` | Test retry / flaky policy |

Test Case IDは次とする。

```text
TC-<test-rule-id-without-TST-prefix>-<3-digit-sequence>
```

例:

```text
TC-DB-023-001
TC-CON-004-002
TC-INV-010-05-003
```

System Invariant専用Caseは可読性のため `TC-INV-010-XX-NNN` を使用してよい。

**TST-GEN-001:** Test Rule ID / Test Case IDはrepository内で一意とし、別意味へ再利用しない。

## 6. Test objective

Test suiteは少なくとも次を証明する。

1. 上流Canonical Ruleどおりの正常動作が成立する。
2. 不正入力、権限不足、期限境界、Provider失敗、DB失敗、response lossで禁止side effectが発生しない。
3. DB constraint / lock / transactionに依存するInvariantは実PostgreSQL semanticsで成立する。
4. 同一Business Causeへの並行実行 / retry / replayが既存結果へ収束する。
5. `UNKNOWN_RESULT` をblind retryせずauthority reconciliationへ移行できる。
6. Security Controlを評価できない場合にFail Closedする。
7. required Audit Eventとhigh-risk local mutationがatomicである。
8. log / metric / alert / audit outputがredaction / cardinality / sampling契約を守る。
9. User Flow / Page / API / DB / Provider / Recoveryの各layerが互いの責務を取り違えない。

**TST-GEN-002:** Test passは単なるHTTP 2xx、snapshot一致、line coverage達成だけで判定せず、当該Test CaseのDomain / DB / Provider / Audit postconditionを明示assertする。

---

## 7. Test level classification

| Level | Purpose | SUT | Real component | Fake / Stub | DB | Browser | External Provider | Failure injection | Required assertion | Trace target |
|---|---|---|---|---|---|---|---|---|---|---|
| Unit | pure decision / schema / formatter / classifier | 1 module / pure service | production code | dependency portのみ | No | No | No | function-level | exact return/error + no secret output | `BR-*`, `AR-*`, schema rule, `SEC-*`, `REL-*`, `OBS-*` |
| Integration | application service + repository + DB semantics | service/repository boundary | Hono service code, Drizzle/pg, real PostgreSQL | Provider adapter | Yes | No | No | DB/provider adapter hooks | rows, states, constraints, transaction result | `DI-030-*`, `DB-*`, `PAY-*`, `TQR-*`, `KRK-*`, `EML-*` |
| API | HTTP / Hono RPC contract | Hono route/middleware/service | Hono, Zod, auth middleware contract, real DB where mutation | Auth/Provider simulator | Usually Yes | No | No | transport + provider + DB | method/status/envelope/auth/idempotency/postcondition | `API-*`, `AR-*`, `SEC-*`, domain rule |
| Database | PostgreSQL physical invariant | migration/schema/SQL transaction | real PostgreSQL with required extensions | none | Yes | No | No | SQLSTATE/lock/fault | constraint name, winner/loser, rollback, history | `DB-*`, `DI-030-*`, `INV-*` |
| E2E | user-visible journey / role UX | Browser + Next.js + Hono + DB | production Web/API build + real DB | Provider/Auth controlled adapter as allowed | Yes | Yes | Normally No | network/API controlled faults | visible state + API/DB authoritative outcome | `UF-*`, `PG-*`, critical `INV-*` |
| Security | security control enforcement | Web/API/config/provider boundary | production security code | attacker inputs / signer fixture | As needed | As needed | No by default | invalid token/signature/config | deny/fail-closed/no side effect/redaction | `SEC-*`, `AR-*` |
| Reliability / Recovery | retry/unknown/reconcile/stuck | service/worker/reconciliation | production worker/service + real DB | deterministic provider simulator | Yes | Optional | No | named Fault Point | same Cause/key, schedule, convergence/review | `REL-*`, `PAY-*`, `EML-*`, `OBS-REC-*` |
| Provider Contract Smoke | adapter assumptions against provider test environment | provider adapter only | production adapter | none | isolated nonprod support DB if required | No | Stripe/Resend/Supabase Auth test only | limited safe inputs | documented contract surface only | provider boundary rules |

**TST-GEN-003:** 同一Invariantを複数levelでTestしてよいが、最も低い再現可能なlevelに根本保証Testを置く。E2Eはcross-layer wiringを確認する補助保証とする。

**TST-GEN-004:** PostgreSQL constraint / lock / isolation / SQLSTATEをUnit mockで代替しない。

**TST-GEN-005:** Provider内部挙動をfakeの実装詳細として保証対象にしない。本システムが依存するrequest/response/correlation/failure modeだけをTest Double contractとする。

---

## 8. Canonical test source layout

RepositoryのTest source layoutは次を標準とする。

```text
src/
  ... production source ...

tests/
  unit/
  integration/
  api/
  db/
    migrations/
    constraints/
    transactions/
    concurrency/
  e2e/
  security/
  reliability/
  recovery/
  observability/
  provider-contract/
  fixtures/
    builders/
    webhook/
    provider/
    expected/
  harness/
    clock/
    random/
    fault/
    postgres/
    auth/
    stripe/
    resend/
    browser/
  traceability/
    test-manifest.json
```

Production source配下へTest-only HTTP endpointを置いてはならない。

**TST-GEN-006:** Fault injector、fake provider server、test clock admin control等はTest processからのみ到達可能なdependency injection / harnessとして実装し、Production route tableへ登録しない。

---

## 9. Test Case contract

各Test Caseはmachine-readable manifestまたはtest metadataとして最低限次を持つ。

```text
test_case_id
level
suite
upstream_rule_ids[]
system_invariant_ids[]
api_operation_ids[]
db_constraint_names[]
preconditions
fixture_ids[]
clock_instant
concurrency_seed|null
fault_points[]
expected_http|null
expected_domain_postconditions[]
expected_db_postconditions[]
expected_provider_postconditions[]
expected_observability[]
sensitivity_class
critical:boolean
```

**TST-TRC-001:** Test Caseは最低1つの上流Rule IDまたは本書Test Rule IDへ追跡できなければならない。

**TST-TRC-002:** Critical Testは対応するSystem Invariant / Security / Reliability / Audit ruleをmanifestへ明示する。

---

# Part II — Test Data / Determinism

## 10. Test data general policy

**TST-DAT-001:** Production DB dump、Production Provider export、Production Email list、Production QR、Production Session、Production logをfixtureに使用しない。

**TST-DAT-002:** Test dataは完全syntheticとし、PIIが必要な場合は `example.com`, `example.net`, `example.org` 等の予約用途domainを使用する。実人物名、実電話番号、実住所をfixtureへ必要なく含めない。

**TST-DAT-003:** Credential / API key / webhook secret / DB password / QR cryptographic keyの実値をrepositoryへcommitしない。通常Test用のsynthetic secretはruntimeに生成するか、明確なtest-only固定値をtest processのlocal scopeへ注入する。

## 11. Fixture naming / builders

Factory / fixture namingは次とする。

```text
build<Event|Profile|Order|Ticket|...>()       # persistence前のvalid object
insert<Event|Profile|Order|Ticket|...>()      # DBへcanonical row作成
fixture_<domain>_<state>_<purpose>             # reusable scenario
webhook_<provider>_<event>_<variant>           # raw signed webhook fixture
```

Builderはdefaultでvalid canonical objectを作り、invalid caseはoverrideで明示する。

Canonical fixture coverage:

- Event / Public Content
- Business Profile
- Role Assignment (`STAFF`, `ADMINISTRATOR`)
- Entry Ticket Offering / Sales Allocation
- Order / Order Item / Checkout Attempt / Payment Binding / Refund Record
- Entry Ticket / QR Token / Entry Check-in
- Karaoke Exclusive Scope / Slot / Hold / Reservation / Karaoke Ticket / Karaoke Check-in
- Goods / Inventory / Sales Allocation / Goods Order Item / Handoff
- Notification Request / Email Delivery Job / Delivery Attempt / webhook receipt
- Consistency Review Case
- Audit Event

**TST-DAT-004:** BuilderはInternal bigint IDを外部assertionのidentityへ使用しない。Browser/API assertionはPublic Referenceまたはcanonical business relationを用いる。

## 12. Public Reference / UUID

ProductionのPublic Reference生成は上流どおりCSPRNG-backed UUIDで維持する。

Testでは次のどちらかを使用する。

1. builderへ明示的なsynthetic UUIDを与える。
2. production generatorの出力をcaptureし、そのTest内で参照する。

UUID sequenceのglobal固定化でProduction random実装を置換してはならない。

**TST-DAT-005:** Test fixtureのPublic Referenceはcanonical lowercase UUIDとし、Internal IDと一致させない。

## 13. Clock / timezone

Canonical Test Clockはinjectable clock interfaceを使用する。

```text
clock.now(): Instant
clock.sleep_until(instant): awaitable  # production scheduler abstraction
TestClock.set(instant)
TestClock.advance(duration)
```

Default fixture instant:

```text
2027-01-15T03:00:00.000Z
= 2027-01-15T12:00:00+09:00 Asia/Tokyo
```

これは実Event開催日時を意味せず、Test用のsynthetic instantである。

**TST-DAT-006:** Time-dependent Testは実時間で30分、45分、1時間、23時間待機せずTest Clockをadvanceする。

**TST-DAT-007:** deadline / half-open intervalは `just-before`, `exact`, `just-after` の3点を最低限Testする。

**TST-DAT-008:** Karaoke日付 / bucket / check-in判定は`Asia/Tokyo` calendar boundaryを使用し、DB保存instantはUTCとしてassertする。

## 14. Money / quantity

- amountは最小通貨単位の整数 / API decimal stringでTestする。
- floating pointをexpected money計算に使用しない。
- `0`, `1`, boundary maximum practical fixture、quantity limit境界をTestする。
- Client supplied amount/currencyがauthorityにならないnegative caseを必須とする。

## 15. Random / QR

QR raw token generation、nonce、cryptographic keysはProduction contractを弱化しない。

**TST-DAT-009:** QR unit/integration Testではsecure-random portへtest implementationを注入して再現可能なbyte sequenceを返してよい。ただしproduction implementationがCSPRNGを利用するconfiguration testを別に持つ。

**TST-DAT-010:** raw QR token / raw QR payloadはfailed assertion message、snapshot、trace、screenshot、JUnit XML、CI annotationへ出力しない。QR assertion helperは`<redacted-qr>`を返す。

---

## 16. Database isolation

Database TestはSupabase PostgreSQL互換の**実PostgreSQL engine**を使用し、`pgcrypto` と `btree_gist` を有効化する。

Exact PostgreSQL major versionは `SPEC-180` がdeployed Supabase projectと一致するよう固定する。Test suiteはmajor mismatchを検出した場合にmigration/DB gating suiteをfailする。

Isolation strategy:

- Test run開始時にephemeral databaseを作る。
- migrationを0から適用する。
- workerごとに独立databaseを使用する。schema共有でparallel Testを分離しない。
- 1 Test内はtransaction rollbackを利用してよいが、COMMIT / concurrent transaction / advisory lock / migrationをTestするcaseは専用databaseで実commitする。
- cross-test row reuseを禁止する。

**TST-DB-001:** In-memory SQL implementation、SQLite、mock repositoryをPostgreSQL compatibility Testの代替にしない。

**TST-DB-002:** DB sessionは上流どおりUTC timezone、`READ COMMITTED`を明示確認する。

---

## 17. Provider Test Double contract

### 17.1 Stripe simulator

Stripe Test Doubleは少なくとも次を制御可能にする。

```text
checkout.create
checkout.retrieve
payment/checkout authority result
refund.create
refund.retrieve
idempotency same-key same-payload
idempotency same-key different-payload
429
5xx
definitive 4xx
latency
timeout before send
connection reset after request may have reached provider
provider accepted then local response lost
duplicate webhook
out-of-order webhook
invalid signature
stale/replayed timestamp
provider object lookup result
```

### 17.2 Resend simulator

```text
email.send
provider acceptance
same Provider Idempotency Key replay
same key different payload
429 clearly not accepted
5xx
timeout/reset -> UNKNOWN_RESULT
provider accepted then response loss
webhook delivered/bounced/failed
svix duplicate
unmatched webhook
invalid signature
stale timestamp
```

### 17.3 Supabase Auth simulator

```text
valid verified identity
email unverified
expired token
invalid signature / issuer / audience
identity missing
user lookup temporary failure
JWKS refresh success/failure
role/profile lookup independent DB failure
```

**TST-PRV-001:** SimulatorはProviderの内部queue、fraud engine、mail delivery network等を再現しない。

**TST-PRV-002:** Simulator responseはcaseごとに決定論的scriptで定義し、random failureを標準gating suiteへ導入しない。

---

## 18. Provider Contract Smoke

実Providerを利用するTestは標準Unit / Integration / API / E2Eから分離し、`provider-contract` suiteとする。

- Production credential禁止。
- Production data禁止。
- Stripe test mode / Resend test-safe recipient / dedicated nonproduction Supabase Auth projectのみ。
- destructive testはdedicated test entityだけへ作用する。
- Provider SLA、rate、delivery時間をpass条件にしない。
- Provider UI browser automationを標準contract smokeにしない。
- Network outageでcontract smokeが失敗しても、Unit / Integration evidenceを成功へ書き換えない。

**TST-PRV-003:** Deployment gateでProvider Contract Smokeを必須にする環境と頻度は`SPEC-180`が決定するが、Production release前の最終staging検証では実行可能でなければならない。

---

## 19. Webhook fixture

Webhook Test fixtureはraw bytes + signed headers + parsed expected envelopeを保持する。

- Stripe fixture: test webhook secretで署名。
- Resend fixture: test Svix secretで署名。
- raw bodyをJSON parseして再serializeした値では署名検証しない。
- duplicate / reordered deliveryでは同じProvider event identifierを再利用する。
- timestampはTest Clockへ連動させ、300秒toleranceの299秒 / 300秒 / 301秒境界をTestする。
- recorded production webhookをfixture化しない。

**TST-PRV-004:** Fixture fileへfull Email、raw QR、Production provider IDsを含めない。

---

# Part III — Fault Injection

## 20. Fault Point registry

Canonical Fault Pointを次とする。

```text
FP.DB.BEFORE_TRANSACTION
FP.DB.INSIDE_STATEMENT
FP.DB.BEFORE_COMMIT
FP.DB.AFTER_COMMIT_SENT_BEFORE_ACK
FP.PROVIDER.BEFORE_REQUEST
FP.PROVIDER.AFTER_REQUEST_MAY_HAVE_REACHED
FP.PROVIDER.AFTER_SUCCESS_BEFORE_DB_PERSIST
FP.WEBHOOK.BEFORE_RECEIPT_COMMIT
FP.BUSINESS_CONFIRMATION.MID_TRANSACTION
FP.AUDIT.BEFORE_INSERT
FP.AUDIT.INSERT_FAILURE
FP.EMAIL.BEFORE_CLAIM
FP.EMAIL.AFTER_CLAIM
FP.EMAIL.DURING_RESEND_CALL
FP.RECONCILIATION.BEFORE_ITEM
FP.RECONCILIATION.AFTER_AUTHORITY_READ
FP.RECOVERY.BEFORE_MUTATION
FP.RECOVERY.AFTER_PROVIDER_CALL
```

**TST-FLT-001:** Fault Pointは1回発火 / N回発火 / always failをTestから選択でき、発火回数をassert可能にする。

**TST-FLT-002:** Fault PointはProduction runtimeから設定変更できない。Production環境変数や公開HTTP endpointで任意failure injectionを有効化しない。

**TST-FLT-003:** Failure injection後は「失敗したこと」だけでなく、DB row、Provider call count、Business Cause、Provider idempotency key、Audit Event、Consistency Reviewのpostconditionをassertする。

---

# Part IV — Unit Test

## 21. Unit Test responsibility

Unit TestはDB / Browser / external networkを使わず、pure decisionとserialization/validationを高速に検証する。

必須対象:

- pure Domain decision / state transition predicate
- Zod request / response / fixture schema
- amount / currency calculation
- order item total calculation
- owner/capability decision helperのpure portion
- Karaoke 15分 + 5分、half-open interval計算
- Hold / Payment Deadline / Safety Buffer predicate
- QR format parserのnon-secret parsing portion
- Email render context validation
- Notification Business Cause generation
- failure classification
- retry eligibility
- retry backoff / full jitter cap calculation（random source固定）
- safe redaction / masking
- structured log schema
- Metric label allowlist / reason category mapping
- Alert evaluation function
- HMAC correlation fingerprint deterministic behavior

**TST-UNT-001:** Unit Testでconstraint / transaction / Provider acceptanceを「保証済み」としない。

**TST-UNT-002:** HMAC correlation fingerprintは同一key/version/inputで同じ32文字lowercase hexとなり、domain separationが異なれば異なることをTestする。HMAC-SHA-256、先頭16 bytes truncationをknown vectorで検証する。

**TST-UNT-003:** Redaction TestはAuthorization/Cookie、access/refresh token、Stripe/Resend secret、DB connection string、raw QR、full Email、provider raw body、SQL bindをinputへ含めてもoutputへ出ないことを検証する。

---

# Part V — Database / Integration Test

## 22. Migration Test

Migration Testは空DBから全migrationを順番に適用し、次をassertする。

1. `app` schemaが存在する。
2. `pgcrypto`, `btree_gist` が使用可能。
3. expected table / column / type / default / nullabilityが存在。
4. named PK / FK / UNIQUE / partial UNIQUE / CHECK / EXCLUDE / indexが存在。
5. `app.audit_events` migrationがSPEC-160どおりappend-only access modelを構成する。
6. migrationを二重適用するのではなく、migration historyに従い1回だけ適用される。
7. migration失敗時にservice schema versionを成功扱いしない。
8. supported previous released schema fixtureからforward migrationしてhistorical rowを失わない。

**TST-DB-003:** Down migrationをProduction rollback authorityとして要求しない。Deployment rollbackのschema compatibilityは`SPEC-180`が定義する。

## 23. Constraint Test

最低限、次のphysical invariantを実PostgreSQLでTestする。

- PK duplicate rejection
- FK orphan rejection
- `public_ref` uniqueness
- state CHECK
- quantity / amount / counter CHECK
- active Role partial unique `ux_role_assignments_profile_role_active`
- active Checkout binding `ux_payment_bindings_order_active`
- live full Refund `ux_refund_records_order_live_full`
- active Entry/Karaoke QR token partial unique `ux_qr_tokens_entry_active`, `ux_qr_tokens_karaoke_active`
- Karaoke occupancy EXCLUDE `ex_karaoke_slots_scope_occupancy`
- active Karaoke Hold `ux_karaoke_holds_slot_active`
- source-to-entitlement unique relation / ticket issuance ordinal unique
- webhook event dedupe unique
- Notification business cause unique
- Resend `provider_event_key` unique
- Goods / Entry allocation uniqueness and safe counters

**TST-DB-004:** Constraint loserはconstraint名を取得してexpected `CONFLICT_LOSER` / duplicate / consistency classificationへmapできることをAPI/Integration Testと組み合わせて検証する。

## 24. Transaction / lock Test

実connectionを2本以上使用し、少なくとも次をTestする。

- `READ COMMITTED` visible-state semantics
- `SELECT ... FOR UPDATE` serializes same resource mutation
- role last-administrator advisory lock
- `FOR UPDATE SKIP LOCKED` Email claim
- transaction rollbackでcounter / Order / Ticket / Audit rowが残らない
- `40001` retry path
- `40P01` deadlock retry path
- 1秒`lock_timeout`
- 5秒normal `statement_timeout` contractに対するapplication mapping
- 2秒pool acquisition timeout mapping
- COMMIT acknowledgement loss

`40001` / `40P01`を自然発生に任せず、transaction ordering / test hookで再現する。

**TST-DB-005:** `23505`, `23P01`, `23514`, `23503`をblind retryするTest expectationを作らない。current stateとconstraint名で分類する。

**TST-DB-006:** historical rowのnormal hard delete APIが存在しないこと、repositoryがfinancial / entitlement / check-in / role / audit historyを通常削除しないことをTestする。

## 25. Audit DB atomicity

**TST-DB-007:** Role grant/revoke、QR rotation、Karaoke Reservation cancellation、Inventory adjustment、Goods Handoff、Entry/Karaoke Check-in、Public Content publish/archive、Notification cancel等のlocal high-risk mutationはBusiness effectとrequired Audit Eventを同一transactionでcommitする。

**TST-DB-008:** `FP.AUDIT.INSERT_FAILURE` でAudit insertを失敗させ、Business mutationがrollbackしsuccess responseが返らないことをTestする。

**TST-DB-009:** `app.audit_events` へのruntime principalのUPDATE / DELETEが拒否され、INSERTだけが許可されることをDB privilege Testで検証する。

---

# Part VI — API Test

## 26. API contract common matrix

`SPEC-110` / `SPEC-120` の現行API operationごとに、該当する項目をTestする。

- exact method / path
- path/query/body Zod validation
- JSON snake_case
- success envelope / common error envelope
- HTTP status
- safe error code
- `request_id` response header / error body一致
- Internal bigint ID非露出
- Public Reference wire format
- timestamp `Z` format
- money decimal string
- Authentication requirement
- email verified requirement
- Ownership / Capability
- role current re-evaluation
- Staff != Administrator
- transport `Idempotency-Key` contract
- error redaction
- response size / body limit where relevant
- Webhook raw-body boundary

**TST-API-001:** API TestはHono route tableをenumerateし、documented current routeとの差分を検出するcontract testを持つ。UCR-only routeはexpected catalogへ入れない。

**TST-API-002:** Protected routeはClient supplied `user_id`, `profile_id`, role, owner, price, payment resultをauthorityへ使用しない。

**TST-API-003:** owner-safe lookupは別UserのPublic Referenceを入力した場合に対象dataを返さず、上流error disclosure ruleを守る。

## 27. Current Operation coverage

Operation IDが明示されているcurrent operationsは100% API contract Test対象とする。少なくとも次のcatalogを含む。

```text
API-AUTH-001..004
API-PUB-001..011
API-PUR-ENTRY-001
API-PUR-KRK-001
API-PUR-GDS-001
API-CHK-001
API-ORD-001..003
API-WHK-001
API-TKT-001..003
API-KRK-SELF-001..004
API-GDS-SELF-001..002
API-STF-CHK-001..002
API-STF-GDS-001
API-ADM-ORD-001..002
API-ADM-TKT-001..002
API-ADM-KRK-001..007
API-ADM-GDS-001
API-ADM-REC-001..002
API-ADM-PAY-001
API-ADM-TQR-001
API-WHK-EML-001
API-ADM-EML-001..005
```

Public Content / Goods manage / Role Assignment manageのOperation ID未付与routeはmethod/path単位でTestし、`UCR-170-001`反映後にOperation ID manifestへ移行する。

## 28. Transport Idempotency

最低限次を共通contractとする。

1. same Principal + Operation + normalized request + same key -> existing transport resultへ収束。
2. same key + different normalized request -> `409 IDEMPOTENCY_KEY_REUSED`。
3. different Transport keyでも同一Domain Business Causeならcritical duplicate effectを作らない。
4. `request_id`変更はDomain duplicate許可理由にならない。
5. idempotency persistence障害時もDB unique / Business Causeでcritical duplicateを防ぐ。

**TST-IDM-001:** Transport Idempotency、Domain Business Cause、Provider Idempotency、Webhook Event dedupe、Ticket consume-once、Goods Handoff one-time、Notification Business Cause、Consistency Review dedupeを別々のTest Caseとして持つ。

---

# Part VII — Authentication / Authorization Test

## 29. Authentication

必須Case:

- Guest -> protected deny
- verified Session -> allowed when other preconditions pass
- email unverified -> deny
- expired token -> deny
- invalid signature / issuer / audience -> deny
- Auth service unavailable / JWKS unavailable -> Fail Closed
- logout / revoked session -> deny
- Business Profile missing / ambiguous -> no privilege inference
- current Role re-evaluation after grant/revoke

**TST-AUTH-001:** Authentication failure時にcached Browser UI roleやClient role claimでmutationを継続しない。

## 30. Authorization / role / ownership

- CustomerはOperational Roleではない。
- StaffはAdministrator capabilityを得ない。
- AdministratorはStaffを自動継承しない。
- owner mismatchはIDORとして拒否。
- Role Assignment create/revokeは`role_assignment.manage`とcurrent stateを再評価。
- last Administrator revokeはadvisory lock下で拒否。
- same Role create concurrencyは1 active assignmentへ収束。
- role revoke concurrencyでもactive Administrator countが0にならない。

**TST-AUTH-002:** AuthorizationをUI hidden stateだけでTest完了としない。Hono API直接requestでも拒否されることをassertする。

---

# Part VIII — Payment / Refund Test

## 31. Order / purchase start

Entry / Karaoke / Goodsそれぞれで次をTestする。

- Auth / verified Email / Profile
- server-side price / currency
- sale period / capacity / inventory / slot current state
- Allocation / Hold + Order `PREPARED` atomicity
- external Checkout前にOrderが存在
- failure rollback
- same Business Cause retry

**TST-PAY-001:** Client price / currencyを改ざんしてもStripe requestはOrder Item Snapshotから生成される。

## 32. Checkout / Payment Confirmation

- Checkout create success -> Payment Binding persistence -> `AWAITING_PAYMENT`
- Browser returnだけでは`CONFIRMED`にしない
- duplicate success webhook
- out-of-order webhook
- same Order confirmation concurrency
- Entitlement generation + Order `CONFIRMED` atomicity
- confirmation mid-transaction fault -> all rollback
- replay後にexactly-once entitlement

**TST-PAY-002:** Payment AuthorityとOrder amount/currency mismatchはBusiness ConfirmationせずConsistency Failureへ分類する。

## 33. Refund

- full refund only
- required authorization / idempotency
- duplicate/live refund partial unique
- provider success
- definitive reject
- timeout / response loss -> `UNKNOWN_RESULT`
- same Provider idempotency key維持
- unknown後のblind second Refund禁止
- provider authority lookupでsafe resolution
- Domain cancellationとの責務分離

**TST-PAY-003:** Financial Refund successだけでTicket / Reservation / Goods stateを本書から推測変更しない。

---

# Part IX — Ticket / QR / Check-in Test

## 34. Ticket issuance

- `CONFIRMED`前にTicketを発行しない
- Entry quantity unitごと最大1Ticket
- Karaoke Reservationごと最大1Karaoke Ticket
- duplicate confirmationで追加Ticketなし
- cancellation / expiry state rule

## 35. QR

必須Case:

- canonical payload parse
- Entry/Karaoke purpose separation
- malformed
- unknown token
- wrong purpose
- revoked token
- unknown key version
- current + explicitly allowed previous key version
- crypto authentication failure
- key unavailable -> Fail Closed
- Owner-safe QR display
- used/canceled/expired Ticketへactive QR提供しない
- rotationでold active revoke + new active 1件
- Admin responseへnew raw token非露出

**TST-TQR-001:** QR Test artifactにraw tokenを残さない。failure messageはToken fingerprintまたは`<redacted-qr>`だけを使用する。

## 36. Check-in

Entry / Karaoke両方で:

- Staff auth/capability
- `VALID -> USED` + immutable Check-in atomicity
- duplicate scan -> existing result
- concurrent scan winner 1 / loser convergence
- response loss -> rescanでexisting result
- canceled/expired/used rejection
- Karaoke time window just-before/exact/just-after
- DB failure -> no partial `USED` or Check-in
- consistency mismatch -> no second consume

---

# Part X — Karaoke Test

## 37. Slot time / generation

**TST-KRK-001:** Standard Slotは利用15分 + 整備5分、Occupancy `[usage_start, cycle_end)`を維持する。

Test:

- `usage_start < usage_end <= cycle_end`
- half-open boundaryで`A.cycle_end == B.usage_start`はoverlapしない
-同一Scope overlapはGiST exclusionで拒否
- different Scope same timeは許可
- Slot generation exact-match reuse
- batch内 / existing rowとのnon-identical overlap -> entire batch rollback
- `SALES_STOPPED` / `SOLD`もoverlap検査対象

## 38. Hold / Payment time

- Hold acquire -> 45分
- Checkout activation -> Payment Deadline 30分
- Holdに5分Safety Bufferが残る関係
- concurrent Hold winner/loser
- exact expiry boundary
- expired Hold release
- Payment unknown中のpremature resale禁止
- late payment authority handling
- Reservation confirmation
- Reservation cancellation後Slot `SOLD`維持
- no resale
- Karaoke Ticket relation

**TST-KRK-002:** 取消後Slotを`AVAILABLE`へ戻すTest expectationを禁止する。

---

# Part XI — Goods Test

## 39. Allocation / Inventory

- sales allocation acquire
- current inventory counter
- capacity boundary
- concurrent purchase winner/loser
- allocation release on terminal unpaid outcome
- purchase confirmation commit
- invalid negative adjustment rejection
- held + committedを破壊するadjustment拒否
- aggregate mismatch -> Consistency Review

## 40. Handoff

- eligible Goods Item / Handoff precondition
- Staff authorization
- `PENDING -> COMPLETED`
- duplicate / parallel completion -> one effect
- response loss -> existing result
- `VOID` / non-fulfillable rejection
- Refund financial lifecycleとHandoff responsibilityを混同しない

**TST-GDS-001:** different Transport Idempotency Keyによるparallel Handoffでも1 completionへ収束する。

---

# Part XII — Notification / Resend Test

## 41. Notification generation

- deterministic Notification Business Cause
- duplicate source event -> 1 Notification Request
- missing Notification Request detection / repair
- source Business TransactionはEmail失敗でrollbackしない
- recipient authority = Profile -> Auth Subject -> Supabase Auth
- recipient snapshot / revision
- render context Zod validation
- Email body非永続化

## 42. Email claim / worker

- `READY` / `UNKNOWN_RESULT` queue eligibility
- `FOR UPDATE ... SKIP LOCKED`
- `CLAIMED` lease 120秒
- parallel worker claim winner 1
- claim expiry before provider call -> safe READY recovery
- claim expiry after `provider_called_at` -> `UNKNOWN_RESULT`
- no nested retry

## 43. Resend result

- acceptance -> `SENT`
- 429 clearly not accepted -> retryable/new Delivery Attempt per upstream
- 5xx / timeout / reset -> `UNKNOWN_RESULT`
- same Attempt / same Provider Idempotency Key
- provider acceptance after local response loss
- same key different payload -> blocked/review
- `SENT` blind resend禁止
- 23時間safe cutoff
- manual retry preconditions
- cancel only unsent/non-in-flight

## 44. Resend webhook

- raw-body signature
- required Svix headers
- 300秒tolerance
- verified `svix-id` UNIQUE dedupe
- duplicate webhook no duplicate Domain effect
- unmatched webhook tracking
- invalid signature no state change
- out-of-order delivery event

**TST-EML-001:** Production Email address / Provider IDをfixtureに入れない。

---

# Part XIII — Security Test

## 45. Browser / API security

必須Case:

- HTTPS / security headers configuration validation
- CSPにscript `unsafe-inline` / `unsafe-eval`がない
- XSS payloadがplain text escaped rendering
- Admin previewも同renderer
- no `dangerouslySetInnerHTML` public content path
- protected route `Cache-Control: no-store, private`
- continuationはrelative same-originだけ
- hostile Host / forwarded hostをabsolute URL authorityにしない
- `javascript:` / `data:`等dangerous scheme拒否
- authenticated Browser mutationは256-bit CSRF cookie/header一致 + exact Origin
- CSRF/Origin failure -> Hono mutation未実行
- credentialed wildcard CORS禁止
- preflightでBusiness action非実行

## 46. Database / injection / secrets

- Drizzle parameterization
- allowlisted identifier / filter / sort
- raw SQLへClient identifierを連結しない
- SQL injection payloadでquery structureが変わらない
- runtime DB principal least privilege
- Browser direct DB mutation credential不存在
- required Secret missing -> not Ready / Fail Closed
- Production SecretがClient bundle/source map/logへ出ない
- Production/nonproduction secret separation

## 47. Webhook / QR / privileged security

- Stripe raw body signature + 300秒timestamp tolerance
- Resend raw body signature + 300秒timestamp tolerance
- invalid/replay -> no Business state mutation
- QR key unavailable / unknown version / AEAD auth failure -> Fail Closed
- Staff scanner raw payload persistent storageなし
- Admin/Staff least privilege
- high-risk operation requires current Role / Capability / precondition / idempotency
- last Administrator protection
- rate limit 429でDomain state変更なし
- error responseへstack/SQL/provider body/Secret非露出

**TST-SEC-001:** Security dependency failure時にAvailability目的のbypassを有効にしないことをFault Injectionでassertする。

**TST-SEC-002:** `SECURITY_FAILURE`はProduct retry対象のtemporary failureと同一視せず、Security Controlが安全に回復するまでmutationを行わない。

---

# Part XIV — Reliability / Unknown Result / Recovery Test

## 48. Failure classification

次の7 classをtable-driven Testする。

```text
SUCCESS
TEMPORARY_FAILURE
PERMANENT_FAILURE
UNKNOWN_RESULT
CONFLICT_LOSER
CONSISTENCY_FAILURE
SECURITY_FAILURE
```

入力failure、retry eligibility、same Business Cause、same Provider key、新Attempt可否、Review要否を`SPEC-150`と一致させる。

## 49. Timeout / retry

Testは `SPEC-150` の値を再定義せず、そのままexpectationに使用する。

| Area | Canonical expectation to test |
|---|---|
| Auth remote | 3秒/call |
| DB pool acquire | 2秒 |
| normal DB statement | 5秒 |
| Admin/reconciliation read | 10秒 |
| DB lock wait | 1秒 |
| Business DB transaction wall clock | 8秒 |
| Stripe API | 10秒 |
| Resend API | 10秒 |
| Email claim | 120秒 |
| reconciliation item | 15秒 |
| webhook soft/hard | 6秒 / 8秒 |
| Admin manual recovery | 15秒 |

Retry matrixも `REL-RTY-*` のinitial / multiplier / max / jitter / attempts / elapsedをtable-drivenに検証する。次はTest oracleとして `SPEC-150` をmirrorする。

| Retry class | Initial | Multiplier | Max delay | Jitter | Max automatic attempts | Max elapsed | Exhausted |
|---|---:|---:|---:|---|---:|---:|---|
| DB `40001` | 50ms | 2 | 400ms | full | 4 transaction attempts total | 2s | 503 |
| DB `40P01` | 100ms | 2 | 800ms | full | 4 total | 3s | 503 |
| DB connection acquisition | 100ms | 2 | 500ms | full | 3 connection attempts | 3s | 503 |
| Supabase Auth temporary | 100ms | 2 | 500ms | full | 2 remote attempts | 7s | 503 / worker reschedule |
| Stripe Checkout create/recovery | 500ms | 2 | 5s | full | initial + 4 same-key | 30s | Unknown / Review path |
| Stripe read-only lookup | 250ms | 2 | 2s | full | 4 | 15s | scheduled reconciliation |
| Refund provider write | 1s | 2 | 5s | full | initial + 2 same-key | 20s | stop writes; read-only reconcile |
| Stripe verified webhook processing | 5s | 2 | 5m | full | 6 internal | 30m | Review |
| Resend 429 clearly not accepted | 30s | 2 | 10m | full | 8 new Delivery Attempts | 45m | BLOCKED / Admin retry |
| Resend 5xx/timeout/reset | 30s | 2 | 30m | full first phase | 8 same-key probes | 4h | long reconciliation |
| Resend Unknown long phase | 1h | fixed | 1h | ±10% | 18 same-key probes | 22h from first call | BLOCKED before 23h |
| Notification recipient Auth lookup | 30s | 2 | 15m | full | 10 | 2h | BLOCKED |
| Abandoned Email claim before provider call | 30s | 2 | 5m | full | 3 recoveries | 15m | BLOCKED + Review |
| Resend webhook DB failure | 5s | 2 | 5m | full | 6 | 30m | Review |
| Reconciliation transient read | 30s | 2 | 10m | full | 6 | 1h | manual/review |

**TST-REL-001:** Provider SDK retryとapplication retryを同時に有効化しないconfiguration Testを持つ。

**TST-REL-002:** retry layerは1 logical operationにつき最大1層であることをcall-count assertionで検証する。

## 50. Provider Result Unknown

必須Fault scenarios:

1. Stripe Checkout create request may have reached provider then timeout。
2. Refund provider accepted then response loss。
3. Resend timeout / reset / 5xx。
4. DB COMMIT sent then acknowledgement loss。
5. Provider success then DB persistence failure。

各scenarioで共通assert:

- `UNKNOWN_RESULT`として扱う。
- new Business Causeなし。
- new Provider Idempotency Keyなし。
- duplicate Refund / Checkout / Email sendなし。
- current Business Database state / Provider Authorityをread-only reconcileする。
- resolution可能ならexisting resultへ収束。
- resolution不能ならConsistency Review / manual boundary。

**TST-REL-003:** `UNKNOWN_RESULT`中にdifferent Transport keyで同一critical operationを実行しても別Business Causeを作らない。

## 51. Reconciliation matrix

`SPEC-150`のcanonical reconciliation対象をすべてTest responsibilityへ含める。次はTest oracleとしてstuck threshold / cadenceをmirrorする。

| Target | Testするthreshold / cadence | Automatic action expectation |
|---|---|---|
| Order `PREPARED` | created >5m, every 2m | provider未開始かつexpiry明確時のみ上流terminal処理 |
| Checkout Attempt `UNKNOWN` | immediate, every 1m, max 30m | same-key result / Binding recovery |
| Order `AWAITING_PAYMENT` | Payment Deadline +5m, every 5m | authoritative unpaid時のみexpiry/release |
| Order `REVIEW_REQUIRED` | every 15m, 2h boundary | authority一意なら上流許可transition |
| Stripe Webhook `FAILED_RETRYABLE` | every 1m | same event reprocess; 30m/6 attemptsでReview |
| Stripe Webhook `REVIEW_REQUIRED` | every 15m | authority一意時だけrepair |
| Refund `REQUESTED/PENDING` | every 2m; first 30m | provider state sync |
| Refund later phase | 30m..6h every 30m | 6hでautomatic lookup停止 |
| Confirmed Order entitlement completeness | every 5m | auto entitlement creation禁止、Case |
| Ticket / Check-in consistency | every 10m | mismatchはCase |
| Karaoke Hold expired | every 1m | unpaid certainty時だけrelease/expire |
| Reservation / Karaoke Ticket | every 10m | mismatchはCase |
| Goods Allocation / counter | every 10m | terminal HELD releaseのみ |
| Goods Handoff consistency | every 10m | already-completed convergenceのみ |
| Missing Notification Request | every 5m | deterministic補完のみ |
| Email `UNKNOWN_RESULT` | worker eligibility 15s + retry phase | same-key reconcile |
| Expired Email claim | every 30s | provider call有無でREADY/UNKNOWN_RESULT分岐 |
| Unmatched Resend webhook | every 10m, max 1h | correlation found時のみapply |
| QR key migration incomplete | every 10m | decrypt+rewrap可能rowのみ |

各reconciliation Testは`before state -> authority input -> action/no-op -> after state -> observability`をassertする。Consistency Reviewのdedupe / resolve / recurrenceも同じCase familyに含める。

## 52. Automatic repair

**TST-REC-001:** Automatic repairはcurrent authorityとInvariantから一意に決まる場合だけstate-changing repairを行う。

**TST-REC-002:** Automatic repairがBusiness stateを変更した場合、`RECOVERY_EXECUTION` Audit Event、`actor_type=SYSTEM_WORKER`、Recovery Execution ID、concrete `recovery_kind`、post-verification resultをassertする。

**TST-REC-003:** read-only reconciliation / no-opはAudit Eventを不要に量産せず、Application Log / Metric contractを満たす。

## 53. Manual recovery

現行Canonical APIで実行可能なmanual recoveryのみTestする。

- full Refund request
- QR token rotation
- Karaoke Normal Cancellation
- Notification retry / cancel
- Consistency Review read / operator decision support
- emergency Administrator bootstrap/recoveryはinfrastructure-controlled runbook boundary

`UCR-150-001/002`が未反映のため、Checkout Unknown reconcile、Payment Confirmation dedicated reconcile、Refund Result dedicated reconcile、Notification Unknown dedicated reconcile、Case re-evaluate mutationを現行API testとして発明しない。

**TST-REC-004:** `UCR-150-001`が将来SPEC-110へ反映された時点で、追加Recovery commandごとにauthorization、15秒deadline、same Cause/key、unknown result、Audit Event、current authority、no generic state inputを必須Testとして追加する。

## 54. Emergency last Administrator recovery

- normal APIでlast Administrator revokeを拒否。
- active Administrator=0のemergency pathはnormal role APIをbypassするgeneric SQLではなく、`SPEC-150` / `SPEC-160` / `SPEC-180`が定めるinfrastructure-controlled recovery boundaryとしてTestする。
- before/after active Administrator count。
- target Profile。
- infrastructure operator safe ref。
- `EMERGENCY_ADMIN_RECOVERY` Audit Event。
- raw DB superuser credentialをTest artifactへ出さない。

---

# Part XV — Audit / Observability Test

## 55. Structured Log

Structured log schema Testは最低限次をassertする。

Required common/conditional field manifest:

```text
timestamp
level
event_name
service
environment
deployment_ref
request_id
operation_id
operation_execution_id
actor_type
actor_ref
target_type
target_ref
result
failure_class
error_code
duration_ms
attempt_number
is_retry
business_cause_ref
transport_idempotency_fp
provider
provider_event_ref
provider_object_ref
provider_idempotency_fp
consistency_review_ref
recovery_execution_id
query_name
http_method
http_route
http_status
schema_version
```

- required / conditional nullabilityが`SPEC-160`のfield contractと一致する
- UTC millisecond timestamp
- allowed level
- canonical event naming
- service / environment
- `request_id`
- Operation ID / Operation Execution ID
- actor / target safe refs
- failure class / reason code
- provider correlation allowlist
- no automatic request/response body dump
- no SQL / bind dump
- sanitized stack trace
- no raw Email / QR / token / Secret

**TST-OBS-001:** Log schemaに未allowlist fieldを渡した場合はdropまたはvalidation failureとし、arbitrary object spreadでserializeしない。

## 56. Correlation

- `request_id`はHTTP chainで一致するがBusiness authorityではない。
- Transport / Stripe / Resend Idempotency Keyはrawでlogしない。
- HMAC-SHA-256 domain separation。
- first 16 bytes truncation。
- lowercase 32 hex。
- Production/nonproduction別 `OBS_CORRELATION_HMAC_KEY`。
- key version違いをraw input保存で跨がない。

**TST-OBS-002:** raw idempotency keyをlog captureへ含め、全sink outputから不存在をassertするnegative Testを持つ。

## 57. Audit Event

`app.audit_events`について:

- append-only
- runtime UPDATE / DELETE禁止
- 100% unsampled
- actor/role/capability/operation/target
- request / execution / Business Cause correlation
- before/after allowlist
- full row JSON禁止
- manual recovery
- automatic state-changing recovery
- emergency Administrator recovery
- concrete `recovery.exception.execute` recovery kind

**TST-OBS-003:** required local high-risk mutationでAudit insert failure -> Business mutation rollback。

**TST-OBS-004:** Provider call後のAudit/result persistence failure -> new Provider call/keyなし、Unknown/reconciliationへ移行。

**TST-OBS-005:** denied privileged operationはDB available時にsafe Audit Eventを残し、DB unavailable時もoperation自体はFail Closedする。

## 58. Metric / cardinality

Canonical metric name / type / labelsをschema testする。

- `r39x_` prefix
- Counter `_total`
- duration Histogram `_seconds`
- Gauge current/age semantics
- routeはroute template
- operation / queryはsource-controlled registry
- forbidden high-cardinality labelsを拒否
- Gauge source query failureをzeroへ偽装しない

Forbidden label negative Testは少なくとも次を入力する。

```text
request_id
operation_execution_id
order_ref
ticket_ref
reservation_ref
profile/auth subject
email
provider IDs
idempotency key/fingerprint
raw error
raw URL
raw QR
consistency_review_ref
recovery_execution_id
```

**TST-OBS-006:** Metric label validatorがforbidden labelを受けた場合gating Testをfailし、silent label emissionを許さない。

## 59. Alert evaluation

`OBS-ALT-001〜037` の全ruleをsynthetic time series / event sequenceでtable-driven Testする。次の表はTest oracleとして `SPEC-160` のCanonical条件をmirrorするものであり、値のCanonical Ownerは `SPEC-160` のままである。

| Alert | Synthetic oracle | Window / minimum | Severity |
|---|---|---|---|
| `OBS-ALT-001` | HTTP 5xx rate >= 5% | 10m, >=100 requests | HIGH |
| `OBS-ALT-002` | HTTP 5xx rate >= 20% | 5m, >=50 requests | CRITICAL |
| `OBS-ALT-003` | DB unavailable + pool acquire failure >=3 | 2m | CRITICAL |
| `OBS-ALT-004` | transaction retry exhausted >=5 | 10m | HIGH |
| `OBS-ALT-005` | Auth/JWKS availability failures >=5 | 5m | HIGH |
| `OBS-ALT-006` | Stripe temporary/unknown rate >=20% | 5m, >=10 calls | HIGH |
| `OBS-ALT-007` | oldest Payment/Checkout unknown >10m | 2 consecutive 1m | HIGH |
| `OBS-ALT-008` | oldest Checkout unknown >=30m | 1 evaluation | CRITICAL |
| `OBS-ALT-009` | oldest Refund unknown >30m | 2 consecutive 5m | HIGH |
| `OBS-ALT-010` | Refund unresolved >=6h | 1 evaluation | CRITICAL |
| `OBS-ALT-011` | verified Stripe webhook failed-retryable >=5 | 5m | HIGH |
| `OBS-ALT-012` | verified Stripe/Resend webhook enters consistency review | 1 event | HIGH |
| `OBS-ALT-013` | QR key/decrypt/digest failure | 1 event | CRITICAL |
| `OBS-ALT-014` | Production not Ready due security config | 1 readiness evaluation | CRITICAL |
| `OBS-ALT-015` | Ticket/Check-in consistency failure | 1 event; 3/10m escalates | HIGH -> CRITICAL |
| `OBS-ALT-016` | stuck/payment-uncertain Karaoke Hold >=1 continuously | 10m after stuck predicate true | HIGH |
| `OBS-ALT-017` | same Karaoke reconciliation fails 3 consecutive runs | `max(3 × cadence,10m)` | HIGH |
| `OBS-ALT-018` | unresolved Goods inventory inconsistency >=1 | continuous 5m | HIGH |
| `OBS-ALT-019` | Email claim expiry >=5 | 10m | HIGH |
| `OBS-ALT-020` | oldest Email unknown >1h | 2 consecutive 5m | HIGH |
| `OBS-ALT-021` | oldest Email unknown >=21h | 1 evaluation | CRITICAL |
| `OBS-ALT-022` | missing Notification Request >=1 | continuous 10m | HIGH |
| `OBS-ALT-023` | oldest unresolved Review >2h | continuous 10m | HIGH |
| `OBS-ALT-024` | oldest unresolved Review >6h | 1 evaluation | CRITICAL |
| `OBS-ALT-025` | reconciliation last success age > `max(3 × cadence,5m)` | 2 consecutive 1m | HIGH |
| `OBS-ALT-026` | same recovery kind failure >=3 | 30m | HIGH |
| `OBS-ALT-027` | webhook signature rejected >=50 | 5m | HIGH Security |
| `OBS-ALT-028` | auth failure >=100 | 5m | MEDIUM Security |
| `OBS-ALT-029` | authorization denial >=25 | 5m | MEDIUM Security |
| `OBS-ALT-030` | CSRF rejection >=20 | 5m | HIGH Security |
| `OBS-ALT-031` | HTTP 429 >=100 OR >=20% | 5m; rate branch >=100 requests | MEDIUM Security |
| `OBS-ALT-032` | invalid/wrong-purpose/revoked QR >=20 | 5m | MEDIUM Security |
| `OBS-ALT-033` | privileged Admin/Staff denial >=10 | 10m | HIGH Security |
| `OBS-ALT-034` | last Administrator protection activation >=1 | 1 event | MEDIUM Security |
| `OBS-ALT-035` | required Audit insert failure | 1 event | CRITICAL |
| `OBS-ALT-036` | log/metric export failures >=10 | 10m | MEDIUM |
| `OBS-ALT-037` | alert delivery failure >=1 | 1 event | HIGH |

各Alert Testは次を含む。

- threshold未満 -> closed
- threshold exact / above
- evaluation window
- minimum count
- consecutive evaluation requirement
- dedupe key
- open notification 1回
- cooldown
- resolve after one full false window
- severity escalation bypass 1回
- staging/testがProduction pageしない

Cooldown:

```text
CRITICAL unresolved repeat <= 1 / 60 minutes
HIGH unresolved repeat <= 1 / 4 hours
MEDIUM automatic repeat = none
```

`OBS-ALT-038`に従い、normal `CONFLICT_LOSER`、verified duplicate webhook、idempotent already-completed、ordinary single invalid QRは単独pageしない。

**TST-OBS-007:** `OBS-ALT-037` Alert delivery failureはprimary alert delivery経路とは独立したhealth pathで検知可能であることを`SPEC-180` deployment integration Testへ引き渡す。

## 60. Sampling / retention / environment

Sampling Test:

- Audit / ERROR / WARN / UNKNOWN / CONSISTENCY / SECURITY / Review / recovery / high-risk mutationはdropされない。
- normal successful high-volume read INFOは`request_id`由来SHA-256 deterministic 5%。
- HTTP metric countは100%。
- Production DEBUG default disabled。
- emergency DEBUGは最大60分 / 10% sampling / redaction維持。

Retention configuration TestはInfrastructure configを検査する。

```text
INFO 30d
DEBUG 7d
WARN/ERROR 90d
Security 180d
Audit 730d
Metrics 400d
Alert/incident metadata 730d
temporary support copy <=7d
```

Environment values:

```text
production
staging
development
test
```

**TST-OBS-008:** Productionとnonproductionのlog dataset、metric/alert dimension、Audit data、Provider identifier、correlation HMAC key、Security Event datasetが分離されることを`SPEC-180` integration gateへ接続する。

---

# Part XVI — Concurrency / Race Test

## 61. Concurrency harness

Concurrency Testは逐次loopではなく、複数独立DB connection / requestを**barrierで同時release**する。

Canonical harness:

```text
prepare N participants
open independent connections/HTTP clients
wait at Barrier A
release simultaneously
optionally pause winner at Fault Point / lock point
collect all outcomes
query authoritative DB state with fresh connection
assert winner count, loser class, final rows, side-effect call count
```

Default participant counts:

- binary race: `N=2`
- hot contention: `N=8`
- worker claim: `N=8`

Critical concurrency Testはbinary raceを毎CI run、hot contentionをnightly / pre-release gatingでも実行する。`SPEC-180`がpipeline cadenceへ接続する。

**TST-CON-001:** Concurrency Testはsleep timingだけに依存せずbarrier / lock hookでrace windowを決定論的に作る。

**TST-CON-002:** loserが正常競合であるcaseは`CONFLICT_LOSER`またはexisting resultへ分類し、500 expectationにしない。

## 62. Mandatory concurrency cases

| Test Case | Concurrent target | Winner / loser assertion | Final convergence |
|---|---|---|---|
| `TC-CON-ENTRY-001` | same Entry capacity last unit | capacity内winnerのみ | held+committed<=capacity |
| `TC-CON-ORDER-CFM-001` | same Order confirmation | 1 logical confirmation | 1 entitlement set / `CONFIRMED` |
| `TC-CON-CHECKOUT-001` | same Checkout activation | 1 active binding | same Checkout/business cause |
| `TC-CON-KRK-HOLD-001` | same Karaoke Slot Hold | 1 Hold winner | Slot `HELD`, 1 active Hold |
| `TC-CON-KRK-GEN-001` | overlapping Slot generation | exact reuse or one conflict loser | no overlap |
| `TC-CON-ENTRY-CHK-001` | same Entry Ticket check-in | 1 consume | 1 immutable Check-in |
| `TC-CON-KRK-CHK-001` | same Karaoke Ticket check-in | 1 consume | 1 immutable Check-in |
| `TC-CON-GDS-ALLOC-001` | same Goods last inventory | inventory within bounds | no negative available |
| `TC-CON-GDS-HANDOFF-001` | same Goods Handoff | 1 completion | `COMPLETED` once |
| `TC-CON-ROLE-CREATE-001` | same Role Assignment create | 1 active row | partial unique convergence |
| `TC-CON-ROLE-REVOKE-001` | last Administrator concurrent revoke | revoke set cannot reach 0 | >=1 active Administrator |
| `TC-CON-EML-CLAIM-001` | same Email Job claim | 1 claimant | other workers skip |
| `TC-CON-EML-RETRY-001` | same Notification retry | one effective retry scheduling | no duplicate provider cause |
| `TC-CON-REVIEW-001` | same Consistency Review cause | one unresolved Case | dedupe |
| `TC-CON-AUDIT-001` | same high-risk logical operation | one business effect | matching required Audit evidence |

**TST-CON-003:** 各CaseはDB final stateに加えProvider call count、Audit Event count、Business Cause、constraint loserをassertする。

---

# Part XVII — Idempotency Test

## 63. Layer separation

| Layer | Authority / key | Core test |
|---|---|---|
| HTTP Transport | `Idempotency-Key` + Principal + Operation + request fingerprint | same/same replay、same/different conflict |
| Domain Business Cause | domain-specific persisted relation | Transport key変更でもduplicate Domain effectなし |
| Stripe Provider | canonical Stripe idempotency key | response loss後same key |
| Resend Provider | Delivery Attempt Provider Idempotency Key | unknown後same Attempt/key |
| Webhook | verified Provider Event ID | duplicate delivery no duplicate effect |
| Ticket | Ticket consume-once + Check-in unique relation | parallel/replay one consume |
| Goods Handoff | Handoff state / unique relation | parallel completion one effect |
| Notification | deterministic Business Cause Key | duplicate source event one request |
| Consistency Review | canonical dedupe cause/relation | same inconsistency one unresolved Case |

**TST-IDM-002:** `request_id`を変えたduplicate requestでもIdempotencyが破れないことをexplicit Testする。

**TST-IDM-003:** Transport Idempotency recordをfaultで失わせてもcritical Domain duplicateをDB constraint / Business Causeで防ぐTestを持つ。

---

# Part XVIII — Required System Invariant Tests

## 64. INV-010-01〜10

| Invariant | Positive | Negative | Concurrency | Failure injection | Primary levels |
|---|---|---|---|---|---|
| `INV-010-01` 購入情報を失わない | Order `PREPARED` persists before Checkout | external call before Order不可 | same purchase cause convergence | DB/provider response loss | Integration, DB, API, E2E |
| `INV-010-02` Order二重確定防止 | one confirmation | duplicate webhook/replay no second confirm | same Order N=8 | confirmation mid-txn / commit ack loss | DB, Integration, API |
| `INV-010-03` Ticket二重発行防止 | correct quantity issuance | replay no extra Ticket | parallel confirmation | fault after partial entitlement attempt | DB, Integration |
| `INV-010-04` Karaoke二重販売防止 | nonoverlap slots/one Hold | overlap rejected | same Slot / generation race | commit loss / payment unknown | DB, Integration, API |
| `INV-010-05` QR二重利用防止 | one check-in | USED/revoked/wrong purpose denied | same Ticket N=8 | response loss / Audit insert failure | DB, API, E2E |
| `INV-010-06` Email失敗で購入Rollbackしない | confirmation + Notification | Resend fail keeps purchase | duplicate Notification cause | 429/5xx/timeout | Integration, Reliability |
| `INV-010-07` Payment確定とEntitlement atomic | `CONFIRMED` + full effects | partial effect impossible | same confirmation | mid-txn rollback / commit unknown | DB, Integration |
| `INV-010-08` Ownership/Authorization server-side | owner/current capability allowed | IDOR/role escalation denied | role revoke during retry | Auth/DB security dependency failure | API, Security, E2E |
| `INV-010-09` Client金額非Authority | server snapshot amount | tampered client amount ignored/rejected | concurrent config/purchase current-state rule | DB/provider boundary fault | Unit, Integration, API |
| `INV-010-10` 外部retry/replay耐性 | same cause resumes | new duplicate side effect禁止 | webhook/request/worker race | Provider/DB unknown result | Integration, Reliability, API |

### 64.1 Minimum named cases

```text
TC-INV-010-01-001 ORDER_BEFORE_PROVIDER
TC-INV-010-01-002 CHECKOUT_RESPONSE_LOSS_ORDER_PRESERVED
TC-INV-010-02-001 DUPLICATE_WEBHOOK_ONE_CONFIRMATION
TC-INV-010-02-002 PARALLEL_CONFIRMATION_ONE_WINNER
TC-INV-010-03-001 DUPLICATE_CONFIRMATION_NO_EXTRA_TICKET
TC-INV-010-04-001 KARAOKE_GIST_OVERLAP_REJECT
TC-INV-010-04-002 PARALLEL_HOLD_ONE_WINNER
TC-INV-010-05-001 PARALLEL_CHECKIN_ONE_CONSUME
TC-INV-010-05-002 RESPONSE_LOSS_RESCAN_CONVERGES
TC-INV-010-06-001 RESEND_FAILURE_DOES_NOT_ROLLBACK_PURCHASE
TC-INV-010-07-001 CONFIRMATION_MID_TXN_ROLLBACK
TC-INV-010-07-002 COMMIT_ACK_LOSS_RECONCILES
TC-INV-010-08-001 OWNER_MISMATCH_DENIED
TC-INV-010-08-002 ROLE_REVOKED_BEFORE_RETRY_DENIED
TC-INV-010-09-001 TAMPERED_AMOUNT_NOT_AUTHORITY
TC-INV-010-10-001 STRIPE_UNKNOWN_SAME_KEY_RECONCILES
TC-INV-010-10-002 RESEND_UNKNOWN_SAME_ATTEMPT_RECONCILES
```

**TST-TRC-003:** 上記Invariant Caseは削除・skip・quarantineしてmerge/deploy gateを通してはならない。

---

# Part XIX — E2E Test

## 65. Browser isolation

E2EはPlaywright-compatible browser automation contractを使用し、production相当Next.js build + Hono API + isolated PostgreSQLを起動する。

- E2E workerごとに独立synthetic User / Role / Order / Slot namespace。
- Browser storage state共有禁止。
- raw QRをtraceへ保存しない。
- screenshot / video / traceはredaction helper適用後のみartifact化。
- Provider boundaryはcontrolled simulatorを標準とする。

**TST-E2E-001:** Stripe hosted pageやResend mailboxを常時external network越しに自動操作することを標準E2E suiteにしない。

## 66. Mandatory journeys

- signup/login gate
- email verification gate state
- Entry purchase start -> controlled Stripe boundary -> pending -> confirmed
- Browser return but payment pending
- Mypage Order / entitlement
- Entry Ticket / QR display
- Karaoke schedule -> Hold -> purchase -> Reservation / Ticket
- Goods purchase -> Handoff state
- Admin high-risk existing operation
- Staff Entry Check-in
- Staff Karaoke Check-in
- Staff Goods Handoff
- error / temporary failure / conflict / review states
- ownership direct URL attempt
- role revoke after page load then mutation deny

**TST-E2E-002:** E2E成功だけでDB unique / Provider idempotency / Alert thresholdを保証済みとしない。

---

# Part XX — Test Runner / Parallelism / Flaky Policy

## 67. Test execution groups

Canonical groups:

```text
G1 unit
G2 db-migration
G3 db-integration
G4 api
G5 security
G6 reliability-recovery
G7 observability
G8 e2e
G9 provider-contract-smoke
G10 hot-concurrency
```

Merge gate:

```text
G1..G8 required
```

Pre-release staging gate:

```text
G1..G8 + G10 required
G9 required when provider test credentials are available in the protected CI environment
```

Provider credential unavailable状態をProduction credentialで代替してはならない。`SPEC-180`はG9のcredential provisioningとfailure policyを明示する。

## 68. Parallelism

Default process parallelism:

```text
unit/api-pure: min(8, max(2, CPU_COUNT))
integration/db worker databases: min(4, max(1, floor(CPU_COUNT/2)))
e2e browsers: max 4
provider-contract: max 2
db-migration: 1
```

Critical race Test自身は独立connectionでN=2 / N=8を内部並行させるが、同じephemeral databaseを使うrace Case同士はserial実行する。

**TST-GEN-007:** CI machine差でparticipant count / seed / expected winner数を変えない。

## 69. Test runner retry

Canonical policy:

- Local default runner retry: **0**。
- CI gating runner retry: **0**。
- Critical Test retry: **0** always。
- failed Testのdiagnostic rerun: original job failure確定後に**非gatingで最大1回**実行してよい。
- diagnostic rerun passでもoriginal failureをpassへ上書きしない。

**TST-FLK-001:** Security / concurrency / payment / recovery / audit Testはrerun成功だけで合格扱いにしない。

## 70. Flaky classification / quarantine

Flaky認定条件:

1. 同一commit、同一fixture、同一seedで再現性なく結果が変動。
2. Productの仕様上許容されたnon-deterministic winner差ではない。
3. external Provider smoke outageだけをapplication flakeと分類しない。

Quarantine:

- Critical Test: **禁止**。
- Non-critical Test: issue ID、owner、root-cause note、expiryを必須として最大**3 calendar days**。
- expiry到達時は自動的にgating failureへ戻す。
- quarantine中もdaily diagnostic runを継続する。

**TST-FLK-002:** flaky修復期限を延長する場合は新しいevidenceとowner approvalが必要で、無期限skip labelを禁止する。

## 71. Concurrency seed

- pseudo-random schedulingを使うstress variantには64-bit seedを明示する。
- CI default seedはcommit SHAから安定導出する。
- failure artifactへseedを記録する。
- fixed regression seedを追加可能。
- logical correctnessをrandom schedulerだけへ依存せず、barrier-based deterministic Caseを必ず持つ。

---

# Part XXI — Failure Artifact / Redaction

## 72. Failure artifact

Failure時に保存してよいもの:

- Test Case ID
- source location
- deterministic seed
- Test Clock instant
- request_id / operation_execution_idのsynthetic values
- Public Reference synthetic values
- safe error code / failure class
- sanitized stack trace
- DB constraint name / SQLSTATE（SQL bind値なし）
- provider simulator scenario name / safe provider test ref
- redacted structured log
- screenshot / trace after redaction

保存禁止:

```text
Production data
Production secret
Authorization/Cookie
access/refresh token
raw QR
raw Email
full provider request/response body
DB connection string
SQL bind values containing PII/secret
```

**TST-FLK-003:** Test assertion libraryのobject diffがsecret fieldを自動展開しないよう、sensitive wrapper / custom serializerを使用する。

---

# Part XXII — Coverage Policy

## 73. Code coverage threshold

Gating threshold:

| Scope | Statement | Branch | Function |
|---|---:|---:|---:|
| repository-wide testable TypeScript | **90%** | **85%** | **90%** |
| critical packages | **95%** | **92%** | **95%** |

Critical packagesには少なくとも次を含む。

```text
authentication / authorization
order / payment / refund
ticket / QR / check-in
karaoke hold / confirmation
goods allocation / handoff
notification / resend
idempotency
reliability / retry / reconciliation / recovery
observability / audit / redaction
```

Generated type declarations、migration SQL、pure config manifestはline coverage denominatorから除外してよいが、それぞれ専用contract/migration/config Testを必要とする。

**TST-COV-001:** 100% line coverageを目的化してInvariant Testを削除しない。

## 74. Semantic coverage

次はpercentageではなく**100% manifest coverage**を要求する。

- `INV-010-01〜10`: 各1件以上Critical Test、§64のminimum case全部。
- `DI-030-001〜012`: 各1件以上。
- critical `BR-*`: state/invariant groupごとにpositive + negative。
- Current API Operation ID: 100% contract case。
- API mutation: 100% auth + validation + current-state test。
- critical API mutation: 100% idempotency / response-loss test。
- SPEC-100 critical named constraints: 100% real PostgreSQL Test。
- concurrency-sensitive operation: 100% explicit parallel Test。
- `SEC-*`: executable/configurable controlを100% Test manifestへmap。
- `REL-*`: executable retry/timeout/recovery ruleを100% Test manifestへmap。
- `OBS-*`: required event/schema/metric/alert/audit/sampling ruleを100% manifestへmap。
- `OBS-ALT-001〜037`: 100% synthetic evaluator Test。

**TST-COV-002:** Upstream ruleが「documentation-only / external fact」等で直接executeできない場合もmanifestから除外せず、`verification_method=document_review|config_validation|provider_contract`を明示する。

---

# Part XXIII — Traceability

## 75. Traceability matrix

| Test group | Upstream Rule IDs | Primary Test level |
|---|---|---|
| System invariants | `INV-010-01〜10` | Integration, DB, API, E2E |
| Functional behavior | `FR-*` | API, Integration, E2E |
| Domain model | `BR-*`, `DI-030-*` | Unit, Integration, DB |
| User flow | `UF-*` | E2E, API |
| Page / Route | `PG-*` | E2E, Security |
| Authentication / Authorization | `AR-*` | Unit, API, Security, DB concurrency |
| Payment / Refund | `PAY-*` | Integration, API, Reliability, DB |
| Ticket / QR / Check-in | `TQR-*` | Unit, Integration, API, DB, E2E |
| Karaoke | `KRK-*` | Unit, Integration, DB, API, E2E |
| Database | `DB-*` | DB, Migration, Integration |
| API | `API-*` | API, Security |
| Email / Notification | `EML-*` | Unit, Integration, Reliability, API |
| Admin / Staff | `ADM-*`, `STF-*`, `OPS-*` | E2E, API, Security |
| Security | `SEC-*` | Unit, API, Security, Config validation |
| Reliability | `REL-*` | Reliability, Integration, DB, Recovery |
| Observability / Audit | `OBS-*` | Unit, Integration, DB, Observability |

## 76. Traceability manifest

`tests/traceability/test-manifest.json` はCIで検査可能なcanonical indexとし、次を満たす。

- duplicate Test Case IDなし。
- unknown upstream IDなし。
- current spec versionに存在しないUCR-only IDをactive featureとして登録しない。
- every `INV-010-*` has Critical Test。
- every current API Operation ID has API Test。
- every `OBS-ALT-*` has synthetic Test。
- every critical DB constraint name has DB Test。
- skipped/quarantined Critical Testが0。

**TST-TRC-004:** Test sourceのコメントだけをTraceability source of truthにしない。manifestとtest runtime resultをjoin可能にする。

---

# Part XXIV — Acceptance Criteria

## 77. SPEC-170 acceptance

SPEC-170に準拠したTest implementationは、少なくとも次をすべて満たさなければならない。

1. `INV-010-01〜10`全てがCritical Testへtraceされる。
2. `DI-030-001〜012`全てがTest manifestへtraceされる。
3. 全current critical API mutationにauthorization / validation / idempotencyまたはdomain consume-once Testがある。
4. Current API Operation IDを持つ全operationにcontract Testがある。
5. SPEC-100 critical constraintを実PostgreSQLでTestする。
6. `READ COMMITTED`, `FOR UPDATE`, advisory lock, `SKIP LOCKED`, rollbackを実DBでTestする。
7. `40001`, `40P01`, lock timeout, statement timeout, pool acquisition timeoutを再現できる。
8. concurrency-sensitive operationをbarrier付きparallel harnessでTestする。
9. normal `CONFLICT_LOSER`をinternal errorとして扱わない。
10. Transport / Domain / Provider / Webhook / consume-once idempotencyを区別してTestする。
11. `request_id`をIdempotency Authorityにしない。
12. Stripe Checkout / Refund / Resend / DB COMMITの`UNKNOWN_RESULT`を再現できる。
13. unknown result中にnew Business Cause / Provider key / duplicate side effectがない。
14. retry exhausted / retry budget exhausted / nested retry禁止をTestする。
15. canonical reconciliation対象を再現できる。
16. Consistency Review dedupe / resolve / recurrenceをTestできる。
17. automatic repair / current manual recovery / emergency Admin recovery境界をTestできる。
18. `UCR-150-001/002`だけのRecovery commandを現行APIとして発明していない。
19. Security Fail ClosedをAuth / Secret / QR key / webhook / CSRF / DB failureでTestできる。
20. Availability fallbackでSecurity Controlをskipしない。
21. Ticket / QR / Check-in single-useとparallel scanをTestする。
22. Karaoke 15+5、45分Hold、30分Payment Deadline、5分Safety Buffer、no resaleを上流値のままTestする。
23. Goods inventory / Handoff concurrencyとresponse lossをTestする。
24. Notification Business Cause / claim / SKIP LOCKED / 120秒lease / Resend unknown / 23時間cutoffをTestする。
25. `app.audit_events` append-onlyをTestする。
26. high-risk local mutationとAudit Eventのsame-transaction atomicityをTestする。
27. Audit insert failureでBusiness mutationがrollbackする。
28. Provider side effect後Audit persistence failureでduplicate Provider callをしない。
29. raw QR / token / Secret / full Email / SQL bindをTest artifactへ不要に残さない。
30. metric cardinality allowlist / forbidden labelsをTestする。
31. Gauge query failureをzeroへ偽装しない。
32. `OBS-ALT-001〜037`のthreshold / window / minimum / dedupe / cooldownをsynthetic inputでTestする。
33. critical observability classがsampling dropされない。
34. normal read INFOのdeterministic 5% samplingをTestする。
35. Production DEBUG default off / emergency 60分・10%をconfig Testできる。
36. retention値をInfrastructure config validationへ接続できる。
37. standard suiteがProduction Provider / Production Secret / Production dataへ依存しない。
38. Test runner retryでcritical failureを隠さない。
39. Critical Test quarantineが0である。
40. code coverage thresholdとsemantic coverageを両方満たす。
41. Test resultからupstream Rule IDへmachine-readableに追跡できる。
42. `UCR-130-001〜006`を反映済みと仮定していない。
43. `UCR-150-001〜002`を反映済みと仮定していない。
44. Test-only fault injection endpointをProductionへ公開していない。
45. E2EだけでDB / Provider / Security invariantを保証済みとしていない。

---

# Part XXV — Upstream Change Requests

## 78. UCR status inheritance

本書は次の既存Upstream Change Requestを継承するが、反映済みとは扱わない。

- `UCR-130-001〜006`
- `UCR-150-001〜002`

これらが対象Canonical Ownerへ反映された場合は、追加されたCapability / API / UI / index / Recovery commandについて、本書の対応test groupへTest Caseを追加する。反映前に期待値を先取りしない。

## 79. UCR-170-001 — SPEC-110のOperation ID completeness

- **対象:** `SPEC-110 API Specification`
- **現在の仕様:** `SPEC-110` はOperation IDをAPI operationの永続識別子として定義し、`SPEC-160` もAPI log / auditの `operation_id` にSPEC-110のOperation IDをexactに使用する。一方、現行 `SPEC-110` §46 Public content manage、§47 Goods inventory manage、§48 Role Assignment manageでは複数のcanonical method/pathが定義されているが、それぞれに一意な `API-*` Operation IDが明示されていない。
- **要求する変更:** 既存method/path、Capability、request/response semanticsを変更せず、§46〜48の各canonical routeへ一意なOperation IDを割り当てる。Operation IDは既存命名規則に従い、`SPEC-160` correlation / Audit EventとSPEC-170 traceabilityから参照可能にする。
- **理由:** API contract Test、structured log、Audit Event、Metric operation registry、incident investigationを同じbounded identifierへ接続し、method/pathの文字列推測を避けるため。
- **変更しない場合の影響:** 対象routeはmethod/path単位のbehavior Testは可能だが、Operation IDベースの100% API coverage / observability correlationを完全には満たせない。
- **影響を受ける可能性がある仕様書:** `SPEC-130`, `SPEC-140`, `SPEC-160`, `SPEC-170`, `SPEC-180`, `SPEC-190`, `SPEC-200`。

---

# Part XXVI — Implementation Guidance Boundary

## 80. Tool / framework choice

本仕様はTest contractをCanonicalに定義する。実装時の標準選択は次とするが、package version固定はDependency / Infrastructure管理へ委譲する。

- TypeScript Unit / Integration / API: Vitest互換runner
- Browser E2E: Playwright互換runner
- PostgreSQL: deployed Supabase projectと同majorのephemeral PostgreSQL
- HTTP: Hono production appをin-processまたはreal socketで起動可能なharness

Frameworkを変更する場合もTest Rule、coverage、parallelism、runner retry、artifact redaction、real PostgreSQL requirementを弱化しない。

## 81. AI implementation contract

Codex等のAI agentがTestを追加するときは次の順序で行う。

1. upstream Rule IDを特定する。
2. 最低の再現可能Test levelを選ぶ。
3. critical / concurrency / fault injection要否を判定する。
4. fixture / clock / provider scenarioを既存registryから選ぶ。
5. expected DB / Provider / Audit postconditionを明示する。
6. Test Case IDとmanifestを追加する。
7. redaction assertionを必要に応じて追加する。
8. suite実行後、semantic coverage欠損を確認する。

AIはpassing implementationに合わせてexpected stateを変更してはならない。実装が上流仕様と不一致ならimplementation defectとして扱い、上流仕様を変える必要がある場合だけSPEC-000のUCR手続へ進む。

---

# Part XXVII — Final Verification Checklist

## 82. 出力前 / 実装前確認

- System Boundaryを変更していない。
- `INV-010-01〜10`全てにTest responsibilityがある。
- Unit fakeだけでDB constraint保証済みとしていない。
- E2Eだけにcritical invariantを押し込んでいない。
- concurrencyを実同時実行できる。
- Idempotency layerを区別している。
- `request_id`をIdempotency Authorityにしていない。
- Provider Result UnknownをTestできる。
- retry exhausted / budget exhaustedをTestできる。
- reconciliation / Consistency ReviewをTestできる。
- automatic / manual recoveryをTestできる。
- Security Fail ClosedをTestできる。
- Audit append-only / transaction atomicityをTestできる。
- raw QR / Token / Secret / Emailをartifactへ不要に出さない。
- Metric high-cardinality禁止をTestできる。
- Alert threshold/window/minimum/cooldownをTestできる。
- `UCR-130-001〜006`を反映済みとしていない。
- `UCR-150-001〜002`を反映済みとしていない。
- Production Provider / Secret / dataへ標準suiteが依存しない。
- critical Testのrunner retry / quarantineでfailureを隠さない。
- Coverage thresholdが具体値である。
- Test fixture / clock / fault injection contractが具体化されている。
- `UCR-170-001`以外に上流変更を暗黙導入していない。
- 長期運用される完成システムを対象としている。

