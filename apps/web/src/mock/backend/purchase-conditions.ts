import { assertNever, type KaraokeSlotState } from "@off-r39x/domain";
import type { KaraokeSaleStatus, PurchaseReason } from "../../api-client/types";

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

export type KaraokeConditionTarget =
  | { kind: "missing" } // unknown slot
  | {
      kind: "slot";
      slotState: KaraokeSlotState;
      saleStatus: KaraokeSaleStatus;
      limitReached: boolean;
    };

/**
 * UI mock test double of API-PUR-ELG-001 for one KARAOKE item (quantity 1): max is 0 or 1. Reasons are in
 * the canonical order and without duplicates. The mock has no payment deadline: PAYMENT_WINDOW_TOO_SHORT
 * is never produced (no time constant in the mock, TC-PG-KRK-003-106).
 */
export function evaluateKaraokeConditions(target: KaraokeConditionTarget): PurchaseConditionResult {
  if (target.kind === "missing") {
    return { reasons: ["NOT_PUBLIC_OR_NOT_FOUND"], maxPurchasableQuantity: 0 };
  }
  const reasons: PurchaseReason[] = [];
  switch (target.saleStatus) {
    case "ON_SALE":
      break;
    case "BEFORE_SALES":
      reasons.push("SALES_NOT_STARTED");
      break;
    case "SALES_ENDED":
      reasons.push("SALES_CLOSED");
      break;
    case "SUSPENDED":
      reasons.push("SALES_STOPPED");
      break;
    default:
      return assertNever(target.saleStatus);
  }
  if (target.limitReached) reasons.push("PURCHASE_LIMIT_EXCEEDED");
  if (target.slotState !== "AVAILABLE") reasons.push("SLOT_UNAVAILABLE");
  return { reasons, maxPurchasableQuantity: reasons.length === 0 ? 1 : 0 };
}
