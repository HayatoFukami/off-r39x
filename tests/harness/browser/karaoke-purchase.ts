import type { Locator, Page } from "@playwright/test";
import type { DbState } from "../../../apps/web/src/mock/backend/db.ts";
import { copy } from "../../../apps/web/src/presentation/copy/ja.ts";
import { readState, type StoredOrder } from "./purchase.ts";
import { KEYS } from "./shell.ts";

// Browser-side helpers for the S7b Karaoke slot suite (tests/contracts/s7b-karaoke.md). Test-only.
// All data is synthetic. The mock DB lives in localStorage ("r39x.mock.db.v1"); tests read it to assert the
// DB postconditions of the UI mock (orders, slot states). This is not API / DB coverage.

export type SlotStateName = DbState["slots"][number]["state"];

export const slotRoute = (ref: string): string => `/karaoke/slots/${ref}`;

const detail = copy.karaoke.slotDetail;

// ---- locators --------------------------------------------------------------------------------

export const mainOf = (page: Page): Locator => page.getByRole("main");
export const heading1 = (page: Page): Locator => page.getByRole("heading", { level: 1 });

/** The purchase button by its exact name (Guest and Authenticated have different names). */
export const purchaseButton = (page: Page, name: string = detail.proceed): Locator =>
  mainOf(page).getByRole("button", { name, exact: true });
export const guestButton = (page: Page): Locator => purchaseButton(page, detail.proceedGuest);

export const alertsOf = (page: Page): Locator => mainOf(page).locator('[role="alert"]');
export const statusesOf = (page: Page): Locator => mainOf(page).locator('[role="status"]');

export const backToDayLink = (page: Page): Locator =>
  mainOf(page).getByRole("link", { name: detail.backToDay, exact: true });
export const chooseAgainLink = (page: Page): Locator =>
  mainOf(page).getByRole("link", { name: detail.chooseAgain, exact: true });

export const infoRegion = (page: Page): Locator =>
  mainOf(page).getByRole("region", { name: detail.infoHeading, exact: true });
export const actionRegion = (page: Page): Locator =>
  mainOf(page).getByRole("region", { name: detail.actionHeading, exact: true });

// ---- database --------------------------------------------------------------------------------

export async function slotStateInDb(page: Page, ref: string): Promise<SlotStateName | undefined> {
  return (await readState(page)).slots.find((s) => s.ref === ref)?.state;
}

/** Every slot that is not AVAILABLE, as `ref:state` (to prove that nothing else changed). */
export async function slotStates(page: Page): Promise<Record<string, SlotStateName>> {
  const slots = (await readState(page)).slots;
  return Object.fromEntries(slots.map((s) => [s.ref, s.state]));
}

/** A server-side change after the page was rendered: another user took the slot (HELD). */
export async function setSlotStateInDb(
  page: Page,
  ref: string,
  state: SlotStateName,
): Promise<void> {
  await page.evaluate(
    ([key, slotRef, next]) => {
      const raw = window.localStorage.getItem(key as string);
      if (raw === null) throw new Error("no mock DB");
      const parsed = JSON.parse(raw) as { slots: { ref: string; state: string }[] };
      const target = parsed.slots.find((s) => s.ref === slotRef);
      if (target === undefined) throw new Error("unknown slot");
      target.state = next as string;
      window.localStorage.setItem(key as string, JSON.stringify(parsed));
    },
    [KEYS.db, ref, state],
  );
}

/** The Karaoke Orders of a state snapshot, newest last. */
export function karaokeOrders(orders: readonly StoredOrder[]): StoredOrder[] {
  return orders.filter((o) => o.purpose === "KARAOKE_PURCHASE");
}

/** The numbers of minutes or seconds that would hint at a Hold duration (never shown, design 4). */
export const HOLD_DURATION_IN_TEXT = /[0-9０-９]+\s*(分|秒)|残り|カウントダウン/;
