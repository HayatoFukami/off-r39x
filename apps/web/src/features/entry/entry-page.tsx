"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ApiPort } from "../../api-client/port";
import { useApi } from "../../api-client/provider";
import { settleRead } from "../../api-client/settle-read";
import type { CartLine, EntryOffering } from "../../api-client/types";
import { type SessionState, useSession } from "../../auth/use-session";
import { CART_HREF } from "../../config/site";
import type { Loadable } from "../../presentation/components/list-state";
import { PageState } from "../../presentation/components/page-state";
import { PlainText } from "../../presentation/components/plain-text";
import { StatusBadge } from "../../presentation/components/status-badge";
import { copy } from "../../presentation/copy/ja";
import { Link } from "../../routing/link";
import { type AddResult, AddResultNotice, AddToCartForm } from "../cart/add-to-cart-form";
import {
  type EligibilityInput,
  type EligibilityMode,
  eligibilityForSession,
  eligibilityMode,
  toEligibilityInput,
} from "../purchase/eligibility-model";
import { buildEntryModel, type EntryOfferingItem } from "./entry-model";

const linkClass = "text-brand underline underline-offset-4";

function OfferingView({
  item,
  onResult,
}: {
  item: EntryOfferingItem;
  onResult: (result: AddResult) => void;
}) {
  const reasonId = `${useId()}-reason`;
  return (
    <li className="flex flex-col gap-2 rounded-base border border-border p-3">
      <h2 className="text-xl font-bold">{item.name}</h2>
      <PlainText>{item.description}</PlainText>
      <p>
        <span className="font-medium">{copy.sales.priceLabel}</span> {item.priceText}
      </p>
      <p>
        <span className="font-medium">{copy.sales.periodLabel}</span> {item.salesPeriodText}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{copy.sales.statusLabel}</span>
        <StatusBadge tone={item.status.tone} label={item.status.label} />
        <span id={reasonId} className="text-sm">
          {item.status.description}
        </span>
      </div>
      {item.perAccountLimit !== null ? (
        <p className="text-sm">{copy.entry.perAccountLimit(item.perAccountLimit)}</p>
      ) : null}
      <AddToCartForm
        buildLine={(quantity) => ({
          kind: "ENTRY_TICKET",
          offeringRef: item.offeringRef,
          quantity,
        })}
        unitPrice={item.unitPrice}
        maxSelectableQuantity={item.maxSelectableQuantity}
        addable={item.addable}
        reasonId={reasonId}
        onResult={onResult}
      />
    </li>
  );
}

type EntryState = {
  /** The session state the eligibility was read under (null before the first read). */
  session: SessionState | null;
  offerings: Loadable<readonly EntryOffering[]>;
  /** The owner-scoped eligibility read together with the offerings. Kept in memory only (SEC-API-029). */
  eligibility: EligibilityInput;
};

/** Reads the eligibility (quantity 1) of the offerings that are on sale publicly; verified owners only. */
async function readEligibility(
  api: ApiPort,
  mode: Exclude<EligibilityMode, "wait">,
  offerings: Loadable<readonly EntryOffering[]>,
): Promise<EligibilityInput> {
  if (mode === "not_applicable") return { kind: "not_applicable" };
  if (mode === "unavailable") return { kind: "unavailable" };
  if (offerings.kind !== "ok") return { kind: "ok", data: [] };
  const lines = offerings.data.flatMap((offering): CartLine[] =>
    offering.availability.kind === "ON_SALE"
      ? [{ kind: "ENTRY_TICKET", offeringRef: offering.offeringRef, quantity: 1 }]
      : [],
  );
  if (lines.length === 0) return { kind: "ok", data: [] };
  try {
    return toEligibilityInput(await api.purchase.getPurchaseEligibility(lines));
  } catch {
    return { kind: "unavailable" };
  }
}

// PG-TKT-001 container: reads after mount through the port. Adding to the Cart starts no purchase.
export function EntryPage() {
  const api = useApi();
  const [state, setState] = useState<EntryState>({
    session: null,
    offerings: { kind: "loading" },
    eligibility: { kind: "loading" },
  });
  const [result, setResult] = useState<AddResult>({ kind: "idle" });
  const { state: session } = useSession();
  const token = useRef(0);

  const load = useCallback(() => {
    const mode = eligibilityMode(session);
    if (mode === "wait") return;
    token.current += 1;
    const current = token.current;
    // The public offerings and the owner-scoped eligibility are applied together, once.
    void (async () => {
      const offerings = await settleRead(api.public.listEntryOfferings());
      const eligibility = await readEligibility(api, mode, offerings);
      if (token.current === current) setState({ session, offerings, eligibility });
    })();
  }, [api, session]);

  // The owner conditions depend on the session (per-account limit), so both are read again when it changes.
  // The public offerings stay shown while both are read again; the owner-scoped answer is used only for
  // the session it was read for (B4b-F-1). A response for an older session is dropped by the token.
  useEffect(() => {
    const ref = token;
    load();
    return () => {
      ref.current += 1;
    };
  }, [load]);

  const reload = (): void => {
    setState({ session: null, offerings: { kind: "loading" }, eligibility: { kind: "loading" } });
    load();
  };

  const eligibility = eligibilityForSession(state.eligibility, state.session, session);
  const list = buildEntryModel(state.offerings, eligibility);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{copy.entry.heading}</h1>
      {list.kind !== "loading" ? (
        <p>
          <Link href={CART_HREF} prefetch={false} className={linkClass}>
            {copy.sales.viewCart}
          </Link>
        </p>
      ) : null}
      {list.kind === "loading" ? <PageState state="loading" /> : null}
      {list.kind === "empty" ? <PageState state="empty" /> : null}
      {list.kind === "unavailable" ? (
        <PageState
          state="unavailable"
          message={copy.pageState.unavailable(copy.entry.subject)}
          onRetry={reload}
        />
      ) : null}
      {list.kind === "items" ? (
        <>
          {eligibility.kind === "unavailable" ? (
            <PageState
              state="unavailable"
              message={copy.pageState.unavailable(copy.entry.eligibilitySubject)}
              onRetry={reload}
            />
          ) : null}
          <AddResultNotice result={result} />
          <ul className="flex flex-col gap-4">
            {list.items.map((item) => (
              <OfferingView key={item.offeringRef} item={item} onResult={setResult} />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
