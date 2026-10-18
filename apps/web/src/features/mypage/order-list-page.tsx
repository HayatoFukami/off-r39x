"use client";

import { useCallback } from "react";
import type { ApiPort } from "../../api-client/port";
import { PageState } from "../../presentation/components/page-state";
import { copy } from "../../presentation/copy/ja";
import { buildOrderListModel } from "./order-list-model";
import { OrderRowView } from "./order-row";
import { useRead } from "./use-read";

// PG-MYP-003 container (SPEC-050 18.3, 21). Loading, Empty and a failed read are three different states.

export function MypageOrderListPage() {
  const load = useCallback((api: ApiPort) => api.self.listOrders(), []);
  const { read, reload } = useRead(load);
  const model = buildOrderListModel(read);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{copy.mypage.orders.heading}</h1>
      {model.kind === "loading" ? <PageState state="loading" /> : null}
      {model.kind === "unavailable" ? (
        <PageState
          state="unavailable"
          message={copy.pageState.unavailable(copy.mypage.orders.subject)}
          onRetry={reload}
        />
      ) : null}
      {model.kind === "empty" ? (
        <PageState state="empty" message={copy.mypage.orders.empty} />
      ) : null}
      {model.kind === "items" ? (
        <ul className="flex flex-col gap-3">
          {model.items.map((row) => (
            <OrderRowView key={row.orderRef} row={row} showSummary />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
