import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GoodsDetailPage } from "../../../src/features/goods/goods-detail-page";
import { parseGoodsRef } from "../../../src/features/public/route-params";
import { copy } from "../../../src/presentation/copy/ja";

// The title is fixed: it never carries the Goods name (nothing is exposed before the read).
export const metadata: Metadata = { title: copy.goods.detail.pageTitle };

// PG-GDS-002. A malformed reference is Not Found (HTTP 404) before any read.
export default async function Page({ params }: { params: Promise<{ goodsRef: string }> }) {
  const { goodsRef } = await params;
  const ref = parseGoodsRef(goodsRef);
  if (ref === null) notFound();
  return <GoodsDetailPage goodsRef={ref} />;
}
