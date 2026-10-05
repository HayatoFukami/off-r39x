import { expect, type Locator, type Page } from "@playwright/test";
import { copy } from "../../../apps/web/src/presentation/copy/ja.ts";

// Locators and helpers for the Header menu and the Floating Ticket Button (tests/contracts/s10-header-float-reveal.md).
// Test-only. Names come from the copy module; "メニュー" is a substring of "アカウントメニュー", so every name
// lookup here is exact.

export const header = (page: Page): Locator => page.getByRole("banner");

export const primaryMenuButton = (page: Page): Locator =>
  header(page).getByRole("button", { name: copy.layout.menu.button, exact: true });

export const primaryMenuPanel = (page: Page): Locator =>
  header(page).getByRole("navigation", { name: copy.layout.nav.primaryLabel, exact: true });

export const floatingTicket = (page: Page): Locator => page.getByTestId("floating-ticket-button");

/** Opens the Header menu the way a user does (click on the button) and returns the panel. */
export async function openPrimaryMenu(page: Page): Promise<Locator> {
  const button = primaryMenuButton(page);
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const panel = primaryMenuPanel(page);
  await expect(panel).toBeVisible();
  return panel;
}

/** Opens the menu and follows one of its links (the primary-navigation journey on both viewports). */
export async function gotoViaPrimaryMenu(page: Page, label: string): Promise<void> {
  const panel = await openPrimaryMenu(page);
  await panel.getByRole("link", { name: label, exact: true }).click();
}

/**
 * Scrolls to a fraction of the scrollable range (0..1) and returns the resulting scrollY. The page must be
 * long enough to make the test meaningful: a short page fails here (a precondition), not in the assertions.
 */
export async function scrollToFraction(page: Page, fraction: number): Promise<number> {
  const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(max, "precondition: the page is scrollable by at least 400px").toBeGreaterThanOrEqual(400);
  const target = Math.floor(max * fraction);
  await page.evaluate((top) => window.scrollTo(0, top), target);
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { message: "scroll position reached" })
    .toBeGreaterThanOrEqual(Math.min(target, max) - 2);
  return target;
}

export type Box = { x: number; y: number; width: number; height: number };

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
