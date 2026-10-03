// Site identity and navigation (SPEC-050 8.1-8.3, 8.5, 24.3). Labels live in presentation/copy/ja.ts.
// Hrefs are same-site relative paths only: never the Administrator / Staff area or the dev area (SPEC-050 27).

export const SITE_NAME = "off r39'x in 大阪らへん2027";
export const EVENT_NAME: string = SITE_NAME;
export const HOME_HREF = "/";
export const CTA_HREF = "/entry";
export const CART_HREF = "/cart";
export const MYPAGE_HREF = "/mypage";

export type PrimaryNavKey = "event" | "entry" | "karaoke" | "goods" | "cart";
export type PrimaryNavItem = {
  readonly key: PrimaryNavKey;
  readonly href: string;
  /** Only collapsible items belong to the Header nav (desktop) and the Drawer (mobile). */
  readonly collapsible: boolean;
};

export const PRIMARY_NAV: readonly PrimaryNavItem[] = [
  { key: "event", href: HOME_HREF, collapsible: true },
  { key: "entry", href: CTA_HREF, collapsible: true },
  { key: "karaoke", href: "/karaoke", collapsible: true },
  { key: "goods", href: "/goods", collapsible: true },
  { key: "cart", href: CART_HREF, collapsible: false },
];

export type GuestAccountLink = { readonly key: "login" | "register"; readonly href: string };
export const GUEST_ACCOUNT_LINKS: readonly GuestAccountLink[] = [
  { key: "login", href: "/account/login" },
  { key: "register", href: "/account/register" },
];

export type AccountMenuItem = {
  readonly key: "profile" | "orders" | "entryTickets" | "karaoke" | "goods";
  readonly href: string;
};
export const ACCOUNT_MENU_ITEMS: readonly AccountMenuItem[] = [
  { key: "profile", href: "/mypage/profile" },
  { key: "orders", href: "/mypage/orders" },
  { key: "entryTickets", href: "/mypage/entry-tickets" },
  { key: "karaoke", href: "/mypage/karaoke" },
  { key: "goods", href: "/mypage/goods" },
];
