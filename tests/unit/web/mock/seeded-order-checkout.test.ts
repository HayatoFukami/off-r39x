import { describe, expect, it } from "vitest";
import { createBackend, dbFingerprint, okData } from "../../../harness/mock-backend.ts";
import { EMAIL, ORDER } from "../../../harness/mock-seed.ts";

// UI mock fidelity (test double, not critical): the Purchase Status page's "支払い開始を再試行" button must work on a
// seeded PREPARED Order exactly as on one created in the session (tests/contracts/s7a-purchase.md section 6.2;
// S2 contract 11.3 / 11.4; SPEC-050 16.4 / 16.6). This is an S2 extension check, not new mock behaviour.

async function demo() {
  const backend = createBackend();
  await backend.signInAs(EMAIL.demo);
  return backend;
}

const orderCount = (backend: Awaited<ReturnType<typeof demo>>): number => {
  const loaded = backend.db.load();
  if (loaded.kind !== "ready") throw new Error("expected a ready DB");
  return loaded.state.orders.length;
};

describe("TC-PG-XFN-001-655 a seeded PREPARED Order can be retried into Checkout and then confirmed by recheck (SPEC-050 16.4, 16.6, PAY-BRW-001)", () => {
  it("startCheckout on the seeded PREPARED Order redirects to the mock Checkout of the same Order and creates no Order", async () => {
    const backend = await demo();
    const before = orderCount(backend);
    const result = await backend.api.purchase.startCheckout(ORDER.prepared, {
      idempotencyKey: "retry-1",
    });
    expect(result).toEqual({ kind: "redirect", url: `/dev/mock-checkout/${ORDER.prepared}` });
    expect(orderCount(backend)).toBe(before);
    const orders = okData(await backend.api.self.listOrders());
    expect(orders.find((o) => o.orderRef === ORDER.prepared)?.state).toBe("AWAITING_PAYMENT");
  });

  it("the first read after the retry is AWAITING_PAYMENT without entitlements, the recheck is CONFIRMED with the ticket", async () => {
    const backend = await demo();
    await backend.api.purchase.startCheckout(ORDER.prepared, { idempotencyKey: "retry-2" });
    const first = okData(await backend.api.self.getOrder(ORDER.prepared));
    expect(first.state).toBe("AWAITING_PAYMENT");
    expect(first.entitlements).toEqual({
      entryTicketRefs: [],
      reservationRef: null,
      goodsItems: [],
    });
    const second = okData(await backend.api.self.getOrder(ORDER.prepared));
    expect(second.state).toBe("CONFIRMED");
    expect(second.entitlements.entryTicketRefs).toHaveLength(1);
  });

  it("a failed retry keeps the seeded Order PREPARED and changes nothing; a later retry succeeds on the same Order", async () => {
    const backend = await demo();
    backend.setScenario({ checkout: "start_failed" });
    const before = dbFingerprint(backend);
    const failed = await backend.api.purchase.startCheckout(ORDER.prepared, {
      idempotencyKey: "retry-3",
    });
    expect(failed).toEqual({ kind: "start_failed" });
    expect(dbFingerprint(backend)).toBe(before);
    backend.setScenario({ checkout: "ok" });
    const retried = await backend.api.purchase.startCheckout(ORDER.prepared, {
      idempotencyKey: "retry-4",
    });
    expect(retried).toEqual({ kind: "redirect", url: `/dev/mock-checkout/${ORDER.prepared}` });
  });

  it("a seeded terminal Order cannot be pushed into Checkout (state_conflict, nothing changes)", async () => {
    const backend = await demo();
    const before = dbFingerprint(backend);
    for (const orderRef of [ORDER.paymentFailed, ORDER.canceled, ORDER.expired]) {
      const result = await backend.api.purchase.startCheckout(orderRef, {
        idempotencyKey: `terminal-${orderRef}`,
      });
      expect(result, orderRef).toEqual({ kind: "state_conflict" });
    }
    expect(dbFingerprint(backend)).toBe(before);
  });

  it("another user's PREPARED-looking Order cannot be retried (answered like a missing Order)", async () => {
    const backend = await demo();
    const before = dbFingerprint(backend);
    const other = await backend.api.purchase.startCheckout(ORDER.otherEntry, {
      idempotencyKey: "other-1",
    });
    const missing = await backend.api.purchase.startCheckout(
      "0d000000-0000-4000-8000-0000000009ff" as typeof ORDER.otherEntry,
      { idempotencyKey: "other-2" },
    );
    expect(other).toEqual(missing);
    expect(dbFingerprint(backend)).toBe(before);
  });
});
