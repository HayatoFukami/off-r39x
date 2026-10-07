import { assertNever, type OrderState } from "@off-r39x/domain";
import { copy } from "../copy/ja";

export type Tone = "success" | "pending" | "failure" | "neutral" | "review";

export type OrderCategory =
  | "pending_retryable"
  | "pending"
  | "success"
  | "terminal_failure"
  | "terminal"
  | "recovery_pending";

export type OrderAction =
  | "retry_checkout"
  | "recheck_status"
  | "view_purchase"
  | "view_entitlements"
  | "purchase_again";

export type OrderPresentation = {
  readonly label: string;
  readonly description: string;
  readonly category: OrderCategory;
  readonly tone: Tone;
  readonly showsEntitlements: boolean;
  readonly actions: readonly OrderAction[];
};

export function presentOrderState(state: OrderState): OrderPresentation {
  switch (state) {
    case "PREPARED":
      return {
        label: copy.order.state.PREPARED,
        description: copy.order.description.PREPARED,
        category: "pending_retryable",
        tone: "pending",
        showsEntitlements: false,
        actions: ["retry_checkout"],
      };
    case "AWAITING_PAYMENT":
      return {
        label: copy.order.state.AWAITING_PAYMENT,
        description: copy.order.description.AWAITING_PAYMENT,
        category: "pending",
        tone: "pending",
        showsEntitlements: false,
        actions: ["recheck_status"],
      };
    case "CONFIRMED":
      return {
        label: copy.order.state.CONFIRMED,
        description: copy.order.description.CONFIRMED,
        category: "success",
        tone: "success",
        showsEntitlements: true,
        actions: ["view_purchase", "view_entitlements"],
      };
    case "PAYMENT_FAILED":
      return {
        label: copy.order.state.PAYMENT_FAILED,
        description: copy.order.description.PAYMENT_FAILED,
        category: "terminal_failure",
        tone: "failure",
        showsEntitlements: false,
        actions: ["purchase_again"],
      };
    case "CANCELED":
      return {
        label: copy.order.state.CANCELED,
        description: copy.order.description.CANCELED,
        category: "terminal",
        tone: "neutral",
        showsEntitlements: false,
        actions: ["purchase_again"],
      };
    case "EXPIRED":
      return {
        label: copy.order.state.EXPIRED,
        description: copy.order.description.EXPIRED,
        category: "terminal",
        tone: "neutral",
        showsEntitlements: false,
        actions: ["purchase_again"],
      };
    case "REVIEW_REQUIRED":
      return {
        label: copy.order.state.REVIEW_REQUIRED,
        description: copy.order.description.REVIEW_REQUIRED,
        category: "recovery_pending",
        tone: "review",
        showsEntitlements: false,
        actions: ["recheck_status"],
      };
    default:
      return assertNever(state);
  }
}

export function orderActionLabel(action: OrderAction): string {
  switch (action) {
    case "retry_checkout":
      return copy.order.action.retry_checkout;
    case "recheck_status":
      return copy.order.action.recheck_status;
    case "view_purchase":
      return copy.order.action.view_purchase;
    case "view_entitlements":
      return copy.order.action.view_entitlements;
    case "purchase_again":
      return copy.order.action.purchase_again;
    default:
      return assertNever(action);
  }
}

export function visibleEntitlements<T>(state: OrderState, entitlements: T): T | null {
  return presentOrderState(state).showsEntitlements ? entitlements : null;
}
