"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useApi } from "../../api-client/provider";
import type { CheckoutStart, KaraokePurchaseStart, Ref } from "../../api-client/types";
import { useSession } from "../../auth/use-session";
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
  | { kind: "expired" };

export type UseKaraokePurchaseOptions = {
  slotRef: Ref<"slot">;
  /** Called after a conflict or a closed sale so the page reads the current slot again. */
  onRefresh: () => void;
};

// Karaoke purchase start (SPEC-050 13.3). Every decision comes from the port result; each attempt uses a
// fresh idempotency key. The Cart is never involved (BR-ORD-019).
export function useKaraokePurchase(options: UseKaraokePurchaseOptions): {
  phase: KaraokePurchasePhase;
  busy: boolean;
  start: () => void;
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
      case "go_login":
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
      router.push(plan.to);
      return;
    }
    void run();
  }, [router, run, session.state, slotRef]);

  const busy = phase.kind === "holding" || phase.kind === "preparing";
  return { phase, busy, start };
}
