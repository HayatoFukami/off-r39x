import type { Metadata } from "next";
import { parseReservationRef } from "../../../../../src/config/mypage-routes";
import { ReservationDetailPage } from "../../../../../src/features/mypage/reservation-detail-page";
import { AccessDeniedView } from "../../../../../src/presentation/components/access-denied-view";
import { copy } from "../../../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.mypage.reservations.detail.pageTitle };

// PG-MYP-009. A malformed ref shows the same Access Denied view as a missing one (HTTP 200).
export default async function Page({ params }: { params: Promise<{ reservationRef: string }> }) {
  const { reservationRef } = await params;
  const ref = parseReservationRef(reservationRef);
  if (ref === null) {
    return (
      <AccessDeniedView listHref="/mypage/karaoke" listLabel={copy.accessDenied.reservationsLink} />
    );
  }
  return <ReservationDetailPage reservationRef={ref} />;
}
