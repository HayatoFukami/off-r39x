"use client";

import { assertNever } from "@off-r39x/domain";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyIfLatest, invalidateRequests } from "../../api-client/latest-request";
import { useApi } from "../../api-client/provider";
import { settleRead } from "../../api-client/settle-read";
import type { CheckoutStart, OrderDetail, Ref } from "../../api-client/types";
import { AccessDeniedView } from "../../presentation/components/access-denied-view";
import type { Loadable } from "../../presentation/components/list-state";
import { PageState } from "../../presentation/components/page-state";
import { copy } from "../../presentation/copy/ja";
import { CartRecovery } from "../cart/cart-recovery";
import { useCart } from "../cart/use-cart";
import { interpretCheckoutStart } from "./cart-purchase-flow";
import { OrderOutcome, type OrderOutcomePending, type OutcomeButtonAction } from "./order-outcome";
import { planPurchaseAgain } from "./purchase-again";
import {
  buildPurchaseStatusModel,
  type PurchaseStatusModel,
  recheckAnnouncement,
} from "./purchase-status-model";

// PG-XFN-001 container (SPEC-050 16, 21, 22, 26.2). The Order is read once per mount and once per
// "recheck" press; the page creates no Order and confirms nothing: only the server state is shown.
// Only the last-started read is shown: an older read that finishes later is dropped.

// PG-MYP-004 shows the same outcome with its own heading, subject, model and a way back (SPEC-050 18.4).
export type PurchaseStatusVariant = {
  heading: string;
  subject: string;
  buildModel: (input: Loadable<OrderDetail>) => PurchaseStatusModel;
  backLink: { href: string; label: string } | null;
};

const PURCHASE_VARIANT: PurchaseStatusVariant = {
  heading: copy.purchase.heading,
  subject: copy.purchase.subject,
  buildModel: buildPurchaseStatusModel,
  backLink: null,
};

export function PurchaseStatusPage({
  orderRef,
  variant = PURCHASE_VARIANT,
}: {
  orderRef: Ref<"order">;
  variant?: PurchaseStatusVariant;
}) {
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

  // Every read of the Order (mount, reload, recheck, retry follow-up) shares one counter.
  const requests = useRef(0);

  useEffect(() => {
    const counter = requests;
    void applyIfLatest(counter, settleRead(api.self.getOrder(orderRef)), setRead);
    return () => invalidateRequests(counter);
  }, [api, orderRef]);

  const reload = useCallback((): void => {
    setRead({ kind: "loading" });
    void applyIfLatest(requests, settleRead(api.self.getOrder(orderRef)), setRead);
  }, [api, orderRef]);

  const recheck = async (): Promise<void> => {
    const previous = shown.current;
    setPending("recheck_status");
    setAlertMessage(null);
    setLiveMessage(copy.purchase.recheck.inProgress);
    const applied = await applyIfLatest(
      requests,
      settleRead(api.self.getOrder(orderRef)),
      (next) => {
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
      },
    );
    // A superseded result is dropped without any message.
    if (!applied) {
      setPending(null);
      setLiveMessage("");
    }
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
    const applied = await applyIfLatest(
      requests,
      settleRead(api.self.getOrder(orderRef)),
      (next) => {
        setPending(null);
        setLiveMessage("");
        if (next.kind === "ok" || next.kind === "not_found") setRead(next);
        if (result.kind === "start_failed") setAlertMessage(copy.purchase.checkoutStartFailed);
      },
    );
    if (!applied) {
      setPending(null);
      setLiveMessage("");
    }
  };

  const purchaseAgain = (): void => {
    const order = shown.current;
    if (order === null) return;
    const plan = planPurchaseAgain(order.purpose, order.items);
    if (plan.kind === "karaoke") {
      router.push(plan.href);
      return;
    }
    if (cart.state.kind !== "ready" && cart.state.kind !== "corrupted") {
      setAlertMessage(
        cart.state.kind === "busy"
          ? copy.cart.lifecycleBusy.description
          : copy.cart.lifecycleBlocked.description,
      );
      return;
    }
    const written = cart.addFromOrder(plan.items);
    // An unreadable Cart is left as it is: the Cart page explains it.
    if (written.kind === "storage_unavailable") {
      setAlertMessage(copy.sales.addFailed);
      return;
    }
    if (written.kind === "busy") {
      setAlertMessage(copy.cart.lifecycleBusy.description);
      return;
    }
    if (written.kind === "blocked") {
      setAlertMessage(copy.cart.lifecycleBlocked.description);
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

  const model = variant.buildModel(read);
  const hasCartPurchaseAgain =
    model.kind === "ready" &&
    model.actions.some((action) => action.kind === "purchase_again" && action.target === "cart");
  const cartUnavailable =
    cart.state.kind === "busy" ||
    cart.state.kind === "blocked" ||
    cart.state.kind === "storage_unavailable" ||
    cart.state.kind === "loading";
  const needsCartRecovery =
    hasCartPurchaseAgain &&
    (cart.state.kind === "blocked" || cart.state.kind === "storage_unavailable");

  // Ownership failure: nothing of the Order was rendered before this view (SPEC-050 26.2).
  if (model.kind === "denied") {
    return <AccessDeniedView listHref="/mypage/orders" listLabel={copy.accessDenied.ordersLink} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{variant.heading}</h1>
      {model.kind === "loading" ? <PageState state="loading" /> : null}
      {model.kind === "unavailable" ? (
        <PageState
          state="unavailable"
          message={copy.pageState.unavailable(variant.subject)}
          onRetry={reload}
        />
      ) : null}
      {model.kind === "ready" ? (
        <OrderOutcome
          model={model}
          liveMessage={
            cart.state.kind === "busy" ? copy.cart.lifecycleBusy.description : liveMessage
          }
          alertMessage={needsCartRecovery ? null : alertMessage}
          pending={pending}
          disableCartPurchaseAgain={hasCartPurchaseAgain && cartUnavailable}
          onAction={handleAction}
        />
      ) : null}
      {needsCartRecovery ? (
        <CartRecovery {...(alertMessage === null ? {} : { message: alertMessage })} />
      ) : null}
      {model.kind === "ready" && variant.backLink !== null ? (
        <p>
          <Link
            href={variant.backLink.href}
            prefetch={false}
            className="text-brand underline underline-offset-4"
          >
            {variant.backLink.label}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
