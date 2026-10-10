import type { Metadata } from "next";
import { copy } from "../../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.mypage.pageTitle };

// S6 placeholder: PG-MYP-001 replaces this page. It renders only behind the AuthGate.
export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{copy.mypage.heading}</h1>
      <p>{copy.mypage.protectedMarker}</p>
    </div>
  );
}
