import type { Metadata } from "next";
import { EntryTicketListPage } from "../../../../src/features/mypage/entry-ticket-list-page";
import { copy } from "../../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.mypage.entryTickets.pageTitle };

// PG-MYP-005.
export default function Page() {
  return <EntryTicketListPage />;
}
