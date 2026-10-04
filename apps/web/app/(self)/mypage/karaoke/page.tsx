import type { Metadata } from "next";
import { ReservationListPage } from "../../../../src/features/mypage/reservation-list-page";
import { copy } from "../../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.mypage.reservations.pageTitle };

// PG-MYP-008.
export default function Page() {
  return <ReservationListPage />;
}
