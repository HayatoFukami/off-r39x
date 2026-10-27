import { useParams } from "react-router";
import { GoodsDetailPage } from "../../features/goods/goods-detail-page";
import { parseGoodsRef } from "../../features/public/route-params";
import { NotFoundView } from "../../presentation/components/not-found-view";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

// The title is fixed: it never carries the Goods name (nothing is exposed before the read).
export const handle: RouteHandle = { title: copy.goods.detail.pageTitle };

// PG-GDS-002. A malformed reference shows Not Found before any read.
// The container is keyed by the raw param so that a change of it remounts the page (React Router reuses the element of a route).
export default function GoodsDetailRoute() {
  const { goodsRef } = useParams();
  const ref = parseGoodsRef(goodsRef ?? "");
  if (ref === null) return <NotFoundView />;
  return <GoodsDetailPage key={goodsRef} goodsRef={ref} />;
}
