# S2 Mock backend 契約書（ports / mock backend / mock auth）

テスト担当が定義した、S2 の実装契約である。コーディング担当はここに書かれたファイルパス・export 名・シグネチャ・戻り値の形・scenario の値・seed の識別子を**そのまま**実装する。テストは `tests/unit/web/mock/*.test.ts` と `tests/unit/web/auth/*.test.ts`、`tests/unit/web/ports/*.test.ts` にあり、この契約に対してのみ書かれている。

- 根拠: `docs/drafts/ui-mock-design.md`（承認済み）の Design §3 / §4 / §6 / §8、SPEC-050 v1.1.0 §12〜§18 / §20 / §21 / §31、SPEC-030 §11.2 / §11.9（BR-ORD-013〜020）、SPEC-040 §16A、SPEC-110 §22、SPEC-070 §8 / PAY-BRW-001〜003、SPEC-140 SEC-AUTH-016〜018 / SEC-API-027 / SEC-QR-012〜013 / SEC-WEB-017〜019、SPEC-190 DEV-TS-* / DEV-WEB-010〜013 / DEV-REL-001、SPEC-170 TST-UNT-004 / TST-E2E-004。
- これは **test double（UI mock）の契約**であり、API contract / DB 制約 / Provider 動作の検証根拠ではない（DEV-WEB-010、TST-E2E-004）。manifest では `critical:false`。
- 純粋 TypeScript。React / DOM / `window` / `localStorage` 直接参照 / `Date.now()` / `Math.random()` / `crypto.randomUUID()` の直接呼び出し（デフォルト実装を除く）/ `setTimeout`（デフォルト `sleep` を除く）/ ネットワークを使わない。時刻・乱数・待機・storage はすべて注入する。`console.*` を呼ばない（Biome `noConsole`）。
- `any`、`as unknown as T`、非 null assertion を使わない（DEV-TS-002/003）。永続化データは必ず `zod` の `.strict()`（または `z.strictObject`）で検証してから使う（DEV-TS-004）。`zod` は `apps/web/package.json` の `dependencies` に追加する（v3 / v4 のどちらでもよい）。
- **Hold の TTL（45 / 30 / 5 分など）をコードのどこにも持たない。** Hold の失効は scenario（`karaokeHold: "expire_before_checkout"`、`checkout: "opportunity_expired"`）でのみ起こす。`ttl`、`holdExpires*`、`expiresAt` などの識別子も置かない。
- `apps/web/src/mock/**` は `src/api-client/index.ts`、`src/auth/index.ts`、`src/routes/dev/**`、`src/routes/root-layout.tsx`（`mock/dev-ui/mock-mode-badge` だけ）以外から import されない（DEV-WEB-012。`scripts/check-import-boundaries.mts`）。ただし `src/mock/**` 自身は `src/api-client/{port,types}.ts`、`src/auth/port.ts`、`src/presentation/**` の純粋関数、`@off-r39x/domain` を import してよい（`presentation` → `mock` の逆向きだけが禁止）。
- 相対 import は拡張子なしでも `.ts` 付きでもよい。

## 0. ファイル一覧

| パス | export（値は `const` / `function`、型は `type` / `interface`） |
|---|---|
| `apps/web/src/api-client/types.ts` | S1 の `Ref`, `Money`, `UtcInstant`, `BusinessDateJst`, `SaleAvailability` を**変更せず**、§1 の型を追加 |
| `apps/web/src/api-client/port.ts` | `PublicApi`, `PurchaseApi`, `SelfApi`, `ApiPort`（型のみ） |
| `apps/web/src/api-client/cart-line-key.ts` | `cartLineKey` |
| `apps/web/src/api-client/eligibility-target-key.ts` | `eligibilityTargetKey`（B4c） |
| `apps/web/src/auth/port.ts` | `Session`, `AuthPort`（型のみ） |
| `apps/web/src/auth/password-policy.ts` | `PASSWORD_MIN_LENGTH`, `PASSWORD_MAX_LENGTH`, `PasswordPolicyResult`, `validatePassword` |
| `apps/web/src/mock/backend/clock.ts` | `Clock`, `systemClock` |
| `apps/web/src/mock/backend/ids.ts` | `IdGenerator`, `uuidIdGenerator` |
| `apps/web/src/mock/backend/latency.ts` | `Sleep`, `defaultSleep`, `applyLatency` |
| `apps/web/src/mock/backend/scenario.ts` | `SCENARIO_STORAGE_KEY`, `scenarioSchema`, `Scenario`, `DEFAULT_SCENARIO`, `defaultScenario`, `ScenarioLoad`, `loadScenario`, `saveScenario`, `resetScenario` |
| `apps/web/src/mock/backend/purpose.ts` | `OrderLineKind`, `decidePurpose` |
| `apps/web/src/mock/backend/karaoke-buckets.ts` | `BucketInputSlot`, `buildKaraokeBuckets`, `filterSlotsByBusinessDate` |
| `apps/web/src/mock/backend/db.ts` | `DB_STORAGE_KEY`, `MockStorage`, `dbStateSchema`, `DbState`, `DbLoad`, `MockDb`, `createMockDb` |
| `apps/web/src/mock/backend/seed.ts` | `buildSeed` |
| `apps/web/src/mock/backend/session-store.ts` | `SESSION_STORAGE_KEY`, `sessionStateSchema`, `SessionStoreState`, `SessionLoad`, `loadSessionState`, `saveSessionState` |
| `apps/web/src/mock/backend/mock-api.ts` | `MockApiDeps`, `createMockApi` |
| `apps/web/src/mock/backend/mock-auth.ts` | `MockAuthDeps`, `createMockAuth`、および `SESSION_STORAGE_KEY` の再 export |

## 1. 共有型 `apps/web/src/api-client/types.ts`（追加分）

```ts
export type Read<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_found" }
  | { kind: "unavailable" }            // Empty に変換してはならない
  | { kind: "auth_required" }
  | { kind: "email_unverified" };

export type CartLine =                 // Karaoke は型として表現できない（FR-CRT-002）
  | { kind: "ENTRY_TICKET"; offeringRef: Ref<"offering">; quantity: number }
  | { kind: "GOODS"; goodsRef: Ref<"goods">; quantity: number };

// SPEC-110 API-PUR-ELG-001 の reasons（9 code、この順で重複なく列挙）。API-PUR-CART-001 の item_failures も同じ有限集合を使う。
// SLOT_UNAVAILABLE / PAYMENT_WINDOW_TOO_SHORT は Karaoke 専用で、Cart / Entry / Goods では発生しない。
export type PurchaseReason =
  | "NOT_PUBLIC_OR_NOT_FOUND" | "SALES_NOT_STARTED" | "SALES_CLOSED" | "SALES_STOPPED"
  | "SOLD_OUT" | "INSUFFICIENT_QUANTITY" | "PURCHASE_LIMIT_EXCEEDED"
  | "SLOT_UNAVAILABLE" | "PAYMENT_WINDOW_TOO_SHORT";

export type CartLineResolution = { lineKey: string } & (
  | { status: "resolved"; name: string; unitPrice: Money; availability: SaleAvailability }
  | { status: "not_public" }
  | { status: "unavailable" }
);

// API-PUR-CART-001: All-or-Nothing。created は送った全 line が 1 つの Order に入ったことを表し（部分的な成立を表す field は無い）、rejected は不成立と確認できた Item だけを入力順に返す（reasons は 1 件以上、正本の順、重複なし）。
// lineKey は cartLineKey の値（API の { kind, target_ref } を UI 側で写したもの）。
export type CartPurchaseStart =
  | { kind: "created"; orderRef: Ref<"order"> }
  | { kind: "rejected"; itemFailures: readonly { lineKey: string; reasons: readonly PurchaseReason[] }[] }
  | { kind: "auth_required" } | { kind: "email_unverified" } | { kind: "unavailable" };

// API-PUR-ELG-001（B4b）: 本人向けの参照のみの一括判定。items は入力順。purchasable === (reasons.length === 0)。
// reasons は PurchaseReason の正本の順。maxPurchasableQuantity は 0 以上の整数（購入できないときは 0）。
// lineKey は cartLineKey の値。Read<T> は使わない（not_found が意味を持たない）。実 api-client では Profile 未解決の 409 を unavailable に写す。
export type PurchaseEligibility = {
  lineKey: string; purchasable: boolean; reasons: readonly PurchaseReason[]; maxPurchasableQuantity: number;
};
export type PurchaseEligibilityRead =
  | { kind: "ok"; data: readonly PurchaseEligibility[] }
  | { kind: "auth_required" } | { kind: "email_unverified" } | { kind: "unavailable" };

export type KaraokePurchaseStart =
  | { kind: "held"; orderRef: Ref<"order"> } | { kind: "slot_unavailable" }
  | { kind: "purchase_limit_exceeded" } | { kind: "not_on_sale" }
  | { kind: "auth_required" } | { kind: "email_unverified" } | { kind: "unavailable" };

export type CheckoutStart =
  | { kind: "redirect"; url: string }  // top-level 遷移のみ（SEC-WEB-005）
  | { kind: "start_failed" } | { kind: "opportunity_expired" }
  | { kind: "state_conflict" } | { kind: "auth_required" } | { kind: "unavailable" };

export type ProfileUpdate =
  | { kind: "saved"; profile: Profile }
  | { kind: "validation_failed"; field: "displayName" }
  | { kind: "unavailable" };

export type KaraokeSaleStatus = "ON_SALE" | "BEFORE_SALES" | "SALES_ENDED" | "SUSPENDED";
export type SalesPeriod = { startsAt: UtcInstant; endsAt: UtcInstant };

export type EventInfo = {
  name: string;                         // 常に非 null
  overview: string | null; startsAt: UtcInstant | null; endsAt: UtcInstant | null;
  venueName: string | null; venueGuide: string | null; accessInfo: string | null;
  notices: readonly string[] | null;    // 未設定 field は null（推測値を入れない）
};
export type FaqItem = { id: string; question: string; answer: string };
export type AnnouncementSummary = { announcementRef: Ref<"announcement">; title: string; publishedAt: UtcInstant; excerpt: string };
export type Announcement = AnnouncementSummary & { body: string };   // body はサニタイズ・エスケープせず原文のまま
export type SponsorLogo = { sponsorRef: Ref<"sponsor">; name: string; imageUrl: string; linkUrl: string | null }; // imageUrl は必須（API-PUB-012 image_url）
export type EntryOffering = {
  offeringRef: Ref<"offering">; name: string; description: string; unitPrice: Money;
  salesPeriod: SalesPeriod; availability: SaleAvailability; perAccountLimit: number | null;
};
export type KaraokeSales = { price: Money; salesPeriod: SalesPeriod; saleStatus: KaraokeSaleStatus; salesDates: readonly BusinessDateJst[] };
export type KaraokeDaySlot = { slotRef: Ref<"slot">; usageStart: UtcInstant; usageEnd: UtcInstant; state: KaraokeSlotState };
export type KaraokeBucket = { startHour: number; totalSlots: number; availableSlots: number; slots: readonly KaraokeDaySlot[] };
export type KaraokeDay = {
  date: BusinessDateJst; saleStatus: KaraokeSaleStatus; buckets: readonly KaraokeBucket[];
  previousDate: BusinessDateJst | null; nextDate: BusinessDateJst | null;    // 販売対象日だけをたどる
};
export type KaraokeSlotDetail = {
  slotRef: Ref<"slot">; date: BusinessDateJst; usageStart: UtcInstant; usageEnd: UtcInstant;
  price: Money; state: KaraokeSlotState; saleStatus: KaraokeSaleStatus;
  purchasable: boolean;                 // state === "AVAILABLE" && saleStatus === "ON_SALE"
};
export type GoodsSummary = { goodsRef: Ref<"goods">; name: string; shortDescription: string; unitPrice: Money; availability: SaleAvailability };
export type GoodsDetail = {
  goodsRef: Ref<"goods">; name: string; description: string; unitPrice: Money;
  salesPeriod: SalesPeriod; availability: SaleAvailability; venuePickupOnly: true;
};
export type Profile = { email: string; displayName: string | null };   // null = 未設定（API-AUTH-002 の display_name）。email で補完しない
export type OrderItem =
  | { kind: "ENTRY_TICKET"; offeringRef: Ref<"offering">; name: string; quantity: number; unitPrice: Money; subtotal: Money }
  | { kind: "GOODS"; goodsRef: Ref<"goods">; name: string; quantity: number; unitPrice: Money; subtotal: Money }
  | { kind: "KARAOKE"; slotRef: Ref<"slot">; name: string; usageStart: UtcInstant; usageEnd: UtcInstant; quantity: 1; unitPrice: Money; subtotal: Money };
export type OrderSummary = { orderRef: Ref<"order">; purpose: OrderPurpose; state: OrderState; createdAt: UtcInstant; total: Money; summary: string };
export type OrderEntitlements = {
  entryTicketRefs: readonly Ref<"ticket">[];
  reservationRef: Ref<"reservation"> | null;
  goodsItems: readonly { ref: Ref<"goodsItem">; itemState: GoodsItemState; handoffState: GoodsHandoffState }[];
};
export type OrderDetail = OrderSummary & {
  items: readonly OrderItem[];          // 購入時 Snapshot
  entitlements: OrderEntitlements;      // 常に存在。CONFIRMED 以外は {entryTicketRefs:[], reservationRef:null, goodsItems:[]}
  receiptUrl: string | null;
  notificationSummary: { status: NotificationSummaryStatus } | null;   // API-ORD-003 notification_summary。null = summary だけ取得不能
};
export type EntryTicketSummary = { ticketRef: Ref<"ticket">; offeringName: string; state: EntryTicketState; orderRef: Ref<"order"> };
export type EntryTicketDetail = EntryTicketSummary & { issuedAt: UtcInstant };
export type ReservationSummary = {
  reservationRef: Ref<"reservation">; orderRef: Ref<"order">; date: BusinessDateJst;
  usageStart: UtcInstant; usageEnd: UtcInstant; reservationState: ReservationState; ticketState: KaraokeTicketState;
};
export type ReservationDetail = ReservationSummary & { slotRef: Ref<"slot">; price: Money; receiptUrl: string | null };
export type GoodsItemSummary = {
  goodsItemRef: Ref<"goodsItem">; goodsName: string; quantity: number;
  itemState: GoodsItemState; handoffState: GoodsHandoffState; orderRef: Ref<"order">; orderState: OrderState;
};
export type GoodsItemDetail = GoodsItemSummary & { unitPrice: Money; subtotal: Money; receiptUrl: string | null };
export type QrPresentation =
  | { kind: "presentable"; purpose: "ENTRY" | "KARAOKE"; mockMatrixSeed: string }
  | { kind: "not_presentable"; ticketState: EntryTicketState | KaraokeTicketState };
```

`OrderPurpose`, `OrderState`, `EntryTicketState`, `KaraokeSlotState`, `ReservationState`, `KaraokeTicketState`, `GoodsItemState`, `GoodsHandoffState` は `@off-r39x/domain` から import する。`Ref<"x">` の `x` は上記のとおり（`offering`, `goods`, `announcement`, `sponsor`, `slot`, `order`, `ticket`, `reservation`, `goodsItem`）。

型 import 経路: view model は `types.ts`、interface は `port.ts`。`types.ts` は `@off-r39x/domain` 以外を import しない。

## 2. Port `apps/web/src/api-client/port.ts`

```ts
export interface PublicApi {
  getEvent(): Promise<Read<EventInfo>>;                                                  // API-PUB-001
  listFaqs(): Promise<Read<readonly FaqItem[]>>;                                         // API-PUB-002
  listAnnouncements(q?: { limit?: number }): Promise<Read<readonly AnnouncementSummary[]>>; // API-PUB-003
  getAnnouncement(ref: Ref<"announcement">): Promise<Read<Announcement>>;                // API-PUB-004
  listSponsorLogos(): Promise<Read<readonly SponsorLogo[]>>;                             // API-PUB-012（PUBLISHED のみ、sort_order ASC, public_ref ASC）
  listEntryOfferings(): Promise<Read<readonly EntryOffering[]>>;                         // API-PUB-005（公開の販売情報だけ。閲覧者に依存しない。本人別の可否は getPurchaseEligibility）
  getKaraokeSales(): Promise<Read<KaraokeSales>>;                                        // API-PUB-006
  getKaraokeDay(date: BusinessDateJst): Promise<Read<KaraokeDay>>;                       // API-PUB-007 + API-PUB-008
  getKaraokeSlot(ref: Ref<"slot">): Promise<Read<KaraokeSlotDetail>>;                    // API-PUB-009
  listGoods(): Promise<Read<readonly GoodsSummary[]>>;                                   // API-PUB-010
  getGoods(ref: Ref<"goods">): Promise<Read<GoodsDetail>>;                               // API-PUB-011
  resolveCartLines(lines: readonly CartLine[]): Promise<Read<readonly CartLineResolution[]>>; // API-PUB-005 / API-PUB-010 / API-PUB-011 の合成（公開条件だけ。閲覧者に依存しない。本人別の可否は getPurchaseEligibility）
}
export interface PurchaseApi {
  getPurchaseEligibility(targets: readonly EligibilityTarget[]): Promise<PurchaseEligibilityRead>; // API-PUR-ELG-001（Cart line、または KARAOKE の Slot（数量 1）。本人向け・参照のみ・private/no-store。在庫確保ではなく、購入開始時に再検証される）
  startCartPurchase(lines: readonly CartLine[], o: { idempotencyKey: string }): Promise<CartPurchaseStart>; // API-PUR-CART-001（all-or-nothing。Checkout は startCheckout / API-CHK-001）
  startKaraokePurchase(slot: Ref<"slot">, o: { idempotencyKey: string }): Promise<KaraokePurchaseStart>;    // API-PUR-KRK-001
  startCheckout(order: Ref<"order">, o: { idempotencyKey: string }): Promise<CheckoutStart>;               // API-CHK-001
}
export interface SelfApi {   // 他者所有でも不存在でも同じ not_found（SPEC-110 §22）
  getProfile(): Promise<Read<Profile>>;                                       // API-AUTH-002
  updateProfile(i: { displayName: string }): Promise<ProfileUpdate>;          // API-AUTH-004（SPEC-030 §9.2: trim、空は null、1〜80 code points、内部 Cc 拒否）
  listOrders(): Promise<Read<readonly OrderSummary[]>>;                       // API-ORD-001
  getOrder(r: Ref<"order">): Promise<Read<OrderDetail>>;                      // API-ORD-003（notification_summary は SPEC-120 7.2 の所有者向け射影。summary だけの取得障害は null）
  listEntryTickets(): Promise<Read<readonly EntryTicketSummary[]>>;           // API-TKT-001
  getEntryTicket(r: Ref<"ticket">): Promise<Read<EntryTicketDetail>>;         // API-TKT-002
  getEntryQr(r: Ref<"ticket">): Promise<Read<QrPresentation>>;                // API-TKT-003
  listReservations(): Promise<Read<readonly ReservationSummary[]>>;           // API-KRK-SELF-001
  getReservation(r: Ref<"reservation">): Promise<Read<ReservationDetail>>;    // API-KRK-SELF-002
  getKaraokeQr(r: Ref<"reservation">): Promise<Read<QrPresentation>>;         // API-KRK-SELF-003
  listGoodsItems(): Promise<Read<readonly GoodsItemSummary[]>>;               // API-GDS-SELF-001
  getGoodsItem(r: Ref<"goodsItem">): Promise<Read<GoodsItemDetail>>;          // API-GDS-SELF-002
}
export interface ApiPort { readonly public: PublicApi; readonly purchase: PurchaseApi; readonly self: SelfApi }
```

各 method の doc comment に対応する正本の Operation ID を書く。`port.ts` に `UCR-110-001` と「Operation ID なし」は 1 つも残さない（全 method が正本の Operation ID を持つ）。`listEntryOfferings`（`API-PUB-005`）と `resolveCartLines`（`API-PUB-005` / `API-PUB-010` / `API-PUB-011` の複合）の注記は、これらが公開の読み取りであり本人別の条件は `getPurchaseEligibility` から取得する、と書く。`getPurchaseEligibility` の注記は `API-PUR-ELG-001`、owner-scoped、read-only、no-store、予約ではない（not a reservation）と書き、B4c 以降は Karaoke の対象（`KARAOKE` の Slot、数量 1）も受けることを書く（注記に他の Operation ID を書かない）。`startCartPurchase` は `API-PUR-CART-001`（`UCR-110-001` は INCORPORATED）として正本化されたので、`UCR-110-001` / 「Operation ID なし」を書かない。`listSponsorLogos` は `API-PUB-012`（`image_url` 必須、`sort_order ASC, public_ref ASC`）として正本化されたので `UCR-110-001` / 「Operation ID なし」を書かない。`getOrder` は `API-ORD-003`（`notification_summary` を含む）として正本化されたので、`UCR-110-001` / 「Operation ID なし」を書かない。新しい Operation ID を発明しない。

`apps/web/src/api-client/cart-line-key.ts`:

```ts
export function cartLineKey(line: CartLine): string;   // `${line.kind}:${ref}`。例 "ENTRY_TICKET:<offeringRef>" / "GOODS:<goodsRef>"
```

`apps/web/src/api-client/eligibility-target-key.ts`（B4c。`api-client/types`、`api-client/cart-line-key`、`@off-r39x/domain` の `assertNever` だけを import する）:

```ts
// API-PUR-ELG-001 の Body の 1 件を UI の型に写したもの（型は types.ts）。KARAOKE は CartLine に入らない（FR-CRT-002）。
export type EligibilityTarget = CartLine | { kind: "KARAOKE"; slotRef: Ref<"slot">; quantity: 1 };
export function eligibilityTargetKey(target: EligibilityTarget): string;   // Cart line は cartLineKey と同じ値、KARAOKE は `KARAOKE:${slotRef}`
```

`PurchaseEligibility` の形（`lineKey` / `purchasable` / `reasons` / `maxPurchasableQuantity`）は変えない。KARAOKE の `lineKey` は `eligibilityTargetKey` の値（TC-PG-KRK-003-617）。

## 3. AuthPort `apps/web/src/auth/port.ts`

設計書 Design §3 の `Session` と `AuthPort` をそのまま（`getSession`, `onSessionChange`, `signUp`, `verifyEmail`, `signIn`, `signOut`, `requestPasswordReset`, `completePasswordReset`）。

`apps/web/src/auth/password-policy.ts`（mock ではなく本番の UI 規則。SEC-AUTH-016/017）:

```ts
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export type PasswordPolicyResult = { ok: true } | { ok: false; reason: "too_short" | "too_long" };
export function validatePassword(password: string): PasswordPolicyResult;
```

- 長さは Unicode code point 数（`[...password].length`）で数える。12 以上 128 以下が ok。
- trim、case-fold、Unicode normalization をしない。前後の空白も文字数に含める（12 個の空白だけでも長さは 12 で ok）。固定の複雑性規則（大文字・記号の必須）を追加しない（SEC-AUTH-017）。

## 4. 注入できる部品

```ts
// clock.ts
export interface Clock { now(): UtcInstant }          // UTC。形式 YYYY-MM-DDTHH:mm:ss(.SSS)?Z
export const systemClock: Clock;                       // 本番 mock 用の既定。テストでは使わない
// ids.ts
export type IdGenerator = () => string;                // 呼ぶたびに新しい canonical lowercase UUID を返す
export const uuidIdGenerator: IdGenerator;             // 既定実装（crypto.randomUUID を使う）。テストでは使わない
// latency.ts
export type Sleep = (ms: number) => Promise<void>;
export const defaultSleep: Sleep;                      // setTimeout 実装。テストでは使わない
export function applyLatency(sleep: Sleep, scenario: Scenario): Promise<void>;
// db.ts
export interface MockStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
```

- `applyLatency`: `scenario.latency === "long"` のとき `sleep(scenario.latencyLongMs)` をちょうど 1 回呼んで await する。`"none"` のとき `sleep` を**一度も呼ばず**、解決済み Promise を返す。
- `createMockApi` の**全 method**（public / purchase / self）は、処理の最初（認証判定の前）に `applyLatency` を 1 回だけ呼ぶ。AuthPort の method は latency を使わない。

## 5. Scenario `scenario.ts`

localStorage key: `SCENARIO_STORAGE_KEY = "r39x.mock.scenario.v1"`。

```ts
type Scenario = {
  version: 1;
  publicFetch: "ok" | "fail" | "empty";
  latency: "none" | "long";
  latencyLongMs: number;                                  // 整数 1..60000
  sponsorLogos: "published" | "none" | "fail" | "image_broken" | "image_disallowed_origin";
  cart: { state: "ok" | "fail" | "partial" | "eligibility_fail"; purchaseStart: "ok" | "reject_one" | "limit" | "unavailable" };   // eligibility_fail（B4b）: resolveCartLines は ok と同じ。getPurchaseEligibility だけが unavailable
  checkout: "ok" | "start_failed" | "opportunity_expired";
  karaokeHold: "ok" | "conflict" | "limit" | "expire_before_checkout";
  karaokeSales: "ON_SALE" | "BEFORE_SALES" | "SALES_ENDED" | "SUSPENDED";   // PG-KRK-001 の販売状態を再現するための追加 switch
  paymentOutcome: "confirm_after_recheck" | "confirm" | "remain_awaiting" | "payment_failed" | "review_required" | "expire" | "cancel";
  notification: "sent" | "pending" | "failed_retryable" | "canceled" | "summary_unavailable";   // 模擬バックエンド内の確認通知の内部状態。UI へは notification_summary に射影して返す
  auth: {
    session: "ok" | "unavailable";
    login: "ok" | "credential_failure" | "unavailable";
    signup: "confirmation_required" | "signed_in" | "rejected" | "unavailable";
    verify: "ok" | "invalid_or_expired" | "unavailable";
    reset: "ok" | "unavailable";
    resetContext: "valid" | "invalid";
    logout: "ok" | "provider_failure";
  };
  eventFields: "complete" | "missing_optional";
};
```

- `scenarioSchema`: 上記の zod schema。**トップレベルも `auth` / `cart` も `.strict()`**。未知の key、未知の値、`version !== 1`、`latencyLongMs` が非整数・0 以下・60000 超は検証失敗。
- `DEFAULT_SCENARIO`（深く freeze してよい）と `defaultScenario()`（毎回新しい object）。既定値は次のとおり。

```ts
{ version: 1, publicFetch: "ok", latency: "none", latencyLongMs: 3000, sponsorLogos: "published",
  cart: { state: "ok", purchaseStart: "ok" }, checkout: "ok", karaokeHold: "ok", karaokeSales: "ON_SALE",
  paymentOutcome: "confirm_after_recheck", notification: "sent",
  auth: { session: "ok", login: "ok", signup: "confirmation_required", verify: "ok", reset: "ok", resetContext: "valid", logout: "ok" },
  eventFields: "complete" }
```

- `loadScenario(storage: MockStorage): ScenarioLoad` — `type ScenarioLoad = { kind: "ok"; scenario: Scenario } | { kind: "corrupted"; message: string }`。key が無ければ `ok` + 既定値（**何も書き込まない**）。JSON として不正、または schema 検証に失敗したら `corrupted`（**書き込み・削除をしない**。既定値に置き換えない）。`message` には保存値の中身（Secret になり得る値）を含めない。
- `saveScenario(storage, scenario)`: 検証して保存（JSON）。検証失敗は throw し、storage を変更しない。
- `resetScenario(storage): Scenario`: 既定値を保存して返す（corrupted からの明示的な復旧手段）。
- `createMockApi` は各 method の最初に `loadScenario` を呼ぶ（scenario は呼び出しごとに読み直す）。`corrupted` のときは Read 系は `{ kind: "unavailable" }`、purchase 系（`getPurchaseEligibility` を含む）は `{ kind: "unavailable" }` を返し、storage を変更しない。

## 6. 純粋関数

### `purpose.ts`（BR-ORD-013）

```ts
export type OrderLineKind = "ENTRY_TICKET" | "GOODS" | "KARAOKE";
export function decidePurpose(kinds: readonly OrderLineKind[]): OrderPurpose;
```

- Entry のみ → `ENTRY_TICKET_PURCHASE`、Goods のみ → `GOODS_PURCHASE`、両方（順序・重複に依存しない）→ `ENTRY_GOODS_PURCHASE`、Karaoke のみ（`["KARAOKE"]`）→ `KARAOKE_PURCHASE`。
- Karaoke と他の kind の混在、空配列は `Error` を throw する（Karaoke を複合にしない）。

### `karaoke-buckets.ts`（API-PUB-007、SPEC-050 §13.2、TST-DAT-007/008）

```ts
export type BucketInputSlot = { slotRef: Ref<"slot">; usageStart: UtcInstant; usageEnd: UtcInstant; state: KaraokeSlotState };
export function buildKaraokeBuckets(slots: readonly BucketInputSlot[], opts: { saleStatus: KaraokeSaleStatus }): KaraokeBucket[];
export function filterSlotsByBusinessDate(slots: readonly BucketInputSlot[], date: BusinessDateJst): BucketInputSlot[];
```

- bucket は **JST（Asia/Tokyo）の `usage_start` の時** で決める半開区間 `[hh:00, hh+1:00)`。`startHour` は 0..23 の整数。同一 slot は 1 つの bucket にだけ属する。
- bucket は `startHour` 昇順、各 bucket の `slots` は `usageStart` 昇順。slot が無い時間帯の bucket は作らない。
- `totalSlots` = bucket 内の slot 数（state を問わない）。`availableSlots` = `saleStatus === "ON_SALE"` かつ `state === "AVAILABLE"` の数（`saleStatus` が ON_SALE 以外なら常に 0）。
- `filterSlotsByBusinessDate`: `usageStart` の JST 営業日が `date` に等しい slot だけを元の順序で返す（UTC の日付ではない）。
- 時刻の変換は S1 の `format/datetime.ts`（`toBusinessDateJst`, `bucketStartHourJst`）を使ってよい。

## 7. DB `db.ts` / `session-store.ts`

```ts
export const DB_STORAGE_KEY = "r39x.mock.db.v1";
export type DbLoad = { kind: "ready"; state: DbState } | { kind: "corrupted"; message: string };
export interface MockDb {
  load(): DbLoad;            // key が無ければ seed して**保存**し ready。corrupted は何も書かない
  save(state: DbState): void;   // dbStateSchema で検証。失敗は throw し storage を変更しない
  reset(): DbState;          // 現在の clock.now() 基準の seed を保存して返す（corrupted からの明示的な復旧）
}
export function createMockDb(deps: { storage: MockStorage; clock: Clock }): MockDb;
```

- `DbState`（`dbStateSchema` で検証。**トップレベルも入れ子も `.strict()`**）は JSON シリアライズ可能で `version: 1` を持つ。内部構造は coder が決める。ただし次を満たす。
  - password、token、raw QR を含まない。
  - `load()` の戻り値は呼び出し側が変更しても storage に影響しない（deep copy を返す）。
  - 同じ storage に対し `load()` を繰り返しても、状態を変える操作が無い限り同じ内容を返す（`JSON.stringify` が一致する）。
- 不正な保存値（JSON として不正、未知の key、未知の enum 値、`version` 不一致、型違い）は `{ kind: "corrupted" }`。**黙って空や seed にしない**。`corrupted` のとき `setItem` / `removeItem` は呼ばれない。復旧は `reset()` のみ。
- `createMockApi` は内部で同じ `storage` / `clock` から `createMockDb` を作る。各 method は `load()` → 変更 → `save()` の順で動き、メモリに状態を残さない（同じ storage を共有する別の `createMockDb` から常に最新が読める）。`corrupted` の扱いは §5 末尾のとおり。

`session-store.ts`:

```ts
export const SESSION_STORAGE_KEY = "r39x.mock.session.v1";
export type SessionStoreState = {
  version: 1;
  session: { kind: "guest" } | { kind: "authenticated"; email: string; emailVerified: boolean };
  pendingVerificationEmail: string | null;
};
export type SessionLoad = { kind: "ok"; state: SessionStoreState } | { kind: "corrupted"; message: string };
export const sessionStateSchema;                       // strict
export function loadSessionState(storage: MockStorage): SessionLoad;   // key が無ければ ok + guest。書き込まない。不正は corrupted（書き込まない）
export function saveSessionState(storage: MockStorage, state: SessionStoreState): void;
```

`createMockApi` は session を `loadSessionState` で読む（`authenticated` のときだけ購入・self が使える）。session の email が DB の user に存在しなければ `auth_required` 扱い。session が `corrupted` なら Read 系は `unavailable`。

## 8. Seed `seed.ts`

```ts
export function buildSeed(now: UtcInstant): DbState;
```

- すべての日時は `now` からの相対値（DEV-REL-001）。固定の絶対日時を持たない。同じ `now` なら同じ内容（`idGenerator` を使わない）。
- UUID は下表のとおり**固定**（canonical lowercase、`4000` / `8000` 形式）。`tests/harness/mock-seed.ts` に同じ値がある。
- 時刻の表記: 下記の `now ± n` は `now` から n 日 / 時間の差。「JST 日 D」は `toBusinessDateJst(now)` に日数を足した営業日。

### 8.1 ユーザー（メールは `example.com` のみ。password は保存しない）

| email | emailVerified | displayName | 内容 |
|---|---|---|---|
| `demo@example.com` | true | `デモ太郎` | 全状態の購入データ |
| `new@example.com` | true | `新規さん` | 購入 0 件 |
| `unverified@example.com` | false | `未確認さん` | 購入 0 件。session は `emailVerified:false` |
| `other@example.com` | true | `他の人` | 他者データ（所有権テスト用） |

### 8.2 Entry Offering（ref = `e0000000-0000-4000-8000-0000000000NN`）

| NN | key | name（自由） | 単価（JPY） | 期間 | control | remaining | perAccountLimit | 公開 read での availability（閲覧者に依存しない） |
|---|---|---|---|---|---|---|---|---|
| 01 | regular | 自由 | 3000 | now-30d 〜 now+60d | ENABLED | 10 | 4 | `ON_SALE` max=4 |
| 02 | early | 自由 | 3500 | **now+3d** 〜 now+60d | ENABLED | 10 | null | `BEFORE_SALES`（startsAt = now+3d） |
| 03 | ended | 自由 | 2000 | now-60d 〜 now-1d | ENABLED | 10 | null | `SALES_ENDED` |
| 04 | suspended | 自由 | 2500 | now-30d 〜 now+60d | SUSPENDED | 10 | null | `SUSPENDED` |
| 05 | soldout | 自由 | 3000 | now-30d 〜 now+60d | ENABLED | 0 | null | `SOLD_OUT` |
| 06 | limit | 自由 | 2500 | now-30d 〜 now+60d | ENABLED | 20 | 2 | `ON_SALE` max=2 |

- 全 6 件が公開（`listEntryOfferings` に常に 6 件、上表の NN 昇順）。
- 最右列は公開 read（`listEntryOfferings` / `resolveCartLines`）の結果で、閲覧者（guest、`new`、`demo`、壊れた session）に依存しない（B4b）。`demo` の `limit` は本人の使用数が上限を超えているので `getPurchaseEligibility` だけが `PURCHASE_LIMIT_EXCEEDED`（`maxPurchasableQuantity` 0）を返し、公開 read は `ON_SALE` max=2 のままである。

### 8.3 Goods（ref = `a0000000-0000-4000-8000-0000000000NN`）

| NN | key | 単価 | 期間 | control | remaining | availability |
|---|---|---|---|---|---|---|
| 01 | tshirt | 4000 | now-30d 〜 now+60d | ENABLED | 20 | `ON_SALE` max=20 |
| 02 | towel | 1800 | 同上 | ENABLED | 3 | `ON_SALE` max=3 |
| 03 | badge | 600 | 同上 | ENABLED | 0 | `SOLD_OUT` |
| 04 | poster | 1200 | **now+5d** 〜 now+60d | ENABLED | 10 | `BEFORE_SALES`（startsAt = now+5d） |
| 05 | sticker | 500 | now-60d 〜 now-1d | ENABLED | 10 | `SALES_ENDED` |
| 06 | lanyard | 900 | now-30d 〜 now+60d | SUSPENDED | 10 | `SUSPENDED` |
| 07 | hidden | 700 | now-30d 〜 now+60d | ENABLED | 10 | **非公開**。名称は `"[hidden] 非公開グッズ"` |

- 公開は 01〜06（`listGoods` に 6 件、NN 昇順）。07 は一覧に出ず、`getGoods` は `not_found`、`resolveCartLines` は `not_public`。

### 8.4 Karaoke

- 販売: 単価 1000 JPY、期間 now-30d 〜 now+30d、既定の `saleStatus` は scenario `karaokeSales`（既定 `ON_SALE`）。`salesDates` = `[D1, D2]`（D1 = JST 日 +7、D2 = JST 日 +8）。
- slot ref = `5a000000-0000-4000-8000-0000000{D}{HHMM}`（`D` は 1 か 2、`HHMM` は JST の利用開始時刻 4 桁）。`usageEnd` = `usageStart` + 15 分（JST 時刻で指定し UTC へ変換して保存）。

| 日 | 利用開始 JST | slot ref 末尾 12 桁 | state | 備考 |
|---|---|---|---|---|
| D1 | 10:00 | `000000011000` | AVAILABLE | |
| D1 | 10:20 | `000000011020` | HELD | 他者が確保中 |
| D1 | 10:40 | `000000011040` | SOLD | `demo` の EXPIRED Ticket の予約 |
| D1 | 11:00 | `000000011100` | AVAILABLE | |
| D1 | 11:20 | `000000011120` | AVAILABLE | |
| D1 | 11:40 | `000000011140` | AVAILABLE | `demo` の CANCELED 予約の slot（解放済み） |
| D1 | 12:00 | `000000011200` | SALES_STOPPED | |
| D1 | 12:20 | `000000011220` | SOLD | `demo` の VALID 予約 |
| D1 | 12:40 | `000000011240` | SOLD | `demo` の USED 予約 |
| D1 | 13:00 | `000000011300` | AVAILABLE | |
| D1 | 14:00 | `000000011400` | SOLD | `other` の予約 |
| D2 | 08:40 | `000000020840` | AVAILABLE | JST 08:40 = UTC 前日 23:40（UTC 日付境界の確認用） |
| D2 | 09:00 | `000000020900` | AVAILABLE | JST 09:00 = UTC 00:00 |

- 結果として `getKaraokeDay(D1)` の bucket は 10 時 total 3 / available 1、11 時 3 / 3、12 時 3 / 0、13 時 1 / 1、14 時 1 / 0。`getKaraokeDay(D2)` は 8 時 1 / 1、9 時 1 / 1。

### 8.5 公開コンテンツ

- Announcement（ref = `ab000000-0000-4000-8000-0000000000NN`）: 01 `latest`（PUBLISHED、publishedAt = now-1d）、02 `script`（PUBLISHED、now-2d。`body` に文字列 `<script>alert("mock")</script>` を**そのまま**含む）、03 `older`（PUBLISHED、now-10d）、04 `draft`（DRAFT、title は `"[draft] 非公開のお知らせ"`）、05 `archived`（ARCHIVED、title は `"[archived] 掲載終了のお知らせ"`）。`listAnnouncements` は PUBLISHED の 3 件を `publishedAt` 降順（01, 02, 03）で返す。
- FAQ: PUBLISHED 3 件 + DRAFT 1 件（question は `"[draft] 非公開のFAQ"`）。`listFaqs` は PUBLISHED の 3 件だけ返す。
- Event: `name` は非空。`eventFields: "complete"` では全 field 非 null、`overview`・`startsAt`・`endsAt`・`venueName`・`venueGuide`・`accessInfo`・`notices` はそれぞれ非空 / 非 null（`notices` は 1 件以上）。`"missing_optional"` では `name` 以外の全 field が `null`。
- Sponsor Logo（ref = `5b000000-0000-4000-8000-0000000000NN`）: 01 `Sponsor Alpha`（PUBLISHED、displayOrder 10、`linkUrl` = `https://sponsor-alpha.example.com/`）、02 `Sponsor Bravo`（PUBLISHED、20、`linkUrl` = null）、03 `Sponsor Charlie`（PUBLISHED、30、`linkUrl` = `https://sponsor-charlie.example.com/`）、04 DRAFT（name = `"[draft] 協賛ドラフト"`）、05 ARCHIVED（name = `"[archived] 協賛アーカイブ"`）。**seed の配列の並びは Charlie, Alpha, Bravo, draft, archived とし、`displayOrder` でソートして返すことを確かめられるようにする**。`imageUrl` は `/mock/sponsors/<key>.svg` 形式の相対 path。`image_broken` では全 Logo の `imageUrl` を `/mock/sponsors/__broken__.svg` にする。`image_disallowed_origin` では全 Logo の `imageUrl` を `https://sponsor-images.invalid/<ref>.svg`（`<ref>` = その Logo の `sponsorRef`。`.invalid` は予約 TLD で、E2E の CSP `img-src` に含まれない origin）にする。相対 path の seed は UI mock の同一 origin 素材であり、`API-PUB-012` は https の URL だけを返す（差は PR の説明に記録する）。

### 8.6 Order（ref = `0d000000-0000-4000-8000-0000000000NN`。`createdAt` は now から過去へ）

`demo@example.com` の Order（NN, key, purpose, state, createdAt, 明細）:

| NN | key | purpose | state | createdAt | 明細 | 権利 |
|---|---|---|---|---|---|---|
| 01 | prepared | ENTRY_TICKET_PURCHASE | PREPARED | now-1h | limit ×1 | なし |
| 02 | awaiting | GOODS_PURCHASE | AWAITING_PAYMENT | now-2h | tshirt ×1 | goods item 01（PENDING_PAYMENT / PENDING） |
| 03 | confirmed_entry | ENTRY_TICKET_PURCHASE | CONFIRMED | now-3h | limit ×4 | ticket 01 VALID / 02 USED / 03 CANCELED / 04 EXPIRED |
| 04 | payment_failed | GOODS_PURCHASE | PAYMENT_FAILED | now-4h | lanyard ×1 | goods item 04（CANCELED / VOID） |
| 05 | canceled | ENTRY_TICKET_PURCHASE | CANCELED | now-5h | limit ×1 | なし |
| 06 | expired | KARAOKE_PURCHASE | EXPIRED | now-6h | karaoke D2 09:00 | なし（slot は AVAILABLE のまま） |
| 07 | review | ENTRY_GOODS_PURCHASE | REVIEW_REQUIRED | now-7h | limit ×1 + tshirt ×1 | goods item 05（PENDING_PAYMENT / PENDING） |
| 08 | confirmed_goods | GOODS_PURCHASE | CONFIRMED | now-8h | towel ×1 | goods item 02（FULFILLABLE / COMPLETED） |
| 09 | confirmed_composite | ENTRY_GOODS_PURCHASE | CONFIRMED | now-9h | limit ×1 + tshirt ×1 | ticket 05 VALID、goods item 03（FULFILLABLE / PENDING） |
| 10 | k_valid | KARAOKE_PURCHASE | CONFIRMED | now-10h | karaoke D1 12:20 | reservation 01（CONFIRMED / ticket VALID） |
| 11 | k_used | KARAOKE_PURCHASE | CONFIRMED | now-11h | karaoke D1 12:40 | reservation 02（CONFIRMED / ticket USED） |
| 12 | k_canceled | KARAOKE_PURCHASE | CONFIRMED | now-12h | karaoke D1 11:40 | reservation 03（CANCELED / ticket CANCELED） |
| 13 | k_expired | KARAOKE_PURCHASE | CONFIRMED | now-13h | karaoke D1 10:40 | reservation 04（CONFIRMED / ticket EXPIRED） |

`other@example.com` の Order: 101 ENTRY_TICKET_PURCHASE CONFIRMED（limit ×1、now-1d、ticket 101 VALID）、102 GOODS_PURCHASE CONFIRMED（tshirt ×1、now-1d-1h、goods item 101 FULFILLABLE / PENDING）、103 KARAOKE_PURCHASE CONFIRMED（karaoke D1 14:00、now-1d-2h、reservation 101 VALID）。

- ticket ref = `7c000000-0000-4000-8000-0000000000NN`、reservation ref = `4e000000-...`、goods item ref = `91000000-...`、order ref の `NN` は 12 桁目までゼロ埋め（例 101 → `0d000000-0000-4000-8000-000000000101`）。
- 明細の単価・小計・合計は seed 時点の単価 Snapshot。`total` は `items` の `subtotal` の合計に等しい（`sumMoney` / `multiplyMoney` と同じ bigint 計算）。
- `receiptUrl`: CONFIRMED の Order は `https://` で始まる文字列。ただし 10 `k_valid` は **null**（Receipt なし）。CONFIRMED 以外は常に null。
- Entry Ticket の `offeringName` は Order 明細の offering の name、`issuedAt` はその Order の `createdAt`（seed）/ CONFIRMED へ遷移した read 時点の `clock.now()`（in-session）。Reservation の `date` は slot の JST 営業日、`price` は 1000 JPY。
- 閲覧者別 Purchase Limit の使用数 = その閲覧者の Order のうち state が PREPARED / AWAITING_PAYMENT / CONFIRMED / REVIEW_REQUIRED のものの、当該 offering の数量合計（PAYMENT_FAILED / CANCELED / EXPIRED は数えない）。`demo` の `limit` の使用数は 01+03+07+09 = 1+4+1+1 = 7 で、上限 2 を超えるため、`getPurchaseEligibility` だけが `PURCHASE_LIMIT_EXCEEDED` を返す（公開 read は本人の使用数を反映しない。§9、§11.5）。

## 9. Availability の評価（Entry / Goods 共通）

`evaluate(item, quantity, viewerUsed)`（内部関数。export は不要。公開 read は B4b から**常に `viewerUsed = 0`** で呼ぶ。本人別の使用数は §11.5 の `getPurchaseEligibility` だけが反映する）:

1. `control === "SUSPENDED"` → `SUSPENDED`。
2. `now < startsAt` → `BEFORE_SALES`（`startsAt` を返す）。`now >= endsAt` → `SALES_ENDED`（半開区間）。
3. `remaining === 0` → `SOLD_OUT`。
4. `perAccountLimit != null` かつ `viewerUsed >= perAccountLimit` → `PURCHASE_LIMIT_EXCEEDED`。
5. `quantity > remaining` → `INSUFFICIENT_QUANTITY`（`maxSelectableQuantity = remaining`）。
6. `perAccountLimit != null` かつ `quantity > perAccountLimit - viewerUsed` → `PURCHASE_LIMIT_EXCEEDED`。
7. それ以外 → `ON_SALE`、`maxSelectableQuantity = min(remaining, perAccountLimit - viewerUsed)`（`perAccountLimit` が null なら `remaining`）。mock は `null` を返さない。

- 一覧（`listEntryOfferings` / `listGoods`）は `quantity = 1` で評価する。`viewerUsed` は閲覧者（guest、`new`、`demo`、壊れた session）によらず 0 で、session が壊れていても `unavailable` にしない（公開 read は閲覧者に依存しない。SPEC-050 12.1、`API-PUB-005`）。公開 read の一覧には `PURCHASE_LIMIT_EXCEEDED` は現れない（`quantity = 1` で `viewerUsed = 0` なら、seed の上限はいずれも 1 以上）。
- `resolveCartLines` は同じ関数を、その line の `quantity` で、同じく `viewerUsed = 0` で評価する。公開上限を超える数量（例: `limit` を 3）は、guest にも `demo` にも同じく `PURCHASE_LIMIT_EXCEEDED`（公開上限と選択数量だけの検証。SPEC-050 12.1）になる。`resolveCartLines` は line ごとに独立して評価し、同じ ref の重複 line を集計しない。`startCartPurchase` は `evaluate()` を使わず、§11.1-5 の `evaluatePurchaseConditions`（API-PUR-ELG-001 の reasons。重複 line は入力検証で reject）で line ごとに独立して評価する。非公開・存在しない ref は resolve では `not_public`、購入開始では `NOT_PUBLIC_OR_NOT_FOUND`。
- `remaining` は Order 作成時に数量分だけ減り（Allocation / Inventory の確保）、`PAYMENT_FAILED` / `CANCELED` / `EXPIRED` へ遷移した Order の数量分が戻る。`CONFIRMED` では戻さない。

## 10. 認証 / 認可の共通規則（`createMockApi`）

session は `SESSION_STORAGE_KEY` から読む。

- `public.*`: 認証不要。session を読まず、壊れた session でも `unavailable` にならない（閲覧者に依存しない）。
- `purchase.getPurchaseEligibility`: guest → `{ kind: "auth_required" }`、emailVerified:false → `{ kind: "email_unverified" }`、session が壊れている → `{ kind: "unavailable" }`（fail closed）。この判定は scenario `cart.state = eligibility_fail` より先に行う（guest に `unavailable` を返さない）。
- `purchase.startCartPurchase` / `startKaraokePurchase`: guest → `{ kind: "auth_required" }`、emailVerified:false → `{ kind: "email_unverified" }`。
- `purchase.startCheckout`: guest と emailVerified:false のどちらも `{ kind: "auth_required" }`（`CheckoutStart` に `email_unverified` が無い）。
- `self.*` の Read: guest → `{ kind: "auth_required" }`、emailVerified:false → `{ kind: "email_unverified" }`。
- `self.updateProfile`: guest / emailVerified:false → `{ kind: "unavailable" }`（`ProfileUpdate` に認証系の結果が無い。UI は呼ばない）。
- 認証判定は、所有権判定・ref の存在判定より**先**に行う。
- 所有権: 他者所有の ref と存在しない ref（形式が不正な文字列を含む）は、**同じ** `{ kind: "not_found" }` を返す（`toEqual` で等しく、追加 field なし）。SPEC-110 §22。`startCheckout` の他者所有・不存在 Order は `{ kind: "state_conflict" }`（両者を区別しない）。

## 11. 購入開始と Checkout（mock の意味論）

### 11.1 `startCartPurchase(lines, { idempotencyKey })`

1. latency → session 判定（§10）。
2. `scenario.cart.purchaseStart === "unavailable"` → `{ kind: "unavailable" }`（状態を変えない）。
3. 入力検証（API-PUR-CART-001 の Body。400 `VALIDATION_FAILED` 相当）: 次のいずれかに当たれば **Promise を reject**（`RangeError`）し、DB は変えず `idGenerator` も呼ばない。`lines` が空、51 件以上、quantity が `Number.isSafeInteger` で 1〜2147483647 の範囲外、`cartLineKey` が同じ line の重複。50 件ちょうどと quantity 2147483647 は有効な入力で、業務結果（`created` / `rejected`）として評価する。UI は `canProceed` と Cart store の合算（重複なし）、試行ごとの新しい `idempotencyKey` でこれらを防ぐ。
4. replay（FR-XFN-012、409 `IDEMPOTENCY_KEY_REUSED` 相当）: 同じ session の user・同じ `idempotencyKey` で以前に `created` を返していれば、送られた lines（`cartLineKey` ごとの数量。**line の順序は問わない**）を、記録した Order の明細（`ENTRY_TICKET.offeringRef` / `GOODS.goodsRef` ごとの数量の合計）と比べる。**一致すれば**同じ `{ kind: "created", orderRef }` を返し、新しい Order を作らず、`idGenerator` も呼ばず、DB を変えない。**違えば**（数量の違い、line の追加、別の Item）Promise を reject し（`Error`、メッセージに `idempotency key reused`）、何も作らない。記録した Order が DB から見つからない replay も同様に reject し、何も作らない（Order を作り直さない）。`rejected` は記録しない（状態が変われば再評価する）。
5. 各 line を**互いに独立に**評価する（重複 line は 3 で排除済みなので、逐次の割り当てはない）。評価は `evaluatePurchaseConditions`（`apps/web/src/mock/backend/purchase-conditions.ts`。API-PUR-ELG-001 の reasons を返す純粋関数。時刻は引数で受け取る）で行い、requested = line の数量、Entry の `used` = 閲覧者の既存 Order の使用数（§8.6）、Goods は上限なし（`perAccountLimit: null`、`used: 0`）とする。理由は次の順に積む（重複なし。SPEC-110 の列挙順と同じ）:
   1. 非公開または存在しない ref → `["NOT_PUBLIC_OR_NOT_FOUND"]` **だけ**（他の理由を付けない。非公開と不存在は区別できない）。
   2. `now < startsAt` → `SALES_NOT_STARTED`、`now >= endsAt` → `SALES_CLOSED`（半開区間）、`control = SUSPENDED` → `SALES_STOPPED`。
   3. `remaining = 0` → `SOLD_OUT`（`INSUFFICIENT_QUANTITY` は付けない）。それ以外で `requested > remaining` → `INSUFFICIENT_QUANTITY`。
   4. `perAccountLimit != null` かつ `requested > max(0, perAccountLimit - used)` → `PURCHASE_LIMIT_EXCEEDED`。
   - 販売期間外・停止でも、在庫・上限の理由を並べる（全理由を列挙する）。この共起の規則は mock の決定で、正本では細部が未定義（DEV-WEB-010 により契約の根拠にしない）。
   - `SLOT_UNAVAILABLE` / `PAYMENT_WINDOW_TOO_SHORT` は Karaoke 専用で、Cart では生じない。
   - さらに scenario `cart.purchaseStart`（**先頭の line の自然な理由が空のときだけ**上書きする。自然な理由があればそれを優先する）: `reject_one` なら先頭の line を `["INSUFFICIENT_QUANTITY"]`（購入開始時に選択数量を確保できなかった状態。SPEC-050 14A.1 の「選択数量を確保できない → 数量不足」）、`limit` なら先頭の line を `["PURCHASE_LIMIT_EXCEEDED"]`。
6. 理由を持つ line が 1 つ以上あれば `{ kind: "rejected", itemFailures }` を返す。`itemFailures` は**不成立の line だけ**を入力順に `{ lineKey, reasons }` で並べる（`lineKey` は `cartLineKey`。`reasons` は 1 件以上、正本の順、重複なし）。**Order、Allocation（remaining）、idempotency 記録を含む DB の状態を一切変えない**（`load()` の JSON が呼び出し前後で一致し、`idGenerator` も呼ばない）。BR-ORD-014、BR-ORD-017、FR-CRT-005。結果に `rejections` / `includedLineKeys` のプロパティは無い。
7. すべて成立したら Order を 1 件作る: `purpose = decidePurpose(...)`、`state = "PREPARED"`、`createdAt = clock.now()`、明細は現在の単価の Snapshot、`total` は小計の合計、各 line の `remaining` を数量分減らす。戻り値は `{ kind: "created", orderRef }` **だけ**（送った全 line が Order に入った。All-or-Nothing）。`orderRef` は `idGenerator()` の値。line ごとに明細（Goods は goods item も）を 1 件ずつ作る。idempotency 記録（`kind: "cart"`）は既存の schema のまま全 line key を書き続ける（DB の `includedLineKeys` は mock 内部の legacy field。port には出さない。保存済みの `r39x.mock.db.v1` を壊さないため）。

### 11.2 `startKaraokePurchase(slotRef, { idempotencyKey })`

1. latency → session 判定 → idempotency（`held` のみ記録。同じ key は同じ `orderRef` を返し、Order を増やさない）。
2. 判定の順序は、1 の後、(a) scenario `karaokeHold`: `conflict` → `{ kind: "slot_unavailable" }`、`limit` → `{ kind: "purchase_limit_exceeded" }`、(b) `karaokeSales !== "ON_SALE"` → `{ kind: "not_on_sale" }`、(c) slot の state（3）の順。(a)(b) は状態を変えない。（B4c: scenario `karaokeHold: "limit"` は §11.5 の KARAOKE の判定にも `PURCHASE_LIMIT_EXCEEDED` として効く。`conflict` / `expire_before_checkout` は購入開始・Checkout だけの scenario で、判定には効かない。）
3. slot が存在しない、または `AVAILABLE` でない（HELD / SOLD / SALES_STOPPED）→ `{ kind: "slot_unavailable" }`（状態を変えない）。
4. 成立 → slot を `HELD` にし、Order を作る（`purpose = KARAOKE_PURCHASE`、`state = PREPARED`、明細は KARAOKE 1 件）。`{ kind: "held", orderRef }`。Karaoke の Order は Cart の Order とは別の独立した Order（BR-ORD-019）で、購入開始で複合 Order にならない。

### 11.3 `startCheckout(orderRef, { idempotencyKey })`

1. latency → session 判定（guest / 未確認は `auth_required`）→ 所有権（他者・不存在は `state_conflict`）。
2. 以前に同じ user・同じ `idempotencyKey` で `redirect` を返していれば、同じ結果（最初の `url`）を返す（状態を再遷移させず、idempotency 記録も増やさず、`idGenerator` も呼ばない）。replay は **user + key だけ**で判定し、`orderRef` は比較しない（別の Order に同じ key を使っても最初の Order の redirect が返り、その別の Order は `PREPARED` のまま）。実 API（SPEC-110 §18、API-CHK-001）では、同じ key で別の Order（fingerprint が違う）は `409 IDEMPOTENCY_KEY_REUSED` になるが、mock はこれを単純化して最初の結果を返す（`CheckoutStart` にこの結果の kind はない）。mock は API contract の検証根拠ではない（DEV-WEB-010）。実 api-client の実装時は SPEC-110 §18 / API-CHK-001 に従って 409 を返すこと。
3. Order が `PREPARED` でなければ `{ kind: "state_conflict" }`。
4. scenario `checkout === "start_failed"` → `{ kind: "start_failed" }`。Order は `PREPARED` のまま（**同じ Order を再利用**して、scenario を `ok` に戻した後の再試行（新しい `idempotencyKey`）が成功する。新しい Order は作られない）。
5. scenario `checkout === "opportunity_expired"`、または Order が Karaoke で `karaokeHold === "expire_before_checkout"` → Order を `EXPIRED` にし、確保（remaining / slot の HELD）を解放して `{ kind: "opportunity_expired" }`。
6. それ以外（`ok`）→ Order を `AWAITING_PAYMENT` にし、webhook 待ち（`pendingWebhook`）を記録して `{ kind: "redirect", url: "/dev/mock-checkout/<orderRef>" }`（先頭が `/` の相対 path、`<orderRef>` は Order ref）を返す。**この時点で `CONFIRMED` にしない**（PAY-BRW-001）。

### 11.4 支払い結果の模擬（`self.getOrder` の read 時）

webhook 待ち（`startCheckout` が `redirect` を返した Order）で、state が `AWAITING_PAYMENT` のものだけが対象。シードの AWAITING_PAYMENT / REVIEW_REQUIRED は対象外（常に不変）。`getOrder` を呼ぶたびに、その Order の「待ち中の read 回数」を 1 増やしてから、現在の scenario `paymentOutcome` を評価する。

| paymentOutcome | 結果 |
|---|---|
| `confirm_after_recheck`（既定） | read 回数 1 → `AWAITING_PAYMENT` のまま。2 以上 → `CONFIRMED` |
| `confirm` | その read で `CONFIRMED` |
| `remain_awaiting` | 常に `AWAITING_PAYMENT` |
| `payment_failed` | その read で `PAYMENT_FAILED`（確保を解放） |
| `review_required` | その read で `REVIEW_REQUIRED`（確保は保持） |
| `expire` | その read で `EXPIRED`（確保を解放） |
| `cancel` | その read で `CANCELED`（確保を解放） |

- 返す `OrderDetail` は遷移**後**の state。終端（`CONFIRMED` / `PAYMENT_FAILED` / `EXPIRED` / `CANCELED` / `REVIEW_REQUIRED`）に達したら webhook 待ちを解除し、以後の read は変化しない。
- `CONFIRMED` への遷移で: Entry の各 line の数量分 Entry Ticket（`VALID`、`idGenerator` で ref）、Goods の各 line の Goods item（`FULFILLABLE` / `PENDING`、line ごとに 1 件）、Karaoke の Reservation（`CONFIRMED`、Ticket `VALID`）を作り、Karaoke の slot を `SOLD` にする。`receiptUrl` は `https://` の文字列。
- Order の state 以外の read（`listOrders`、他の `self.*` Read）は遷移を起こさない。`getOrder` / `listOrders` / 他の read は**新しい Order を作らない**（PAY-BRW-002）。
- Order が `PREPARED` / `AWAITING_PAYMENT` / `REVIEW_REQUIRED` の goods item は `PENDING_PAYMENT`（handoff `PENDING`）、`PAYMENT_FAILED` / `CANCELED` / `EXPIRED` の goods item は `CANCELED`（handoff `VOID`）、`CONFIRMED` は記録された値（`FULFILLABLE` + `PENDING` / `COMPLETED`）として返す。
- `OrderDetail.entitlements`: `CONFIRMED` のときだけ、その Order の Ticket refs / reservationRef / goodsItems（itemState と handoffState）を返す。それ以外の state は常に `{ entryTicketRefs: [], reservationRef: null, goodsItems: [] }`（複合 Order でも片方だけ返さない。BR-ORD-015、INV-010-07）。
- `OrderDetail.notificationSummary`（`API-ORD-003`、SPEC-120 §7.2 `EML-NTF-003` の射影。`notice` は存在しない。summary status は `types.ts` の DTO 型 `NotificationSummaryStatus = "NONE" | "PENDING" | "SENT" | "ATTENTION_REQUIRED"` で、Domain State ではない）:

  | scenario `notification` | `CONFIRMED` の Order | 非 `CONFIRMED` の Order |
  |---|---|---|
  | `failed_retryable` | `{ status: "ATTENTION_REQUIRED" }` | `{ status: "NONE" }` |
  | `pending` | `{ status: "PENDING" }` | `{ status: "NONE" }` |
  | `sent`（既定） | `{ status: "SENT" }` | `{ status: "NONE" }` |
  | `canceled` | `{ status: "NONE" }`（CANCELED は集約対象外） | `{ status: "NONE" }` |
  | `summary_unavailable` | `null` | `null` |

  `summary_unavailable` でも `getOrder` は `ok` を返し、state・entitlements・receiptUrl は通常どおり（部分障害を Order の失敗にしない）。state と entitlements は scenario の影響を受けない。read は DB を書き換えない。
- `listOrders`: 本人の Order だけを `createdAt` 降順（非増加）で返す。guest / 未確認は §10。`getOrder`: 本人の Order 以外は `not_found`。

### 11.5 `getPurchaseEligibility(targets)`（B4b / B4c。`API-PUR-ELG-001`、SEC-API-029、AR-AZ-011）

本人向けの**参照のみ**の一括判定。購入開始の前に画面へ本人別の可否・理由・購入できる最大数量を見せるための read で、在庫の確保でも購入の保証でもない（表示後の競合は購入開始時に再検証される。`startCartPurchase` が同じ line に同じ理由を返す）。

1. latency → session 判定（§10。guest → `auth_required`、emailVerified:false → `email_unverified`、session が壊れている → `unavailable`）。続いて scenario（`corrupted` なら `unavailable`、`cart.state === "eligibility_fail"` なら `unavailable`）。認証の判定が scenario より先。
2. 入力検証（§11.1-3 と同じ。API-PUR-ELG-001 の Body）: 空、51 件以上、quantity が `Number.isSafeInteger` で 1〜2147483647 の範囲外、`eligibilityTargetKey` の重複は **Promise を reject**（`RangeError`）。**KARAOKE は数量 1 のときだけ有効**（それ以外は reject）。重複は `eligibilityTargetKey` で判定する（Cart line は `cartLineKey` と同じ。同じ Slot の 2 件は重複）。50 件ちょうどと quantity 2147483647（Cart line）は業務結果として評価する。`startCartPurchase` の検証（§11.1-3）は Cart line だけで、変わらない。
3. 各 target を**互いに独立に**評価する。Cart line は `evaluatePurchaseConditions`（§11.1-5 と同じ純粋関数。requested = line の数量、Entry の `used` = 署名中の user の既存 Order の使用数（§8.6）、Goods は上限なし）。**KARAOKE（B4c）は `evaluateKaraokeConditions`（`apps/web/src/mock/backend/purchase-conditions.ts` の純粋関数。`{ kind: "missing" }` または `{ kind: "slot", slotState, saleStatus, limitReached }`）**: 存在しない Slot → `["NOT_PUBLIC_OR_NOT_FOUND"]` **だけ**・最大 0。それ以外は正本の順に積む（重複なし）: scenario `karaokeSales` が `BEFORE_SALES` → `SALES_NOT_STARTED`、`SALES_ENDED` → `SALES_CLOSED`、`SUSPENDED` → `SALES_STOPPED`（`ON_SALE` は何もしない）、scenario `karaokeHold === "limit"` → `PURCHASE_LIMIT_EXCEEDED`、slot の state が `AVAILABLE` でない（HELD / SOLD / SALES_STOPPED）→ `SLOT_UNAVAILABLE`。理由が無いときだけ `purchasable: true`・最大 1、それ以外は最大 0（Karaoke の最大は 0 または 1）。**`PAYMENT_WINDOW_TOO_SHORT` は mock では生じない**（mock に支払い期限が無く、時間の定数も置けない。TC-PG-KRK-003-106）。`ok` の `data` は**入力順**（ENTRY / GOODS / KARAOKE の混在も入力順）で、各 item は `{ lineKey, purchasable, reasons, maxPurchasableQuantity }`。`lineKey` は `eligibilityTargetKey`（Cart line は `cartLineKey`、KARAOKE は `KARAOKE:<slotRef>`）。
   - `purchasable === (reasons.length === 0)`。`reasons` は正本の順で重複なし。非公開と不存在は同じ答え（`["NOT_PUBLIC_OR_NOT_FOUND"]` だけ、最大 0）。
   - `maxPurchasableQuantity`: 公開で販売期間内・停止なしの item は `max(0, min(remaining, perAccountLimit - used))`（`perAccountLimit` が null なら `remaining`）。販売期間外・停止・`SOLD_OUT`・非公開は 0。
   - 本人の使用数だけを数える（別の user の Order は数えない）。
4. **何も書かない**: `db.save` を呼ばず、`idGenerator` も呼ばず、idempotency 記録を作らず、Order の状態も Slot の state も進めない（`getOrder` のような simulated webhook の読み取り回数を増やさない）。呼び出しの前後で `load()` の JSON、storage の全 key と値、書き込みログ、id の採番数が一致する。
5. 結果は port の外へ保存されない（UI は storage に書かない。SEC-API-029）。

## 12. Self Read の意味論

- `listEntryTickets` / `listReservations` / `listGoodsItems`: 本人の分だけ。`new@example.com` は 3 つとも `{ kind: "ok", data: [] }`（`unavailable` でも `not_found` でもない）。
- `getEntryQr`: 本人の ticket が `VALID` なら `{ kind: "presentable", purpose: "ENTRY", mockMatrixSeed }`、それ以外は `{ kind: "not_presentable", ticketState }`。`getKaraokeQr`: Reservation が `CONFIRMED` かつ Ticket が `VALID` なら `presentable`（`purpose: "KARAOKE"`）、それ以外は `not_presentable`（`ticketState` は Karaoke Ticket の state）。
- `mockMatrixSeed` は正規表現 `^mock-seed-\d{1,8}$` に一致し、同じ ref に対して常に同じ値（ref から決定的に導く。`Math.random` を使わない）。Token・JWT・UUID・長い hex / base64 の形にしない（SEC-QR-012/013）。`presentable` / `not_presentable` のどちらの object にも、ref の文字列そのものや token らしい field を含めない。
- `getProfile`: `{ email, displayName }`（seed のとおり。未設定は `displayName: null` で、email から補完しない）。`updateProfile({ displayName })`: `apps/web/src/api-client/display-name-policy.ts` の `normalizeDisplayName`（SPEC-030 §9.2、API-AUTH-004）を適用する。(1) `trim()` 後が空（空文字、半角・全角空白・タブ・改行だけ）→ 未設定にする（`displayName = null` で保存し `{ kind: "saved", profile: { email, displayName: null } }`）。(2) trim 後に内部 `Cc`（`\t`、`\u0000`、`\u007F`、`\u0085` など `\p{Cc}`）が残る、または 80 code points（`[...value].length`）を超える → `{ kind: "validation_failed", field: "displayName" }`（保存しない。DB 不変）。`Cc` と長さの両方に違反する場合の判定は `Cc` が先。(3) それ以外は trim した値を保存し `{ kind: "saved", profile }`。Unicode 正規化はしない。他の user は変わらない。保存後の `getProfile` に反映される。

## 13. 公開 Read と scenario `publicFetch`

- `fail`: `getEvent`、`listFaqs`、`listAnnouncements`、`getAnnouncement`、`listEntryOfferings`、`getKaraokeSales`、`getKaraokeDay`、`getKaraokeSlot`、`listGoods`、`getGoods`、`resolveCartLines` はすべて `{ kind: "unavailable" }`。
- `empty`: 一覧系（`listFaqs`、`listAnnouncements`、`listEntryOfferings`、`listGoods`）は `{ kind: "ok", data: [] }`。`getKaraokeSales` は `salesDates: []`。`getKaraokeDay` は（日付が販売対象日なら）`buckets: []`、`previousDate` / `nextDate` は通常どおり。`getEvent`、`getAnnouncement`、`getKaraokeSlot`、`getGoods`、`resolveCartLines` は `ok` と同じ。
- `fail` と `empty` は互いに区別できる（`unavailable` を Empty に変換しない）。
- `listSponsorLogos` は `publicFetch` の影響を受けない。`scenario.sponsorLogos`: `published` → PUBLISHED だけを `displayOrder` 昇順、**同値は ref 昇順**（`API-PUB-012` の `sort_order ASC, public_ref ASC`。保存順に依存しない）で `ok`、`none` → `ok` + `[]`、`fail` → `unavailable`、`image_broken` → `published` と同じ内容で `imageUrl` を §8.5 の壊れた URL にする、`image_disallowed_origin` → `published` と同じ内容（同じ 3 件・同順・同 `linkUrl`）で `imageUrl` だけを §8.5 の許可されない origin の URL にする。
- `scenario.cart.state`: `fail` → `resolveCartLines` が `unavailable`。`partial` → `ok` だが、**先頭の line**だけ `{ lineKey, status: "unavailable" }`（他の line は通常どおり）。`ok` → 通常。`eligibility_fail` → `resolveCartLines` は `ok` と同じ結果を返し、`getPurchaseEligibility`（§11.5）だけが `unavailable` を返す（公開 read の障害ではない。KARAOKE を含むすべての対象で `unavailable`。名前に `cart` を含むが `getPurchaseEligibility` 全体の失敗の switch で、Goods 詳細と Karaoke Slot にも効く。保存済みの scenario を壊さないため名前は変えない）。
- `scenario.eventFields`: §8.5。
- `listAnnouncements({ limit })`: `limit` が指定されたら先頭から `limit` 件まで（降順の後で切る）。
- `getAnnouncement`: PUBLISHED だけ `ok`。DRAFT / ARCHIVED / 存在しない / 形式不正は `not_found`（`ok` のときの話。`fail` は `unavailable`）。`body` は seed の文字列をそのまま返す（HTML エスケープ・除去をしない。描画側が plain text として表示する）。
- `getKaraokeDay(date)`: `date` が `salesDates` に含まれなければ `not_found`。含まれれば §6 の `buildKaraokeBuckets`（`filterSlotsByBusinessDate` で当日だけに絞る）。`saleStatus` は scenario `karaokeSales`。`getKaraokeSlot`: slot の JST 営業日、`purchasable`（`state === AVAILABLE` かつ `saleStatus === ON_SALE`）を返す。存在しなければ `not_found`。
- `getKaraokeSales` の `saleStatus` は scenario `karaokeSales`。

## 14. MockAuth `mock-auth.ts`

```ts
export type MockAuthDeps = { storage: MockStorage; clock: Clock; idGenerator: IdGenerator };
export function createMockAuth(deps: MockAuthDeps): AuthPort;
```

- **password を保存・記録しない**（SEC-AUTH-018）。storage の全 key、`console.*`、返却値のどこにも password を含めない。mock は password の一致を検証しない（成否は scenario が決める）。
- user は DB（`createMockDb({storage, clock})`）の users、session は `SESSION_STORAGE_KEY`。DB が corrupted のとき DB を使う操作（`signUp`、`signIn`、`verifyEmail`）は `{ kind: "unavailable" }`。
- `getSession()`: `scenario.auth.session === "unavailable"` → `{ kind: "unavailable" }`。session が corrupted → `{ kind: "unavailable" }`（guest にしない）。それ以外は `{ kind: "ok", session }`（保存された session。無ければ guest）。呼び出しごとに storage から読む。
- `onSessionChange(cb)`: 登録し、unsubscribe 関数を返す。session が変わった操作（`signIn` 成功、`signOut`、`signUp` が `signed_in`、`verifyEmail` が `verified` で session の emailVerified が変わった）の**あと**に、登録中の全 cb を引数なしで 1 回ずつ呼ぶ。unsubscribe 後は呼ばない。変化がない操作では呼ばない。
- `signIn({ email, password })`: `auth.login === "unavailable"` → `unavailable`、`credential_failure` → `credential_failure`。`ok` のとき、email が空・password が空・email が DB の user に存在しない → `{ kind: "credential_failure" }`（原因を区別しない）。存在すれば session を `authenticated` にして `{ kind: "signed_in", emailVerified }`（user の emailVerified）。`credential_failure` / `unavailable` では session を変えない。
- `signUp({ email, password })`: `auth.signup === "unavailable"` → `unavailable`、`rejected` → `rejected`（user を作らない）。それ以外は email の形式（`^[^@\s]+@[^@\s]+$`）と `validatePassword` を検査し、不合格なら `{ kind: "rejected" }`（user を作らない）。合格のとき、
  - 新しい user の `displayName` は **null**（email の local part などから推測して補完しない。SPEC-030 §9.2。TC-PG-MYP-002-103）。
  - `confirmation_required`: 新しい email なら user を `emailVerified:false` で作り、`pendingVerificationEmail` に記録、session は変えない。既存の email なら何も作らない。どちらも `{ kind: "confirmation_required" }`（存在を開示しない。SEC-API-027）。
  - `signed_in`: 新しい email なら user を `emailVerified:true` で作り session を `authenticated(emailVerified:true)` にして `{ kind: "signed_in" }`。既存の email なら何も変えず `{ kind: "confirmation_required" }`。
- `verifyEmail({ context })`: `auth.verify === "unavailable"` → `unavailable`、`invalid_or_expired` → `invalid_or_expired`。`ok` のとき `context` が `null` または空文字 → `invalid_or_expired`。それ以外は、対象 user を「現在の session が authenticated ならその email、そうでなければ `pendingVerificationEmail`」で決める。対象が無い / DB に存在しない → `invalid_or_expired`。見つかれば user を `emailVerified:true` にし、session が同じ email の authenticated なら `emailVerified:true` に更新し、`pendingVerificationEmail` を null にして `{ kind: "verified" }`。
- `signOut()`: **常に**ローカル session を guest にして（`removeItem` でも guest の保存でもよい。`getSession` が `guest` を返すこと。corrupted な保存値も消える）`{ kind: "signed_out" }` を返す。`auth.logout === "provider_failure"` でも、`auth.session === "unavailable"` でも同じ（AR-SES-009）。session が変わったときだけ cb を呼ぶ。
- `requestPasswordReset({ email })`: `auth.reset === "unavailable"` → `unavailable`、`ok` → **email が既知でも未知でも**同一の `{ kind: "accepted" }`（`toEqual` で等しい）。user を作らず、DB と session を変えない。同じ呼び出し回数の `sleep` 以外に挙動の差を作らない（SEC-API-027）。
- `completePasswordReset({ context, newPassword })`: `validatePassword(newPassword)` が不合格なら Promise を **reject**（`RangeError`、メッセージに `password policy` を含む）。UI が先に検査する。次に `auth.reset === "unavailable"` → `unavailable`。`context` が `null` / 空文字、または `auth.resetContext === "invalid"` → `{ kind: "invalid_context" }`。それ以外は `{ kind: "updated" }`。password を保存しない。session を変えない。

## 15. 受入との対応（テストファイル）

| ファイル | 内容 |
|---|---|
| `tests/unit/web/auth/password-policy.test.ts` | §3 |
| `tests/unit/web/mock/scenario.test.ts` | §5 |
| `tests/unit/web/mock/db.test.ts` | §7 |
| `tests/unit/web/mock/purpose.test.ts`, `karaoke-buckets.test.ts`, `latency.test.ts` | §4, §6 |
| `tests/unit/web/mock/public-api.test.ts`（seed の公開データも含む） | §8, §9, §13 |
| `tests/unit/web/mock/cart-purchase.test.ts` | §9, §11.1, §11.5（`getPurchaseEligibility`。本人別上限の消費はここで確かめる） |
| `tests/unit/web/mock/review-gaps.test.ts` | §11.1（重複 line）, 静的走査 |
| `tests/unit/web/mock/karaoke-purchase.test.ts` | §11.2、§11.5（KARAOKE の対象。TC-PG-KRK-003-107） |
| `tests/unit/web/mock/checkout-payment.test.ts` | §11.3（key のみの replay を含む）, §11.4（在庫の確保と戻りは保存済み DB の `remaining`、本人別上限の消費は §11.5 の `getPurchaseEligibility` で確かめる。公開 read は本人の消費を反映しない） |
| `tests/unit/web/mock/self-api.test.ts` | §10, §12 |
| `tests/unit/web/mock/mock-auth.test.ts` | §14 |
| `tests/unit/web/ports/ports.test.ts` | §1, §2, §3 の型、`zod` 依存、Hold TTL の不在 |
| `tests/unit/web/ports/eligibility-target-key.test.ts` | §2（`eligibilityTargetKey`。TC-PG-KRK-003-617） |

## 16. 仕様の曖昧さについてテスト担当が決めたこと

1. `CheckoutStart` に `email_unverified` が無い → 未確認 user も `auth_required`。他者・不存在の Order は `state_conflict`（区別しない）。
2. `ProfileUpdate` に認証系の結果が無い → guest / 未確認は `unavailable`。
3. `AuthPort.signUp` / `completePasswordReset` に validation 失敗が無い → `signUp` は `rejected`、`completePasswordReset` の password policy 違反は reject（programmer error）。
4. `confirm_after_recheck` の「初回 read」は `getOrder` の呼び出し回数で数える（時間経過ではない）。React の StrictMode 等で `getOrder` が二重に呼ばれると 1 回で確定して見えるため、S7a の container は mount ごとに 1 回だけ読むこと。
5. `karaokeSales` を scenario に追加した（PG-KRK-001 の販売前 / 終了 / 停止、`not_on_sale` を再現するため）。設計書 §8 の一覧外の追加 switch。
6. Purchase Limit の閲覧者別可否は `API-PUR-ELG-001`（`getPurchaseEligibility`）が正本で、`listEntryOfferings`（`API-PUB-005`）と `resolveCartLines`（`API-PUB-005` / `API-PUB-010` / `API-PUB-011`）は閲覧者に依存しない公開の read である（B4b。`UCR-110-001` は port に残らない）。`startCartPurchase`（`ENTRY_GOODS_PURCHASE` の Order を含む）は `API-PUR-CART-001`。`getOrder` の通知は `API-ORD-003.notification_summary` として正本化された（旧 `notice` は廃止）。
7. `KaraokeSales` には `usage` / 整備時間の数値を持たせない（Hold TTL との混同を避け、時間帯は slot の `usageStart` / `usageEnd` から導く）。
8. 同じ Goods / Entry Offering の重複 line は、`API-PUR-CART-001`（同一 kind + 参照の重複は 400 `VALIDATION_FAILED`）により不正入力として reject する（B4a で変更。以前は入力順に逐次評価して許容していた）。1 件でも不成立なら全体を破棄する（All-or-Nothing、BR-ORD-014 / BR-ORD-017）。
9. Checkout の idempotency replay は user + key のみで判定する（`orderRef` を含めない）。SPEC-110 §18 の `409 IDEMPOTENCY_KEY_REUSED` との差は mock の意図的な単純化で、実 API の検証根拠にしない。
10. **Karaoke の事前判定（B4c）**: mock は Karaoke の Purchase Limit の数値を持たないので、scenario `karaokeHold: "limit"` を本人の上限到達として判定（§11.5）にも使う。Slot の HELD / SOLD / SALES_STOPPED は `SLOT_UNAVAILABLE` で表す（B4a の copy の意味。正本は Slot state と理由の対応を定めていない）。支払い期限は mock に無いので `PAYMENT_WINDOW_TOO_SHORT` は生じない。いずれも DEV-WEB-010 により契約の根拠にしない。（計画書 B4c の項目番号は 9 だが、本書の項目 9 は Checkout の replay なので 10 とした。）
