import type { Money } from "../../api-client/types";
import { formatMoney, multiplyMoney } from "../../presentation/format/money";

export type QuantityParse =
  | { kind: "valid"; quantity: number }
  | { kind: "invalid"; reason: "empty" | "not_integer" | "below_min" | "above_max" };

const INTEGER_TEXT = /^-?[0-9]+$/;

/** `max` is the announced maximum (Entry / Goods) or null (the Cart never invents a limit). */
export function parseQuantityInput(raw: string, max: number | null): QuantityParse {
  if (raw === "") return { kind: "invalid", reason: "empty" };
  if (!INTEGER_TEXT.test(raw)) return { kind: "invalid", reason: "not_integer" };
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return { kind: "invalid", reason: "not_integer" };
  if (value < 1) return { kind: "invalid", reason: "below_min" };
  if (max !== null && value > max) return { kind: "invalid", reason: "above_max" };
  return { kind: "valid", quantity: value };
}

/** Display only: the server recalculates the amount at purchase (SPEC-050 26.4). */
export function formatDisplayTotal(unitPrice: Money, quantity: number): string {
  return formatMoney(multiplyMoney(unitPrice, quantity));
}
