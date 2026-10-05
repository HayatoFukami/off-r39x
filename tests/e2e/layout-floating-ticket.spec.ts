import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  type Box,
  floatingTicket,
  header,
  intersects,
  openPrimaryMenu,
  scrollToFraction,
} from "../harness/browser/header-menu.ts";
import { gotoHydrated } from "../harness/browser/hydration.ts";
import {
  authenticatedSession,
  GOODS_TSHIRT,
  KEYS,
  seedLocalStorage,
} from "../harness/browser/shell.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s10-header-float-reveal.md sections 4, 5.
// SPEC-050 8.5 Floating Ticket Button, 24.1 (Mobile), 25.

// Read lazily: a missing copy key must fail the tests that need it, not the loading of this file.
const floatingLabel = (): string => copy.layout.floatingTicket.label;
const MARGIN = 64; // contract 4.2: distance from the right and bottom edges

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
}

test.describe("TC-PG-PUB-001-311 the Floating Ticket Button is shown on general pages and hidden on Entry, Cart, Account, Mypage, Purchase and dev pages (SPEC-050 8.5)", () => {
  for (const route of [
    "/",
    "/karaoke",
    "/goods",
    `/goods/${GOODS_TSHIRT}`,
    "/announcements",
    "/no-such-route-r39x",
  ]) {
    test(`shown on ${route}`, async ({ page }) => {
      await gotoHydrated(page, route);
      await settle(page);
      await expect(floatingTicket(page)).toBeVisible();
      await expect(floatingTicket(page)).toHaveCount(1);
      await expect(floatingTicket(page)).toBeInViewport();
    });
  }

  for (const route of [
    "/entry",
    "/cart",
    "/account/login",
    "/account/register",
    "/account/email-verification",
    "/account/password-reset",
    "/purchase/orders/00000000-0000-4000-8000-000000000001",
    "/dev/scenarios",
  ]) {
    test(`hidden on ${route}`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole("banner")).toBeVisible();
      await settle(page);
      await expect(floatingTicket(page)).toHaveCount(0);
      await expect(page.getByRole("link", { name: floatingLabel(), exact: true })).toHaveCount(0);
    });
  }

  for (const route of ["/mypage", "/mypage/orders", "/mypage/profile"]) {
    test(`hidden on ${route} for an authenticated user`, async ({ page }) => {
      await seedLocalStorage(page, { [KEYS.session]: authenticatedSession() });
      await page.goto(route);
      await expect(page.getByRole("banner")).toBeVisible();
      await settle(page);
      await expect(floatingTicket(page)).toHaveCount(0);
      await expect(page.getByRole("link", { name: floatingLabel(), exact: true })).toHaveCount(0);
    });
  }

  test("follows client-side navigation (layout is not remounted): hidden on /entry, back on Home", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    await expect(floatingTicket(page)).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { r39xMarker: number }).r39xMarker = 1;
    });
    const panel = await openPrimaryMenu(page);
    await panel.getByRole("link", { name: copy.layout.nav.items.entry, exact: true }).click();
    await expect(page).toHaveURL(/\/entry$/);
    await expect(floatingTicket(page)).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(floatingTicket(page)).toBeVisible();
    const marker = await page.evaluate(
      () => (window as unknown as { r39xMarker?: number }).r39xMarker,
    );
    expect(marker, "the transitions were client-side").toBe(1);
  });
});

test.describe("TC-PG-PUB-001-312 the Floating Ticket Button is a fixed bottom-right Link to /entry that follows scrolling (SPEC-050 8.5)", () => {
  test("is a Link to /entry with its own visible label, distinct from the Header CTA", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    const button = floatingTicket(page);
    await expect(button).toBeVisible();
    expect(await button.evaluate((el) => el.tagName)).toBe("A");
    await expect(button).toHaveAttribute("href", "/entry");
    await expect(button).toHaveText(floatingLabel());
    await expect(page.getByRole("link", { name: floatingLabel(), exact: true })).toHaveCount(1);
    // The Header main CTA stays, and its name does not match the floating button (strict-mode locators).
    const cta = header(page).getByRole("link", { name: copy.layout.cta.buyTickets, exact: true });
    await expect(cta).toBeVisible();
    const sameName = page.getByRole("link", { name: copy.layout.cta.buyTickets });
    expect(
      await sameName.evaluateAll(
        (els) =>
          els.filter((el) => el.getAttribute("data-testid") === "floating-ticket-button").length,
      ),
    ).toBe(0);
  });

  test("is position: fixed in the bottom-right corner, big enough, and not inside a landmark", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    const button = floatingTicket(page);
    await expect(button).toBeVisible();
    expect(await button.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
    const box = await button.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box === null || viewport === null) return;
    expect(box.x + box.width / 2).toBeGreaterThan(viewport.width / 2);
    expect(box.y + box.height / 2).toBeGreaterThan(viewport.height / 2);
    expect(viewport.width - (box.x + box.width)).toBeGreaterThanOrEqual(0);
    expect(viewport.width - (box.x + box.width)).toBeLessThanOrEqual(MARGIN);
    expect(viewport.height - (box.y + box.height)).toBeGreaterThanOrEqual(0);
    expect(viewport.height - (box.y + box.height)).toBeLessThanOrEqual(MARGIN);
    expect(box.height).toBeGreaterThanOrEqual(36);
    expect(
      await button.evaluate((el) => el.closest("header, main, footer, nav, [role='dialog']")),
    ).toBeNull();
  });

  test("keeps the same viewport position while scrolling, and a click after scrolling goes to /entry", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    const button = floatingTicket(page);
    await expect(button).toBeVisible();
    const before = await button.boundingBox();
    expect(before).not.toBeNull();
    for (const fraction of [0.3, 0.8]) {
      await scrollToFraction(page, fraction);
      await expect(button).toBeInViewport();
      const after = await button.boundingBox();
      expect(after).not.toBeNull();
      expect(Math.abs((after?.x ?? -999) - (before?.x ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((after?.y ?? -999) - (before?.y ?? 0))).toBeLessThanOrEqual(1);
    }
    await button.click();
    await expect(page).toHaveURL(/\/entry$/);
    await expect(floatingTicket(page)).toHaveCount(0);
  });

  test("comes after the Footer in DOM order and is reached by Tab right after the last Footer link", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    const order = await page.evaluate(() => {
      const button = document.querySelector("[data-testid='floating-ticket-button']");
      const footer = document.querySelector("footer");
      const main = document.querySelector("main");
      if (button === null || footer === null || main === null) return [];
      const follows = (a: Element, b: Element): boolean =>
        (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      return [follows(main, button), follows(footer, button)];
    });
    expect(order).toEqual([true, true]);

    const footerLinks = page.getByRole("contentinfo").getByRole("link");
    const last = footerLinks.last();
    await last.focus();
    await page.keyboard.press("Tab");
    await expect(floatingTicket(page)).toBeFocused();
  });
});

test.describe("TC-PG-PUB-001-313 at the end of the page the Floating Ticket Button covers neither the Footer, the Sponsor Logos nor any control, and does not meet the mock badge (SPEC-050 8.5)", () => {
  test("no Footer element or operable element intersects the button when scrolled to the bottom", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    await settle(page);
    await expect(floatingTicket(page)).toBeVisible();
    // The sponsor area is part of the default scenario; make sure it rendered before measuring.
    await expect(
      page
        .getByRole("contentinfo")
        .getByRole("region", { name: copy.layout.sponsors.regionLabel, exact: true }),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            Math.ceil(window.scrollY + window.innerHeight) >=
            document.documentElement.scrollHeight - 1,
        ),
      )
      .toBe(true);

    const button = await floatingTicket(page).boundingBox();
    expect(button).not.toBeNull();
    if (button === null) return;

    const rects = await page.evaluate(() => {
      const own = document.querySelector("[data-testid='floating-ticket-button']");
      const visible = (el: Element): DOMRect | null => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") return null;
        return rect;
      };
      const out: { what: string; x: number; y: number; width: number; height: number }[] = [];
      const push = (what: string, el: Element): void => {
        if (own !== null && (el === own || own.contains(el))) return;
        const rect = visible(el);
        if (rect === null) return;
        out.push({ what, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      };
      for (const el of Array.from(document.querySelectorAll("footer *"))) {
        if (el.children.length === 0) push(`footer ${el.tagName.toLowerCase()}`, el);
      }
      for (const el of Array.from(
        document.querySelectorAll("a[href], button, input, select, textarea"),
      )) {
        push(`control ${el.tagName.toLowerCase()}`, el);
      }
      return out;
    });
    expect(rects.length).toBeGreaterThan(5);
    const overlapped = rects.filter((r) => intersects(button, r)).map((r) => r.what);
    expect(overlapped, "elements covered by the Floating Ticket Button").toEqual([]);
  });

  test("the mock badge sits at the bottom left and never meets the button", async ({ page }) => {
    await gotoHydrated(page, "/");
    const badge = page.getByText(copy.layout.mockBadge, { exact: true });
    await expect(badge).toBeVisible();
    await expect(floatingTicket(page)).toBeVisible();
    const b = await badge.boundingBox();
    const f = await floatingTicket(page).boundingBox();
    expect(b).not.toBeNull();
    expect(f).not.toBeNull();
    if (b === null || f === null) return;
    expect(intersects(b as Box, f as Box)).toBe(false);
    expect(b.x + b.width).toBeLessThan(f.x);
  });
});

test.describe("TC-PG-PUB-001-314 the viewport meta enables safe-area insets for the fixed button (SPEC-050 8.5 Mobile safe area)", () => {
  test("has viewport-fit=cover and keeps width=device-width and initial-scale=1", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    const content = await page.locator("meta[name='viewport']").getAttribute("content");
    expect(content).not.toBeNull();
    expect(content).toMatch(/viewport-fit=cover/);
    expect(content).toMatch(/width=device-width/);
    expect(content).toMatch(/initial-scale=1/);
  });
});
