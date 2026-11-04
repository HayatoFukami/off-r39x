import { Outlet, ScrollRestoration, useMatches } from "react-router";
import { ApiProvider } from "../api-client/provider";
import { SessionProvider } from "../auth/session-provider";
import { SiteFloatingTicket } from "../features/shell/site-floating-ticket";
import { SiteFooter } from "../features/shell/site-footer";
import { SiteHeader } from "../features/shell/site-header";
import { MockModeBadge } from "../mock/dev-ui/mock-mode-badge";
import { HydrationMarker } from "../presentation/components/hydration-marker";
import { copy } from "../presentation/copy/ja";
import { formatDocumentTitle } from "./document-title";
import { isRouteHandle } from "./route-handle";

/** The title of the deepest matched route that names one; a route without a title (Home) keeps the site name. */
function useDeepestTitle(): string | undefined {
  const matches = useMatches();
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const handle = matches[index]?.handle;
    if (isRouteHandle(handle) && handle.title !== undefined) return handle.title;
  }
  return undefined;
}

// The root layout owns the single main landmark: route modules, features and presentation must not render their
// own (DEV-WEB-001). The document title is rendered here once, from the matched route handles.
export default function RootLayout() {
  const title = useDeepestTitle();
  return (
    <>
      <HydrationMarker />
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
            <Outlet />
          </main>
          <SiteFooter />
          <SiteFloatingTicket />
          <MockModeBadge />
        </SessionProvider>
      </ApiProvider>
      {/* Keyed by the router's own location key, never by URL or query (SEC-AUTH-018). */}
      <ScrollRestoration />
      <title>{formatDocumentTitle(title)}</title>
    </>
  );
}
