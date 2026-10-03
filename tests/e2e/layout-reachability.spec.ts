import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  allHrefs,
  authenticatedSession,
  FORBIDDEN_AREA,
  isDesktop,
  KEYS,
  ORIGIN_HOST,
  pathOf,
  SITE_NAME,
  seedLocalStorage,
  watchRequestHosts,
  watchRuntimeErrors,
} from "../harness/browser/shell.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s3-layout.md sections 4, 8.3, 10.
// SPEC-050 31 items 23 and 29, 8.5, 25, 27; SEC-WEB-004.

const ROUTES = {
  home: "/",
  dev: "/dev/scenarios",
  notFound: "/no-such-route-r39x",
  error: "/dev/error-probe",
} as const;
const ALL_ROUTES = Object.values(ROUTES);

const header = (page: Page) => page.getByRole("banner");
const cta = (page: Page) =>
  header(page).getByRole("link", { name: copy.layout.cta.buyTickets, exact: true });
const cart = (page: Page) =>
  header(page).getByRole("link", { name: copy.layout.cart.label, exact: true });

async function loaded(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await expect(header(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
}

test.describe("TC-PG-PUB-001-501 no link to /admin or /staff on any page, footer or drawer (SPEC-050 31 item 23, 27)", () => {
  for (const authenticated of [false, true]) {
    for (const route of ALL_ROUTES) {
      test(`${authenticated ? "authenticated" : "guest"} ${route}`, async ({ page }) => {
        if (authenticated) await seedLocalStorage(page, { [KEYS.session]: authenticatedSession() });
        await loaded(page, route);
        if (authenticated) {
          await expect(
            header(page).getByRole("button", { name: copy.layout.account.menuButton, exact: true }),
          ).toBeVisible();
        }

        const collect = async (): Promise<string[]> => allHrefs(page);
        let hrefs = await collect();
        expect(hrefs.length).toBeGreaterThan(5);

        if (!isDesktop(page)) {
          await header(page)
            .getByRole("button", { name: copy.layout.drawer.open, exact: true })
            .click();
          await expect(
            page.getByRole("dialog", { name: copy.layout.drawer.title, exact: true }),
          ).toBeVisible();
          hrefs = hrefs.concat(await collect());
          await page.keyboard.press("Escape");
        }
        if (authenticated) {
          await header(page)
            .getByRole("button", { name: copy.layout.account.menuButton, exact: true })
            .click();
          await expect(
            page.getByRole("navigation", { name: copy.layout.account.menuLabel, exact: true }),
          ).toBeVisible();
          hrefs = hrefs.concat(await collect());
        }

        for (const href of hrefs) {
          const url = new URL(href);
          expect(FORBIDDEN_AREA.test(pathOf(href)), href).toBe(false);
          expect(url.pathname.toLowerCase(), href).not.toMatch(/\/(admin|staff)(\/|$)/);
        }
        // The dev area is never linked from general navigation (DEV-WEB-012).
        if (route !== ROUTES.dev) {
          for (const href of hrefs) {
            expect(pathOf(href).startsWith("/dev"), href).toBe(false);
          }
        }
      });
    }
  }
});

test.describe("TC-PG-PUB-001-502 the main CTA and Cart are reachable from every route (SPEC-050 31 item 29, 8.5)", () => {
  for (const route of ALL_ROUTES) {
    test(`${route} shows the CTA and Cart in the viewport`, async ({ page }) => {
      await loaded(page, route);
      await expect(cta(page)).toBeVisible();
      await expect(cta(page)).toBeInViewport();
      await expect(cta(page)).toHaveAttribute("href", "/entry");
      await expect(cart(page)).toBeVisible();
      await expect(cart(page)).toBeInViewport();
      await expect(cart(page)).toHaveAttribute("href", "/cart");
      await expect(
        header(page).getByRole("link", { name: SITE_NAME, exact: true }),
      ).toHaveAttribute("href", "/");
    });
  }

  test("the CTA and Cart navigate from a dev route", async ({ page }) => {
    await loaded(page, ROUTES.dev);
    await cta(page).click();
    await expect(page).toHaveURL(/\/entry$/);
    await cart(page).click();
    await expect(page).toHaveURL(/\/cart$/);
    await header(page).getByRole("link", { name: SITE_NAME, exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("TC-PG-PUB-001-503 headings and landmarks (SPEC-050 25)", () => {
  for (const route of ALL_ROUTES) {
    test(`${route} has one h1 and one banner / main / contentinfo`, async ({ page }) => {
      await loaded(page, route);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(header(page).getByRole("heading")).toHaveCount(0);
      await expect(page.getByRole("contentinfo").getByRole("heading", { level: 1 })).toHaveCount(0);
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.locator("main#main-content")).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toHaveCount(1);
      // Every navigation landmark is named so that screen reader users can tell them apart.
      await expect(page.locator("nav:not([aria-label]):not([aria-labelledby])")).toHaveCount(0);
      await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    });
  }
});

test.describe("TC-SEC-WEB-004-101 no external font or third-party origin is requested (SEC-WEB-004)", () => {
  for (const route of [ROUTES.home, ROUTES.dev, ROUTES.notFound]) {
    test(`${route} requests only the app origin`, async ({ page }) => {
      const seen = watchRequestHosts(page);
      await loaded(page, route);
      await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
      await page.waitForLoadState("networkidle");
      expect([...seen.hosts]).toEqual([ORIGIN_HOST]);
    });
  }
});

test.describe("TC-PG-PUB-001-504 pages load without runtime or hydration errors", () => {
  for (const route of [ROUTES.home, ROUTES.dev, ROUTES.notFound]) {
    test(`${route} has no pageerror or console.error`, async ({ page }) => {
      const runtime = watchRuntimeErrors(page);
      await seedLocalStorage(page, { [KEYS.session]: authenticatedSession() });
      await loaded(page, route);
      expect(runtime.errors).toEqual([]);
    });
  }
});

test.describe("TC-DEV-WEB-012-201 MockModeBadge is a small label shown in mock mode and not part of navigation (DEV-WEB-012, design section 8)", () => {
  test("shows one fixed label at the bottom right, outside every landmark and not interactive", async ({
    page,
  }) => {
    await loaded(page, ROUTES.home);
    const badge = page.getByText(copy.layout.mockBadge, { exact: true });
    await expect(badge).toHaveCount(1);
    await expect(badge).toBeVisible();
    await expect(badge).toBeInViewport();

    const box = await badge.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box !== null && viewport !== null) {
      expect(box.x + box.width / 2).toBeGreaterThan(viewport.width / 2);
      expect(box.y + box.height / 2).toBeGreaterThan(viewport.height / 2);
    }
    expect(await badge.evaluate((el) => getComputedStyle(el).position)).toMatch(/fixed|sticky/);
    // Not inside a landmark / navigation, not a link or a button.
    expect(
      await badge.evaluate(
        (el) => el.closest("nav, header, footer, main, [role='dialog']") !== null,
      ),
    ).toBe(false);
    await expect(page.getByRole("link", { name: copy.layout.mockBadge })).toHaveCount(0);
    await expect(page.getByRole("button", { name: copy.layout.mockBadge })).toHaveCount(0);
    await expect(page.locator("nav").getByText(copy.layout.mockBadge)).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("appears on every route including dev and system pages", async ({ page }) => {
    for (const route of ALL_ROUTES) {
      await loaded(page, route);
      await expect(page.getByText(copy.layout.mockBadge, { exact: true })).toHaveCount(1);
    }
  });
});
