import { cartLineKey } from "../../api-client/cart-line-key";
import type { CartLine, CartLineResolution, PurchaseReason } from "../../api-client/types";
import { type EligibilityInput, findEligibility } from "../purchase/eligibility-model";

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
        | "not_public"
        | PurchaseReason;
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

/**
 * The owner-scoped answer for a line that is purchasable on the public conditions (API-PUR-ELG-001).
 * "waiting" is a pending or failed read: never treated as purchasable.
 */
function eligibilityBlock(
  line: CartLine,
  lineKey: string,
  eligibility: EligibilityInput,
): LineReason | "waiting" | null {
  switch (eligibility.kind) {
    case "not_applicable":
      return null;
    case "loading":
    case "unavailable":
      return "waiting";
    case "ok": {
      const entry = findEligibility(eligibility, lineKey);
      if (entry === undefined) return "unavailable";
      if (!entry.purchasable) return entry.reasons[0] ?? "unavailable";
      return entry.maxPurchasableQuantity < line.quantity ? "INSUFFICIENT_QUANTITY" : null;
    }
    default: {
      const unreachable: never = eligibility;
      return unreachable;
    }
  }
}

export function canProceed(
  lines: readonly CartLine[],
  resolutions: readonly CartLineResolution[] | null,
  eligibility: EligibilityInput = { kind: "not_applicable" },
): ProceedDecision {
  if (lines.length === 0) return { canProceed: false, reasons: [{ kind: "empty" }] };
  if (resolutions === null) return { canProceed: false, reasons: [{ kind: "unresolved" }] };
  const reasons: ProceedBlockReason[] = [];
  let waiting = false;
  for (const line of lines) {
    const lineKey = cartLineKey(line);
    const publicReason = blockReason(
      line,
      resolutions.find((resolution) => resolution.lineKey === lineKey),
    );
    // Only a line that is purchasable on the public conditions is narrowed by the owner conditions.
    const reason = publicReason ?? eligibilityBlock(line, lineKey, eligibility);
    if (reason === "waiting") {
      if (!waiting) reasons.push({ kind: "unresolved" });
      waiting = true;
    } else if (reason !== null) {
      reasons.push({ kind: "line", lineKey, reason });
    }
  }
  return reasons.length === 0 ? { canProceed: true } : { canProceed: false, reasons };
}
