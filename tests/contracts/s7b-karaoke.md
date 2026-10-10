# S7b Karaoke Slot 詳細 / 購入開始 / Hold 系 契約書（PG-KRK-003）

テスト担当が定義した S7b の実装契約である。コーディング担当は、ここに書かれたファイルパス・export 名・シグネチャ・文言・DOM 構造をそのまま実装する。対応するテスト:

- Vitest（node）: `tests/unit/web/karaoke/*.test.ts`、`tests/unit/web/public/route-params-slot.test.ts`
- Playwright（mock mode、`desktop-chromium` と `mobile-chromium`）: `tests/e2e/karaoke-slot-*.spec.ts`
- ハーネス: `tests/harness/browser/karaoke-purchase.ts`（`purchase.ts` / `auth.ts` / `hydration.ts` を再利用）

根拠: `docs/drafts/ui-mock-design.md`（承認済み。Design §3 PurchaseApi / §6 Karaoke 購入 / mock Checkout / OrderOutcome / §7 Continuation / §8 Scenario（Karaoke Hold: ok / conflict / limit / expire_before_checkout）、S7b 行、Test plan E2E 3 / 7〜9 の Karaoke 側 / 13 / 28）、SPEC-050 v1.1.0 §13.3 / §16 / §20.3 / §21 / §22 / §24 / §25 / §31（3, 7, 8, 9, 13, 28）、SPEC-030 BR-ORD-019 / BR-KRK（Karaoke は別 Order + Hold）、SPEC-070 §8 / PAY-BRW-001〜003、SPEC-060 AR-CONT-001〜003、SPEC-040 UF-KRK-001 / 002、SPEC-190 DEV-WEB-001〜013、SPEC-170 TST-UNT-004 / TST-E2E-003 / TST-E2E-004。UI mock suite（補助 suite）であり G8 でも API / DB / Provider coverage でもない。manifest では `critical:false`、`api_operation_ids` / `db_constraint_names` は空。S1〜S7a の契約は**変更しない**（拡張のみ。既存 export の名前・シグネチャは変えない）。

## 0. 範囲

- 含む: `/karaoke/slots/{slotRef}`（PG-KRK-003）の表示、Guest → Login（Continuation `karaoke-slot`）→ Slot へ復帰、Authenticated の購入開始（`purchase.startKaraokePurchase` → `purchase.startCheckout`）、Hold 系の結果表示（取得中 / 確保成功 / 競合 / 失効 / 上限 / 販売期間外 / 失敗）、`start_failed` / 決済結果は S7a の PG-XFN-001 と `/dev/mock-checkout/[orderRef]` を**そのまま再利用**する。
- 含まない（S8）: Mypage の Karaoke 予約・Karaoke QR の各ページ。S7b は `/mypage/karaoke/{ref}` への `href` を PG-XFN-001（S7a）が出すことを前提にするだけで、遷移先の実在を前提にしない。
- **Cart とは完全に別**: Karaoke の購入は Cart へ入れない・Cart を読まない・Cart を変更しない（FR-CRT-002、BR-ORD-019、SPEC-070 §8）。Slot 画面は `useCart` / `cart-store` を使わない。購入開始は Cart に内容があっても影響を受けず、Cart の保存値（`r39x.cart.v1`）は購入開始の前後でバイト単位で変わらない。
- **mock backend / port への追加は不要**。S2 の `createMockApi` は `public.getKaraokeSlot`、`purchase.startKaraokePurchase`（`held` / `slot_unavailable` / `purchase_limit_exceeded` / `not_on_sale` / `auth_required` / `email_unverified` / `unavailable`）、`purchase.startCheckout`（`opportunity_expired` を含む）、scenario `karaokeHold`（`ok` / `conflict` / `limit` / `expire_before_checkout`）と `karaokeSales`、seed の Slot 4 状態（`SLOT.d1_1000` AVAILABLE、`d1_1020` HELD、`d1_1040` SOLD、`d1_1200` SALES_STOPPED）をすべて実装済みで、`tests/unit/web/mock/karaoke-purchase.test.ts`（TC-PG-KRK-003-102〜105）が検証している。coder は `apps/web/src/mock/backend/**`、`src/api-client/{port,types}.ts`、`src/auth/**` を変更しない。S7a の `features/purchase/**`、`MockCheckoutScreen`、`AccessDeniedView` も変更しない（`interpretCheckoutStart` は import して再利用してよい）。
- **Hold の TTL を UI にもコピーにも置かない**（SPEC-050 §13.3 末尾、設計書 §4）。失効は scenario `expire_before_checkout` で起こす。画面に「◯分」「◯秒」「残り時間」を出さない。

共通の約束（S4〜S7a の約束を引き継ぐ）:

- 文言は `apps/web/src/presentation/copy/ja.ts` の `copy` に集める。S7b の新規ファイルに**日本語の直書き・`¥` の直書き・色の直書きを置かない**。金額は `formatMoney`、日時は `format/datetime.ts`（JST）。
- page.tsx は Server Component の薄い殻（`metadata` と route param の検証だけ。async `params` を `await`）。データ取得は `"use client"` の container が mount 後（`useEffect`）に `useApi()` 経由で行う。`features/**` から `mock/**` を import しない。
- 価格・状態・可否の権威は port の戻り値だけ。URL・Continuation・DOM の値を権威にしない（DEV-WEB-009）。
- `console.*`、`localStorage` / `sessionStorage` の直接参照、`dangerouslySetInnerHTML` を S7b の新規ファイルで使わない。
- `h1` は 1 つだけ。見出し level を飛ばさない。`main` 内の `role="alert"` は同時に 1 つだけ。
- Order の ref（UUID）・内部 ID を画面の本文に出さない（URL の path は可）。

## 1. ファイル一覧

| パス | 種別 | export |
|---|---|---|
| `apps/web/src/features/public/route-params.ts`（S4 既存。追加） | 純粋 | `parseSlotRef`（既存 export は変えない） |
| `apps/web/src/features/karaoke/karaoke-slot-model.ts` | 純粋（react / next を import しない） | `KaraokeSlotModel`, `buildKaraokeSlotModel` |
| `apps/web/src/features/karaoke/karaoke-purchase-flow.ts` | 純粋 | `KaraokeProceedPlan`, `planKaraokeProceed`, `KaraokeStartStep`, `interpretKaraokeStart`, `KaraokeCheckoutStep`, `interpretKaraokeCheckout` |
| `apps/web/src/features/karaoke/use-karaoke-purchase.ts` | client hook | `KaraokePurchasePhase`, `useKaraokePurchase` |
| `apps/web/src/features/karaoke/karaoke-slot-page.tsx` | client container | `KaraokeSlotPage`（props `{ slotRef: Ref<"slot"> }`） |
| `apps/web/app/karaoke/slots/[slotRef]/page.tsx` | route（Server Component の薄い殻） | `metadata.title = copy.pageTitle.karaokeSlot`、`parseSlotRef` が null なら `notFound()`（HTTP 404）、それ以外は `<KaraokeSlotPage slotRef=... />` |

- title は root layout の template（`%s | SITE_NAME`）に従う。
- この route は公開（AuthGate の外。`(self)` に置かない）。Guest でも閲覧できる（閲覧不要、購入開始は必要）。`/karaoke/slots/*` の `Cache-Control` は検査しない（動的 route。S4 §4）。
- 既存の再利用: `presentSlot`（S1）、`presentKaraokeSaleStatus`（S4）、`karaokeDayHref` / `karaokeSlotHref`（S4）、`purchaseOrderHref`（S7a）、`interpretCheckoutStart` / `isSafeCheckoutUrl`（S7a）、`accountPath` / `continuationPath`（S6）、`PageState` / `StatusBadge` / `NotFoundView` / `SectionHeading` / `settleRead`。

## 2. 文言 `copy`（`ja.ts` に追加。既存 key は変えない）

```ts
pageTitle: { /* 既存に加えて */ karaokeSlot: "Karaoke枠の詳細" },
karaoke: {
  // 既存 slot / hold / reservation / ticket / primary / disabledReason / guide / saleStatus / day に加えて
  slotDetail: {
    heading: "Karaoke 枠の詳細",
    subject: "Karaoke枠の情報",
    infoHeading: "枠の情報",
    actionHeading: "購入手続き",
    dateLabel: "対象日",
    timeLabel: "利用時刻",
    stateLabel: "この枠の状態",
    purchasableLabel: "予約購入可能",
    purchasableDescription: "この枠は現在購入できます。購入手続きに進むと、この枠を確保します。",
    notPurchasableLabel: "現在購入不可",
    notPurchasableDescription: "この枠は現在購入できません。",
    separateNote: "Karaokeの購入はカートを使いません。Entry TicketやGoodsとは別の購入、別の支払いになります。",
    proceed: "購入手続きへ進む",
    proceedGuest: "ログインして購入手続きへ",
    backToDay: "空き状況へ戻る",
    chooseAgain: "空き状況から選び直す",
    holding: "枠を確保しています",
    disabledReason: {
      HELD: "他の購入試行で確保中のため、購入手続きへ進めません。空き状況から別の枠を選んでください。",
      SOLD: "この枠は販売済みのため、購入手続きへ進めません。",
      SALES_STOPPED: "この枠は販売停止のため、購入手続きへ進めません。",
      NOT_ON_SALE: "現在は販売期間外または販売停止中のため、購入手続きへ進めません。",
      NOT_PURCHASABLE: "現在この枠は購入できないため、購入手続きへ進めません。空き状況から別の枠を選んでください。",
    },
    failure: {
      conflict: "他の利用者が先に確保したため購入を開始できません",
      limit: "購入上限に達しているため、この枠の購入を開始できません",
      notOnSale: "現在は販売期間外または販売停止中のため、購入を開始できません",
      expired: "枠の確保期限が切れたため選び直してください",
      unavailable: "枠の購入条件を確認できませんでした。時間をおいて、もう一度お試しください",
    },
  },
},
```

- 上記は**そのまま**使う（`s7b-copy.test.ts` が固定する）。全 leaf は trim 済みの非空 string。
- `copy.karaoke.slotDetail.holding` は SPEC-050 §13.3 手順 3「枠を確保しています」。`failure.conflict` は手順 4（設計書 §6 の文末表記）、`failure.expired` は手順 7。
- **部分文字列の衝突を避ける**: `disabledReason.*`、`failure.*`、`holding`、`purchasableDescription`、`notPurchasableDescription`、`disabledReason.NOT_PURCHASABLE` の 11 件は、**どの 2 件も一方が他方を含まない**（E2E の否定 assert が誤検知しない。S7a の教訓）。`purchasableLabel`（予約購入可能）と `notPurchasableLabel`（現在購入不可）はこの 11 件のどれにも含まれない（`notPurchasableLabel` は `purchasableLabel` も含まない）。
- 全 leaf は Hold の具体秒数・残り時間を表す数字（`/[0-9０-９]+\s*(分|秒)/`）を含まない。
- `copy.karaoke.slotDetail.*` は「取り消されました」「キャンセルされました」を含まない。

## 3. 純粋 module

### 3.1 `features/public/route-params.ts` の `parseSlotRef`

`parseSlotRef(raw: string): Ref<"slot"> | null`: canonical lowercase UUID（`parseAnnouncementRef` と同じ規則）だけを返す。大文字、前後空白、`%` エンコード、空文字、UUID でない文字列は `null`（正規化して救済しない）。

### 3.2 `features/karaoke/karaoke-slot-model.ts`

```ts
export type KaraokeSlotModel =
  | { kind: "loading" } | { kind: "not_found" } | { kind: "unavailable" }
  | { kind: "ready"; slotRef: Ref<"slot">; dateText: string; timeText: string; priceText: string;
      stateLabel: string; description: string; tone: Tone;
      purchasable: boolean; disabledReason: string | null; dayHref: string };
export function buildKaraokeSlotModel(input: Loadable<KaraokeSlotDetail>): KaraokeSlotModel;
```

- `loading` → `loading`。`not_found` → `not_found`。`unavailable` / `auth_required` / `email_unverified` → `unavailable`（`not_found` と混同しない）。`ok` → `ready`。
- `dateText = formatBusinessDate(date)`、`timeText = formatJstTimeRange(usageStart, usageEnd)`、`priceText = formatMoney(price)`、`dayHref = karaokeDayHref(date)`（PG-KRK-002）。
- 状態の表示（SPEC-050 §13.3 の表。色だけに依存せず text で区別）:
  - `state !== "AVAILABLE"`: `presentSlot(state)` の `label` / `description` / `tone`。`purchasable = false`。`disabledReason = copy.karaoke.slotDetail.disabledReason[state]`（`HELD` / `SOLD` / `SALES_STOPPED`）。**販売状態が `ON_SALE` でなくても slot の状態を優先**する。
  - `state === "AVAILABLE"` かつ `saleStatus === "ON_SALE"` かつ `purchasable === true`: `stateLabel = copy.karaoke.slotDetail.purchasableLabel`、`description = copy.karaoke.slotDetail.purchasableDescription`、`tone = presentSlot("AVAILABLE").tone`、`purchasable = true`、`disabledReason = null`。
  - `state === "AVAILABLE"` かつ `saleStatus === "ON_SALE"` かつ port の `purchasable !== true`（不整合な組み合わせ。TC-PG-KRK-003-615）: `stateLabel = copy.karaoke.slotDetail.notPurchasableLabel`、`description = copy.karaoke.slotDetail.notPurchasableDescription`、`tone = "neutral"`、`purchasable = false`、`disabledReason = disabledReason.NOT_PURCHASABLE`（SPEC-050 §25: Disabled の理由を周辺 Text で示す）。
  - `state === "AVAILABLE"` かつ `saleStatus !== "ON_SALE"`: `presentKaraokeSaleStatus(saleStatus)` の `label` / `description` / `tone`（「予約購入可能」「選択可能」を出さない）、`purchasable = false`、`disabledReason = disabledReason.NOT_ON_SALE`。
- **多重防御（INV-010-04）は双方向**: port の `purchasable` が `true` でも、`state === "AVAILABLE" && saleStatus === "ON_SALE"` でなければ `purchasable = false`。逆に `state === "AVAILABLE" && saleStatus === "ON_SALE"` でも、port の `purchasable` が `false`（`true` でない）なら `purchasable = false`（`notPurchasableLabel` 等を表示）。state と saleStatus の理由を flag より優先する。
- `ready` では `purchasable === true` ⇔ `disabledReason === null`。入力を変更しない。例外を投げない。

### 3.3 `features/karaoke/karaoke-purchase-flow.ts`

```ts
export type KaraokeProceedPlan = { kind: "go_login"; to: string } | { kind: "start" };
export function planKaraokeProceed(session: SessionState, slotRef: Ref<"slot">): KaraokeProceedPlan;
```
- `status: "ready"` かつ `session.kind === "guest"` → `{ kind: "go_login", to: accountPath("login", { key: "karaoke-slot", ref: slotRef }) }`（= `/account/login?continue=karaoke-slot%3A<ref>`）。API を呼ばない。
- それ以外（`loading` / `unavailable` / authenticated の確認済み・未確認）→ `{ kind: "start" }`（認証・確認状態は server の結果で決める。S7a と同じ）。

```ts
export type KaraokeStartStep =
  | { kind: "checkout"; orderRef: Ref<"order"> }
  | { kind: "conflict" } | { kind: "limit" } | { kind: "not_on_sale" } | { kind: "unavailable" }
  | { kind: "go_login"; to: string } | { kind: "go_verification"; to: string };
export function interpretKaraokeStart(result: KaraokePurchaseStart, slotRef: Ref<"slot">): KaraokeStartStep;
```
- `held` → `checkout`（`orderRef` そのまま）。`slot_unavailable` → `conflict`。`purchase_limit_exceeded` → `limit`。`not_on_sale` → `not_on_sale`。`unavailable` → `unavailable`。`auth_required` → `go_login`（Login。`karaoke-slot:<ref>`）。`email_unverified` → `go_verification`（`accountPath("email-verification", { key: "karaoke-slot", ref: slotRef })`）。exhaustive switch。入力を変更しない。

```ts
export type KaraokeCheckoutStep = { kind: "assign"; url: string } | { kind: "expired" } | { kind: "go_status"; to: string };
export function interpretKaraokeCheckout(orderRef: Ref<"order">, result: CheckoutStart): KaraokeCheckoutStep;
```
- `opportunity_expired` → `expired`（Slot 画面に留まり、選び直しを案内する。同じ Hold を再利用しない）。それ以外は S7a の `interpretCheckoutStart(orderRef, result)` と同じ（`redirect` + 安全な URL → `assign`、`start_failed` / `state_conflict` / `auth_required` / `unavailable` / 不正 URL → `go_status`、`to = purchaseOrderHref(orderRef)`）。

## 4. 画面（`KaraokeSlotPage` / `useKaraokePurchase`）

```ts
export type KaraokePurchasePhase =
  | { kind: "idle" } | { kind: "holding" } | { kind: "preparing" }
  | { kind: "conflict" } | { kind: "limit" } | { kind: "not_on_sale" }
  | { kind: "unavailable" } | { kind: "expired" };
```

### 4.1 取得と表示

- mount 後に `public.getKaraokeSlot(slotRef)` を読む（SSR 中は fetch せず、最初の描画は常に loading）。
- loading: `h1` = `copy.karaoke.slotDetail.heading` と `PageState` の `role="status"`（`copy.pageState.loading`）。価格・日時・状態・購入ボタンを出さない。
- not_found: `NotFoundView`（S4 の日 page と同じ。`h1` = `copy.notFound.title`）。存在しない Slot の ref でも同じ。
- unavailable: `h1` = `copy.karaoke.slotDetail.heading`、`role="alert"` + `copy.pageState.unavailable(copy.karaoke.slotDetail.subject)` + `<button type="button">` `copy.pageState.retry`（read の再取得のみ。購入 button を出さない）。
- ready（見出し構造: `h1` → `h2` ×2）:
  1. `<section aria-labelledby>`（region。`h2` = `infoHeading`）: `dateLabel` + `dateText`、`timeLabel` + `timeText`、`copy.karaoke.guide.priceLabel` + `priceText`、`stateLabel` + `StatusBadge`（`stateLabel` を text で）+ `description`、`copy.karaoke.guide.purchaseLimit`（Purchase Limit 案内。数値を創作しない）。
  2. `<section aria-labelledby>`（region。`h2` = `actionHeading`）: 購入 button（4.2）、理由（`purchasable === false` のときの `disabledReason` を `<p id>`）、結果の status / alert（4.3）、`separateNote`、Link `backToDay`（exact。`href = dayHref`）。
- ready の `main` の `<button>` は**購入 button の 1 つだけ**（Cart 追加の操作、`copy.sales.add`（Cartに追加）、`copy.sales.viewCart` を置かない。E2E 28）。`<li>` を使わない。`main` 内の `role="status"` は購入開始の処理中（`holding` / `preparing`）だけ 1 つ描画する（通常時は 0 件）。

### 4.2 購入 button

- ネイティブ `<button type="button">`。name（exact）: Guest（`useSession` が `ready` + `guest`）は `proceedGuest`、それ以外は `proceed`。
- `disabled`（ネイティブ）: `purchasable === false`、または処理中（`holding` / `preparing`）、または `limit` / `expired` の phase のあと。`purchasable === false` のとき `aria-describedby` が `disabledReason` の `<p id>` を指す。処理中は `aria-busy="true"`（name は変えない）。二重クリックで Order は 1 件だけ。
- Guest: 押すと `planKaraokeProceed` → `router.push("/account/login?continue=karaoke-slot%3A<ref>")`。API を呼ばない。mock DB・Order・Slot 状態・Cart を変えない。Login 後は S6 の Continuation で同じ Slot 画面へ戻り、**購入は自動では始まらない**（利用者が改めて Action する）。現在の Slot 状態を再取得して表示する。
- Authenticated: 試行ごとに新しい idempotency key（`crypto.randomUUID()`）で `purchase.startKaraokePurchase(slotRef, { idempotencyKey })`。

### 4.3 結果（SPEC-050 §13.3 Purchase start 2〜7）

1. phase = `holding`: `<div role="status">` に `copy.karaoke.slotDetail.holding`。
2. 結果を `interpretKaraokeStart` で解釈:
   - `go_login` / `go_verification` → `router.push(to)`。
   - `checkout` → phase = `preparing`: status に `copy.purchase.checkoutPreparing`（「枠を確保しています」は消える）。新しい key で `purchase.startCheckout(orderRef, ...)` → `interpretKaraokeCheckout`:
     - `assign` → `window.location.assign(url)`（`/dev/mock-checkout/<orderRef>`）。
     - `go_status` → `router.push(purchaseOrderHref(orderRef))`（`start_failed` など。PG-XFN-001 が PREPARED と「支払い開始を再試行」を表示する。S7a）。
     - `expired` → phase = `expired`（4.4）。
   - `conflict` / `limit` / `not_on_sale` / `unavailable` → 対応する phase。**Order も Hold も作られていない**（mock DB の orders / slots は変化しない）。
3. alert: `<div role="alert" tabindex="-1">`（`main` 内で 1 つ）。`failure.conflict` / `limit` / `notOnSale` / `expired` / `unavailable` のうち対応する 1 つの文言。表示後に**この要素へ focus** を移す。次の試行を始めたら消える。
   - `conflict` と `expired` の alert には Link `chooseAgain`（exact。`href = dayHref`。PG-KRK-002 へ戻る Action）を含める。他の alert には含めない。
4. `conflict` / `not_on_sale` のあと、**現在の Slot を再取得して**表示を更新する（読み込み中の loading 表示にしない。内容を保ったまま差し替える）。再取得した結果が HELD / SOLD / SALES_STOPPED なら、ready の表示（label・理由・button の disabled）が現在の状態になる。`purchase_limit_exceeded` は state が変わらないため再取得不要。
5. `limit` のあとは button を `disabled` のままにし、理由として `failure.limit` を `aria-describedby` で結ぶ（Disabled。SPEC-050 §13.3 表「Purchase Limit 超過」）。

### 4.4 Hold 失効（`expired`）

- 同じ Hold を再利用しない。Slot 画面に留まり（自動遷移しない）、alert に `failure.expired` と Link `chooseAgain`（PG-KRK-002）を出す。購入 button は `disabled`（`aria-describedby` が alert の文言を指してよい）。再購入は PG-KRK-002 から Slot を選び直す（新 Hold・新 Order になり得る）。
- mock DB: Order は `EXPIRED`（Entitlement なし）、Slot は `AVAILABLE` に戻る（S2 実装済み）。

## 5. Continuation と保護

- Guest が `/karaoke/slots/{ref}` を直接開いて閲覧できる（redirect しない。公開）。Guest の購入 button は `proceedGuest`。
- Login → 同じ Slot へ戻る（`continue=karaoke-slot:<ref>`。S6 実装済み）。Login をやめた場合の戻り先は同じ Slot（S6 の `continuationCancelPath`）。
- email 未確認の Authenticated: 購入 button は `proceed`。押すと server が `email_unverified` を返し、`/account/email-verification?continue=karaoke-slot%3A<ref>` へ遷移する。Order・Hold は作られない。
- Karaoke の Order は PG-XFN-001（`/purchase/orders/{ref}`、AuthGate 内）で表示される（S7a）。S7b は何も変えない。

## 6. E2E 共通条件

- 各ページ（ready の Slot、not_found）: `h1` 1 つ、見出し level を飛ばさない、`pageerror` / `console.error`（resource load 失敗を除く）なし、外部 origin への要求なし、`/admin` / `/staff` / `/dev` への href なし、390px 幅で横 scroll なし。
- 時刻は `page.clock.setFixedTime(NOW_ISO)`（`2027-03-01T03:00:00Z`）。timezone は UTC、表示は JST。

## 7. テストファイルと契約の対応

| ファイル | 内容 |
|---|---|
| `tests/unit/web/karaoke/s7b-copy.test.ts` | §2（TC-PG-KRK-003-601〜603。新しい 3 文言を含む） |
| `tests/unit/web/karaoke/s7b-static.test.ts` | §0 / §1 / §4 の静的検査（TC-DEV-WEB-001-701〜704） |
| `tests/unit/web/karaoke/karaoke-slot-model.test.ts` | §3.2（TC-PG-KRK-003-611〜615） |
| `tests/unit/web/karaoke/karaoke-purchase-flow.test.ts` | §3.3（TC-PG-KRK-003-621〜623） |
| `tests/unit/web/public/route-params-slot.test.ts` | §3.1（TC-PG-KRK-003-602） |
| `tests/e2e/karaoke-slot-detail.spec.ts` | §4.1（E2E 5 / 28、TC-PG-KRK-003-641〜645） |
| `tests/e2e/karaoke-slot-purchase.spec.ts` | §4.2 / §4.3（E2E 3 / 7〜9 の Karaoke 側、TC-PG-KRK-003-651〜654） |
| `tests/e2e/karaoke-slot-hold.spec.ts` | §4.3 / §4.4（E2E 13、TC-PG-KRK-003-661〜664） |

## 8. 曖昧さ・仕様の不足についてテスト担当が決めたこと

1. **HELD の表示**: SPEC-050 §13.3 表は「他の購入試行で確保中」。S1 / S4 の既存ラベルは「他の方が確保中」。→ `stateLabel` は既存の `presentSlot("HELD").label`（日 page と揃える）、「他の購入試行で確保中」は `disabledReason.HELD` に含める。
2. **Purchase Limit の事前表示**: port は閲覧者別の上限可否を返さない（UCR-110-001 の既知の不足。数値も創作しない）。→ 事前の無効化はできないため、`purchase_limit_exceeded` の結果を受けたあとに alert と無効化で示す（`karaoke-guide` の `purchaseLimit` 案内文は常時表示）。
3. **Hold 失効後の「PG-KRK-002 へ戻す」**: 設計書は「示し、戻す」。自動遷移すると文言が見えなくなる。→ Slot 画面に留まって `failure.expired` と Link を出す（遷移は利用者の操作）。同様に競合も Link を出すだけで自動遷移しない。
4. **Hold 失効の発生点**: `opportunity_expired` は `startCheckout` の結果（S2 実装済み）。Slot 画面は購入開始の一連の流れの中でだけこれを受ける。PG-XFN-001 側で `startCheckout` を再試行して失効した場合は S7a どおり `EXPIRED` の表示（「もう一度購入する」→ `/karaoke`）になる。
5. **Guest の購入ボタン**: SPEC は「Guest: Login」。→ ラベルを `proceedGuest`（設計書 §6「ログインして購入手続きへ」）にし、押すと API を呼ばず Login へ。session が `loading` / `unavailable` のときは `proceed` を出し、server の結果に従う（S7a の `planProceed` と同じ）。
6. **競合の再取得**: `slot_unavailable` のあと現在の状態を再取得する（古い「予約購入可能」のまま進めなくなるのを防ぐ。S7a の rejected 後の再取得と同じ考え方）。scenario `conflict` では Slot が実際には AVAILABLE のままのため、再取得後も ready（購入可）である。
7. **Cart との関係**: Slot 画面に Cart 追加の操作は置かない。E2E 28 の「案内文」は Cart 画面（S5）が持つ。Slot 画面は `separateNote` で別の購入であることを示す。Cart の保存値は購入開始の前後で変わらない（Cart に Entry / Goods が入っていても影響しない）。
