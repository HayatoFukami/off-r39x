# off r39'x in 大阪らへん2027

イベント「off r39'x in 大阪らへん2027」の Web システムです。公開イベントサイト、アカウント・認証、入場チケット販売、カラオケ予約、グッズ販売、マイページ、管理・スタッフ受付、メール通知を一体のシステムとして扱います。

業務ルール、API、DB、画面、テストの正式な定義は [docs/specs/](docs/specs/) の仕様書（`SPEC-000`〜`SPEC-200`）にあります。この README は入口であり、仕様の内容は複製しません。矛盾がある場合は仕様書が正です。

## 現在の状態

実装済みなのは、フロントエンドの**画面モック**（UI mock）です。Hono API、DB、認証、決済、メールの実装はまだありません。

| 領域 | 状態 |
|---|---|
| 仕様書（`docs/specs/`） | 21 本。いずれも `provisional` |
| 画面モック（`apps/web`） | 公開ページ、Cart、Entry 販売、Goods、認証、購入開始と mock Checkout、購入状況、Karaoke の Slot 詳細と購入、マイページ、QR 表示 |
| ドメインの純粋ロジック（`packages/domain`） | 状態の型と網羅性検査 |
| 検査用スクリプト（`scripts/`） | import 境界、traceability、Secret スキャン、mock 用の起動 |
| Hono API、DB、Supabase Auth、Stripe、Resend | 未実装（仕様上の計画） |

モックは、画面の表示・導線・アクセシビリティの確認だけを目的とします。API の契約、DB 制約、決済 Provider の動作を検証したことにはなりません（`SPEC-190` DEV-WEB-010、`SPEC-170` TST-E2E-004）。

## 技術スタック

仕様上の採用技術は `SPEC-010 §8.1` のとおりです。

| 領域 | 技術 |
|---|---|
| 言語 / モノレポ | TypeScript / pnpm workspaces |
| Web | Vite / React / React Router（静的 SPA）/ Tailwind CSS / shadcn/ui |
| API（計画） | Hono / Zod / Hono RPC |
| DB・認証（計画） | Supabase PostgreSQL / Supabase Auth |
| 決済・メール（計画） | Stripe Checkout・Webhook / Resend |
| テスト | Vitest / Playwright |
| Lint / Format | Biome |

データの流れは `Browser → React SPA（静的配信） → Hono API → Supabase PostgreSQL` です。ブラウザと React SPA は Business Database に直接アクセスしません。認証・所有者・価格・在庫・決済結果は、サーバー側が権威です。

## リポジトリ構成

構成の正式な定義は `SPEC-190 §6` です。現在存在するものだけを示します。

```text
.
├─ apps/web/             Vite + React Router の静的 SPA（画面モックを含む）
│  ├─ index.html         静的 shell
│  ├─ vite.config.ts     build 設定、mock の本番ガード
│  └─ src/
│     ├─ routes/         React Router の route 定義（薄い route module と root layout）
│     ├─ routing/        React Router の adapter（Link、ナビゲーション hook）
│     ├─ features/       画面ごとの container と純粋ロジック
│     ├─ presentation/   見た目の部品、文言（copy/ja.ts）、表示形式
│     ├─ api-client/     API の port（呼び出し口）
│     ├─ auth/           認証の port、Continuation、AuthGate
│     ├─ config/         サイト設定、route、素材
│     └─ mock/           UI mock の実装（合成データ、mock 認証、dev 用 UI）
├─ packages/domain/      ドメインの純粋な型と判定
├─ tests/                unit / e2e / harness / contracts / traceability
├─ scripts/              開発用の検査スクリプト
├─ traceability/         Rule とコードの対応（rule-code-map.json）
├─ docs/specs/           正式仕様書
├─ docs/drafts/          設計メモ（正式仕様ではない）
```

## セットアップ

必要なもの: Node 24.x、pnpm 12.3.4（`package.json` の `packageManager` と同じ版）。

```powershell
corepack enable
pnpm install --frozen-lockfile
```

仕様上の標準の build 手順は `SPEC-180 §43` です（`corepack enable` → `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck` → テスト → `pnpm build`）。

> Corepack 0.32 は pnpm 12 を起動できないことがあります（`Cannot find module '...\pnpm.cjs'`）。その場合は Corepack を使わず、`corepack disable` のあとに `npm install -g pnpm@12.3.4` で pnpm を直接入れてください。

## モックの起動

モックは `VITE_UI_MOCK=1` のときだけ有効です。このフラグが無いと、実 API の生成が失敗して画面は動きません（fail closed。`SPEC-190` DEV-WEB-011）。次のスクリプトがフラグを設定するので、フラグのために追加の設定は要りません（Windows でも同じです）。ただし `pnpm build:mock` には、フラグとは別に `APP_ENV` の指定が必要です（下記）。

`pnpm build:mock` は環境名の変数 `APP_ENV` の明示が必須です（`development` / `staging` / `test` のどれか。未設定でも通る既定値はありません）。

```sh
# bash
APP_ENV=development pnpm build:mock   # モック有効でビルド（出力: apps/web/dist）
pnpm start:mock                       # ビルド済みのモックを配信（既定: http://127.0.0.1:3100）
```

```powershell
# PowerShell
$env:APP_ENV = "development"; pnpm build:mock   # モック有効でビルド（出力: apps/web/dist）
pnpm start:mock                                 # ビルド済みのモックを配信（既定: http://127.0.0.1:3100）
```

`start:mock` は `apps/web/dist` を `scripts/serve-web-dist.mts` で配信し、`dist/_headers`（security header を含み、`Cache-Control: no-store` と `Pragma` は content-hash 付き asset の正規の path 以外の全応答に、`Referrer-Policy: no-referrer` は hash 付き asset を含む全応答に付く）を適用します。ポートを変えるには `pnpm start:mock --port 3200` とします（`--` は付けません）。開発サーバー（Vite。モックが既定で有効）で確認する場合は、`pnpm dev` を実行します（URL は Vite が表示します）。

### モックの使い方

- **シナリオ切り替え:** `/dev/scenarios` で、決済結果、Hold の失敗、通信エラーなどを切り替えます。`/dev/*` はモックが有効なときだけ表示され、一般向けのナビゲーションからはリンクされません。
- **ログイン:** mock 認証です。アカウント登録は画面から行えます。seed のユーザーの表示名は「デモ太郎」です。
- **購入の流れ:** Cart または Karaoke の Slot から購入を開始すると、`/dev/mock-checkout/...` に遷移します。ここで決済は行いません。購入状況ページの表示は、ブラウザの戻りではなく、サーバー側が返す Order の状態で決まります。
- **状態のリセット:** データはブラウザの localStorage に保存されます（`r39x.mock.*` と Cart 用の `r39x.cart.v1`）。リセットするには、開発者ツールでこのサイトの localStorage を削除します。
- **使ってはいけないもの:** モックに、パスワード、Secret、実際の QR Token、実際の個人情報を入れないでください。QR は合成のプレースホルダです。

モックを有効にする（`VITE_UI_MOCK=1`）ビルドは、fail closed です。`APP_ENV` が `development` / `staging` / `test` と完全一致するときだけ通り、未設定、空文字、大文字小文字違いや前後の空白付き、別名（`prod`、`dev` など）、`production` では失敗します（エラー文言に `APP_ENV` の値は出ません）。開発サーバーは、未設定のときだけ `development` を補う点がビルドと違います（空文字、不正な値、`production` は失敗します）。経路ごとの未設定の扱いは次のとおりです。

- `pnpm build:mock`（`scripts/mock-web.mts build`）は既定値を与えません。`APP_ENV` を明示しないと失敗します（`production` は `ERROR mock-web-production`、未設定と不正な値は `ERROR mock-web-app-env-invalid`）。`VITE_UI_MOCK=1` を付けた `pnpm build` の直接実行も同じ判定を受け、`APP_ENV` が許可値でなければ Vite の設定の読み込みで失敗します（許可値なら成功します）。
- `pnpm dev` だけは、`APP_ENV` が未設定のときに `development` を補います（手元専用で、deploy する成果物を作りません）。明示した値は上書きせず、不正な値と `production` は起動に失敗します。
- `pnpm start:mock` は build を行わないので、`APP_ENV` が未設定なら通ります。設定されているときは、`production` と不正な値を拒否します。
- `pnpm test:e2e` は、`APP_ENV=test` で build と配信を行います（親の `APP_ENV` は無視します）。
- 実行時の `/dev/*` も同じ許可値のときだけ開きます。

この判定は、`APP_ENV` を静的な Web の build に使うという、このリポジトリの選択です（`SPEC-190` DEV-AI-003）。`SPEC-180 §9` は `APP_ENV` を server process の変数として挙げており、Web の静的 build 用とは書いていません。仕様本文は変えていません。upload 時にも判定するか、UCR にするかは Issue #29 で検討を続けます。

実 API・実認証を導入するときは、`apps/web/src/mock/` と `apps/web/src/routes/dev/` を削除でき、画面側の変更が要らない形（port）を保ちます（`SPEC-190` DEV-WEB-012・013）。

## 品質確認のコマンド

```powershell
pnpm lint                     # Biome
pnpm typecheck                # 型検査（domain / web / tests）
pnpm check:boundaries         # import の依存方向と禁止 edge の検査
pnpm validate:traceability    # テストの manifest と rule-code-map の整合
pnpm test:unit                # Vitest
pnpm secret-scan              # Secret・実 QR・PII らしい値の検出（値は出力しない）
pnpm test:e2e                 # Playwright（モック用の補助 suite）
```

- `pnpm secret-scan` は、ビルド出力も走査するなら `APP_ENV=development pnpm build:mock`（PowerShell では `$env:APP_ENV = "development"; pnpm build:mock`）の後に実行します。
- `pnpm secret-scan` は、リポジトリ直下のファイル、`.github/**`、`apps/**`、`packages/**`、`scripts/**`、`tests/**`、`traceability/**` と、ビルド出力の `apps/web/dist/**` を走査します。ビルド出力では値を検出する rule を全ファイルに適用し、`mock-seed-field` は dist の HTML に限定します。`OK` は、これらの走査範囲に問題がないことだけを示します。
- `pnpm test:e2e` は、`VITE_UI_MOCK=1` と `APP_ENV=test` で `apps/web/dist` のビルドと配信を自動で行います（`127.0.0.1:3100`。`start:mock` の既定と同じポートなので、同時には使えません）。desktop と mobile の 2 project で動き、再試行はしません。
- この Windows 開発機では、並列度 2 の E2E が稀にホストの接続障害で失敗します。その場合は `cd tests; pnpm exec playwright test --workers=1` で実行してください。
- E2E は UI mock の補助 suite です。実 DB・実 API・Provider を使う正規の E2E（`SPEC-170` の G8）の代わりにはなりません。

## 開発の進め方

- **仕様が先:** 画面の挙動、公開インターフェース、業務ルールを変えるときは、実装より先に該当の仕様書を改訂します（`AGENTS.md §7`）。
- **変更の分類と必読仕様:** `SPEC-190 §33` の表で決めます。
- **役割分担:** プランニング、テスト、コーディングの各担当と、その書き込み範囲は `AGENTS.md §4` にあります。テストを先に書き、実装し、検証する流れです。
- **ブランチ:** 作業は `dev` ブランチで行います。`main` へのマージは手動です。
- **テストの追跡:** テストは `tests/traceability/test-manifest.json` で、コードは `traceability/rule-code-map.json` で、Rule ID に紐づけます。

## ドキュメント

| 場所 | 内容 |
|---|---|
| [docs/specs/](docs/specs/) | 正式仕様書。読む順序と優先順位は `SPEC-000` |
| [docs/drafts/ui-mock-design.md](docs/drafts/ui-mock-design.md) | 画面モックの設計（承認済み） |
| [docs/drafts/frontend-design.md](docs/drafts/frontend-design.md) | フロントエンドの技術スタックと要件の整理 |
| [docs/drafts/konbini-payment-review.md](docs/drafts/konbini-payment-review.md) | コンビニ決済の検討資料（開発チームで検討中） |
| [docs/drafts/spec-diff-old-new.md](docs/drafts/spec-diff-old-new.md) | 画面モック作成に伴う仕様書の新旧差分 |
| [tests/contracts/](tests/contracts/) | スライスごとのテスト契約（DOM、文言、挙動） |
| [AGENTS.md](AGENTS.md) | AI エージェント向けの作業ルール |

`docs/drafts/` は正式仕様ではありません。

## ライセンス

GNU General Public License v3.0 です。詳細は [LICENSE](LICENSE) を参照してください。
