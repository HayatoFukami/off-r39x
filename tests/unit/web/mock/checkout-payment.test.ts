import type { OrderState } from "@off-r39x/domain";
import { describe, expect, it } from "vitest";
import type { CartLine, Ref } from "../../../../apps/web/src/api-client/types.ts";
import type { Scenario } from "../../../../apps/web/src/mock/backend/scenario.ts";
import type { ScenarioPatch } from "../../../harness/mock-backend.ts";
import {
  type Backend,
  createBackend,
  dbFingerprint,
  okData,
} from "../../../harness/mock-backend.ts";
import { EMAIL, GOODS, OFFERING, ORDER } from "../../../harness/mock-seed.ts";

const entry = (offeringRef: Ref<"offering">, quantity: number): CartLine => ({
  kind: "ENTRY_TICKET",
  offeringRef,
  quantity,
});
const goods = (goodsRef: Ref<"goods">, quantity: number): CartLine => ({
  kind: "GOODS",
  goodsRef,
  quantity,
});

async function freshBackend(patch: ScenarioPatch = {}): Promise<Backend> {
  const backend = createBackend();
  backend.setScenario(patch);
  await backend.signInAs(EMAIL.fresh);
  return backend;
}

async function prepare(
  backend: Backend,
  lines: readonly CartLine[],
  key = "k-prepare",
): Promise<Ref<"order">> {
  const result = await backend.api.purchase.startCartPurchase(lines, { idempotencyKey: key });
  if (result.kind !== "created") throw new Error(`expected created but got ${result.kind}`);
  return result.orderRef;
}

async function stateOf(backend: Backend, orderRef: Ref<"order">): Promise<OrderState | null> {
  // listOrders is not a status read: it never advances the simulated webhook.
  const orders = okData(await backend.api.self.listOrders());
  return orders.find((o) => o.orderRef === orderRef)?.state ?? null;
}

async function remaining(
  backend: Backend,
): Promise<{ regular: number | null; tshirt: number | null }> {
  const offerings = okData(await backend.api.public.listEntryOfferings());
  const goodsList = okData(await backend.api.public.listGoods());
  const regular = offerings.find((o) => o.offeringRef === OFFERING.regular)?.availability;
  const tshirt = goodsList.find((g) => g.goodsRef === GOODS.tshirt)?.availability;
  return {
    regular: regular?.kind === "ON_SALE" ? regular.maxSelectableQuantity : -1,
    tshirt: tshirt?.kind === "ON_SALE" ? tshirt.maxSelectableQuantity : -1,
  };
}

const COMPOSITE = [entry(OFFERING.regular, 2), goods(GOODS.tshirt, 1)] as const;

describe("TC-PG-XFN-001-105 startCheckout hands off to the mock Checkout and never confirms (PAY-BRW-001, SEC-WEB-005)", () => {
  it("returns a relative top-level redirect for the same Order and moves it to AWAITING_PAYMENT", async () => {
    const backend = await freshBackend();
    const orderRef = await prepare(backend, COMPOSITE);
    const result = await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-1" });
    expect(result).toEqual({ kind: "redirect", url: `/dev/mock-checkout/${orderRef}` });
    expect(await stateOf(backend, orderRef)).toBe("AWAITING_PAYMENT");
  });

  it("does not create a second Order and does not grant entitlements by itself", async () => {
    const backend = await freshBackend();
    const orderRef = await prepare(backend, COMPOSITE);
    await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-1" });
    expect(okData(await backend.api.self.listOrders()).length).toBe(1);
    expect(okData(await backend.api.self.listEntryTickets())).toEqual([]);
    expect(okData(await backend.api.self.listGoodsItems()).map((i) => i.itemState)).toEqual([
      "PENDING_PAYMENT",
    ]);
  });

  it("replays the same redirect for the same idempotencyKey without another transition", async () => {
    const backend = await freshBackend();
    const orderRef = await prepare(backend, COMPOSITE);
    const first = await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-same" });
    const fingerprint = dbFingerprint(backend);
    const replay = await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-same" });
    expect(replay).toEqual(first);
    expect(dbFingerprint(backend)).toBe(fingerprint);
  });

  it("returns state_conflict for an Order that is no longer PREPARED (new key)", async () => {
    const backend = await freshBackend();
    const orderRef = await prepare(backend, COMPOSITE);
    await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-1" });
    expect(await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-2" })).toEqual({
      kind: "state_conflict",
    });
    expect(await stateOf(backend, orderRef)).toBe("AWAITING_PAYMENT");
  });
});

describe("TC-PG-XFN-001-102 Checkout start failure keeps the same PREPARED Order for a retry (SPEC-050 16.6, 21)", () => {
  it("start_failed leaves the Order PREPARED and a later retry reuses that Order", async () => {
    const backend = await freshBackend({ checkout: "start_failed" });
    const orderRef = await prepare(backend, COMPOSITE);
    const failed = await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-f" });
    expect(failed).toEqual({ kind: "start_failed" });
    expect(await stateOf(backend, orderRef)).toBe("PREPARED");
    const afterFail = await remaining(backend);
    expect(afterFail).toEqual({ regular: 2, tshirt: 19 });
    expect(okData(await backend.api.self.listOrders()).length).toBe(1);

    backend.setScenario({ checkout: "ok" });
    const retry = await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-r" });
    expect(retry).toEqual({ kind: "redirect", url: `/dev/mock-checkout/${orderRef}` });
    expect(okData(await backend.api.self.listOrders()).length).toBe(1);
    expect(await stateOf(backend, orderRef)).toBe("AWAITING_PAYMENT");
  });

  it("can fail repeatedly and still never create another Order", async () => {
    const backend = await freshBackend({ checkout: "start_failed" });
    const orderRef = await prepare(backend, COMPOSITE);
    for (const key of ["c-1", "c-2", "c-3"]) {
      expect(await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: key })).toEqual({
        kind: "start_failed",
      });
    }
    expect(okData(await backend.api.self.listOrders()).length).toBe(1);
    expect(await stateOf(backend, orderRef)).toBe("PREPARED");
  });
});

describe("TC-PG-XFN-001-103 opportunity_expired makes the Order terminal and releases the allocation (16.4, BR-ORD-016)", () => {
  it("moves the Order to EXPIRED, restores remaining and rejects a later checkout", async () => {
    const backend = await freshBackend({ checkout: "opportunity_expired" });
    const orderRef = await prepare(backend, COMPOSITE);
    expect(await remaining(backend)).toEqual({ regular: 2, tshirt: 19 });
    const result = await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-x" });
    expect(result).toEqual({ kind: "opportunity_expired" });
    expect(await stateOf(backend, orderRef)).toBe("EXPIRED");
    expect(await remaining(backend)).toEqual({ regular: 4, tshirt: 20 });

    backend.setScenario({ checkout: "ok" });
    expect(await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-y" })).toEqual({
      kind: "state_conflict",
    });
    const detail = okData(await backend.api.self.getOrder(orderRef));
    expect(detail.state).toBe("EXPIRED");
    expect(detail.entitlements).toEqual({
      entryTicketRefs: [],
      reservationRef: null,
      goodsItems: [],
    });
  });
});

describe("TC-PG-XFN-001-106 startCheckout authorization and ownership (SPEC-110 22, AR-AZ)", () => {
  it("returns auth_required for a guest and for an unverified user", async () => {
    const backend = createBackend();
    const result = await backend.api.purchase.startCheckout(ORDER.prepared, {
      idempotencyKey: "c-g",
    });
    expect(result).toEqual({ kind: "auth_required" });
    await backend.signInAs(EMAIL.unverified);
    const unverified = await backend.api.purchase.startCheckout(ORDER.prepared, {
      idempotencyKey: "c-u",
    });
    expect(unverified).toEqual({ kind: "auth_required" });
  });

  it("answers another user's Order and a nonexistent Order identically and changes nothing", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.fresh);
    const before = dbFingerprint(backend);
    const foreign = await backend.api.purchase.startCheckout(ORDER.otherEntry, {
      idempotencyKey: "c-o",
    });
    const missing = await backend.api.purchase.startCheckout(
      "66666666-6666-4666-8666-666666666666" as Ref<"order">,
      { idempotencyKey: "c-m" },
    );
    expect(foreign).toEqual({ kind: "state_conflict" });
    expect(missing).toEqual(foreign);
    expect(dbFingerprint(backend)).toBe(before);
  });
});

describe("TC-PAY-BRW-001-101 Browser Return never confirms: default confirm_after_recheck (PAY-BRW-001..003, 16.3)", () => {
  it("shows AWAITING_PAYMENT without entitlements on the first read and CONFIRMED on the recheck", async () => {
    const backend = await freshBackend();
    const orderRef = await prepare(backend, COMPOSITE);
    await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-1" });

    const first = okData(await backend.api.self.getOrder(orderRef));
    expect(first.state).toBe("AWAITING_PAYMENT");
    expect(first.entitlements).toEqual({
      entryTicketRefs: [],
      reservationRef: null,
      goodsItems: [],
    });
    expect(first.receiptUrl).toBeNull();
    expect(okData(await backend.api.self.listEntryTickets())).toEqual([]);

    const second = okData(await backend.api.self.getOrder(orderRef));
    expect(second.state).toBe("CONFIRMED");
    expect(second.entitlements.entryTicketRefs.length).toBe(2);
    expect(second.receiptUrl).toMatch(/^https:\/\//);

    const third = okData(await backend.api.self.getOrder(orderRef));
    expect(third).toEqual(second);
  });

  it("never creates another Order while rereading (PAY-BRW-002)", async () => {
    const backend = await freshBackend();
    const orderRef = await prepare(backend, COMPOSITE);
    await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-1" });
    for (let i = 0; i < 4; i += 1) await backend.api.self.getOrder(orderRef);
    expect(okData(await backend.api.self.listOrders()).length).toBe(1);
  });

  it("applies each Order's own read count (another Order starts again at AWAITING_PAYMENT)", async () => {
    const backend = await freshBackend();
    const a = await prepare(backend, [goods(GOODS.tshirt, 1)], "k-a");
    const b = await prepare(backend, [goods(GOODS.tshirt, 1)], "k-b");
    await backend.api.purchase.startCheckout(a, { idempotencyKey: "c-a" });
    await backend.api.purchase.startCheckout(b, { idempotencyKey: "c-b" });
    expect(okData(await backend.api.self.getOrder(a)).state).toBe("AWAITING_PAYMENT");
    expect(okData(await backend.api.self.getOrder(a)).state).toBe("CONFIRMED");
    expect(okData(await backend.api.self.getOrder(b)).state).toBe("AWAITING_PAYMENT");
  });
});

describe("TC-PAY-BRW-001-102 payment outcome only changes through the scenario (PAY-BRW-001/003, 16.4, 21)", () => {
  type Row = {
    outcome: Scenario["paymentOutcome"];
    reads: OrderState[];
    released: boolean;
  };
  const rows: Row[] = [
    { outcome: "confirm", reads: ["CONFIRMED", "CONFIRMED"], released: false },
    {
      outcome: "remain_awaiting",
      reads: ["AWAITING_PAYMENT", "AWAITING_PAYMENT", "AWAITING_PAYMENT"],
      released: false,
    },
    { outcome: "payment_failed", reads: ["PAYMENT_FAILED", "PAYMENT_FAILED"], released: true },
    { outcome: "review_required", reads: ["REVIEW_REQUIRED", "REVIEW_REQUIRED"], released: false },
    { outcome: "expire", reads: ["EXPIRED", "EXPIRED"], released: true },
    { outcome: "cancel", reads: ["CANCELED", "CANCELED"], released: true },
  ];

  it.each(rows)("$outcome -> $reads", async ({ outcome, reads, released }) => {
    const backend = await freshBackend({ paymentOutcome: outcome });
    const orderRef = await prepare(backend, COMPOSITE);
    await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-1" });
    // The Browser Return alone (startCheckout) never decided the outcome.
    expect(await stateOf(backend, orderRef)).toBe("AWAITING_PAYMENT");
    const seen: OrderState[] = [];
    for (let i = 0; i < reads.length; i += 1) {
      seen.push(okData(await backend.api.self.getOrder(orderRef)).state);
    }
    expect(seen).toEqual(reads);
    expect(okData(await backend.api.self.listOrders()).length).toBe(1);
    const final = reads[reads.length - 1];
    expect(await stateOf(backend, orderRef)).toBe(final);
    const detail = okData(await backend.api.self.getOrder(orderRef));
    if (final === "CONFIRMED") {
      expect(detail.entitlements.entryTicketRefs.length).toBe(2);
    } else {
      expect(detail.entitlements).toEqual({
        entryTicketRefs: [],
        reservationRef: null,
        goodsItems: [],
      });
    }
    expect(await remaining(backend)).toEqual(
      released ? { regular: 4, tshirt: 20 } : { regular: 2, tshirt: 19 },
    );
  });

  it("evaluates the scenario at read time: a switch to confirm applies to the next read", async () => {
    const backend = await freshBackend({ paymentOutcome: "remain_awaiting" });
    const orderRef = await prepare(backend, COMPOSITE);
    await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-1" });
    expect(okData(await backend.api.self.getOrder(orderRef)).state).toBe("AWAITING_PAYMENT");
    backend.setScenario({ paymentOutcome: "confirm" });
    expect(okData(await backend.api.self.getOrder(orderRef)).state).toBe("CONFIRMED");
  });
});

describe("TC-PAY-BRW-002-101 reads never create Orders or advance seeded Orders (PAY-BRW-002, 22)", () => {
  it("keeps seeded AWAITING_PAYMENT and REVIEW_REQUIRED Orders unchanged under every outcome", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.demo);
    backend.setScenario({ paymentOutcome: "confirm" });
    for (let i = 0; i < 3; i += 1) {
      expect(okData(await backend.api.self.getOrder(ORDER.awaiting)).state).toBe(
        "AWAITING_PAYMENT",
      );
      expect(okData(await backend.api.self.getOrder(ORDER.review)).state).toBe("REVIEW_REQUIRED");
      expect(okData(await backend.api.self.getOrder(ORDER.prepared)).state).toBe("PREPARED");
    }
  });

  it("changes no stored state when rereading a terminal Order and generates no new id", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.demo);
    await backend.api.self.getOrder(ORDER.confirmedEntry);
    const before = dbFingerprint(backend);
    const ids = backend.ids.count();
    const count = okData(await backend.api.self.listOrders()).length;
    for (let i = 0; i < 3; i += 1) {
      await backend.api.self.getOrder(ORDER.confirmedEntry);
      await backend.api.self.getOrder(ORDER.paymentFailed);
      await backend.api.self.listEntryTickets();
    }
    expect(dbFingerprint(backend)).toBe(before);
    expect(backend.ids.count()).toBe(ids);
    expect(okData(await backend.api.self.listOrders()).length).toBe(count);
  });
});

describe("TC-BR-ORD-015-101 composite Order confirmation yields both Entry tickets and goods items (BR-ORD-015, INV-010-07)", () => {
  it("returns entitlements for both kinds only when CONFIRMED", async () => {
    const backend = await freshBackend({ paymentOutcome: "confirm" });
    const orderRef = await prepare(backend, COMPOSITE);
    await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-1" });
    const detail = okData(await backend.api.self.getOrder(orderRef));
    expect(detail.state).toBe("CONFIRMED");
    expect(detail.purpose).toBe("ENTRY_GOODS_PURCHASE");
    expect(detail.entitlements.entryTicketRefs.length).toBe(2);
    expect(detail.entitlements.reservationRef).toBeNull();
    expect(detail.entitlements.goodsItems.length).toBe(1);
    expect(detail.entitlements.goodsItems[0]).toMatchObject({
      itemState: "FULFILLABLE",
      handoffState: "PENDING",
    });
    const tickets = okData(await backend.api.self.listEntryTickets());
    expect(tickets.map((t) => t.state)).toEqual(["VALID", "VALID"]);
    expect(new Set(tickets.map((t) => t.orderRef))).toEqual(new Set([orderRef]));
    expect(tickets.map((t) => t.ticketRef).sort()).toEqual(
      [...detail.entitlements.entryTicketRefs].sort(),
    );
  });

  it("returns neither kind for a composite Order that is not CONFIRMED (not even partially)", async () => {
    for (const outcome of ["remain_awaiting", "review_required", "payment_failed"] as const) {
      const backend = await freshBackend({ paymentOutcome: outcome });
      const orderRef = await prepare(backend, COMPOSITE);
      await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-1" });
      const detail = okData(await backend.api.self.getOrder(orderRef));
      expect(detail.purpose).toBe("ENTRY_GOODS_PURCHASE");
      expect(detail.entitlements, outcome).toEqual({
        entryTicketRefs: [],
        reservationRef: null,
        goodsItems: [],
      });
      expect(okData(await backend.api.self.listEntryTickets()), outcome).toEqual([]);
    }
  });

  it("derives goods item states from the Order state (PENDING_PAYMENT / CANCELED+VOID / FULFILLABLE)", async () => {
    const pending = await freshBackend({ paymentOutcome: "remain_awaiting" });
    const a = await prepare(pending, [goods(GOODS.tshirt, 1)]);
    await pending.api.purchase.startCheckout(a, { idempotencyKey: "c-1" });
    await pending.api.self.getOrder(a);
    expect(
      okData(await pending.api.self.listGoodsItems()).map((i) => [i.itemState, i.handoffState]),
    ).toEqual([["PENDING_PAYMENT", "PENDING"]]);

    const failed = await freshBackend({ paymentOutcome: "payment_failed" });
    const b = await prepare(failed, [goods(GOODS.tshirt, 1)]);
    await failed.api.purchase.startCheckout(b, { idempotencyKey: "c-1" });
    await failed.api.self.getOrder(b);
    expect(
      okData(await failed.api.self.listGoodsItems()).map((i) => [i.itemState, i.handoffState]),
    ).toEqual([["CANCELED", "VOID"]]);
  });
});

describe("TC-PG-XFN-001-104 Email failure is a non-blocking notice on a confirmed Order (SPEC-050 16.7, 20.5)", () => {
  async function confirmed(
    patch: ScenarioPatch,
  ): Promise<{ backend: Backend; orderRef: Ref<"order"> }> {
    const backend = await freshBackend({ paymentOutcome: "confirm", ...patch });
    const orderRef = await prepare(backend, COMPOSITE);
    await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-1" });
    return { backend, orderRef };
  }

  it("returns notice email_delayed while keeping CONFIRMED and all entitlements", async () => {
    const { backend, orderRef } = await confirmed({ notification: "failed_retryable" });
    const detail = okData(await backend.api.self.getOrder(orderRef));
    expect(detail.state).toBe("CONFIRMED");
    expect(detail.notice).toEqual({ kind: "email_delayed" });
    expect(detail.entitlements.entryTicketRefs.length).toBe(2);
    expect(detail.entitlements.goodsItems.length).toBe(1);
  });

  it("returns no notice when the notification was sent", async () => {
    const { backend, orderRef } = await confirmed({ notification: "sent" });
    expect(okData(await backend.api.self.getOrder(orderRef)).notice).toBeNull();
  });

  it("returns no notice for an Order that is not CONFIRMED", async () => {
    const backend = await freshBackend({
      paymentOutcome: "remain_awaiting",
      notification: "failed_retryable",
    });
    const orderRef = await prepare(backend, COMPOSITE);
    await backend.api.purchase.startCheckout(orderRef, { idempotencyKey: "c-1" });
    const detail = okData(await backend.api.self.getOrder(orderRef));
    expect(detail.state).toBe("AWAITING_PAYMENT");
    expect(detail.notice).toBeNull();
  });

  it("applies to seeded CONFIRMED Orders at read time and never changes their state", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.demo);
    backend.setScenario({ notification: "failed_retryable" });
    const detail = okData(await backend.api.self.getOrder(ORDER.confirmedGoods));
    expect(detail.state).toBe("CONFIRMED");
    expect(detail.notice).toEqual({ kind: "email_delayed" });
    expect(okData(await backend.api.self.getOrder(ORDER.prepared)).notice).toBeNull();
  });
});
