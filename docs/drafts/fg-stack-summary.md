# 構成 F・G の技術スタック整理（コスト・セキュリティ）

> 状態: **検討資料（正式仕様ではない）**。`docs/specs/` は変更していない。
> 作成日: 2026-10-24 / 改訂: 2026-10-24（13 構成での再採点を反映）
> 元資料: `d1-migration-review.md`。出典番号 `[S#]` は同資料の Sources に対応する。記号は ✅ 一次情報で確認 / 📐 リポジトリで確認 / ⚠️ 推定・未確認。
> 前提: AWS のサービスを自分で契約・運用しない。為替は $1 = ¥150。料金は 2026-10-23 時点。
>
> **【過去の比較資料】** 本書は、**旧仕様（Next.js on Vercel / Railway の Hono / Supabase PostgreSQL + Supabase Auth）を「現行」とした、2026-10-24 時点の比較**である。表の「現行からの変更」「Railway から移行」「Supabase PG から移行」「Next.js 16 on Vercel」は旧構成との比較であり、**現在の仕様ではない**。
>
> 2026-10-25 の構成改定（PR #20、`SPEC-010` §8.1.1）で、Canonical 仕様は次のとおりになった。本書の F・G とは異なる構成である。
>
> - Web: **Cloudflare Pages** の静的 SPA（Vite / React Router）。Next.js on Vercel ではない。
> - API・認証中継・Email Worker・Reconciliation Worker: **Railway**。Workers / Durable Object / Hyperdrive は採用していない。
> - DB・認証: **Neon PostgreSQL**（シンガポール）+ **Neon Auth**。Better Auth の自前運用（本書の G）は採用していない。
> - 認証情報の参照: 限定ビュー `auth_read.identity_directory` だけ（`SPEC-100` §5.1）。
>
> 現行仕様と食い違う場合は `docs/specs/` が優先する。構成 F の評価（4.1・4.3 など）は、旧仕様を基準にした値であり、現行仕様の採用構成の評価ではない。

## 1. 構成の違い

F・G は、DB を Neon PostgreSQL に置き、Workers + Hyperdrive から接続する点が共通で、**認証だけが違う**。

| 構成 | 認証 | 運用責任 |
|---|---|---|
| F | Neon Auth（Managed Better Auth）| 提供元 |
| G | Better Auth（Workers 上の Hono にマウント、自前運用）| 自分 |

## 2. 技術スタック

### 2.1 共通部分

| 層 | 採用技術 | 現行からの変更 |
|---|---|---|
| Web | Next.js 16 on Vercel | なし |
| API | Hono + Zod を **Workers** で動かす | Railway（Node）から移行。`process.env` は binding へ、`pg` 接続プールは Hyperdrive へ、SIGTERM 処理は廃止 |
| Email Worker / Reconciliation Worker | **Durable Object の alarm**（15 秒 tick を自己再スケジュール）| Railway 常駐プロセスから作り直し。1 object に alarm は 1 つ、at-least-once、失敗時は指数 backoff ✅[S14] |
| DB 接続 | **Hyperdrive**（Neon への公式手順あり。プールなしの直接接続文字列、`pg` 8.16.3 以上、`nodejs_compat`。Neon serverless driver は使わない）✅[S54] | 新規。transaction mode のため `SET` は持続しない ✅[S18] |
| DB | **Neon PostgreSQL 17**（`btree_gist` 1.7 に対応。EXCLUDE 制約を維持）✅[S51]。Drizzle（PostgreSQL 版）をそのまま使う | Supabase PG から移行。業務 DB の仕様（行ロック、EXCLUDE、DB ロール）は維持できる |
| 決済 | Stripe（stripe-node の `workerd` ビルド、`constructEventAsync`）✅ | Webhook は Workers 用に非同期署名検証へ |
| メール | Resend（Workers 向けガイドあり）✅ | なし |
| バックアップ | `pg_dump` → 暗号化 → R2（日次 35 日 + 月次 400 日）| 仕様どおり継続。Neon の復元履歴（PITR）は Launch で最大 7 日のため、要件を満たせない ✅[S53] |
| 監視 | Better Stack、Healthchecks.io | HTTP 経由のまま。メトリクスは push 化 |

⚠️ `pg_dump` は Workers 内では実行できないため、実行場所（GitHub Actions のスケジュール実行など）を別に決める必要がある。本調査では未検討。

### 2.2 認証部分

| 項目 | F: Neon Auth | G: Better Auth |
|---|---|---|
| 実体 | Better Auth のマネージド版。GA ✅ | OSS ライブラリ（MIT）✅ |
| データの置き場 | 同じ Neon DB の `neon_auth` スキーマ ✅ | 別 DB か別スキーマ・別ロールに分ける設計が可能（Kysely/Drizzle 経由）|
| JWT | 15 分**固定**、EdDSA、`/.well-known/jwks.json` ✅ | 既定 15 分（設定可）、EdDSA、`/api/auth/jwks`。鍵ローテーションは既定オフ ✅ |
| Workers 側の役割 | JWKS で JWT を検証。メールは webhook を受けて送信 | Hono に `app.all("/api/auth/*")` でマウント。`nodejs_compat` が必要 ✅ |
| 使えるプラグイン | Admin、JWT、Email OTP、Magic Link など。**漏洩検知・captcha・rate limit・bearer は対応リストにない** ✅ | 漏洩検知（HIBP）、captcha（Turnstile など）、rate limit、admin ほか ✅ |
| メール | 確認リンクは独自 SMTP が必須。文面を変えるには webhook（`send.otp` など）で自前送信 ✅ | 自前送信（`sendVerificationEmail` など）|

## 3. コスト

### 3.1 月額の内訳

| 項目 | F | G | 根拠 |
|---|---|---|---|
| Workers Paid | $5 | $5 | ✅[S12]。Hyperdrive は追加料金なし、DO・Queues は込み分内の見込み |
| Neon Launch 本番 | 約 $19.4 | 約 $19.4 | 0.25 CU 常時稼働 = 182.5 CU 時間 × $0.106 ✅[S53]（導出）|
| Neon ストレージ | 約 $1.75 | 約 $1.75 | 5GB × $0.35。容量は仮定 ⚠️ |
| staging・dev | $0〜10 | $0〜10 | ブランチでゼロスケールにして使用分のみ。仮定 ⚠️ |
| 認証 | $0（Neon Auth は全プランに含まれる。MAU 上限は Launch 100 万）| $0（ライブラリは無料）| ✅ |
| **合計** | **約 $26〜40（¥3,900〜6,000）** | **約 $26〜40** | 現行 A の $60〜130 に対し、月 $20〜100 の削減 |

### 3.2 追加で発生しうるコスト

| 項目 | 金額 | 備考 |
|---|---|---|
| Neon を常時稼働にしない（ゼロスケール）| 本番の約 $19 が減る | 復帰に数百ミリ秒かかる ✅。会費・チケット処理で許容できるかは別途判断 |
| Neon Scale（PITR 30 日、SLA、IP Allow）| 本番の計算が約 $40.5（182.5 CU 時間 × $0.222）。合計 約 $47〜 | F は IP Allow と Neon Auth を併用できないため、Scale にする利点は PITR と SLA に限る ✅ |
| Better Auth Infrastructure Pro（G）| $20/月 | 監査ログ 2 万件/月、セキュリティ検知 1 万件/月、メール $0.001/通など ✅[S73]。G の合計は約 $46〜60。採点はコスト点が 4 → 3 相当で下がる |
| Neon のブランチ追加 | $1.50/月 | 10 を超える場合 |
| Neon Auth の MAU 超過 | 記載なし ⚠️ | 本アプリの規模では 6 万 MAU の Free 枠でも足りる見込みで、実質影響は小さい |
| 人件費・仕様改訂 | 含まない | 追加作業量は F が約 2〜4.5 週間、G が約 2.5〜5 週間 ⚠️ |

### 3.3 コスト面のまとめ

- F と G の月額は同じ。**差は作業量と運用負担**に出る。
- 最大の変動要因は Neon の使用量（CU 時間）で、仮定のため実測が要る。
- 採点上のコスト点は 4（$15〜35 帯の上端付近）。staging・dev の使い方によっては $35 を超え、コスト点が 3 に下がる（基本 → コスト高位: F 3.35 → 2.95、G 3.55 → 3.15）。

## 4. セキュリティ

### 4.1 仕様要件への適合

| 要件 | F: Neon Auth | G: Better Auth |
|---|---|---|
| アクセストークン寿命 900 秒以下（SEC-AUTH-004）| 15 分固定で適合 ✅ | 既定 15 分で適合 ✅。ログアウト後も最大 15 分有効なので許容範囲の確認が要る ⚠️ |
| JWKS 検証（SEC-AUTH-001/002）| 検証側（Hono の JWK ミドルウェア）で iss・aud を**明示設定**する必要がある ✅ | 同左 |
| パスワード長 12〜128（SEC-AUTH-016）| 最大 128 のみ記載。最小長を設定できるか**不明** ⚠️ | `minPasswordLength` を 12 に設定 ✅ |
| 漏洩パスワード検知（SEC-AUTH-017）| プラグイン非対応 ✅ | `haveIBeenPwned` プラグイン（SHA-1 の先頭 5 文字のみ送信）✅ |
| ボット対策（SEC-AUTH-019）| プラグイン非対応 ✅。前段で Turnstile を挟む案は未検討 ⚠️ | captcha プラグイン（Turnstile 対応）✅ |
| 資格情報を業務 DB に置かない（AR-AUTH-011、SEC-AUTH-006）| 同じ DB の別スキーマ。当時は**仕様の解釈が必要**（またはスキーマ・ロール分離）としたが、**現行仕様は整理済み**: `neon_auth` は Provider 所有で、`app` / `auth_read` に資格情報を置かず、runtime ロールに元テーブルの権限を与えない（`SPEC-060` `AR-SES-001`、`SPEC-100` `DB-ARC-004`・§5.1）| 別 DB か別スキーマ・別ロールに分けて満たせる ⚠️ |
| `sub` からのメール・検証状態の引き当て（SPEC-120 §15）| 管理 API に一覧・取得の記載なし。当時は `neon_auth` スキーマの直接参照案 ⚠️。**現行仕様は直接参照を採らず**、限定ビュー `auth_read.identity_directory`（`auth_subject` / `email` / `email_verified` の 3 列）だけを API と Email Worker が読む（`SPEC-100` §5.1、`SPEC-120`）| admin プラグインは admin ヘッダが必要。読み取り専用ロールで直接参照する案 ⚠️（現行仕様では採用しない）|
| 認証障害時は fail closed | 提供元の障害に依存。SLA は Launch になし ✅ | 自前の可用性 |

### 4.2 共通のセキュリティ事項

| 項目 | 内容 |
|---|---|
| DB の保証 | 行ロック（`FOR UPDATE`）、EXCLUDE、DB ロール分離は PostgreSQL のまま維持できる。Hyperdrive 経由の動作は spike で確認 ⚠️ |
| Hyperdrive の制約 | transaction mode。`SET` は `SET LOCAL` へ、session 単位の advisory lock は transaction 単位または lease 方式へ ✅[S18] |
| データの所在 | Neon に東京リージョンはなく、最寄りはシンガポール ✅[S50]。個人情報が国外に保管される点は、運営の方針として確認が要る（法的な判断は対象外）|
| ネットワーク制限 | Launch には IP Allow がない ✅。F は Scale の IP Allow と併用不可 |
| 秘密情報 | Workers Secrets（運用方法は一次情報を未参照 ⚠️）。DB 接続文字列、Stripe・Resend のキー、認証の署名鍵 |
| バックアップ | 仕様どおり `pg_dump` を継続。認証情報（G は別 DB なら別にバックアップ）も機密として扱う |

### 4.3 F 固有のリスク

- 漏洩検知・captcha・rate limit が使えず、SEC-AUTH-017・019 を満たす手段が別途必要。
- パスワード最小長 12 文字を設定で満たせるか不明。
- JWT 寿命が固定で変更できない。
- 認証情報が業務 DB と同じ Neon DB に入る（現行仕様では、`neon_auth` を Provider 所有として分離し、runtime ロールからは `auth_read.identity_directory` の 3 列だけを読む形で整理済み）。
- IP Allow・Private Networking を有効にしたプロジェクトでは Neon Auth を使えない ✅。
- 提供元の仕様変更（`neon_auth` スキーマの安定性の記載なし）に追従する必要がある ⚠️。現行仕様では、限定ビューの元になる列・UUID 形式・grant を Provider 契約テストで確認し、崩れたら fail closed とする（`SPEC-100` §5.1）。
- 利点: 脆弱性への対応や更新を提供元に任せられる。

### 4.4 G 固有のリスクと対策

GitHub のセキュリティアドバイザリを 4 ページ分（計 32 件）確認した（1 ページ分は未取得）。多くは本構成で使わないプラグインの問題で、コアに影響した例は次のとおり ✅[S82]。

- レート制限が IPv6 プレフィックスの変更で回避できる（High、2026-05）
- パスの二重スラッシュで `disabledPaths` とレート制限を回避できる（High、2025-12）
- `trustedOrigins` の回避によるアカウント乗っ取り（High、2025-02）
- メール確認エンドポイントのオープンリダイレクト（Critical、2024-12）
- Cookie キャッシュ使用時の 2FA バイパス（High、2026-04）

リリースは 15 日間で 8 回、v1.7.0 は破壊的変更が多かった ✅[S83]。**更新と脆弱性対応の責任を自分で負う**。

優先して対応するもの:

1. 使うプラグインを絞り（メール+パスワード、JWT、漏洩検知、captcha）、バージョンを固定し、更新の運用（検知・検証・期限）を決める。
2. レート制限は永続ストレージで原子的なカウンタにし、実クライアント IP（`cf-connecting-ip`）を認証層まで渡す。Cloudflare の Rate Limiting binding も重ねる（ただし拠点ごとの近似値）。
3. Cookie キャッシュを無効にするか短くし、`revokeSessionsOnPasswordReset` を有効にする。
4. scrypt の既定値は OWASP の最小構成より作業量が約 1/4。`password.hash` で強度を上げ、Workers の CPU 30 秒・メモリ 128MB の範囲で実測する。
5. 認証情報を業務 DB から分離し、ロールも分け、バックアップも機密として扱う。
6. メール送信（再送、バウンス、日本語テンプレート）、監査ログ、インシデント対応手順（全セッション失効、署名鍵の入れ替え）を自前で用意する。

## 5. 比較と判断

| 観点 | F | G |
|---|---|---|
| 月額 | 約 $26〜40 | 約 $26〜40（Infrastructure Pro で +$20）|
| 採点（基本、13 構成中）| 3.35（7 位）| 3.55（4 位）|
| 仕様適合（認証）| 漏洩検知・captcha・最小長に不足 | 標準プラグインで満たせる |
| 運用負担 | 小さい | 大きい（更新、脆弱性対応、監査、メール）|
| 追加作業量 | 約 2〜4.5 週間 | 約 2.5〜5 週間 |
| 向く場合 | 運用に手を割けず、機能の不足を別手段で補える | 仕様どおりの認証機能が必要で、運用責任を負える |

⚠️ 以下は判断であって確認済みの事実ではない。

- 仕様（SEC-AUTH-016・017・019）を設定だけで満たしたいなら G。
- 運用責任を最小にしたいなら F だが、不足する要件を補う実装が要る。
- 比較対象を 13 構成に広げた再採点（`d1-migration-review.md` 第 11 章）では、Supabase を維持して staging・dev を使う時間だけ動かす縮小運用の構成（H: 月 $46〜77、I: 月 $39〜63）が基本ケースの上位（H 3.65、I 4.00）で、G は 3.55、B は 3.50。F・G の月額優位は、縮小運用の Supabase 構成との比較では約 $5〜30 に縮まる。
- F・G を選ぶ理由は、コストよりも「Supabase を使わない方針があるか」にほぼ依存する。

## 6. 次に確かめること（spike）

| # | 内容 | 対象 |
|---|---|---|
| 1 | Workers → Hyperdrive → Neon（シンガポール）で、Hold 取得など複数文の transaction の所要時間を測る。許容値は先に決める | F・G |
| 2 | Neon で `btree_gist` の EXCLUDE 制約を張り、Hyperdrive 経由の `SELECT ... FOR UPDATE` で並行テストする（二重販売 0 件）| F・G |
| 3 | `SET LOCAL` による timeout と `pg_try_advisory_xact_lock` が Hyperdrive 経由で動くか | F・G |
| 4 | Durable Object alarm で 15 秒 tick を動かし、重複処理が起きないか | F・G |
| 5 | Better Auth を Workers 上で動かし、`nodejs_compat`、rate limit の保存先、`advanced.backgroundTasks`、ハッシュの CPU 時間を確認する | G |
| 6 | Neon Auth でパスワード最小長 12 文字を満たせるか、検証メールを webhook 経由で日本語送信できるかを確かめる | F |
| 7 | `pg_dump` を実行する場所（GitHub Actions など）と、Neon Launch のバックアップ保持が仕様（日次 35 日 + 月次 400 日）に合うか | F・G |

## 7. 未確認事項

- Neon Auth: セッション寿命、パスワード最小長、組み込みの rate limit の有無、管理 API でのユーザー一覧・取得（現行仕様は管理 API を前提にせず `auth_read.identity_directory` を使う）、`neon_auth` スキーマの安定性、MAU の超過単価。
- Better Auth: Workers での `advanced.backgroundTasks` の設定、パスワードハッシュの形式と他サービスへの移行互換性、未取得のアドバイザリ 1 ページ分、メンテナ体制と SLA。
- Hyperdrive: advisory lock の可否。
- Neon: Launch のバックアップ保持と仕様との関係、使用量（CU 時間）の実測。
- Hono の Workers での動作と Secrets の運用（一次情報を未参照）。
- 現行 Supabase のリージョン（遅延の比較基準）。
