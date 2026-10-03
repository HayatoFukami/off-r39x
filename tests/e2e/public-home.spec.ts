import { expect, type Page, test } from "@playwright/test";
import type { UtcInstant } from "../../apps/web/src/api-client/types.ts";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  formatJstDate,
  formatJstDateTime,
} from "../../apps/web/src/presentation/format/datetime.ts";
import {
  expectedAnnouncements,
  expectedEvent,
  expectedFaqs,
  fixClock,
  LOADING_FORBIDDEN,
  publicScenario,
} from "../harness/browser/public.ts";
import { KEYS, scenarioJson, seedLocalStorage } from "../harness/browser/shell.ts";
import { MARKER } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s4-public.md sections 3.1, 4.
// PG-PUB-001 (SPEC-050 11.1), 31 items 1 and 2, 9, 21, 24.1, 25, 33.

const main = (page: Page) => page.getByRole("main");
const region = (page: Page, name: string) => main(page).getByRole("region", { name, exact: true });
const h1 = (page: Page) => main(page).getByRole("heading", { level: 1 });

async function openHome(page: Page, entries: Record<string, string> = {}): Promise<void> {
  await fixClock(page);
  await seedLocalStorage(page, entries);
  await page.goto("/");
}

function expected() {
  return {
    event: expectedEvent(),
    announcements: expectedAnnouncements().slice(0, 3),
    faqs: expectedFaqs(),
  };
}

/** The hero is the nearest section / header around the single h1 (contract 3.1). */
const hero = (page: Page) =>
  h1(page).locator("xpath=ancestor::*[self::section or self::header][1]");

test.describe("TC-PG-PUB-001-601 Event Home lists its sections in the SPEC-050 order with the required elements (SPEC-050 11.1, 31 item 1)", () => {
  test("hero first, then NEWS, sales shortcut, overview, schedule, venue, notices and FAQ", async ({
    page,
  }) => {
    const { event } = expected();
    await openHome(page);
    await expect(h1(page)).toHaveText(event.name);
    await expect(h1(page)).toHaveCount(1);

    const sectionNames = copy.home.sections;
    const expectedH2 = [
      sectionNames.news,
      sectionNames.salesShortcut,
      sectionNames.overview,
      sectionNames.schedule,
      sectionNames.venue,
      sectionNames.notices,
      sectionNames.faq,
    ];
    await expect(main(page).getByRole("heading", { level: 2 })).toHaveText(expectedH2);

    // Document order of h1, the hero CTA and the section headings.
    const sequence = await page.evaluate((cta: string) => {
      const nodes = Array.from(document.querySelectorAll("main h1, main h2, main a"));
      return nodes
        .filter((el) => el.tagName !== "A" || (el.textContent ?? "").trim() === cta)
        .map((el) => (el.textContent ?? "").trim());
    }, copy.layout.cta.buyTickets);
    expect(sequence).toEqual([event.name, copy.layout.cta.buyTickets, ...expectedH2]);

    // Hero: event name, period, venue name, primary CTA.
    const heroBox = hero(page);
    await expect(heroBox).toContainText(event.name);
    await expect(heroBox).toContainText(formatJstDateTime(event.startsAt as UtcInstant));
    await expect(heroBox).toContainText(event.venueName ?? "");
    await expect(
      heroBox.getByRole("link", { name: copy.layout.cta.buyTickets, exact: true }),
    ).toHaveCount(1);

    // Every section is a named region; the hero is the only content before NEWS.
    for (const name of expectedH2) await expect(region(page, name)).toBeVisible();
  });
});

test.describe("TC-PG-PUB-001-602 the primary CTA and the sales shortcuts lead to the sales pages (SPEC-050 11.1 Primary Action)", () => {
  test("the hero CTA goes to the Entry Ticket sales page, like the Global Header CTA", async ({
    page,
  }) => {
    await openHome(page);
    const heroCta = hero(page).getByRole("link", { name: copy.layout.cta.buyTickets, exact: true });
    await expect(heroCta).toHaveAttribute("href", "/entry");
    await expect(
      page.getByRole("banner").getByRole("link", { name: copy.layout.cta.buyTickets, exact: true }),
    ).toHaveAttribute("href", "/entry");
    await heroCta.click();
    await expect(page).toHaveURL(/\/entry$/);
  });

  test("offers the Entry Ticket, Karaoke and Goods shortcuts in that order", async ({ page }) => {
    await openHome(page);
    const links = region(page, copy.home.sections.salesShortcut).getByRole("link");
    await expect(links).toHaveText([
      copy.home.shortcut.entry,
      copy.home.shortcut.karaoke,
      copy.home.shortcut.goods,
    ]);
    await expect(links.nth(0)).toHaveAttribute("href", "/entry");
    await expect(links.nth(1)).toHaveAttribute("href", "/karaoke");
    await expect(links.nth(2)).toHaveAttribute("href", "/goods");
  });
});

test.describe("TC-PG-PUB-001-603 NEWS shows the newest PUBLISHED announcements with a date and a link to the list (SPEC-050 11.1, INV-010-08)", () => {
  test("lists three items newest first, each dated in JST and linking to its detail", async ({
    page,
  }) => {
    const { announcements } = expected();
    await openHome(page);
    const news = region(page, copy.home.sections.news);
    const items = news.getByRole("listitem");
    await expect(items).toHaveCount(3);
    expect(announcements).toHaveLength(3);
    for (const [index, announcement] of announcements.entries()) {
      const item = items.nth(index);
      const link = item.getByRole("link", { name: announcement.title });
      await expect(link).toHaveAttribute("href", `/announcements/${announcement.announcementRef}`);
      await expect(item).toContainText(formatJstDate(announcement.publishedAt));
      await expect(item.locator("time")).toHaveCount(1);
    }
    await expect(
      news.getByRole("link", { name: copy.home.news.viewAll, exact: true }),
    ).toHaveAttribute("href", "/announcements");
  });

  test("never shows a draft or archived announcement", async ({ page }) => {
    await openHome(page);
    await expect(region(page, copy.home.sections.news).getByRole("listitem")).toHaveCount(3);
    await expect(main(page)).not.toContainText(MARKER.draftAnnouncement);
    await expect(main(page)).not.toContainText(MARKER.archivedAnnouncement);
  });

  test("the 'view all' link opens the announcement list", async ({ page }) => {
    await openHome(page);
    await region(page, copy.home.sections.news)
      .getByRole("link", { name: copy.home.news.viewAll, exact: true })
      .click();
    await expect(page).toHaveURL(/\/announcements$/);
  });
});

test.describe("TC-PG-PUB-001-604 overview, schedule, venue and notices show the published event facts in JST (SPEC-050 11.1, BR-EVT-001)", () => {
  test("shows each fact inside its own section", async ({ page }) => {
    const { event } = expected();
    await openHome(page);
    await expect(h1(page)).toHaveText(event.name);

    const overview = region(page, copy.home.sections.overview);
    await expect(overview).toContainText(event.name);
    await expect(overview).toContainText(event.overview ?? "");

    // The browser runs in UTC; the schedule must be the JST wall clock.
    const schedule = region(page, copy.home.sections.schedule);
    await expect(schedule).toContainText(formatJstDateTime(event.startsAt as UtcInstant));
    await expect(schedule).toContainText(formatJstDateTime(event.endsAt as UtcInstant));

    const venue = region(page, copy.home.sections.venue);
    await expect(venue).toContainText(event.venueName ?? "");
    await expect(venue).toContainText(event.venueGuide ?? "");
    await expect(venue).toContainText(event.accessInfo ?? "");

    const notices = region(page, copy.home.sections.notices).getByRole("listitem");
    await expect(notices).toHaveText([...(event.notices ?? [])]);
  });
});

test.describe("TC-PG-PUB-001-605 FAQ shows only PUBLISHED questions with their answers (SPEC-050 11.1, INV-010-08)", () => {
  test("lists the three published FAQs and no draft", async ({ page }) => {
    const { faqs } = expected();
    await openHome(page);
    const faq = region(page, copy.home.sections.faq);
    await expect(faq).toBeVisible();
    for (const item of faqs) {
      await expect(faq).toContainText(item.question);
      await expect(faq).toContainText(item.answer);
    }
    expect(faqs).toHaveLength(3);
    await expect(main(page)).not.toContainText(MARKER.draftFaq);
  });
});

test.describe("TC-PG-PUB-001-606 unset event facts are hidden, never guessed (SPEC-050 11.1 未設定外部事実, 33)", () => {
  test("shows only the hero, NEWS, shortcuts and FAQ when every optional field is unset", async ({
    page,
  }) => {
    const { event } = expected();
    await openHome(page, publicScenario({ eventFields: "missing_optional" }));
    await expect(h1(page)).toHaveText(event.name);
    const sectionNames = copy.home.sections;
    await expect(main(page).getByRole("heading", { level: 2 })).toHaveText([
      sectionNames.news,
      sectionNames.salesShortcut,
      sectionNames.faq,
    ]);
    await expect(main(page)).not.toContainText(/未設定|未定|TBD|N\/A|undefined|null/);
    // The hero has the event name and the CTA only: no period, no venue.
    const heroText = (await hero(page).innerText()).replaceAll(/\s+/g, " ");
    expect(heroText).not.toMatch(/\d{4}\/\d{2}\/\d{2}/);
    await expect(
      hero(page).getByRole("link", { name: copy.layout.cta.buyTickets, exact: true }),
    ).toBeVisible();
    // The fully-set sections are absent rather than shown with a placeholder.
    for (const name of [
      sectionNames.overview,
      sectionNames.schedule,
      sectionNames.venue,
      sectionNames.notices,
    ]) {
      await expect(region(page, name)).toHaveCount(0);
    }
  });
});

test.describe("TC-PG-PUB-001-607 an event fetch failure is a page-level error and is never shown as an empty page (SPEC-050 11.1, 21, 31 item 2)", () => {
  test("shows one error with a retry, no sections, no empty or zero wording", async ({ page }) => {
    await openHome(page, publicScenario({ publicFetch: "fail" }));
    await expect(h1(page)).toHaveText(copy.home.fallbackHeading);
    await expect(h1(page)).toHaveCount(1);
    const alert = main(page).getByRole("alert");
    await expect(alert).toContainText(copy.pageState.unavailable(copy.home.subject));
    await expect(
      alert.getByRole("button", { name: copy.pageState.retry, exact: true }),
    ).toBeVisible();
    await expect(main(page).getByRole("heading", { level: 2 })).toHaveCount(0);
    await expect(main(page)).not.toContainText(copy.pageState.empty);
    await expect(main(page)).not.toContainText(/0件|売り切れ/);
    await expect(main(page).getByRole("link", { name: copy.home.news.viewAll })).toHaveCount(0);
  });

  test("retry re-reads and recovers once the reads succeed", async ({ page }) => {
    const { event } = expected();
    await openHome(page, publicScenario({ publicFetch: "fail" }));
    await expect(main(page).getByRole("alert")).toBeVisible();
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [
      KEYS.scenario,
      scenarioJson(),
    ] as const);
    await main(page).getByRole("button", { name: copy.pageState.retry, exact: true }).click();
    await expect(h1(page)).toHaveText(event.name);
    await expect(main(page).getByRole("alert")).toHaveCount(0);
    await expect(region(page, copy.home.sections.faq)).toBeVisible();
  });
});

test.describe("TC-PG-PUB-001-608 empty is shown only for a successful empty read, and the event sections stay (SPEC-050 11.1, 9.2)", () => {
  test("announcements and FAQs say there is nothing published; the rest of the page is unaffected", async ({
    page,
  }) => {
    const { event } = expected();
    await openHome(page, publicScenario({ publicFetch: "empty" }));
    await expect(h1(page)).toHaveText(event.name);
    await expect(region(page, copy.home.sections.news)).toContainText(copy.pageState.empty);
    await expect(region(page, copy.home.sections.faq)).toContainText(copy.pageState.empty);
    await expect(region(page, copy.home.sections.news).getByRole("listitem")).toHaveCount(0);
    await expect(region(page, copy.home.sections.overview)).toBeVisible();
    await expect(region(page, copy.home.sections.venue)).toBeVisible();
    await expect(main(page).getByRole("alert")).toHaveCount(0);
  });
});

test.describe("TC-PG-PUB-001-609 loading never shows business outcomes or invented values (SPEC-050 9.1, 21)", () => {
  test("shows a loading status, no event facts and no result wording while the reads are pending", async ({
    page,
  }) => {
    const { event } = expected();
    await openHome(page, publicScenario({ latency: "long", latencyLongMs: 6000 }));
    await expect(h1(page)).toHaveText(copy.home.fallbackHeading);
    await expect(main(page).getByRole("status").first()).toContainText(copy.pageState.loading);
    await expect(main(page)).not.toContainText(LOADING_FORBIDDEN);
    await expect(main(page)).not.toContainText(event.name);
    await expect(main(page).getByRole("alert")).toHaveCount(0);
    await expect(main(page).getByRole("heading", { level: 2 })).toHaveCount(0);
    // After the reads resolve the real content replaces the loading state.
    await expect(h1(page)).toHaveText(event.name, { timeout: 20_000 });
    await expect(
      main(page).getByRole("status").filter({ hasText: copy.pageState.loading }),
    ).toHaveCount(0);
  });
});

test.describe("TC-PG-PUB-001-610 the Home page is operable by keyboard (SPEC-050 25)", () => {
  test("Tab reaches the hero CTA after the Global Header and Enter opens the Entry Ticket page", async ({
    page,
  }) => {
    await openHome(page);
    await expect(region(page, copy.home.sections.faq)).toBeVisible();
    const heroCta = hero(page).getByRole("link", { name: copy.layout.cta.buyTickets, exact: true });
    let reached = false;
    for (let step = 0; step < 80 && !reached; step += 1) {
      await page.keyboard.press("Tab");
      reached = await heroCta.evaluate((el) => el === document.activeElement);
    }
    expect(reached, "the hero CTA must be reachable with Tab").toBe(true);
    await expect(heroCta).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/entry$/);
  });

  test("the shortcut and view-all links are in the tab order after the hero and in section order", async ({
    page,
  }) => {
    await openHome(page);
    await expect(region(page, copy.home.sections.faq)).toBeVisible();
    const order: string[] = [];
    const wanted = new Set<string>([
      copy.layout.cta.buyTickets,
      copy.home.news.viewAll,
      copy.home.shortcut.entry,
      copy.home.shortcut.karaoke,
      copy.home.shortcut.goods,
    ]);
    for (let step = 0; step < 120 && order.length < 6; step += 1) {
      await page.keyboard.press("Tab");
      const inMain = await page.evaluate(() => document.activeElement?.closest("main") !== null);
      if (!inMain) continue;
      const label =
        (await page.evaluate(() => (document.activeElement?.textContent ?? "").trim())) ?? "";
      if (wanted.has(label)) order.push(label);
    }
    expect(order.slice(0, 1)).toEqual([copy.layout.cta.buyTickets]);
    expect(order).toContain(copy.home.news.viewAll);
    const idx = (label: string) => order.indexOf(label);
    expect(idx(copy.home.news.viewAll)).toBeLessThan(idx(copy.home.shortcut.entry));
    expect(idx(copy.home.shortcut.entry)).toBeLessThan(idx(copy.home.shortcut.karaoke));
    expect(idx(copy.home.shortcut.karaoke)).toBeLessThan(idx(copy.home.shortcut.goods));
  });
});
