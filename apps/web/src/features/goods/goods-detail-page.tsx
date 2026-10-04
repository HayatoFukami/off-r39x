"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useApi } from "../../api-client/provider";
import { settleRead } from "../../api-client/settle-read";
import type { GoodsDetail, Ref } from "../../api-client/types";
import { GOODS_HREF } from "../../config/public-routes";
import { CART_HREF } from "../../config/site";
import type { Loadable } from "../../presentation/components/list-state";
import { NotFoundView } from "../../presentation/components/not-found-view";
import { PageState } from "../../presentation/components/page-state";
import { PlainText } from "../../presentation/components/plain-text";
import { StatusBadge } from "../../presentation/components/status-badge";
import { copy } from "../../presentation/copy/ja";
import { type AddResult, AddResultNotice, AddToCartForm } from "../cart/add-to-cart-form";
import { buildGoodsDetailModel, type GoodsDetailModel } from "./goods-detail-model";

const linkClass = "text-brand underline underline-offset-4";

function GoodsReady({ goods }: { goods: Extract<GoodsDetailModel, { kind: "ready" }> }) {
  const [result, setResult] = useState<AddResult>({ kind: "idle" });
  const reasonId = `${useId()}-reason`;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{goods.name}</h1>
      <PlainText>{goods.description}</PlainText>
      <p>
        <span className="font-medium">{copy.sales.priceLabel}</span> {goods.priceText}
      </p>
      <p>
        <span className="font-medium">{copy.sales.periodLabel}</span> {goods.salesPeriodText}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{copy.sales.statusLabel}</span>
        <StatusBadge tone={goods.status.tone} label={goods.status.label} />
        <span id={reasonId} className="text-sm">
          {goods.status.description}
        </span>
      </div>
      <p className="text-sm">{goods.pickupNotice}</p>
      <AddResultNotice result={result} />
      <AddToCartForm
        buildLine={(quantity) => ({ kind: "GOODS", goodsRef: goods.goodsRef, quantity })}
        unitPrice={goods.unitPrice}
        maxSelectableQuantity={goods.maxSelectableQuantity}
        addable={goods.addable}
        reasonId={reasonId}
        onResult={setResult}
      />
      <p className="flex flex-wrap gap-4">
        <Link href={CART_HREF} prefetch={false} className={linkClass}>
          {copy.sales.viewCart}
        </Link>
        <Link href={GOODS_HREF} prefetch={false} className={linkClass}>
          {copy.goods.detail.backToList}
        </Link>
      </p>
    </div>
  );
}

// PG-GDS-002 container: reads after mount through the port. Adding to the Cart starts no purchase.
export function GoodsDetailPage({ goodsRef }: { goodsRef: Ref<"goods"> }) {
  const api = useApi();
  const [input, setInput] = useState<Loadable<GoodsDetail>>({ kind: "loading" });
  const token = useRef(0);

  const load = useCallback(() => {
    token.current += 1;
    const current = token.current;
    void settleRead(api.public.getGoods(goodsRef)).then((read) => {
      if (token.current === current) setInput(read);
    });
  }, [api, goodsRef]);

  useEffect(() => {
    const ref = token;
    setInput({ kind: "loading" });
    load();
    return () => {
      ref.current += 1;
    };
  }, [load]);

  const reload = (): void => {
    setInput({ kind: "loading" });
    load();
  };

  const model = buildGoodsDetailModel(input);

  // Not Found shows the shared view only: nothing of the Goods is exposed (SPEC-050 14.2, 19.1).
  if (model.kind === "not_found") return <NotFoundView />;
  if (model.kind === "ready") return <GoodsReady key={model.goodsRef} goods={model} />;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{copy.goods.detail.heading}</h1>
      {model.kind === "loading" ? (
        <PageState state="loading" />
      ) : (
        <PageState
          state="unavailable"
          message={copy.pageState.unavailable(copy.goods.detail.subject)}
          onRetry={reload}
        />
      )}
    </div>
  );
}
