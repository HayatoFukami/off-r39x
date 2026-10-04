# S5 Cart / Entry販売 / Goods詳細 契約書（PG-TKT-001 / PG-GDS-002 / PG-CRT-001。購入開始は除く）

テスト担当が定義した S5 の実装契約である。コーディング担当は、ここに書かれたファイルパス・export 名・シグネチャ・文言・DOM 構造をそのまま実装する。対応するテスト:

- Vitest（node）: `tests/unit/web/cart/*.test.ts`
- Playwright（mock mode、`desktop-chromium` と `mobile-chromium`）: `tests/e2e/entry-*.spec.ts`、`goods-detail.spec.ts`、`cart-*.spec.ts`
- ハーネス: `tests/harness/browser/cart.ts`

根拠: `docs/drafts/ui-mock-design.md`（承認済み。Design §4 Cart、§6 Cart flow、S5 行）、SPEC-050 v1.1.0 §8.5 / §9 / §10.2 / §12.1 / §14.2 / §14A.1 / §20 / §21 / §22 / §24 / §25 / §26.4 / §31（4, 6, 24 前半, 25, 28）/ §33、SPEC-020 FR-CRT-001〜005, 011, 012、SPEC-030 BR-ORD-020、SPEC-040 §16A.1 / §16A.9、SPEC-190 DEV-WEB-001〜013 / DEV-TS-004、SPEC-170 TST-UNT-004 / TST-E2E-003 / TST-E2E-004。UI mock suite（補助 suite）であり G8 でも API / DB / Provider coverage でもない。manifest では `critical:false`。S1〜S4 の契約は**変更しない**（S3 の `cart-count.ts` と保存形式 `r39x.cart.v1` は拡張のみ）。

共通の約束（S4 の約束をそのまま引き継ぐ）:

- 文言は `apps/web/src/presentation/copy/ja.ts` の `copy` に集める。S5 の `features/{cart,entry,goods}/**` と新規 `presentation/components/**` に**日本語の直書き・`¥` の直書き・色の直書きを置かない**。金額は `formatMoney` / `multiplyMoney` / `sumMoney`（bigint）、日時は `format/datetime.ts`（JST）。
- page.tsx は Server Component の薄い殻（`metadata` と route param の検証だけ）。データ取得は `"use client"` の container が mount 後（`useEffect`）に `useApi()` 経由で行う。container から `mock/**` を import しない。公開 Content（説明文）は `PlainText` で描画する。
- Cart は**参照と数量だけ**を持つ（FR-CRT-003）。価格・金額・通貨・在庫・販売可否・Owner・Role・個人情報・Secret は保存せず、保存値を権威値にしない。Karaoke は型としても schema としても表現できない（FR-CRT-002）。
- Cart の追加・変更・削除は Business effect を作らない（FR-CRT-001 / BR-ORD-020）。S5 は `purchase.*`（`startCartPurchase` / `startCheckout` / `startKaraokePurchase`）を**呼ばない**。mock DB（`r39x.mock.db.v1`）を書き換える操作も行わない。
- 取得 3 状態（loading / empty / unavailable）の区別は S4 §0 と同じ。loading 中の `main` に、売り切れ / 販売済み / 販売停止 / 販売終了 / 販売開始前 / `0件` / 金額（`¥` + 数字）/ empty 文言 / unavailable 文言を出さない。loading は `role="status"` で `copy.pageState.loading` を含む。
- 各ページの `h1` は 1 つだけ。見出しの level は飛ばさない。`main` 内の `<li>` は、そのページの一覧項目（Entry の offering、Cart の line）だけにする。

## 0. ファイル一覧

| パス | 種別 | export |
|---|---|---|
| `apps/web/src/features/cart/cart-model.ts` | 純粋 | `Cart`, `CartLoad`, `EMPTY_CART`, `parseCart`, `serializeCart`, `addLine`, `setLineQuantity`, `removeLine`, `removeLines`, `addFromOrder`, `cartTotalQuantity` |
| `apps/web/src/features/cart/cart-count.ts` | 純粋（S3 既存。拡張のみ） | `CART_STORAGE_KEY`, `readCartCount`（内部で `parseCart` を使い、zod schema を二重に持たない） |
| `apps/web/src/features/cart/quantity.ts` | 純粋 | `QuantityParse`, `parseQuantityInput`, `formatDisplayTotal` |
| `apps/web/src/features/cart/cart-store.ts` | client から使う | `CartStorage`, `CartSnapshot`, `CartWriteResult`, `CartStore`, `CartStoreDeps`, `createCartStore`, `getBrowserCartStore` |
| `apps/web/src/features/cart/use-cart.ts` | client hook | `CartState`, `useCart` |
| `apps/web/src/features/cart/use-cart-count.ts` | client hook（S3 既存。変更） | `useCartCount`（store 経由。同一 tab の変更でも更新される） |
| `apps/web/src/features/cart/can-proceed.ts` | 純粋 | `ProceedBlockReason`, `ProceedDecision`, `canProceed` |
| `apps/web/src/features/cart/cart-view-model.ts` | 純粋 | `CartInput`, `CartRow`, `CartPageModel`, `buildCartPageModel` |
| `apps/web/src/features/cart/add-to-cart-form.tsx` | client view | `AddToCartForm`（Entry / Goods 共通の数量 + 追加 UI） |
| `apps/web/src/features/cart/cart-page.tsx` | client container | `CartPage` |
| `apps/web/src/features/entry/entry-model.ts` | 純粋 | `EntryOfferingItem`, `buildEntryModel` |
| `apps/web/src/features/entry/entry-page.tsx` | client container | `EntryPage` |
| `apps/web/src/features/goods/goods-detail-model.ts` | 純粋 | `GoodsDetailModel`, `buildGoodsDetailModel` |
| `apps/web/src/features/goods/goods-detail-page.tsx` | client container | `GoodsDetailPage`（props `{ goodsRef: Ref<"goods"> }`） |
| `apps/web/src/features/public/route-params.ts` | 純粋（S4 既存。追加のみ） | `parseGoodsRef` を追加 |
| `apps/web/app/entry/page.tsx` | route | `/entry`（PG-TKT-001）。`metadata.title = copy.entry.pageTitle` |
| `apps/web/app/goods/[goodsRef]/page.tsx` | route | PG-GDS-002。async `params` を `await`。`parseGoodsRef` が null なら `notFound()`。`metadata.title = copy.goods.detail.pageTitle` |
| `apps/web/app/cart/page.tsx` | route | `/cart`（PG-CRT-001）。`metadata.title = copy.cart.pageTitle` |

route 用ファイルは `app/<path>/page.tsx` でも `app/(public)/<path>/page.tsx` でもよい。`app/layout.tsx` の title template（`%s | SITE_NAME`）により、title は `${copy.entry.pageTitle} | ${SITE_NAME}` 等になる。**title は `copy.pageTitle` へ足さない**（S4 の `s4-copy.test.ts` が `copy.pageTitle` の全 key を固定しているため）。

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
export function addFromOrder(cart: Cart, items: readonly OrderItem[]): Cart;
export function cartTotalQuantity(cart: Cart): number;
```

- すべて**純粋**（入力を変更しない、新しい `Cart` を返す）。`CartLine` は `api-client/types.ts`、line key は既存 `cartLineKey`（`${kind}:${ref}`。数量・並び順に依存しない）。
- `parseCart`: `raw === null`（key なし）→ `ok` + 空の Cart。JSON として不正・schema 不正・空文字は `corrupted`（**空の Cart にしない**）。schema は strict（トップレベルも line も）: `version: 1`、`lines` の各要素は `ENTRY_TICKET`（`offeringRef`）か `GOODS`（`goodsRef`）、ref は canonical lowercase UUID、`quantity` は 1 以上の**安全な整数**。余分な field（価格・在庫・Owner 等）、`KARAOKE`、未知の kind は `corrupted`。S3 の `readCartCount` 表（`cart-count.test.ts`）の拒否ケースはすべて `corrupted`。**同じ line key が複数あれば数量を合算して 1 本にする**（最初の出現位置。`readCartCount` の合計と一致させるため。`corrupted` にはしない）。数量の上限は設けない（安全な整数の範囲だけ。Cart は Entry / Goods の `maxSelectableQuantity` を知らない）。
- `serializeCart`: `JSON.stringify({ version: 1, lines })`。line は `kind` / ref / `quantity` だけ。`parseCart(serializeCart(c))` は `ok` で `c` と等しい。
- `addLine`: 同じ line key があれば数量を**加算**（位置は変えない）、なければ末尾に追加。line が不正（数量が 1 以上の安全な整数でない、ref が canonical UUID でない、`KARAOKE` や未知の kind、余分な field）なら `RangeError` を throw。加算結果が安全な整数を超える場合も `RangeError`。
- `setLineQuantity`: 数量を置き換える（位置を変えない）。数量が 1 以上の安全な整数でなければ `RangeError`（0 にする代わりに `removeLine` を使う）。存在しない key は何もしない（等しい Cart を返す）。
- `removeLine` / `removeLines`: 該当 line を除く（残りの順序は保つ）。存在しない key は無視。空の `lineKeys` は何もしない。
- `addFromOrder`（再購入時の再投入。SPEC-050 §16.4 / FR-CRT-011 の純粋部）: `ENTRY_TICKET` と `GOODS` の明細だけを、**参照と数量だけ**で `addLine` と同じ規則で（既存と同じ line key なら加算）明細の順に加える。`KARAOKE` の明細は無視する（Cart に入れられない）。名前・単価・小計は読まない・保存しない。明細が空、または Karaoke だけなら等しい Cart を返す。
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
export interface CartStore {
  getSnapshot(): CartSnapshot;
  subscribe(listener: () => void): () => void;
  add(line: CartLine): CartWriteResult;
  setQuantity(lineKey: string, quantity: number): CartWriteResult;
  remove(lineKey: string): CartWriteResult;
  removeLines(lineKeys: readonly string[]): CartWriteResult;
  addFromOrder(items: readonly OrderItem[]): CartWriteResult;
  reset(): CartWriteResult;
}
export type CartStoreDeps = { storage: CartStorage; subscribeExternal?: (onChange: () => void) => () => void };
export function createCartStore(deps: CartStoreDeps): CartStore;
export function getBrowserCartStore(): CartStore | null;   // window.localStorage が使えないとき（SSR 等）は null
```

- 永続化先は `CART_STORAGE_KEY = "r39x.cart.v1"`（`cart-count.ts`）。
- `getSnapshot()`: 呼ぶたびに storage を読むが、**保存文字列が変わらない限り同じ参照を返す**（`useSyncExternalStore` 用）。`parseCart` が `ok` → `ready`、`corrupted` → `corrupted`。`getItem` が throw した場合も `corrupted`（内容を確認できないので空として扱わない）。
- 変更操作（`add` / `setQuantity` / `remove` / `removeLines` / `addFromOrder`）: 現在の snapshot が `corrupted` なら**何も書かず** `{ kind: "corrupted" }`。それ以外は cart-model の関数で新しい Cart を作り `serializeCart` で `CART_STORAGE_KEY` に書く。`setItem` が throw したら `{ kind: "storage_unavailable" }`（保存されたと主張しない。snapshot も変わらない）。成功したら `subscribe` 済みの listener を呼び `{ kind: "ok", cart }`。不正な引数（`RangeError`）は throw する（storage は変更しない）。
- `reset()`: 明示的な復旧手段。`corrupted` からでも、空の Cart（`serializeCart(EMPTY_CART)`）を書いて listener を呼び `ok`。`setItem` が throw したら `storage_unavailable`。
- `subscribe(listener)`: 自 store の書き込み成功後と、`subscribeExternal` からの通知（他 tab の変更）のあとに listener を呼ぶ。unsubscribe 後は呼ばない。`subscribeExternal` は最初の listener が付いたときに 1 度だけ購読し、最後の listener が外れたら解除する。
- `getBrowserCartStore()`: `window.localStorage` を使う store を 1 つだけ作る（同一 tab の Header と Cart ページが同じ instance を共有するので、書き込みで即座に更新される。`storage` event は同一 tab では発火しない）。外部通知は `window` の `storage` event のうち `event.key === CART_STORAGE_KEY` または `event.key === null`（`clear()`）のもの。
- Login / Logout は Cart に触れない（FR-CRT-012）。Cart store は session を知らない。

### 2.4 `features/cart/use-cart.ts` / `use-cart-count.ts`

```ts
export type CartState = { readonly kind: "loading" } | CartSnapshot;
export function useCart(): {
  state: CartState;                       // server snapshot と最初の描画は { kind: "loading" }
  add(line: CartLine): CartWriteResult;
  setQuantity(lineKey: string, quantity: number): CartWriteResult;
  remove(lineKey: string): CartWriteResult;
  removeLines(lineKeys: readonly string[]): CartWriteResult;
  addFromOrder(items: readonly OrderItem[]): CartWriteResult;
  reset(): CartWriteResult;
};
```

- `useCart` は `getBrowserCartStore()` を `useSyncExternalStore` で購読する。store が `null` のとき操作は `{ kind: "storage_unavailable" }` を返す。
- `useCartCount(): number | null` は同じ store を購読する。`ready` → `cartTotalQuantity`、`corrupted` / store なし → `null`、server snapshot は `null`。S3 の表示規則（1 以上のときだけ数字、accessible name `カート（n点）`）は変えない。**同一 tab での追加・変更・削除、他 tab の変更、`localStorage.clear()` のいずれでも Header の数が更新される。**

## 3. `canProceed` と Cart view model

### 3.1 `features/cart/can-proceed.ts`

```ts
export type ProceedBlockReason =
  | { kind: "empty" }
  | { kind: "unresolved" }
  | { kind: "line"; lineKey: string;
      reason: "BEFORE_SALES" | "SALES_ENDED" | "SUSPENDED" | "SOLD_OUT" | "INSUFFICIENT_QUANTITY"
            | "PURCHASE_LIMIT_EXCEEDED" | "unavailable" | "not_public" };
export type ProceedDecision = { canProceed: true } | { canProceed: false; reasons: readonly ProceedBlockReason[] };
export function canProceed(lines: readonly CartLine[], resolutions: readonly CartLineResolution[] | null): ProceedDecision;
```

- `lines` が空 → `{ canProceed: false, reasons: [{ kind: "empty" }] }`（`resolutions` を問わない）。
- `lines` があり `resolutions === null`（loading / 取得失敗）→ `reasons: [{ kind: "unresolved" }]`。
- それ以外は line ごとに `cartLineKey(line)` で resolution を探す。resolution が無い → `{ kind: "line", reason: "unavailable" }`。`status: "unavailable"` → `"unavailable"`、`"not_public"` → `"not_public"`、`resolved` で availability が `ON_SALE` 以外 → その `kind`。`ON_SALE` でも `maxSelectableQuantity` が数値でその line の数量より小さければ `"INSUFFICIENT_QUANTITY"`（防御）。`ON_SALE` で `maxSelectableQuantity: null` は購入可。
- 全 line が購入可 → `{ canProceed: true }`。1 つでもあれば `{ canProceed: false, reasons }`（line の順。`lines` に無い resolution は無視）。
- 入力を変更しない。

### 3.2 `features/cart/cart-view-model.ts`

```ts
export type CartInput = {
  cart: { kind: "loading" } | CartSnapshot;
  resolutions: Loadable<readonly CartLineResolution[]>;   // list-state.ts の Loadable
  refreshing: boolean;                                    // 数量変更後、resolutions がまだ現在の Cart に対して再取得されていない
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
export function buildEntryModel(input: Loadable<readonly EntryOffering[]>): ListState<EntryOfferingItem>;
```

- `toListState` に従う（入力順のまま。`unavailable` 等は empty にしない）。`priceText = formatMoney(unitPrice)`。`salesPeriodText = copy.home.period.range(formatJstDateTime(startsAt), formatJstDateTime(endsAt))`。`status = presentAvailability(availability)`、`addable = status.purchasable`（ON_SALE だけ true）。

### 4.2 `features/goods/goods-detail-model.ts`

```ts
export type GoodsDetailModel =
  | { kind: "loading" } | { kind: "not_found" } | { kind: "unavailable" }
  | { kind: "ready"; goodsRef: Ref<"goods">; name: string; description: string; unitPrice: Money; priceText: string;
      salesPeriodText: string; status: AvailabilityPresentation; addable: boolean;
      maxSelectableQuantity: number | null; pickupNotice: string };
export function buildGoodsDetailModel(input: Loadable<GoodsDetail>): GoodsDetailModel;
```

- `ok` → `ready`（`pickupNotice = copy.goods.detail.pickupNotice`。他は §4.1 と同じ規則）。`not_found` → `not_found`。`unavailable` / `auth_required` / `email_unverified` → `unavailable`（Not Found と混同しない）。`loading` → `loading`。

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
- page 全体に live region `role="status"` を **ready のとき 1 つだけ**常に描画する（追加前は空）。Add 成功で `copy.sales.addSucceeded` が入る。Cart に書けた場合だけ成功にする。保存先が壊れている（`corrupted`）→ `role="alert"` に `copy.cart.corrupted.title` と `copy.cart.corrupted.goToCart` の Link（`/cart`）を出し、storage を変えず、成功を示さない。`storage_unavailable` → `role="alert"` に `copy.sales.addFailed`、成功を示さない。
- 数量入力の検証は `parseQuantityInput(raw, maxSelectableQuantity)`。不正な数量では Cart を変更しない。エラー文は `empty` / `not_integer` / `below_min` → `copy.quantity.invalid`、`above_max` → `copy.quantity.exceedsMax(max)`。
- **購入開始を持たない**: `購入手続き` / `今すぐ購入` を名前に持つ button / link を置かない。Add は `purchase.*` を呼ばず、mock DB を変更しない。

### 5.2 `/goods/{goodsRef}`（PG-GDS-002）

- route param が canonical UUID でない → server 側の `notFound()`（HTTP 404、`copy.notFound.title`）。port が `not_found`（非公開・存在しない）→ Not Found 表示（`copy.notFound` と同じ見た目で、商品名・「非公開」等を出さない）。`unavailable` → `h1` = `copy.goods.detail.heading` + `role="alert"` + `copy.pageState.unavailable(copy.goods.detail.subject)` + retry（有効な Add を出さない）。loading: `h1` = `copy.goods.detail.heading` + status。
- ready: `h1` = 商品名、説明（`PlainText`）、価格、販売期間、状態の label と description、`copy.goods.detail.pickupNotice`、数量入力、Add button、表示用合計、`Cartを見る` Link、`copy.goods.detail.backToList` Link（`/goods`）、live region（§5.1 と同じ規則）。**配送先住所・配送業者・配送追跡の field や文言を置かない**（入力欄は数量だけ）。`<ul>` / `<li>` を使わない。
- 状態表（§14.2）: ON_SALE のとき Add 有効、その他（販売期間外 / 停止 / 売り切れ / 開始前）は無効 + 理由。Add の検証・結果・購入開始なしは §5.1 と同じ。

### 5.3 `/cart`（PG-CRT-001）

- `h1` = `copy.cart.heading`。
- loading: `role="status"` + loading 文言。行・金額・購入手続きボタン・empty 文言を出さない。
- empty（検証済みの 0 件）: `copy.cart.empty`、Link `copy.cart.backToEntry`（`/entry`）と `copy.cart.backToGoods`（`/goods`）、Karaoke 案内（下記）。購入手続きボタンと `role="alert"` は出さない。
- corrupted: `role="alert"` に `copy.cart.corrupted.title` と description、`<button>` `copy.cart.corrupted.reset`。行・empty 文言・購入手続きボタンを出さず、**ボタンを押すまで storage を変更しない**。押すと空の Cart（`{"version":1,"lines":[]}`）が保存され empty 表示になる。
- ready / unavailable: `<ul>` の各 `<li>` が Cart の line 1 件（Cart の順）。`<li>` に `h2` = 名称（未解決は `copy.cart.unknownItemName`）、種別（`kindLabel`）、単価（`copy.cart.unitPriceLabel` と `unitPriceText`。未解決は金額を出さない）、数量入力（§5 の共通規則。`parseQuantityInput(raw, null)`）、小計（`copy.cart.subtotalLabel` と `subtotalText`）、状態の label と description（購入不可理由。ON_SALE の行にも label を出す）、削除 button（name に `copy.cart.remove` を含む）。
  - 数量: 正の整数なら即座に `setQuantity` で保存し、再取得が終わるまで（`refreshing`）購入手続きを無効にする。**入力欄は再取得中も unmount せず、focus を失わない**。不正な値はエラー表示のみで保存しない（行は直前の保存値のまま）。
  - 削除: `remove`。最後の 1 件を消すと empty 表示になる。
- Summary（`<section aria-labelledby>`、見出し `h2` = `copy.cart.summary.heading`）: `totalText` が非 null なら `copy.cart.summary.totalLabel` と合計、null なら `copy.cart.summary.totalUnknown`（金額なし）。常に `copy.cart.summary.recalcNote` と `copy.cart.summary.onePayment`。
- Karaoke 案内（`<section aria-labelledby>`、見出し `h2` = `copy.cart.karaoke.heading`）: `copy.cart.karaoke.body`、Link `copy.cart.karaoke.link`（`/karaoke`）。empty / ready / unavailable で表示（loading / corrupted では出さない）。**Karaoke を Cart へ追加する button / link を提供しない。**
- unavailable（resolve が失敗）: `role="alert"` + `copy.pageState.unavailable(copy.cart.subject)` + `<button>` `copy.pageState.retry`（`resolveCartLines` の再取得のみ）。行は未解決のまま表示（名称は `copy.cart.unknownItemName`、状態 label は `copy.availability.label.UNAVAILABLE`、金額なし）。削除と数量変更は可能。`copy.availability.label.ON_SALE` や「購入できます」を出さない。
- 購入手続きボタン `<button type="button">` name = `copy.cart.proceed.label`（exact）。ready と unavailable で表示する。`proceed.canProceed === false` のとき**ネイティブ `disabled`** + `aria-describedby` で理由文を含む要素へ結ぶ（理由に `kind: "line"` が 1 つでもあれば `copy.cart.proceed.blocked`、なければ `copy.cart.proceed.unknown`）。
  - **S5 では、有効なときもクリックは何も起こさない**: Order を作らず、`purchase.*` を呼ばず、画面遷移せず、Cart と mock DB を変更しない。S7a が `cart-page.tsx` の `handleProceed`（Guest は `/account/login?continue=cart`、Authenticated User は `startCartPurchase`）を結線する。Guest も Authenticated User も同じ画面（認証 gate なし）。
- 商品へ戻る: Link `copy.cart.backToEntry`（`/entry`）と `copy.cart.backToGoods`（`/goods`）を ready / unavailable でも表示する。
- resolve は Cart の line が変わるたびに（storage の変更、他 tab の変更を含む）`resolveCartLines` を呼び直す。Cart が空のときは呼ばない。

## 6. E2E の共通条件

- 時刻は `page.clock.setFixedTime(NOW_ISO)`、状態の仕込みは `seedLocalStorage`（S3 / S4 と同じ）。DB 仕込みは `dbJson`。保存内容の確認は `tests/harness/browser/cart.ts`。
- 検査対象のページは、`pageerror` / `console.error`（resource load 失敗を除く）が無く、外部 origin へ要求せず、`/admin` / `/staff` への href を持たず、390px 幅で横 scroll が無い。`/entry` と `/cart`（静的 route）の `Cache-Control` は `private` / `no-store` を含まない（S4 §4 と同じ）。動的 route `/goods/[goodsRef]` は対象外。
- Cart 内容の E2E は seed の UUID（`tests/harness/mock-seed.ts`）だけを使う。保存内容に価格・金額が現れないことを、追加・変更の後で毎回確認する。

## 7. テストファイルと契約の対応

| ファイル | 内容 |
|---|---|
| `tests/unit/web/cart/cart-model.test.ts` | §2.1 |
| `tests/unit/web/cart/quantity.test.ts` | §2.2 |
| `tests/unit/web/cart/cart-store.test.ts` | §2.3 |
| `tests/unit/web/cart/can-proceed.test.ts` | §3.1 |
| `tests/unit/web/cart/cart-view-model.test.ts` | §3.2 |
| `tests/unit/web/cart/sales-models.test.ts` | §4 |
| `tests/unit/web/cart/s5-copy.test.ts` | §1 |
| `tests/unit/web/cart/s5-static.test.ts` | §0 と静的検査（構成、page 殻、直書き、Karaoke 不在、購入開始不在、単一 schema） |
| `tests/e2e/entry-sales.spec.ts` | §5.1 |
| `tests/e2e/goods-detail.spec.ts` | §5.2 |
| `tests/e2e/cart-page.spec.ts` | §5.3 |
| `tests/e2e/cart-store.spec.ts` | 永続、Header の即時更新、他 tab、壊れた保存内容、FR-CRT-012 |
| `tests/e2e/cart-common.spec.ts` | §6（title、見出し、runtime error、外部 origin、href、横 scroll、Cache-Control、404） |

## 8. 曖昧さ・仕様の不足についてテスト担当が決めたこと

1. **数量の上限**: SPEC-050 §12.1 は「正の整数、案内された上限を超えない」を Entry / Goods で検証してよいとし、§14A.1 は下限 1 だけを定める。→ Cart store と Cart ページは上限を創作しない（下限 1 と安全な整数だけ）。上限は Entry / Goods が port の `maxSelectableQuantity`（ON_SALE のときだけ）で検証する。Cart 内で上限を超えた数量は `resolveCartLines` の `INSUFFICIENT_QUANTITY` / `PURCHASE_LIMIT_EXCEEDED` で購入不可として示す。
2. **一覧の評価数量**: Entry / Goods の port 評価は数量 1 で行われる（S2 §9）。→ `INSUFFICIENT_QUANTITY` は Cart でだけ現れ、Entry / Goods の「売り切れ / 数量不足」は `SOLD_OUT` と数量入力の上限検証で表す（§12.1 の「Disabledまたは数量変更を要求」の後者）。
3. **保存内容の重複 line**: 同じ line key が保存されていたら合算する（S3 の `readCartCount` が合計を返す既存仕様と整合させるため。`corrupted` にしない）。
4. **`addFromOrder` の合算**: SPEC-050 §16.4 は「Cartへ再投入」とだけ定める。→ 既存 line と同じ key なら `add` と同じく加算する。Karaoke 明細は無視（Karaoke は `/karaoke` へ遷移。§16.4 / FR-CRT-002）。
5. **壊れた保存内容と storage 例外**: 「空として扱わない」（§26.4 / Design §4）を、`getItem` の例外にも適用する（`corrupted`）。`setItem` の例外は `storage_unavailable` で、追加成功を主張しない。
6. **同一 tab の更新**: `storage` event は同一 tab で発火しないため、store 自身が通知する。Header の `useCartCount`（S3）は store 経由に変更する（S3 契約 §2.5 の拡張。S3 のテストは変わらない）。
7. **購入手続きボタンの S5 の挙動**: 有効でも何も起こさない（S7a が結線）。無効のとき理由を `aria-describedby` で結ぶ。Cart ページの購入手続きは Guest も Authenticated User も同じ画面。
8. **Resolve 失敗時の行**: 未解決の行を表示し続け（名称は汎用文言、金額なし、状態は「状態を確認できません」）、削除と数量変更を可能にする。購入可能と表示せず、購入手続きは無効（§14A.1 Failure）。
9. **再取得中**: 数量変更後は直前の resolution で行を表示したまま、購入手続きだけを無効にする。入力欄を unmount しない（focus と入力の継続性）。
10. **title**: `copy.pageTitle` は S4 のテストが全 key を固定しているため、S5 の title は `copy.entry` / `copy.cart` / `copy.goods.detail` の `pageTitle` に置く。
11. **Cache-Control**: `/entry` と `/cart` は静的 route として S4 §4 と同じ扱い（`private` / `no-store` を含まない）。
12. **Goods 詳細の `not_found`**: S4 の Announcement 詳細と同じく、client が Not Found 表示（HTTP 200）。不正な UUID だけ server の `notFound()`（HTTP 404）。

## 9. Hydration-ready signal（検証 round 1 で追加。SPEC-170 §69 / TST-FLK-001）

mobile-chromium で、React の hydration 完了前に test が操作・DOM 変更・待機を始めると、click が捨てられる、`main` に足した要素が hydration で消える、5 秒の待機が尽きる、といった間欠失敗が起きる（runner retry は 0 なので許されない）。

- Web は root layout（`app/layout.tsx`）の `<body>` 内に、**子の後ろ**へ極小の client component を 1 つ置き、`useEffect`（mount 時 1 回）で `document.documentElement.dataset.hydrated = "true"` を設定する。表示せず（`null` を返す）、business データ・token・storage は読まない。
- ハーネスは `tests/harness/browser/hydration.ts` の `gotoHydrated` / `reloadHydrated` / `waitForHydration` で `html[data-hydrated="true"]` を最大 15 秒待つ。無ければ「production の signal が無い」と明示するエラーで失敗する。
- 対象 spec: `layout-*`、`public-*`、`entry-sales`、`goods-detail`、`cart-*`。error boundary を検査する `system-pages` / `layout-runtime-errors` / `dev-scenarios` / `smoke` は対象外（root layout が置き換わる可能性があるため）。
- `seedLocalStorage` は呼び出しごとに別の sessionStorage flag を使う（同じ page への 2 回目以降の呼び出しも次の navigation で反映される）。

### 9.3 Host stall の扱い（検証 round 2）

Windows dev host の loopback stall（`playwright.config.ts` 参照）が、hydration 待機の間欠失敗として現れる。round 1 後の実測（workers=2、両 project の full run）は、coder 側 3 回中 1 回失敗（public-common:106）、tester 側 round 2 の 1 回目で全 pass、2 回目で 1 回失敗（public-karaoke:306、mobile、SSR 済みで `data-hydrated` 未設定）、diagnostics 導入後の full run 2 回は全 pass、同条件の 4 spec x4 repeat は 464 件中 1 件失敗が 1 回・0 件が 2 回。約 1 run あたり 20〜30% の確率で 1 件の stall が出る。workers=1 の full run は 454 s で全 pass。

- `waitForHydration` は request ledger（`request` / `requestfinished` / `requestfailed`）、`pageerror`、`console.error` を記録する。15 秒で未観測のとき、failed request・pageerror・console error のいずれかがあれば **厳密に失敗**（`APP-DEFECT-SUSPECTED`）。何も無ければ **1 回だけ**さらに 15 秒（合計 30 秒上限）待つ。それでも無ければ `HOST-STALL-SUSPECTED` として pending / failed 一覧（path のみ、query / body は含めない）付きで失敗する。
- これは retry ではない。test の操作は繰り返さず、runner retry は 0 のまま（SPEC-170 §69）。
- workers=2 を既定のままにする。workers=1 は不安定が続く場合の逃げ道として `--workers=1` で使う。
