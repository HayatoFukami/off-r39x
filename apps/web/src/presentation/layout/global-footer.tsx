import { EVENT_NAME, PRIMARY_NAV } from "../../config/site";
import { cn } from "../components/ui/cn";
import { copy } from "../copy/ja";
import { isFloatingTicketVisible } from "./floating-ticket-visibility";
import { PrimaryNav } from "./primary-nav";
import type { SponsorAreaModel } from "./sponsor-area-model";
import { SponsorLogos } from "./sponsor-logos";

type Props = { sponsors: SponsorAreaModel; pathname: string };

/** Global Footer: event name, the five navigation links and, when there is any, the Sponsor Logo area. */
export function GlobalFooter({ sponsors, pathname }: Props) {
  return (
    <footer
      className={cn(
        "mt-8 border-t border-border bg-muted",
        // Room for the Floating Ticket Button so it never covers a footer control.
        isFloatingTicketVisible(pathname) && "pb-[calc(4.5rem+env(safe-area-inset-bottom))]",
      )}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-3 py-6">
        <p className="text-sm font-semibold">{EVENT_NAME}</p>
        <PrimaryNav
          items={PRIMARY_NAV}
          label={copy.layout.nav.footerLabel}
          currentPath={pathname}
        />
        {sponsors.kind === "visible" ? <SponsorLogos items={sponsors.items} /> : null}
      </div>
    </footer>
  );
}
