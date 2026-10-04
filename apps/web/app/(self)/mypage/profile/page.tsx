import type { Metadata } from "next";
import { ProfilePage } from "../../../../src/features/mypage/profile-page";
import { copy } from "../../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.mypage.profile.pageTitle };

// PG-MYP-002. The route takes no reference: it is always the signed-in user's Profile.
export default function Page() {
  return <ProfilePage />;
}
