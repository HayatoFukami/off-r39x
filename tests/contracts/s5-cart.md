# S5 Cart / Entry販売 / Goods詳細 契約書（PG-TKT-001 / PG-GDS-002 / PG-CRT-001。購入開始は除く）

テスト担当が定義した S5 の実装契約である。コーディング担当は、ここに書かれたファイルパス・export 名・シグネチャ・文言・DOM 構造をそのまま実装する。対応するテスト:

- Vitest（node）: `tests/unit/web/cart/*.test.ts`
- Playwright（mock mode、`desktop-chromium` と `mobile-chromium`）: `tests/e2e/entry-*.spec.ts`、`goods-detail.spec.ts`、`cart-*.spec.ts`
- ハーネス: `tests/harness/browser/cart.ts`

根拠: `docs/drafts/ui-mock-design.md`（承認済み。Design §4 Cart、§6 Cart flow、S5 行）、SPEC-050 v1.1.0 §8.5 / §9 / §10.2 / §12.1 / §14.2 / §14A.1 / §20 / §21 / §22 / §24 / §25 / §26.4 / §31（4, 6, 24 前半, 25, 28）/ §33、SPEC-020 FR-CRT-001〜005, 011, 012、SPEC-030 BR-ORD-020、SPEC-040 §16A.1 / §16A.9、SPEC-190 DEV-WEB-001〜013 / DEV-TS-004、SPEC-170 TST-UNT-004 / TST-E2E-003 / TST-E2E-004。UI mock suite（補助 suite）であり G8 でも API / DB / Provider coverage でもない。manifest では `critical:false`。S1〜S4 の契約は**変更しない**（S3 の `cart-count.ts` と保存形式 `r39x.cart.v1` は拡張のみ）。

共通の約束（S4 の約束をそのまま引き継ぐ）:

- 文言は `apps/web/src/presentation/copy/ja.ts` の `copy` に集める。S5 の `features/{cart,entry,goods}/**` と新規 `presentation/components/**` に**日本語の直書き・`¥` の直書き・色の直書きを置かない**。金額は `formatMoney` / `multiplyMoney` / `sumMoney`（bigint）、日時は `format/datetime.ts`（JST）。
- route module（`src/routes/**`。React Router。旧 `app/**/page.tsx`）は薄い殻（`export const handle = { title }` と route param の検証だけ。`useParams()` で値を取り、feature container に `key={生の param 値}` を付けて描画して param の変化で再マウントする）。`<main>` を描画せず、mock・`fetch`・storage を参照しない。データ取得は `"use client"` の container が mount 後（`useEffect`）に `useApi()` 経由で行う。container から `mock/**` を import しない。公開 Content（説明文）は `PlainText` で描画する。
- Cart は**参照と数量だけ**を持つ（FR-CRT-003）。価格・金額・通貨・在庫・販売可否・Owner・Role・個人情報・Secret は保存せず、保存値を権威値にしない。Karaoke は型としても schema としても表現できない（FR-CRT-002）。
- Cart の追加・変更・削除は Business effect を作らない（FR-CRT-001 / BR-ORD-020）。S5 は `purchase.*`（`startCartPurchase` / `startCheckout` / `startKaraokePurchase`）を**呼ばない**。mock DB（`r39x.mock.db.v1`）を書き換える操作も行わない。
- 取得 3 状態（loading / empty / unavailable）の区別は S4 §0 と同じ。loading 中の `main` に、売り切れ / 販売済み / 販売停止 / 販売終了 / 販売開始前 / `0件` / 金額（`¥` + 数字）/ empty 文言 / unavailable 文言を出さない。loading は `role="status"` で `copy.pageState.loading` を含む。
- 各ページの `h1` は 1 つだけ。見出しの level は飛ばさない。`main` 内の `<li>` は、そのページの一覧項目（Entry の offering、Cart の line）だけにする。

## 0. ファイル一覧

| パス | 種別 | export |
|---|---|---|
| `apps/web/src/features/cart/cart-model.ts` | 純粋 | `Cart`, `CartLoad`, `EMPTY_CART`, `parseCart`, `serializeCart`, `addLine`, `setLineQuantity`, `removeLine`, `removeLines`, `subtractLines`, `addFromOrder`, `cartTotalQuantity` |
| `apps/web/src/features/cart/cart-count.ts` | 純粋（S3 既存。拡張のみ） | `CART_STORAGE_KEY`, `readCartCount`（内部で `parseCart` を使い、zod schema を二重に持たない） |
| `apps/web/src/features/cart/quantity.ts` | 純粋 | `QuantityParse`, `parseQuantityInput`, `formatDisplayTotal` |
| `apps/web/src/features/cart/cart-store.ts` | client から使う | `CartStorage`, `CartSnapshot`, `CartWriteResult`, `CartStore`, `CartStoreDeps`, `createCartStore`, `getBrowserCartStore` |
| `apps/web/src/features/cart/use-cart.ts` | client hook | `CartState`, `useCart` |
| `apps/web/src/features/cart/use-cart-count.ts` | client hook（S3 既存。変更） | `useCartCount`（store 経由。同一 tab の変更でも更新される） |
| `apps/web/src/features/purchase/eligibility-model.ts` | 純粋（B4b。React・storage・port・mock を import しない。`SessionState` は型だけ） | `EligibilityInput`, `eligibilityMode`, `eligibilityTargets`, `toEligibilityInput`, `findEligibility`, `eligibilityForSession`, `eligibilityForLines`（B4b-F-1。§5.1 / §5.3）, `SaleDecision`, `decideSaleState`（B4c。Entry と Goods 詳細が共有する、公開上の状態を本人向け判定で絞る規則。§4.1 / §4.2。`presentation/state-mapping/availability` の `presentAvailability` / `presentPurchaseReasons` だけを import する） |
| `apps/web/src/features/cart/can-proceed.ts` | 純粋 | `ProceedBlockReason`, `ProceedDecision`, `canProceed` |
| `apps/web/src/features/cart/cart-view-model.ts` | 純粋 | `CartInput`, `CartRow`, `CartPageModel`, `buildCartPageModel` |
| `apps/web/src/features/cart/add-to-cart-form.tsx` | client view | `AddToCartForm`（Entry / Goods 共通の数量 + 追加 UI） |
| `apps/web/src/features/cart/cart-page.tsx` | client container | `CartPage` |
| `apps/web/src/features/entry/entry-model.ts` | 純粋 | `EntryOfferingItem`, `buildEntryModel` |
| `apps/web/src/features/entry/entry-page.tsx` | client container | `EntryPage` |
| `apps/web/src/features/goods/goods-detail-model.ts` | 純粋 | `GoodsDetailModel`, `buildGoodsDetailModel`, `goodsEligibilityTarget`（B4c） |
| `apps/web/src/features/goods/goods-detail-page.tsx` | client container | `GoodsDetailPage`（props `{ goodsRef: Ref<"goods"> }`） |
| `apps/web/src/features/public/route-params.ts` | 純粋（S4 既存。追加のみ） | `parseGoodsRef` を追加 |
| `apps/web/src/routes/public/entry.tsx` | route | `/entry`（PG-TKT-001）。`metadata.title = copy.entry.pageTitle` |
| `apps/web/src/routes/public/goods-detail.tsx` | route | PG-GDS-002。`useParams()`。`parseGoodsRef` が null なら `NotFoundView`（HTTP 200）。container は `key` 付き。`handle.title = copy.goods.detail.pageTitle` |
| `apps/web/src/routes/public/cart.tsx` | route | `/cart`（PG-CRT-001）。`metadata.title = copy.cart.pageTitle` |

route module の位置は上の表のとおり。title は `export const handle = { title: … }` と `src/routes/root-layout.tsx` の `formatDocumentTitle`（`%s | SITE_NAME`）により `${copy.entry.pageTitle} | ${SITE_NAME}` 等になる。**title は `copy.pageTitle` へ足さない**（S4 の `s4-copy.test.ts` が `copy.pageTitle` の全 key を固定しているため）。

## 1. 文言 `copy`（`ja.ts` に追加。既存 key は変えない）

```ts
cart: {
  pageTitle: "カート",
  heading: "カート",
  subject: "カートの現在状態",
  empty: "カートは空です",
  backToEntry: "Entry Ticketを見る",
  backToGoods: "Goodsを見る",
  unknownItemName: "状態を確認できない商品",
  kind: { ENTRY_TICKET: "Entry Ticket", GOODS: "Goods" },
  unitPriceLabel: "単価", subtotalLabel: "小計",
  remove: "削除",
  summary: {
    heading: "合計",
    totalLabel: "表示用合計",
    recalcNote: "購入時の金額はサーバーで再計算されます",
    onePayment: "Entry TicketとGoodsは1回の支払いにまとめられます",
    totalUnknown: <string>,          // 合計を出せない理由（数字を含まない）
  },
  karaoke: {
    heading: "Karaokeについて",
    body: <string>,                   // 「カートに入れられない」「別の購入」「別の支払い」を含む
    link: "Karaoke販売案内を見る",
  },
  proceed: {
    label: "購入手続きへ進む",
    blocked: <string>,                // 購入できない商品があるため進めない。削除または数量変更を案内
    unknown: <string>,                // 現在の状態を確認できないため進めない
  },
  corrupted: {
    title: "カートを読み込めません",
    description: <string>,            // 空のカートとして扱わないこと、リセットで復旧できること
    reset: "カートをリセットする",
    goToCart: "カートを確認する",
  },
},
quantity: {
  label: "数量",
  invalid: "数量は1以上の整数で入力してください",
  exceedsMax: (max: number): string => <max を含む>,
  guidance: (max: number): string => <max を含む>,
},
sales: {
  add: "Cartに追加",
  addSucceeded: "Cartに追加しました。購入はまだ確定していません",
  addFailed: <string>,               // ブラウザの保存領域に書けなかった
  viewCart: "Cartを見る",
  displayTotalLabel: "表示用合計",
  displayTotalNote: "購入時の金額はサーバーで再計算されます",
  priceLabel: "価格", periodLabel: "販売期間", statusLabel: "販売状態",
},
entry: {
  pageTitle: "Entry Ticket",
  heading: "Entry Ticket",
  subject: "Entry Ticket情報",
  perAccountLimit: (limit: number): string => <limit を含む。1アカウントあたりの購入上限>,
},
goods: { detail: {                    // 既存 copy.goods に detail を追加
  pageTitle: "Goods詳細",
  heading: "Goods詳細",               // loading / unavailable のときの h1
  subject: "Goods情報",
  pickupNotice: <string>,             // 会場受け取りであること。「配送先」「住所」「配送業者」「配送追跡」「お届け」を含まない
  backToList: "Goods一覧へ戻る",
} },
```

- 既存 `copy.test.ts` の制約（全 leaf は trim 済みの非空 string か関数）を守る。`copy.sales.addSucceeded` と `copy.sales.add`、`copy.cart.proceed.label`、`copy.cart.empty`、`copy.cart.corrupted.title` は上記の文字列をそのまま使う（SPEC-050 §12.1 / §14.2 / §14A.1 の固定文言）。
- `copy.sales.addQuantityOverflow` = `"Cartの数量が扱える範囲を超えるため、Cartに追加できませんでした。Cartで数量を確認してください"`（Cart の数量の合算が安全な整数を超えたときの専用文言）。`copy.sales.addFailed`（保存先に書けない）とは別の文言で、「追加しました」「保存領域」「購入上限」と数字を含まない。末尾に「。」を付けない。
- `copy.cart.proceed.blocked` と `copy.cart.proceed.unknown` は互いに異なる。`copy.cart.karaoke.body` は「カート」「別」を含み、Karaoke を Cart へ追加する示唆（「追加できます」等）を含まない。
- `copy.cart.summary.totalUnknown` と `copy.cart.summary.recalcNote` は数字を含まない。

## 2. Cart store（純粋 module）

### 2.1 `features/cart/cart-model.ts`

```ts
export type Cart = { readonly version: 1; readonly lines: readonly CartLine[] };
export type CartLoad = { kind: "ok"; cart: Cart } | { kind: "corrupted" };
export const EMPTY_CART: Cart;                       // { version: 1, lines: [] }
export function parseCart(raw: string | null): CartLoad;
export function serializeCart(cart: Cart): string;
export function addLine(cart: Cart, line: CartLine): Cart;
export function setLineQuantity(cart: Cart, lineKey: string, quantity: number): Cart;
export function removeLine(cart: Cart, lineKey: string): Cart;
export function removeLines(cart: Cart, lineKeys: readonly string[]): Cart;
export function subtractLines(cart: Cart, ordered: readonly CartLine[]): Cart;
export function addFromOrder(cart: Cart, items: readonly OrderItem[]): Cart;
export function cartTotalQuantity(cart: Cart): number;
export class CartQuantityOverflowError extends RangeError {}   // message "Cart quantity is out of range"、name も設定
```

- すべて**純粋**（入力を変更しない、新しい `Cart` を返す）。`CartLine` は `api-client/types.ts`、line key は既存 `cartLineKey`（`${kind}:${ref}`。数量・並び順に依存しない）。
- `parseCart`: `raw === null`（key なし）→ `ok` + 空の Cart。JSON として不正・schema 不正・空文字は `corrupted`（**空の Cart にしない**）。schema は strict（トップレベルも line も）: `version: 1`、`lines` の各要素は `ENTRY_TICKET`（`offeringRef`）か `GOODS`（`goodsRef`）、ref は canonical lowercase UUID、`quantity` は 1 以上の**安全な整数**。余分な field（価格・在庫・Owner 等）、`KARAOKE`、未知の kind は `corrupted`。S3 の `readCartCount` 表（`cart-count.test.ts`）の拒否ケースはすべて `corrupted`。**同じ line key が複数あれば数量を合算して 1 本にする**（最初の出現位置。`readCartCount` の合計と一致させるため。`corrupted` にはしない）。数量の上限は設けない（安全な整数の範囲だけ。Cart は Entry / Goods の `maxSelectableQuantity` を知らない）。
- `serializeCart`: `JSON.stringify({ version: 1, lines })`。line は `kind` / ref / `quantity` だけ。`parseCart(serializeCart(c))` は `ok` で `c` と等しい。
- `addLine`: 同じ line key があれば数量を**加算**（位置は変えない）、なければ末尾に追加。line が不正（数量が 1 以上の安全な整数でない、ref が canonical UUID でない、`KARAOKE` や未知の kind、余分な field）なら `RangeError` を throw。加算結果が安全な整数を超える場合は `CartQuantityOverflowError`（`RangeError` の subclass。`instanceof RangeError` も真）を throw する。line の不正は subclass ではない通常の `RangeError`（呼び出し側が「合算の overflow」と「不正な line」を例外の class で区別できる。SPEC-050 §9.3: 失敗した対象と未成立の操作を、別の原因として示す）。
- `setLineQuantity`: 数量を置き換える（位置を変えない）。数量が 1 以上の安全な整数でなければ `RangeError`（0 にする代わりに `removeLine` を使う）。存在しない key は何もしない（等しい Cart を返す）。
- `removeLine` / `removeLines`: 該当 line を除く（残りの順序は保つ）。存在しない key は無視。空の `lineKeys` は何もしない。
- `subtractLines`（FR-CRT-011 / BR-ORD-020 / SPEC-050 §14A.1 の純粋部。購入開始の応答待ちに Cart が編集されても、「Order に含めた数量」だけを現在の Cart から外す。TC-PG-CRT-001-407）:
  1. `ordered` を line key（`cartLineKey`）ごとに数量を合算する。数量が 1 以上の安全な整数でない ordered line は**無視**する（`isValidQuantity` と同じ判定。throw しない）。
  2. 現在の Cart の各 line について、合算値 `t` があれば `left = quantity − t` を求め、`left > 0` なら同じ位置に `{ ...line, quantity: left }` で残し、`left ≤ 0` なら除く。合算値がない line（待機中に追加された line、Order に含まれない line）は**そのまま**残す。
  3. `ordered` にあって Cart にない key（待機中に削除された line）は**無視**する（復活させない）。
  4. 何も変わらないとき（`ordered` が空、すべて無視、該当 key がない）は**入力と同じ参照**の `cart` を返す（store がこの参照の同一性で no-op を判定する）。
  5. 入力を変更しない。例外を投げない。ENTRY_TICKET と GOODS は同じ UUID でも別 key。
- `addFromOrder`（再購入時の再投入。SPEC-050 §16.4 / FR-CRT-011 の純粋部）: `ENTRY_TICKET` と `GOODS` の明細だけを、**参照と数量だけ**で `addLine` と同じ規則で（既存と同じ line key なら加算）明細の順に加える。途中で合算が overflow したら全体を中止し `CartQuantityOverflowError`（純粋関数なので何も書かれない）。`KARAOKE` の明細は無視する（Cart に入れられない）。名前・単価・小計は読まない・保存しない。明細が空、または Karaoke だけなら等しい Cart を返す。
- `cartTotalQuantity`: 全 line の数量の合計。`readCartCount(serializeCart(c)) === cartTotalQuantity(c)`。

### 2.2 `features/cart/quantity.ts`

```ts
export type QuantityParse =
  | { kind: "valid"; quantity: number }
  | { kind: "invalid"; reason: "empty" | "not_integer" | "below_min" | "above_max" };
export function parseQuantityInput(raw: string, max: number | null): QuantityParse;
export function formatDisplayTotal(unitPrice: Money, quantity: number): string;
```

- `parseQuantityInput`: `""` → `empty`。`/^-?[0-9]+$/` に一致しない（小数、指数、空白付き、文字）または安全な整数でない → `not_integer`。1 未満（`0`、負数、`-0`）→ `below_min`。`max !== null` かつ `max` を超える → `above_max`（`max` ちょうどは valid）。それ以外は `valid`（先頭の 0 は許す。`"01"` → 1）。Cart ページは `max = null`（Cart は上限を創作しない）、Entry / Goods は port の `maxSelectableQuantity`（ON_SALE のときだけ。null なら `null`）を渡す。
- `formatDisplayTotal`: `formatMoney(multiplyMoney(unitPrice, quantity))`。bigint のみ（浮動小数を使わない）。表示用であり権威値ではない。

### 2.3 `features/cart/cart-store.ts`

```ts
export interface CartStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export type CartSnapshot = { readonly kind: "ready"; readonly cart: Cart } | { readonly kind: "corrupted" };
export type CartWriteResult = { kind: "ok"; cart: Cart } | { kind: "corrupted" } | { kind: "storage_unavailable" };
export type CartAddResult = CartWriteResult | { kind: "quantity_overflow" };
export interface CartStore {
  getSnapshot(): CartSnapshot;
  subscribe(listener: () => void): () => void;
  add(line: CartLine): CartAddResult;
  setQuantity(lineKey: string, quantity: number): CartWriteResult;
  remove(lineKey: string): CartWriteResult;
  removeLines(lineKeys: readonly string[]): CartWriteResult;
  subtractLines(lines: readonly CartLine[]): CartWriteResult;
  addFromOrder(items: readonly OrderItem[]): CartAddResult;
  reset(): CartWriteResult;
  clear(): CartWriteResult;   // Logout 用。corrupted は返さない
}
export type CartStoreDeps = { storage: CartStorage; subscribeExternal?: (onChange: () => void) => () => void };
export function createCartStore(deps: CartStoreDeps): CartStore;
export function getBrowserCartStore(): CartStore | null;   // window.localStorage が使えないとき（SSR 等）は null
```

- 永続化先は `CART_STORAGE_KEY = "r39x.cart.v1"`（`cart-count.ts`）。
- `getSnapshot()`: 呼ぶたびに storage を読むが、**保存文字列が変わらない限り同じ参照を返す**（`useSyncExternalStore` 用）。`parseCart` が `ok` → `ready`、`corrupted` → `corrupted`。`getItem` が throw した場合も `corrupted`（内容を確認できないので空として扱わない）（store の snapshot の規則。Cart の停止は lifecycle が決める。§2.4）。
- 変更操作（`add` / `setQuantity` / `remove` / `removeLines` / `addFromOrder`）: 現在の snapshot が `corrupted` なら**何も書かず** `{ kind: "corrupted" }`。それ以外は cart-model の関数で新しい Cart を作り `serializeCart` で `CART_STORAGE_KEY` に書く。`setItem` が throw したら `{ kind: "storage_unavailable" }`（保存されたと主張しない。snapshot も変わらない）。成功したら `subscribe` 済みの listener を呼び `{ kind: "ok", cart }`。不正な引数（`RangeError`）は throw する（storage は変更しない）。`add` / `addFromOrder` だけは、計算中に `CartQuantityOverflowError` が出たら throw せず、何も書かず listener も呼ばず `{ kind: "quantity_overflow" }` を返す（snapshot は同じ参照）。snapshot が `corrupted` なら従来どおり `corrupted` が先（計算しない）。不正な line の `RangeError` は従来どおり throw する。
- `subtractLines(lines)`（購入開始に成功した直後に hook が呼ぶ。TC-PG-CRT-001-427）: `getSnapshot()` で**保存済みの最新 text**を読む（hook の React state は使わない。同じ tab と他 tab の編集の両方を反映する）。`corrupted` なら何も書かず notify もせず `{ kind: "corrupted" }`。`cart-model.subtractLines(snapshot.cart, lines)` の結果が入力と**同じ参照**なら何も書かず notify もせず `{ kind: "ok", cart }`（他 tab の Logout で key が消えていても空の Cart key を再作成しない）。それ以外は 1 回だけ `setItem` し（原子的な 1 回の write）、listener を 1 回呼び `{ kind: "ok", cart }`。`setItem` が throw したら `{ kind: "storage_unavailable" }`（notify せず、snapshot も保存内容も変えない）。`removeLines` は残す。
- `reset()`: 明示的な復旧手段。`corrupted` からでも、空の Cart（`serializeCart(EMPTY_CART)`）を書いて listener を呼び `ok`。`setItem` が throw したら `storage_unavailable`。
- `clear()`（FR-CRT-012 / SPEC-050 §15.6 / AR-SES-009 / UF-AUTH-004。Logout 時に shell が呼ぶ）: `storage.removeItem(CART_STORAGE_KEY)` を実行し、成功したら listener を 1 回呼び `{ kind: "ok", cart: EMPTY_CART }`。現在の snapshot を読まず、`setItem` も呼ばないので、`corrupted`（壊れた保存内容、`getItem` が throw する storage を含む）からでも成功し、`corrupted` を返さない。key が無い状態は検証済みの空の Cart（`parseCart(null)`）。`removeItem` が throw したら `{ kind: "storage_unavailable" }`（保存内容も snapshot も変えず、listener も呼ばない）。他 tab へは既存の `storage` event（key 一致）で伝わる。`reset()` は変えない（空の Cart を書く復旧手段のまま）。
- `subscribe(listener)`: 自 store の書き込み成功後と、`subscribeExternal` からの通知（他 tab の変更）のあとに listener を呼ぶ。unsubscribe 後は呼ばない。`subscribeExternal` は最初の listener が付いたときに 1 度だけ購読し、最後の listener が外れたら解除する。
- `getBrowserCartStore()`: `window.localStorage` を使う store を 1 つだけ作る（同一 tab の Header と Cart ページが同じ instance を共有するので、書き込みで即座に更新される。`storage` event は同一 tab では発火しない）。外部通知は `window` の `storage` event のうち `event.key === CART_STORAGE_KEY` または `event.key === null`（`clear()`）のもの。
- Cart store は session を知らない。Guest → 初回 Login は Cart に触れない（保持）。Logout 時の clear は shell（`site-header.tsx`）が `clear()` で行う（FR-CRT-012、SPEC-050 §15.6、AR-SES-009、UF-AUTH-004）。

### 2.4 `features/cart/use-cart.ts` / `use-cart-count.ts`

```ts
export type CartState = { readonly kind: "loading" | "busy" | "blocked" | "storage_unavailable" } | CartSnapshot;
export type CartWriteOutcome = CartWriteResult | { kind: "busy" } | { kind: "blocked" };
export type CartAddOutcome = CartAddResult | { kind: "busy" } | { kind: "blocked" };
export function useCart(): {
  state: CartState;                       // server snapshot と最初の描画は { kind: "loading" }
  add(line: CartLine): CartAddOutcome;
  setQuantity(lineKey: string, quantity: number): CartWriteOutcome;
  remove(lineKey: string): CartWriteOutcome;
  removeLines(lineKeys: readonly string[]): CartWriteOutcome;
  subtractLines(lines: readonly CartLine[]): CartWriteOutcome;
  addFromOrder(items: readonly OrderItem[]): CartAddOutcome;
  reset(): CartWriteOutcome;
  clear(): CartWriteOutcome;
};
```

- `useCart` は `getBrowserCartStore()` を `useSyncExternalStore` で購読する。store が `null` のとき操作（`clear` を含む）は `{ kind: "storage_unavailable" }` を返す。
- FR-CRT-012 の認証遷移中は追加・編集・購入操作を無効化して待機中と示す。Cart停止 / storage取得不可では追加を無効化し、Cart停止は `/cart` の復旧、storage取得不可は理由と再試行を提供する。販売情報の閲覧は継続できる。
- 【B4c-fix】Cart キー（`r39x.cart.v1`）の `getItem` が例外を投げる間は、lifecycle metadata の有無・内容にかかわらず Cart 停止（`blocked`）である（FR-CRT-012「Cartまたはmetadataを安全に読み書き・clearできない場合も停止」）。lifecycle は `getSnapshot` / `initializeGuestIfEmpty` / `markAuthenticated` / `beginTransition` で Cart キーを読めることを確かめ、読めなければ停止する。停止は明示的な復旧（`recover`）が Cart の clear・metadata の更新・Cart キーの読み取りに成功するまで続く。store 単体の snapshot は従来どおり `corrupted`（§2.3）。読めるが壊れた Cart 本体（JSON 破損・schema 不一致）は停止ではなく従来どおり `corrupted`。TC-FR-CRT-012-015 / TC-PG-CRT-001-543。【Q-1。利用者決定: 止める挙動を維持する。UCR は起票しない】metadata が `guest` を示していても、Guest 由来の metadata だけでは読めない Cart を安全と確認できたとみなさない。AuthGate・Guest の Karaoke handoff・Login・登録は止まって `CartRecovery` を出し、復旧後に進める（s6-auth.md §10 の【Q-1】、TC-PG-CRT-001-543）。
- `useCartCount(): number | null` は同じ store を購読する。`ready` → `cartTotalQuantity`、`corrupted` / store なし → `null`、server snapshot は `null`。S3 の表示規則（1 以上のときだけ数字、accessible name `カート（n点）`）は変えない。**同一 tab での追加・変更・削除、他 tab の変更、`localStorage.clear()` のいずれでも Header の数が更新される。**

## 3. `canProceed` と Cart view model

### 3.1 `features/cart/can-proceed.ts`

```ts
export type ProceedBlockReason =
  | { kind: "empty" }
  | { kind: "unresolved" }
  | { kind: "line"; lineKey: string;
      reason: "BEFORE_SALES" | "SALES_ENDED" | "SUSPENDED" | "SOLD_OUT" | "INSUFFICIENT_QUANTITY"
            | "PURCHASE_LIMIT_EXCEEDED" | "unavailable" | "not_public" | PurchaseReason };   // PurchaseReason（9 code）は B4b の eligibility 由来
export type ProceedDecision = { canProceed: true } | { canProceed: false; reasons: readonly ProceedBlockReason[] };
export function canProceed(
  lines: readonly CartLine[], resolutions: readonly CartLineResolution[] | null,
  eligibility?: EligibilityInput,      // 既定 { kind: "not_applicable" }（B4b）
): ProceedDecision;
```

- `lines` が空 → `{ canProceed: false, reasons: [{ kind: "empty" }] }`（`resolutions` を問わない）。
- `lines` があり `resolutions === null`（loading / 取得失敗）→ `reasons: [{ kind: "unresolved" }]`。
- それ以外は line ごとに `cartLineKey(line)` で resolution を探す。resolution が無い → `{ kind: "line", reason: "unavailable" }`。`status: "unavailable"` → `"unavailable"`、`"not_public"` → `"not_public"`、`resolved` で availability が `ON_SALE` 以外 → その `kind`。`ON_SALE` でも `maxSelectableQuantity` が数値でその line の数量より小さければ `"INSUFFICIENT_QUANTITY"`（防御）。`ON_SALE` で `maxSelectableQuantity: null` は購入可。
- 全 line が購入可 → `{ canProceed: true }`。1 つでもあれば `{ canProceed: false, reasons }`（line の順。`lines` に無い resolution は無視）。
- 入力を変更しない。
- 【B4b】公開上は購入可能な line（上の規則で購入可と判定された line）だけが、第 3 引数 `eligibility`（SPEC-110 `API-PUR-ELG-001`、SPEC-050 §12.1 / §14A.1）で絞られる。公開上の理由がある line はその理由のまま（eligibility が何を言っても変えない）。
  - `not_applicable`（Guest / 未確認の利用者。公開条件だけ）→ 購入可のまま（従来と同じ）。
  - `loading` / `unavailable` → その line を未確認として数える（`reasons` に `{ kind: "unresolved" }` を**全体で 1 回だけ**入れる。「上限未到達」と推測して購入可にしない）。
  - `ok` → `findEligibility` で line の entry を探す。entry が無い → `{ kind: "line", reason: "unavailable" }`（購入可と推測しない）。`purchasable: false` → `{ kind: "line", reason: <先頭の理由> }`。`purchasable: true` でも `maxPurchasableQuantity` が line の数量より小さければ `INSUFFICIENT_QUANTITY`（防御）。それ以外は購入可。

### 3.2 `features/cart/cart-view-model.ts`

```ts
export type CartInput = {
  cart: { kind: "loading" } | CartSnapshot;
  resolutions: Loadable<readonly CartLineResolution[]>;   // list-state.ts の Loadable
  refreshing: boolean;                                    // lines または session が変わった後、resolutions と eligibility がまだ現在の Cart と session に対して再取得されていない
  eligibility: EligibilityInput;                          // B4b。API-PUR-ELG-001 の本人向け判定（eligibility-model.ts）。Guest / 未確認は { kind: "not_applicable" }。container は、eligibilityForSession と eligibilityForLines で、現在の session と数量に対して読んだ部分だけを渡す（§5.3）
};
export type CartRow = {
  lineKey: string; kind: "ENTRY_TICKET" | "GOODS"; kindLabel: string; quantity: number;
  name: string | null; unitPriceText: string | null; subtotalText: string | null;
  status: AvailabilityPresentation;                       // presentAvailability の結果
};
export type CartPageModel =
  | { kind: "loading" } | { kind: "corrupted" } | { kind: "empty" }
  | { kind: "unavailable"; rows: readonly CartRow[]; proceed: ProceedDecision }
  | { kind: "ready"; rows: readonly CartRow[]; totalText: string | null; proceed: ProceedDecision };
export function buildCartPageModel(input: CartInput): CartPageModel;
```

- `cart.kind === "loading"` → `loading`。`corrupted` → `corrupted`（resolutions を問わない）。`ready` で `lines` が空 → `empty`（**Cart が検証済みで 0 件のときだけ**。resolutions / refreshing を問わない。resolve の失敗を empty にしない）。
- `lines` があり `resolutions.kind === "loading"` → `loading`（行も金額も出さない）。
- `resolutions` が `ok` 以外（`unavailable` / `not_found` / `auth_required` / `email_unverified`）→ `unavailable`。`rows` は Cart の line の順で、すべて未解決（`name` / `unitPriceText` / `subtotalText` が `null`、`status = presentAvailability({ kind: "unavailable" })`）。`proceed` は `canProceed(lines, null)`。
- `ok` → `ready`。row は Cart の line の順。`resolved` → `name`、`unitPriceText = formatMoney(unitPrice)`、`subtotalText = formatMoney(multiplyMoney(unitPrice, quantity))`、`status = presentAvailability(availability)`。`not_public` → `name` と金額は `null`、`status = presentAvailability({ kind: "not_public" })`。`unavailable` と resolution なしは `status = presentAvailability({ kind: "unavailable" })`、`name` と金額は `null`。
- `totalText`: **すべての row が resolved のときだけ** `formatMoney(各 subtotal の合計)`（bigint。購入不可の row も含む）。1 つでも未解決なら `null`。
- `proceed`: `refreshing === false` → `canProceed(lines, data)`。`refreshing === true` → `{ canProceed: false, reasons: [{ kind: "unresolved" }] }`（直前の resolutions で行は表示し続けるが、現在の Cart に対して未検証なので進めない）。
- 【B4b】`eligibility` の規則（`resolutions` が `ok` のときだけ見る。Cart が loading / corrupted / empty、`resolutions` が loading / ok 以外のときは、これまでの規則のまま eligibility を見ない）:
  - `loading` かつ `refreshing === false`（最初の取得）→ `{ kind: "loading" }`（行も金額も出さない。「上限未到達」と推測して ON_SALE を見せない）。
  - `loading` かつ `refreshing === true`（再取得中）→ `ready`。行は名称・種別・数量・単価・小計を保ち、公開上は購入可能な line の `status` は `presentAvailability({ kind: "unavailable" })`、公開上は購入不可の line は公開の表示。`totalText` は従来の規則。`proceed` は `refreshing` の規則。ON_SALE を見せない。
  - `unavailable` → `{ kind: "unavailable", rows, proceed }`。`rows` は resolved の名称・単価・小計を保つ。`status` は、公開上は購入不可の line ではその公開の表示、公開上は購入可能な line では `presentAvailability({ kind: "unavailable" })`（「状態を確認できません」）。`proceed = canProceed(lines, data, eligibility)`（理由は未確認の 1 回だけ、または公開上の理由）。
  - `not_applicable` → 従来の `ready`。
  - `ok` → `ready`。公開上は購入不可の line は公開の表示（開始日時などを保つ）。公開上は購入可能な line は、entry が無ければ unavailable の表示、`purchasable` なら `presentAvailability({ kind: "ON_SALE", maxSelectableQuantity: maxPurchasableQuantity })`、購入不可なら `presentPurchaseReasons(reasons, maxPurchasableQuantity)`（全理由。s1-presentation.md）。`totalText` の規則は従来のまま。
  - `refreshing` の間に前の値を保つのは、閲覧者にも判定の数量にも依存しない公開 read の部分（名称・種別・単価・小計・合計・公開上は購入不可の line の公開の表示）だけである。本人別判定は、container が現在の session と数量に対応する部分だけを渡し、model は渡された eligibility をそのまま表示する。購入手続きは無効にする。
- 入力を変更しない。

## 4. Entry / Goods の純粋 model

### 4.1 `features/entry/entry-model.ts`

```ts
export type EntryOfferingItem = {
  offeringRef: Ref<"offering">; name: string; description: string;
  unitPrice: Money; priceText: string; salesPeriodText: string;
  status: AvailabilityPresentation; addable: boolean;
  maxSelectableQuantity: number | null;     // ON_SALE のときだけ port の値。それ以外は null
  perAccountLimit: number | null;
};
export function buildEntryModel(
  input: Loadable<readonly EntryOffering[]>,
  eligibility?: EligibilityInput,      // 既定 { kind: "not_applicable" }（B4b）
): ListState<EntryOfferingItem>;
```

- `toListState` に従う（入力順のまま。`unavailable` 等は empty にしない）。`priceText = formatMoney(unitPrice)`。`salesPeriodText = copy.home.period.range(formatJstDateTime(startsAt), formatJstDateTime(endsAt))`。`status = presentAvailability(availability)`、`addable = status.purchasable`（ON_SALE だけ true）。
- 【B4b】公開上 `ON_SALE` の offering だけが `eligibility`（line = 数量 1 の `ENTRY_TICKET`、line key は `cartLineKey`）で絞られる。公開上 ON_SALE でない offering は従来のまま（eligibility が何を言っても変えない）。順序・価格・`perAccountLimit` の案内も従来のまま。
  - `not_applicable` → 従来のまま（Guest / 未確認の利用者は公開の状態だけ）。
  - `loading` / `unavailable` / entry なし → `status = presentAvailability({ kind: "unavailable" })`、`addable: false`、`maxSelectableQuantity: null`（未確認の offering を ON_SALE と見せない）。
  - `ok` かつ `purchasable` → ON_SALE の表示、`addable: true`、`maxSelectableQuantity = min(公開の max ?? Infinity, maxPurchasableQuantity)`。
  - `ok` かつ購入不可 → `presentPurchaseReasons(reasons, maxPurchasableQuantity)`、`addable: false`、`maxSelectableQuantity: null`。
  - `Loadable` が loading / empty / unavailable のときは従来のまま（eligibility を見ない）。入力を変更しない。
- 判定は `decideSaleState(availability, eligibility, targetKey)`（§0。B4c で Goods 詳細と共通化。規則は変えない）で行う。

### 4.2 `features/goods/goods-detail-model.ts`

```ts
export type GoodsDetailModel =
  | { kind: "loading" } | { kind: "not_found" } | { kind: "unavailable" }
  | { kind: "ready"; goodsRef: Ref<"goods">; name: string; description: string; unitPrice: Money; priceText: string;
      salesPeriodText: string; status: AvailabilityPresentation; addable: boolean;
      maxSelectableQuantity: number | null; pickupNotice: string };
export function buildGoodsDetailModel(
  input: Loadable<GoodsDetail>,
  eligibility?: EligibilityInput,      // 既定 { kind: "not_applicable" }（B4c）
): GoodsDetailModel;
/** 本人向け判定を読む対象: 公開上 ON_SALE の Goods だけ（数量 1 の GOODS の line）。それ以外は null。 */
export function goodsEligibilityTarget(input: Loadable<GoodsDetail>): CartLine | null;
```

- `ok` → `ready`（`pickupNotice = copy.goods.detail.pickupNotice`。他は §4.1 と同じ規則）。`not_found` → `not_found`。`unavailable` / `auth_required` / `email_unverified` → `unavailable`（Not Found と混同しない）。`loading` → `loading`。
- 【B4c】公開上 `ON_SALE` の Goods だけが `eligibility`（line = 数量 1 の `GOODS`、key は `cartLineKey`）で絞られる。規則は §4.1 の【B4b】と同じ（`decideSaleState`）: `not_applicable` → 公開のまま（第 2 引数を省略したときと `toEqual`）。`loading` / `unavailable` / entry なし → 「状態を確認できません」・`addable: false`・`maxSelectableQuantity: null`（名称・説明・価格・販売期間・`pickupNotice` は変えない）。購入可 → ON_SALE の表示・`addable: true`・`min(公開の max ?? Infinity, maxPurchasableQuantity)`。購入不可 → `presentPurchaseReasons`・`addable: false`・max null。公開上 ON_SALE でない Goods は eligibility が何を言っても公開の状態のまま。`goodsEligibilityTarget(input)` は ok かつ ON_SALE のときだけ対象を返す（TC-PG-GDS-002-413）。`loading` / `not_found` / `unavailable` は eligibility を見ない。入力を変更しない。

### 4.3 `parseGoodsRef`

`features/public/route-params.ts` の `parseGoodsRef(raw: string): Ref<"goods"> | null`: canonical lowercase UUID だけ（`parseAnnouncementRef` と同じ規則。正規化で救済しない）。

## 5. DOM 契約（E2E が検査する）

共通: 本体は layout の `<main>` の中。購入可否を示す button は、無効のとき**ネイティブ `disabled`** にし、`aria-describedby`（空白区切りで複数 id 可）で**理由の文字列を含む要素**へ結ぶ。数量入力は `<input type="number">`（role `spinbutton`、accessible name は `copy.quantity.label` を含む）。数量が不正なとき入力に `aria-invalid="true"` と、エラー文を含む要素への `aria-describedby` を付け（Add button もそのエラー要素を `aria-describedby` に含める）、Add button を無効にする。

focus 順は DOM 順と一致させる。Entry / Goods では**数量入力の直後（DOM 順）に Add button** を置き、間に focus 可能な要素を置かない（Tab 1 回で Add に届く）。Cart の行では**数量入力の直後に削除 button** を置く。追加結果の live region は `role="status"` 要素 1 つで、Entry / Goods の ready のとき常に DOM に存在し（空）、成功時にだけ文字が入る。ready の `main` 内で `role="status"` を持つ要素はこの 1 つだけにする（`StatusBadge` 等に付けない）。

### 5.1 `/entry`（PG-TKT-001）

- `h1` = `copy.entry.heading`。page 全体の `Cartを見る` Link（`copy.sales.viewCart`、`href="/cart"`）は loading 以外で常に表示する。
- loading: `role="status"` + `copy.pageState.loading`。unavailable: `role="alert"` + `copy.pageState.unavailable(copy.entry.subject)` + `<button>` `copy.pageState.retry`（read だけ再取得）。**有効な Add button を 1 つも出さない**（公開情報取得 Failure は Disabled。SPEC-050 §12.1）。empty: `copy.pageState.empty`。
- ready: `<ul>` の各 `<li>` が offering 1 件（port の順）。`<li>` に `h2` = 名称、説明（`PlainText`）、価格（`priceText`）、販売期間（`formatJstDateTime` で整形した開始と終了の両方）、状態の label と description（理由。`BEFORE_SALES` は開始日時を含む）、`perAccountLimit` が非 null のとき `copy.entry.perAccountLimit(n)`、ON_SALE で `maxSelectableQuantity` が非 null のとき `copy.quantity.guidance(max)`、数量入力（初期値 `1`）、Add button（name に `copy.sales.add` を含む）、表示用合計（`copy.sales.displayTotalLabel` と `formatDisplayTotal(unitPrice, 入力数量)`、`copy.sales.displayTotalNote`）。
- 状態表（SPEC-050 §12.1）: `addable` のとき Add は有効（Guest も Authenticated User も同じ）。それ以外は無効 + 理由。理由の文言は `presentAvailability` の `description`。販売開始前 / 販売中 / 販売終了 / 販売停止 / 売り切れ / 購入上限は互いに別の label。
- page 全体に live region `role="status"` を **ready のとき 1 つだけ**常に描画する（追加前は空）。Add 成功で `copy.sales.addSucceeded` が入る。Cart に書けた場合だけ成功にする。保存先が壊れている（`corrupted`）→ `role="alert"` に `copy.cart.corrupted.title` と `copy.cart.corrupted.goToCart` の Link（`/cart`）を出し、storage を変えず、成功を示さない。`storage_unavailable` → `role="alert"` に `copy.sales.addFailed`、成功を示さない。`quantity_overflow`（保存済み数量との合算が安全な整数を超える）→ `role="alert"` に `copy.sales.addQuantityOverflow`（`copy.sales.addFailed` は出さない）、成功を示さず、保存内容と Header の数は変わらない。成功の live region の文字は `ok` のときだけ。`AddResultNotice` を共有する Entry / Goods の両方で同じ。これらの追加結果は、Add が有効な状態（Cart の状態が `ready` / `corrupted`）で Add を押したときに生じる（`storage_unavailable` は、lifecycle が `ready` のまま `setItem` だけが throw した場合。TC-PG-TKT-001-506 / -510、TC-PG-GDS-002-541）。押した時点で Cart lifecycle が `busy` / `blocked` に変わっていた場合は何も書かず、`busy` → live region に `copy.cart.lifecycleBusy.description`、`blocked` → `role="alert"` に `copy.cart.lifecycleBlocked.description` と `copy.cart.corrupted.goToCart` の Link（`/cart`）を出し、成功を示さない。`storage_unavailable` を返した直後に Cart lifecycle は停止（`blocked`）するので、`copy.sales.addFailed` の alert が表示されたまま、次の停止表示になる。Cart の状態が `busy` / `blocked` / `storage_unavailable` のとき（FR-CRT-012 による停止。lifecycle metadata の有無にかかわらず Cart の保存先を読めない場合を含む。TC-PG-CRT-001-542 / -543）は、数量入力と Add button をネイティブ `disabled` にし、Add button の `aria-describedby` に停止理由を含む要素を結ぶ。理由は `busy` → `copy.cart.lifecycleBusy.description`、`blocked` → `copy.cart.lifecycleBlocked.description`、`storage_unavailable` → `copy.cart.lifecycleBlocked.storageUnavailable`。`blocked` / `storage_unavailable` では、その要素に `copy.cart.corrupted.goToCart` の Link（`/cart`）を置く。停止中は Add を押せないので新しい追加結果は生じず、保存内容も変わらない。停止の前に出た追加結果の表示（alert / live region の文字）は page が保持し、Cart の状態が変わっても消さない（次の追加まで残る）。販売情報の表示は続ける（SPEC-050 §12.1 / §14.2、FR-CRT-012）。`loading`（最初の描画）でも数量入力と Add は無効にする（理由の要素は結ばない）。
- session が変わったとき（`SessionProvider` の state が実際に変わったとき。他 tab のログイン / ログアウトを含む）、Entry は `listEntryOfferings`（公開の read。閲覧者に依存しない）を再取得し、verified の Authenticated User のときだけ `purchase.getPurchaseEligibility`（公開上 ON_SALE の各 offering を数量 1 の `ENTRY_TICKET` として送る）も読み直し、reload なしで各行の状態（例: verified の `demo` の `OFFERING.limit` が `PURCHASE_LIMIT_EXCEEDED`、Add 無効 + 理由。ログアウト後は公開の状態に戻り、前の利用者の判定は残らない）を更新する。公開 read と eligibility は**両方がそろってから 1 回だけ**反映する。session が `loading` の間は読まない（`unavailable` のときは公開 read だけを読み、eligibility は呼ばずに fail closed にする）。再取得の間も一覧は loading へ戻さない。閲覧者に依存しない公開 read の部分（名称・説明・価格・販売期間・`perAccountLimit` の案内・公開上 ON_SALE でない offering の公開の状態）は前の値を保つ。本人別判定は、読んだときの session（`SessionProvider` の state の参照）が現在の session と同じときだけ使う（`eligibilityForSession`）。違うときの扱いは次のとおり。verified → 公開上 ON_SALE の offering は「状態を確認できません」（`copy.availability.label.UNAVAILABLE`）で、Add は無効（`aria-describedby` の理由は `description.UNAVAILABLE`）、数量の上限案内（`copy.quantity.guidance`）は出さず、`role="alert"` も出さない（失敗が確定するまで）。Guest / 未確認 → その場で公開の状態だけを表示する（前の利用者の判定は 1 回の描画の間も残らない）。session が `unavailable` → fail closed（下の【B4b】の unavailable と同じ表示）。古い応答は捨てる。Add の結果表示も残る。session が変わらない再読込み（他 tab の Cart 書き込みの `storage` event 等）では再取得しない。
- 【B4b】本人向け判定（SPEC-050 §12.1、`API-PUR-ELG-001`、SEC-API-029）: `eligibilityMode(session)` が `read`（verified の Authenticated User）のときだけ `getPurchaseEligibility` を呼ぶ。Guest と未確認の利用者は**呼ばない**（公開条件だけを見る。eligibility の失敗も見えない）。読めた判定は ON_SALE の offering の状態・理由・購入できる最大数量（数量入力の上限）に反映する。**読めなかったとき（`unavailable`）は fail closed**: 公開上 ON_SALE の offering は「状態を確認できません」（`copy.availability.label.UNAVAILABLE`）で Add を無効にし、ON_SALE や「購入できます」を出さない。公開上 ON_SALE でない offering は公開の状態のまま。`list.kind === "items"` かつ、現在の session に対応する eligibility が `unavailable` のとき、`AddResultNotice` の前に `role="alert"` で `copy.pageState.unavailable(copy.entry.eligibilitySubject)` と `<button>` `copy.pageState.retry` を出す。retry は公開 read と eligibility の両方を読み直し、reload なしで回復する。判定の結果は localStorage / sessionStorage に**保存しない**（保存内容に eligibility・purchasable・reasons が現れない）。
- 数量入力の検証は `parseQuantityInput(raw, maxSelectableQuantity)`。不正な数量では Cart を変更しない。エラー文は `empty` / `not_integer` / `below_min` → `copy.quantity.invalid`、`above_max` → `copy.quantity.exceedsMax(max)`。
- **購入開始を持たない**: `購入手続き` / `今すぐ購入` を名前に持つ button / link を置かない。Add は `purchase.*` を呼ばず、mock DB を変更しない。

### 5.2 `/goods/{goodsRef}`（PG-GDS-002）

- route param が canonical UUID でない → route module が `NotFoundView` を描画する（`copy.notFound.title`。HTTP status は静的 shell の 200）。port が `not_found`（非公開・存在しない）→ Not Found 表示（`copy.notFound` と同じ見た目で、商品名・「非公開」等を出さない）。`unavailable` → `h1` = `copy.goods.detail.heading` + `role="alert"` + `copy.pageState.unavailable(copy.goods.detail.subject)` + retry（有効な Add を出さない）。loading: `h1` = `copy.goods.detail.heading` + status。
- ready: `h1` = 商品名、説明（`PlainText`）、価格、販売期間、状態の label と description、`copy.goods.detail.pickupNotice`、数量入力、Add button、表示用合計、`Cartを見る` Link、`copy.goods.detail.backToList` Link（`/goods`）、live region（§5.1 と同じ規則）。**配送先住所・配送業者・配送追跡の field や文言を置かない**（入力欄は数量だけ）。`<ul>` / `<li>` を使わない。
- 状態表（§14.2）: ON_SALE のとき Add 有効、その他（販売期間外 / 停止 / 売り切れ / 開始前）は無効 + 理由。Add の検証・結果・購入開始なしは §5.1 と同じ。
- 【B4c】本人向け判定（SPEC-050 §12.1「Goods／Karaokeの対象画面も同Operationを使用する」、§14.2「取得Failure → 購入可否を確認できない → Disabled」、`API-PUR-ELG-001`、SEC-API-029）: §5.1 の session の規則と fail closed の規則を Goods 詳細にも適用する。verified の Authenticated User のときだけ `purchase.getPurchaseEligibility([{ kind: "GOODS", goodsRef, quantity: 1 }])` を呼ぶ（公開上 ON_SALE の Goods だけ。Guest・未確認・session `loading` の間は呼ばない。`unavailable` は呼ばずに fail closed）。公開 read と eligibility は両方がそろってから 1 回だけ反映し、session が変わったら読み直す。再取得の間も名称・説明・価格・販売期間・数量入力・追加結果は保ち（`GoodsReady` は unmount しない）、本人別判定は読んだときの session に対してだけ使う（`eligibilityForSession`）。verified に対応する判定が無い間は「状態を確認できません」・Add 無効（`aria-describedby` の理由は `description.UNAVAILABLE`）・数量の上限案内なし・`role="alert"` なし。Guest / 未確認になったらその場で公開の状態。取得失敗（`unavailable`）は fail closed: 「状態を確認できません」・Add 無効・上限案内なしで、`AddResultNotice` の前に `role="alert"`（`copy.pageState.unavailable(copy.entry.eligibilitySubject)`）と `<button>` `copy.pageState.retry`（公開 read と eligibility の両方を読み直す）を出す。公開上 ON_SALE でない Goods は公開の状態のままで、eligibility を呼ばない。判定は storage に保存しない（TC-PG-GDS-002-507 / -508）。

### 5.3 `/cart`（PG-CRT-001）

- `h1` = `copy.cart.heading`。
- loading: `role="status"` + loading 文言。行・金額・購入手続きボタン・empty 文言を出さない。
- empty（検証済みの 0 件）: `copy.cart.empty`、Link `copy.cart.backToEntry`（`/entry`）と `copy.cart.backToGoods`（`/goods`）、Karaoke 案内（下記）。購入手続きボタンと `role="alert"` は出さない。
- corrupted: `role="alert"` に `copy.cart.corrupted.title` と description、`<button>` `copy.cart.corrupted.reset`。行・empty 文言・購入手続きボタンを出さず、**ボタンを押すまで storage を変更しない**。押すと空の Cart（`{"version":1,"lines":[]}`）が保存され empty 表示になる。
- ready / unavailable: `<ul>` の各 `<li>` が Cart の line 1 件（Cart の順）。`<li>` に `h2` = 名称（未解決は `copy.cart.unknownItemName`）、種別（`kindLabel`）、単価（`copy.cart.unitPriceLabel` と `unitPriceText`。未解決は金額を出さない）、数量入力（§5 の共通規則。`parseQuantityInput(raw, null)`）、小計（`copy.cart.subtotalLabel` と `subtotalText`）、状態の label と description（購入不可理由。ON_SALE の行にも label を出す）、削除 button（name に `copy.cart.remove` を含む）。
  - 数量: 正の整数なら即座に `setQuantity` で保存し、再取得が終わるまで（`refreshing`）購入手続きを無効にする。**入力欄は再取得中も unmount せず、focus を失わない**。不正な値はエラー表示のみで保存しない（行は直前の保存値のまま）。【v3】verified の利用者では、数量を変えた line の本人別判定は、新しい数量で読み直すまで使わない。その line は「状態を確認できません」になる（`eligibilityForLines`）。数量を変えていない line は、同じ session で読んだ判定を保つ。
  - 削除: `remove`。最後の 1 件を消すと empty 表示になる。
- Summary（`<section aria-labelledby>`、見出し `h2` = `copy.cart.summary.heading`）: `totalText` が非 null なら `copy.cart.summary.totalLabel` と合計、null なら `copy.cart.summary.totalUnknown`（金額なし）。常に `copy.cart.summary.recalcNote` と `copy.cart.summary.onePayment`。
- Karaoke 案内（`<section aria-labelledby>`、見出し `h2` = `copy.cart.karaoke.heading`）: `copy.cart.karaoke.body`、Link `copy.cart.karaoke.link`（`/karaoke`）。empty / ready / unavailable で表示（loading / corrupted では出さない）。**Karaoke を Cart へ追加する button / link を提供しない。**
- unavailable（resolve が失敗、または【B4b】verified の利用者の eligibility が失敗）: `role="alert"` + `copy.pageState.unavailable(copy.cart.subject)` + `<button>` `copy.pageState.retry`（`resolveCartLines` と、verified のときは eligibility の再取得）。行は未解決のまま表示（名称は `copy.cart.unknownItemName`、状態 label は `copy.availability.label.UNAVAILABLE`、金額なし）。削除と数量変更は可能。`copy.availability.label.ON_SALE` や「購入できます」を出さない。eligibility の失敗のときは、公開上の理由を持つ行（例: 売り切れ）はその理由を保ち、公開上は購入可能な行だけが「状態を確認できません」になる（名称と金額は保つ）。購入手続きは無効のまま、説明は `copy.cart.proceed.unknown`（公開上の理由を持つ行があれば `copy.cart.proceed.blocked`）。
- 購入手続きボタン `<button type="button">` name = `copy.cart.proceed.label`（exact）。ready と unavailable で表示する。`proceed.canProceed === false` のとき**ネイティブ `disabled`** + `aria-describedby` で理由文を含む要素へ結ぶ（理由に `kind: "line"` が 1 つでもあれば `copy.cart.proceed.blocked`、なければ `copy.cart.proceed.unknown`）。
  - **S5 では、有効なときもクリックは何も起こさない**: Order を作らず、`purchase.*` を呼ばず、画面遷移せず、Cart と mock DB を変更しない。S7a が `cart-page.tsx` の `handleProceed`（Guest は `/account/login?continue=cart`、Authenticated User は `startCartPurchase`）を結線する。Guest も Authenticated User も同じ画面（認証 gate なし）。
- 商品へ戻る: Link `copy.cart.backToEntry`（`/entry`）と `copy.cart.backToGoods`（`/goods`）を ready / unavailable でも表示する。
- resolve は Cart の line が変わるたびに（storage の変更、他 tab の変更を含む）、また session が実際に変わったときに（他 tab のログイン / ログアウトを含む。Cart は同じでも購入済み数量が変わるため）`resolveCartLines` を呼び直し、【B4b】verified の Authenticated User のときは公開上購入可能な line だけを `getPurchaseEligibility` に送って読み直す（`eligibilityTargets`。0 件なら呼ばず `ok` の空とする。Guest / 未確認の利用者は呼ばない）。両方がそろってから 1 回だけ反映し、古い応答は捨てる。判定は storage に保存しない。Cart が空のときは呼ばない。session が `loading` の間は呼ばない。session が変わった後は、再取得が終わるまで、行（閲覧者に依存しない公開 read の部分）を表示したまま購入手続きを無効にする（`refreshing`）。本人別判定は、読んだときの session と数量に対応するものだけを使う（`eligibilityForSession` → `eligibilityForLines`）。verified の利用者に対応する判定が無い間は、公開上は購入可能な行を「状態を確認できません」にし、`role="alert"` は出さない。Guest / 未確認になったら、その場で公開の条件だけの表示にする（前の利用者の判定は残らない）。保存済みの Cart は変わらない。古い応答は捨てる。
- Logout（SPEC-050 §15.6）: ログアウト後は `PG-PUB-001`（Home）へ遷移し、Browser 側の Cart を clear する。Header の件数付き Cart Link は消え、その後に開いた `/cart` は Empty（`copy.cart.empty`）。provider 側の失敗（`auth.logout: "provider_failure"`）でも、保存済み Cart が壊れていても同じ結果。別 tab の `/cart` も Empty になる。Guest → 初回 Login では Cart を保持する。Session 期限切れでの clear は本契約の対象外（AR-SES-007 / FR-CRT-012 後半は別途）。

## 6. E2E の共通条件

- 時刻は `page.clock.setFixedTime(NOW_ISO)`、状態の仕込みは `seedLocalStorage`（S3 / S4 と同じ）。DB 仕込みは `dbJson`。保存内容の確認は `tests/harness/browser/cart.ts`。
- 検査対象のページは、`pageerror` / `console.error`（resource load 失敗を除く）が無く、外部 origin へ要求せず、`/admin` / `/staff` への href を持たず、390px 幅で横 scroll が無い。`/entry` と `/cart`（静的 route）の `Cache-Control` は `private` / `no-store` を含まない（S4 §4 と同じ）。動的 route `/goods/[goodsRef]` は対象外。
- Cart 内容の E2E は seed の UUID（`tests/harness/mock-seed.ts`）だけを使う。保存内容に価格・金額が現れないことを、追加・変更の後で毎回確認する。

## 7. テストファイルと契約の対応

| ファイル | 内容 |
|---|---|
| `tests/unit/web/cart/cart-model.test.ts` | §2.1（`subtractLines` は TC-PG-CRT-001-407） |
| `tests/unit/web/cart/quantity.test.ts` | §2.2 |
| `tests/unit/web/cart/cart-store.test.ts` | §2.3（`subtractLines` は TC-PG-CRT-001-427） |
| `tests/unit/web/cart/can-proceed.test.ts` | §3.1（eligibility は TC-PG-CRT-001-433） |
| `tests/unit/web/purchase/eligibility-model.test.ts` | §0（TC-PG-CRT-001-625。`eligibilityMode` / `eligibilityTargets` / `toEligibilityInput` / `findEligibility` / `eligibilityForSession` / `eligibilityForLines` / `decideSaleState`） |
| `tests/unit/web/auth/session-equality.test.ts` | §5（`sameSessionState`。s3-layout.md §3.3） |
| `tests/unit/web/cart/cart-view-model.test.ts` | §3.2（eligibility は TC-PG-CRT-001-446） |
| `tests/unit/web/cart/sales-models.test.ts` | §4（eligibility は TC-PG-TKT-001-413、Goods 詳細の eligibility は TC-PG-GDS-002-413） |
| `tests/unit/web/cart/s5-copy.test.ts` | §1 |
| `tests/unit/web/cart/s5-static.test.ts` | §0 と静的検査（構成、page 殻、直書き、Karaoke 不在、購入開始不在、Cart本体の単一 schema。FR-CRT-012の別由来metadataは独立したruntime schemaを許す） |
| `tests/e2e/entry-sales.spec.ts` | §5.1（本人向け判定は TC-PG-TKT-001-511。途中表示（latency long）も TC-PG-TKT-001-511） |
| `tests/e2e/goods-detail.spec.ts` | §5.2（本人向け判定は TC-PG-GDS-002-507。session を確定できない（scenario `auth.session: "unavailable"`）ときの fail closed もここで確認する。途中表示（latency long）は TC-PG-GDS-002-508） |
| `tests/e2e/cart-page.spec.ts` | §5.3（本人向け判定は TC-PG-CRT-001-514。途中表示（latency long）も TC-PG-CRT-001-514） |
| `tests/e2e/cart-store.spec.ts` | 永続、Header の即時更新、他 tab、壊れた保存内容、FR-CRT-012 |
| `tests/e2e/cart-session-isolation.spec.ts` | TC-FR-CRT-012-011: lifecycle停止中も販売Pageを表示し、Cart追加を無効にする |
| `tests/e2e/cart-failure-modes.spec.ts` | 書けない / 読めない保存先（TC-PG-CRT-001-541 / -542 / -543、TC-PG-GDS-002-541。-543 は Q-1 の AuthGate・Guest Karaoke handoff・Login・登録の停止と復旧も固定する）。§5.1 の停止表示を含む |
| `tests/e2e/cart-common.spec.ts` | §6（title、見出し、runtime error、外部 origin、href、横 scroll、Cache-Control、404） |

## 8. 曖昧さ・仕様の不足についてテスト担当が決めたこと

1. **数量の上限**: SPEC-050 §12.1 は「正の整数、案内された上限を超えない」を Entry / Goods で検証してよいとし、§14A.1 は下限 1 だけを定める。→ Cart store と Cart ページは上限を創作しない（下限 1 と安全な整数だけ）。上限は Entry / Goods が port の `maxSelectableQuantity`（ON_SALE のときだけ。B4b からは、verified の利用者では公開の上限と eligibility の `maxPurchasableQuantity` の小さい方）で検証する。Cart 内で上限を超えた数量は `resolveCartLines` の `INSUFFICIENT_QUANTITY` / `PURCHASE_LIMIT_EXCEEDED`（公開上限）と eligibility の理由（本人別上限）で購入不可として示す。
2. **一覧の評価数量**: Entry / Goods の port 評価は数量 1 で行われる（S2 §9）。→ `INSUFFICIENT_QUANTITY` は Cart でだけ現れ、Entry / Goods の「売り切れ / 数量不足」は `SOLD_OUT` と数量入力の上限検証で表す（§12.1 の「Disabledまたは数量変更を要求」の後者）。
3. **保存内容の重複 line**: 同じ line key が保存されていたら合算する（S3 の `readCartCount` が合計を返す既存仕様と整合させるため。`corrupted` にしない）。
4. **`addFromOrder` の合算**: SPEC-050 §16.4 は「Cartへ再投入」とだけ定める。→ 既存 line と同じ key なら `add` と同じく加算する。Karaoke 明細は無視（Karaoke は `/karaoke` へ遷移。§16.4 / FR-CRT-002）。
5. **壊れた保存内容と storage 例外**: 「空として扱わない」（§26.4 / Design §4）を、`getItem` の例外にも適用する（`corrupted`）。`setItem` の例外は `storage_unavailable` で、追加成功を主張しない。
6. **同一 tab の更新**: `storage` event は同一 tab で発火しないため、store 自身が通知する。Header の `useCartCount`（S3）は store 経由に変更する（S3 契約 §2.5 の拡張。S3 のテストは変わらない）。
7. **購入手続きボタンの S5 の挙動**: 有効でも何も起こさない（S7a が結線）。無効のとき理由を `aria-describedby` で結ぶ。Cart ページの購入手続きは Guest も Authenticated User も同じ画面。
8. **Resolve 失敗時の行**: 未解決の行を表示し続け（名称は汎用文言、金額なし、状態は「状態を確認できません」）、削除と数量変更を可能にする。購入可能と表示せず、購入手続きは無効（§14A.1 Failure）。
9. **再取得中**: 数量変更後は直前の resolution で行を表示したまま、購入手続きだけを無効にする。入力欄を unmount しない（focus と入力の継続性）。【v3】保つのは、閲覧者にも判定の数量にも依存しない公開 read の部分だけである。本人別判定は、数量を変えた line には使わない（§5.3）。
10. **title**: `copy.pageTitle` は S4 のテストが全 key を固定しているため、S5 の title は `copy.entry` / `copy.cart` / `copy.goods.detail` の `pageTitle` に置く。
11. **Cache-Control**: `/entry` と `/cart` は静的 route として S4 §4 と同じ扱い（`private` / `no-store` を含まない）。
12. **Goods 詳細の `not_found`**: S4 の Announcement 詳細と同じく、client が Not Found 表示（HTTP 200）。不正な UUID も route module が `NotFoundView` を描画する（HTTP 200）。
13. **認証とCart lifecycle**: Login・Logout・Session復元・保護Page / Actionでの期限切れ判定は `FR-CRT-012` に従う。Cart本体とは別の非識別metadataを使い、必要なclearと停止状態の確定後に認証結果を公開する。LogoutはHomeへ戻り、clearのstorage障害でも認証結果を維持する。storage障害では保存値を成功として扱わず、内容・件数・編集・購入を停止し、明示的なclear再試行を提供する。公開PageのGuest照会だけではclearしない。
14. **session 変化での再取得**: Entry / Cart / Goods 詳細の本人別の購入可否は現在のユーザーの購入済み数量に依存するため（B4b からは `API-PUR-ELG-001` の判定。公開 read は閲覧者に依存しない）、Guest で開いたまま別 tab でログインした画面は Guest 時の状態を残してはならず、ログアウトした画面は前の利用者の判定を残してはならない（SPEC-050 §14A.1: 現在の販売状態を Server-side の値で表示）。Cart store は session を知らないまま。`SessionProvider` は `sameSessionState` で、実際に変わったときだけ state の参照を変える（他 tab の Cart 書き込みの `storage` event だけでは再取得しない）。session が `loading` の間は読まない。再取得の間に残すのは、閲覧者に依存しない公開 read の部分だけである。前の session の本人別判定と、判定不要（`not_applicable`）の公開表示は、新しい session に出さない（verified には「状態を確認できません」、Guest / 未確認には公開の状態。SPEC-050 §12.1「取得中を推測せず」、§14A.1、SPEC-110 `API-PUR-ELG-001` Safety、SEC-API-029）。Cart ページは購入手続きを、Entry は公開上 ON_SALE の offering の Add を無効にする。
15. **数量 overflow**: UI から到達できる（Cart ページの数量入力は上限なしで `9007199254740991` を保存でき、その後 Entry / Goods で 1 を追加すると合算が overflow）。保存先に書けない失敗（`storage_unavailable`）とは別の原因なので、別の結果 kind（`quantity_overflow`）と別の文言（`copy.sales.addQuantityOverflow`）で示す。例外 class（`CartQuantityOverflowError extends RangeError`）で区別し、UI で `instanceof RangeError` を使わない。
16. **本人向け判定（B4b、Open issues Q1〜Q7 の既定案）**: SPEC-050 §12.1 は「認証済み利用者の購入上限・購入可能数量は `API-PUR-ELG-001` の本人向け一括判定から取得」「Guest は公開上限と選択数量だけを検証」「取得中・取得 Failure を『上限未到達』と推測せず、再取得を提供」と定める。→ verified の Authenticated User だけが判定を読み、Guest と未確認の利用者は呼ばない（購入開始時に server が login / 確認へ送る）。公開上購入不可の line は判定に送らない（結果が変わらず、件数・数量の 400 も避ける）。判定の失敗は fail closed（「状態を確認できません」）で、`toEligibilityInput` は `auth_required` / `email_unverified` も `unavailable` に写す。判定は保存せず、session が変わるたびに読み直す。Goods 詳細にも同じ規則を適用した（B4c）。Goods は SPEC-030 §10.3 で Purchase Limit を持たないが、§12.1 の「Goods の対象画面も同Operationを使用する」と §14.2 の「取得Failure → Disabled」に従い、取得失敗は fail closed にする。Karaoke Slot は s7b-karaoke.md の【B4c】。
17. **再取得中の行の文言（B4b-F-1）**: 本人別判定の未取得の行は、既存の「状態を確認できません」（`presentAvailability({ kind: "unavailable" })`）で示し、新しい文言・状態を作らない。失敗が確定したとき（`unavailable`）だけ `role="alert"` と再読み込みを出す。

## 9. Hydration-ready signal（検証 round 1 で追加。SPEC-170 §69 / TST-FLK-001）

mobile-chromium で、React の hydration 完了前に test が操作・DOM 変更・待機を始めると、click が捨てられる、`main` に足した要素が hydration で消える、5 秒の待機が尽きる、といった間欠失敗が起きる（runner retry は 0 なので許されない）。

- Web は root layout（`src/routes/root-layout.tsx`）に、**子の後ろ**へ極小の `HydrationMarker` を 1 つ置き（SPA は `createRoot` で描画し hydration しないが、名前と挙動は不変）、`useEffect`（mount 時 1 回、初回 commit の後）で `document.documentElement.dataset.hydrated = "true"` を設定する。表示せず（`null` を返す）、business データ・token・storage は読まない。
- ハーネスは `tests/harness/browser/hydration.ts` の `gotoHydrated` / `reloadHydrated` / `waitForHydration` で `html[data-hydrated="true"]` を最大 15 秒待つ。無ければ「production の signal が無い」と明示するエラーで失敗する。
- 対象 spec: `layout-*`、`public-*`、`entry-sales`、`goods-detail`、`cart-*`。error boundary を検査する `system-pages` / `layout-runtime-errors` / `dev-scenarios` / `smoke` は対象外（root layout が置き換わる可能性があるため）。
- `seedLocalStorage` は呼び出しごとに別の sessionStorage flag を使う（同じ page への 2 回目以降の呼び出しも次の navigation で反映される）。

### 9.3 Host stall の扱い（検証 round 2）

Windows dev host の loopback stall（`playwright.config.ts` 参照）が、hydration 待機の間欠失敗として現れる。round 1 後の実測（workers=2、両 project の full run）は、coder 側 3 回中 1 回失敗（public-common:106）、tester 側 round 2 の 1 回目で全 pass、2 回目で 1 回失敗（public-karaoke:306、mobile、SSR 済みで `data-hydrated` 未設定）、diagnostics 導入後の full run 2 回は全 pass、同条件の 4 spec x4 repeat は 464 件中 1 件失敗が 1 回・0 件が 2 回。約 1 run あたり 20〜30% の確率で 1 件の stall が出る。workers=1 の full run は 454 s で全 pass。

- `waitForHydration` は request ledger（`request` / `requestfinished` / `requestfailed`）、`pageerror`、`console.error` を記録する。15 秒で未観測のとき、failed request・pageerror・console error のいずれかがあれば **厳密に失敗**（`APP-DEFECT-SUSPECTED`）。何も無ければ **1 回だけ**さらに 15 秒（合計 30 秒上限）待つ。それでも無ければ `HOST-STALL-SUSPECTED` として pending / failed 一覧（path のみ、query / body は含めない）付きで失敗する。
- これは retry ではない。test の操作は繰り返さず、runner retry は 0 のまま（SPEC-170 §69）。
- workers=2 を既定のままにする。workers=1 は不安定が続く場合の逃げ道として `--workers=1` で使う。
