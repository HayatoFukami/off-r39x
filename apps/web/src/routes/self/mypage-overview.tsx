import { MypageOverviewPage } from "../../features/mypage/mypage-overview-page";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.mypage.pageTitle };

// PG-MYP-001. It renders only behind the AuthGate of the self layout.
export default function MypageOverviewRoute() {
  return <MypageOverviewPage />;
}
