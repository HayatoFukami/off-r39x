import type { Metadata } from "next";
import { parseTicketRef } from "../../../../../src/config/mypage-routes";
import { EntryTicketDetailPage } from "../../../../../src/features/mypage/entry-ticket-detail-page";
import { AccessDeniedView } from "../../../../../src/presentation/components/access-denied-view";
import { copy } from "../../../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.mypage.entryTickets.detail.pageTitle };

// PG-MYP-006. A malformed ref shows the same Access Denied view as a missing one (HTTP 200).
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
  return <EntryTicketDetailPage ticketRef={ref} />;
}
