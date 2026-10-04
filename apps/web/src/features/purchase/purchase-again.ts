import type { OrderPurpose } from "@off-r39x/domain";
import type { OrderItem } from "../../api-client/types";
import { purchaseAgainTarget } from "../../presentation/state-mapping/purpose";

// Purchase again (SPEC-050 16.4): Entry / Goods go back to the Cart, Karaoke restarts from slot selection.

export type PurchaseAgainPlan =
  | { kind: "karaoke"; href: "/karaoke" }
  | { kind: "cart"; href: "/cart"; items: readonly OrderItem[] };

export function planPurchaseAgain(
  purpose: OrderPurpose,
  items: readonly OrderItem[],
): PurchaseAgainPlan {
  if (purchaseAgainTarget(purpose) === "karaoke") return { kind: "karaoke", href: "/karaoke" };
  // Karaoke can never be a Cart line (FR-CRT-002).
  return {
    kind: "cart",
    href: "/cart",
    items: items.filter((item) => item.kind === "ENTRY_TICKET" || item.kind === "GOODS"),
  };
}
