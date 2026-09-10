---
spec_id: SPEC-140
title: Security Specification
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
  - SPEC-100
  - SPEC-110
  - SPEC-120
  - SPEC-130
related_specs:
  - SPEC-040
  - SPEC-050
  - SPEC-090
  - SPEC-150
  - SPEC-160
  - SPEC-170
  - SPEC-180
  - SPEC-200
---

# 140 Security Specification

## 1. 目的

本書は、**off r39'x in 大阪らへん2027** Webシステムの完成形におけるSecurity Architecture、Trust Boundary、Threat Model、Authentication / Session security、Authorization enforcement、Browser / Next.js security、Hono API security、CSRF / CORS、XSS / Content security、Security Header、Supabase PostgreSQL access control、Secret / Key management、Stripe / Resend / Webhook security、Ticket / QR token protection、Administrator / Staff privileged operation security、Personal Data minimization、rate limit / abuse protection、error disclosure、environment separation、およびsecurity failure時のFail Closed behaviorを定義する。

本書は **Security Control / Security BoundaryのCanonical Owner** である。

本書は次を変更しない。

- `SPEC-060` のAuthentication State、Role Assignment、Operational Role、Capability Matrix
- `SPEC-070` のOrder / Payment / Refund lifecycle
- `SPEC-080` のTicket / QR Payload / Check-in semantics
- `SPEC-100` のDatabase physical schema / state / constraint
- `SPEC-110` のAPI endpoint / namespace / request / response / error envelope
- `SPEC-120` のNotification Domain / Processing State / Email lifecycle
- `SPEC-130` のAdministrator / Staff Page / Route / UX contract
- `SPEC-010` のSystem Boundaryと `INV-010-01〜10`

Security Controlを理由として、Client申告RoleをAuthorityへ昇格させる、Administratorをgeneric superuserへする、Public Referenceをcredentialへする、Browser / Next.js WebからBusiness Databaseを直接更新する、Provider result unknownを成功扱いする等の上流変更を行ってはならない。

本書はMVP、Step1、Step2、初期リリース等でSecurity Controlを分断しない。長期運用される完成システムのSecurity baselineを定義する。

---

## 2. Canonical Scope

本書は少なくとも次をCanonicalに所有する。

- protected assetとsecurity objective
- trust boundaryとthreat / abuse case
- Authentication token verificationとSession / Cookie policy
- Authorization enforcement / least privilege
- Browser / Next.js Web security
- Hono API transport / request security
- CSRF / CORS
- XSS / Public Content / HTML rendering policy
- Security Header / HTTPS / cache control
- Database principal / grants / direct access防止
- SQL injection / identifier injection防止
- Secret classification / storage reader boundary / rotation policy
- Stripe Checkout / Webhook / Refund security
- QR Token HMAC / encryption / key version / rotation
- scanner input security
- Resend / Email / webhook security
- Administrator / Staff privileged operation security
- Personal Data minimization / masking / copy boundary
- rate limit / enumeration / brute-force resistance
- error disclosure / redaction
- dependency / third-party integration security
- security configuration validation
- security failure時に許可してはならないoperation
- Security Acceptance Criteria

以下は本書のCanonical Ownerではない。

- Audit Event schema / metric taxonomy / monitoring event taxonomy: `SPEC-160`
- retry回数 / backoff sequence / timeout recovery runbook / reconciliation runbook: `SPEC-150`
- deployment command、DNS、hosting wiring、Secret storeの製品別設定手順: `SPEC-180`
- Test case catalog: `SPEC-170`

ただし、Security Controlが安全に評価できない場合の**禁止事項とFail Closed結果**は本書で定義する。

---

## 3. 依存仕様と採用理由

| Spec | 本書が直接利用するCanonical contract |
|---|---|
| `SPEC-000` | Canonical Owner、`depends_on`、Upstream Change Request、未決定事項決定規則 |
| `SPEC-010` | System Boundary、Trust Boundary原則、System of Record、`INV-010-01〜10` |
| `SPEC-020` | `FR-AUTH-*`, `FR-ADM-*`, `FR-STF-*`, `FR-EML-*`, `FR-XFN-*` とPayment / Ticket / Goods関連要件 |
| `SPEC-030` | Domain Entity / Ownership / State / Business Rule / `DI-030-*` |
| `SPEC-060` | Authentication State、Session責務、Role / Capability、Ownership、Role revoke |
| `SPEC-070` | Stripe Checkout / Webhook / Payment / Refund / Unknown Result / idempotency |
| `SPEC-080` | QR format、Token lifecycle、Check-in、single-use、rotation |
| `SPEC-100` | `app` schema、DB physical columns、QR protected fields、constraint / transaction |
| `SPEC-110` | `/api/v1`、namespace、Hono RPC、Zod、error、size limit、idempotency、server operation |
| `SPEC-120` | Resend / Notification / recipient resolution / Email support persistence / webhook |
| `SPEC-130` | `/admin/*`, `/staff/*`, high-risk action、Minimal Staff Data、UCR-130-001〜006 |

`SPEC-040`, `SPEC-050`, `SPEC-090` はUser Flow / general Page / Karaoke business detailの関連仕様である。本書は、それらのCanonical stateやPageを再定義しない。

### 3.1 SPEC-130 Upstream Change Requestの扱い

`UCR-130-001〜006` は本書作成時点では**未反映の上流変更要求として扱う**。

本書は次を行わない。

- `entry_sales.manage` / `karaoke_sales.manage` が既に `SPEC-060` に存在するとみなす
- UCRで要求中のAdmin API / Staff Handoff preview APIが既に `SPEC-110` に存在するとみなす
- UCRで要求中のDatabase Indexが既に `SPEC-100` に存在するとみなす

これらが将来Canonical化された場合、追加されたoperationにも本書の同じSecurity Controlを適用しなければならない。

---

## 4. Canonical Security Terms

| Term | 意味 |
|---|---|
| Protected Asset | 漏えい、改ざん、破壊、重複実行、権限外利用から守る対象 |
| Trust Boundary | 一方の入力をAuthorityとして信頼する前に検証が必要となる境界 |
| Browser-facing Boundary | BrowserとNext.js Web間の境界 |
| Business API Boundary | Next.js Web / trusted server callerとHono API間の境界 |
| Provider Webhook Boundary | Stripe / ResendからHono APIへ到達する署名付き外部入力境界 |
| Authorization Principal | `SPEC-060` のverified Auth Subject + Business Profile + current Role Assignment |
| Security Fail Closed | Security条件を安全に評価できない場合、権限や成功を推測せずoperationを拒否すること |
| Sensitive Data | Session token、Secret、raw QR token、recipient Email等、漏えい時にsecurity / privacy影響がある値 |
| Secret | Clientへ公開せず、特定runtimeだけが読めるcredential / cryptographic key |
| High-risk Operation | Refund、Reservation cancellation、QR rotation、Role mutation等、誤実行または乗っ取り時の影響が大きいoperation |
| Provider Result Unknown | Provider side effectの成功 / 失敗を安全に断定できない状態 |
| Security Configuration | Origin、Host、key version、Secret、rate limit等、Security Controlを成立させるserver-side設定 |
| Redaction | Client / log / operational viewからsecret / PII /内部detailを除去またはmaskすること |

---

## 5. Rule ID体系

本書のNormative Ruleは次のPrefixを使用する。

| Prefix | Category |
|---|---|
| `SEC-TRU-*` | Trust Boundary / Threat Model |
| `SEC-AUTH-*` | Authentication / Session / Cookie |
| `SEC-AZ-*` | Authorization / least privilege |
| `SEC-WEB-*` | Browser / Next.js / CSP / Security Headers |
| `SEC-API-*` | API / CORS / CSRF / request security |
| `SEC-DB-*` | Database / SQL / credential boundary |
| `SEC-KEY-*` | Secret / cryptographic key management |
| `SEC-PAY-*` | Stripe / Payment / Refund |
| `SEC-QR-*` | Ticket / QR token protection |
| `SEC-EML-*` | Resend / Email |
| `SEC-ADM-*` | Administrator / Staff privileged operation |
| `SEC-PII-*` | Personal Data / masking / redaction |
| `SEC-ABU-*` | Abuse / rate limit / enumeration |
| `SEC-DEP-*` | Dependency / third-party integration |
| `SEC-ERR-*` | Security failure / error disclosure |

同一Rule IDを別の意味へ再利用してはならない。

---

# Part I — Security Objective / Threat Model

## 6. Protected Assets

本システムの主要Protected Assetを次とする。

| Asset | Security objective |
|---|---|
| Supabase Auth Session / access / refresh material | 本人以外が再利用できないこと、Client JSやlogへ不必要に露出しないこと |
| Business Profile / Ownership relation | 別人への付け替え、IDOR、enumerationを防止すること |
| Role Assignment / Capability | Client申告、古いSession、UI stateから権限昇格できないこと |
| Order / Payment / Refund | 金額改ざん、二重確定、二重Refund、fake provider eventを防止すること |
| Entry / Karaoke Ticket | 未支払権利の有効化、重複発行、無断取消を防止すること |
| QR raw token / protection key | bearer token漏えいとDB漏えいからの一括復元を抑制すること |
| Check-in / Goods Handoff | 二重成立、Staff権限外操作、scanner input改ざんを防止すること |
| Karaoke Slot / Reservation | Slot二重販売、無権限取消、再販売禁止rule迂回を防止すること |
| Notification Request / recipient snapshot | 宛先すり替え、blind resend、Email PII漏えいを防止すること |
| Public Content | stored / reflected XSS、unsafe URL、権限外publishを防止すること |
| Database | Browser direct access、SQL injection、過剰DB principal privilegeを防止すること |
| Server Secrets | source control / Client bundle / log / nonproductionへ露出しないこと |
| Operational history | Security障害を理由に確定済み履歴を消失させないこと |

**SEC-TRU-001:** Confidentiality、Integrity、Availabilityのうち、金銭・権利・Role・Check-in・WebhookのIntegrityを最優先し、Availability障害時にIntegrity Controlを無効化して継続運転してはならない。

**SEC-TRU-002:** Security failureを回避するために認証・署名・CSRF・Domain precondition・DB constraintのいずれかを一時的にskipするfallbackを実装してはならない。

## 7. Trust Boundary

Canonical data flowは次とする。

```text
Browser
  -> HTTPS -> Next.js Web / Vercel
  -> HTTPS + Bearer Auth -> Hono API / Railway
  -> TLS -> Supabase PostgreSQL

Browser / Next.js Web <-> Supabase Auth
Hono API <-> Supabase Auth
Hono API <-> Stripe
Hono API / Email Worker <-> Resend

Stripe -> HTTPS signed webhook -> Hono API
Resend -> HTTPS signed webhook -> Hono API
```

### 7.1 Boundary rules

**SEC-TRU-003:** Browser inputは、認証状態、Role、owner、price、payment result、inventory、Slot availability、QR validity、Notification recipientのAuthorityではない。

**SEC-TRU-004:** Next.js Webはtrusted presentation / BFF layerではあるが、最終Authorization Authorityではない。Hono APIはprotected requestごとにPrincipalとCapability / Ownershipを再評価する。

**SEC-TRU-005:** Stripe / ResendからのHTTP requestは、署名検証前はInternet上の任意requestと同じuntrusted inputとして扱う。

**SEC-TRU-006:** Business Database rowはSystem of Recordであるが、DB rowを取得できたこと自体はAuthorization successではない。

## 8. Threat Actor / Abuse Case

最低限、次を想定する。

| Threat actor / abuse | Defense boundary |
|---|---|
| 未認証Internet attacker | HTTPS、rate limit、validation、no CORS trust、webhook signature |
| 認証済み一般利用者によるIDOR | owner-safe query、404 masking、Server-side Principal |
| Session cookie窃取を狙うattacker | HttpOnly / Secure / CSP / CSRF / short access token |
| Staff account compromise | Role-specific capability、Minimal Staff Data、rate limit、current role evaluation |
| Administrator account compromise | operation-specific capability、high-risk confirmation、idempotency、Business Rule保持 |
| Client改ざん / DevTools | Zod、allowlist、price / role / owner再導出 |
| Stored XSS投稿 | plain-text content contract、escaping、CSP |
| Webhook spoof / replay | raw-body signature、timestamp tolerance、event dedupe |
| QR screenshot / copied bearer token | 256-bit token、single-use、current Ticket state、rotation |
| Database read leak | QR HMAC + encrypted token material、Secret分離、PII minimization |
| Duplicate / replay request | Domain Business Cause、DB unique、Idempotency-Key、current state |
| Host header poisoning / open redirect | configured base URL / host allowlist / safe continuation |
| SQL / identifier injection | Zod allowlist、Drizzle parameterization、raw SQL restrictions |
| Dependency compromise | lockfile、integrity、secret boundary、dependency review |

**SEC-TRU-007:** Insider / compromised privileged accountを「trustedだからvalidation不要」と扱わない。Administrator / Staff inputも通常Client inputと同じValidationを受ける。

---

# Part II — Authentication / Session Security

## 9. Authentication input / token verification

`SPEC-110` のprotected APIは `Authorization: Bearer <access-token>` を使用する。

**SEC-AUTH-001:** Hono APIはprotected requestごとにSupabase Auth access tokenをServer-sideで検証する。JWT payloadをdecodeしただけの処理をAuthenticationとみなしてはならない。

検証はSupabase Authが現在提供する公式server verification方式または等価な標準JWT verificationを使用し、最低限次を成立させる。

1. signatureがtrusted key / JWKSにより有効
2. expected issuerがenvironment設定とexact match
3. expected audienceを使用する構成ではaudienceがexact match
4. `exp` が現在時刻より後
5. `nbf` が存在する場合は現在時刻が到達済み
6. `sub` が正規Auth Subjectとしてparse可能
7. `alg=none` およびSecurity Configuration外のalgorithmを拒否
8. verification keyをuntrusted token headerの任意URLから取得しない

JWKS URL / issuer / audienceはenvironment-specific server configurationとし、Client input / Host headerから組み立てない。

**SEC-AUTH-002:** key取得cacheは許可するが、署名検証失敗時に「cacheが古いかもしれない」という理由でtokenをacceptしてはならない。必要ならtrusted JWKSを再取得して一度だけ再検証し、それでも成立しなければFail Closedとする。

**SEC-AUTH-003:** Email確認がrequiredなoperationでは、`SPEC-060` のEmail verified stateをSupabase AuthのServer-side authorityから確認する。Client-visible email string、Business Profile、Stripe Emailをverification根拠にしない。

## 10. Access token lifetime / refresh boundary

**SEC-AUTH-004:** Production Supabase Auth access token lifetimeは **900秒（15分）** をSecurity baselineとする。Environmentがこれより長いaccess token lifetimeを設定してはならない。

Session refreshは `SPEC-060 AR-SES-006` に従いBrowser / Next.js WebのSupabase Auth integrationが担う。Hono APIはBusiness request処理中に長期Session lifecycleを所有しない。

**SEC-AUTH-005:** expired tokenをgrace periodでBusiness operationへ通してはならない。refresh成功後に新しいaccess tokenをHono APIが改めて検証する。

**SEC-AUTH-006:** Session / refresh credential / Password CredentialをBusiness Databaseへ保存してはならない。

## 11. Cookie Policy

Supabase Auth由来のSession materialを保持するCookieは次を満たす。

| Attribute | Canonical policy |
|---|---|
| `Secure` | **MUST true**。ProductionでHTTP送信禁止 |
| `HttpOnly` | **MUST true** for access / refresh / session credential material |
| `SameSite` | **Lax** |
| `Path` | `/` |
| `Domain` | **設定しない**。host-only cookie |
| Expiry | Provider session lifetimeと整合。不要なpermanent cookie化禁止 |

**SEC-AUTH-007:** Session credentialを`localStorage`、`sessionStorage`、IndexedDB、URL query、URL fragment、HTML hidden fieldへ複製してはならない。

**SEC-AUTH-008:** Browser JavaScriptがaccess / refresh tokenを読み出してRailway Hono APIへ直接cross-origin送信する方式をCanonical transportとしない。Browserのbusiness requestはNext.js WebをBrowser-facing boundaryとし、Next.js WebがServer-sideでHono APIへBearer tokenをforwardする。

**SEC-AUTH-009:** Auth callback / refresh等でCookieを更新するresponseも`Cache-Control: no-store`とし、Session credentialをshared cacheへ保存させない。

## 12. Session fixation / login / logout

**SEC-AUTH-010:** Login成功、Password reset completion、Session recovery等、Guest / recovery contextからauthenticated Sessionへ遷移する時点で、pre-authentication Session credentialを再利用せず、Supabase Authが新たに成立させたSessionへ置換する。

**SEC-AUTH-011:** Login成功 / Logout完了時にCSRF tokenもrotateする。

**SEC-AUTH-012:** LogoutではBrowser側Session Cookieを削除し、Supabase Authの正規logout処理を実行する。Logout request失敗を「server session revoke済み」と偽装しない。

**SEC-AUTH-013:** Logout後の `/mypage/*`, `/admin/*`, `/staff/*` のresponse再利用を防ぐためprotected HTML / API responseは`no-store`とする。BFCache復元が起きたClientはsensitive contentを操作可能にする前にSessionをServer-sideで再検証し、無効なら即時にAuthentication Gateへ遷移する。

## 13. Privileged session freshness

本システムは、`SPEC-060` に存在しない新しいstep-up Authentication StateをSPEC-140から追加しない。

**SEC-AUTH-014:** Refund、Reservation cancellation、QR rotation、Role Assignment、Notification recoveryを含むHigh-risk Operationは、通常Sessionに加えて**当該Requestでのfresh server-side token validation + current Role Assignment再評価**を必須とするが、Password再入力 / MFA等の独自step-upを本versionでは要求しない。

理由は、step-upを追加すると `SPEC-060` のAuthentication State / User Flow変更を必要とするためである。将来step-upを導入する場合はUpstream Change Requestとして `SPEC-060` を先に変更する。

**SEC-AUTH-015:** `SEC-AUTH-014` は古いRole snapshotを許可する意味ではない。privileged requestは毎回Business Databaseのcurrent `ACTIVE` Role Assignmentを評価する。

## 14. Password / Auth entry security boundary

Credential lifecycleはSupabase AuthがSystem of Recordである。

**SEC-AUTH-016:** 新規Password設定 / reset時にWeb UIは **12文字以上128文字以下** を要求する。Passwordをtrim、case-fold、Unicode normalizationして別値へ変換してはならない。

**SEC-AUTH-017:** Password compositionとして「英大文字・記号を必ず1つ」等の固定複雑性ruleは追加しない。長さを優先し、Supabase Authが提供する漏えいPassword / bot / abuse protection機能が利用可能な場合はProductionで有効化する。

**SEC-AUTH-018:** Password、Password reset token、Email verification tokenをapplication log、Business Database、analyticsへ記録しない。

**SEC-AUTH-019:** Auth entry pointのapplication側rate limitはPart XIIIを適用する。Supabase Auth provider endpoint自体のabuse protectionはprovider側controlも有効化し、application側rate limitだけでProvider endpointを保護したとみなさない。

---

# Part III — Authorization / Least Privilege

## 15. Canonical authorization sequence

Protected Hono APIは、`SPEC-060` / `SPEC-110` を次の順序で実装する。

1. request syntax / sizeの安全な受理
2. Authentication token verification
3. Email verified check
4. Auth Subject取得
5. Business Profile resolution
6. owner relationまたはcurrent Role Assignment + Capability
7. Domain precondition / current state
8. idempotency / concurrency control
9. Business effect

**SEC-AZ-001:** UI route guard、Navigation非表示、Client-side capability cacheはUXでありAuthorizationではない。

**SEC-AZ-002:** `user_id`, `auth_subject`, `profile_id`, `role`, `permission`, `customer`, owner fieldをClient authorityにしない。

**SEC-AZ-003:** Public Referenceはaddressing inputでありAuthorization credentialではない。

## 16. Namespace authorization

| Namespace | Security boundary |
|---|---|
| `/api/v1/public/*` | Authentication不要。Server-sideで公開可能Dataだけをfilter |
| `/api/v1/self/*` | verified Session + Business Profile。owner-safe lookup |
| `/api/v1/staff/*` | verified Session + active `STAFF` + operation-specific Capability |
| `/api/v1/admin/*` | verified Session + active `ADMINISTRATOR` + operation-specific Capability |
| `/api/v1/webhooks/*` | Supabase AuthではなくProvider signature。Browser credentialで代用不可 |

**SEC-AZ-004:** `ADMINISTRATOR` は `STAFF` を自動継承しない。

**SEC-AZ-005:** `Customer` をRoleとして保存・評価しない。

**SEC-AZ-006:** AdministratorもDomain Business Rule / System Invariantを通常operationで迂回できない。

## 17. Ownership / existence leakage

**SEC-AZ-007:** Owner限定resourceはPublic Referenceとverified owner relationを同一Server-side query条件または同一transaction内で検証する。

**SEC-AZ-008:** unknown Public Referenceと別Owner resourceはどちらも `404 RESOURCE_NOT_FOUND` とし、existence oracleを作らない。

**SEC-AZ-009:** Admin / Staffのoperation-level Capability denialは、対象resourceを取得・表示する前に判定可能な場合 `403 AUTHORIZATION_DENIED` とし、resource detailを同responseへ含めない。

## 18. Role Assignment security

**SEC-AZ-010:** Role grant / revokeは `role_assignment.manage` を持つactive Administratorのみが実行できる。

**SEC-AZ-011:** Administrator自身への通常self grant / self revokeを許可しない。

**SEC-AZ-012:** 最後のactive Administratorを失わせるmutationは、`SPEC-100` のglobal advisory lock + current active Administrator count再評価を通過しない限り成立させない。

**SEC-AZ-013:** Role revokeは次のprivileged requestから即時に反映し、Session内の古いRole表示やNext.js cacheをAuthorityにしない。

**SEC-AZ-014:** Role grant targetは `SPEC-130` の `target_profile_ref` を使用し、任意Email検索をSPEC-140から追加しない。

## 19. Recovery capability

**SEC-AZ-015:** `recovery.exception.execute` はgeneric superuser bypassではない。API側に明示された個別operation ID、required current state、operation-specific Business Ruleのすべてが成立する場合だけ認可する。

**SEC-AZ-016:** `recovery.exception.execute` を持つことだけで任意SQL、任意state edit、任意Refund amount、check-in override、Role overrideを許可してはならない。

---

# Part IV — Browser / Next.js Web Security

## 20. HTTPS-only

**SEC-WEB-001:** ProductionのBrowser-facing WebとHono APIはHTTPS onlyとする。HTTP requestはBusiness contentを返さずHTTPSへredirectするかplatform edgeで拒否する。

**SEC-WEB-002:** Production HTML、CSS、script、image、API callに`http://` subresourceを含めない。Mixed Contentを許可しない。

## 21. Content Security Policy

Production HTML responseはrequestごとにCSPRNG nonceを生成し、CSP headerとNext.jsが出力する許可scriptへ同じnonceを適用する。

Canonical CSPは次をbaselineとする。

```text
default-src 'self';
script-src 'self' 'nonce-{REQUEST_NONCE}' 'strict-dynamic';
script-src-attr 'none';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self';
object-src 'none';
base-uri 'none';
frame-ancestors 'none';
frame-src 'none';
form-action 'self';
manifest-src 'self';
worker-src 'self' blob:;
media-src 'self' blob:;
upgrade-insecure-requests;
```

**SEC-WEB-003:** Production `script-src`へ `'unsafe-inline'` または `'unsafe-eval'` を追加してはならない。

**SEC-WEB-004:** third-party analytics、chat widget、external font、tag manager等、上流要件に存在しないoriginをCSPへ予防的にallowlistしない。

**SEC-WEB-005:** Stripe Checkoutはhosted pageへのtop-level navigationとして利用し、Stripe frameを埋め込むために`frame-src`を緩和しない。

**SEC-WEB-006:** Supabase AuthとのBrowser直接connectionを必要とする実装へ変更する場合、必要originだけを`connect-src`へ追加するSecurity specification changeが必要であり、`*`へ緩和してはならない。

## 22. Security Headers

Production Web responseは次を送る。

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `DENY` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Permissions-Policy` | route別Policy |
| `Content-Security-Policy` | §21 |

`/auth/*`, `/mypage/*`, `/admin/*`, `/staff/*` は追加で `Referrer-Policy: no-referrer` を使用する。

Hono API JSON responseは最低限次を送る。

```text
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
Strict-Transport-Security: max-age=63072000; includeSubDomains
```

**SEC-WEB-007:** HSTSの`includeSubDomains`を使用するため、本システム管理下のProduction subdomainはHTTPS以外で利用してはならない。Deployment wiringは `SPEC-180` が確認する。

### 22.1 Permissions-Policy

通常Page:

```text
camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()
```

`/staff/check-in/entry` と `/staff/check-in/karaoke` のcamera scanner Pageだけ:

```text
camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=()
```

**SEC-WEB-008:** Admin Page、Mypage、Public Pageへcamera permissionを広げない。

## 23. Cache / source map / error page

**SEC-WEB-009:** `/auth/*`, `/mypage/*`, `/admin/*`, `/staff/*`、Order status、QR payload response、Session mutation responseは:

```text
Cache-Control: no-store, private, max-age=0
Pragma: no-cache
```

を使用する。

**SEC-WEB-010:** Public Event / FAQ / Announcement等はBusiness stateに応じてcacheしてよいが、personalized / role-specific payloadをpublic cache keyへ混入させない。

**SEC-WEB-011:** Production browser source mapをpublicly downloadableにしない。Observability用source mapを保持する場合はprivate artifactとして扱い、公開Web assetへ配置しない。

**SEC-WEB-012:** Production error pageへstack trace、environment variable、filesystem path、SQL、provider response bodyを表示しない。

## 24. Open redirect / Host header

**SEC-WEB-013:** Continuation Intentはrelative pathのみ許可する。次を拒否する。

- schemeを持つURL
- `//` で始まるnetwork-path reference
- backslashを含むpath
- username / password component
- control character
- percent decode後に上記禁止形へなる値
- `/admin/*`, `/staff/*` へRole確認をskipして直接通す値

最終redirect前に再parseし、同一origin pathであることを再確認する。

**SEC-WEB-014:** Server-generated absolute URLは`APP_BASE_URL`等のtrusted configurationから生成し、incoming `Host`, `X-Forwarded-Host`, query parameterをAuthorityにしない。

**SEC-WEB-015:** configured canonical host以外のProduction Host headerはBusiness page生成前に拒否またはcanonical hostへredirectする。

## 25. Dangerous URL scheme

**SEC-WEB-016:** User / Admin入力をlink destinationへ利用する場合、`javascript:`, `data:`, `vbscript:`, `file:` その他non-HTTPS schemeをrejectする。Public ContentはPart Vのplain-text contractを使用し、任意URL auto-linkificationを行わない。

---

# Part V — XSS / Public Content Security

## 26. Public Content format

上流仕様にrich HTML / Markdown requirementが存在しないため、Event、FAQ、Announcementの管理本文は**plain text first**をCanonicalとする。

**SEC-WEB-017:** Event summary、venue details、access information、participant notices、FAQ question / answer、Announcement title / bodyをraw HTMLとして解釈しない。

**SEC-WEB-018:** Markdown parserを導入せず、`<script>`, `<img onerror>`, Markdown link syntax等は入力文字列として保存できても、表示時はescaped textとしてrenderする。

**SEC-WEB-019:** `dangerouslySetInnerHTML`、raw DOM insertion、HTML sanitizer依存のrich content rendererをPublic Content表示へ使用しない。

**SEC-WEB-020:** 改行表示が必要な場合はtext node + CSS (`white-space`) またはsafe line splittingで表現し、HTML string生成で改行を挿入しない。

## 27. Admin preview

**SEC-WEB-021:** Admin Public Content previewは公開画面と同じescape / renderer componentを使用する。Previewだけraw HTMLを有効にしない。

**SEC-WEB-022:** Preview contentを`srcdoc`, unsandboxed iframe, Blob HTML documentへ流し込まない。

**SEC-WEB-023:** Publication State変更はXSS sanitizationの代替ではない。`DRAFT`でもAdmin Sessionを攻撃できるため同じescapingを適用する。

## 28. Reflected XSS

**SEC-WEB-024:** query / path / validation errorのClient表示ではReact text interpolation等のescaped contextを使用し、入力値をHTML stringへ連結しない。

**SEC-WEB-025:** request URL、search keyword、Public Referenceをmeta tag / script block / inline event handlerへ未escapeで挿入しない。

---

# Part VI — CSRF / CORS

## 29. Browser-to-Next.js CSRF model

Canonical Browser business flowは `Browser -> Next.js Web -> Hono API` である。

BrowserはSession CookieをNext.jsへ送るため、authenticated state-changing browser requestにはCSRF defenseを必須とする。

### 29.1 CSRF token

Next.js WebはBrowser Sessionごとにrandom **256-bit** CSRF tokenを生成し、次で保持する。

Cookie:

```text
__Host-r39x-csrf=<43-char-base64url-random>
Secure
SameSite=Strict
Path=/
HttpOnly=false
Domain=<unset>
```

Request header:

```text
X-R39X-CSRF: <same token>
```

**SEC-API-001:** Authenticated `POST`, `PUT`, `PATCH`, `DELETE` 相当のBrowser-origin mutationは、CSRF cookieとheaderがconstant-timeで一致し、かつOrigin checkが成功した場合だけNext.js WebからHono APIへforwardする。

**SEC-API-002:** CSRF tokenはAuthentication credentialではない。漏えいしても単独でUser identityを成立させない。

**SEC-API-003:** CSRF tokenはLogin成功 / Logoutでrotateする。Session credentialと同じCookieへ格納しない。

### 29.2 Origin / Fetch Metadata

State-changing requestでは次も要求する。

- `Origin` がconfigured canonical Web originとexact match
- Browserが `Sec-Fetch-Site` を送る場合 `same-origin` を要求
- `Sec-Fetch-Mode` / `Sec-Fetch-Dest` はoperationに不整合なnavigation / embedをreject可能

**SEC-API-004:** `Origin`欠落を無条件allowしない。Browser UI mutationでOriginを取得できないlegacy clientを標準対応しない。

**SEC-API-005:** CSRF / Origin failureは `403` とし、Hono business mutationを呼ばない。

## 30. Hono API CORS

Hono APIの`/public`, `/self`, `/staff`, `/admin` business routeはServer-to-server Next.js callerをCanonicalとするため、Browser cross-origin accessを標準Capabilityとしない。

**SEC-API-006:** `/api/v1/self/*`, `/api/v1/staff/*`, `/api/v1/admin/*` に `Access-Control-Allow-Origin: *` を付与してはならない。

**SEC-API-007:** credentialed CORS (`Access-Control-Allow-Credentials: true`) をprotected business routeで使用しない。

**SEC-API-008:** Browserからのpreflight `OPTIONS` はBusiness actionを実行しない。Protected routeへのcross-origin preflightにはAuthorization successを返す必要はなく、CORS headerなしで拒否してよい。

Public APIをBrowser direct readへ開放する必要がある場合も、Originはenvironment-specific exact allowlistのみとし、`*`は使わない。Allowlistはscheme + host + portのexact originとする。

## 31. Webhook CSRF boundary

**SEC-API-009:** Stripe / Resend webhookはBrowser Session Cookieを使用しないためBrowser CSRF tokenを要求しない。代わりにProvider signature verificationを唯一のProvider authentication boundaryとする。

**SEC-API-010:** Webhook routeへCORS success headerを付ける必要はない。Browser Authorization Bearer tokenが存在してもsignature failureをoverrideしない。

---

# Part VII — Hono API Request Security

## 32. Runtime validation / mass assignment

**SEC-API-011:** 全path / query / JSON body / webhook envelopeは `SPEC-110` のZod Runtime Validationを使用する。TypeScript型だけでruntime validationを代替しない。

**SEC-API-012:** `PATCH` / command bodyはoperationごとのallowlisted fieldのみ受け、unknown fieldはstripではなくrejectを標準とする。これにより将来fieldが追加されてもmass assignmentで権限外fieldを更新しない。

**SEC-API-013:** owner ID、Role、state、price、currency、provider ID、check-in actor、created_at等のServer-owned fieldをgeneric object spreadでrepository updateへ渡さない。

## 33. Request size / content type

`SPEC-110` のsize limitを維持する。

| Request | Limit |
|---|---:|
| normal JSON | 64 KiB |
| QR scan body | 4 KiB |
| Stripe raw webhook | 1 MiB |
| Resend raw webhook | 256 KiB |

**SEC-API-014:** body limitをJSON parse後だけで確認せず、stream / raw body受理段階で超過を停止する。

**SEC-API-015:** JSON endpointは `Content-Type: application/json` を要求し、不正Content-Type、malformed JSON、duplicate ambiguous fieldをBusiness inputとして処理しない。

**SEC-API-016:** QR payloadはcanonical maximum lengthを超える入力をHMAC / DB lookup前にrejectする。`r39x1.<purpose>.<43>` 以外の長大payloadを暗号処理へ渡さない。

## 34. SQL / identifier injection

**SEC-API-017:** Drizzle query builder / `pg` parameterized queryを使用し、valueをSQL string interpolationしない。

**SEC-API-018:** sort column、filter field、table名、column名等のidentifierはClient文字列をquoteして利用するのではなく、code-defined allowlistから選択する。

**SEC-API-019:** raw SQLは、Drizzleで表現できないlock / advisory lock / exclusion関連等、`SPEC-100` が必要とする箇所に限定し、parameter placeholderを使用する。

**SEC-API-020:** SQL error message / SQLSTATE raw detailをClientへ返さない。

## 35. HTTP method / request semantics

**SEC-API-021:** `GET` / `HEAD`でDomain mutationを実行しない。

**SEC-API-022:** unsupported methodは`405`、unsupported content typeは`415`、invalid JSON / syntaxは`400`とし、これらをDomain state conflictへ誤分類しない。

**SEC-API-023:** `request_id` はcorrelationだけに使用し、Secret、Authorization credential、Domain Business Cause、Provider idempotency keyの代替にしない。

## 36. Forwarded header / client IP

**SEC-API-024:** `X-Forwarded-For`, `Forwarded`, `X-Real-IP`, `X-Forwarded-Host`, `X-Forwarded-Proto` は、Vercel / Railwayの**immediate trusted proxyから付与されたことをruntime configurationで確認できる場合だけ**利用する。

**SEC-API-025:** trusted proxy chainを確立できない場合、rate limitのClient IPはdirect peer情報を使用し、arbitrary incoming forwarding headerを採用しない。

**SEC-API-026:** forwarded hostをabsolute URL、redirect、Email CTA、Stripe return URLのAuthorityにしない。

## 37. Enumeration resistance

**SEC-API-027:** Login、Password reset、Email verification開始等、Account存在を不要に開示するoperationは、成功 / 不存在でUser-visible文言とresponse timing差を過度に変えない。Providerがgeneric responseを返せる場合はそれを維持する。

**SEC-API-028:** Owner resource existenceは`SEC-AZ-008`の404 policyを使用する。

---

# Part VIII — Database Security

## 38. Database access model

Business Schemaは `app` であり、Browser / Next.js Web / Supabase PostgREST roleから直接操作させない。

本システムは**grant-based server-only access**をCanonicalとし、RLSをprimary authorization mechanismにしない。

**SEC-DB-001:** Hono runtimeは専用DB login principal `app_runtime` 相当を使用する。

**SEC-DB-002:** schema migrationは別principal `app_migrator` 相当を使用し、runtime credentialからDDL、GRANT、role creation、extension管理を行えないよう分離する。

## 39. Runtime DB principal privilege

`app_runtime` は次のleast privilegeを持つ。

- `CONNECT` to target production database
- `USAGE` on schema `app`
- explicit table / sequence privilege only
- `SELECT`, 必要tableへの `INSERT`, 必要tableへの `UPDATE`
- Business historyへのgeneric `DELETE`なし
- `CREATE` on database / schemaなし
- `ALTER`, `DROP`, `GRANT`, role managementなし
- superuser / `BYPASSRLS` / replication privilegeなし
- Supabase managed `auth` schemaへのdirect writeなし

**SEC-DB-003:** migration convenienceを理由に`app_runtime`へschema owner相当権限を与えない。

## 40. Supabase Browser role closure

Production migrationは最低限次の意図を満たすGRANT / REVOKEを持つ。

```text
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM PUBLIC;

REVOKE ALL ON SCHEMA app FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM anon, authenticated;
```

future tableにも漏れないようdefault privilegeを同様に設定する。

**SEC-DB-004:** Supabase Data API / PostgRESTのexposed schema設定に`app`を追加しない。

**SEC-DB-005:** `app`が誤ってexposed schemaに追加されても、`anon` / `authenticated`にUSAGE / table privilegeがないためfail closedとなる状態を維持する。

RLSを追加のdefense-in-depthとして将来採用してよいが、Hono API authorization / grantsを置換してはならない。RLS導入がDomain query semanticsを変更する場合は `SPEC-100` 変更対象とする。

## 41. Search path hardening

**SEC-DB-006:** Runtime connectionの`search_path`にuntrusted writable `public` schemaを含めない。runtime SQLは `pg_catalog, app` 相当へ固定し、application-owned objectは可能な限りschema-qualifiedする。

**SEC-DB-007:** Raw SQLでunqualified function / operator / tableを使用する場合、search path hijackが成立しないことをmigration / testで確認する。

## 42. DB connection security

**SEC-DB-008:** Production Database connectionはTLSを必須とし、certificate verificationを無効化しない。

**SEC-DB-009:** `DATABASE_URL` / DB PasswordをBrowser、Next.js client bundle、log、error responseへ出さない。

**SEC-DB-010:** Production DB credentialをPreview / local / test environmentへ再利用しない。

## 43. Production data copy

**SEC-DB-011:** Production database dumpをnonproductionへ無制限copyしない。

nonproductionでProduction由来dataが必要な場合は、専用exportで次を満たす。

- Auth Subjectをnonproduction identityへ利用できない値へ置換
- Emailをsynthetic addressへ置換
- raw / encrypted QR token materialとlookup digestを除去または再生成不能化
- provider identifier / receipt URLを不要なら除去
- Session / Secretを含めない
- export fileは一時artifactとし、7日以内に削除

**SEC-DB-012:** Backup encryption / restore availabilityの運用詳細は `SPEC-150` / `SPEC-180` へ委譲するが、backupへproduction Secretを埋め込む設計は禁止する。

---

# Part IX — Secret / Key Management

## 44. Secret classification

| Secret / trust material | Class | Authorized reader |
|---|---|---|
| Supabase service credential | S1 Critical | Hono Auth / Email recipient-resolution server component only |
| Supabase Auth JWKS / public validation key | T1 Trust Material | Hono / Next.js server。Secretではないがorigin固定 |
| Database connection credential | S1 Critical | Hono runtime / migration principal別々 |
| Stripe secret key | S1 Critical | Hono payment component only |
| Stripe webhook signing secret | S1 Critical | Hono Stripe webhook verifier only |
| Resend API key | S1 Critical | Email worker only |
| Resend webhook signing secret | S1 Critical | Hono Resend webhook verifier only |
| QR lookup HMAC key | S1 Critical | Hono QR component only |
| QR AEAD encryption key | S1 Critical | Hono QR display / rotation component only |
| Application signing/encryption key | S1 Critical | その用途のserver component only |
| CSRF token | S2 Ephemeral | Browser + Next.js。Authentication Secretではない |

**SEC-KEY-001:** S1 Secretを`NEXT_PUBLIC_*`、Client-side environment、HTML、source map、analytics、error messageへ公開しない。

**SEC-KEY-002:** S1 Secretをsource controlへcommitしない。`.env` sampleには値ではなくvariable nameだけを置く。

**SEC-KEY-003:** Secret readerを「serverだから全部読める」にしない。Stripe componentがQR keyを、Email workerがDB migration credentialを読む必要はない。

## 45. Environment separation

**SEC-KEY-004:** Production / staging / preview / developmentはSecretを共有しない。

最低限別にする。

- Supabase project / server credential
- Database runtime credential
- Stripe secret / webhook secret
- Resend API / webhook secret
- QR HMAC / AEAD keys
- application signing keys

**SEC-KEY-005:** Production SecretをCI log、developer shell history、issue tracker、chat、test fixtureへコピーしない。

## 46. Rotation baseline

S1 Secretは次のruleでrotateする。

- routine rotation: **180日以内**
- suspected exposure / staff offboarding / repository leak等: **即時**
- environment clone時: clone先で必ず新規発行
- write operationは常にcurrent keyのみ
- previous key acceptanceは明示されたgraceだけ

**SEC-KEY-006:** missing current Secret、unknown key version、duplicate current key設定はstartup security configuration failureとしてserviceをReadyにしない。

### 46.1 Provider webhook secret overlap

Routine rotationではcurrent / previous webhook verification secretのdual verificationを最大 **24時間** 許可する。どちらで検証成功したかはinternal metadataとして区別する。

Compromise rotationではprevious secretを即時revokeし、overlapを許可しない。

**SEC-KEY-007:** old secretで検証できたことを理由にtimestamp / event dedupeをskipしない。

### 46.2 QR key overlap

QR key rotationはPart XIを使用する。Active Tokenが旧versionで存在する間、read/decrypt用旧keyを保持できるが、新規Token / rewrapはcurrent versionだけを使用する。

## 47. Secret storage / backup boundary

**SEC-KEY-008:** Vercel / Railway / Supabase等の最終Secret store wiringは `SPEC-180` が定義するが、Secretはdeployment-time server secret storeから注入し、Database business rowへ保存しない。

**SEC-KEY-009:** QR cryptographic keyをQR row、Notification context、Consistency Review detailへ保存しない。

**SEC-KEY-010:** Backup / disaster recoveryでSecret復元が必要な場合、Secret backupはBusiness Database backupと別のaccess boundaryに置く。具体的媒体 / escrowは `SPEC-180` が定義する。

---

# Part X — Stripe / Payment Security

## 48. Checkout / card data

**SEC-PAY-001:** Payment UIは `SPEC-070` のStripe Checkout hosted paymentを使用し、本システムがcard number / CVCを入力・保存・logするformを作らない。

**SEC-PAY-002:** Business Database、Browser storage、Notification、Admin viewへPAN / CVC / raw Payment Method secretを保存しない。

**SEC-PAY-003:** amount / currency / line itemはOrder SnapshotからServer-side生成し、Client入力をAuthorityにしない。

**SEC-PAY-004:** Stripe success URL / cancel URL / Browser ReturnはPayment Authorityではない。

## 49. Stripe Webhook

`POST /api/v1/webhooks/stripe` は `SPEC-110` を維持する。

**SEC-PAY-005:** webhook raw bodyを最大1 MiBで受理し、JSON reserialization前にconfigured signing secretでStripe official verifier相当のsignature verificationを実行する。

**SEC-PAY-006:** signature timestamp toleranceは **300秒** とする。tolerance外のcaptured requestをreplayとしてBusiness effectへ使用しない。

**SEC-PAY-007:** invalid / missing signatureは`400 WEBHOOK_SIGNATURE_INVALID`とし、正規Webhook Receiptを作成せず、Order / Refund / Ticket / Reservation / Inventoryを変更しない。

**SEC-PAY-008:** verified Event IDは`app.webhook_receipts.stripe_event_id UNIQUE`でdedupeする。duplicate EventからBusiness effectを再実行しない。

**SEC-PAY-009:** Event ID、Checkout Session ID、PaymentIntent IDをClient body / queryからProvider Authorityとして受けない。

**SEC-PAY-010:** metadata / client referenceはcorrelation cross-checkでありAuthorization credentialではない。

## 50. Webhook stale / replay / livemode

**SEC-PAY-011:** signatureがvalidでも、EventがEnvironmentと一致しない、Payment Bindingが一意に解決不能、amount / currency mismatch、unexpected stateの場合はBusiness Confirmationを行わずReview boundaryへ送る。

**SEC-PAY-012:** Productionではverified Stripe Eventの`livemode`がProduction configurationと一致することを要求する。Test-mode EventでProduction Orderを更新しない。

## 51. Refund security

**SEC-PAY-013:** Refundは `SPEC-070` のfull refund onlyを維持し、Client-specified arbitrary amountを受けない。

**SEC-PAY-014:** Refund requestはactive Administrator + `recovery.exception.execute` + explicit refund operation + current eligible state + required `Idempotency-Key`を全て要求する。

**SEC-PAY-015:** Stripe result unknown時に別idempotency keyで2件目のRefundを作らない。same Refund Record / same Stripe idempotency keyでreconcileする。

**SEC-PAY-016:** UI confirmationはRefund authorization、CSRF defense、idempotency、current state再評価の代替ではない。

## 52. Receipt URL

**SEC-PAY-017:** Stripe receipt URLを表示する場合、Server-sideで次を満たすURLだけをallowする。

- absolute `https` URL
- username / password componentなし
- configured `STRIPE_RECEIPT_ALLOWED_HOSTS` exact host allowlistに一致
- control characterなし

allowlist不一致時はlinkを非表示とし、provider responseをHTMLとしてproxy / renderしない。

**SEC-PAY-018:** Receipt URLをServer-side fetchしてCustomerへproxyする機能を追加しない。これによりSSRF / content injection boundaryを増やさない。

---

# Part XI — Ticket / QR Security

## 53. QR bearer model

`SPEC-080` のCanonical payloadを維持する。

```text
r39x1.ent.<43-char-base64url-random>
r39x1.krk.<43-char-base64url-random>
```

random componentは256-bit CSPRNGである。

**SEC-QR-001:** raw QR tokenはcredential-like bearer valueとして扱い、Email、URL、analytics、log、Admin view、error detailへ出さない。

**SEC-QR-002:** QR tokenを知っていることはCustomer ownership証明ではない。Customer QR displayはOwner authorization、Staff scanはStaff authorizationを別途要求する。

## 54. Lookup digest

`app.qr_tokens.lookup_digest` は次で計算する。

```text
HMAC-SHA-256(
  key = QR_LOOKUP_KEY[key_version],
  message = UTF8(canonical_full_qr_payload)
)
```

結果32 byteをDBへ保存する。

**SEC-QR-003:** unkeyed SHA-256だけでraw token lookupを構成しない。

**SEC-QR-004:** QR scan時はformat / purpose / exact lengthを先に検証した後、accept-read key versionごとにdigestを計算し、DB lookupする。

## 55. Protected token material

`app.qr_tokens.protected_token_material` は**AES-256-GCM**でapplication-side暗号化する。

Canonical plaintext:

```text
32-byte raw random token material
```

Canonical AEAD parameters:

- key: 256 bit `QR_AEAD_KEY[key_version]`
- nonce: CSPRNG 96 bit、暗号化ごとに新規
- authentication tag: 128 bit
- envelope version: `1`
- AAD:
  ```text
  r39x1|<ENTRY|KARAOKE>|<ticket_internal_id>|<protection_key_version>
  ```

Binary envelope:

```text
1 byte envelope_version
12 bytes nonce
32 bytes ciphertext
16 bytes authentication_tag
```

**SEC-QR-005:** AES-GCM nonceを同じkeyで再利用してはならない。

**SEC-QR-006:** AEAD authentication failure時にplaintextを返さず、QR display / rotationをFail Closedにする。

**SEC-QR-007:** `protected_token_material`だけを別Ticket rowへcopyしてもAAD verificationで復号成功しない設計とする。

## 56. Key versioning

`protection_key_version` はHMAC / AEADの**key bundle version**を表す。

1 versionは別々の256-bit secretを持つ。

```text
QR_LOOKUP_KEY[vN]
QR_AEAD_KEY[vN]
```

同じraw keyをHMACとAES-GCMへ再利用しない。

**SEC-QR-008:** new Tokenはcurrent write versionだけを使用する。

**SEC-QR-009:** read pathはcurrent + migration中のprevious versionを明示allowlistし、未知versionを「current keyで試す」fallbackをしない。

## 57. QR key rotation

Routine rotation sequenceは次とする。

1. new version key bundleをserver Secret storeへ配置
2. application read allowlistへold + newを配置
3. write current versionをnewへ切替
4. active QR rowをbatchでlock
5. old AEADでraw 32 byteを復号
6. same canonical raw tokenをnew HMACでre-digest
7. new AEAD nonceでre-encrypt
8. `lookup_digest`, `protected_token_material`, `protection_key_version`を同一transactionで更新
9. active old-version rowが0件になったことを確認
10. grace終了後old keyをremove

このmigrationはraw QR payload自体を変えないためCustomer screenshotを無用に失効させない。

**SEC-QR-010:** rotation migrationで復号不能rowを新Tokenへ勝手に置換しない。affected TicketをConsistency Review対象にし、Owner-visible QR displayをFail Closedとする。

**SEC-QR-011:** compromiseがraw Token自体に及ぶ場合はglobal rewrapではなく `SPEC-080` のTicket-specific QR rotationを使用し、旧Tokenを`REVOKED`にする。

## 58. QR display

**SEC-QR-012:** Customer QR displayはverified Session + owner-safe Ticket / Reservation lookup + current `VALID` stateを要求する。

**SEC-QR-013:** QR responseは`Cache-Control: no-store, private`とし、raw payloadをURL path / queryに置かない。

**SEC-QR-014:** Administrator QR rotation responseへ新raw tokenを返さない。Owner自身のQR endpointから取得させる。

## 59. Scanner input

**SEC-QR-015:** Staff camera / scanner inputはtransient memoryだけで扱い、localStorage、IndexedDB、URL、analytics、crash reportへ保存しない。

**SEC-QR-016:** scan result routeへraw tokenをquery / fragment / history stateとして残さない。

**SEC-QR-017:** camera libraryへ第三者cloud OCR / image uploadを行わせない。QR decodeはBrowser local処理とし、Hono APIへ送るのはcanonical text payloadだけとする。

## 60. Check-in security

**SEC-QR-018:** Check-inはactive `STAFF` + correct Capability + purpose binding + current Ticket state +必要なReservation conditionをServer-sideで検証する。

**SEC-QR-019:** Check-in成功は `SPEC-080` / `SPEC-100` のatomic Ticket `VALID -> USED` + immutable Check-in insertにより最大1回とする。

**SEC-QR-020:** QR screenshot / copied tokenが存在し得ることを前提とし、秘密保持だけに依存しない。single-useとcurrent stateを最終防御とする。

---

# Part XII — Resend / Email Security

## 61. Recipient authority

**SEC-EML-001:** Business Email recipient authorityは `recipient_profile_id -> Business Profile.auth_subject -> Supabase Auth server-side lookup` とする。

**SEC-EML-002:** Client-supplied Email、Stripe Checkout Email、query parameter、Admin free-text Emailをrecipient authorityにしない。

**SEC-EML-003:** 初回Provider call前に`SPEC-120`のrecipient snapshotを固定し、自動retryで暗黙変更しない。

**SEC-EML-004:** `CURRENT_VERIFIED` recipient refreshはAdministrator recovery operationでのみ実行し、current Supabase Auth verified Emailを再解決してsnapshot revisionを更新する。`UNKNOWN_RESULT`中は変更しない。

## 62. Resend API / header security

**SEC-EML-005:** `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`はserver configurationからのみ取得し、Client inputを使用しない。

**SEC-EML-006:** recipient address、From、Reply-To、subjectにCR / LFを含む入力をrejectし、header injectionを防止する。

**SEC-EML-007:** Template contextはnotification typeごとのZod schemaで検証し、HTML renderではReact escapingを維持する。

**SEC-EML-008:** arbitrary HTML stringをTemplate contextとして受け取り`dangerouslySetInnerHTML`へ渡さない。

## 63. Email links

**SEC-EML-009:** CTA originはtrusted `APP_BASE_URL`から生成し、Host header / Client inputから生成しない。

**SEC-EML-010:** Email URLへraw QR token、Supabase access / refresh token、Password reset token、Email verification token、Stripe Secret、Internal bigint IDを埋め込まない。

**SEC-EML-011:** CTA pathは `SPEC-120` のallowlisted existing Mypage routeだけを使用し、arbitrary redirect URLをTemplate contextへ持たせない。

## 64. Resend Webhook

`POST /api/v1/webhooks/resend` は `SPEC-120` を維持する。

**SEC-EML-012:** max 256 KiB raw bodyをJSON reserialization前にResend/Svix official verifier相当で検証する。

Required signed headers:

```text
svix-id
svix-timestamp
svix-signature
```

**SEC-EML-013:** webhook timestamp toleranceは **300秒** とし、tolerance外のcaptured requestをreplayとしてrejectする。

**SEC-EML-014:** verified `svix-id`を`provider_event_key UNIQUE`でdedupeし、duplicate delivery eventを重複処理しない。

**SEC-EML-015:** invalid signatureはNotification / Attempt / source Business stateを変更しない。

## 65. Provider result unknown

**SEC-EML-016:** `UNKNOWN_RESULT` は成功でも失敗でもない。別Provider Idempotency Keyでblind resendしない。

**SEC-EML-017:** Unknown Result recoveryは `SPEC-120` のsame Attempt / same Provider Idempotency Key / 23時間safe cutoffを変更しない。

**SEC-EML-018:** Notification retry / cancelからOrder、Ticket、Reservation、Goods、Refundの元Business Transactionを再実行しない。

## 66. Email PII persistence

**SEC-EML-019:** Email body全文、plain-text全文、provider response body全文を通常DB / log / Admin responseへ保存しない。

**SEC-EML-020:** `recipient_email_snapshot` は送信に必要なPIIとしてBusiness Database内に保持してよいが、Admin list/detailではPart XVのmaskingを適用し、Staffへ返さない。

---

# Part XIII — Rate Limit / Abuse Protection

## 67. Enforcement model

Rate limitはDomain authorizationの代替ではない。Rate limitを通過してもAuthentication / Authorization / Business Ruleを必ず評価する。

**SEC-ABU-001:** Production rate limitはmulti-instanceで共有されるenforcement layerを使用する。per-process in-memory counterだけをProductionの唯一controlにしない。

具体的なVercel / Railway / edge / shared store wiringは `SPEC-180` が選定する。

**SEC-ABU-002:** Rate limit configurationがmissing、0、negative、parse不能の場合は「unlimited」へfallbackせずstartup / readinessをfailureにする。

### 67.1 Config model

各classは次の設定を持つ。

```text
burst_limit
burst_window_seconds = 10
sustained_limit
sustained_window_seconds = 60
```

Productionでは下表の値を**上限**とする。より厳しくすることは可能だが、上限を増やす場合はSPEC-140変更を必要とする。

## 68. Canonical Rate Limit Matrix

| Class | Keys | Burst / 10s | Sustained / 60s | Additional resource/global rule |
|---|---|---:|---:|---|
| Public read | per-IP | 20 | 120 | global 10,000/min |
| Auth form/proxy | per-IP | 5 | 20 | per normalized identifier hash 5/10min |
| Self read | per-auth-subject + per-IP | 30 | 120 | IP 240/min |
| Purchase / checkout | per-auth-subject | 3 | 12 | per offering/resource 60/min |
| QR display | per-auth-subject | 6 | 30 | per Ticket 12/min |
| Staff Check-in | per-staff-subject + per-IP | 40 | 180 | per QR digest 30/min; IP 300/min |
| Goods Handoff | per-staff-subject | 10 | 60 | per Goods Item 10/min |
| Admin mutation | per-admin-subject | 10 | 30 | per target resource 15/min |
| Role Assignment | per-admin-subject | 3 | 10 | per target profile 5/10min |
| Refund / QR rotation / Notification recovery | per-admin-subject | 2 | 6 | per target resource 2/min and 10/hour |
| Stripe webhook | per trusted-derived source IP | 100 | 300 | global 3,000/min |
| Resend webhook | per trusted-derived source IP | 100 | 300 | global 3,000/min |

**SEC-ABU-003:** Staff Check-inは当日burstを許容するためPublic mutationより高いlimitを持つが、Staff Role / Capability検証をskipしない。

**SEC-ABU-004:** 256-bit QR tokenはbrute-force resistantであるが、unknown QR大量scanを無制限にDBへ到達させない。

## 69. Auth provider abuse boundary

Supabase Authへのdirect provider trafficはHono rate limiterで完全には制御できない。

**SEC-ABU-005:** Signup / Login / Password reset UIにapplication-side per-IP guardを置き、同時にSupabase Authが提供するprovider-side rate / bot protectionをProductionで有効化する。

**SEC-ABU-006:** Provider-side limit値を本書が外部事実として捏造しない。Provider limit変更があってもapplication側matrixは維持する。

## 70. 429 behavior

**SEC-ABU-007:** Rate limit超過は`429`とし、可能なら整数秒`Retry-After`を返す。responseにcounter key、Email、Auth Subject、raw IP historyを含めない。

**SEC-ABU-008:** 429を返したrequestから新しいOrder、Allocation、Hold、Refund、Token、Check-in、Handoff、Role Assignment、Notification mutationを成立させない。

**SEC-ABU-009:** Rate limit failureを`AUTHORIZATION_DENIED`やresource existence responseへ変換せず、security control failureとして一貫して扱う。

---

# Part XIV — Administrator / Staff Security

## 71. Route guard / protected response

**SEC-ADM-001:** `/admin/*` と `/staff/*` はServer-side Session / Principal確認前にprotected dataをfetch / renderしない。

**SEC-ADM-002:** Admin / Staff responseは`no-store`とし、shared cacheへCustomer / operational dataを保存しない。

**SEC-ADM-003:** Admin != Staff inheritanceを維持する。AdministratorだけのactorにStaff scanner / Handoff execute operationを許可しない。

## 72. High-risk operation common control

次をHigh-riskとする。

- full Refund
- Karaoke Reservation cancellation
- QR rotation
- Inventory adjustment
- Slot generation / edit / stop / resume
- Public Content publish / archive
- Role grant / revoke
- Notification retry / cancel / recipient refresh
- Consistency Reviewからのexplicit recovery action
- Goods Handoff completion
- Entry / Karaoke Check-in

High-risk mutationは最低限次を要求する。

1. HTTPS
2. valid current Session
3. CSRF / same-origin validation at Browser-facing boundary
4. Hono APIでcurrent Authentication / Role / Capability再評価
5. Zod allowlist validation
6. current Domain state再取得
7. operation-specific idempotency / consume-once rule
8. DB transaction / constraint
9. safe result / no secret disclosure

**SEC-ADM-004:** UI confirmation dialogは上記1〜9の代替ではない。

## 73. Operation-specific controls

| Operation | Security-specific requirement |
|---|---|
| Full Refund | full amount Server-side derive、required Idempotency-Key、Unknown Resultでduplicate禁止 |
| Reservation cancellation | explicit recovery context、current `CONFIRMED`、Ticket lock、Slot `SOLD`維持 |
| QR rotation | confirmed compromise / authorized recovery、new raw tokenをAdminへ返さない |
| Inventory adjustment | Client absolute inventoryをAuthorityにせず、allowlisted operation / current counter / invariant |
| Slot mutation | Scope / overlap / sold/held stateをServer-side再検証 |
| Public Content publish/archive | plain-text renderer、current publication state、no raw HTML |
| Role grant/revoke | target profile ref、no self mutation、last Administrator protection |
| Notification retry | `FAILED_RETRYABLE`のみ、`SENT`不可、Unknown Result blind retry不可 |
| Notification cancel | Provider Acceptance前のみ、source Business state不変 |
| Staff Check-in | `STAFF` + capability + purpose + atomic single-use |
| Goods Handoff | `STAFF` + capability + current `PENDING` / fulfillable + one-time completion |
| Consistency Review | `recovery.review`はreadのみ。mutationはexplicit recovery operation + `recovery.exception.execute` |

## 74. Staff minimal data

**SEC-ADM-005:** Staff responseは `SPEC-060` / `SPEC-130` のMinimal Staff Dataだけを返す。

Staffへ返してはならない。

- Customer全Order履歴
- Email address
- Auth Subject
- Role history
- payment provider response
- raw QR token after scan result
- unrelated Entry / Karaoke / Goods history

**SEC-ADM-006:** Staff scanner UIのresult stateとAdmin detail stateを同じpayloadへ統合して過剰dataを返さない。

## 75. Consistency Review security boundary

**SEC-ADM-007:** Consistency Reviewは「不整合だから自由編集してよい」状態ではない。

**SEC-ADM-008:** `recovery.review` actorはread-only。Business mutationには対象operationが `SPEC-110` / `SPEC-150`で明示され、`recovery.exception.execute`とcurrent stateが成立することを要求する。

**SEC-ADM-009:** Review解消のために直接DB console操作を通常Admin UIの代替手段として仕様化しない。

## 76. SPEC-130 unresolved UCR protection

**SEC-ADM-010:** UCR-130-001〜006が未解決のPageでは、missing API / CapabilityをBrowser direct DB access、generic admin endpoint、`recovery.exception.execute`流用で埋めない。

---

# Part XV — Personal Data / Privacy Boundary

## 77. Data minimization

**SEC-PII-001:** Business Profileへ業務要件に存在しない氏名、住所、電話番号等のPII fieldをSecurity都合で追加しない。

**SEC-PII-002:** Customer identificationは可能な限りPublic Reference / operational stateを使用し、Auth Subjectをnormal UI identifierとして表示しない。

**SEC-PII-003:** StaffへEmailを返さない。

## 78. Email masking

Admin Notification viewでrecipient Emailを表示する必要がある場合はmaskする。

Canonical masking:

```text
local-part length >= 2: first character + "***" + "@" + domain
local-part length = 1: "***@" + domain
```

例:

```text
alice@example.com -> a***@example.com
x@example.com     -> ***@example.com
```

**SEC-PII-004:** masked Emailをrecipient authority / equality checkへ使用しない。表示専用である。

**SEC-PII-005:** full recipient snapshotはEmail worker / authorized server recovery logicだけが読み、Admin APIへ通常返さない。

## 79. QR / provider PII

**SEC-PII-006:** raw QR tokenはPIIそのものではなくてもcredential-like sensitive dataとしてPII同等以上にredactする。

**SEC-PII-007:** provider response body全文を保存しない。必要なprovider ID、safe status code、allowlisted error codeだけを保持する。

## 80. Logs / errors

Client response / operational logへ次を含めてはならない。

- Password / reset token / verification token
- access / refresh token
- Session Cookie value
- CSRF token
- Stripe / Resend / Supabase / DB Secret
- raw QR payload
- `protected_token_material`
- QR HMAC key / digest input
- full recipient Email where不要
- SQL / database connection string
- raw provider response body
- Internal bigint ID in Client-facing log context

**SEC-PII-008:** `request_id` はClientへ返してsupport correlationへ利用してよい。

## 81. Production / nonproduction / support copy

**SEC-PII-009:** Screenshot、CSV、support export等でCustomer dataを外部copyする機能は既存Requirementがないため通常Capabilityとして追加しない。

**SEC-PII-010:** support調査で一時copyが必要な場合も、least data subset、access restricted storage、7日以内削除をSecurity minimumとする。Audit taxonomyは`SPEC-160`が定義する。

## 82. Retention / account deletion boundary

法的保存期間等の外部事実は本書で捏造しない。

**SEC-PII-011:** Order / Payment / Ticket / Reservation / Check-in / Handoff / Notification historyをAccount deletionの副作用としてcascade hard deleteしない。`SPEC-100`のhistory retention ruleを維持する。

**SEC-PII-012:** Privacy operationが将来Requirementとして追加される場合、financial / entitlement historyを保ったidentity detach / anonymizationとして上流Canonical Ownerで定義し、SPEC-140からad-hoc SQL deleteを追加しない。

**SEC-PII-013:** Retention期間が外部policyで決定されていないDataについて、「無期限にsecondary copyを増やす」ことを禁止し、primary Business history以外のsupport export / temporary artifactには§81の7日上限を適用する。

---

# Part XVI — Error Disclosure / Security Failure

## 83. Error response boundary

`SPEC-110` のcommon error envelopeを維持する。

**SEC-ERR-001:** Clientへ次を返さない。

- stack trace
- SQLSTATE raw detail
- SQL text
- Internal bigint ID
- Secret
- raw QR token
- full recipient Email where unnecessary
- provider response body
- DB connection information
- filesystem path
- infrastructure hostname / internal topologyの不要detail

**SEC-ERR-002:** Validation error `details` はallowlisted field name / generic reasonまでとし、raw rejected credentialやQR payloadをechoしない。

**SEC-ERR-003:** unexpected errorは`INTERNAL_ERROR`または既存safe codeへmapし、exception messageをそのままClientへ流さない。

## 84. Security failure matrix

| Failure | Required result | Forbidden behavior |
|---|---|---|
| Auth verification unavailable | `503 AUTH_SERVICE_TEMPORARY_FAILURE`相当 | stale/unverified identityで続行 |
| invalid / expired token | `401` | refresh不能tokenをgrace accept |
| Email unverified | `403 EMAIL_VERIFICATION_REQUIRED` | protected operation実行 |
| Role resolution DB failure | `503` | cached roleでprivileged mutation |
| Authorization denied | `403` or owner-safe `404` | partial mutation / resource detail leak |
| DB unavailable | `503 DATABASE_TEMPORARY_FAILURE` | Provider side effectをblind start |
| Stripe unavailable | existing Order保持 / temporary failure | paid / failedと断定 |
| Stripe result unknown | Review / pending | duplicate Checkout / Refund |
| Resend unavailable | Notification failure only | source Business rollback |
| Resend result unknown | `UNKNOWN_RESULT` | new provider key blind resend |
| QR key unavailable | QR display / scan fail closed | plaintext DB fallback / new token自動発行 |
| Webhook signature invalid | `400` | receipt / Business state mutation |
| CORS / CSRF failure | `403` | Hono mutation forward |
| rate limit exceeded | `429` | Domain state mutation |
| Security Configuration invalid | service not Ready | insecure defaultで起動 |
| required Secret missing | service not Ready | featureだけverification bypass |
| key rotation incomplete | affected operation fail closed / review | unknown keyをcurrentで復号試行 |
| CSP nonce generation failure | sensitive HTMLをserveしない | CSPなしでserve |

**SEC-ERR-004:** Security dependency failureを理由に既に確定済みBusiness Dataを削除・取消・巻き戻ししない。

## 85. Security Configuration validation

Production startup / readinessで最低限次を検証する。

- `APP_BASE_URL` is absolute HTTPS canonical origin
- allowed Host / Originのexact list
- Supabase issuer / JWKS configuration存在
- access token lifetime policyが900秒以下
- DB TLS required configuration
- Stripe Secret / webhook secret存在
- Resend API / webhook secret存在
- current QR key versionとHMAC / AEAD key両方存在
- duplicate QR key versionなし
- rate limitがpositiveかつ§68上限以下
- Productionでdebug / public source map無効

**SEC-ERR-005:** validation failureはwarningだけで起動継続しない。

---

# Part XVII — Dependency / Third-party Integration Security

## 86. Outbound network allowlist

**SEC-DEP-001:** Server-side outbound requestはSupabase Auth、Stripe、Resend等、既存Architectureで必要なconfigured Provider endpointに限定する。Client-supplied URLをserver fetchしない。

**SEC-DEP-002:** HTTPS certificate verificationを無効にする`rejectUnauthorized=false`相当をProductionで使用しない。

## 87. Dependency integrity

**SEC-DEP-003:** JavaScript / TypeScript dependencyは`pnpm-lock.yaml`でversion / integrityを固定し、Production buildでfloating branch / unpinned Git dependencyを使用しない。

**SEC-DEP-004:** 新dependencyは既存機能で代替不能な必要性を確認し、特にAuth、crypto、QR、webhook parserでは自作primitiveより標準library / Provider official SDKを優先する。

**SEC-DEP-005:** package install scriptを無条件trustしない。必要なinstall scriptだけをrepositoryで明示allowし、CI / buildのSecret exposureを最小化する。

**SEC-DEP-006:** Vulnerability scan / dependency alertのevent taxonomyは`SPEC-160`、deployment gateは`SPEC-180`が具体化するが、known critical vulnerabilityを無視してProduction deployを正当化しない。

## 88. Cryptographic primitive rule

**SEC-DEP-007:** custom cipher、custom hash construction、home-grown JWT signature、手書きWebhook signature parserを作らない。

使用primitive:

- CSPRNG: platform cryptographic RNG
- HMAC: HMAC-SHA-256
- QR encryption: AES-256-GCM
- payload fingerprint: SHA-256 where non-secret integrity fingerprintで十分
- JWT: JOSE standard + trusted Provider keys
- Webhook: Provider official verifier / documented compatible verifier

---

# Part XVIII — Traceability

## 89. System Invariant trace

| Invariant | Security control |
|---|---|
| `INV-010-01` 購入情報を失わない | `SEC-PAY-*`, `SEC-ERR-004` |
| `INV-010-02` Orderを二重確定しない | `SEC-PAY-008〜015`, `SEC-API-*` |
| `INV-010-03` Ticketを二重発行しない | `SEC-AZ-*`, `SEC-PAY-*`, DB unique維持 |
| `INV-010-04` Karaoke枠二重販売防止 | `SEC-ADM-004`, `SEC-API-011〜019`, Domain / DB再評価 |
| `INV-010-05` QR二重利用防止 | `SEC-QR-018〜020` |
| `INV-010-06` Email失敗でRollbackしない | `SEC-EML-016〜020`, `SEC-ERR-004` |
| `INV-010-07` 確定と権利発行を中途半端にしない | `SEC-PAY-*`, Security failure fail closed |
| `INV-010-08` Ownership / Authorization | `SEC-AUTH-*`, `SEC-AZ-*` |
| `INV-010-09` Client金額非Authority | `SEC-PAY-003`, `SEC-API-013` |
| `INV-010-10` 外部再送耐性 | `SEC-PAY-008`, `SEC-EML-014〜017`, `SEC-ABU-*` |

## 90. Functional Requirement trace

| Requirement group | Primary security rules |
|---|---|
| `FR-AUTH-*` | `SEC-AUTH-*`, `SEC-ABU-005〜006`, `SEC-ERR-*` |
| `FR-ADM-*` | `SEC-AZ-*`, `SEC-ADM-*`, `SEC-PII-*` |
| `FR-STF-*` | `SEC-AZ-004`, `SEC-QR-015〜020`, `SEC-ADM-005〜006` |
| `FR-EML-*` | `SEC-EML-*`, `SEC-PII-004〜007` |
| `FR-XFN-001〜007` | `SEC-TRU-*`, `SEC-AUTH-*`, `SEC-AZ-*`, `SEC-DB-*` |
| `FR-XFN-008〜018` | `SEC-PAY-*`, `SEC-QR-*` |
| `FR-XFN-019〜021` | `SEC-EML-*`, `SEC-ERR-004` |
| `FR-XFN-024〜025` | `SEC-ADM-*`, `SEC-ERR-*` |
| `FR-XFN-026〜032` | current-state再評価、Fail Closed、error redaction |
| `FR-XFN-033` | `SEC-KEY-*` |

## 91. Domain / Auth / Payment / QR / DB / API / Email / Admin trace

| Upstream | Security connection |
|---|---|
| `BR-USR-*` | `SEC-AZ-002〜014`, `SEC-PII-*` |
| `BR-CHK-*` | `SEC-QR-018〜020` |
| `BR-NTF-*` | `SEC-EML-001〜020` |
| relevant `DI-030-*` | Fail Closed / duplicate side effect prevention |
| `AR-*` | `SEC-AUTH-*`, `SEC-AZ-*` |
| Role / Capability Matrix | `SEC-AZ-004〜016`, `SEC-ADM-*` |
| `PAY-*` | `SEC-PAY-*` |
| `TQR-*` | `SEC-QR-*` |
| `DB-*` | `SEC-DB-*`, `SEC-QR-003〜011` |
| `API-*` | `SEC-API-*`, `SEC-ERR-*`, `SEC-ABU-*` |
| `EML-*` | `SEC-EML-*` |
| `PG-ADM-*`, `PG-STF-*` | `SEC-WEB-*`, `SEC-ADM-*` |
| `ADM-*`, `STF-*`, `OPS-*` | `SEC-ADM-*`, `SEC-PII-*`, `SEC-ERR-*` |

---

# Part XIX — Security Acceptance Criteria

## 92. Authentication / Session acceptance

1. Protected Hono requestはdecode-only JWTでAuthentication成功しない。
2. issuer / signature / expiry等のvalidation failureはFail Closedになる。
3. access token lifetimeがProductionで900秒を超えない。
4. Session credential CookieはSecure / HttpOnly / SameSite=Lax / host-onlyである。
5. Session credentialがlocalStorage / URL / Business Databaseに存在しない。
6. Login / LogoutでCSRF tokenがrotateする。
7. Logout後にprotected responseをshared cache / BFCacheから操作可能なまま再利用しない。

## 93. Authorization acceptance

1. Clientのrole / profile / owner申告で権限が上がらない。
2. Public Referenceのみで他者resourceへ到達できない。
3. owner mismatchは404でexistenceを漏らさない。
4. AdministratorはSTAFFを自動継承しない。
5. Role revokeは次のprivileged requestから反映する。
6. self Role mutationとlast Administrator lossを防止する。
7. `recovery.exception.execute`がgeneric bypassになっていない。

## 94. Web / API acceptance

1. Production CSPに`unsafe-eval` / script `unsafe-inline`がない。
2. `frame-ancestors 'none'` + `X-Frame-Options: DENY`でAdmin / Staff clickjackingを防ぐ。
3. authenticated Browser mutationはCSRF token + exact Origin checkを要求する。
4. Hono protected APIにwildcard credentialed CORSがない。
5. normal JSON / QR / Stripe / Resend webhook body size limitが適用される。
6. all path/query/bodyにRuntime Validationが存在する。
7. mass assignmentでServer-owned fieldを更新できない。
8. raw SQL value / identifier injection pathがない。
9. absolute URLがHost headerから生成されない。

## 95. Database / Secret acceptance

1. `app_runtime`とmigration principalが分離される。
2. `anon`, `authenticated`, `PUBLIC`が`app` schema tableへ直接アクセスできない。
3. runtime principalがDDL / generic DELETE / superuser privilegeを持たない。
4. DB TLS certificate validationを無効化していない。
5. Production SecretがClient bundle / source control / nonproductionへ存在しない。
6. missing Secret / invalid Security ConfigurationでserviceがReadyにならない。
7. routine Secret rotationが180日以内、compromise時は即時である。

## 96. Stripe acceptance

1. card number / CVCを本システムが保存しない。
2. amount / currencyはServer-side Order Snapshotから生成する。
3. success URLだけでOrderを確定しない。
4. Stripe webhook raw body signature + 300秒timestamp toleranceを検証する。
5. verified Event IDをdedupeする。
6. Refundはfull only + required idempotencyである。
7. Provider result unknownでduplicate Refundを作らない。

## 97. QR acceptance

1. QR random componentが256-bit CSPRNGである。
2. lookup digestがHMAC-SHA-256である。
3. raw token plaintextをDB columnへ保存しない。
4. protected materialがAES-256-GCM / 96-bit nonce / 128-bit tagである。
5. HMAC keyとAEAD keyを分離する。
6. key version rotationでraw token互換を保ったrewrapが可能である。
7. raw tokenがlog / URL / Admin responseへ出ない。
8. Staff scan inputがBrowser persistent storageへ残らない。
9. purpose + Staff auth + current state + atomic consume-onceでCheck-inする。

## 98. Email acceptance

1. recipient authorityがBusiness Profile → Auth Subject → Supabase Authである。
2. Client / Stripe Emailをrecipient authorityにしない。
3. Adminにfull recipient Emailを通常表示しない。
4. Email linkにSecret / raw QR / auth tokenを含めない。
5. Template contextがZod + escaped renderingを通る。
6. Resend webhook raw body signature + 300秒timestamp toleranceを検証する。
7. verified `svix-id`をdedupeする。
8. `UNKNOWN_RESULT`をblind resendしない。
9. Email failureでBusiness TransactionをRollbackしない。

## 99. Admin / Staff / Privacy acceptance

1. `/admin/*`, `/staff/*`のprotected responseがno-storeである。
2. High-risk actionがCSRF / current Role / Capability / current state / idempotencyを通る。
3. UI confirmationだけでoperationが成立しない。
4. StaffへEmail / Auth Subject /無関係Customer履歴を返さない。
5. Public Contentはplain textとしてescaped renderされraw HTMLを実行しない。
6. Client errorへstack / SQL / Internal ID / Secret / raw QR / full Emailを返さない。
7. rate limit 429でDomain stateを変更しない。
8. Security control評価不能時に権限を推測せずFail Closedとする。

---

# Part XX — Failure / Recovery Boundary to SPEC-150

## 100. SPEC-150へ委譲する事項

`SPEC-150` は本書のSecurity boundaryを変更せず、次を具体化する。

- retry count
- exponential / fixed backoff
- jitter
- timeout / deadline handling
- queue cadence
- Provider reconciliation
- transaction retry
- Consistency Review resolution
- recovery runbook
- stuck job / stuck Order / stuck Refund detection
- Auth outage / Role bootstrap recovery
- QR key rotation incomplete recovery
- Provider result unknown recovery
- degraded dependency restoration

**SEC-ERR-006:** `SPEC-150` のRecoveryは、本書でFail Closedとしたconditionに「availabilityのためのbypass」を追加してはならない。

---

# Part XXI — Upstream Change Request

## 101. SPEC-140新規Upstream Change Request

本書作成時点で、Security Controlを成立させるために既存Canonical OwnerのState、Role、Capability、API endpoint、Database columnを変更する必要は確認されなかった。

**SPEC-140から新規Upstream Change Requestは発行しない。**

理由:

- Cookie / CSP / CSRF / CORS / rate limitは `SPEC-060` / `SPEC-110` から本書へ明示委譲済み
- QR `lookup_digest`, `protected_token_material`, `protection_key_version` は `SPEC-100` に既に存在し、本書へalgorithm / key rotationが明示委譲済み
- Payment / Email webhook signature boundaryは上流に既に存在し、本書はSecurity Controlを具体化するだけである
- Database principal / grant / Secret reader boundaryはphysical business schemaを変更せず設定可能である

### 101.1 Carry-forward UCR

`SPEC-130` の次のUCRは未反映のままcarry-forwardする。

- `UCR-130-001` Sales management Capability不足
- `UCR-130-002` Entry / Karaoke Sales Configuration Admin API不足
- `UCR-130-003` Goods Handoff operational read / Admin manage API不足
- `UCR-130-004` Admin list filter query contract明示不足
- `UCR-130-005` Operational query index追加
- `UCR-130-006` Admin read contract completeness

本書はこれらを解決済みとして扱わない。

---

# Part XXII — Final Invariants

## 102. Security final checklist

本仕様の完成実装は次をすべて満たさなければならない。

1. System Boundaryを変更しない。
2. Browser / Next.js WebからBusiness Databaseを直接更新しない。
3. Supabase AuthがIdentityのSystem of Recordである。
4. Business DatabaseがOrder / Ticket / Reservation / Goods / Check-in / Notification RequestのSystem of Recordである。
5. CustomerをOperational Role化しない。
6. Administratorをgeneric superuser化しない。
7. AdministratorがSTAFFを自動継承しない。
8. Client role / owner / price / payment resultをAuthorityにしない。
9. Public Referenceをcredentialにしない。
10. Session / Secret / raw QR tokenをClient-readable persistent storageへ置かない。
11. Stripe card dataを保存しない。
12. Stripe / Resend webhook signatureをraw bodyで検証する。
13. Provider result unknownを成功扱いしない。
14. CORS wildcard credential policyを使用しない。
15. state-changing Browser requestにCSRF controlがある。
16. CSP / escapingでstored / reflected XSSを防ぐ。
17. Public Contentへraw HTML capabilityを追加しない。
18. DB runtime / migration principalを分離する。
19. `anon` / `authenticated` / `PUBLIC`からBusiness Schemaを閉じる。
20. raw SQLをparameterized / allowlistedにする。
21. Secretをenvironment分離しroutine / incident rotation可能にする。
22. QR tokenをHMAC lookup + AES-GCM protected materialで守る。
23. Staff PIIを最小化する。
24. High-risk Admin actionをcurrent Authorization + Business Rule + idempotencyで守る。
25. error / logへstack / SQL / Internal ID / Secret / raw QR / full Emailを出さない。
26. rate limit failureでDomain stateを変更しない。
27. Security controlを安全に評価できない場合はFail Closedとする。
28. Security failureで確定済みBusiness Dataを削除しない。
29. `UCR-130-001〜006` を反映済みとみなさない。
30. `INV-010-01〜10` を維持する。
