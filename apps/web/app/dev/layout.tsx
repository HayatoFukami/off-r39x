import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isDevAreaEnabled } from "../../src/config/ui-mock";

// DEV-WEB-012: the dev area exists only in UI mock mode and is kept out of search indexes.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DevLayout({ children }: { children: ReactNode }) {
  const enabled = isDevAreaEnabled({
    NEXT_PUBLIC_UI_MOCK: process.env.NEXT_PUBLIC_UI_MOCK,
    VERCEL_ENV: process.env.VERCEL_ENV,
  });
  if (!enabled) notFound();
  return children;
}
