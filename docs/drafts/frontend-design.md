# フロントエンド設計ドラフト（技術スタック・要件）

> 状態: **ドラフト（正式仕様ではない）**。`docs/specs/` は変更していない。
> 承認後、必要な箇所を `SPEC-000` の手続きで仕様（主に `SPEC-050`、必要なら `SPEC-010`）へ反映する。

## 1. 入力と位置づけ

| 入力 | 使い方 |
|---|---|
| 参考サイト（hololive PRO「personyarespect」） | **ページ構成・導線・演出の型のみ**参考にする。画像・ロゴ・文言・キャラクター・動画サムネ等は一切流用しない |
| `ref/Dev/payment-mock`（試作モック） | 技術選定・購入フロー画面・状態表示の実装方針の叩き台 |
| `docs/specs/` | 技術スタック（SPEC-010 §8.1）、Page/Route（SPEC-050）の**Canonical**。矛盾時は仕様が正 |

## 2. 参考サイトのページ構成（構造のみ）

単一ページ型のイベントLP。

1. 固定ヘッダー: ロゴ + 主要CTA（チケット購入）+ ナビ（TOP / NEWS / TICKETS / ALBUM / MERCH / VIDEOS / INFORMATION）
2. ファーストビュー: 全幅キービジュアル、タイトルロゴ、日時・会場・開場/開演・配信情報
3. NEWS: 日付付きリスト（3件表示 + VIEW MORE）
4. MERCH / メッセージボード: バナー + 導線
5. ALBUM / VIDEOS: 作品紹介、動画サムネイルグリッド
6. プロフィール・ポエム: 装飾的な読み物セクション
7. フッター: SNSシェア（X / LINE / Reddit / Facebook）、主催・協賛ロゴ

### 本プロジェクトへの対応づけ

| 参考サイト | 本プロジェクト | 備考 |
|---|---|---|
| TOP / KV | `/` Event Home（PG-PUB-001）ヒーロー | 画像は自作またはプレースホルダ |
| NEWS | `/announcements`（PG-PUB-002/003）+ Home抜粋 | VIEW MORE → 一覧 |
| TICKETS | `/entry`（PG-TKT-001）、`/karaoke`（PG-KRK-001〜003） | 固定ヘッダーCTAは `/entry` |
| MERCH | `/goods`（PG-GDS-001/002） | 会場受け取りのみ |
| INFORMATION | Home内の会場・アクセス / 注意事項 / FAQ セクション（アンカー） | SPEC-050 §11.1 |
| ALBUM / VIDEOS / プロフィール / ポエム | **対応する仕様なし → 対象外** | 必要なら先に仕様追加（§9 論点1） |
| SNSシェア | フッターのシェアボタン | 仕様未記載（§9 論点2） |

参考サイトにない要素（Account、Mypage、Purchase Status、QR）は SPEC-050 の定義どおり追加する。

## 3. 技術スタック

### 3.1 確定（SPEC-010 §8.1。置換不可）

TypeScript / pnpm workspaces / Next.js（App Router）/ React / Tailwind CSS / shadcn/ui / Hono RPC クライアント / Zod / Supabase Auth / Vitest / Playwright / Biome / Vercel

### 3.2 モックの実績（そのまま踏襲してよいもの）

Next.js 16 / React 19 / Tailwind CSS v4（`@tailwindcss/postcss`）/ shadcn（`components.json`、`@base-ui/react` ベース）/ `class-variance-authority` / `lucide-react` / `tw-animate-css` / `next/font`

### 3.3 追加提案（要承認）

| 用途 | 提案 | 理由 |
|---|---|---|
| 日本語フォント | `next/font` で Noto Sans JP（サブセット）。見出し用に1書体まで | モックのGeistは欧文のみ |
| Supabase Auth連携 | `@supabase/ssr`（Cookieベース）。Browserは **Authのみ** 利用 | SPEC-060 §8。Business DBへ直接アクセスしない |
| API呼び出し | Hono RPC client（`hono/client`）。型は `packages/shared` 経由で共有 | SPEC-110。Server Component / Route Handler から呼ぶ |
| フォーム | Server Actions or Client + Zod、`useActionState` で状態管理。React Hook Form は複雑なフォームが出た時のみ | 依存を最小に |
| 状態再取得（`AWAITING_PAYMENT` 等） | 小さなpolling hook（上限・間隔つき）。TanStack Queryは必須としない | 仕様上「状態を再確認」は手動操作が基本 |
| QR描画 | 軽量なQR生成ライブラリ（候補: `qrcode`）。**Tokenはログ・URL・テキストに出さない** | SPEC-080 / SPEC-140 |
| アニメーション | CSS（Tailwind + `tw-animate-css`）中心。`prefers-reduced-motion` 対応必須。重いスクロール演出ライブラリは使わない | 参考サイトの演出は軽量に再現 |
| コンポーネント試験 | Vitest + Testing Library（`jsdom`/`happy-dom`）、a11y確認に `@axe-core/playwright` | SPEC-170 と整合 |

### 3.4 モックから**変えるべき**点

| モック | 本実装 | 根拠 |
|---|---|---|
| 状態を `localStorage` に保持（`StoreProvider`） | 全て Hono API が権威。クライアント状態はUI用途のみ | SPEC-010 §10, INV-010-08/09 |
| ESLint | Biome | SPEC-010 §8.1 |
| 擬似認証・権限チェックなし | Supabase Auth + Server側検証。Page guardはUX用で最終認可ではない | SPEC-060 |
| `[orderId]` 等のID | `{order_ref}` 等のReference（知っているだけで権限根拠にしない） | SPEC-050 §5.2 |
| `max-w-3xl` 単一カラムのみ | 公開LPはフルブリード、購入/Mypageは読みやすい幅 | §5 |
| カート（`/cart`）・コンビニ払い・複数Domain同時購入 | **SPEC-050/070 に存在しない**。採用するなら先に仕様変更（§9 論点3） | AGENTS §7 |
| `/staff`・`/admin` を同一レイアウト・フッターから直リンク | 一般利用者Navigationから分離。個別画面は SPEC-130 | SPEC-050 §8.4, §27 |
| Announcement / Not Found / Access Denied / Email Verification なし | 実装対象（PG-PUB-002/003, PG-XFN-002/003, PG-AUTH-002） | SPEC-050 §7 |

## 4. レンダリング戦略

| ページ群 | 方式 | 補足 |
|---|---|---|
| `/`, `/announcements*`, `/goods*`, `/entry`, `/karaoke*` | Server Component。公開情報は短いrevalidate or dynamic | 販売可否は表示用。購入開始時にServerが再検証（Browser Back対策） |
| `/account/*` | Client Component中心（フォーム） | Credentialを自前保存しない |
| `/purchase/orders/*`, `/mypage/*` | **dynamic（キャッシュなし）、Server側でOwnership検証後にデータ取得** | 他者データを一度もClientへ送らない（SPEC-050 §26.2） |
| 状態再確認が必要な箇所 | Server初期描画 + Client再取得 + `aria-live` 通知 | §6.3 |

- Next.js Web から Business DB へ接続するコード・環境変数は置かない。
- Route Handler / Server Action は Hono API へのプロキシ・Cookie橋渡しに限定する。

## 5. デザイン要件

### 5.1 ビジュアル方針（参考サイトの型を独自表現で）

- 公開ページ（`/`, `/announcements`）: ヒーロー → 開催情報 → NEWS → 販売ショートカット → 会場/注意事項/FAQ → フッター の縦スクロール。固定ヘッダーに「チケット購入」CTAを常設。
- 購入・Mypage: 装飾を抑え、状態と操作の明瞭さを優先（モックのカード中心UIを踏襲）。
- デザイントークン（色・角丸・余白・書体）は `globals.css` の CSS変数で一元管理。ライト/ダーク対応は将来拡張（初期はライトのみで可、トークンは対応可能な形にする）。
- ヒーロー画像・ロゴ・イラストは **自前制作 or 権利確認済みの素材のみ**。参考サイトの画像/ロゴ/フォント/文言は使わない。素材未確定の間はグラデーション + テキストのプレースホルダ。

### 5.2 共通コンポーネント

`Header`（固定、Guest/Authenticated切替、モバイルはドロワー）、`Footer`、`SectionHeading`、`NewsList`、`ProductCard`、`QuantitySelector`、`StatusBadge`（アイコン + テキスト、色のみ禁止）、`OrderSummary`、`QrPanel`、`InlineFailure` / `PendingNotice` / `EmptyState` / `Skeleton`、`LiveRegion`、`Dialog`/`Drawer`（focus trap・Esc・focus return）。shadcn/ui を基盤にし、`components/ui` は生成物として扱う。

### 5.3 Responsive

- Mobile first。Breakpointは Tailwind 標準（`sm 640 / md 768 / lg 1024`）を使用。
- 主要Action・Canonical State・Error/Pending を Mobile で隠さない（SPEC-050 §24.1）。
- Karaoke 1時間bucket: Mobileでも「対象時刻 + 選択可能数」を表示。表はカード化 or 横スクロール。
- QRページ: Mobile会場提示が主用途。QRを大きく、余白確保、「Entry」「Karaoke」ラベルと日時/状態を同時表示。無効状態はQRを隠し、「使用済み / 取消済み / 失効済み」を文字で表示。
- Mypageローカルナビ: Desktop常設、Mobile折りたたみ（全領域到達可能）。

## 6. 機能要件（フロントエンドが担う範囲）

### 6.1 ページ・ルート

SPEC-050 §7 の Page 一覧（PG-PUB / TKT / KRK / GDS / AUTH / XFN / MYP）をそのまま実装範囲とする。ルートnamespaceは `/`, `/announcements/*`, `/entry`, `/karaoke/*`, `/goods/*`, `/account/*`, `/purchase/orders/*`, `/mypage/*`。

### 6.2 認証と継続（Continuation Intent）

- Guestの購入Action → Login/Registerへ。復帰先は**論理的な目的（Page + 対象ref）のみ**をURL/Cookieで保持。金額・Owner・決済結果・Secretは保持しない（SPEC-050 §10）。
- 認証復帰後は販売状態・在庫・Slot・購入上限をServerから再取得。
- 保護ページはServer側でSession検証。Logout後のBack操作で保護データを再表示しない。

### 6.3 購入フロー表示（最重要）

- Browser Return（Stripeからの戻り）は成功と見なさない。**必ず同一OrderをServerから再取得**して表示。
- 7状態（`PREPARED / AWAITING_PAYMENT / CONFIRMED / PAYMENT_FAILED / CANCELED / EXPIRED / REVIEW_REQUIRED`）を SPEC-050 §16.4 の表どおりに出し分け。
- Retry 4分類（状態再確認 / 支払い開始再試行 / もう一度購入 / Slot選び直し）をボタン文言・処理で混同しない。
- Email失敗は非阻害バナー。購入失敗として表示しない。
- 状態が変わったら `aria-live` で通知。
- 送信中は二重送信を抑止し「処理中」をテキストでも表示。
- 表示用合計金額はあくまで表示。購入時の金額はServer再計算。

### 6.4 Loading / Empty / Error

- 取得失敗を Empty / 売り切れ / 0件に変換しない。Loading中にBusiness outcomeを仮表示しない（確定値に見えるSkeletonを使わない）。
- Error表示は「何が」「未成立の業務操作」「次の操作」を示し、内部例外・他者データの有無を出さない。
- `error.tsx` / `not-found.tsx` / Access Denied を用意し、Sectionごとの部分失敗（Inline Failure）を許容。

### 6.5 Karaoke

日付選択 → 1時間bucket（`10:00 <= usage_start < 11:00`）→ Slot詳細。Slot状態 `AVAILABLE / HELD / SOLD / SALES_STOPPED` を文言 + アイコンで区別。Hold具体秒数はフロントで定義しない（期限表示は参考値、判定はServer）。

## 7. 非機能要件

### 7.1 Accessibility（SPEC-050 §25）

キーボード操作、論理的focus順序、色だけに依存しない状態表現、Form errorの関連付け（`aria-describedby` / error summary）、Dialogのfocus管理、Disabled理由のテキスト表示、見出し階層、LinkとButtonの使い分け。目標は WCAG 2.2 AA 相当（仕様上の最低要件を超える部分は提案）。

### 7.2 セキュリティ（SPEC-140 / SPEC-050 §26）

- Secret・raw QR・Session credential・PIIを client bundle / ログ / URL / テスト成果物に出さない。`NEXT_PUBLIC_*` に置くのは公開可能な値のみ。
- CSP・セキュリティヘッダは `next.config` / middleware で設定（具体値は SPEC-140/180）。
- 認可はUI非表示で代替しない。

### 7.3 パフォーマンス

`next/image`（自前素材）、フォントサブセット、LCPはヒーロー（画像は優先読み込み・適切なサイズ）、Server Component優先でClient JSを最小化。目標値（Core Web Vitals）は提案: LCP ≤ 2.5s / INP ≤ 200ms / CLS ≤ 0.1（公開ページ、Mobile）。

### 7.4 SEO / i18n

- 公開ページに `metadata`、OGP、`lang="ja"`。購入/Mypageは `noindex`。
- UI言語は日本語のみ（多言語は現時点で仕様なし）。

### 7.5 テスト（SPEC-170 と整合）

- Playwright: SPEC-050 §31 のE2E観点（Mobile/Desktop両方）。決済はProvider contract（非本番）を使い、Browser Return単独で成功表示にならないことを検証。
- Vitest: 状態→UIマッピング、Continuation Intentの無害化など純粋ロジック。
- a11y: axeによる自動検査 + キーボード操作の手動確認項目。

## 8. リポジトリ配置（案）

SPEC-010 §の構成に従う（現時点では未作成。作成は実装タスク時にコーディング担当が行う）。

```
apps/web/
  src/app/                # App Router（§6.1のルート）
  src/components/ui/      # shadcn生成物
  src/components/         # 共通・機能別コンポーネント
  src/lib/                # api client, auth, continuation, format
packages/shared/          # 型・Zod（Business Logicは置かない）
tests/                    # tester担当の領域
```

## 9. 決定事項と残論点

### 9.1 決定済み（ユーザー回答）

| # | 決定 | 設計への反映 |
|---|---|---|
| 1 | ALBUM / VIDEOS / プロフィール等の読み物系セクションは**作らない**（必要になれば再検討） | §2 の対象外のまま。ルート・コンポーネントを用意しない |
| 2 | 協賛ロゴは**まず静的な素材として設定する。最終的には運営が管理画面から変更できるようにしたい** | フッターに `SponsorLogos` を設ける。当面は設定ファイル（定数モジュール + `public/` 素材）を参照し、0件なら非表示。**将来の管理画面化に備え、取得処理を1か所（`getSponsors()` のようなデータアクセス関数）に閉じ込め、コンポーネントは props のみ受け取る。**管理画面化の際は SPEC-020（FR-PUB-011 の拡張）/ 100 / 110 / 130 の改訂が必要。当面の静的設定は SPEC-050 §11.1 / 共通フッターに追記 |
| 3 | Domain 混在の1 Order（A案）。**Entry と Goods は同一 Order、Karaoke は別 Order（K4）** | 決済は最大2回。コンビニ払いは開発チームで検討中（`docs/drafts/konbini-payment-review.md`）。判断が出るまで `/cart`・コンビニ払いは実装しない |
| 4 | Lint/Format は **Biome** | 仕様どおり。モックのESLintは持ち込まない |
| 5 | デザインは担当チームが検討中。**後から変更できる設計**にする。素材は**自前で用意** | §9.3 参照 |

### 9.2 採用した項目に伴う仕様改訂（未実施・実装の前提条件）

決定3は SPEC-050（`/cart` ルート不在、Order Purpose単一前提の購入開始導線）および SPEC-070（PAY-ORD-004 Order Purposeは単一値、カード決済のみ、利用者セルフ取消の扱い）と食い違う。モックREADMEの CR-070-001〜003（open）に相当する。AGENTS.md §7.1 に従い、**コードより先に仕様を改訂する**。改訂範囲の洗い出し（SPEC-020/030/040/050/070/090/110/130/170 への波及）は別タスクとして統合報告する。それまでは `/cart` と複数Domain購入、コンビニ払いの実装に着手しない。

### 9.3 デザイン差し替え容易性の設計要件

- **デザイントークン一元化:** 色・書体・角丸・余白・影・コンテナ幅をすべて `globals.css` のCSS変数（Tailwind v4 `@theme`）で定義。コンポーネント内に色コードや固定値を直書きしない。
- **構造とスキンの分離:** shadcn/uiをラップした自前の共通コンポーネント（`StatusBadge`, `ProductCard` 等）経由で使い、見た目の変更を1箇所で完結させる。ページはレイアウトと状態ロジックのみを持つ。
- **テーマ切替の余地:** ダークモード等の追加は `.dark` クラス / data属性によるトークン再定義だけで可能な形にする（初期スコープは担当チームの方針待ち）。
- **素材は差し替え可能な参照にする:** 画像・ロゴ・協賛ロゴ・OGP画像は `public/` またはストレージ上の素材を、設定（定数モジュール）経由で参照。未確定の間はプレースホルダ（グラデーション+テキスト）を表示。素材は自前制作のみ、第三者サイトの素材は使用しない。
- **状態表現はデザインに依存させない:** 状態の意味（Canonical State）→ 表示ラベル/アイコンのマッピングはロジック層に置き、色・形は`StatusBadge`のスキンで変更可能にする（色だけで区別しない要件は維持）。
- **文言の一元管理:** 利用者向け日本語ラベルは定数モジュールに集約し、デザイン調整や文言変更でページコードを触らずに済むようにする。

### 9.4 残論点

- SNSシェアの要否（前回の論点2のうち未回答分）。協賛ロゴと合わせて仕様化を検討。
- デザイン方向性・ダークモードの要否は担当チームの結論待ち。

## 10. 次のステップ案

1. 決定3に伴う仕様改訂の範囲を洗い出し、統合して報告 → 承認後に仕様改訂をコミット（実装コミットより先）。
2. 通常ワークフロー（planner → 承認 → tester → coder → tester）で、`apps/web` の土台（Next.js + Tailwind + shadcn + Biome + トークン/共通レイアウト）から着手。
