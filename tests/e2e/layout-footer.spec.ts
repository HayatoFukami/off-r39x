import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { gotoHydrated } from "../harness/browser/hydration.ts";
import {
  cartJson,
  KEYS,
  SITE_NAME,
  scenarioJson,
  seedLocalStorage,
  watchRuntimeErrors,
} from "../harness/browser/shell.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s3-layout.md sections 4.5, 7.
// SPEC-050 8.5 Global Footer / Sponsor Logo area, BR-EVT-005, 31 item 29.

const footer = (page: Page) => page.getByRole("contentinfo");
const region = (page: Page) =>
  footer(page).getByRole("region", { name: copy.layout.sponsors.regionLabel, exact: true });

/** The sponsor fetch has no observable "done" signal when the area stays hidden: let it settle. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await expect(footer(page)).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 300)));
      }),
  );
}

const sponsorScenario = (value: "published" | "none" | "fail" | "image_broken") => ({
  [KEYS.scenario]: scenarioJson({ sponsorLogos: value }),
});

test.describe("TC-PG-PUB-001-401 Global Footer content (SPEC-050 8.5)", () => {
  test("shows the event name and the five navigation links without a cart count", async ({
    page,
  }) => {
    await seedLocalStorage(page, {
      [KEYS.cart]: cartJson([{ kind: "GOODS", quantity: 2 }]),
    });
    await gotoHydrated(page, "/");
    await expect(footer(page)).toHaveCount(1);
    await expect(footer(page)).toContainText(SITE_NAME);
    const nav = footer(page).getByRole("navigation", {
      name: copy.layout.nav.footerLabel,
      exact: true,
    });
    await expect(nav).toBeVisible();
    const items = copy.layout.nav.items;
    for (const [name, href] of [
      [items.event, "/"],
      [items.entry, "/entry"],
      [items.karaoke, "/karaoke"],
      [items.goods, "/goods"],
      [items.cart, "/cart"],
    ] as const) {
      await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
    }
    await expect(nav.getByRole("link")).toHaveCount(5);
  });

  test("the footer comes after the main landmark in the DOM", async ({ page }) => {
    await gotoHydrated(page, "/");
    const order = await page.evaluate(() => {
      const main = document.querySelector("main");
      const foot = document.querySelector("footer");
      if (main === null || foot === null) return "missing";
      return main.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING
        ? "footer-after-main"
        : "footer-before-main";
    });
    expect(order).toBe("footer-after-main");
  });
});

test.describe("TC-PG-PUB-001-402 sponsors: PUBLISHED only, in display order (SPEC-050 8.5, BR-EVT-005, 31 item 29)", () => {
  test("shows Alpha, Bravo, Charlie in order with accessible names, loaded images and external links", async ({
    page,
  }) => {
    const runtime = watchRuntimeErrors(page);
    await seedLocalStorage(page, sponsorScenario("published"));
    await gotoHydrated(page, "/");
    await footer(page).scrollIntoViewIfNeeded();
    await expect(region(page)).toBeVisible();

    await expect
      .poll(() =>
        region(page)
          .locator("img")
          .evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).alt)),
      )
      .toEqual(["Sponsor Alpha", "Sponsor Bravo", "Sponsor Charlie"]);
    await expect(region(page).getByRole("listitem")).toHaveCount(3);
    await expect
      .poll(() =>
        region(page)
          .locator("img")
          .evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).naturalWidth > 0)),
      )
      .toBe(true);

    const alpha = region(page).getByRole("link", { name: /^Sponsor Alpha\s*（外部サイト）$/ });
    const charlie = region(page).getByRole("link", { name: /^Sponsor Charlie\s*（外部サイト）$/ });
    await expect(alpha).toHaveAttribute("href", "https://sponsor-alpha.example.com/");
    await expect(charlie).toHaveAttribute("href", "https://sponsor-charlie.example.com/");
    for (const link of [alpha, charlie]) {
      const rel = (await link.getAttribute("rel")) ?? "";
      expect(rel).toContain("noopener");
      expect(rel).toContain("noreferrer");
    }
    // Bravo has no link target: it is an image only, never a link.
    await expect(region(page).getByRole("link")).toHaveCount(2);
    await expect(
      region(page).getByRole("img", { name: "Sponsor Bravo", exact: true }),
    ).toBeVisible();

    // DRAFT / ARCHIVED sponsors are never rendered.
    await expect(footer(page)).not.toContainText(/\[draft\]|\[archived\]|ドラフト|アーカイブ/);
    expect(runtime.errors).toEqual([]);
  });

  test("renders in the same order on the Not Found page (footer is global)", async ({ page }) => {
    await gotoHydrated(page, "/no-such-route-for-footer");
    await footer(page).scrollIntoViewIfNeeded();
    await expect(region(page)).toBeVisible();
    await expect(region(page).getByRole("listitem")).toHaveCount(3);
  });
});

test.describe("TC-PG-PUB-001-403 sponsors: 0 items hides the area (SPEC-050 8.5, 31 item 29)", () => {
  test("renders no sponsor area and no 'none' wording", async ({ page }) => {
    await seedLocalStorage(page, sponsorScenario("none"));
    await gotoHydrated(page, "/");
    await settle(page);
    await expect(region(page)).toHaveCount(0);
    await expect(footer(page)).not.toContainText(/協賛|スポンサー|sponsor|なし|0件/i);
    await expect(footer(page).getByRole("navigation")).toBeVisible();
  });
});

test.describe("TC-PG-PUB-001-404 sponsors: fetch failure hides the area and keeps everything operable (SPEC-050 8.5, 33, 31 item 29)", () => {
  test("renders no area, no 'none'-like text, and the rest of the page stays operable", async ({
    page,
  }) => {
    await seedLocalStorage(page, sponsorScenario("fail"));
    await gotoHydrated(page, "/");
    await settle(page);
    await expect(region(page)).toHaveCount(0);
    await expect(footer(page)).not.toContainText(/協賛|スポンサー|sponsor|なし|0件|取得/i);
    await expect(page.locator("body")).not.toContainText(
      /協賛なし|スポンサーなし|協賛はありません/,
    );

    // Page content and navigation still work.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link", { name: copy.layout.cta.buyTickets, exact: true }),
    ).toBeVisible();
    await footer(page)
      .getByRole("navigation", { name: copy.layout.nav.footerLabel, exact: true })
      .getByRole("link", { name: copy.layout.nav.items.goods, exact: true })
      .click();
    await expect(page).toHaveURL(/\/goods$/);
    await page
      .getByRole("banner")
      .getByRole("link", { name: copy.layout.cta.buyTickets, exact: true })
      .click();
    await expect(page).toHaveURL(/\/entry$/);
  });
});

test.describe("TC-PG-PUB-001-405 sponsors: a broken image falls back to the display name text (SPEC-050 8.5)", () => {
  test("shows each name as text and leaves no broken image behind", async ({ page }) => {
    await seedLocalStorage(page, sponsorScenario("image_broken"));
    await gotoHydrated(page, "/");
    await footer(page).scrollIntoViewIfNeeded();
    await expect(region(page)).toBeVisible();
    for (const name of ["Sponsor Alpha", "Sponsor Bravo", "Sponsor Charlie"]) {
      await expect(region(page).getByText(name, { exact: false }).first()).toBeVisible();
    }
    await expect(region(page).locator("img")).toHaveCount(0);
    // Order is kept and the external links still carry their external indication.
    await expect(region(page).getByRole("listitem")).toHaveCount(3);
    await expect(
      region(page).getByRole("link", { name: /^Sponsor Alpha\s*（外部サイト）$/ }),
    ).toHaveAttribute("href", "https://sponsor-alpha.example.com/");
    await expect(
      region(page).getByRole("link", { name: /^Sponsor Charlie\s*（外部サイト）$/ }),
    ).toHaveAttribute("href", "https://sponsor-charlie.example.com/");
    const texts = await region(page).getByRole("listitem").allInnerTexts();
    expect(texts.map((t) => t.replace(/\s+/g, " ").trim())[0]).toMatch(/^Sponsor Alpha/);
    expect(texts.map((t) => t.replace(/\s+/g, " ").trim())[1]).toMatch(/^Sponsor Bravo/);
    expect(texts.map((t) => t.replace(/\s+/g, " ").trim())[2]).toMatch(/^Sponsor Charlie/);
  });
});
