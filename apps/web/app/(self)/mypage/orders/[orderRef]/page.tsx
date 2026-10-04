import type { Metadata } from "next";
import { parseOrderRef } from "../../../../../src/config/purchase-routes";
import { MypageOrderDetailPage } from "../../../../../src/features/mypage/order-detail-page";
import { AccessDeniedView } from "../../../../../src/presentation/components/access-denied-view";
import { copy } from "../../../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.mypage.orders.detail.pageTitle };

// PG-MYP-004. A malformed ref shows the same Access Denied view as a missing one (HTTP 200): the
// response never confirms whether an Order exists (SPEC-050 19.2).
export default async function Page({ params }: { params: Promise<{ orderRef: string }> }) {
  const { orderRef } = await params;
  const ref = parseOrderRef(orderRef);
  if (ref === null) {
    return <AccessDeniedView listHref="/mypage/orders" listLabel={copy.accessDenied.ordersLink} />;
  }
  return <MypageOrderDetailPage orderRef={ref} />;
}
