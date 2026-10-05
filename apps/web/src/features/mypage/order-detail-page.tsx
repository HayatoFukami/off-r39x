"use client";

import type { Ref } from "../../api-client/types";
import { MYPAGE_PATHS } from "../../config/mypage-routes";
import { copy } from "../../presentation/copy/ja";
import { PurchaseStatusPage, type PurchaseStatusVariant } from "../purchase/purchase-status-page";
import { buildMypageOrderDetailModel } from "./order-detail-model";

// PG-MYP-004 container (SPEC-050 18.4). It is the shared Order outcome of PG-XFN-001 (the same reads,
// the same re-check and checkout-retry behaviour, the same Access Denied view with the Orders list as the
// way back); only the heading, the model (no link to itself) and the way back differ.

const MYPAGE_ORDER_VARIANT: PurchaseStatusVariant = {
  heading: copy.mypage.orders.detail.heading,
  subject: copy.mypage.orders.detail.subject,
  buildModel: buildMypageOrderDetailModel,
  backLink: { href: MYPAGE_PATHS.orders, label: copy.mypage.orders.detail.backToList },
};

export function MypageOrderDetailPage({ orderRef }: { orderRef: Ref<"order"> }) {
  return <PurchaseStatusPage orderRef={orderRef} variant={MYPAGE_ORDER_VARIANT} />;
}
