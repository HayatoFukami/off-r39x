import { expect, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { formatBusinessDate } from "../../apps/web/src/presentation/format/datetime.ts";
import { readDbRaw, writeStorage } from "../harness/browser/cart.ts";
import {
  DEMO_NAME,
  FRESH_NAME,
  freshSession,
  hrefsIn,
  mainLink,
  orderPath,
  PATH,
  region,
  reservationPath,
  retryButtons,
  rowsIn,
  rowWithHref,
} from "../harness/browser/mypage.ts";
import { seedState } from "../harness/browser/public.ts";
import {
  alertsOf,
  ENTITLEMENT_HREF,
  heading1,
  mainOf,
  openAs,
  statusLive,
} from "../harness/browser/purchase.ts";
import { KEYS } from "../harness/browser/shell.ts";
import { D1, EMAIL, ORDER, RESERVATION } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s8-mypage.md section 4.3.
// SPEC-050 18.1 (PG-MYP-001), 9.2, 20.1, 21, 31 items 14 / 19, INV-010-01 / 06 / 07 / 08.

const overview = () => copy.mypage.overview;
const AREAS = () => [
  overview().profileHeading,
  overview().pendingHeading,
  overview().latestHeading,
  overview().ticketsHeading,
  overview().karaokeHeading,
  overview().goodsHeading,
];

test.describe("TC-PG-MYP-001-701 the Overview of a user with every state summarises each area and links to the details (E2E 14, SPEC-050 18.1)", () => {
  test("has the h1 and six regions in order, each with its content", async ({ page }) => {
    await openAs(page, PATH.overview);
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    await expect(heading1(page)).toHaveCount(1);
    await expect(region(page, overview().profileHeading)).toBeVisible();
    expect(await mainOf(page).getByRole("heading", { level: 2 }).allInnerTexts()).toEqual(AREAS());

    // Profile summary (Account / Profile).
    const profile = region(page, overview().profileHeading);
    await expect(profile).toContainText(DEMO_NAME);
    await expect(profile).toContainText(EMAIL.demo);
    await expect(
      profile.getByRole("link", { name: overview().profileLink, exact: true }),
    ).toHaveAttribute("href", PATH.profile);

    // Unconfirmed Orders: PREPARED, AWAITING_PAYMENT, REVIEW_REQUIRED, newest first.
    const pending = region(page, overview().pendingHeading);
    await expect(rowsIn(pending)).toHaveCount(3);
    expect(await hrefsIn(rowsIn(pending))).toEqual([
      orderPath(ORDER.prepared),
      orderPath(ORDER.awaiting),
      orderPath(ORDER.review),
    ]);
    await expect(rowWithHref(pending, orderPath(ORDER.prepared))).toContainText(
      copy.order.state.PREPARED,
    );
    await expect(rowWithHref(pending, orderPath(ORDER.awaiting))).toContainText(
      copy.order.state.AWAITING_PAYMENT,
    );
    await expect(rowWithHref(pending, orderPath(ORDER.review))).toContainText(
      copy.order.state.REVIEW_REQUIRED,
    );
    await expect(
      pending.getByRole("link", { name: overview().ordersLink, exact: true }),
    ).toHaveAttribute("href", PATH.orders);
    await expect(pending).not.toContainText(overview().pendingEmpty);

    // Latest Order: the newest one (PREPARED, one hour ago).
    const latest = region(page, overview().latestHeading);
    await expect(rowsIn(latest)).toHaveCount(1);
    await expect(rowWithHref(latest, orderPath(ORDER.prepared))).toContainText(
      copy.order.state.PREPARED,
    );
    await expect(latest).not.toContainText(overview().latestEmpty);

    // Entry Ticket summary: 2 valid of 5.
    const tickets = region(page, overview().ticketsHeading);
    await expect(tickets).toContainText(overview().ticketsSummary(2, 5));
    await expect(
      tickets.getByRole("link", { name: overview().ticketsLink, exact: true }),
    ).toHaveAttribute("href", PATH.entryTickets);

    // Upcoming Karaoke: the one CONFIRMED + VALID Reservation (12:20-12:35 JST on D1).
    const karaoke = region(page, overview().karaokeHeading);
    await expect(rowsIn(karaoke)).toHaveCount(1);
    const row = rowWithHref(karaoke, reservationPath(RESERVATION.valid));
    await expect(row).toContainText(formatBusinessDate(D1));
    await expect(row).toContainText("12:20-12:35");
    await expect(row).toContainText(copy.karaoke.reservation.CONFIRMED);
    await expect(row).toContainText(copy.karaoke.ticket.VALID);
    await expect(
      karaoke.getByRole("link", { name: overview().karaokeLink, exact: true }),
    ).toHaveAttribute("href", PATH.reservations);

    // Goods waiting for pickup: only the one FULFILLABLE + PENDING item.
    const goods = region(page, overview().goodsHeading);
    await expect(goods).toContainText(overview().goodsSummary(1));
    await expect(
      goods.getByRole("link", { name: overview().goodsLink, exact: true }),
    ).toHaveAttribute("href", PATH.goodsItems);

    // Settled: nothing is loading and nothing failed.
    await expect(alertsOf(page)).toHaveCount(0);
    await expect(statusLive(page)).toHaveCount(0);
  });

  test("an unconfirmed Order links only to its own detail, never to a right (INV-010-07)", async ({
    page,
  }) => {
    await openAs(page, PATH.overview);
    const pending = region(page, overview().pendingHeading);
    await expect(rowsIn(pending)).toHaveCount(3);
    for (const href of await hrefsIn(pending)) {
      expect(ENTITLEMENT_HREF.test(href), href).toBe(false);
    }
    const latest = region(page, overview().latestHeading);
    for (const href of await hrefsIn(latest)) expect(ENTITLEMENT_HREF.test(href), href).toBe(false);
  });

  test("every area reaches its page: the pending Order opens the Order detail", async ({
    page,
  }) => {
    await openAs(page, PATH.overview);
    const pending = region(page, overview().pendingHeading);
    await rowWithHref(pending, orderPath(ORDER.awaiting)).getByRole("link").first().click();
    await expect(page).toHaveURL(new RegExp(`${orderPath(ORDER.awaiting)}$`));
    await expect(heading1(page)).toHaveText(copy.mypage.orders.detail.heading);
  });
});

test.describe("TC-PG-MYP-001-702 a user with no purchases sees five distinct Empty states, not failures (SPEC-050 9.2, 18.1)", () => {
  test("shows the profile and the five Empty messages in their own regions", async ({ page }) => {
    await openAs(page, PATH.overview, { session: freshSession() });
    await expect(region(page, overview().profileHeading)).toContainText(FRESH_NAME);
    await expect(region(page, overview().profileHeading)).toContainText(EMAIL.fresh);
    await expect(region(page, overview().pendingHeading)).toContainText(overview().pendingEmpty);
    await expect(region(page, overview().latestHeading)).toContainText(overview().latestEmpty);
    await expect(region(page, overview().ticketsHeading)).toContainText(overview().ticketsEmpty);
    await expect(region(page, overview().karaokeHeading)).toContainText(overview().karaokeEmpty);
    await expect(region(page, overview().goodsHeading)).toContainText(overview().goodsEmpty);
    await expect(rowsIn(mainOf(page))).toHaveCount(0);
    await expect(alertsOf(page)).toHaveCount(0);
    await expect(mainOf(page)).not.toContainText(DEMO_NAME);
    await expect(mainOf(page)).not.toContainText(EMAIL.demo);
    const text = await mainOf(page).innerText();
    expect(text).not.toMatch(/取得できません/);
  });
});

test.describe("TC-PG-MYP-001-703 a failed read is not an Empty and is retried area by area (SPEC-050 9.3, 18.1 State, 21)", () => {
  test("with the data unreadable every area says so and offers its own retry; one retry recovers only its area", async ({
    page,
  }) => {
    await openAs(page, PATH.overview, { extra: { [KEYS.db]: "{ not json" } });
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    const subjects: [string, string][] = [
      [overview().profileHeading, overview().profileSubject],
      [overview().pendingHeading, overview().pendingSubject],
      [overview().latestHeading, overview().latestSubject],
      [overview().ticketsHeading, overview().ticketsSubject],
      [overview().karaokeHeading, overview().karaokeSubject],
      [overview().goodsHeading, overview().goodsSubject],
    ];
    for (const [heading, subject] of subjects) {
      const area = region(page, heading);
      await expect(area, heading).toContainText(copy.pageState.unavailable(subject));
      await expect(retryButtons(area), heading).toHaveCount(1);
    }
    for (const empty of [
      overview().pendingEmpty,
      overview().latestEmpty,
      overview().ticketsEmpty,
      overview().karaokeEmpty,
      overview().goodsEmpty,
    ]) {
      await expect(mainOf(page)).not.toContainText(empty);
    }
    await expect(mainOf(page)).not.toContainText(DEMO_NAME);

    // The data is readable again: only the retried area changes (profile), the others keep failing until retried.
    await writeStorage(page, KEYS.db, JSON.stringify(seedState()));
    await retryButtons(region(page, overview().profileHeading)).click();
    await expect(region(page, overview().profileHeading)).toContainText(DEMO_NAME);
    await expect(region(page, overview().profileHeading)).not.toContainText(
      copy.pageState.unavailable(overview().profileSubject),
    );
    await expect(region(page, overview().ticketsHeading)).toContainText(
      copy.pageState.unavailable(overview().ticketsSubject),
    );
    await expect(region(page, overview().goodsHeading)).toContainText(
      copy.pageState.unavailable(overview().goodsSubject),
    );

    await retryButtons(region(page, overview().ticketsHeading)).click();
    await expect(region(page, overview().ticketsHeading)).toContainText(
      overview().ticketsSummary(2, 5),
    );
  });
});

test.describe("TC-PG-MYP-001-704 Email failure does not change what the Overview shows (E2E 19, SPEC-050 18.1 State, INV-010-06)", () => {
  test("with a delayed confirmation Email the confirmed Tickets, Karaoke and Goods are still shown, with no failure", async ({
    page,
  }) => {
    await openAs(page, PATH.overview, { scenario: { notification: "failed_retryable" } });
    await expect(region(page, overview().ticketsHeading)).toContainText(
      overview().ticketsSummary(2, 5),
    );
    await expect(rowsIn(region(page, overview().karaokeHeading))).toHaveCount(1);
    await expect(region(page, overview().goodsHeading)).toContainText(overview().goodsSummary(1));
    await expect(rowsIn(region(page, overview().pendingHeading))).toHaveCount(3);
    await expect(alertsOf(page)).toHaveCount(0);
    await expect(mainOf(page)).not.toContainText(copy.notification.FAILED_RETRYABLE.message);
  });
});

test.describe("TC-PG-MYP-001-705 while the Overview is loading no business result is shown (SPEC-050 9.1, 21)", () => {
  test("every area shows only the loading state until its read finishes, then the real data", async ({
    page,
  }) => {
    await openAs(page, PATH.overview, { scenario: { latency: "long", latencyLongMs: 2500 } });
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    for (const heading of AREAS()) {
      await expect(region(page, heading), heading).toContainText(copy.pageState.loading);
    }
    const early = await mainOf(page).innerText();
    expect(early).not.toContain(DEMO_NAME);
    expect(early).not.toContain(overview().ticketsSummary(2, 5));
    for (const empty of [
      overview().pendingEmpty,
      overview().latestEmpty,
      overview().ticketsEmpty,
      overview().karaokeEmpty,
      overview().goodsEmpty,
    ]) {
      expect(early).not.toContain(empty);
    }
    expect(early).not.toMatch(/[¥￥]\s*\d/);
    await expect(region(page, overview().profileHeading)).toContainText(DEMO_NAME, {
      timeout: 15_000,
    });
    await expect(region(page, overview().ticketsHeading)).toContainText(
      overview().ticketsSummary(2, 5),
      {
        timeout: 15_000,
      },
    );
    expect(await readDbRaw(page)).not.toBeNull();
    await expect(mainLink(page, overview().profileLink)).toHaveAttribute("href", PATH.profile);
  });
});
