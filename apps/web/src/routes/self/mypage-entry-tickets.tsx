import { EntryTicketListPage } from "../../features/mypage/entry-ticket-list-page";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.mypage.entryTickets.pageTitle };

// PG-MYP-005.
export default function MypageEntryTicketsRoute() {
  return <EntryTicketListPage />;
}
