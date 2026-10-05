# S10 契約書（Header Menu / Floating Ticket Button / 見出しフェードイン / サイト名）

テスト担当が定義した S10 の実装契約。コーディング担当は `apps/web/**`（presentation / features / config / app）だけを変更する。S1〜S9 と同じ契約先行の流れで、失敗するテストを先に書いてある。

根拠: SPEC-050 v1.2.0 §8.5（Global Header、Floating Ticket Button、サイト名）、§24.1、§24.3、§25（Dialog / Drawer、Link と Button、見出しのフェードイン）。DEV-WEB-001〜013、DEV-DEP-006、TST-UNT-004、TST-E2E-003 / 004、TST-FLK-001。UI mock suite は補助 suite（G8 ではない）で、manifest は `critical:false`、`api_operation_ids` / `db_constraint_names` は空、runner retry は 0。

対応テスト:

- Vitest: `tests/unit/web/layout/{floating-ticket-visibility,s10-static,layout-copy,shell-static}.test.ts`
- Playwright（`desktop-chromium` = 1280x720、`mobile-chromium` = Pixel 7 の 412 幅。両 project で同じテストが走る）: `tests/e2e/{layout-header,layout-header-menu,layout-floating-ticket,reveal-headings}.spec.ts` と、旧挙動を主張していた既存 spec の更新（§7）。
- ハーネス: `tests/harness/browser/header-menu.ts`（ロケータと menu 操作）。

Tailwind の `md` breakpoint（768px）未満を mobile とする（既存 `isDesktop`）。**文言は `copy`（`apps/web/src/presentation/copy/ja.ts`）から import して使う。** E2E の role / name 照合は `exact: true` を既定とする。特に `メニュー` は `アカウントメニュー` の部分文字列なので、必ず `exact: true` で照合する。

## 0. ファイル

| パス | 種別 | export / 内容 |
|---|---|---|
| `apps/web/src/presentation/layout/header-menu.tsx`（新規） | client view | `HeaderMenu({ currentPath, showRegister })`。`mobile-nav-drawer.tsx` を**置き換える**（旧ファイルは削除する） |
| `apps/web/src/presentation/layout/global-header.tsx` | view | 常時表示の desktop `PrimaryNav` と `MobileNavDrawer` を外し、`HeaderMenu` を置く |
| `apps/web/src/presentation/layout/floating-ticket-visibility.ts`（新規） | 純粋 | `isFloatingTicketVisible(pathname: string): boolean`（§4.1） |
| `apps/web/src/presentation/layout/floating-ticket-button.tsx`（新規） | view | `FloatingTicketButton`（Link。§4.2） |
| `apps/web/src/features/shell/` 配下の container（名前は任意） | client | `usePathname()` を読み、`FloatingTicketButton` へ props で渡す。`app/layout.tsx` が描画する |
| `apps/web/src/presentation/components/section-heading.tsx` | view | §6 のフェードイン属性と挙動（実装は client 部品へ委譲してよい） |
| `apps/web/src/mock/dev-ui/mock-mode-badge.tsx` | view | 左下へ移動（§5） |
| `apps/web/app/layout.tsx` | route | Floating button を Footer の後・MockModeBadge の前に描画。`viewport` export で `viewportFit: "cover"`（§4.2） |
| `apps/web/app/globals.css` | token | `[data-reveal]` の規則と `prefers-reduced-motion` の上書き（§6） |
| `apps/web/src/presentation/copy/ja.ts` | copy | §1 |
| 既存のサイト名 Link（`global-header.tsx` 内） | view / client | `/` 表示中は先頭へ scroll（§3）。`onClick` が要るため client 部品へ切り出してよい |

`presentation/**` は `features/**`・`mock/**`・provider を import しない（DEV-DEP-006）。pathname は props で受け取る。

## 1. 文言 `copy.layout`（`ja.ts`）

- `copy.layout.drawer`（`open` / `close` / `title`）を**削除**し、次を追加する。

```ts
menu: { button: "メニュー" },
floatingTicket: { label: "入場券を手に入れる" }, // 差し替え可能な仮文言
```

- `floatingTicket.label` の**文字列そのものはテストで固定しない**。テストは `copy.layout.floatingTicket.label` を参照する。制約は 3 つだけ: 空でない、`copy.layout.cta.buyTickets` と等しくなく部分文字列でもない（逆向きも）、`copy.layout.nav.items.*` / `copy.layout.cart.label*` / `copy.layout.account.*` / `copy.layout.menu.button` と相互に部分文字列にならない。Header の主要 CTA や既存の `getByRole("link", { name: copy.layout.cta.buyTickets })`（`exact` なしを含む）が strict mode で複数一致しないための条件である。
- 既存のその他の `copy.layout` は変更しない。

## 2. Header Menu（SPEC-050 §8.5, §25）

「メニューボタンを押したときに開く disclosure」とする。`AccountMenu`（`account-menu.tsx`）と同じ型で、Dialog にしない（modal でも focus trap でもない）。

- DOM 位置: `<header>` の中、サイト名 Link の**直後**、主要 CTA の前。したがって Tab 順は desktop が skip link → サイト名 → メニューボタン → 主要 CTA → Cart → Login → アカウント登録、mobile が skip link → サイト名 → メニューボタン → 主要 CTA → Cart → Login（メニューを閉じている状態）。
- ボタン: `<button type="button">`、accessible name = `copy.layout.menu.button`、`aria-expanded="true" | "false"`、開いている間 `aria-controls` = パネルの `id`。**mobile / desktop の両方**に表示する（旧 `md:hidden` を外す）。
- 閉じている間はパネルを DOM に描画しない（`AccountMenu` と同じ。常時展開しない）。Header 内に Primary Navigation の Link（Event / Entry Ticket / Karaoke / Goods）は 1 つも存在しない。desktop でも同じ。
- パネル: `<nav aria-label={copy.layout.nav.primaryLabel}>`（`<header>` の子孫）。中身は `<ul>/<li>/<Link>` の 4 項目（href は Event `/`、Entry Ticket `/entry`、Karaoke `/karaoke`、Goods `/goods`）。項目は Link であり、`role="menu"` / `role="menuitem"` を使わない。現在 Page の項目は `aria-current="page"`（既存 `PrimaryNav`）。`PrimaryNav` を再利用してよい。
- 追加: guest の mobile では、パネルに「アカウント登録」Link（`/account/register`）も含める（旧 Drawer と同じ。desktop は Header に常時表示するのでパネルに含めない）。authenticated は含めない。
- CTA、Cart、Login / Mypage / Account menu は**パネルに入れず**、メニューを開かなくても Header に常時表示する。パネルを開いても Header 内の位置は変わらず、これらは viewport 内に残る。
- 閉じる操作: ボタンの再操作（toggle）、Escape、パネル外の pointerdown、パネル内 Link の選択、Route の変更（Link 以外の遷移要因を含む）。Escape で閉じた後は focus をメニューボタンへ戻す（focus がパネル内にあった場合も、ボタン上にあった場合も）。
- 開いている間の focus は移動させない（focus はボタンに残る。Tab で次の DOM 要素であるパネルの Link へ進める）。
- パネルは viewport の外へはみ出さない（水平方向）。開いても横 scroll を発生させない。Header は sticky のまま、scroll 後もパネルが viewport 内にある。
- Footer の navigation（`copy.layout.nav.footerLabel`）は変更しない（常時表示）。

## 3. サイト名（SPEC-050 §8.5）

- `<header>` 内のサイト名 Link は `href="/"` のまま、accessible name は `SITE_NAME`（ロゴ未設定時）。
- `/` 以外の Page: 通常の client-side 遷移で `/` へ。
- すでに `/` を表示している場合: 既定の遷移を止め、ページ先頭へ scroll する（`window.scrollTo({ top: 0 })`。`prefers-reduced-motion: reduce` のときは smooth にしない）。URL は `/` のまま、full reload にならない（window の状態が保たれる）。クリックでも Enter でも同じ。
- 判定は `usePathname()` 相当の pathname が `"/"` かどうか。クエリや hash は無視してよい。

## 4. Floating Ticket Button（SPEC-050 §8.5）

### 4.1 表示規則 `isFloatingTicketVisible(pathname)`

pathname（クエリ・hash を含まない）の**先頭 segment**で判定する。次の先頭 segment のとき `false`、それ以外は `true`。

| 先頭 segment | 対応 Page |
|---|---|
| `entry` | `PG-TKT-001` |
| `cart` | `PG-CRT-001` |
| `account` | `PG-AUTH-*` |
| `mypage` | `PG-MYP-*` |
| `purchase` | `PG-XFN-001` |
| `dev` | 開発用領域 |

segment 境界で比較する: `/entry` と `/entry/` と `/entry/x` は false、`/entry-foo`、`/entries`、`/cartoon`、`/accounts`、`/devices`、`/mypage2` は true。大文字小文字は区別する（Next の route は区別する）。`/` と `/karaoke`、`/karaoke/schedule/2027-01-01`、`/goods`、`/goods/<ref>`、`/announcements`、`/announcements/<ref>`、存在しない Route（Not Found）は true。Administrator / Staff 領域は一般 Page ではなく Link も無いので、この関数の対象外とする（`/admin` / `/staff` を特別扱いしない）。

このモジュールは `/dev` 等の文字列を除外判定のためだけに持つ。Link は作らない（`shell-static` の「shell は `/dev` を link しない」検査は、この 1 ファイルを名前で除外し、代わりに `href` / `Link` を含まないことを検査する。§7）。

### 4.2 見た目と DOM

- `FloatingTicketButton`（`pathname` を props で受ける）は `isFloatingTicketVisible` が false のとき `null`（DOM に存在しない）。client-side 遷移でも切り替わる（layout は再 mount されない）。
- `<a>`（Next `Link`、`prefetch={false}`）、`href="/entry"`、`data-testid="floating-ticket-button"`、accessible name = `copy.layout.floatingTicket.label`（可視テキスト。アイコンだけにしない）。**Header の主要 CTA と accessible name が異なる**ことで、`getByRole("link", { name })` が strict mode で一意になる。
- `position: fixed`、右下（右端・下端からの距離は各 64px 以内）。Page を scroll しても同じ位置に追従する。高さ 36px 以上。
- DOM 位置: `<header>`・`<main>`・`<footer>`・`<nav>` の外、Footer の**後**（focus 順が DOM 順と一致）。MockModeBadge の前でも後でもよい。
- safe area: `bottom` と `right` に `env(safe-area-inset-bottom)` / `env(safe-area-inset-right)` を足す（ソースに `safe-area-inset-bottom` を含める）。`app/layout.tsx` は `viewport` を export し `viewportFit: "cover"` を設定する（`<meta name="viewport">` の content に `viewport-fit=cover` が入る。これが無いと iOS で env() が 0 になる）。`width=device-width` と `initial-scale=1` は保つ。
- 覆わない: Page の末尾まで scroll したとき、Floating button の矩形は、Footer 内のすべての要素（Event 名称、Footer navigation の Link、Sponsor Logo 領域の画像・テキスト）および Page 上のすべての操作要素（`a[href]`, `button`, `input`, `select`, `textarea`）の矩形と交差しない。末尾に Button の高さ + 余白 + safe area 分の余白を確保する（`body` か Footer の `padding-bottom` など。表示する Page でだけ確保してもよい）。Floating button を非表示にする Page では余白を足さなくてよい。
- Floating button が Header の主要 CTA を置き換えない（両方が存在する）。
- tab 順: Footer の最後の Link の次が Floating button。

## 5. MockModeBadge（旧: 右下）

- 左下に移動する。`position: fixed`、矩形の中心が viewport の左半分かつ下半分。`pointer-events-none`、landmark の外、Link / Button ではない、既存どおり全 Route で 1 つ（旧契約 TC-DEV-WEB-012-201 を更新）。
- Floating button とは重ならない（矩形が交差しない）。

## 6. 見出しのフェードイン（SPEC-050 §25）

対象は `SectionHeading`（h2 / h3）だけ。h1、Hero、他の見出しは対象外。

### 6.1 属性

`SectionHeading` が描画する `<h2>` / `<h3>` 要素**自身**に `data-reveal` を付ける。値は次の 3 つ。

| 値 | 意味 | computed 値 |
|---|---|---|
| `static` | server 出力と最初の client render の値。演出を行わない | `opacity: 1` |
| `pending` | client が演出を準備した。画面内に入るのを待つ | `opacity: 0`（`display: none` / `visibility: hidden` / `aria-hidden` は使わない。DOM に存在し続ける） |
| `revealed` | 画面内に入り表示済み | `opacity: 1` |

- `data-reveal` は h2 / h3 以外に付けない。h1 には付けず、`opacity: 1` を保つ。
- 遷移は一方向（`static` → `pending` → `revealed`、または `static` → `revealed`）。`revealed` に戻って `pending` へ戻ることはない（scroll して出入りしても再び隠さない）。
- JavaScript が無効: server 出力は `static` のままで、見出しは常に `opacity: 1`。
- `prefers-reduced-motion: reduce`: `pending` を使わない（`static` のまま、または即 `revealed`）。見出しは常に `opacity: 1` で、`transition-duration` は `0s`（CSS でも `@media (prefers-reduced-motion: reduce)` で `[data-reveal]` の opacity を 1、transition を無効にして二重に守る）。
- それ以外で `IntersectionObserver` が使える場合: client が mount した後（`useLayoutEffect` 相当で最初の paint 前）、その要素が viewport の下方にあり画面内にまだ入っていなければ `pending` にする。すでに画面内に入っている要素は `pending` にせず、`static` のままか即 `revealed`（最終的に `opacity: 1`）。`pending` の要素が viewport と交差したら `revealed` にする。
- hydration 後に mount した見出し（データ取得後に描画される Home の各 Section など）にも同じ処理を行う。
- `[data-reveal]` の transition: `transition-property` に `opacity`（または `all`）を含み、`transition-duration` は 0 より大きく 1s 以下（目安 300〜600ms）。軽い `transform`（数 px の移動）を併用してよいが、opacity が主。

### 6.2 アクセシビリティ

- 見出しは DOM に常に存在する。演出の有無で heading の個数・順序・level・accessible name・Focus 順序・`aria-labelledby` の参照先を変えない。`aria-hidden` を付けない。
- 画像・ロゴ・Hero・本文は対象外（フェードインさせない）。

## 7. 既存テストの更新（S10 で旧挙動を主張していたもの）

| 旧 ID / 場所 | 旧挙動 | 更新 |
|---|---|---|
| `TC-PG-PUB-001-301`（layout-header） | desktop は常時表示の primary nav、mobile は Drawer | 両 project でメニューボタン。Header に Primary Link が無い。登録 Link は desktop のみ Header |
| `TC-PG-PUB-001-305` | Tab 順に desktop は 4 つの nav Link | メニューボタン 1 つに置換（§2） |
| `TC-PG-PUB-001-306` | Mobile Drawer（dialog、focus trap、close ボタン） | メニュー（disclosure）に置換。focus trap と close ボタンの検査は削除 |
| `TC-PG-PUB-001-221`（layout-copy） | `copy.layout.drawer` | `copy.layout.menu` と `copy.layout.floatingTicket` |
| `TC-DEV-WEB-001-201`（shell-static） | `mobile-nav-drawer.tsx` が必須 | `header-menu.tsx`、`floating-ticket-button.tsx`、`floating-ticket-visibility.ts` が必須。`mobile-nav-drawer.tsx` は存在しない |
| `TC-DEV-WEB-012-102`（shell-static） | shell の全ファイルに `/dev` の文字列が無い | `floating-ticket-visibility.ts` だけ除外（§4.1） |
| `TC-DEV-WEB-012-201`（layout-reachability） | Badge は右下 | 左下 |
| `TC-PG-PUB-001-501`、`TC-PG-PUB-001-505`、`TC-SPEC-050-31-21-001`〜`002`（journeys） | mobile だけ Drawer を開く | 両 project でメニューを開く（共通ヘルパー `openPrimaryMenu`） |

`TC-PG-PUB-001-302`（Header 固定）、`-303`、`-304`、`-401`〜`-405`、`-502`〜`-504` は変更しない。

## 8. Test Case ID 一覧

| ID | level / ファイル | 内容 |
|---|---|---|
| `TC-PG-PUB-001-241` | Unit `floating-ticket-visibility.test.ts` | §4.1 の表示規則 |
| `TC-PG-PUB-001-242` | Unit `layout-copy.test.ts`（同ファイルの `-221` 更新と別 describe） | `copy.layout.menu` / `floatingTicket` の制約 |
| `TC-PG-PUB-001-243` | Unit `s10-static.test.ts` | ファイル、safe area、viewport、badge、reveal CSS の静的検査 |
| `TC-PG-PUB-001-307` | E2E `layout-header-menu.spec.ts` | メニューの開閉、内容、a11y 属性 |
| `TC-PG-PUB-001-308` | E2E 同上 | Escape / focus return / 外側 / 選択 / Route 変更で閉じる |
| `TC-PG-PUB-001-309` | E2E 同上 | サイト名（`/` 以外から `/`、`/` で先頭へ scroll） |
| `TC-PG-PUB-001-311` | E2E `layout-floating-ticket.spec.ts` | Route 別の表示 / 非表示（client 遷移を含む） |
| `TC-PG-PUB-001-312` | E2E 同上 | 固定位置、scroll 追従、遷移、DOM 位置、名前の一意性 |
| `TC-PG-PUB-001-313` | E2E 同上 | Page 末尾で Footer・操作要素を覆わない、Badge と重ならない |
| `TC-PG-PUB-001-314` | E2E 同上 | viewport meta |
| `TC-SPEC-050-25-001` | E2E `reveal-headings.spec.ts` | 動き軽減では常に表示 |
| `TC-SPEC-050-25-002` | E2E 同上 | 通常: 画面外は `pending`（opacity 0）、scroll で `revealed`（opacity 1）、transition |
| `TC-SPEC-050-25-003` | E2E 同上 | JavaScript 無効では見出しを表示 |
| `TC-SPEC-050-25-004` | E2E 同上 | 対象は h2 / h3 のみ、DOM と a11y が不変 |

## 9. 決めた曖昧点

1. メニューは modal Dialog でなく disclosure（`AccountMenu` と同型）。SPEC-050 §8.5 / §25 は「Dialog を使う場合は…」と条件付きで、disclosure ならボタン側の要件（`aria-expanded`、Keyboard、Escape、focus return、選択 / 遷移で閉じる、Link）だけを満たせばよいと解釈した。
2. Floating button の除外 Page は先頭 segment 判定。仕様の `PG-XFN-001` は `/purchase/*`、`PG-AUTH-*` は `/account/*`、`PG-MYP-*` は `/mypage/*`、開発領域は `/dev/*`。Not Found（`PG-XFN-002`）は仕様が除外していないので表示する。
3. Floating button の文言は仮（`入場券を手に入れる`）。テストは固定しない。
4. 見出しの属性名と 3 状態は、テストが観測できるようにするための契約（仕様は演出の有無と安全性だけを規定している）。
5. 先頭に既に入っている見出しを即表示でよいか: 仕様は「画面内に表示された際に」。最初から画面内にある見出しは最終的に表示されていればよいとした。
6. メニューの outside click は仕様に書かれていないが `AccountMenu` と一貫させるため要求する（pointerdown）。
