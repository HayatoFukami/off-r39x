# S4 公開ページ契約書（PG-PUB-001〜003 / PG-KRK-001〜002 / PG-GDS-001）

テスト担当が定義した S4 の実装契約である。コーディング担当は、ここに書かれたファイルパス・export 名・シグネチャ・文言・DOM 構造をそのまま実装する。対応するテスト:

- Vitest（node）: `tests/unit/web/public/*.test.ts`
- Playwright（mock mode、`desktop-chromium` と `mobile-chromium`）: `tests/e2e/public-*.spec.ts`
- ハーネス: `tests/harness/browser/public.ts`

根拠: `docs/drafts/ui-mock-design.md`（承認済み。Design §1 / §3 / §5 / §6 / §9 / §10、S4 行）、SPEC-050 v1.1.0 §9 / §11.1〜11.3 / §13.1〜13.2 / §14.1 / §20.3 / §21 / §22 / §24 / §25 / §26.2 / §27 / §31（1, 2, 5, 6）/ §33、SPEC-030 §8、SPEC-190 DEV-WEB-001〜013 / DEV-DEP-006、SPEC-140 SEC-WEB-016〜020、SPEC-170 TST-UNT-004 / TST-E2E-003 / TST-E2E-004。これは UI mock suite（補助 suite）であり G8 でも API / DB / Provider coverage でもない（TST-E2E-004）。manifest では `critical:false`。S2（`s2-mock-backend.md`）と S3（`s3-layout.md`）の契約は**変更しない**。

共通の約束:

- 文言は `apps/web/src/presentation/copy/ja.ts` の `copy` に集める。E2E / Unit はこの export を import して期待値にする。S4 の `features/{public,karaoke,goods}/**` と新規 `presentation/components/**` に**日本語の直書き・`¥` の直書き・色の直書きを置かない**（SPEC-050 §24.3）。
- 金額は必ず `formatMoney`、日時は `format/datetime.ts`（JST）で整形する。
- page.tsx は Server Component の薄い殻（`metadata` と route param の検証だけ）。データ取得は `"use client"` の container が mount 後（`useEffect`）に `useApi()` 経由で行う（SSR 中は fetch せず、最初の描画は常に loading。hydration mismatch を起こさない）。container から `mock/**` を import しない。
- 公開 Content（Event 概要・会場案内・アクセス・注意事項・FAQ・Announcement の title / excerpt / body）は plain text として描画する。`dangerouslySetInnerHTML`、Markdown、自動 link 化、sanitizer を使わない（SEC-WEB-017〜020）。改行は CSS `white-space: pre-line`（または `pre-wrap`）で表す。
- 取得 3 状態の区別: loading（業務結果を仮表示しない）、empty（正常取得で 0 件を確認できたときだけ）、unavailable（失敗。0 件へ変換しない）。`Read<T>` の `not_found` / `auth_required` / `email_unverified` は公開一覧では `unavailable` と同様に扱い、決して empty にしない。
- loading 中、`main` 内に次を出さない: 売り切れ / 販売済み / 販売停止 / 販売終了 / `0件` / 金額（`¥` + 数字）/ empty 文言 / unavailable 文言。loading 表示は `role="status"` で `copy.pageState.loading` を含む。
- unavailable 表示は `role="alert"` で失敗した対象を示し、`<button type="button">` `copy.pageState.retry` を持つ（read の再取得のみ。write はしない）。
- 各ページの `h1` は 1 つだけ。見出しの level は飛ばさない。Header / Footer に見出しを置かない（S3）。
- `main` 内の `<li>` は、そのページの一覧項目（お知らせ・Goods・販売対象日・slot の行）だけにする。日付ナビ・section 見出し周辺・注意事項以外の装飾に `<ul>` / `<li>` を使わない（E2E が `listitem` の件数で項目数を検査する。Home の注意事項と NEWS は region 内の `<li>` を数える）。

## 0. ファイル一覧

| パス | 種別 | export |
|---|---|---|
| `apps/web/src/config/public-routes.ts` | 純粋 | `ANNOUNCEMENTS_HREF`, `ENTRY_HREF`, `KARAOKE_HREF`, `GOODS_HREF`, `announcementHref`, `karaokeDayHref`, `karaokeSlotHref`, `goodsHref` |
| `apps/web/src/features/public/route-params.ts` | 純粋 | `parseAnnouncementRef`, `parseBusinessDateParam` |
| `apps/web/src/features/public/announcement-model.ts` | 純粋 | `AnnouncementListItem`, `toAnnouncementListItem`, `buildAnnouncementListModel`, `AnnouncementDetailModel`, `buildAnnouncementDetailModel` |
| `apps/web/src/features/public/home-model.ts` | 純粋 | `HOME_NEWS_LIMIT`, `HOME_SECTION_ORDER`, `HomeSectionKey`, `HomeInputs`, `HomeSection`, `HomeModel`, `buildEventPeriodText`, `buildHomeModel` |
| `apps/web/src/features/public/home-page.tsx` | client container | `HomePage` |
| `apps/web/src/features/public/announcement-list-page.tsx` | client container | `AnnouncementListPage` |
| `apps/web/src/features/public/announcement-detail-page.tsx` | client container | `AnnouncementDetailPage`（props `{ announcementRef: Ref<"announcement"> }`） |
| `apps/web/src/features/karaoke/karaoke-guide-model.ts` | 純粋 | `KaraokeGuideModel`, `buildKaraokeGuideModel` |
| `apps/web/src/features/karaoke/karaoke-day-model.ts` | 純粋 | `DayLink`, `SlotModel`, `BucketModel`, `KaraokeDayModel`, `buildKaraokeDayModel` |
| `apps/web/src/features/karaoke/karaoke-guide-page.tsx` | client container | `KaraokeGuidePage` |
| `apps/web/src/features/karaoke/karaoke-day-page.tsx` | client container | `KaraokeDayPage`（props `{ date: BusinessDateJst }`） |
| `apps/web/src/features/goods/goods-list-model.ts` | 純粋 | `GoodsListItem`, `buildGoodsListModel` |
| `apps/web/src/features/goods/goods-list-page.tsx` | client container | `GoodsListPage` |
| `apps/web/src/presentation/components/list-state.ts` | 純粋 | `Loadable`, `ListState`, `toListState` |
| `apps/web/src/presentation/components/safe-url.ts` | 純粋 | `safeExternalHref` |
| `apps/web/src/presentation/state-mapping/karaoke-sale-status.ts` | 純粋 | `KaraokeSaleStatusPresentation`, `presentKaraokeSaleStatus` |
| `apps/web/src/presentation/components/page-state.tsx` | view | `PageState`（loading / empty / unavailable。§1 の role と文言） |
| `apps/web/src/presentation/components/plain-text.tsx` | view | `PlainText` |
| `apps/web/src/presentation/components/external-link.tsx` | view | `ExternalLink`（`safeExternalHref` が null なら Link にしない） |
| `apps/web/src/presentation/components/status-badge.tsx` | view | `StatusBadge`（tone + 必ず text） |
| `apps/web/src/presentation/components/money.tsx` | view | `Money`（`formatMoney`） |
| `apps/web/src/presentation/components/date-time.tsx` | view | `DateTime`（`<time dateTime>` + JST 整形） |
| `apps/web/src/presentation/components/section-heading.tsx` | view | `SectionHeading` |
| `apps/web/app/page.tsx` | route | 既存を置き換え。`HomePage` を描画 |
| `apps/web/app/announcements/page.tsx` | route | `/announcements`（PG-PUB-002） |
| `apps/web/app/announcements/[announcementRef]/page.tsx` | route | PG-PUB-003。Next 16 の async `params` を `await` し、`parseAnnouncementRef` が null なら `notFound()` |
| `apps/web/app/karaoke/page.tsx` | route | PG-KRK-001 |
| `apps/web/app/karaoke/schedule/[date]/page.tsx` | route | PG-KRK-002。async `params`。`parseBusinessDateParam` が null なら `notFound()` |
| `apps/web/app/goods/page.tsx` | route | PG-GDS-001 |

route 用ファイルは `app/<path>/page.tsx` でも `app/(public)/<path>/page.tsx` でもよい（URL は SPEC-050 で固定）。`app/layout.tsx` の `metadata` は `title: { default: SITE_NAME, template: \`%s | ${SITE_NAME}\` }` にする（Home の title は `SITE_NAME` のまま）。page ごとに `export const metadata = { title: copy.pageTitle.<key> }`。

依存方向（DEV-DEP-006）は S3 と同じ: `presentation` → `features` / `mock` / `api-client` 実装を import しない。`features` → `mock` 禁止。純粋 model は `api-client/types` と `presentation/**` の純粋関数だけを import してよい。

## 1. 文言 `copy`（`ja.ts` に追加。S1 / S3 の既存 key は変えない）

```ts
pageTitle: {
  announcements: "お知らせ",
  announcementDetail: "お知らせ詳細",
  karaoke: "Karaoke販売案内",
  karaokeDay: "Karaoke空き状況",
  goods: "Goods",
},
pageState: {
  loading: "読み込み中です",
  empty: "現在公開中の情報はありません",
  unavailable: (subject: string): string => `${subject}を取得できません`,
  retry: "再読み込み",
},
home: {
  fallbackHeading: "Event Home",         // loading / page-level error のときの h1
  subject: "Event情報",                   // page-level error: pageState.unavailable(subject)
  sections: {
    news: "お知らせ", salesShortcut: "販売のご案内", overview: "Event概要", schedule: "開催日時",
    venue: "会場・アクセス", notices: "注意事項", faq: "FAQ",
  },
  news: { viewAll: "すべて見る" },
  shortcut: { entry: "Entry Ticketを見る", karaoke: "Karaokeを見る", goods: "Goodsを見る" },
},
announcements: {
  heading: "お知らせ",                      // 一覧の h1。詳細の loading / unavailable 時の h1
  subject: "お知らせ",
  backToList: "お知らせ一覧へ戻る",
  backHome: "Event Homeへ戻る",
},
goods: {   // 既存 copy.goods（item / handoff / awaiting / description）に list を追加
  list: { heading: "Goods", subject: "Goods一覧" },
},
```

`copy.karaoke`（既存 `slot` / `hold` / `reservation` / `ticket` / `primary` / `disabledReason`）に追加:

```ts
guide: {
  heading: "Karaoke 販売案内", subject: "Karaoke販売案内",
  intro: <string>,          // 販売案内（自由）
  usageUnit: <string>,      // 利用単位（自由）
  duration: <string>,       // 「15分」と「5分」を含む。利用時間を中心に、整備時間 5 分で運用される旨
  purchaseLimit: <string>,  // 数字を含まない（Purchase Limit の数値は port が返さない。数値を創作しない）
  priceLabel: "価格", periodLabel: "販売期間", statusLabel: "販売状態",
  datesHeading: "販売対象日",
  datesEmpty: "現在、販売対象日はありません",
  dateLink: (dateText: string): string => `${dateText}の空き状況を見る`,
},
saleStatus: { description: { ON_SALE: <string>, BEFORE_SALES: <string>, SALES_ENDED: <string>, SUSPENDED: <string> } },
day: {
  heading: "Karaoke 空き状況", subject: "空き状況",
  previous: "前の販売日", next: "次の販売日",
  reload: "空き状況を再読み込み",
  empty: "この日に販売対象の枠はありません",       // SPEC-050 §13.2 固定文言
  unavailable: "空き状況を取得できません",          // SPEC-050 §13.2 固定文言
  bucketCount: (available: number, total: number): string => `空き ${available} / 全 ${total} 枠`,
  slotLink: (timeText: string): string => `${timeText}の枠を選ぶ`,
  backToGuide: "販売案内へ戻る",
},
```

- 既存 `copy.test.ts` の制約を守る（全 leaf は trim 済みの非空 string か関数）。`copy.karaoke.saleStatus.description` の 4 つは互いに異なり、`SUSPENDED` の説明に「既存の予約は取り消されません」の趣旨を含める。どの説明にも「取り消されました / 取消されました / キャンセルされました」を含めない（SPEC-050 §13.1）。
- 既存の `copy.karaoke.slot.label`（選択可能 / 他の方が確保中 / 販売済み / 販売停止）をそのまま使う（S1 の `presentSlot`）。HELD の description は「現在確保中」を含む（既存）。
- ラベルの境界: 日付表示は `formatBusinessDate`（`2027/03/08(月)`）、時刻は `formatJstTimeRange`（`10:00-10:15`）、bucket は `10:00-11:00`（`startHour` から `HH:00-HH+1:00`。23 時は `23:00-24:00`）。

## 2. 純粋 module

### 2.1 `config/public-routes.ts`

`ANNOUNCEMENTS_HREF = "/announcements"`, `ENTRY_HREF = "/entry"`, `KARAOKE_HREF = "/karaoke"`, `GOODS_HREF = "/goods"`。
`announcementHref(ref)` = `/announcements/<ref>`、`karaokeDayHref(date)` = `/karaoke/schedule/<date>`、`karaokeSlotHref(ref)` = `/karaoke/slots/<ref>`、`goodsHref(ref)` = `/goods/<ref>`。`/admin`・`/staff`・`/dev` を含まない。

### 2.2 `features/public/route-params.ts`

- `parseAnnouncementRef(raw: string): Ref<"announcement"> | null`: canonical lowercase UUID（`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`）だけを返す。大文字・前後空白・`%` エンコード・空文字・UUID でない文字列は `null`（正規化して救済しない）。
- `parseBusinessDateParam(raw: string): BusinessDateJst | null`: `parseBusinessDateJst`（既存）と同じ。実在する暦日の `YYYY-MM-DD` だけ。`2027-02-30`、`2027-3-8`、`20270308`、前後空白、時刻付き、全角数字、空文字は `null`。

### 2.3 `presentation/components/list-state.ts`

```ts
export type Loadable<T> = Read<T> | { kind: "loading" };
export type ListState<T> =
  | { kind: "loading" } | { kind: "unavailable" } | { kind: "empty" }
  | { kind: "items"; items: readonly T[] };
export function toListState<S, T>(input: Loadable<readonly S[]>, map: (source: S) => T): ListState<T>;
```

`loading` → `loading`（`map` を呼ばない）。`ok` + `[]` → `empty`。`ok` + 1 件以上 → `items`（入力順のまま `map`）。`unavailable` / `not_found` / `auth_required` / `email_unverified` → `unavailable`（empty にしない）。入力を変更しない。

### 2.4 `presentation/components/safe-url.ts`

`safeExternalHref(url: string | null | undefined): string | null`: `https:` で parse でき、userinfo（username / password）が無いときだけ元の文字列を返す。`http:`、`javascript:`、`data:`、`vbscript:`、`file:`、相対 path、`//host`、空文字、parse 不能、`null` / `undefined` は `null`（SEC-WEB-016）。

### 2.5 `features/public/announcement-model.ts`

```ts
export type AnnouncementListItem = {
  announcementRef: Ref<"announcement">; href: string; title: string; excerpt: string;
  dateText: string;            // formatJstDate(publishedAt)
  publishedAt: UtcInstant;
};
export function toAnnouncementListItem(s: AnnouncementSummary): AnnouncementListItem;
export function buildAnnouncementListModel(
  input: Loadable<readonly AnnouncementSummary[]>, opts?: { limit?: number },
): ListState<AnnouncementListItem>;
export type AnnouncementDetailModel =
  | { kind: "loading" } | { kind: "not_found" } | { kind: "unavailable" }
  | { kind: "ready"; announcementRef: Ref<"announcement">; title: string; dateText: string; body: string;
      listHref: string; homeHref: string };
export function buildAnnouncementDetailModel(input: Loadable<Announcement>): AnnouncementDetailModel;
```

- list: `toListState` に従う。`items` は `publishedAt` 降順（同時刻は入力順）。`limit` は並べ替えの**後**に先頭から切る。`limit` が 1 以上の整数でなければ `RangeError`。
- detail: `ok` → `ready`（`body` は**原文のまま**。trim・escape・除去をしない。`listHref = "/announcements"`、`homeHref = "/"`）。`not_found` → `not_found`。`unavailable` / `auth_required` / `email_unverified` → `unavailable`（Not Found と混同しない。SPEC-050 §11.3）。`loading` → `loading`。

### 2.6 `features/public/home-model.ts`

```ts
export const HOME_NEWS_LIMIT = 3;
export const HOME_SECTION_ORDER = ["hero","news","salesShortcut","overview","schedule","venue","notices","faq"] as const;
export type HomeInputs = {
  event: Loadable<EventInfo>; announcements: Loadable<readonly AnnouncementSummary[]>; faqs: Loadable<readonly FaqItem[]>;
};
export type HomeSection =
  | { key: "hero"; eventName: string; periodText: string | null; venueName: string | null; ctaHref: string }
  | { key: "news"; list: ListState<AnnouncementListItem>; viewAllHref: string }
  | { key: "salesShortcut"; links: readonly { key: "entry" | "karaoke" | "goods"; href: string }[] }
  | { key: "overview"; eventName: string; overview: string }
  | { key: "schedule"; periodText: string }
  | { key: "venue"; venueName: string | null; venueGuide: string | null; accessInfo: string | null }
  | { key: "notices"; items: readonly string[] }
  | { key: "faq"; list: ListState<{ id: string; question: string; answer: string }> };
export type HomeModel = { kind: "loading" } | { kind: "error" } | { kind: "ready"; sections: readonly HomeSection[] };
export function buildEventPeriodText(startsAt: UtcInstant | null, endsAt: UtcInstant | null): string | null;
export function buildHomeModel(inputs: HomeInputs): HomeModel;
```

- `event` が `loading` → `{ kind: "loading" }`。`event` が `ok` 以外（`unavailable` / `not_found` / `auth_required` / `email_unverified`）→ `{ kind: "error" }`（Page-level error。他の入力に依存しない）。
- `event` が `ok` → `{ kind: "ready" }`。`sections` は `HOME_SECTION_ORDER` の順序で、次の規則で並べる（欠けた section は**省略**し順序は保つ）。
  - `hero`（常に）: `eventName = event.name`、`periodText = buildEventPeriodText(startsAt, endsAt)`、`venueName = event.venueName`（空白だけは `null`）、`ctaHref = "/entry"`。
  - `news`（常に）: `list = buildAnnouncementListModel(announcements, { limit: HOME_NEWS_LIMIT })`、`viewAllHref = "/announcements"`。
  - `salesShortcut`（常に）: `entry` `/entry`、`karaoke` `/karaoke`、`goods` `/goods` の順。
  - `overview`: `overview` が空白だけでない文字列のときだけ。`eventName = event.name`、`overview` は原文。
  - `schedule`: `buildEventPeriodText` が `null` でないときだけ。
  - `venue`: `venueName` / `venueGuide` / `accessInfo` のうち空白だけでないものが 1 つ以上あるときだけ（個別の欠けは `null` のまま）。
  - `notices`: `notices` が 1 件以上のときだけ（`null` と `[]` は省略）。原文の順。
  - `faq`（常に）: `list = toListState(faqs, 原文のまま)`。
- **section 単位の失敗の分離**: `announcements` が失敗でも `faq` と他の section は通常どおり（逆も同じ）。`news.list` だけ `unavailable` になる。
- 未設定の値を推測しない: `missing_optional`（`name` 以外が `null`）の model に「未設定」「未定」「TBD」等の創作文字列を含めない（model を JSON 化して検査）。
- `buildEventPeriodText`: 両方 `null` → `null`。設定済みの側は `formatJstDateTime` の表記（JST。UTC の日付境界をまたいでも JST の日付）を含む文字列。start だけ / end だけでも、設定済みの値だけを含み、欠けた側の値を創作しない。

### 2.7 `presentation/state-mapping/karaoke-sale-status.ts`

```ts
export type KaraokeSaleStatusPresentation = { label: string; description: string; tone: Tone; onSale: boolean };
export function presentKaraokeSaleStatus(status: KaraokeSaleStatus): KaraokeSaleStatusPresentation;
```

`label` は `copy.availability.label.{ON_SALE,BEFORE_SALES,SALES_ENDED,SUSPENDED}`、`description` は `copy.karaoke.saleStatus.description.*`。`onSale` は `ON_SALE` のときだけ true。4 つの label は互いに異なる。exhaustive switch + `assertNever`（未知の値は throw）。

### 2.8 `features/karaoke/karaoke-guide-model.ts`

```ts
export type KaraokeGuideModel =
  | { kind: "loading" } | { kind: "unavailable" }
  | { kind: "ready"; priceText: string; salesPeriodText: string; saleStatus: KaraokeSaleStatusPresentation;
      dates: { kind: "empty" } | { kind: "items"; items: readonly { date: BusinessDateJst; text: string; href: string }[] } };
export function buildKaraokeGuideModel(input: Loadable<KaraokeSales>): KaraokeGuideModel;
```

- `priceText = formatMoney(price)`。`salesPeriodText` は `formatJstDateTime(startsAt)` と `formatJstDateTime(endsAt)` を両方含む。
- `dates`: `salesDates` が `[]` → `{ kind: "empty" }`（正常取得のときだけ）。1 件以上 → 日付昇順の `items`（`text = formatBusinessDate`、`href = /karaoke/schedule/<date>`）。
- `unavailable` / `not_found` / `auth_required` / `email_unverified` → `{ kind: "unavailable" }`（**`ready` + 空の `dates` にしない**。対象日の取得失敗を「対象日なし」にしない）。`loading` → `loading`。

### 2.9 `features/karaoke/karaoke-day-model.ts`

```ts
export type DayLink = { date: BusinessDateJst; href: string; text: string };
export type SlotModel = {
  slotRef: Ref<"slot">; href: string | null;     // 選択可能な枠だけ /karaoke/slots/<ref>、それ以外は null
  timeText: string;                               // formatJstTimeRange(usageStart, usageEnd)
  stateLabel: string; description: string; tone: Tone; selectable: boolean;
};
export type BucketModel = { startHour: number; label: string; countText: string; totalSlots: number; availableSlots: number; slots: readonly SlotModel[] };
export type KaraokeDayModel =
  | { kind: "loading" } | { kind: "not_found" } | { kind: "unavailable" }
  | { kind: "ready"; date: BusinessDateJst; dateText: string; saleStatus: KaraokeSaleStatusPresentation;
      previous: DayLink | null; next: DayLink | null; buckets: readonly BucketModel[] };
export function buildKaraokeDayModel(input: Loadable<KaraokeDay>): KaraokeDayModel;
```

- `ok` → `ready`。`buckets` が `[]` でも `ready`（empty。`unavailable` にしない）。`not_found` → `not_found`。`unavailable` / `auth_required` / `email_unverified` → `unavailable`。`loading` → `loading`。
- `dateText = formatBusinessDate(date)`。`previous` / `next` は port の `previousDate` / `nextDate` から（`null` は `null`）。`href = /karaoke/schedule/<date>`、`text = formatBusinessDate`。
- bucket: `startHour` 昇順、`slots` は `usageStart` 昇順（port が整列済みでも防御的に並べる）。`totalSlots` / `availableSlots` は port の値をそのまま使い、`countText = copy.karaoke.day.bucketCount(availableSlots, totalSlots)`。`label = HH:00-HH+1:00`。**同じ `slotRef` は 1 つの bucket にだけ（最初の出現）表示する**。
- slot の状態表示（text で区別。色だけに依存しない）:
  - `state !== "AVAILABLE"`: `presentSlot(state)` の `label` / `description` / `tone`、`selectable = false`、`href = null`。
  - `state === "AVAILABLE"` かつ `saleStatus === "ON_SALE"`: `presentSlot("AVAILABLE")`、`selectable = true`、`href = /karaoke/slots/<ref>`。
  - `state === "AVAILABLE"` かつ `saleStatus !== "ON_SALE"`: `stateLabel` / `description` は `presentKaraokeSaleStatus(saleStatus)` のもの、`selectable = false`、`href = null`（「選択可能」と表示しない。SPEC-050 §13.2）。

### 2.10 `features/goods/goods-list-model.ts`

```ts
export type GoodsListItem = {
  goodsRef: Ref<"goods">; href: string; name: string; shortDescription: string;
  priceText: string;                                 // formatMoney(unitPrice)
  status: { label: string; description: string; tone: Tone; purchasable: boolean };   // presentAvailability(availability)
};
export function buildGoodsListModel(input: Loadable<readonly GoodsSummary[]>): ListState<GoodsListItem>;
```

`toListState` に従う（入力順のまま）。`href = /goods/<ref>`。`status` は `presentAvailability(item.availability)`（販売中 / 販売開始前 / 販売終了 / 販売停止 / 売り切れ / 数量不足 / 購入上限 が互いに別の label）。

## 3. DOM 契約（E2E が検査する）

共通: ページ本体は layout の `<main>` の中。`<section aria-labelledby>`（= role `region`、name は見出し text）を使う。

### 3.1 `/`（PG-PUB-001）

- `ready`: `h1` = event 名。`main` 内の `h1` / `h2` / hero CTA の DOM 順は `h1` → hero CTA（`<a href="/entry">` name `チケットを購入する`）→ `h2`（`news`, `salesShortcut`, 以下 model の section のうち存在するもの）。`h2` は section 見出し**専用**（item は `h3` か見出し以外）。
- hero: `h1` の直近の祖先 `<section>` または `<header>`（`h2` を持たない）が hero で、その中に event 名（h1）、開催日時の要約（`periodText` があるとき）、会場名（`venueName` があるとき）、主要 CTA を含む。
- `news` region: `<ul>`、各 `<li>` に Link（name = title、`href = /announcements/<ref>`）と `<time>`（`dateText`）。`すべて見る`（`copy.home.news.viewAll`）Link `href="/announcements"`。件数 0 → `copy.pageState.empty`。失敗 → `role="alert"` + `copy.pageState.unavailable(copy.home.sections.news)` + retry。
- `salesShortcut` region: Link 3 つ（`copy.home.shortcut.{entry,karaoke,goods}`）。`href` は `/entry` / `/karaoke` / `/goods`。
- `overview` region: event 名と `overview`。`schedule` region: `periodText`。`venue` region: 会場名・会場案内・アクセス（値があるものだけ）。`notices` region: `<ul>` / `<li>`。
- `faq` region: 各 FAQ の question と answer（plain text）。0 件 → `copy.pageState.empty`。失敗 → `role="alert"` + `copy.pageState.unavailable(copy.home.sections.faq)` + retry（他の section は表示される）。
- page-level error（event 失敗）: `h1` = `copy.home.fallbackHeading`、`role="alert"` + `copy.pageState.unavailable(copy.home.subject)` + retry。section は 1 つも出さない。retry は 3 つの read を再取得する。
- loading: `h1` = `copy.home.fallbackHeading`、`role="status"` `copy.pageState.loading`。

### 3.2 `/announcements`、`/announcements/{ref}`（PG-PUB-002 / 003）

- 一覧: `h1` = `copy.announcements.heading`。`<ul>` の `<li>` に Link（title、`href = /announcements/<ref>`）、`<time>`（`dateText`）、excerpt。新しい順。0 件 → `copy.pageState.empty`、失敗 → alert + `unavailable(copy.announcements.subject)` + retry。
- 詳細（`ready`）: `h1` = title、`<time>`（`dateText`）、本文（`PlainText`）。Link `copy.announcements.backToList`（`/announcements`）と `copy.announcements.backHome`（`/`）。
- 詳細（`not_found`）: **Not Found 表示**（`app/not-found.tsx` と同じ `copy.notFound`。`notFound()` でも同等の view でもよい）。DRAFT / ARCHIVED / 存在しない UUID でも**同一**の見た目で、公開本文・title・「非公開」等の存在を示す語を出さない。
- 詳細（`unavailable`）: Not Found と区別し、`h1` = `copy.announcements.heading`、alert + `unavailable(copy.announcements.subject)` + retry。
- route param が canonical UUID でない → server 側の `notFound()`（**HTTP 404**、`copy.notFound` の表示）。

### 3.3 `/karaoke`（PG-KRK-001）

- `h1` = `copy.karaoke.guide.heading`。`ready`: `intro` / `usageUnit` / `duration` / `purchaseLimit` を text で、価格（`priceText`）、販売期間（`salesPeriodText`）、販売状態（`StatusBadge` の label。`description` も表示）。
- 販売対象日: `h2` = `copy.karaoke.guide.datesHeading`。`<ul>` の各 `<li>` に Link（name = `copy.karaoke.guide.dateLink(text)`、`href = /karaoke/schedule/<date>`）。空 → `copy.karaoke.guide.datesEmpty`。
- 失敗 → alert + `unavailable(copy.karaoke.guide.subject)` + retry。**`datesEmpty` を出さない**。

### 3.4 `/karaoke/schedule/{date}`（PG-KRK-002）

- `h1` = `copy.karaoke.day.heading`。`ready`: `h2` = `dateText`、日付ナビ（`<nav aria-label>` は付けてよいが、名前付き nav 以外の無名 nav を作らない）: Link name に `copy.karaoke.day.previous` / `next` を含み、`href` は前後の販売対象日。無い側は Link を出さない。販売状態の label を text で表示。Link `copy.karaoke.day.backToGuide`（`/karaoke`）。
- bucket: `<section aria-labelledby>`（region、name に `label` を含む）。見出しは `h3` = `label`。`countText` を text で表示。slot は bucket 内の `<ul>` / `<li>`。各 `<li>` に `timeText` と `stateLabel`（text）を**必ず**含む。選択可能な slot だけ `<a>`（name = `copy.karaoke.day.slotLink(timeText)`、`href = /karaoke/slots/<ref>`）。
- 空（`buckets: []`）: `copy.karaoke.day.empty`（日付ナビは残す）。失敗: `role="alert"` に `copy.karaoke.day.unavailable`、`<button>` `copy.karaoke.day.reload`。成功時にも reload ボタン（`copy.karaoke.day.reload`）を出す。reload は `getKaraokeDay` を再取得するだけ（`r39x.mock.db.v1` を書き換えない）。
- `not_found`（販売対象日でない日付）: Not Found 表示（§3.2 と同じ）。route param が不正な日付 → server 側の `notFound()`（HTTP 404）。
- loading: `role="status"` `copy.pageState.loading`。空き 0 / empty 文言を出さない。
- 本ページは **Cart 追加・購入操作を持たない**（`<button>` は reload だけ）。

### 3.5 `/goods`（PG-GDS-001）

- `h1` = `copy.goods.list.heading`。`<ul>` の各 `<li>`: Link（name = 商品名、`href = /goods/<ref>`）、短い説明、価格（`priceText`）、販売状態 label（text）と `description`（購入可否の理由）。**購入・Cart 追加の操作を置かない**（ok のとき `main` に `<button>` が 0 個）。0 件 → `copy.pageState.empty`、失敗 → alert + `unavailable(copy.goods.list.subject)` + retry（商品 0 件の文言を出さない）。非公開 Goods は一覧に出ない（port の責務）。

## 4. E2E の共通条件

- 時刻は `page.clock.setFixedTime(NOW_ISO)`（`tests/harness/mock-seed.ts` の `2027-03-01T03:00:00Z`）で固定し、seed の相対日時を決定的にする。期待値は Node 側で純粋な `buildSeed(NOW_ISO)`（`apps/web/src/mock/backend/seed.ts`。`@off-r39x/domain` を実行時に import しない）から作り、SPEC-050 の規則（PUBLISHED のみ、新しい順、JST の 1 時間 bucket）で test 側が絞り込む（Playwright は `mock-api.ts` / `db.ts` を読み込めないため、`tests/harness/browser/public.ts`）。`seed.ts` は `@off-r39x/domain` の値 import を持ち込まないこと。
- 状態の仕込みは S3 §10 の `seedLocalStorage`（scenario / session / db）。DB 仕込みは `buildSeed(NOW_ISO)` の状態を加工して `r39x.mock.db.v1` へ入れる（`dbStateSchema` の strict 検証を通る形のまま）。
- browser の timezone は UTC（`playwright.config.ts`）。表示は JST。
- 検査対象のページは、`pageerror` / `console.error`（resource load 失敗を除く）が無く、外部 origin へ要求せず、`/admin` / `/staff` / `/dev` への href を持たず、390px 幅で横 scroll が無い。
- `/`、`/announcements`、`/karaoke`、`/goods`（静的 route）の `Cache-Control` は `private` / `no-store` を含まない（SEC-WEB-009 は protected route 用。公開 page を private にしない）。動的 route（`[ref]`, `[date]`）の `Cache-Control` は対象外（Next の既定が `private` になり得るため）。

## 5. テストファイルと契約の対応

| ファイル | 内容 |
|---|---|
| `tests/unit/web/public/s4-copy.test.ts` | §1 |
| `tests/unit/web/public/s4-static.test.ts` | §0、§3 の静的検査（構成、page 殻、直書き、dangerouslySetInnerHTML） |
| `tests/unit/web/public/list-state.test.ts` | §2.3 |
| `tests/unit/web/public/safe-url.test.ts` | §2.4 |
| `tests/unit/web/public/route-params.test.ts` | §2.1, §2.2 |
| `tests/unit/web/public/announcement-model.test.ts` | §2.5 |
| `tests/unit/web/public/home-model.test.ts` | §2.6 |
| `tests/unit/web/public/karaoke-sale-status.test.ts` | §2.7 |
| `tests/unit/web/public/karaoke-guide-model.test.ts` | §2.8 |
| `tests/unit/web/public/karaoke-day-model.test.ts` | §2.9 |
| `tests/unit/web/public/goods-list-model.test.ts` | §2.10 |
| `tests/e2e/public-home.spec.ts` | §3.1 |
| `tests/e2e/public-announcements.spec.ts` | §3.2 |
| `tests/e2e/public-karaoke.spec.ts` | §3.3, §3.4 |
| `tests/e2e/public-goods.spec.ts` | §3.5 |
| `tests/e2e/public-common.spec.ts` | §4（title、見出し、リンク、実行時エラー、横 scroll、Cache-Control、plain text） |

## 6. 曖昧さ・仕様の不足についてテスト担当が決めたこと

1. SPEC-050 §11.1 は未設定の Section を「非表示または運営設定に基づく案内」とする。→ mock では**非表示**を選び、「運営設定に基づく案内」は使わない（文言を創作しないため）。
2. SPEC-050 §13.2 は HELD を「現在確保中」等と書く。→ 既存 S1 の `copy.karaoke.slot.label.HELD`（`他の方が確保中`）をそのまま使い、description が「現在確保中」を含む。E2E は label を `copy` から読む。
3. SPEC-050 §13.2 は Slot 選択 → PG-KRK-003 を定めるが、非選択の枠のリンクは未規定。→ 選択可能な枠だけ Link にする（購入不可の枠にはリンクを出さない）。
4. `AVAILABLE` の枠でも販売状態が `ON_SALE` でない場合の表示は未規定。→ 「選択可能」と表示せず、販売状態の label を出す（§2.9）。
5. 公開ルートの UUID の大文字は未規定。→ canonical lowercase だけを有効とし、それ以外は 404（S2 / SPEC-110 の canonical 形に合わせる）。
6. Karaoke の Purchase Limit の数値、整備時間の数値は port が返さない。→ 数値を創作せず、整備時間の 5 分と標準利用 15 分だけは SPEC-050 §13.1 が明記するため静的 copy に含める。
7. Event 基本情報の section 単位の失敗（FAQ だけ失敗など）は、現行の scenario（`publicFetch` は全 read 共通）では E2E で再現できない。→ 分離は `buildHomeModel` の Unit で検証する。E2E で再現するには scenario へ section 別の fail switch が必要（S2 契約の変更になるため、本スライスでは行わない。オーケストレーターの判断事項）。
8. 動的 route（`[ref]`, `[date]`）は Next 16 が `Cache-Control: private` を付け得るため、`Cache-Control` の検査は静的な 4 route に限る。
