import { describe, expect, it } from "vitest";
import { cartLineKey } from "../../../../apps/web/src/api-client/cart-line-key.ts";
import type { CartLine, Ref } from "../../../../apps/web/src/api-client/types.ts";
import {
  type Backend,
  createBackend,
  dbFingerprint,
  okData,
} from "../../../harness/mock-backend.ts";
import { EMAIL, GOODS, OFFERING } from "../../../harness/mock-seed.ts";

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

async function freshBackend(): Promise<Backend> {
  const backend = createBackend();
  await backend.signInAs(EMAIL.fresh);
  return backend;
}

async function regularMax(backend: Backend): Promise<number | null> {
  const offerings = okData(await backend.api.public.listEntryOfferings());
  const regular = offerings.find((o) => o.offeringRef === OFFERING.regular);
  return regular?.availability.kind === "ON_SALE" ? regular.availability.maxSelectableQuantity : -1;
}

async function tshirtMax(backend: Backend): Promise<number | null> {
  const list = okData(await backend.api.public.listGoods());
  const item = list.find((g) => g.goodsRef === GOODS.tshirt);
  return item?.availability.kind === "ON_SALE" ? item.availability.maxSelectableQuantity : -1;
}

describe("TC-BR-ORD-013-102 purpose is decided by the server side from the Order items (BR-ORD-013)", () => {
  it.each([
    ["Entry only", [entry(OFFERING.regular, 1)], "ENTRY_TICKET_PURCHASE"],
    ["Goods only", [goods(GOODS.tshirt, 1)], "GOODS_PURCHASE"],
    [
      "Entry and Goods",
      [goods(GOODS.tshirt, 1), entry(OFFERING.regular, 1)],
      "ENTRY_GOODS_PURCHASE",
    ],
  ] as const)("%s -> %s", async (_name, lines, purpose) => {
    const backend = await freshBackend();
    const result = await backend.api.purchase.startCartPurchase(lines, { idempotencyKey: "k-1" });
    if (result.kind !== "created") throw new Error(`expected created but got ${result.kind}`);
    const detail = okData(await backend.api.self.getOrder(result.orderRef));
    expect(detail.purpose).toBe(purpose);
    expect(detail.state).toBe("PREPARED");
    // The Cart never carries Karaoke: a cart Order is never a KARAOKE_PURCHASE.
    expect(detail.purpose).not.toBe("KARAOKE_PURCHASE");
  });
});

describe("TC-BR-ORD-014-101 all-or-nothing purchase start (BR-ORD-014, FR-CRT-007, SPEC-050 14A.1)", () => {
  it("creates no Order and changes no allocation, inventory or stored state when one line is rejected", async () => {
    const backend = await freshBackend();
    const before = dbFingerprint(backend);
    const regularBefore = await regularMax(backend);
    const tshirtBefore = await tshirtMax(backend);
    const lines = [
      entry(OFFERING.regular, 2),
      goods(GOODS.tshirt, 1),
      entry(OFFERING.suspended, 1),
    ];
    const result = await backend.api.purchase.startCartPurchase(lines, { idempotencyKey: "k-aon" });
    expect(result).toEqual({
      kind: "rejected",
      rejections: [{ lineKey: cartLineKey(lines[2] as CartLine), reason: "SUSPENDED" }],
    });
    expect(dbFingerprint(backend)).toBe(before);
    expect(okData(await backend.api.self.listOrders())).toEqual([]);
    expect(await regularMax(backend)).toBe(regularBefore);
    expect(await tshirtMax(backend)).toBe(tshirtBefore);
  });

  it("lists every failing line (and only those) in input order with the correct reason", async () => {
    const backend = await freshBackend();
    const unknownGoods = "55555555-5555-4555-8555-555555555555" as Ref<"goods">;
    const lines = [
      entry(OFFERING.early, 1),
      goods(GOODS.tshirt, 1),
      entry(OFFERING.ended, 1),
      entry(OFFERING.suspended, 1),
      entry(OFFERING.soldout, 1),
      goods(GOODS.towel, 4),
      entry(OFFERING.regular, 5),
      goods(GOODS.hidden, 1),
      goods(unknownGoods, 1),
    ];
    const result = await backend.api.purchase.startCartPurchase(lines, { idempotencyKey: "k-all" });
    expect(result).toEqual({
      kind: "rejected",
      rejections: [
        { lineKey: cartLineKey(lines[0] as CartLine), reason: "BEFORE_SALES" },
        { lineKey: cartLineKey(lines[2] as CartLine), reason: "SALES_ENDED" },
        { lineKey: cartLineKey(lines[3] as CartLine), reason: "SUSPENDED" },
        { lineKey: cartLineKey(lines[4] as CartLine), reason: "SOLD_OUT" },
        { lineKey: cartLineKey(lines[5] as CartLine), reason: "INSUFFICIENT_QUANTITY" },
        { lineKey: cartLineKey(lines[6] as CartLine), reason: "PURCHASE_LIMIT_EXCEEDED" },
        { lineKey: cartLineKey(lines[7] as CartLine), reason: "NOT_PUBLIC" },
        { lineKey: cartLineKey(lines[8] as CartLine), reason: "NOT_PUBLIC" },
      ],
    });
  });

  it("rejects with PURCHASE_LIMIT_EXCEEDED for a viewer who already used the limit", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.demo);
    const line = entry(OFFERING.limit, 1);
    const result = await backend.api.purchase.startCartPurchase([line], {
      idempotencyKey: "k-lim",
    });
    expect(result).toEqual({
      kind: "rejected",
      rejections: [{ lineKey: cartLineKey(line), reason: "PURCHASE_LIMIT_EXCEEDED" }],
    });
  });

  it("reject_one scenario rejects the first line with ALLOCATION_CONFLICT and changes nothing", async () => {
    const backend = await freshBackend();
    backend.setScenario({ cart: { purchaseStart: "reject_one" } });
    const before = dbFingerprint(backend);
    const lines = [entry(OFFERING.regular, 1), goods(GOODS.tshirt, 1)];
    const result = await backend.api.purchase.startCartPurchase(lines, { idempotencyKey: "k-r1" });
    expect(result).toEqual({
      kind: "rejected",
      rejections: [{ lineKey: cartLineKey(lines[0] as CartLine), reason: "ALLOCATION_CONFLICT" }],
    });
    expect(dbFingerprint(backend)).toBe(before);
  });

  it("reject_one also reports a natural rejection on another line", async () => {
    const backend = await freshBackend();
    backend.setScenario({ cart: { purchaseStart: "reject_one" } });
    const lines = [entry(OFFERING.regular, 1), entry(OFFERING.suspended, 1)];
    const result = await backend.api.purchase.startCartPurchase(lines, { idempotencyKey: "k-r2" });
    expect(result).toEqual({
      kind: "rejected",
      rejections: [
        { lineKey: cartLineKey(lines[0] as CartLine), reason: "ALLOCATION_CONFLICT" },
        { lineKey: cartLineKey(lines[1] as CartLine), reason: "SUSPENDED" },
      ],
    });
  });

  it("limit scenario rejects the first line with PURCHASE_LIMIT_EXCEEDED and changes nothing", async () => {
    const backend = await freshBackend();
    backend.setScenario({ cart: { purchaseStart: "limit" } });
    const before = dbFingerprint(backend);
    const lines = [goods(GOODS.tshirt, 1)];
    const result = await backend.api.purchase.startCartPurchase(lines, { idempotencyKey: "k-l1" });
    expect(result).toEqual({
      kind: "rejected",
      rejections: [
        { lineKey: cartLineKey(lines[0] as CartLine), reason: "PURCHASE_LIMIT_EXCEEDED" },
      ],
    });
    expect(dbFingerprint(backend)).toBe(before);
  });

  it("unavailable scenario returns unavailable and changes nothing", async () => {
    const backend = await freshBackend();
    backend.setScenario({ cart: { purchaseStart: "unavailable" } });
    const before = dbFingerprint(backend);
    const result = await backend.api.purchase.startCartPurchase([entry(OFFERING.regular, 1)], {
      idempotencyKey: "k-un",
    });
    expect(result).toEqual({ kind: "unavailable" });
    expect(dbFingerprint(backend)).toBe(before);
  });
});

describe("TC-BR-ORD-014-102 a successful purchase start persists one Order with a price Snapshot (BR-ORD-014/018)", () => {
  it("creates one PREPARED Order, takes the allocation and sums the Snapshot prices", async () => {
    const backend = await freshBackend();
    const lines = [entry(OFFERING.regular, 2), goods(GOODS.tshirt, 1)];
    const result = await backend.api.purchase.startCartPurchase(lines, { idempotencyKey: "k-ok" });
    if (result.kind !== "created") throw new Error(`expected created but got ${result.kind}`);
    expect(result.orderRef).toMatch(/^f0000000-0000-4000-8000-[0-9]{12}$/);
    expect(result.includedLineKeys).toEqual(lines.map(cartLineKey));

    const orders = okData(await backend.api.self.listOrders());
    expect(orders.map((o) => [o.orderRef, o.state, o.purpose])).toEqual([
      [result.orderRef, "PREPARED", "ENTRY_GOODS_PURCHASE"],
    ]);

    const detail = okData(await backend.api.self.getOrder(result.orderRef));
    expect(detail.total).toEqual({ amount: "10000", currency: "JPY" });
    expect(detail.createdAt).toBe(backend.clock.now());
    expect(detail.items.map((i) => i.kind)).toEqual(["ENTRY_TICKET", "GOODS"]);
    expect(detail.items[0]).toMatchObject({
      quantity: 2,
      unitPrice: { amount: "3000", currency: "JPY" },
      subtotal: { amount: "6000", currency: "JPY" },
    });
    expect(detail.items[1]).toMatchObject({
      quantity: 1,
      unitPrice: { amount: "4000", currency: "JPY" },
      subtotal: { amount: "4000", currency: "JPY" },
    });
    expect(detail.entitlements).toEqual({
      entryTicketRefs: [],
      reservationRef: null,
      goodsItems: [],
    });

    // The allocation is held: remaining 10 -> 8 for the offering, the per-account quota 4 -> 2.
    expect(await regularMax(backend)).toBe(2);
    expect(await tshirtMax(backend)).toBe(19);
  });

  it("counts a PREPARED Order toward the per-account quota", async () => {
    const backend = await freshBackend();
    const first = await backend.api.purchase.startCartPurchase([entry(OFFERING.regular, 4)], {
      idempotencyKey: "k-q1",
    });
    expect(first.kind).toBe("created");
    const offerings = okData(await backend.api.public.listEntryOfferings());
    expect(offerings.find((o) => o.offeringRef === OFFERING.regular)?.availability).toEqual({
      kind: "PURCHASE_LIMIT_EXCEEDED",
    });
    const second = await backend.api.purchase.startCartPurchase([entry(OFFERING.regular, 1)], {
      idempotencyKey: "k-q2",
    });
    expect(second).toMatchObject({ kind: "rejected" });
  });

  it("shows SOLD_OUT once the whole remaining quantity is allocated", async () => {
    const backend = await freshBackend();
    const first = await backend.api.purchase.startCartPurchase([goods(GOODS.towel, 3)], {
      idempotencyKey: "k-t1",
    });
    expect(first.kind).toBe("created");
    const list = okData(await backend.api.public.listGoods());
    expect(list.find((g) => g.goodsRef === GOODS.towel)?.availability).toEqual({
      kind: "SOLD_OUT",
    });
  });
});

describe("TC-PG-CRT-001-103 idempotencyKey replay returns the same Order (design section 4, FR-XFN-012)", () => {
  it("returns the same orderRef and creates no second Order or second allocation", async () => {
    const backend = await freshBackend();
    const lines = [entry(OFFERING.regular, 2)];
    const first = await backend.api.purchase.startCartPurchase(lines, { idempotencyKey: "k-idem" });
    const idsAfterFirst = backend.ids.count();
    const fingerprint = dbFingerprint(backend);
    const second = await backend.api.purchase.startCartPurchase(lines, {
      idempotencyKey: "k-idem",
    });
    expect(second).toEqual(first);
    expect(okData(await backend.api.self.listOrders()).length).toBe(1);
    expect(backend.ids.count()).toBe(idsAfterFirst);
    expect(dbFingerprint(backend)).toBe(fingerprint);
    expect(await regularMax(backend)).toBe(2);
  });

  it("returns the first result even if the replay carries other lines", async () => {
    const backend = await freshBackend();
    const first = await backend.api.purchase.startCartPurchase([entry(OFFERING.regular, 1)], {
      idempotencyKey: "k-same",
    });
    const replay = await backend.api.purchase.startCartPurchase([goods(GOODS.tshirt, 1)], {
      idempotencyKey: "k-same",
    });
    expect(replay).toEqual(first);
    expect(okData(await backend.api.self.listOrders()).length).toBe(1);
  });

  it("creates a second Order for a different key", async () => {
    const backend = await freshBackend();
    const a = await backend.api.purchase.startCartPurchase([entry(OFFERING.regular, 1)], {
      idempotencyKey: "k-a",
    });
    const b = await backend.api.purchase.startCartPurchase([entry(OFFERING.regular, 1)], {
      idempotencyKey: "k-b",
    });
    expect(a.kind).toBe("created");
    expect(b.kind).toBe("created");
    expect(a).not.toEqual(b);
    expect(okData(await backend.api.self.listOrders()).length).toBe(2);
  });

  it("scopes a key to the user: another user with the same key gets their own Order", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.fresh);
    const mine = await backend.api.purchase.startCartPurchase([goods(GOODS.tshirt, 1)], {
      idempotencyKey: "shared-key",
    });
    await backend.signOut();
    await backend.signInAs(EMAIL.demo);
    const theirs = await backend.api.purchase.startCartPurchase([goods(GOODS.tshirt, 1)], {
      idempotencyKey: "shared-key",
    });
    expect(mine.kind).toBe("created");
    expect(theirs.kind).toBe("created");
    expect(theirs).not.toEqual(mine);
  });

  it("does not memoize a rejection: the same key is evaluated again", async () => {
    const backend = await freshBackend();
    backend.setScenario({ cart: { purchaseStart: "reject_one" } });
    const lines = [entry(OFFERING.regular, 1)];
    const rejected = await backend.api.purchase.startCartPurchase(lines, {
      idempotencyKey: "k-re",
    });
    expect(rejected.kind).toBe("rejected");
    backend.setScenario({ cart: { purchaseStart: "ok" } });
    const created = await backend.api.purchase.startCartPurchase(lines, { idempotencyKey: "k-re" });
    expect(created.kind).toBe("created");
  });
});

describe("TC-AR-AZ-011-101 purchase start requires a verified authenticated session (AR-AUTH, AR-AZ-011)", () => {
  it("returns auth_required for a guest and changes nothing", async () => {
    const backend = createBackend();
    const before = dbFingerprint(backend);
    const result = await backend.api.purchase.startCartPurchase([entry(OFFERING.regular, 1)], {
      idempotencyKey: "k-g",
    });
    expect(result).toEqual({ kind: "auth_required" });
    expect(dbFingerprint(backend)).toBe(before);
  });

  it("returns email_unverified for an unverified user and changes nothing", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.unverified);
    const before = dbFingerprint(backend);
    const result = await backend.api.purchase.startCartPurchase([entry(OFFERING.regular, 1)], {
      idempotencyKey: "k-u",
    });
    expect(result).toEqual({ kind: "email_unverified" });
    expect(dbFingerprint(backend)).toBe(before);
  });

  it("checks authentication before the scenario (a guest never sees unavailable)", async () => {
    const backend = createBackend();
    backend.setScenario({ cart: { purchaseStart: "unavailable" } });
    const result = await backend.api.purchase.startCartPurchase([entry(OFFERING.regular, 1)], {
      idempotencyKey: "k-gs",
    });
    expect(result).toEqual({ kind: "auth_required" });
  });
});

describe("TC-PG-CRT-001-104 invalid purchase input is a programmer error, not a business result", () => {
  it.each([
    ["no lines", [] as CartLine[]],
    ["quantity 0", [entry(OFFERING.regular, 0)]],
    ["negative quantity", [entry(OFFERING.regular, -1)]],
    ["fractional quantity", [entry(OFFERING.regular, 1.5)]],
  ])("rejects the promise for %s without changing state", async (_name, lines) => {
    const backend = await freshBackend();
    const before = dbFingerprint(backend);
    await expect(
      backend.api.purchase.startCartPurchase(lines, { idempotencyKey: "k-bad" }),
    ).rejects.toThrow(RangeError);
    expect(dbFingerprint(backend)).toBe(before);
  });
});
