import type { Money, UtcInstant } from "../../api-client/types";
import { toBusinessDateJst } from "../../presentation/format/datetime";
import { multiplyMoney, sumMoney } from "../../presentation/format/money";
import type { DbState } from "./db";

// Seed data for the UI mock (tests/contracts/s2-mock-backend.md section 8). Every time is relative
// to the instant passed in (DEV-REL-001) and nothing here is random, so one instant always yields
// one seed. Identifiers are fixed canonical UUIDs.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const JST_OFFSET_MS = 9 * HOUR_MS;

type Order = DbState["orders"][number];
type OrderItem = Order["items"][number];

const uuid = (prefix: string, suffix: number | string): string =>
  `${prefix}-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

const yen = (amount: number): Money => ({ amount: String(amount), currency: "JPY" });

const EMAIL = {
  demo: "demo@example.com",
  fresh: "new@example.com",
  unverified: "unverified@example.com",
  other: "other@example.com",
} as const;

const OFFERING = (n: number): string => uuid("e0000000", n);
const GOODS = (n: number): string => uuid("a0000000", n);
const ORDER = (n: number): string => uuid("0d000000", n);
const TICKET = (n: number): string => uuid("7c000000", n);
const RESERVATION = (n: number): string => uuid("4e000000", n);
const GOODS_ITEM = (n: number): string => uuid("91000000", n);

export function buildSeed(now: UtcInstant): DbState {
  const nowMs = Date.parse(now);
  const at = (offsetMs: number): string =>
    new Date(nowMs + offsetMs).toISOString().replace(".000Z", "Z");

  // ---- Karaoke slots: JST day +7 and +8 ---------------------------------------------------
  const todayJst = toBusinessDateJst(now);
  const jstDayMs = (days: number): number => Date.parse(`${todayJst}T00:00:00Z`) + days * DAY_MS;
  const businessDate = (days: number): string =>
    new Date(jstDayMs(days)).toISOString().slice(0, 10);
  const D1 = businessDate(7);
  const D2 = businessDate(8);

  const slotStartMs = (days: number, hhmm: string): number =>
    jstDayMs(days) +
    (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4))) * MINUTE_MS -
    JST_OFFSET_MS;
  const toUtc = (ms: number): string => new Date(ms).toISOString().replace(".000Z", "Z");
  const slotRef = (day: 1 | 2, hhmm: string): string => uuid("5a000000", `${day}${hhmm}`);
  const slot = (day: 1 | 2, hhmm: string, state: DbState["slots"][number]["state"]) => {
    const start = slotStartMs(day === 1 ? 7 : 8, hhmm);
    return {
      ref: slotRef(day, hhmm),
      usageStart: toUtc(start),
      usageEnd: toUtc(start + 15 * MINUTE_MS),
      state,
    };
  };
  const slots = [
    slot(1, "1000", "AVAILABLE"),
    slot(1, "1020", "HELD"),
    slot(1, "1040", "SOLD"),
    slot(1, "1100", "AVAILABLE"),
    slot(1, "1120", "AVAILABLE"),
    slot(1, "1140", "AVAILABLE"),
    slot(1, "1200", "SALES_STOPPED"),
    slot(1, "1220", "SOLD"),
    slot(1, "1240", "SOLD"),
    slot(1, "1300", "AVAILABLE"),
    slot(1, "1400", "SOLD"),
    slot(2, "0840", "AVAILABLE"),
    slot(2, "0900", "AVAILABLE"),
  ];
  const slotItem = (day: 1 | 2, hhmm: string): OrderItem => {
    const found = slots.find((s) => s.ref === slotRef(day, hhmm));
    if (found === undefined) {
      throw new Error("Unknown seed slot");
    }
    return {
      kind: "KARAOKE",
      slotRef: found.ref,
      name: "カラオケ利用枠",
      usageStart: found.usageStart,
      usageEnd: found.usageEnd,
      quantity: 1,
      unitPrice: yen(1000),
      subtotal: yen(1000),
    };
  };

  // ---- Sales items ---------------------------------------------------------------------------
  const offering = (
    n: number,
    name: string,
    price: number,
    startsAt: number,
    endsAt: number,
    control: "ENABLED" | "SUSPENDED",
    remaining: number,
    perAccountLimit: number | null,
  ) => ({
    ref: OFFERING(n),
    name,
    description: `${name}の説明です。`,
    unitPrice: yen(price),
    startsAt: at(startsAt),
    endsAt: at(endsAt),
    control,
    remaining,
    perAccountLimit,
    published: true,
  });
  const offerings = [
    offering(1, "一般入場券", 3000, -30 * DAY_MS, 60 * DAY_MS, "ENABLED", 10, 4),
    offering(2, "早割入場券", 3500, 3 * DAY_MS, 60 * DAY_MS, "ENABLED", 10, null),
    offering(3, "販売終了入場券", 2000, -60 * DAY_MS, -DAY_MS, "ENABLED", 10, null),
    offering(4, "販売停止中入場券", 2500, -30 * DAY_MS, 60 * DAY_MS, "SUSPENDED", 10, null),
    offering(5, "完売入場券", 3000, -30 * DAY_MS, 60 * DAY_MS, "ENABLED", 0, null),
    offering(6, "購入上限確認用入場券", 2500, -30 * DAY_MS, 60 * DAY_MS, "ENABLED", 20, 2),
  ];

  const goodsEntry = (
    n: number,
    name: string,
    price: number,
    startsAt: number,
    endsAt: number,
    control: "ENABLED" | "SUSPENDED",
    remaining: number,
    published: boolean,
  ) => ({
    ref: GOODS(n),
    name,
    shortDescription: `${name}（会場受け取り）`,
    description: `${name}の説明です。会場での受け取りのみ対応します。`,
    unitPrice: yen(price),
    startsAt: at(startsAt),
    endsAt: at(endsAt),
    control,
    remaining,
    published,
  });
  const goods = [
    goodsEntry(1, "Tシャツ", 4000, -30 * DAY_MS, 60 * DAY_MS, "ENABLED", 20, true),
    goodsEntry(2, "タオル", 1800, -30 * DAY_MS, 60 * DAY_MS, "ENABLED", 3, true),
    goodsEntry(3, "缶バッジ", 600, -30 * DAY_MS, 60 * DAY_MS, "ENABLED", 0, true),
    goodsEntry(4, "ポスター", 1200, 5 * DAY_MS, 60 * DAY_MS, "ENABLED", 10, true),
    goodsEntry(5, "ステッカー", 500, -60 * DAY_MS, -DAY_MS, "ENABLED", 10, true),
    goodsEntry(6, "ネックストラップ", 900, -30 * DAY_MS, 60 * DAY_MS, "SUSPENDED", 10, true),
    goodsEntry(7, "[hidden] 非公開グッズ", 700, -30 * DAY_MS, 60 * DAY_MS, "ENABLED", 10, false),
  ];

  // ---- Public content ------------------------------------------------------------------------
  const announcement = (
    n: number,
    title: string,
    body: string,
    publishedAt: number,
    publication: "DRAFT" | "PUBLISHED" | "ARCHIVED",
  ) => ({
    ref: uuid("ab000000", n),
    title,
    excerpt: `${title}の概要です。`,
    body,
    publishedAt: at(publishedAt),
    publication,
  });
  const announcements = [
    announcement(1, "最新のお知らせ", "最新のお知らせの本文です。", -DAY_MS, "PUBLISHED"),
    announcement(
      2,
      "表示確認用のお知らせ",
      'マークアップを含む本文の確認用です。<script>alert("mock")</script>',
      -2 * DAY_MS,
      "PUBLISHED",
    ),
    announcement(3, "過去のお知らせ", "過去のお知らせの本文です。", -10 * DAY_MS, "PUBLISHED"),
    announcement(4, "[draft] 非公開のお知らせ", "下書きの本文です。", -3 * DAY_MS, "DRAFT"),
    announcement(
      5,
      "[archived] 掲載終了のお知らせ",
      "掲載終了の本文です。",
      -20 * DAY_MS,
      "ARCHIVED",
    ),
  ];

  const faqs = [
    {
      id: "faq-1",
      question: "入場券はどこで使えますか。",
      answer: "会場の入口で提示してください。",
      publication: "PUBLISHED" as const,
    },
    {
      id: "faq-2",
      question: "グッズはどこで受け取れますか。",
      answer: "会場の受け取り窓口でのみお渡しします。",
      publication: "PUBLISHED" as const,
    },
    {
      id: "faq-3",
      question: "カラオケの枠は変更できますか。",
      answer: "購入後の変更はできません。",
      publication: "PUBLISHED" as const,
    },
    {
      id: "faq-4",
      question: "[draft] 非公開のFAQ",
      answer: "下書きの回答です。",
      publication: "DRAFT" as const,
    },
  ];

  const sponsor = (
    n: number,
    key: string,
    name: string,
    displayOrder: number,
    publication: "DRAFT" | "PUBLISHED" | "ARCHIVED",
    linkUrl: string | null,
  ) => ({
    ref: uuid("5b000000", n),
    name,
    displayOrder,
    publication,
    imageUrl: `/mock/sponsors/${key}.svg`,
    linkUrl,
  });
  // The stored order is deliberately not the display order.
  const sponsors = [
    sponsor(
      3,
      "charlie",
      "Sponsor Charlie",
      30,
      "PUBLISHED",
      "https://sponsor-charlie.example.com/",
    ),
    sponsor(1, "alpha", "Sponsor Alpha", 10, "PUBLISHED", "https://sponsor-alpha.example.com/"),
    sponsor(2, "bravo", "Sponsor Bravo", 20, "PUBLISHED", null),
    sponsor(4, "draft", "[draft] 協賛ドラフト", 40, "DRAFT", null),
    sponsor(5, "archived", "[archived] 協賛アーカイブ", 50, "ARCHIVED", null),
  ];

  // ---- Orders and entitlements ------------------------------------------------------------
  const offeringName = (n: number): string =>
    offerings.find((o) => o.ref === OFFERING(n))?.name ?? "";
  const goodsName = (n: number): string => goods.find((g) => g.ref === GOODS(n))?.name ?? "";
  const entryLine = (n: number, price: number, quantity: number): OrderItem => ({
    kind: "ENTRY_TICKET",
    offeringRef: OFFERING(n),
    name: offeringName(n),
    quantity,
    unitPrice: yen(price),
    subtotal: multiplyMoney(yen(price), quantity),
  });
  const goodsLine = (n: number, price: number, quantity: number): OrderItem => ({
    kind: "GOODS",
    goodsRef: GOODS(n),
    name: goodsName(n),
    quantity,
    unitPrice: yen(price),
    subtotal: multiplyMoney(yen(price), quantity),
  });

  const receipt = (n: number): string => `https://receipt.example.com/mock/${ORDER(n)}`;
  const order = (
    n: number,
    ownerEmail: string,
    purpose: Order["purpose"],
    state: Order["state"],
    ageMs: number,
    items: OrderItem[],
    receiptUrl: string | null,
  ): Order => ({
    ref: ORDER(n),
    ownerEmail,
    purpose,
    state,
    createdAt: at(-ageMs),
    items,
    total: sumMoney(items.map((i) => i.subtotal)),
    receiptUrl,
    pendingWebhook: false,
    webhookReads: 0,
  });

  const orders: Order[] = [
    order(
      1,
      EMAIL.demo,
      "ENTRY_TICKET_PURCHASE",
      "PREPARED",
      1 * HOUR_MS,
      [entryLine(6, 2500, 1)],
      null,
    ),
    order(
      2,
      EMAIL.demo,
      "GOODS_PURCHASE",
      "AWAITING_PAYMENT",
      2 * HOUR_MS,
      [goodsLine(1, 4000, 1)],
      null,
    ),
    order(
      3,
      EMAIL.demo,
      "ENTRY_TICKET_PURCHASE",
      "CONFIRMED",
      3 * HOUR_MS,
      [entryLine(6, 2500, 4)],
      receipt(3),
    ),
    order(
      4,
      EMAIL.demo,
      "GOODS_PURCHASE",
      "PAYMENT_FAILED",
      4 * HOUR_MS,
      [goodsLine(6, 900, 1)],
      null,
    ),
    order(
      5,
      EMAIL.demo,
      "ENTRY_TICKET_PURCHASE",
      "CANCELED",
      5 * HOUR_MS,
      [entryLine(6, 2500, 1)],
      null,
    ),
    order(6, EMAIL.demo, "KARAOKE_PURCHASE", "EXPIRED", 6 * HOUR_MS, [slotItem(2, "0900")], null),
    order(
      7,
      EMAIL.demo,
      "ENTRY_GOODS_PURCHASE",
      "REVIEW_REQUIRED",
      7 * HOUR_MS,
      [entryLine(6, 2500, 1), goodsLine(1, 4000, 1)],
      null,
    ),
    order(
      8,
      EMAIL.demo,
      "GOODS_PURCHASE",
      "CONFIRMED",
      8 * HOUR_MS,
      [goodsLine(2, 1800, 1)],
      receipt(8),
    ),
    order(
      9,
      EMAIL.demo,
      "ENTRY_GOODS_PURCHASE",
      "CONFIRMED",
      9 * HOUR_MS,
      [entryLine(6, 2500, 1), goodsLine(1, 4000, 1)],
      receipt(9),
    ),
    order(
      10,
      EMAIL.demo,
      "KARAOKE_PURCHASE",
      "CONFIRMED",
      10 * HOUR_MS,
      [slotItem(1, "1220")],
      null,
    ),
    order(
      11,
      EMAIL.demo,
      "KARAOKE_PURCHASE",
      "CONFIRMED",
      11 * HOUR_MS,
      [slotItem(1, "1240")],
      receipt(11),
    ),
    order(
      12,
      EMAIL.demo,
      "KARAOKE_PURCHASE",
      "CONFIRMED",
      12 * HOUR_MS,
      [slotItem(1, "1140")],
      receipt(12),
    ),
    order(
      13,
      EMAIL.demo,
      "KARAOKE_PURCHASE",
      "CONFIRMED",
      13 * HOUR_MS,
      [slotItem(1, "1040")],
      receipt(13),
    ),
    order(
      101,
      EMAIL.other,
      "ENTRY_TICKET_PURCHASE",
      "CONFIRMED",
      DAY_MS,
      [entryLine(6, 2500, 1)],
      receipt(101),
    ),
    order(
      102,
      EMAIL.other,
      "GOODS_PURCHASE",
      "CONFIRMED",
      DAY_MS + HOUR_MS,
      [goodsLine(1, 4000, 1)],
      receipt(102),
    ),
    order(
      103,
      EMAIL.other,
      "KARAOKE_PURCHASE",
      "CONFIRMED",
      DAY_MS + 2 * HOUR_MS,
      [slotItem(1, "1400")],
      receipt(103),
    ),
  ];

  const ticket = (
    n: number,
    orderNumber: number,
    orderAgeMs: number,
    entryNumber: number,
    state: DbState["tickets"][number]["state"],
  ) => ({
    ref: TICKET(n),
    orderRef: ORDER(orderNumber),
    offeringName: offeringName(entryNumber),
    state,
    issuedAt: at(-orderAgeMs),
  });
  const tickets = [
    ticket(1, 3, 3 * HOUR_MS, 6, "VALID"),
    ticket(2, 3, 3 * HOUR_MS, 6, "USED"),
    ticket(3, 3, 3 * HOUR_MS, 6, "CANCELED"),
    ticket(4, 3, 3 * HOUR_MS, 6, "EXPIRED"),
    ticket(5, 9, 9 * HOUR_MS, 6, "VALID"),
    ticket(101, 101, DAY_MS, 6, "VALID"),
  ];

  const reservation = (
    n: number,
    orderNumber: number,
    slotDay: 1 | 2,
    hhmm: string,
    reservationState: DbState["reservations"][number]["reservationState"],
    ticketState: DbState["reservations"][number]["ticketState"],
  ) => ({
    ref: RESERVATION(n),
    orderRef: ORDER(orderNumber),
    slotRef: slotRef(slotDay, hhmm),
    reservationState,
    ticketState,
  });
  const reservations = [
    reservation(1, 10, 1, "1220", "CONFIRMED", "VALID"),
    reservation(2, 11, 1, "1240", "CONFIRMED", "USED"),
    reservation(3, 12, 1, "1140", "CANCELED", "CANCELED"),
    reservation(4, 13, 1, "1040", "CONFIRMED", "EXPIRED"),
    reservation(101, 103, 1, "1400", "CONFIRMED", "VALID"),
  ];

  const goodsItem = (
    n: number,
    orderNumber: number,
    goodsNumber: number,
    itemState: DbState["goodsItems"][number]["itemState"],
    handoffState: DbState["goodsItems"][number]["handoffState"],
  ) => ({
    ref: GOODS_ITEM(n),
    orderRef: ORDER(orderNumber),
    goodsRef: GOODS(goodsNumber),
    goodsName: goodsName(goodsNumber),
    quantity: 1,
    itemState,
    handoffState,
  });
  const goodsItems = [
    goodsItem(1, 2, 1, "PENDING_PAYMENT", "PENDING"),
    goodsItem(2, 8, 2, "FULFILLABLE", "COMPLETED"),
    goodsItem(3, 9, 1, "FULFILLABLE", "PENDING"),
    goodsItem(4, 4, 6, "CANCELED", "VOID"),
    goodsItem(5, 7, 1, "PENDING_PAYMENT", "PENDING"),
    goodsItem(101, 102, 1, "FULFILLABLE", "PENDING"),
  ];

  return {
    version: 1,
    users: [
      { email: EMAIL.demo, displayName: "デモ太郎", emailVerified: true },
      { email: EMAIL.fresh, displayName: "新規さん", emailVerified: true },
      { email: EMAIL.unverified, displayName: "未確認さん", emailVerified: false },
      { email: EMAIL.other, displayName: "他の人", emailVerified: true },
    ],
    offerings,
    goods,
    karaoke: {
      price: yen(1000),
      startsAt: at(-30 * DAY_MS),
      endsAt: at(30 * DAY_MS),
      salesDates: [D1, D2],
    },
    slots,
    announcements,
    faqs,
    event: {
      name: "off r39'x in 大阪らへん2027",
      overview: "大阪らへんで開かれる音楽イベントです。",
      startsAt: at(14 * DAY_MS),
      endsAt: at(14 * DAY_MS + 8 * HOUR_MS),
      venueName: "モック会場ホール",
      venueGuide: "正面入口からお入りください。",
      accessInfo: "最寄り駅から徒歩10分です。",
      notices: ["開場時間は変更になる場合があります。", "再入場はできません。"],
    },
    sponsors,
    orders,
    tickets,
    reservations,
    goodsItems,
    idempotency: [],
  };
}
