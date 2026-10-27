import { useParams } from "react-router";
import { KaraokeDayPage } from "../../features/karaoke/karaoke-day-page";
import { parseBusinessDateParam } from "../../features/public/route-params";
import { NotFoundView } from "../../presentation/components/not-found-view";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.pageTitle.karaokeDay };

// PG-KRK-002. A malformed or impossible date shows Not Found before any read.
// The container is keyed by the raw param so that a change of it remounts the page (React Router reuses the element of a route).
export default function KaraokeDayRoute() {
  const { date } = useParams();
  const businessDate = parseBusinessDateParam(date ?? "");
  if (businessDate === null) return <NotFoundView />;
  return <KaraokeDayPage key={date} date={businessDate} />;
}
