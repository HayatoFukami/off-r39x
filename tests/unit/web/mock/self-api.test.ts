import type { OrderState } from "@off-r39x/domain";
import { describe, expect, it } from "vitest";
import type { CartLine, Ref } from "../../../../apps/web/src/api-client/types.ts";
import { multiplyMoney, sumMoney } from "../../../../apps/web/src/presentation/format/money.ts";
import {
  type Backend,
  createBackend,
  dbFingerprint,
  okData,
} from "../../../harness/mock-backend.ts";
import {
  D1,
  D2,
  EMAIL,
  GOODS,
  GOODS_ITEM,
  HOUR_MS,
  NOW_ISO,
  OFFERING,
  ORDER,
  RESERVATION,
  SLOT,
  TICKET,
} from "../../../harness/mock-seed.ts";

const nowMs = Date.parse(NOW_ISO);
const EMPTY_ENTITLEMENTS = { entryTicketRefs: [], reservationRef: null, goodsItems: [] };
const UNKNOWN = "88888888-8888-4888-8888-888888888888";

async function demo(): Promise<Backend> {
  const backend = createBackend();
  await backend.signInAs(EMAIL.demo);
  return backend;
}

describe("TC-PG-MYP-003-102 order list shows all 7 states, purposes and seed order (18.3, 20.1)", () => {
  it("returns the 13 demo Orders newest first, covering all 7 Order states and 4 purposes", async () => {
    const backend = await demo();
    const orders = okData(await backend.api.self.listOrders());
    expect(orders.map((o) => o.orderRef)).toEqual([
      ORDER.prepared,
      ORDER.awaiting,
      ORDER.confirmedEntry,
      ORDER.paymentFailed,
      ORDER.canceled,
      ORDER.expired,
      ORDER.review,
      ORDER.confirmedGoods,
      ORDER.confirmedComposite,
      ORDER.kValid,
      ORDER.kUsed,
      ORDER.kCanceled,
      ORDER.kExpired,
    ]);
    const times = orders.map((o) => Date.parse(o.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    orders.forEach((order, index) => {
      expect(Date.parse(order.createdAt)).toBe(nowMs - (index + 1) * HOUR_MS);
    });
    const states = new Set<OrderState>(orders.map((o) => o.state));
    expect(states).toEqual(
      new Set([
        "PREPARED",
        "AWAITING_PAYMENT",
        "CONFIRMED",
        "PAYMENT_FAILED",
        "CANCELED",
        "EXPIRED",
        "REVIEW_REQUIRED",
      ]),
    );
    expect(new Set(orders.map((o) => o.purpose))).toEqual(
      new Set([
        "ENTRY_TICKET_PURCHASE",
        "KARAOKE_PURCHASE",
        "GOODS_PURCHASE",
        "ENTRY_GOODS_PURCHASE",
      ]),
    );
    const byRef = new Map(orders.map((o) => [o.orderRef, o]));
    expect(byRef.get(ORDER.prepared)).toMatchObject({
      state: "PREPARED",
      purpose: "ENTRY_TICKET_PURCHASE",
    });
    expect(byRef.get(ORDER.awaiting)).toMatchObject({
      state: "AWAITING_PAYMENT",
      purpose: "GOODS_PURCHASE",
    });
    expect(byRef.get(ORDER.review)).toMatchObject({
      state: "REVIEW_REQUIRED",
      purpose: "ENTRY_GOODS_PURCHASE",
    });
    expect(byRef.get(ORDER.expired)).toMatchObject({
      state: "EXPIRED",
      purpose: "KARAOKE_PURCHASE",
    });
    expect(byRef.get(ORDER.confirmedComposite)).toMatchObject({
      state: "CONFIRMED",
      purpose: "ENTRY_GOODS_PURCHASE",
    });
    for (const order of orders) expect(order.summary.length).toBeGreaterThan(0);
  });

  it("returns an Empty ok list for a user with no purchases (not unavailable, not not_found)", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.fresh);
    expect(await backend.api.self.listOrders()).toEqual({ kind: "ok", data: [] });
    expect(await backend.api.self.listEntryTickets()).toEqual({ kind: "ok", data: [] });
    expect(await backend.api.self.listReservations()).toEqual({ kind: "ok", data: [] });
    expect(await backend.api.self.listGoodsItems()).toEqual({ kind: "ok", data: [] });
  });
});

describe("TC-PG-MYP-004-101 order detail: Snapshot items, totals, entitlements and receipt (18.4, BR-ORD-018)", () => {
  it("sums each Order's item subtotals exactly into its total", async () => {
    const backend = await demo();
    const orders = okData(await backend.api.self.listOrders());
    for (const summary of orders) {
      const detail = okData(await backend.api.self.getOrder(summary.orderRef));
      expect(detail.total, String(summary.orderRef)).toEqual(
        sumMoney(detail.items.map((i) => i.subtotal)),
      );
      expect(detail.total).toEqual(summary.total);
      for (const item of detail.items) {
        expect(item.subtotal).toEqual(multiplyMoney(item.unitPrice, item.quantity));
      }
    }
  });

  it("describes the seeded items of the composite, goods and karaoke Orders", async () => {
    const backend = await demo();
    const composite = okData(await backend.api.self.getOrder(ORDER.confirmedComposite));
    expect(composite.items.map((i) => [i.kind, i.quantity])).toEqual([
      ["ENTRY_TICKET", 1],
      ["GOODS", 1],
    ]);
    expect(composite.total).toEqual({ amount: "6500", currency: "JPY" });
    const entry = okData(await backend.api.self.getOrder(ORDER.confirmedEntry));
    expect(entry.items.map((i) => [i.kind, i.quantity])).toEqual([["ENTRY_TICKET", 4]]);
    expect(entry.total).toEqual({ amount: "10000", currency: "JPY" });
    const karaoke = okData(await backend.api.self.getOrder(ORDER.kValid));
    expect(karaoke.items).toHaveLength(1);
    expect(karaoke.items[0]).toMatchObject({
      kind: "KARAOKE",
      slotRef: SLOT.d1_1220,
      quantity: 1,
      unitPrice: { amount: "1000", currency: "JPY" },
    });
    expect(karaoke.total).toEqual({ amount: "1000", currency: "JPY" });
  });

  it("returns entitlements only for CONFIRMED Orders and empty ones otherwise (INV-010-07, BR-ORD-015)", async () => {
    const backend = await demo();
    const nonConfirmed = [
      ORDER.prepared,
      ORDER.awaiting,
      ORDER.paymentFailed,
      ORDER.canceled,
      ORDER.expired,
      ORDER.review,
    ];
    for (const ref of nonConfirmed) {
      const detail = okData(await backend.api.self.getOrder(ref));
      expect(detail.entitlements, String(ref)).toEqual(EMPTY_ENTITLEMENTS);
      expect(detail.receiptUrl).toBeNull();
      expect(detail.notice).toBeNull();
    }
    const entry = okData(await backend.api.self.getOrder(ORDER.confirmedEntry));
    expect([...entry.entitlements.entryTicketRefs].sort()).toEqual(
      [TICKET.valid, TICKET.used, TICKET.canceled, TICKET.expired].sort(),
    );
    const goods = okData(await backend.api.self.getOrder(ORDER.confirmedGoods));
    expect(goods.entitlements.goodsItems).toEqual([
      { ref: GOODS_ITEM.completed, itemState: "FULFILLABLE", handoffState: "COMPLETED" },
    ]);
    const composite = okData(await backend.api.self.getOrder(ORDER.confirmedComposite));
    expect(composite.entitlements.entryTicketRefs).toEqual([TICKET.composite]);
    expect(composite.entitlements.goodsItems).toEqual([
      { ref: GOODS_ITEM.fulfillable, itemState: "FULFILLABLE", handoffState: "PENDING" },
    ]);
    const karaoke = okData(await backend.api.self.getOrder(ORDER.kValid));
    expect(karaoke.entitlements.reservationRef).toBe(RESERVATION.valid);
    expect(karaoke.entitlements.entryTicketRefs).toEqual([]);
  });

  it("gives CONFIRMED Orders an https receipt URL except the Karaoke order without a receipt", async () => {
    const backend = await demo();
    for (const ref of [ORDER.confirmedEntry, ORDER.confirmedGoods, ORDER.confirmedComposite]) {
      const detail = okData(await backend.api.self.getOrder(ref));
      expect(detail.receiptUrl, String(ref)).toMatch(/^https:\/\//);
    }
    expect(okData(await backend.api.self.getOrder(ORDER.kValid)).receiptUrl).toBeNull();
  });

  it("does not leak internal Stripe or webhook identifiers in an Order", async () => {
    const backend = await demo();
    const raw = JSON.stringify(okData(await backend.api.self.getOrder(ORDER.confirmedEntry)));
    expect(raw).not.toMatch(/cs_(test|live)_|evt_|whsec_|pi_|sk_(test|live)_/);
  });
});

describe("TC-PG-XFN-003-101 other users' refs and nonexistent refs are indistinguishable (SPEC-110 22, 16.8, 26.2)", () => {
  async function reads(
    backend: Backend,
    ids: { order: string; ticket: string; reservation: string; goodsItem: string },
  ) {
    const { self } = backend.api;
    return {
      order: await self.getOrder(ids.order as Ref<"order">),
      ticket: await self.getEntryTicket(ids.ticket as Ref<"ticket">),
      entryQr: await self.getEntryQr(ids.ticket as Ref<"ticket">),
      reservation: await self.getReservation(ids.reservation as Ref<"reservation">),
      karaokeQr: await self.getKaraokeQr(ids.reservation as Ref<"reservation">),
      goodsItem: await self.getGoodsItem(ids.goodsItem as Ref<"goodsItem">),
    };
  }

  it("returns the same bare not_found for another user's refs and for unknown refs", async () => {
    const backend = await demo();
    const foreign = await reads(backend, {
      order: ORDER.otherEntry,
      ticket: TICKET.other,
      reservation: RESERVATION.other,
      goodsItem: GOODS_ITEM.other,
    });
    const missing = await reads(backend, {
      order: UNKNOWN,
      ticket: UNKNOWN,
      reservation: UNKNOWN,
      goodsItem: UNKNOWN,
    });
    const malformed = await reads(backend, {
      order: "not-a-uuid",
      ticket: "not-a-uuid",
      reservation: "not-a-uuid",
      goodsItem: "not-a-uuid",
    });
    for (const result of Object.values(foreign)) expect(result).toEqual({ kind: "not_found" });
    expect(missing).toEqual(foreign);
    expect(malformed).toEqual(foreign);
  });

  it("also hides another user's Order from a verified user with no purchases", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.fresh);
    for (const ref of [ORDER.otherEntry, ORDER.otherGoods, ORDER.otherKaraoke, ORDER.prepared]) {
      expect(await backend.api.self.getOrder(ref)).toEqual({ kind: "not_found" });
    }
  });

  it("never lists or embeds another user's data in the demo user's lists", async () => {
    const backend = await demo();
    const raw = JSON.stringify([
      okData(await backend.api.self.listOrders()),
      okData(await backend.api.self.listEntryTickets()),
      okData(await backend.api.self.listReservations()),
      okData(await backend.api.self.listGoodsItems()),
    ]);
    for (const ref of [
      ORDER.otherEntry,
      ORDER.otherGoods,
      ORDER.otherKaraoke,
      TICKET.other,
      RESERVATION.other,
      GOODS_ITEM.other,
    ]) {
      expect(raw).not.toContain(ref);
    }
    expect(raw).not.toContain(EMAIL.other);
  });

  it("is symmetric: the other user sees their own data and not the demo user's", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.other);
    expect(
      okData(await backend.api.self.listOrders())
        .map((o) => o.orderRef)
        .sort(),
    ).toEqual([ORDER.otherEntry, ORDER.otherGoods, ORDER.otherKaraoke].sort());
    expect((await backend.api.self.getOrder(ORDER.otherEntry)).kind).toBe("ok");
    expect(await backend.api.self.getOrder(ORDER.confirmedEntry)).toEqual({ kind: "not_found" });
  });

  it("does not change stored state when probing foreign refs", async () => {
    const backend = await demo();
    await backend.api.self.getOrder(ORDER.prepared);
    const before = dbFingerprint(backend);
    await backend.api.self.getOrder(ORDER.otherEntry);
    await backend.api.self.getEntryQr(TICKET.other);
    expect(dbFingerprint(backend)).toBe(before);
  });
});

describe("TC-AR-AZ-011-102 self reads require a verified authenticated session (AR-AZ-011, SPEC-050 17.1)", () => {
  async function everySelfRead(backend: Backend) {
    const { self } = backend.api;
    return [
      await self.getProfile(),
      await self.listOrders(),
      await self.getOrder(ORDER.prepared),
      await self.listEntryTickets(),
      await self.getEntryTicket(TICKET.valid),
      await self.getEntryQr(TICKET.valid),
      await self.listReservations(),
      await self.getReservation(RESERVATION.valid),
      await self.getKaraokeQr(RESERVATION.valid),
      await self.listGoodsItems(),
      await self.getGoodsItem(GOODS_ITEM.pendingPayment),
    ];
  }

  it("returns auth_required for a guest on every self read, before any ownership check", async () => {
    const backend = createBackend();
    for (const result of await everySelfRead(backend)) {
      expect(result).toEqual({ kind: "auth_required" });
    }
  });

  it("returns email_unverified for an unverified user on every self read", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.unverified);
    for (const result of await everySelfRead(backend)) {
      expect(result).toEqual({ kind: "email_unverified" });
    }
  });

  it("returns auth_required again after sign out (no cached data)", async () => {
    const backend = await demo();
    expect((await backend.api.self.listOrders()).kind).toBe("ok");
    await backend.signOut();
    expect(await backend.api.self.listOrders()).toEqual({ kind: "auth_required" });
  });

  it("does not accept a forged session entry for an unknown user as authenticated data", async () => {
    const backend = createBackend();
    backend.storage.seedRaw(
      "r39x.mock.session.v1",
      JSON.stringify({
        version: 1,
        session: { kind: "authenticated", email: "ghost@example.com", emailVerified: true },
        pendingVerificationEmail: null,
      }),
    );
    expect(await backend.api.self.listOrders()).toEqual({ kind: "auth_required" });
  });
});

describe("TC-PG-MYP-005-101 entry tickets list and detail (18.5, 18.6, 20.2)", () => {
  it("lists the demo user's 5 tickets with their 4 states and offering names", async () => {
    const backend = await demo();
    const tickets = okData(await backend.api.self.listEntryTickets());
    const byRef = new Map(tickets.map((t) => [t.ticketRef, t]));
    expect(tickets.length).toBe(5);
    expect(byRef.get(TICKET.valid)).toMatchObject({
      state: "VALID",
      orderRef: ORDER.confirmedEntry,
    });
    expect(byRef.get(TICKET.used)?.state).toBe("USED");
    expect(byRef.get(TICKET.canceled)?.state).toBe("CANCELED");
    expect(byRef.get(TICKET.expired)?.state).toBe("EXPIRED");
    expect(byRef.get(TICKET.composite)).toMatchObject({
      state: "VALID",
      orderRef: ORDER.confirmedComposite,
    });
    for (const ticket of tickets) expect(ticket.offeringName.length).toBeGreaterThan(0);
  });

  it("returns the detail of an owned ticket, issued at its Order's creation time", async () => {
    const backend = await demo();
    const detail = okData(await backend.api.self.getEntryTicket(TICKET.used));
    expect(detail).toMatchObject({
      ticketRef: TICKET.used,
      state: "USED",
      orderRef: ORDER.confirmedEntry,
    });
    const order = okData(await backend.api.self.getOrder(ORDER.confirmedEntry));
    expect(detail.issuedAt).toBe(order.createdAt);
  });

  it("uses the offering name from the Order item (the limit offering for the seeded Orders)", async () => {
    const backend = await demo();
    const detail = okData(await backend.api.self.getOrder(ORDER.confirmedEntry));
    const first = detail.items[0];
    const ticket = okData(await backend.api.self.getEntryTicket(TICKET.valid));
    expect(first?.kind).toBe("ENTRY_TICKET");
    expect(ticket.offeringName).toBe(first?.name);
    expect(first && first.kind === "ENTRY_TICKET" ? first.offeringRef : null).toBe(OFFERING.limit);
  });
});

describe("TC-PG-MYP-007-101 Entry QR is presentable only for VALID tickets (SEC-QR-012/013, 18.7)", () => {
  it("returns a presentable ENTRY presentation for a VALID ticket", async () => {
    const backend = await demo();
    const qr = okData(await backend.api.self.getEntryQr(TICKET.valid));
    expect(qr.kind).toBe("presentable");
    if (qr.kind === "presentable") {
      expect(qr.purpose).toBe("ENTRY");
      expect(qr.mockMatrixSeed).toMatch(/^mock-seed-\d{1,8}$/);
    }
    const composite = okData(await backend.api.self.getEntryQr(TICKET.composite));
    expect(composite).toMatchObject({ kind: "presentable", purpose: "ENTRY" });
  });

  it.each([
    ["USED", TICKET.used],
    ["CANCELED", TICKET.canceled],
    ["EXPIRED", TICKET.expired],
  ] as const)(
    "returns not_presentable with the %s state and no QR material",
    async (state, ref) => {
      const backend = await demo();
      const qr = okData(await backend.api.self.getEntryQr(ref));
      expect(qr).toEqual({ kind: "not_presentable", ticketState: state });
    },
  );

  it("contains only a mock seed: no token-like string, no ref, only the documented keys", async () => {
    const backend = await demo();
    const qr = okData(await backend.api.self.getEntryQr(TICKET.valid));
    expect(Object.keys(qr).sort()).toEqual(["kind", "mockMatrixSeed", "purpose"]);
    const raw = JSON.stringify(qr);
    expect(raw).not.toContain(TICKET.valid);
    expect(raw).not.toMatch(/[0-9a-f]{16,}/i); // no long hex
    expect(raw).not.toMatch(/[A-Za-z0-9_-]{24,}/); // no long base64url / JWT-like run
    expect(raw).not.toContain("eyJ");
    expect(raw).not.toMatch(/token|secret|credential/i);
  });

  it("is deterministic per ticket and does not consume an id or change state", async () => {
    const backend = await demo();
    const a = okData(await backend.api.self.getEntryQr(TICKET.valid));
    const before = dbFingerprint(backend);
    const ids = backend.ids.count();
    const b = okData(await backend.api.self.getEntryQr(TICKET.valid));
    expect(b).toEqual(a);
    expect(backend.ids.count()).toBe(ids);
    expect(dbFingerprint(backend)).toBe(before);
  });
});

describe("TC-PG-MYP-008-101 karaoke reservations list and detail (18.8, 18.9, 20.3)", () => {
  it("lists the demo user's 4 reservations with reservation and ticket states", async () => {
    const backend = await demo();
    const list = okData(await backend.api.self.listReservations());
    const byRef = new Map(list.map((r) => [r.reservationRef, r]));
    expect(list.length).toBe(4);
    expect(byRef.get(RESERVATION.valid)).toMatchObject({
      reservationState: "CONFIRMED",
      ticketState: "VALID",
      orderRef: ORDER.kValid,
      date: D1,
      usageStart: "2027-03-08T03:20:00Z", // 12:20 JST
    });
    expect(byRef.get(RESERVATION.used)).toMatchObject({
      reservationState: "CONFIRMED",
      ticketState: "USED",
    });
    expect(byRef.get(RESERVATION.canceled)).toMatchObject({
      reservationState: "CANCELED",
      ticketState: "CANCELED",
    });
    expect(byRef.get(RESERVATION.expired)).toMatchObject({
      reservationState: "CONFIRMED",
      ticketState: "EXPIRED",
    });
    for (const reservation of list) {
      expect(Date.parse(reservation.usageEnd) - Date.parse(reservation.usageStart)).toBe(
        15 * 60 * 1000,
      );
    }
  });

  it("returns the detail with slot, price and the receipt rule", async () => {
    const backend = await demo();
    const detail = okData(await backend.api.self.getReservation(RESERVATION.valid));
    expect(detail).toMatchObject({
      slotRef: SLOT.d1_1220,
      price: { amount: "1000", currency: "JPY" },
      receiptUrl: null,
    });
    const used = okData(await backend.api.self.getReservation(RESERVATION.used));
    expect(used.receiptUrl).toMatch(/^https:\/\//);
  });
});

describe("TC-PG-MYP-010-101 Karaoke QR is presentable only for a CONFIRMED reservation with a VALID ticket (18.10)", () => {
  it("returns a presentable KARAOKE presentation for the VALID reservation", async () => {
    const backend = await demo();
    const qr = okData(await backend.api.self.getKaraokeQr(RESERVATION.valid));
    expect(qr.kind).toBe("presentable");
    if (qr.kind === "presentable") {
      expect(qr.purpose).toBe("KARAOKE");
      expect(qr.mockMatrixSeed).toMatch(/^mock-seed-\d{1,8}$/);
    }
  });

  it("keeps the Entry and Karaoke QR purposes apart", async () => {
    const backend = await demo();
    const karaoke = okData(await backend.api.self.getKaraokeQr(RESERVATION.valid));
    const entry = okData(await backend.api.self.getEntryQr(TICKET.valid));
    expect(karaoke).toMatchObject({ purpose: "KARAOKE" });
    expect(entry).toMatchObject({ purpose: "ENTRY" });
    // Entry refs are never accepted by the Karaoke QR and vice versa (purpose separation).
    expect(
      await backend.api.self.getKaraokeQr(TICKET.valid as unknown as Ref<"reservation">),
    ).toEqual({
      kind: "not_found",
    });
    expect(
      await backend.api.self.getEntryQr(RESERVATION.valid as unknown as Ref<"ticket">),
    ).toEqual({
      kind: "not_found",
    });
  });

  it.each([
    ["USED", RESERVATION.used],
    ["CANCELED", RESERVATION.canceled],
    ["EXPIRED", RESERVATION.expired],
  ] as const)("returns not_presentable with the Karaoke ticket state %s", async (state, ref) => {
    const backend = await demo();
    expect(okData(await backend.api.self.getKaraokeQr(ref))).toEqual({
      kind: "not_presentable",
      ticketState: state,
    });
  });
});

describe("TC-PG-MYP-011-101 goods items list and detail (18.11, 18.12, 20.4)", () => {
  it("covers the four item and handoff combinations with their Order state", async () => {
    const backend = await demo();
    const list = okData(await backend.api.self.listGoodsItems());
    const byRef = new Map(list.map((i) => [i.goodsItemRef, i]));
    expect(list.length).toBe(5);
    expect(byRef.get(GOODS_ITEM.pendingPayment)).toMatchObject({
      itemState: "PENDING_PAYMENT",
      handoffState: "PENDING",
      orderRef: ORDER.awaiting,
      orderState: "AWAITING_PAYMENT",
      quantity: 1,
    });
    expect(byRef.get(GOODS_ITEM.completed)).toMatchObject({
      itemState: "FULFILLABLE",
      handoffState: "COMPLETED",
      orderState: "CONFIRMED",
    });
    expect(byRef.get(GOODS_ITEM.fulfillable)).toMatchObject({
      itemState: "FULFILLABLE",
      handoffState: "PENDING",
      orderRef: ORDER.confirmedComposite,
    });
    expect(byRef.get(GOODS_ITEM.canceled)).toMatchObject({
      itemState: "CANCELED",
      handoffState: "VOID",
      orderState: "PAYMENT_FAILED",
    });
    expect(byRef.get(GOODS_ITEM.review)).toMatchObject({
      itemState: "PENDING_PAYMENT",
      orderState: "REVIEW_REQUIRED",
    });
    for (const item of list) expect(item.goodsName.length).toBeGreaterThan(0);
  });

  it("returns a detail with the purchase-time unit price and subtotal", async () => {
    const backend = await demo();
    const detail = okData(await backend.api.self.getGoodsItem(GOODS_ITEM.completed));
    expect(detail).toMatchObject({
      quantity: 1,
      unitPrice: { amount: "1800", currency: "JPY" },
      subtotal: { amount: "1800", currency: "JPY" },
    });
    expect(detail.receiptUrl).toMatch(/^https:\/\//);
    const pending = okData(await backend.api.self.getGoodsItem(GOODS_ITEM.pendingPayment));
    expect(pending.receiptUrl).toBeNull();
  });
});

describe("TC-PG-MYP-002-101 profile read and update (18.2, API-AUTH-002/004, UCR-100-001)", () => {
  it("returns the signed-in user's email and display name", async () => {
    const backend = await demo();
    expect(okData(await backend.api.self.getProfile())).toEqual({
      email: EMAIL.demo,
      displayName: "デモ太郎",
    });
  });

  it.each(["", " ", "   ", "\t", "\n", "　", " 　\t\n "])(
    "rejects the blank display name %j without saving",
    async (blank) => {
      const backend = await demo();
      const before = dbFingerprint(backend);
      expect(await backend.api.self.updateProfile({ displayName: blank })).toEqual({
        kind: "validation_failed",
        field: "displayName",
      });
      expect(dbFingerprint(backend)).toBe(before);
      expect(okData(await backend.api.self.getProfile()).displayName).toBe("デモ太郎");
    },
  );

  it("saves the value exactly as given (no trim, no maximum length) and reflects it on the next read", async () => {
    const backend = await demo();
    const name = `  ${"あ".repeat(300)}  `;
    const result = await backend.api.self.updateProfile({ displayName: name });
    expect(result).toEqual({
      kind: "saved",
      profile: { email: EMAIL.demo, displayName: name },
    });
    expect(okData(await backend.api.self.getProfile()).displayName).toBe(name);
  });

  it("does not alter another user's profile", async () => {
    const backend = await demo();
    await backend.api.self.updateProfile({ displayName: "変更後" });
    await backend.signOut();
    await backend.signInAs(EMAIL.other);
    expect(okData(await backend.api.self.getProfile()).displayName).toBe("他の人");
  });

  it("returns unavailable for a guest or an unverified user (the union has no auth result)", async () => {
    const guest = createBackend();
    expect(await guest.api.self.updateProfile({ displayName: "x" })).toEqual({
      kind: "unavailable",
    });
    const unverified = createBackend();
    await unverified.signInAs(EMAIL.unverified);
    expect(await unverified.api.self.updateProfile({ displayName: "x" })).toEqual({
      kind: "unavailable",
    });
  });
});

describe("TC-DEV-WEB-010-101 latency applies once per ApiPort call; corrupted scenario is unavailable", () => {
  it("calls the injected sleep exactly once for each purchase and self method", async () => {
    const backend = await demo();
    backend.setScenario({ latency: "long", latencyLongMs: 250 });
    const { purchase, self } = backend.api;
    const line: CartLine = { kind: "GOODS", goodsRef: GOODS.towel, quantity: 1 };
    const calls: [string, () => Promise<unknown>][] = [
      ["startCartPurchase", () => purchase.startCartPurchase([line], { idempotencyKey: "l-1" })],
      [
        "startKaraokePurchase",
        () => purchase.startKaraokePurchase(SLOT.d1_1000, { idempotencyKey: "l-2" }),
      ],
      ["startCheckout", () => purchase.startCheckout(ORDER.prepared, { idempotencyKey: "l-3" })],
      ["getProfile", () => self.getProfile()],
      ["updateProfile", () => self.updateProfile({ displayName: "x" })],
      ["listOrders", () => self.listOrders()],
      ["getOrder", () => self.getOrder(ORDER.prepared)],
      ["listEntryTickets", () => self.listEntryTickets()],
      ["getEntryTicket", () => self.getEntryTicket(TICKET.valid)],
      ["getEntryQr", () => self.getEntryQr(TICKET.valid)],
      ["listReservations", () => self.listReservations()],
      ["getReservation", () => self.getReservation(RESERVATION.valid)],
      ["getKaraokeQr", () => self.getKaraokeQr(RESERVATION.valid)],
      ["listGoodsItems", () => self.listGoodsItems()],
      ["getGoodsItem", () => self.getGoodsItem(GOODS_ITEM.completed)],
    ];
    let expected = 0;
    for (const [name, call] of calls) {
      await call();
      expected += 1;
      expect(backend.sleep.calls.length, name).toBe(expected);
    }
    expect(new Set(backend.sleep.calls)).toEqual(new Set([250]));
  });

  it("answers unavailable (never defaults) when the stored scenario is corrupted", async () => {
    const backend = await demo();
    backend.storage.seedRaw("r39x.mock.scenario.v1", "{oops");
    const writes = backend.storage.writes.length;
    expect(await backend.api.public.getEvent()).toEqual({ kind: "unavailable" });
    expect(await backend.api.self.listOrders()).toEqual({ kind: "unavailable" });
    expect(
      await backend.api.purchase.startKaraokePurchase(SLOT.d1_1000, { idempotencyKey: "z-1" }),
    ).toEqual({ kind: "unavailable" });
    expect(backend.storage.writes.length).toBe(writes);
  });

  it("answers unavailable when the stored DB is corrupted and keeps the raw value for a reset", async () => {
    const backend = createBackend();
    await backend.api.public.getEvent(); // seeds
    backend.storage.seedRaw("r39x.mock.db.v1", "{oops");
    const writes = backend.storage.writes.length;
    expect(await backend.api.public.listGoods()).toEqual({ kind: "unavailable" });
    expect(await backend.api.public.getKaraokeDay(D2)).toEqual({ kind: "unavailable" });
    expect(backend.storage.writes.length).toBe(writes);
    expect(backend.storage.getItem("r39x.mock.db.v1")).toBe("{oops");
    backend.db.reset();
    expect((await backend.api.public.listGoods()).kind).toBe("ok");
  });
});
