import { useParams } from "react-router";
import { parseTicketRef } from "../../config/mypage-routes";
import { EntryQrPage } from "../../features/mypage/entry-qr-page";
import { AccessDeniedView } from "../../presentation/components/access-denied-view";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.qr.ENTRY };

// PG-MYP-007. A malformed ref shows the same Access Denied view as a missing one: the response never
// confirms whether the target exists (SPEC-050 19.2). The container is keyed by the raw param so that a change of it remounts the page (React Router reuses the element of a route).
export default function MypageEntryTicketQrRoute() {
  const { ticketRef } = useParams();
  const ref = parseTicketRef(ticketRef ?? "");
  if (ref === null) {
    return (
      <AccessDeniedView
        listHref="/mypage/entry-tickets"
        listLabel={copy.accessDenied.entryTicketsLink}
      />
    );
  }
  return <EntryQrPage key={ticketRef} ticketRef={ref} />;
}
