"use client";

import { useSession } from "../../auth/use-session";
import { Button } from "../../presentation/components/ui/button";
import { copy } from "../../presentation/copy/ja";
import { useCart } from "./use-cart";

/** Recovery clears the Cart before its contents or a protected action can be used again. */
export function CartRecovery() {
  const cart = useCart();
  const { state: session } = useSession();
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-base border border-tone-failure-fg/30 bg-tone-failure-bg p-3 text-tone-failure-fg"
    >
      <p className="font-bold">{copy.cart.lifecycleBlocked.title}</p>
      <p>{copy.cart.lifecycleBlocked.description}</p>
      <Button
        type="button"
        variant="outline"
        onClick={() => cart.recover(session.status === "ready" ? session.session.kind : "unknown")}
      >
        {copy.cart.lifecycleBlocked.retry}
      </Button>
    </div>
  );
}
