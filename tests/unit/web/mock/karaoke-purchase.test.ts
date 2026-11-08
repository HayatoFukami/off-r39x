import { describe, expect, it } from "vitest";
import { cartLineKey } from "../../../../apps/web/src/api-client/cart-line-key.ts";
import { eligibilityTargetKey } from "../../../../apps/web/src/api-client/eligibility-target-key.ts";
import type {
  CartLine,
  EligibilityTarget,
  PurchaseEligibility,
  PurchaseReason,
  Ref,
} from "../../../../apps/web/src/api-client/types.ts";
import type { ScenarioPatch } from "../../../harness/mock-backend.ts";
import {
  type Backend,
  createBackend,
  dbFingerprint,
  okData,
} from "../../../harness/mock-backend.ts";
import { D1, EMAIL, GOODS, OFFERING, SLOT } from "../../../harness/mock-seed.ts";
import { PURCHASE_REASONS } from "../../../harness/purchase-reasons.ts";

async function freshBackend(patch: ScenarioPatch = {}): Promise<Backend> {
  const backend = createBackend();
  backend.setScenario(patch);
  await backend.signInAs(EMAIL.fresh);
  return backend;
}

async function slotState(backend: Backend, slot: Ref<"slot">): Promise<string> {
  return okData(await backend.api.public.getKaraokeSlot(slot)).state;
}

async function hold(backend: Backend, slot: Ref<"slot">, key = "h-1"): Promise<Ref<"order">> {
  const result = await backend.api.purchase.startKaraokePurchase(slot, { idempotencyKey: key });
  if (result.kind !== "held") throw new Error(`expected held but got ${result.kind}`);
  return result.orderRef;
}

describe("TC-PG-KRK-003-102 startKaraokePurchase holds an AVAILABLE slot with a separate Order (13.3, BR-ORD-019)", () => {
  it("returns held, marks the slot HELD for everyone and creates one KARAOKE_PURCHASE Order in PREPARED", async () => {
    const backend = await freshBackend();
    expect(await slotState(backend, SLOT.d1_1000)).toBe("AVAILABLE");
    const orderRef = await hold(backend, SLOT.d1_1000);
    expect(await slotState(backend, SLOT.d1_1000)).toBe("HELD");
    const detail = okData(await backend.api.self.getOrder(orderRef));
    expect(detail).toMatchObject({
      orderRef,
      purpose: "KARAOKE_PURCHASE",
      state: "PREPARED",
      total: { amount: "1000", currency: "JPY" },
    });
    expect(detail.items.length).toBe(1);
    expect(detail.items[0]).toMatchObject({
      kind: "KARAOKE",
      slotRef: SLOT.d1_1000,
      quantity: 1,
      usageStart: "2027-03-08T01:00:00Z",
      unitPrice: { amount: "1000", currency: "JPY" },
    });
    expect(detail.entitlements).toEqual({
      entryTicketRefs: [],
      reservationRef: null,
      goodsItems: [],
    });
    const day = okData(await backend.api.public.getKaraokeDay(D1));
    expect(day.buckets.find((b) => b.startHour === 10)?.availableSlots).toBe(0);
  });

  it("replays the same Order for the same idempotencyKey without creating another", async () => {
    const backend = await freshBackend();
    const first = await hold(backend, SLOT.d1_1000, "h-same");
    const ids = backend.ids.count();
    const second = await hold(backend, SLOT.d1_1000, "h-same");
    expect(second).toBe(first);
    expect(okData(await backend.api.self.listOrders()).length).toBe(1);
    expect(backend.ids.count()).toBe(ids);
  });

  it("keeps a cart Order and a Karaoke Order independent (BR-ORD-019)", async () => {
    const backend = await freshBackend();
    const cart = await backend.api.purchase.startCartPurchase(
      [{ kind: "GOODS", goodsRef: GOODS.tshirt, quantity: 1 }],
      { idempotencyKey: "k-cart" },
    );
    if (cart.kind !== "created") throw new Error("expected created");
    const karaokeOrder = await hold(backend, SLOT.d1_1000);
    expect(karaokeOrder).not.toBe(cart.orderRef);
    const orders = okData(await backend.api.self.listOrders());
    expect(orders.map((o) => o.purpose).sort()).toEqual(["GOODS_PURCHASE", "KARAOKE_PURCHASE"]);
    // Expiring the Karaoke Order does not touch the cart Order.
    backend.setScenario({ karaokeHold: "expire_before_checkout" });
    await backend.api.purchase.startCheckout(karaokeOrder, { idempotencyKey: "c-k" });
    const after = okData(await backend.api.self.listOrders());
    expect(after.find((o) => o.orderRef === cart.orderRef)?.state).toBe("PREPARED");
    expect(after.find((o) => o.orderRef === karaokeOrder)?.state).toBe("EXPIRED");
  });
});

describe("TC-PG-KRK-003-103 slot_unavailable, limit and sale status results (13.3, 21 Slot conflict)", () => {
  it.each([
    ["HELD", SLOT.d1_1020],
    ["SOLD", SLOT.d1_1040],
    ["SALES_STOPPED", SLOT.d1_1200],
  ] as const)(
    "returns slot_unavailable for a %s slot and changes nothing",
    async (_state, slot) => {
      const backend = await freshBackend();
      const before = dbFingerprint(backend);
      const result = await backend.api.purchase.startKaraokePurchase(slot, {
        idempotencyKey: "h-x",
      });
      expect(result).toEqual({ kind: "slot_unavailable" });
      expect(dbFingerprint(backend)).toBe(before);
    },
  );

  it("returns slot_unavailable for a nonexistent slot", async () => {
    const backend = await freshBackend();
    const result = await backend.api.purchase.startKaraokePurchase(
      "77777777-7777-4777-8777-777777777777" as Ref<"slot">,
      { idempotencyKey: "h-n" },
    );
    expect(result).toEqual({ kind: "slot_unavailable" });
  });

  it("lets only the first buyer hold a slot; a second user gets slot_unavailable", async () => {
    const backend = await freshBackend();
    await hold(backend, SLOT.d1_1000, "h-first");
    await backend.signOut();
    await backend.signInAs(EMAIL.demo);
    const result = await backend.api.purchase.startKaraokePurchase(SLOT.d1_1000, {
      idempotencyKey: "h-second",
    });
    expect(result).toEqual({ kind: "slot_unavailable" });
  });

  it("conflict scenario returns slot_unavailable even for an AVAILABLE slot, changing nothing", async () => {
    const backend = await freshBackend({ karaokeHold: "conflict" });
    const before = dbFingerprint(backend);
    const result = await backend.api.purchase.startKaraokePurchase(SLOT.d1_1000, {
      idempotencyKey: "h-c",
    });
    expect(result).toEqual({ kind: "slot_unavailable" });
    expect(dbFingerprint(backend)).toBe(before);
    expect(await slotState(backend, SLOT.d1_1000)).toBe("AVAILABLE");
  });

  it("limit scenario returns purchase_limit_exceeded, changing nothing", async () => {
    const backend = await freshBackend({ karaokeHold: "limit" });
    const before = dbFingerprint(backend);
    const result = await backend.api.purchase.startKaraokePurchase(SLOT.d1_1000, {
      idempotencyKey: "h-l",
    });
    expect(result).toEqual({ kind: "purchase_limit_exceeded" });
    expect(dbFingerprint(backend)).toBe(before);
  });

  it.each(["BEFORE_SALES", "SALES_ENDED", "SUSPENDED"] as const)(
    "returns not_on_sale when the Karaoke sale is %s",
    async (status) => {
      const backend = await freshBackend({ karaokeSales: status });
      const before = dbFingerprint(backend);
      const result = await backend.api.purchase.startKaraokePurchase(SLOT.d1_1000, {
        idempotencyKey: "h-s",
      });
      expect(result).toEqual({ kind: "not_on_sale" });
      expect(dbFingerprint(backend)).toBe(before);
    },
  );

  it("evaluates the hold scenario before the sale status", async () => {
    const backend = await freshBackend({ karaokeHold: "conflict", karaokeSales: "SUSPENDED" });
    const result = await backend.api.purchase.startKaraokePurchase(SLOT.d1_1000, {
      idempotencyKey: "h-o",
    });
    expect(result).toEqual({ kind: "slot_unavailable" });
  });

  it("requires a verified authenticated session", async () => {
    const guest = createBackend();
    expect(
      await guest.api.purchase.startKaraokePurchase(SLOT.d1_1000, { idempotencyKey: "h-g" }),
    ).toEqual({ kind: "auth_required" });
    const unverified = createBackend();
    await unverified.signInAs(EMAIL.unverified);
    expect(
      await unverified.api.purchase.startKaraokePurchase(SLOT.d1_1000, { idempotencyKey: "h-u" }),
    ).toEqual({ kind: "email_unverified" });
    expect(await slotState(unverified, SLOT.d1_1000)).toBe("AVAILABLE");
  });
});

describe("TC-PG-KRK-003-104 Hold expiry happens only through the scenario (13.3 step 7, 21 Hold expired)", () => {
  it("expire_before_checkout: the hold succeeds, the checkout reports opportunity_expired and the slot is released", async () => {
    const backend = await freshBackend({ karaokeHold: "expire_before_checkout" });
    const orderRef = await hold(backend, SLOT.d1_1000);
    expect(await slotState(backend, SLOT.d1_1000)).toBe("HELD");
    const result = await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-1" });
    expect(result).toEqual({ kind: "opportunity_expired" });
    const detail = okData(await backend.api.self.getOrder(orderRef));
    expect(detail.state).toBe("EXPIRED");
    expect(detail.entitlements).toEqual({
      entryTicketRefs: [],
      reservationRef: null,
      goodsItems: [],
    });
    expect(await slotState(backend, SLOT.d1_1000)).toBe("AVAILABLE");
    // The same Order is never reused: a new Hold needs a new purchase start.
    backend.setScenario({ karaokeHold: "ok" });
    expect(await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-2" })).toEqual({
      kind: "state_conflict",
    });
    const again = await hold(backend, SLOT.d1_1000, "h-again");
    expect(again).not.toBe(orderRef);
  });

  it("does not expire on its own: the clock passing never changes a Hold (no TTL in the mock)", async () => {
    const backend = await freshBackend();
    const orderRef = await hold(backend, SLOT.d1_1000);
    backend.clock.advance(24 * 60 * 60 * 1000);
    expect(await slotState(backend, SLOT.d1_1000)).toBe("HELD");
    const result = await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-1" });
    expect(result).toEqual({ kind: "redirect", url: `/dev/mock-checkout/${orderRef}` });
  });

  it("start_failed keeps the Hold and the same PREPARED Order for a retry", async () => {
    const backend = await freshBackend({ checkout: "start_failed" });
    const orderRef = await hold(backend, SLOT.d1_1000);
    expect(await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-1" })).toEqual({
      kind: "start_failed",
    });
    expect(await slotState(backend, SLOT.d1_1000)).toBe("HELD");
    backend.setScenario({ checkout: "ok" });
    expect(await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-2" })).toEqual({
      kind: "redirect",
      url: `/dev/mock-checkout/${orderRef}`,
    });
    expect(okData(await backend.api.self.listOrders()).length).toBe(1);
  });
});

describe("TC-PG-KRK-003-105 Karaoke payment outcome creates the Reservation only on CONFIRMED (BR-KRK-008, PAY-BRW-001)", () => {
  it("confirm: slot SOLD, a CONFIRMED Reservation with a VALID Ticket and a presentable Karaoke QR", async () => {
    const backend = await freshBackend({ paymentOutcome: "confirm" });
    const orderRef = await hold(backend, SLOT.d1_1000);
    await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-1" });
    const detail = okData(await backend.api.self.getOrder(orderRef));
    expect(detail.state).toBe("CONFIRMED");
    const reservationRef = detail.entitlements.reservationRef;
    expect(reservationRef).not.toBeNull();
    expect(detail.entitlements.entryTicketRefs).toEqual([]);
    expect(detail.entitlements.goodsItems).toEqual([]);
    expect(await slotState(backend, SLOT.d1_1000)).toBe("SOLD");
    const reservations = okData(await backend.api.self.listReservations());
    expect(reservations.map((r) => [r.reservationRef, r.reservationState, r.ticketState])).toEqual([
      [reservationRef, "CONFIRMED", "VALID"],
    ]);
    const qr = okData(await backend.api.self.getKaraokeQr(reservationRef as Ref<"reservation">));
    expect(qr).toMatchObject({ kind: "presentable", purpose: "KARAOKE" });
  });

  it("confirm_after_recheck: no Reservation on the first read, one on the recheck", async () => {
    const backend = await freshBackend();
    const orderRef = await hold(backend, SLOT.d1_1000);
    await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-1" });
    expect(okData(await backend.api.self.getOrder(orderRef)).state).toBe("AWAITING_PAYMENT");
    expect(okData(await backend.api.self.listReservations())).toEqual([]);
    expect(await slotState(backend, SLOT.d1_1000)).toBe("HELD");
    expect(okData(await backend.api.self.getOrder(orderRef)).state).toBe("CONFIRMED");
    expect(okData(await backend.api.self.listReservations()).length).toBe(1);
  });

  it.each([
    ["payment_failed", "PAYMENT_FAILED", "AVAILABLE"],
    ["expire", "EXPIRED", "AVAILABLE"],
    ["cancel", "CANCELED", "AVAILABLE"],
    ["review_required", "REVIEW_REQUIRED", "HELD"],
    ["remain_awaiting", "AWAITING_PAYMENT", "HELD"],
  ] as const)("%s -> Order %s and slot %s, with no Reservation", async (outcome, state, slot) => {
    const backend = await freshBackend({ paymentOutcome: outcome });
    const orderRef = await hold(backend, SLOT.d1_1000);
    await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-1" });
    expect(okData(await backend.api.self.getOrder(orderRef)).state).toBe(state);
    expect(await slotState(backend, SLOT.d1_1000)).toBe(slot);
    expect(okData(await backend.api.self.listReservations())).toEqual([]);
  });
});

describe("TC-PG-KRK-003-107 getPurchaseEligibility evaluates a KARAOKE target as the owner-scoped read-only pre-check of API-PUR-ELG-001 (FR-KRK-007, BR-KRK-003, KRK-AVL-003, AR-AZ-011, SEC-API-029, SPEC-050 12.1 / 13.3)", () => {
  const karaoke = (slotRef: Ref<"slot">): EligibilityTarget => ({
    kind: "KARAOKE",
    slotRef,
    quantity: 1,
  });
  const UNKNOWN_SLOT = "77777777-7777-4777-8777-777777777777" as Ref<"slot">;

  async function eligible(
    backend: Backend,
    targets: readonly EligibilityTarget[],
  ): Promise<readonly PurchaseEligibility[]> {
    const read = await backend.api.purchase.getPurchaseEligibility(targets);
    if (read.kind !== "ok") throw new Error(`expected an ok eligibility read but got ${read.kind}`);
    return read.data;
  }

  async function one(backend: Backend, slot: Ref<"slot">): Promise<PurchaseEligibility> {
    const [item] = await eligible(backend, [karaoke(slot)]);
    if (item === undefined) throw new Error("expected one eligibility item");
    return item;
  }

  async function demoBackend(patch: ScenarioPatch = {}): Promise<Backend> {
    const backend = createBackend();
    backend.setScenario(patch);
    await backend.signInAs(EMAIL.demo);
    return backend;
  }

  const allSlots = Object.values(SLOT);

  /** Nothing is written, no id is drawn, no Slot changes and no idempotency record appears (SEC-API-029). */
  async function expectReadOnly(backend: Backend, run: () => Promise<unknown>): Promise<void> {
    // Prime the lazily seeded DB so that only the call under test can write.
    okData(await backend.api.public.getKaraokeSlot(SLOT.d1_1000));
    const before = dbFingerprint(backend);
    const dump = backend.storage.dump();
    const writes = backend.storage.writes.length;
    const ids = backend.ids.count();
    const states = await Promise.all(allSlots.map((slot) => slotState(backend, slot)));
    await run();
    expect(dbFingerprint(backend)).toBe(before);
    expect(backend.storage.dump()).toEqual(dump);
    expect(backend.storage.writes).toHaveLength(writes);
    expect(backend.ids.count()).toBe(ids);
    expect(await Promise.all(allSlots.map((slot) => slotState(backend, slot)))).toEqual(states);
  }

  it("(a) answers an AVAILABLE slot with purchasable, no reason and a maximum of 1, keyed KARAOKE:<slotRef>", async () => {
    const backend = await demoBackend();
    await expectReadOnly(backend, async () => {
      expect(await eligible(backend, [karaoke(SLOT.d1_1000)])).toEqual([
        {
          lineKey: `KARAOKE:${SLOT.d1_1000}`,
          purchasable: true,
          reasons: [],
          maxPurchasableQuantity: 1,
        },
      ]);
    });
  });

  it.each([
    ["HELD", SLOT.d1_1020],
    ["SOLD", SLOT.d1_1040],
    ["SALES_STOPPED", SLOT.d1_1200],
  ] as const)(
    "(b) answers a %s slot with SLOT_UNAVAILABLE and a maximum of 0",
    async (_state, slot) => {
      const backend = await demoBackend();
      await expectReadOnly(backend, async () => {
        expect(await eligible(backend, [karaoke(slot)])).toEqual([
          {
            lineKey: `KARAOKE:${slot}`,
            purchasable: false,
            reasons: ["SLOT_UNAVAILABLE"],
            maxPurchasableQuantity: 0,
          },
        ]);
      });
    },
  );

  it.each([
    ["BEFORE_SALES", "SALES_NOT_STARTED"],
    ["SALES_ENDED", "SALES_CLOSED"],
    ["SUSPENDED", "SALES_STOPPED"],
  ] as const)("(c) answers %s Karaoke sales with %s and a maximum of 0", async (sales, reason) => {
    const backend = await demoBackend({ karaokeSales: sales });
    await expectReadOnly(backend, async () => {
      expect(await one(backend, SLOT.d1_1000)).toEqual({
        lineKey: `KARAOKE:${SLOT.d1_1000}`,
        purchasable: false,
        reasons: [reason],
        maxPurchasableQuantity: 0,
      });
    });
  });

  it("(d) answers the scenario karaokeHold limit with PURCHASE_LIMIT_EXCEEDED, and conflict / expire_before_checkout (purchase-start-only scenarios) do not matter", async () => {
    const limit = await demoBackend({ karaokeHold: "limit" });
    await expectReadOnly(limit, async () => {
      expect(await one(limit, SLOT.d1_1000)).toEqual({
        lineKey: `KARAOKE:${SLOT.d1_1000}`,
        purchasable: false,
        reasons: ["PURCHASE_LIMIT_EXCEEDED"],
        maxPurchasableQuantity: 0,
      });
    });
    for (const hold of ["conflict", "expire_before_checkout"] as const) {
      const backend = await demoBackend({ karaokeHold: hold });
      await expectReadOnly(backend, async () => {
        expect(await one(backend, SLOT.d1_1000), hold).toEqual({
          lineKey: `KARAOKE:${SLOT.d1_1000}`,
          purchasable: true,
          reasons: [],
          maxPurchasableQuantity: 1,
        });
      });
    }
  });

  it("(e) lists co-occurring reasons in the canonical order without a duplicate", async () => {
    const backend = await demoBackend({ karaokeSales: "SUSPENDED", karaokeHold: "limit" });
    await expectReadOnly(backend, async () => {
      expect(await one(backend, SLOT.d1_1020)).toEqual({
        lineKey: `KARAOKE:${SLOT.d1_1020}`,
        purchasable: false,
        reasons: ["SALES_STOPPED", "PURCHASE_LIMIT_EXCEEDED", "SLOT_UNAVAILABLE"],
        maxPurchasableQuantity: 0,
      });
    });
  });

  it("(f) answers an unknown slot with NOT_PUBLIC_OR_NOT_FOUND alone and a maximum of 0", async () => {
    const backend = await demoBackend();
    await expectReadOnly(backend, async () => {
      expect(await one(backend, UNKNOWN_SLOT)).toEqual({
        lineKey: `KARAOKE:${UNKNOWN_SLOT}`,
        purchasable: false,
        reasons: ["NOT_PUBLIC_OR_NOT_FOUND"],
        maxPurchasableQuantity: 0,
      });
    });
  });

  it("(g) never produces PAYMENT_WINDOW_TOO_SHORT (the mock has no payment window) and always holds the canonical order, purchasable === no reason, and a maximum of 0 or 1", async () => {
    for (const sales of ["ON_SALE", "BEFORE_SALES", "SALES_ENDED", "SUSPENDED"] as const) {
      for (const hold of ["ok", "conflict", "limit", "expire_before_checkout"] as const) {
        const backend = await demoBackend({ karaokeSales: sales, karaokeHold: hold });
        const data = await eligible(backend, [...allSlots, UNKNOWN_SLOT].map(karaoke));
        expect(data).toHaveLength(allSlots.length + 1);
        for (const item of data) {
          const where = `${sales}/${hold}/${item.lineKey}`;
          expect(item.reasons as readonly PurchaseReason[], where).not.toContain(
            "PAYMENT_WINDOW_TOO_SHORT",
          );
          expect(new Set(item.reasons).size, where).toBe(item.reasons.length);
          const ranks = item.reasons.map((reason) => PURCHASE_REASONS.indexOf(reason));
          expect(ranks, where).toEqual([...ranks].sort((a, b) => a - b));
          expect(item.purchasable, where).toBe(item.reasons.length === 0);
          expect(item.maxPurchasableQuantity, where).toBe(item.purchasable ? 1 : 0);
        }
      }
    }
  });

  it("(h) answers a mixed input of ENTRY, KARAOKE and GOODS in input order with each key", async () => {
    const backend = await demoBackend();
    const entry: CartLine = { kind: "ENTRY_TICKET", offeringRef: OFFERING.regular, quantity: 1 };
    const goods: CartLine = { kind: "GOODS", goodsRef: GOODS.tshirt, quantity: 1 };
    await expectReadOnly(backend, async () => {
      const data = await eligible(backend, [entry, karaoke(SLOT.d1_1000), goods]);
      expect(data.map((item) => item.lineKey)).toEqual([
        cartLineKey(entry),
        `KARAOKE:${SLOT.d1_1000}`,
        cartLineKey(goods),
      ]);
      expect(data.map((item) => item.purchasable)).toEqual([true, true, true]);
      expect(eligibilityTargetKey(karaoke(SLOT.d1_1000))).toBe(data[1]?.lineKey);
    });
  });

  it.each([
    ["quantity 2", [{ kind: "KARAOKE", slotRef: SLOT.d1_1000, quantity: 2 }]],
    ["quantity 0", [{ kind: "KARAOKE", slotRef: SLOT.d1_1000, quantity: 0 }]],
    ["quantity 1.5", [{ kind: "KARAOKE", slotRef: SLOT.d1_1000, quantity: 1.5 }]],
    [
      "the same slot twice",
      [
        { kind: "KARAOKE", slotRef: SLOT.d1_1000, quantity: 1 },
        { kind: "KARAOKE", slotRef: SLOT.d1_1000, quantity: 1 },
      ],
    ],
    ["no target", []],
  ])(
    "(i) rejects the promise for %s without changing state (programmer error)",
    async (_name, targets) => {
      const backend = await demoBackend();
      await expectReadOnly(backend, async () => {
        await expect(
          backend.api.purchase.getPurchaseEligibility(targets as readonly EligibilityTarget[]),
        ).rejects.toThrow(RangeError);
      });
    },
  );

  it("(i) accepts two different slots in one read", async () => {
    const backend = await demoBackend();
    const data = await eligible(backend, [karaoke(SLOT.d1_1000), karaoke(SLOT.d1_1020)]);
    expect(data.map((item) => item.lineKey)).toEqual([
      `KARAOKE:${SLOT.d1_1000}`,
      `KARAOKE:${SLOT.d1_1020}`,
    ]);
    expect(data.map((item) => item.purchasable)).toEqual([true, false]);
  });

  it("(j) is not a reservation: reading draws no id and creates no Order or Hold, and the slot stays AVAILABLE", async () => {
    const backend = await demoBackend();
    // The demo user already has seeded Orders: the read must leave exactly the same list (no Order is added).
    const ordersBefore = okData(await backend.api.self.listOrders());
    await expectReadOnly(backend, async () => {
      await eligible(backend, [karaoke(SLOT.d1_1000)]);
      await eligible(backend, [karaoke(SLOT.d1_1000)]);
    });
    expect(backend.ids.count()).toBe(0);
    expect(await slotState(backend, SLOT.d1_1000)).toBe("AVAILABLE");
    const ordersAfter = okData(await backend.api.self.listOrders());
    expect(ordersAfter).toHaveLength(ordersBefore.length);
    expect(ordersAfter).toEqual(ordersBefore);
  });

  it("(k) answers a guest with auth_required and an unverified user with email_unverified, and changes nothing", async () => {
    const guest = createBackend();
    await expectReadOnly(guest, async () => {
      expect(await guest.api.purchase.getPurchaseEligibility([karaoke(SLOT.d1_1000)])).toEqual({
        kind: "auth_required",
      });
    });
    const unverified = createBackend();
    await unverified.signInAs(EMAIL.unverified);
    await expectReadOnly(unverified, async () => {
      expect(await unverified.api.purchase.getPurchaseEligibility([karaoke(SLOT.d1_1000)])).toEqual(
        { kind: "email_unverified" },
      );
    });
  });

  it("(k) scenario cart.state eligibility_fail makes a verified user's KARAOKE read unavailable (every target) while the public slot read still works", async () => {
    const backend = await demoBackend();
    backend.setScenario({ cart: { state: "eligibility_fail" as const } });
    await expectReadOnly(backend, async () => {
      expect(await backend.api.purchase.getPurchaseEligibility([karaoke(SLOT.d1_1000)])).toEqual({
        kind: "unavailable",
      });
      expect(
        await backend.api.purchase.getPurchaseEligibility([
          { kind: "GOODS", goodsRef: GOODS.tshirt, quantity: 1 },
          karaoke(SLOT.d1_1000),
        ]),
      ).toEqual({ kind: "unavailable" });
    });
    expect(okData(await backend.api.public.getKaraokeSlot(SLOT.d1_1000)).purchasable).toBe(true);
  });

  it("(k) checks authentication before the eligibility_fail scenario (a guest never sees unavailable)", async () => {
    const guest = createBackend();
    guest.setScenario({ cart: { state: "eligibility_fail" as const } });
    expect(await guest.api.purchase.getPurchaseEligibility([karaoke(SLOT.d1_1000)])).toEqual({
      kind: "auth_required",
    });
  });
});
