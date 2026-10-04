import type { ReactNode } from "react";
import { MypageNav } from "../../../src/features/mypage/mypage-nav";

// The Mypage local navigation (SPEC-050 17.2). It stays across the Mypage pages, also on Access Denied.
// The AuthGate of the (self) layout runs first: nothing here renders for a Guest.
export default function MypageLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <MypageNav />
      {children}
    </>
  );
}
