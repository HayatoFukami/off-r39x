import type { Ref } from "../api-client/types";

// Same-origin relative paths of the Mypage (SPEC-050 7, 17.2). Pure.

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A route parameter is a canonical lowercase UUID or nothing: it is never repaired (SPEC-050 5.2). */
export function parseTicketRef(raw: string): Ref<"ticket"> | null {
  return CANONICAL_UUID.test(raw) ? (raw as Ref<"ticket">) : null;
}

export function parseReservationRef(raw: string): Ref<"reservation"> | null {
  return CANONICAL_UUID.test(raw) ? (raw as Ref<"reservation">) : null;
}

export function parseGoodsItemRef(raw: string): Ref<"goodsItem"> | null {
  return CANONICAL_UUID.test(raw) ? (raw as Ref<"goodsItem">) : null;
}

export const MYPAGE_PATHS = {
  overview: "/mypage",
  profile: "/mypage/profile",
  orders: "/mypage/orders",
  entryTickets: "/mypage/entry-tickets",
  reservations: "/mypage/karaoke",
  goodsItems: "/mypage/goods",
} as const;

export type MypageNavKey = keyof typeof MYPAGE_PATHS;

export const MYPAGE_NAV_KEYS: readonly MypageNavKey[] = [
  "overview",
  "profile",
  "orders",
  "entryTickets",
  "reservations",
  "goodsItems",
];

// A QR page is addressed by the reference only: no token or seed is ever part of the path (SEC-QR-013).
export const entryQrHref = (ref: string): string => `/mypage/entry-tickets/${ref}/qr`;
export const reservationQrHref = (ref: string): string => `/mypage/karaoke/${ref}/qr`;

function isUnder(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/** The navigation entry that a pathname belongs to (query and hash are ignored). */
export function currentNavKey(pathname: string): MypageNavKey | null {
  const raw = pathname.split(/[?#]/)[0] ?? "";
  const path = raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;
  if (path === MYPAGE_PATHS.overview) return "overview";
  if (path === MYPAGE_PATHS.profile) return "profile";
  if (isUnder(path, MYPAGE_PATHS.orders)) return "orders";
  if (isUnder(path, MYPAGE_PATHS.entryTickets)) return "entryTickets";
  if (isUnder(path, MYPAGE_PATHS.reservations)) return "reservations";
  if (isUnder(path, MYPAGE_PATHS.goodsItems)) return "goodsItems";
  return null;
}
