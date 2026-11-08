import { assertNever } from "@off-r39x/domain";
import type { PurchaseReason, SaleAvailability } from "../../api-client/types";
import { copy } from "../copy/ja";
import { formatJstDateTime } from "../format/datetime";
import type { Tone } from "./order";

export type AvailabilityInput = SaleAvailability | { kind: "not_public" } | { kind: "unavailable" };

export type AvailabilityPresentation = {
  readonly label: string;
  readonly description: string;
  readonly tone: Tone;
  readonly purchasable: boolean;
};

const label = copy.availability.label;
const description = copy.availability.description;

function blocked(text: string, detail: string): AvailabilityPresentation {
  return { label: text, description: detail, tone: "neutral", purchasable: false };
}

export function presentAvailability(input: AvailabilityInput): AvailabilityPresentation {
  switch (input.kind) {
    case "ON_SALE":
      return {
        label: label.ON_SALE,
        description: description.ON_SALE,
        tone: "success",
        purchasable: true,
      };
    case "BEFORE_SALES":
      return {
        label: label.BEFORE_SALES,
        description: copy.availability.beforeSales(formatJstDateTime(input.startsAt)),
        tone: "pending",
        purchasable: false,
      };
    case "SALES_ENDED":
      return blocked(label.SALES_ENDED, description.SALES_ENDED);
    case "SUSPENDED":
      return blocked(label.SUSPENDED, description.SUSPENDED);
    case "SOLD_OUT":
      return blocked(label.SOLD_OUT, description.SOLD_OUT);
    case "INSUFFICIENT_QUANTITY":
      return {
        label: label.INSUFFICIENT_QUANTITY,
        description: copy.availability.insufficientQuantity(String(input.maxSelectableQuantity)),
        tone: "failure",
        purchasable: false,
      };
    case "PURCHASE_LIMIT_EXCEEDED":
      return blocked(label.PURCHASE_LIMIT_EXCEEDED, description.PURCHASE_LIMIT_EXCEEDED);
    case "not_public":
      return blocked(label.NOT_PUBLIC, description.NOT_PUBLIC);
    case "unavailable":
      return {
        label: label.UNAVAILABLE,
        description: description.UNAVAILABLE,
        tone: "review",
        purchasable: false,
      };
    default:
      return assertNever(input);
  }
}

/**
 * The owner-specific reasons of API-PUR-ELG-001 for one line. The label is the first reason's; the
 * description lists every reason in the received order (no reason is merged or dropped).
 */
export function presentPurchaseReasons(
  reasons: readonly PurchaseReason[],
  maxPurchasableQuantity: number,
): AvailabilityPresentation {
  const first = reasons[0];
  if (first === undefined) return presentAvailability({ kind: "unavailable" });
  const details = reasons.map((reason) =>
    reason === "INSUFFICIENT_QUANTITY" && maxPurchasableQuantity >= 1
      ? copy.availability.insufficientQuantity(String(maxPurchasableQuantity))
      : presentRejectionReason(reason).description,
  );
  return {
    label: presentRejectionReason(first).label,
    description: details.join(" "),
    tone: first === "INSUFFICIENT_QUANTITY" ? "failure" : "neutral",
    purchasable: false,
  };
}

export type RejectionPresentation = {
  readonly label: string;
  readonly description: string;
};

export function presentRejectionReason(reason: PurchaseReason): RejectionPresentation {
  switch (reason) {
    case "NOT_PUBLIC_OR_NOT_FOUND":
      return { label: label.NOT_PUBLIC, description: description.NOT_PUBLIC };
    case "SALES_NOT_STARTED":
      return { label: label.BEFORE_SALES, description: description.BEFORE_SALES };
    case "SALES_CLOSED":
      return { label: label.SALES_ENDED, description: description.SALES_ENDED };
    case "SALES_STOPPED":
      return { label: label.SUSPENDED, description: description.SUSPENDED };
    case "SOLD_OUT":
      return { label: label.SOLD_OUT, description: description.SOLD_OUT };
    case "INSUFFICIENT_QUANTITY":
      return {
        label: label.INSUFFICIENT_QUANTITY,
        description: description.INSUFFICIENT_QUANTITY,
      };
    case "PURCHASE_LIMIT_EXCEEDED":
      return {
        label: label.PURCHASE_LIMIT_EXCEEDED,
        description: description.PURCHASE_LIMIT_EXCEEDED,
      };
    case "SLOT_UNAVAILABLE":
      return { label: label.SLOT_UNAVAILABLE, description: description.SLOT_UNAVAILABLE };
    case "PAYMENT_WINDOW_TOO_SHORT":
      return {
        label: label.PAYMENT_WINDOW_TOO_SHORT,
        description: description.PAYMENT_WINDOW_TOO_SHORT,
      };
    default:
      return assertNever(reason);
  }
}
