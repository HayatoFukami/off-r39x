import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  addButton,
  cartEntries,
  entryLine,
  expectedGoodsDetail,
  goodsLine,
  mainOf,
  offeringName,
  quantityInput,
  removeButton,
  resetStorage,
  rowByHeading,
} from "../harness/browser/cart.ts";
import { gotoHydrated } from "../harness/browser/hydration.ts";
import {
  fixClock,
  hasLevelSkip,
  horizontalOverflow,
  mainHeadingLevels,
  publicScenario,
} from "../harness/browser/public.ts";
import {
  allHrefs,
  FORBIDDEN_AREA,
  KEYS,
  ORIGIN_HOST,
  pathOf,
  SITE_NAME,
  scenarioJson,
  seedLocalStorage,
  watchRequestHosts,
  watchRuntimeErrors,
} from "../harness/browser/shell.ts";
import { GOODS, OFFERING } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s5-cart.md section 6.
// Cross-page checks for PG-TKT-001, PG-GDS-002 and PG-CRT-001: SPEC-050 24.1, 24.3, 25, 27, 31 item 23,
// SEC-WEB-004 / 009 / 012, DEV-WEB-001.

const main = mainOf;
const CART_LINES = [entryLine(OFFERING.regular, 2), goodsLine(GOODS.tshirt, 1)];

type PageCase = {
  readonly name: string;
  readonly route: string;
  readonly entries: () => Record<string, string>;
  readonly title: () => string;
  readonly ready: (page: Page) => Promise<void>;
};

const PAGES: readonly PageCase[] = [
  {
    name: "PG-TKT-001 Entry Ticket Sales",
    route: "/entry",
    entries: () => ({}),
    title: () => `${copy.entry.pageTitle} | ${SITE_NAME}`,
    ready: async (page) => {
      await expect(main(page).getByRole("listitem")).toHaveCount(6);
    },
  },
  {
    name: "PG-GDS-002 Goods Detail",
    route: `/goods/${GOODS.tshirt}`,
    entries: () => ({}),
    title: () => `${copy.goods.detail.pageTitle} | ${SITE_NAME}`,
    ready: async (page) => {
      await expect(main(page).getByRole("heading", { level: 1 })).toHaveText(
        expectedGoodsDetail(GOODS.tshirt).name,
      );
    },
  },
  {
    name: "PG-CRT-001 Cart (lines)",
    route: "/cart",
    entries: () => cartEntries(CART_LINES),
    title: () => `${copy.cart.pageTitle} | ${SITE_NAME}`,
    ready: async (page) => {
      await expect(main(page).getByRole("listitem")).toHaveCount(2);
    },
  },
  {
    name: "PG-CRT-001 Cart (empty)",
    route: "/cart",
    entries: () => ({}),
    title: () => `${copy.cart.pageTitle} | ${SITE_NAME}`,
    ready: async (page) => {
      await expect(main(page)).toContainText(copy.cart.empty);
    },
  },
];

async function load(page: Page, item: PageCase, extra: Record<string, string> = {}): Promise<void> {
  await fixClock(page);
  await seedLocalStorage(page, { ...item.entries(), ...extra });
  await gotoHydrated(page, item.route);
}

test.describe("TC-PG-CRT-001-531 every S5 page has a metadata title and one logical heading hierarchy with the shell landmarks (SPEC-050 7, 25)", () => {
  for (const item of PAGES) {
    test(`${item.name}: title, one h1, no skipped level, banner / main / contentinfo`, async ({
      page,
    }) => {
      await load(page, item);
      await item.ready(page);
      await expect(page).toHaveTitle(item.title());
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const levels = await mainHeadingLevels(page);
      expect(levels[0]).toBe(1);
      expect(hasLevelSkip(levels), `heading levels ${levels.join(",")}`).toBe(false);
      await expect(page.getByRole("banner").getByRole("heading")).toHaveCount(0);
      await expect(page.getByRole("contentinfo").getByRole("heading")).toHaveCount(0);
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toHaveCount(1);
      await expect(page.locator("nav:not([aria-label]):not([aria-labelledby])")).toHaveCount(0);
    });
  }
});

test.describe("TC-PG-CRT-001-532 no S5 page links to /admin, /staff or /dev (SPEC-050 27, 31 item 23, DEV-WEB-012)", () => {
  for (const item of PAGES) {
    test(`${item.name}`, async ({ page }) => {
      await load(page, item);
      await item.ready(page);
      const hrefs = await allHrefs(page);
      expect(hrefs.length).toBeGreaterThan(8);
      for (const href of hrefs) {
        expect(FORBIDDEN_AREA.test(pathOf(href)), href).toBe(false);
        expect(new URL(href).pathname, href).not.toMatch(/^\/dev(\/|$)/);
      }
    });
  }
});

test.describe("TC-PG-CRT-001-533 the S5 pages run without runtime or hydration errors and talk only to the app origin (SEC-WEB-004, DEV-WEB-001)", () => {
  for (const item of PAGES) {
    test(`${item.name}`, async ({ page }) => {
      const runtime = watchRuntimeErrors(page);
      const seen = watchRequestHosts(page);
      await load(page, item);
      await item.ready(page);
      await page.waitForLoadState("networkidle");
      expect(runtime.errors).toEqual([]);
      expect([...seen.hosts]).toEqual([ORIGIN_HOST]);
    });
  }

  test("interactions (add, quantity change, delete, reset) raise no runtime error", async ({
    page,
  }) => {
    const runtime = watchRuntimeErrors(page);
    await fixClock(page);
    await seedLocalStorage(page, {});
    await gotoHydrated(page, "/entry");
    const regular = rowByHeading(page, offeringName(OFFERING.regular));
    await quantityInput(regular).fill("0");
    await quantityInput(regular).fill("2");
    await addButton(regular).click();
    await gotoHydrated(page, `/goods/${GOODS.towel}`);
    await addButton(main(page)).click();
    await gotoHydrated(page, "/cart");
    await expect(main(page).getByRole("listitem")).toHaveCount(2);
    await quantityInput(main(page).getByRole("listitem").nth(0)).fill("3");
    await removeButton(main(page).getByRole("listitem").nth(1)).click();
    await expect(main(page).getByRole("listitem")).toHaveCount(1);
    await page.waitForLoadState("networkidle");
    expect(runtime.errors).toEqual([]);
  });

  test("the failure, empty, partial and damaged states also load without runtime errors", async ({
    page,
  }) => {
    const runtime = watchRuntimeErrors(page);
    const variants: Record<string, string>[] = [
      publicScenario({ publicFetch: "fail" }),
      publicScenario({ publicFetch: "empty" }),
      { [KEYS.scenario]: scenarioJson({ cart: { state: "partial", purchaseStart: "ok" } }) },
      { [KEYS.scenario]: scenarioJson({ cart: { state: "fail", purchaseStart: "ok" } }) },
      { [KEYS.cart]: "not-json" },
    ];
    await fixClock(page);
    await gotoHydrated(page, "/");
    for (const extra of variants) {
      for (const item of PAGES) {
        await resetStorage(page, { ...item.entries(), ...extra });
        await gotoHydrated(page, item.route);
        await expect(page.getByRole("banner")).toBeVisible();
        await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible();
        await expect(main(page)).not.toContainText(copy.notFound.description);
        await page.waitForLoadState("networkidle");
      }
    }
    expect(runtime.errors).toEqual([]);
  });
});

test.describe("TC-PG-CRT-001-534 no horizontal scroll at 390px and the primary actions stay usable (SPEC-050 24.1)", () => {
  for (const item of PAGES) {
    test(`${item.name}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await load(page, item);
      await item.ready(page);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test("the Entry add controls and the Cart delete and quantity controls are inside the 390px viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fixClock(page);
    await seedLocalStorage(page, cartEntries(CART_LINES));
    await gotoHydrated(page, "/entry");
    const regular = rowByHeading(page, offeringName(OFFERING.regular));
    await expect(addButton(regular)).toBeVisible();
    await addButton(regular).scrollIntoViewIfNeeded();
    await expect(addButton(regular)).toBeInViewport();
    await expect(quantityInput(regular)).toBeInViewport();
    await gotoHydrated(page, "/cart");
    const first = main(page).getByRole("listitem").nth(0);
    await expect(first).toBeVisible();
    await expect(quantityInput(first)).toBeInViewport();
    await expect(removeButton(first)).toBeInViewport();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("TC-SEC-WEB-009-602 the static S5 routes are not served as private / no-store (informational; SEC-WEB-009 covers protected routes)", () => {
  for (const route of ["/entry", "/cart"]) {
    test(`${route} has no private / no-store Cache-Control`, async ({ page }) => {
      const response = await gotoHydrated(page, route);
      expect(response?.status()).toBe(200);
      const cacheControl = (response?.headers()["cache-control"] ?? "").toLowerCase();
      expect(cacheControl).not.toContain("private");
      expect(cacheControl).not.toContain("no-store");
    });
  }
});

test.describe("TC-PG-CRT-001-535 the S5 pages never call the purchase API or write business state (FR-CRT-001, BR-ORD-020)", () => {
  test("a full Cart session leaves the mock database byte-identical", async ({ page }) => {
    await fixClock(page);
    await seedLocalStorage(page, {});
    await gotoHydrated(page, "/entry");
    await expect(main(page).getByRole("listitem")).toHaveCount(6);
    const dbBefore = await page.evaluate((key) => window.localStorage.getItem(key), KEYS.db);
    expect(dbBefore).not.toBeNull();
    const regular = rowByHeading(page, offeringName(OFFERING.regular));
    await addButton(regular).click();
    await gotoHydrated(page, `/goods/${GOODS.towel}`);
    await addButton(main(page)).click();
    await gotoHydrated(page, "/cart");
    await expect(main(page).getByRole("listitem")).toHaveCount(2);
    await quantityInput(main(page).getByRole("listitem").nth(0)).fill("4");
    await removeButton(main(page).getByRole("listitem").nth(1)).click();
    await expect(main(page).getByRole("listitem")).toHaveCount(1);
    const dbAfter = await page.evaluate((key) => window.localStorage.getItem(key), KEYS.db);
    expect(dbAfter).toBe(dbBefore);
  });
});
