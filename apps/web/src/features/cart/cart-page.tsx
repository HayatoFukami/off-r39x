"use client";

import Link from "next/link";
import { type ChangeEvent, useCallback, useEffect, useId, useState } from "react";
import { useApi } from "../../api-client/provider";
import { settleRead } from "../../api-client/settle-read";
import type { CartLine, CartLineResolution } from "../../api-client/types";
import { type SessionState, useSession } from "../../auth/use-session";
import { ENTRY_HREF, GOODS_HREF, karaokeGuideHref } from "../../config/public-routes";
import type { Loadable } from "../../presentation/components/list-state";
import { PageState } from "../../presentation/components/page-state";
import { SectionHeading } from "../../presentation/components/section-heading";
import { StatusBadge } from "../../presentation/components/status-badge";
import { Button } from "../../presentation/components/ui/button";
import { Input } from "../../presentation/components/ui/input";
import { copy } from "../../presentation/copy/ja";
import { CartPurchaseFeedback } from "../purchase/cart-purchase-feedback";
import { useCartPurchase } from "../purchase/use-cart-purchase";
import { buildCartPageModel, type CartRow } from "./cart-view-model";
import { parseQuantityInput } from "./quantity";
import { useCart } from "./use-cart";

const linkClass = "text-brand underline underline-offset-4";

type Resolution = {
  /** The Cart lines these resolutions were read for (null before the first read). */
  signature: string | null;
  /** The session state they were read under (null before the first read). */
  session: SessionState | null;
  value: Loadable<readonly CartLineResolution[]>;
};

const signatureOf = (lines: readonly CartLine[]): string => JSON.stringify(lines);

function CartRowView({
  row,
  onSetQuantity,
  onRemove,
}: {
  row: CartRow;
  onSetQuantity: (lineKey: string, quantity: number) => boolean;
  onRemove: (lineKey: string) => void;
}) {
  const baseId = useId();
  const inputId = `${baseId}-quantity`;
  const errorId = `${baseId}-error`;
  // A draft exists only while the typed text is not (yet) the saved quantity.
  const [draft, setDraft] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  const text = draft ?? String(row.quantity);
  const parse = parseQuantityInput(text, null);
  const invalid = parse.kind !== "valid";
  const hasError = invalid || saveFailed;

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = event.target.value;
    const parsed = parseQuantityInput(next, null);
    if (parsed.kind !== "valid") {
      setSaveFailed(false);
      setDraft(next);
      return;
    }
    const saved = onSetQuantity(row.lineKey, parsed.quantity);
    setSaveFailed(!saved);
    setDraft(saved ? null : next);
  };

  return (
    <li className="flex flex-col gap-2 rounded-base border border-border p-3">
      <h2 className="text-xl font-bold">{row.name ?? copy.cart.unknownItemName}</h2>
      <p className="text-sm">{row.kindLabel}</p>
      {row.unitPriceText !== null ? (
        <p>
          <span className="font-medium">{copy.cart.unitPriceLabel}</span> {row.unitPriceText}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={inputId} className="text-sm font-medium">
          {copy.quantity.label}
        </label>
        <Input
          id={inputId}
          type="number"
          inputMode="numeric"
          value={text}
          onChange={handleChange}
          aria-invalid={hasError ? true : undefined}
          aria-describedby={hasError ? errorId : undefined}
        />
        <Button type="button" variant="outline" onClick={() => onRemove(row.lineKey)}>
          {copy.cart.remove}
        </Button>
      </div>
      {hasError ? (
        <p id={errorId} role="alert" className="text-sm text-tone-failure-fg">
          {invalid ? copy.quantity.invalid : copy.sales.addFailed}
        </p>
      ) : null}
      {row.subtotalText !== null ? (
        <p>
          <span className="font-medium">{copy.cart.subtotalLabel}</span> {row.subtotalText}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={row.status.tone} label={row.status.label} />
        <span className="text-sm">{row.status.description}</span>
      </div>
    </li>
  );
}

// PG-CRT-001 container. The Cart is read from the browser store; names, prices and states are read
// through the port after mount. `handleProceed` hands the purchase start to `useCartPurchase` (S7a).
export function CartPage() {
  const api = useApi();
  const cart = useCart();
  const { state: session } = useSession();
  const [resolution, setResolution] = useState<Resolution>({
    signature: null,
    session: null,
    value: { kind: "loading" },
  });
  const [attempt, setAttempt] = useState(0);
  const summaryId = useId();
  const karaokeId = useId();
  const reasonId = useId();

  const lines = cart.state.kind === "ready" ? cart.state.cart.lines : null;

  // Re-resolve whenever the lines or the session change (this tab or another). An empty Cart is not resolved.
  // `attempt` only re-runs the read for the retry button.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` triggers a re-read on retry
  useEffect(() => {
    if (session.status === "loading") return;
    if (lines === null || lines.length === 0) return;
    let active = true;
    const signature = signatureOf(lines);
    void settleRead(api.public.resolveCartLines(lines)).then((value) => {
      if (active) setResolution({ signature, session, value });
    });
    return () => {
      active = false;
    };
  }, [api, lines, attempt, session]);

  // After a rejected purchase start the lines are read again, without a loading flash.
  const refreshLines = useCallback((): void => {
    setAttempt((count) => count + 1);
  }, []);

  const retry = useCallback((): void => {
    setResolution({ signature: null, session: null, value: { kind: "loading" } });
    setAttempt((count) => count + 1);
  }, []);

  const refreshing =
    lines !== null &&
    resolution.signature !== null &&
    (resolution.signature !== signatureOf(lines) || resolution.session !== session);
  const model = buildCartPageModel({ cart: cart.state, resolutions: resolution.value, refreshing });

  const names = new Map<string, string | null>(
    model.kind === "ready" || model.kind === "unavailable"
      ? model.rows.map((row) => [row.lineKey, row.name])
      : [],
  );
  const purchase = useCartPurchase({ names, onRejected: refreshLines });

  // A Guest goes to Login, an Authenticated User starts the purchase (the server decides every outcome).
  const handleProceed = (): void => {
    purchase.start();
  };

  const setQuantity = (lineKey: string, quantity: number): boolean =>
    cart.setQuantity(lineKey, quantity).kind === "ok";

  const showRows = model.kind === "ready" || model.kind === "unavailable";

  // The Order exists and the lines have left the Cart: show progress only, never "empty".
  if (purchase.phase.kind === "preparing") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">{copy.cart.heading}</h1>
        <CartPurchaseFeedback phase={purchase.phase} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{copy.cart.heading}</h1>

      {model.kind === "loading" ? <PageState state="loading" /> : null}

      {model.kind === "corrupted" ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-base border border-tone-failure-fg/30 bg-tone-failure-bg p-3 text-tone-failure-fg"
        >
          <p className="font-bold">{copy.cart.corrupted.title}</p>
          <p>{copy.cart.corrupted.description}</p>
          <Button type="button" variant="outline" onClick={() => cart.reset()}>
            {copy.cart.corrupted.reset}
          </Button>
        </div>
      ) : null}

      {model.kind === "empty" ? <PageState state="empty" message={copy.cart.empty} /> : null}

      {model.kind === "unavailable" ? (
        <PageState
          state="unavailable"
          message={copy.pageState.unavailable(copy.cart.subject)}
          onRetry={retry}
        />
      ) : null}

      {showRows ? (
        <ul className="flex flex-col gap-4">
          {model.rows.map((row) => (
            <CartRowView
              key={row.lineKey}
              row={row}
              onSetQuantity={setQuantity}
              onRemove={(lineKey) => cart.remove(lineKey)}
            />
          ))}
        </ul>
      ) : null}

      {showRows || model.kind === "empty" ? (
        <p className="flex flex-wrap gap-4">
          <Link href={ENTRY_HREF} prefetch={false} className={linkClass}>
            {copy.cart.backToEntry}
          </Link>
          <Link href={GOODS_HREF} prefetch={false} className={linkClass}>
            {copy.cart.backToGoods}
          </Link>
        </p>
      ) : null}

      {showRows ? (
        <section aria-labelledby={summaryId} className="flex flex-col gap-2">
          <SectionHeading id={summaryId}>{copy.cart.summary.heading}</SectionHeading>
          <p>
            {model.kind === "ready" && model.totalText !== null ? (
              <>
                <span className="font-medium">{copy.cart.summary.totalLabel}</span>{" "}
                {model.totalText}
              </>
            ) : (
              copy.cart.summary.totalUnknown
            )}
          </p>
          <p className="text-sm">{copy.cart.summary.recalcNote}</p>
          <p className="text-sm">{copy.cart.summary.onePayment}</p>
          {model.proceed.canProceed ? null : (
            <p id={reasonId} className="text-sm">
              {model.proceed.reasons.some((reason) => reason.kind === "line")
                ? copy.cart.proceed.blocked
                : copy.cart.proceed.unknown}
            </p>
          )}
          <div>
            <Button
              type="button"
              disabled={!model.proceed.canProceed || purchase.busy}
              aria-busy={purchase.busy ? true : undefined}
              aria-describedby={model.proceed.canProceed ? undefined : reasonId}
              onClick={handleProceed}
            >
              {copy.cart.proceed.label}
            </Button>
          </div>
          <CartPurchaseFeedback phase={purchase.phase} />
        </section>
      ) : null}

      {showRows || model.kind === "empty" ? (
        <section aria-labelledby={karaokeId} className="flex flex-col gap-2">
          <SectionHeading id={karaokeId}>{copy.cart.karaoke.heading}</SectionHeading>
          <p>{copy.cart.karaoke.body}</p>
          <p>
            <Link href={karaokeGuideHref()} prefetch={false} className={linkClass}>
              {copy.cart.karaoke.link}
            </Link>
          </p>
        </section>
      ) : null}
    </div>
  );
}
