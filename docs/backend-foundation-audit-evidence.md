# バックエンド基盤・監査後修正記録

総合判定: **FAIL（共有Rate Limitの実バックエンドが未実装、外部互換性gateが未検証）**。
ローカルの修正済み項目を、基盤全体の完成やProduction公開可と扱わない。

## Changed scope

- 監査対象: `feat/backend-foundation` / `c7891318cf8d9260681879a5816501355e78d78b`。
- `git remote -v`、upstream・作業ツリー確認、`git fetch --prune`後はHEAD側6 / upstream側0。開始時クリーン、fast-forward不要。
- 上記HEADから `fix/backend-foundation-audit` を新規作成。元ブランチへの直接変更、Merge、Pushは行わない。
- 分類: Database-sensitive / Reliability / Observability / Security / API contract / Infrastructure。
- `apps/web/`、`docs/specs/`、購入・予約・決済業務、Worker業務handlerは変更しない。Canonicalの既存挙動へ合わせる修正であり、仕様変更を行わない。

## Canonical rules referenced

| 修正項目 | Rule / Owner | 判定と証拠範囲 |
|---|---|---|
| release対象DB catalogの実在・定義・有効状態検査 | `REL-DB-012`, `INF-DB-008` | PASS: 実PG17で13種類の可逆DDL故障を検出し、rollback後Readyへ戻る |
| Stripe本文を含む総期限 | SPEC-150 §9, `REL-TMO-003`, `DEV-REL-002` | PASS: 実HTTPで250msごとに本文を送り12秒で完了する応答を約10秒で打切り、socket終了・1回のみを確認。キャンセル無視／event loop遅延も検査 |
| DB障害・再試行・結果不明の観測 | `OBS-DB-001/003/004` | PASS: 実PG17 SQLSTATEとCOMMIT応答喪失proxy。`40001`/`40P01`別集計可能、制約競合・接続障害・deadline／lock／statement timeoutを区別、unknown eventを出力 |
| 認証・認可イベント | SPEC-160 §24, `OBS-AUTH-001/002`, `OBS-LOG-006` | PASS: 成功／拒否／Auth障害、現在Role／メール確認・Profile解決、request ID、Canonical Operation／execution ID、認証済みActor、秘密値非出力 |
| 既知Pathの未対応Method | `SEC-API-022` | PASS: literal／parameterized pathを405＋Allow、未知pathを404。Origin等の安全性検証は維持 |
| 認証中継・JWT・Directory連携 | `AR-SES-003/005`, `SEC-AUTH-001/009`, `SEC-API-001/003/008`, `DB-ARC-008` | ローカルPASS: 限定proxy候補、署名検証と現在Directory／Roleを接続。実Neon・4方式の完結・同一Subject連携・SafariはNOT VERIFIED |
| 共有Rate Limit | `SEC-ABU-001/002` | **FAIL**: guardへの接続と欠落／障害時503は確認したが、標準入口に実共有enforcementがない。counter、window、identifier制限、multi-instanceでの実動作は未実装・未検証 |
| 公開RPC型とmount | `DEV-API-002/003`, `API-AUTH-001` | PASS（基盤ルートのみ）: `hc<AppType>`で同じbuilder由来のrouteを呼び、現在Roleとnavigation情報、401/403/503を確認。全SPEC-110の完成を意味しない |
| 起動・Readiness | `REL-DB-012`, `INF-HLT-002`, `SEC-ABU-002` | ローカルPASS: 実bootstrap/socket/TLS/PG17で200→503→200→drain503。共有guard・build identity・CAは明記したharness依存。標準3プロセスのReady達成は**FAIL** |

## Files changed

- `packages/db/src/readiness.ts`, `schema-contract.ts`, `schema-contract.json`: release catalogとDirectoryの健全性検査。
- `packages/providers/stripe/src/index.ts`: Fetch transport、本文処理までのdeadline、遅延成功拒否。
- `packages/db/src/transaction.ts`, `database.ts`, `observability.ts`, `packages/observability/src/index.ts`: 安全なDB観測とprocess logger接続。
- `apps/api/src/api/app.ts`: 認証認可観測、405、RPC、guardと限定proxyのmount。
- `apps/api/src/api/auth-proxy.ts`, `middleware/json.ts`: 公開endpoint限定、固定upstream、Origin／CSRF／CORS、Cookie、redirect、body制限と総期限。
- `packages/api-contract/src/index.ts`: `API-AUTH-001`のshared wire schema／route builder／公開型。
- `apps/api/src/bootstrap/index.ts`, `packages/config/src/index.ts`: verifier・Principal repository・proxy・共有guardの接続と必須条件のreadiness確認。
- `tests/vitest.backend.config.mts`, `tests/harness/db/isolated-database.ts`: テストごとの独立DBとsetup／cleanup。
- `apps/email-worker/src/main.ts`, `apps/reconciliation-worker/src/main.ts`: process loggerをDB poolへ接続。空registryを維持。
- workspace package manifests / lockfile: 既存observability／reliability workspace依存を宣言。
- `tests/traceability/test-manifest.json`, `traceability/rule-code-map.json`: 追加13 TCと変更sourceのCanonical対応。
- `AGENTS.md`, `docs/backend-foundation.md`, 本記録: 現在の実装境界と未解決事項。

## Migrations

なし。既存SQL、Provider所有schema、業務schemaを変更していない。
`schema-contract.json` は新規作成した合成PG17の既存migration結果から採取し、既存SQL／journal DDLと照合したrelease期待値であり、runtimeの実DBから期待値を生成しない。

## Tests added/changed

- `TC-DB-AUDIT-001`: `tests/db/foundation-audit-readiness.test.ts`。
- `TC-STRIPE-AUDIT-001/003`: `tests/unit/foundation-audit-stripe.test.ts`。
- `TC-STRIPE-AUDIT-002`: `tests/integration/foundation-audit-stripe-transport.test.ts`。
- 既存`TC-DB-FOUNDATION-008`: callbackの8秒期限切れを`reliability.timeout.occurred`として記録し、DB接続不能へ混同しないassertionを追加。
- `TC-OBS-AUDIT-001`: `tests/db/foundation-audit-observability.test.ts`。
- `TC-OBS-AUDIT-002`: `tests/api/foundation-audit-observability.test.ts`。
- `TC-HTTP-AUDIT-001`, `TC-RPC-AUDIT-001`: `tests/api/foundation-audit-method.test.ts`。
- `TC-AUTH-AUDIT-001〜003`: `tests/api/foundation-audit-auth-proxy.test.ts`。
- `TC-AUTH-AUDIT-004`: `tests/db/foundation-audit-principal.test.ts`。
- `TC-STARTUP-AUDIT-001`: `tests/db/foundation-audit-startup.test.ts`。

先行する回帰試験で、UNIQUE削除後Ready=true、キャンセル無視時のStripe未settle、DB／認証イベントなし、既知path 404、principal route 404を失敗として確認してから実装した。初回の型検査ではgeneric Context／test transportの型、Traceability検査では追加TC未登録・critical upstream不足も検出し修正した。Operation相関の追加試験では、Role解決前のverificationまでAdministratorとする初期assertionの誤りを検出し、verification時点はGuest、現在Role解決後はDB由来ActorとするCanonical順序へ修正した。診断時の失敗を成功記録へ置き換えない。全体gateの最終結果は下記に記録する。

## Test groups executed

ローカルDBは専用の破棄可能PostgreSQL **17.11**、UTC、合成証明書によるverified TLS。既存監査DBは再利用していない。Node **24.22.1** / corepack pnpm **12.3.4**。runner retryは0。

| コマンド／検証 | 結果 |
|---|---|
| `corepack pnpm lint` | PASS: error 0、既存warning 2件 |
| `corepack pnpm typecheck` | PASS: 全workspace |
| `corepack pnpm check:boundaries` | PASS |
| `corepack pnpm validate:traceability` | PASS: 654 TC / 218 Rule |
| `corepack pnpm validate:migrations` | PASS: 既存SQL 1本の静的検査。DB試験とは別 |
| `corepack pnpm test:unit` | PASS: 106 files / 2,303 tests |
| `corepack pnpm test:backend`（実PG17 / test CA指定） | 修正後の新gateでPASS: 20 files / 76 tests |
| `corepack pnpm build:backend` | PASS: API / Email / Reconciliationの3 bundle |
| `corepack pnpm secret-scan --build-dir dist --require-build` | PASS: 513 files、検出0。指定scopeのpattern scanであり完全な監査ではない |
| 生成bundleの実起動・SIGTERM | 3プロセスともlive=200 / ready=503 / exit=0、stderrなし。非Readyの解消を意味しない |
| `git diff --check`、禁止directory差分 | PASS: `apps/web/` / `docs/specs/` の差分0 |
| Docker image build | NOT VERIFIED: Docker daemonへ接続できない |

最初の全体Backend gate（修正前runner設定）は **18 files PASS / 2 files FAIL、74 tests PASS / 2 tests FAIL**。readinessのDDL故障と起動試験が同一DB上で重なり、lock timeoutによる503と5秒のtest timeoutが発生した。採用Vitest 3ではproject内の`fileParallelism`はscheduler制御に使用できないことを、ローカル実装・型と公式資料で確認した。

`2d318b9` でDB laneにファイルごとの独立したephemeral databaseを導入し、cluster role初期化だけ共通setup DBのadvisory lockで保護した。起動試験のmarkerもcluster-wideなRole設定から専用Database設定へ移した。retry、時間上限、期待HTTP、SQLSTATEの期待値、並行競合のparticipant数を緩和していない。新しい変更に対する全体gateで20 files / 76 testsが通過した。後続の最終レビューではNode接続エラーをSQLSTATEとして記録しないこと、callback期限切れをDB unavailabilityへ混同しないことも追加確認した。最初の失敗は取り消さず記録を残す。

起動正常系の`TC-STARTUP-AUDIT-001`はbuild hash／test CAの注入をtest harnessに閉じている。生成bundleそのものは別途、実PG17と合成設定で3プロセスを起動して検証した。実共有guardのない標準APIと空registryのWorkerは503であり、正常系fixtureの200をProduction readinessの証拠にしない。

Directoryの最小権限probeを追加した際、Recon identityでreadinessが`database_contract_unverified`となることを確認した。Directory行読取とschema名解決に依存した権限検査を、`pg_catalog`の型／NOT NULL／一意Index／view定義とOIDによる権限検査へ置換した。Email／Reconの実runtime roleでDB readinessが成立し、ReconからDirectoryの行を読む要求は42501となることを同じ試験で確認した。権限付与を追加して解決していない。Provider table名がSQL予約語である合成ケースでもprojection一致を確認し、独自の識別子regexではなくPostgreSQLの`quote_ident`を使用した。変更前の当該probeは`directory_projection`で失敗し、変更後に通過した。

## Security/reliability implications

- ログへJWT／Cookie／Password／メール／SQL text／bind／接続文字列／raw Provider errorを追加しない。
- DB結果不明を成功／確定失敗へ変換せず、自動再実行しない。`55P03`のretryは追加しない。
- Auth proxyは管理API、任意URL転送、独自認証発行、Session cache、Provider schema書込みを提供しない。API用JWTのissuerをproxyへ置換しない。
- Auth proxyのローカルfixtureはCookie／status／body／Origin／method／redirect／deadline等を検証するもので、実Provider protocolやSafariの互換性証明ではない。
- Provider Logout失敗時もproxy hostのSession Cookieを失効させ、503を維持する。Provider側の失効成功は主張しない（`AR-SES-009`, `SEC-AUTH-012`）。
- `NEON_AUTH_BASE_URL`未指定時はproxyをmountせずAPI非Ready。共有guard欠落／障害時は中継・principalを503で拒否する。これはRate Limit実装の代替ではない。
- Auth Profile provisioning／編集等の他operationは未実装。未作成ProfileをGETから作成しない。Profileが必要なrequestは拒否を維持する。

## Traceability changes

654 TC / 218 Rule（最終validator出力で確認）。追加13 TCを上記のsourceと対応付ける。既存UCR提案をactive Ruleや新APIへ昇格していない。

## Known non-implemented UCRs

### UCR-BACKEND-001（既存、継続）

- 対象: SPEC-150 §14 `REL-DB-001`、§16 `REL-DB-011`。
- 現在の仕様: 自動transaction retryは`40001`／`40P01`のみ。一方lock timeoutもretry対象とする要求がある。
- 要求する変更: Canonical OwnerでSQLSTATEとretry policyを統一する。
- 理由: `55P03`をagent判断でallowlistへ追加できない。
- 変更しない場合の影響: lock timeoutは1回で上位へ返し、要件全体をPASSにしない。
- 影響を受ける可能性がある仕様書: SPEC-100 / 150 / 170 / 190。

### UCR-BACKEND-AUDIT-001（新規、未解決）

- 対象: SPEC-140 §67–70 `SEC-ABU-001/002`、選定委譲先SPEC-180、必要に応じSPEC-100 / 110。
- 現在の仕様: multi-instance共有、class／key／window／上限、欠落時Fail Closedは定義されるが、SPEC-180に実共有layer／storeと接続契約がない。SPEC-100にもrate counter tableはない。
- 要求する変更: Canonical Ownerで共有enforcement方式、atomicな複数window消費、時刻／TTL／境界、trusted source IPの取得経路とorigin bypass防止、起動config／権限、障害時動作を確定する。必要なschemaや外部サービスを選ぶ場合は所有仕様へ取り込む。各保護operationのclass適用とHTTP429 envelopeも整合させる。
- 理由: 今回は`docs/specs/`変更、新規schema／API、未定義インフラを独断で追加できない。仕様書自身がSPEC-180へ委譲する選定をrepository-only判断で代替しない。
- 変更しない場合の影響: 共有adapterを実装・標準server入口へ接続できず、標準APIは非Ready。per-process counterや外部サービスの架空APIでPASSにしない。
- 影響を受ける可能性がある仕様書: SPEC-060 / 100 / 110 / 140 / 150 / 160 / 170 / 180 / 190。

`UCR-130-005` は引き続き `DEFERRED_NONBLOCKING`。提案Indexは追加していない。

## External verification / Release impact

| 対象 | 判定 | 理由／影響 |
|---|---|---|
| 実Neon Directory／JWT／Auth proxy | NOT VERIFIED | 非本番環境のProvider schema version・設定・credentialとbrowser検証環境なし。4方式完結、同一Subject連携、メール／reset／Logout、CSRF state、OAuth handoff、Safariは公開ブロッカー |
| 実Stripe／Resend G9 | NOT VERIFIED | 承認済み非本番credential／送信先なし。local transport／doubleは代替にしない |
| 共有Rate Limit実store・複数instance | FAIL / NOT VERIFIED | 実装契約未決定、実storeなし。guard障害試験のみで成功扱いしない |
| Worker業務handler／claim／lease／配送・照合 | NOT VERIFIED（対象外） | registryは空。readinessを偽装せず503を維持 |
| Railway配置・Remote CI・staging・全システムG1〜G10 | NOT VERIFIED | ローカル基盤suiteのみ。デプロイ／公開操作は行わない |
| Web build／UI E2E／G8 | NOT VERIFIED（対象外） | 旧Web mockは変更せず、基盤の証拠に算入しない |

## Re-audit readiness

修正したローカル基盤の再監査は可能。shared store契約のCanonical確定と実装、非本番のProvider／Safari検証、対象外業務handler等を満たすまで、バックエンド全体の完成・Production昇格は判定できない。

参考に確認した一次資料（採用環境との適合は未確認）:
- [Neon framework adapter guide](https://github.com/neondatabase/neon-js/blob/main/packages/auth/BUILDING-AN-ADAPTER.md)
- [Neon public endpoint registry](https://github.com/neondatabase/neon-js/blob/main/packages/auth/src/server/endpoints.ts)
- [Neon cookie constants](https://github.com/neondatabase/neon-js/blob/main/packages/auth/src/server/constants.ts)
- [Neon proxy response handling](https://github.com/neondatabase/neon-js/blob/main/packages/auth/src/server/proxy/response.ts)
- [Better Auth Magic Link](https://better-auth.com/docs/plugins/magic-link)

- [Vitest 3 fileParallelism（root-only設定）](https://v3.vitest.dev/config/#fileparallelism)
