import type { Metadata } from "next";
import { MypageOrderListPage } from "../../../../src/features/mypage/order-list-page";
import { copy } from "../../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.mypage.orders.pageTitle };

// PG-MYP-003.
export default function Page() {
  return <MypageOrderListPage />;
}
