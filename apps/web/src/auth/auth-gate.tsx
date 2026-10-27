"use client";

import { type ReactNode, useEffect } from "react";
import { getBrowserCartLifecycle } from "../features/cart/cart-lifecycle";
import { CartRecovery } from "../features/cart/cart-recovery";
import { useCart } from "../features/cart/use-cart";
import { PageState } from "../presentation/components/page-state";
import { Button } from "../presentation/components/ui/button";
import { copy } from "../presentation/copy/ja";
import { usePathname, useRouter } from "../routing/navigation";
import { decideGate } from "./gate-decision";
import { isLogoutInProgress } from "./logout-signal";
import { useSession } from "./use-session";

/**
 * Renders protected content only for an Authenticated User with a verified email (AR-SES-007,
 * SPEC-050 15.6). Loading, redirecting and unavailable states never show the content.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { state } = useSession();
  const cart = useCart();
  const pathname = usePathname();
  const router = useRouter();
  const decision = decideGate(state, pathname);
  const cartBlocked = cart.state.kind === "blocked";
  const cartBusy = cart.state.kind === "busy";
  const guestRedirect = decision.kind === "redirect" && decision.reason === "guest";
  const redirectTo = decision.kind === "redirect" ? decision.to : null;

  useEffect(() => {
    if (redirectTo === null || (guestRedirect && (cartBlocked || cartBusy))) return;
    // A Logout in this tab ends on Home; only a change made elsewhere sends the page to Login.
    if (isLogoutInProgress()) return;
    if (
      guestRedirect &&
      (getBrowserCartLifecycle()?.expireAuthenticatedCart() ?? "done") !== "done"
    )
      return;
    router.replace(redirectTo);
  }, [redirectTo, router, cartBlocked, cartBusy, guestRedirect]);

  // A page restored from the back/forward cache re-checks the Session (SPEC-050 15.6).
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  if (guestRedirect && cartBlocked) return <CartRecovery />;
  if (guestRedirect && cartBusy) {
    return (
      <p role="status" className="text-sm text-foreground/80">
        {copy.cart.lifecycleBusy.description}
      </p>
    );
  }

  switch (decision.kind) {
    case "allow":
      return <>{children}</>;
    case "loading":
      return <PageState state="loading" />;
    case "redirect":
      return (
        <p role="status" className="text-sm text-foreground/80">
          {copy.auth.gate.redirecting}
        </p>
      );
    case "unavailable":
      return (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-base border border-tone-failure-fg/30 bg-tone-failure-bg p-3 text-tone-failure-fg"
        >
          <p>{copy.pageState.unavailable(copy.auth.gate.subject)}</p>
          <Button type="button" variant="outline" onClick={() => window.location.reload()}>
            {copy.pageState.retry}
          </Button>
        </div>
      );
    default: {
      const unreachable: never = decision;
      return unreachable;
    }
  }
}
