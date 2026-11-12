# バックエンド基盤

この変更は `SPEC-190` の配置・依存方向と `SPEC-180` の Node 24 / PostgreSQL 17 / Railway 常駐プロセスを対象にする。正式仕様 (`docs/specs/`) と旧 UI モック (`apps/web/`) は変更しない。

## 実行範囲

基盤の入口は API、Email Worker、Reconciliation Worker の3プロセス。購入・予約・決済確定・返金・QR・通知生成・Role変更・個別復旧コマンドなどの業務機能は含めない。空の Worker を業務処理完了や本番稼働可能と扱わない。

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm check:boundaries
pnpm validate:traceability
pnpm validate:migrations
pnpm test:unit
# 合成データ専用の実 PostgreSQL 17 とsetup identityを指定する（CREATE/DROP DATABASE・test role作成権限が必要）。
# DB test fileごとに独立した一時databaseを作成・削除する。設定なしでは失敗する。
# 共有Rate Limitの実Redisテスト（TST-RLM-001）には使い捨てのRedisを `TEST_REDIS_URL` で指定する。
# 未設定・到達不能ならskipせず失敗する。Redis major 7はCIの暫定値で、Railwayの実versionは未確認（SPEC-180 §17.2 #3）。
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/r39x_test \
TEST_DATABASE_CA=/path/to/test-ca.crt \
TEST_REDIS_URL=redis://127.0.0.1:6379 pnpm test:backend
pnpm build:backend
pnpm secret-scan --build-dir dist --require-build
```

`pnpm build:backend` は実行時 Secret を読まず、次を生成する。

- `dist/apps/api/server.js`
- `dist/workers/email-worker.js`
- `dist/workers/reconciliation-worker.js`

標準 `pnpm build` はバックエンドと既存 Web をビルドする。Web の UI mock（Vite SPA）は別契約のため、その成功はバックエンドの証拠にならない。バックエンドだけの確認には `build:backend` を使う。

## 配置

`infra/backend.Dockerfile` は3サービス共通の非root実行イメージを作る。Railway の各サービスは**同一の immutable image digest**を使い、`infra/railway/*.toml` の start command だけを分ける。Worker に public domain を与えない。環境・region・replica・Secret・Neon側の設定は SPEC-180 に従い外部で用意する。このリポジトリの CI はデプロイを実行しない。

マイグレーションは専用 identity で明示実行し、API / Worker の起動処理からは実行しない。Provider 所有 schema は変更しない。

## 環境設定の入口

設定値は `packages/config/src/index.ts` の Zod schema が実行可能な一覧となる。Secret の実値をファイル・コマンド例・CI出力へ記録しない。各サービス専用の `DATABASE_URL`、Provider credential、相関鍵、環境 identity、health listener の `PORT` を Railway Sealed Variables で渡す。migration credential は runtime へ渡さない。

`AUTH_ISSUER` / `AUTH_AUDIENCE` / `AUTH_JWKS_URL` は実 Neon で確認した値を明示し、中継 origin から導出しない。API の `APP_BASE_URL` / `PUBLIC_WEB_ORIGIN` / `PUBLIC_API_ORIGIN` / `PUBLIC_AUTH_ORIGIN` / `ALLOWED_HOSTS` / `ALLOWED_ORIGINS` は exact origin / host に限定する。Email Worker は `EMAIL_FROM` / 任意の `EMAIL_REPLY_TO` / `APP_BASE_URL` も検証する。

次は `DEV-AI-003` に基づく deployment 設定の命名であり、新しい業務テーブルや API ではない。

- `DATABASE_ENV_MARKER_SETTING` / `NEON_PROJECT_ID_SETTING` / `NEON_BRANCH_ID_SETTING`: 外部 deployment が管理する、互いに異なる PostgreSQL `namespace.key` setting 名。期待値をそのまま観測値として使用せず、接続先の `current_setting` と照合する。実 Neon project/branch との紐付けは deployment preflight の責任であり、自己申告の marker だけで Provider identity を証明しない。
- `AUTH_DIRECTORY_SOURCE_MAPPING`: 実環境で確認した source schema/table/3列・Provider version を指定する任意の strict JSON。未指定時に推測値を入れない。`deploymentConfirmed:true` だけでは Provider 互換性の証拠にならず、実 DB の型・view・権限検証を別途必要とする。

共通の build 時に実行時 Secret は不要。SQL ファイル名・内容から計算した migration-set hash を3つの bundle に埋め込み、readiness で同梱 SQL・DB journal と照合する。hash の欠落・不一致は非 Ready とするため、未ビルドの source 起動は Ready にならない。`dist/backend-build.json` は同じ hash を記録するが、staging / Provider / approval gate の代替ではない。

Worker の停止は、新規処理を止めて協調終了を待ち、15秒を超えれば接続破棄・最大2秒の後処理を経て process を非0終了する。未完了の外部結果を成功や確定失敗へ書き換えない。

## 共有 Rate Limit（UCR-140-003）

- 判定ロジック・key導出・Class ID registry・store portは `packages/security/src/rate-limit/`、Redis adapterは `packages/rate-limit-redis/`（Redis clientをimportできる唯一の場所、`pnpm check:boundaries` で検査）。原子的評価のLuaは `packages/rate-limit-redis/src/evaluate.lua` をsource管理し、script hash（EVALSHA）で呼ぶ。`pnpm build:backend` がLuaをbundleへ埋め込む。
- API: 評価は3段階（`apps/api/src/api/rate-limit.ts`、SEC-ABU-017 / 029 / 030、SPEC-110 §24.1）。Stage 1（IP等。guardは確認も記録もしない）を draining の後・CORS/origin/body/認証/DBより前。`auth_form_proxy` は per-IP を body読取りより先に評価し、body読取り後に段階1bで (IP, 正規化済みidentifier) の組を評価する（SEC-ABU-017 / 024 / 031）、Stage 2（subject）をtoken検証の後・Principal解決（DB）の前（Webhookは署名検証の成功後・receipt dedupe（DB）の前にglobal ruleだけ）、Stage 3（resource / QR digest / target resource / target profile）を対象の認可確認（owner relation = 手順6、Role + Capability = 手順7）が成功した後・Domain preconditionとmutationの前に評価する。token検証に失敗したrequestだけが、そのclassのAuthentication-failure guardを1回の atomic 評価として評価する（上限内は記録して401、上限超過は記録せず429。有効tokenのrequestはguardの状態で拒否されない。SEC-ABU-020 / 021）。routeは `apps/api/src/api/routes.ts` のregistryでOperation IDとclassを必須にし、SPEC-110 §56.1と不一致なら型エラーまたは起動失敗。store障害・timeout・判定不能は `503 TEMPORARY_UNAVAILABLE`（Fail Closed、process-local fallbackなし）、超過は `429 RATE_LIMIT_EXCEEDED` と整数秒 `Retry-After`。
- 環境変数（API serviceのみ。workerに `RATE_LIMIT_REDIS_URL` / `RATE_LIMIT_HMAC_KEY` を置くと起動拒否）: `RATE_LIMIT_REDIS_URL`（Secret、`redis://` / `rediss://`）、`RATE_LIMIT_HMAC_KEY`（Secret、base64 32 byte）、`RATE_LIMIT_HMAC_KEY_VERSION`、`RATE_LIMIT_CONFIG`（JSON、全Class IDがcanonical ceiling以下の正整数）、`TRUSTED_PROXY_HOPS`（0以上の整数、`0` は直接peer）。いずれかの欠落・不正は起動失敗、store到達不能はreadiness=false。
- Client IPは `X-Forwarded-For` の右から `TRUSTED_PROXY_HOPS` 番目からだけ導出し、`Forwarded` / `X-Real-IP` は使わない。段数0・header欠落・要素不足・解釈不能ならsocket peer、peerも無ければ評価不能として503（SEC-API-031。`TRUSTED_PROXY_HOPS` の値と実ingressの整合は未検証）。
- Redisがメモリ上限（`maxmemory` + `noeviction`）に達したときの保証範囲: Redisはscript開始時に一度だけOOMかを判定する。上限超過の状態で始まったscriptは最初の書込み（rule 1のZADD）が拒否され、何も書かれずに評価全体が `503` になる（Fail Closed）。上限未満で始まったscriptは、途中で上限を越えても全ruleの書込みを完了する。したがって評価は「全ruleに適用」か「どれにも適用されない」のどちらかで、一部のruleだけ記録されることはない（TC-RLM-003-008）。readinessはこの書込みを伴う（下記）。越える量は高々1評価分の書込みで、直後のscriptがFail Closedになる。そのため `maxmemory` はcounter全体の作業集合に対して余裕を持って設定し、`used_memory` が `maxmemory` へ近づくことを運用で監視する必要がある。具体的な余裕量・監視閾値はRailway Redisの実測が前提で、Issue #45で確認する（本リポジトリは値を定めない）。
- 実装済みrouteは `apps/api/src/api/routes.ts` のregistryに登録する。`createApp` は起動時に `app.routes` と突き合わせ、registryにないroute（middleware、OPTIONS、healthを除く）があれば起動を失敗させる（DEV-RLM-005、TC-RLM-007-003）。
- rate limit store障害のログは `failure_class=SECURITY_FAILURE`（REL-SEC-007）で、HTTP結果は `503 TEMPORARY_UNAVAILABLE` のままである。
- 評価は段階1・段階2・段階3の独立した最大3回で、各評価の内部だけがatomicである。後の評価で拒否されたrequestも前の評価のcounterは消費する（SEC-ABU-013）。`self_read` / `staff_checkin` のIP keyには追加ruleのIP上限（240/300 per 60秒）だけを適用し、burst/sustainedはsubjectにだけ適用する（SEC-ABU-026）。追加ruleの `window_seconds` は§68の値に固定で、`RATE_LIMIT_CONFIG` で変えられるのは `limit` だけ（SEC-ABU-010、INF-RLS-009）。
- `/auth/*` は3つのclassに分かれる（SEC-ABU-027 / 028、SPEC-110 §56.1）。`GET /auth/get-session`・`GET /auth/token`・`POST /auth/sign-out` は `auth_session`（IP単位のみ。burst 100/10秒、sustained 600/60秒）、メールのリンクから開かれる `GET /auth/verify-email`・`GET /auth/magic-link/verify` は `auth_callback`（IP単位のみ。burst 30/10秒、sustained 120/60秒）、それ以外の許可されたroute（`POST /auth/email-otp/verify-email` を含む）は `auth_form_proxy`、どのrouteにも一致しない `/auth/*` は `public_read`（SEC-ABU-018）。`auth_session` / `auth_callback` はidentifier ruleとAuthentication-failure guardを持たず、bodyを読まない。3つのclassのcounterは互いに独立で、一つの消費は他に影響しない。分類は `apps/api/src/api/routes.ts` の `AUTH_SESSION_ROUTES` / `AUTH_CALLBACK_ROUTES` にあり、class registryは15のOperation用class + 2つのguardの計17。
- Stage 3（SEC-ABU-029）: `requireResourceRateLimit(limiter, valuesOf)` は認可確認の後に置く。`requireCapability` が通ると `authorizationConfirmed` を立て、owner relationを確認するself operation（および手順6だけを通るoperation）は `markAuthorizationConfirmed(c)` を呼ぶ。この印が無いままStage 3に到達したrouteは実装の欠陥として500で拒否し、共有counterには触れない。`valuesOf` は認可確認の後にだけ呼ばれるため、QR digestはStaff Capability確認の後に導出され、QR照会より前に評価される。403 / 404で終わったrequestはStage 3のcounterを変化させず、Stage 3の429 / 503はDomain preconditionとmutationへ進まない。
- Webhook（SEC-ABU-030）: `stripe_webhook` / `resend_webhook` のglobal rule（3,000/分）はregistryでphase `webhook_verified` を持ち、署名検証前のStage 1にはsource IPのburst / sustainedだけを評価する。署名検証が成功した後、receipt dedupe（DB）の前に `requireWebhookGlobalRateLimit(limiter)` を置く。無効署名はglobal counterを消費せず、超過は `429 RATE_LIMIT_EXCEEDED` と `Retry-After` でReceiptを作らない。Webhook routeはまだ未実装で、このhookと限度の検証はfixtureのrouteで行う。
- `/auth/*` 許可表（API-RLC-004、SPEC-110 §23.1）: `apps/api/src/api/routes.ts` の `CANONICAL_AUTH_ALLOWLIST`（15経路のmethod・path・class）が実装の許可リスト（`AUTH_ROUTES` + class割当）と完全一致しなければ、module読込時の `assertAuthAllowlist` と `createApp` の `assertMountedAuthRoutes`（実際にmountしたroute）が起動を失敗させる。testは仕様書 `docs/specs/110-api-specification.md` の表そのものを読んで突き合わせる。表にない経路・methodは404 / 405で `public_read` のper-IP ruleだけで評価される。Google OAuth callbackは `UCR-110-002` が未解決のため含めない。
- login identifierは `auth_form_proxy` のPOST JSON `email`（先頭64 KiB・3秒まで。文字列でない値・空・正規化後に1〜320文字を外れる値は取り出せない扱い、それ以外はtrim・NFKC・locale非依存の小文字化で正規化）。取り出せなければidentifier ruleだけ省略し、per-IP ruleは常に評価する（SEC-ABU-024）。identifier ruleの組のkeyは (source IP, identifier) を長さ接頭辞付きでHMACに入れる（同じidentifierでも別IPは別の枠）。body読取りの同時実行はIPごとに3件・process全体で256件まで、超過は body を読まず `429`（`Retry-After: 1`、storeを呼ばず `rule_category=concurrency`）。読取りは3秒・64 KiBで打ち切り、slotは応答完了・打切り・切断のいずれでも必ず解放する。段階1の拒否は body を読まず `Connection: close` で返す（SEC-ABU-031）。Stage 1の429/503は、exactなWeb originにだけ `Access-Control-Allow-Origin`・`Vary: Origin`・`Access-Control-Expose-Headers: X-Request-Id, Retry-After` を付ける（`/api/v1/*` では `Allow-Credentials` を付けない。`/auth/*` は認証proxyの既存どおり `true`。SEC-ABU-025）。
- JWKS（REL-AUTH-002、SEC-ABU-021）: `packages/auth` の `createJwksKeyResolver` が `kid` ごとに鍵を cache する。未知の `kid` による refresh は process 単位で single-flight、かつ開始は30秒に1回まで。refresh の実行中・間隔内に cache で検証できない token は待たずに `503` とし、guardには数えない。refresh の失敗も `503`（判定不能は未認証ではない）。
- IP正規化（SEC-API-032）: counter key に使う IP は、IPv4-mapped IPv6 を対応する IPv4 とし、その他の IPv6 は /64 に集約する。同じ /64 内で address を変えても per-IP rule を回避できない。
- Cart（SEC-ABU-029 / API-RLC-006）: 1つのruleは複数のresourceを持てる（distinct のみ、最大50）。全resourceを1回のatomic評価に含め、1つでも超過すれば全counterを記録せず `429`。cart の route はまだ未実装で、この port の検証は limiter の単体・実Redisテストで行う。
- 読取り専用 operation（API-RLC-005）: `API-STF-GDS-002`（Goods Handoff の対象確認）は `self_read` に属し、完了用 `goods_handoff` の counter を消費しない。
