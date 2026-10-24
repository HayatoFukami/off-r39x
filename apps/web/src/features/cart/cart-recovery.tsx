"use client";

import { useState } from "react";
import { useSession } from "../../auth/use-session";
import { Button } from "../../presentation/components/ui/button";
import { copy } from "../../presentation/copy/ja";
import { useCart } from "./use-cart";

/** Recovery clears the Cart before its contents or a protected action can be used again. */
export function CartRecovery({
  onRecovered,
  message,
}: {
  onRecovered?: () => void;
  message?: string;
} = {}) {
  const cart = useCart();
  const { state: session } = useSession();
  const [failure, setFailure] = useState<"busy" | "failed" | null>(null);
  const [recovering, setRecovering] = useState(false);
  const storageUnavailable = cart.state.kind === "storage_unavailable";

  const recover = async (): Promise<void> => {
    if (recovering) return;
    setFailure(null);
    setRecovering(true);
    try {
      const result = await cart.recover(
        session.status === "ready" ? session.session.kind : "unknown",
      );
      if (result === "recovered") onRecovered?.();
      else setFailure(result);
    } finally {
      setRecovering(false);
    }
  };

  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-base border border-tone-failure-fg/30 bg-tone-failure-bg p-3 text-tone-failure-fg"
    >
      <p className="font-bold">
        {storageUnavailable
          ? copy.cart.lifecycleBlocked.storageTitle
          : copy.cart.lifecycleBlocked.title}
      </p>
      <p>
        {storageUnavailable
          ? copy.cart.lifecycleBlocked.storageUnavailable
          : copy.cart.lifecycleBlocked.description}
      </p>
      {message === undefined ? null : <p>{message}</p>}
      {failure === "busy" ? <p role="status">{copy.cart.lifecycleBusy.description}</p> : null}
      {failure === "failed" ? <p role="status">{copy.cart.lifecycleBlocked.failed}</p> : null}
      <Button
        type="button"
        variant="outline"
        disabled={recovering}
        aria-busy={recovering ? true : undefined}
        onClick={() => void recover()}
      >
        {copy.cart.lifecycleBlocked.retry}
      </Button>
    </div>
  );
}
