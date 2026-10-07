import { describe, expect, it } from "vitest";
import type { Ref } from "../../../../apps/web/src/api-client/types.ts";
import type { ScenarioPatch } from "../../../harness/mock-backend.ts";
import {
  type Backend,
  createBackend,
  dbFingerprint,
  okData,
} from "../../../harness/mock-backend.ts";
import { D1, EMAIL, GOODS, SLOT } from "../../../harness/mock-seed.ts";

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
