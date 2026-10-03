import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KaraokeDayPage } from "../../../../src/features/karaoke/karaoke-day-page";
import { parseBusinessDateParam } from "../../../../src/features/public/route-params";
import { copy } from "../../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.pageTitle.karaokeDay };

// PG-KRK-002. A malformed or impossible date is Not Found (HTTP 404) before any read.
export default async function Page({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const businessDate = parseBusinessDateParam(date);
  if (businessDate === null) notFound();
  return <KaraokeDayPage date={businessDate} />;
}
