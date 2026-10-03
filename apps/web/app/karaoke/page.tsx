import type { Metadata } from "next";
import { KaraokeGuidePage } from "../../src/features/karaoke/karaoke-guide-page";
import { copy } from "../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.pageTitle.karaoke };

// PG-KRK-001
export default function Page() {
  return <KaraokeGuidePage />;
}
