import type { Metadata } from "next";
import { AnnouncementListPage } from "../../src/features/public/announcement-list-page";
import { copy } from "../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.pageTitle.announcements };

// PG-PUB-002
export default function Page() {
  return <AnnouncementListPage />;
}
