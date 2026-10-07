import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ApiProvider } from "../src/api-client/provider";
import { SessionProvider } from "../src/auth/session-provider";
import { SITE_NAME } from "../src/config/site";
import { SiteFooter } from "../src/features/shell/site-footer";
import { SiteHeader } from "../src/features/shell/site-header";
import { MockModeBadge } from "../src/mock/dev-ui/mock-mode-badge";
import { copy } from "../src/presentation/copy/ja";
import "./globals.css";

export const metadata: Metadata = {
  title: SITE_NAME,
};

// The root layout owns the single main landmark: pages must not render their own <main>.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body className="flex min-h-dvh flex-col bg-background font-sans text-foreground">
        <ApiProvider>
          <SessionProvider>
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-base focus:bg-brand focus:px-3 focus:py-2 focus:text-brand-foreground"
            >
              {copy.layout.skipLink}
            </a>
            <SiteHeader />
            <main
              id="main-content"
              tabIndex={-1}
              className="mx-auto w-full max-w-6xl flex-1 px-3 py-6 outline-none"
            >
              {children}
            </main>
            <SiteFooter />
            <MockModeBadge />
          </SessionProvider>
        </ApiProvider>
      </body>
    </html>
  );
}
