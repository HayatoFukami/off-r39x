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
# 破棄可能な合成データ専用の実 PostgreSQL 17 を指定する。設定なしでは DB テストは失敗する。
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/r39x_test \
TEST_DATABASE_CA=/path/to/test-ca.crt pnpm test:backend
pnpm build:backend
pnpm secret-scan --build-dir dist --require-build
```

`pnpm build:backend` は実行時 Secret を読まず、次を生成する。

- `dist/apps/api/server.js`
- `dist/workers/email-worker.js`
- `dist/workers/reconciliation-worker.js`

標準 `pnpm build` はバックエンドと既存 Web をビルドする。Web の旧モックは別契約のため、その成功はバックエンドの証拠にならない。バックエンドだけの確認には `build:backend` を使う。

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

## 検証記録

実行結果・例外・未実装範囲は [backend-foundation-evidence.md](backend-foundation-evidence.md) を参照。

## 未検証・公開ブロッカー

- Neon Auth の実際の管理 schema / version を確認した限定 Directory の配置・権限検証。合成 Provider table を使う PG17 テストは Neon 互換性の証明ではない。
- Neon JWT の実 issuer / audience / JWKS / Ed25519 / 最大900秒の互換性。
- `/auth/*` の許可 method/path、Cookie・Origin・CSRF・redirect、全4認証方式、同一Subject連携、Safari を含む実 Provider 検証。未確定のため汎用転送ルートは登録しない。
- 共有 multi-instance Rate Limit の配線。独自の Redis / DB テーブル / 業務 API を追加して補完しない。
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
