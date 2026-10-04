import type {
  CartPurchaseStart,
  CartRejectionReasonCode,
  CheckoutStart,
  Ref,
} from "../../api-client/types";
import { accountPath, type ContinuationIntent, isSafeRelativePath } from "../../auth/continuation";
import type { SessionState } from "../../auth/use-session";
import { purchaseOrderHref } from "../../config/purchase-routes";
import { copy } from "../../presentation/copy/ja";
import { presentRejectionReason } from "../../presentation/state-mapping/availability";

// Pure decisions of the Cart purchase start (SPEC-050 14A.1, 16.6, SEC-WEB-005). No Order is created here:
// the server (port) result decides every step and the UI never treats an unverified Identity as purchasable.

const CART_INTENT: ContinuationIntent = { key: "cart", ref: null };

export type ProceedPlan = { kind: "go_login"; to: string } | { kind: "start" };

/** Only a known Guest is sent to Login without a request; any other session lets the server decide. */
export function planProceed(session: SessionState): ProceedPlan {
  if (session.status === "ready" && session.session.kind === "guest") {
    return { kind: "go_login", to: accountPath("login", CART_INTENT) };
  }
  return { kind: "start" };
}

export type CartStartStep =
  | { kind: "checkout"; orderRef: Ref<"order">; includedLineKeys: readonly string[] }
  | {
      kind: "rejected";
      rejections: readonly { lineKey: string; reason: CartRejectionReasonCode }[];
    }
  | { kind: "go_login"; to: string }
  | { kind: "go_verification"; to: string }
  | { kind: "unavailable" };

export function interpretCartStart(result: CartPurchaseStart): CartStartStep {
  switch (result.kind) {
    case "created":
      return {
        kind: "checkout",
        orderRef: result.orderRef,
        includedLineKeys: result.includedLineKeys,
      };
    case "rejected":
      return { kind: "rejected", rejections: result.rejections };
    case "auth_required":
      return { kind: "go_login", to: accountPath("login", CART_INTENT) };
    case "email_unverified":
      return { kind: "go_verification", to: accountPath("email-verification", CART_INTENT) };
    case "unavailable":
      return { kind: "unavailable" };
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

export type CheckoutStep = { kind: "assign"; url: string } | { kind: "go_status"; to: string };

const hasControlOrSpace = (value: string): boolean =>
  [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x20 || code === 0x7f;
  });

/** A same-origin relative path, or an https URL without credentials. Never throws. */
export function isSafeCheckoutUrl(url: string): boolean {
  if (typeof url !== "string" || url === "") return false;
  if (url.startsWith("/")) return isSafeRelativePath(url);
  if (!url.startsWith("https://")) return false;
  if (hasControlOrSpace(url) || url.includes("\\")) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}

/** Anything other than a safe redirect reads the same Order again; there is no blind retry. */
export function interpretCheckoutStart(
  orderRef: Ref<"order">,
  result: CheckoutStart,
): CheckoutStep {
  if (result.kind === "redirect" && isSafeCheckoutUrl(result.url)) {
    return { kind: "assign", url: result.url };
  }
  return { kind: "go_status", to: purchaseOrderHref(orderRef) };
}

export type RejectionLine = { lineKey: string; name: string; label: string; description: string };

export function describeRejections(
  rejections: readonly { lineKey: string; reason: CartRejectionReasonCode }[],
  names: ReadonlyMap<string, string | null>,
): RejectionLine[] {
  return rejections.map((rejection) => {
    const presented = presentRejectionReason(rejection.reason);
    return {
      lineKey: rejection.lineKey,
      name: names.get(rejection.lineKey) ?? copy.cart.unknownItemName,
      label: presented.label,
      description: presented.description,
    };
  });
}
