import { expect, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  header,
  openPrimaryMenu,
  primaryMenuButton,
  primaryMenuPanel,
  scrollToFraction,
} from "../harness/browser/header-menu.ts";
import { gotoHydrated } from "../harness/browser/hydration.ts";
import { SITE_NAME } from "../harness/browser/shell.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s10-header-float-reveal.md sections 2, 3.
// SPEC-050 8.5 (Header menu, site name), 25 (keyboard, Link vs Button, Escape, focus return).

const siteName = (page: import("@playwright/test").Page) =>
  header(page).getByRole("link", { name: SITE_NAME, exact: true });

test.describe("TC-PG-PUB-001-307 Header menu is a disclosure button with state, a controlled panel of Links (SPEC-050 8.5, 25)", () => {
  test("toggles aria-expanded and renders the panel only while open", async ({ page }) => {
    await gotoHydrated(page, "/");
    const button = primaryMenuButton(page);
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(primaryMenuPanel(page)).toHaveCount(0);

    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = primaryMenuPanel(page);
    await expect(panel).toBeVisible();
    const id = await panel.getAttribute("id");
    expect(id, "the open panel has an id").not.toBeNull();
    await expect(button).toHaveAttribute("aria-controls", id ?? "");

    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(primaryMenuPanel(page)).toHaveCount(0);
  });

  test("is a real button reachable and operable by keyboard (Enter and Space)", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    const button = primaryMenuButton(page);
    expect(await button.evaluate((el) => el.tagName)).toBe("BUTTON");
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(primaryMenuPanel(page)).toBeVisible();
    await page.keyboard.press("Space");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(primaryMenuPanel(page)).toHaveCount(0);
    await page.keyboard.press("Space");
    await expect(button).toHaveAttribute("aria-expanded", "true");
  });

  test("lists the 4 navigation destinations as Links in the DOM order of the Header, marking the current page", async ({
    page,
  }) => {
    await gotoHydrated(page, "/goods");
    const panel = await openPrimaryMenu(page);
    const links = panel.getByRole("link");
    const names = await links.evaluateAll((els) =>
      els.map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim()),
    );
    const primary = [
      copy.layout.nav.items.event,
      copy.layout.nav.items.entry,
      copy.layout.nav.items.karaoke,
      copy.layout.nav.items.goods,
    ];
    expect(names.slice(0, 4)).toEqual(primary);
    await expect(
      panel.getByRole("link", { name: copy.layout.nav.items.goods, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      panel.getByRole("link", { name: copy.layout.nav.items.event, exact: true }),
    ).not.toHaveAttribute("aria-current", "page");
    // The panel belongs to the banner, right after the site name and the menu button.
    const order = await page.evaluate((buttonName) => {
      const banner = document.querySelector("header");
      if (banner === null) return [];
      const button = Array.from(banner.querySelectorAll("button")).find(
        (el) => el.getAttribute("aria-expanded") !== null && el.textContent?.trim() === buttonName,
      );
      const nav = banner.querySelector("nav");
      const site = banner.querySelector("a[href='/']");
      if (button === undefined || nav === null || site === null) return [];
      const precedes = (a: Element, b: Element): boolean =>
        (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      return [precedes(site, button), precedes(button, nav)];
    }, copy.layout.menu.button);
    expect(order).toEqual([true, true]);
  });

  test("stays inside the viewport horizontally and keeps the Header fixed while open", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    const panel = await openPrimaryMenu(page);
    const viewport = page.viewportSize();
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box !== null && viewport !== null) {
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    for (const name of [
      copy.layout.nav.items.event,
      copy.layout.nav.items.entry,
      copy.layout.nav.items.karaoke,
      copy.layout.nav.items.goods,
    ]) {
      await expect(panel.getByRole("link", { name, exact: true })).toBeInViewport();
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await scrollToFraction(page, 0.5);
    await expect(header(page)).toBeInViewport();
    await expect(primaryMenuButton(page)).toBeInViewport();
  });
});

test.describe("TC-PG-PUB-001-308 Header menu closes on Escape, outside press, selection and route change, and returns focus (SPEC-050 8.5, 25)", () => {
  test("Escape closes it and returns focus to the button (focus on the button)", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    await openPrimaryMenu(page);
    await page.keyboard.press("Escape");
    await expect(primaryMenuPanel(page)).toHaveCount(0);
    await expect(primaryMenuButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(primaryMenuButton(page)).toBeFocused();
  });

  test("Escape closes it and returns focus to the button (focus inside the panel)", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    const panel = await openPrimaryMenu(page);
    await panel.getByRole("link", { name: copy.layout.nav.items.karaoke, exact: true }).focus();
    await expect(
      panel.getByRole("link", { name: copy.layout.nav.items.karaoke, exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(primaryMenuPanel(page)).toHaveCount(0);
    await expect(primaryMenuButton(page)).toBeFocused();
  });

  test("a press outside the menu closes it", async ({ page }) => {
    await gotoHydrated(page, "/");
    await openPrimaryMenu(page);
    await page.locator("footer p").first().click();
    await expect(primaryMenuPanel(page)).toHaveCount(0);
    await expect(primaryMenuButton(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("selecting the link of the current page also closes it", async ({ page }) => {
    await gotoHydrated(page, "/");
    const panel = await openPrimaryMenu(page);
    await panel.getByRole("link", { name: copy.layout.nav.items.event, exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(primaryMenuPanel(page)).toHaveCount(0);
    await expect(primaryMenuButton(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("a route change made outside the menu (footer link) closes it, and Back does not reopen it", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    await openPrimaryMenu(page);
    // Keyboard activation: no pointer press happens, so only the route change can close the menu.
    const footerLink = page
      .getByRole("contentinfo")
      .getByRole("navigation", { name: copy.layout.nav.footerLabel, exact: true })
      .getByRole("link", { name: copy.layout.nav.items.karaoke, exact: true });
    await footerLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/karaoke$/);
    await expect(primaryMenuPanel(page)).toHaveCount(0);
    await expect(primaryMenuButton(page)).toHaveAttribute("aria-expanded", "false");
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(primaryMenuPanel(page)).toHaveCount(0);
    await expect(primaryMenuButton(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("the menu can be opened again after a navigation", async ({ page }) => {
    await gotoHydrated(page, "/");
    const panel = await openPrimaryMenu(page);
    await panel.getByRole("link", { name: copy.layout.nav.items.entry, exact: true }).click();
    await expect(page).toHaveURL(/\/entry$/);
    const again = await openPrimaryMenu(page);
    await expect(
      again.getByRole("link", { name: copy.layout.nav.items.entry, exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });
});

test.describe("TC-PG-PUB-001-309 the site name goes to the top page, and scrolls to the top when already there (SPEC-050 8.5)", () => {
  test("from another page it navigates to / (client-side)", async ({ page }) => {
    await gotoHydrated(page, "/goods");
    await expect(siteName(page)).toHaveAttribute("href", "/");
    await page.evaluate(() => {
      (window as unknown as { r39xMarker: number }).r39xMarker = 1;
    });
    await siteName(page).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const marker = await page.evaluate(
      () => (window as unknown as { r39xMarker?: number }).r39xMarker,
    );
    expect(marker, "no full page reload").toBe(1);
  });

  test("on / it scrolls to the top without reloading, by click", async ({ page }) => {
    await gotoHydrated(page, "/");
    await page.evaluate(() => {
      (window as unknown as { r39xMarker: number }).r39xMarker = 1;
    });
    await scrollToFraction(page, 0.6);
    await siteName(page).click();
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 }).toBe(0);
    await expect(page).toHaveURL(/\/$/);
    const marker = await page.evaluate(
      () => (window as unknown as { r39xMarker?: number }).r39xMarker,
    );
    expect(marker, "no full page reload").toBe(1);
    await expect(header(page)).toBeInViewport();
  });

  test("on / it scrolls to the top by keyboard (Enter on the focused site name)", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    await scrollToFraction(page, 0.6);
    await siteName(page).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 }).toBe(0);
    await expect(page).toHaveURL(/\/$/);
  });

  test("with reduced motion the jump to the top is immediate (no smooth scrolling)", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoHydrated(page, "/");
    await scrollToFraction(page, 0.6);
    await siteName(page).click();
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 1000 }).toBe(0);
  });
});
