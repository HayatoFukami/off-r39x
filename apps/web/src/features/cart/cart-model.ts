import { z } from "zod";
import { cartLineKey } from "../../api-client/cart-line-key";
import type { CartLine, OrderItem, Ref } from "../../api-client/types";

// Pure Cart model (SPEC-050 14A.1, 26.4). The Cart holds references and quantities only (FR-CRT-003);
// every level of the stored shape is strict, so no other value is ever accepted or written.
// This file owns the single schema of the stored Cart: cart-count.ts and the store reuse it.

export type Cart = { readonly version: 1; readonly lines: readonly CartLine[] };
export type CartLoad = { kind: "ok"; cart: Cart } | { kind: "corrupted" };

/** A merged quantity passed the safe integer range. Still a RangeError, but not an invalid line. */
export class CartQuantityOverflowError extends RangeError {
  constructor() {
    super("Cart quantity is out of range");
    this.name = "CartQuantityOverflowError";
  }
}

export const EMPTY_CART: Cart = { version: 1, lines: [] };

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const quantity = z
  .number()
  .refine((value) => Number.isSafeInteger(value) && value >= 1, "quantity must be a safe integer");

const lineSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ENTRY_TICKET"), offeringRef: uuid, quantity }),
  z.strictObject({ kind: z.literal("GOODS"), goodsRef: uuid, quantity }),
]);

const cartSchema = z.strictObject({ version: z.literal(1), lines: z.array(lineSchema) });

type ParsedLine = z.infer<typeof lineSchema>;

const asRef = <T extends string>(value: string): Ref<T> => value as Ref<T>;

function toCartLine(line: ParsedLine): CartLine {
  switch (line.kind) {
    case "ENTRY_TICKET":
      return {
        kind: "ENTRY_TICKET",
        offeringRef: asRef<"offering">(line.offeringRef),
        quantity: line.quantity,
      };
    case "GOODS":
      return { kind: "GOODS", goodsRef: asRef<"goods">(line.goodsRef), quantity: line.quantity };
    default: {
      const unreachable: never = line;
      return unreachable;
    }
  }
}

function isValidQuantity(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

/** Sums the quantity of a line key into the existing line, or appends a new line. */
function merge(lines: readonly CartLine[], line: CartLine): CartLine[] | null {
  const key = cartLineKey(line);
  const index = lines.findIndex((existing) => cartLineKey(existing) === key);
  if (index === -1) return [...lines, line];
  const existing = lines[index];
  if (existing === undefined) return null;
  const sum = existing.quantity + line.quantity;
  if (!Number.isSafeInteger(sum)) return null;
  return lines.map((item, position) => (position === index ? { ...item, quantity: sum } : item));
}

/** An absent key is an empty Cart; damage is `corrupted` and is never turned into an empty Cart. */
export function parseCart(raw: string | null): CartLoad {
  if (raw === null) return { kind: "ok", cart: EMPTY_CART };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { kind: "corrupted" };
  }
  const parsed = cartSchema.safeParse(json);
  if (!parsed.success) return { kind: "corrupted" };
  let lines: CartLine[] = [];
  for (const stored of parsed.data.lines) {
    const merged = merge(lines, toCartLine(stored));
    if (merged === null) return { kind: "corrupted" };
    lines = merged;
  }
  return { kind: "ok", cart: { version: 1, lines } };
}

export function serializeCart(cart: Cart): string {
  return JSON.stringify({ version: 1, lines: cart.lines.map((line) => lineForStorage(line)) });
}

function lineForStorage(line: CartLine): CartLine {
  switch (line.kind) {
    case "ENTRY_TICKET":
      return { kind: line.kind, offeringRef: line.offeringRef, quantity: line.quantity };
    case "GOODS":
      return { kind: line.kind, goodsRef: line.goodsRef, quantity: line.quantity };
    default: {
      const unreachable: never = line;
      return unreachable;
    }
  }
}

export function addLine(cart: Cart, line: CartLine): Cart {
  const checked = lineSchema.safeParse(line);
  if (!checked.success) throw new RangeError("Invalid cart line");
  const merged = merge(cart.lines, toCartLine(checked.data));
  if (merged === null) throw new CartQuantityOverflowError();
  return { version: 1, lines: merged };
}

export function setLineQuantity(cart: Cart, lineKey: string, next: number): Cart {
  if (!isValidQuantity(next)) throw new RangeError("quantity must be a safe integer >= 1");
  return {
    version: 1,
    lines: cart.lines.map((line) =>
      cartLineKey(line) === lineKey ? { ...line, quantity: next } : line,
    ),
  };
}

export function removeLine(cart: Cart, lineKey: string): Cart {
  return removeLines(cart, [lineKey]);
}

export function removeLines(cart: Cart, lineKeys: readonly string[]): Cart {
  return { version: 1, lines: cart.lines.filter((line) => !lineKeys.includes(cartLineKey(line))) };
}

/**
 * Subtracts the ordered quantities from the current Cart, per line key. A line that reaches zero is
 * removed; a line the Order does not cover (added meanwhile) is kept; an ordered key missing from the
 * Cart (removed meanwhile) is not restored. Returns the same `cart` reference when nothing changes.
 */
export function subtractLines(cart: Cart, ordered: readonly CartLine[]): Cart {
  const totals = new Map<string, number>();
  for (const line of ordered) {
    if (!isValidQuantity(line.quantity)) continue;
    const key = cartLineKey(line);
    totals.set(key, (totals.get(key) ?? 0) + line.quantity);
  }
  let changed = false;
  const lines: CartLine[] = [];
  for (const line of cart.lines) {
    const total = totals.get(cartLineKey(line));
    if (total === undefined) {
      lines.push(line);
      continue;
    }
    changed = true;
    const left = line.quantity - total;
    if (left > 0) lines.push({ ...line, quantity: left });
  }
  return changed ? { version: 1, lines } : cart;
}

/** Re-populates the Cart from order items: references and quantities only; items that cannot be in a Cart are skipped. */
export function addFromOrder(cart: Cart, items: readonly OrderItem[]): Cart {
  let next = cart;
  for (const item of items) {
    switch (item.kind) {
      case "ENTRY_TICKET":
        next = addLine(next, {
          kind: "ENTRY_TICKET",
          offeringRef: item.offeringRef,
          quantity: item.quantity,
        });
        break;
      case "GOODS":
        next = addLine(next, { kind: "GOODS", goodsRef: item.goodsRef, quantity: item.quantity });
        break;
      case "KARAOKE":
        break;
      default: {
        const unreachable: never = item;
        return unreachable;
      }
    }
  }
  return next;
}

export function cartTotalQuantity(cart: Cart): number {
  return cart.lines.reduce((sum, line) => sum + line.quantity, 0);
}
