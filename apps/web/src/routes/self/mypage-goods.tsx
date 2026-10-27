import { GoodsItemListPage } from "../../features/mypage/goods-item-list-page";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.mypage.goodsItems.pageTitle };

// PG-MYP-011.
export default function MypageGoodsRoute() {
  return <GoodsItemListPage />;
}
