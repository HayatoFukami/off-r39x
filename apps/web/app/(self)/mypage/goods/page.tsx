import type { Metadata } from "next";
import { GoodsItemListPage } from "../../../../src/features/mypage/goods-item-list-page";
import { copy } from "../../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.mypage.goodsItems.pageTitle };

// PG-MYP-011.
export default function Page() {
  return <GoodsItemListPage />;
}
