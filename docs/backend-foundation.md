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
- API: Stage 1（IP等、guardの確認）を draining の後・CORS/origin/body/認証/DBより前、Stage 2（subject）をtoken検証の後・Principal解決（DB）の前、resource/QR digestを入力検証の後に評価する（`apps/api/src/api/rate-limit.ts`）。routeは `apps/api/src/api/routes.ts` のregistryでOperation IDとclassを必須にし、SPEC-110 §56.1と不一致なら型エラーまたは起動失敗。store障害・timeout・判定不能は `503 TEMPORARY_UNAVAILABLE`（Fail Closed、process-local fallbackなし）、超過は `429 RATE_LIMIT_EXCEEDED` と整数秒 `Retry-After`。
- 環境変数（API serviceのみ。workerに `RATE_LIMIT_REDIS_URL` / `RATE_LIMIT_HMAC_KEY` を置くと起動拒否）: `RATE_LIMIT_REDIS_URL`（Secret、`redis://` / `rediss://`）、`RATE_LIMIT_HMAC_KEY`（Secret、base64 32 byte）、`RATE_LIMIT_HMAC_KEY_VERSION`、`RATE_LIMIT_CONFIG`（JSON、全Class IDがcanonical ceiling以下の正整数）、`TRUSTED_PROXY_HOPS`（0以上の整数、`0` は直接peer）。いずれかの欠落・不正は起動失敗、store到達不能はreadiness=false。
- Client IPは `X-Forwarded-For` の右から `TRUSTED_PROXY_HOPS` 番目からだけ導出し、`Forwarded` / `X-Real-IP` は使わない。段数0・header欠落・要素不足・解釈不能ならsocket peer、peerも無ければ評価不能として503（SEC-API-031。`TRUSTED_PROXY_HOPS` の値と実ingressの整合は未検証）。
- Redisがメモリ上限（`maxmemory` + `noeviction`）に達したときの保証範囲: Redisはscript開始時に一度だけOOMかを判定する。上限超過の状態で始まったscriptは最初の書込み（rule 1のZADD）が拒否され、何も書かれずに評価全体が `503` になる（Fail Closed）。上限未満で始まったscriptは、途中で上限を越えても全ruleの書込みを完了する。したがって評価は「全ruleに適用」か「どれにも適用されない」のどちらかで、一部のruleだけ記録されることはない（TC-RLM-003-008）。越える量は高々1評価分の書込みで、直後のscriptがFail Closedになる。そのため `maxmemory` はcounter全体の作業集合に対して余裕を持って設定し、`used_memory` が `maxmemory` へ近づくことを運用で監視する必要がある。具体的な余裕量・監視閾値はRailway Redisの実測が前提で、Issue #45で確認する（本リポジトリは値を定めない）。
- 実装済みrouteは `apps/api/src/api/routes.ts` のregistryに登録する。`createApp` は起動時に `app.routes` と突き合わせ、registryにないroute（middleware、OPTIONS、healthを除く）があれば起動を失敗させる（DEV-RLM-005、TC-RLM-007-003）。
- rate limit store障害のログは `failure_class=SECURITY_FAILURE`（REL-SEC-007）で、HTTP結果は `503 TEMPORARY_UNAVAILABLE` のままである。
- 評価は段階1・段階2のsubject・resource/QR digestの独立した最大3回で、各評価の内部だけがatomicである。後の評価で拒否されたrequestも前の評価のcounterは消費する（SEC-ABU-013）。`self_read` / `staff_checkin` のIP keyには追加ruleのIP上限（240/300 per 60秒）だけを適用し、burst/sustainedはsubjectにだけ適用する（SEC-ABU-026）。追加ruleの `window_seconds` は§68の値に固定で、`RATE_LIMIT_CONFIG` で変えられるのは `limit` だけ（SEC-ABU-010、INF-RLS-009）。
- `/auth/*` は3つのclassに分かれる（SEC-ABU-027 / 028、SPEC-110 §56.1）。`GET /auth/get-session`・`GET /auth/token`・`POST /auth/sign-out` は `auth_session`（IP単位のみ。burst 100/10秒、sustained 600/60秒）、メールのリンクから開かれる `GET /auth/verify-email`・`GET /auth/magic-link/verify` は `auth_callback`（IP単位のみ。burst 30/10秒、sustained 120/60秒）、それ以外の許可されたroute（`POST /auth/email-otp/verify-email` を含む）は `auth_form_proxy`、どのrouteにも一致しない `/auth/*` は `public_read`（SEC-ABU-018）。`auth_session` / `auth_callback` はidentifier ruleとAuthentication-failure guardを持たず、bodyを読まない。3つのclassのcounterは互いに独立で、一つの消費は他に影響しない。分類は `apps/api/src/api/routes.ts` の `AUTH_SESSION_ROUTES` / `AUTH_CALLBACK_ROUTES` にあり、class registryは15のOperation用class + 2つのguardの計17。
- login identifierは `auth_form_proxy` のPOST JSON `email`（先頭64 KiB・3秒まで。文字列でない値・空・正規化後に1〜320文字を外れる値は取り出せない扱い、それ以外はtrim・NFKC・locale非依存の小文字化で正規化）。取り出せなければidentifier ruleだけ省略し、per-IP ruleは常に評価する（SEC-ABU-024）。Stage 1の429/503は、exactなWeb originにだけ `Access-Control-Allow-Origin`・`Vary: Origin`・`Access-Control-Expose-Headers: X-Request-Id, Retry-After` を付ける（`/api/v1/*` では `Allow-Credentials` を付けない。`/auth/*` は認証proxyの既存どおり `true`。SEC-ABU-025）。
- 観測: eventは `ratelimit.decision.completed`（rejected／store_unavailableのみ）と `security.fail_closed.triggered`（`control_category: rate_limit`）、metricは `r39x_rate_limit_decisions_total` / `r39x_rate_limit_store_duration_seconds`（`bootstrap()` が返す `rateLimitMetrics` に蓄積。exporter／Better Stackへの配線は未実装）、alertは `OBS-ALT-041` のrule定義と純関数評価器（`packages/observability`）。
- テスト: 実Redis（`TEST_REDIS_URL` 必須）は `tests/integration/foundation-rate-limit-redis.test.ts`、障害注入は `tests/harness/rate-limit/faults.ts` のDIのみ、API層は `tests/api/foundation-rate-limit-api.test.ts`（memory storeはAPI層に限る）。ローカルでは `docker run --rm -d -p 127.0.0.1:6379:6379 redis:7` 等で使い捨てRedisを用意する。

## 検証記録

初回実装の記録は [backend-foundation-evidence.md](backend-foundation-evidence.md)、監査後修正と現在の制限は [backend-foundation-audit-evidence.md](backend-foundation-audit-evidence.md) を参照。

## 未検証・公開ブロッカー

- Neon Auth の実際の管理 schema / version を確認した限定 Directory の配置・権限検証。合成 Provider table を使う PG17 テストは Neon 互換性の証明ではない。
- Neon JWT の実 issuer / audience / JWKS / Ed25519 / 最大900秒の互換性。
- `/auth/*` は限定transport候補を実装済み。`NEON_AUTH_BASE_URL` を環境固定HTTPS URL（末尾slashなし、Providerの `/auth` を含む）として設定する。公開method/pathはソースの限定表のみ。実NeonでのCookie・Origin・CSRF・redirect、全4認証方式、同一Subject連携、Safari互換性は未検証であり、Production公開gateは未達。管理API・汎用転送・独自Session cacheは追加しない。
- 共有 Rate Limit（UCR-140-003）は実装済みで、実Redisに対する合成テストを持つ。次の外部事実は未確認で、本リポジトリは値を確定しない（SPEC-180 §17.2）: ① Railway ingressが付与するforwarded headerと `TRUSTED_PROXY_HOPS`（現実装は `X-Forwarded-For` の右からN番目を使うため、実ingressの形と一致するかをstagingで確認する。**Production promotionをblock**）、② private network内のRedis TLS、③ Railway Redisの実version、④ `maxmemory-policy noeviction` と `maxmemory` の設定可否（**Production promotionをblock**）。`rate-limit-redis` serviceの配備、メモリ量の実測、OBS-ALT-041の通知配線（Better Stack）は運用側の作業であり未実施。
- 非本番の Stripe / Resend credentials、承認済み送信先、Provider Contract Smoke。Resend の same-key replay は同じ payload/key の `POST /emails` であり、未確認の検索 API を作らない。
- 個別 Worker handler、claim/lease/通知永続化、業務照合・復旧の実装。空の起動基盤を配送・reconciliation の完了と扱わない。
- 本番の監視配線、監査の運用、バックアップ、restore rehearsal、staging・全システム G1〜G10 の公開 gate。この基盤 suite だけで公開を許可しない。

## 仕様矛盾の報告（正式仕様は未変更）

### UCR-BACKEND-001

- 対象: SPEC-150 §14 `REL-DB-001`、§16 `REL-DB-011`
- 現在の仕様: `REL-DB-001` は自動 transaction retry を `40001` / `40P01` のみに限定する一方、`REL-DB-011` は lock timeout にも最大4回の retry を要求する。
- 要求する変更: Canonical Owner で lock timeout の SQLSTATE と retry 可否・適用 policy を統一する。
- 理由: `55P03` 等を agent 判断で retry allowlist に追加できない。
- 変更しない場合の影響: 矛盾する lock-timeout 自動 retry は実装せず上位へ返す。明示的な `40001` / `40P01` のみを retry する基盤として扱い、lock-timeout 要件を満たしたとは報告しない。
- 影響を受ける可能性がある仕様書: SPEC-100、SPEC-150、SPEC-170、SPEC-190。

`UCR-130-005` の deferred operational index は追加しない。

## 監査後の実装境界

- DB readinessはmigration journalに加え、release対象のPG17 catalog（列・default・制約定義／検証状態・Index定義／有効状態・sequence・schema owner）をsource-controlledな期待値と照合する。既存release以外の業務table実装を証明しない。
- Directoryは3列の型／grantだけでなく、直接投影、Subjectの有効な一意Index、Subject／verified列のNOT NULLと有効な一意Indexによってcardinalityを確認する。catalogとOIDを用い、Directoryを読めないReconへ行読取権限を要求しない。実Neonのsource mappingはdeploymentで確認し、Provider所有tableは変更しない。
- Stripe lookupはSDK Fetch transportを明示採用し、本文処理まで10秒のadapter deadlineと単調時計の確認を適用する。SDKの自動network retryは0。旧Node socket inactivity timeoutへの依存を除いた。
- `GET /api/v1/self/principal` (`API-AUTH-001`) は公開RPC型と同じbuilderでmountする。署名済みJWT→現在Directory／Profile／Role→メール確認→共有guardを経てnavigation情報だけを返す。GETによるProfile作成は行わない。
- 本変更は全SPEC-110の実装ではない。Profile provisioning／編集を含むその他のoperation、購入・予約・決済、Worker業務handlerは追加していない。
- `NEON_AUTH_BASE_URL`／Directory mapping／共有guardが成立しない標準API起動はReadyにならない。空Worker registryも引き続きReadyにならない。合成依存による正常系試験を、標準3プロセスの本番Readyと読み替えない。
