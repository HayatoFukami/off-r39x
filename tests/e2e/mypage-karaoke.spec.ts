import { expect, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  formatBusinessDate,
  formatJstTime,
  formatJstTimeRange,
} from "../../apps/web/src/presentation/format/datetime.ts";
import { readDbRaw, writeStorage } from "../harness/browser/cart.ts";
import { gotoHydrated } from "../harness/browser/hydration.ts";
import {
  describedBy,
  figureOf,
  freshSession,
  hrefsIn,
  mainButton,
  mainLink,
  orderPath,
  otherSession,
  PATH,
  pageButtons,
  qrImage,
  qrImages,
  region,
  reservationPath,
  reservationQrPath,
  retryButtons,
  rowsIn,
  rowWithHref,
  seedReservation,
  ticketQrPath,
} from "../harness/browser/mypage.ts";
import { horizontalOverflow, seedState } from "../harness/browser/public.ts";
import { alertsOf, heading1, mainOf, openAs } from "../harness/browser/purchase.ts";
import { KEYS, SITE_NAME } from "../harness/browser/shell.ts";
import { D1, ORDER, RESERVATION, TICKET } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s8-mypage.md sections 4.10 .. 4.12.
// SPEC-050 18.8 / 18.9 / 18.10 (PG-MYP-008 / 009 / 010), 20.3, 23, 24.2, 25, 31 items 16 / 17, SEC-QR-012 / 013,
// INV-010-05. The QR is a synthetic placeholder: no real QR token exists anywhere in this suite.

const list = () => copy.mypage.reservations;
const detail = () => copy.mypage.reservations.detail;
const reservationLabel = copy.karaoke.reservation;
const ticketLabel = copy.karaoke.ticket;

type Case = {
  name: string;
  ref: string;
  order: string;
  reservation: "CONFIRMED" | "CANCELED";
  ticket: "VALID" | "USED" | "CANCELED" | "EXPIRED";
  qr: boolean;
  reason: string | null;
  receipt: boolean;
};

const CASES: Case[] = [
  {
    name: "valid",
    ref: RESERVATION.valid,
    order: ORDER.kValid,
    reservation: "CONFIRMED",
    ticket: "VALID",
    qr: true,
    reason: null,
    receipt: false,
  },
  {
    name: "used",
    ref: RESERVATION.used,
    order: ORDER.kUsed,
    reservation: "CONFIRMED",
    ticket: "USED",
    qr: false,
    reason: copy.karaoke.disabledReason.USED,
    receipt: true,
  },
  {
    name: "canceled",
    ref: RESERVATION.canceled,
    order: ORDER.kCanceled,
    reservation: "CANCELED",
    ticket: "CANCELED",
    qr: false,
    reason: copy.karaoke.disabledReason.reservationCanceled,
    receipt: true,
  },
  {
    name: "expired",
    ref: RESERVATION.expired,
    order: ORDER.kExpired,
    reservation: "CONFIRMED",
    ticket: "EXPIRED",
    qr: false,
    reason: copy.karaoke.disabledReason.EXPIRED,
    receipt: true,
  },
];

/** Labels of the other states, which a given Reservation must not show (the Reservation CANCELED label contains the Ticket one). */
function wrongLabels(c: Case): string[] {
  const wrong: string[] = [];
  if (c.reservation === "CONFIRMED") wrong.push(reservationLabel.CANCELED);
  if (c.reservation === "CANCELED") wrong.push(reservationLabel.CONFIRMED);
  for (const state of ["VALID", "USED", "CANCELED", "EXPIRED"] as const) {
    if (state === c.ticket) continue;
    // "予約取消済み" contains "取消済み": the cancelled Ticket label is checked only where it cannot hide in it.
    if (state === "CANCELED" && c.reservation === "CANCELED") continue;
    wrong.push(ticketLabel[state]);
  }
  return wrong;
}

test.describe("TC-PG-MYP-008-701 the Reservation list shows date, time and both states, in time order (E2E 16, SPEC-050 18.8, 20.3)", () => {
  test("lists demo's four Reservations by usage start, each with the Reservation and the Ticket state as text", async ({
    page,
  }) => {
    await openAs(page, PATH.reservations);
    await expect(heading1(page)).toHaveText(list().heading);
    await expect(heading1(page)).toHaveCount(1);
    await expect(page).toHaveTitle(new RegExp(`^${list().pageTitle} \\|`));
    const rows = rowsIn(mainOf(page));
    await expect(rows).toHaveCount(4);
    // 10:40 (expired), 11:40 (canceled), 12:20 (valid), 12:40 (used)
    expect(await hrefsIn(rows)).toEqual(
      [RESERVATION.expired, RESERVATION.canceled, RESERVATION.valid, RESERVATION.used].map(
        reservationPath,
      ),
    );
    for (const c of CASES) {
      const { slot } = seedReservation(c.ref);
      const row = rowWithHref(mainOf(page), reservationPath(c.ref));
      await expect(row, c.name).toHaveCount(1);
      await expect(row).toContainText(formatBusinessDate(D1));
      await expect(row).toContainText(
        formatJstTimeRange(slot.usageStart as never, slot.usageEnd as never),
      );
      await expect(row).toContainText(list().reservationStateLabel);
      await expect(row).toContainText(list().ticketStateLabel);
      await expect(row).toContainText(reservationLabel[c.reservation]);
      await expect(row).toContainText(ticketLabel[c.ticket]);
      const text = await row.innerText();
      for (const wrong of wrongLabels(c)) expect(text, `${c.name}: ${wrong}`).not.toContain(wrong);
    }
  });

  test("a used Ticket is shown on the Ticket, not as a Reservation state of its own", async ({
    page,
  }) => {
    await openAs(page, PATH.reservations);
    const row = rowWithHref(mainOf(page), reservationPath(RESERVATION.used));
    await expect(row).toContainText(reservationLabel.CONFIRMED);
    await expect(row).toContainText(ticketLabel.USED);
    // No Reservation label of any row says "used".
    const allText = await mainOf(page).innerText();
    expect(Object.values(reservationLabel).some((l) => l.includes("使用済み"))).toBe(false);
    expect(allText).toContain(ticketLabel.USED);
  });

  test("a row opens the Reservation detail", async ({ page }) => {
    await openAs(page, PATH.reservations);
    await rowWithHref(mainOf(page), reservationPath(RESERVATION.valid))
      .getByRole("link")
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`${reservationPath(RESERVATION.valid)}$`));
    await expect(heading1(page)).toHaveText(detail().heading);
  });
});

test.describe("TC-PG-MYP-008-702 loading, Empty and a failed read are three different states, and only the viewer's Reservations are listed (SPEC-050 9, 18.8, INV-010-08)", () => {
  test("a user without Reservations sees the Empty message only", async ({ page }) => {
    await openAs(page, PATH.reservations, { session: freshSession() });
    await expect(mainOf(page)).toContainText(list().empty);
    await expect(rowsIn(mainOf(page))).toHaveCount(0);
    await expect(alertsOf(page)).toHaveCount(0);
  });

  test("another user sees only their own Reservation", async ({ page }) => {
    await openAs(page, PATH.reservations, { session: otherSession() });
    await expect(rowsIn(mainOf(page))).toHaveCount(1);
    await expect(rowWithHref(mainOf(page), reservationPath(RESERVATION.other))).toHaveCount(1);
    await expect(rowWithHref(mainOf(page), reservationPath(RESERVATION.valid))).toHaveCount(0);
  });

  test("an unreadable list is an unavailable alert with a retry, never the Empty message", async ({
    page,
  }) => {
    await openAs(page, PATH.reservations, { extra: { [KEYS.db]: "{ not json" } });
    await expect(alertsOf(page)).toContainText(copy.pageState.unavailable(list().subject));
    await expect(mainOf(page)).not.toContainText(list().empty);
    await writeStorage(page, KEYS.db, JSON.stringify(seedState()));
    await retryButtons(mainOf(page)).click();
    await expect(rowsIn(mainOf(page))).toHaveCount(4);
  });

  test("while loading no Reservation and no Empty message is shown", async ({ page }) => {
    await openAs(page, PATH.reservations, { scenario: { latency: "long", latencyLongMs: 2500 } });
    await expect(mainOf(page).locator('[role="status"]').first()).toContainText(
      copy.pageState.loading,
    );
    expect(await mainOf(page).innerText()).not.toContain(list().empty);
    await expect(rowsIn(mainOf(page))).toHaveCount(4, { timeout: 15_000 });
  });
});

test.describe("TC-PG-MYP-009-701 the Reservation detail shows the date, the times and both states, and offers the QR only for CONFIRMED + VALID (E2E 16, SPEC-050 18.9, 20.3)", () => {
  for (const c of CASES) {
    test(`${c.reservation} + ${c.ticket}`, async ({ page }) => {
      await openAs(page, reservationPath(c.ref));
      await expect(heading1(page)).toHaveText(detail().heading);
      await expect(heading1(page)).toHaveCount(1);
      await expect(page).toHaveTitle(new RegExp(`^${detail().pageTitle} \\|`));
      const info = region(page, detail().infoHeading);
      await expect(info).toBeVisible();
      const { slot } = seedReservation(c.ref);
      await expect(info).toContainText(list().dateLabel);
      await expect(info).toContainText(formatBusinessDate(D1));
      await expect(info).toContainText(detail().startLabel);
      await expect(info).toContainText(formatJstTime(slot.usageStart as never));
      await expect(info).toContainText(detail().endLabel);
      await expect(info).toContainText(formatJstTime(slot.usageEnd as never));
      await expect(info).toContainText(list().reservationStateLabel);
      await expect(info).toContainText(reservationLabel[c.reservation]);
      await expect(info).toContainText(list().ticketStateLabel);
      await expect(info).toContainText(ticketLabel[c.ticket]);
      const text = await info.innerText();
      for (const wrong of wrongLabels(c)) expect(text, `${c.name}: ${wrong}`).not.toContain(wrong);

      if (c.qr) {
        await expect(mainLink(page, detail().qrLink)).toHaveAttribute(
          "href",
          reservationQrPath(c.ref),
        );
        await expect(mainButton(page, detail().qrLink)).toHaveCount(0);
      } else {
        await expect(mainLink(page, detail().qrLink)).toHaveCount(0);
        const button = mainButton(page, detail().qrLink);
        await expect(button).toBeDisabled();
        expect(await describedBy(button)).toBe(c.reason);
        await expect(info).toContainText(c.reason ?? "");
        expect(await hrefsIn(mainOf(page))).not.toContain(reservationQrPath(c.ref));
      }
      await expect(mainLink(page, list().orderLink)).toHaveAttribute("href", orderPath(c.order));
      await expect(mainLink(page, detail().backToList)).toHaveAttribute("href", PATH.reservations);

      // Receipt: shown only when the Order has a safe https URL (the first seed Order has none).
      const receipt = mainLink(page, copy.purchase.receipt.link);
      if (c.receipt) {
        await expect(receipt).toHaveAttribute(
          "href",
          `https://receipt.example.com/mock/${c.order}`,
        );
        await expect(receipt).toHaveAttribute("target", "_blank");
        await expect(receipt).toHaveAttribute("rel", /noopener/);
      } else {
        await expect(receipt).toHaveCount(0);
      }
    });
  }
});

test.describe("TC-PG-MYP-009-702 reloading a Reservation page reads the existing Reservation and creates no Hold or Reservation (SPEC-050 22)", () => {
  test("the Business data (Orders, Reservations, Slots) is identical after a reload", async ({
    page,
  }) => {
    await openAs(page, reservationPath(RESERVATION.valid));
    await expect(heading1(page)).toHaveText(detail().heading);
    const before = await readDbRaw(page);
    await page.reload();
    await expect(heading1(page)).toHaveText(detail().heading);
    await expect(region(page, detail().infoHeading)).toContainText(ticketLabel.VALID);
    expect(await readDbRaw(page)).toBe(before);
  });
});

test.describe("TC-PG-MYP-009-703 loading and a failed read are not shown as a Reservation or as Access Denied (SPEC-050 9, 21, 26.2)", () => {
  test("an unreadable Reservation is an unavailable alert with a retry that recovers", async ({
    page,
  }) => {
    await openAs(page, reservationPath(RESERVATION.valid), { extra: { [KEYS.db]: "{ not json" } });
    await expect(heading1(page)).toHaveText(detail().heading);
    await expect(alertsOf(page)).toContainText(copy.pageState.unavailable(detail().subject));
    await expect(mainOf(page)).not.toContainText(copy.accessDenied.title);
    await writeStorage(page, KEYS.db, JSON.stringify(seedState()));
    await retryButtons(mainOf(page)).click();
    await expect(region(page, detail().infoHeading)).toContainText(ticketLabel.VALID);
  });

  test("while loading only the loading state is shown", async ({ page }) => {
    await openAs(page, reservationPath(RESERVATION.valid), {
      scenario: { latency: "long", latencyLongMs: 2500 },
    });
    await expect(mainOf(page).locator('[role="status"]').first()).toContainText(
      copy.pageState.loading,
    );
    expect(await mainOf(page).innerText()).not.toContain(formatBusinessDate(D1));
    await expect(region(page, detail().infoHeading)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("TC-PG-MYP-010-701 the Karaoke QR page shows the Karaoke title, the date, the times and both states next to a QR only for CONFIRMED + VALID (E2E 16 / 17, SPEC-050 18.10, 24.2)", () => {
  test("CONFIRMED + VALID: the QR with the Karaoke title, date, time, states and the mock notice in one figure", async ({
    page,
  }) => {
    await openAs(page, reservationQrPath(RESERVATION.valid));
    await expect(heading1(page)).toHaveText(copy.qr.KARAOKE);
    await expect(heading1(page)).toHaveCount(1);
    await expect(page).toHaveTitle(`${copy.qr.KARAOKE} | ${SITE_NAME}`);
    const { slot } = seedReservation(RESERVATION.valid);
    const figure = figureOf(page);
    await expect(figure).toHaveCount(1);
    await expect(figure).toContainText(copy.qr.KARAOKE);
    await expect(figure).toContainText(copy.mypage.qr.dateLabel);
    await expect(figure).toContainText(formatBusinessDate(D1));
    await expect(figure).toContainText(copy.mypage.qr.timeLabel);
    await expect(figure).toContainText(
      formatJstTimeRange(slot.usageStart as never, slot.usageEnd as never),
    );
    await expect(figure).toContainText(copy.mypage.qr.reservationStateLabel);
    await expect(figure).toContainText(reservationLabel.CONFIRMED);
    await expect(figure).toContainText(copy.mypage.qr.ticketStateLabel);
    await expect(figure).toContainText(ticketLabel.VALID);
    await expect(figure).toContainText(copy.mypage.qr.mockNotice);
    await expect(
      figure.getByRole("img", { name: copy.mypage.qr.imageLabel.KARAOKE, exact: true }),
    ).toBeVisible();
    await expect(qrImages(page)).toHaveCount(1);
    await expect(mainLink(page, copy.mypage.qr.backToReservation)).toHaveAttribute(
      "href",
      reservationPath(RESERVATION.valid),
    );
    await expect(alertsOf(page)).toHaveCount(0);
  });

  for (const c of CASES.filter((x) => !x.qr)) {
    test(`${c.reservation} + ${c.ticket}: no QR, the state in text and the reason, still the Karaoke title and the date`, async ({
      page,
    }) => {
      await openAs(page, reservationQrPath(c.ref));
      await expect(heading1(page)).toHaveText(copy.qr.KARAOKE);
      await expect(qrImages(page)).toHaveCount(0);
      await expect(qrImage(page, copy.mypage.qr.imageLabel.KARAOKE)).toHaveCount(0);
      await expect(mainOf(page)).not.toContainText(copy.mypage.qr.mockNotice);
      await expect(mainOf(page)).toContainText(c.reason ?? "");
      // The main state is the Ticket one (a cancelled Reservation reads as cancelled).
      const main =
        c.reservation === "CANCELED" ? copy.karaoke.primary.CANCELED : ticketLabel[c.ticket];
      await expect(mainOf(page)).toContainText(main);
      await expect(figureOf(page)).toContainText(formatBusinessDate(D1));
      await expect(mainLink(page, copy.mypage.qr.backToReservation)).toHaveAttribute(
        "href",
        reservationPath(c.ref),
      );
      expect(await pageButtons(page).count()).toBe(0);
    });
  }
});

test.describe("TC-PG-MYP-010-702 the Entry QR and the Karaoke QR cannot be mistaken for each other (E2E 17, SPEC-050 18.10, 24.2, SEC-QR-012)", () => {
  test("title, document title, caption, image label and supporting information differ between the two pages", async ({
    page,
  }) => {
    await openAs(page, ticketQrPath(TICKET.valid));
    const entryTitle = await page.title();
    await expect(heading1(page)).toHaveText(copy.qr.ENTRY);
    await expect(figureOf(page)).toContainText(copy.qr.ENTRY);
    const entryFigure = await figureOf(page).innerText();
    await expect(qrImage(page, copy.mypage.qr.imageLabel.ENTRY)).toBeVisible();
    await expect(mainOf(page)).not.toContainText(copy.qr.KARAOKE);
    await expect(
      page.getByRole("img", { name: copy.mypage.qr.imageLabel.KARAOKE, exact: true }),
    ).toHaveCount(0);

    await gotoHydrated(page, reservationQrPath(RESERVATION.valid));
    const karaokeTitle = await page.title();
    await expect(heading1(page)).toHaveText(copy.qr.KARAOKE);
    await expect(figureOf(page)).toContainText(copy.qr.KARAOKE);
    const karaokeFigure = await figureOf(page).innerText();
    await expect(qrImage(page, copy.mypage.qr.imageLabel.KARAOKE)).toBeVisible();
    await expect(mainOf(page)).not.toContainText(copy.qr.ENTRY);
    await expect(
      page.getByRole("img", { name: copy.mypage.qr.imageLabel.ENTRY, exact: true }),
    ).toHaveCount(0);

    expect(karaokeTitle).not.toBe(entryTitle);
    expect(entryFigure).not.toContain(copy.mypage.qr.dateLabel);
    expect(karaokeFigure).toContain(copy.mypage.qr.dateLabel);
    expect(karaokeFigure).not.toBe(entryFigure);
  });
});

test.describe("TC-PG-MYP-010-703 the Karaoke QR route is its own purpose: a Ticket ref or another user's Reservation is denied (E2E 20, SEC-QR-012)", () => {
  test("denies an Entry Ticket ref and another user's Reservation, showing nothing and offering the Reservation list", async ({
    page,
  }) => {
    await openAs(page, reservationQrPath(RESERVATION.valid));
    for (const ref of [TICKET.valid, RESERVATION.other]) {
      await gotoHydrated(page, reservationQrPath(ref));
      await expect(heading1(page)).toHaveText(copy.accessDenied.title);
      await expect(qrImages(page)).toHaveCount(0);
      await expect(mainOf(page)).not.toContainText(copy.qr.KARAOKE);
      await expect(mainLink(page, copy.accessDenied.reservationsLink)).toHaveAttribute(
        "href",
        PATH.reservations,
      );
    }
  });
});

test.describe("TC-PG-MYP-010-704 the Karaoke QR is large, has margins and does not overflow on Mobile (SPEC-050 18.10, 24.1, 24.2)", () => {
  test("at 390px the QR is at least 200px square with margin in its figure, and the date and states are on the same screen", async ({
    page,
  }) => {
    await openAs(page, reservationQrPath(RESERVATION.valid));
    await page.setViewportSize({ width: 390, height: 844 });
    const image = qrImage(page, copy.mypage.qr.imageLabel.KARAOKE);
    await expect(image).toBeVisible();
    const box = await image.boundingBox();
    const figureBox = await figureOf(page).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(200);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(200);
    expect((figureBox?.width ?? 0) - (box?.width ?? 0)).toBeGreaterThanOrEqual(16);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expect(figureOf(page)).toContainText(formatBusinessDate(D1));
    await expect(figureOf(page)).toContainText(ticketLabel.VALID);
  });
});
