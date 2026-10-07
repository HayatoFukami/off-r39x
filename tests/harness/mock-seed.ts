import type { BusinessDateJst, Ref, UtcInstant } from "../../apps/web/src/api-client/types.ts";

// Stable seed identifiers defined by tests/contracts/s2-mock-backend.md section 8.
// Test-only. Never imported from production code.

const r = <T extends string>(value: string): Ref<T> => value as Ref<T>;
const uuid = (prefix: string, suffix: string): string =>
  `${prefix}-0000-4000-8000-${suffix.padStart(12, "0")}`;

export const NOW_ISO = "2027-03-01T03:00:00Z" as UtcInstant; // 2027-03-01 12:00 JST
export const TEST_PASSWORD = "mock-pass-phrase-0123";
export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

export const EMAIL = {
  demo: "demo@example.com",
  fresh: "new@example.com",
  unverified: "unverified@example.com",
  other: "other@example.com",
} as const;

export const OFFERING = {
  regular: r<"offering">(uuid("e0000000", "1")),
  early: r<"offering">(uuid("e0000000", "2")),
  ended: r<"offering">(uuid("e0000000", "3")),
  suspended: r<"offering">(uuid("e0000000", "4")),
  soldout: r<"offering">(uuid("e0000000", "5")),
  limit: r<"offering">(uuid("e0000000", "6")),
} as const;

export const GOODS = {
  tshirt: r<"goods">(uuid("a0000000", "1")),
  towel: r<"goods">(uuid("a0000000", "2")),
  badge: r<"goods">(uuid("a0000000", "3")),
  poster: r<"goods">(uuid("a0000000", "4")),
  sticker: r<"goods">(uuid("a0000000", "5")),
  lanyard: r<"goods">(uuid("a0000000", "6")),
  hidden: r<"goods">(uuid("a0000000", "7")),
} as const;

export const ANNOUNCEMENT = {
  latest: r<"announcement">(uuid("ab000000", "1")),
  script: r<"announcement">(uuid("ab000000", "2")),
  older: r<"announcement">(uuid("ab000000", "3")),
  draft: r<"announcement">(uuid("ab000000", "4")),
  archived: r<"announcement">(uuid("ab000000", "5")),
} as const;

export const SPONSOR = {
  alpha: r<"sponsor">(uuid("5b000000", "1")),
  bravo: r<"sponsor">(uuid("5b000000", "2")),
  charlie: r<"sponsor">(uuid("5b000000", "3")),
} as const;

export const ORDER = {
  prepared: r<"order">(uuid("0d000000", "1")),
  awaiting: r<"order">(uuid("0d000000", "2")),
  confirmedEntry: r<"order">(uuid("0d000000", "3")),
  paymentFailed: r<"order">(uuid("0d000000", "4")),
  canceled: r<"order">(uuid("0d000000", "5")),
  expired: r<"order">(uuid("0d000000", "6")),
  review: r<"order">(uuid("0d000000", "7")),
  confirmedGoods: r<"order">(uuid("0d000000", "8")),
  confirmedComposite: r<"order">(uuid("0d000000", "9")),
  kValid: r<"order">(uuid("0d000000", "10")),
  kUsed: r<"order">(uuid("0d000000", "11")),
  kCanceled: r<"order">(uuid("0d000000", "12")),
  kExpired: r<"order">(uuid("0d000000", "13")),
  otherEntry: r<"order">(uuid("0d000000", "101")),
  otherGoods: r<"order">(uuid("0d000000", "102")),
  otherKaraoke: r<"order">(uuid("0d000000", "103")),
} as const;

export const TICKET = {
  valid: r<"ticket">(uuid("7c000000", "1")),
  used: r<"ticket">(uuid("7c000000", "2")),
  canceled: r<"ticket">(uuid("7c000000", "3")),
  expired: r<"ticket">(uuid("7c000000", "4")),
  composite: r<"ticket">(uuid("7c000000", "5")),
  other: r<"ticket">(uuid("7c000000", "101")),
} as const;

export const RESERVATION = {
  valid: r<"reservation">(uuid("4e000000", "1")),
  used: r<"reservation">(uuid("4e000000", "2")),
  canceled: r<"reservation">(uuid("4e000000", "3")),
  expired: r<"reservation">(uuid("4e000000", "4")),
  other: r<"reservation">(uuid("4e000000", "101")),
} as const;

export const GOODS_ITEM = {
  pendingPayment: r<"goodsItem">(uuid("91000000", "1")),
  completed: r<"goodsItem">(uuid("91000000", "2")),
  fulfillable: r<"goodsItem">(uuid("91000000", "3")),
  canceled: r<"goodsItem">(uuid("91000000", "4")),
  review: r<"goodsItem">(uuid("91000000", "5")),
  other: r<"goodsItem">(uuid("91000000", "101")),
} as const;

/** slot ref: D is 1 or 2, hhmm is the JST usage start. */
export const slotRef = (day: 1 | 2, hhmm: string): Ref<"slot"> =>
  r<"slot">(uuid("5a000000", `${day}${hhmm}`));

export const SLOT = {
  d1_1000: slotRef(1, "1000"),
  d1_1020: slotRef(1, "1020"),
  d1_1040: slotRef(1, "1040"),
  d1_1100: slotRef(1, "1100"),
  d1_1120: slotRef(1, "1120"),
  d1_1140: slotRef(1, "1140"),
  d1_1200: slotRef(1, "1200"),
  d1_1220: slotRef(1, "1220"),
  d1_1240: slotRef(1, "1240"),
  d1_1300: slotRef(1, "1300"),
  d1_1400: slotRef(1, "1400"),
  d2_0840: slotRef(2, "0840"),
  d2_0900: slotRef(2, "0900"),
} as const;

export const MARKER = {
  draftAnnouncement: "[draft] 非公開のお知らせ",
  archivedAnnouncement: "[archived] 掲載終了のお知らせ",
  draftFaq: "[draft] 非公開のFAQ",
  draftSponsor: "[draft] 協賛ドラフト",
  archivedSponsor: "[archived] 協賛アーカイブ",
  hiddenGoods: "[hidden] 非公開グッズ",
  scriptMarkup: '<script>alert("mock")</script>',
  brokenImage: "/mock/sponsors/__broken__.svg",
} as const;

/** JST business date = JST date of NOW_ISO plus the offset in days. */
export function jstDatePlus(nowIso: string, days: number): BusinessDateJst {
  const jst = new Date(Date.parse(nowIso) + 9 * HOUR_MS + days * DAY_MS);
  return jst.toISOString().slice(0, 10) as BusinessDateJst;
}

export const D1 = jstDatePlus(NOW_ISO, 7);
export const D2 = jstDatePlus(NOW_ISO, 8);
