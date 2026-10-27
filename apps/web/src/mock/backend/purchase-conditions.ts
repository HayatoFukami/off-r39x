import type { PurchaseReason } from "../../api-client/types";

// UI mock test double of the SPEC-110 API-PUR-ELG-001 reason evaluation; not a contract (DEV-WEB-010).
// Pure: no React, storage or clock. The time is an argument.

export type PurchaseConditionTarget =
  | { kind: "missing" } // not published or unknown: the two are never distinguished
  | {
      kind: "sellable";
      control: "ENABLED" | "SUSPENDED";
      startsAt: string;
      endsAt: string;
      remaining: number;
      perAccountLimit: number | null;
      used: number;
    };

export type PurchaseConditionResult = {
  reasons: PurchaseReason[];
  maxPurchasableQuantity: number;
};

/**
 * Every confirmed reason for one line, in the canonical order of API-PUR-ELG-001 and without
 * duplicates. The co-occurrence rules are a mock decision (the specification leaves the detail open):
 * all reasons are listed, so a closed or stopped sale still lists the stock and quota reasons.
 */
export function evaluatePurchaseConditions(
  target: PurchaseConditionTarget,
  requested: number,
  nowMs: number,
): PurchaseConditionResult {
  if (target.kind === "missing") {
    return { reasons: ["NOT_PUBLIC_OR_NOT_FOUND"], maxPurchasableQuantity: 0 };
  }
  const reasons: PurchaseReason[] = [];
  let outsideSalesWindow = false;
  if (nowMs < Date.parse(target.startsAt)) {
    reasons.push("SALES_NOT_STARTED");
    outsideSalesWindow = true;
  }
  if (nowMs >= Date.parse(target.endsAt)) {
    reasons.push("SALES_CLOSED");
    outsideSalesWindow = true;
  }
  if (target.control === "SUSPENDED") {
    reasons.push("SALES_STOPPED");
    outsideSalesWindow = true;
  }
  if (target.remaining === 0) {
    reasons.push("SOLD_OUT");
  } else if (requested > target.remaining) {
    reasons.push("INSUFFICIENT_QUANTITY");
  }
  const accountLeft =
    target.perAccountLimit === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, target.perAccountLimit - target.used);
  if (target.perAccountLimit !== null && requested > accountLeft) {
    reasons.push("PURCHASE_LIMIT_EXCEEDED");
  }
  const maxPurchasableQuantity = outsideSalesWindow ? 0 : Math.min(target.remaining, accountLeft);
  return { reasons, maxPurchasableQuantity };
}
