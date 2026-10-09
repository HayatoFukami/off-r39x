import { cartTotalQuantity, parseCart } from "./cart-model";

// Read-only cart quantity for the Header (SPEC-050 8.5). The stored shape is owned by cart-model.ts.

export const CART_STORAGE_KEY = "r39x.cart.v1";

/** null = absent or invalid (unknown), 0 = valid empty cart. Never touches storage. */
export function readCartCount(raw: string | null): number | null {
  if (raw === null) return null;
  const load = parseCart(raw);
  return load.kind === "ok" ? cartTotalQuantity(load.cart) : null;
}
