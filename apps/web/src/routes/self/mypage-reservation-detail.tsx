import { useParams } from "react-router";
import { parseReservationRef } from "../../config/mypage-routes";
import { ReservationDetailPage } from "../../features/mypage/reservation-detail-page";
import { AccessDeniedView } from "../../presentation/components/access-denied-view";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.mypage.reservations.detail.pageTitle };

// PG-MYP-009. A malformed ref shows the same Access Denied view as a missing one: the response never
// confirms whether the target exists (SPEC-050 19.2). The container is keyed by the raw param so that a change of it remounts the page (React Router reuses the element of a route).
export default function MypageReservationDetailRoute() {
  const { reservationRef } = useParams();
  const ref = parseReservationRef(reservationRef ?? "");
  if (ref === null) {
    return (
      <AccessDeniedView listHref="/mypage/karaoke" listLabel={copy.accessDenied.reservationsLink} />
    );
  }
  return <ReservationDetailPage key={reservationRef} reservationRef={ref} />;
}
