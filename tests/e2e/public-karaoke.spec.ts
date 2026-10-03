import { expect, type Page, test } from "@playwright/test";
import type { BusinessDateJst } from "../../apps/web/src/api-client/types.ts";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  formatBusinessDate,
  formatJstDateTime,
  formatJstTimeRange,
} from "../../apps/web/src/presentation/format/datetime.ts";
import {
  expectedBuckets,
  expectedSales,
  fixClock,
  LOADING_FORBIDDEN,
  publicScenario,
} from "../harness/browser/public.ts";
import { KEYS, scenarioJson, seedLocalStorage } from "../harness/browser/shell.ts";
import { D1, D2, SLOT } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s4-public.md sections 3.3, 3.4, 4.
// PG-KRK-001 / PG-KRK-002 (SPEC-050 13.1, 13.2, 20.3), 31 items 1, 2 and 5, 24.1, 25, 33, INV-010-04.

const main = (page: Page) => page.getByRole("main");
const h1 = (page: Page) => main(page).getByRole("heading", { level: 1 });
const dayRoute = (date: BusinessDateJst): string => `/karaoke/schedule/${date}`;
const pad = (n: number): string => String(n).padStart(2, "0");
const bucketLabel = (hour: number): string => `${pad(hour)}:00-${pad(hour + 1)}:00`;
const bucketRegion = (page: Page, hour: number) =>
  main(page).getByRole("region", { name: bucketLabel(hour) });
const slotLinks = (page: Page) => main(page).locator("a[href^='/karaoke/slots/']");

async function open(
  page: Page,
  route: string,
  entries: Record<string, string> = {},
): Promise<number | undefined> {
  await fixClock(page);
  await seedLocalStorage(page, entries);
  const response = await page.goto(route);
  return response?.status();
}

async function setScenario(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [
    KEYS.scenario,
    scenarioJson(patch),
  ] as const);
}

test.describe("TC-PG-KRK-001-611 the guide explains the sale and lists the target dates (SPEC-050 13.1)", () => {
  test("shows the guide facts, the price via formatMoney, the JST period, the status and the dates", async ({
    page,
  }) => {
    const sales = expectedSales();
    expect(await open(page, "/karaoke")).toBe(200);
    await expect(h1(page)).toHaveText(copy.karaoke.guide.heading);
    await expect(h1(page)).toHaveCount(1);
    const body = main(page);
    await expect(body).toContainText(copy.karaoke.guide.intro);
    await expect(body).toContainText(copy.karaoke.guide.usageUnit);
    await expect(body).toContainText(copy.karaoke.guide.duration);
    await expect(body).toContainText(copy.karaoke.guide.purchaseLimit);
    await expect(body).toContainText("¥1,000");
    await expect(body).toContainText(formatJstDateTime(sales.startsAt));
    await expect(body).toContainText(formatJstDateTime(sales.endsAt));
    await expect(body.getByText(copy.availability.label.ON_SALE, { exact: true })).toBeVisible();
    await expect(body).toContainText(copy.karaoke.saleStatus.description.ON_SALE);
  });

  test("links each sales date to its schedule and opens it", async ({ page }) => {
    const sales = expectedSales();
    await open(page, "/karaoke");
    await expect(
      main(page).getByRole("heading", { level: 2, name: copy.karaoke.guide.datesHeading }),
    ).toBeVisible();
    const links = main(page).locator("a[href^='/karaoke/schedule/']");
    await expect(links).toHaveCount(sales.salesDates.length);
    for (const date of sales.salesDates) {
      await expect(
        main(page).getByRole("link", {
          name: copy.karaoke.guide.dateLink(formatBusinessDate(date)),
          exact: true,
        }),
      ).toHaveAttribute("href", dayRoute(date));
    }
    await main(page)
      .getByRole("link", { name: copy.karaoke.guide.dateLink(formatBusinessDate(D1)), exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/karaoke/schedule/${D1}$`));
    await expect(main(page).getByRole("heading", { level: 2 }).first()).toContainText(
      formatBusinessDate(D1),
    );
  });

  test("offers no purchase or Cart action on the guide", async ({ page }) => {
    await open(page, "/karaoke");
    await expect(
      main(page).getByRole("heading", { level: 2, name: copy.karaoke.guide.datesHeading }),
    ).toBeVisible();
    await expect(main(page).getByRole("button")).toHaveCount(0);
    await expect(main(page)).not.toContainText(/カートに追加/);
  });
});

test.describe("TC-PG-KRK-001-612 before / ended / suspended are different states and suspension never claims a cancellation (SPEC-050 13.1)", () => {
  const statuses = ["BEFORE_SALES", "SALES_ENDED", "SUSPENDED"] as const;
  const labels = (): string[] => [
    copy.availability.label.ON_SALE,
    copy.availability.label.BEFORE_SALES,
    copy.availability.label.SALES_ENDED,
    copy.availability.label.SUSPENDED,
  ];

  for (const status of statuses) {
    test(`${status} shows its own label and description, and still lists the dates`, async ({
      page,
    }) => {
      const label = copy.availability.label[status];
      const description = copy.karaoke.saleStatus.description[status];
      await open(page, "/karaoke", publicScenario({ karaokeSales: status }));
      await expect(h1(page)).toHaveText(copy.karaoke.guide.heading);
      await expect(main(page).getByText(label, { exact: true })).toBeVisible();
      await expect(main(page)).toContainText(description);
      for (const other of labels().filter((l) => l !== label)) {
        await expect(main(page).getByText(other, { exact: true }), other).toHaveCount(0);
      }
      await expect(main(page).locator("a[href^='/karaoke/schedule/']")).toHaveCount(2);
      await expect(main(page)).not.toContainText(/(取り消|取消|キャンセル)(されました|しました)/);
    });
  }
});

test.describe("TC-PG-KRK-001-613 a failed read is never 'no target dates' (SPEC-050 13.1, 9.2, 21, 31 item 2)", () => {
  test("shows an error with a retry, no dates, no price and no 'no dates' wording", async ({
    page,
  }) => {
    await open(page, "/karaoke", publicScenario({ publicFetch: "fail" }));
    await expect(h1(page)).toHaveText(copy.karaoke.guide.heading);
    const alert = main(page).getByRole("alert");
    await expect(alert).toContainText(copy.pageState.unavailable(copy.karaoke.guide.subject));
    await expect(
      alert.getByRole("button", { name: copy.pageState.retry, exact: true }),
    ).toBeVisible();
    await expect(main(page)).not.toContainText(copy.karaoke.guide.datesEmpty);
    await expect(main(page)).not.toContainText(/[¥￥]\s*\d/);
    await expect(main(page).locator("a[href^='/karaoke/schedule/']")).toHaveCount(0);
  });

  test("retry recovers and shows the dates", async ({ page }) => {
    await open(page, "/karaoke", publicScenario({ publicFetch: "fail" }));
    await expect(main(page).getByRole("alert")).toBeVisible();
    await setScenario(page, {});
    await main(page).getByRole("button", { name: copy.pageState.retry, exact: true }).click();
    await expect(main(page).locator("a[href^='/karaoke/schedule/']")).toHaveCount(2);
    await expect(main(page).getByRole("alert")).toHaveCount(0);
  });

  test("a successful read with no sales dates says so, while keeping the guide", async ({
    page,
  }) => {
    await open(page, "/karaoke", publicScenario({ publicFetch: "empty" }));
    await expect(main(page)).toContainText(copy.karaoke.guide.datesEmpty);
    await expect(main(page)).toContainText("¥1,000");
    await expect(main(page).locator("a[href^='/karaoke/schedule/']")).toHaveCount(0);
    await expect(main(page).getByRole("alert")).toHaveCount(0);
  });

  test("loading shows a status and neither dates, amounts nor result wording", async ({ page }) => {
    await open(page, "/karaoke", publicScenario({ latency: "long", latencyLongMs: 6000 }));
    await expect(main(page).getByRole("status").first()).toContainText(copy.pageState.loading);
    await expect(main(page)).not.toContainText(LOADING_FORBIDDEN);
    await expect(main(page)).not.toContainText(copy.karaoke.guide.datesEmpty);
    await expect(main(page).locator("a[href^='/karaoke/schedule/']")).toHaveCount(0);
    await expect(main(page).locator("a[href^='/karaoke/schedule/']")).toHaveCount(2, {
      timeout: 20_000,
    });
  });
});

test.describe("TC-PG-KRK-002-611 the day schedule shows JST 1-hour buckets with n / m counts as text (SPEC-050 13.2, 31 item 5, TST-DAT-007/008)", () => {
  test("lists each bucket with its counts and every slot's usage start-end time", async ({
    page,
  }) => {
    const buckets = expectedBuckets(D1);
    expect(await open(page, dayRoute(D1))).toBe(200);
    await expect(h1(page)).toHaveText(copy.karaoke.day.heading);
    await expect(h1(page)).toHaveCount(1);
    await expect(
      main(page).getByRole("heading", { level: 2, name: formatBusinessDate(D1) }),
    ).toBeVisible();
    await expect(
      main(page)
        .getByRole("region")
        .filter({ has: page.getByRole("heading", { level: 3 }) }),
    ).toHaveCount(buckets.length);
    expect(buckets.map((b) => b.startHour)).toEqual([10, 11, 12, 13, 14]);
    for (const bucket of buckets) {
      const region = bucketRegion(page, bucket.startHour);
      await expect(
        region.getByRole("heading", { level: 3, name: bucketLabel(bucket.startHour) }),
      ).toBeVisible();
      await expect(region).toContainText(
        copy.karaoke.day.bucketCount(bucket.availableSlots, bucket.totalSlots),
      );
      const rows = region.getByRole("listitem");
      await expect(rows).toHaveCount(bucket.totalSlots);
      for (const [index, slot] of bucket.slots.entries()) {
        await expect(rows.nth(index)).toContainText(
          formatJstTimeRange(slot.usageStart, slot.usageEnd),
        );
      }
    }
    // The counts from the contract (S2 section 8.4) stated explicitly: 10h 1/3, 11h 3/3, 12h 0/3, 13h 1/1, 14h 0/1.
    await expect(bucketRegion(page, 10)).toContainText(copy.karaoke.day.bucketCount(1, 3));
    await expect(bucketRegion(page, 12)).toContainText(copy.karaoke.day.bucketCount(0, 3));
  });

  test("shows no slot twice", async ({ page }) => {
    await open(page, dayRoute(D1));
    await expect(bucketRegion(page, 10)).toBeVisible();
    const hrefs = await slotLinks(page).evaluateAll((els) =>
      els.map((el) => el.getAttribute("href")),
    );
    expect(new Set(hrefs).size).toBe(hrefs.length);
    const times = await main(page)
      .getByRole("listitem")
      .evaluateAll((els) =>
        els.map((el) => (el.textContent ?? "").match(/\d{2}:\d{2}-\d{2}:\d{2}/)?.[0] ?? ""),
      );
    expect(new Set(times).size).toBe(times.length);
    expect(times).toHaveLength(11);
  });

  test("keeps the 08:40 JST slot (23:40 UTC the day before) in the 08:00 bucket while the browser runs in UTC", async ({
    page,
  }) => {
    await open(page, dayRoute(D2));
    await expect(bucketRegion(page, 8)).toBeVisible();
    await expect(bucketRegion(page, 8)).toContainText("08:40-08:55");
    await expect(bucketRegion(page, 8)).toContainText(copy.karaoke.day.bucketCount(1, 1));
    await expect(bucketRegion(page, 9)).toContainText("09:00-09:15");
    await expect(main(page)).not.toContainText("23:40");
    await expect(
      main(page)
        .getByRole("region")
        .filter({ has: page.getByRole("heading", { level: 3 }) }),
    ).toHaveCount(2);
  });
});

test.describe("TC-PG-KRK-002-612 AVAILABLE / HELD / SOLD / SALES_STOPPED differ by text and only AVAILABLE can be selected (SPEC-050 13.2, 20.3, 25, 31 item 5)", () => {
  const rowFor = (page: Page, hour: number, timeText: string) =>
    bucketRegion(page, hour).getByRole("listitem").filter({ hasText: timeText });

  test("labels the four states with four different texts", async ({ page }) => {
    await open(page, dayRoute(D1));
    await expect(bucketRegion(page, 10)).toBeVisible();
    const label = copy.karaoke.slot.label;
    await expect(rowFor(page, 10, "10:00-10:15")).toContainText(label.AVAILABLE);
    await expect(rowFor(page, 10, "10:20-10:35")).toContainText(label.HELD);
    await expect(rowFor(page, 10, "10:40-10:55")).toContainText(label.SOLD);
    await expect(rowFor(page, 12, "12:00-12:15")).toContainText(label.SALES_STOPPED);
    const texts = [label.AVAILABLE, label.HELD, label.SOLD, label.SALES_STOPPED];
    expect(new Set(texts).size).toBe(4);
    // A row shows its own state text only (not another state's), so the text alone tells them apart.
    for (const [hour, time, own] of [
      [10, "10:00-10:15", label.AVAILABLE],
      [10, "10:20-10:35", label.HELD],
      [10, "10:40-10:55", label.SOLD],
      [12, "12:00-12:15", label.SALES_STOPPED],
    ] as const) {
      const text = await rowFor(page, hour, time).innerText();
      for (const other of texts.filter((t) => t !== own)) {
        expect(text, `${time} must not show ${other}`).not.toContain(other);
      }
    }
  });

  test("links only the selectable slots to their slot page", async ({ page }) => {
    await open(page, dayRoute(D1));
    await expect(bucketRegion(page, 10)).toBeVisible();
    const selectable = [
      ["10:00-10:15", SLOT.d1_1000],
      ["11:00-11:15", SLOT.d1_1100],
      ["11:20-11:35", SLOT.d1_1120],
      ["11:40-11:55", SLOT.d1_1140],
      ["13:00-13:15", SLOT.d1_1300],
    ] as const;
    await expect(slotLinks(page)).toHaveCount(selectable.length);
    for (const [time, ref] of selectable) {
      await expect(
        main(page).getByRole("link", { name: copy.karaoke.day.slotLink(time), exact: true }),
      ).toHaveAttribute("href", `/karaoke/slots/${ref}`);
    }
    for (const [hour, time] of [
      [10, "10:20-10:35"],
      [10, "10:40-10:55"],
      [12, "12:00-12:15"],
      [14, "14:00-14:15"],
    ] as const) {
      await expect(rowFor(page, hour, time).getByRole("link")).toHaveCount(0);
    }
  });

  for (const status of ["BEFORE_SALES", "SALES_ENDED", "SUSPENDED"] as const) {
    test(`${status}: no slot is selectable and no AVAILABLE slot reads as selectable`, async ({
      page,
    }) => {
      await open(page, dayRoute(D1), publicScenario({ karaokeSales: status }));
      await expect(bucketRegion(page, 10)).toBeVisible();
      await expect(slotLinks(page)).toHaveCount(0);
      await expect(main(page).getByText(copy.karaoke.slot.label.AVAILABLE)).toHaveCount(0);
      await expect(
        main(page).getByText(copy.availability.label[status], { exact: true }).first(),
      ).toBeVisible();
      // SOLD and HELD stay what they are.
      await expect(rowFor(page, 10, "10:40-10:55")).toContainText(copy.karaoke.slot.label.SOLD);
      await expect(rowFor(page, 10, "10:20-10:35")).toContainText(copy.karaoke.slot.label.HELD);
      await expect(bucketRegion(page, 10)).toContainText(copy.karaoke.day.bucketCount(0, 3));
    });
  }
});

test.describe("TC-PG-KRK-002-613 the date navigation walks only the sales dates (SPEC-050 13.2)", () => {
  test("the first day offers only 'next' and the last day only 'previous'", async ({ page }) => {
    await open(page, dayRoute(D1));
    await expect(bucketRegion(page, 10)).toBeVisible();
    await expect(main(page).getByRole("link", { name: copy.karaoke.day.previous })).toHaveCount(0);
    await expect(main(page).getByRole("link", { name: copy.karaoke.day.next })).toHaveAttribute(
      "href",
      dayRoute(D2),
    );
    await open(page, dayRoute(D2));
    await expect(bucketRegion(page, 8)).toBeVisible();
    await expect(main(page).getByRole("link", { name: copy.karaoke.day.next })).toHaveCount(0);
    await expect(main(page).getByRole("link", { name: copy.karaoke.day.previous })).toHaveAttribute(
      "href",
      dayRoute(D1),
    );
  });

  test("following next and previous changes the day and the heading", async ({ page }) => {
    await open(page, dayRoute(D1));
    await main(page).getByRole("link", { name: copy.karaoke.day.next }).click();
    await expect(page).toHaveURL(new RegExp(`/karaoke/schedule/${D2}$`));
    await expect(
      main(page).getByRole("heading", { level: 2, name: formatBusinessDate(D2) }),
    ).toBeVisible();
    await expect(bucketRegion(page, 8)).toBeVisible();
    await main(page).getByRole("link", { name: copy.karaoke.day.previous }).click();
    await expect(page).toHaveURL(new RegExp(`/karaoke/schedule/${D1}$`));
    await expect(
      main(page).getByRole("heading", { level: 2, name: formatBusinessDate(D1) }),
    ).toBeVisible();
    await expect(bucketRegion(page, 10)).toBeVisible();
  });

  test("links back to the guide", async ({ page }) => {
    await open(page, dayRoute(D1));
    await expect(bucketRegion(page, 10)).toBeVisible();
    await expect(
      main(page).getByRole("link", { name: copy.karaoke.day.backToGuide, exact: true }),
    ).toHaveAttribute("href", "/karaoke");
  });
});

test.describe("TC-PG-KRK-002-614 empty day, failure and loading are three different states (SPEC-050 13.2, 9, 21, 31 item 2)", () => {
  test("a successful read with no slots says there are none and keeps the date navigation", async ({
    page,
  }) => {
    await open(page, dayRoute(D1), publicScenario({ publicFetch: "empty" }));
    await expect(main(page)).toContainText(copy.karaoke.day.empty);
    await expect(main(page).getByRole("link", { name: copy.karaoke.day.next })).toHaveAttribute(
      "href",
      dayRoute(D2),
    );
    await expect(main(page).getByRole("alert")).toHaveCount(0);
    await expect(main(page).getByRole("heading", { level: 3 })).toHaveCount(0);
  });

  test("a failed read says the schedule cannot be fetched, with a reload and no counts or empty wording", async ({
    page,
  }) => {
    await open(page, dayRoute(D1), publicScenario({ publicFetch: "fail" }));
    const alert = main(page).getByRole("alert");
    await expect(alert).toContainText(copy.karaoke.day.unavailable);
    await expect(
      main(page).getByRole("button", { name: copy.karaoke.day.reload, exact: true }),
    ).toBeVisible();
    await expect(main(page)).not.toContainText(copy.karaoke.day.empty);
    await expect(main(page)).not.toContainText(/空き\s*0\s*\/|0件/);
    await expect(main(page).getByRole("heading", { level: 3 })).toHaveCount(0);
    await expect(slotLinks(page)).toHaveCount(0);
  });

  test("reload re-reads only: it recovers after a failure and never writes the mock DB", async ({
    page,
  }) => {
    await open(page, dayRoute(D1), publicScenario({ publicFetch: "fail" }));
    await expect(main(page).getByRole("alert")).toContainText(copy.karaoke.day.unavailable);
    await setScenario(page, {});
    await main(page).getByRole("button", { name: copy.karaoke.day.reload, exact: true }).click();
    await expect(bucketRegion(page, 10)).toBeVisible();
    await expect(main(page).getByRole("alert")).toHaveCount(0);

    const readDb = (): Promise<string | null> =>
      page.evaluate((key) => window.localStorage.getItem(key), KEYS.db);
    const before = await readDb();
    expect(before).not.toBeNull();
    await main(page).getByRole("button", { name: copy.karaoke.day.reload, exact: true }).click();
    await expect(bucketRegion(page, 10)).toBeVisible();
    expect(await readDb()).toBe(before);
    await expect(slotLinks(page)).toHaveCount(5);
  });

  test("loading shows a status, no counts and no empty wording", async ({ page }) => {
    await open(page, dayRoute(D1), publicScenario({ latency: "long", latencyLongMs: 6000 }));
    await expect(h1(page)).toHaveText(copy.karaoke.day.heading);
    await expect(main(page).getByRole("status").first()).toContainText(copy.pageState.loading);
    await expect(main(page)).not.toContainText(LOADING_FORBIDDEN);
    await expect(main(page)).not.toContainText(/空き\s*\d+\s*\//);
    await expect(main(page)).not.toContainText(copy.karaoke.day.empty);
    await expect(main(page).getByRole("heading", { level: 3 })).toHaveCount(0);
    await expect(bucketRegion(page, 10)).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("TC-PG-KRK-002-615 a bad date is Not Found and the page has no purchase operation (SPEC-050 13.2, 19.1, 33)", () => {
  test("an impossible or malformed date is answered with HTTP 404 and the Not Found page", async ({
    page,
  }) => {
    // The day route must work for a sales date, so the 404 checks below cannot pass vacuously.
    await open(page, dayRoute(D1));
    await expect(bucketRegion(page, 10)).toBeVisible();
    for (const bad of ["2027-02-30", "2027-13-01", "abc", "2027-3-8", "20270308"]) {
      const response = await page.goto(`/karaoke/schedule/${bad}`);
      expect(response?.status(), bad).toBe(404);
      await expect(h1(page), bad).toHaveText(copy.notFound.title);
      await expect(main(page), bad).not.toContainText(bad);
    }
  });

  test("a real date that is not a sales date shows the Not Found page, not an empty day", async ({
    page,
  }) => {
    await open(page, "/karaoke/schedule/2030-01-01");
    await expect(h1(page)).toHaveText(copy.notFound.title);
    await expect(h1(page)).toHaveCount(1);
    await expect(main(page)).not.toContainText(copy.karaoke.day.empty);
    await expect(main(page)).not.toContainText(copy.karaoke.day.unavailable);
    await expect(main(page).getByRole("alert")).toHaveCount(0);
  });

  test("offers only the reload button, no Cart, hold or purchase action", async ({ page }) => {
    await open(page, dayRoute(D1));
    await expect(bucketRegion(page, 10)).toBeVisible();
    const names = await main(page).getByRole("button").allInnerTexts();
    expect(names.map((n) => n.trim())).toEqual([copy.karaoke.day.reload]);
    await expect(main(page)).not.toContainText(/カート|確保する|購入する|購入手続き/);
  });
});

test.describe("TC-PG-KRK-002-616 the day schedule is operable by keyboard (SPEC-050 25)", () => {
  test("Tab reaches a selectable slot link and Enter follows it to the slot page", async ({
    page,
  }) => {
    await open(page, dayRoute(D1));
    await expect(bucketRegion(page, 10)).toBeVisible();
    const link = main(page).getByRole("link", {
      name: copy.karaoke.day.slotLink("10:00-10:15"),
      exact: true,
    });
    let reached = false;
    for (let step = 0; step < 100 && !reached; step += 1) {
      await page.keyboard.press("Tab");
      reached = await link.evaluate((el) => el === document.activeElement);
    }
    expect(reached, "the selectable slot link must be reachable with Tab").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/karaoke/slots/${SLOT.d1_1000}$`));
  });

  test("the reload button works with the keyboard", async ({ page }) => {
    await open(page, dayRoute(D1), publicScenario({ publicFetch: "fail" }));
    await expect(main(page).getByRole("alert")).toContainText(copy.karaoke.day.unavailable);
    await setScenario(page, {});
    const reload = main(page).getByRole("button", { name: copy.karaoke.day.reload, exact: true });
    await reload.focus();
    await expect(reload).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(bucketRegion(page, 10)).toBeVisible();
  });
});
