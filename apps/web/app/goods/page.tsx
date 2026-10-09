import type { Metadata } from "next";
import { GoodsListPage } from "../../src/features/goods/goods-list-page";
import { copy } from "../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.pageTitle.goods };

// PG-GDS-001
export default function Page() {
  return <GoodsListPage />;
}
