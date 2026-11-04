import { useParams } from "react-router";
import { AnnouncementDetailPage } from "../../features/public/announcement-detail-page";
import { parseAnnouncementRef } from "../../features/public/route-params";
import { NotFoundView } from "../../presentation/components/not-found-view";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

// The title is fixed: it never carries the announcement (nothing is exposed before the read).
export const handle: RouteHandle = { title: copy.pageTitle.announcementDetail };

// PG-PUB-003. A malformed reference shows Not Found before any read.
// The container is keyed by the raw param so that a change of it remounts the page (React Router reuses the element of a route).
export default function AnnouncementDetailRoute() {
  const { announcementRef } = useParams();
  const ref = parseAnnouncementRef(announcementRef ?? "");
  if (ref === null) return <NotFoundView />;
  return <AnnouncementDetailPage key={announcementRef} announcementRef={ref} />;
}
