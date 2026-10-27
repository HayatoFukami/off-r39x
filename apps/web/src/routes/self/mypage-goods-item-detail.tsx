import { useParams } from "react-router";
import { parseGoodsItemRef } from "../../config/mypage-routes";
import { GoodsItemDetailPage } from "../../features/mypage/goods-item-detail-page";
import { AccessDeniedView } from "../../presentation/components/access-denied-view";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.mypage.goodsItems.detail.pageTitle };

// PG-MYP-012. A malformed ref shows the same Access Denied view as a missing one: the response never
// confirms whether the target exists (SPEC-050 19.2). The container is keyed by the raw param so that a change of it remounts the page (React Router reuses the element of a route).
export default function MypageGoodsItemDetailRoute() {
  const { goodsItemRef } = useParams();
  const ref = parseGoodsItemRef(goodsItemRef ?? "");
  if (ref === null) {
    return (
      <AccessDeniedView listHref="/mypage/goods" listLabel={copy.accessDenied.goodsItemsLink} />
    );
  }
  return <GoodsItemDetailPage key={goodsItemRef} goodsItemRef={ref} />;
}
