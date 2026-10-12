"use client";

import Link from "next/link";
import { useCallback, useId } from "react";
import type { ApiPort } from "../../api-client/port";
import type { Ref } from "../../api-client/types";
import { MYPAGE_PATHS } from "../../config/mypage-routes";
import { AccessDeniedView } from "../../presentation/components/access-denied-view";
import { PageState } from "../../presentation/components/page-state";
import { SectionHeading } from "../../presentation/components/section-heading";
import { StatusBadge } from "../../presentation/components/status-badge";
import { copy } from "../../presentation/copy/ja";
import { buildGoodsItemDetailModel } from "./goods-item-model";
import { ReceiptLink } from "./receipt-link";
import { useRead } from "./use-read";

// PG-MYP-012 container (SPEC-050 18.12, 20.4). Read-only: a customer can never move a handed-over item
// back to pending, so this page has no control at all. The price is the purchase-time Snapshot.

const linkClass = "text-brand underline underline-offset-4";

export function GoodsItemDetailPage({ goodsItemRef }: { goodsItemRef: Ref<"goodsItem"> }) {
  const load = useCallback((api: ApiPort) => api.self.getGoodsItem(goodsItemRef), [goodsItemRef]);
  const { read, reload } = useRead(load);
  const model = buildGoodsItemDetailModel(read);
  const infoId = `${useId()}-info`;
  const labels = copy.mypage.goodsItems;

  // Ownership failure: nothing of the item was rendered before this view (SPEC-050 26.2).
  if (model.kind === "denied") {
    return (
      <AccessDeniedView
        listHref={MYPAGE_PATHS.goodsItems}
        listLabel={copy.accessDenied.goodsItemsLink}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{labels.detail.heading}</h1>
      {model.kind === "loading" ? <PageState state="loading" /> : null}
      {model.kind === "unavailable" ? (
        <PageState
          state="unavailable"
          message={copy.pageState.unavailable(labels.detail.subject)}
          onRetry={reload}
        />
      ) : null}
      {model.kind === "ready" ? (
        <>
          <section aria-labelledby={infoId} className="flex flex-col gap-3">
            <SectionHeading id={infoId}>{labels.detail.infoHeading}</SectionHeading>
            <div>
              <StatusBadge tone={model.tone} label={model.primaryLabel} />
            </div>
            <p>{model.description}</p>
            <p>
              <span className="font-medium">{labels.detail.nameLabel}</span> {model.name}
            </p>
            <p>{model.quantityText}</p>
            <p>
              <span className="font-medium">{copy.cart.unitPriceLabel}</span> {model.unitPriceText}
            </p>
            <p>
              <span className="font-medium">{copy.cart.subtotalLabel}</span> {model.subtotalText}
            </p>
            <p>
              <span className="font-medium">{labels.itemStateLabel}</span> {model.itemLabel}
            </p>
            <p>
              <span className="font-medium">{labels.handoffStateLabel}</span> {model.handoffLabel}
            </p>
            {model.pickupNotice === null ? null : <p>{model.pickupNotice}</p>}
            {model.noSecondHandoff === null ? null : <p>{model.noSecondHandoff}</p>}
            <p>
              <span className="font-medium">{labels.orderStateLabel}</span> {model.orderStateLabel}
            </p>
            <p>
              <Link href={model.orderHref} prefetch={false} className={linkClass}>
                {labels.orderLink}
              </Link>
            </p>
            <ReceiptLink href={model.receiptHref} />
          </section>
          <p>
            <Link href={MYPAGE_PATHS.goodsItems} prefetch={false} className={linkClass}>
              {labels.detail.backToList}
            </Link>
          </p>
        </>
      ) : null}
    </div>
  );
}
