"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useApi } from "../../api-client/provider";
import { settleRead } from "../../api-client/settle-read";
import type { EntryOffering } from "../../api-client/types";
import { CART_HREF } from "../../config/site";
import type { Loadable } from "../../presentation/components/list-state";
import { PageState } from "../../presentation/components/page-state";
import { PlainText } from "../../presentation/components/plain-text";
import { StatusBadge } from "../../presentation/components/status-badge";
import { copy } from "../../presentation/copy/ja";
import { type AddResult, AddResultNotice, AddToCartForm } from "../cart/add-to-cart-form";
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

// PG-TKT-001 container: reads after mount through the port. Adding to the Cart starts no purchase.
export function EntryPage() {
  const api = useApi();
  const [input, setInput] = useState<Loadable<readonly EntryOffering[]>>({ kind: "loading" });
  const [result, setResult] = useState<AddResult>({ kind: "idle" });
  const token = useRef(0);

  const load = useCallback(() => {
    token.current += 1;
    const current = token.current;
    void settleRead(api.public.listEntryOfferings()).then((read) => {
      if (token.current === current) setInput(read);
    });
  }, [api]);

  useEffect(() => {
    const ref = token;
    load();
    return () => {
      ref.current += 1;
    };
  }, [load]);

  const reload = (): void => {
    setInput({ kind: "loading" });
    load();
  };

  const list = buildEntryModel(input);

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
