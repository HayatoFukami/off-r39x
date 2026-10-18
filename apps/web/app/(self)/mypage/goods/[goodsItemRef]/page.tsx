import type { Metadata } from "next";
import { parseGoodsItemRef } from "../../../../../src/config/mypage-routes";
import { GoodsItemDetailPage } from "../../../../../src/features/mypage/goods-item-detail-page";
import { AccessDeniedView } from "../../../../../src/presentation/components/access-denied-view";
import { copy } from "../../../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.mypage.goodsItems.detail.pageTitle };

// PG-MYP-012. A malformed ref shows the same Access Denied view as a missing one (HTTP 200).
export default async function Page({ params }: { params: Promise<{ goodsItemRef: string }> }) {
  const { goodsItemRef } = await params;
  const ref = parseGoodsItemRef(goodsItemRef);
  if (ref === null) {
    return (
      <AccessDeniedView listHref="/mypage/goods" listLabel={copy.accessDenied.goodsItemsLink} />
    );
  }
  return <GoodsItemDetailPage goodsItemRef={ref} />;
}
