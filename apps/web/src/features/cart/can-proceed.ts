import { cartLineKey } from "../../api-client/cart-line-key";
import type { CartLine, CartLineResolution } from "../../api-client/types";

// Proceeding is enabled only for a non-empty Cart whose every line is shown as purchasable (SPEC-050 14A.1).

export type ProceedBlockReason =
  | { kind: "empty" }
  | { kind: "unresolved" }
  | {
      kind: "line";
      lineKey: string;
      reason:
        | "BEFORE_SALES"
        | "SALES_ENDED"
        | "SUSPENDED"
        | "SOLD_OUT"
        | "INSUFFICIENT_QUANTITY"
        | "PURCHASE_LIMIT_EXCEEDED"
        | "unavailable"
        | "not_public";
    };

export type ProceedDecision =
  | { canProceed: true }
  | { canProceed: false; reasons: readonly ProceedBlockReason[] };

type LineReason = Extract<ProceedBlockReason, { kind: "line" }>["reason"];

/** null = purchasable. A line without an answer is unknown, never purchasable. */
function blockReason(
  line: CartLine,
  resolution: CartLineResolution | undefined,
): LineReason | null {
  if (resolution === undefined) return "unavailable";
  switch (resolution.status) {
    case "unavailable":
      return "unavailable";
    case "not_public":
      return "not_public";
    case "resolved": {
      const availability = resolution.availability;
      if (availability.kind !== "ON_SALE") return availability.kind;
      const max = availability.maxSelectableQuantity;
      return max !== null && max < line.quantity ? "INSUFFICIENT_QUANTITY" : null;
    }
    default: {
      const unreachable: never = resolution;
      return unreachable;
    }
  }
}

export function canProceed(
  lines: readonly CartLine[],
  resolutions: readonly CartLineResolution[] | null,
): ProceedDecision {
  if (lines.length === 0) return { canProceed: false, reasons: [{ kind: "empty" }] };
  if (resolutions === null) return { canProceed: false, reasons: [{ kind: "unresolved" }] };
  const reasons: ProceedBlockReason[] = [];
  for (const line of lines) {
    const lineKey = cartLineKey(line);
    const reason = blockReason(
      line,
      resolutions.find((resolution) => resolution.lineKey === lineKey),
    );
    if (reason !== null) reasons.push({ kind: "line", lineKey, reason });
  }
  return reasons.length === 0 ? { canProceed: true } : { canProceed: false, reasons };
}
