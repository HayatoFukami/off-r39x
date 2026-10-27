import { GoodsListPage } from "../../features/goods/goods-list-page";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.pageTitle.goods };

// PG-GDS-001
export default function GoodsRoute() {
  return <GoodsListPage />;
}
