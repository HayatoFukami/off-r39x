import { useParams } from "react-router";
import { parseOrderRef } from "../../config/purchase-routes";
import { MypageOrderDetailPage } from "../../features/mypage/order-detail-page";
import { AccessDeniedView } from "../../presentation/components/access-denied-view";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.mypage.orders.detail.pageTitle };

// PG-MYP-004. A malformed ref shows the same Access Denied view as a missing one: the response never
// confirms whether the target exists (SPEC-050 19.2). The container is keyed by the raw param so that a change of it remounts the page (React Router reuses the element of a route).
export default function MypageOrderDetailRoute() {
  const { orderRef } = useParams();
  const ref = parseOrderRef(orderRef ?? "");
  if (ref === null) {
    return <AccessDeniedView listHref="/mypage/orders" listLabel={copy.accessDenied.ordersLink} />;
  }
  return <MypageOrderDetailPage key={orderRef} orderRef={ref} />;
}
