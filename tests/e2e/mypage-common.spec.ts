import { expect, type Locator, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { watchConsole } from "../harness/browser/auth.ts";
import { readDbRaw } from "../harness/browser/cart.ts";
import {
  DEMO_NAME,
  expectNoMatrixSeed,
  figureOf,
  goodsItemPath,
  orderPath,
  PATH,
  qrImages,
  region,
  reservationPath,
  reservationQrPath,
  rowsIn,
  ticketPath,
  ticketQrPath,
} from "../harness/browser/mypage.ts";
import { hasLevelSkip, horizontalOverflow, mainHeadingLevels } from "../harness/browser/public.ts";
import { heading1, mainOf, openAs } from "../harness/browser/purchase.ts";
import {
  allHrefs,
  FORBIDDEN_AREA,
  pathOf,
  SITE_NAME,
  watchRequestHosts,
  watchRuntimeErrors,
} from "../harness/browser/shell.ts";
import { GOODS_ITEM, ORDER, RESERVATION, TICKET } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s8-mypage.md sections 6 and 7.
// SPEC-050 5.3, 22, 24, 25, 27, 31 item 23, SPEC-140 SEC-WEB-004 / SEC-WEB-009 (G5 header check at the UI mock level),
// SEC-QR-012 / 013. Expected DB postconditions are the mock DB.

type PageCase = {
  id: string;
  path: string;
  title: () => string;
  heading: () => string;
  ready: (page: Page) => Locator;
};

const m = () => copy.mypage;
const PAGES: PageCase[] = [
  {
    id: "PG-MYP-001",
    path: PATH.overview,
    title: () => m().pageTitle,
    heading: () => m().heading,
    ready: (p) => region(p, m().overview.profileHeading).getByText(DEMO_NAME),
  },
  {
    id: "PG-MYP-002",
    path: PATH.profile,
    title: () => m().profile.pageTitle,
    heading: () => m().profile.heading,
    ready: (p) => mainOf(p).getByLabel(m().profile.displayNameLabel, { exact: true }),
  },
  {
    id: "PG-MYP-003",
    path: PATH.orders,
    title: () => m().orders.pageTitle,
    heading: () => m().orders.heading,
    ready: (p) => rowsIn(mainOf(p)).first(),
  },
  {
    id: "PG-MYP-004",
    path: orderPath(ORDER.confirmedComposite),
    title: () => m().orders.detail.pageTitle,
    heading: () => m().orders.detail.heading,
    ready: (p) => region(p, copy.purchase.outcomeHeading),
  },
  {
    id: "PG-MYP-005",
    path: PATH.entryTickets,
    title: () => m().entryTickets.pageTitle,
    heading: () => m().entryTickets.heading,
    ready: (p) => rowsIn(mainOf(p)).first(),
  },
  {
    id: "PG-MYP-006",
    path: ticketPath(TICKET.valid),
    title: () => m().entryTickets.detail.pageTitle,
    heading: () => m().entryTickets.detail.heading,
    ready: (p) => region(p, m().entryTickets.detail.infoHeading),
  },
  {
    id: "PG-MYP-007",
    path: ticketQrPath(TICKET.valid),
    title: () => copy.qr.ENTRY,
    heading: () => copy.qr.ENTRY,
    ready: (p) => figureOf(p),
  },
  {
    id: "PG-MYP-008",
    path: PATH.reservations,
    title: () => m().reservations.pageTitle,
    heading: () => m().reservations.heading,
    ready: (p) => rowsIn(mainOf(p)).first(),
  },
  {
    id: "PG-MYP-009",
    path: reservationPath(RESERVATION.valid),
    title: () => m().reservations.detail.pageTitle,
    heading: () => m().reservations.detail.heading,
    ready: (p) => region(p, m().reservations.detail.infoHeading),
  },
  {
    id: "PG-MYP-010",
    path: reservationQrPath(RESERVATION.valid),
    title: () => copy.qr.KARAOKE,
    heading: () => copy.qr.KARAOKE,
    ready: (p) => figureOf(p),
  },
  {
    id: "PG-MYP-011",
    path: PATH.goodsItems,
    title: () => m().goodsItems.pageTitle,
    heading: () => m().goodsItems.heading,
    ready: (p) => rowsIn(mainOf(p)).first(),
  },
  {
    id: "PG-MYP-012",
    path: goodsItemPath(GOODS_ITEM.fulfillable),
    title: () => m().goodsItems.detail.pageTitle,
    heading: () => m().goodsItems.detail.heading,
    ready: (p) => region(p, m().goodsItems.detail.infoHeading),
  },
];

test.describe("TC-PG-MYP-001-731 every Mypage page has a title, one h1, ordered headings, no runtime error, no outside request and no Admin / Staff / dev link (E2E 23, SPEC-050 24, 25, 27, SEC-WEB-004)", () => {
  for (const c of PAGES) {
    test(`${c.id} ${c.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, ":ref")}`, async ({ page }) => {
      const errors = watchRuntimeErrors(page);
      const hosts = watchRequestHosts(page);
      await openAs(page, c.path);
      await expect(c.ready(page)).toBeVisible();
      await expect(page).toHaveTitle(`${c.title()} | ${SITE_NAME}`);
      await expect(heading1(page)).toHaveCount(1);
      await expect(heading1(page)).toHaveText(c.heading());
      const levels = await mainHeadingLevels(page);
      expect(levels.filter((l) => l === 1)).toHaveLength(1);
      expect(levels[0]).toBe(1);
      expect(hasLevelSkip(levels), `heading levels ${levels.join(",")}`).toBe(false);
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toHaveCount(1);
      const hrefs = await allHrefs(page);
      expect(hrefs.length).toBeGreaterThan(5);
      for (const href of hrefs) {
        expect(FORBIDDEN_AREA.test(pathOf(href)), href).toBe(false);
        expect(pathOf(href), href).not.toMatch(/^\/dev(\/|$)/);
      }
      expect(
        [...hosts.hosts].every((host) => host === "127.0.0.1:3100"),
        [...hosts.hosts].join(","),
      ).toBe(true);
      expect(errors.errors).toEqual([]);
    });
  }
});

test.describe("TC-PG-MYP-001-732 every Mypage page fits a 390px screen with its primary content reachable (SPEC-050 24.1)", () => {
  for (const c of PAGES) {
    test(`${c.id}: no horizontal scroll at 390px`, async ({ page }) => {
      await openAs(page, c.path);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(c.ready(page)).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      await expect(heading1(page)).toBeVisible();
    });
  }
});

test.describe("TC-PG-MYP-001-733 reloading a Mypage page reads existing data and creates nothing (SPEC-050 22)", () => {
  const readOnly = PAGES.filter((c) => c.id !== "PG-MYP-002");
  for (const c of readOnly) {
    test(`${c.id}: the whole mock DB is byte-identical after a reload`, async ({ page }) => {
      await openAs(page, c.path);
      await expect(c.ready(page)).toBeVisible();
      const before = await readDbRaw(page);
      expect(before).not.toBeNull();
      await page.reload();
      await expect(heading1(page)).toHaveText(c.heading());
      await expect(c.ready(page)).toBeVisible();
      expect(await readDbRaw(page)).toBe(before);
    });
  }
});

test.describe("TC-SEC-WEB-009-721 every Mypage route is never cached (SEC-WEB-009, G5 header check at the UI mock level)", () => {
  const paths = [
    ...PAGES.map((c) => c.path),
    orderPath("not-a-uuid"),
    ticketPath("not-a-uuid"),
    ticketQrPath("not-a-uuid"),
    reservationPath("not-a-uuid"),
    reservationQrPath("not-a-uuid"),
    goodsItemPath("not-a-uuid"),
  ];
  test("GET of each route is HTTP 200 with no-store, private and Pragma no-cache", async ({
    request,
  }) => {
    for (const path of paths) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(200);
      const cacheControl = response.headers()["cache-control"] ?? "";
      expect(cacheControl, path).toContain("no-store");
      expect(cacheControl, path).toContain("private");
      expect(response.headers().pragma, path).toBe("no-cache");
    }
  });
});

test.describe("TC-SEC-QR-013-701 the mock QR seed is input to drawing only and appears in no URL, DOM, storage or console (SEC-QR-012 / 013, AGENTS.md section 3)", () => {
  for (const [name, path, label] of [
    ["Entry QR", ticketQrPath(TICKET.valid), () => copy.mypage.qr.imageLabel.ENTRY],
    ["Karaoke QR", reservationQrPath(RESERVATION.valid), () => copy.mypage.qr.imageLabel.KARAOKE],
  ] as const) {
    test(`${name}: a QR is drawn, and no seed string is anywhere observable`, async ({ page }) => {
      const console_ = watchConsole(page);
      await openAs(page, path);
      await expect(figureOf(page)).toBeVisible();
      await expect(qrImages(page)).toHaveCount(1);
      await expect(page.getByRole("img", { name: label(), exact: true })).toBeVisible();
      await expectNoMatrixSeed(page);
      // The accessible name and the visible text say what it is, not what it encodes.
      const html = await page.content();
      expect(html).not.toMatch(/data-(seed|token|qr|matrix)/i);
      expect(console_.messages.join("\n")).not.toMatch(/mock-seed/);
      // Reloading changes the page's URL and DOM in no way that exposes it.
      await page.reload();
      await expect(figureOf(page)).toBeVisible();
      await expectNoMatrixSeed(page);
    });
  }

  test("a QR page is not linked with a token or a seed from any other Mypage page", async ({
    page,
  }) => {
    for (const path of [
      PATH.overview,
      PATH.entryTickets,
      ticketPath(TICKET.valid),
      reservationPath(RESERVATION.valid),
    ]) {
      await openAs(page, path);
      for (const href of await allHrefs(page)) {
        expect(href, `${path} -> ${href}`).not.toMatch(/mock-seed|[?&](token|seed|qr)=/i);
      }
    }
  });
});
