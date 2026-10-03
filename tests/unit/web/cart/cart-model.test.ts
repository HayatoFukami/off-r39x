import { describe, expect, it } from "vitest";
import { cartLineKey } from "../../../../apps/web/src/api-client/cart-line-key.ts";
import type { CartLine, OrderItem, Ref } from "../../../../apps/web/src/api-client/types.ts";
import { readCartCount } from "../../../../apps/web/src/features/cart/cart-count.ts";
import {
  addFromOrder,
  addLine,
  type Cart,
  cartTotalQuantity,
  EMPTY_CART,
  parseCart,
  removeLine,
  removeLines,
  serializeCart,
  setLineQuantity,
} from "../../../../apps/web/src/features/cart/cart-model.ts";

// Contract: tests/contracts/s5-cart.md section 2.1 (SPEC-050 14A.1 / 26.4, FR-CRT-001 / 002 / 003 / 011,
// BR-ORD-020, DEV-TS-004). Pure functions: no storage, no clock.

const OFFERING_A = "e0000000-0000-4000-8000-000000000001" as Ref<"offering">;
const OFFERING_B = "e0000000-0000-4000-8000-000000000006" as Ref<"offering">;
const GOODS_A = "a0000000-0000-4000-8000-000000000001" as Ref<"goods">;
const GOODS_B = "a0000000-0000-4000-8000-000000000002" as Ref<"goods">;
const SLOT = "5a000000-0000-4000-8000-000000011000" as Ref<"slot">;

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
const cartOf = (...lines: CartLine[]): Cart => ({ version: 1, lines });
const raw = (lines: unknown[], extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ version: 1, lines, ...extra });

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const money = (amount: string) => ({ amount, currency: "JPY" });

describe("TC-PG-CRT-001-401 parseCart accepts an absent or valid Cart and never turns damage into an empty Cart (SPEC-050 26.4, FR-CRT-003)", () => {
  it("treats an absent key as an empty Cart", () => {
    expect(parseCart(null)).toEqual({ kind: "ok", cart: { version: 1, lines: [] } });
    expect(EMPTY_CART).toEqual({ version: 1, lines: [] });
  });

  it("parses a valid Cart keeping line order and quantities", () => {
    const result = parseCart(
      raw([
        { kind: "GOODS", goodsRef: GOODS_A, quantity: 2 },
        { kind: "ENTRY_TICKET", offeringRef: OFFERING_A, quantity: 1 },
      ]),
    );
    expect(result).toEqual({
      kind: "ok",
      cart: cartOf(goods(GOODS_A, 2), entry(OFFERING_A, 1)),
    });
  });

  it("parses a valid empty Cart", () => {
    expect(parseCart(raw([]))).toEqual({ kind: "ok", cart: EMPTY_CART });
  });

  it.each([
    ["empty string", ""],
    ["not JSON", "not-json"],
    ["truncated JSON", '{"version":1,"lines":['],
    ["JSON null", "null"],
    ["JSON array", "[]"],
    ["JSON string", '"cart"'],
    ["wrong version", JSON.stringify({ version: 2, lines: [] })],
    ["missing version", JSON.stringify({ lines: [] })],
    ["missing lines", JSON.stringify({ version: 1 })],
    ["lines is not an array", JSON.stringify({ version: 1, lines: "x" })],
    ["unknown top-level field", raw([], { total: 100 })],
    [
      "price on a line",
      raw([{ kind: "ENTRY_TICKET", offeringRef: OFFERING_A, quantity: 1, unitPrice: 3000 }]),
    ],
    ["amount on a line", raw([{ kind: "GOODS", goodsRef: GOODS_A, quantity: 1, amount: "100" }])],
    [
      "currency on a line",
      raw([{ kind: "GOODS", goodsRef: GOODS_A, quantity: 1, currency: "JPY" }]),
    ],
    ["stock on a line", raw([{ kind: "GOODS", goodsRef: GOODS_A, quantity: 1, remaining: 3 }])],
    [
      "availability on a line",
      raw([{ kind: "GOODS", goodsRef: GOODS_A, quantity: 1, availability: "ON_SALE" }]),
    ],
    [
      "owner on a line",
      raw([{ kind: "GOODS", goodsRef: GOODS_A, quantity: 1, owner: "demo@example.com" }]),
    ],
    [
      "email on a line",
      raw([{ kind: "GOODS", goodsRef: GOODS_A, quantity: 1, email: "demo@example.com" }]),
    ],
    ["karaoke line", raw([{ kind: "KARAOKE", slotRef: SLOT, quantity: 1 }])],
    [
      "karaoke line with an entry-looking ref",
      raw([{ kind: "KARAOKE", offeringRef: OFFERING_A, quantity: 1 }]),
    ],
    ["unknown kind", raw([{ kind: "COUPON", quantity: 1 }])],
    ["quantity 0", raw([{ kind: "ENTRY_TICKET", offeringRef: OFFERING_A, quantity: 0 }])],
    ["negative quantity", raw([{ kind: "ENTRY_TICKET", offeringRef: OFFERING_A, quantity: -1 }])],
    [
      "fractional quantity",
      raw([{ kind: "ENTRY_TICKET", offeringRef: OFFERING_A, quantity: 1.5 }]),
    ],
    ["string quantity", raw([{ kind: "ENTRY_TICKET", offeringRef: OFFERING_A, quantity: "2" }])],
    [
      "unsafe integer quantity",
      `{"version":1,"lines":[{"kind":"GOODS","goodsRef":"${GOODS_A}","quantity":9007199254740993}]}`,
    ],
    ["missing quantity", raw([{ kind: "ENTRY_TICKET", offeringRef: OFFERING_A }])],
    ["non-UUID ref", raw([{ kind: "ENTRY_TICKET", offeringRef: "x", quantity: 1 }])],
    ["uppercase UUID ref", raw([{ kind: "GOODS", goodsRef: GOODS_A.toUpperCase(), quantity: 1 }])],
    [
      "ref field that does not match the kind",
      raw([{ kind: "GOODS", offeringRef: OFFERING_A, quantity: 1 }]),
    ],
    [
      "one invalid line among valid lines",
      raw([
        { kind: "GOODS", goodsRef: GOODS_A, quantity: 1 },
        { kind: "GOODS", goodsRef: GOODS_B, quantity: 0 },
      ]),
    ],
  ])("reports corrupted (not an empty Cart) for %s", (_label, value) => {
    expect(parseCart(value)).toEqual({ kind: "corrupted" });
  });

  it("has no upper bound on a quantity other than the safe-integer range (the Cart does not invent a limit)", () => {
    const result = parseCart(raw([{ kind: "GOODS", goodsRef: GOODS_A, quantity: 1000 }]));
    expect(result).toEqual({ kind: "ok", cart: cartOf(goods(GOODS_A, 1000)) });
    const max = parseCart(
      `{"version":1,"lines":[{"kind":"GOODS","goodsRef":"${GOODS_A}","quantity":9007199254740991}]}`,
    );
    expect(max.kind).toBe("ok");
  });

  it("merges duplicate line keys into one line at the first position, keeping the Header total", () => {
    const text = raw([
      { kind: "ENTRY_TICKET", offeringRef: OFFERING_A, quantity: 1 },
      { kind: "GOODS", goodsRef: GOODS_A, quantity: 4 },
      { kind: "ENTRY_TICKET", offeringRef: OFFERING_A, quantity: 2 },
    ]);
    const result = parseCart(text);
    expect(result).toEqual({ kind: "ok", cart: cartOf(entry(OFFERING_A, 3), goods(GOODS_A, 4)) });
    expect(readCartCount(text)).toBe(7);
    if (result.kind === "ok") expect(cartTotalQuantity(result.cart)).toBe(7);
  });
});

describe("TC-PG-CRT-001-402 serializeCart writes references and quantities only (FR-CRT-003, 26.4)", () => {
  it("round-trips through parseCart", () => {
    const cart = cartOf(entry(OFFERING_A, 2), goods(GOODS_B, 5));
    expect(parseCart(serializeCart(cart))).toEqual({ kind: "ok", cart });
    expect(parseCart(serializeCart(EMPTY_CART))).toEqual({ kind: "ok", cart: EMPTY_CART });
  });

  it("emits only version and lines, and only kind, ref and quantity per line", () => {
    const parsed: unknown = JSON.parse(
      serializeCart(cartOf(entry(OFFERING_A, 2), goods(GOODS_B, 5))),
    );
    expect(parsed).toEqual({
      version: 1,
      lines: [
        { kind: "ENTRY_TICKET", offeringRef: OFFERING_A, quantity: 2 },
        { kind: "GOODS", goodsRef: GOODS_B, quantity: 5 },
      ],
    });
  });

  it("agrees with the Header count source (one schema)", () => {
    const cart = cartOf(entry(OFFERING_A, 2), goods(GOODS_B, 5), goods(GOODS_A, 1));
    expect(readCartCount(serializeCart(cart))).toBe(cartTotalQuantity(cart));
    expect(cartTotalQuantity(cart)).toBe(8);
    expect(cartTotalQuantity(EMPTY_CART)).toBe(0);
  });
});

describe("TC-PG-CRT-001-403 addLine adds a new line or sums the quantity of the same line key (FR-CRT-001)", () => {
  it("appends a new line at the end", () => {
    const next = addLine(cartOf(entry(OFFERING_A, 1)), goods(GOODS_A, 2));
    expect(next).toEqual(cartOf(entry(OFFERING_A, 1), goods(GOODS_A, 2)));
  });

  it("sums the quantity of the same line key and keeps the position", () => {
    const base = cartOf(entry(OFFERING_A, 1), goods(GOODS_A, 2));
    const next = addLine(base, entry(OFFERING_A, 3));
    expect(next).toEqual(cartOf(entry(OFFERING_A, 4), goods(GOODS_A, 2)));
    expect(next.lines).toHaveLength(2);
  });

  it("keeps an Entry line and a Goods line apart even when they were added with the same quantity", () => {
    const next = addLine(addLine(EMPTY_CART, entry(OFFERING_A, 1)), goods(GOODS_A, 1));
    expect(next.lines).toHaveLength(2);
  });

  it("does not mutate its input (frozen input does not throw, the input is unchanged)", () => {
    const base = deepFreeze(cartOf(entry(OFFERING_A, 1)));
    const snapshot = JSON.stringify(base);
    const next = addLine(base, goods(GOODS_A, 1));
    expect(JSON.stringify(base)).toBe(snapshot);
    expect(next).not.toBe(base);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["beyond the safe integer range", 2 ** 53],
  ])("rejects a %s quantity with a RangeError", (_label, quantity) => {
    expect(() => addLine(EMPTY_CART, entry(OFFERING_A, quantity))).toThrow(RangeError);
  });

  it("rejects a sum beyond the safe integer range", () => {
    const base = cartOf(goods(GOODS_A, Number.MAX_SAFE_INTEGER));
    expect(() => addLine(base, goods(GOODS_A, 1))).toThrow(RangeError);
  });

  it("cannot take a Karaoke line, a price or any extra field even through a type escape (FR-CRT-002, 003)", () => {
    const karaoke = { kind: "KARAOKE", slotRef: SLOT, quantity: 1 } as unknown as CartLine;
    expect(() => addLine(EMPTY_CART, karaoke)).toThrow(RangeError);
    const priced = {
      kind: "ENTRY_TICKET",
      offeringRef: OFFERING_A,
      quantity: 1,
      unitPrice: money("3000"),
    } as unknown as CartLine;
    expect(() => addLine(EMPTY_CART, priced)).toThrow(RangeError);
    const stock = {
      kind: "GOODS",
      goodsRef: GOODS_A,
      quantity: 1,
      remaining: 4,
    } as unknown as CartLine;
    expect(() => addLine(EMPTY_CART, stock)).toThrow(RangeError);
    const badRef = { kind: "GOODS", goodsRef: "not-a-uuid", quantity: 1 } as unknown as CartLine;
    expect(() => addLine(EMPTY_CART, badRef)).toThrow(RangeError);
  });
});

describe("TC-PG-CRT-001-404 setLineQuantity / removeLine / removeLines (FR-CRT-001, 011, SPEC-050 14A.1 Actions)", () => {
  const base = cartOf(entry(OFFERING_A, 1), goods(GOODS_A, 2), entry(OFFERING_B, 3));

  it("replaces the quantity without moving the line", () => {
    const next = setLineQuantity(base, cartLineKey(goods(GOODS_A, 1)), 7);
    expect(next).toEqual(cartOf(entry(OFFERING_A, 1), goods(GOODS_A, 7), entry(OFFERING_B, 3)));
  });

  it("keeps the line key stable across a quantity change and independent of the quantity", () => {
    const before = cartLineKey(goods(GOODS_A, 2));
    const next = setLineQuantity(base, before, 9);
    const after = next.lines.map(cartLineKey);
    expect(after).toContain(before);
    expect(cartLineKey(goods(GOODS_A, 1))).toBe(cartLineKey(goods(GOODS_A, 99)));
    expect(cartLineKey(goods(GOODS_A, 1))).not.toBe(cartLineKey(entry(OFFERING_A, 1)));
    expect(before).toBe(`GOODS:${GOODS_A}`);
  });

  it.each([
    ["zero (use removeLine instead)", 0],
    ["negative", -2],
    ["fractional", 2.5],
    ["NaN", Number.NaN],
    ["beyond the safe integer range", 2 ** 53],
  ])(
    "rejects a %s quantity with a RangeError and leaves the Cart untouched",
    (_label, quantity) => {
      expect(() => setLineQuantity(base, cartLineKey(goods(GOODS_A, 1)), quantity)).toThrow(
        RangeError,
      );
    },
  );

  it("ignores an unknown line key", () => {
    expect(setLineQuantity(base, `GOODS:${GOODS_B}`, 4)).toEqual(base);
    expect(removeLine(base, `GOODS:${GOODS_B}`)).toEqual(base);
  });

  it("removes one line and keeps the order of the others", () => {
    expect(removeLine(base, cartLineKey(goods(GOODS_A, 1)))).toEqual(
      cartOf(entry(OFFERING_A, 1), entry(OFFERING_B, 3)),
    );
  });

  it("removes many lines at once (the lines of a created Order, FR-CRT-011) and ignores unknown keys", () => {
    const next = removeLines(base, [
      cartLineKey(entry(OFFERING_A, 1)),
      `GOODS:${GOODS_B}`,
      cartLineKey(entry(OFFERING_B, 1)),
    ]);
    expect(next).toEqual(cartOf(goods(GOODS_A, 2)));
    expect(removeLines(base, [])).toEqual(base);
    expect(removeLines(base, base.lines.map(cartLineKey))).toEqual(EMPTY_CART);
  });

  it("does not mutate its input", () => {
    const frozen = deepFreeze(cartOf(entry(OFFERING_A, 1), goods(GOODS_A, 2)));
    const snapshot = JSON.stringify(frozen);
    setLineQuantity(frozen, cartLineKey(goods(GOODS_A, 1)), 3);
    removeLine(frozen, cartLineKey(goods(GOODS_A, 1)));
    removeLines(frozen, [cartLineKey(entry(OFFERING_A, 1))]);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });
});

describe("TC-PG-CRT-001-405 addFromOrder re-populates the Cart from order items with references and quantities only (SPEC-050 16.4, FR-CRT-002, 011)", () => {
  const entryItem: OrderItem = {
    kind: "ENTRY_TICKET",
    offeringRef: OFFERING_A,
    name: "Regular",
    quantity: 2,
    unitPrice: money("3000"),
    subtotal: money("6000"),
  };
  const goodsItem: OrderItem = {
    kind: "GOODS",
    goodsRef: GOODS_A,
    name: "T-shirt",
    quantity: 1,
    unitPrice: money("4000"),
    subtotal: money("4000"),
  };
  const karaokeItem: OrderItem = {
    kind: "KARAOKE",
    slotRef: SLOT,
    name: "Karaoke",
    usageStart: "2027-03-08T01:00:00Z" as never,
    usageEnd: "2027-03-08T01:15:00Z" as never,
    quantity: 1,
    unitPrice: money("1000"),
    subtotal: money("1000"),
  };

  it("adds Entry and Goods items in the order of the items", () => {
    expect(addFromOrder(EMPTY_CART, [goodsItem, entryItem])).toEqual(
      cartOf(goods(GOODS_A, 1), entry(OFFERING_A, 2)),
    );
  });

  it("never copies a name, price or subtotal into the Cart", () => {
    const json = serializeCart(addFromOrder(EMPTY_CART, [entryItem, goodsItem]));
    expect(json).not.toMatch(/Regular|T-shirt|unitPrice|subtotal|amount|JPY|"name"/);
    expect(Object.keys(JSON.parse(json) as object).sort()).toEqual(["lines", "version"]);
  });

  it("ignores Karaoke items (a Karaoke Slot cannot be in the Cart)", () => {
    expect(addFromOrder(EMPTY_CART, [entryItem, karaokeItem])).toEqual(
      cartOf(entry(OFFERING_A, 2)),
    );
    expect(addFromOrder(EMPTY_CART, [karaokeItem])).toEqual(EMPTY_CART);
  });

  it("sums into a line that is already in the Cart (same rule as add) and keeps other lines", () => {
    const base = cartOf(entry(OFFERING_A, 1), goods(GOODS_B, 3));
    expect(addFromOrder(base, [entryItem, goodsItem])).toEqual(
      cartOf(entry(OFFERING_A, 3), goods(GOODS_B, 3), goods(GOODS_A, 1)),
    );
  });

  it("returns an equal Cart for no items and does not mutate its inputs", () => {
    const base = deepFreeze(cartOf(entry(OFFERING_A, 1)));
    const items = deepFreeze([entryItem, goodsItem, karaokeItem]);
    const snapshot = JSON.stringify(base);
    expect(addFromOrder(base, [])).toEqual(base);
    addFromOrder(base, items);
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it("does not validate against sales rules (an order of 4 stays 4; the server re-verifies later)", () => {
    const four: OrderItem = { ...entryItem, quantity: 4 };
    expect(addFromOrder(EMPTY_CART, [four])).toEqual(cartOf(entry(OFFERING_A, 4)));
  });
});
