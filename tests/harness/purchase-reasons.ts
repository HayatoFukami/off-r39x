import type { PurchaseReason } from "../../apps/web/src/api-client/types.ts";

/** SPEC-110 API-PUR-ELG-001 reasons in the canonical order, as shared by API-PUR-CART-001 item failures. */
export const PURCHASE_REASONS = [
  "NOT_PUBLIC_OR_NOT_FOUND",
  "SALES_NOT_STARTED",
  "SALES_CLOSED",
  "SALES_STOPPED",
  "SOLD_OUT",
  "INSUFFICIENT_QUANTITY",
  "PURCHASE_LIMIT_EXCEEDED",
  "SLOT_UNAVAILABLE",
  "PAYMENT_WINDOW_TOO_SHORT",
] as const satisfies readonly PurchaseReason[];
