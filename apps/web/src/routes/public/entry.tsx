import { EntryPage } from "../../features/entry/entry-page";
import { copy } from "../../presentation/copy/ja";
import type { RouteHandle } from "../route-handle";

export const handle: RouteHandle = { title: copy.entry.pageTitle };

// PG-TKT-001
export default function EntryRoute() {
  return <EntryPage />;
}
