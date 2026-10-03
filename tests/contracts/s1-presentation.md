# S1 Presentation 契約書（state-mapping / format / copy / 共有型）

テスト担当が定義した、S1 の実装契約である。コーディング担当はここに書かれた export 名・ファイルパス・引数と戻り値の形・固定文言を**そのまま**実装する。テストは `tests/unit/web/presentation/*.test.ts` にあり、この契約に対してのみ書かれている。

- 根拠: `docs/drafts/ui-mock-design.md`（承認済み）の Design §3 / §5 / §9 / §10、SPEC-050 v1.1.0、SPEC-190 DEV-TS-006 / 007 / 010、SPEC-170 TST-DAT-007 / 008。
- 純粋関数のみ。React / DOM / `Date.now()` / `process.env` / ネットワークを使わない。時刻は引数で受ける。
- `apps/web/src/presentation/**` は `features` / `mock` / `api-client` の実装 / `auth` の実装を import しない（DEV-DEP-006）。許可される import は `@off-r39x/domain`、`apps/web/src/api-client/types.ts`（型のみ）、`presentation` 内の相対 import だけである。
- 全 mapper は網羅的 `switch` と `assertNever`（`@off-r39x/domain`）で書く（DEV-TS-010）。実行時に未知の値が来たら、`Error` を投げ、メッセージに `Unexpected value` を含める。複数引数の関数は、**全引数を先に検証**してから結果を決める（片方が有効な値でも、もう片方が未知なら必ず投げる）。
- 「固定」と書いた文言は SPEC-050 が定める文言で、テストが一字一句比較する。「自由」と書いた文言は文言を自由に決めてよいが、非空・テストが指定する不変条件（区別可能性、キーフレーズ）を満たす。
- 表示文言（label / description / message / disabledReason / action label）はすべて `apps/web/src/presentation/copy/ja.ts` の辞書の値から作る。辞書の文字列リーフと完全一致する文字列を mapper が返す（実行時に組み立てる動的文言を除く。動的文言は下記で明記する）。

## 0. ファイル一覧

| パス | export |
|---|---|
| `apps/web/src/api-client/types.ts` | `Ref`, `Money`, `UtcInstant`, `BusinessDateJst`, `SaleAvailability`（型のみ。実行時 export なし） |
| `apps/web/src/presentation/copy/ja.ts` | `copy` |
| `apps/web/src/presentation/format/money.ts` | `formatMoney`, `multiplyMoney`, `sumMoney` |
| `apps/web/src/presentation/format/datetime.ts` | `toBusinessDateJst`, `parseBusinessDateJst`, `jstDayBoundsUtc`, `formatJstDateTime`, `formatJstDate`, `formatJstTime`, `formatJstTimeRange`, `formatBusinessDate`, `bucketStartHourJst`, `formatBucketLabel` |
| `apps/web/src/presentation/state-mapping/order.ts` | `Tone`, `OrderCategory`, `OrderAction`, `OrderPresentation`, `presentOrderState`, `orderActionLabel`, `visibleEntitlements` |
| `apps/web/src/presentation/state-mapping/purpose.ts` | `OrderPurposeIncludes`, `PurposePresentation`, `QrPurpose`, `PurchaseAgainTarget`, `presentPurpose`, `presentQrTitle`, `purchaseAgainTarget` |
| `apps/web/src/presentation/state-mapping/entry-ticket.ts` | `EntryTicketPresentation`, `presentEntryTicket` |
| `apps/web/src/presentation/state-mapping/karaoke.ts` | `SlotPresentation`, `HoldPresentation`, `ReservationTicketPresentation`, `presentSlot`, `presentHold`, `presentReservationTicket` |
| `apps/web/src/presentation/state-mapping/goods.ts` | `GoodsItemPresentation`, `presentGoodsItem` |
| `apps/web/src/presentation/state-mapping/notification.ts` | `NotificationPresentation`, `presentNotification` |
| `apps/web/src/presentation/state-mapping/availability.ts` | `AvailabilityInput`, `AvailabilityPresentation`, `CartRejectionReason`, `RejectionPresentation`, `presentAvailability`, `presentRejectionReason` |

relative import は拡張子なしでも `.ts` 付きでもよい（Vitest と `tests` の `tsc` の両方で解決できること）。`Tone` は `order.ts` で定義し、他の state-mapping は `import type { Tone } from "./order"` する。

## 1. 共有型 `apps/web/src/api-client/types.ts`

SPEC-190 DEV-TS-006（金額は decimal string）、設計書 Design §3。S1 に必要な型だけを置く。後続 slice の型（`Read<T>`, `CartLine`, `CartPurchaseStart` など）は S1 では追加しない。

```ts
// canonical lowercase UUID の参照。brand で他の Ref と混同できなくする。
export type Ref<T extends string> = string & { readonly __ref: T };

// 最小単位の decimal string。DEV-TS-006。currency は ISO 4217 の大文字（S1 は "JPY" のみ対応）。
export type Money = { readonly amount: string; readonly currency: string };

// UTC の instant。`YYYY-MM-DDTHH:mm:ss(.SSS)?Z` 形式の文字列。
export type UtcInstant = string & { readonly __utc: true };

// JST（Asia/Tokyo）の営業日。`YYYY-MM-DD`。
export type BusinessDateJst = string & { readonly __jst: true };

export type SaleAvailability =
  | { kind: "ON_SALE"; maxSelectableQuantity: number | null }
  | { kind: "BEFORE_SALES"; startsAt: UtcInstant }
  | { kind: "SALES_ENDED" }
  | { kind: "SUSPENDED" }
  | { kind: "SOLD_OUT" }
  | { kind: "INSUFFICIENT_QUANTITY"; maxSelectableQuantity: number }
  | { kind: "PURCHASE_LIMIT_EXCEEDED" };
```

## 2. 辞書 `apps/web/src/presentation/copy/ja.ts`

```ts
export const copy = { /* ネストした object。リーフは string か、(...args) => string のテンプレート関数 */ } as const;
```

- キー名は自由。ただし以下を満たす。
  - 名前付き export `copy` を持つ。ネストした plain object で、リーフは `string` または `string` を返す関数である。
  - 文字列リーフは非空で、前後に空白がない。
  - 外部ブランド素材の文言を含まない（`hololive` を大文字小文字を問わず含まない）。`/admin`・`/staff` へのリンク文字列を含まない（SPEC-050 §27）。
  - mapper が返す label 類は、すべて辞書の文字列リーフのどれかと完全一致する（動的文言は個別に明記）。
- Order state の固定文言は §5 を参照する。

## 3. 金額 `apps/web/src/presentation/format/money.ts`（DEV-TS-006 / 007）

`bigint` だけで計算し、`number` / `Number()` / `parseFloat` / `Intl.NumberFormat` を金額に使わない。

```ts
import type { Money } from "../../api-client/types";

/** amount を ¥ 付き 3 桁区切りで返す。JPY のみ対応。 */
export function formatMoney(money: Money): string;
```

- 形式: 通貨記号は円記号 `¥`（U+00A5）で、直後に 3 桁区切り（`,`）の整数。小数点・指数表記は使わない。例: `{amount:"1234", currency:"JPY"}` → `"¥1,234"`、`"0"` → `"¥0"`、`"9007199254740993"` → `"¥9,007,199,254,740,993"`（2^53 超でも lossless）。
- 負数: `"-500"` → `"-¥500"`（符号は記号の前）。
- 不正な amount は `Error` を投げる。許可するのは正規形 `/^(0|-?[1-9][0-9]*)$/` だけである。空文字、`"12.5"`, `"1e3"`, `" 1"`, `"1 "`, `"01"`, `"-0"`, `"+1"`, 全角数字、`"NaN"` はすべて投げる。
- JPY 以外の currency は `Error` を投げ、メッセージに `currency` を含める（大文字小文字を問わない）。

```ts
/** 単価 × 数量（明細小計）。bigint で計算する。 */
export function multiplyMoney(unitPrice: Money, quantity: number): Money;
```

- `quantity` は 1 以上の安全な整数（`Number.isSafeInteger(quantity) && quantity >= 1`）。それ以外（0, 負数, 小数, `NaN`, `Infinity`, 2^53）は `RangeError` を投げる（SPEC-050 §14: 数量の下限は 1）。
- unitPrice の amount の検証は `formatMoney` と同じ。戻り値は `{ amount: <10進文字列>, currency: unitPrice.currency }`。例: `9007199254740993 × 3` → `"27021597764222979"`、`1234567890123456789 × 7` → `"8641975230864197523"`。

```ts
/** 合計。空配列は {amount:"0", currency:"JPY"}。通貨が混在したら Error。 */
export function sumMoney(items: readonly Money[]): Money;
```

## 4. 日時 `apps/web/src/presentation/format/datetime.ts`（TST-DAT-007 / 008）

JST は UTC+9 固定（夏時間なし）。実行環境の `TZ` / ロケール / `Date` のローカル時刻アクセサ（`getHours` など）に依存しない（テストは `process.env.TZ` を変えて検証する）。`Intl` を使う場合も `timeZone: "Asia/Tokyo"` を明示するか、UTC 算術で実装する。

```ts
import type { BusinessDateJst, UtcInstant } from "../../api-client/types";
```

UtcInstant の入力検証: `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/` に一致し、かつ `Date.parse` が有限であること。満たさない値（`"+09:00"` オフセット付き、日付のみ、`"not-a-date"`、月 13、時 25）は `RangeError` を投げ、メッセージに `Invalid UTC instant` を含める。

```ts
/** instant が属する JST の営業日（YYYY-MM-DD）。15:00:00Z で日付が切り替わる（半開区間）。 */
export function toBusinessDateJst(instant: UtcInstant): BusinessDateJst;

/** 実在する暦日の `YYYY-MM-DD` だけを受け付ける。不正なら null（route param 検証用）。 */
export function parseBusinessDateJst(input: string): BusinessDateJst | null;

/** JST 営業日の半開区間 [start, endExclusive) を UTC instant で返す。ミリ秒なしの `YYYY-MM-DDTHH:mm:ssZ`。 */
export function jstDayBoundsUtc(date: BusinessDateJst): { start: UtcInstant; endExclusive: UtcInstant };

/** `YYYY/MM/DD HH:mm`（JST、24 時間表記、ゼロ埋め）。 */
export function formatJstDateTime(instant: UtcInstant): string;
/** `YYYY/MM/DD`（JST）。 */
export function formatJstDate(instant: UtcInstant): string;
/** `HH:mm`（JST）。 */
export function formatJstTime(instant: UtcInstant): string;
/** `HH:mm-HH:mm`（JST。利用開始 / 利用終了。区切りは ASCII ハイフン）。 */
export function formatJstTimeRange(start: UtcInstant, end: UtcInstant): string;
/** 営業日の表示。`YYYY/MM/DD(曜)`。曜は 日 月 火 水 木 金 土。例: `2027-01-01` → `2027/01/01(金)`。 */
export function formatBusinessDate(date: BusinessDateJst): string;

/** 1 時間 bucket の開始時（JST の時、0〜23）。`10:00 <= usage_start < 11:00` は 10（SPEC-050 §13.2）。 */
export function bucketStartHourJst(instant: UtcInstant): number;
/** bucket の表示。`HH:00-HH:00`。23 時台の終端は `24:00`。例: JST 10:xx → `10:00-11:00`、23:xx → `23:00-24:00`、00:xx → `00:00-01:00`。 */
export function formatBucketLabel(instant: UtcInstant): string;
```

- `parseBusinessDateJst` は入力を trim せず、`2027-1-5`・`20270115`・`2027-02-29`（非閏年）・`2027-13-01`・`2027-00-10`・`2027-01-32`・時刻付き・空文字・前後空白をすべて `null` にする。`2028-02-29`（閏年）は有効。
- `formatBusinessDate` の入力は `parseBusinessDateJst` を通過した値を想定する。不正な形式は `RangeError`（メッセージに `Invalid business date`）。

## 5. Order `apps/web/src/presentation/state-mapping/order.ts`

SPEC-050 §16.4（label / action）、§20.1（category / 有効権利表示）、§16.3、INV-010-07。

```ts
import type { OrderState } from "@off-r39x/domain";

export type Tone = "success" | "pending" | "failure" | "neutral" | "review";

export type OrderCategory =
  | "pending_retryable" // PREPARED
  | "pending" // AWAITING_PAYMENT
  | "success" // CONFIRMED
  | "terminal_failure" // PAYMENT_FAILED
  | "terminal" // CANCELED, EXPIRED
  | "recovery_pending"; // REVIEW_REQUIRED

export type OrderAction =
  | "retry_checkout" // 支払い開始を再試行（同一 Order）
  | "recheck_status" // 状態を再確認（新 Order を作らない）
  | "view_purchase" // 購入内容を見る
  | "view_entitlements" // Ticket / Reservation / Goods を見る
  | "purchase_again"; // もう一度購入する（新しい購入）

export type OrderPresentation = {
  readonly label: string;
  readonly description: string; // 自由。非空
  readonly category: OrderCategory;
  readonly tone: Tone;
  readonly showsEntitlements: boolean;
  readonly actions: readonly OrderAction[];
};

export function presentOrderState(state: OrderState): OrderPresentation;
export function orderActionLabel(action: OrderAction): string;
export function visibleEntitlements<T>(state: OrderState, entitlements: T): T | null;
```

`presentOrderState` の表（固定）:

| state | label（固定。§16.4 のセル文字列そのまま） | category | tone | showsEntitlements | actions（この順） |
|---|---|---|---|---|---|
| `PREPARED` | `支払い手続き未開始 / 準備済み` | `pending_retryable` | `pending` | false | `["retry_checkout"]` |
| `AWAITING_PAYMENT` | `支払い結果を確認中` | `pending` | `pending` | false | `["recheck_status"]` |
| `CONFIRMED` | `購入確定` | `success` | `success` | **true** | `["view_purchase", "view_entitlements"]` |
| `PAYMENT_FAILED` | `支払い不成立` | `terminal_failure` | `failure` | false | `["purchase_again"]` |
| `CANCELED` | `購入手続き取消済み` | `terminal` | `neutral` | false | `["purchase_again"]` |
| `EXPIRED` | `購入手続き失効` | `terminal` | `neutral` | false | `["purchase_again"]` |
| `REVIEW_REQUIRED` | `購入状態を確認中` | `recovery_pending` | `review` | false | `["recheck_status"]` |

- 7 状態の label は互いに異なる。category は §20.1 のとおり 6 種類（CANCELED と EXPIRED が同じ `terminal`）。
- `showsEntitlements` は `CONFIRMED` のときだけ true（INV-010-07）。
- `AWAITING_PAYMENT` と `REVIEW_REQUIRED` は `purchase_again` / `retry_checkout` / `view_entitlements` を含まない（新権利生成につながる retry を出さない）。
- `description` は §20.1「利用者向け意味」に対応する自由文言。

`orderActionLabel`（固定）:

| action | label |
|---|---|
| `retry_checkout` | `支払い開始を再試行`（§16.6） |
| `recheck_status` | `状態を再確認` |
| `view_purchase` | `購入内容を見る` |
| `view_entitlements` | `Ticket / Reservation / Goodsを見る` |
| `purchase_again` | `もう一度購入する` |

`visibleEntitlements(state, entitlements)`: `presentOrderState(state).showsEntitlements` が true のときだけ `entitlements` をそのまま（同一参照）返し、それ以外は `null` を返す。port が権利を返しても UI で再度絞り込むための多重防御（設計 Design §5）。複合 Order（`ENTRY_GOODS_PURCHASE`）でも、`CONFIRMED` 以外では Entry Ticket / Goods のどちらも返さない（BR-ORD-015）。

## 6. Purpose / QR title `apps/web/src/presentation/state-mapping/purpose.ts`

SPEC-050 §16.4 末尾（再購入）、§16.5、§18.3、§18.7、§18.10、BR-ORD-013。

```ts
import type { OrderPurpose } from "@off-r39x/domain";

export type OrderPurposeIncludes = "ENTRY_TICKET" | "GOODS" | "KARAOKE";

export type PurposePresentation = {
  readonly label: string;
  readonly includes: readonly OrderPurposeIncludes[];
  readonly isComposite: boolean;
};

export function presentPurpose(purpose: OrderPurpose): PurposePresentation;

export type QrPurpose = "ENTRY" | "KARAOKE";
export function presentQrTitle(purpose: QrPurpose): string;

export type PurchaseAgainTarget = "cart" | "karaoke";
export function purchaseAgainTarget(purpose: OrderPurpose): PurchaseAgainTarget;
```

`presentPurpose`:

| purpose | includes（この順） | isComposite | label の制約（自由文言） |
|---|---|---|---|
| `ENTRY_TICKET_PURCHASE` | `["ENTRY_TICKET"]` | false | `Entry` を含み `Goods` を含まない |
| `KARAOKE_PURCHASE` | `["KARAOKE"]` | false | `Karaoke` を含む |
| `GOODS_PURCHASE` | `["GOODS"]` | false | `Goods` を含み `Entry` を含まない |
| `ENTRY_GOODS_PURCHASE` | `["ENTRY_TICKET", "GOODS"]` | true | `Entry` と `Goods` の両方を含む（複合 Order の文言） |

4 つの label はすべて異なる。

`presentQrTitle`（固定。§18.7 / §18.10。権利種別をテキストで常時識別できる）:

- `ENTRY` → `Entry Ticket / 入場受付用`
- `KARAOKE` → `Karaoke Ticket / Karaoke受付用`

`purchaseAgainTarget`（§16.4 を採用。設計書 OI-6）: `KARAOKE_PURCHASE` → `"karaoke"`（新 Slot / Hold 取得から）、それ以外 3 つ → `"cart"`（Item を Cart へ再投入して `PG-CRT-001`）。

## 7. Entry Ticket `apps/web/src/presentation/state-mapping/entry-ticket.ts`

SPEC-050 §18.6, §18.7, §20.2, INV-010-05, SEC-QR-012。

```ts
import type { EntryTicketState } from "@off-r39x/domain";
import type { Tone } from "./order";

export type EntryTicketPresentation = {
  readonly label: string;
  readonly description: string; // 自由。非空
  readonly tone: Tone;
  readonly qrPresentable: boolean;
  readonly disabledReason: string | null; // qrPresentable が false のときだけ非 null かつ非空（§25）
};

export function presentEntryTicket(state: EntryTicketState): EntryTicketPresentation;
```

| state | label（固定。§20.2） | qrPresentable | tone |
|---|---|---|---|
| `VALID` | `利用可能` | **true** | `success` |
| `USED` | `使用済み` | false | `success` 以外 |
| `CANCELED` | `取消済み` | false | `success` 以外 |
| `EXPIRED` | `失効済み` | false | `success` 以外 |

- QR を提示してよいのは `VALID` だけ。`disabledReason` は `VALID` で `null`、他 3 状態で非空文字列。
- 4 つの label は互いに異なる。

## 8. Karaoke `apps/web/src/presentation/state-mapping/karaoke.ts`

SPEC-050 §13.2, §13.3, §18.8〜§18.10, §20.3。

```ts
import type { KaraokeHoldState, KaraokeSlotState, KaraokeTicketState, ReservationState } from "@off-r39x/domain";
import type { Tone } from "./order";

export type SlotPresentation = {
  readonly label: string;
  readonly description: string; // 自由。非空
  readonly tone: Tone;
  readonly selectable: boolean;
};
export function presentSlot(state: KaraokeSlotState): SlotPresentation;

export type HoldPresentation = {
  readonly label: string;
  readonly description: string; // 自由。非空
  readonly tone: Tone;
};
export function presentHold(state: KaraokeHoldState): HoldPresentation;

export type ReservationTicketPresentation = {
  readonly reservationLabel: string;
  readonly ticketLabel: string;
  readonly primaryLabel: string;
  readonly tone: Tone;
  readonly qrPresentable: boolean;
  readonly disabledReason: string | null;
};
export function presentReservationTicket(
  reservation: ReservationState,
  ticket: KaraokeTicketState,
): ReservationTicketPresentation;
```

`presentSlot`（`selectable` は AVAILABLE だけ true。呼び出し側は「販売条件が成立している AVAILABLE」だけを渡す）:

| state | label | selectable |
|---|---|---|
| `AVAILABLE` | `選択可能`（固定。§13.2） | true |
| `HELD` | 自由。`確保中` を含む（§13.2「現在確保中」等） | false |
| `SOLD` | `販売済み`（固定） | false |
| `SALES_STOPPED` | `販売停止`（固定） | false |

4 つの label は互いに異なる。tone は `AVAILABLE` が `success`、他は `success` 以外。

`presentHold`（§20.3）:

| state | label | description の要点 |
|---|---|---|
| `ACTIVE` | 自由。`購入試行中` を含む | Reservation 確定ではない |
| `COMMITTED` | 自由。`確定購入` を含む | 確定購入に使用済み |
| `RELEASED` | 自由。`終了` を含む | 当該確保は終了。再利用不可 |
| `EXPIRED` | 自由。`期限切れ` を含む | 確保期限切れ。新 Hold が必要 |

4 つの label は互いに異なる。どの label も `予約確定` を含まない。

`presentReservationTicket`:

- `reservationLabel`（固定。§20.3）: `CONFIRMED` → `予約確定`、`CANCELED` → `予約取消済み`。
- `ticketLabel`（固定。§20.3）: `VALID` → `受付利用可能`、`USED` → `使用済み`、`CANCELED` → `取消済み`、`EXPIRED` → `失効済み`。
- `qrPresentable`: reservation が `CONFIRMED` かつ ticket が `VALID` のときだけ true（§18.9）。
- `primaryLabel`（QR 画面・詳細の主表示。固定）:
  1. reservation が `CANCELED` → `取消済み`（ticket の状態に関係なく。Ticket を受付可能として表示しない）。
  2. それ以外は ticket に従う: `VALID` → `受付利用可能`、`USED` → `使用済み`、`CANCELED` → `取消済み`、`EXPIRED` → `失効済み`。
- `disabledReason`: `qrPresentable` が true なら `null`、false なら非空文字列。
- `tone`: `qrPresentable` が true のとき `success`、それ以外は `success` 以外。
- 8 通りの組み合わせすべてで、`qrPresentable` は上記の 1 通りだけが true。

## 9. Goods `apps/web/src/presentation/state-mapping/goods.ts`

SPEC-050 §18.11, §18.12, §20.4, INV-010-07 / 10。

```ts
import type { GoodsHandoffState, GoodsItemState } from "@off-r39x/domain";
import type { Tone } from "./order";

export type GoodsItemPresentation = {
  readonly label: string; // 主表示（item と handoff の組み合わせ）
  readonly itemLabel: string;
  readonly handoffLabel: string;
  readonly description: string; // 自由。非空
  readonly tone: Tone;
  readonly receivable: boolean;
};

export function presentGoodsItem(item: GoodsItemState, handoff: GoodsHandoffState): GoodsItemPresentation;
```

- `itemLabel`（固定。§20.4）: `PENDING_PAYMENT` → `支払未確定・受け取り不可`、`FULFILLABLE` → `支払確定済み`、`CANCELED` → `取消済み・受け取り不可`。
- `handoffLabel`（固定。§20.4）: `PENDING` → `未受け渡し`、`COMPLETED` → `受け渡し済み`、`VOID` → `受け渡し対象外`。
- 主表示 `label` と `receivable` は次の優先順位で決める（先に当てはまったもの）。

| 優先 | 条件 | label（固定。§18.11） | receivable |
|---|---|---|---|
| 1 | item が `CANCELED`、または handoff が `VOID` | `取消済み・受け取り不可` | false |
| 2 | item が `PENDING_PAYMENT` | `支払未確定・受け取り不可` | false |
| 3 | item `FULFILLABLE` かつ handoff `COMPLETED` | `受け渡し済み` | false（二回目の受け取り不可） |
| 4 | item `FULFILLABLE` かつ handoff `PENDING` | `会場受け取り待ち` | **true** |

- `receivable` が true になるのは `FULFILLABLE` + `PENDING` の組み合わせだけ（3 × 3 = 9 通りで 1 通り）。
- `tone`: `receivable` が true のとき `pending`（受け取り待ち）。`受け渡し済み` は `success`。取消系は `neutral`。支払未確定は `pending`。この tone 割り当ては tone が 5 種のいずれかであることだけをテストする（自由）。ただし優先 1 と 2 の tone は `success` 以外。
- 9 通りの組み合わせのうち、`label` は上記 4 種類のどれかになる。

## 10. Notification `apps/web/src/presentation/state-mapping/notification.ts`

SPEC-050 §16.7, §20.5。

```ts
import type { NotificationState } from "@off-r39x/domain";
import type { Tone } from "./order";

export type NotificationPresentation = {
  readonly label: string;
  readonly message: string;
  readonly tone: Tone;
  readonly blocking: false; // 常に非阻害。購入成功表示を覆わない
  readonly keepsPurchaseSuccess: true; // 常に購入状態を変えない
  readonly actions: readonly []; // 常に空。Business Transaction の再実行 Button を出さない
};

/** `CANCELED`（通知不要化）は表示しないので null。 */
export function presentNotification(state: NotificationState): NotificationPresentation | null;
```

| state | 戻り値 |
|---|---|
| `PENDING` | label は自由で `確認Email` を含む。message は自由で非空 |
| `SENT` | label は自由で `Email` を含む。補助情報。message は自由で非空 |
| `FAILED_RETRYABLE` | message は固定 `購入は確定済みです。確認Emailの送信に失敗または遅延しています。購入内容はこの画面とMypageで確認できます`（§16.7）。tone は `failure` 以外。message に `再試行` / `再送` / `もう一度購入` / `やり直` を含まない |
| `CANCELED` | `null` |

- `PENDING` / `SENT` / `FAILED_RETRYABLE` の 3 つの label は互いに異なる。
- `actions` は常に空配列、`blocking` は常に `false`、`keepsPurchaseSuccess` は常に `true`。

## 11. 販売可否 `apps/web/src/presentation/state-mapping/availability.ts`

SPEC-050 §10（Entry 販売条件表）、§14（Cart 購入不可理由表）、FR-CRT-005、§21。

```ts
import type { SaleAvailability } from "../../api-client/types";
import type { Tone } from "./order";

export type AvailabilityInput =
  | SaleAvailability
  | { kind: "not_public" } // 公開されていない Item（Cart 解決結果）
  | { kind: "unavailable" }; // 現在状態を取得できない

export type AvailabilityPresentation = {
  readonly label: string;
  readonly description: string; // 自由。非空。動的値を含んでよい（下記）
  readonly tone: Tone;
  readonly purchasable: boolean;
};

export function presentAvailability(input: AvailabilityInput): AvailabilityPresentation;
```

| input.kind | label | purchasable | description の要件 |
|---|---|---|---|
| `ON_SALE` | `販売中`（固定） | **true** | 非空 |
| `BEFORE_SALES` | `販売開始前`（固定） | false | `formatJstDateTime(startsAt)` の文字列を含む（例 `2027/01/15 09:30`） |
| `SALES_ENDED` | `販売終了`（固定） | false | 非空 |
| `SUSPENDED` | `販売停止`（固定） | false | 非空 |
| `SOLD_OUT` | `売り切れ`（固定） | false | 非空 |
| `INSUFFICIENT_QUANTITY` | `数量不足`（固定） | false | `数量` を含み（数量変更を促す）、`maxSelectableQuantity` の 10 進表記を含む |
| `PURCHASE_LIMIT_EXCEEDED` | `購入上限により購入不可`（固定） | false | 非空 |
| `not_public` | `現在取り扱っていません`（固定） | false | 非空 |
| `unavailable` | 自由。`状態を確認` を含む | false | 非空。購入可能と読める文言を含まない（`購入できます` を含まない） |

- 9 種の label はすべて互いに異なる（FR-CRT-005: 理由を区別する）。
- `purchasable` が true になるのは `ON_SALE` だけ。`ON_SALE` の tone は `success`、他は `success` 以外。
- `label` は辞書の文字列リーフと完全一致する。`description` のうち `BEFORE_SALES` と `INSUFFICIENT_QUANTITY` は動的値を含むため、辞書のテンプレート関数から組み立てる（辞書の文字列リーフとの完全一致は要求しない）。他の description は辞書の文字列リーフと完全一致する。
- 未知の `kind` は `Unexpected value` で投げる。

```ts
export type CartRejectionReason =
  | "BEFORE_SALES"
  | "SALES_ENDED"
  | "SUSPENDED"
  | "SOLD_OUT"
  | "INSUFFICIENT_QUANTITY"
  | "PURCHASE_LIMIT_EXCEEDED"
  | "ALLOCATION_CONFLICT"
  | "NOT_PUBLIC";

export type RejectionPresentation = {
  readonly label: string;
  readonly description: string; // 自由。非空。辞書の文字列リーフと完全一致
};

export function presentRejectionReason(reason: CartRejectionReason): RejectionPresentation;
```

購入開始が `rejected` のとき Item ごとに示す理由（SPEC-050 §14 Purchase start result、設計 Design §3 の `CartPurchaseStart.rejections[].reason`）。

- `BEFORE_SALES` / `SALES_ENDED` / `SUSPENDED` / `SOLD_OUT` / `INSUFFICIENT_QUANTITY` / `PURCHASE_LIMIT_EXCEEDED` の label は、`presentAvailability` の対応する kind の label と**同じ文字列**。`NOT_PUBLIC` の label は `presentAvailability({kind:"not_public"})` の label と同じ。
- `ALLOCATION_CONFLICT` の label は自由（`確保` を含む。他の 7 つと異なる）。
- 8 つの label はすべて互いに異なる。未知の値は `Unexpected value` で投げる。
