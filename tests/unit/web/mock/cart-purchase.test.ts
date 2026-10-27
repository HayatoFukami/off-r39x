import { describe, expect, it } from "vitest";
import { cartLineKey } from "../../../../apps/web/src/api-client/cart-line-key.ts";
import type { CartLine, PurchaseReason, Ref } from "../../../../apps/web/src/api-client/types.ts";
import {
  type Backend,
  createBackend,
  dbFingerprint,
  okData,
} from "../../../harness/mock-backend.ts";
import { EMAIL, GOODS, NOW_ISO, OFFERING } from "../../../harness/mock-seed.ts";
import { PURCHASE_REASONS } from "../../../harness/purchase-reasons.ts";

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

const MAX_QUANTITY = 2147483647;

/** A well-formed ref that no seed row uses (SPEC-110: an unknown target is a business failure, not a 404). */
const unknownGoods = (n: number): Ref<"goods"> =>
  `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}` as Ref<"goods">;

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

/** Replaces part of the stored mock DB before the call under test (the schema is validated on save). */
function editDb(backend: Backend, edit: (state: ReadyState) => void): void {
  const loaded = backend.db.load();
  if (loaded.kind !== "ready") throw new Error("expected a ready DB");
  edit(loaded.state);
  backend.db.save(loaded.state);
}
type ReadyState = Extract<ReturnType<Backend["db"]["load"]>, { kind: "ready" }>["state"];

function offeringRow(state: ReadyState, ref: string): ReadyState["offerings"][number] {
  const row = state.offerings.find((o) => o.ref === ref);
  if (row === undefined) throw new Error(`unknown offering ${ref}`);
  return row;
}

/** Every reasons list has at least one reason, no duplicates and follows the SPEC-110 canonical order. */
function expectCanonicalReasons(reasons: readonly PurchaseReason[]): void {
  expect(reasons.length).toBeGreaterThan(0);
  expect(new Set(reasons).size).toBe(reasons.length);
  const ranks = reasons.map((r) => PURCHASE_REASONS.indexOf(r));
  expect(ranks.every((rank) => rank >= 0)).toBe(true);
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
}

type Failure = { lineKey: string; reasons: readonly PurchaseReason[] };

/** The itemFailures of a rejected start, or a failing test naming the unexpected kind. */
function failuresOf(result: { kind: string }): Failure[] {
  const rejected = result as { kind: string; itemFailures?: Failure[] };
  if (rejected.kind !== "rejected" || rejected.itemFailures === undefined) {
    throw new Error(
      `expected rejected with itemFailures but got ${rejected.kind} with keys [${Object.keys(result).join(", ")}]`,
    );
  }
  return rejected.itemFailures;
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

describe("TC-BR-ORD-014-101 all-or-nothing purchase start with item failures (BR-ORD-014, FR-CRT-007, API-PUR-CART-001, SPEC-050 14A.1)", () => {
  it("creates no Order and changes no allocation, inventory or stored state when one line is rejected", async () => {
    const backend = await freshBackend();
    const before = dbFingerprint(backend);
    const ids = backend.ids.count();
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
      itemFailures: [{ lineKey: cartLineKey(lines[2] as CartLine), reasons: ["SALES_STOPPED"] }],
    });
    expect(result).not.toHaveProperty("rejections");
    expect(dbFingerprint(backend)).toBe(before);
    expect(backend.ids.count()).toBe(ids);
    expect(okData(await backend.api.self.listOrders())).toEqual([]);
    expect(await regularMax(backend)).toBe(regularBefore);
    expect(await tshirtMax(backend)).toBe(tshirtBefore);
  });

  it("lists every failing line (and only those) in input order with its reasons", async () => {
    const backend = await freshBackend();
    const before = dbFingerprint(backend);
    const ids = backend.ids.count();
    const lines = [
      entry(OFFERING.early, 1),
      goods(GOODS.tshirt, 1),
      entry(OFFERING.ended, 1),
      entry(OFFERING.suspended, 1),
      entry(OFFERING.soldout, 1),
      goods(GOODS.towel, 4),
      entry(OFFERING.regular, 5),
      goods(GOODS.hidden, 1),
      goods(unknownGoods(1), 1),
    ];
    const result = await backend.api.purchase.startCartPurchase(lines, { idempotencyKey: "k-all" });
    expect(result).toEqual({
      kind: "rejected",
      itemFailures: [
        { lineKey: cartLineKey(lines[0] as CartLine), reasons: ["SALES_NOT_STARTED"] },
        { lineKey: cartLineKey(lines[2] as CartLine), reasons: ["SALES_CLOSED"] },
        { lineKey: cartLineKey(lines[3] as CartLine), reasons: ["SALES_STOPPED"] },
        { lineKey: cartLineKey(lines[4] as CartLine), reasons: ["SOLD_OUT"] },
        { lineKey: cartLineKey(lines[5] as CartLine), reasons: ["INSUFFICIENT_QUANTITY"] },
        { lineKey: cartLineKey(lines[6] as CartLine), reasons: ["PURCHASE_LIMIT_EXCEEDED"] },
        { lineKey: cartLineKey(lines[7] as CartLine), reasons: ["NOT_PUBLIC_OR_NOT_FOUND"] },
        { lineKey: cartLineKey(lines[8] as CartLine), reasons: ["NOT_PUBLIC_OR_NOT_FOUND"] },
      ],
    });
    for (const failure of failuresOf(result)) expectCanonicalReasons(failure.reasons);
    expect(dbFingerprint(backend)).toBe(before);
    expect(backend.ids.count()).toBe(ids);
  });

  it("rejects with PURCHASE_LIMIT_EXCEEDED for a viewer who already used the limit", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.demo);
    const before = dbFingerprint(backend);
    const ids = backend.ids.count();
    const line = entry(OFFERING.limit, 1);
    const result = await backend.api.purchase.startCartPurchase([line], {
      idempotencyKey: "k-lim",
    });
    expect(result).toEqual({
      kind: "rejected",
      itemFailures: [{ lineKey: cartLineKey(line), reasons: ["PURCHASE_LIMIT_EXCEEDED"] }],
    });
    expect(dbFingerprint(backend)).toBe(before);
    expect(backend.ids.count()).toBe(ids);
  });

  it("reject_one scenario rejects the first line with INSUFFICIENT_QUANTITY and changes nothing", async () => {
    const backend = await freshBackend();
    backend.setScenario({ cart: { purchaseStart: "reject_one" } });
    const before = dbFingerprint(backend);
    const ids = backend.ids.count();
    const lines = [entry(OFFERING.regular, 1), goods(GOODS.tshirt, 1)];
    const result = await backend.api.purchase.startCartPurchase(lines, { idempotencyKey: "k-r1" });
    expect(result).toEqual({
      kind: "rejected",
      itemFailures: [
        { lineKey: cartLineKey(lines[0] as CartLine), reasons: ["INSUFFICIENT_QUANTITY"] },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("ALLOCATION_CONFLICT");
    expect(dbFingerprint(backend)).toBe(before);
    expect(backend.ids.count()).toBe(ids);
  });

  it("reject_one also reports a natural rejection on another line", async () => {
    const backend = await freshBackend();
    backend.setScenario({ cart: { purchaseStart: "reject_one" } });
    const lines = [entry(OFFERING.regular, 1), entry(OFFERING.suspended, 1)];
    const result = await backend.api.purchase.startCartPurchase(lines, { idempotencyKey: "k-r2" });
    expect(result).toEqual({
      kind: "rejected",
      itemFailures: [
        { lineKey: cartLineKey(lines[0] as CartLine), reasons: ["INSUFFICIENT_QUANTITY"] },
        { lineKey: cartLineKey(lines[1] as CartLine), reasons: ["SALES_STOPPED"] },
      ],
    });
  });

  it("reject_one leaves a natural reason of the first line as it is", async () => {
    const backend = await freshBackend();
    backend.setScenario({ cart: { purchaseStart: "reject_one" } });
    const lines = [entry(OFFERING.suspended, 1), entry(OFFERING.regular, 1)];
    const result = await backend.api.purchase.startCartPurchase(lines, { idempotencyKey: "k-r3" });
    expect(result).toEqual({
      kind: "rejected",
      itemFailures: [{ lineKey: cartLineKey(lines[0] as CartLine), reasons: ["SALES_STOPPED"] }],
    });
  });

  it("limit scenario rejects the first line with PURCHASE_LIMIT_EXCEEDED and changes nothing", async () => {
    const backend = await freshBackend();
    backend.setScenario({ cart: { purchaseStart: "limit" } });
    const before = dbFingerprint(backend);
    const ids = backend.ids.count();
    const lines = [goods(GOODS.tshirt, 1)];
    const result = await backend.api.purchase.startCartPurchase(lines, { idempotencyKey: "k-l1" });
    expect(result).toEqual({
      kind: "rejected",
      itemFailures: [
        { lineKey: cartLineKey(lines[0] as CartLine), reasons: ["PURCHASE_LIMIT_EXCEEDED"] },
      ],
    });
    expect(dbFingerprint(backend)).toBe(before);
    expect(backend.ids.count()).toBe(ids);
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

describe("TC-BR-ORD-014-102 a successful purchase start persists one Order with a price Snapshot (BR-ORD-014/018, API-PUR-CART-001)", () => {
  it("creates one PREPARED Order, takes the allocation and sums the Snapshot prices", async () => {
    const backend = await freshBackend();
    const lines = [entry(OFFERING.regular, 2), goods(GOODS.tshirt, 1)];
    const result = await backend.api.purchase.startCartPurchase(lines, { idempotencyKey: "k-ok" });
    if (result.kind !== "created") throw new Error(`expected created but got ${result.kind}`);
    expect(result.orderRef).toMatch(/^f0000000-0000-4000-8000-[0-9]{12}$/);
    // Every sent line is in the Order (all-or-nothing): the result carries the Order reference only.
    expect(result).toEqual({ kind: "created", orderRef: result.orderRef });
    expect(Object.keys(result).sort()).toEqual(["kind", "orderRef"]);
    expect(result).not.toHaveProperty("includedLineKeys");

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

describe("TC-BR-ORD-014-112 item failures list every confirmed reason in the canonical order and never separate a hidden target from an unknown one (BR-ORD-014, BR-ORD-017, FR-CRT-005, FR-CRT-007, API-PUR-CART-001, API-PUR-ELG-001)", () => {
  async function rejectedWith(
    backend: Backend,
    lines: readonly CartLine[],
    key: string,
  ): Promise<Failure[]> {
    const before = dbFingerprint(backend);
    const ids = backend.ids.count();
    const result = await backend.api.purchase.startCartPurchase(lines, { idempotencyKey: key });
    const failures = failuresOf(result);
    for (const failure of failures) expectCanonicalReasons(failure.reasons);
    expect(dbFingerprint(backend)).toBe(before);
    expect(backend.ids.count()).toBe(ids);
    return failures;
  }

  it("(a) a quantity above the stock and above the account quota reports both, in the canonical order", async () => {
    const backend = await freshBackend();
    editDb(backend, (state) => {
      const row = offeringRow(state, OFFERING.limit);
      row.remaining = 1;
      row.perAccountLimit = 1;
    });
    const line = entry(OFFERING.limit, 2);
    expect(await rejectedWith(backend, [line], "k-m-a")).toEqual([
      { lineKey: cartLineKey(line), reasons: ["INSUFFICIENT_QUANTITY", "PURCHASE_LIMIT_EXCEEDED"] },
    ]);
  });

  it("(b) a suspended, ended and sold-out offering reports all three, in the canonical order", async () => {
    const backend = await freshBackend();
    const endedAt = new Date(Date.parse(NOW_ISO) - 24 * 60 * 60 * 1000)
      .toISOString()
      .replace(".000Z", "Z");
    editDb(backend, (state) => {
      const row = offeringRow(state, OFFERING.regular);
      row.control = "SUSPENDED";
      row.endsAt = endedAt;
      row.remaining = 0;
    });
    const line = entry(OFFERING.regular, 1);
    expect(await rejectedWith(backend, [line], "k-m-b")).toEqual([
      { lineKey: cartLineKey(line), reasons: ["SALES_CLOSED", "SALES_STOPPED", "SOLD_OUT"] },
    ]);
  });

  it("(c) a non-public item and an unknown ref are answered identically: NOT_PUBLIC_OR_NOT_FOUND alone", async () => {
    const backend = await freshBackend();
    const hidden = goods(GOODS.hidden, 1);
    const unknown = goods(unknownGoods(2), 3);
    const [first, second] = await rejectedWith(backend, [hidden, unknown], "k-m-c");
    expect(first?.reasons).toEqual(["NOT_PUBLIC_OR_NOT_FOUND"]);
    expect(second?.reasons).toEqual(["NOT_PUBLIC_OR_NOT_FOUND"]);
    // Only the line key differs, so nothing tells a hidden item from a missing one.
    expect({ ...first, lineKey: "" }).toEqual({ ...second, lineKey: "" });
    expect(first?.lineKey).toBe(cartLineKey(hidden));
    expect(second?.lineKey).toBe(cartLineKey(unknown));
  });

  it("(d) a sold-out offering reports SOLD_OUT only, even for a quantity above the (zero) stock", async () => {
    const backend = await freshBackend();
    const line = entry(OFFERING.soldout, 5);
    expect(await rejectedWith(backend, [line], "k-m-d")).toEqual([
      { lineKey: cartLineKey(line), reasons: ["SOLD_OUT"] },
    ]);
  });

  it("evaluates each line on its own: failing lines never blame the others", async () => {
    const backend = await freshBackend();
    const lines = [entry(OFFERING.regular, 1), goods(GOODS.towel, 4), goods(GOODS.tshirt, 1)];
    expect(await rejectedWith(backend, lines, "k-m-e")).toEqual([
      { lineKey: cartLineKey(lines[1] as CartLine), reasons: ["INSUFFICIENT_QUANTITY"] },
    ]);
  });
});

describe("TC-PG-CRT-001-103 idempotencyKey replay returns the same Order and a changed request under the same key is refused (API-PUR-CART-001, design section 4, FR-XFN-012)", () => {
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

  it("treats the same content in another line order as the same request", async () => {
    const backend = await freshBackend();
    const a = entry(OFFERING.regular, 2);
    const b = goods(GOODS.tshirt, 1);
    const first = await backend.api.purchase.startCartPurchase([a, b], { idempotencyKey: "k-ord" });
    expect(first.kind).toBe("created");
    const idsAfterFirst = backend.ids.count();
    const fingerprint = dbFingerprint(backend);
    const replay = await backend.api.purchase.startCartPurchase([b, a], {
      idempotencyKey: "k-ord",
    });
    expect(replay).toEqual(first);
    expect(backend.ids.count()).toBe(idsAfterFirst);
    expect(dbFingerprint(backend)).toBe(fingerprint);
  });

  it.each([
    ["another quantity", [entry(OFFERING.regular, 1)]],
    ["an added line", [entry(OFFERING.regular, 2), goods(GOODS.tshirt, 1)]],
    ["another item", [goods(GOODS.tshirt, 1)]],
  ])("refuses the same key with %s and creates nothing", async (_name, changed) => {
    const backend = await freshBackend();
    const first = await backend.api.purchase.startCartPurchase([entry(OFFERING.regular, 2)], {
      idempotencyKey: "k-same",
    });
    expect(first.kind).toBe("created");
    const idsAfterFirst = backend.ids.count();
    const fingerprint = dbFingerprint(backend);
    await expect(
      backend.api.purchase.startCartPurchase(changed, { idempotencyKey: "k-same" }),
    ).rejects.toThrow(/idempotency key reused/i);
    expect(dbFingerprint(backend)).toBe(fingerprint);
    expect(backend.ids.count()).toBe(idsAfterFirst);
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

describe("TC-PG-CRT-001-104 invalid purchase input is a programmer error, not a business result (API-PUR-CART-001 Body)", () => {
  const fifty = Array.from({ length: 50 }, (_, i) => goods(unknownGoods(100 + i), 1));
  const fiftyOne = Array.from({ length: 51 }, (_, i) => goods(unknownGoods(200 + i), 1));

  it.each([
    ["no lines", [] as CartLine[]],
    ["quantity 0", [entry(OFFERING.regular, 0)]],
    ["negative quantity", [entry(OFFERING.regular, -1)]],
    ["fractional quantity", [entry(OFFERING.regular, 1.5)]],
    ["quantity 2147483648", [goods(GOODS.tshirt, MAX_QUANTITY + 1)]],
    [
      "the same Entry offering on two lines",
      [entry(OFFERING.regular, 1), entry(OFFERING.regular, 1)],
    ],
    ["the same Goods item on two lines", [goods(GOODS.tshirt, 1), goods(GOODS.tshirt, 2)]],
    [
      "a duplicate after another line",
      [goods(GOODS.tshirt, 1), goods(GOODS.towel, 1), goods(GOODS.tshirt, 1)],
    ],
    ["51 lines", fiftyOne],
  ])("rejects the promise for %s without changing state", async (_name, lines) => {
    const backend = await freshBackend();
    const before = dbFingerprint(backend);
    const ids = backend.ids.count();
    await expect(
      backend.api.purchase.startCartPurchase(lines, { idempotencyKey: "k-bad" }),
    ).rejects.toThrow(RangeError);
    expect(dbFingerprint(backend)).toBe(before);
    expect(backend.ids.count()).toBe(ids);
  });

  it("evaluates 50 lines, among them unknown refs, as a business result (the limit is inclusive)", async () => {
    const backend = await freshBackend();
    const before = dbFingerprint(backend);
    const result = await backend.api.purchase.startCartPurchase(fifty, {
      idempotencyKey: "k-fifty",
    });
    const failures = failuresOf(result);
    expect(failures).toHaveLength(50);
    expect(failures.map((f) => f.lineKey)).toEqual(fifty.map(cartLineKey));
    for (const failure of failures) expect(failure.reasons).toEqual(["NOT_PUBLIC_OR_NOT_FOUND"]);
    expect(dbFingerprint(backend)).toBe(before);
  });

  it("evaluates quantity 2147483647 as a business result: too many for the stock, not invalid input", async () => {
    const backend = await freshBackend();
    const before = dbFingerprint(backend);
    const line = goods(GOODS.tshirt, MAX_QUANTITY);
    const result = await backend.api.purchase.startCartPurchase([line], {
      idempotencyKey: "k-max",
    });
    expect(result).toEqual({
      kind: "rejected",
      itemFailures: [{ lineKey: cartLineKey(line), reasons: ["INSUFFICIENT_QUANTITY"] }],
    });
    expect(dbFingerprint(backend)).toBe(before);
  });
});
