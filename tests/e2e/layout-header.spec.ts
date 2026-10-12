import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  openPrimaryMenu,
  primaryMenuButton,
  primaryMenuPanel,
} from "../harness/browser/header-menu.ts";
import { gotoHydrated, reloadHydrated } from "../harness/browser/hydration.ts";
import {
  authenticatedSession,
  cartJson,
  isDesktop,
  KEYS,
  SITE_NAME,
  scenarioJson,
  seedLocalStorage,
  sessionJson,
} from "../harness/browser/shell.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s3-layout.md sections 4.2-4.7, 5;
// tests/contracts/s10-header-float-reveal.md section 2 (Header menu replaces the desktop nav and the mobile drawer).
// SPEC-050 8.1-8.3, 8.5, 24.1, 25, 31 item 29. Copy comes from presentation/copy/ja.ts (read inside tests only).

const header = (page: Page) => page.getByRole("banner");
const cta = (page: Page) =>
  header(page).getByRole("link", { name: copy.layout.cta.buyTickets, exact: true });
const cartLink = (page: Page, name: string = copy.layout.cart.label) =>
  header(page).getByRole("link", { name, exact: true });
const loginLink = (page: Page) =>
  header(page).getByRole("link", { name: copy.layout.account.login, exact: true });
const registerLink = (page: Page) =>
  page.getByRole("link", { name: copy.layout.account.register, exact: true });

test.describe("TC-PG-PUB-001-301 Global Header content for a guest (SPEC-050 8.2, 8.5)", () => {
  test("shows site name, CTA, Cart and Login, and no member-only controls", async ({ page }) => {
    await gotoHydrated(page, "/");
    await expect(header(page)).toBeVisible();
    await expect(header(page).getByRole("link", { name: SITE_NAME, exact: true })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(cta(page)).toBeVisible();
    await expect(cta(page)).toHaveAttribute("href", "/entry");
    await expect(cartLink(page)).toBeVisible();
    await expect(cartLink(page)).toHaveAttribute("href", "/cart");
    await expect(loginLink(page)).toBeVisible();
    await expect(loginLink(page)).toHaveAttribute("href", "/account/login");
    await expect(
      page.getByRole("link", { name: copy.layout.account.mypage, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: copy.layout.account.logout, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: copy.layout.account.menuButton, exact: true }),
    ).toHaveCount(0);
  });

  test("the primary navigation is collapsed behind the menu button on both viewports; registration stays in the desktop header", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    // No Primary Navigation link and no navigation landmark is open in the Header (SPEC-050 8.5).
    await expect(primaryMenuButton(page)).toBeVisible();
    await expect(primaryMenuButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(primaryMenuPanel(page)).toHaveCount(0);
    for (const name of [
      copy.layout.nav.items.event,
      copy.layout.nav.items.entry,
      copy.layout.nav.items.karaoke,
      copy.layout.nav.items.goods,
    ]) {
      await expect(header(page).getByRole("link", { name, exact: true })).toHaveCount(0);
    }
    if (isDesktop(page)) {
      await expect(
        header(page).getByRole("link", { name: copy.layout.account.register, exact: true }),
      ).toHaveAttribute("href", "/account/register");
    } else {
      await expect(
        header(page).getByRole("link", { name: copy.layout.account.register, exact: true }),
      ).toHaveCount(0);
    }
  });
});

test.describe("TC-PG-PUB-001-302 Global Header stays fixed while scrolling (SPEC-050 8.5)", () => {
  test("remains at the top of the viewport with the CTA and Cart reachable after scrolling", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "4000px";
      document.querySelector("main")?.appendChild(spacer);
    });
    await page.evaluate(() => window.scrollTo(0, 2500));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    const box = await header(page).boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box?.y ?? 999)).toBeLessThanOrEqual(1);
    await expect(header(page)).toBeInViewport();
    await expect(cta(page)).toBeInViewport();
    await expect(cartLink(page)).toBeInViewport();
  });
});

test.describe("TC-PG-PUB-001-303 main CTA is the same for guests and authenticated users (SPEC-050 8.5)", () => {
  test("authenticated user sees the same CTA and Mypage instead of Login", async ({ page }) => {
    await seedLocalStorage(page, { [KEYS.session]: authenticatedSession() });
    await gotoHydrated(page, "/");
    await expect(cta(page)).toBeVisible();
    await expect(cta(page)).toHaveAttribute("href", "/entry");
    await expect(cta(page)).toBeInViewport();
    const mypage = header(page).getByRole("link", {
      name: copy.layout.account.mypage,
      exact: true,
    });
    await expect(mypage).toBeVisible();
    await expect(mypage).toHaveAttribute("href", "/mypage");
    await expect(mypage).toBeInViewport();
    await expect(loginLink(page)).toHaveCount(0);
    await expect(registerLink(page)).toHaveCount(0);
    await expect(
      header(page).getByRole("button", { name: copy.layout.account.menuButton, exact: true }),
    ).toBeInViewport();
  });
});

test.describe("TC-PG-CRT-001-301 Cart link shows the total quantity in text and in the accessible name (SPEC-050 8.5)", () => {
  test("shows 3 for 3 items across lines, in text and in the name", async ({ page }) => {
    await seedLocalStorage(page, {
      [KEYS.cart]: cartJson([
        { kind: "ENTRY_TICKET", quantity: 1 },
        { kind: "GOODS", quantity: 2 },
      ]),
    });
    await gotoHydrated(page, "/");
    const link = cartLink(page, copy.layout.cart.labelWithCount(3));
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/cart");
    await expect(link).toContainText("3");
    await expect(link).toBeInViewport();
  });

  for (const [label, entries] of [
    ["an empty cart (0 items)", { [KEYS.cart]: cartJson([]) }],
    ["no cart key", {}],
    ["a corrupted cart", { [KEYS.cart]: "not-json" }],
    [
      "a cart carrying a price (strict schema violation)",
      {
        [KEYS.cart]: JSON.stringify({
          version: 1,
          lines: [
            {
              kind: "ENTRY_TICKET",
              offeringRef: "e0000000-0000-4000-8000-000000000001",
              quantity: 5,
              unitPrice: 3000,
            },
          ],
        }),
      },
    ],
  ] as const) {
    test(`shows no number for ${label}`, async ({ page }) => {
      await seedLocalStorage(page, entries);
      await gotoHydrated(page, "/");
      const link = cartLink(page);
      await expect(link).toBeVisible();
      await expect(link).not.toContainText(/\d/);
      await expect(header(page).getByRole("link", { name: /カート（\d+点）/ })).toHaveCount(0);
    });
  }

  test("follows a change made in another tab (storage event)", async ({ page, context }) => {
    await gotoHydrated(page, "/");
    await expect(cartLink(page)).toBeVisible();
    const other = await context.newPage();
    await other.goto("/");
    await other.evaluate(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [KEYS.cart, cartJson([{ kind: "GOODS", quantity: 5 }])],
    );
    await expect(cartLink(page, copy.layout.cart.labelWithCount(5))).toBeVisible();
    await other.close();
  });
});

test.describe("TC-PG-PUB-001-304 Account area follows the session (SPEC-050 8.2, 8.3, 15.6)", () => {
  test("authenticated: the Account menu discloses profile, orders, tickets, karaoke, goods and Logout", async ({
    page,
  }) => {
    await seedLocalStorage(page, { [KEYS.session]: authenticatedSession() });
    await gotoHydrated(page, "/");
    const button = page.getByRole("button", {
      name: copy.layout.account.menuButton,
      exact: true,
    });
    await expect(button).toHaveAttribute("aria-expanded", "false");
    const menu = page.getByRole("navigation", { name: copy.layout.account.menuLabel, exact: true });
    await expect(menu).toHaveCount(0);

    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(menu).toBeVisible();
    const account = copy.layout.account;
    for (const [name, href] of [
      [account.profile, "/mypage/profile"],
      [account.orders, "/mypage/orders"],
      [account.entryTickets, "/mypage/entry-tickets"],
      [account.karaoke, "/mypage/karaoke"],
      [account.goods, "/mypage/goods"],
    ] as const) {
      await expect(menu.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
    }
    await expect(menu.getByRole("button", { name: account.logout, exact: true })).toBeVisible();
    await expect(menu.getByRole("link", { name: account.logout, exact: true })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toBeFocused();
  });

  test("Logout from the Account menu ends the session, goes Home and shows Login again", async ({
    page,
  }) => {
    await seedLocalStorage(page, { [KEYS.session]: authenticatedSession() });
    await gotoHydrated(page, "/");
    await page.getByRole("button", { name: copy.layout.account.menuButton, exact: true }).click();
    await page.getByRole("button", { name: copy.layout.account.logout, exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(loginLink(page)).toBeVisible();
    await expect(
      page.getByRole("link", { name: copy.layout.account.mypage, exact: true }),
    ).toHaveCount(0);
    const stored = await page.evaluate((key) => window.localStorage.getItem(key), KEYS.session);
    const session =
      stored === null ? { kind: "guest" } : (JSON.parse(stored) as { session: unknown }).session;
    expect(session).toEqual({ kind: "guest" });
    await reloadHydrated(page);
    await expect(loginLink(page)).toBeVisible();
  });

  test("session provider unavailable falls back to the guest links (never to member links)", async ({
    page,
  }) => {
    await seedLocalStorage(page, {
      [KEYS.session]: authenticatedSession(),
      [KEYS.scenario]: scenarioJson({
        auth: {
          session: "unavailable",
          login: "ok",
          signup: "confirmation_required",
          verify: "ok",
          reset: "ok",
          resetContext: "valid",
          logout: "ok",
        },
      }),
    });
    await gotoHydrated(page, "/");
    await expect(loginLink(page)).toBeVisible();
    await expect(
      page.getByRole("link", { name: copy.layout.account.mypage, exact: true }),
    ).toHaveCount(0);
    await expect(cta(page)).toBeVisible();
  });

  test("a guest session object is shown as guest", async ({ page }) => {
    await seedLocalStorage(page, { [KEYS.session]: sessionJson() });
    await gotoHydrated(page, "/");
    await expect(loginLink(page)).toBeVisible();
  });
});

test.describe("TC-PG-PUB-001-305 keyboard order follows the DOM and starts with the skip link (SPEC-050 25)", () => {
  async function tabNames(page: Page, count: number): Promise<string[]> {
    const names: string[] = [];
    for (let i = 0; i < count; i += 1) {
      await page.keyboard.press("Tab");
      names.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          if (el === null) return "";
          const label = el.getAttribute("aria-label") ?? el.textContent ?? "";
          return label.replace(/\s+/g, " ").trim();
        }),
      );
    }
    return names;
  }

  test("tabs through skip link, site name, menu button, CTA, Cart and account links in order", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    const l = copy.layout;
    const expected = isDesktop(page)
      ? [
          l.skipLink,
          SITE_NAME,
          l.menu.button,
          l.cta.buyTickets,
          l.cart.label,
          l.account.login,
          l.account.register,
        ]
      : [l.skipLink, SITE_NAME, l.menu.button, l.cta.buyTickets, l.cart.label, l.account.login];
    expect(await tabNames(page, expected.length)).toEqual(expected);
  });

  test("the skip link targets the single main landmark and moves focus to it", async ({ page }) => {
    await gotoHydrated(page, "/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: copy.layout.skipLink, exact: true });
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAttribute("href", "#main-content");
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main-content$/);
    await expect(page.locator("main#main-content")).toHaveCount(1);
    await expect(page.locator("main#main-content")).toBeFocused();
  });
});

test.describe("TC-PG-PUB-001-306 Header menu keeps CTA, Cart and Login visible and opens the four navigation links (SPEC-050 8.5, 24.1, 25)", () => {
  test("keeps CTA, Cart and Login outside the menu and inside the viewport without horizontal scroll", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    await expect(cta(page)).toBeInViewport();
    await expect(cartLink(page)).toBeInViewport();
    await expect(loginLink(page)).toBeInViewport();
    await expect(primaryMenuButton(page)).toBeInViewport();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(primaryMenuPanel(page)).toHaveCount(0);
  });

  test("opens a labelled navigation of exactly the 4 Links (not ARIA menu items), with CTA / Cart / Login still in the Header", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    const panel = await openPrimaryMenu(page);
    for (const [name, href] of [
      [copy.layout.nav.items.event, "/"],
      [copy.layout.nav.items.entry, "/entry"],
      [copy.layout.nav.items.karaoke, "/karaoke"],
      [copy.layout.nav.items.goods, "/goods"],
    ] as const) {
      await expect(panel.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
    }
    await expect(panel.getByRole("link")).toHaveCount(4 + (isDesktop(page) ? 0 : 1));
    await expect(panel.getByRole("menuitem")).toHaveCount(0);
    await expect(page.getByRole("menu")).toHaveCount(0);
    if (isDesktop(page)) {
      await expect(
        panel.getByRole("link", { name: copy.layout.account.register, exact: true }),
      ).toHaveCount(0);
    } else {
      await expect(
        panel.getByRole("link", { name: copy.layout.account.register, exact: true }),
      ).toHaveAttribute("href", "/account/register");
    }
    await expect(panel.getByRole("link", { name: copy.layout.cta.buyTickets })).toHaveCount(0);
    await expect(panel.getByRole("link", { name: /^カート/ })).toHaveCount(0);
    await expect(panel.getByRole("link", { name: copy.layout.account.login })).toHaveCount(0);
    // They stay in the Header while the menu is open.
    await expect(cta(page)).toBeInViewport();
    await expect(cartLink(page)).toBeInViewport();
    await expect(loginLink(page)).toBeInViewport();
  });

  test("choosing a link navigates and closes the menu", async ({ page }) => {
    await gotoHydrated(page, "/");
    const panel = await openPrimaryMenu(page);
    await panel.getByRole("link", { name: copy.layout.nav.items.goods, exact: true }).click();
    await expect(page).toHaveURL(/\/goods$/);
    await expect(primaryMenuPanel(page)).toHaveCount(0);
    await expect(primaryMenuButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(cta(page)).toBeInViewport();
  });
});
