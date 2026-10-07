import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cartLineKey } from "../../../../apps/web/src/api-client/cart-line-key.ts";
import type { CartLine } from "../../../../apps/web/src/api-client/types.ts";
import {
  type Backend,
  createBackend,
  dbFingerprint,
  okData,
} from "../../../harness/mock-backend.ts";
import { EMAIL, GOODS, OFFERING } from "../../../harness/mock-seed.ts";

const towel = (quantity: number): CartLine => ({
  kind: "GOODS",
  goodsRef: GOODS.towel,
  quantity,
});
const tshirt = (quantity: number): CartLine => ({
  kind: "GOODS",
  goodsRef: GOODS.tshirt,
  quantity,
});
const regular = (quantity: number): CartLine => ({
  kind: "ENTRY_TICKET",
  offeringRef: OFFERING.regular,
  quantity,
});

async function freshBackend(): Promise<Backend> {
  const backend = createBackend();
  await backend.signInAs(EMAIL.fresh);
  return backend;
}

type Reason = "SOLD_OUT" | "INSUFFICIENT_QUANTITY" | "PURCHASE_LIMIT_EXCEEDED";

/** Rejection is a business result: no exception, and no stored state or id changes. */
async function expectRejectedUnchanged(
  backend: Backend,
  lines: readonly CartLine[],
  only: { index: number; reason: Reason },
  key: string,
): Promise<void> {
  const before = dbFingerprint(backend);
  const ids = backend.ids.count();
  const result = await backend.api.purchase.startCartPurchase(lines, { idempotencyKey: key });
  expect(result).toEqual({
    kind: "rejected",
    rejections: [{ lineKey: cartLineKey(lines[only.index] as CartLine), reason: only.reason }],
  });
  expect(dbFingerprint(backend)).toBe(before);
  expect(backend.ids.count()).toBe(ids);
}

describe("TC-BR-ORD-014-110 duplicate cart lines never oversell (BR-ORD-014, BR-ORD-017, FR-CRT-007, SPEC-050 14A.1)", () => {
  it("rejects only the overflowing duplicate Goods line when the total exceeds the stock", async () => {
    // Towel has 3 left; each line alone fits (2 <= 3) but together they need 4.
    await expectRejectedUnchanged(
      await freshBackend(),
      [towel(2), towel(2)],
      { index: 1, reason: "INSUFFICIENT_QUANTITY" },
      "dup-a",
    );
  });

  it("reports SOLD_OUT for a duplicate line after the earlier lines took all the stock", async () => {
    await expectRejectedUnchanged(
      await freshBackend(),
      [towel(3), towel(1)],
      { index: 1, reason: "SOLD_OUT" },
      "dup-a1",
    );
  });

  it("keeps input order and ignores lines of other items between the duplicates", async () => {
    await expectRejectedUnchanged(
      await freshBackend(),
      [towel(2), tshirt(1), towel(2)],
      { index: 2, reason: "INSUFFICIENT_QUANTITY" },
      "dup-a2",
    );
  });

  it("rejects the duplicate Entry line that pushes the total over the per-account limit (step 6)", async () => {
    // Regular: limit 4, stock 10. 3 + 2 = 5 > 4.
    await expectRejectedUnchanged(
      await freshBackend(),
      [regular(3), regular(2)],
      { index: 1, reason: "PURCHASE_LIMIT_EXCEEDED" },
      "dup-b1",
    );
  });

  it("rejects the duplicate Entry line once the earlier lines used the whole limit (step 4)", async () => {
    await expectRejectedUnchanged(
      await freshBackend(),
      [regular(4), regular(1)],
      { index: 1, reason: "PURCHASE_LIMIT_EXCEEDED" },
      "dup-b2",
    );
  });

  it("adds the already persisted usage to the in-flight duplicate quantity", async () => {
    const backend = await freshBackend();
    const pre = await backend.api.purchase.startCartPurchase([regular(1)], {
      idempotencyKey: "k-pre",
    });
    expect(pre.kind).toBe("created");
    // Used 1 already: 2 fits (1 + 2 <= 4), the second 2 does not (1 + 4 > 4).
    await expectRejectedUnchanged(
      backend,
      [regular(2), regular(2)],
      { index: 1, reason: "PURCHASE_LIMIT_EXCEEDED" },
      "dup-b3",
    );
  });
});

describe("TC-BR-ORD-014-111 duplicate lines that fit exactly are purchasable (BR-ORD-014, BR-ORD-018, FR-CRT-007)", () => {
  it("creates one Order with one item per duplicate Goods line and takes exactly the stock", async () => {
    const backend = await freshBackend();
    const lines = [towel(2), towel(1)];
    const result = await backend.api.purchase.startCartPurchase(lines, {
      idempotencyKey: "fit-goods",
    });
    if (result.kind !== "created") throw new Error(`expected created but got ${result.kind}`);
    expect(result.includedLineKeys).toEqual([
      cartLineKey(lines[0] as CartLine),
      cartLineKey(lines[1] as CartLine),
    ]);

    const orders = okData(await backend.api.self.listOrders());
    expect(orders.map((o) => [o.orderRef, o.state, o.purpose])).toEqual([
      [result.orderRef, "PREPARED", "GOODS_PURCHASE"],
    ]);
    const detail = okData(await backend.api.self.getOrder(result.orderRef));
    expect(detail.items.map((i) => [i.kind, i.quantity])).toEqual([
      ["GOODS", 2],
      ["GOODS", 1],
    ]);
    expect(detail.items.map((i) => i.subtotal)).toEqual([
      { amount: "3600", currency: "JPY" },
      { amount: "1800", currency: "JPY" },
    ]);
    expect(detail.total).toEqual({ amount: "5400", currency: "JPY" });

    const list = okData(await backend.api.public.listGoods());
    expect(list.find((g) => g.goodsRef === GOODS.towel)?.availability).toEqual({
      kind: "SOLD_OUT",
    });
    const state = backend.db.load();
    if (state.kind !== "ready") throw new Error("expected a ready DB");
    expect(state.state.goods.find((g) => g.ref === GOODS.towel)?.remaining).toBe(0);
  });

  it("creates one Order with one item per duplicate Entry line and takes exactly the limit", async () => {
    const backend = await freshBackend();
    const lines = [regular(2), regular(2)];
    const result = await backend.api.purchase.startCartPurchase(lines, {
      idempotencyKey: "fit-entry",
    });
    if (result.kind !== "created") throw new Error(`expected created but got ${result.kind}`);
    expect(result.includedLineKeys).toEqual([
      cartLineKey(lines[0] as CartLine),
      cartLineKey(lines[1] as CartLine),
    ]);

    const orders = okData(await backend.api.self.listOrders());
    expect(orders.map((o) => [o.state, o.purpose])).toEqual([
      ["PREPARED", "ENTRY_TICKET_PURCHASE"],
    ]);
    const detail = okData(await backend.api.self.getOrder(result.orderRef));
    expect(detail.items.map((i) => [i.kind, i.quantity])).toEqual([
      ["ENTRY_TICKET", 2],
      ["ENTRY_TICKET", 2],
    ]);
    expect(detail.total).toEqual({ amount: "12000", currency: "JPY" });

    const state = backend.db.load();
    if (state.kind !== "ready") throw new Error("expected a ready DB");
    expect(state.state.offerings.find((o) => o.ref === OFFERING.regular)?.remaining).toBe(6);
    const offerings = okData(await backend.api.public.listEntryOfferings());
    expect(offerings.find((o) => o.offeringRef === OFFERING.regular)?.availability).toEqual({
      kind: "PURCHASE_LIMIT_EXCEEDED",
    });
  });
});

const SOURCE_ROOTS = ["api-client", "auth", "mock"].map((d) =>
  join(import.meta.dirname, "../../../../apps/web/src", d),
);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("TC-DEV-TS-013-101 mock sources use only injected time, random and I/O (DEV-TS, SPEC-190 U6)", () => {
  const files = SOURCE_ROOTS.flatMap(sources);
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("finds the sources", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each([
    ["Date.now", /\bDate\.now\s*\(/],
    ["new Date()", /\bnew Date\(\s*\)/],
    ["Math.random", /\bMath\.random\s*\(/],
    ["console", /\bconsole\./],
    ["as unknown as", /as unknown as/],
    ["explicit any", /:\s*any\b|<any>|as any\b/],
    ["Hold TTL literal", /\b(?:hold|ttl)\w*\s*[:=]\s*(?:45|30|5)\b/i],
  ])("has no %s", (_name, pattern) => {
    const offenders = files.filter((f) => pattern.test(strip(readFileSync(f, "utf8"))));
    expect(offenders).toEqual([]);
  });

  it("confines randomUUID and setTimeout to their injectable defaults", () => {
    const hits = files
      .filter((f) => /\b(?:randomUUID|setTimeout)\b/.test(strip(readFileSync(f, "utf8"))))
      .map((f) => f.replaceAll("\\", "/").split("/").pop());
    expect(hits.sort()).toEqual(["ids.ts", "latency.ts"]);
  });
});
