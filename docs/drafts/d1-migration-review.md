# Cloudflare 移行・認証・基盤構成の検討（D1 を中心に）

> 状態: **検討資料（正式仕様ではない）**。`docs/specs/` は変更していない。
> 作成日: 2026-10-23 / 改訂: 2026-10-24（一次情報による精査、認証・基盤・コストの比較を追加、章立てを再構成、コスト要因別の構成を追加して 13 構成で再採点）
> 対象: SPEC-010・060・100・140・150・180 ほかの現行本文（`main`）、`payment/integration` の実装
> 目的: 業務 DB を Supabase PostgreSQL から Cloudflare D1 へ変更する場合の実現可能性・変更量・実装難易度・コストを整理し、Workers への移行、認証の代替、Railway の代替、有料プランの構成を含めて 13 の構成を比較する。
> 注意: 本書は仕様変更の提案ではない。移行を決めた場合は `AGENTS.md §7` / `SPEC-000` の手続き（UCR）で仕様を先に改訂する。

## 0. この資料の確認方法

各記述には、根拠の種類を示す記号を付けた。

| 記号 | 意味 |
|---|---|
| ✅ | 一次情報（公式ドキュメント、ライブラリのソースコード、GitHub）で確認した。出典は `[S#]`（末尾の Sources） |
| 📐 | リポジトリの仕様書・実装を実測または精読して確認した |
| ⚠️ | 推定または判断。実測や公式の裏付けがない |

- 外部情報は、Cloudflare・Supabase・Railway・Neon・Better Auth・Hono・Stripe・Resend・SQLite・Drizzle・各認証サービス・Fly.io・Render・Google Cloud・AWS の公式ドキュメントと、OWASP・Have I Been Pwned・GitHub（ソース、リリース、アドバイザリ）だけを使った。ブログやフォーラムは使っていない。
- 公式ドキュメントに記載がないことは、「ない」と断定せず「記載を確認できなかった」と書いた。
- 料金・上限は 2026-10-23 時点の公式ページの値。変わる可能性がある。為替は $1 = ¥150。
- 表記: 「第 N 章」「N.M」は本書の章・節、「SPEC-xxx」「§N」は仕様書の節を指す。
- 前提: AWS のサービスを自分で契約・運用する構成は採用しない（確認した内容は付録 A）。Neon のように、AWS 上で提供元が運用する SaaS は対象に含める。
- 構成の呼び名（A〜M）は第 3 章で定義する。

## 1. 結論と推奨

### 1.1 要点

1. **D1 への全面移行（構成 C・D・E）は技術的には可能だが、DB だけの差し替えでは済まない。** D1 は Workers の binding 経由で使うのが基本で、Railway の Node から使うと Cloudflare の REST API（制御面 API）になる。REST API はトークンあたり 1,200 リクエスト/5 分の共通上限があり、超えると 5 分間すべての API が止まる ✅[S8][S9]。実行時の経路には使えないので、**API と Worker の Workers 移行がセット**になる。
2. **仕様の根幹に触れる。** 業務 transaction（16 種）が「行ロック + 対話的 transaction」を前提にしており 📐、D1 で公式に示されている transaction の手段は `batch()` だけ ✅[S3]。カラオケ枠の EXCLUDE 制約、DB role による最小権限、バックアップ要件も代替が難しい（第 5 章）。
3. **現行（構成 A、月 $60〜130）のコスト要因は Railway（約 6 割、$36〜84）と Supabase（約 4 割、$25〜45）。** staging・dev を使う時間だけ動かす「縮小運用」（第 3 章）にすると、Railway のままで **$46〜77（H）**、Fly.io で **$39〜63（I）**、Workers + Hyperdrive で **$31〜40（B）** まで下がる（第 8 章）。Workers 移行によるコスト削減は D1 とは独立で、B でも F・G とほぼ同じ水準になる。
4. **採点（第 11 章）では、Supabase を維持して縮小運用する構成が上位。** 基本ケースは I 4.00 > H 3.65 > J 3.60 > G 3.55 > B 3.50 > A 3.40 > F 3.35 > E 3.30 > K 3.20 > M 3.10 > L 2.95 > C 2.70 > D 2.60。H・I は全コストケースで 3.60 以上と安定している。差は小さく、I は Fly.io の東京価格とメモリ 256MB で足りるかに依存する。
5. **推奨は、まず構成 H（A の縮小運用）。** 仕様の変更が小さい（数日の見込み ⚠️）うえで、月額を中央値で約 $33 下げられる。次に、構成 I（Fly.io）を spike で確かめ、東京価格・メモリ・SIGTERM の扱いが通れば更に約 $10 下がる。Workers への移行（B）は、月額が H より中央値で約 $26 低いが、工数（約 1.5〜3 週間）に対して採点では上回らない。
6. **認証は Supabase Auth の継続が最も仕様に適合する**（第 6 章）。Hono での自作（D）は非推奨。Supabase を使わない方針なら、Neon + Better Auth の自前運用（G）が現実的な選択肢だが、運用責任が増える（6.6）。Neon Auth（F）は、漏洩検知・captcha・レート制限のプラグインが使えず、パスワード最小長の設定可否が不明。
7. **Neon には東京リージョンがない**（最寄りはシンガポール）。F・G・L・M を選ぶ場合は、Workers からの往復遅延の実測が必要（4.4）。
8. AWS 系の構成は除外した（付録 A）。D1 系（C・D・E）は、どのコスト前提でも下位。

### 1.2 構成の一覧

| 構成 | 内容 | 月額 | 追加作業（⚠️）| 採点（基本）| 一言 |
|---|---|---:|---|:-:|---|
| A | 現行仕様（現行運用）| $60〜130 | 0 | 3.40 | 仕様に最も忠実。コストが高め |
| H | A の縮小運用（Railway は本番のみ常駐）| $46〜77 | 数日 | 3.65 | 仕様をほぼ変えずに下げる。最も安定 |
| I | Railway → Fly.io、Supabase 縮小 | $39〜63 | 約 1〜2 週間 | 4.00 | Railway より安い。東京価格・メモリは未確認 |
| J | Railway → Render、Supabase 縮小 | $68〜77 | 約 1〜2 週間 | 3.60 | I より高い |
| B | Workers + Hyperdrive + Supabase PG + Supabase Auth | $31〜40 | 約 1.5〜3 週間 | 3.50 | 最安クラスで DB の保証も維持 |
| K | B の認証を Better Auth に替える | $31〜40 | 約 2.5〜5 週間 | 3.20 | B に劣る（コスト利点なし）|
| C | Workers + D1 + Supabase Auth | $31〜40 | 約 3〜6 週間 | 2.70 | B に対するコスト利点なし |
| D | Workers + D1 + Hono 自作認証 | 約 $5〜10 | 約 6〜11 週間 | 2.60 | 非推奨 |
| E | Workers + D1 + Better Auth | 約 $5 | 約 4〜8 週間 | 3.30 | D1 の難しさが残る |
| F | Workers + Hyperdrive + Neon + Neon Auth | $26〜40 | 約 2〜4.5 週間 | 3.35 | 認証プラグインの制約、東京リージョンなし |
| G | Workers + Hyperdrive + Neon + Better Auth | $26〜40 | 約 2.5〜5 週間 | 3.55 | Supabase を使わない場合の第一候補 |
| L | Workers + Hyperdrive + Neon + Supabase Auth | $51〜61 | 約 2〜3.5 週間 | 2.95 | Supabase Pro が別に要り、割高 |
| M | Workers + Hyperdrive + Neon + Clerk Pro | $46〜61 | 約 2.5〜5 週間 | 3.10 | Clerk の未確認項目が多い |

## 2. 現在の設計の整理（📐 SPEC-010 / 060 / 100 / 140 / 180）

### 2.1 スタック

| 領域 | 採用技術 |
|---|---|
| 言語・構成 | TypeScript、pnpm workspaces（Node 24）、Biome |
| Web | Next.js 16 / React 19 / App Router / Tailwind 4 / shadcn 系（Vercel） |
| API | Hono + Hono RPC + Zod（Railway） |
| DB | Supabase PostgreSQL 17、Drizzle ORM、`pg` |
| 認証 | Supabase Auth |
| 決済 | Stripe Checkout / Webhook（restricted key、API version 固定） |
| メール | Resend + React Email |
| テスト | Vitest、Playwright |
| 運用補助 | Better Stack、Healthchecks.io、Cloudflare R2（論理バックアップ） |

Railway には API・Email Worker・Reconciliation Worker を独立サービスとして置く。replica は本番 2 / staging 1 / development 1 / test 1（SPEC-180 §16）。

### 2.2 Supabase の役割

- **Supabase Auth**: ログイン、メール確認、パスワード再設定、セッション。注文・チケット・権限は持たない。API が access token を JWKS で検証する。有効期間は 900 秒（SPEC-140 SEC-AUTH-004）。
- **Supabase PostgreSQL**: 業務データの唯一の正本。業務テーブルは `app` schema（`app.*` が 30 テーブル）。アクセスは Hono API のみ。RLS は採用せず、GRANT による server-only access（SPEC-100 §53、SPEC-140）。
- Storage / Realtime / Edge Functions / PostgREST は業務に使わない。

### 2.3 DB 接続・運用ルール

- direct connection（5432）のみ、`sslmode=verify-full`（ローカル loopback のみ例外）。transaction-mode pooler は使わない（INF-DB-004）。
- DB role を用途別に分離（`app_api_runtime` / `app_email_runtime` / `app_reconciliation_runtime` / `app_migrator` / incident・audit・backup 用 reader など。SPEC-180 §22）。
- extension `pgcrypto` と `btree_gist` 必須。`btree_gist` はアプリ側チェックへ代替しない（DB-MIG-001）。
- 接続時に session 設定（UTC、`application_name`、`statement_timeout`、`lock_timeout`）を行う（SPEC-180 §21）。
- migration の正本は `packages/db/migrations/`。advisory lock で 1 環境同時 1 件（SPEC-180 §24）。
- 本番の接続数予算は 40（API 16 / Email 8 / Recon 8 / 予備 8）。
- 4 環境（production / staging / development / test）は Supabase project も認証情報も完全分離。

### 2.4 実装の現状

- `payment/integration` に slice 12（DB 基盤: pool、transaction runner、readiness、migrator、role bootstrap、migration 0001）がある。`main` には未マージ（確認時点の `main` は PR #7 のマージ後）。
- `apps/api`、`apps/reconciliation-worker` は `.env.example` のみ。Email Worker は未着手。`apps/web` は UI mock。

## 3. 比較する構成

### 3.1 構成の一覧

| 構成 | 実行基盤（API・Worker）| DB | 認証 | 運用 | 旧称（旧版・会話中）|
|---|---|---|---|---|---|
| A | Railway | Supabase PG | Supabase Auth | 現行 | 構成 A、① |
| H | Railway（本番のみ常駐）| Supabase PG | Supabase Auth | 縮小 | A-lite |
| I | Fly.io（本番のみ常駐）| Supabase PG | Supabase Auth | 縮小 | H（Fly.io）|
| J | Render（本番のみ常駐）| Supabase PG | Supabase Auth | 縮小 | R |
| B | Workers + Hyperdrive | Supabase PG | Supabase Auth | 縮小 | 構成 B、④ |
| K | Workers + Hyperdrive | Supabase PG | Better Auth（自前）| 縮小 | B+BA |
| C | Workers | D1 | Supabase Auth | 縮小 | 構成 C、② |
| D | Workers | D1 | Hono で自作 | — | ③ |
| E | Workers | D1 | Better Auth（自前）| — | ⑦ |
| F | Workers + Hyperdrive | Neon PG | Neon Auth | — | ⑨ |
| G | Workers + Hyperdrive | Neon PG | Better Auth（自前）| — | ⑩ |
| L | Workers + Hyperdrive | Neon PG | Supabase Auth | — | N+S |
| M | Workers + Hyperdrive | Neon PG | Clerk Pro | — | N+C |

- 共通: Next.js は Vercel、決済は Stripe、メールは Resend、論理バックアップは R2 のまま。B〜G・K〜M では Hono の API と Worker を Workers に移す。
- 旧版の「案 D（認証も置き換え）」は、D〜G に分けて扱う。
- 除外した AWS 系の構成（Cognito + SES、RDS）は付録 A に記録した。
- 実装の進捗やコミット状況は考慮しない。仕様を現行のまま基準にした比較で、作業量は仕様・設計の変更量にもとづく相対的な目安 ⚠️。

### 3.2 staging・dev の運用前提

コストの大きな要因が staging・dev の持ち方のため、2 つの前提を分けて扱う。

| 運用 | 内容 | 適用する構成 |
|---|---|---|
| 現行 | 本番 6 + staging 3 + dev 3 の計 12 インスタンスを常駐。staging・dev は別の有料 Supabase project（各 約 $10）| A |
| 縮小 | 本番 6 のみ常駐。staging・dev は使う時間だけ起動する。Supabase は dev をローカル（Supabase CLI）、staging を使う時間だけ動かす（一時停止、またはブランチ）| H〜K、C |

縮小運用の費用の根拠は 8.1・8.2。dev のローカル化が仕様（SPEC-180 の環境定義）と合うかは未確認 ⚠️。D・E・F・G・L・M は、Workers の込み分と Neon のブランチ（ゼロスケール）で、もともと縮小運用に近い。

## 4. 技術的な事実（✅ 公式）

### 4.1 D1

| 項目 | 内容 | 出典 |
|---|---|---|
| transaction | `batch()` が transaction の単位。「バッチされた文は SQL transaction」で、失敗すると全体がロールバックされる。D1 は auto-commit で動く。`BEGIN`/`COMMIT`/`SAVEPOINT` と対話的 transaction の記載は確認できなかった | ✅[S3] |
| 並行性 | 1 DB は単一スレッドで 1 クエリずつ処理。1ms のクエリで約 1,000 件/秒、100ms で約 10 件/秒。上限超過で overloaded エラー | ✅[S2] |
| 容量・上限 | 1 DB 10GB（引き上げ不可）、1 invocation あたりのクエリ 1,000（Paid）、バインドパラメータ 100/クエリ、文の長さ 100KB、行サイズ 2MB、クエリ時間 30 秒 | ✅[S2] |
| 料金 | Workers Paid に含まれる分: 読み取り 250 億行/月、書き込み 5,000 万行/月、ストレージ 5GB。超過は $0.001/百万行（読み取り）、$1.00/百万行（書き込み）、$0.75/GB-月。egress 無料 | ✅[S1] |
| SQL 機能 | 外部キー対応（`PRAGMA foreign_keys`）、`PRAGMA defer_foreign_keys` で transaction 終了時まで検証を遅延できる。FTS5・JSON 拡張・数学関数に対応 | ✅[S4] |
| 制約の追加 | SQLite に `ADD CONSTRAINT` はなく、既存テーブルに CHECK / FOREIGN KEY / NOT NULL / UNIQUE を足すには 12 手順のテーブル再作成が必要（新テーブル作成→コピー→旧テーブル削除→リネーム） | ✅[S26] |
| トリガー | SQLite は `BEFORE INSERT` トリガー内の `SELECT RAISE(ABORT, ...)` で挿入を拒否できる | ✅[S27] |
| migration | `wrangler d1 migrations apply` は失敗した migration をロールバックし、直前の成功分を維持する。履歴は `d1_migrations` テーブル | ✅[S7][S22] |
| バックアップ | Time Travel は Paid で 30 日、Free で 7 日。復元は**データベース全体を上書きする破壊的操作**。30 日超の保持は Workflows で R2 へ export する方法が示されている | ✅[S6] |
| export | `wrangler d1 export`。**実行中は他のリクエストをブロックする**。virtual table を含む DB は export 不可。数値は JavaScript の 52 bit 精度（大きな int64 は精度が落ちる） | ✅[S5] |
| 外部からのアクセス | REST API でも SQL を実行できるが、公式は「制御面の API」と位置づけている。Cloudflare API 全体でトークンあたり 1,200 リクエスト/5 分。超えると 5 分間すべての API 呼び出しがブロックされる | ✅[S8][S9] |
| アクセス権限 | API トークンの D1 権限は「D1 Read」と「D1 Edit」で、アカウント単位。1 つの DB に絞れるかはドキュメントで確認できなかった。binding の読み取り専用モードの記載も確認できなかった | ✅[S10] ⚠️ |
| Drizzle | `drizzle-orm/d1` で完全対応と明記 | ✅[S28] |

### 4.2 Workers / Durable Objects / Hyperdrive

| 項目 | 内容 | 出典 |
|---|---|---|
| Workers の上限（Paid） | CPU 時間: HTTP は最大 5 分（既定 30 秒）。Cron は間隔が 1 時間未満で 30 秒、1 時間以上で 15 分。Cron / Queue consumer / DO alarm の wall time は 15 分。メモリ 128MB。subrequest 10,000/invocation。Cron Trigger 250/アカウント | ✅[S11] |
| Workers の料金 | $5/月、リクエスト 1,000 万/月と CPU 3,000 万 ms/月を含む。超過はリクエスト $0.30/百万、CPU $0.02/百万 ms | ✅[S12] |
| Cron | 式は 5 フィールドで、例示されている最短は毎分（`* * * * *`）。UTC で実行 | ✅[S13] |
| Durable Object alarm | 1 object に 1 つ。at-least-once。例外時は 2 秒から指数 backoff で最大 6 回再試行 | ✅[S14] |
| DO の SQLite transaction | SQLite-backed DO では `transactionSync(callback)` が使える（同期のみ）。`sql.exec()` で `BEGIN TRANSACTION` / `SAVEPOINT` は実行できない。point-in-time recovery（30 日）対応 | ✅[S15] |
| DO の上限・料金 | 1 object あたり 10GB（Paid）、1 object の処理は単一スレッドで、1,000 リクエスト/秒が目安（soft limit）。Paid に含まれる分: リクエスト 100 万/月、400,000 GB-s、読み取り 250 億行、書き込み 5,000 万行。alarm の起動はリクエストとして計上 | ✅[S16][S17] |
| Hyperdrive | **transaction mode** のプーリング。接続返却時に `RESET` されるため、`SET` は接続をまたいで持続しない。advisory lock に関する記載は確認できなかった | ✅[S18] |
| Hyperdrive の料金 | Paid プランでクエリ無制限、追加料金なし（Free は 10 万クエリ/日） | ✅[S19] |
| Node 互換 | `nodejs_compat` で Buffer / Crypto / Net / Process / Web Crypto などが完全対応。`child_process` などは stub | ✅[S20] |

### 4.3 決済・メール

| 項目 | 内容 | 出典 |
|---|---|---|
| Stripe SDK | stripe-node の `exports` に `workerd` / `worker` 条件があり、Workers 用ビルドが提供されている。Webhook は `constructEventAsync` / `verifyHeaderAsync`（非同期版）が提供されている。署名検証に raw body が必須 | ✅[S44][S45][S46] |
| Resend | Cloudflare Workers 向けガイドがあり、Resend SDK と React コンポーネント（`react:`）による送信が示されている | ✅[S47] |

### 4.4 PostgreSQL の提供元（Neon）

| 項目 | 内容 | 出典 |
|---|---|---|
| リージョン | 米国東部（バージニア・オハイオ）、米国西部（オレゴン）、フランクフルト、ロンドン、シンガポール、シドニー、サンパウロ。**東京はない**。Azure は新規作成不可。Postgres と Neon Auth は上記すべてで動く | ✅[S50] |
| バージョン・拡張 | PostgreSQL 17 で `btree_gist` 1.7 に対応。EXCLUDE 制約は実現できる | ✅[S51] |
| Workers からの接続 | HTTP（セッションなし、非対話的な `sql.transaction()`）と、WebSocket の `Pool`（1 リクエスト内で作成して閉じる）。Hyperdrive 経由は Cloudflare 公式に Neon 用の手順がある（プールなしの直接接続文字列、`pg` 8.16.3 以上、`nodejs_compat`。Neon serverless driver は使わない）| ✅[S52][S54] |
| 計算 | 最小 0.25 CU（RAM 約 1GB、共有計算）、自動スケールは最大 16 CU。ゼロスケールは 5 分で停止し、復帰に数百ミリ秒かかる | ✅[S53] |
| 影響 | 仕様にはデータベースのリージョンの指定も、数値のレイテンシ目標もない 📐。業務 transaction（16 種）は複数文の往復を含むため、Workers → Hyperdrive → シンガポールの往復遅延が積み上がる。**実測が必要** ⚠️。個人情報の保管場所が国外になる点は、運営の方針として確認が要る（法的な判断は本書の範囲外）。現行の Supabase のリージョンは仕様に記載がなく、実際の設定は未確認 ⚠️ | 📐 ⚠️ |

プランと料金は 8.1、認証（Neon Auth）は 6.5 を参照。

## 5. D1 移行の技術課題

### 5.1 現仕様との衝突点

| # | 現仕様の前提（📐） | D1 での扱い | 影響 |
|---|---|---|---|
| 1 | 業務 transaction は 16 種（SPEC-100 §48）。全て `READ COMMITTED` + 明示的な行ロック（`FOR UPDATE` が SPEC-100 に約 30 箇所）。「読む→判断→書く」の流れ | 行ロックがなく、transaction は `batch()`。判断を SQL（条件付き UPDATE、`INSERT ... SELECT ... WHERE`）へ押し込む | 16 種の設計やり直しと並行テストでの再証明 |
| 2 | カラオケ枠の重複排除は `EXCLUDE USING gist`（`[usage_start, cycle_end)` の重複禁止）。SPEC-100 §28.1、DB-MIG-001、INV-010-04 | EXCLUDE 制約がない | 下記 4.1 を参照 |
| 3 | SPEC-100 §58「Business state transition を DB trigger に隠さない」。重要な不変条件は CHECK / UNIQUE / FK / EXCLUDE / partial unique と行ロックで守る | トリガーを使えば重複拒否は書ける ✅[S27] | トリガーは方針に反するので、不変条件ガード用のトリガーを認める仕様改訂が必要 |
| 4 | 制約の段階導入は `NOT VALID` → `VALIDATE CONSTRAINT`、index は `CREATE INDEX CONCURRENTLY`（SPEC-100 §60）。既存データへの制約追加は事前スキャン後に有効化（§61） | `NOT VALID` / `CONCURRENTLY` がなく、制約追加はテーブル再作成 ✅[S26] | migration 方針（§60〜§61）の改訂。再作成は FK の一時無効化（`defer_foreign_keys`）と組み合わせる |
| 5 | DB role と GRANT による最小権限（`app_api_runtime`、`app_audit_purger` など、SPEC-180 §22、SPEC-140） | role / GRANT の概念がない。API トークンはアカウント単位の Read / Edit のみ ✅[S10] | Worker ごとの binding 分離とコードでの制御に格下げ（5.4） |
| 6 | 型: `timestamptz`、`bytea`、`jsonb`、uuid（`gen_random_uuid`）、生成列（`hold_expires_at = acquired + interval '45 minutes'`）、`transaction_timestamp()` 既定値 | SQLite の型。日時は文字列か整数、interval 演算は `datetime()` などで書き換え | 全 30 テーブルの型設計の見直し。Drizzle は `sqliteTable` へ |
| 7 | SQLSTATE `40001` / `40P01` で標準リトライ、`23505` / `23P01` で制約違反を分類（SPEC-150 REL-DB-001、SPEC-100 §46） | SQLSTATE がない | エラー分類表の作り直し |
| 8 | Email の claim は `FOR UPDATE SKIP LOCKED`、Reconciliation は `pg_try_advisory_lock()`（SPEC-180 §33〜§34） | どちらもない | lease 方式の条件付き UPDATE へ |
| 9 | Email Worker / Reconciliation Worker は Railway の常駐プロセス（15 秒 tick）。SIGTERM で 20 秒 drain（SPEC-180 §17） | Cron は最短毎分 ✅[S13]。常駐プロセスと SIGTERM がない | Durable Object alarm 等へ作り直し（5.3） |
| 10 | `pg_dump` → 暗号化 → R2 に毎日、35 日 + 月初 400 日保持。月次で PG17 へ restore 演習（SPEC-180 §64〜§66） | `wrangler d1 export` は実行中に DB をブロックする ✅[S5]。Time Travel は全体上書きの復元 ✅[S6] | 自作の export ジョブ。restore 演習の手順を作り直し |
| 11 | テストは実 PostgreSQL 17 で並行性を検証。G2 db-migration / G3 db-integration / G10 hot-concurrency（SPEC-170） | ローカルは workerd の D1 | テスト基盤の再設計。staging の実 D1 での検証が必須 |

### 5.2 カラオケ枠の重複排除の代替案

- **トリガー（`BEFORE INSERT/UPDATE` で重複を検査し `RAISE(ABORT)`）**: 実現できる ✅[S27]。ただし SPEC-100 §58 の方針変更が前提。D1 は書き込みが直列なので競合しない。
- **固定グリッド + UNIQUE**: 標準 Slot は `usage_start(n) = window_start + 20分 × n` で生成される 📐（SPEC-090）。`window_start` は任意で、Admin による時刻編集（API-ADM-KRK-006 など）もあるため、全 Scope・全 window で 20 分境界を揃える制約を仕様に入れない限り、UNIQUE だけでは重複を防げない。
- どちらも SPEC-090 / 100 の MAJOR 改訂が必要。

### 5.3 実行基盤の作り直し

| 現設計 | Workers 側の代替 | 確認できたこと |
|---|---|---|
| Hono API（Railway） | Workers 上の Hono | Hono 自体は Workers で動く ⚠️。`process.env`、`pg` pool、SIGTERM 処理は書き換え。Node 互換は広い ✅[S20] |
| 15 秒 tick の常駐 Worker | Durable Object alarm（自己再スケジュール） | 1 object に alarm は 1 つ、at-least-once、失敗時は指数 backoff で再試行 ✅[S14]。alarm の wall time は 15 分 ✅[S11] |
| Email のキュー | Queues または lease 方式の条件付き UPDATE | ⚠️ |
| 結果不明の Provider 呼び出しの扱い（INF-RWY-005） | Provider 呼び出し前に追跡行を書く設計を厳守 | Workers には SIGTERM の drain 相当がなく、中断を前提にする ⚠️ |
| Stripe / Resend | Workers 用のビルドと非同期署名検証 | ✅[S44][S45][S47] |
| Secret | Workers Secrets | ⚠️（本調査では未確認） |

**alarm tick の課金の目安**（⚠️ 計算）: 15 秒 tick は 1 つの alarm あたり約 17 万リクエスト/月。Email と Reconciliation の 2 つで約 35 万/月。3 環境（production / staging / development）で約 104 万/月となり、Paid の込み分（100 万/月）にほぼ収まる。超過しても $0.15/百万リクエスト ✅[S16] で、影響は小さい。

### 5.4 既存サービスの組み合わせでカバーできない範囲

5.1 の衝突点のうち、サービスを組み合わせても代替が効かない、または効きにくいものを整理する。

| 項目 | 状況 | 緩和策と限界 |
|---|---|---|
| テーブル単位の最小権限（衝突点 5） | 現設計は DB role で API・Reconciliation・audit を分離している。D1 は role 概念がなく、API トークンはアカウント単位の Read / Edit ✅[S10]。1 つの DB に絞れるかは確認できなかった ⚠️ | Worker ごとの binding 分離、audit 用の別 D1、UPDATE / DELETE を拒否するトリガー（SPEC-100 §58 の方針改訂が必要）で緩和できる。「DB が権限で拒否する」から「コードが守る」への格下げで、**代替が効かない** |
| 一般利用者向けの認証 | Cloudflare Access はアプリへのアクセス制御で、顧客向けの会員登録・メール/パスワード・パスワード再設定の記載は確認できなかった ✅[S21]。Cloudflare 単体では代替にならないと判断 ⚠️ | Supabase Auth を残すか、第 6 章の代替を使う |
| 行ロック前提の処理の再証明（衝突点 1）| 16 種の transaction を SQL に書き直し、並行テストで二重販売・二重確定が起きないことを証明する作業が必要 | Durable Objects の `transactionSync` で対話的な処理を直列に書ける ✅[S15] が、DB が D1 ではなくなり、object をまたぐ transaction はできない ⚠️ |
| 宣言的制約と型（衝突点 2・6）| EXCLUDE、`tstzrange`、interval 演算の生成列がない。営業日の JST 扱いもアプリ側の責務 | トリガーまたはアプリ側（5.2） |
| DB 側のタイムアウトと負荷制御 | D1 のクエリ時間は 30 秒固定 ✅[S2]。SPEC-150 の DB ロック待ち 1 秒などは DB 側で設定できない。販売開始直後の集中アクセスは overloaded エラーになり得る ✅[S2] | アプリ側のタイムアウトとリトライ |
| バックアップ要件（衝突点 10）| export が DB をブロックし ✅[S5]、Time Travel は全体上書き ✅[S6]。SPEC-180 §64〜§66 の保持期間と restore 演習の手順を再設計する必要がある | 自作ジョブ。30 日超は Workflows で R2 へ export する方法が公式に示されている ✅[S6] |
| Hyperdrive 経由（構成 B・F・G）の session 状態 | Hyperdrive は transaction mode で、`SET` が接続をまたいで持続しない ✅[S18]。SPEC-180 §21 の session 設定（`statement_timeout`、`lock_timeout` など）と、`pg_try_advisory_lock`（session 単位）が前提どおりには使えない | transaction 内の `SET LOCAL` や `pg_try_advisory_xact_lock`、lease 方式への変更。advisory lock の可否は公式で確認できなかった ⚠️ |

## 6. 認証

### 6.1 仕様の要件（📐 SPEC-060 / 120 / 140）

| 区分 | 要件 |
|---|---|
| 方式 | メール+パスワードのみ。ソーシャルログイン、MFA、パスキーは仕様にない。ステップアップ認証も本版では不要（SEC-AUTH-014）|
| メール確認・再設定 | メール確認が必須（AR-AUTH-003〜005）。パスワード再設定、失効つきのログアウト |
| トークン | アクセストークンの寿命は 900 秒以下（SEC-AUTH-004）。API は毎リクエスト JWKS で JWT を検証し、iss・aud・exp・nbf・sub を確認、`alg=none` を拒否、JWKS の URL はサーバー設定のみから取得（SEC-AUTH-001/002）|
| Cookie・保管 | セッション Cookie は Next.js サーバー側で扱い、トークンを localStorage に置かない（SEC-AUTH-007/008）|
| パスワード | 12〜128 文字、構成規則なし。漏洩パスワード検知とボット対策は、提供元に機能があれば使う（SEC-AUTH-016/017/019）|
| 資格情報の分離 | パスワードや資格情報を業務 DB に置かない（AR-SES-001、AR-AUTH-011、SEC-AUTH-006）。業務 Profile は認証の subject と 1:1（`auth_subject`）。ロールは業務 DB が持ち、認証側のメタデータに置かない |
| メール | 認証メール（確認・再設定）は認証提供元の責務。Email Worker は、subject からメールと検証状態をサーバー側で引く（SPEC-120 §15、EML-RCP）|
| 障害時 | 認証の障害時は fail closed |

### 6.2 認証サービスの確認結果（AWS 系を除く）

| サービス | 料金・無料枠 | 確認できた機能・仕様 |
|---|---|---|
| Supabase Auth | Free 5 万 MAU、Pro は 10 万 MAU まで込みで超過は $0.00325/MAU ✅[S35] | 漏洩パスワード保護は Pro 以上 ✅[S35]。JWKS（`/auth/v1/.well-known/jwks.json`）でローカル検証でき、非対称署名鍵が必要。共有秘密（HS256）の project は `/auth/v1/user` への問い合わせが推奨される。JWKS は 10 分キャッシュ ✅[S33] |
| Clerk | Hobby は無料で 5 万 MRU（独自ドメイン込み、ブランド表示あり）。Pro は $20（年払い）/ $25（月払い）で、MFA・セッション寿命の変更・ブランド削除が加わる。超過は $0.02/MRU ✅[S89] | トークンの `exp` は Dashboard の JWT テンプレートで設定する。JWKS は `/.well-known/jwks.json` で公開され、`azp` の検証が必要 ✅[S90][S91]。既定の寿命、パスワード長・漏洩検知・メールのカスタム・`sub` からのメール引き当ては確認できなかった ⚠️ |
| Auth0 | Free 2.5 万 MAU。Essentials は 500 MAU で $35/月 ✅[S93] | Free ではカスタム SMTP が使えず、既定のメール送信は「テスト用」（10 通/分、From 固定、テンプレート変更不可）✅[S92][S93]。アクセストークン寿命は既定 24 時間、上限 30 日（下限の記載なし）✅[S94]。漏洩検知は Free では不可 |
| GCP Identity Platform | メール+パスワードは Tier 1 で、5 万 MAU まで無料、超過は $0.0055/MAU ✅[S95][S96] | トークン寿命、漏洩検知、メールのカスタムは確認できなかった ⚠️ |
| WorkOS AuthKit | 100 万ユーザーまで無料。独自ドメインは $99/月。Radar（ボット対策）は別料金 ✅[S95][S96] | トークン寿命などは確認できなかった ⚠️ |
| Firebase Auth | — | 公式のセッション Cookie 管理ページに ID トークン寿命の記載がなく、確認できなかった ✅[S97]。SEC-AUTH-004 との適合は不明 ⚠️ |
| Better Auth | ライブラリは無料（MIT）。マネージドの Infrastructure は Starter $0 / Pro $20 ✅[S73][S74] | 6.5 を参照 |
| Neon Auth | 全プランに含まれる。Free 6 万 MAU、Launch・Scale は 100 万 MAU ✅[S55] | 6.5 を参照 |

評価の要点:

- **コスト**: 現構成（DB も Supabase）なら Supabase Auth の追加費用は実質 0。DB を Cloudflare へ移す構成 C では、Auth のためだけに Supabase Pro $25 が必要になる（漏洩パスワード検知が Pro 以上のため）。Auth0 は Free だと本番運用に向かず、WorkOS は独自ドメインに $99/月かかる。
- **実装・移行工数**: Supabase Auth は仕様がすでにこれを前提にしており、変更はない。他へ移す場合は、SPEC-060 のログイン処理、SPEC-010 のブラウザ直接通信の例外、SPEC-120 の宛先解決、JWT 検証の設定を改める。公開前なのでユーザー移行は不要。
- **ロックイン・運用**: Supabase Auth は PostgreSQL 上にあり、データを持ち出しやすい。Clerk は実装が速い一方で SaaS 依存が増える。

### 6.3 実用的な 4 候補の要件適合

仕様の要件（6.1）に対し、Supabase Auth（A・B・C）、Better Auth（E・G）、Neon Auth（F）、Hono 自作（D）を比べる。

| 要件 | Supabase Auth | Better Auth（自前運用）| Neon Auth | Hono 自作 |
|---|---|---|---|---|
| 寿命 900 秒以下の JWT | 設定可 | 既定 15 分（= 900 秒）、`jwt.expirationTime` で変更可 ✅[S66] | 15 分固定で変更不可 ✅[S58] | 自前（Hono の JWT で発行）✅[S86] |
| JWKS の公開 | 非対称署名鍵が必要 ✅[S33] | `/api/auth/jwks`、EdDSA 既定。鍵ローテーションは既定オフ ✅[S66] | `<URL>/.well-known/jwks.json`、EdDSA ✅[S58] | 自前で公開 |
| パスワード長 12〜128 | 最小長を設定可 | 既定は最小 8・最大 128。設定で 12 にできる ✅[S65][S79] | 最大 128 のみ記載。最小長は不明 ✅[S63] ⚠️ | 自前 |
| メール確認・再設定 | あり | `requireEmailVerification`、再設定トークンは既定 1 時間 ✅[S65] | メール確認は既定オフ。確認リンクは独自 SMTP が必須 ✅[S56] | 自前 |
| 漏洩パスワード検知 | Pro 以上 ✅[S35] | `haveIBeenPwned` プラグイン ✅[S69] | プラグイン非対応 ✅[S60] | HIBP の API を自前で呼ぶ（無料・API キー不要 ✅[S88]）|
| ボット対策 | 未確認 ⚠️ | captcha プラグイン（Turnstile など）✅[S72] | プラグイン非対応 ✅[S60] | Turnstile（Free は検証無制限）✅[S25] |
| レート制限 | 未確認 ⚠️ | 組み込み。サーバーレスでは永続ストレージが必要 ✅[S67] | プラグイン非対応（組み込みの有無は不明）✅[S60] ⚠️ | Rate Limiting binding または Durable Objects ✅[S24] |
| 認証メールの文面 | 可 | 自前で送信（`sendVerificationEmail` など）✅[S65] | webhook で自前送信 ✅[S59] | 自前 |
| subject からのメール引き当て | Admin API | admin プラグインは admin 権限のヘッダが必要。自分の DB を読み取り専用ロールで直接参照する案もある ✅[S70] ⚠️ | `neon_auth` スキーマを直接参照する案 ⚠️。管理 API に一覧・取得の記載なし | service binding |
| 業務 DB からの資格情報の分離 | 提供元が管理 | `account` テーブルにパスワードが入る ✅[S64]。別 DB / スキーマに分ける | `neon_auth` スキーマが同じ DB に入る ✅[S55]。解釈または分離が必要 | 別の D1 を使う |
| 運用責任 | 提供元 | **自前**（6.6）| 提供元（開発は活発）| **全面自前** |
| 料金 | Supabase Pro に込み | 無料（Infrastructure Pro は $20）| 全プランに含まれる | 無料 |
| Workers との相性 | JWKS 検証のみ | `nodejs_compat` または `nodejs_als` が必要 ✅[S84] | JWKS 検証 + webhook を受ける Worker | Web Crypto で実装 |

### 6.4 Hono での自作認証の設計案（構成 D）

本節は**設計案**であり、仕様でも確認済みの事実でもない。事実は ✅ と出典で示す。

```
Browser
  └─ Next.js (Vercel)  ← セッション Cookie は Next.js サーバーが管理（SEC-AUTH-007/008）
        ├─ Business API Worker (Hono) ── D1: business-db
        │     ├─ JWT 検証のみ（JWKS の URL は設定固定）
        │     └─ Service binding ──┐
        └─ Auth Worker (Hono) ←────┘
              ├─ D1: auth-db（この Worker だけが binding を持つ）
              ├─ Workers Secrets: JWT 署名鍵
              ├─ Resend: 確認・再設定メール
              └─ /jwks, /signup, /verify, /login, /refresh, /logout, /reset
```

- 業務 DB と認証 DB を別の D1 データベースにし、binding を分ける。AR-AUTH-011・SEC-AUTH-006 は、DB ロールではなく binding の分離で満たす。
- Email Worker の宛先解決（SPEC-120）は、Supabase Admin API の代わりに Auth Worker への service binding を使う。
- Better Auth（E・G）を使う場合も、この Auth Worker の実装を Better Auth に置き換えるだけで、構成は同じ。

認証 DB のテーブル案:

| テーブル | 主な内容 |
|---|---|
| `users` | id（業務側の `auth_subject`）、正規化メール、メール確認日時、パスワードハッシュとパラメータ、無効化日時 |
| `email_tokens` | 確認・再設定用トークンのハッシュ、用途、期限、使用済み日時 |
| `refresh_tokens` | family_id、トークンのハッシュ、期限、失効日時、置換先 |
| `audit_log` | ログイン成否、再設定、失効 |

処理の流れ:

1. サインアップ: 12〜128 文字（SEC-AUTH-016）を検証し、ハッシュ化して保存、確認メールを送る。
2. ログイン: ハッシュを検証し、アクセストークン（JWT、900 秒以下）と不透明なリフレッシュトークンを発行する。
3. リフレッシュ: ローテーションし、使用済みトークンの再利用を検知したら family ごと失効させる。D1 の対話的トランザクションは公式に確認できていない ✅[S3] ため、条件付き `UPDATE` の変更行数で競合を判定する案とする。変更行数の取得方法は未確認 ⚠️。
4. ログアウト: リフレッシュトークンを失効し、Next.js 側の Cookie を削除する。
5. API 呼び出し: 業務 Worker が JWT を JWKS で検証する。

部品ごとの確認結果:

| 部品 | 確認できた事実 | 判断 |
|---|---|---|
| JWT 検証（Hono JWK ミドルウェア）| `alg` は非対称アルゴリズムの許可リストが必須で、対称アルゴリズムは拒否。`jwks_uri` で鍵を取得できる。`exp`・`nbf`・`iat` は既定で検証するが、**`iss` と `aud` は設定したときだけ検証する** ✅[S85] | SEC-AUTH-001 の iss・aud 検証を満たすには `verification` の設定が必須 |
| JWT 発行（Hono JWT）| HS256、RS256、PS256、ES256、EdDSA など多数に対応 ✅[S86] | 発行側の実装は可能 |
| 署名・鍵（Workers Web Crypto）| PBKDF2 の `deriveBits`、Ed25519、ECDSA、HMAC に対応。PBKDF2 の反復回数の上限は記載なし ✅[S23] | JWT 署名は可能。反復回数の実用上限は spike で測る ⚠️ |
| パスワードハッシュ | OWASP の推奨: Argon2id は最小 19MiB・t=2・p=1、scrypt は最小 N=2^17（128MiB）、PBKDF2-HMAC-SHA256 は 600,000 回 ✅[S87]。Workers のメモリは 128MB（isolate 単位、WebAssembly を含む）✅[S11] | scrypt の最小構成（128MiB）は上限に収まらない。PBKDF2-SHA256 600,000 回は Web Crypto で可能。Argon2id は Web Crypto で確認できず、WASM 等が必要 ⚠️ |
| CPU 時間 | 有料プランの HTTP リクエストは既定 30 秒、最大 5 分。無料プランは 10 ms ✅[S11] | 有料プラン前提。ハッシュ処理の実測は spike で確認 |
| レート制限 | Rate Limiting binding は 10 秒または 60 秒の窓で、Cloudflare のロケーションごとの近似値。結果整合。厳密な制限は Durable Objects での実装を推奨 ✅[S24] | ログイン試行の制限は Durable Objects が必要 |
| ボット対策 | Turnstile の Free は検証回数が無制限、ウィジェットは 20 個まで ✅[S25] | 追加費用なし |
| 漏洩パスワード検知 | Pwned Passwords API は無料で、API キー不要 ✅[S88] | 仕様上は「提供元に機能があれば」の扱い（SEC-AUTH-017）。任意 |
| メール送信 | Resend の Workers 向けガイドがある ✅[S47] | 可能 |

評価: コスト 5・セキュリティ 1・機能の充足 1・実装難易度 1（第 11 章）。コストは最小だが、パスワードハッシュ、署名鍵、トークン失効、ブルートフォース対策のすべてが自分の責任になり、決済のあるアプリ全体に影響する。

### 6.5 Better Auth と Neon Auth の確認結果

**Better Auth（OSS、自前運用）**

| 事項 | 結果 |
|---|---|
| ライセンス | MIT ✅[S74] |
| Hono・Workers への組み込み | Hono に `app.all("/api/auth/*", ...)` でそのままマウントできる。Workers では `nodejs_compat`（または `nodejs_als`）が必要 ✅[S84] |
| D1 | DB は SQLite / D1 / PostgreSQL などに対応し、D1 は Kysely アダプタに分類される ✅[S64]。Kysely の任意の dialect が使え、D1 は community dialect（`kysely-d1`）として案内されている ✅[S77]。設定手順は公式ページで確認できなかった ⚠️。Workers では CLI の代わりに `getMigrations` による migration を使う ✅[S64] |
| scrypt の既定値 | N=16384、r=16、p=1、dkLen=64。Node.js / Bun / Deno は `node:crypto`、非対応ランタイムは `@noble/hashes`（純 JS）にフォールバック ✅[S75]。メモリ使用量は 128·N·r ≒ 32MiB で Workers の 128MB に収まる（導出）。ただし N×r×p は 262,144 で、OWASP の最小構成（N=2^17, r=8, p=1 = 1,048,576）の約 1/4 ✅[S87][S75]（導出）。`password.hash` / `verify` で差し替え可能 ✅[S65] |
| Cookie | 本番では `httpOnly` と `secure`、既定は `SameSite=Lax` ✅[S71][S78] |
| JWT・レート制限・セッション | JWT プラグイン: 既定は EdDSA、有効期限 15 分、JWKS は `/api/auth/jwks`、鍵ローテーションは既定でオフ、issuer / audience は既定でベース URL ✅[S66]。レート制限: 本番で既定 100 回/10 秒、メールサインインは 3 回/10 秒。既定のメモリ保存はサーバーレスに不向きで、DB・セカンダリ・独自ストレージ（カウンタの確認と加算が原子的であること）を使う ✅[S67]。セッション: 既定 7 日、失効 API あり。Cookie キャッシュを有効にすると失効の反映が遅れる ✅[S68] |
| ボット対策 | captcha プラグインが Turnstile ・reCAPTCHA・hCaptcha などに対応し、`/sign-up/email`・`/sign-in/email`・`/request-password-reset` を既定で保護 ✅[S72] |
| 漏洩パスワード検知 | `haveIBeenPwned` プラグインを標準提供（SHA-1 の先頭 5 文字のみ送信）✅[S69] |
| 管理 API | admin プラグインの `getUser`（id 指定）・`listUsers`（メール絞り込み）は、サーバー側呼び出しでも admin 権限のヘッダが必要 ✅[S70] |
| マネージド版 | Better Auth Infrastructure: Starter $0、Pro $20/月（ダッシュボード席、監査ログ 2 万件/月、セキュリティ検知 1 万件/月、メール $0.001/通、テンプレート、不正対策）。Enterprise は個別見積もり ✅[S73] |

**Neon Auth（Managed Better Auth）**

| 事項 | 結果 |
|---|---|
| 位置づけ | Better Auth のマネージド版。GA で、開発は活発。ユーザーとセッションは Neon PostgreSQL の `neon_auth` スキーマに保存される。MFA は未対応 ✅[S57][S61] |
| JWT | 有効期限 15 分で**変更不可**、EdDSA（Ed25519）、JWKS は `<NEON_AUTH_URL>/.well-known/jwks.json`、カスタムクレーム非対応 ✅[S58] |
| セッション | Cookie `__Secure-neonauth.session_token`（HttpOnly、不透明トークン）✅[S61]。セッション寿命・更新動作は記載なし ⚠️ |
| パスワード規則 | 最大 128 文字のみ記載。最小長の記載なし ✅[S63]。SEC-AUTH-016（12 文字以上）を設定で満たせるかは不明 ⚠️ |
| 対応プラグイン | Admin・JWT・Email OTP・Magic Link・Open API・Phone Number に対応、OAuth Provider はベータ、Organization は一部。**haveIBeenPwned・captcha・rate limit・bearer は対応リストにない** ✅[S60] |
| メール | 共有送信元は開発・テスト用でレート制限があり、確認リンクは使えない。確認リンクには独自 SMTP が必要で、その場合も文面は Neon の既定。文面を完全に変えるには webhook（`send.otp`・`send.magic_link`）を購読して自前の送信基盤（Resend など）から送る。ダッシュボードのテンプレート機能は未提供。メール確認は既定でオフ ✅[S56][S59] |
| webhook | 3 回まで再試行（バックオフなし、全体 15 秒）、`user.before_create` は失敗時に登録を拒否（fail closed）、署名は EdDSA の detached JWS。テストイベントと再送は未対応 ✅[S62] |
| 提供条件 | AWS リージョンのみ。**IP Allow・Private Networking を有効にしたプロジェクトでは使えない** ✅[S55]。MAU 上限は Free 6 万 / Launch・Scale 100 万。MAU 単価、超過時の課金は記載なし ✅[S55][S49] |
| 管理 API | ユーザーの作成・削除・ロール変更はあるが、一覧・取得は記載なし ✅。`neon_auth` スキーマの直接参照は可能と見られるが、スキーマ安定性の記載は確認できなかった ⚠️ |

### 6.6 Better Auth を自前運用する場合の懸念点と注意点

#### 前提となる事実

- GitHub のセキュリティアドバイザリを 4 ページ分（計 32 件）確認した ✅[S82]。一覧のページ表示は「5 ページ」とあり、1 ページ分は未取得。2026 年 4〜8 月に High と Critical が集中している。
- 多くは本構成で使わないプラグイン（SSO、SCIM、OAuth プロバイダー、Organization、API キー、Passkey、デバイス認可など）の問題である ✅[S82]。
- コアに影響した例 ✅[S82]:
  - レート制限が IPv6 プレフィックスの変更で回避できる（High、2026-05）
  - パスの二重スラッシュで `disabledPaths` とレート制限を回避できる（High、2025-12）
  - `trustedOrigins` の回避によるアカウント乗っ取り（High、2025-02）
  - メール確認エンドポイントのオープンリダイレクト（Critical、2024-12）
  - Cookie キャッシュ使用時の 2FA バイパス（High、2026-04）
- リリースは 15 日間で 8 回。取得時点の最新は v1.7.2（8 月 26 日）。v1.7.0 は破壊的変更が多く、スキーマの再生成やデータの移行が必要だった ✅[S83]。
- 本構成で使うのは、メール+パスワード、JWT、漏洩検知、captcha に絞る方針とする ⚠️。

#### セキュリティ面の懸念と対策

| 項目 | 懸念 | 対策 |
|---|---|---|
| レート制限 | 既定のメモリ保存はサーバーレスに不向き ✅[S67]。回避の脆弱性が過去に 2 件（上記）| DB かカスタムストレージ（カウンタの確認と加算が原子的なもの）を使う ✅[S67]。Cloudflare の Rate Limiting binding も重ねる（拠点ごとの近似値で結果整合 ✅[S24]）|
| クライアント IP | IP は既定で `X-Forwarded-For` から取る ✅[S78]。Vercel → Hono → 認証と中継すると、全員が同じ IP に見えて一斉にロックされる恐れ ⚠️ | `ipAddressHeaders` と `trustedProxies` を明示し ✅[S78][S79]、実クライアント IP を認証層まで渡す。Workers では `cf-connecting-ip` が使える（Better Auth の例にあり ✅[S67]）|
| Cookie キャッシュ | 失効したセッションが、キャッシュの期限まで他端末で有効なまま残る ✅[S68]。2FA バイパスの脆弱性もあった ✅[S82] | 仕様のログアウト時の失効（AR-AUTH）を満たすため、無効にするか短くする。重要操作は `disableCookieCache` を指定する ✅[S68] |
| 秘密鍵 | `BETTER_AUTH_SECRET` は 32 文字以上。本番で未設定ならエラーになる ✅[S76][S79] | `BETTER_AUTH_SECRETS`（版管理つき）でローテーションする ✅[S78][S79]。手順書とテストを用意する |
| JWT の鍵 | 鍵ローテーションは既定でオフ ✅[S66] | `rotationInterval` と猶予期間（既定 30 日）を有効にする ✅[S66]。検証側は JWKS をキャッシュしつつ、未知の `kid` で再取得する ✅[S66] |
| JWT の失効 | JWT は失効できず、ログアウト後も最大 15 分有効 ✅[S66] | SEC-AUTH-004（900 秒以下）の範囲で許容されるかを、仕様側で確認する ⚠️ |
| パスワードのハッシュ | 既定の scrypt は OWASP の最小構成より作業量が約 1/4（6.5）。非 Node ランタイムでは純 JS の実装に切り替わる ✅[S75] | `password.hash` / `verify` で強度を上げる ✅[S65]。Workers の CPU 30 秒・メモリ 128MB ✅[S11] の範囲で実測する。後から変更するなら、ログイン時の再ハッシュが要る ⚠️ |
| パスワード再設定 | `revokeSessionsOnPasswordReset` の既定は `false` ✅[S79] | `true` にして、再設定時に全セッションを失効させる |
| パスワード長 | `minPasswordLength` の既定は 8 ✅[S79] | 12 に設定（SEC-AUTH-016）。漏洩検知プラグインも入れる ✅[S69] |
| 設定ミスによる無効化 | `disableCSRFCheck`、`disableOriginCheck`、`trustedProxyHeaders` は誤用で保護が外れる ✅[S78] | 本番では使わない。`trustedOrigins` は完全一致にし、localhost を入れない ✅[S78] |
| メール列挙・タイミング | 列挙対策は `requireEmailVerification` が有効なとき、または `autoSignIn` が無効なときのみ ✅[S78]。メール送信を `await` するとタイミング差が出る ✅[S80] | `requireEmailVerification` を有効にし、送信はバックグラウンドにする（`runInBackground` / `runInBackgroundOrAwait` ✅[S81]）。Workers での `advanced.backgroundTasks` の設定は未確認 ⚠️ |
| アカウントリンクと危険機能 | リンクは既定で有効、メール変更とアカウント削除は既定で無効（削除は物理削除）✅[S80] | OAuth を使わないなら `accountLinking` を無効にする。メール変更・削除は仕様で必要になるまで無効のままにする |
| 認証情報の置き場所 | パスワードは `account` テーブルに入る ✅[S64] | 業務 DB と別の DB かスキーマに分け、ロールも分ける（AR-AUTH-011・SEC-AUTH-006）。バックアップにもハッシュが入るため、同等に機密として扱う ⚠️ |

#### 運用面の懸念と対策

| 項目 | 懸念 | 対策 |
|---|---|---|
| 更新頻度 | 15 日間で 8 リリース。v1.7.0 は破壊的変更が多い ✅[S83] | バージョンを固定し、Dependabot などで検知、staging で検証してから本番へ。クリティカルな脆弱性への対応期限（例: 48 時間）を決める ⚠️ |
| 脆弱性の検知 | 利用者側で GitHub のアドバイザリを追う必要がある ✅[S82] | 通知を購読し、受領から対応までの担当を決める |
| スキーマ管理 | CLI の `migrate` は Kysely アダプタのみ。Drizzle などは `generate` した結果を自分で適用する ✅[S64][S76]。D1 + Workers では `getMigrations` を使う ✅[S64] | SPEC-100 §60〜§61 の手順（NOT VALID / CONCURRENTLY）に合わせて、生成されたスキーマをレビューしてから適用する ⚠️ |
| D1 経由の接続（E）| D1 は community の dialect（`kysely-d1`）経由 ✅[S77]。アダプタにトランザクションがないと、after フックが、後続処理の失敗後にも走ることがある ✅[S64] | ユーザー作成とアカウント作成の途中失敗に対する整合を確認する ⚠️。PostgreSQL（G）ならトランザクションが使える |
| メール配送 | 確認・再設定のメール送信は自前の責任 ✅[S65] | 失敗時の再送、バウンス処理、日本語テンプレート、再設定メールの連打への制限を設計する ⚠️ |
| 監査・監視 | ベンダーの管理画面がない。Infrastructure Pro（$20）なら監査ログ、セキュリティ検知が付く ✅[S73] | SPEC-160 に沿った監査ログと、ログイン失敗の急増アラートを自前で作る |
| インシデント対応 | 乗っ取りが疑われたときの手順が必要 ⚠️ | 全セッション失効、JWT 署名鍵の入れ替え、強制パスワード再設定の手順書を事前に作り、演習する |
| テスト | 認証フローのテストは自前 | SPEC-170 に、認証の E2E、レート制限の回避パターン、アップグレード時の回帰テストを追加する |
| サポート | メール・Slack のサポートは Infrastructure の Enterprise のみ ✅[S73] | 一次情報は GitHub と公式ドキュメントだけ。ライセンスは MIT ✅[S74] |
| 性能・可用性 | 認証障害時は fail closed（仕様）。Neon のゼロスケールは復帰に数百ミリ秒 ✅[S53]。DB がシンガポールになる場合は往復が増える（4.4）| ログインのハッシュ処理の CPU 時間、DB の往復を実測する |
| 退出時の移行 | ハッシュ形式が Better Auth 固有 ⚠️（形式は未確認）| 他サービスへ移す際は、パスワード再設定を前提にする |

#### 優先して対応するもの

1. 使うプラグインを絞り、バージョンを固定して、更新の運用（検知・検証・期限）を決める。
2. レート制限は、永続ストレージで原子的なカウンタにし、実クライアント IP を認証層まで渡す。
3. Cookie キャッシュを無効にするか短くし、`revokeSessionsOnPasswordReset` を有効にする。
4. パスワードのハッシュ強度を上げ、Workers での実測を行う。
5. 認証情報を業務 DB から分離し、バックアップも機密として扱う。

### 6.7 認証の見立て

- **仕様への適合は Supabase Auth が最も高い。** 6.3 の確認項目のうち、メールの自由度、パスワード規則、漏洩検知、管理 API がそろっている。構成 A・B なら追加費用もない。
- **Hono 自作（D）は推奨しない。** パスワードハッシュ、署名鍵、トークン失効、ブルートフォース対策のすべてが自分の責任になる。
- **Better Auth は自作より安全側。** JWT 15 分・JWKS・漏洩検知・captcha・パスワード長の設定が標準でそろう。Supabase を使わない場合は、E（D1）より G（Neon）のほうが、D1 の難しさを避けられる。ただし 6.6 の運用責任が残る。
- **Neon Auth は運用が楽だが機能制約がある。** 漏洩検知・captcha・レート制限のプラグインが使えず、パスワード最小長（12 文字）の設定可否が不明。メールは webhook で自前送信すれば日本語化できる。
- **有料化で買えるもの**: Supabase Pro は漏洩パスワード保護とバックアップ、Neon Launch は 7 日の PITR と常時稼働（8.1）、Clerk Pro は MFA とセッション寿命の変更、Better Auth Infrastructure Pro は監査ログとセキュリティ検知。このアプリの規模では「必要な要件に応じて 1 つだけ買う」考え方が現実的 ⚠️。

## 7. Railway の代替

### 7.1 前提

- 仕様（SPEC-180）の常駐プロセス: Hono の API と Worker が本番 6、staging 3、dev 3 の計 12 インスタンス 📐。
- Worker は 15 秒 tick で動き、SIGTERM を受けて処理を終える設計 📐。
- 比較の基準となる Railway の費用は、8.2 の見積もり（12 台で $36〜84、使用量は仮定 ⚠️）。
- 「縮小運用」（3.2）では本番 6 台のみ常駐とし、staging・dev は使う時間だけ動かす。
- AWS のサービス（ECS Fargate など）は除外した（付録 A）。

### 7.2 候補の比較

料金は米国リージョン（最安）。東京リージョンの価格は取得できていない。

| 候補 | 12 台常駐 | 本番 6 台のみ常駐 | 確認できた事実 |
|---|---|---|---|
| Railway | $36〜84 | **$20〜42** | Pro $20（利用 $20 込み）、RAM $10/GB・月、CPU $20/vCPU・月。1 台は $3〜7 の仮定。6 台なら $18〜42 で、下限は Pro の込み分 $20 ✅[S37][S38]。停止中の課金は確認できていない ⚠️ |
| Fly.io Machines | $26〜44 | **$13〜22**（東京は +15〜27% の可能性があり、比較には $13〜28）| shared-cpu-1x が 256MB で $2.19/月、512MB で $3.69/月。月額のプラットフォーム料金なし、無料枠なし。停止中はルートファイルシステム分（$0.15/GB・月）のみ課金 ✅[S39]。**停止時の既定シグナルは SIGINT**。`kill_signal` で SIGTERM に変更でき、`kill_timeout` は既定 5 秒・最大 300 秒（ベストエフォート）✅[S40]。仕様の SIGTERM ドレイン（20 秒）には設定が必要。東京の価格は取得できず、1GB の例では米国 $6.70 に対し fra $7.73（+15%）、sin $8.50（+27%）✅[S39] |
| Render | $84 | **$42** | 0.5 CPU / 512MB が $7/月。ワークスペースは Hobby が $0（25 サービスまで）✅[S41]。SIGTERM を送り、猶予は既定 30 秒・最大 300 秒（永続ディスクを使うサービスは変更不可）。Background Worker もゼロダウンタイム デプロイの対象 ✅[S42]。常時稼働できるか、停止中の課金は料金ページに記載がない ⚠️ |
| Google Cloud Run（Worker pools）| 算出できない | 算出できない | 既定は vCPU あたり $0.000011244/秒、メモリ GiB あたり $0.000001235/秒（us-central1）。無料枠あり ✅[S43]。最小サイズの記載がなく、月額は算出できなかった |
| Cloudflare Workers（構成 B〜G、K〜M）| **$5** | **$5** | Workers Paid ✅[S12]。15 秒 tick は Durable Object の alarm へ作り直す（5.3）|
| VPS 1 台 + Docker | 未確認 | 未確認 | 価格の一次情報は取得していない ⚠️ |

導出: Fly 12 台 = 12 × $2.19 = $26.3 〜 12 × $3.69 = $44.3、6 台 = $13.1〜$22.1（× 1.27 = $28）。Render 12 台 = 12 × $7 = $84、6 台 = $42。Railway 6 台 = 6 × $3〜7 = $18〜42（Pro の込み分で下限 $20）。

### 7.3 解釈

- **縮小運用では、Railway と Fly.io の差は小さい。** 本番 6 台のみで比べると、Railway は $20〜42、Fly.io は $13〜28（東京の割増を見込んだ場合）で、差は月 $0〜15 程度。Fly.io は**東京の価格**、メモリ 256MB で足りるか、SIGTERM の設定の確認が要る。
- Render は 6 台でも $42 で、Railway と同等以上。Cloud Run は、常駐 Worker では安くなる見込みがない。
- 12 台常駐のまま比べると、Fly.io は Railway より月 $10〜40 安い。ただしこの差の大半は「staging・dev を常駐させない」ことで得られるもので、ホストの違いによる分ではない。
- 大きな削減は Workers への移行（構成 B〜G）で、Railway を使わなくなることによる。ただし縮小運用の Railway（H）との差は、中央値で約 $26 にとどまる。

## 8. コスト（月額、概算）

前提: 為替 $1 = ¥150。Vercel・Stripe・Resend・Better Stack は全構成で共通のため除外。Railway・Fly.io・Neon の使用量は仮定で、**実測ではない**。staging・dev の運用前提（現行 / 縮小）は 3.2 を参照。

### 8.1 料金の根拠（✅ 公式）

| サービス | 内容 | 出典 |
|---|---|---|
| Supabase | Free: 500MB、プロジェクトは 1 週間未使用で一時停止、2 project まで、バックアップなし。Pro: $25/月から、$10/月分の compute credits（Micro 1 台分）、8GB、daily backup 7 日。追加の project は compute が別課金（Micro は $0.01344/時間、約 $10/月）。**一時停止中の project は compute 使用量に数えない**。PITR は 7 日で約 $100/月（Small 以上の compute が必要）。有料プランの project は自動では一時停止されない。**ブランチは使った時間だけ課金され（Micro で $0.01344/時間）、compute credits は適用されない**。停止中のディスク課金は確認できていない ⚠️ | [S29][S30][S31][S32][S34][S36] |
| Railway | Hobby: $5/月（$5 の利用込み）、Pro: $20/月（$20 の利用込み）。RAM $10/GB/月、CPU $20/vCPU/月、egress $0.05/GB。請求は「割り当てられたリソース」に対する分単位の従量 | [S37][S38] |
| Cloudflare | Workers Paid $5/月。D1・Durable Objects・Queues の込み分は 4.1・4.2 のとおり。Hyperdrive は Paid で追加料金なし | [S1][S12][S16][S19] |
| Better Auth Infrastructure | Starter $0。Pro $20/月（ダッシュボード席、監査ログ 2 万件/月、セキュリティ検知 1 万件/月、メール $0.001/通、テンプレート、不正対策）。ライブラリ本体は無料 | [S73] |

**Neon のプラン**（✅ 公式 [S48][S49][S53]）

| 項目 | Free | Launch | Scale |
|---|---|---|---|
| 月額の最低料金 | $0 | なし | なし |
| 計算 | 100 CU 時間/プロジェクト | $0.106/CU 時間 | $0.222/CU 時間 |
| 自動スケール | 最大 2 CU | 最大 16 CU | 最大 16 CU、固定は最大 56 CU |
| ゼロスケール | 5 分で停止、無効化不可 | 5 分で停止、無効化可 | 1 分〜常時稼働 |
| 復元（PITR）の履歴 | 6 時間（変更量 1GB まで）| 最大 7 日 | 最大 30 日 |
| スナップショット | 手動 1 | 手動 100、定期バックアップあり | 手動 100、定期バックアップあり |
| ブランチ | 10 | 10（追加 $1.50/月）| 25（追加 $1.50/月）|
| ストレージ | 1GB/プロジェクト | $0.35/GB・月 | $0.35/GB・月 |
| IP Allow / 稼働率 SLA | なし | なし | あり |
| Neon Auth | 6 万 MAU | 100 万 MAU | 100 万 MAU |

- 最小の計算サイズは 0.25 CU（RAM 約 1GB、共有計算）。
- Scale の IP Allow は Neon Auth と併用できない（6.5）。Neon Auth を使う限り、Scale を選ぶ利点は PITR 30 日と SLA に限られる。
- 仕様のバックアップ要件（日次 35 日 + 月次 400 日、SPEC-180）には、Neon の PITR（最大 7 日 / 30 日）では足りない。仕様どおり `pg_dump` → R2 のジョブを続ける前提になる。

### 8.2 構成別の月額

| 構成 | 運用 | 内訳 | 月額目安 |
|---|---|---|---|
| A | 現行 | Supabase: 本番 Pro $25 + staging・dev を別の有料 project にすると各 約 $10（Free なら $0 だが、一時停止・バックアップなし）→ $25〜45。Railway: Pro $20（利用 $20 込み）。12 インスタンスで、1 インスタンスは低位（RAM 約 250MB + CPU 約 0.02 vCPU ≒ $3）〜高位（RAM 0.5GB + 0.1 vCPU ≒ $7）→ $36〜84 | **約 $60〜130**（¥9,000〜19,500）|
| H | 縮小 | Railway 本番 6 台 $20〜42 + Supabase 本番 Pro $25（Micro は credits で込み）+ staging（使う時間だけ）$1〜10 + dev（ローカル）$0 | **約 $46〜77** |
| I | 縮小 | Fly.io 本番 6 台 $13〜28（東京の割増を含む）+ Supabase $26〜35 | **約 $39〜63** |
| J | 縮小 | Render 本番 6 台 $42 + Supabase $26〜35 | **約 $68〜77** |
| B | 縮小 | Workers Paid $5（Hyperdrive 追加料金なし。DO / Queues は込み分内の見込み）+ Supabase $26〜35（PG と Auth）。staging・dev を常駐の有料 project にする場合は $30〜50 | **約 $31〜40**（¥4,650〜6,000）|
| K | 縮小 | B と同じ（PG のために Supabase Pro が必要）| **約 $31〜40** |
| C | 縮小 | Workers Paid $5（D1・DO・Queues は込み分内の見込み）+ Supabase $26〜35（Auth のみ）| **約 $31〜40** |
| D | — | Workers Paid $5。Turnstile は Free で追加費用なし ✅[S25]。メールは既存の Resend で共通費 | **約 $5〜10** ⚠️ |
| E | — | Workers Paid $5。Better Auth Infrastructure Pro（$20）を加える場合は $25〜30 | **約 $5**（Pro あり $25〜30）|
| F・G | — | Workers $5 + Neon Launch。本番は 0.25 CU を常時稼働で 182.5 CU 時間 × $0.106 ≒ $19.4、ストレージ 5GB（仮定）で $1.75。staging・dev はブランチでゼロスケールにして、使用時間分のみ（仮定で $0〜10）。合計の導出は $26〜36 だが、使用量の不確かさを見て上限を $40 とした。Neon Auth の MAU 単価は記載がなく、含めていない | **約 $26〜40** ⚠️ |
| L | — | Workers $5 + Neon $21〜31 + Supabase Pro $25（Auth のためだけ）| **約 $51〜61** |
| M | — | Workers $5 + Neon $21〜31 + Clerk Pro $20（年払い）〜$25（月払い）✅[S89] | **約 $46〜61** |

導出メモ: Neon Scale にすると本番の計算は 182.5 CU 時間 × $0.222 ≒ $40.5 で、F・G は約 $47〜になる。ゼロスケールの停止（無効化）と常時稼働とで、本番の月額に約 $19 の差が出る。ゼロスケールの復帰遅延は数百ミリ秒 ✅[S53] で、会費・チケットの処理に許容できるかは別途判断が要る。Supabase Micro を使う時間だけ動かす場合の費用は、時間 × $0.01344（例: 月 160 時間で 約 $2.2、100 時間で 約 $1.3）。

### 8.3 コスト要因と削減額

現行（A）の要因は、Railway が約 6 割（$36〜84）、Supabase が約 4 割（$25〜45）。

| 対策 | 対象 | 削減額の目安 | 備考 |
|---|---|---|---|
| ① Railway をやめて Workers へ | Railway $36〜84 → $5 | $31〜79 | 工数 約 1.5〜3 週間 |
| ① 代替: Railway の台数を本番のみにする | $36〜84 → $20〜42 | $16〜42 | 停止中の課金は未確認 ⚠️ |
| ① 代替: Fly.io へ移す（本番のみ）| $36〜84 → $13〜28 | $8〜71 | 東京価格・メモリは未確認 |
| ② staging・dev の追加 Supabase project を減らす | Supabase $25〜45 → $26〜35 | 最大 約 $19 | dev はローカル、staging は使う時間だけ停止またはブランチ |
| ③ Supabase を Neon に替える（F・G）| Supabase $26〜35 → Neon $21〜31 | 約 $0〜10 | 固定費 $25 と Neon 常時稼働 約 $21 がほぼ同じ |

- 削減の最大要因は①。Workers への移行（B）でも、ホスト変更や台数削減（H・I）でも得られる。
- ②はどの構成でも効く。先に決める価値が高い。
- ③は効果が小さい。F・G を選ぶ理由は、コストではなく「Supabase を使わない方針」「Neon の PITR（7 日）が計算に含まれる」といった別の観点になる。
- 年間売上見込み 300 万円以内に対して、A から B への月 約 $60（約 ¥9,000、年 約 ¥10.7 万）は 3.5% 程度。H への月 約 $33（年 約 ¥6 万）は 2% 程度。
- B と C のコスト差はほぼない。どちらも本番の Supabase Pro が必要で（C は Auth のため）、D1 の込み分は元々使い切らない規模のため。
- 含まれないコスト: 移行の人件費、仕様改訂、テスト再設計。

## 9. 変更量と作業量

### 9.1 仕様書（📐 実測）

方法: 各仕様書を `##` の節に分け、PostgreSQL / Supabase / Railway / ロック / SQLSTATE / DB role / `timestamptz` / EXCLUDE などのキーワードが 3 行以上、または 8% 超の密度で出る節を「影響節」として行数を数えた。影響節の行数は、改訂範囲の上限に近い値。

| 仕様書 | 全体（行） | 影響節 | 影響行 | 割合 | 主な内容 |
|---|---:|---:|---:|---:|---|
| SPEC-100 DB設計 | 2,275 | 40/71 | 1,378 | 60% | 型・制約・transaction・migration |
| SPEC-180 インフラ | 1,742 | 42/84 | 998 | 57% | Railway、DB、Worker、バックアップ、デプロイ |
| SPEC-110 API | 2,212 | 10/72 | 528 | 23% | エラー対応、ロック前提の記述 |
| SPEC-010 概要 | 1,142 | 9/24 | 451 | 39% | 構成図、技術スタック、責務表 |
| SPEC-170 テスト | 1,943 | 17/84 | 382 | 19% | DB 統合テスト、並行性テスト、harness |
| SPEC-190 AI開発 | 965 | 14/45 | 303 | 31% | repo 構成、実装規約 |
| SPEC-060 認証 | 1,317 | 11/51 | 292 | 22% | 主に Supabase Auth の記述。Auth を残す前提では対象外 |
| SPEC-120 メール | 1,965 | 7/62 | 291 | 14% | Worker の実行方式、claim |
| SPEC-140 セキュリティ | 1,676 | 21/103 | 283 | 17% | DB 権限分離、Secret |
| SPEC-200 受入条件 | 1,427 | 10/51 | 237 | 17% | DB・インフラ関連の受入条件 |
| SPEC-130 管理・Staff | 2,642 | 5/80 | 223 | 8% | Recon の runtime |
| SPEC-160 観測性 | 2,021 | 4/62 | 176 | 9% | メトリクス出力、audit infra |
| SPEC-150 信頼性 | 1,187 | 10/69 | 120 | 10% | リトライ、shutdown、Worker |
| その他 | — | — | 約 230 | — | SPEC-020 / 030 / 040 / 070 / 080 ほか |
| **合計** | **32,708** | | **5,891** | **18%** | |

- Supabase Auth を残す前提では SPEC-060 の 292 行は対象外とみなせるので、影響行は約 5,600 行（約 17%）。書き換えが必要な量はその 6〜10 割で、**約 3,300〜5,600 行**と見る ⚠️。
- 約 9 本の仕様書が MAJOR 改訂になる見込み。UCR、`depends_on` の整合、版数（SPEC-000）が各仕様に必要。
- `DB-*` 約 83 件、`INF-*` 約 90 件のルール ID（📐 SPEC-100 / 180 の出現数）のうち、かなりの数が廃止・差し替えになる。`traceability/rule-code-map.json` と `tests/traceability/` の整合も取り直す。

### 9.2 実装済みコード（📐 実測、`payment/integration`）

| 対象 | 行数 | 扱い |
|---|---:|---|
| `packages/db/src`（pool、transaction、readiness、migrate、sqlstate） | 774 | 全面作り直し |
| DB 関連テスト（`tests/db` 1,962、`tests/unit/db` 1,410、`tests/harness` の db・postgres・scripts 810） | 4,182 | ほぼ作り直し |
| `scripts/db-bootstrap-local.mts`、`db-migrate.mts` | 399 | 作り直しまたは廃止 |
| `supabase/` | 設定ファイル | 廃止（wrangler 設定へ） |
| `packages/config`（`db.ts` 52、`env/*`、`identity.ts` のうち DB・Supabase URL・environment marker 関連） | 約 830 行のうち一部 | 部分修正（⚠️ 約 250 行と推定） |
| `packages/reliability/src/retry.ts`（`DB_40001`/`DB_40P01` のポリシー） | 177 の一部 | 部分修正 |
| `packages/security`・`observability`・`domain`、Web mock | — | ほぼそのまま |

手戻りは合計で**約 5,600 行**。API・Worker・各 transaction・Stripe 連携はこれから書く部分で、Cloudflare を選んでも作り直しにはならず「書き方が難しくなる」だけ。

### 9.3 構成要素ごとの変更規模（A から D1 へ移す場合）

| 構成要素 | 設計 | Cloudflare 構成 | 規模 |
|---|---|---|---|
| Next.js Web | Vercel | そのままでよい | なし |
| Hono API | Railway（Node） | Workers | 中 |
| DB | Supabase PG17 + Drizzle + `pg` | D1 + Drizzle（D1 版） | 特大 |
| Email / Reconciliation Worker | Railway 常駐 | Durable Object alarm、Queues | 大 |
| 認証 | Supabase Auth | そのまま残す | なし |
| ログ・監視 | Better Stack、Healthchecks.io | HTTP 経由のまま。メトリクスは push 化 | 小〜中 |
| バックアップ | `pg_dump` → R2 | D1 export → 暗号化 → R2 | 中 |
| CI/CD | GitHub Actions、OCI digest | `wrangler deploy`、Worker version | 中 |
| ローカル開発 | Supabase CLI（Docker） | wrangler dev | 中 |

### 9.4 構成別の仕様改訂範囲と作業量（⚠️ 推定）

| 構成 | 主な仕様改訂 | 追加作業量 |
|---|---|---|
| A | なし | 0 |
| B | SPEC-180・150・190（実行基盤、`SET` と advisory lock の扱い）| 約 1.5〜3 週間 |
| C | SPEC-100・180 ほか約 9 本が MAJOR 改訂（9.1）| 約 3〜6 週間 |
| D | C に加え、SPEC-060・010・120・140（認証の全面自作）| 約 6〜11 週間 |
| E | C に加え、SPEC-060・010・120・140 | 約 4〜8 週間 |
| F | B に加え、SPEC-060・010・120・140（認証）、SPEC-180（DB 提供元）。`neon_auth` スキーマの扱い（AR-AUTH-011・SEC-AUTH-006）の解釈 | 約 2〜4.5 週間 |
| G | F と同範囲。認証を自前運用するため、SEC-AUTH の証跡を自前で示す | 約 2.5〜5 週間 |
| H | SPEC-180 の環境定義（staging・dev の運用、dev のローカル化の可否）| 数日 |
| I | H に加え、SPEC-180 の Railway 固有の規定（INF-RWY）、CI/CD、SIGTERM の設定（`kill_signal`）| 約 1〜2 週間 |
| J | I と同範囲（Render）| 約 1〜2 週間 |
| K | B に加え、SPEC-060・010・120・140（認証を Better Auth へ）| 約 2.5〜5 週間 |
| L | B に加え、SPEC-180（DB 提供元）。認証は Supabase Auth のまま | 約 2〜3.5 週間 |
| M | F と同範囲。Clerk の JWT 検証・メール・`sub` 引き当ての確認が追加 | 約 2.5〜5 週間 |

D〜G・K・M では、9.1 で除外した SPEC-060（292 行）が改訂対象に加わる。H〜J・L の作業量は設計変更の量からの推定で、過去の実績からは導いていない ⚠️。

### 9.5 作業量の目安（構成 C、⚠️ 推定）

実績を基にしている。`docs/drafts/payment-pr-plan.md` によれば PR-1（仕様改訂と開発環境整備）が 2026-10-20 時点で 24 ファイル・+3,203 行、slice 12（DB 基盤）は 2026-10-21 にマージされた。つまり約 3,000 行の仕様改訂と、DB 基盤の実装・テスト約 5,000 行が、数日のエージェント作業 + ユーザーレビューで進んでいる。

| 段階 | 内容 | 目安 |
|---|---|---|
| 0. spike | 第 12 章の spike（#1〜#5） | 3〜5 日 |
| 1. 仕様改訂 | 約 9 本 MAJOR、約 3,300〜5,600 行、UCR、トレーサビリティ。ユーザーレビューが律速 | 1.5〜2.5 週間 |
| 2. 基盤の作り直し | `packages/db` 相当、migration、ローカル環境、テスト基盤、CI（約 5,600 行） | 3〜5 日 |
| 3. 以降の実装の割り増し | 16 種の transaction と周辺のテスト・再証明が通常より重い（+30〜50%） | +1〜3 週間 |

合計は、現構成のまま進める場合より**約 3〜6 週間の追加**（前版の 5〜9 週間から、実績ベースで下方修正）。D1 側に特有の不確実性（transaction の書き換え、トリガー方針の改訂、DO alarm の挙動）は spike で縮める。

## 10. 実装難易度の比較（⚠️ 1〜5 の主観評価）

| 領域 | A | B | C | 根拠 |
|---|:-:|:-:|:-:|---|
| 業務 transaction（16 種） | 2 | 2 | **5** | 行ロック前提を条件付き SQL + `batch()` へ。再証明が必要 |
| カラオケ枠の重複排除 | 1 | 1 | **3〜4** | EXCLUDE なし。トリガー案は SPEC-100 §58 の改訂が前提 |
| キュー取得・排他（claim、重複防止） | 2 | 3 | 4 | B は Hyperdrive の transaction mode で session 単位のロックが前提どおりに使えない可能性。C は `SKIP LOCKED`・advisory lock が存在しない |
| 定期実行（15 秒 tick） | 1 | 4 | 4 | Durable Object alarm での作り直し（B・C 共通） |
| 終了処理と結果不明の扱い | 2 | 3 | 3 | SIGTERM がなく、中断前提の設計 |
| Stripe Webhook・Resend | 1 | 2 | 2 | Workers 用ビルドと非同期署名検証があり、障壁は低い ✅ |
| migration と制約の導入 | 2 | 2 | **4** | `NOT VALID` / `CONCURRENTLY` がなく、制約追加はテーブル再作成 |
| 最小権限と監査の改ざん耐性 | 2 | 2 | **4** | role なし。binding 分離 + コード |
| エラー分類とリトライ | 1 | 1 | 3 | SQLSTATE なし |
| テスト（実 DB での並行性） | 2 | 2 | **4** | 実 D1 と workerd の差。staging での検証が必須 |
| バックアップと復旧 | 2 | 2 | 3 | export が DB をブロック、Time Travel は全体上書き |
| ログ・メトリクス出力 | 2 | 3 | 3 | 常駐前提の exporter が使えず、push + `waitUntil` |
| ローカル開発 | 3 | 3 | **2** | Docker・Supabase CLI が不要 |
| デプロイ・環境追加 | 3 | 2 | **2** | Railway の複数サービス管理がなくなる |
| 実装時の情報量と AI の得意度 | 1 | 2 | 3 | PostgreSQL の transaction パターンは情報が多い |

- 構成 C の難しさは「お金とチケットの整合性」という失敗が許されない部分に集中する。失敗は二重販売・二重確定のように静かに起きやすい。
- 運用面（ローカル開発、環境追加、デプロイ）は C が楽になる。これは実装後の運用の話。
- 構成 B は定期実行の作り直しが主で、DB の保証が変わらないぶんリスクの質は A に近い。

> 表の列 A・B・C は第 3 章の構成 A・B・C（H〜J は A と同じ構成でホストと運用だけが変わる）。D〜G の個別評価はしていないが、D・E は C の難しさに認証の実装が加わり、F・G は B と同じく DB の保証は維持される代わりに、認証の組み込み（6.4〜6.6）が加わる。構成ごとの総合評価は第 11 章。

## 11. 構成の採点

### 11.1 判断基準

優先順位は **コスト > セキュリティ > 機能の充足 > 実装難易度**。順位比例で重みを 40 / 30 / 20 / 10 % とし、各観点を 1〜5 点（0.5 点刻み、5 が最良）で採点する。採点は主観を含むため、基準を明記する。

| 点 | コスト（月額。Vercel・Stripe・Resend・Better Stack の共通費を除く） | セキュリティ | 仕様に対する機能の充足 | 実装難易度 |
|---|---|---|---|---|
| 5 | $15 以下 | DB ロール分離・行ロックあり、認証はマネージド | 仕様変更なし | 追加作業なし |
| 4 | $15〜35 | DB の保証はほぼ維持、認証はマネージド | DB 仕様は維持、周辺仕様のみ改訂 | 約 1.5〜3 週間 |
| 3 | $35〜55 | DB の保証が一部弱い、または認証の管理が分散 | 改訂が複数仕様に及ぶ | 約 3 週間前後 |
| 2 | $55〜90 | DB のロール分離・監査が弱い | 主要仕様の大規模改訂（約 9 本）| 約 3〜6 週間 |
| 1 | $90 超 | 認証を自作 | 上記に加え、認証仕様の規定と衝突 | 6 週間超 |

コスト点は、月額の**中央値**が属する帯で決める（帯の境界を 1 ドル超えるだけで 1 点変わる粗い尺度のため、低位・高位の感度分析を併記する）。

### 11.2 採点結果

| 構成 | コスト | セキュリティ | 機能の充足 | 実装難易度 | 基本 | コスト低位 | コスト高位 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| A | 1 | 5 | 5 | 5 | **3.40** | 3.80（$60）| 3.40（$130）|
| H | 2 | 5 | 4.5 | 4.5 | **3.65** | 4.05（$46）| 3.65（$77）|
| I | 3 | 5 | 4.5 | 4 | **4.00** | 4.00（$39）| 3.60（$63）|
| J | 2 | 5 | 4.5 | 4 | **3.60** | 3.60（$68）| 3.60（$77）|
| B | 3 | 4 | 4 | 3 | **3.50** | 3.90（$31）| 3.50（$40）|
| K | 3 | 3.5 | 3.5 | 2.5 | **3.20** | 3.60（$31）| 3.20（$40）|
| C | 3 | 3 | 2 | 2 | **2.70** | 3.10（$31）| 2.70（$40）|
| D | 5 | 1 | 1 | 1 | **2.60** | 2.60（$5）| 2.60（$10）|
| E | 5 | 2.5 | 2 | 1.5 | **3.30** | 3.30（$5）| 3.30（$5）|
| F | 4 | 3 | 3 | 2.5 | **3.35** | 3.35（$26）| 2.95（$40）|
| G | 4 | 3.5 | 3.5 | 2 | **3.55** | 3.55（$26）| 3.15（$40）|
| L | 2 | 4 | 3.5 | 2.5 | **2.95** | 3.35（$51）| 2.95（$61）|
| M | 3 | 3.5 | 3 | 2.5 | **3.10** | 3.10（$46）| 2.70（$61）|

計算例（I）: 3×0.4 + 5×0.3 + 4.5×0.2 + 4×0.1 = 4.00

- 「コスト低位・高位」は、8.2 の月額の下端・上端での点数。
- E に Better Auth Infrastructure Pro（$20）を加えるとコスト点が 4 になり、**2.90**。
- **シンガポール DB の遅延は採点に反映していない**（4.4）。反映するなら F・G・L・M の機能の充足・実装難易度が下がる方向に働く。

| ケース | 順位 |
|---|---|
| 基本 | I 4.00 > H 3.65 > J 3.60 > G 3.55 > B 3.50 > A 3.40 > F 3.35 > E 3.30 > K 3.20 > M 3.10 > L 2.95 > C 2.70 > D 2.60 |
| コスト低位 | H 4.05 > I 4.00 > B 3.90 > A 3.80 > J 3.60 = K 3.60 > G 3.55 > F 3.35 = L 3.35 > E 3.30 > C 3.10 = M 3.10 > D 2.60 |
| コスト高位 | H 3.65 > I 3.60 = J 3.60 > B 3.50 > A 3.40 > E 3.30 > K 3.20 > G 3.15 > F 2.95 = L 2.95 > C 2.70 = M 2.70 > D 2.60 |

### 11.3 点数の理由

- **A**: コストだけが最低（1）。DB ロール分離・行ロック・マネージド認証が揃い、他の観点は満点。
- **H**: A と同じ構成で、staging・dev を使う時間だけ動かす。仕様の環境定義（dev のローカル化など）の改訂と運用手順の整備だけが加わるため、機能の充足・難易度を 4.5 とした。停止中の Railway の課金は未確認 ⚠️。
- **I**: DB・認証は A と同じ。Railway 固有の規定とデプロイを Fly.io に改訂し（機能の充足 4.5）、ホスト移行の作業が加わる（難易度 4）。東京の価格、256MB で足りるか、SIGTERM の設定（既定は SIGINT）が未確認 ⚠️。
- **J**: I と同じ。Render は 1 台 $7 で、コストが I より高い。
- **B**: DB の保証が維持され、認証もマネージド。主な作業は 15 秒 tick の作り直しと `SET`・advisory lock の見直し。Hyperdrive の session 制約があるため、セキュリティ・機能の充足は A より 1 点下げた。
- **K**: B の認証を Better Auth にした構成。Supabase Pro は PG のために要るため、コスト利点がなく、自前運用の責任だけが増える。
- **C**: D1 の弱点（第 5 章）がそのまま残る。DB のロール分離がなく、約 9 本の仕様の大規模改訂が必要。
- **D**: 認証を自作するため、セキュリティ 1。SPEC-060 の規定を満たす実装・証跡を自前で用意する（6.4）。
- **E**: Better Auth により JWT 15 分・JWKS・漏洩検知・captcha・パスワード長設定が標準で揃い、D より仕様に合う（6.5）。D1 の難しさは残る。
- **F**: PostgreSQL に戻るため DB 仕様は維持できる。Neon Auth はプラグインの制約（漏洩検知・captcha・rate limit なし）、JWT 寿命の固定、認証情報が同じ DB の `neon_auth` スキーマに入る点（AR-AUTH-011・SEC-AUTH-006 の解釈が必要）が減点。
- **G**: DB は Neon、認証は Better Auth を自前で運用する。標準プラグインで SEC-AUTH-016・017・019 を満たしやすく、DB と認証を別スキーマ・別ロールにしやすい。一方、組み込み・運用・更新の責任（6.6）は自分に残る。
- **L**: 認証は Supabase Auth のまま DB だけ Neon にする。Supabase Pro を認証のためだけに払うため割高で、DB と認証が別ベンダーになる。
- **M**: Clerk の既定トークン寿命、パスワード規則、漏洩検知、メールのカスタム、`sub` からの引き当てが未確認 ⚠️。

### 11.4 読み方

- **縮小運用で Supabase を維持する構成（H・I・J）が上位。** 月額の差は 1 帯分（約 $26）でも、セキュリティ・機能の充足・難易度で A とほぼ同じ点を保てるため。H・I は全コストケースで 3.60 以上。
- **B は基本ケースで 5 位。** 月額は最安クラス（$31〜40）でも、コスト点は H より 1 帯上がるだけ（3 と 2）で、Hyperdrive の制約と移行工数（難易度 3）の分を取り戻せない。コストが低位に振れた場合（$31）は 3.90 で、H・I に次ぐ。
- **G は Supabase を使わない場合の第一候補。** 基本ケースは 3.55 だが、コストが上がる（$36〜40）と 3.15 まで下がる。B との月額差は $4〜20 程度（Supabase Pro と Neon Launch の差）にとどまり、東京リージョンがないこと、認証を自前で運用することの負担が上乗せされる。
- **F は G より機能面で劣る。** 漏洩検知・captcha・レート制限のプラグインが使えず、パスワード最小長（12 文字）の設定可否が不明。運用の手間は減る。
- **コスト帯が粗い。** コスト点は 1 帯（$20 前後）ごとに 0.4 点動くため、上位の順位は帯の境界付近の金額で入れ替わる。上位の差（0.05〜0.15）は確定的ではなく、順位より「どのグループに入るか」で読む。
- **前提への依存。** H・I・J の点は、staging・dev を使う時間だけ動かす運用（停止中の課金、dev のローカル化の可否）に依存する。これが成り立たない場合、H・I の月額は上がり、順位は B・G 側に寄る。
- **D1 系（C・D・E）は、どの前提でも下位。** L・M のように Neon に外部認証を足す組み合わせも、コスト利点がない。
- 買えるもの（有料化）: Neon は 7 日の PITR と常時稼働、Supabase Pro は漏洩パスワード保護とバックアップ、Clerk Pro は MFA とセッション寿命の変更。このアプリの規模では、必要な要件に応じて 1 つだけ買う考え方が現実的。

## 12. 判断前の spike（試作）案

D1 + workerd 上で次を試し、構成 C の可否を数日で判断する。

| # | 内容 | 合格基準 |
|---|---|---|
| 1 | Karaoke の Hold 取得と Entry の check-in を `batch()` + 条件付き SQL で書く（SPEC-100 §48 の該当行の再現） | 並行テストで二重販売・二重 check-in が 0 件。ロック順序に頼らない |
| 2 | Karaoke 枠の重複排除をトリガー案で実装 | 異なる window・Admin 編集を含む重複を全て拒否。境界一致（`cycle_end == usage_start`）は許可 |
| 3 | Durable Object alarm で 15 秒 tick の Reconciliation を動かす | 2 インスタンス相当の同時実行で重複処理が起きない。失敗時の再試行を確認 |
| 4 | Stripe Webhook を Workers で `constructEventAsync` により署名検証し、冪等に確定する | 同一イベントの再送で二重確定しない |
| 5 | `wrangler d1 export` を 1,000 行規模で実行し、ブロック時間を測る | バックアップ中のブロック時間が許容内 |

構成 B を選ぶ場合は、次を spike にする: Hyperdrive 経由で `SET LOCAL` による timeout 設定と `pg_try_advisory_xact_lock` が動くか。


構成 F・G を選ぶ場合の spike:

| # | 内容 | 合格基準 |
|---|---|---|
| 6 | Workers → Hyperdrive → Neon（シンガポール）で、業務 transaction（Hold 取得など複数文のもの）の所要時間を測る | 利用者の体感として許容できる（数値目標は仕様にないため、先に決める）|
| 7 | Neon の `btree_gist` で EXCLUDE 制約が張れ、Hyperdrive 経由の `SELECT ... FOR UPDATE` が期待どおり動く | 並行テストで二重販売が 0 件 |
| 8 | [G] Better Auth を Workers + Hyperdrive 上で動かし、`nodejs_compat`・rate limit の保存先・`advanced.backgroundTasks` の設定を確認する | 6.6 の運用項目が実際の設定で満たせる |
| 9 | [F] Neon Auth でパスワード最小長 12 文字を満たせるか、検証メールを webhook 経由で日本語送信できるかを確かめる | SEC-AUTH-016 とメール要件を満たす |

構成 E・G で Better Auth を使う場合は、依存の更新運用（リリースが約 2 日おき、v1.7.0 で破壊的変更あり）を試験的に回す。

運用の縮小（構成 H・I・B）を選ぶ場合の spike:

| # | 内容 | 合格基準 |
|---|---|---|
| 10 | Railway・Fly.io・Render で、停止中の staging・dev がいくら課金されるかを、請求画面または公式の請求ドキュメントで確認する | 停止中の課金が見積もり（ほぼ 0）と合う |
| 11 | [I] Fly.io の東京リージョンの価格を確認し、メモリ 256MB で API と Worker が動くか、`kill_signal=SIGTERM` で 20 秒の drain ができるかを試す | 月額が $13〜28 に収まり、SIGTERM の drain が仕様どおり動く |
| 12 | Supabase の staging を一時停止・再開したときの待ち時間と、ブランチの Auth（ユーザー・設定の引き継ぎ）の挙動を確認する。dev のローカル化（Supabase CLI）が SPEC-180 の環境定義と合うかを確認する | 再開が運用上許容でき、staging の検証手順が成り立つ |

## 13. 未確認事項

本書で「記載を確認できなかった」とした事項を、領域ごとに一か所へまとめる。各章では個別に繰り返さない。

| 領域 | 事項 | 影響する構成 |
|---|---|---|
| D1 / Cloudflare | D1 の対話的 transaction（公式には `batch()` のみ ✅[S3]）、binding の読み取り専用モード、API トークンの DB 単位の絞り込み | C〜E |
| D1 / Cloudflare | `ALTER TABLE` の個別制約を D1 が追加で制限するか（SQLite の仕様は ✅[S26]）、changes 件数の取得方法 | C〜E |
| Hyperdrive | advisory lock の可否 | B・F・G |
| Workers 運用 | Hono の Workers での動作、Secrets の運用（一次情報を参照していない）| B〜G |
| Supabase | captcha・レート制限の標準機能、現行の Supabase のリージョン | A・B・C |
| RDS / AWS | RDS for PostgreSQL の単価（料金 API がプロキシで拒否された）、DSQL の `btree_gist`・advisory lock・トリガー | 付録 A |
| Better Auth | D1 の設定手順（コミュニティ dialect の導入手順が公式にない）、パスワードハッシュのフォーマットと他サービスへの移行互換性、Workers での `advanced.backgroundTasks` の設定、未取得のアドバイザリ 1 ページ分、メンテナ体制と SLA | E・G |
| Neon / Neon Auth | セッション寿命、パスワード最小長、組み込みの rate limit の有無、管理 API でのユーザー一覧・取得、`neon_auth` スキーマの安定性、MAU の超過単価、Launch のバックアップ保持期間と仕様（日次 35 日 + 月次 400 日）の関係 | F・G |
| 他の認証サービス | Clerk の既定トークン寿命・パスワード規則・メールのカスタム、Firebase の ID トークン寿命（公式のセッション Cookie 管理ページに記載なし ✅[S97]）、GCP Identity Platform と WorkOS のトークン寿命、Auth0 / Clerk の管理 API による `sub` からのメール引き当て | 参考 |
| Railway の代替 | Fly.io 東京の価格、Render の Background Worker が常時稼働できるか、Cloud Run worker pool の最小サイズ、VPS の価格 | A |
| 前提・推定 | Railway・Fly.io・Neon の使用量（仮定）、作業量の週数（実績ベースの推定で保証値ではない）| 全て |
| 運用の縮小 | Railway・Render の停止中の課金、Supabase の停止中のディスク課金と再開時間、ブランチの Auth の挙動、dev のローカル化と SPEC-180 の環境定義の整合、Fly.io のメモリ 256MB の適否 | H・I・J・B |

## 付録 A. 除外した AWS 系の構成と、確認できた事実

方針により、AWS のサービスを自分で契約・運用する構成（Cognito、SES、RDS、Fargate など）は比較から外した。提供元が AWS 上でホストする Neon は含めている（第 3 章）。参考として、除外した構成と確認済みの事実を残す。

### A.1 除外した構成

| 記号 | 構成 | コスト | セキュリティ | 機能の充足 | 実装難易度 | 合計 |
|---|---|:-:|:-:|:-:|:-:|:-:|
| X1 | Workers + D1 + Cognito + SES（約 $5〜10） | 5 | 3 | 1.5 | 1.5 | 3.35 |
| X2 | Workers + Hyperdrive + RDS PostgreSQL + Cognito + SES（約 $20〜40 ⚠️） | 4 | 4 | 3.5 | 2.5 | 3.75 |

採点基準は 11.1 と同じ。X2 は RDS の単価が未確認で、コストは推定のまま ⚠️。除外しなければ X2 が基本ケースの首位だったが、点差が小さく確定とは言えない。

### A.2 確認できた事実（✅ 公式）

| サービス | 内容 |
|---|---|
| Cognito | Essentials・Lite とも 1 万 MAU まで無料。超過は Essentials が $0.015/MAU、Lite が段階制（最初の 9 万 MAU は $0.0055/MAU）、Plus は $0.02/MAU（無料枠なし。1,000 MAU で $20、10,000 MAU で $200 は導出）。漏洩認証情報の検出は Plus のみ ✅[S98]。アクセストークン寿命は 5 分〜1 日（app client 単位）、RS256、JWKS は `{iss}/.well-known/jwks.json`、`sub` は標準 UUID とは限らない。`AdminGetUser` は username 指定なので、`sub` からの検索は `ListUsers` の filter を使う ✅[S99]。標準のメール送信は AWS アカウントあたり 1 日 50 通（変更不可）で、本番では SES が必要 ✅[S101]。`ListUsers` は 30 RPS で固定、`AdminGetUser` は 120 RPS ✅[S101]。独自ドメインの送信元は CLI / API でのみ設定できる ✅[S100]。認証メールの日本語化は Lambda トリガー（Custom Message）で実装し、件名・本文の差し替えは SES 利用時のみ有効 ✅[S102] |
| SES | 1,000 通あたり $0.10。SES 固有の無料枠の記載はない（新規アカウントの無料クレジットのみ）✅[S103] |
| RDS for PostgreSQL | 料金ページからインスタンス単価・ストレージ単価を取得できなかった。無料枠（750 時間、バックアップ 20GB）と T4g の CPU クレジット（$0.075/vCPU 時間）のみ確認 ✅[S109]。**単価は未確認** ⚠️ |
| Aurora DSQL | 分離レベルは Repeatable Read 固定で、ロックではなく楽観的並行制御。1 トランザクション 3,000 行まで。PL/pgSQL なし。トリガーはアプリ層での実装を推奨 ✅[S104]。CREATE TABLE の制約は CHECK・UNIQUE・PRIMARY KEY・FOREIGN KEY が記載され、EXCLUDE の記載はない ✅[S105]。`SELECT ... FOR UPDATE / KEY SHARE` は対応一覧にある（トランザクション上限あり）✅[S106]。`FOR SHARE`・`SKIP LOCKED`・advisory lock・拡張（`btree_gist` など）・トリガー・EXCLUDE は記載がなく、未対応とも対応とも言えない ⚠️。READ COMMITTED 前提の SPEC-100 §48 とは合わない |
| ECS Fargate | Linux/ARM（米国東部）の単価は vCPU あたり $0.0000089944/秒、メモリ GB あたり $0.0000009889/秒、最小課金 1 分 ✅[S107]。最小タスクは 0.25 vCPU + 512MiB ✅[S108]。Railway の代替として 12 タスクで約 $85（導出: (0.25 × 2,592,000 × 0.0000089944 + 0.5 × 2,592,000 × 0.0000009889) × 12、30 日換算、ALB・固定 IP は含まない）。Spot は最大 70% 割引だが中断を許容する用途向け |

### A.3 AWS へ置き換えられるものの検討

**現構成（Vercel / Railway / Supabase）から Cognito へ寄せる場合**

| 現構成 | AWS 側の候補 | 判断 |
|---|---|---|
| Resend | SES | **置き換え推奨**。Cognito の本番メールに SES が必要で、基盤を一本化できる。サンドボックス解除とバウンス処理は自前 |
| Supabase PostgreSQL | RDS for PostgreSQL | Supabase を抜けるなら有力。PostgreSQL のままなので EXCLUDE 制約・16 トランザクション・DB ロール分離をそのまま使える。パッチ適用と接続管理は自前 |
| pg_dump → R2 | RDS 自動バックアップ / S3 | 部分的に置き換え可 |
| Railway（API・Worker） | Lambda / ECS Fargate | 効果に比べて変更が大きい。仕様の 15 秒 tick・SIGTERM ドレイン・接続プールは常駐プロセス前提 |
| Vercel | Amplify Hosting など | 価値は低い。Next.js 16 対応の確認が要る |
| Better Stack / Healthchecks.io | CloudWatch | 任意 |

Cognito だけを採用して Supabase DB を残す構成は、Supabase Auth が追加費用 0 のため意味が薄い。

**Cloudflare + Cognito + Stripe の場合**

| 要素 | AWS 側の候補 | 判断 |
|---|---|---|
| Resend | SES | **置き換え推奨**（Cognito の前提でもある） |
| D1 | RDS / Aurora（Hyperdrive 経由） | 条件付き。D1 の弱点を避けるなら PostgreSQL に戻す（= 構成 B の DB 側）。Aurora DSQL は上記のとおり SPEC-100 §48 に合わない |
| R2 | S3 | 不要 |
| Cron / Queues / Durable Objects | EventBridge / SQS / Lambda | 不要。重い処理が出たときだけ検討 |
| Workers Observability | CloudWatch | 不要 |
| Stripe | なし | そのまま |

この構成に特有の注意:

- Email Worker が `sub` からメールと検証状態を取るには、Cognito の `ListUsers` を Workers から SigV4 署名つきで呼ぶ必要がある。IAM 認証情報は Workers のシークレットに置く。
- JWT 検証は `jose` など Web 標準 API のライブラリで Workers 上でも実装できる。
- 認証メールの日本語化は Lambda トリガー（Custom Message）で実装し、言語の切り替えは `clientMetadata` を使って自作する。
- 「認証だけ AWS」になるため、Cloudflare と AWS の二つのクラウドを運用する複雑さが残る。

**見立て**: AWS に寄せる価値がはっきりあるのは SES だけで、Cognito 採用の前提条件でもある。DB まで AWS に寄せる案（X2）は、Supabase Pro $25 が不要になる一方、RDS の費用と運用が加わるため、純粋な節約額は小さいと見ている（⚠️ 未検証）。

## 付録 B. 前版（初版）からの主な訂正

初版は一般知識と概算に基づく部分が多かった。今回、公式ドキュメントとリポジトリの実測で精査し、次を訂正した。

| 項目 | 初版 | 本版 | 理由 |
|---|---|---|---|
| 業務 transaction の数 | 約 20 本 | 16 種 | SPEC-100 §48 の表の行数を数えた |
| 仕様書の改訂量 | 約 5,000〜7,000 行 | 影響節 約 5,900 行（18%）、書き換え 約 3,300〜5,600 行 | 節単位のキーワード分析（9.1）。Supabase Auth を残す前提で SPEC-060 を除外 |
| 実装の手戻り | 約 6,000 行 | 約 5,600 行 | DB 関連テストを実測（5,000 → 4,182 行） |
| カラオケ枠の代替案 | トリガーまたは固定グリッド | トリガーは SPEC-100 §58 の方針と衝突。固定グリッドは window_start が任意のため不十分 | SPEC-100 §58 / SPEC-090 の精読 |
| 制約の段階導入 | 「可能性がある」 | `NOT VALID` / `CONCURRENTLY` が使えない。既存テーブルへの制約追加は 12 手順の再作成が必要 | SQLite 公式 |
| Node から D1 | 「遅くレート制限もあるはず」 | REST API は制御面。Cloudflare API 全体でトークンあたり 1,200 リクエスト/5 分、超過で 5 分間ブロック | Cloudflare 公式 |
| Cron / Worker の上限 | 未確認 | Cron の CPU は間隔 1 時間未満で 30 秒、wall は 15 分、subrequest は 10,000、Cron Trigger は 250 | Workers limits |
| Hyperdrive | 料金・挙動が未確認 | Paid で追加料金なし。transaction mode で `SET` は持続しない。advisory lock は記載を確認できなかった | Hyperdrive 公式 |
| Stripe / Resend | 未確認 | stripe-node に `workerd` 向けビルドと `constructEventAsync` がある。Resend に Workers ガイドがある | ソースと公式ガイド |
| バックアップ | 「自作ジョブが必要」 | export は DB をブロック。Time Travel は全体上書き。30 日超は Workflows で R2 に export する方法が公式に示されている | D1 公式 |
| 現構成の月額 | 約 $100〜130 | 約 $60〜130 | Railway の使用量に低位・高位の 2 つの仮定を置いた |
| 構成 B の月額 | 約 $60〜80 | 約 $30〜50 | Hyperdrive は追加料金なし |
| 構成 C の月額 | 約 $30〜40 | 約 $30〜50 | staging・dev の Supabase が有料の場合を含めた |
| 削減額 | 月 $60〜90 | 月 $10〜100（中央付近 約 $55） | 上記の見直し |
| 構成 B と構成 C のコスト差 | 触れていない | ほぼなし | 構成 C でも Auth のため Supabase の有料プランが必要 |
| 追加作業量 | 約 5〜9 週間 | 約 3〜6 週間 | リポジトリの実績（PR-1、slice 12）を基に再推定 |
| 構成 B の追加作業 | 約 2〜4 週間 | 約 1.5〜3 週間 | 同上 |

初版から変わらず、公式に記載を確認できていない事項は第 13 章に残している。

追加の訂正（本書の後半を作る過程で見つけたもの）:

| 項目 | 訂正前 | 訂正後 | 理由 |
|---|---|---|---|
| Workers $5 の出典 | D1 の料金ページ | Workers の料金ページ | 引用の取り違え |
| Aurora DSQL | 「`FOR UPDATE` は未確認」と断定的に記載 | `FOR UPDATE` / `KEY SHARE` は対応一覧にある。`btree_gist`・`SKIP LOCKED`・advisory lock は記載を確認できなかった | 公式の対応一覧を確認 |
| Cognito の標準メール | 制限が曖昧 | AWS アカウントあたり 1 日 50 通（変更不可）。Lite にも 1 万 MAU の無料枠がある | Cognito の Quotas と料金ページ |
| 一部の出典 | 本文で引用されていない、または定義がない出典番号があった | 引用を補い、未定義の番号を定義した | 出典の整合性確認 |
| 構成の呼称 | 構成 A〜C と ①〜⑩ が混在 | 構成 A〜M に統一（第 3 章に旧称の対応表）| 本章立ての再構成 |
| 比較する構成の数 | 7（A〜G）| 13（A〜M）| コスト要因（Railway・Supabase）別の構成（縮小運用、Fly.io、Render、Neon + 外部認証など）を追加 |
| 構成 B・C の月額 | $30〜50 | $31〜40 | staging・dev を使う時間だけ動かす縮小運用に前提を変えた（8.2）|
| 推奨 | 構成 A、次点で B | 構成 H（A の縮小運用）、次に I | 縮小運用を含めて再採点した（第 11 章）|
| コスト点の読み方 | 基本ケースの順位を主に提示 | 低位・高位の感度分析と、コスト帯が粗い点を明記 | 帯の境界付近で順位が入れ替わるため |

## Sources（一次情報）

**Cloudflare**
- [S1] [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [S2] [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [S3] [D1 Worker API（batch、exec）](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [S4] [D1 SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
- [S5] [D1 import and export data](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [S6] [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [S7] [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [S8] [Query D1 (REST API)](https://developers.cloudflare.com/d1/best-practices/query-d1/)
- [S9] [Cloudflare API rate limits](https://developers.cloudflare.com/fundamentals/api/reference/limits/)
- [S10] [Cloudflare API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
- [S11] [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [S12] [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [S13] [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [S14] [Durable Objects Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [S15] [SQLite-backed Durable Object Storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [S16] [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [S17] [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [S18] [Hyperdrive connection pooling](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/)
- [S19] [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/)
- [S20] [Workers Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- [S21] [Cloudflare Access policies](https://developers.cloudflare.com/cloudflare-one/policies/access/)
- [S22] [D1 documentation（llms-full.txt。`wrangler d1 migrations apply` の記述）](https://developers.cloudflare.com/d1/llms-full.txt)
- [S23] [Cloudflare Workers — Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [S24] [Cloudflare Workers — Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [S25] [Cloudflare Turnstile — Plans](https://developers.cloudflare.com/turnstile/plans/)

**SQLite / Drizzle**
- [S26] [SQLite ALTER TABLE](https://www.sqlite.org/lang_altertable.html)
- [S27] [SQLite CREATE TRIGGER](https://www.sqlite.org/lang_createtrigger.html)
- [S28] [Drizzle ORM — Cloudflare D1](https://orm.drizzle.team/docs/connect-cloudflare-d1)

**Supabase**
- [S29] [Supabase pricing](https://supabase.com/pricing)
- [S30] [Supabase compute and disk](https://supabase.com/docs/guides/platform/manage-your-usage/compute)
- [S31] [Billing on Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [S32] [Supabase backups](https://supabase.com/docs/guides/platform/backups)
- [S33] [Supabase JWTs](https://supabase.com/docs/guides/auth/jwts)
- [S34] [Supabase — pausing and upgrading](https://supabase.com/docs/guides/platform/upgrading)
- [S35] [Supabase Auth ドキュメント / 料金ページ（MAU、漏洩パスワード保護、JWKS 検証）](https://supabase.com/pricing)
- [S36] [Supabase — Branching の料金](https://supabase.com/docs/guides/platform/manage-your-usage/branching)

**Railway と代替ホスティング**
- [S37] [Railway pricing plans](https://docs.railway.com/reference/pricing/plans)
- [S38] [Railway — understanding your bill](https://docs.railway.com/reference/pricing/understanding-your-bill)
- [S39] [Fly.io — Resource pricing](https://docs.fly.io/about/pricing)
- [S40] [Fly.io — App configuration（`kill_signal`・`kill_timeout`）](https://docs.fly.io/reference/configuration)
- [S41] [Render — Pricing](https://render.com/pricing)
- [S42] [Render — Deploys（SIGTERM・猶予時間）](https://render.com/docs/deploys)
- [S43] [Google Cloud Run — Pricing](https://cloud.google.com/run/pricing)

**Stripe / Resend**
- [S44] [stripe-node package.json（exports の `workerd` 条件）](https://raw.githubusercontent.com/stripe/stripe-node/master/package.json)
- [S45] [stripe-node Webhooks.ts（`constructEventAsync`）](https://raw.githubusercontent.com/stripe/stripe-node/master/src/Webhooks.ts)
- [S46] [Stripe — Receive events in your webhook endpoint](https://docs.stripe.com/webhooks)
- [S47] [Resend — Send with Cloudflare Workers](https://resend.com/docs/send-with-cloudflare-workers)

**Neon**
- [S48] [Neon — Plans](https://neon.com/docs/introduction/plans)
- [S49] [Neon — Pricing](https://neon.com/pricing)
- [S50] [Neon — Regions](https://neon.com/docs/introduction/regions)
- [S51] [Neon — Supported Postgres extensions](https://neon.com/docs/extensions/pg-extensions)
- [S52] [Neon — Serverless driver](https://neon.com/docs/serverless/serverless-driver)
- [S53] [Neon — Compute（autoscaling・scale to zero）](https://neon.com/docs/manage/endpoints)
- [S54] [Cloudflare Hyperdrive — Neon への接続](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/neon/)

**Neon Auth**
- [S55] [Neon Auth — About Managed Better Auth](https://neon.com/docs/auth/about)
- [S56] [Neon Auth — Production checklist](https://neon.com/docs/auth/production-checklist)
- [S57] [Neon Auth — Roadmap](https://neon.com/docs/auth/roadmap)
- [S58] [Neon Auth — JWT plugin](https://neon.com/docs/auth/guides/plugins/jwt)
- [S59] [Neon Auth — Customize emails](https://neon.com/docs/auth/guides/customize-emails)
- [S60] [Neon Auth — Plugins](https://neon.com/docs/auth/guides/plugins)
- [S61] [Neon Auth — Authentication flow](https://neon.com/docs/auth/authentication-flow)
- [S62] [Neon Auth — Webhooks](https://neon.com/docs/auth/guides/webhooks)
- [S63] [Neon Auth — User management](https://neon.com/docs/auth/guides/user-management)

**Better Auth**
- [S64] [Better Auth — Database](https://www.better-auth.com/docs/concepts/database)
- [S65] [Better Auth — Email & Password](https://www.better-auth.com/docs/authentication/email-password)
- [S66] [Better Auth — JWT plugin](https://www.better-auth.com/docs/plugins/jwt)
- [S67] [Better Auth — Rate limit](https://www.better-auth.com/docs/concepts/rate-limit)
- [S68] [Better Auth — Session management](https://www.better-auth.com/docs/concepts/session-management)
- [S69] [Better Auth — Have I Been Pwned plugin](https://www.better-auth.com/docs/plugins/have-i-been-pwned)
- [S70] [Better Auth — Admin plugin](https://www.better-auth.com/docs/plugins/admin)
- [S71] [Better Auth — Cookies](https://www.better-auth.com/docs/concepts/cookies)
- [S72] [Better Auth — Captcha plugin](https://www.better-auth.com/docs/plugins/captcha)
- [S73] [Better Auth — Pricing](https://www.better-auth.com/pricing)
- [S74] [Better Auth — LICENSE（MIT）](https://raw.githubusercontent.com/better-auth/better-auth/main/LICENSE.md)
- [S75] [better-auth/utils — password.node.ts（scrypt パラメータ）](https://raw.githubusercontent.com/better-auth/utils/main/src/password.node.ts)
- [S76] [Better Auth — Installation](https://www.better-auth.com/docs/installation)
- [S77] [Better Auth — Other relational databases](https://www.better-auth.com/docs/adapters/other-relational-databases)
- [S78] [Better Auth — Security](https://www.better-auth.com/docs/reference/security)
- [S79] [Better Auth — Options](https://www.better-auth.com/docs/reference/options)
- [S80] [Better Auth — Users & Accounts](https://www.better-auth.com/docs/concepts/users-accounts)
- [S81] [Better Auth — Hooks](https://www.better-auth.com/docs/concepts/hooks)
- [S82] [better-auth/better-auth — Security advisories](https://github.com/better-auth/better-auth/security/advisories)
- [S83] [better-auth/better-auth — Releases](https://github.com/better-auth/better-auth/releases)
- [S84] [Better Auth — Hono integration](https://www.better-auth.com/docs/integrations/hono)

**Hono / パスワード保管 / 漏洩検知**
- [S85] [Hono — JWK middleware](https://hono.dev/docs/middleware/builtin/jwk)
- [S86] [Hono — JWT middleware](https://hono.dev/docs/middleware/builtin/jwt)
- [S87] [OWASP — Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [S88] [Have I Been Pwned — API v3（Pwned Passwords）](https://haveibeenpwned.com/API/v3)

**その他の認証サービス**
- [S89] [Clerk Pricing](https://clerk.com/pricing)
- [S90] [Clerk — Session tokens](https://clerk.com/docs/guides/sessions/session-tokens)
- [S91] [Clerk — Manual JWT verification](https://clerk.com/docs/guides/sessions/manual-jwt-verification)
- [S92] [Auth0 — SMTP email providers](https://auth0.com/docs/customize/email/smtp-email-providers)
- [S93] [Auth0 Pricing](https://auth0.com/pricing)
- [S94] [Auth0 — Update access token lifetime](https://auth0.com/docs/secure/tokens/access-tokens/update-access-token-lifetime)
- [S95] [GCP Identity Platform Pricing](https://cloud.google.com/identity-platform/pricing)
- [S96] [WorkOS Pricing](https://workos.com/pricing)
- [S97] [Firebase — Manage session cookies（ID トークン寿命の記載なし）](https://firebase.google.com/docs/auth/admin/manage-cookies)

**AWS（付録 A）**
- [S98] [Amazon Cognito Pricing](https://aws.amazon.com/cognito/pricing/)
- [S99] [Amazon Cognito — Access tokens](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html)
- [S100] [Amazon Cognito — Email settings](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html)
- [S101] [Amazon Cognito — Quotas](https://docs.aws.amazon.com/cognito/latest/developerguide/quotas.html)
- [S102] [Amazon Cognito — Custom message Lambda trigger](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-custom-message.html)
- [S103] [Amazon SES Pricing](https://aws.amazon.com/ses/pricing/)
- [S104] [Aurora DSQL — Unsupported PostgreSQL features](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-unsupported-features.html)
- [S105] [Aurora DSQL — CREATE TABLE syntax support](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/create-table-syntax-support.html)
- [S106] [Aurora DSQL — Supported SQL features](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-supported-sql-features.html)
- [S107] [AWS Fargate — Pricing](https://aws.amazon.com/fargate/pricing/)
- [S108] [Amazon ECS — Fargate のタスクサイズ](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html)
- [S109] [Amazon RDS for PostgreSQL — Pricing（無料枠・T4g CPU クレジットのみ取得）](https://aws.amazon.com/rds/postgresql/pricing/)

**リポジトリ（📐）**
- `docs/specs/010-system-overview.md`、`090-karaoke-reservation-specification.md`、`100-database-design.md`（§28.1、§46〜§49、§53、§58、§60〜§61）、`140-security-specification.md`、`150-reliability-error-recovery.md`、`170-test-specification.md`、`180-infrastructure-deployment.md`（§16〜§17、§21〜§24、§32〜§36、§64〜§66）
- `docs/drafts/payment-pr-plan.md`、`payment-m1-open-items.md`
