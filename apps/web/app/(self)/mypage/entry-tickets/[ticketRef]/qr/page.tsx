import type { Metadata } from "next";
import { parseTicketRef } from "../../../../../../src/config/mypage-routes";
import { EntryQrPage } from "../../../../../../src/features/mypage/entry-qr-page";
import { AccessDeniedView } from "../../../../../../src/presentation/components/access-denied-view";
import { copy } from "../../../../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.qr.ENTRY };

// PG-MYP-007. A malformed ref shows the same Access Denied view as a missing one (HTTP 200).
export default async function Page({ params }: { params: Promise<{ ticketRef: string }> }) {
  const { ticketRef } = await params;
  const ref = parseTicketRef(ticketRef);
  if (ref === null) {
    return (
      <AccessDeniedView
        listHref="/mypage/entry-tickets"
        listLabel={copy.accessDenied.entryTicketsLink}
      />
    );
  }
  return <EntryQrPage ticketRef={ref} />;
}
