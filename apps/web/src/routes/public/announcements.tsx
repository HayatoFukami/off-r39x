import { AnnouncementListPage } from "../../features/public/announcement-list-page";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.pageTitle.announcements };

// PG-PUB-002
export default function AnnouncementsRoute() {
  return <AnnouncementListPage />;
}
