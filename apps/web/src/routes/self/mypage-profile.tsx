import { ProfilePage } from "../../features/mypage/profile-page";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.mypage.profile.pageTitle };

// PG-MYP-002. The route takes no reference: it is always the signed-in user's Profile.
export default function MypageProfileRoute() {
  return <ProfilePage />;
}
