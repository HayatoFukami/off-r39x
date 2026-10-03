import { describe, expect, it } from "vitest";
import type { Money } from "../../../../apps/web/src/api-client/types.ts";
import {
  formatMoney,
  multiplyMoney,
  sumMoney,
} from "../../../../apps/web/src/presentation/format/money.ts";

const YEN = "¥";
const jpy = (amount: string): Money => ({ amount, currency: "JPY" });

describe("TC-PG-CRT-001-003 formatMoney (DEV-TS-006 / 007)", () => {
  it.each([
    ["0", `${YEN}0`],
    ["1", `${YEN}1`],
    ["999", `${YEN}999`],
    ["1000", `${YEN}1,000`],
    ["1234", `${YEN}1,234`],
    ["1234567", `${YEN}1,234,567`],
    ["-500", `-${YEN}500`],
    ["-1234", `-${YEN}1,234`],
  ])("%s -> %s", (amount, expected) => {
    expect(formatMoney(jpy(amount))).toBe(expected);
  });

  it("is lossless beyond Number.MAX_SAFE_INTEGER (no floating point)", () => {
    expect(formatMoney(jpy("9007199254740993"))).toBe(`${YEN}9,007,199,254,740,993`);
    expect(formatMoney(jpy("123456789012345678901234567890"))).toBe(
      `${YEN}123,456,789,012,345,678,901,234,567,890`,
    );
  });

  it("never renders a decimal point or exponent", () => {
    for (const amount of ["0", "10", "1000000", "9007199254740993"]) {
      expect(formatMoney(jpy(amount))).not.toMatch(/[.eE]/);
    }
  });

  it.each(["", "12.5", "1e3", " 1", "1 ", "01", "-0", "+1", "１２", "NaN", "1,000", "-", "--1"])(
    "rejects the non-canonical amount %j",
    (amount) => {
      expect(() => formatMoney(jpy(amount))).toThrow();
    },
  );

  it("rejects an unsupported currency", () => {
    expect(() => formatMoney({ amount: "100", currency: "USD" })).toThrow(/currency/i);
    expect(() => formatMoney({ amount: "100", currency: "jpy" })).toThrow(/currency/i);
  });
});

describe("TC-PG-CRT-001-003 multiplyMoney (subtotal, DEV-TS-006 / 007)", () => {
  it("multiplies unit price by quantity as a decimal string", () => {
    expect(multiplyMoney(jpy("1500"), 1)).toEqual(jpy("1500"));
    expect(multiplyMoney(jpy("1500"), 3)).toEqual(jpy("4500"));
    expect(multiplyMoney(jpy("0"), 5)).toEqual(jpy("0"));
  });

  it("is exact for values that a JavaScript number cannot hold", () => {
    expect(multiplyMoney(jpy("9007199254740993"), 3)).toEqual(jpy("27021597764222979"));
    expect(multiplyMoney(jpy("1234567890123456789"), 7)).toEqual(jpy("8641975230864197523"));
  });

  it("keeps the currency of the unit price", () => {
    expect(multiplyMoney(jpy("100"), 2).currency).toBe("JPY");
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    "rejects the quantity %s",
    (quantity) => {
      expect(() => multiplyMoney(jpy("100"), quantity)).toThrow(RangeError);
    },
  );

  it("rejects a non-canonical unit price", () => {
    expect(() => multiplyMoney(jpy("12.5"), 2)).toThrow();
  });

  it("produces a subtotal that formats without precision loss", () => {
    expect(formatMoney(multiplyMoney(jpy("9007199254740993"), 3))).toBe(
      `${YEN}27,021,597,764,222,979`,
    );
  });
});

describe("TC-PG-CRT-001-003 sumMoney", () => {
  it("sums exactly and returns zero JPY for an empty list", () => {
    expect(sumMoney([])).toEqual(jpy("0"));
    expect(sumMoney([jpy("100"), jpy("200")])).toEqual(jpy("300"));
    expect(sumMoney([jpy("9007199254740993"), jpy("1")])).toEqual(jpy("9007199254740994"));
  });

  it("rejects mixed currencies", () => {
    expect(() => sumMoney([jpy("100"), { amount: "1", currency: "USD" }])).toThrow();
  });
});
