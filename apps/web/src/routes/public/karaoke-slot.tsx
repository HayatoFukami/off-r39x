import { useParams } from "react-router";
import { KaraokeSlotPage } from "../../features/karaoke/karaoke-slot-page";
import { parseSlotRef } from "../../features/public/route-params";
import { NotFoundView } from "../../presentation/components/not-found-view";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.pageTitle.karaokeSlot };

// PG-KRK-003. A malformed slot reference shows Not Found before any read.
// The container is keyed by the raw param so that a change of it remounts the page (React Router reuses the element of a route).
export default function KaraokeSlotRoute() {
  const { slotRef } = useParams();
  const ref = parseSlotRef(slotRef ?? "");
  if (ref === null) return <NotFoundView />;
  return <KaraokeSlotPage key={slotRef} slotRef={ref} />;
}
