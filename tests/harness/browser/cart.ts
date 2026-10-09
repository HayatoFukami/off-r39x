import type { BrowserContext, Locator, Page } from "@playwright/test";
import type { Money, Ref, UtcInstant } from "../../../apps/web/src/api-client/types.ts";
import { copy } from "../../../apps/web/src/presentation/copy/ja.ts";
import { NOW_ISO } from "../mock-seed.ts";
import { seedState } from "./public.ts";
import { KEYS } from "./shell.ts";

// Browser-side helpers for the S5 Cart / Entry / Goods detail suite (tests/contracts/s5-cart.md section 6).
// Test-only. All data is synthetic (seed UUIDs). Expected values come from the pure seed builder, filtered
// here by the SPEC-050 rules, not by application code.

export type StoredLine =
  | { kind: "ENTRY_TICKET"; offeringRef: string; quantity: number }
  | { kind: "GOODS"; goodsRef: string; quantity: number };

export const entryLine = (offeringRef: string, quantity = 1): StoredLine => ({
  kind: "ENTRY_TICKET",
  offeringRef,
  quantity,
});
export const goodsLine = (goodsRef: string, quantity = 1): StoredLine => ({
  kind: "GOODS",
  goodsRef,
  quantity,
});

/** localStorage entries that preseed a valid Cart. */
export function cartEntries(lines: readonly StoredLine[]): Record<string, string> {
  return { [KEYS.cart]: JSON.stringify({ version: 1, lines }) };
}

export const EMPTY_CART_JSON = JSON.stringify({ version: 1, lines: [] });

/** What a Cart must never contain (SPEC-050 26.4, FR-CRT-003). Refs and "kind" values do not match. */
export const FORBIDDEN_IN_CART_STORAGE =
  /price|amount|currency|JPY|remaining|stock|availability|owner|email|"name"|unit|subtotal|total/i;

export async function readCartRaw(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), KEYS.cart);
}

/** The parsed stored Cart, or null when the key is absent. */
export async function readCart(page: Page): Promise<unknown> {
  const raw = await readCartRaw(page);
  return raw === null ? null : (JSON.parse(raw) as unknown);
}

export async function readDbRaw(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), KEYS.db);
}

/**
 * Replaces the whole localStorage of the current origin. seedLocalStorage applies its entries once per tab
 * (so that a reload keeps later changes), which means a loop over several states must reset explicitly.
 */
export async function resetStorage(page: Page, entries: Record<string, string>): Promise<void> {
  await page.evaluate((payload) => {
    window.localStorage.clear();
    for (const [key, value] of Object.entries(payload)) window.localStorage.setItem(key, value);
  }, entries);
}

export async function writeStorage(page: Page, key: string, value: string): Promise<void> {
  await page.evaluate(
    ([k, v]) => window.localStorage.setItem(k as string, v as string),
    [key, value],
  );
}

/** A second tab of the same browser context with the same fixed clock. */
export async function openSecondTab(context: BrowserContext): Promise<Page> {
  const other = await context.newPage();
  await other.clock.setFixedTime(new Date(NOW_ISO));
  return other;
}

// ---- expected data -------------------------------------------------------------------------

export type ExpectedOffering = {
  ref: Ref<"offering">;
  name: string;
  description: string;
  unitPrice: Money;
  startsAt: UtcInstant;
  endsAt: UtcInstant;
  perAccountLimit: number | null;
};

/** The six public offerings in seed (port) order. */
export function expectedOfferings(): ExpectedOffering[] {
  return seedState()
    .offerings.filter((o) => o.published)
    .map((o) => ({
      ref: o.ref as Ref<"offering">,
      name: o.name,
      description: o.description,
      unitPrice: o.unitPrice,
      startsAt: o.startsAt as UtcInstant,
      endsAt: o.endsAt as UtcInstant,
      perAccountLimit: o.perAccountLimit,
    }));
}

export function offeringName(ref: string): string {
  const found = expectedOfferings().find((o) => o.ref === ref);
  if (found === undefined) throw new Error(`unknown offering ${ref}`);
  return found.name;
}

export type ExpectedGoodsDetail = {
  ref: Ref<"goods">;
  name: string;
  description: string;
  unitPrice: Money;
  startsAt: UtcInstant;
  endsAt: UtcInstant;
  published: boolean;
};

export function expectedGoodsDetail(ref: string): ExpectedGoodsDetail {
  const found = seedState().goods.find((g) => g.ref === ref);
  if (found === undefined) throw new Error(`unknown goods ${ref}`);
  return {
    ref: found.ref as Ref<"goods">,
    name: found.name,
    description: found.description,
    unitPrice: found.unitPrice,
    startsAt: found.startsAt as UtcInstant,
    endsAt: found.endsAt as UtcInstant,
    published: found.published,
  };
}

/** A DB edit that changes the unit price of one offering / goods (price comes from the port, not the Cart). */
export function priceEdit(kind: "offering" | "goods", ref: string, amount: string) {
  return (state: ReturnType<typeof seedState>): void => {
    const list = kind === "offering" ? state.offerings : state.goods;
    const target = list.find((item) => item.ref === ref);
    if (target === undefined) throw new Error(`unknown ${kind} ${ref}`);
    target.unitPrice = { amount, currency: "JPY" };
  };
}

// ---- locators ------------------------------------------------------------------------------

export const mainOf = (page: Page): Locator => page.getByRole("main");

/** The list item whose h2 is exactly the given name (Entry offering or Cart line). */
export const rowByHeading = (page: Page, name: string): Locator =>
  mainOf(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });

export const quantityInput = (scope: Locator): Locator => scope.getByRole("spinbutton");
export const addButton = (scope: Locator): Locator =>
  scope.getByRole("button", { name: copy.sales.add });
export const removeButton = (scope: Locator): Locator =>
  scope.getByRole("button", { name: copy.cart.remove });

/** The page-level add-result live region (role=status, present and empty before the first add). */
export const liveRegion = (page: Page): Locator => mainOf(page).locator('[role="status"]');

export const headerCartLink = (page: Page, count: number | null = null): Locator =>
  page.getByRole("banner").getByRole("link", {
    name: count === null ? copy.layout.cart.label : copy.layout.cart.labelWithCount(count),
    exact: true,
  });

export const proceedButton = (page: Page): Locator =>
  mainOf(page).getByRole("button", { name: copy.cart.proceed.label, exact: true });

/** Text of every element referenced by aria-describedby of the element (joined by a space). */
export async function describedText(locator: Locator): Promise<string> {
  return locator.evaluate((el) => {
    const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
  });
}

/** Forces a failing localStorage write for the Cart key (browser quota / blocked storage). */
export async function failCartWrites(page: Page): Promise<void> {
  await page.addInitScript((key: string) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(this: Storage, name: string, value: string) {
      if (name === key) throw new DOMException("quota", "QuotaExceededError");
      original.call(this, name, value);
    };
  }, KEYS.cart);
}
