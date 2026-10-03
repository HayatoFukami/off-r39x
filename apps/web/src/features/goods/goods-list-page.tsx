"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../api-client/provider";
import { settleRead } from "../../api-client/settle-read";
import type { GoodsSummary } from "../../api-client/types";
import type { Loadable } from "../../presentation/components/list-state";
import { PageState } from "../../presentation/components/page-state";
import { StatusBadge } from "../../presentation/components/status-badge";
import { copy } from "../../presentation/copy/ja";
import { buildGoodsListModel } from "./goods-list-model";

// PG-GDS-001 container: reads after mount through the port. The list has no purchase operation.
export function GoodsListPage() {
  const api = useApi();
  const [input, setInput] = useState<Loadable<readonly GoodsSummary[]>>({ kind: "loading" });
  const token = useRef(0);

  const load = useCallback(() => {
    token.current += 1;
    const current = token.current;
    void settleRead(api.public.listGoods()).then((result) => {
      if (token.current === current) setInput(result);
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

  const list = buildGoodsListModel(input);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{copy.goods.list.heading}</h1>
      {list.kind === "loading" ? <PageState state="loading" /> : null}
      {list.kind === "empty" ? <PageState state="empty" /> : null}
      {list.kind === "unavailable" ? (
        <PageState
          state="unavailable"
          message={copy.pageState.unavailable(copy.goods.list.subject)}
          onRetry={reload}
        />
      ) : null}
      {list.kind === "items" ? (
        <ul className="flex flex-col gap-4">
          {list.items.map((item) => (
            <li
              key={item.goodsRef}
              className="flex flex-col gap-1 rounded-base border border-border p-3"
            >
              <Link
                href={item.href}
                prefetch={false}
                className="font-semibold text-brand underline underline-offset-4"
              >
                {item.name}
              </Link>
              <p>{item.shortDescription}</p>
              <p>{item.priceText}</p>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={item.status.tone} label={item.status.label} />
                <span className="text-sm">{item.status.description}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
