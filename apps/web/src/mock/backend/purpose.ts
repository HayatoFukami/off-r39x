import type { OrderPurpose } from "@off-r39x/domain";

export type OrderLineKind = "ENTRY_TICKET" | "GOODS" | "KARAOKE";

/**
 * BR-ORD-013: the Order purpose follows from the Order lines. Karaoke is never combined with
 * other kinds (there is no composite Karaoke purpose).
 */
export function decidePurpose(kinds: readonly OrderLineKind[]): OrderPurpose {
  if (kinds.length === 0) {
    throw new Error("An Order needs at least one line");
  }
  const hasEntry = kinds.includes("ENTRY_TICKET");
  const hasGoods = kinds.includes("GOODS");
  const hasKaraoke = kinds.includes("KARAOKE");
  if (hasKaraoke) {
    if (hasEntry || hasGoods) {
      throw new Error("Karaoke cannot be combined with other line kinds");
    }
    return "KARAOKE_PURCHASE";
  }
  if (hasEntry && hasGoods) return "ENTRY_GOODS_PURCHASE";
  return hasEntry ? "ENTRY_TICKET_PURCHASE" : "GOODS_PURCHASE";
}
