import { describe, expect, it } from "vitest";
import {
  formatDisplayTotal,
  parseQuantityInput,
} from "../../../../apps/web/src/features/cart/quantity.ts";

// Contract: tests/contracts/s5-cart.md section 2.2 (SPEC-050 12.1 quantity validation, 14A.1 lower bound 1,
// DEV-TS-006 / 007 bigint money). The Cart does not invent an upper bound; Entry / Goods pass the port's max.

describe("TC-PG-CRT-001-411 parseQuantityInput accepts positive integers only (SPEC-050 12.1, 14A.1)", () => {
  it.each([
    ["1", 1],
    ["2", 2],
    ["10", 10],
    ["01", 1],
    ["007", 7],
    ["999999", 999999],
  ])("accepts %s as %i", (input, quantity) => {
    expect(parseQuantityInput(input, null)).toEqual({ kind: "valid", quantity });
  });

  it("rejects an empty string as empty", () => {
    expect(parseQuantityInput("", null)).toEqual({ kind: "invalid", reason: "empty" });
    expect(parseQuantityInput("", 4)).toEqual({ kind: "invalid", reason: "empty" });
  });

  it.each([
    ["0", "below_min"],
    ["-0", "below_min"],
    ["-1", "below_min"],
    ["-25", "below_min"],
    ["00", "below_min"],
  ])("rejects %s as %s (use delete instead of zero)", (input, reason) => {
    expect(parseQuantityInput(input, null)).toEqual({ kind: "invalid", reason });
  });

  it.each([
    ["1.5"],
    ["2.0"],
    [".5"],
    ["1e1"],
    ["1e0"],
    ["+2"],
    [" 2"],
    ["2 "],
    ["abc"],
    ["１"],
    ["0x10"],
    ["Infinity"],
    ["NaN"],
    ["9007199254740993"],
    ["99999999999999999999"],
  ])(
    "rejects %j as not an integer (decimals, exponents, spaces, letters, unsafe size)",
    (input) => {
      expect(parseQuantityInput(input, null)).toEqual({ kind: "invalid", reason: "not_integer" });
    },
  );

  it("has no upper bound when max is null (the Cart never invents one)", () => {
    expect(parseQuantityInput("1000", null)).toEqual({ kind: "valid", quantity: 1000 });
    expect(parseQuantityInput("9007199254740991", null)).toEqual({
      kind: "valid",
      quantity: 9007199254740991,
    });
  });

  it("enforces the announced maximum: equal is valid, above is above_max", () => {
    expect(parseQuantityInput("4", 4)).toEqual({ kind: "valid", quantity: 4 });
    expect(parseQuantityInput("5", 4)).toEqual({ kind: "invalid", reason: "above_max" });
    expect(parseQuantityInput("1", 1)).toEqual({ kind: "valid", quantity: 1 });
    expect(parseQuantityInput("2", 1)).toEqual({ kind: "invalid", reason: "above_max" });
  });

  it("reports the lower bound before the upper bound", () => {
    expect(parseQuantityInput("0", 4)).toEqual({ kind: "invalid", reason: "below_min" });
  });
});

describe("TC-PG-CRT-001-412 formatDisplayTotal is exact bigint arithmetic, display only (DEV-TS-006 / 007, SPEC-050 26.4)", () => {
  const jpy = (amount: string) => ({ amount, currency: "JPY" });

  it("multiplies a unit price by a quantity and formats it with a thousands separator", () => {
    expect(formatDisplayTotal(jpy("3000"), 1)).toBe("¥3,000");
    expect(formatDisplayTotal(jpy("3000"), 2)).toBe("¥6,000");
    expect(formatDisplayTotal(jpy("600"), 15)).toBe("¥9,000");
    expect(formatDisplayTotal(jpy("0"), 3)).toBe("¥0");
  });

  it("stays exact beyond the double-precision range", () => {
    expect(formatDisplayTotal(jpy("9007199254740993"), 3)).toBe("¥27,021,597,764,222,979");
    expect(formatDisplayTotal(jpy("123456789012345678"), 2)).toBe("¥246,913,578,024,691,356");
  });

  it("rejects a non-positive or fractional quantity", () => {
    expect(() => formatDisplayTotal(jpy("100"), 0)).toThrow(RangeError);
    expect(() => formatDisplayTotal(jpy("100"), 1.5)).toThrow(RangeError);
  });
});
