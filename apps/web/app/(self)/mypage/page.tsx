import type { Metadata } from "next";
import { MypageOverviewPage } from "../../../src/features/mypage/mypage-overview-page";
import { copy } from "../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.mypage.pageTitle };

// PG-MYP-001. It renders only behind the AuthGate of the (self) layout.
export default function Page() {
  return <MypageOverviewPage />;
}
