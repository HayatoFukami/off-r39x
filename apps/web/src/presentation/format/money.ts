import type { Money } from "../../api-client/types";

// Money is computed with bigint only (DEV-TS-006 / 007). No floating point.

const CANONICAL_AMOUNT = /^(0|-?[1-9][0-9]*)$/;

function assertJpy(currency: string): void {
  if (currency !== "JPY") {
    throw new Error(`Unsupported currency: ${currency}`);
  }
}

function parseAmount(amount: string): bigint {
  if (!CANONICAL_AMOUNT.test(amount)) {
    throw new Error("Invalid money amount");
  }
  return BigInt(amount);
}

export function formatMoney(money: Money): string {
  assertJpy(money.currency);
  const value = parseAmount(money.amount);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}¥${grouped}`;
}

export function multiplyMoney(unitPrice: Money, quantity: number): Money {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new RangeError("quantity must be a safe integer >= 1");
  }
  const total = parseAmount(unitPrice.amount) * BigInt(quantity);
  return { amount: total.toString(), currency: unitPrice.currency };
}

export function sumMoney(items: readonly Money[]): Money {
  let total = 0n;
  for (const item of items) {
    assertJpy(item.currency);
    total += parseAmount(item.amount);
  }
  return { amount: total.toString(), currency: "JPY" };
}
