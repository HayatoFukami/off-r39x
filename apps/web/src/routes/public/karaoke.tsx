import { KaraokeGuidePage } from "../../features/karaoke/karaoke-guide-page";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.pageTitle.karaoke };

// PG-KRK-001
export default function KaraokeRoute() {
  return <KaraokeGuidePage />;
}
