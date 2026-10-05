"use client";

import Link from "next/link";
import { useCallback } from "react";
import type { ApiPort } from "../../api-client/port";
import { PageState } from "../../presentation/components/page-state";
import { StatusBadge } from "../../presentation/components/status-badge";
import { copy } from "../../presentation/copy/ja";
import { buildGoodsItemListModel } from "./goods-item-model";
import { useRead } from "./use-read";

// PG-MYP-011 container (SPEC-050 18.11, 20.4). The main outcome is the display rule's label: an unpaid
// item is never shown as waiting for pickup.

const linkClass = "text-brand underline underline-offset-4";

export function GoodsItemListPage() {
  const load = useCallback((api: ApiPort) => api.self.listGoodsItems(), []);
  const { read, reload } = useRead(load);
  const model = buildGoodsItemListModel(read);
  const labels = copy.mypage.goodsItems;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{labels.heading}</h1>
      {model.kind === "loading" ? <PageState state="loading" /> : null}
      {model.kind === "unavailable" ? (
        <PageState
          state="unavailable"
          message={copy.pageState.unavailable(labels.subject)}
          onRetry={reload}
        />
      ) : null}
      {model.kind === "empty" ? <PageState state="empty" message={labels.empty} /> : null}
      {model.kind === "items" ? (
        <ul className="flex flex-col gap-3">
          {model.items.map((row) => (
            <li
              key={row.goodsItemRef}
              className="flex flex-col gap-1 rounded-base border border-border p-3"
            >
              <p className="font-bold">{row.name}</p>
              <p>{row.quantityText}</p>
              <div>
                <StatusBadge tone={row.tone} label={row.primaryLabel} />
              </div>
              <p>
                <span className="font-medium">{labels.itemStateLabel}</span> {row.itemLabel}
              </p>
              <p>
                <span className="font-medium">{labels.handoffStateLabel}</span> {row.handoffLabel}
              </p>
              <p>
                <span className="font-medium">{labels.orderStateLabel}</span> {row.orderStateLabel}
              </p>
              <Link href={row.href} prefetch={false} className={linkClass}>
                {row.linkLabel}
              </Link>
              <Link href={row.orderHref} prefetch={false} className={linkClass}>
                {labels.orderLink}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
