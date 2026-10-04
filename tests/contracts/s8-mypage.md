# S8 Mypage 契約書（PG-MYP-001〜012 / PG-XFN-003 / QR ページ）

テスト担当が定義した S8 の実装契約である。コーディング担当は、ここに書かれたファイルパス・export 名・シグネチャ・文言・DOM 構造をそのまま実装する。対応するテスト:

- Vitest（node）: `tests/unit/web/mypage/*.test.ts`
- Playwright（mock mode、`desktop-chromium` と `mobile-chromium`）: `tests/e2e/mypage-*.spec.ts`
- ハーネス: `tests/harness/browser/mypage.ts`（`purchase.ts` / `auth.ts` / `hydration.ts` / `cart.ts` を再利用）

根拠: `docs/drafts/ui-mock-design.md`（承認済み。Design §1 route 表、§3 SelfApi、§4 状態モデル、§5 Domain State→UI 対応、§6 Ownership / QR、§7 Continuation、S8 行、Test plan E2E 14〜20 / 22）、SPEC-050 v1.1.0 §17 / §18.1〜18.12（PG-MYP-001〜012）/ §19.2（PG-XFN-003）/ §20.1〜20.5 / §21 / §22 / §23 / §24.2 / §25 / §26.2 / §31（14〜20, 22, 23 と 3 の Mypage 部分）、SPEC-030 BR-ORD-015 / INV-010-05 / INV-010-07 / INV-010-08、SPEC-110 §22（他者所有と不存在を同じ結果にする）、SPEC-140 SEC-WEB-009 / SEC-QR-012 / SEC-QR-013、SPEC-060 AR-SES-007 / AR-AZ-011 / AR-CONT-001〜003、SPEC-190 DEV-WEB-001〜013、SPEC-170 TST-UNT-004 / TST-E2E-003 / TST-E2E-004。UI mock suite（補助 suite）であり G8 でも API / DB / Provider coverage でもない。manifest では `critical:false`、`api_operation_ids` / `db_constraint_names` は空。S1〜S7b の契約は**拡張のみ**（既存 export の名前・シグネチャは変えない）。**例外は §10 に列挙した S6 placeholder の置き換えだけ**である。

## 0. 範囲

- 含む: `/mypage`（PG-MYP-001）、`/mypage/profile`（002）、`/mypage/orders`（003）、`/mypage/orders/{orderRef}`（004）、`/mypage/entry-tickets`（005）、`/mypage/entry-tickets/{ticketRef}`（006）、`/mypage/entry-tickets/{ticketRef}/qr`（007）、`/mypage/karaoke`（008）、`/mypage/karaoke/{reservationRef}`（009）、`/mypage/karaoke/{reservationRef}/qr`（010）、`/mypage/goods`（011）、`/mypage/goods/{goodsItemRef}`（012）、Mypage ローカルナビゲーション（SPEC-050 §17.2）、PG-XFN-003（`AccessDeniedView`。S7a の部品を再利用）、QR 表示部品（mock 用の合成プレースホルダ）。
- **mock backend / port への追加は不要**。S2 の `createMockApi`（`self.getProfile` / `updateProfile` / `listOrders` / `getOrder` / `listEntryTickets` / `getEntryTicket` / `getEntryQr` / `listReservations` / `getReservation` / `getKaraokeQr` / `listGoodsItems` / `getGoodsItem`）、`ApiPort` の型、seed、scenario はすべて実装済みで、`tests/unit/web/mock/self-api.test.ts` ほかが検証している。coder は `apps/web/src/mock/backend/**` と `src/api-client/{port,types}.ts` を変更しない。
- **QR は合成プレースホルダだけ**（SEC-QR-012 / 013、AGENTS.md §3）。実 QR token・raw QR は存在しない。port の `mockMatrixSeed`（`mock-seed-<数字>`）は**描画の入力にだけ**使い、DOM のテキスト・属性（`data-*` / `aria-*` / `title` / `alt` / class 名 / `id`）・URL・storage・console のどこにも**文字列として出さない**。QR ページの URL に token / seed を載せない（path は ref のみ）。
- Order 詳細（PG-MYP-004）は S7a の `OrderOutcome`（`features/purchase/order-outcome.tsx`）と `buildPurchaseStatusModel` を共有する（§5）。

共通の約束（S4〜S7b の約束を引き継ぐ）:

- 文言は `apps/web/src/presentation/copy/ja.ts` の `copy` に集める。S8 の新規ファイルに**日本語の直書き・`¥` の直書き・色の直書きを置かない**。金額は `formatMoney`、日時は `format/datetime.ts`（JST）。
- page.tsx は Server Component の薄い殻（`metadata` と route param の検証だけ。async `params` を `await`）。データ取得は `"use client"` の container が mount 後（`useEffect`）に `useApi()` 経由で行う。`features/**` から `mock/**` を import しない。
- 価格・状態・可否の権威は port の戻り値だけ。URL・DOM の値を権威にしない（DEV-WEB-009）。
- `console.*`、`localStorage` / `sessionStorage` の直接参照、`dangerouslySetInnerHTML` を S8 の新規ファイルで使わない。
- `h1` は 1 つだけ。見出し level を飛ばさない。Order / Ticket / Reservation の ref（UUID）・内部 ID を画面の本文に出さない（URL の path は可）。
- 状態は常にテキストで示す（tone は色だけを決める。SPEC-050 §25）。

## 1. ファイル一覧

| パス | 種別 | export |
|---|---|---|
| `apps/web/src/config/mypage-routes.ts` | 純粋（react / next を import しない。型 import のみ） | `parseTicketRef`, `parseReservationRef`, `parseGoodsItemRef`, `MYPAGE_PATHS`, `MypageNavKey`, `MYPAGE_NAV_KEYS`, `entryQrHref`, `reservationQrHref`, `currentNavKey` |
| `apps/web/src/features/mypage/order-list-model.ts` | 純粋 | `OrderListRow`, `buildOrderListModel` |
| `apps/web/src/features/mypage/order-detail-model.ts` | 純粋 | `buildMypageOrderDetailModel` |
| `apps/web/src/features/mypage/entry-ticket-model.ts` | 純粋 | `EntryTicketRow`, `buildEntryTicketListModel`, `EntryTicketDetailModel`, `buildEntryTicketDetailModel` |
| `apps/web/src/features/mypage/reservation-model.ts` | 純粋 | `ReservationRow`, `buildReservationListModel`, `ReservationDetailModel`, `buildReservationDetailModel` |
| `apps/web/src/features/mypage/goods-item-model.ts` | 純粋 | `GoodsItemRow`, `buildGoodsItemListModel`, `GoodsItemDetailModel`, `buildGoodsItemDetailModel` |
| `apps/web/src/features/mypage/qr-model.ts` | 純粋 | `QrPageModel`, `buildEntryQrModel`, `buildKaraokeQrModel` |
| `apps/web/src/features/mypage/profile-model.ts` | 純粋 | `ProfileModel`, `buildProfileModel`, `ProfileSaveStep`, `interpretProfileSave` |
| `apps/web/src/features/mypage/overview-model.ts` | 純粋 | `OverviewInput`, `MypageOverviewModel`, `buildMypageOverviewModel` |
| `apps/web/src/features/mypage/mypage-nav.tsx` | client view | `MypageNav` |
| `apps/web/src/features/mypage/mypage-overview-page.tsx` | client container | `MypageOverviewPage` |
| `apps/web/src/features/mypage/profile-page.tsx` | client container | `ProfilePage` |
| `apps/web/src/features/mypage/order-list-page.tsx` | client container | `MypageOrderListPage` |
| `apps/web/src/features/mypage/order-detail-page.tsx` | client container | `MypageOrderDetailPage`（props `{ orderRef: Ref<"order"> }`） |
| `apps/web/src/features/mypage/entry-ticket-list-page.tsx` | client container | `EntryTicketListPage` |
| `apps/web/src/features/mypage/entry-ticket-detail-page.tsx` | client container | `EntryTicketDetailPage`（props `{ ticketRef }`） |
| `apps/web/src/features/mypage/entry-qr-page.tsx` | client container | `EntryQrPage`（props `{ ticketRef }`） |
| `apps/web/src/features/mypage/reservation-list-page.tsx` | client container | `ReservationListPage` |
| `apps/web/src/features/mypage/reservation-detail-page.tsx` | client container | `ReservationDetailPage`（props `{ reservationRef }`） |
| `apps/web/src/features/mypage/karaoke-qr-page.tsx` | client container | `KaraokeQrPage`（props `{ reservationRef }`） |
| `apps/web/src/features/mypage/goods-item-list-page.tsx` | client container | `GoodsItemListPage` |
| `apps/web/src/features/mypage/goods-item-detail-page.tsx` | client container | `GoodsItemDetailPage`（props `{ goodsItemRef }`） |
| `apps/web/src/presentation/components/qr-placeholder.tsx` | 純粋な表示部品 | `QrPlaceholder`（props `{ matrixSeed: string; label: string }`） |
| `apps/web/app/(self)/mypage/layout.tsx` | route layout（Server Component の薄い殻） | `MypageNav` + `children` |
| `apps/web/app/(self)/mypage/page.tsx` | route（**S6 placeholder の置き換え**） | `metadata.title = copy.mypage.pageTitle`、`<MypageOverviewPage />` |
| `apps/web/app/(self)/mypage/profile/page.tsx` | route | `copy.mypage.profile.pageTitle`、`<ProfilePage />` |
| `apps/web/app/(self)/mypage/orders/page.tsx` | route | `copy.mypage.orders.pageTitle` |
| `apps/web/app/(self)/mypage/orders/[orderRef]/page.tsx` | route | `copy.mypage.orders.detail.pageTitle`。`parseOrderRef`（S7a）が null なら `AccessDeniedView`（§8） |
| `apps/web/app/(self)/mypage/entry-tickets/page.tsx` | route | `copy.mypage.entryTickets.pageTitle` |
| `apps/web/app/(self)/mypage/entry-tickets/[ticketRef]/page.tsx` | route | `copy.mypage.entryTickets.detail.pageTitle`。`parseTicketRef` が null なら `AccessDeniedView` |
| `apps/web/app/(self)/mypage/entry-tickets/[ticketRef]/qr/page.tsx` | route | `metadata.title = copy.qr.ENTRY` |
| `apps/web/app/(self)/mypage/karaoke/page.tsx` | route | `copy.mypage.reservations.pageTitle` |
| `apps/web/app/(self)/mypage/karaoke/[reservationRef]/page.tsx` | route | `copy.mypage.reservations.detail.pageTitle`。`parseReservationRef` が null なら `AccessDeniedView` |
| `apps/web/app/(self)/mypage/karaoke/[reservationRef]/qr/page.tsx` | route | `metadata.title = copy.qr.KARAOKE` |
| `apps/web/app/(self)/mypage/goods/page.tsx` | route | `copy.mypage.goodsItems.pageTitle` |
| `apps/web/app/(self)/mypage/goods/[goodsItemRef]/page.tsx` | route | `copy.mypage.goodsItems.detail.pageTitle`。`parseGoodsItemRef` が null なら `AccessDeniedView` |

- title は root layout の template（`%s | SITE_NAME`）に従う（`copy.pageTitle` へは足さない）。
- 全 route は `(self)/layout.tsx`（S6 の AuthGate）の配下。AuthGate は**変更しない**。QR ページは Continuation の key を持たない（S6 の設計どおり。Guest が QR ページを開くと `/account/login?continue=mypage` になり、Login 後は `/mypage` へ戻る。QR を戻り先にしない）。
- `next.config.ts` の no-store（`/mypage/:path*`）はそのまま効く（S0）。変更しない。
- 既存の再利用: `mypageOrderHref` / `entryTicketHref` / `reservationHref` / `goodsItemHref` / `parseOrderRef`（S7a）、`buildPurchaseStatusModel` / `OrderOutcome`（S7a）、`presentOrderState` / `presentPurpose` / `presentEntryTicket` / `presentReservationTicket` / `presentGoodsItem`（S1）、`toListState` / `Loadable` / `settleRead` / `PageState` / `StatusBadge` / `SectionHeading` / `ExternalLink` / `AccessDeniedView` / `safeExternalHref`。

## 2. 文言 `copy`（`ja.ts` に追加・変更。既存 key は変えない。**`copy.mypage.protectedMarker` は削除**する）

```ts
accessDenied: {
  // 既存 title / description / mypageLink / ordersLink に加えて
  entryTicketsLink: "Entry Ticket一覧へ戻る",
  reservationsLink: "Karaoke予約一覧へ戻る",
  goodsItemsLink: "Goods購入一覧へ戻る",
},
mypage: {
  pageTitle: "マイページ",
  heading: "マイページ",
  nav: {
    label: "マイページ内メニュー",
    toggle: "マイページのメニュー",
    items: {
      overview: "マイページ トップ",
      profile: "プロフィール",
      orders: "注文履歴",
      entryTickets: "Entry Ticket一覧",
      reservations: "Karaoke予約一覧",
      goodsItems: "Goods購入一覧",
    },
  },
  overview: {
    profileHeading: "アカウント情報",
    profileSubject: "アカウント情報",
    emailLabel: "メールアドレス",
    displayNameLabel: "表示名",
    profileLink: "プロフィールを見る",
    pendingHeading: "確定前の購入手続き",
    pendingSubject: "購入手続き",
    pendingEmpty: "確定前の購入手続きはありません",
    latestHeading: "最新の注文",
    latestSubject: "最新の注文",
    latestEmpty: "注文はまだありません",
    ordersLink: "注文履歴を見る",
    ticketsHeading: "Entry Ticket",
    ticketsSubject: "Entry Ticket",
    ticketsSummary: (valid: number, total: number): string => `利用可能 ${valid}枚 / 全 ${total}枚`,
    ticketsEmpty: "Entry Ticketはありません",
    ticketsLink: "Entry Ticket一覧を見る",
    karaokeHeading: "これからのKaraoke予約",
    karaokeSubject: "Karaoke予約",
    karaokeEmpty: "予定されているKaraoke予約はありません",
    karaokeLink: "Karaoke予約一覧を見る",
    goodsHeading: "Goodsの受け取り",
    goodsSubject: "Goods",
    goodsSummary: (count: number): string => `会場受け取り待ち ${count}件`,
    goodsEmpty: "会場受け取り待ちのGoodsはありません",
    goodsLink: "Goods購入一覧を見る",
  },
  profile: {
    pageTitle: "プロフィール",
    heading: "プロフィール",
    subject: "プロフィール",
    emailLabel: "メールアドレス",
    emailNote: "ログインに使うメールアドレスです。この画面では変更できません",
    displayNameLabel: "表示名",
    save: "保存する",
    status: { dirty: "未保存の変更があります", saving: "保存しています", saved: "表示名を保存しました" },
    error: {
      required: "表示名を入力してください",
      unavailable: "表示名を保存できませんでした。時間をおいて、もう一度お試しください",
    },
    passwordNote: "パスワードの変更は、パスワード再設定の手続きで行います",
    passwordReset: "パスワードの再設定へ",
  },
  orders: {
    pageTitle: "注文履歴",
    heading: "注文履歴",
    subject: "注文履歴",
    empty: "注文はありません",
    itemsLabel: "購入対象",
    detailLink: (dateTimeText: string): string => `${dateTimeText}の注文を見る`,
    detail: {
      pageTitle: "注文の詳細",
      heading: "注文の詳細",
      subject: "注文の詳細",
      backToList: "注文履歴へ戻る",
    },
  },
  entryTickets: {
    pageTitle: "Entry Ticket一覧",
    heading: "Entry Ticket一覧",
    subject: "Entry Ticket一覧",
    empty: "Entry Ticketはありません",
    stateLabel: "Ticketの状態",
    detailLink: (name: string): string => `${name}のTicketを見る`,
    orderLink: "対応する購入を見る",
    detail: {
      pageTitle: "Entry Ticketの詳細",
      heading: "Entry Ticketの詳細",
      subject: "Entry Ticket情報",
      infoHeading: "Ticketの情報",
      kindLabel: "Ticketの種別",
      stateLabel: "Ticketの状態",
      issuedAtLabel: "発行日時",
      usableLabel: "入場受付での利用",
      usable: "入場受付に利用できます",
      notUsable: "入場受付には利用できません",
      qrLink: "QRを表示する",
      backToList: "Entry Ticket一覧へ戻る",
    },
  },
  reservations: {
    pageTitle: "Karaoke予約一覧",
    heading: "Karaoke予約一覧",
    subject: "Karaoke予約一覧",
    empty: "Karaoke予約はありません",
    dateLabel: "対象日",
    timeLabel: "利用時刻",
    reservationStateLabel: "予約の状態",
    ticketStateLabel: "Ticketの状態",
    detailLink: (dateText: string, timeText: string): string =>
      `${dateText} ${timeText}のKaraoke予約を見る`,
    orderLink: "対応する購入を見る",
    detail: {
      pageTitle: "Karaoke予約の詳細",
      heading: "Karaoke予約の詳細",
      subject: "Karaoke予約情報",
      infoHeading: "予約の情報",
      startLabel: "利用開始時刻",
      endLabel: "利用終了時刻",
      qrLink: "QRを表示する",
      backToList: "Karaoke予約一覧へ戻る",
    },
  },
  goodsItems: {
    pageTitle: "Goods購入一覧",
    heading: "Goods購入一覧",
    subject: "Goods購入一覧",
    empty: "Goodsの購入はありません",
    itemStateLabel: "購入の状態",
    handoffStateLabel: "受け渡しの状態",
    orderStateLabel: "注文の状態",
    detailLink: (name: string): string => `${name}の購入内容を見る`,
    orderLink: "対応する購入を見る",
    detail: {
      pageTitle: "Goodsの詳細",
      heading: "Goodsの詳細",
      subject: "Goods購入情報",
      infoHeading: "購入内容",
      nameLabel: "商品名",
      noSecondHandoff: "二回目の受け取りはできません",
      backToList: "Goods購入一覧へ戻る",
    },
  },
  qr: {
    mockNotice: "モック表示：実際のQRではありません",
    imageLabel: {
      ENTRY: "Entry Ticket用の入場受付QR（モック表示）",
      KARAOKE: "Karaoke Ticket用のKaraoke受付QR（モック表示）",
    },
    dateLabel: "対象日",
    timeLabel: "利用時刻",
    reservationStateLabel: "予約の状態",
    ticketStateLabel: "Ticketの状態",
    backToTicket: "Ticketの詳細へ戻る",
    backToReservation: "予約の詳細へ戻る",
  },
},
```

- 上記は**そのまま**使う（`s8-copy.test.ts` が固定する）。全 leaf は trim 済みの非空 string か関数。既存の `copy.qr.ENTRY`（`Entry Ticket / 入場受付用`）と `copy.qr.KARAOKE`（`Karaoke Ticket / Karaoke受付用`）を QR ページの title と `h1` と QR 近傍の見出しに使う。
- Overview の 5 件（`pendingEmpty` / `latestEmpty` / `ticketsEmpty` / `karaokeEmpty` / `goodsEmpty`）は**互いに部分文字列にならない**。各一覧の 4 件（`orders.empty` / `entryTickets.empty` / `reservations.empty` / `goodsItems.empty`）も**互いに部分文字列にならない**（E2E の否定 assert が誤検知しない。S7a の教訓。Overview と一覧は別ページなので、`ticketsEmpty` = `entryTickets.empty` の同一文言や、`reservations.empty` ⊂ `karaokeEmpty` はテストで混ぜない）。`copy.pageState.unavailable(subject)` は「を取得できません」で終わり、どの `*Empty` / `empty` も含まない。
- `copy.mypage.profile.save`（保存する）は `status.saved` / `error.unavailable` / `status.saving` のどれにも含まれない。`status.*` と `error.*` の 5 件は**どの 2 件も一方が他方を含まない**。
- `copy.accessDenied.*` は「他の」「存在」「所有」を含まない（S7a の約束を引き継ぐ）。
- `copy.mypage.qr.mockNotice` は「実際のQRではありません」を含む。`imageLabel.ENTRY` と `imageLabel.KARAOKE` は互いを含まず、`copy.qr.ENTRY` / `copy.qr.KARAOKE` とも異なる。
- 全 leaf は「パスワード」「token」「トークン」の語を `profile.passwordNote` / `profile.passwordReset` 以外に含まない。

## 3. 純粋 module

### 3.1 `config/mypage-routes.ts`

```ts
export function parseTicketRef(raw: string): Ref<"ticket"> | null;
export function parseReservationRef(raw: string): Ref<"reservation"> | null;
export function parseGoodsItemRef(raw: string): Ref<"goodsItem"> | null;
export const MYPAGE_PATHS: {
  readonly overview: "/mypage"; readonly profile: "/mypage/profile"; readonly orders: "/mypage/orders";
  readonly entryTickets: "/mypage/entry-tickets"; readonly reservations: "/mypage/karaoke";
  readonly goodsItems: "/mypage/goods";
};
export type MypageNavKey = keyof typeof MYPAGE_PATHS;
export const MYPAGE_NAV_KEYS: readonly MypageNavKey[];   // ["overview","profile","orders","entryTickets","reservations","goodsItems"]（この順）
export const entryQrHref: (ref: string) => string;       // `/mypage/entry-tickets/${ref}/qr`
export const reservationQrHref: (ref: string) => string; // `/mypage/karaoke/${ref}/qr`
export function currentNavKey(pathname: string): MypageNavKey | null;
```

- `parse*Ref`: canonical lowercase UUID だけを返す（`parseOrderRef` と同じ規則。大文字・前後空白・`%` エンコード・空・UUID でない文字列は `null`）。
- `currentNavKey`: `/mypage`（末尾 `/` 可）→ `overview`。`/mypage/profile` → `profile`。`/mypage/orders` と `/mypage/orders/<anything>` → `orders`。`/mypage/entry-tickets` 配下（QR を含む）→ `entryTickets`。`/mypage/karaoke` 配下 → `reservations`。`/mypage/goods` 配下 → `goodsItems`。それ以外（`/mypage/unknown`、`/mypage2`、`/`）→ `null`。query / hash は無視する。

### 3.2 `order-list-model.ts`

```ts
export type OrderListRow = {
  orderRef: Ref<"order">; href: string;                        // mypageOrderHref
  purposeLabel: string; summary: string;                       // presentPurpose(purpose).label / port の summary
  stateKey: OrderState; stateLabel: string; tone: Tone;        // presentOrderState
  createdAtText: string; totalText: string;                    // formatJstDateTime / formatMoney
  linkLabel: string;                                           // copy.mypage.orders.detailLink(createdAtText)
};
export function buildOrderListModel(input: Loadable<readonly OrderSummary[]>): ListState<OrderListRow>;
```

- `toListState` の意味論（loading / unavailable / empty / items。failed read を empty にしない）。`not_found` / `auth_required` / `email_unverified` も `unavailable`。
- 行は **createdAt の新しい順**（同時刻は port の順を保つ。安定ソート）。入力を変更しない。7 state すべてを `stateLabel`（`copy.order.state[state]`）で区別できる。

### 3.3 `order-detail-model.ts`

```ts
export function buildMypageOrderDetailModel(input: Loadable<OrderDetail>): PurchaseStatusModel;
```

- `buildPurchaseStatusModel(input)` と**同一**（loading / denied / unavailable / ready、entitlements の多重防御、notice、receipt、actions の順）だが、`ready` の `actions` から **`{ kind: "link", action: "view_purchase" }` を取り除く**（自分自身への Link を出さない）。他の action（`retry_checkout` / `recheck_status` / `purchase_again` / `view_entitlements`）は同じ順・同じ内容。`not_found` は `denied`。

### 3.4 `entry-ticket-model.ts`

```ts
export type EntryTicketRow = {
  ticketRef: Ref<"ticket">; href: string; name: string;       // entryTicketHref / offeringName
  stateKey: EntryTicketState; stateLabel: string; tone: Tone;  // presentEntryTicket
  orderHref: string; linkLabel: string;                        // mypageOrderHref(orderRef) / copy.mypage.entryTickets.detailLink(name)
};
export function buildEntryTicketListModel(input: Loadable<readonly EntryTicketSummary[]>): ListState<EntryTicketRow>;  // port の順

export type EntryTicketDetailModel =
  | { kind: "loading" } | { kind: "denied" } | { kind: "unavailable" }
  | { kind: "ready"; ticketRef: Ref<"ticket">; name: string; stateKey: EntryTicketState; stateLabel: string;
      description: string; tone: Tone; issuedAtText: string;                 // formatJstDateTime(issuedAt)
      usable: boolean; usableText: string;                                   // copy.mypage.entryTickets.detail.usable / notUsable
      qr: { kind: "link"; label: string; href: string }                      // VALID だけ。href = entryQrHref(ref)
        | { kind: "disabled"; label: string; reason: string };               // それ以外。reason = presentEntryTicket(state).disabledReason
      orderHref: string };
export function buildEntryTicketDetailModel(input: Loadable<EntryTicketDetail>): EntryTicketDetailModel;
```

- Detail: `not_found` → `denied`（他者所有と不存在を区別しない）。他の失敗 → `unavailable`。`usable === (state === "VALID")`。`qr.label = copy.mypage.entryTickets.detail.qrLink`。

### 3.5 `reservation-model.ts`

```ts
export type ReservationRow = {
  reservationRef: Ref<"reservation">; href: string;                      // reservationHref
  dateText: string; timeText: string;                                    // formatBusinessDate(date) / formatJstTimeRange(start, end)
  reservationLabel: string; ticketLabel: string; primaryLabel: string; tone: Tone;   // presentReservationTicket
  linkLabel: string;                                                     // copy.mypage.reservations.detailLink(dateText, timeText)
};
export function buildReservationListModel(input: Loadable<readonly ReservationSummary[]>): ListState<ReservationRow>;
// 行は usageStart の昇順（同時刻は port の順。安定ソート）。入力を変更しない。

export type ReservationDetailModel =
  | { kind: "loading" } | { kind: "denied" } | { kind: "unavailable" }
  | { kind: "ready"; reservationRef: Ref<"reservation">; dateText: string; startText: string; endText: string;
      timeText: string; reservationLabel: string; ticketLabel: string; primaryLabel: string; tone: Tone;
      qr: { kind: "link"; label: string; href: string }                  // qrPresentable のときだけ。href = reservationQrHref(ref)
        | { kind: "disabled"; label: string; reason: string };           // reason = presentReservationTicket の disabledReason
      orderHref: string; receiptHref: string | null };                   // safeExternalHref(receiptUrl)（https で userinfo なし）
export function buildReservationDetailModel(input: Loadable<ReservationDetail>): ReservationDetailModel;
```

- `startText` / `endText` は `formatJstTime`。`reservationLabel` / `ticketLabel` は別々（Reservation に `USED` という独自 state を作らない。利用済みは `ticketLabel`（Karaoke Ticket `USED`）で表す。SPEC-050 §18.8）。Reservation `CANCELED` のとき `qr.kind = "disabled"`、`reason = copy.karaoke.disabledReason.reservationCanceled`。

### 3.6 `goods-item-model.ts`

```ts
export type GoodsItemRow = {
  goodsItemRef: Ref<"goodsItem">; href: string; name: string; quantityText: string;   // goodsItemHref / goodsName / copy.purchase.quantity(n)
  primaryLabel: string; itemLabel: string; handoffLabel: string; tone: Tone; receivable: boolean;   // presentGoodsItem(item, handoff)
  orderStateLabel: string; orderHref: string; linkLabel: string;       // copy.order.state[orderState] / mypageOrderHref / copy.mypage.goodsItems.detailLink(name)
};
export function buildGoodsItemListModel(input: Loadable<readonly GoodsItemSummary[]>): ListState<GoodsItemRow>;  // port の順

export type GoodsItemDetailModel =
  | { kind: "loading" } | { kind: "denied" } | { kind: "unavailable" }
  | { kind: "ready"; goodsItemRef: Ref<"goodsItem">; name: string; quantityText: string; unitPriceText: string;
      subtotalText: string; primaryLabel: string; itemLabel: string; handoffLabel: string; description: string;
      tone: Tone; receivable: boolean;
      pickupNotice: string | null;          // receivable のときだけ copy.goods.detail.pickupNotice
      noSecondHandoff: string | null;       // item FULFILLABLE かつ handoff COMPLETED のときだけ copy.mypage.goodsItems.detail.noSecondHandoff
      orderStateLabel: string; orderHref: string;
      receiptHref: string | null };         // orderState === "CONFIRMED" かつ safeExternalHref(receiptUrl) !== null のときだけ
export function buildGoodsItemDetailModel(input: Loadable<GoodsItemDetail>): GoodsItemDetailModel;
```

- `receivable` は `FULFILLABLE` かつ `PENDING` のときだけ true（`presentGoodsItem`）。`PENDING_PAYMENT`（支払未確定）を受け取り可能と表示しない。`COMPLETED` を `PENDING` に戻す操作を model に持たせない。

### 3.7 `qr-model.ts`

```ts
export type QrPageModel =
  | { kind: "loading" } | { kind: "denied" } | { kind: "unavailable" }
  | { kind: "ready"; purpose: "ENTRY" | "KARAOKE"; title: string;       // copy.qr[purpose]
      imageLabel: string;                                                // copy.mypage.qr.imageLabel[purpose]
      presentable: boolean;
      matrixSeed: string | null;                                         // presentable のときだけ。他は null
      primaryLabel: string;                                              // Entry: presentEntryTicket(state).label / Karaoke: presentReservationTicket の primaryLabel
      disabledReason: string | null;                                     // presentable でないときの理由（テキスト）
      mockNotice: string | null;                                         // presentable のときだけ copy.mypage.qr.mockNotice
      lines: readonly { label: string; value: string }[];
      backHref: string; backLabel: string };
export function buildEntryQrModel(ticket: Loadable<EntryTicketDetail>, qr: Loadable<QrPresentation>): QrPageModel;
export function buildKaraokeQrModel(reservation: Loadable<ReservationDetail>, qr: Loadable<QrPresentation>): QrPageModel;
```

- 結合規則（Entry / Karaoke 共通）: どちらかが `not_found` → `denied`。そうでなくどちらかが `loading` → `loading`。そうでなくどちらかが失敗（`unavailable` / `auth_required` / `email_unverified`）→ `unavailable`。両方 `ok` のとき:
  - Entry: `presentable = presentEntryTicket(state).qrPresentable && qr.kind === "presentable" && qr.purpose === "ENTRY"`。Karaoke: `presentReservationTicket(reservationState, ticketState).qrPresentable && qr.kind === "presentable" && qr.purpose === "KARAOKE"`。
  - **Fail closed**: 詳細が QR 提示可能（VALID）なのに `qr` が `not_presentable`、または `purpose` が違う（Entry ページへ `KARAOKE` の presentation 等）→ `unavailable`（QR を描かない。権利種別の取り違えを描画しない）。詳細が提示不可（USED / CANCELED / EXPIRED、Reservation CANCELED）のときは、`qr` が `presentable` と言っていても `presentable = false`、`matrixSeed = null`（QR を受付可能として描かない）。
  - `lines`: Entry = `[{ label: copy.mypage.qr.ticketStateLabel, value: stateLabel }]`、Karaoke = `[対象日, 利用時刻, 予約の状態, Ticketの状態]`（`copy.mypage.qr.dateLabel` / `timeLabel` / `reservationStateLabel` / `ticketStateLabel` と `formatBusinessDate` / `formatJstTimeRange` / 予約・Ticket の label）。
  - `backHref` / `backLabel`: Entry = `entryTicketHref(ref)` / `copy.mypage.qr.backToTicket`、Karaoke = `reservationHref(ref)` / `copy.mypage.qr.backToReservation`。
  - ready 以外の model と `presentable === false` の ready model は、`mock-seed-` を含む文字列を**どこにも**含まない。

### 3.8 `profile-model.ts`

```ts
export type ProfileModel = { kind: "loading" } | { kind: "unavailable" } | { kind: "ready"; email: string; displayName: string };
export function buildProfileModel(input: Loadable<Profile>): ProfileModel;
export type ProfileSaveStep =
  | { kind: "saved"; displayName: string }
  | { kind: "invalid"; message: string }
  | { kind: "failed"; message: string };
export function interpretProfileSave(result: ProfileUpdate): ProfileSaveStep;
```

- `buildProfileModel`: `ok` → ready。`not_found` / `unavailable` / `auth_required` / `email_unverified` → `unavailable`（**別 Profile へ fallback しない**。SPEC-050 §18.2 Failure。`denied` を持たない）。
- `interpretProfileSave`: `saved` → `{ kind: "saved", displayName: profile.displayName }`（server が確定した値）。`validation_failed` → `{ kind: "invalid", message: copy.mypage.profile.error.required }`。`unavailable` → `{ kind: "failed", message: copy.mypage.profile.error.unavailable }`。exhaustive switch。

### 3.9 `overview-model.ts`

```ts
export type OverviewInput = {
  profile: Loadable<Profile>; orders: Loadable<readonly OrderSummary[]>;
  tickets: Loadable<readonly EntryTicketSummary[]>; reservations: Loadable<readonly ReservationSummary[]>;
  goodsItems: Loadable<readonly GoodsItemSummary[]>;
};
export type MypageOverviewModel = {
  profile: { kind: "loading" } | { kind: "unavailable" } | { kind: "ready"; displayName: string; email: string; href: string };  // href = "/mypage/profile"
  pending: ListState<OrderListRow>;                       // PREPARED / AWAITING_PAYMENT / REVIEW_REQUIRED の Order（新しい順）
  latest: { kind: "loading" } | { kind: "unavailable" } | { kind: "empty" } | { kind: "ready"; row: OrderListRow };
  tickets: { kind: "loading" } | { kind: "unavailable" } | { kind: "empty" }
    | { kind: "ready"; validCount: number; totalCount: number; summary: string; href: string };   // summary = copy.mypage.overview.ticketsSummary、href = "/mypage/entry-tickets"
  reservations: ListState<ReservationRow>;                // Reservation CONFIRMED かつ Ticket VALID だけ。usageStart の昇順
  goods: { kind: "loading" } | { kind: "unavailable" } | { kind: "empty" }
    | { kind: "ready"; count: number; summary: string; href: string };   // count = item FULFILLABLE かつ handoff PENDING の件数、href = "/mypage/goods"
};
export function buildMypageOverviewModel(input: OverviewInput): MypageOverviewModel;
```

- **Section ごとに独立**（SPEC-050 §18.1 State）: 1 つの入力が失敗しても、他の Section の model は変わらない。失敗した Section は `unavailable`（`empty` にしない）。`orders` が失敗したら `pending` と `latest` が両方 `unavailable`。
- `latest` は createdAt が最も新しい Order 1 件（同時刻は port の先頭）。Order が 0 件なら `empty`。`pending` の 0 件は `empty`。
- `tickets`: 0 件 → `empty`。`validCount` は state が `VALID` の件数、`totalCount` は全件数。
- `reservations`: 該当 0 件（Reservation が存在しても全て終了 / 取消 / 失効 / 使用済み）→ `empty`。「現在 / これから」の判定は **server が持つ state だけ**で行い、UI は時計を読まない（Ticket の失効は server の state。DEV-REL-001）。
- `goods`: 受け取り待ちが 0 件 → `empty`（`PENDING_PAYMENT` を受け取り待ちに数えない）。
- 入力を変更しない。例外を投げない。

## 4. 画面と DOM

### 4.1 共通

- 全ページ: AuthGate が allow した後に mount で read する（SSR 中は fetch しない。最初の描画は loading）。read が `not_found`（detail / QR）なら**データを描画する前に** `AccessDeniedView` を表示する（redirect しない。§8）。
- loading: `h1`（denied 以外は各ページの heading）と `role="status"` + `copy.pageState.loading`。業務データ・空表示・金額・状態 label を出さない。
- unavailable: `h1` + `role="alert"` + `copy.pageState.unavailable(subject)` + `<button type="button">` `copy.pageState.retry`（その read の再取得だけ。Empty / Access Denied に変換しない）。Overview は Section ごとに同じ表示（§4.2）。
- 一覧（Order / Entry Ticket / Karaoke / Goods）: 取得成功で 0 件のときだけ `copy.mypage.*.empty`（`<p>`。alert / button なし）。1 件以上のとき `<ul>` の各 `<li>` が 1 行。**Mypage nav は `<ul>` / `<li>` を使わない**（`main` 内の `listitem` = ページの行だけ）。
- 行の状態は label テキストを持ち、同一行に別の状態 label を出さない。

### 4.2 Mypage ローカルナビゲーション（`MypageNav`、`mypage/layout.tsx`）

- `<nav aria-label={copy.mypage.nav.label}>` に 6 つの `<a>`（`MYPAGE_NAV_KEYS` の順、name = `copy.mypage.nav.items[key]`、`href = MYPAGE_PATHS[key]`）。`currentNavKey(pathname)` と一致する 1 つだけに `aria-current="page"`（`null` なら 0 個）。`<ul>` / `<li>` と見出しを使わない。
- **Desktop（viewport 幅 768px 以上）**: nav は常に表示。`toggle` button は表示しない（DOM にあっても非表示）。
- **Mobile（768px 未満）**: `<button type="button" aria-expanded aria-controls>`（name = `copy.mypage.nav.toggle`、`aria-controls` は nav の `id`）が表示される。初期は閉（`aria-expanded="false"`、nav の Link は非表示でアクセシビリティツリーにもない）。押すと開（`aria-expanded="true"`、6 Link が表示される）。Link を選んで遷移したあとは閉じる。キーボード（Enter / Space）で操作できる。Mypage 各領域へ到達できなくならない（SPEC-050 §17.2 / §24.1）。
- nav は `AccessDeniedView` / loading / unavailable のときも表示される（layout にあるため）。

### 4.3 Overview（`/mypage`、PG-MYP-001）

- `h1` = `copy.mypage.heading`。次の 6 つの `<section aria-labelledby>`（region。見出し `h2`、順序固定）。**各 region は loading / unavailable / empty / ready のどの状態でも見出しとともに存在する**:
  1. `copy.mypage.overview.profileHeading`: ready = `emailLabel` + email、`displayNameLabel` + displayName、Link `profileLink` → `/mypage/profile`。
  2. `pendingHeading`: items = 各行（`OrderListRow`）に `StatusBadge`（stateLabel）、purposeLabel、createdAtText、totalText、Link `linkLabel`（`href`）。empty = `pendingEmpty`。Section の末尾に Link `ordersLink` → `/mypage/orders`。
  3. `latestHeading`: ready = 1 行（同上）。empty = `latestEmpty`。
  4. `ticketsHeading`: ready = `summary`（`利用可能 n枚 / 全 m枚`）と Link `ticketsLink` → `/mypage/entry-tickets`。empty = `ticketsEmpty`。
  5. `karaokeHeading`: items = 各行（dateText、timeText、reservationLabel、ticketLabel、Link `linkLabel`）。empty = `karaokeEmpty`。Link `karaokeLink` → `/mypage/karaoke`。
  6. `goodsHeading`: ready = `summary`（`会場受け取り待ち n件`）と Link `goodsLink` → `/mypage/goods`。empty = `goodsEmpty`。
- **未確定 Order は権利を示さない**: `pending` の行は Order の state・Purpose・金額・作成日時と詳細への Link だけを持ち、Entry Ticket / Reservation / Goods の権利へ直接 Link しない（SPEC-050 §20.1、INV-010-07）。
- 5 つの read（`getProfile` / `listOrders` / `listEntryTickets` / `listReservations` / `listGoodsItems`）は独立に行い、**1 つの失敗が他の Section を `empty` にも `unavailable` にも変えない**。失敗した Section は、その region の中に `PageState` unavailable（`copy.pageState.unavailable(subject)`、subject は `overview.*Subject`）と retry button を出す（その Section の read だけを再取得する）。**ready のとき `main` の `role="alert"` は 0 個、`role="status"` は 0 個**。
- Email 未達（scenario `notification = failed_retryable`）でも Overview は同じ確定済みの内容を表示する（SPEC-050 §18.1 State、INV-010-06。Overview は通知を扱わない）。

### 4.4 Profile（`/mypage/profile`、PG-MYP-002）

- `h1` = `copy.mypage.profile.heading`。ready:
  - Account email: `copy.mypage.profile.emailLabel` + email（**テキスト**。`<input>` にしない）+ `emailNote`。
  - `<form>`: `<label>` `displayNameLabel` + `<input type="text">`（`getByLabel(displayNameLabel, { exact: true })`。初期値 = displayName）と `<button type="submit">` `save`。**この画面の `main` の入力欄はこの 1 つだけ**（ref / email / ID を指定する入力を置かない。SPEC-050 §18.2 Failure）。
  - 状態表示: `<div role="status">`（常に存在。初期は空）に、入力が保存済み値と異なるとき `status.dirty`（未保存）、送信中 `status.saving`、成功後 `status.saved`。
  - Link `passwordReset` → `/account/password-reset`（Password 変更を Profile 編集として扱わない。`passwordNote` を併記）。
- 送信: **UI は値が空かどうかを自分で判定せず**、入力値をそのまま `self.updateProfile({ displayName })` に渡す（server が権威。Display name の最大文字数は定めない = UCR-100-001）。結果は `interpretProfileSave`:
  - `saved` → status `status.saved`、入力値を保存値に更新（dirty ではなくなる）。mock DB の displayName が更新され、reload 後も保持される。他の User は変わらない。
  - `invalid` → **error summary** `<div role="alert" tabindex="-1">`（`main` で 1 つ。`message` と、入力欄へ移動する `<a href="#<input id>">` を含む）へ focus を移す。入力欄に `aria-invalid="true"` と `aria-describedby`（欄の下の誤りメッセージ `<p id>` = 同じ `message`）を付ける。mock DB は変わらない。次の入力 / 送信で消える。
  - `failed` → `role="alert"` + `message`。入力値は保持する（失われない）。保存済みと表示しない。
- 保存中は submit button を `disabled` + `aria-busy="true"` にする（二重送信を抑止）。
- read が失敗（`not_found` を含む）→ unavailable（form を出さない。別 Profile を表示しない。`AccessDeniedView` にもしない）。
- reload は同じ Profile を再取得するだけ。

### 4.5 Order List（`/mypage/orders`、PG-MYP-003）

- `h1` = `copy.mypage.orders.heading`。行（`OrderListRow`）: `StatusBadge`（stateLabel）、purposeLabel、`copy.mypage.orders.itemsLabel` + summary、`copy.purchase.createdAtLabel` + createdAtText、`copy.purchase.totalLabel` + totalText、Link `linkLabel` → `href`（PG-MYP-004）。
- seed の demo は 13 件で、**7 つの Canonical Order State と 4 つの Purpose をすべて区別して表示**する。Empty（`new@example.com`）= `copy.mypage.orders.empty`。

### 4.6 Order Detail（`/mypage/orders/{orderRef}`、PG-MYP-004）

- `h1` = `copy.mypage.orders.detail.heading`（denied だけ `copy.accessDenied.title`）。ready は S7a の `OrderOutcome` と**同じ DOM**（region `copy.purchase.outcomeHeading` / `itemsHeading` / `entitlements.heading`、Order state の `StatusBadge`、live region、actions、Receipt の `ExternalLink`、非阻害の notice）。S7a の契約（§6.1 / §6.2）の挙動をそのまま使う: 再確認（live region に `copy.purchase.recheck.*`、新 Order を作らない、失敗時は前の内容を残して `copy.purchase.recheck.failed`）、支払い開始の再試行（同じ Order。`PREPARED` だけ）、もう一度購入する（Entry / Goods / 複合は Cart へ再投入して `/cart`、Karaoke は `/karaoke`）。
- **差分**: (a) `view_purchase`（`copy.order.action.view_purchase` = 購入内容を見る）の Link を**出さない**（このページ自身。`buildMypageOrderDetailModel`）。(b) region の外に Link `copy.mypage.orders.detail.backToList` → `/mypage/orders` を出す。
- 他者所有 / 不存在 Order → `AccessDeniedView`（`listHref = "/mypage/orders"`、`listLabel = copy.accessDenied.ordersLink`）。
- 実装は `PurchaseStatusPage` を引数で拡張しても、`order-detail-page.tsx` に同じ処理を持たせても構わない（S7a の `s7a-static.test.ts` が見る S7a ファイルの内容は保つ）。DOM と挙動が上記と一致すること。

### 4.7 Entry Ticket List（`/mypage/entry-tickets`、PG-MYP-005）

- `h1` = `copy.mypage.entryTickets.heading`。行: name、`copy.mypage.entryTickets.stateLabel` + `StatusBadge`（stateLabel）、Link `linkLabel` → `href`（PG-MYP-006）、Link `copy.mypage.entryTickets.orderLink` → `orderHref`（PG-MYP-004）。port の順。Empty = `copy.mypage.entryTickets.empty`（正常取得 0 件のときだけ）。

### 4.8 Entry Ticket Detail（`/mypage/entry-tickets/{ticketRef}`、PG-MYP-006）

- `h1` = `copy.mypage.entryTickets.detail.heading`。`<section aria-labelledby>`（region。`h2` = `detail.infoHeading`）: `kindLabel` + name、`detail.stateLabel` + `StatusBadge`（stateLabel）+ description、`issuedAtLabel` + issuedAtText、`usableLabel` + usableText、QR action、Link `copy.mypage.entryTickets.orderLink` → `orderHref`、Link `detail.backToList` → `/mypage/entry-tickets`。
- QR action（`qr.label` = `detail.qrLink`）: **VALID**: `<a href="/mypage/entry-tickets/{ref}/qr">`（role link。同名の button を出さない）。**VALID 以外**: Link を**出さず**、`<button type="button" disabled aria-describedby>`（同じ name）と、`aria-describedby` が指す `<p id>` に `reason` を表示する（USED / CANCELED / EXPIRED の `presentEntryTicket(...).disabledReason`。QR を受付可能として見せない。SPEC-050 §25）。
- 未確定 Order から有効 Ticket を生成・表示しない（port が返す Ticket だけを表示する。UI が Ticket を作らない）。reload は既存 Ticket を再取得するだけで新 Ticket を作らない（mock DB の tickets は不変）。

### 4.9 Entry QR（`/mypage/entry-tickets/{ticketRef}/qr`、PG-MYP-007）

- document title = `Entry Ticket / 入場受付用 | SITE_NAME`（`metadata.title = copy.qr.ENTRY`）。`h1` = `copy.qr.ENTRY`（denied 以外）。見出しは `h1` だけ（`h2` 以降を持たない）。
- ready: `<figure>`（QR 近傍。`main` に 1 つだけ）が次を**すべて含む**: (1) `<figcaption>` の `copy.qr.ENTRY`（権利種別をテキストで常時識別）、(2) `lines`（`Ticketの状態` + `StatusBadge`）、(3) presentable のとき QR（`<svg role="img" aria-label={imageLabel}>` を持つ `QrPlaceholder`）と `mockNotice`、(4) presentable でないとき `primaryLabel`（使用済み / 取消済み / 失効済み）と `disabledReason` を**テキストで主表示**し、QR（role `img`）を**描かない**。`main` に Link `backLabel`（`copy.mypage.qr.backToTicket`）→ `backHref`。
- presentable のとき QR の `role="img"` 要素は、viewport 390px でも**幅・高さとも 200px 以上**で、`<figure>` の幅との差が 16px 以上ある（周囲の余白。SPEC-050 §18.7 / §24.2）。横 scroll が出ない。
- QR の描画は `matrixSeed` から決定的に導く。seed の文字列そのものを DOM / URL / storage / console に出さない（§0）。

### 4.10 Karaoke Reservation List（`/mypage/karaoke`、PG-MYP-008）

- `h1` = `copy.mypage.reservations.heading`。行（利用時刻の昇順）: `dateLabel` + dateText、`timeLabel` + timeText、`reservationStateLabel` + reservationLabel、`ticketStateLabel` + ticketLabel（ともにテキスト。`StatusBadge` 可）、Link `linkLabel` → `href`（PG-MYP-009）。Empty = `copy.mypage.reservations.empty`。
- Reservation に独自の `USED` を作らない: 使用済みは Ticket label（`copy.karaoke.ticket.USED`）だけで表し、Reservation label は `copy.karaoke.reservation.*` の 2 値だけ。

### 4.11 Karaoke Reservation Detail（`/mypage/karaoke/{reservationRef}`、PG-MYP-009）

- `h1` = `copy.mypage.reservations.detail.heading`。`<section aria-labelledby>`（region。`h2` = `detail.infoHeading`）: `dateLabel` + dateText、`detail.startLabel` + startText、`detail.endLabel` + endText、`reservationStateLabel` + reservationLabel、`ticketStateLabel` + ticketLabel（+ `primaryLabel` を主表示）、QR action、Link `orderLink` → `orderHref`、Receipt（`receiptHref` が非 null のときだけ `ExternalLink` `copy.purchase.receipt.link`。null なら Link も見出しも出さず、存在を捏造しない。SPEC-050 §23）、Link `detail.backToList` → `/mypage/karaoke`。
- QR action（`qr.label` = `detail.qrLink`）: `qr.kind = "link"` のとき `<a href="/mypage/karaoke/{ref}/qr">`。`disabled` のとき Link を出さず、`<button disabled aria-describedby>` + `reason` のテキスト（Reservation `CONFIRMED` + Ticket `USED` / `EXPIRED`、Reservation `CANCELED`）。
- reload は既存 Reservation / Ticket を再取得するだけで、新 Hold / Reservation を作らない（mock DB の reservations / slots は不変）。

### 4.12 Karaoke QR（`/mypage/karaoke/{reservationRef}/qr`、PG-MYP-010）

- title / `h1` / `<figcaption>` = `copy.qr.KARAOKE`（Entry QR と異なる）。`<figure>` に `lines`（対象日、利用時刻、予約の状態、Ticketの状態。テキスト）と、presentable のとき QR（`role="img"` `aria-label` = `copy.mypage.qr.imageLabel.KARAOKE`）と `mockNotice`、presentable でないとき `primaryLabel`（使用済み / 取消済み / 失効済み）と `disabledReason` を主表示し QR を描かない。Reservation `CANCELED` と Ticket `CANCELED` はどちらも `copy.karaoke.primary.CANCELED`（取消済み）。Link `copy.mypage.qr.backToReservation` → `backHref`。
- Entry QR と Karaoke QR は、title・`figcaption`・`imageLabel` で互いに区別でき、Karaoke QR ページに `copy.qr.ENTRY` を、Entry QR ページに `copy.qr.KARAOKE` を出さない（SPEC-050 §18.10 / §24.2、SEC-QR-012）。寸法・余白は §4.9 と同じ。

### 4.13 Goods Purchase List（`/mypage/goods`、PG-MYP-011）

- `h1` = `copy.mypage.goodsItems.heading`。行（port の順）: name、quantityText、`primaryLabel`（**主表示**。Display rule: `PENDING_PAYMENT` = 支払未確定・受け取り不可、`FULFILLABLE` + `PENDING` = 会場受け取り待ち、`COMPLETED` = 受け渡し済み、`CANCELED` / `VOID` = 取消済み・受け取り不可）、`itemStateLabel` + itemLabel、`handoffStateLabel` + handoffLabel、`orderStateLabel` + orderStateLabel（Order State 要約）、Link `linkLabel` → `href`（PG-MYP-012）、Link `orderLink` → `orderHref`。Empty = `copy.mypage.goodsItems.empty`。
- 支払未確定の行に「会場受け取り待ち」を出さない。

### 4.14 Goods Purchase Detail（`/mypage/goods/{goodsItemRef}`、PG-MYP-012）

- `h1` = `copy.mypage.goodsItems.detail.heading`。`<section aria-labelledby>`（region。`h2` = `detail.infoHeading`）: `nameLabel` + name、`copy.purchase.quantity` の quantityText、`copy.cart.unitPriceLabel` + unitPriceText、`copy.cart.subtotalLabel` + subtotalText（購入時 Snapshot）、`itemStateLabel` + itemLabel、`handoffStateLabel` + handoffLabel、`primaryLabel` と `description`、`pickupNotice`（receivable のときだけ。会場受け取りに必要な案内）、`noSecondHandoff`（COMPLETED のときだけ。「二回目の受け取りはできません」）、`orderStateLabel` + orderStateLabel、Link `orderLink` → `orderHref`、Receipt（`receiptHref` が非 null のときだけ。§4.11 と同じ）、Link `detail.backToList` → `/mypage/goods`。
- **この画面に `<button>` を 1 つも置かない**（`COMPLETED` を `PENDING` に戻す操作を一般利用者へ提供しない）。Email 未達（`notification = failed_retryable`）でも `CONFIRMED` Order の Goods は同じ内容で表示される（正本導線。SPEC-050 §18.12）。

## 5. Ownership と Access Denied（PG-XFN-003、E2E 20）

- detail / QR の read が `not_found`（他者所有・不存在）→ **データを描画する前に** `AccessDeniedView`（redirect しない。`h1` = `copy.accessDenied.title`、`copy.accessDenied.description`、Link `copy.accessDenied.mypageLink` → `/mypage`、本人所有一覧への Link、retry button なし）。他者の Item 名・日時・state・購入内容を一切出さない。`main` のテキストが、他者所有 ref・不存在 ref・不正 ref で**完全に同じ**になる（同じ種類のページ内で。Mypage nav を含む）。
- `listHref` / `listLabel`: Order = `/mypage/orders` / `copy.accessDenied.ordersLink`、Entry Ticket（詳細・QR）= `/mypage/entry-tickets` / `copy.accessDenied.entryTicketsLink`、Karaoke（詳細・QR）= `/mypage/karaoke` / `copy.accessDenied.reservationsLink`、Goods = `/mypage/goods` / `copy.accessDenied.goodsItemsLink`。
- route param が不正（UUID でない・大文字・空白等）の detail / QR route は、server の殻が `AccessDeniedView` を直接描画する（HTTP 200。`notFound()` にしない。存在の有無を確定させない。S7a と同じ）。
- **権利種別の取り違え**: Entry の route に Reservation の ref（またはその逆）を渡しても `AccessDeniedView`（port が not_found を返す）。Entry QR の route で Karaoke の presentation を受け取っても描画しない（§3.7）。
- 他者所有 ref の read の前後で mock DB は変わらない。Login している User を切り替えると（`other@example.com`）、demo の ref は denied、自分の ref は表示される（所有権は Session に従う）。

## 6. 認証と保護

- Guest が各 route を開く → `/account/login?continue=<key>` へ redirect（保護 Content を一度も描画しない。S6 の AuthGate）。key: `/mypage` = `mypage`、`/mypage/profile` = `mypage-profile`、`/mypage/orders` = `mypage-orders`、`/mypage/orders/{ref}` = `mypage-order:{ref}`、`/mypage/entry-tickets` = `mypage-entry-tickets`、`/mypage/entry-tickets/{ref}` = `mypage-entry-ticket:{ref}`、`/mypage/karaoke` = `mypage-karaoke`、`/mypage/karaoke/{ref}` = `mypage-reservation:{ref}`、`/mypage/goods` = `mypage-goods`、`/mypage/goods/{ref}` = `mypage-goods-item:{ref}`、QR 2 route = `mypage`（QR を戻り先にしない）。Login 後は対応する route へ戻り、現在の内容を再取得する（Continuation は値を運ばない）。
- email 未確認の Authenticated → `/account/email-verification?continue=<同じ key>`。
- 全 route（正しい ref でも不正な ref でも）の GET は HTTP 200 で `Cache-Control` に `no-store` と `private`、`Pragma: no-cache`（SEC-WEB-009）。

## 7. E2E 共通条件

- 各ページ（ready と Access Denied）: title、`h1` が 1 つ、見出し level を飛ばさない、`pageerror` / `console.error`（resource load 失敗を除く）なし、外部 origin への要求なし、`/admin` / `/staff` / `/dev` への href なし、390px 幅で横 scroll なし。
- 時刻は `page.clock.setFixedTime(NOW_ISO)`（`2027-03-01T03:00:00Z`）。timezone は UTC、表示は JST。状態の仕込みは `openAs`（DB の preseed、session、scenario）。失敗は DB を壊す（`"{ not json"`）か scenario の `latency: "long"` で再現する（scenario の failure は mock 内の切替であり SPEC-170 の Fault Point ではない。TST-GEN-006）。
- Seed の User: `demo@example.com`（全状態）、`new@example.com`（購入 0 件）、`other@example.com`（他者用 fixture）。
- Mypage の nav は `main` の中にある（`mypage/layout.tsx`）。Mobile の toggle `<button>` と nav の 3 つの Link（Entry Ticket / Karaoke / Goods の一覧）は `main` の中に存在するため、E2E は「ページ自身の button 数」を toggle を除いて（`pageButtons`）、「権利への Link」を region の中だけで（`rightsHrefs`）数える。nav を `region`（`aria-labelledby` を持つ `<section>`）にしない。

## 8. テストファイルと契約の対応

| ファイル | 内容 |
|---|---|
| `tests/unit/web/mypage/s8-copy.test.ts` | §2（TC-PG-MYP-001-601、002-601、003-601、004-601、007-601、TC-DEV-WEB-001-801） |
| `tests/unit/web/mypage/s8-static.test.ts` | §0 / §1 / §4 の静的検査（TC-DEV-WEB-001-802〜807、TC-SEC-QR-013-601） |
| `tests/unit/web/mypage/mypage-routes.test.ts` | §3.1（TC-PG-MYP-001-611〜612） |
| `tests/unit/web/mypage/order-models.test.ts` | §3.2 / §3.3（TC-PG-MYP-003-621〜622、TC-PG-MYP-004-621〜622） |
| `tests/unit/web/mypage/entry-ticket-model.test.ts` | §3.4（TC-PG-MYP-005-621、TC-PG-MYP-006-621〜622） |
| `tests/unit/web/mypage/reservation-model.test.ts` | §3.5（TC-PG-MYP-008-621、TC-PG-MYP-009-621〜622） |
| `tests/unit/web/mypage/goods-item-model.test.ts` | §3.6（TC-PG-MYP-011-621、TC-PG-MYP-012-621〜622） |
| `tests/unit/web/mypage/qr-model.test.ts` | §3.7（TC-PG-MYP-007-621〜622、TC-PG-MYP-010-621〜622） |
| `tests/unit/web/mypage/profile-model.test.ts` | §3.8（TC-PG-MYP-002-621〜622） |
| `tests/unit/web/mypage/overview-model.test.ts` | §3.9（TC-PG-MYP-001-621〜624） |
| `tests/e2e/mypage-overview.spec.ts` | §4.3（E2E 14 / 19 の Overview 部分、TC-PG-MYP-001-701〜705） |
| `tests/e2e/mypage-nav.spec.ts` | §4.2 / §6（E2E 14 / 3 の Mypage 部分 / 22、TC-PG-MYP-001-711〜714） |
| `tests/e2e/mypage-profile.spec.ts` | §4.4（TC-PG-MYP-002-701〜705） |
| `tests/e2e/mypage-orders.spec.ts` | §4.5 / §4.6（E2E 15 / 19、TC-PG-MYP-003-701〜703、TC-PG-MYP-004-701〜706） |
| `tests/e2e/mypage-entry-tickets.spec.ts` | §4.7〜4.9（E2E 16 / 17、TC-PG-MYP-005-701〜702、TC-PG-MYP-006-701〜703、TC-PG-MYP-007-701〜704） |
| `tests/e2e/mypage-karaoke.spec.ts` | §4.10〜4.12（E2E 16 / 17、TC-PG-MYP-008-701〜702、TC-PG-MYP-009-701〜703、TC-PG-MYP-010-701〜703） |
| `tests/e2e/mypage-goods.spec.ts` | §4.13 / §4.14（E2E 18 / 19、TC-PG-MYP-011-701〜702、TC-PG-MYP-012-701〜704） |
| `tests/e2e/mypage-ownership.spec.ts` | §5（E2E 20、TC-PG-XFN-003-701〜704） |
| `tests/e2e/mypage-a11y.spec.ts` | §4.2 / §4.4 / §4.6 のキーボード・状態通知（E2E 22、TC-PG-MYP-001-721〜724） |
| `tests/e2e/mypage-common.spec.ts` | §6 / §7（E2E 23 / no-store / reload / QR の seed 非露出、TC-PG-MYP-001-731〜733、TC-SEC-WEB-009-721、TC-SEC-QR-013-701） |

## 9. SPEC-050 §31 の Page Acceptance と Test Case

| §31 | 内容 | Test Case |
|---|---|---|
| 14 | Mypage が Profile / Order / Entry / Karaoke / Goods へ到達可能 | TC-PG-MYP-001-711, 712, 713（nav）、TC-PG-MYP-001-701（Overview の各 Link） |
| 15 | Order 一覧が 7 つの Canonical Order State を区別 | TC-PG-MYP-003-701 |
| 16 | Entry / Karaoke Ticket の `VALID / USED / CANCELED / EXPIRED` を区別 | TC-PG-MYP-005-701, 006-701, 008-701, 009-701 |
| 17 | Entry QR と Karaoke QR を権利種別・画面タイトル・補助情報で混同しにくくする | TC-PG-MYP-007-703, 010-702 |
| 18 | Goods の Item 3 状態と Handoff 3 状態を区別 | TC-PG-MYP-011-701, 012-701 |
| 19 | Email failure でも `CONFIRMED` purchase と権利を Mypage で確認 | TC-PG-MYP-004-704, 012-703, 001-704 |
| 20 | 他者 Reference でも他者 Data を描画しない | TC-PG-XFN-003-701〜704 |
| 22 | Keyboard 操作、Form error 関連付け、非色依存 State 表示、状態変化通知 | TC-PG-MYP-001-721〜724、TC-PG-MYP-002-703 |
| 23 | 一般利用者 Page に Admin / Staff 専用操作を混在させない | TC-PG-MYP-001-731 |
| 3 | Guest が認証必須 Action を選ぶと Login へ進み、認証後に復帰 | TC-PG-MYP-001-714 |
| 21 | Mobile / Desktop 両方で主要 Flow を完遂 | S9。S8 の E2E は 2 project（desktop-chromium / mobile-chromium）の両方で走る |

PG-MYP-001〜012 の各 Page の Sections / State / Actions / Failure は §4 の項と上表の Test Case が 1 対 1 以上で対応する（TST-E2E-003）。

## 10. S6 placeholder の置き換え（既存テストの更新。理由: S6 契約 §6.6 が「S8 が置き換えてよい」と明記）

- `copy.mypage.protectedMarker` を**削除**する。S6 のテストの「保護 Content の目印」は、`/mypage`（Overview）の Profile Section に出る `demo@example.com` の**表示名**（seed の `デモ太郎`。`tests/harness/browser/auth.ts` の `MARKER_PROTECTED_TEXT`）に置き換えた。更新したテスト: `tests/e2e/auth-gate-logout.spec.ts`、`tests/e2e/auth-login.spec.ts`、`tests/unit/web/auth/s6-copy.test.ts`（marker の等値 assert を削除）、`tests/unit/web/auth/s6-static.test.ts`（`app/(self)/mypage/page.tsx` が `copy.mypage.protectedMarker` を使う assert を、`MypageOverviewPage` を描画する assert へ）、`tests/e2e/auth-common.spec.ts`（title / `h1` は同じ `copy.mypage.*` のまま。表示名を ready の目印にする）、`tests/contracts/s6-auth.md` の該当記述（§1 の copy、§6.6、§6.7）は本書が上書きする。
- S6 の他の挙動（Guest → `/account/login?continue=mypage`、email 未確認 → verification、session unavailable の alert、Logout / back、no-store、Header の切替）は**変わらない**。`/mypage` の `h1` は `copy.mypage.heading` のまま。

## 11. 曖昧さ・仕様の不足についてテスト担当が決めたこと

1. **Overview の「未確定 Order」「最新 Order」**: SPEC-050 §18.1 は Section 名だけ。→ 未確定 = `PREPARED` / `AWAITING_PAYMENT` / `REVIEW_REQUIRED`（§20.1 の Pending 系と Recovery Pending）。最新 = createdAt が最も新しい 1 件。同じ Order が両方の Section に出てよい。0 件はそれぞれ別の Empty 文言。
2. **Overview の「Entry Ticket summary」「Goods Handoff PENDING summary」**: 件数だけを示す。Entry Ticket は `VALID` の件数 / 全件数。Goods は **`FULFILLABLE` かつ Handoff `PENDING`** の件数（`PENDING_PAYMENT` の Item は Handoff が `PENDING` でも受け取り待ちに数えない。SPEC-050 §18.11 Display rule、INV-010-07）。未確定の Goods は「確定前の購入手続き」Section で Order として見える。
3. **「Upcoming / current Karaoke Reservation」**: Reservation `CONFIRMED` かつ Ticket `VALID`。時計を UI に持たない（失効は server が Ticket `EXPIRED` にする）。`USED` / `CANCELED` / `EXPIRED` は一覧（PG-MYP-008）で確認する。
4. **Overview の一部 Section の取得失敗**: SPEC-050 §18.1 は「全 Data が存在しない状態として表示しない」。→ Section ごとに独立に read し、失敗した Section だけを `PageState` unavailable（その Section の retry）にする。他の Section は失敗の影響を受けない。mock は DB 全体が壊れたときだけ全 read が失敗するため、Section の独立性は純粋 model（§3.9）で、全 Section の失敗と Section 単位の retry は E2E で確認する。
5. **Mypage ローカルナビゲーションの Mobile**: SPEC-050 §17.2 は「折りたたみ可能な Navigation を使用してよい」。→ Mobile は disclosure button（`aria-expanded`）、Desktop は常設。選択後は閉じる。Header の Account menu / Drawer（S3）にも同じ領域への Link があり、到達性は二重に確保される。
6. **QR 提示の判定は二重**: 詳細の state（`presentEntryTicket` / `presentReservationTicket`）と QR presentation の両方が許すときだけ描く。食い違い（VALID なのに `not_presentable`、purpose 違い）は `unavailable`（QR を描かない）。`USED` 等の詳細に `presentable` の presentation が付いても描かない。
7. **QR ページの Continuation**: S6 の `continuation.ts` は QR を戻り先にしない（Guest → Login → `/mypage`）。S8 は変更しない。QR の URL に Continuation の ref を載せない。
8. **Karaoke 一覧の並び**: 利用時刻の昇順（予約を日時で見つけやすい）。Entry Ticket / Goods は port の順、Order は新しい順。
9. **Goods 詳細の「会場受け取りに必要な案内」**: 受け取り可能（`receivable`）のときだけ `copy.goods.detail.pickupNotice` を示す。取消済み・支払未確定・受け渡し済みで受け取りを促さない。`COMPLETED` では「二回目の受け取りはできません」を示す。
10. **Receipt**: 詳細 Page は、port が安全な https URL を返したときだけ `ExternalLink`（新しいタブ、`rel="noopener noreferrer"`）を出す。Goods は Order が `CONFIRMED` のときだけ。URL が null なら Link も見出しも出さない（Receipt の存在を捏造しない。SPEC-050 §23）。seed の Karaoke 予約 1（`RESERVATION.valid`）の Order は Receipt が null。
11. **Order Detail の「購入内容を見る」**: 自分自身への Link のため出さない（SPEC-050 §18.4 は「PG-XFN-001 と同じ Order State 意味」とし、Action の集合は共有する）。他の Action は同じ。
12. **Profile の検証の責務**: 「空」の判定は server（port）が権威。UI は事前に弾かず port の `validation_failed` を error summary にする（DEV-WEB-009）。最大文字数は定めない（UCR-100-001）。
13. **Profile の Password**: Credential 変更を Profile 編集として扱わない（SPEC-050 §18.2）。`/account/password-reset` への Link だけを置く。
14. **Hold / Ticket の reload**: reload は既存の Order / Ticket / Reservation / Goods item を再取得するだけで、mock DB を変えない。ただし `PAYMENT` の模擬 Webhook（`pendingWebhook` の Order）は、S7a の契約どおり `self.getOrder` の read で進む。Mypage の一覧 read（`list*`）と Ticket / Reservation / Goods の read は DB を変えない。
15. **E2E 17 の「補助情報」**: `figcaption`（権利種別）、`imageLabel`、`mockNotice` 以外の補助情報として、Karaoke QR は対象日・利用時刻・予約の状態を QR と同じ `<figure>` に持ち、Entry QR は Ticket の状態を持つ。
