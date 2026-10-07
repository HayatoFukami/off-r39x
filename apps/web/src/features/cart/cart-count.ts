import { z } from "zod";

// Read-only cart quantity for the Header (SPEC-050 8.5). The stored shape carries references and
// quantities only (FR-CRT-003); every level is strict so a price or stock value is never accepted.

export const CART_STORAGE_KEY = "r39x.cart.v1";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const quantity = z.number().int().min(1);

const cartSchema = z.strictObject({
  version: z.literal(1),
  lines: z.array(
    z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("ENTRY_TICKET"), offeringRef: uuid, quantity }),
      z.strictObject({ kind: z.literal("GOODS"), goodsRef: uuid, quantity }),
    ]),
  ),
});

/** null = absent or invalid (unknown), 0 = valid empty cart. Never touches storage. */
export function readCartCount(raw: string | null): number | null {
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = cartSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data.lines.reduce((sum, line) => sum + line.quantity, 0);
}
