import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AnnouncementDetailPage } from "../../../src/features/public/announcement-detail-page";
import { parseAnnouncementRef } from "../../../src/features/public/route-params";
import { copy } from "../../../src/presentation/copy/ja";

// The title is fixed: it never carries the announcement (nothing is exposed before the read).
export const metadata: Metadata = { title: copy.pageTitle.announcementDetail };

// PG-PUB-003. A malformed reference is Not Found (HTTP 404) before any read.
export default async function Page({ params }: { params: Promise<{ announcementRef: string }> }) {
  const { announcementRef } = await params;
  const ref = parseAnnouncementRef(announcementRef);
  if (ref === null) notFound();
  return <AnnouncementDetailPage announcementRef={ref} />;
}
