import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KaraokeSlotPage } from "../../../../src/features/karaoke/karaoke-slot-page";
import { parseSlotRef } from "../../../../src/features/public/route-params";
import { copy } from "../../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.pageTitle.karaokeSlot };

// PG-KRK-003. A malformed slot reference is Not Found (HTTP 404) before any read.
export default async function Page({ params }: { params: Promise<{ slotRef: string }> }) {
  const { slotRef } = await params;
  const ref = parseSlotRef(slotRef);
  if (ref === null) notFound();
  return <KaraokeSlotPage slotRef={ref} />;
}
