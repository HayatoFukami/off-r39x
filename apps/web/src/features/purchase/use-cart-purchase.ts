"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useApi } from "../../api-client/provider";
import type { CartPurchaseStart, CheckoutStart } from "../../api-client/types";
import { useSession } from "../../auth/use-session";
import { useCart } from "../cart/use-cart";
import {
  describeRejections,
  interpretCartStart,
  interpretCheckoutStart,
  planProceed,
  type RejectionLine,
} from "./cart-purchase-flow";

export type CartPurchasePhase =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "preparing" }
  | { kind: "rejected"; rejections: readonly RejectionLine[] }
  | { kind: "unavailable" };

export type UseCartPurchaseOptions = {
  /** The names of the Cart lines by line key (read through the port by the Cart page). */
  names: ReadonlyMap<string, string | null>;
  /** Called after a rejection so the Cart reads the current state of its lines again. */
  onRejected: () => void;
};

// Cart purchase start (SPEC-050 14A.1). Every decision comes from the port result; each attempt uses a
// fresh idempotency key. A Browser Return never confirms anything: this hook only hands the Order on.
export function useCartPurchase(options: UseCartPurchaseOptions): {
  phase: CartPurchasePhase;
  busy: boolean;
  start: () => void;
} {
  const api = useApi();
  const router = useRouter();
  const session = useSession();
  const cart = useCart();
  const [phase, setPhase] = useState<CartPurchasePhase>({ kind: "idle" });
  const inFlight = useRef(false);
  const { names, onRejected } = options;

  const lines = cart.state.kind === "ready" ? cart.state.cart.lines : null;
  const removeLines = cart.removeLines;

  const run = useCallback(async (): Promise<void> => {
    if (lines === null || lines.length === 0) return;
    inFlight.current = true;
    setPhase({ kind: "verifying" });
    const result: CartPurchaseStart = await api.purchase
      .startCartPurchase(lines, { idempotencyKey: crypto.randomUUID() })
      .catch((): CartPurchaseStart => ({ kind: "unavailable" }));
    const step = interpretCartStart(result);
    switch (step.kind) {
      case "go_login":
      case "go_verification":
        router.push(step.to);
        return;
      case "rejected":
        setPhase({ kind: "rejected", rejections: describeRejections(step.rejections, names) });
        inFlight.current = false;
        onRejected();
        return;
      case "unavailable":
        setPhase({ kind: "unavailable" });
        inFlight.current = false;
        return;
      case "checkout": {
        setPhase({ kind: "preparing" });
        // The Order exists: a failed Cart write must not stop the hand-off to Checkout.
        removeLines(step.includedLineKeys);
        const checkout: CheckoutStart = await api.purchase
          .startCheckout(step.orderRef, { idempotencyKey: crypto.randomUUID() })
          .catch((): CheckoutStart => ({ kind: "unavailable" }));
        const next = interpretCheckoutStart(step.orderRef, checkout);
        if (next.kind === "assign") {
          window.location.assign(next.url);
        } else {
          router.push(next.to);
        }
        return;
      }
      default: {
        const unreachable: never = step;
        return unreachable;
      }
    }
  }, [api, lines, names, onRejected, removeLines, router]);

  const start = useCallback((): void => {
    if (inFlight.current) return;
    const plan = planProceed(session.state);
    if (plan.kind === "go_login") {
      router.push(plan.to);
      return;
    }
    void run();
  }, [router, run, session.state]);

  const busy = phase.kind === "verifying" || phase.kind === "preparing";
  return { phase, busy, start };
}
