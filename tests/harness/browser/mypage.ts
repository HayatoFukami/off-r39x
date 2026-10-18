import { expect, type Locator, type Page } from "@playwright/test";
import type { DbState } from "../../../apps/web/src/mock/backend/db.ts";
import { copy } from "../../../apps/web/src/presentation/copy/ja.ts";
import { EMAIL } from "../mock-seed.ts";
import { dumpStorage } from "./auth.ts";
import { seedState } from "./public.ts";
import { mainOf } from "./purchase.ts";
import { sessionJson } from "./shell.ts";

// Browser-side helpers for the S8 Mypage suite (tests/contracts/s8-mypage.md). Test-only. All data is
// synthetic (example.com addresses, fixed seed UUIDs). New wording is read lazily (inside functions), so a
// missing production copy key fails the single test that needs it with a clear TypeError, not module load.

/** The route paths of the Mypage (SPEC-050 7). Kept here so that a missing production module does not hide E2E results. */
export const PATH = {
  overview: "/mypage",
  profile: "/mypage/profile",
  orders: "/mypage/orders",
  entryTickets: "/mypage/entry-tickets",
  reservations: "/mypage/karaoke",
  goodsItems: "/mypage/goods",
} as const;
export type NavKey = keyof typeof PATH;
export const NAV_KEYS: readonly NavKey[] = [
  "overview",
  "profile",
  "orders",
  "entryTickets",
  "reservations",
  "goodsItems",
];

export const orderPath = (ref: string): string => `/mypage/orders/${ref}`;
export const ticketPath = (ref: string): string => `/mypage/entry-tickets/${ref}`;
export const ticketQrPath = (ref: string): string => `/mypage/entry-tickets/${ref}/qr`;
export const reservationPath = (ref: string): string => `/mypage/karaoke/${ref}`;
export const reservationQrPath = (ref: string): string => `/mypage/karaoke/${ref}/qr`;
export const goodsItemPath = (ref: string): string => `/mypage/goods/${ref}`;

/** Display name of the seed user demo@example.com: the S6 "protected content" marker (contract section 10). */
export const DEMO_NAME = "デモ太郎";
export const FRESH_NAME = "新規さん";
export const OTHER_NAME = "他の人";

export const sessionFor = (email: string): string =>
  sessionJson({ kind: "authenticated", email, emailVerified: true });
export const demoSession = (): string => sessionFor(EMAIL.demo);
export const freshSession = (): string => sessionFor(EMAIL.fresh);
export const otherSession = (): string => sessionFor(EMAIL.other);

// ---- locators ------------------------------------------------------------------------------

export const region = (page: Page, name: string): Locator =>
  mainOf(page).getByRole("region", { name, exact: true });

/** The rows of a list (nav uses no list items, so these are only the page's own rows). */
export const rowsIn = (scope: Locator): Locator => scope.getByRole("listitem");

/** The list row that contains a link to `href`. */
export function rowWithHref(scope: Locator, href: string): Locator {
  return rowsIn(scope).filter({ has: scope.page().locator(`a[href="${href}"]`) });
}

export async function hrefsIn(scope: Locator): Promise<string[]> {
  return scope
    .locator("a[href]")
    .evaluateAll((anchors) => anchors.map((a) => a.getAttribute("href") ?? ""));
}

/** An href of an entitlement (Entry Ticket / Karaoke / Goods) page or list. */
const RIGHTS_HREF = /^\/mypage\/(entry-tickets|karaoke|goods)(\/|$)/;

/**
 * The entitlement links inside the page's regions. The Mypage navigation (outside every region) links to the
 * same lists, so the generic `entitlementHrefs` of the purchase harness would always see them.
 */
export async function rightsHrefs(page: Page): Promise<string[]> {
  return (await hrefsIn(mainOf(page).getByRole("region"))).filter((href) => RIGHTS_HREF.test(href));
}

export const mypageNav = (page: Page): Locator =>
  page.getByRole("navigation", { name: copy.mypage.nav.label, exact: true });
export const navToggle = (page: Page): Locator =>
  page.getByRole("button", { name: copy.mypage.nav.toggle, exact: true });
export const navLink = (page: Page, key: NavKey): Locator =>
  mypageNav(page).getByRole("link", { name: copy.mypage.nav.items[key], exact: true });

export const figureOf = (page: Page): Locator => mainOf(page).locator("figure");
export const qrImages = (page: Page): Locator => mainOf(page).locator('[role="img"]');
export const qrImage = (page: Page, label: string): Locator =>
  mainOf(page).getByRole("img", { name: label, exact: true });

/** The page's own buttons: every <button> in <main> except the Mobile toggle of the Mypage navigation. */
export const pageButtons = (page: Page): Locator =>
  mainOf(page).getByRole("button").filter({ hasNotText: copy.mypage.nav.toggle });

export const mainLink = (page: Page, name: string): Locator =>
  mainOf(page).getByRole("link", { name, exact: true });
export const mainButton = (page: Page, name: string): Locator =>
  mainOf(page).getByRole("button", { name, exact: true });
export const retryButtons = (scope: Locator): Locator =>
  scope.getByRole("button", { name: copy.pageState.retry, exact: true });

// ---- seed expectations (from the pure seed builder, filtered by the SPEC-050 rules, not by app code) ----

export type SeedOrder = DbState["orders"][number];

/** demo's Orders, newest first (stable on ties). */
export function demoOrdersNewestFirst(): SeedOrder[] {
  return seedState()
    .orders.map((order, index) => ({ order, index }))
    .filter(({ order }) => order.ownerEmail === EMAIL.demo)
    .sort(
      (a, b) => Date.parse(b.order.createdAt) - Date.parse(a.order.createdAt) || a.index - b.index,
    )
    .map(({ order }) => order);
}

export const seedTicket = (ref: string): DbState["tickets"][number] => {
  const found = seedState().tickets.find((t) => t.ref === ref);
  if (found === undefined) throw new Error(`unknown seed ticket ${ref}`);
  return found;
};

export const seedReservation = (ref: string) => {
  const state = seedState();
  const reservation = state.reservations.find((r) => r.ref === ref);
  const slot = state.slots.find((s) => s.ref === reservation?.slotRef);
  if (reservation === undefined || slot === undefined)
    throw new Error(`unknown seed reservation ${ref}`);
  return { reservation, slot };
};

export const seedGoodsItem = (ref: string): DbState["goodsItems"][number] => {
  const found = seedState().goodsItems.find((g) => g.ref === ref);
  if (found === undefined) throw new Error(`unknown seed goods item ${ref}`);
  return found;
};

// ---- database ------------------------------------------------------------------------------

/** The Business data that a read-only page must never change (orders, tickets, reservations, goods items, slots). */
export function businessDataOf(state: DbState): unknown {
  return {
    orders: state.orders,
    tickets: state.tickets,
    reservations: state.reservations,
    goodsItems: state.goodsItems,
    slots: state.slots,
  };
}

/** A DB edit that makes the seeded AWAITING_PAYMENT Order wait for a simulated webhook (the read advances it). */
export function awaitingWithWebhook(state: DbState, orderRef: string): void {
  const order = state.orders.find((o) => o.ref === orderRef);
  if (order === undefined) throw new Error(`unknown order ${orderRef}`);
  order.pendingWebhook = true;
  order.webhookReads = 0;
}

// ---- assertions shared by the specs --------------------------------------------------------

export const MOCK_SEED_IN_TEXT = /mock-seed-\d+/;

/** The mock matrix seed is input to drawing only: it is in no URL, no DOM text or attribute, no storage. */
export async function expectNoMatrixSeed(page: Page): Promise<void> {
  expect(page.url()).not.toMatch(MOCK_SEED_IN_TEXT);
  expect(await page.content()).not.toMatch(MOCK_SEED_IN_TEXT);
  expect(await dumpStorage(page)).not.toMatch(MOCK_SEED_IN_TEXT);
}

/** The accessible description of an element (the text of the elements named by aria-describedby). */
export async function describedBy(locator: Locator): Promise<string> {
  return locator.evaluate((el) => {
    const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    return ids
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  });
}

/** Text of <main> (the Mypage navigation is part of it and is identical on every denied view). */
export async function mainText(page: Page): Promise<string> {
  return mainOf(page).innerText();
}
