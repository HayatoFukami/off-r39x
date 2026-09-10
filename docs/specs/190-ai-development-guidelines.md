---
spec_id: SPEC-190
title: AI Development Guidelines
version: 1.0.0
status: provisional
depends_on:
  - SPEC-000
  - SPEC-010
  - SPEC-060
  - SPEC-070
  - SPEC-080
  - SPEC-100
  - SPEC-110
  - SPEC-120
  - SPEC-140
  - SPEC-150
  - SPEC-160
  - SPEC-170
  - SPEC-180
related_specs:
  - SPEC-020
  - SPEC-030
  - SPEC-040
  - SPEC-050
  - SPEC-090
  - SPEC-130
  - SPEC-200
---

# 190 AI Development Guidelines

## 1. 目的

本書は、**off r39'x in 大阪らへん2027** Webシステムの完成形を、AI coding agent / Codex等が既存正式仕様から安全かつ再現可能に実装、変更、レビュー、自己検証するための開発規約を定義する。

本書は **AI Development Workflow / Repository Organization / Source Module Boundary / Dependency Direction / Architecture・Safetyに影響するCoding Rule / Canonical Spec-to-Code Traceability / Test-first Workflow / Generated Code Self-verification / Completion Evidence / Upstream Change Request handling** のCanonical Ownerである。

本書は上流Canonical Ownerが定義したDomain State、Business Rule、API contract、Database physical schema、Authentication / Authorization、Security Control、Payment / QR / Email lifecycle、Reliability値、Observability taxonomy、Infrastructure topology、Test contractを変更しない。実装容易性を理由に上流仕様へ存在しないState、API、Capability、schema、business exception、Recovery operationを追加してはならない。

本書はMVP、Step1、Step2、初期リリース等で開発安全性を分断しない。長期運用される完成システムへ適用する。

## 2. 適用範囲

本書は次へ適用する。

- pnpm workspace / monorepo organization
- Web / API / worker / shared packageのsource配置
- package / layer dependency direction
- TypeScript、Next.js、Hono、Zod、Drizzle ORM、`pg`、React Emailの実装規約
- Database transaction / migration実装境界
- Supabase Auth / Stripe / Resend provider adapter実装境界
- Secret / Configuration reader boundary
- Reliability / recovery / observability support code
- Production sourceとTest Harnessの分離
- Test-first実装手順
- Canonical Rule / Test Case / code変更のTraceability
- AI coding agentのtask processing sequence
- generated codeのself-verification
- completion evidence
- CodeとSpecの矛盾時のUpstream Change Request handling

本書はGit hosting上のbranch命名や人間組織の一般的な開発プロセスを主目的としない。ただし、`SPEC-180` のCI/CD gateへ必要なsource-level ruleは定義する。

## 3. 依存仕様と採用理由

`depends_on` はAI実装規約の直接入力だけに限定する。

| Spec | Implementation ruleへの入力 | Code / Repositoryへ反映するboundary | SPEC-190が再定義しないCanonical value |
|---|---|---|---|
| `SPEC-000` | Spec参照、Canonical Owner、UCR、依存選定、次仕様生成 | `docs/specs`参照、UCR handling、trace metadata | Governance rule自体 |
| `SPEC-010` | System Boundary / technology stack / `INV-010-01〜10` | workspace責務、Web→API→DB方向 | System of Record、採用技術、System Invariant |
| `SPEC-060` | Principal / ownership / Role / Capability | auth middleware、authorization helper、client authority禁止 | `AR-*`、Role inheritance semantics |
| `SPEC-070` | Payment / Stripe / idempotency / unknown result | payment service / Stripe adapter境界 | `PAY-*`、state、timeout等 |
| `SPEC-080` | QR protection / check-in concurrency | QR crypto helper、check-in repository境界 | `TQR-*`、QR format / lifecycle |
| `SPEC-100` | Physical DB schema / transaction / constraint / migration | `packages/db`、repository、migration | `DB-*`、table/constraint/lock semantics |
| `SPEC-110` | Hono route / RPC / Zod / Operation ID | API package route→service layering | `API-*`、method/path/response/error contract |
| `SPEC-120` | Notification / worker / Resend / React Email | email package / worker / provider adapter | `EML-*`、Notification lifecycle |
| `SPEC-140` | Security / secret / fail-closed | server-only config / secret / redaction / crypto | `SEC-*`、control values |
| `SPEC-150` | timeout / retry / unknown / reconciliation / graceful shutdown | reliability registry / worker boundary | `REL-*`、retry/cadence values |
| `SPEC-160` | log / metric / audit / correlation | structured emitter / audit repository / validators | `OBS-*` taxonomy / threshold / retention |
| `SPEC-170` | Test architecture / fixture / traceability / gate | `tests/*`、manifest、self-verification | `TST-*`, `TC-*`, G1〜G10、retry/quarantine policy |
| `SPEC-180` | runtime / environment / deployment / secret placement | build targets、startup validation、infra-change boundary | `INF-*`、Node/PostgreSQL major、provider topology |

`SPEC-020`, `SPEC-030`, `SPEC-040`, `SPEC-050`, `SPEC-090`, `SPEC-130` は、実装taskの具体的なbehavior traceで必要になる関連Canonical Ownerであるが、Repository / implementation architectureの直接定義元ではないため `related_specs` とする。変更分類に応じて実装agentはこれらも必ず読む。

## 4. 未反映Upstream Change Requestの扱い

本書作成時点では次を未反映と扱う。

```text
UCR-130-001〜006
UCR-150-001〜002
UCR-170-001
```

**DEV-GEN-001:** UCRは対象Canonical Owner本文へ反映されるまでCanonical behaviorではない。

**DEV-GEN-002:** 実装agentはUCRだけに存在するCapability、API、Operation ID、UI、Index、Recovery commandを「予定されている」ことを理由に実装済み契約として扱ってはならない。

**DEV-GEN-003:** `UCR-170-001` 未反映中、SPEC-110にOperation IDがないrouteへSPEC-190または実装agentがOperation IDを発明してはならない。method + path + capability単位の既存Test契約を維持する。

**DEV-GEN-004:** `UCR-150-001〜002` 未反映中、dedicated Recovery API / UIを追加してはならない。既存Canonical operationとautomatic reconciliationだけを実装する。

## 5. Rule ID体系

| Prefix | Category |
|---|---|
| `DEV-GEN-*` | General development / spec protection |
| `DEV-REP-*` | Repository organization |
| `DEV-DEP-*` | Dependency direction |
| `DEV-TS-*` | TypeScript |
| `DEV-WEB-*` | Next.js / React |
| `DEV-API-*` | Hono / Zod / RPC |
| `DEV-DB-*` | Drizzle / pg / transaction / migration |
| `DEV-AUTH-*` | Authentication / Authorization |
| `DEV-SEC-*` | Secret / security implementation |
| `DEV-PAY-*` | Stripe / payment |
| `DEV-TQR-*` | Ticket / QR / Check-in |
| `DEV-EML-*` | Email / React Email / Resend |
| `DEV-REL-*` | Reliability / recovery |
| `DEV-OBS-*` | Observability / Audit |
| `DEV-INF-*` | Infrastructure boundary |
| `DEV-TST-*` | Test-first / validation |
| `DEV-AI-*` | AI agent workflow / self-review |
| `DEV-TRC-*` | Traceability |

Rule IDはrepository内で一意とし、別意味へ再利用しない。

# Part I — Repository / Workspace

## 6. Canonical repository layout

```text
.
├─ apps/
│  ├─ web/                         # Next.js App Router, Vercel
│  │  ├─ app/
│  │  └─ src/
│  │     ├─ features/
│  │     ├─ api-client/
│  │     ├─ auth/
│  │     ├─ presentation/
│  │     └─ config/
│  ├─ api/                         # Hono API, Railway
│  │  └─ src/
│  │     ├─ api/
│  │     │  ├─ middleware/
│  │     │  ├─ schemas/
│  │     │  ├─ routes/
│  │     │  └─ webhooks/
│  │     ├─ application/
│  │     └─ bootstrap/
│  ├─ email-worker/                # Railway persistent worker
│  │  └─ src/
│  └─ reconciliation-worker/       # Railway persistent worker
│     └─ src/
├─ packages/
│  ├─ domain/                      # pure domain decisions / opaque domain types
│  ├─ application/                 # use-case contracts/services shared by API/workers
│  ├─ api-contract/                # Hono RPC exported app type + shared wire schema only
│  ├─ db/                          # Drizzle schema, pg helpers, repositories, migrations source
│  │  ├─ src/schema/
│  │  ├─ src/repositories/
│  │  ├─ src/transactions/
│  │  └─ migrations/
│  ├─ auth/                        # Supabase Auth server verification / principal construction
│  ├─ providers/
│  │  ├─ stripe/
│  │  ├─ resend/
│  │  └─ supabase-auth/
│  ├─ email/                       # React Email templates + renderer contracts
│  │  ├─ templates/
│  │  └─ src/
│  ├─ security/                    # crypto, keyring, redaction, safe fingerprints
│  ├─ reliability/                 # timeout/retry registry, Clock abstractions, classifications
│  ├─ observability/               # log/metric/audit contracts and emitters
│  └─ config/                      # server config schemas; no secret values
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  ├─ api/
│  ├─ db/
│  ├─ e2e/
│  ├─ security/
│  ├─ reliability/
│  ├─ recovery/
│  ├─ observability/
│  ├─ provider-contract/
│  ├─ fixtures/
│  ├─ harness/
│  └─ traceability/test-manifest.json
├─ docs/specs/
├─ traceability/
│  ├─ rule-code-map.json
│  └─ change-evidence.schema.json
├─ scripts/
│  ├─ check-import-boundaries.mts
│  ├─ validate-traceability.mts
│  ├─ validate-generated-migrations.mts
│  └─ secret-scan.mts
└─ generated/
   └─ reports/                      # disposable reports only; never authoritative source
```

**DEV-REP-001:** `apps/*` はdeployable process、`packages/*` はreusable source module、`tests/*` はProductionから到達不能なTest Harness、`docs/specs/*` はCanonical specificationとする。

**DEV-REP-002:** migration sourceのCanonical locationは `packages/db/migrations/` とし、生成migrationもreview前提のsource artifactとしてversion controlへ含める。

**DEV-REP-003:** React Email templateは `packages/email/templates/` に配置し、Notification rendering以外のbusiness decisionを持たせない。

**DEV-REP-004:** Test fixture / fake provider / fault injector / deterministic admin hookは `tests/fixtures` または `tests/harness` にのみ置き、Production route table / worker public endpointへ登録しない。

**DEV-REP-005:** `generated/` は再生成可能なreportだけに使用し、handwritten type、migration、spec、business rule、secret、provider credentialのauthorityにしない。

**DEV-REP-006:** `packages/shared` のような無制約汎用packageを新設してはならない。共有対象は責務名を持つpackageへ配置する。

## 7. Package responsibility

- `domain`: network / DB / framework importを持たないpure decision、domain-specific opaque types、state exhaustiveness。
- `application`: use-case orchestration contract。repository / provider portへ依存するがconcrete adapterへ依存しない。
- `api-contract`: HTTP/RPC wire schema、Hono RPC public type。DB entity / provider SDK typeをexportしない。
- `db`: physical schema、repository adapter、transaction / lock helper。HTTP / Reactへ依存しない。
- `auth`: verified principal構築。UI stateへ依存しない。
- `providers`: Stripe / Resend / Supabase AuthのSDK adapter。Domain Stateを独自に定義しない。
- `security`: keyring / encryption / HMAC / redaction。raw secretを返す汎用dump APIを持たない。
- `reliability`: timeout / retry / Clock / classification。Canonical値はSPEC-150 registryからcode constantへ写像する。
- `observability`: schema-validated log / metric / audit helper。Business authorityを持たない。

# Part II — Dependency Direction

## 8. Canonical dependency graph

```text
UI
  -> API client / API contract
  -> Hono route / middleware
  -> application service
  -> domain decision
  -> repository/provider port
  -> infrastructure adapter

worker entrypoint
  -> application service
  -> domain decision
  -> repository/provider port
  -> infrastructure adapter
```

**DEV-DEP-001:** dependencyは外側から内側へ向け、repository / provider adapterからHTTP route、React component、worker entrypointへ逆依存してはならない。

**DEV-DEP-002:** Web packageから `packages/db`、Drizzle schema、`pg` clientへBusiness query / mutation目的でimportしてはならない。

**DEV-DEP-003:** React componentからrepository、provider SDK、secret readerへ直接依存してはならない。

**DEV-DEP-004:** domain packageへStripe / Resend / Supabase SDK、Hono、Next.js、Drizzle、`pg`をimportしてはならない。

**DEV-DEP-005:** package間circular importは禁止する。

**DEV-DEP-006:** import boundaryはBiomeだけへ依存せず、`scripts/check-import-boundaries.mts` がworkspace dependency graphとsource importを検査しCIでfailさせる。少なくとも上記禁止edge、cycle、Test Harness→Production逆流を検出する。

**DEV-DEP-007:** application serviceはport/interfaceを所有し、infrastructure adapterがそれを実装する。adapter typeをapplication/domain public signatureへ露出しない。

# Part III — TypeScript

## 9. TypeScript baseline

**DEV-TS-001:** 全workspaceは共通base `tsconfig` で `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noImplicitOverride: true`, `useUnknownInCatchVariables: true` を有効にする。

**DEV-TS-002:** Production sourceで明示的 `any` を使用してはならない。第三者library境界で型欠落がある場合はadapter内で `unknown` として受け、runtime narrowingした後にtyped valueへ変換する。

**DEV-TS-003:** `as unknown as T`、根拠のないtype assertion、non-null assertion `!` をauthority boundaryで使用してはならない。例外はframework limitationを局所adapterへ封じ、コメントでinvariantとvalidation根拠を示し、Testを付ける。

**DEV-TS-004:** Runtime inputは必ずZod等のruntime schemaでvalidateし、TypeScript typeだけを信頼してはならない。

## 10. Identifier / money / time types

Branded / opaque typeを最低限次へ使用する。

```text
InternalId<T>       # bigint based, repository内部
PublicRef<T>        # UUID wire/domain ref
AuthSubject         # verified UUID
MoneyMinor          # bigint
CurrencyCode        # validated uppercase 3-letter
UtcInstant          # Date/object wrapper after validated parse
BusinessDateJst     # YYYY-MM-DD semantic in Asia/Tokyo
OperationExecutionId
```

**DEV-TS-005:** Internal IDとPublic Referenceを同じ`string`/`number` aliasとして扱ってはならない。Internal IDはAPI responseへ出さない。

**DEV-TS-006:** DB `bigint`はlosslessな`bigint`またはdecimal stringで扱い、JavaScript `number`へ暗黙変換しない。API money wire formatはSPEC-110どおりdecimal stringを使用する。

**DEV-TS-007:** Money計算にfloating pointを使用しない。

**DEV-TS-008:** absolute instantはUTCとして保持し、`Asia/Tokyo` business date / date boundaryとは別type / conversion helperを使用する。境界比較は上流のhalf-open interval semanticsを維持する。

**DEV-TS-009:** `optional` は「fieldが存在しなくてよい」、`nullable` は「明示nullを許可」の意味として区別する。API/DB schemaから勝手に相互変換しない。

## 11. State / Result / error

**DEV-TS-010:** Domain Stateをdiscriminated unionまたはliteral unionとして表し、state-dependent branchは `assertNever(x: never)` 等でexhaustiveにする。

**DEV-TS-011:** 新Stateをcompiler error回避目的でdefault branchへ吸収しない。Canonical State追加が必要なら対象Spec変更が先である。

**DEV-TS-012:** expected domain / validation / conflict resultはtyped Resultまたはdiscriminated outcomeとして返し、unexpected programming/runtime exceptionと区別する。

**DEV-TS-013:** exceptionはlayer boundaryで一度だけclassificationし、routeへはSPEC-110 error contract、workerへはSPEC-150 failure classへmapする。raw exception objectをClient/logへspreadしない。

## 12. Type authority

**DEV-TS-014:** wire typeはZod schemaからderiveし、同じcontractを手書きinterfaceと二重管理しない。

**DEV-TS-015:** Drizzle generated/inferred row typeはphysical DB representationのauthorityであり、Domain typeのauthorityではない。repository mapperで明示変換する。

**DEV-TS-016:** generated typeがCanonical Spec / runtime schemaと不一致ならgenerated typeを正としてSpecを変更してはならない。

# Part IV — Next.js / Web

## 13. App Router boundary

Canonical route groupは概念上次へ分離する。

```text
apps/web/app/
  (public)/
  (auth)/
  (self)/
  (admin)/
  (staff)/
```

実URLはSPEC-050 / SPEC-130を維持し、route group名をURLへ露出しない。

**DEV-WEB-001:** Server Componentをdefaultとし、browser API、interactive local state、scanner操作等が必要な最小leafだけClient Componentへする。

**DEV-WEB-002:** Client ComponentへSecret、service role、DB credential、provider secret、QR keyringをimport可能なmoduleを依存させない。

**DEV-WEB-003:** Server ActionをBusiness mutation authorityとして使用してはならない。Server Actionを使用する場合もHono RPC/APIを呼ぶthin adapterに限定し、Business Databaseを直接更新しない。

**DEV-WEB-004:** Web / BrowserからBusiness Database / Drizzle / `pg`へ直接query/mutationしない。認証用途のSupabase Auth integrationとBusiness Database accessを混同しない。

## 14. Session / RPC / cache

**DEV-WEB-005:** Supabase Auth Sessionの復元 / refreshはSPEC-060 / SPEC-140のserver-side integrationへ従い、UI local stateだけで認証済みと判定しない。

**DEV-WEB-006:** Hono RPC clientは `apps/web/src/api-client/` に集約し、page/componentごとのad-hoc `fetch` でprotected contractを複製しない。

**DEV-WEB-007:** self/admin/staff等のprotected response、QR表示、session-dependent contentはshared/public cacheへ保存してはならず、上流Security contractに従い`no-store`等でprivate/noncache semanticsを強制する。

**DEV-WEB-008:** URL / Public Reference / hidden form field / client role flagをAuthorization authorityにしない。Hono APIでowner/capabilityを再評価する。

**DEV-WEB-009:** pending / retry / failure UIはAPIが返すauthoritative outcomeを表示するだけであり、Browser側でOrder/Payment/Ticket/Reservation stateを確定しない。

# Part V — Hono / API

## 15. API source flow

```text
route registration
 -> request-context middleware
 -> authentication
 -> principal resolution
 -> authorization / owner-safe boundary
 -> Zod input validation as defined by operation contract
 -> application service
 -> repository / provider adapter
 -> response schema validation / error mapping
```

Authentication/validation orderingでSecurity上必要な先行処理がSPEC-110/140に定義される場合はそのCanonical orderを優先する。

**DEV-API-001:** route handlerへBusiness Logic、raw SQL、Stripe/Resend SDK sequenceを埋め込まない。handlerはtransport変換とservice呼出しに限定する。

**DEV-API-002:** Hono RPC public type exportは `packages/api-contract` から行い、Webhook、internal health、worker internalsをBrowser RPC contractへ含めない。

**DEV-API-003:** path / query / bodyだけでなく主要success responseとcommon errorをZodでvalidateする。runtime inputをcompile-time typeだけで受けない。

**DEV-API-004:** protected operationはClient supplied `user_id`, `profile_id`, `role`, `permission`, `customer`をPrincipalへ使用しない。

**DEV-API-005:** owner resourceはPublic Referenceだけでqueryせず、verified Business Profile relationをsame queryまたはsame transactionで評価する。

## 16. Correlation / idempotency / webhook

**DEV-API-006:** `request_id`, Operation ID, `operation_execution_id`, Business Cause, Transport Idempotency Keyを別概念として保持する。相互代替しない。

**DEV-API-007:** Transport Idempotency KeyはSPEC-110対象operationだけで受理し、Business Cause / provider idempotencyの代替としない。

**DEV-API-008:** Stripe / Resend Webhookはsignature verificationに必要なraw bodyを専用boundaryで保持し、通常JSON middlewareで改変してから検証しない。

**DEV-API-009:** Webhook raw bodyはsignature verification後もApplication Log、trace、snapshot、failure artifactへ保存しない。

**DEV-API-010:** known PostgreSQL constraint loserはconstraint name / current stateを再評価し、SPEC-110のknown conflictへmapする。`23505` / `23P01` をblind retryしない。

**DEV-API-011:** unexpected exceptionはClientへstack、SQLSTATE、Internal ID、provider full object、raw QR、Secretを返さず、SPEC-110 common errorへredactしてmapする。

# Part VI — Database / Drizzle / pg

## 17. Drizzle schema / repository ownership

**DEV-DB-001:** physical schemaは `packages/db/src/schema/` でtable domainごとに分割し、export barrelはschema identityを変換しない。

**DEV-DB-002:** repositoryはAggregate / use-case access pattern単位で定義し、UI/API route単位のad-hoc SQL collectionにしない。

**DEV-DB-003:** repository外でDrizzle table object / `pg` Poolを直接使う場合はmigration/health/observability等の明示infrastructure用途に限定する。Business mutationはrepository/transaction moduleへ集約する。

## 18. Raw SQL / bigint / SQLSTATE

**DEV-DB-004:** Drizzleで正確に表現できないlock、advisory lock、`SKIP LOCKED`、constraint-sensitive statement等のみraw SQLを許可する。値は必ずparameter bindingする。

**DEV-DB-005:** client/user inputからdynamic SQL identifierを組み立てない。identifierが必要なadmin/report queryはsource-controlled allowlistから選ぶ。

**DEV-DB-006:** `bigint` PK / amountはlossless mappingを使用する。

**DEV-DB-007:** SQLSTATEはtyped classifierへ集約する。`40001` / `40P01` はSPEC-150のtransaction retry boundaryだけが再試行し、`23505` / `23P01`等のconstraint violationはblind retryしない。

## 19. Transaction / lock

**DEV-DB-008:** transaction isolationはSPEC-100の `READ COMMITTED` を維持し、agent判断でSerializable等へ変更しない。

**DEV-DB-009:** row lock順序、advisory lock、`FOR UPDATE SKIP LOCKED`はSPEC-100/120/150の対象処理どおりに実装し、performance理由で削除しない。

**DEV-DB-010:** DB transaction中にStripe、Resend、Supabase Authその他remote network callを実行しない。

**DEV-DB-011:** commit応答喪失等でcommit result unknownとなった場合は同一transactionを無条件再送せず、Business Cause / current state / provider correlationからSPEC-150のreconciliationへ移行する。

## 20. Migration

**DEV-DB-012:** migrationはapplication startupで自動実行しない。SPEC-180のdedicated migration identity / deployment sequenceで実行する。

**DEV-DB-013:** generated migrationは人間またはAI agentが必ずdiff reviewし、named constraint、index、extension、lock risk、destructive SQL、history preservationを検査する。

**DEV-DB-014:** expand → bounded backfill → validate → contractを原則とし、application codeとschemaのcompatible windowを維持する。

**DEV-DB-015:** `pgcrypto` / `btree_gist` requirement、named constraint、historical row hard-delete禁止を維持する。

**DEV-DB-016:** Test fixture cleanupのTRUNCATE/DELETE helperは `tests/harness` に隔離し、Production API / repositoryへexportしない。

# Part VII — Authentication / Authorization

## 21. Authority rules

**DEV-AUTH-001:** Client supplied `user_id`, `profile_id`, `role`, `permission`, `customer`をauthorityにしない。

**DEV-AUTH-002:** JWT payloadをdecodeしただけでAuthentication successにしない。SPEC-140のserver-side verificationを通す。

**DEV-AUTH-003:** UI guard / route group guardはUX boundaryでありAuthorization authorityではない。

**DEV-AUTH-004:** `ADMINISTRATOR`をgeneric superuserにしない。`ADMINISTRATOR`が`STAFF`を暗黙継承すると仮定しない。

**DEV-AUTH-005:** Public Referenceをcredential / ownership proofにしない。

**DEV-AUTH-006:** service role / DB credential / migration credentialをBrowser bundleへ渡さない。

**DEV-AUTH-007:** Session / reset token / verification token等をBusiness Databaseへ保存しない。

**DEV-AUTH-008:** Security Configuration failureをwarning-onlyにせずFail Closedする。

**DEV-AUTH-009:** test用auth bypassをProduction code pathへ残さない。

## 22. Authorization source ownership

- token verification: `packages/auth`
- Business Profile resolution: API/application + DB repository
- current Role Assignment evaluation: Business Databaseからrequestごとにserver-side解決
- capability matrix: `SPEC-060`由来のsource-controlled typed registry
- owner-safe query: repository method contract

**DEV-AUTH-010:** Role / Capability registryがSpecと異なる場合、registryを勝手に更新してSpecを追認させない。Canonical Ownerに照合する。

# Part VIII — Secret / Configuration

## 23. Config parsing / reader boundary

**DEV-SEC-001:** 各server processは起動時にZod等でenvironment schemaをparseし、欠落・不正・environment mismatch時はReadyにならない。

**DEV-SEC-002:** secret reader moduleはserver-only packageとし、Client Component / browser bundleからimport不可能なpackage export condition / build checkを持つ。

**DEV-SEC-003:** config objectをDomain inputへ渡さない。Domainへ必要な値はvalidated non-secret policy/portとして渡す。

## 24. Secret classes

Codeは少なくとも次を個別named secretとして扱う。

```text
DB runtime credential
DB migration credential
Supabase Auth server credential / verifier config
Stripe API secret
Stripe webhook secret
Resend API secret
Resend webhook secret
QR HMAC / AEAD keyring
OBS_CORRELATION_HMAC_KEY
Environment identity markers / provider expected identity
```

QR keyring representationは `current_version`, `allowed_previous_versions`, `keys_by_version` を明示するimmutable parsed objectとし、currentが1件でない、unknown version、duplicate versionはstartup failureとする。具体的key placement / rotation sequenceはSPEC-140/180を参照する。

**DEV-SEC-004:** Secret valueをsource、fixture、snapshot、CI annotation、test report、build artifact、generated fileへ書かない。

**DEV-SEC-005:** exception serializer / structured loggerはSecret classを受け取らず、arbitrary object spreadを禁止する。

# Part IX — Payment

## 25. Stripe critical implementation boundary

**DEV-PAY-001:** Stripe Checkout / Refund provider callとBusiness DB transactionを分離する。DB transaction中にStripe network callを行わない。

**DEV-PAY-002:** Provider writeはSPEC-070のBusiness Causeとprovider idempotency keyを維持し、retryごとに新keyを発行しない。

**DEV-PAY-003:** Browser ReturnをPayment Authorityにしない。verified Webhookまたはserver-to-server provider authorityだけを使用する。

**DEV-PAY-004:** Webhookはraw-body signature validation、duplicate receipt、out-of-order eventをCanonical contractどおり処理する。

**DEV-PAY-005:** Provider Result Unknownをblind retryしない。same key / provider lookup / reconciliationへ進める。

**DEV-PAY-006:** amount / currencyはBusiness Databaseのserver-side snapshotがauthorityであり、Client / Stripe metadataだけから確定しない。

**DEV-PAY-007:** Payment confirmation時のDomain effectはSPEC-070/100のtransaction boundaryでatomicに成立させる。

**DEV-PAY-008:** Provider side effect後のresponse lossをlocal rollbackで「Stripe side effectも消えた」と扱わない。

# Part X — Ticket / QR / Check-in

## 26. QR implementation boundary

**DEV-TQR-001:** Entry / Karaoke QR purposeを型・parser・operationで分離する。

**DEV-TQR-002:** raw QR tokenは最小scopeのsensitive value objectとして扱い、log / assertion message / screenshot / trace / snapshotへ出さない。

**DEV-TQR-003:** lookup用HMAC / protected material用AEAD / current+allowed previous keyをSPEC-080/140/180どおり使用し、平文tokenを永続化しない。

**DEV-TQR-004:** token rotationはTicket State / Owner / historical check-inを変更しない。

**DEV-TQR-005:** Check-inはsingle-useをDB row lock / conditional update / named constraintで保証し、Client-side debounceを最終防御にしない。

**DEV-TQR-006:** parallel scanはwinner 1件とcanonical loser outcomeへ収束させる。

**DEV-TQR-007:** canceled / invalid / expired TicketをQR possessionだけで有効化しない。

**DEV-TQR-008:** Staff authorizationはQR validation前後の上流specified orderに従いserver-sideで成立させる。

**DEV-TQR-009:** QR key migration / reconciliationはexisting Token / Ticket authorityから安全に変換可能なrowだけを処理し、新Business Causeを作らない。

# Part XI — Email / React Email

## 27. Notification generation / worker

**DEV-EML-001:** Notification Request生成とBusiness Transactionを分離し、Resend送信成功をBusiness Confirmation条件にしない。

**DEV-EML-002:** recipient authorityはSPEC-120のBusiness Profile→Auth Subject→Supabase Auth server lookupから解決し、Client / Stripe Emailをauthorityにしない。

**DEV-EML-003:** recipient snapshotはSPEC-120のタイミングでのみ作成し、logへfull Emailを不要に出さない。

**DEV-EML-004:** React Email templateはversioned template IDを持ち、input Zod schemaを通したnon-secret render contextだけを受ける。

**DEV-EML-005:** HTMLとplain textを同一validated modelから生成する。

**DEV-EML-006:** CTA URLはconfigured canonical public origin + allowlisted route builderで構築し、Host header / arbitrary Client URLを使用しない。

**DEV-EML-007:** worker claim lease / `SKIP LOCKED` / Provider Idempotency Key / Unknown ResultはSPEC-120/150どおり実装する。

**DEV-EML-008:** Notification retry / resendで元Order / Refund / Reservation / Ticket transactionを再実行しない。

# Part XII — Reliability / Recovery

## 28. Reliability implementation primitives

**DEV-REL-001:** clock-sensitive codeはinjectable `Clock` interfaceを使用する。Productionはsystem UTC clock、Testはdeterministic clockを注入する。

**DEV-REL-002:** external dependency callはdependency-specific timeout wrapperを通す。値はSPEC-150 registryから参照し、call siteへ任意値を重複記述しない。

**DEV-REL-003:** retry policyはsource-controlled typed registryへ集約し、SPEC-150のtimeout/backoff/jitter/budget/cadenceを変えない。

**DEV-REL-004:** 1 Business Cause / dependency writeに対するautomatic retry layerは1層だけとする。SDK + adapter + serviceの多重retryを禁止する。

**DEV-REL-005:** Result Unknownをtyped classificationとして保持し、generic exception / temporary failureへ潰さない。

**DEV-REL-006:** Provider write pathとread-only reconciliation pathを別function / adapter methodとして分離する。

**DEV-REL-007:** workerはitem-level failure isolation、claim lease、graceful shutdownを実装し、1 item failureでbatch全体のstateを成功扱いしない。

**DEV-REL-008:** retry / recoveryで新Business Causeを発行しない。

**DEV-REL-009:** recoveryは元Transactionを最初から再実行せず、current state / authority / correlationを再取得して不足分だけを処理する。

**DEV-REL-010:** Consistency Review creation / dedupe / resolutionはSPEC-150のboundaryへ従い、agentがgeneric state editorを追加しない。

# Part XIII — Observability / Audit

## 29. Structured observability

**DEV-OBS-001:** Application Logは `packages/observability` のschema-validated emitterだけから出し、自由な`console.log(object)`をProduction business codeで使用しない。

**DEV-OBS-002:** emitterはSPEC-160のfield / event schemaをauthorityとし、`request_id`, `operation_id`, `operation_execution_id`, Business Cause、safe provider reference、deployment referenceを該当時に渡す。

**DEV-OBS-003:** Idempotency / auth subject等のsafe correlationはSPEC-160のHMAC fingerprint helperと `OBS_CORRELATION_HMAC_KEY` を使用する。

**DEV-OBS-004:** Metric labelはbounded registryでvalidationし、request/entity/provider ID等のhigh-cardinality値をlabelにしない。

**DEV-OBS-005:** Audit EventはApplication Logで代替しない。required high-risk local Business mutationとAudit persistenceが同一DB transactionで必要な場合、そのatomicityを維持する。

**DEV-OBS-006:** observability sink failureを理由にSecurity / Domain / Payment invariantをskipしない。Audit persistenceがCanonical success conditionに含まれるoperationはSPEC-160どおりFail Closed / rollbackする。

## 30. Logging prohibition

Application Logへ次を出してはならない。

```text
raw QR
Secret
Session credential
Password
reset token
full recipient Email where not explicitly permitted
raw webhook body
full provider error object
SQL bind parameter dump
JWT payload dump
full request / response body automatic dump
unnecessary PII
```

**DEV-OBS-007:** logger APIはraw request / response / SQL bind / provider objectのautomatic serializationを提供しない。

# Part XIV — Infrastructure Boundary

## 31. Feature implementationで変更禁止のInfrastructure

**DEV-INF-001:** 通常feature taskは次を変更してはならない。

- `production` / `staging` / `development` / `test` topology
- Vercel / Railway / Supabase境界
- Railway API / Email Worker / Reconciliation Worker topology
- Node.js major / PostgreSQL major
- Database role separation
- Secret store / reader matrix
- Worker scheduler mechanism / cadence wiring
- migration execution order
- readiness / liveness contract
- Better Stack observability backend
- Healthchecks.io independent alert path
- Audit purge infrastructure
- Cloudflare R2 backup / restore infrastructure
- Production deployment gate

変更が必要な場合はcode changeへ混ぜず、対象Canonical Owner revisionまたはUCRを作成する。

**DEV-INF-002:** WorkerへTest用public HTTP endpointを追加してはならない。

**DEV-INF-003:** feature sourceはProduction environment identity / provider name / deployment topologyをhardcodeせず、SPEC-180で許可されたvalidated configだけを利用する。

# Part XV — Test-first / Traceability

## 32. Test-first rule

**DEV-TST-001:** bug fixは修正前に失敗を再現するTest Caseを追加し、そのTestが修正前にfailし修正後にpassすることを確認する。

**DEV-TST-002:** new behavior実装前にCanonical Owner、Rule ID、既存 `TST-*` / `TC-*` を特定する。該当Caseが存在しなければSPEC-170 contractに従うTest Caseを追加する。

**DEV-TST-003:** System Invariant、DB constraint、transaction race、lock semanticsはreal PostgreSQLでTestする。

**DEV-TST-004:** Provider failureはSPEC-170 Provider Test Double / Fault Pointを使用し、Production SDKをmonkey-patchしてhidden behaviorを作らない。

**DEV-TST-005:** time / randomnessはdeterministic Clock / Random injectionを使用する。ただしProduction CSPRNG semanticsをTest都合で弱化しない。

**DEV-TST-006:** concurrency-sensitive変更はhot concurrency suiteを必須とする。

**DEV-TST-007:** Provider Contract Smokeはnonproduction credentialだけを使い、Production data / Production credentialを使用しない。

**DEV-TST-008:** Test runner retryはSPEC-170どおり0を維持し、Critical Testをquarantineしない。diagnostic rerunはoriginal failureを上書きしない。

## 33. Change classification → required verification

変更前に複数該当可で分類し、全categoryの要求をunionする。

| Category | 必読Canonical Owner | Minimum required Test group | 主な禁止事項 |
|---|---|---|---|
| UI-only | `SPEC-050` or `SPEC-130`, `SPEC-140`, `SPEC-170` | Unit + affected E2E | UIをauthorityにしない |
| API contract | `SPEC-110`, Auth/Security owner, `SPEC-170` | Unit + API + Integration | undocumented route/schema変更 |
| Domain / business logic | `SPEC-030` + domain-specific owner | Unit + Integration + affected API/E2E | new State / exception発明 |
| Database schema / migration | `SPEC-100`, `SPEC-170`, `SPEC-180` | DB migration + Integration + affected API | startup migration / unnamed constraint |
| Security-sensitive | `SPEC-060`, `SPEC-140`, `SPEC-160` | Security + API + affected Integration | fail-open / secret exposure |
| Payment | `SPEC-070`, `100`, `110`, `140`, `150` | Payment Integration/API + Reliability + DB + Security | blind provider retry |
| QR / Check-in | `SPEC-080`, `100`, `140`, `150` | QR/API + DB + Security + hot concurrency | raw QR artifacts / double-use |
| Email | `SPEC-120`, `140`, `150` | Email Integration + Reliability + Provider double | business transaction rerun |
| Reliability / Recovery | `SPEC-150`, `160`, `170` | Reliability + Recovery + Integration | retry/cadence再定義 |
| Observability / Audit | `SPEC-160`, `170` | Observability + DB atomicity where applicable | taxonomy変更 / PII dump |
| Infrastructure | `SPEC-180`, `170` | Infra config validation + deployment gate relevant suites | feature taskへの混在 |
| Test-only | `SPEC-170` + traced owners | changed suite itself + manifest validation | Production bypass追加 |

**DEV-TST-009:** 「Unit Testがpassした」だけで完了判定しない。変更categoryから必要levelを機械的に決定する。

## 34. Traceability files

`tests/traceability/test-manifest.json` はSPEC-170がCanonical Ownerであり、本書はその形式を変更しない。

`traceability/rule-code-map.json` は実装補助indexとして次を最低限保持する。

```json
{
  "schema_version": 1,
  "entries": [
    {
      "rule_id": "PAY-CHK-008",
      "code_paths": ["packages/providers/stripe/..."],
      "test_case_ids": ["TC-..."],
      "notes": "implementation mapping only"
    }
  ]
}
```

**DEV-TRC-001:** `rule-code-map.json` はCanonical behaviorのsourceではない。Spec Rule IDを参照するindexである。

**DEV-TRC-002:** active code pathをUCR-only IDへtraceしてはならない。

**DEV-TRC-003:** 変更したbehavioral sourceは少なくとも1つのCanonical Rule IDへtraceし、critical behaviorは対応 `TC-*` へtraceする。

# Part XVI — AI Agent Canonical Workflow

## 35. Task processing sequence

AI coding agentは1 taskを次の順序で処理する。

1. **Task scope取得** — 要求、変更対象、受入条件、非対象を列挙する。
2. **Change classification** — §33のcategoryを複数選択する。
3. **Canonical Owner特定** — category + behaviorから直接Ownerを読む。
4. **Rule ID抽出** — `INV-*`, `AR-*`, `PAY-*`, `TQR-*`, `DB-*`, `API-*`, `EML-*`, `SEC-*`, `REL-*`, `OBS-*`, `TST-*`, `INF-*` 等を列挙する。
5. **UCR status確認** — UCR-only behaviorをactiveとみなしていないことを確認する。
6. **Existing code / test / migration確認** — implementation map、route、repository、migration、manifestを読む。
7. **Implementation boundary決定** — 変更するpackage/layerと禁止edgeを明示する。
8. **Failing / coverage Test作成** — bugは再現fail、新behaviorはcontract Testを先に作る。
9. **Minimal compliant implementation** — Specで要求される最小変更を行う。無関係refactorを混ぜない。
10. **Focused tests** — 最小scopeのUnit/Integration/API等を実行する。
11. **Static validation** — format/lint/typecheck/import boundaryを実行する。
12. **Wider affected test groups** — §33とSPEC-170 gateに従い実行する。
13. **Security / Secret / Log self-review** — authority、redaction、bundle、fixtureを検査する。
14. **Migration / Provider / Concurrency review** —該当categoryなら必須。
15. **Traceability update** — Test manifest / rule-code mappingを更新する。
16. **Git diff self-review** — unintended file、generated noise、secret、spec driftを検査する。
17. **Completion evidence出力** — §39の固定formatで報告する。

**DEV-AI-001:** workflowの途中でCodeがSpecと矛盾していることを発見した場合、既存CodeをCanonicalと推測しない。

**DEV-AI-002:** 仕様にないState / API / Capability / schema / business exceptionを「実装上必要」という理由で追加しない。

**DEV-AI-003:** spec gapがSPEC-190のRepository / development workflow範囲なら本書ruleとして合理的に決定できるが、Domain/API/DB/Security等の別Canonical Owner変更ならUCRへ送る。

# Part XVII — Upstream Specification Protection

## 36. Spec conflict handling

**DEV-GEN-005:** 実装agentは正式仕様を黙って変更しない。

**DEV-GEN-006:** CodeとSpecが矛盾した場合、Specを基準として差異を報告し、既存Codeの挙動を仕様へ昇格させない。

**DEV-GEN-007:** 上流変更が必要なら `SPEC-000 §15.2` 形式のUpstream Change Requestを作る。UCRは反映まで未実装仕様である。

**DEV-GEN-008:** 「既存コードがそうなっている」は仕様変更理由として十分ではない。Domain need、external contract、security/reliability requirement等の根拠を示す。

**DEV-GEN-009:** 実装taskで正式仕様Markdownを変更する場合は、そのtaskが明示的なspec revisionを含む場合だけ許可する。feature code変更へ無関係なspec rewriteを混ぜない。

# Part XVIII — Generated Code Self-verification

## 37. Mandatory self-verification matrix

完了前に該当項目をすべて実行する。

| Verification | Always / Conditional | Pass condition |
|---|---|---|
| format / Biome | Always | diffなし / exit 0 |
| lint | Always | error 0 |
| TypeScript typecheck | Always | error 0 |
| forbidden import / dependency check | Always | prohibited edge / cycle 0 |
| Unit Test | Always for source change | affected + required G1 pass |
| Integration / API | behavior/API change | relevant suite pass |
| DB migration / DB integration | DB-sensitive | real PostgreSQL pass |
| Security Test | security-sensitive | fail-closed/redaction/no-side-effect pass |
| Reliability / Recovery | retry/provider/worker | required suite pass |
| Observability | log/audit/metric affected | schema/redaction/atomicity pass |
| E2E | user flow changed | affected journey pass |
| hot concurrency | invariant/race-sensitive | G10 required case pass |
| Provider Contract Smoke | provider contract affected / release gate | nonprod smoke pass as SPEC-170/180 requires |
| generated migration review | migration exists | named constraints/no destructive drift/compatible sequence |
| source diff review | Always | no unintended change/generated noise |
| Secret scan | Always | no secret/credential match |
| raw QR / PII / Secret logging review | sensitive paths | prohibited output absent |
| traceability manifest validation | behavior/test change | all references valid; no UCR-only active ID |

**DEV-TST-010:** diagnostic rerun結果だけをcompletion evidenceにせず、最初のgating failureと修正後のclean runを区別する。

**DEV-TST-011:** SPEC-180のProduction promotionではSPEC-170 G1〜G10の要求とstaging/Provider Smoke evidenceをそのまま適用し、本書都合でgateを弱めない。

## 38. Self-review questions

Agentは少なくとも次をdiffに対してyes/no判定する。

- Browser / WebからBusiness DBへ新しい直接accessがないか。
- Client valueをowner/role/price/payment authorityにしていないか。
- transaction中にexternal network callを追加していないか。
- Result Unknownにblind retryを追加していないか。
- raw QR / Secret / PII / raw webhook body / provider full objectを出していないか。
- new Domain State / API / Capability / schemaがSpecなしに追加されていないか。
- named constraint / lock / idempotency / Business Causeを弱めていないか。
- test-only bypass / endpointがProduction graphへ入っていないか。
- Infrastructure topology / runtime major / secret placementを変更していないか。
- UCR-only itemを現行Canonicalとして扱っていないか。

1つでも不適合ならtaskは完了ではない。

# Part XIX — Completion Evidence

## 39. Canonical completion report

AI implementation agentは完了時に次の固定見出しを出力する。internal chain-of-thoughtは要求しない。

```text
Changed scope:
- <classification + concise behavior>

Canonical rules referenced:
- <Rule IDs>

Files changed:
- <path>: <purpose>

Migrations:
- none | <migration file + compatibility notes>

Tests added/changed:
- <TC IDs + paths>

Test groups executed:
- <Gx / command / result>

Security/reliability implications:
- <authority, secret, retry, unknown-result, concurrency implications>

Traceability changes:
- <manifest / rule-code map updates>

Known non-implemented UCRs:
- UCR-130-001〜006: not assumed implemented
- UCR-150-001〜002: not assumed implemented
- UCR-170-001: not assumed implemented

Verification exceptions:
- none | <not-run item + concrete reason + release impact>
```

**DEV-AI-004:** 「tests pass」「done」だけをcompletion evidenceにしてはならない。

**DEV-AI-005:** 実行していないTestをpassedと報告しない。未実行項目は理由とrelease impactを明示する。

# Part XX — Review Checklist by Category

## 40. Required review checks

- **UI-only:** cache/session boundary、Hono API authority、route/visibility、E2E。
- **API contract:** Operation ID、Zod、auth order、owner-safe、error mapping、idempotency、API Test。
- **Domain/business:** state exhaustiveness、Business Cause、invariant、real DB if persistence-sensitive。
- **DB/migration:** physical schema exactness、named constraints、extensions、lock、SQLSTATE、expand/backfill/validate/contract。
- **Security:** fail-closed、secret reader、Client authority、redaction、negative Test。
- **Payment:** amount authority、provider key、webhook signature、unknown result、confirmation atomicity。
- **QR/Check-in:** purpose separation、raw token handling、keyring、single-use、parallel scan。
- **Email:** recipient authority、snapshot、template version、claim lease、unknown result、no business rerun。
- **Reliability/Recovery:** single retry layer、policy registry、same Cause/key、reconciliation-only repair。
- **Observability/Audit:** schema fields、bounded metric labels、Audit atomicity、no sensitive dump。
- **Infrastructure:** SPEC-180 approval path、deployment order、secret/identity impact、gates。
- **Test-only:** no production bypass、fixture isolation、manifest coverage、retry=0。

# Part XXI — Traceability to Canonical Families

## 41. Rule family mapping

| DEV family | Primary upstream trace |
|---|---|
| `DEV-REP`, `DEV-DEP` | `INV-010-*`, `DB-ARC-*`, `API-*`, `INF-ARC-*` |
| `DEV-TS` | `DB-ID-*`, `DB-MNY-*`, `DB-TIM-*`, `API-*`, domain state rules |
| `DEV-WEB` | `INV-010-08〜09`, `AR-*`, `SEC-WEB-*`, `API-*` |
| `DEV-API` | `API-*`, `AR-*`, `SEC-API-*`, `OBS-COR-*` |
| `DEV-DB` | `DB-*`, `REL-DB-*`, relevant `INV-010-*` |
| `DEV-AUTH` | `AR-*`, `SEC-AUTH-*`, `SEC-AZ-*`, `INV-010-08` |
| `DEV-SEC` | `SEC-*`, `INF-SEC-*`, `OBS-SEC-*` |
| `DEV-PAY` | `PAY-*`, `SEC-PAY-*`, `REL-PAY-*`, `INV-010-02/07/09/10` |
| `DEV-TQR` | `TQR-*`, `SEC-QR-*`, `REL-TQR-*`, `INV-010-03/05/10` |
| `DEV-EML` | `EML-*`, `REL-EML-*`, `OBS-EML-*`, `INV-010-06/10` |
| `DEV-REL` | `REL-*`, `TST-REL-*`, `TST-REC-*` |
| `DEV-OBS` | `OBS-*`, `TST-OBS-*` |
| `DEV-INF` | `INF-*`, `TST-*` deployment gate |
| `DEV-TST` | `TST-*`, `TC-*`, `INV-010-*` |

**DEV-TRC-004:** 上表はrule familyの探索開始点であり、実装taskでは具体的Rule IDまで解決する。

# Part XXII — Acceptance Criteria

## 42. SPEC-190 Acceptance Criteria

SPEC-190は以下を全て満たすとき受入可能である。

1. Repository layoutがAI agentにより一意に解釈できる。
2. package / layer dependency directionと禁止edgeが明示される。
3. Web / BrowserからBusiness Database直接mutation/queryによるBusiness authorityを禁止する。
4. Hono APIをBusiness mutation authorityとして維持する。
5. strict TypeScriptとruntime validation境界を定義する。
6. Internal ID / Public Reference / Money / bigint / UTC Instant / Asia/Tokyo Business Dateの型混同を防ぐ。
7. Hono route / middleware / service / repository / provider adapter責務を分離する。
8. DB transaction中のexternal network callを禁止する。
9. migrationをapplication startupで自動実行しない。
10. named constraint / lock / transaction / extension ruleを維持する。
11. Client role / owner / price / payment resultをauthorityにしない。
12. Security Configuration invalid時にFail Closedする。
13. SecretをClient / source / log / fixture / snapshot / build outputへ出さない。
14. Stripe Provider Result Unknownをblind retryしない。
15. raw QRをlog / assertion / screenshot / traceへ出さない。
16. Email retryが元Business Transactionを再実行しない。
17. Reliability retry / timeout / cadenceをSPEC-190で再定義しない。
18. SPEC-160 event / metric / alert / sampling / retention taxonomyを再定義しない。
19. raw QR / Secret / credential / unnecessary PIIのloggingを禁止する。
20. Infrastructure topologyをfeature implementation agentが変更しない。
21. Test-first、Rule ID、Test Case ID、Traceabilityへ接続される。
22. Critical Test retry=0 / quarantine禁止を維持する。
23. generated code self-verificationが具体的な実行項目を持つ。
24. 上流仕様を実装agentが黙って変更できない。
25. UCR-only仕様を実装済みと仮定しない。
26. completion evidenceが再現可能な固定formatを持つ。
27. Production codeとTest Harnessが分離される。
28. `INV-010-01〜10` と関連 `AR-*`, `PAY-*`, `TQR-*`, `DB-*`, `API-*`, `EML-*`, `SEC-*`, `REL-*`, `OBS-*`, `TST-*`, `INF-*`へ追跡可能である。
29. 長期運用される完成システムを対象とする。
30. 未確定表現を残さない。

# Part XXIII — Upstream Change Requests

## 43. 上流仕様変更要求

なし。

本書は `UCR-130-001〜006`, `UCR-150-001〜002`, `UCR-170-001` を継承して未反映と扱うが、それらを新規要求として再提出しない。

## 44. 最終禁止事項

本仕様の実装agentは、少なくとも次をしてはならない。

- 上流Specより既存Codeを優先する。
- Browser / Next.js WebからBusiness DBへBusiness mutationを追加する。
- `ADMINISTRATOR`へ暗黙`STAFF`権限を与える。
- Provider SDKをDomain decision layerへ持ち込む。
- DB transaction内にStripe / Resend / Supabase Auth callを置く。
- `23505` / `23P01`をblind retryする。
- startupでmigrationを実行する。
- Payment / Email Unknown Resultへnew provider idempotency keyでblind retryする。
- raw QR、Secret、Session credential、raw webhook body、full provider error objectをlogする。
- Test用public worker endpointをProductionに追加する。
- Critical Testをretry / quarantineで緑にする。
- Feature taskへInfrastructure topology変更を混ぜる。
- UCR-only operationをcurrent APIとして実装する。

