import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  dbJson,
  expectedGoods,
  fixClock,
  hasLevelSkip,
  horizontalOverflow,
  mainHeadingLevels,
  publicScenario,
} from "../harness/browser/public.ts";
import {
  allHrefs,
  FORBIDDEN_AREA,
  ORIGIN_HOST,
  pathOf,
  SITE_NAME,
  seedLocalStorage,
  watchRequestHosts,
  watchRuntimeErrors,
} from "../harness/browser/shell.ts";
import { ANNOUNCEMENT, D1, GOODS } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s4-public.md sections 3, 4.
// Cross-page checks for PG-PUB-001..003, PG-KRK-001..002 and PG-GDS-001: SPEC-050 24.1, 24.3, 25, 27,
// 31 items 1 and 23, SEC-WEB-004 / 009 / 017〜020.

const main = (page: Page) => page.getByRole("main");

type PageCase = {
  readonly name: string;
  readonly route: string;
  readonly title: () => string;
  /** A locator-ready check that the page content (not the loading state) is on screen. */
  readonly ready: (page: Page) => Promise<void>;
};

const PAGES: readonly PageCase[] = [
  {
    name: "PG-PUB-001 Event Home",
    route: "/",
    title: () => SITE_NAME,
    ready: async (page) => {
      await expect(
        main(page).getByRole("region", { name: copy.home.sections.faq, exact: true }),
      ).toBeVisible();
    },
  },
  {
    name: "PG-PUB-002 Announcement List",
    route: "/announcements",
    title: () => `${copy.pageTitle.announcements} | ${SITE_NAME}`,
    ready: async (page) => {
      await expect(main(page).getByRole("listitem")).toHaveCount(3);
    },
  },
  {
    name: "PG-PUB-003 Announcement Detail",
    route: `/announcements/${ANNOUNCEMENT.latest}`,
    title: () => `${copy.pageTitle.announcementDetail} | ${SITE_NAME}`,
    ready: async (page) => {
      await expect(
        main(page).getByRole("link", { name: copy.announcements.backToList, exact: true }),
      ).toBeVisible();
    },
  },
  {
    name: "PG-KRK-001 Karaoke Sales Guide",
    route: "/karaoke",
    title: () => `${copy.pageTitle.karaoke} | ${SITE_NAME}`,
    ready: async (page) => {
      await expect(main(page).locator("a[href^='/karaoke/schedule/']")).toHaveCount(2);
    },
  },
  {
    name: "PG-KRK-002 Karaoke Day Schedule",
    route: `/karaoke/schedule/${D1}`,
    title: () => `${copy.pageTitle.karaokeDay} | ${SITE_NAME}`,
    ready: async (page) => {
      await expect(main(page).getByRole("heading", { level: 3 }).first()).toBeVisible();
    },
  },
  {
    name: "PG-GDS-001 Goods List",
    route: "/goods",
    title: () => `${copy.pageTitle.goods} | ${SITE_NAME}`,
    ready: async (page) => {
      await expect(main(page).getByRole("listitem")).toHaveCount(6);
    },
  },
];

async function load(
  page: Page,
  route: string,
  entries: Record<string, string> = {},
): Promise<void> {
  await fixClock(page);
  await seedLocalStorage(page, entries);
  await page.goto(route);
}

test.describe("TC-PG-PUB-001-691 every public page has a metadata title (SPEC-050 7, 25)", () => {
  for (const item of PAGES) {
    test(`${item.name} has its title`, async ({ page }) => {
      await load(page, item.route);
      await expect(page).toHaveTitle(item.title());
    });
  }
});

test.describe("TC-PG-PUB-001-692 headings form one logical hierarchy and the shell keeps its landmarks (SPEC-050 25)", () => {
  for (const item of PAGES) {
    test(`${item.name}: one h1, no skipped level, one banner / main / contentinfo`, async ({
      page,
    }) => {
      await load(page, item.route);
      await item.ready(page);
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
      await expect(page.locator("main main")).toHaveCount(0);
    });
  }
});

test.describe("TC-PG-PUB-001-693 no page links to /admin, /staff or /dev (SPEC-050 27, 31 item 23, DEV-WEB-012)", () => {
  for (const item of PAGES) {
    test(`${item.name}`, async ({ page }) => {
      await load(page, item.route);
      await item.ready(page);
      const hrefs = await allHrefs(page);
      expect(hrefs.length).toBeGreaterThan(8);
      for (const href of hrefs) {
        const url = new URL(href);
        expect(FORBIDDEN_AREA.test(pathOf(href)), href).toBe(false);
        expect(url.pathname, href).not.toMatch(/^\/dev(\/|$)/);
      }
    });
  }
});

test.describe("TC-PG-PUB-001-694 pages load without runtime or hydration errors and talk only to the app origin (SEC-WEB-004)", () => {
  for (const item of PAGES) {
    test(`${item.name}`, async ({ page }) => {
      const runtime = watchRuntimeErrors(page);
      const seen = watchRequestHosts(page);
      await load(page, item.route);
      await item.ready(page);
      await page.waitForLoadState("networkidle");
      expect(runtime.errors).toEqual([]);
      expect([...seen.hosts]).toEqual([ORIGIN_HOST]);
    });
  }

  test("the failure and empty states also load without runtime errors", async ({ page }) => {
    const runtime = watchRuntimeErrors(page);
    for (const publicFetch of ["fail", "empty"] as const) {
      for (const item of PAGES) {
        await load(page, item.route, publicScenario({ publicFetch }));
        await expect(page.getByRole("banner")).toBeVisible();
        await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible();
        // The page itself is implemented (not an unmatched route) in every scenario.
        await expect(main(page)).not.toContainText(copy.notFound.description);
        await page.waitForLoadState("networkidle");
      }
    }
    expect(runtime.errors).toEqual([]);
  });
});

test.describe("TC-PG-PUB-001-695 no horizontal scroll at 390px and the primary actions stay on screen (SPEC-050 24.1)", () => {
  for (const item of PAGES) {
    test(`${item.name}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await load(page, item.route);
      await item.ready(page);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      // Content that must not be dropped on a narrow screen stays visible (SPEC-050 24.1).
      await expect(
        page.getByRole("link", { name: copy.layout.cta.buyTickets, exact: true }).first(),
      ).toBeInViewport();
      await expect(
        page.getByRole("link", { name: copy.layout.cart.label }).first(),
      ).toBeInViewport();
    });
  }

  test("the day schedule keeps every bucket count and slot time readable at 390px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await load(page, `/karaoke/schedule/${D1}`);
    await expect(main(page).getByRole("region", { name: "10:00-11:00" })).toBeVisible();
    await expect(main(page)).toContainText(copy.karaoke.day.bucketCount(1, 3));
    await expect(main(page)).toContainText("10:20-10:35");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("TC-SEC-WEB-009-601 public pages are not served as private / no-store (SEC-WEB-009 applies to protected routes only)", () => {
  for (const route of ["/", "/announcements", "/karaoke", "/goods"]) {
    test(`${route} has no private / no-store Cache-Control`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      const cacheControl = (response?.headers()["cache-control"] ?? "").toLowerCase();
      expect(cacheControl).not.toContain("private");
      expect(cacheControl).not.toContain("no-store");
    });
  }
});

test.describe("TC-SEC-WEB-017-601 public content is shown as plain text, never as HTML (SEC-WEB-016〜020, SPEC-050 11.1, 11.3)", () => {
  const PAYLOAD = {
    img: '<img src="x-xss" onerror="window.__xss = 1">',
    bold: "<b>bold-marker</b>",
    anchor: "[markdown link](https://evil.example/md)",
    bare: "https://auto-link.example/path",
    script: "<script>window.__xss = 2</script>",
  } as const;
  const multiline = (label: string): string =>
    `${label} first line\n${PAYLOAD.img}\n${PAYLOAD.bold} ${PAYLOAD.anchor}\n${PAYLOAD.bare}\n${PAYLOAD.script}`;

  const seeded = () =>
    dbJson((state) => {
      state.event.overview = multiline("overview");
      state.event.venueGuide = multiline("guide");
      state.event.accessInfo = multiline("access");
      state.event.notices = [multiline("notice")];
      const faq = state.faqs.find((f) => f.publication === "PUBLISHED");
      if (faq !== undefined) {
        faq.question = multiline("question");
        faq.answer = multiline("answer");
      }
      const news = state.announcements.find((a) => a.ref === ANNOUNCEMENT.latest);
      if (news !== undefined) {
        news.title = `title ${PAYLOAD.bold}`;
        news.body = multiline("body");
      }
    });

  async function assertPlain(page: Page, markers: readonly string[]): Promise<void> {
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    const root = main(page);
    await expect(root.locator("img[src*='x-xss']")).toHaveCount(0);
    await expect(root.locator("b")).toHaveCount(0);
    await expect(root.locator("script")).toHaveCount(0);
    await expect(root.locator("a[href*='evil.example'], a[href*='auto-link.example']")).toHaveCount(
      0,
    );
    for (const marker of markers) await expect(root).toContainText(marker);
    const text = await root.innerText();
    expect(text).toContain(PAYLOAD.img);
    expect(text).toContain(PAYLOAD.bold);
    expect(text).toContain(PAYLOAD.anchor);
    expect(text).toContain(PAYLOAD.bare);
    expect(text).toContain("<script>window.__xss = 2</script>");
    expect(
      await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
    ).toBeUndefined();
    expect(dialogs).toEqual([]);
  }

  test("Event Home: overview, venue guide, access, notices and FAQ keep markup as literal text with line breaks", async ({
    page,
  }) => {
    await load(page, "/", seeded());
    const faq = main(page).getByRole("region", { name: copy.home.sections.faq, exact: true });
    await expect(faq).toBeVisible();
    await assertPlain(page, [
      "overview first line",
      "guide first line",
      "access first line",
      "notice first line",
      "question first line",
      "answer first line",
    ]);
    // Line breaks come from CSS white-space, not from inserted <br> or HTML strings.
    const overview = main(page).getByText("overview first line");
    expect(await overview.evaluate((el) => getComputedStyle(el).whiteSpace)).toMatch(
      /pre-line|pre-wrap/,
    );
    expect(await overview.evaluate((el) => (el as HTMLElement).innerText)).toContain("\n");
    await expect(main(page).locator("br")).toHaveCount(0);
  });

  test("Announcement detail: the body keeps markup and Markdown as literal text", async ({
    page,
  }) => {
    await load(page, `/announcements/${ANNOUNCEMENT.latest}`, seeded());
    await expect(main(page).getByText("body first line")).toBeVisible();
    await assertPlain(page, ["body first line", `title ${PAYLOAD.bold}`]);
    await expect(main(page).locator("br")).toHaveCount(0);
  });

  test("Announcement list: titles and excerpts are text too", async ({ page }) => {
    await load(page, "/announcements", seeded());
    await expect(main(page).getByRole("listitem")).toHaveCount(3);
    await expect(main(page).locator("img[src*='x-xss'], script, b")).toHaveCount(0);
    await expect(main(page)).toContainText(`title ${PAYLOAD.bold}`);
  });
});

test.describe("TC-PG-PUB-001-696 public pages show server-owned values only and invent no amounts or counts (SPEC-050 26.4, 33, DEV-WEB-009)", () => {
  test("the Goods and Karaoke prices come from the port (changing the stored price changes the page)", async ({
    page,
  }) => {
    const goods = expectedGoods();
    const tshirt = goods.find((g) => g.goodsRef === GOODS.tshirt);
    expect(tshirt?.unitPrice.amount).toBe("4000");
    await load(
      page,
      "/goods",
      dbJson((state) => {
        const target = state.goods.find((g) => g.ref === GOODS.tshirt);
        if (target !== undefined) target.unitPrice = { amount: "4321", currency: "JPY" };
      }),
    );
    await expect(main(page).getByRole("listitem")).toHaveCount(6);
    await expect(main(page)).toContainText("¥4,321");
    await expect(main(page)).not.toContainText("¥4,000");
  });
});
