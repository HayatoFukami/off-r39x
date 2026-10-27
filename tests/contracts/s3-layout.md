# S3 Layout shell / Providers / Dev scenario panel 契約書

テスト担当が定義した S3 の実装契約である。コーディング担当は、ここに書かれたファイルパス・export 名・シグネチャ・accessible name・DOM 構造・localStorage の形を**そのまま**実装する。対応するテストは次のとおり。

- Vitest（node）: `tests/unit/web/layout/*.test.ts`、`tests/unit/web/ports/factories.test.ts`、`tests/unit/web/routes/route-table-static.test.ts`
- Playwright（mock mode、`desktop-chromium` と `mobile-chromium`）: `tests/e2e/layout-*.spec.ts`、`tests/e2e/system-pages.spec.ts`、`tests/e2e/dev-scenarios.spec.ts`、`tests/e2e/static-hosting.spec.ts`
- **構成（フェーズM）**: Web は Next.js ではなく Vite + React Router の静的 SPA（出力 `apps/web/dist`、SPEC-190 DEV-WEB-001 / SPEC-010 §8.1.1）。旧 `apps/web/app/**` の位置は、本書では §0 の表の `src/routes/**` に読み替える。配信・header・Not Found の status は §13。

- 根拠: `docs/drafts/ui-mock-design.md` の Design §1 / §3 / §8 / §9 / §10 と S3 行、SPEC-050 v1.1.0 §8 / §8.5 / §19.1 / §24.1 / §24.3 / §25 / §27 / §31（23, 29） / §33、SPEC-190 DEV-WEB-001〜013 / DEV-DEP-006、SPEC-140 SEC-WEB-004 / SEC-WEB-009 / SEC-WEB-012、SPEC-170 TST-UNT-004 / TST-E2E-003 / TST-E2E-004。
- これは UI mock suite（補助 suite）であり、G8 でも API / DB / Provider coverage でもない（TST-E2E-004）。manifest では `critical:false`。
- Tailwind の `md` breakpoint（768px）未満を「mobile」、以上を「desktop」とする。E2E は viewport 幅で分岐する（`desktop-chromium` = 1280、`mobile-chromium` = Pixel 7 の 412）。
- **文言は `apps/web/src/presentation/copy/ja.ts` の `copy` から import して使う**（E2E もこの export を import する）。§1 のキーと文字列をそのまま追加する。
- E2E の role / name 照合は、特記が無い限り `exact: true`（部分一致の取り違えを防ぐ）で行う。
- 相対 import は拡張子なし / `.ts` 付きのどちらでもよい。`any`、`as unknown as T`、非 null assertion、`console.*`、`dangerouslySetInnerHTML` を使わない。

## 0. ファイル一覧

| パス | 種別 | export |
|---|---|---|
| `apps/web/src/config/site.ts` | 純粋 | `SITE_NAME`, `EVENT_NAME`, `HOME_HREF`, `CTA_HREF`, `CART_HREF`, `MYPAGE_HREF`, `PrimaryNavKey`, `PrimaryNavItem`, `PRIMARY_NAV`, `GuestAccountLink`, `GUEST_ACCOUNT_LINKS`, `AccountMenuItem`, `ACCOUNT_MENU_ITEMS` |
| `apps/web/src/config/assets.ts` | 純粋 | `AssetSlot`, `assets` |
| `apps/web/src/config/ui-mock.ts`（既存に追加） | 純粋 | 既存 + `isDevAreaEnabled` |
| `apps/web/src/config/browser-storage.ts` | 純粋 | `StorageLike`, `createInMemoryStorage`, `resolveBrowserStorage` |
| `apps/web/src/features/cart/cart-count.ts` | 純粋 | `CART_STORAGE_KEY`, `readCartCount` |
| `apps/web/src/features/cart/use-cart-count.ts` | client | `useCartCount` |
| `apps/web/src/api-client/index.ts` | factory | `PortFactoryOptions`, `createApiPort` |
| `apps/web/src/api-client/provider.tsx` | client | `ApiProvider`, `useApi` |
| `apps/web/src/auth/index.ts` | factory | `createAuthPort`（`PortFactoryOptions` を `api-client/index.ts` と同形で再定義または再 export） |
| `apps/web/src/auth/session-provider.tsx` | client | `SessionProvider` |
| `apps/web/src/auth/use-session.ts` | client | `SessionState`, `useSession` |
| `apps/web/src/presentation/layout/sponsor-area-model.ts` | 純粋 | `SponsorAreaInput`, `SponsorItemModel`, `SponsorAreaModel`, `buildSponsorAreaModel` |
| `apps/web/src/presentation/layout/global-header.tsx` | view | `GlobalHeader` |
| `apps/web/src/presentation/layout/primary-nav.tsx` | view | `PrimaryNav` |
| `apps/web/src/presentation/layout/mobile-nav-drawer.tsx` | view | `MobileNavDrawer` |
| `apps/web/src/presentation/layout/account-menu.tsx` | view | `AccountMenu` |
| `apps/web/src/presentation/layout/cart-link.tsx` | view | `CartLink` |
| `apps/web/src/presentation/layout/global-footer.tsx` | view | `GlobalFooter` |
| `apps/web/src/presentation/layout/sponsor-logos.tsx` | view | `SponsorLogos` |
| `apps/web/src/presentation/components/ui/button.tsx` | primitive | `Button`（+ 必要な variant export） |
| `apps/web/src/presentation/components/ui/badge.tsx` | primitive | `Badge` |
| `apps/web/src/presentation/components/ui/dialog.tsx` | primitive | `@base-ui/react` の Dialog ベース。Drawer はこれから作る |
| `apps/web/src/features/shell/site-header.tsx`, `site-footer.tsx` | container（推奨配置・テスト対象外） | `useCartCount` / `useSession` / `useApi` を使い presentation の `GlobalHeader` / `GlobalFooter` へ props を渡す。`src/routes/root-layout.tsx` から使う |
| `apps/web/index.html` | 静的 shell | §4.1（`lang="ja"`、viewport、`<title>` なし、inline script なし） |
| `apps/web/vite.config.ts` | build 設定 | §13（本番ガード、`VITE_UI_MOCK` の dev 既定、`sourcemap: false`） |
| `apps/web/src/main.tsx` | entry | §13（`createRoot` + `RouterProvider`。mock を import しない） |
| `apps/web/src/config/build-env.ts` | config | §13（`import.meta.env` を読む唯一の場所） |
| `apps/web/src/routing/{link.tsx,navigation.ts}` | adapter | §13（`Link`、`usePathname`、`useRouter`、`useSearchParams`） |
| `apps/web/src/routes/route-table.tsx` | route 表 | §13（31 path + `*`） |
| `apps/web/src/routes/document-title.ts` | title | §4.1（`formatDocumentTitle`） |
| `apps/web/src/routes/root-layout.tsx` | route | §3 |
| `apps/web/src/styles/globals.css` | token | §9 |
| `apps/web/src/routes/route-error.tsx` | route（pathless route の `errorElement`） | §6 |
| `apps/web/src/routes/root-error.tsx` | route（root の `errorElement`） | §6 |
| `apps/web/src/routes/dev/dev-layout.tsx` | route | §8 |
| `apps/web/src/routes/dev/scenarios.tsx` | route | §8 |
| `apps/web/src/routes/dev/error-probe.tsx` | route（dev 専用・テスト支援） | §6.3 |
| `apps/web/src/mock/dev-ui/scenario-panel.tsx` | client | `ScenarioPanel` |
| `apps/web/src/mock/dev-ui/mock-mode-badge.tsx` | server / client | `MockModeBadge` |
| `apps/web/public/mock/sponsors/{alpha,bravo,charlie}.svg` | asset | §7.4 |
| `apps/web/package.json`（追記） | deps | `@base-ui/react`, `clsx`, `tailwind-merge` を `dependencies` に追加 |

`presentation/**` は `features/**`・`mock/**`・`api-client/index.ts`・`auth/index.ts`・session / api provider を import しない（DEV-DEP-006）。`presentation/layout/*` が受け取る値はすべて props（`cartCount`、session の種別、sponsor の `Read` 結果、`onLogout` など）である。`apps/web/src/mock/**` の import は `api-client/index.ts`、`auth/index.ts`、`app/dev/**`、`src/routes/root-layout.tsx`（MockModeBadge のみ）に限る。

## 1. 文言 `copy.layout` / `copy.notFound` / `copy.errorPage`（`ja.ts` に追加）

```ts
layout: {
  skipLink: "メインコンテンツへ移動",
  nav: {
    primaryLabel: "メインナビゲーション",
    footerLabel: "フッターナビゲーション",
    items: { event: "Event", entry: "Entry Ticket", karaoke: "Karaoke", goods: "Goods", cart: "カート" },
  },
  cta: { buyTickets: "チケットを購入する" },
  cart: { label: "カート", labelWithCount: (count: number): string => `カート（${count}点）` },
  account: {
    login: "ログイン",
    register: "アカウント登録",
    mypage: "マイページ",
    menuButton: "アカウントメニュー",
    menuLabel: "アカウント",
    profile: "プロフィール",
    orders: "注文",
    entryTickets: "Entry Ticket",
    karaoke: "Karaoke",
    goods: "Goods",
    logout: "ログアウト",
  },
  drawer: { open: "メニューを開く", close: "メニューを閉じる", title: "メニュー" },
  sponsors: { regionLabel: "協賛", externalSuffix: "（外部サイト）" },
  mockBadge: "UIモック表示中",
},
notFound: {
  title: "ページを表示できません",
  description: "お探しのページは存在しないか、現在表示できません。",
  homeLink: "Event Homeへ戻る",
},
errorPage: {
  title: "問題が発生しました",
  description: "ページを表示できませんでした。時間をおいて、もう一度お試しください。",
  retry: "再試行",
  homeLink: "Event Homeへ戻る",
},
```

- 全角括弧 `（` `）` と「点」を使う。数字は半角。
- `copy.layout.cart.labelWithCount(0)` は呼ばれない（0 のときは `label`）。
- `errorPage` と `notFound` の文言に、`error.message` / `error.stack` / `digest` を連結しない（SEC-WEB-012）。

## 2. 純粋 module の契約（Unit が検証する）

### 2.1 `config/site.ts`

```ts
export const SITE_NAME = "off r39'x in 大阪らへん2027";
export const EVENT_NAME: string;     // = SITE_NAME と同じ値。Footer の Event 名称（API 取得に依存しない）
export const HOME_HREF = "/";
export const CTA_HREF = "/entry";
export const CART_HREF = "/cart";
export const MYPAGE_HREF = "/mypage";
export type PrimaryNavKey = "event" | "entry" | "karaoke" | "goods" | "cart";
export type PrimaryNavItem = { readonly key: PrimaryNavKey; readonly href: string; readonly collapsible: boolean };
export const PRIMARY_NAV: readonly PrimaryNavItem[];
export type GuestAccountLink = { readonly key: "login" | "register"; readonly href: string };
export const GUEST_ACCOUNT_LINKS: readonly GuestAccountLink[];
export type AccountMenuItem = { readonly key: "profile" | "orders" | "entryTickets" | "karaoke" | "goods"; readonly href: string };
export const ACCOUNT_MENU_ITEMS: readonly AccountMenuItem[];
```

| 定数 | 値（この順序） |
|---|---|
| `PRIMARY_NAV` | `event` `/` collapsible:true、`entry` `/entry` true、`karaoke` `/karaoke` true、`goods` `/goods` true、`cart` `/cart` **false** |
| `GUEST_ACCOUNT_LINKS` | `login` `/account/login`、`register` `/account/register` |
| `ACCOUNT_MENU_ITEMS` | `profile` `/mypage/profile`、`orders` `/mypage/orders`、`entryTickets` `/mypage/entry-tickets`、`karaoke` `/mypage/karaoke`、`goods` `/mypage/goods` |

- `collapsible:true` の項目だけが、Header の primary nav（desktop）と Drawer（mobile）に入る。`cart` は Header の Cart link（§4.3）と Footer の nav だけに出す。
- すべての href は `/` で始まり `//` で始まらない相対 path で、`/admin`・`/staff`・`/dev` を含まない（SPEC-050 §27、DEV-WEB-012）。
- 値は `as const` でもよい。上の型に代入できること。

### 2.2 `config/assets.ts`

```ts
export type AssetSlot = { readonly src: string; readonly alt: string };
export const assets: { readonly logo: AssetSlot | null; readonly keyVisual: AssetSlot | null };
```

既定は両方 `null`（外部素材を使わない。SPEC-050 §24.3）。`logo` が `null` のとき Header はサイト名テキストだけを表示する。

### 2.3 `config/ui-mock.ts` — `isDevAreaEnabled`

```ts
export function isDevAreaEnabled(env: Env): boolean;   // Env は既存の Readonly<Record<string, string | undefined>>
```

`isUiMockEnabled(env)` が true、かつ `env.APP_ENV !== "production"` のときだけ true。`VITE_UI_MOCK` が `"1"` 以外（`"0"`、`"true"`、`""`、undefined）なら false。旧変数 `NEXT_PUBLIC_UI_MOCK` は mock の有効化に使わず、`VERCEL_ENV` は production の判定に使わない（どちらを渡しても結果は変わらない）。`/dev/*` の guard（§8）はこの関数を使う。環境変数は `config/build-env.ts` の `readBuildEnv()` だけが読む（§13）。

### 2.4 `config/browser-storage.ts`

```ts
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export function createInMemoryStorage(): StorageLike;
export function resolveBrowserStorage(getLocal?: () => StorageLike | null): StorageLike;
```

- `createInMemoryStorage()`: Map ベース。呼ぶたびに独立した新しい storage。
- `resolveBrowserStorage(getLocal)`: 既定の `getLocal` は `() => window.localStorage`（`typeof window === "undefined"`、アクセスで例外、のとき `null` 扱い）。
  - `getLocal()` が例外を投げる、`null` を返す、または**書き込み probe**（`setItem` → `removeItem` を専用 key `r39x.storage-probe`）が例外を投げる場合は、**モジュール内の共有 in-memory storage**（シングルトン）を返す。同じ失敗で何度呼んでも**同一 object**（`toBe`）を返す。クラッシュしない。
  - 使える storage の場合は、その storage 自体（同一 object）を返す。probe の痕跡（`r39x.storage-probe`）を残さない。
- `window` が無い環境（unit）でも throw しない。

### 2.5 `features/cart/cart-count.ts`

```ts
export const CART_STORAGE_KEY = "r39x.cart.v1";
export function readCartCount(raw: string | null): number | null;
```

保存形式（S5 が Cart store を実装するときに**拡張のみ**可能な最小形。FR-CRT-003）:

```json
{ "version": 1, "lines": [
  { "kind": "ENTRY_TICKET", "offeringRef": "<canonical lowercase UUID>", "quantity": 1 },
  { "kind": "GOODS", "goodsRef": "<canonical lowercase UUID>", "quantity": 2 } ] }
```

- トップレベルは `version`（literal `1`）と `lines` だけ。各 line は `kind` と該当 ref と `quantity` だけ。**どの階層でも余分な field があれば不正**（価格・在庫・Owner などを保持させない）。zod の `.strict()` で検証する（DEV-TS-004）。
- `quantity` は 1 以上の整数（`0`、負数、小数、文字列、`NaN` は不正）。ref は canonical lowercase UUID（大文字・空文字・非 UUID は不正）。`kind` は `ENTRY_TICKET`（`offeringRef`）と `GOODS`（`goodsRef`）の 2 種だけ（`KARAOKE` など他は不正。FR-CRT-002）。ref の field 名が kind と合わない line も不正。
- 同じ ref の line が複数あってもよい（合計に足す）。
- `readCartCount`: `raw === null`（key 無し）→ `null`。JSON として不正、schema 不正 → `null`。有効で `lines: []` → `0`。有効なら全 line の `quantity` の合計。
- `null`（不明 / 不正）と `0` はどちらも Header で「数字を出さない」が、不正な保存値を**書き換えたり削除したりしない**（読み取り専用。復旧 UI は S5）。この関数は storage に触れない。

`useCartCount(): number | null`（client、`useSyncExternalStore`）: `window.localStorage`（`resolveBrowserStorage` ではなく、直接かつ `try/catch` で安全に）の `CART_STORAGE_KEY` を `readCartCount` へ渡す。`storage` event（他 tab の変更）で更新する。**server snapshot は `null`**（hydration mismatch を起こさない）。storage 取得が例外でも `null` を返し、クラッシュしない。

### 2.6 `presentation/layout/sponsor-area-model.ts`

```ts
import type { Read, SponsorLogo } from "../../api-client/types";
export type SponsorAreaInput = Read<readonly SponsorLogo[]> | { kind: "loading" };
export type SponsorItemModel = {
  readonly sponsorRef: string;
  readonly name: string;
  readonly imageSrc: string | null;        // null のとき名称テキストを表示する
  readonly externalHref: string | null;    // null のとき Link にしない
};
export type SponsorAreaModel =
  | { readonly kind: "hidden" }
  | { readonly kind: "visible"; readonly items: readonly SponsorItemModel[] };
export function buildSponsorAreaModel(input: SponsorAreaInput): SponsorAreaModel;
```

- `{ kind: "ok", data }` で `data.length >= 1` のときだけ `visible`。`data` が空、`not_found` / `unavailable` / `auth_required` / `email_unverified`、`loading` はすべて **`{ kind: "hidden" }`（他の field を持たない）**。0 件を示す文言・理由などを model に持たない（SPEC-050 §8.5）。
- `items` は **`data` の順序のまま**（再ソートしない。表示順の権威は port）。入力を変更しない。
- `externalHref`: `linkUrl` が `https:` で parse でき、userinfo（username / password）が無いときだけ元の文字列を返す。`http:`、`javascript:`、`data:`、相対 path、parse 不能、`null` は `null`。
- `imageSrc`: `imageUrl`（**非 null の `string`**。`API-PUB-012` の `image_url` は必須で、`SponsorLogo.imageUrl: string`）が `/` で始まる相対 path（`//` と `/\` で始まるものを除く）か、`https:` の URL（userinfo なし）のとき元の文字列。`http:`、`javascript:`、`data:`、`//host/...`、空文字、userinfo 付き、parse 不能は `null`。相対 path を許すのは UI mock の同一 origin 素材（`/mock/sponsors/*.svg`）のためであり、`API-PUB-012` は https の URL だけを返す（仕様の文言との差は PR の説明に記録する）。許可 origin の判定は CSP（`SPONSOR_IMAGE_ALLOWED_ORIGINS` 由来の `img-src`）が担い、UI は origin の一覧を持たない。
- `name` と `sponsorRef` は入力のまま。

## 3. Factory / Provider

### 3.1 `api-client/index.ts` と `auth/index.ts`

```ts
export type PortFactoryOptions = { env?: Readonly<Record<string, string | undefined>>; storage?: StorageLike };
export function createApiPort(options?: PortFactoryOptions): ApiPort;
export function createAuthPort(options?: PortFactoryOptions): AuthPort;
```

- `env` 省略時は `readBuildEnv()`（`config/build-env.ts`。`import.meta.env.VITE_UI_MOCK` を直接参照して Vite の静的置換を効かせる）。`VITE_UI_MOCK` が `"1"` 以外、および `NEXT_PUBLIC_UI_MOCK` だけが `"1"` の env は fail closed。
- `isUiMockEnabled(env)` が false のとき、**同期的に** `Error` を throw する（fail closed）。メッセージは `createApiPort` が `real api client not implemented`、`createAuthPort` が `real auth client not implemented`（部分一致で検査する）。mock を黙って選ばない。
- true のとき `createMockApi` / `createMockAuth` を返す。`storage` は `options.storage ?? resolveBrowserStorage()`、`clock = systemClock`、`idGenerator = uuidIdGenerator`、`sleep = defaultSleep`。
- **同じ `storage` を渡した `createApiPort` と `createAuthPort` は、同じ DB / session / scenario を共有する**（`r39x.mock.db.v1`、`r39x.mock.session.v1`、`r39x.mock.scenario.v1`）。
- S2 契約（`tests/contracts/s2-mock-backend.md`）は変更しない。

### 3.2 `api-client/provider.tsx`（`"use client"`）

```tsx
export function ApiProvider(props: { children: ReactNode; port?: ApiPort }): JSX.Element;
export function useApi(): ApiPort;
```

- `port` 省略時は `createApiPort()` を**1 回だけ**（`useState` の lazy 初期化。毎 render で作り直さない）作る。`window` が無い環境でも throw しない（storage は `resolveBrowserStorage` が in-memory へ fall back する）。
- `useApi()` は Provider の外で呼ぶと `Error`（`useApi must be used within ApiProvider`）。

### 3.3 `auth/session-provider.tsx` / `auth/use-session.ts`

```ts
export type SessionState =
  | { status: "loading" }
  | { status: "ready"; session: Session }      // Session は auth/port.ts
  | { status: "unavailable" };
export function useSession(): { state: SessionState; signOut(): Promise<void> };
export function SessionProvider(props: { children: ReactNode; port?: AuthPort }): JSX.Element;
```

- 初期 state は `loading`（最初の client render は常に `loading`。SPA は `createRoot` で描画し、hydration しない）。mount 後に `getSession()` を呼び、`{kind:"ok"}` → `ready`、`{kind:"unavailable"}` → `unavailable`。`onSessionChange` で再取得する。他 tab の変更を拾うため `storage` event でも再取得してよい。
- `signOut()` は `AuthPort.signOut()` を呼び、その後 `/` へ遷移する（`useRouter().push("/")`。`src/routing/navigation.ts` の adapter。AR-SES-009 / SPEC-050 §15.6）。provider 側が失敗してもローカル session は破棄済みとして扱う。
- state の参照は、session が実際に変わったときだけ変わる。再取得のたびに新しい object を作らず、`sameSessionState(prev, next)`（`auth/session-equality.ts`。`status` が同じで、`ready` なら `kind` が同じ、`authenticated` なら `email` と `emailVerified` も同じ）が真なら直前の state をそのまま返す。他 tab の Cart 書き込みなど session と無関係な `storage` event では、`useSession().state` を購読する component（Entry / Cart の再取得）を動かさないため（`tests/unit/web/auth/session-equality.test.ts`）。
- `useSession` を Provider の外で呼ぶと `Error`。

## 4. Layout shell の DOM 契約

### 4.1 `src/routes/root-layout.tsx`

`apps/web/index.html`（静的 shell）: `<html lang="ja">`、`<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`、`<body class="flex min-h-dvh flex-col ...">` の中に `<div id="root" class="contents"></div>` と `<script type="module" src="/src/main.tsx">`。**`<title>` と inline script / inline event 属性を置かない**（title は root layout が 1 つだけ描画する。CSP の `script-src` に `'unsafe-inline'` を入れないため）。個人データ・QR・Session を含めない（§13）。

`src/routes/root-layout.tsx`（`Outlet` を持つ layout route）:

```
<HydrationMarker />   ← 初回 commit の後に <html data-hydrated="true">（名前と挙動は不変。s5-cart.md §12）
<ApiProvider><SessionProvider>
  <a href="#main-content">{copy.layout.skipLink}</a>     ← DOM 上の最初の focus 可能要素
  <SiteHeader />        ← <header>（role=banner）
  <main id="main-content" tabIndex={-1}><Outlet /></main>   ← ページ全体で唯一の main
  <SiteFooter />        ← <footer>（role=contentinfo）
  <SiteFloatingTicket />
  <MockModeBadge />     ← src/routes/root-layout.tsx から mock を import してよい唯一の箇所（badge だけ）
</SessionProvider></ApiProvider>
<ScrollRestoration />   ← `getKey` を渡さない（既定の location key。URL・query を sessionStorage に保存しない。SEC-AUTH-018）
<title>{formatDocumentTitle(最も深い route の handle.title)}</title>   ← React 19。1 つだけ
```

- document title: 各 route module が `export const handle = { title: copy.… }` を持ち、root layout が `useMatches()` の最も深い `handle.title` から `formatDocumentTitle(title)` を求める。title が無ければ `SITE_NAME`、あれば `` `${title} | ${SITE_NAME}` ``（`src/routes/document-title.ts`、区切りは ` | `）。AuthGate の内側の page でも、title は認証確認と無関係に出る。
- **`<main>` を描画するのは `src/routes/root-layout.tsx` だけ**。例外は `src/routes/root-error.tsx`（root layout 自体が描画できないときの最小表示。そのとき文書内の `<main>` は 1 つのまま）。route module・`features/**`・`presentation/**` は `<main>` を描画しない。`src/routes/public/home.tsx` も `<main>` ではなく `<div>` か fragment。
- skip link は通常は視覚的に隠してよいが、focus を受けたら見える（`sr-only focus:not-sr-only` など）。
- landmark は 1 ページに `banner` ×1、`main` ×1、`contentinfo` ×1。`navigation` は §4.2〜§4.5 の名前付きのものだけ。
- Header / Footer は全ルート（`/`、`/dev/*`、not-found、error）で表示される（`route-error.tsx` は root layout の `<main>` の内側で描画されるため）。
- `h1` はページ本体が 1 つだけ持つ。**Header / Footer / Drawer / Badge に `h1` を置かない**（見出しを使うなら h2 以降。S3 では Header / Footer に見出しを置かない）。

### 4.2 Header（`<header>`、固定表示）

- `position: fixed`（または `sticky`）で top 0。**ページを scroll しても viewport の上端に表示され続ける**（`boundingBox().y` が 0）。fixed の場合、本文が Header の裏に隠れないよう `main` に上余白を付ける。
- DOM 順（= Tab 順。SPEC-050 §25）:
  1. サイト名 Link（accessible name = `SITE_NAME`、`href="/"`。`assets.logo` が `null` ならテキストのみ。見出しにしない）
  2. **desktop（md 以上）**: `<nav aria-label={copy.layout.nav.primaryLabel}>` に `collapsible:true` の 4 link（名前は `copy.layout.nav.items.{event,entry,karaoke,goods}`、href は `PRIMARY_NAV`）。**mobile（md 未満）**: nav の代わりに Drawer の trigger button（§5）
  3. 主要 CTA Link（§4.4）
  4. Cart Link（§4.3）
  5. Account area（§4.6 / §4.7）
- desktop の nav と mobile の trigger は CSS の `hidden` / `md:hidden` ではなく、**非表示側が accessibility tree に出ない**ようにする（`display:none` ならよい）。
- mobile（412px）で CTA、Cart、Login（または Mypage）が**すべて viewport 内に表示**され、**横 scroll が発生しない**（`documentElement.scrollWidth <= clientWidth`）。サイト名は省略表示してよいが Link として focus できる。

### 4.3 Cart Link

- `<a href="/cart">`。props は `count: number | null`（presentation は count だけを受ける）。
- accessible name: `count` が 1 以上 → `copy.layout.cart.labelWithCount(count)`（例 `カート（3点）`、`aria-label` で与えてよい）。`null` または 0 → `copy.layout.cart.label`（`カート`）。
- 表示テキストに数字を出すのは `count >= 1` のときだけ（`3` などの数字が Link の可視 text に含まれる）。0 / `null` のときは Link 内に数字（0 を含む）を出さない。色や形だけに依存しない。

### 4.4 主要 CTA

- `<a href="/entry">` accessible name `copy.layout.cta.buyTickets`（`チケットを購入する`）。Guest にも Authenticated にも**同じ href** で常時表示。Drawer の外（Header 直下）に置く。Button 風の見た目でよいが `<a>`（Navigation は Link、SPEC-050 §25）。

### 4.5 Footer（`<footer>`）

- Event 名称: `EVENT_NAME` を可視 text として含む（Link でも見出しでもない）。
- `<nav aria-label={copy.layout.nav.footerLabel}>`: `PRIMARY_NAV` の**全 5 項目**の Link（`event`、`entry`、`karaoke`、`goods`、`cart`。名前は `copy.layout.nav.items.*`。Footer の cart は件数を付けず常に `カート`）。
- Sponsor Logo 領域（§7）。
- `/admin`、`/staff`、`/dev` への Link を置かない。

### 4.6 Guest の Account area（session が `ready` かつ `guest`、または `unavailable`）

- Link `ログイン`（`copy.layout.account.login`、`/account/login`）は **desktop / mobile とも Header 直下に常時表示**（Drawer の外）。
- Link `アカウント登録`（`copy.layout.account.register`、`/account/register`）: **desktop は Header 直下**、**mobile は Drawer 内**（Header 直下に出さない）。
- Mypage 内の本人データ Link、Logout、`マイページ` を出さない。

### 4.7 Authenticated の Account area（session が `ready` かつ `authenticated`）

- Link `マイページ`（`copy.layout.account.mypage`、`/mypage`）を Header 直下に常時表示（Drawer の外）。`ログイン` / `アカウント登録` は出さない。
- Account menu（`AccountMenu`）: `<button type="button" aria-expanded aria-controls>` 名前 `アカウントメニュー`（`copy.layout.account.menuButton`）。
  - 閉じているとき `aria-expanded="false"`、メニュー内容は表示されない。クリックで `aria-expanded="true"` になり、`<nav aria-label="アカウント">`（`copy.layout.account.menuLabel`）が表示される。
  - 内容: `ACCOUNT_MENU_ITEMS` の 5 Link（名前 `プロフィール`、`注文`、`Entry Ticket`、`Karaoke`、`Goods`。`copy.layout.account.{profile,orders,entryTickets,karaoke,goods}`）と、`<button type="button">` `ログアウト`（`copy.layout.account.logout`）。Logout は **Link ではなく button**（SPEC-050 §25）。
  - `Escape` で閉じ、**focus が `アカウントメニュー` button へ戻る**。メニュー外のクリックでも閉じてよい。
  - `ログアウト` を押すと `useSession().signOut()` が実行され（§3.3）、`/` へ遷移し、Header は Guest 表示（`ログイン` Link が出て `マイページ` が消える）になる。localStorage の `r39x.mock.session.v1` は guest を返す状態になる（AuthPort の既存契約）。
  - Logout は Browser 側の Cart も clear する（FR-CRT-012、SPEC-050 §15.6、AR-SES-009、UF-AUTH-004）: `signOut()` が終わったあと（reject しても）shell が Cart store の `clear()` を呼び、localStorage の `r39x.cart.v1` が削除され、Header の件数付き Cart Link が消える（件数なしの `カート` Link になる）。provider 側の失敗でも壊れた Cart でも同じ。Guest → 初回 Login では Cart に触れない（`tests/e2e/cart-store.spec.ts` TC-PG-CRT-001-523。契約は s5-cart.md §2.3 / §5.3 / §8）。
- session が `loading` の間、Account area には `ログイン` も `マイページ` も出さない（placeholder だけ。誤った状態のちらつきを避ける）。

## 5. Mobile Drawer（md 未満）

- trigger: `<button type="button" aria-expanded aria-controls>` 名前 `メニューを開く`（`copy.layout.drawer.open`）。閉じているとき `aria-expanded="false"`、`role="dialog"` の要素は DOM に**存在しない**（または非表示）。
- 開く: `role="dialog"`、accessible name `メニュー`（`copy.layout.drawer.title`）、`aria-modal`。`@base-ui/react` の Dialog ベース。
  - 開いた直後に focus が dialog **内**へ移る。
  - **focus trap**: Tab / Shift+Tab を何度押しても `document.activeElement` は dialog 内に留まる。Drawer の外（CTA、Cart、skip link など）へ focus が出ない。
  - `Escape` で閉じ、**focus が trigger（`メニューを開く`）へ戻る**。
  - dialog 内に close button（名前 `メニューを閉じる`、`copy.layout.drawer.close`）。
  - 内容: `<nav aria-label="メインナビゲーション">` に `collapsible:true` の 4 Link（`Event`、`Entry Ticket`、`Karaoke`、`Goods`）。Guest のときは Link `アカウント登録` も含む（§4.6）。**CTA、Cart、`ログイン`、`マイページ` は Drawer の外（Header）にある**。
  - Link を選んで遷移したら Drawer は閉じる（layout は遷移で unmount されないため、pathname の変化で閉じる）。
- desktop（md 以上）では trigger も dialog も出ない。

## 6. システムページ

### 6.1 `src/routes/route-table.tsx`（PG-XFN-002、SPEC-050 §19.1）

- 未知の URL は `path: "*"` の route が `NotFoundView`（`src/presentation/components/not-found-view.tsx`）を描画する。**HTTP status は 200（静的 shell）**で、Not Found の判定は client の表示で行う（SPEC-050 §19.1 は status を規定しない）。layout（Header / Footer）の内側に描画。AuthGate の外側（`/mypage/no-such` も Guest に Not Found を見せ、ログインへ redirect しない）。
- 存在しない asset（拡張子付きの path）は HTML の成功応答にせず、HTML でない本文の 404（§13）。
- `<h1>` `ページを表示できません`（`copy.notFound.title`）が唯一の h1。説明文 `copy.notFound.description`。Link `Event Homeへ戻る`（`copy.notFound.homeLink`、`href="/"`）。
- 内部情報（stack、要求された path、環境変数、フレームワークの既定文言 `This page could not be found` / `404`）を出さない。`<title>` にも `404` を含めない。

### 6.2 `src/routes/route-error.tsx`（SEC-WEB-012）

- pathless route の `errorElement`。props は取らない。`<h1>` `問題が発生しました`（`copy.errorPage.title`）、説明文 `copy.errorPage.description`、`<button type="button">` `再試行`（`copy.errorPage.retry`）、Link `Event Homeへ戻る`（`href="/"`）。
- 再試行は、同じ location（`pathname` + `search` + `hash`）への `navigate(..., { replace: true })` で error 境界を解除する（全体の再読込はしない。URL は変わらない）。
- **`useRouteError` を呼ばない。`error.message`、`error.stack`、`error.digest`、`error.name`、`error.cause`、path、環境変数、SQL、provider response を DOM・属性・`console` へ出さない**。error を描画に使わない（`console.*` も呼ばない）。
- `route-error.tsx` は root layout の `<main>` の中に表示されるので、Header（CTA、Cart）と Footer が残る。
- `src/routes/root-error.tsx`: root layout 自体が描画できないとき（例: mock 無効で port factory が fail closed したとき）の root の `errorElement`。`<main>` の中に `copy.errorPage.title` と `copy.errorPage.description` だけを出す。error オブジェクトには触れない。

### 6.3 `src/routes/dev/error-probe.tsx`（dev 専用・テスト支援。S3 の追加）

- mount の後に、**render 中に** `throw new Error("r39x-error-probe: SENSITIVE-MARKER-9f3a C:\\secret\\path\\leak.ts")` を投げる（`src/routes/route-error.tsx` に捕捉させ、`error.message` が画面へ漏れないことを E2E で確認するため。`"use client"` は要求しない）。固定の合成文字列で、Secret ではない。
- `src/routes/dev/dev-layout.tsx` の guard 配下にあるため mock 無効時は Not Found 表示（`NotFoundView`）。一般 Navigation・Footer・Drawer から Link しない。`/dev/mock-checkout` は S7a で別途追加する（S3 の対象外）。

## 7. Sponsor Logo 領域（Footer）

`GlobalFooter` は `sponsors: SponsorAreaModel` を props で受ける（container が `useApi().public.listSponsorLogos()` を mount 後に呼び、`buildSponsorAreaModel` を通す）。

### 7.1 領域

- `model.kind === "hidden"` → **領域を DOM に描画しない**。協賛・スポンサー・0 件を示す text（`協賛`、`スポンサー`、`Sponsor`、`なし`、`0件`、取得失敗の文言、見出し、枠、空の region）を Footer のどこにも出さない。他の Footer 要素と Header・本文の操作は妨げない。
- `model.kind === "visible"` → `<section aria-label="協賛">`（`copy.layout.sponsors.regionLabel`。role=region）を描画し、その中の `<ul>` に `items` を**与えられた順**に `<li>` で並べる。**PUBLISHED だけ**（DRAFT / ARCHIVED は port が返さないのでそもそも出ない）。

### 7.2 各 Logo

- `imageSrc !== null`: `<img src={imageSrc} alt={name} referrerpolicy="no-referrer">`（`alt` = 表示名称、`loading` は任意。**`referrerpolicy="no-referrer"` は必須**。SPEC-050 §8.5、`SEC-WEB-026`。Server-side proxy にしない）。`onError`（CSP で拒否された画像でも発火する）で画像を取り除き、**名称 `name` を text で表示**する（壊れた画像アイコンを残さない）。`imageSrc === null` のときも最初から名称 text。
- `externalHref !== null`: `<a href={externalHref} rel="noopener noreferrer">`（`target="_blank"` は任意）で、accessible name は `{name}{copy.layout.sponsors.externalSuffix}`（例 `Sponsor Alpha（外部サイト）`。画像の `alt` + visually hidden の `（外部サイト）` でよい。間に空白があってもよい）。外部へ遷移する Link であることが利用者に分かること（SPEC-050 §8.5）。
- `externalHref === null`: Link にしない（画像 + `alt`、または名称 text のみ）。

### 7.3 Scenario との対応（`scenario.sponsorLogos`、S2 契約 §13）

| scenario | seed からの結果 | Footer |
|---|---|---|
| `published`（既定） | Alpha（10）、Bravo（20）、Charlie（30）の順 | 3 件を上の順に表示。Alpha と Charlie は外部 Link、Bravo は Link なし。画像が読み込まれる |
| `none` | `ok` + `[]` | 領域なし |
| `fail` | `unavailable` | 領域なし。「協賛なし」等の text なし。Header・nav・本文は操作可能 |
| `image_broken` | `imageUrl` が `/mock/sponsors/__broken__.svg`（404） | 3 件が名称 text（`Sponsor Alpha` など）で表示される |
| `image_disallowed_origin` | `published` と同じ 3 件・同順・同 `linkUrl`。`imageUrl` が `https://sponsor-images.invalid/<ref>.svg`（予約 TLD。E2E の CSP `img-src` は `'self' data: blob:` のみで、この origin を含まない） | ブラウザが `img-src` 違反（`securitypolicyviolation`、画像 1 件につき 1 回）を報告し、画像は読み込まれず（この origin への応答 0）、3 件が名称 text で順序どおり表示される。region 内に `<img>` を残さない。外部 Link 2 件の accessible name・href・`rel` は維持。CSP 違反の console 出力は想定内（`pageerror` だけを 0 とする）。CSP で拒否された画像を「読み込み成功」と偽装しない（`SEC-WEB-026`） |

### 7.4 `public/mock/sponsors/{alpha,bravo,charlie}.svg`

seed の `imageUrl`（`/mock/sponsors/<key>.svg`）が指す文字だけの placeholder SVG。外部素材を使わない。`<script>`、外部 URL 参照（`href="http…"`、`xlink:href`、`@import url(…)`）、`<image>`、`<foreignObject>` を含まない。`<svg` で始まる有効な SVG（表示名称に相当する `<text>` を含む）。`__broken__.svg` は**作らない**（404 を返させる）。

## 8. Dev area

### 8.1 `src/routes/dev/dev-layout.tsx`

- `isDevAreaEnabled(readBuildEnv())` が false なら `NotFoundView` を返す（mock 無効時、または `APP_ENV=production` の `/dev/*` は Not Found 表示。HTTP status は 200 の静的 shell）。
- true のときは `<meta name="robots" content="noindex, nofollow" />`（React 19 が head へ出す）と `<Outlet />` を描画する。
- `/dev/*` を Header / Footer / Drawer / Account menu / MockModeBadge から Link しない（SPEC-190 DEV-WEB-012）。

### 8.2 `/dev/scenarios`（`src/routes/dev/scenarios.tsx` + `mock/dev-ui/scenario-panel.tsx`。title は handle なし = `SITE_NAME`）

- `<h1>` `モックシナリオ`（唯一の h1。dev 専用なので `ja.ts` ではなくリテラルでよい）。
- **Scenario の全 switch** を編集できる。各 switch は `<label>` で accessible name を持つ native control で、**name は scenario の key path そのもの**（下表、完全一致）。値は `scenarioSchema`（S2 契約 §5）の enum を `<option value>` にそのまま使う（option の label も値と同じ文字列）。`latencyLongMs` だけ `<input type="number">`。

| accessible name（key path） | 値 |
|---|---|
| `publicFetch` | `ok` `fail` `empty` |
| `latency` | `none` `long` |
| `latencyLongMs` | 整数 1..60000（number input） |
| `sponsorLogos` | `published` `none` `fail` `image_broken` `image_disallowed_origin` |
| `cart.state` | `ok` `fail` `partial` |
| `cart.purchaseStart` | `ok` `reject_one` `limit` `unavailable` |
| `checkout` | `ok` `start_failed` `opportunity_expired` |
| `karaokeHold` | `ok` `conflict` `limit` `expire_before_checkout` |
| `karaokeSales` | `ON_SALE` `BEFORE_SALES` `SALES_ENDED` `SUSPENDED` |
| `paymentOutcome` | `confirm_after_recheck` `confirm` `remain_awaiting` `payment_failed` `review_required` `expire` `cancel` |
| `notification` | `sent` `pending` `failed_retryable` `canceled` `summary_unavailable` |
| `auth.session` | `ok` `unavailable` |
| `auth.login` | `ok` `credential_failure` `unavailable` |
| `auth.signup` | `confirmation_required` `signed_in` `rejected` `unavailable` |
| `auth.verify` | `ok` `invalid_or_expired` `unavailable` |
| `auth.reset` | `ok` `unavailable` |
| `auth.resetContext` | `valid` `invalid` |
| `auth.logout` | `ok` `provider_failure` |
| `eventFields` | `complete` `missing_optional` |

- 現在値の表示: マウント時に `loadScenario(storage)` で読み、各 control に反映する（key が無ければ既定値）。
- **変更は即時に保存**する（Save button なし）。control の変更ごとに、現在の scenario へその key だけ反映して `saveScenario`（S2 の zod 検証つき）で `r39x.mock.scenario.v1` へ書く。検証に失敗する入力（例 `latencyLongMs` が 0 や 60001）は保存せず、control の近くに text でエラーを示す（storage は変更しない）。
- 保存済み scenario が不正（`loadScenario` が `corrupted`）なとき: `role="alert"` に text `保存されているシナリオを読み込めません` を表示し（保存値の内容を echo しない）、`<button type="button">` `シナリオを初期化` を出す。押すと `resetScenario(storage)` で既定値を保存し、alert を消して control に既定値を反映する。corrupted の間は control を自動で上書きしない。
- `<button type="button">` `モックDBをリセット`: `createMockDb({ storage, clock: systemClock }).reset()` を呼び（corrupted からの復旧も兼ねる）、完了後に `role="status"` で `モックDBをリセットしました` を表示する。`r39x.mock.session.v1` と scenario は変更しない。
- `<section aria-label="他者データの参照">`（region）: 所有権確認用に `other@example.com` の参照への Link を並べる。href は次の 4 つ**以上**（S2 seed の固定 UUID）。

| 種別 | href |
|---|---|
| Order | `/mypage/orders/0d000000-0000-4000-8000-000000000101` |
| Entry Ticket | `/mypage/entry-tickets/7c000000-0000-4000-8000-000000000101` |
| Karaoke Reservation | `/mypage/karaoke/4e000000-0000-4000-8000-000000000101` |
| Goods | `/mypage/goods/91000000-0000-4000-8000-000000000101` |

- パネルは storage に `resolveBrowserStorage()` を使う（localStorage が使えなくてもクラッシュしない）。password・token・raw QR を表示も保存もしない。

### 8.3 MockModeBadge（`mock/dev-ui/mock-mode-badge.tsx`）

- `isUiMockEnabled(...)` が true のときだけ、画面**右下**に固定表示する小さな text label `UIモック表示中`（`copy.layout.mockBadge`）を描画。false のときは `null`。
- `nav`、Header、Footer、Drawer の中に置かない。Link でも button でもない（`pointer-events: none` 推奨）。`src/routes/root-layout.tsx` からだけ import される。DOM に 1 つだけ。

## 9. Design token（`src/styles/globals.css`、SPEC-050 §24.3）

`@theme` ブロックに次の token を定義する（既存を維持して追加）。

- `--color-brand`、`--color-brand-foreground`
- `--color-tone-{success,pending,failure,neutral,review}-{bg,fg}`（10 個）
- `--radius-base`
- `--font-sans`（system font stack。Web font を使わない。SEC-WEB-004）
- **`--hero-gradient`**（`linear-gradient(...)` で始まる値。画像 URL を使わない）

CSS・source のどこにも外部 origin（`http://`、`https://`、`//host`）の `url(...)` / `@import` / `@font-face` を置かない。`fonts.googleapis.com`、`fonts.gstatic.com` を使わない（`index.html` も同様）。

## 10. E2E の共通条件

- 状態の仕込みは `page.addInitScript` で localStorage を設定する（harness の `seedLocalStorage`。tab 内で 1 回だけ設定するので reload で上書きされない）。使う key: `r39x.mock.scenario.v1`、`r39x.mock.session.v1`、`r39x.mock.db.v1`、`r39x.cart.v1`。
- session の仕込み形（S2 契約 §7）: `{"version":1,"session":{"kind":"authenticated","email":"demo@example.com","emailVerified":true},"pendingVerificationEmail":null}`。
- ページ読み込み中に `pageerror` が無く、`console.error`（`Failed to load resource` を除く）が無いこと。
- ネットワーク要求の宛先は `127.0.0.1:3100`（と `data:` / `blob:`）だけ（外部 font・外部 CDN を使わない）。
- Playwright の既定 workers は 2（`tests/playwright.config.ts`）。Windows host で 4 workers 並列時に loopback の停止（素の node http server でも再現、最大約 20 秒）が起き、アプリ起因でない timeout が散発したため。retry は 0 のまま（SPEC-170 §69）、各 test は新規 context（TST-FLK-001 / §65）。`--workers=N` で上書き可能。
- 保護 6 prefix（`/account`・`/auth`・`/purchase`・`/mypage`・`/admin`・`/staff`）の `Cache-Control: no-store` と `Pragma: no-cache` は `dist/_headers`（§13）が付け、`tests/e2e/no-store.spec.ts`（TC-SEC-WEB-009-001）が 6 prefix すべてを検査する。
- E2E の webServer は `tests/harness/browser/start-mock-web.mjs`: `VITE_UI_MOCK=1` で `pnpm --filter @off-r39x/web build`（`APP_ENV`・`NODE_ENV`・`SPONSOR_IMAGE_ALLOWED_ORIGINS`・旧 `VERCEL_ENV`・`NEXT_PUBLIC_UI_MOCK` は除く）を行い、`apps/web/dist` を `scripts/serve-web-dist.mts --port 3100 --host 127.0.0.1` で配信する（`dist/_headers` を適用）。

## 11. テストファイルと契約の対応

| ファイル | 内容 |
|---|---|
| `tests/unit/web/layout/site-config.test.ts` | §2.1, §2.2 |
| `tests/unit/web/layout/cart-count.test.ts` | §2.5 |
| `tests/unit/web/layout/sponsor-area-model.test.ts` | §2.6, §7 |
| `tests/unit/web/layout/dev-area.test.ts` | §2.3 |
| `tests/unit/web/layout/browser-storage.test.ts` | §2.4 |
| `tests/unit/web/layout/layout-copy.test.ts` | §1 |
| `tests/unit/web/layout/shell-static.test.ts` | §0, §4.1, §6, §7.4, §8, §9, SEC-WEB-004 / 012 の静的検査 |
| `tests/unit/web/layout/scenario-controls.test.ts` | §8.2 の表と S2 `scenarioSchema` の一致 |
| `tests/unit/web/ports/factories.test.ts` | §3.1 |
| `tests/unit/web/routes/route-table-static.test.ts` | §13（TC-STACK-008-001〜004） |
| `tests/unit/scripts/{serve-web-dist,generate-web-headers}.test.ts` | §13（TC-STACK-008-101〜107、201〜207） |
| `tests/e2e/layout-header.spec.ts` | §4.2〜§4.7, §5 |
| `tests/e2e/layout-footer.spec.ts` | §4.5, §7 |
| `tests/e2e/layout-reachability.spec.ts` | SPEC-050 §31 の 23, 29、見出し・landmark、外部要求、実行時エラー、MockModeBadge |
| `tests/e2e/system-pages.spec.ts` | §6 |
| `tests/e2e/dev-scenarios.spec.ts` | §8 |
| `tests/e2e/static-hosting.spec.ts` | §13（TC-STACK-008-301〜308） |

## 12. 曖昧さについてテスト担当が決めたこと

1. SPEC-050 §8.1 は Cart を Primary Navigation に含めるが §8.5 は Cart を別要素として挙げる。→ Header は「4 項目の primary nav」と「独立した Cart Link」に分け、Footer の nav は 5 項目とする（`collapsible`）。
2. SPEC-050 §8.2 は Guest に `アカウント登録` を表示するが、§8.5 が mobile で Drawer の外に置くのは Login / Mypage だけ。→ mobile では `アカウント登録` は Drawer 内、desktop は Header 直下。
3. Footer の Event 名称は API の `getEvent()` ではなく `config/site.ts`（公開取得の失敗で Footer が崩れないため）。
4. 最小の読み取り専用 Cart 数量 source は S3 で `features/cart/cart-count.ts` として定義し、保存形式は S5 が拡張のみする（§2.5）。
5. error page の E2E は `/dev/error-probe`（dev 専用・テスト支援）を S3 で追加して検証する。SPEC-050 の Page ではなく、mock 無効時は Not Found 表示（DEV-WEB-012 の `src/routes/dev/**` に該当）。
6. Scenario panel の control 名は日本語 copy ではなく key path とする（dev 専用で、`ja.ts` はプロダクト UI 用のため）。
7. 本番相当 build（`VITE_UI_MOCK` 無効、または `APP_ENV=production`）で `/dev/*` が Not Found 表示になること、`MockModeBadge` が出ないことは、E2E の server が mock 固定のため Unit（`isDevAreaEnabled`、静的検査）でのみ確認する。`VITE_UI_MOCK=1` かつ `APP_ENV=production` の build が失敗することは `root-scripts.test.ts`（TC-DEV-WEB-011-201）で確認する。

## 13. 静的 SPA の配信・header・route 表（フェーズM。SPEC-190 DEV-WEB-001〜013、SPEC-180 §13.1、SPEC-140 §21 / §22）

テスト: `tests/unit/web/routes/route-table-static.test.ts`、`tests/unit/scripts/{serve-web-dist,generate-web-headers,root-scripts,secret-scan,check-import-boundaries}.test.ts`、`tests/e2e/static-hosting.spec.ts`、`tests/e2e/no-store.spec.ts`。UI mock の E2E は補助 suite であり、実 API・DB・Provider・Cloudflare Pages の挙動の根拠にならない（DEV-WEB-011）。

### 13.1 route 表（`src/routes/route-table.tsx`。TC-STACK-008-002）

- React Router の data router（`createBrowserRouter` + `RouterProvider`、`src/main.tsx` が `createRoot` で描画）。`export const routes: RouteObject[]`。
- 全 page の `path` は絶対 path の literal（31 個、動的 segment は `:announcementRef`・`:date`・`:slotRef`・`:goodsRef`・`:orderRef`・`:ticketRef`・`:reservationRef`・`:goodsItemRef`）+ `"*"`。layout は pathless route。
- 構造: `RootLayout`（`errorElement: <RootError/>`）> pathless（`errorElement: <RouteError/>`）> { 公開 10 + account 5、`SelfLayout`（`AuthGate` + `Outlet`）> { `/purchase/orders/:orderRef`、`MypageLayout`（`MypageNav` + `Outlet`）> { Mypage 12 } }、`DevLayout` > { `/dev/scenarios`、`/dev/mock-checkout/:orderRef`、`/dev/error-probe` }、`*` → `NotFoundView` }。
- 動的 route は `useParams()` の値を現行と同じ parse 関数で検査する。不正な値: 公開系（announcement / karaoke day / slot / goods / dev mock-checkout）は `NotFoundView`、Mypage・purchase は `AccessDeniedView`（同じ props）。正常な値は feature container に `key={生の param}` を付けて描画する（param が変わったら再マウント。TC-STACK-008-307）。
- 照合は大文字小文字を区別する。`"*"` 以外の path を持つ全 route（31 個）は `caseSensitive: true`（移行前の Next と同じ。`dist/_headers` の照合とも一致する）。pathless の layout と `"*"` には付けない。大文字小文字だけが異なる URL（`/MYPAGE`、`/GOODS` など）は `"*"` の Not Found（AuthGate の外。ゲストでも login へ redirect しない）になる。動的 param の値の大文字小文字は、従来どおり各 parse 関数が判定する（`/goods/<大文字の UUID>` は `/goods/:goodsRef` に一致し、`parseGoodsRef` が拒否して Not Found になる）。検査: TC-STACK-008-002（静的）、TC-STACK-008-302（E2E）。
- `react-router` を import してよいのは `src/routing/**`・`src/routes/**`・`src/main.tsx` だけ。`next` の import・依存・`next.config.*`・`app/` は無い（TC-STACK-008-001）。`import.meta.env` を読むのは `src/config/build-env.ts` だけ（TC-STACK-008-003）。
- CSP（SEC-WEB-003）に `unsafe-eval` が無いため、Zod は `src/config/zod-jitless.ts` の `z.config({ jitless: true })` で eval を試さない。`src/main.tsx` はこれを最初の JS import（`globals.css` を除く）にし、Zod の schema を定義するモジュール（`src/features/**`・`src/mock/**`）より前に評価させる（TC-STACK-008-005。実ブラウザでの違反なしは TC-STACK-008-306）。

### 13.2 adapter（`src/routing/`。TC-STACK-008-004）

- `link.tsx`: `Link`（`<a>` の属性 + `href: string` + `prefetch?: false`）。`prefetch` は取り除いて DOM へ渡さず、`react-router` の `Link` に `to={href}` を渡す。
- `navigation.ts`: `usePathname()`、`useRouter()`（`{ push(href), replace(href) }`。`useNavigate()` から作り、**`useMemo` で安定化**する。AuthGate の effect の依存配列に入るため）、`useSearchParams()`（`URLSearchParams` を返し、書き換え関数は返さない）。

### 13.3 環境変数とガード（TC-DEV-WEB-011-201 / 204）

- mock のフラグは `VITE_UI_MOCK`（`"1"` のときだけ有効）。production の判定は `APP_ENV`（SPEC-180 §9 の環境名。仕様に Web build 用の変数名の明文規定はなく、DEV-WEB-011 を満たすための本リポジトリの選択）。
- `apps/web/vite.config.ts` は `defineConfig(({ command, mode }) => …)`。serve と build のどちらでも `assertUiMockNotInProductionBuild({ VITE_UI_MOCK, APP_ENV })` を呼び、`VITE_UI_MOCK=1` かつ `APP_ENV=production` なら `UI mock mode must not be enabled in a production build` で失敗する。serve で `VITE_UI_MOCK` が未設定なら `process.env.VITE_UI_MOCK = "1"`（dev 既定）。build は明示指定のときだけ有効。`build.sourcemap` は false、`outDir` は `dist`（SEC-WEB-011）。
- `NEXT_PUBLIC_UI_MOCK` と `VERCEL_ENV` は参照しない。

### 13.4 配信と `dist/_headers`（TC-STACK-008-101〜107、201〜207、301〜305）

- `scripts/serve-web-dist.mts [--dir] [--port 0-65535] [--host]`（既定 `apps/web/dist`・3100・`127.0.0.1`）: 起動時に `ERROR dist-missing` / `index-missing` / `headers-missing` / `headers-invalid line=<n>` / `listen <code>`（終了コード 1）、不正な CLI は `USAGE`（2）。起動したら `READY http://<host>:<port>`。GET / HEAD のみ（他は 405 + `Allow: GET, HEAD`）。拡張子のない未知の path は `index.html` を 200、最後の segment に `.` がある不在 path は `text/plain` の 404（`Not Found`）。dist の外・NUL・バックスラッシュ・`.` 始まりの segment・`/_headers`・`/_redirects` は 404。request の URL・query・header を log に出さない。
- `_headers` の対応構文は生成するものだけ（`#` 行、空行、`/` 始まりの path 行 = 完全一致または末尾 `/*` の前方一致、2 空白以上で字下げした `Name: value`）。`!` による除去・`:placeholder`・途中の `*`・絶対 URL は `headers-invalid`。複数の規則に一致した同名 header は記述順に `, ` で連結する（Pages と同じ）。`_headers` 以外の `Cache-Control` を付けない。
- `scripts/generate-web-headers.mts [--dist] [--check]`（build の末尾で実行）: `dist/**/*.html` の src のない `<script>` 本文の SHA-256（base64）を `script-src` に重複なし・辞書順で入れ、`on*=` 属性・`javascript:` URL は `ERROR inline-handler <相対path>`、閉じていない `<script` は `ERROR html-unparsable`。`SPONSOR_IMAGE_ALLOWED_ORIGINS`（JSON の文字列配列。https・userinfo/port/path/query/fragment なし・IP literal / localhost / `*.local` / `*` なし）の origin だけを `img-src` に入れ、不正なら `ERROR sponsor-image-origin-invalid index=<n>`（値を出さず、`_headers` を書かない）。成功時 `OK headers inline-scripts=<n> img-origins=<n>`。`--check` は書き込まず、不一致なら `ERROR headers-stale`。
- `dist/_headers` の内容（v2）は `tests/contracts/s9-finalize.md` §5。`tests/harness/web-dist.ts` の `expectedHeadersFile()` が期待値の正である。

### 13.5 静的 shell の不変条件（TC-STACK-008-305）

- `dist/**/*.html` は `#root` が空で、body に文字がなく、`demo@example.com`・seed の表示名・`r39x1.`・`r39x.mock` を含まず、inline script を持たない。`dist` に `.map` が無い。`node scripts/generate-web-headers.mts --check` が 0 で終わる（CSP の hash が成果物と一致）。初回描画は従来どおり `loading` から始まる。

### 13.6 テスト担当が決めたこと（フェーズM）

1. 未知の URL・不正な ref の HTTP status は 200（静的 shell）。SPEC-050 §19.1 は status を規定しない。期待値の変更は本節と各 E2E の「Not Found」系に限る。
2. JS 無効時の `SPEC-050 §25`: SPA は JS なしで内容を描画しない（SPEC-050 §5.4）。`TC-SPEC-050-25-003` は「演出が JS 無効時に見出しを隠さない」という CSS の契約だけを、静的 shell の `#root` に差し込んだ `data-reveal="static"` の見出しで検証する。
3. 遷移後のフォーカス移動と route announcer は追加しない（現行の挙動も、先頭要素がフォーカス不能のため移動しない）。`TC-PG-MYP-001-722` は「何もフォーカスを強制しない」ことを要求している。
4. `Referrer-Policy` は `/*`（`strict-origin-when-cross-origin`）と保護 prefix（`no-referrer`）の両方に一致して `, ` で連結され、実効値は最後の token の `no-referrer`。Pages 上で同じ連結になることの実地確認は deploy の作業に残る。
