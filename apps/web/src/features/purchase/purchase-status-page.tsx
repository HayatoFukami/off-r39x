"use client";

import { assertNever } from "@off-r39x/domain";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../api-client/provider";
import { settleRead } from "../../api-client/settle-read";
import type { CheckoutStart, OrderDetail, Ref } from "../../api-client/types";
import { AccessDeniedView } from "../../presentation/components/access-denied-view";
import type { Loadable } from "../../presentation/components/list-state";
import { PageState } from "../../presentation/components/page-state";
import { copy } from "../../presentation/copy/ja";
import { useCart } from "../cart/use-cart";
import { interpretCheckoutStart } from "./cart-purchase-flow";
import { OrderOutcome, type OrderOutcomePending, type OutcomeButtonAction } from "./order-outcome";
import { planPurchaseAgain } from "./purchase-again";
import { buildPurchaseStatusModel, recheckAnnouncement } from "./purchase-status-model";

// PG-XFN-001 container (SPEC-050 16, 21, 22, 26.2). The Order is read once per mount and once per
// "recheck" press; the page creates no Order and confirms nothing: only the server state is shown.

export function PurchaseStatusPage({ orderRef }: { orderRef: Ref<"order"> }) {
  const api = useApi();
  const router = useRouter();
  const cart = useCart();
  const [read, setRead] = useState<Loadable<OrderDetail>>({ kind: "loading" });
  const [liveMessage, setLiveMessage] = useState("");
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<OrderOutcomePending>(null);
  // The Order shown at the moment an action starts (the recheck compares against it).
  const shown = useRef<OrderDetail | null>(null);
  shown.current = read.kind === "ok" ? read.data : shown.current;

  useEffect(() => {
    let active = true;
    void settleRead(api.self.getOrder(orderRef)).then((value) => {
      if (active) setRead(value);
    });
    return () => {
      active = false;
    };
  }, [api, orderRef]);

  const reload = useCallback((): void => {
    setRead({ kind: "loading" });
    void settleRead(api.self.getOrder(orderRef)).then((value) => setRead(value));
  }, [api, orderRef]);

  const recheck = async (): Promise<void> => {
    const previous = shown.current;
    setPending("recheck_status");
    setAlertMessage(null);
    setLiveMessage(copy.purchase.recheck.inProgress);
    const next = await settleRead(api.self.getOrder(orderRef));
    setPending(null);
    if (next.kind === "ok") {
      setRead(next);
      setLiveMessage(
        previous === null
          ? copy.purchase.recheck.unchanged
          : recheckAnnouncement(previous.state, next.data.state),
      );
      return;
    }
    if (next.kind === "not_found") {
      setRead(next);
      return;
    }
    // The Order that was shown stays; only the failure is reported.
    setLiveMessage("");
    setAlertMessage(copy.purchase.recheck.failed);
  };

  const retryCheckout = async (): Promise<void> => {
    setPending("retry_checkout");
    setAlertMessage(null);
    setLiveMessage(copy.purchase.checkoutPreparing);
    const result: CheckoutStart = await api.purchase
      .startCheckout(orderRef, { idempotencyKey: crypto.randomUUID() })
      .catch((): CheckoutStart => ({ kind: "unavailable" }));
    const step = interpretCheckoutStart(orderRef, result);
    if (step.kind === "assign") {
      window.location.assign(step.url);
      return;
    }
    // Anything else reads the same Order again: no blind retry, no new Order.
    const next = await settleRead(api.self.getOrder(orderRef));
    setPending(null);
    setLiveMessage("");
    if (next.kind === "ok" || next.kind === "not_found") setRead(next);
    if (result.kind === "start_failed") setAlertMessage(copy.purchase.checkoutStartFailed);
  };

  const purchaseAgain = (): void => {
    const order = shown.current;
    if (order === null) return;
    const plan = planPurchaseAgain(order.purpose, order.items);
    if (plan.kind === "karaoke") {
      router.push(plan.href);
      return;
    }
    const written = cart.addFromOrder(plan.items);
    // An unreadable Cart is left as it is: the Cart page explains it.
    if (written.kind === "storage_unavailable") {
      setAlertMessage(copy.sales.addFailed);
      return;
    }
    router.push(plan.href);
  };

  const handleAction = (action: OutcomeButtonAction): void => {
    switch (action.kind) {
      case "recheck_status":
        void recheck();
        return;
      case "retry_checkout":
        void retryCheckout();
        return;
      case "purchase_again":
        purchaseAgain();
        return;
      default:
        assertNever(action);
    }
  };

  const model = buildPurchaseStatusModel(read);

  // Ownership failure: nothing of the Order was rendered before this view (SPEC-050 26.2).
  if (model.kind === "denied") {
    return <AccessDeniedView listHref="/mypage/orders" listLabel={copy.accessDenied.ordersLink} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{copy.purchase.heading}</h1>
      {model.kind === "loading" ? <PageState state="loading" /> : null}
      {model.kind === "unavailable" ? (
        <PageState
          state="unavailable"
          message={copy.pageState.unavailable(copy.purchase.subject)}
          onRetry={reload}
        />
      ) : null}
      {model.kind === "ready" ? (
        <OrderOutcome
          model={model}
          liveMessage={liveMessage}
          alertMessage={alertMessage}
          pending={pending}
          onAction={handleAction}
        />
      ) : null}
    </div>
  );
}
