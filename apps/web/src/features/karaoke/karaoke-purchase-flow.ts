import type { CheckoutStart, KaraokePurchaseStart, Ref } from "../../api-client/types";
import { accountPath, type ContinuationIntent } from "../../auth/continuation";
import type { SessionState } from "../../auth/use-session";
import { interpretCheckoutStart } from "../purchase/cart-purchase-flow";

// Pure decisions of the Karaoke purchase start (SPEC-050 13.3 Purchase start). The server (port) result
// decides every step; a Hold is never reused after it expired.

const intentOf = (slotRef: Ref<"slot">): ContinuationIntent => ({
  key: "karaoke-slot",
  ref: slotRef,
});

export type KaraokeProceedPlan = { kind: "go_login"; to: string } | { kind: "start" };

/** Only a known Guest is sent to Login without a request; any other session lets the server decide. */
export function planKaraokeProceed(
  session: SessionState,
  slotRef: Ref<"slot">,
): KaraokeProceedPlan {
  if (session.status === "ready" && session.session.kind === "guest") {
    return { kind: "go_login", to: accountPath("login", intentOf(slotRef)) };
  }
  return { kind: "start" };
}

export type KaraokeStartStep =
  | { kind: "checkout"; orderRef: Ref<"order"> }
  | { kind: "conflict" }
  | { kind: "limit" }
  | { kind: "not_on_sale" }
  | { kind: "unavailable" }
  | { kind: "go_login"; to: string }
  | { kind: "go_verification"; to: string };

export function interpretKaraokeStart(
  result: KaraokePurchaseStart,
  slotRef: Ref<"slot">,
): KaraokeStartStep {
  switch (result.kind) {
    case "held":
      return { kind: "checkout", orderRef: result.orderRef };
    case "slot_unavailable":
      return { kind: "conflict" };
    case "purchase_limit_exceeded":
      return { kind: "limit" };
    case "not_on_sale":
      return { kind: "not_on_sale" };
    case "unavailable":
      return { kind: "unavailable" };
    case "auth_required":
      return { kind: "go_login", to: accountPath("login", intentOf(slotRef)) };
    case "email_unverified":
      return { kind: "go_verification", to: accountPath("email-verification", intentOf(slotRef)) };
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

export type KaraokeCheckoutStep =
  | { kind: "assign"; url: string }
  | { kind: "expired" }
  | { kind: "go_status"; to: string };

export function interpretKaraokeCheckout(
  orderRef: Ref<"order">,
  result: CheckoutStart,
): KaraokeCheckoutStep {
  if (result.kind === "opportunity_expired") return { kind: "expired" };
  return interpretCheckoutStart(orderRef, result);
}
