import { ReservationListPage } from "../../features/mypage/reservation-list-page";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.mypage.reservations.pageTitle };

// PG-MYP-008.
export default function MypageKaraokeRoute() {
  return <ReservationListPage />;
}
