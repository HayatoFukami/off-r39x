import { MypageOrderListPage } from "../../features/mypage/order-list-page";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.mypage.orders.pageTitle };

// PG-MYP-003.
export default function MypageOrdersRoute() {
  return <MypageOrderListPage />;
}
