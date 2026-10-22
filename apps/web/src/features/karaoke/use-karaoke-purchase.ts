"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useApi } from "../../api-client/provider";
import type { CheckoutStart, KaraokePurchaseStart, Ref } from "../../api-client/types";
import { useSession } from "../../auth/use-session";
import { getBrowserCartLifecycle } from "../cart/cart-lifecycle";
import {
  interpretKaraokeCheckout,
  interpretKaraokeStart,
  planKaraokeProceed,
} from "./karaoke-purchase-flow";

export type KaraokePurchasePhase =
  | { kind: "idle" }
  | { kind: "holding" }
  | { kind: "preparing" }
  | { kind: "conflict" }
  | { kind: "limit" }
  | { kind: "not_on_sale" }
  | { kind: "unavailable" }
  | { kind: "expired" }
  | { kind: "cart_busy" }
  | { kind: "cart_recovery" };

export type UseKaraokePurchaseOptions = {
  slotRef: Ref<"slot">;
  /** Called after a conflict or a closed sale so the page reads the current slot again. */
  onRefresh: () => void;
};

// Karaoke purchase start (SPEC-050 13.3). Cart contents never enter the purchase; Guest hand-off applies FR-CRT-012.
export function useKaraokePurchase(options: UseKaraokePurchaseOptions): {
  phase: KaraokePurchasePhase;
  busy: boolean;
  start: () => void;
  dismissCartRecovery: () => void;
} {
  const api = useApi();
  const router = useRouter();
  const session = useSession();
  const [phase, setPhase] = useState<KaraokePurchasePhase>({ kind: "idle" });
  const inFlight = useRef(false);
  const { slotRef, onRefresh } = options;

  const run = useCallback(async (): Promise<void> => {
    inFlight.current = true;
    setPhase({ kind: "holding" });
    const result: KaraokePurchaseStart = await api.purchase
      .startKaraokePurchase(slotRef, { idempotencyKey: crypto.randomUUID() })
      .catch((): KaraokePurchaseStart => ({ kind: "unavailable" }));
    const step = interpretKaraokeStart(result, slotRef);
    switch (step.kind) {
      case "go_login": {
        // A protected purchase operation can be the first place an expired Session is noticed.
        inFlight.current = false;
        const result = getBrowserCartLifecycle()?.expireAuthenticatedCart() ?? "done";
        if (result === "done") {
          setPhase({ kind: "idle" });
          router.push(step.to);
        } else {
          setPhase({ kind: result === "busy" ? "cart_busy" : "cart_recovery" });
        }
        return;
      }
      case "go_verification":
        router.push(step.to);
        return;
      case "conflict":
      case "not_on_sale":
        setPhase({ kind: step.kind });
        inFlight.current = false;
        onRefresh();
        return;
      case "limit":
      case "unavailable":
        setPhase({ kind: step.kind });
        inFlight.current = false;
        return;
      case "checkout": {
        setPhase({ kind: "preparing" });
        const checkout: CheckoutStart = await api.purchase
          .startCheckout(step.orderRef, { idempotencyKey: crypto.randomUUID() })
          .catch((): CheckoutStart => ({ kind: "unavailable" }));
        const next = interpretKaraokeCheckout(step.orderRef, checkout);
        switch (next.kind) {
          case "assign":
            window.location.assign(next.url);
            return;
          case "go_status":
            router.push(next.to);
            return;
          case "expired":
            setPhase({ kind: "expired" });
            inFlight.current = false;
            return;
          default: {
            const unreachable: never = next;
            return unreachable;
          }
        }
      }
      default: {
        const unreachable: never = step;
        return unreachable;
      }
    }
  }, [api, onRefresh, router, slotRef]);

  const start = useCallback((): void => {
    if (inFlight.current) return;
    const plan = planKaraokeProceed(session.state, slotRef);
    if (plan.kind === "go_login") {
      const result = getBrowserCartLifecycle()?.expireAuthenticatedCart() ?? "done";
      if (result === "done") router.push(plan.to);
      else setPhase({ kind: result === "busy" ? "cart_busy" : "cart_recovery" });
      return;
    }
    void run();
  }, [router, run, session.state, slotRef]);

  const busy = phase.kind === "holding" || phase.kind === "preparing";
  return {
    phase,
    busy,
    start,
    dismissCartRecovery: () => setPhase({ kind: "idle" }),
  };
}
