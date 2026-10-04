import { expect, type Locator, type Page } from "@playwright/test";
import type { DbState } from "../../../apps/web/src/mock/backend/db.ts";
import { copy } from "../../../apps/web/src/presentation/copy/ja.ts";
import { EMAIL } from "../mock-seed.ts";
import { cartEntries, readDbRaw, type StoredLine, writeStorage } from "./cart.ts";
import { gotoHydrated } from "./hydration.ts";
import { dbJson, fixClock, seedState } from "./public.ts";
import { authenticatedSession, KEYS, scenarioJson, seedLocalStorage } from "./shell.ts";

// Browser-side helpers for the S7a purchase suite (tests/contracts/s7a-purchase.md). Test-only.
// All data is synthetic. The mock database lives in localStorage ("r39x.mock.db.v1"); tests read it to
// assert the DB postconditions of the UI mock (orders, allocations). This is not API / DB coverage.

export type StoredOrder = DbState["orders"][number];
export type OrderStateName = StoredOrder["state"];

/** The seven Canonical Order states (SPEC-030). Playwright cannot load @off-r39x/domain values, so it is listed here. */
export const ORDER_STATE_LIST: readonly OrderStateName[] = [
  "PREPARED",
  "AWAITING_PAYMENT",
  "CONFIRMED",
  "PAYMENT_FAILED",
  "CANCELED",
  "EXPIRED",
  "REVIEW_REQUIRED",
];

export const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
export const INTERNAL_IDS_IN_TEXT = /webhook|evt_|payment_intent|pi_[0-9a-z]{6,}/i;
/** Wording that would claim a finished purchase. Used while the Order is not CONFIRMED. */
export const SUCCESS_WORDING = /支払い完了|Ticket発行済み|予約確定|受け取り可能|購入が確定しました/;
/** An href of an entitlement (Entry Ticket / Karaoke / Goods) page or list. */
export const ENTITLEMENT_HREF = /^\/mypage\/(entry-tickets|karaoke|goods)(\/|$)/;

export const mainOf = (page: Page): Locator => page.getByRole("main");
export const heading1 = (page: Page): Locator => page.getByRole("heading", { level: 1 });

export const outcomeRegion = (page: Page): Locator =>
  mainOf(page).getByRole("region", { name: copy.purchase.outcomeHeading, exact: true });
export const itemsRegion = (page: Page): Locator =>
  mainOf(page).getByRole("region", { name: copy.purchase.itemsHeading, exact: true });
export const entitlementsRegion = (page: Page): Locator =>
  mainOf(page).getByRole("region", { name: copy.purchase.entitlements.heading, exact: true });

/** The page-level live region of the Purchase Status page (the only role=status in a ready main). */
export const statusLive = (page: Page): Locator => mainOf(page).locator('[role="status"]');
export const alertsOf = (page: Page): Locator => mainOf(page).locator('[role="alert"]');

export const actionButton = (page: Page, label: string): Locator =>
  mainOf(page).getByRole("button", { name: label, exact: true });
export const actionLink = (page: Page, label: string): Locator =>
  mainOf(page).getByRole("link", { name: label, exact: true });

export const proceedButton = (page: Page): Locator =>
  mainOf(page).getByRole("button", { name: copy.cart.proceed.label, exact: true });

// ---- database / scenario ------------------------------------------------------------------

export async function readState(page: Page): Promise<DbState> {
  const raw = await readDbRaw(page);
  if (raw === null) throw new Error("the mock DB has not been written yet");
  return JSON.parse(raw) as DbState;
}

export async function storedOrders(page: Page): Promise<StoredOrder[]> {
  return (await readState(page)).orders;
}

/** The orders owned by one user (default: demo). */
export async function ordersOf(page: Page, email: string = EMAIL.demo): Promise<StoredOrder[]> {
  return (await storedOrders(page)).filter((o) => o.ownerEmail === email);
}

export async function orderByRef(page: Page, ref: string): Promise<StoredOrder | undefined> {
  return (await storedOrders(page)).find((o) => o.ref === ref);
}

/** Orders that did not exist in the seed (created during the test). */
export async function newOrders(page: Page): Promise<StoredOrder[]> {
  const seedRefs = new Set(seedState().orders.map((o) => o.ref));
  return (await storedOrders(page)).filter((o) => !seedRefs.has(o.ref));
}

export async function remainingOf(
  page: Page,
  kind: "offering" | "goods",
  ref: string,
): Promise<number | undefined> {
  const state = await readState(page);
  const list = kind === "offering" ? state.offerings : state.goods;
  return list.find((item) => item.ref === ref)?.remaining;
}

/** Applies a scenario switch from inside the page (the app re-reads the scenario at every call). */
export async function setScenario(page: Page, patch: Record<string, unknown>): Promise<void> {
  await writeStorage(page, KEYS.scenario, scenarioJson(patch));
}

/** A server-side change that happens after the page was rendered: the offering is suspended. */
export async function suspendOffering(page: Page, ref: string): Promise<void> {
  await page.evaluate(
    ([key, offeringRef]) => {
      const raw = window.localStorage.getItem(key as string);
      if (raw === null) throw new Error("no mock DB");
      const state = JSON.parse(raw) as {
        offerings: { ref: string; control: string }[];
      };
      const target = state.offerings.find((o) => o.ref === offeringRef);
      if (target === undefined) throw new Error("unknown offering");
      target.control = "SUSPENDED";
      window.localStorage.setItem(key as string, JSON.stringify(state));
    },
    [KEYS.db, ref],
  );
}

// ---- opening pages -----------------------------------------------------------------------

export type OpenOptions = {
  /** Mock DB edit applied to a copy of the seed (the DB is always preseeded so that counts are stable). */
  dbEdit?: (state: DbState) => void;
  scenario?: Record<string, unknown>;
  session?: string | null;
  lines?: readonly StoredLine[];
  extra?: Record<string, string>;
};

function entriesFor(options: OpenOptions): Record<string, string> {
  return {
    ...dbJson(options.dbEdit ?? (() => {})),
    ...(options.scenario === undefined ? {} : { [KEYS.scenario]: scenarioJson(options.scenario) }),
    ...(options.session === null
      ? {}
      : { [KEYS.session]: options.session ?? authenticatedSession() }),
    ...(options.lines === undefined ? {} : cartEntries(options.lines)),
    ...(options.extra ?? {}),
  };
}

/** Opens a page as demo (verified) with a fixed clock and a preseeded DB. */
export async function openAs(page: Page, path: string, options: OpenOptions = {}): Promise<void> {
  await fixClock(page);
  await seedLocalStorage(page, entriesFor(options));
  await gotoHydrated(page, path);
}

/** Opens the Cart, waits until it can proceed, presses "購入手続きへ進む" and waits for the mock Checkout. */
export async function proceedToMockCheckout(page: Page): Promise<string> {
  await expect(proceedButton(page)).toBeEnabled({ timeout: 15_000 });
  await proceedButton(page).click();
  await page.waitForURL(/\/dev\/mock-checkout\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  return orderRefFromUrl(page.url());
}

export function orderRefFromUrl(url: string): string {
  const match = /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(
    new URL(url).pathname,
  );
  if (match === null || match[1] === undefined) throw new Error(`no order ref in ${url}`);
  return match[1];
}

// ---- text watching (for transient states) -------------------------------------------------

/**
 * Records, from document start, which of the given texts ever appeared in <main> (also across client-side
 * navigation). A full navigation starts a fresh document, which resets the record.
 */
export async function watchTexts(page: Page, needles: readonly string[]): Promise<void> {
  await page.addInitScript(
    (list: string[]) => {
      const w = window as unknown as { __seenTexts?: Record<string, boolean> };
      w.__seenTexts = {};
      for (const needle of list) w.__seenTexts[needle] = false;
      const check = (): void => {
        const text = document.querySelector("main")?.textContent ?? "";
        for (const needle of list) {
          if (text.includes(needle) && w.__seenTexts) w.__seenTexts[needle] = true;
        }
      };
      new MutationObserver(check).observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    },
    [...needles],
  );
}

export async function seenTexts(page: Page): Promise<Record<string, boolean>> {
  return page.evaluate(
    () => (window as unknown as { __seenTexts?: Record<string, boolean> }).__seenTexts ?? {},
  );
}

/** Waits until the watched text has been seen in this document. */
export async function waitSeen(page: Page, needle: string, timeout = 15_000): Promise<void> {
  await page.waitForFunction(
    (text: string) =>
      (window as unknown as { __seenTexts?: Record<string, boolean> }).__seenTexts?.[text] === true,
    needle,
    { timeout },
  );
}

/** Every anchor href inside <main>, as a path + search (same-origin ones only). */
export async function mainHrefs(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("main a[href]")).map((a) => {
      const url = new URL((a as HTMLAnchorElement).href);
      return `${url.pathname}${url.search}`;
    }),
  );
}

export async function entitlementHrefs(page: Page): Promise<string[]> {
  return (await mainHrefs(page)).filter((href) => ENTITLEMENT_HREF.test(href));
}

export const seedOrder = (ref: string) => {
  const found = seedState().orders.find((o) => o.ref === ref);
  if (found === undefined) throw new Error(`unknown seed order ${ref}`);
  return found;
};
