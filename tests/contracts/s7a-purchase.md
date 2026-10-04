# S7a Cart購入開始 / mock Checkout / Purchase Status 契約書（PG-CRT-001 購入手続き / `/dev/mock-checkout/[orderRef]` / PG-XFN-001 / 再購入）

テスト担当が定義した S7a の実装契約である。コーディング担当は、ここに書かれたファイルパス・export 名・シグネチャ・文言・DOM 構造をそのまま実装する。対応するテスト:

- Vitest（node）: `tests/unit/web/purchase/*.test.ts`、`tests/unit/web/mock/seeded-order-checkout.test.ts`
- Playwright（mock mode、`desktop-chromium` と `mobile-chromium`）: `tests/e2e/purchase-*.spec.ts`、`tests/e2e/mock-checkout.spec.ts`
- ハーネス: `tests/harness/browser/purchase.ts`

根拠: `docs/drafts/ui-mock-design.md`（承認済み。Design §3 PurchaseApi、§4、§5、§6 Cart購入の流れ / mock Checkout / OrderOutcome、§7 Continuation、S7a 行、Test plan E2E 7〜12 / 19（XFN 部分）/ 26 / 27）、SPEC-050 v1.1.0 §14A.1（購入手続き、Purchase start result）/ §16（PG-XFN-001 全体）/ §19.2 / §20 / §21 / §22 / §25 / §26.2 / §31（7〜12, 19, 26, 27）、SPEC-030 BR-ORD-013〜020、SPEC-020 FR-CRT-007〜011、SPEC-070 PAY-BRW-001〜003 / §8、SPEC-140 SEC-WEB-005 / 009、SPEC-110 §22、SPEC-190 DEV-WEB-001〜013、SPEC-170 TST-UNT-004 / TST-E2E-003 / TST-E2E-004。UI mock suite（補助 suite）であり G8 でも API / DB / Provider coverage でもない。manifest では `critical:false`、`api_operation_ids` / `db_constraint_names` は空。S1〜S6 の契約は**変更しない**（拡張のみ。既存 export の名前・シグネチャは変えない）。

## 0. 範囲

- 含む: Cart の「購入手続きへ進む」の結線（Guest → Login、Authenticated → `purchase.startCartPurchase` → `purchase.startCheckout`）、mock Checkout 画面、PG-XFN-001 Purchase Status（OrderOutcome 部品を含む）、再購入（Entry / Goods / 複合は Cart へ再投入、Karaoke は `/karaoke`）、`AccessDeniedView`（PG-XFN-003 の部品。S8 が Mypage の経路を足す）。
- 含まない（S7b / S8）: Karaoke の購入開始（PG-KRK-003 の `startKaraokePurchase`、Hold 系 scenario の画面）、Mypage の各ページ（`/mypage/orders` ほか）。S7a の画面は S8 の route へ `href` を張るだけで、遷移先の実在を前提にしない。E2E 7 の「Mypage の注文一覧に同じ Order がある」は、S7a では mock DB の `orders` に同じ Order が 1 件あることで確認し、一覧 UI の確認は S8 が行う。E2E 7〜9 の Karaoke 側は S7b。ただし seed 済みの Karaoke Order（`ORDER.kValid` / `ORDER.expired`）を PG-XFN-001 で開く確認は S7a に含める。
- **mock backend / port への追加は不要**。S2 の `createMockApi`（`purchase.startCartPurchase`、`purchase.startCheckout`、`self.getOrder`、`self.listOrders`）、`ApiPort` の型、`AuthPort` は**変更しない**。必要な動作（Purpose 決定、all-or-nothing、同一 idempotencyKey の同一結果、`/dev/mock-checkout/<orderRef>` の redirect、`confirm_after_recheck` の read 回数、entitlements の CONFIRMED 限定、`notice`）はすべて S2 契約 §9〜§11 で実装済みであり、`tests/unit/web/mock/*.test.ts` が検証している。coder は `apps/web/src/mock/backend/**` と `src/api-client/{port,types}.ts` を変更しない。追加するのは `src/mock/dev-ui/mock-checkout-screen.tsx` だけ。

共通の約束（S4 / S5 / S6 の約束を引き継ぐ）:

- 文言は `apps/web/src/presentation/copy/ja.ts` の `copy` に集める。S7a の新規ファイル（`features/purchase/**`、`src/config/purchase-routes.ts`、新規 `presentation/components/**`、`src/mock/dev-ui/mock-checkout-screen.tsx`、route）に**日本語の直書き・`¥` の直書き・色の直書きを置かない**。金額は `formatMoney`（bigint）、日時は `format/datetime.ts`（JST）。
- page.tsx は Server Component の薄い殻（`metadata` と route param の検証だけ。async `params` を `await` する）。データ取得は `"use client"` の container が mount 後（`useEffect`）に `useApi()` 経由で行う。`features/**` から `mock/**` を import しない。
- 価格・金額・数量の権威は port の戻り値だけ。Cart の保存値・URL・Continuation の値を権威にしない。Browser Return（mock Checkout からの戻り）だけで成功を表示しない（PAY-BRW-001〜003）。
- `console.*`、`localStorage` / `sessionStorage` の直接参照、`dangerouslySetInnerHTML` を `features/purchase/**` と新規ファイルで使わない（Cart の保存は既存の `useCart()` / cart store 経由だけ）。
- 各ページの `h1` は 1 つだけ。見出しの level は飛ばさない。`main` 内の `role="alert"` は同時に 1 つだけ。
- Order の ref（UUID）、内部の Stripe Event 名・Webhook ID・内部 DB ID を、画面の本文テキストへ表示しない（SPEC-050 §16.2）。URL の path に ref があるのは可。

## 1. ファイル一覧

| パス | 種別 | export |
|---|---|---|
| `apps/web/src/config/purchase-routes.ts` | 純粋（react / next を import しない。型 import のみ） | `parseOrderRef`, `purchaseOrderHref`, `mypageOrderHref`, `entitlementsListHref`, `entryTicketHref`, `reservationHref`, `goodsItemHref`, `mockCheckoutHref` |
| `apps/web/src/features/purchase/cart-purchase-flow.ts` | 純粋 | `ProceedPlan`, `planProceed`, `CartStartStep`, `interpretCartStart`, `CheckoutStep`, `interpretCheckoutStart`, `isSafeCheckoutUrl`, `RejectionLine`, `describeRejections` |
| `apps/web/src/features/purchase/purchase-status-model.ts` | 純粋 | `PurchaseItemRow`, `PurchaseAction`, `EntitlementsModel`, `PurchaseStatusModel`, `buildPurchaseStatusModel`, `recheckAnnouncement` |
| `apps/web/src/features/purchase/purchase-again.ts` | 純粋 | `PurchaseAgainPlan`, `planPurchaseAgain` |
| `apps/web/src/features/purchase/use-cart-purchase.ts` | client hook | `CartPurchasePhase`, `useCartPurchase` |
| `apps/web/src/features/purchase/cart-purchase-feedback.tsx` | client view | `CartPurchaseFeedback`（購入開始中の status と、不成立の error summary） |
| `apps/web/src/features/purchase/order-outcome.tsx` | view | `OrderOutcome`（PG-XFN-001 と将来の PG-MYP-004 が共有する部品） |
| `apps/web/src/features/purchase/purchase-status-page.tsx` | client container | `PurchaseStatusPage`（props `{ orderRef: Ref<"order"> }`） |
| `apps/web/src/features/cart/cart-page.tsx` | client container（S5 既存。変更） | `CartPage`（`handleProceed` を `useCartPurchase` へ結線） |
| `apps/web/src/presentation/components/access-denied-view.tsx` | 純粋な表示部品 | `AccessDeniedView`（props `{ listHref: string; listLabel: string }`） |
| `apps/web/src/mock/dev-ui/mock-checkout-screen.tsx` | view（dev 専用） | `MockCheckoutScreen`（props `{ orderRef: Ref<"order"> }`） |
| `apps/web/app/(self)/purchase/orders/[orderRef]/page.tsx` | route | PG-XFN-001。`metadata.title = copy.purchase.pageTitle` |
| `apps/web/app/dev/mock-checkout/[orderRef]/page.tsx` | route（`app/dev/**`） | `metadata.title = copy.mockCheckout.pageTitle` |

- `(self)/layout.tsx`（S6 の AuthGate）が `/purchase/*` を覆う。変更しない。
- `/dev/mock-checkout/*` は `app/dev/layout.tsx` の guard 配下（mock 無効時は `notFound()`、noindex）。一般の Navigation / Footer / Drawer / sitemap から Link しない。
- title は `${copy.purchase.pageTitle} | ${SITE_NAME}` 等（root layout の template）。`copy.pageTitle` へ足さない。
- 既存の再利用: `presentOrderState` / `orderActionLabel` / `presentPurpose` / `purchaseAgainTarget` / `presentNotification` / `presentRejectionReason`（S1）、`CartStore.addFromOrder` / `removeLines`（S5）、`accountPath` / `continuationPath`（S6）、`StatusBadge` / `PageState` / `ExternalLink` / `PlainText` / `SectionHeading`。

## 2. 文言 `copy`（`ja.ts` に追加。既存 key は変えない）

```ts
cart: {
  // 既存の key に加えて
  purchase: {
    verifying: "購入条件を確認しています",
    preparing: "支払い画面を準備中です。購入はまだ確定していません",
    rejectedTitle: "購入は開始されていません",
    rejectedBody: "購入手続きは作成されていません。カートの内容はそのまま残っています。成立しなかった商品を確認し、数量を変更するか削除してください",
    unavailable: "購入条件を確認できませんでした。購入は開始されていません。時間をおいて、もう一度お試しください",
  },
},
purchase: {
  pageTitle: "購入状況",
  heading: "購入状況",
  subject: "購入状況",
  outcomeHeading: "現在の状態",
  purposeLabel: "購入の種類",
  createdAtLabel: "作成日時",
  itemsHeading: "購入内容",
  totalLabel: "合計金額",
  quantity: (count: number): string => `数量 ${count}`,
  usage: (dateText: string, rangeText: string): string => `利用日時 ${dateText} ${rangeText}`,
  itemKind: { ENTRY_TICKET: "Entry Ticket", GOODS: "Goods", KARAOKE: "Karaoke" },
  checkoutPreparing: "支払い画面を準備中です。購入はまだ確定していません",
  checkoutStartFailed: "支払い画面を開始できませんでした。購入は確定していません",
  recheck: {
    inProgress: "購入状態を確認しています",
    unchanged: "購入状態はまだ変わっていません",
    changed: (label: string): string => `購入状態が『${label}』に更新されました`,
    failed: "購入状態を取得できませんでした。時間をおいて、もう一度お試しください",
  },
  entitlements: {
    heading: "購入した権利",
    entryHeading: "Entry Ticket",
    entryLink: (index: number): string => `Entry Ticket ${index}を見る`,
    karaokeHeading: "Karaoke予約",
    reservationLink: "Karaoke Ticketを見る",
    goodsHeading: "Goods",
    goodsLink: (index: number): string => `Goods ${index}を見る`,
  },
  receipt: { link: "Receiptを見る" },
},
accessDenied: {
  title: "このページの内容を表示できません",
  description: "対象を表示または操作できません。マイページから、ご自身の購入情報をご確認ください。",
  mypageLink: "マイページへ戻る",
  ordersLink: "注文一覧へ戻る",
},
mockCheckout: {
  pageTitle: "支払い画面（モック）",
  heading: "Stripe Checkoutの代替モック。実際の決済は行われません",
  note: "ここで押すボタンでは購入は確定しません。購入状態は、開発用シナリオの「支払い結果」に従って、購入状況ページで決まります",
  pay: "支払う（モック）",
  back: "戻る",
},
```

- 上記の文字列は**そのまま**使う（`s7a-copy.test.ts` が固定する）。全 leaf は trim 済みの非空 string か関数。
- `copy.cart.purchase.rejectedTitle` は SPEC-050 §14A.1 の固定文言。`copy.cart.purchase.verifying` は §14A.1 の「購入条件を確認しています」。`copy.purchase.checkoutStartFailed` は §16.6 の固定文言。`copy.purchase.recheck.changed("購入確定")` は設計書の固定文言「購入状態が『購入確定』に更新されました」。
- `copy.cart.purchase.preparing` / `copy.purchase.checkoutPreparing` は「支払い画面を準備中」を含み、`copy.order.state.CONFIRMED`（購入確定）・「完了」・「成功」を含まない（購入成功表示をしない。§14A.1）。
- `copy.accessDenied.*` は「他の」「存在」を含まない（対象の存在を確定させない。§19.2）。
- `copy.mockCheckout.heading` は「実際の決済は行われません」を含み、`copy.mockCheckout.note` は購入が確定しないことを含む。

## 3. 純粋 module

### 3.1 `src/config/purchase-routes.ts`

```ts
export function parseOrderRef(raw: string): Ref<"order"> | null;   // canonical lowercase UUID だけ。正規化で救済しない
export const purchaseOrderHref: (ref: string) => string;           // `/purchase/orders/${ref}`
export const mypageOrderHref: (ref: string) => string;             // `/mypage/orders/${ref}`
export const entryTicketHref: (ref: string) => string;             // `/mypage/entry-tickets/${ref}`
export const reservationHref: (ref: string) => string;             // `/mypage/karaoke/${ref}`
export const goodsItemHref: (ref: string) => string;               // `/mypage/goods/${ref}`
export const mockCheckoutHref: (ref: string) => string;            // `/dev/mock-checkout/${ref}`
export function entitlementsListHref(purpose: OrderPurpose): string;
```

- `entitlementsListHref`: `ENTRY_TICKET_PURCHASE` → `/mypage/entry-tickets`、`KARAOKE_PURCHASE` → `/mypage/karaoke`、`GOODS_PURCHASE` → `/mypage/goods`、`ENTRY_GOODS_PURCHASE` → `/mypage/entry-tickets`（複合は Entry の一覧を主導線とし、Goods は同じ画面の権利欄から個別に辿れる）。exhaustive な switch（`assertNever`）。
- すべて同一 origin の相対 path で、`isSafeRelativePath`（S6）を通る形。

### 3.2 `features/purchase/cart-purchase-flow.ts`

```ts
export type ProceedPlan = { kind: "go_login"; to: string } | { kind: "start" };
export function planProceed(session: SessionState): ProceedPlan;   // SessionState は auth/use-session の型（import type）
```

- `status: "ready"` かつ `session.kind === "guest"` → `{ kind: "go_login", to: accountPath("login", { key: "cart", ref: null }) }`（= `/account/login?continue=cart`）。Cart は変更しない（Cart 内容は保持。§14A.1）。
- それ以外（`loading` / `unavailable` / authenticated の確認済み・未確認）→ `{ kind: "start" }`。認証・確認状態の判定は server（port）の結果で行い、UI は未検証の Identity を購入可として扱わない。

```ts
export type CartStartStep =
  | { kind: "checkout"; orderRef: Ref<"order">; includedLineKeys: readonly string[] }
  | { kind: "rejected"; rejections: readonly { lineKey: string; reason: CartRejectionReasonCode }[] }
  | { kind: "go_login"; to: string }
  | { kind: "go_verification"; to: string }
  | { kind: "unavailable" };
export function interpretCartStart(result: CartPurchaseStart): CartStartStep;
```

- `created` → `checkout`（`orderRef` と `includedLineKeys` をそのまま）。`rejected` → `rejected`（`rejections` をそのまま。空でも `rejected`）。`auth_required` → `go_login`（`accountPath("login", cart intent)`）。`email_unverified` → `go_verification`（`accountPath("email-verification", cart intent)`。`continue=cart` を引き継ぐ）。`unavailable` → `unavailable`。入力を変更しない。

```ts
export type CheckoutStep = { kind: "assign"; url: string } | { kind: "go_status"; to: string };
export function interpretCheckoutStart(orderRef: Ref<"order">, result: CheckoutStart): CheckoutStep;
export function isSafeCheckoutUrl(url: string): boolean;
```

- `redirect` かつ `isSafeCheckoutUrl(url)` → `assign`（`location.assign` で top-level 遷移。SEC-WEB-005）。それ以外のすべて（`redirect` で URL が不正、`start_failed`、`opportunity_expired`、`state_conflict`、`auth_required`、`unavailable`）→ `go_status`、`to = purchaseOrderHref(orderRef)`（PG-XFN-001 が現在の Order 状態を読み直して表示する。盲目的な retry をしない）。
- `isSafeCheckoutUrl`: 文字列全体が次のどちらかのときだけ true。(a) `isSafeRelativePath(url)` を満たす同一 origin の相対 path（例 `/dev/mock-checkout/<uuid>`）。(b) `https:` の絶対 URL で、userinfo（username / password）が無く、`new URL` で解釈できる。それ以外（空、`http:`、`javascript:`、`data:`、`//host/...`、backslash を含む、制御文字を含む、前後に空白、`/admin...`、userinfo 付き）は false。例外を throw しない。

```ts
export type RejectionLine = { lineKey: string; name: string; label: string; description: string };
export function describeRejections(
  rejections: readonly { lineKey: string; reason: CartRejectionReasonCode }[],
  names: ReadonlyMap<string, string | null>,
): RejectionLine[];
```

- 入力の順のまま 1 件ずつ。`name` は `names.get(lineKey)`（未登録・null は `copy.cart.unknownItemName`）。`label` / `description` は `presentRejectionReason(reason)`（S1）。

### 3.3 `features/purchase/purchase-status-model.ts`

```ts
export type PurchaseItemRow = {
  key: string; kind: "ENTRY_TICKET" | "GOODS" | "KARAOKE"; kindLabel: string; name: string;
  quantityText: string | null;      // Entry / Goods: copy.purchase.quantity(n)。Karaoke: null
  usageText: string | null;         // Karaoke: copy.purchase.usage(formatJstDate(start), formatJstTimeRange(start, end))。他: null
  unitPriceText: string; subtotalText: string;
};
export type PurchaseAction =
  | { kind: "retry_checkout"; label: string }
  | { kind: "recheck_status"; label: string }
  | { kind: "purchase_again"; label: string; target: "cart" | "karaoke" }
  | { kind: "link"; action: "view_purchase" | "view_entitlements"; label: string; href: string };
export type EntitlementsModel = {
  entryTickets: readonly { ref: string; label: string; href: string }[];
  reservation: { ref: string; label: string; href: string } | null;
  goodsItems: readonly { ref: string; label: string; href: string; itemLabel: string; handoffLabel: string }[];
};
export type PurchaseStatusModel =
  | { kind: "loading" } | { kind: "denied" } | { kind: "unavailable" }
  | { kind: "ready"; orderRef: Ref<"order">; stateKey: OrderState; stateLabel: string; description: string;
      tone: Tone; purposeLabel: string; createdAtText: string; totalText: string;
      items: readonly PurchaseItemRow[]; actions: readonly PurchaseAction[];
      entitlements: EntitlementsModel | null;
      notice: { label: string; message: string } | null; receiptHref: string | null };
export function buildPurchaseStatusModel(input: Loadable<OrderDetail>): PurchaseStatusModel;
export function recheckAnnouncement(previous: OrderState, next: OrderState): string;
```

- `loading` → `loading`。`not_found` → `denied`（他者所有と不存在を区別しない。SPEC-110 §22、§16.8）。`unavailable` / `auth_required` / `email_unverified` → `unavailable`（`denied` や空と混同しない）。`ok` → `ready`。
- `stateLabel` / `description` / `tone` は `presentOrderState(state)`、`purposeLabel` は `presentPurpose(purpose).label`、`createdAtText = formatJstDateTime(createdAt)`、`totalText = formatMoney(total)`。`items` は Order の明細の順（購入時 Snapshot。`unitPriceText` / `subtotalText` は `formatMoney`）。`kindLabel = copy.purchase.itemKind[kind]`。`key` は明細ごとに一意（例 `kind + ref + index`）。
- **`entitlements`（INV-010-07 / BR-ORD-015 の多重防御）**: `presentOrderState(state).showsEntitlements`（= `CONFIRMED`）でなければ、port が entitlements を返しても **`null`**。`CONFIRMED` のときも、Purpose が要求する権利が**すべて**揃っているときだけ非 null: Entry を含む Purpose は `entryTicketRefs.length >= 1`、Goods を含む Purpose は `goodsItems.length >= 1`、`KARAOKE_PURCHASE` は `reservationRef !== null`。1 つでも欠けたら**全体を `null`**（複合 Order で一部の権利だけを有効表示しない）。非 null のとき `label` は `copy.purchase.entitlements.entryLink(i + 1)` / `reservationLink` / `goodsLink(i + 1)`（i は port の順）、`href` は `entryTicketHref` / `reservationHref` / `goodsItemHref`、`itemLabel = copy.goods.item[itemState]`、`handoffLabel = copy.goods.handoff[handoffState]`。Purpose に含まれない種類は空（`entryTickets: []` / `reservation: null` / `goodsItems: []`）。
- **`actions`**: `presentOrderState(state).actions` の順で、`orderActionLabel(action)` を `label` にする。`retry_checkout` → `{ kind: "retry_checkout" }`、`recheck_status` → `{ kind: "recheck_status" }`、`purchase_again` → `{ kind: "purchase_again", target: purchaseAgainTarget(purpose) }`、`view_purchase` → `{ kind: "link", action: "view_purchase", href: mypageOrderHref(orderRef) }`、`view_entitlements` → **`entitlements !== null` のときだけ** `{ kind: "link", action: "view_entitlements", href: entitlementsListHref(purpose) }`（null なら出さない）。
- **`notice`**: `detail.notice?.kind === "email_delayed"` かつ `state === "CONFIRMED"` のときだけ `presentNotification("FAILED_RETRYABLE")` の `{ label, message }`。それ以外は `null`（§16.7）。通知に再試行の action を持たせない（`actions` へ足さない）。
- **`receiptHref`**: `state === "CONFIRMED"` かつ `safeExternalHref(receiptUrl) !== null`（https で userinfo なし）のときだけその URL。それ以外は `null`。
- `recheckAnnouncement(previous, next)`: `previous !== next` → `copy.purchase.recheck.changed(presentOrderState(next).label)`、同じ → `copy.purchase.recheck.unchanged`。
- 入力を変更しない。

### 3.4 `features/purchase/purchase-again.ts`

```ts
export type PurchaseAgainPlan =
  | { kind: "karaoke"; href: "/karaoke" }
  | { kind: "cart"; href: "/cart"; items: readonly OrderItem[] };
export function planPurchaseAgain(purpose: OrderPurpose, items: readonly OrderItem[]): PurchaseAgainPlan;
```

- `purchaseAgainTarget(purpose)`（S1）が `karaoke` → `{ kind: "karaoke", href: "/karaoke" }`（Cart へ何も入れない。新 Slot / Hold 取得から。§16.4）。`cart` → `{ kind: "cart", href: "/cart", items }`。`items` は `ENTRY_TICKET` と `GOODS` の明細だけを元の順で残す（`KARAOKE` は除く。FR-CRT-002）。空でも `cart`。入力を変更しない。

## 4. Cart の購入手続き（`CartPage` / `useCartPurchase` / `CartPurchaseFeedback`）

`handleProceed`（S5 の seam。名前を保つ）は `useCartPurchase` の `start()` を呼ぶ。`useCartPurchase` は `useSession()`（`planProceed`）、`useApi().purchase`、`useCart()` を使う。

```ts
export type CartPurchasePhase =
  | { kind: "idle" } | { kind: "verifying" } | { kind: "preparing" }
  | { kind: "rejected"; rejections: readonly RejectionLine[] } | { kind: "unavailable" };
```

流れ（SPEC-050 §14A.1 Actions / Purchase start result、設計 §6）:

1. `planProceed(session)`。`go_login` → `router.push(to)`（API を呼ばない。Cart・DB を変えない）。`start` → 2。
2. phase = `verifying`。idempotency key を**この試行ごとに 1 つ**新しく作る（`crypto.randomUUID()`）。`purchase.startCartPurchase(lines, { idempotencyKey })` を呼ぶ（`lines` は Cart の現在の line。価格を含めない）。処理中は購入手続き button を**ネイティブ `disabled` + `aria-busy="true"`**（name は変えない）にし、二重送信を抑止する（double click で Order は 1 件だけ）。
3. `interpretCartStart(result)`:
   - `go_login` / `go_verification` → `router.push(to)`。
   - `rejected` → phase = `rejected`（`describeRejections` に Cart の行名を渡す）。**Cart を変更しない**。error summary へ focus を移す。**`resolveCartLines` を再取得して**行の状態表示を現在の状態に更新する（古い「販売中」のまま進めなくなるのを防ぐ）。
   - `unavailable` → phase = `unavailable`。Cart を変更しない。
   - `checkout` → phase = `preparing`。`cart.removeLines(includedLineKeys)`（失敗しても続行する。Order は作成済み）。続けて新しい idempotency key で `purchase.startCheckout(orderRef, { idempotencyKey })`。`interpretCheckoutStep` 相当（`interpretCheckoutStart`）が `assign` → `window.location.assign(url)`、`go_status` → `router.push(purchaseOrderHref(orderRef))`。
4. `preparing` の間、`main` は `h1` と status だけを描画する（行・Summary・購入手続き button・**`copy.cart.empty`** を出さない。Order 作成直後に Cart が空になっても「カートは空です」を見せない）。`verifying` の間は行・Summary を保つ。

DOM（`CartPurchaseFeedback`。`ready` / `unavailable` の Cart で表示）:

- **live region**: `<div role="status">` を Cart の ready / unavailable のとき**常に 1 つ**描画し、通常は空。`verifying` のとき `copy.cart.purchase.verifying`、`preparing` のとき `copy.cart.purchase.preparing` を入れる。
- **不成立の error summary**（`rejected`）: `<div role="alert" tabindex="-1">`。`copy.cart.purchase.rejectedTitle`、`copy.cart.purchase.rejectedBody`、**不成立の line だけ**を 1 件ずつ `<p>`（`<li>` を使わない）に「名称 + `label` + `description`」で並べる。表示後に**この要素へ focus** を移す。次の購入試行を始めたら消える。`main` 内の `role="alert"` はこれ 1 つ。
- **`unavailable`**: `<div role="alert">` + `copy.cart.purchase.unavailable`。Cart・DB は変わらない。
- 購入手続き button の `disabled` / 理由の結び付け（S5）は変えない。`rejected` / `unavailable` のあと、button は再び（`canProceed` が許すなら）有効になり、再試行できる。

## 5. mock Checkout（`/dev/mock-checkout/[orderRef]`）

- route 殻: async `params` を `await`、`parseOrderRef` が null なら `notFound()`（HTTP 404）。それ以外は `MockCheckoutScreen`。mock 無効時は `app/dev/layout.tsx` が `notFound()`。
- DOM: `h1` = `copy.mockCheckout.heading`（大きく表示。1 つだけ）、`copy.mockCheckout.note`、Link `copy.mockCheckout.pay`（name exact）と Link `copy.mockCheckout.back`（name exact）。**どちらも `href = purchaseOrderHref(orderRef)`**（PG-XFN-001 へ戻るだけ）。入力欄（`input` / `textarea` / `select`、role `textbox` / `spinbutton` / `combobox`）を**置かない**（カード番号等を扱わない）。`main` 内に `role="alert"` を置かない。
- **この画面は mock DB を読み書きしない**（`self.getOrder` を含め port を一切呼ばない）。Order の state と `webhookReads` はこの画面の表示・操作の前後で変わらない。Browser Return（pay / back のどちらでも）は Order を確定しない（PAY-BRW-001〜003）。Order の状態は、PG-XFN-001 の `getOrder` が scenario `paymentOutcome` に従って決める。
- 一般 Navigation から到達できない。`/admin` / `/staff` への href、外部 origin への要求、外部 font を持たない。

## 6. PG-XFN-001 Purchase Status（`/purchase/orders/[orderRef]`）

- route 殻（Server Component）: async `params` を `await`。`parseOrderRef` が null → **`AccessDeniedView`** を直接描画する（HTTP 200。`notFound()` にしない。存在の有無を確定させない。`listHref = "/mypage/orders"`、`listLabel = copy.accessDenied.ordersLink`）。それ以外は `<PurchaseStatusPage orderRef={...} />`。AuthGate（`(self)/layout.tsx`）の内側。
- `PurchaseStatusPage`（client container）: AuthGate が allow した後の mount で `self.getOrder(orderRef)` を**ちょうど 1 回**読む（mount ごと。S2 契約 §16-4: `confirm_after_recheck` の初回 read は呼び出し回数で数える）。「状態を再確認」の press ごとに 1 回だけ読む。再読込（reload）は同じ Order を読み直すだけで新しい Order を作らない（§22）。`buildPurchaseStatusModel` で整形する。
- **Ownership（§26.2 / §16.8）**: read が `not_found` なら、データを描画する前に `AccessDeniedView` を表示する（redirect しない。`h1` = `copy.accessDenied.title`）。他者所有 ref と不存在 ref で、`main` のテキストが**完全に同じ**になる。Order 内容・state・Purpose・購入者・存在の有無を一切出さない。

### 6.1 DOM

- `h1` = `copy.purchase.heading`（loading / unavailable / ready で共通。denied だけ `copy.accessDenied.title`）。
- loading: `role="status"` + `copy.pageState.loading`。Order の内容・state label・金額を出さない。
- unavailable: `role="alert"` + `copy.pageState.unavailable(copy.purchase.subject)` + `<button type="button">` `copy.pageState.retry`（`getOrder` の再取得。空の表示や Access Denied にしない）。
- ready: 次の構造。**`main` 内で `role="status"` を持つ要素は live region の 1 つだけ**。`StatusBadge` 等に `role` を付けない。
  1. `<section aria-labelledby>`（region。見出し `h2` = `copy.purchase.outcomeHeading`）: `StatusBadge`（`stateLabel` を**テキストで**表示）、`description`、`copy.purchase.purposeLabel` + `purposeLabel`、`copy.purchase.createdAtLabel` + `createdAtText`、`notice`（あれば `label` と `message` を含む非阻害の `<p>`。`role="alert"` にしない。ボタンを付けない）、**live region `<div role="status">`**（ready のとき常に存在。初期は空）、actions。
  2. `<section aria-labelledby>`（見出し `h2` = `copy.purchase.itemsHeading`）: `<ul>` の各 `<li>` が 1 明細。名称、`kindLabel`、`quantityText`（Karaoke は `usageText`）、`copy.cart.unitPriceLabel` + `unitPriceText`、`copy.cart.subtotalLabel` + `subtotalText`。末尾に `copy.purchase.totalLabel` + `totalText`。
  3. `entitlements !== null` のときだけ `<section aria-labelledby>`（見出し `h2` = `copy.purchase.entitlements.heading`）: 含まれる種類ごとに `h3`（`entryHeading` / `karaokeHeading` / `goodsHeading`）と、`<a href>`（`label`）。Goods は各 item に `itemLabel` と `handoffLabel` をテキストで併記し、`copy.goods.detail.pickupNotice` を表示する（会場受け取り導線。§16.5）。Entry と Goods（複合）は**別の見出しの下**に並べる。
  4. `receiptHref !== null` のとき `ExternalLink`（`copy.purchase.receipt.link`。`target="_blank"` `rel="noopener noreferrer"`）。`null` ならリンクも見出しも出さない。
- **actions の DOM**: `retry_checkout` / `recheck_status` / `purchase_again` は `<button type="button">`（name = `label`、exact）。`link` は `<a href>`（name = `label`、exact）。state ごとの集合は `presentOrderState` のとおり: `PREPARED` = 「支払い開始を再試行」だけ、`AWAITING_PAYMENT` と `REVIEW_REQUIRED` = 「状態を再確認」だけ（「もう一度購入する」「支払い開始を再試行」を**出さない**）、`CONFIRMED` = Link 「購入内容を見る」（`/mypage/orders/{ref}`）と Link 「Ticket / Reservation / Goodsを見る」（`entitlementsListHref`）で **button を 1 つも持たない**（Email 失敗時も再実行 button を出さない。§16.7）、`PAYMENT_FAILED` / `CANCELED` / `EXPIRED` = 「もう一度購入する」だけ。
- **Browser Return（§16.3）**: 最初に必ず `getOrder` の結果を取得して表示する。Return の種類（どの button / リンクで戻ったか）で state を断定しない。`AWAITING_PAYMENT` のとき、`copy.order.state.CONFIRMED`、`copy.order.description.CONFIRMED`、「支払い完了」「Ticket発行済み」、権利（`/mypage/entry-tickets` / `/mypage/karaoke` / `/mypage/goods` 配下）へのリンクを**出さない**。

### 6.2 操作

- **状態を再確認**（`recheck_status`）: button を `disabled` + `aria-busy="true"` にし、live region に `copy.purchase.recheck.inProgress`。`getOrder` を 1 回読み、結果が `ok` なら画面を新しい Order に更新して live region に `recheckAnnouncement(previous.state, next.state)`（状態が変われば `changed(label)`、同じなら `unchanged`）。`not_found` → `AccessDeniedView`。それ以外（`unavailable` 等）→ **前に表示していた内容を残したまま** `role="alert"` + `copy.purchase.recheck.failed`。新しい Order を作らない・購入系 port を呼ばない（§21）。
- **支払い開始を再試行**（`retry_checkout`、`PREPARED` のみ）: button を `disabled` + `aria-busy="true"`、live region に `copy.purchase.checkoutPreparing`。**新しい idempotency key** で `purchase.startCheckout(orderRef)`（同じ Order を再利用。新 Order を作らない）。`interpretCheckoutStart` の `assign` → `location.assign`。`go_status`（`start_failed` / `opportunity_expired` / `state_conflict` / `unavailable` / `auth_required`）→ 同じページの Order を `getOrder` で読み直して表示する（`opportunity_expired` は `EXPIRED` の「もう一度購入する」へ切り替わる。盲目的な retry をしない）。**`start_failed` のときだけ** `role="alert"` + `copy.purchase.checkoutStartFailed` を表示する（PREPARED のまま。retry button は残る。§16.6）。
- **もう一度購入する**（`purchase_again`）: `planPurchaseAgain(purpose, items)`。`cart` → `cart.addFromOrder(items)`（参照と数量だけ。既存 line と同じ key は加算。新 Order を作らない、`purchase.*` を呼ばない）→ `router.push("/cart")`（価格・販売状態・在庫は Cart が現在の状態で表示し直す。§16.4）。write が `corrupted` なら storage を変えずに `/cart` へ遷移する（Cart が `copy.cart.corrupted.title` を示す）。`storage_unavailable` なら遷移せず `role="alert"` + `copy.sales.addFailed`。`karaoke` → Cart を触らず `router.push("/karaoke")`。
- 再投入した Item は、販売停止・売り切れ等でも**そのまま Cart に入る**（Cart が理由を示し、購入手続きを無効にする）。

### 6.3 `AccessDeniedView`（PG-XFN-003 の部品）

- `h1` = `copy.accessDenied.title`、`copy.accessDenied.description`、Link `copy.accessDenied.mypageLink` → `/mypage`、Link `{listLabel}` → `{listHref}`（本人所有一覧へ戻る）。retry button を出さない（権限は再試行で得られない。§19.2）。他者の氏名・state・購入内容、「他の利用者のもの」の類の文言を出さない。props 以外の入力（ref 等）を受け取らない。

## 7. route と保護の確認

- `/purchase/orders/{ref}`: GET が HTTP 200 で `Cache-Control` が `no-store` と `private` を含み `Pragma: no-cache`（SEC-WEB-009。S0 の `next.config.ts` で設定済み。route が実在して初めて 200 になる）。
- Guest が `/purchase/orders/{ref}` を開く → `/account/login?continue=purchase-order%3A{ref}` へ redirect（保護 Content を一度も描画しない。S6 の AuthGate）。Login 後は同じ `/purchase/orders/{ref}` へ戻り、現在の Order を再取得する（Continuation は値を運ばない）。
- email 未確認の Authenticated → `/account/email-verification?continue=purchase-order%3A{ref}`。
- 各ページ（`/purchase/orders/{ref}`、`/dev/mock-checkout/{ref}`）: `h1` が 1 つ、`pageerror` / `console.error`（resource load 失敗を除く）が無く、外部 origin へ要求せず、`/admin` / `/staff` への href が無く、390px 幅で横 scroll が無く、見出し level を飛ばさない。

## 8. テストファイルと契約の対応

| ファイル | 内容 |
|---|---|
| `tests/unit/web/purchase/purchase-routes.test.ts` | §3.1 |
| `tests/unit/web/purchase/cart-purchase-flow.test.ts` | §3.2（planProceed / interpretCartStart / interpretCheckoutStart / isSafeCheckoutUrl / describeRejections） |
| `tests/unit/web/purchase/purchase-status-model.test.ts` | §3.3 |
| `tests/unit/web/purchase/purchase-again.test.ts` | §3.4 |
| `tests/unit/web/purchase/s7a-copy.test.ts` | §2 |
| `tests/unit/web/purchase/s7a-static.test.ts` | §1 と静的検査（構成、route 殻、直書き、依存方向、mock Checkout が port を呼ばない、Cart page の結線） |
| `tests/unit/web/mock/seeded-order-checkout.test.ts` | mock の忠実度: seed 済み `PREPARED` Order の再試行（§6.2 の前提。S2 の拡張確認） |
| `tests/e2e/purchase-cart-start.spec.ts` | §4（E2E 3 / 7 の前半 / 24 後半 / 26） |
| `tests/e2e/mock-checkout.spec.ts` | §5（PAY-BRW-001〜003） |
| `tests/e2e/purchase-status.spec.ts` | §6.1 / §6.2（E2E 7 / 8 / 9 / 10 / 11 / 19 XFN / 27） |
| `tests/e2e/purchase-again.spec.ts` | §6.2 もう一度購入する（E2E 12） |
| `tests/e2e/purchase-ownership.spec.ts` | §6 Ownership、§6.3、§7 の保護（E2E 20 の XFN-001 部分、§26.2） |
| `tests/e2e/purchase-common.spec.ts` | §7 |

S5 の以下のテストは S7a の結線に合わせて**更新済み**（購入手続きが「何も起こさない」前提を外した。理由: S5 契約 §5.3 / §8-7 が「S7a が結線する」と明記）: `tests/e2e/cart-page.spec.ts` の TC-PG-CRT-001-504、`tests/unit/web/cart/s5-static.test.ts` の TC-PG-CRT-001-461（`cart-page.tsx` を購入 API 禁止の対象から外し、`features/purchase/**` へ委譲することを確認する。`add-to-cart-form` / `entry-page` / `goods-detail-page` / `cart-store` は引き続き購入 API を呼ばない）。

## 9. 曖昧さ・仕様の不足についてテスト担当が決めたこと

1. **mock Checkout の「支払う（モック）」と「戻る」**: Design §6 は「どちらも PG-XFN-001 へ戻るだけ」とする。Order の結果は scenario `paymentOutcome` だけで決まる（成功 / 失敗 / 取消 / pending はすべて scenario で再現）。→ 両方を Link（href 同一）とし、画面は port を呼ばない。「failure / cancel」を画面のボタンで選ばせない。
2. **「購入内容を見る」の遷移先**: SPEC-050 §16.4 は action 名だけ。→ `/mypage/orders/{ref}`（PG-MYP-004）。「Ticket / Reservation / Goodsを見る」→ Purpose ごとの一覧（§3.1）。複合は Entry の一覧（Goods は同じ画面の権利欄から個別に辿れる）。S8 実装前は遷移先が 404 になるが、S7a は `href` だけを検証する。
3. **start_failed の通知を出す場所**: SPEC-050 §16.6 は「Orderが PREPARED のままで Checkout開始だけが失敗した場合」に固定文言を表示する。Cart から `start_failed` で PG-XFN-001 へ遷移した直後は、画面が PREPARED の state と description と「支払い開始を再試行」を示す（E2E 7）。専用の通知文言は、**同じ画面で再試行して再び `start_failed` になったとき**に出す。遷移直後の通知は、URL の query や sessionStorage を使わないと運べないため、追加しない（設計外の運搬手段を発明しない）。
4. **PREPARED の「支払い画面を開く / 再試行」**: SPEC-050 §16.4 は「必要 Allocation / Hold が有効な場合のみ」。mock では有効性を UI が判定できない。→ 常に「支払い開始を再試行」を出し、無効なら `startCheckout` が `opportunity_expired`（→ `EXPIRED`）を返す。UI は結果を読み直すだけ。
5. **Cart 購入開始の Guest / session 取得失敗**: SPEC-050 §14A.1 は Guest → Login。→ session が `ready` + `guest` のときだけ API を呼ばず Login へ。session が `loading` / `unavailable` のときは API を呼び、server の結果（`auth_required` → Login、`email_unverified` → Email Verification、`unavailable` → 失敗表示）に従う（UI が Identity を権威にしない）。
6. **不成立（rejected）のあとの Cart**: SPEC-050 §14A.1 は Cart の保持と数量変更・削除の可否だけ。→ error summary は次の試行まで残し、`resolveCartLines` を再取得して行表示を現在の状態にする（古い「販売中」のまま進めなくなるのを防ぐ。§22 最終項）。
7. **created 後の Cart 除去と「カートは空です」**: SPEC-050 §14A.1 は「Item を Cart から除去し、PG-XFN-001 へ遷移するか Checkout 開始へ進む」。→ 除去直後から遷移までの間に「カートは空です」を見せない（`preparing` 中は status だけ）。除去の失敗は購入手続きを止めない。
8. **再購入の合算**: SPEC-050 §16.4 の「再投入」は、既存 line と同じ key なら加算する（S5 §8-4）。Karaoke の明細は Cart に入れない。
9. **`AccessDeniedView` の置き場所**: Design §1 は `presentation/components/access-denied-view.tsx` と定める。PG-XFN-003 は S8 の範囲だが PG-XFN-001 の Ownership failure（§16.8）が先に必要なため、S7a が部品を作る。S8 は同じ部品を使い、本人所有一覧の `listHref` を渡す。route param が不正な UUID のときも同じ部品を表示する（Design §1 の「self の route は PG-XFN-003 の表示」）。
10. **`/dev/mock-checkout` が存在しない Order ref を受けたとき**: 仕様に定めがない。mock Checkout は Stripe の代替で port を呼ばないため、形式が正しい ref なら Order の有無を問わず同じ画面を表示する（PG-XFN-001 側が not found を扱う）。形式が不正な ref だけ 404。
11. **OrderOutcome の置き場所**: Design §6 は PG-XFN-001 / PG-MYP-004 の共有部品とする。→ `features/purchase/order-outcome.tsx`（presentation から features への import は禁止のため）。S8 の Mypage feature が import する（features → features は禁止 edge に無い）。
12. **E2E 7 の「Mypage の注文一覧」**: S7a は Mypage 一覧 UI を持たない。→ mock DB の `orders` の件数と内容（同じ Order が 1 件、重複なし）で確認する。一覧 UI での確認は S8 の E2E 15 が担う。
