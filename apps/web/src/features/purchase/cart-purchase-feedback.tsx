"use client";

import { useEffect, useRef } from "react";
import { copy } from "../../presentation/copy/ja";
import type { CartPurchasePhase } from "./use-cart-purchase";

const alertClass =
  "flex flex-col gap-2 rounded-base border border-tone-failure-fg/30 bg-tone-failure-bg p-3 text-tone-failure-fg";

// Progress is announced through a role=status region that exists only while a purchase start is in
// progress (the S5 Cart tests require no status region otherwise); a rejection is an error summary
// that takes focus (SPEC-050 14A.1, 21, 25).
export function CartPurchaseFeedback({ phase }: { phase: CartPurchasePhase }) {
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase.kind === "rejected") summaryRef.current?.focus();
  }, [phase]);

  const progress =
    phase.kind === "verifying"
      ? copy.cart.purchase.verifying
      : phase.kind === "preparing"
        ? copy.cart.purchase.preparing
        : "";

  return (
    <div className="flex flex-col gap-2">
      {progress === "" ? null : (
        <div role="status" className="text-sm">
          {progress}
        </div>
      )}
      {phase.kind === "rejected" ? (
        <div ref={summaryRef} role="alert" tabIndex={-1} className={alertClass}>
          <p className="font-bold">{copy.cart.purchase.rejectedTitle}</p>
          <p>{copy.cart.purchase.rejectedBody}</p>
          {phase.rejections.map((line) => (
            <p key={line.lineKey}>
              <span className="font-medium">{line.name}</span> {line.label} {line.description}
            </p>
          ))}
        </div>
      ) : null}
      {phase.kind === "unavailable" ? (
        <div role="alert" className={alertClass}>
          <p>{copy.cart.purchase.unavailable}</p>
        </div>
      ) : null}
    </div>
  );
}
