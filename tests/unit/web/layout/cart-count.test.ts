import { describe, expect, it } from "vitest";
import {
  CART_STORAGE_KEY,
  readCartCount,
} from "../../../../apps/web/src/features/cart/cart-count.ts";

// Contract: tests/contracts/s3-layout.md section 2.5 (SPEC-050 8.5, FR-CRT-001 / 003, 26.4, DEV-TS-004).

const OFFERING = "e0000000-0000-4000-8000-000000000001";
const GOODS = "a0000000-0000-4000-8000-000000000001";
const entry = (quantity: unknown, extra: Record<string, unknown> = {}) => ({
  kind: "ENTRY_TICKET",
  offeringRef: OFFERING,
  quantity,
  ...extra,
});
const goods = (quantity: unknown, extra: Record<string, unknown> = {}) => ({
  kind: "GOODS",
  goodsRef: GOODS,
  quantity,
  ...extra,
});
const cart = (lines: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 1, lines, ...extra });

describe("TC-PG-CRT-001-201 readCartCount sums line quantities (SPEC-050 8.5)", () => {
  it("uses the documented storage key", () => {
    expect(CART_STORAGE_KEY).toBe("r39x.cart.v1");
  });

  it("returns the sum of the quantities of all lines", () => {
    expect(readCartCount(cart([entry(1), goods(2)]))).toBe(3);
    expect(readCartCount(cart([entry(4)]))).toBe(4);
    expect(readCartCount(cart([goods(10), entry(5), goods(1)]))).toBe(16);
  });

  it("adds duplicate lines of the same ref", () => {
    expect(readCartCount(cart([entry(1), entry(2)]))).toBe(3);
  });

  it("returns 0 (not null) for a valid empty cart", () => {
    expect(readCartCount(cart([]))).toBe(0);
  });

  it("returns null when the key is absent", () => {
    expect(readCartCount(null)).toBeNull();
  });
});

describe("TC-PG-CRT-001-202 readCartCount rejects invalid content instead of guessing (FR-CRT-003, 26.4, DEV-TS-004)", () => {
  it.each([
    ["empty string", ""],
    ["not JSON", "not-json"],
    ["JSON null", "null"],
    ["JSON array", "[]"],
    ["wrong version", JSON.stringify({ version: 2, lines: [entry(1)] })],
    ["missing version", JSON.stringify({ lines: [entry(1)] })],
    ["missing lines", JSON.stringify({ version: 1 })],
    ["lines is not an array", JSON.stringify({ version: 1, lines: "x" })],
    ["unknown top-level field", cart([entry(1)], { total: 100 })],
    ["price on a line", cart([entry(1, { unitPrice: 3000 })])],
    ["stock on a line", cart([goods(1, { remaining: 3 })])],
    ["owner on a line", cart([goods(1, { owner: "x" })])],
    ["karaoke line", cart([{ kind: "KARAOKE", slotRef: GOODS, quantity: 1 }])],
    ["unknown kind", cart([{ kind: "COUPON", quantity: 1 }])],
    ["quantity 0", cart([entry(0)])],
    ["negative quantity", cart([entry(-1)])],
    ["fractional quantity", cart([entry(1.5)])],
    ["string quantity", cart([entry("2")])],
    ["missing quantity", cart([{ kind: "ENTRY_TICKET", offeringRef: OFFERING }])],
    ["non-UUID ref", cart([{ kind: "ENTRY_TICKET", offeringRef: "x", quantity: 1 }])],
    ["uppercase UUID ref", cart([{ kind: "GOODS", goodsRef: GOODS.toUpperCase(), quantity: 1 }])],
    [
      "ref field that does not match the kind",
      cart([{ kind: "GOODS", offeringRef: OFFERING, quantity: 1 }]),
    ],
    ["one invalid line among valid lines", cart([entry(1), goods(0)])],
  ])("returns null for %s", (_label, raw) => {
    expect(readCartCount(raw)).toBeNull();
  });
});
