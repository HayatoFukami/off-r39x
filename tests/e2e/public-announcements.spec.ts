import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { formatJstDate } from "../../apps/web/src/presentation/format/datetime.ts";
import { gotoHydrated } from "../harness/browser/hydration.ts";
import {
  expectedAnnouncements,
  fixClock,
  LOADING_FORBIDDEN,
  publicScenario,
} from "../harness/browser/public.ts";
import { KEYS, scenarioJson, seedLocalStorage } from "../harness/browser/shell.ts";
import { ANNOUNCEMENT, MARKER } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s4-public.md sections 3.2, 4.
// PG-PUB-002 / PG-PUB-003 (SPEC-050 11.2, 11.3), 31 items 1 and 2, SEC-WEB-017/018, INV-010-08.

const main = (page: Page) => page.getByRole("main");
const h1 = (page: Page) => main(page).getByRole("heading", { level: 1 });

async function open(
  page: Page,
  route: string,
  entries: Record<string, string> = {},
): Promise<number | undefined> {
  await fixClock(page);
  await seedLocalStorage(page, entries);
  const response = await gotoHydrated(page, route);
  return response?.status();
}

const expectedList = expectedAnnouncements;

/** Proves the detail route is implemented, so the Not Found checks cannot pass vacuously. */
async function expectDetailRouteWorks(page: Page): Promise<void> {
  await open(page, `/announcements/${ANNOUNCEMENT.latest}`);
  await expect(h1(page)).toHaveText(latestAnnouncement().title);
}

function latestAnnouncement() {
  const found = expectedList().find((a) => a.announcementRef === ANNOUNCEMENT.latest);
  if (found === undefined) throw new Error("seed has no latest announcement");
  return found;
}

test.describe("TC-PG-PUB-002-611 the list shows PUBLISHED announcements newest first with date, summary and a detail link (SPEC-050 11.2, INV-010-08)", () => {
  test("has one h1 and one item per published announcement", async ({ page }) => {
    const announcements = expectedList();
    expect(announcements).toHaveLength(3);
    expect(await open(page, "/announcements")).toBe(200);
    await expect(h1(page)).toHaveText(copy.announcements.heading);
    await expect(h1(page)).toHaveCount(1);
    const items = main(page).getByRole("listitem");
    await expect(items).toHaveCount(3);
    for (const [index, announcement] of announcements.entries()) {
      const item = items.nth(index);
      await expect(item.getByRole("link", { name: announcement.title })).toHaveAttribute(
        "href",
        `/announcements/${announcement.announcementRef}`,
      );
      await expect(item).toContainText(formatJstDate(announcement.publishedAt));
      await expect(item).toContainText(announcement.excerpt);
      await expect(item.locator("time")).toHaveCount(1);
    }
  });

  test("never shows a draft or an archived announcement", async ({ page }) => {
    await open(page, "/announcements");
    await expect(main(page).getByRole("listitem")).toHaveCount(3);
    await expect(main(page)).not.toContainText(MARKER.draftAnnouncement);
    await expect(main(page)).not.toContainText(MARKER.archivedAnnouncement);
  });

  test("selecting an item opens its detail page", async ({ page }) => {
    const announcements = expectedList();
    await open(page, "/announcements");
    await main(page)
      .getByRole("link", { name: announcements[0]?.title ?? "" })
      .click();
    await expect(page).toHaveURL(new RegExp(`/announcements/${ANNOUNCEMENT.latest}$`));
    await expect(h1(page)).toHaveText(announcements[0]?.title ?? "");
  });
});

test.describe("TC-PG-PUB-002-612 list states: empty is a successful zero, a failure is never zero (SPEC-050 11.2, 9.2, 21, 31 item 2)", () => {
  test("a successful empty read says nothing is published", async ({ page }) => {
    await open(page, "/announcements", publicScenario({ publicFetch: "empty" }));
    await expect(h1(page)).toHaveText(copy.announcements.heading);
    await expect(main(page)).toContainText(copy.pageState.empty);
    await expect(main(page).getByRole("listitem")).toHaveCount(0);
    await expect(main(page).getByRole("alert")).toHaveCount(0);
  });

  test("a failed read shows an error with a retry and neither the empty nor a zero wording", async ({
    page,
  }) => {
    await open(page, "/announcements", publicScenario({ publicFetch: "fail" }));
    await expect(h1(page)).toHaveText(copy.announcements.heading);
    const alert = main(page).getByRole("alert");
    await expect(alert).toContainText(copy.pageState.unavailable(copy.announcements.subject));
    await expect(
      alert.getByRole("button", { name: copy.pageState.retry, exact: true }),
    ).toBeVisible();
    await expect(main(page)).not.toContainText(copy.pageState.empty);
    await expect(main(page)).not.toContainText(/0件/);
    await expect(main(page).getByRole("listitem")).toHaveCount(0);
  });

  test("retry recovers when the read succeeds again", async ({ page }) => {
    await open(page, "/announcements", publicScenario({ publicFetch: "fail" }));
    await expect(main(page).getByRole("alert")).toBeVisible();
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [
      KEYS.scenario,
      scenarioJson(),
    ] as const);
    await main(page).getByRole("button", { name: copy.pageState.retry, exact: true }).click();
    await expect(main(page).getByRole("listitem")).toHaveCount(3);
    await expect(main(page).getByRole("alert")).toHaveCount(0);
  });

  test("loading shows a status and no empty, zero or result wording", async ({ page }) => {
    await open(page, "/announcements", publicScenario({ latency: "long", latencyLongMs: 6000 }));
    await expect(main(page).getByRole("status").first()).toContainText(copy.pageState.loading);
    await expect(main(page)).not.toContainText(LOADING_FORBIDDEN);
    await expect(main(page).getByRole("listitem")).toHaveCount(0);
    await expect(main(page).getByRole("listitem")).toHaveCount(3, { timeout: 20_000 });
  });
});

test.describe("TC-PG-PUB-003-611 the detail page shows the title, date and body as plain text (SPEC-050 11.3, SEC-WEB-017/018)", () => {
  test("shows h1 = title, the JST date, the body and the way back", async ({ page }) => {
    const latest = latestAnnouncement();
    expect(await open(page, `/announcements/${ANNOUNCEMENT.latest}`)).toBe(200);
    await expect(h1(page)).toHaveText(latest.title);
    await expect(h1(page)).toHaveCount(1);
    await expect(main(page)).toContainText(formatJstDate(latest.publishedAt));
    await expect(main(page)).toContainText(latest.body);
    await expect(main(page).locator("time")).toHaveCount(1);
    await expect(
      main(page).getByRole("link", { name: copy.announcements.backToList, exact: true }),
    ).toHaveAttribute("href", "/announcements");
    await expect(
      main(page).getByRole("link", { name: copy.announcements.backHome, exact: true }),
    ).toHaveAttribute("href", "/");
  });

  test("renders a script tag in the body as literal text without running or inserting it", async ({
    page,
  }) => {
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await open(page, `/announcements/${ANNOUNCEMENT.script}`);
    const literal = main(page).getByText(MARKER.scriptMarkup, { exact: false });
    await expect(literal).toBeVisible();
    await expect(literal).toHaveCount(1);
    await expect(main(page).locator("script")).toHaveCount(0);
    await expect(main(page).locator("a[href*='alert']")).toHaveCount(0);
    expect(dialogs).toEqual([]);
    // Newlines are preserved by CSS, not by inserted HTML.
    const whiteSpace = await literal.evaluate((el) => getComputedStyle(el).whiteSpace);
    expect(whiteSpace).toMatch(/pre-line|pre-wrap/);
  });

  test("selecting the back links returns to the list and to Event Home", async ({ page }) => {
    await open(page, `/announcements/${ANNOUNCEMENT.latest}`);
    await main(page)
      .getByRole("link", { name: copy.announcements.backToList, exact: true })
      .click();
    await expect(page).toHaveURL(/\/announcements$/);
    await page.goBack();
    await main(page).getByRole("link", { name: copy.announcements.backHome, exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("TC-PG-PUB-003-612 an unpublished, unknown or malformed announcement is Not Found and leaks nothing (SPEC-050 11.3, 19.1, INV-010-08)", () => {
  const unreadable = [
    ["draft", ANNOUNCEMENT.draft, MARKER.draftAnnouncement, "下書きの本文"],
    ["archived", ANNOUNCEMENT.archived, MARKER.archivedAnnouncement, "掲載終了の本文"],
    ["unknown", "ab000000-0000-4000-8000-0000000000ff", "", ""],
  ] as const;

  for (const [kind, ref, title, body] of unreadable) {
    test(`${kind} announcement shows the Not Found page without its title or body`, async ({
      page,
    }) => {
      await expectDetailRouteWorks(page);
      await gotoHydrated(page, `/announcements/${ref}`);
      await expect(h1(page)).toHaveText(copy.notFound.title);
      await expect(h1(page)).toHaveCount(1);
      await expect(main(page)).toContainText(copy.notFound.description);
      await expect(
        main(page).getByRole("link", { name: copy.notFound.homeLink, exact: true }),
      ).toHaveAttribute("href", "/");
      const text = await page.locator("body").innerText();
      if (title !== "") expect(text).not.toContain(title);
      if (body !== "") expect(text).not.toContain(body);
      expect(text).not.toContain(ref);
      if (title !== "") expect(await page.title()).not.toContain(title);
      await expect(main(page).getByRole("alert")).toHaveCount(0);
    });
  }

  test("is indistinguishable between a draft and an unknown reference", async ({ page }) => {
    await expectDetailRouteWorks(page);
    await gotoHydrated(page, `/announcements/${ANNOUNCEMENT.draft}`);
    await expect(h1(page)).toHaveText(copy.notFound.title);
    const draft = (await main(page).innerText()).replaceAll(/\s+/g, " ");
    await gotoHydrated(page, "/announcements/ab000000-0000-4000-8000-0000000000ff");
    await expect(h1(page)).toHaveText(copy.notFound.title);
    const unknown = (await main(page).innerText()).replaceAll(/\s+/g, " ");
    expect(draft).toBe(unknown);
  });

  test("a malformed reference is answered with HTTP 404 and the Not Found page", async ({
    page,
  }) => {
    await expectDetailRouteWorks(page);
    for (const bad of ["not-a-uuid", "12345", ANNOUNCEMENT.latest.toUpperCase()]) {
      const response = await gotoHydrated(page, `/announcements/${bad}`);
      expect(response?.status(), bad).toBe(404);
      await expect(h1(page), bad).toHaveText(copy.notFound.title);
      await expect(main(page), bad).not.toContainText(bad);
    }
  });
});

test.describe("TC-PG-PUB-003-613 a fetch failure is a failure, not Not Found (SPEC-050 11.3, 21)", () => {
  test("shows the error with a retry and none of the Not Found wording", async ({ page }) => {
    await open(
      page,
      `/announcements/${ANNOUNCEMENT.latest}`,
      publicScenario({ publicFetch: "fail" }),
    );
    await expect(h1(page)).toHaveText(copy.announcements.heading);
    const alert = main(page).getByRole("alert");
    await expect(alert).toContainText(copy.pageState.unavailable(copy.announcements.subject));
    await expect(main(page)).not.toContainText(copy.notFound.description);
    await expect(main(page)).not.toContainText(copy.notFound.title);
    await expect(
      alert.getByRole("button", { name: copy.pageState.retry, exact: true }),
    ).toBeVisible();
  });

  test("retry shows the announcement once the read succeeds", async ({ page }) => {
    const latest = latestAnnouncement();
    await open(
      page,
      `/announcements/${ANNOUNCEMENT.latest}`,
      publicScenario({ publicFetch: "fail" }),
    );
    await expect(main(page).getByRole("alert")).toBeVisible();
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [
      KEYS.scenario,
      scenarioJson(),
    ] as const);
    await main(page).getByRole("button", { name: copy.pageState.retry, exact: true }).click();
    await expect(h1(page)).toHaveText(latest.title);
    await expect(main(page)).toContainText(latest.body);
  });

  test("loading shows a status and neither the announcement nor Not Found", async ({ page }) => {
    const latest = latestAnnouncement();
    await open(
      page,
      `/announcements/${ANNOUNCEMENT.latest}`,
      publicScenario({ latency: "long", latencyLongMs: 6000 }),
    );
    await expect(main(page).getByRole("status").first()).toContainText(copy.pageState.loading);
    await expect(main(page)).not.toContainText(latest.body);
    await expect(main(page)).not.toContainText(copy.notFound.description);
    await expect(main(page)).not.toContainText(LOADING_FORBIDDEN);
    await expect(h1(page)).toHaveText(latest.title, { timeout: 20_000 });
  });
});
