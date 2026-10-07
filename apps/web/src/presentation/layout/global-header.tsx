import Link from "next/link";
import { assets } from "../../config/assets";
import {
  CTA_HREF,
  GUEST_ACCOUNT_LINKS,
  HOME_HREF,
  MYPAGE_HREF,
  PRIMARY_NAV,
  SITE_NAME,
} from "../../config/site";
import { buttonVariants } from "../components/ui/button";
import { cn } from "../components/ui/cn";
import { copy } from "../copy/ja";
import { AccountMenu } from "./account-menu";
import { CartLink } from "./cart-link";
import { MobileNavDrawer } from "./mobile-nav-drawer";
import { PrimaryNav } from "./primary-nav";

export type HeaderSession = "loading" | "guest" | "authenticated";

type Props = {
  cartCount: number | null;
  session: HeaderSession;
  pathname: string;
  onLogout: () => void;
};

const linkClass = "inline-flex min-h-9 items-center rounded-base px-2 text-sm hover:bg-muted";

const LOGIN = GUEST_ACCOUNT_LINKS.find((link) => link.key === "login");
const REGISTER = GUEST_ACCOUNT_LINKS.find((link) => link.key === "register");

/**
 * Global Header (SPEC-050 8.5). DOM order is the Tab order: site name, navigation (desktop) or the
 * drawer trigger (mobile), the main CTA, Cart, then the account area.
 */
export function GlobalHeader({ cartCount, session, pathname, onLogout }: Props) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
        <Link
          prefetch={false}
          href={HOME_HREF}
          className="min-w-0 flex-1 basis-40 truncate rounded-base px-1 text-base font-semibold md:flex-none md:basis-auto"
        >
          {assets.logo === null ? (
            SITE_NAME
          ) : (
            // biome-ignore lint/performance/noImgElement: the logo slot is a plain configured asset
            <img src={assets.logo.src} alt={assets.logo.alt} className="inline-block h-6 w-auto" />
          )}
        </Link>
        <PrimaryNav
          items={PRIMARY_NAV.filter((item) => item.collapsible)}
          label={copy.layout.nav.primaryLabel}
          currentPath={pathname}
          className="hidden md:block"
        />
        <MobileNavDrawer currentPath={pathname} showRegister={session !== "authenticated"} />
        <Link
          prefetch={false}
          href={CTA_HREF}
          className={cn(buttonVariants({ size: "default" }), "ml-auto")}
        >
          {copy.layout.cta.buyTickets}
        </Link>
        <CartLink count={cartCount} />
        {session === "authenticated" ? (
          <>
            <Link prefetch={false} href={MYPAGE_HREF} className={linkClass}>
              {copy.layout.account.mypage}
            </Link>
            <AccountMenu onLogout={onLogout} />
          </>
        ) : null}
        {session === "guest" && LOGIN !== undefined ? (
          <Link prefetch={false} href={LOGIN.href} className={linkClass}>
            {copy.layout.account.login}
          </Link>
        ) : null}
        {session === "guest" && REGISTER !== undefined ? (
          <Link
            prefetch={false}
            href={REGISTER.href}
            className={cn(linkClass, "hidden md:inline-flex")}
          >
            {copy.layout.account.register}
          </Link>
        ) : null}
      </div>
    </header>
  );
}
