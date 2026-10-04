import type { Metadata } from "next";
import { EntryPage } from "../../src/features/entry/entry-page";
import { copy } from "../../src/presentation/copy/ja";

export const metadata: Metadata = { title: copy.entry.pageTitle };

// PG-TKT-001
export default function Page() {
  return <EntryPage />;
}
