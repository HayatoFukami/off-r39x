import { EVENT_NAME, PRIMARY_NAV } from "../../config/site";
import { copy } from "../copy/ja";
import { PrimaryNav } from "./primary-nav";
import type { SponsorAreaModel } from "./sponsor-area-model";
import { SponsorLogos } from "./sponsor-logos";

type Props = { sponsors: SponsorAreaModel; pathname: string };

/** Global Footer: event name, the five navigation links and, when there is any, the Sponsor Logo area. */
export function GlobalFooter({ sponsors, pathname }: Props) {
  return (
    <footer className="mt-8 border-t border-border bg-muted">
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
