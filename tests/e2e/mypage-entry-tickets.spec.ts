import { expect, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { formatJstDateTime } from "../../apps/web/src/presentation/format/datetime.ts";
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
  retryButtons,
  rowsIn,
  rowWithHref,
  seedTicket,
  ticketPath,
  ticketQrPath,
} from "../harness/browser/mypage.ts";
import { horizontalOverflow, seedState } from "../harness/browser/public.ts";
import { alertsOf, heading1, mainOf, openAs } from "../harness/browser/purchase.ts";
import { KEYS, SITE_NAME } from "../harness/browser/shell.ts";
import { ORDER, RESERVATION, TICKET } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s8-mypage.md sections 4.7 .. 4.9.
// SPEC-050 18.5 / 18.6 / 18.7 (PG-MYP-005 / 006 / 007), 20.2, 24.2, 25, 31 item 16, SEC-QR-012 / 013, INV-010-05.
// The QR is a synthetic placeholder: no real QR token exists anywhere in this suite.

const tickets = () => copy.mypage.entryTickets;
const detail = () => copy.mypage.entryTickets.detail;
const labels = () => copy.entryTicket.label;
const ALL_LABELS = (): string[] => Object.values(copy.entryTicket.label);

const STATES = [
  { name: "valid", ref: TICKET.valid, state: "VALID" },
  { name: "used", ref: TICKET.used, state: "USED" },
  { name: "canceled", ref: TICKET.canceled, state: "CANCELED" },
  { name: "expired", ref: TICKET.expired, state: "EXPIRED" },
] as const;

test.describe("TC-PG-MYP-005-701 the Entry Ticket list shows each Ticket with its own state, name and Order link (E2E 16, SPEC-050 18.5, 20.2)", () => {
  test("lists demo's five Tickets in order, each with exactly one state label and a link to its detail and its Order", async ({
    page,
  }) => {
    await openAs(page, PATH.entryTickets);
    await expect(heading1(page)).toHaveText(tickets().heading);
    await expect(heading1(page)).toHaveCount(1);
    await expect(page).toHaveTitle(new RegExp(`^${tickets().pageTitle} \\|`));
    const rows = rowsIn(mainOf(page));
    await expect(rows).toHaveCount(5);
    const seed = seedState().tickets.filter(
      (t) => t.ref !== TICKET.other && t.orderRef !== ORDER.otherEntry,
    );
    for (const ticket of seed) {
      const row = rowWithHref(mainOf(page), ticketPath(ticket.ref));
      await expect(row, ticket.ref).toHaveCount(1);
      await expect(row).toContainText(ticket.offeringName);
      await expect(row).toContainText(labels()[ticket.state]);
      await expect(row.locator(`a[href="${orderPath(ticket.orderRef)}"]`)).toHaveCount(1);
      const text = await row.innerText();
      expect(
        ALL_LABELS().filter((l) => text.includes(l)),
        `${ticket.ref} ${ticket.state}`,
      ).toEqual([labels()[ticket.state]]);
    }
    // The four Canonical states are four different texts across the list (not colour).
    const text = await mainOf(page).innerText();
    for (const label of ALL_LABELS()) expect(text, label).toContain(label);
    // Another user's Ticket is not listed.
    await expect(rowWithHref(mainOf(page), ticketPath(TICKET.other))).toHaveCount(0);
  });

  test("a row opens the Ticket detail", async ({ page }) => {
    await openAs(page, PATH.entryTickets);
    await rowWithHref(mainOf(page), ticketPath(TICKET.used))
      .locator(`a[href="${ticketPath(TICKET.used)}"]`)
      .click();
    await expect(page).toHaveURL(new RegExp(`${ticketPath(TICKET.used)}$`));
    await expect(heading1(page)).toHaveText(detail().heading);
  });
});

test.describe("TC-PG-MYP-005-702 loading, Empty and a failed read are three different states, and only the viewer's Tickets are listed (SPEC-050 9, 18.5, INV-010-08)", () => {
  test("a user without Tickets sees the Empty message only", async ({ page }) => {
    await openAs(page, PATH.entryTickets, { session: freshSession() });
    await expect(mainOf(page)).toContainText(tickets().empty);
    await expect(rowsIn(mainOf(page))).toHaveCount(0);
    await expect(alertsOf(page)).toHaveCount(0);
  });

  test("another user sees only their own Ticket", async ({ page }) => {
    await openAs(page, PATH.entryTickets, { session: otherSession() });
    await expect(rowsIn(mainOf(page))).toHaveCount(1);
    await expect(rowWithHref(mainOf(page), ticketPath(TICKET.other))).toHaveCount(1);
    await expect(rowWithHref(mainOf(page), ticketPath(TICKET.valid))).toHaveCount(0);
  });

  test("an unreadable list is an unavailable alert with a retry, never the Empty message", async ({
    page,
  }) => {
    await openAs(page, PATH.entryTickets, { extra: { [KEYS.db]: "{ not json" } });
    await expect(alertsOf(page)).toContainText(copy.pageState.unavailable(tickets().subject));
    await expect(mainOf(page)).not.toContainText(tickets().empty);
    await writeStorage(page, KEYS.db, JSON.stringify(seedState()));
    await retryButtons(mainOf(page)).click();
    await expect(rowsIn(mainOf(page))).toHaveCount(5);
  });

  test("while loading no Ticket and no Empty message is shown", async ({ page }) => {
    await openAs(page, PATH.entryTickets, { scenario: { latency: "long", latencyLongMs: 2500 } });
    await expect(mainOf(page).locator('[role="status"]').first()).toContainText(
      copy.pageState.loading,
    );
    expect(await mainOf(page).innerText()).not.toContain(tickets().empty);
    await expect(rowsIn(mainOf(page))).toHaveCount(5, { timeout: 15_000 });
  });
});

test.describe("TC-PG-MYP-006-701 the Ticket detail states the Ticket's state and offers the QR only for a VALID one (E2E 16, SPEC-050 18.6, 20.2, 25)", () => {
  for (const c of STATES) {
    test(`${c.state}: label, usability, and ${c.state === "VALID" ? "a link to the QR" : "a disabled QR action with its reason"}`, async ({
      page,
    }) => {
      await openAs(page, ticketPath(c.ref));
      await expect(heading1(page)).toHaveText(detail().heading);
      await expect(heading1(page)).toHaveCount(1);
      await expect(page).toHaveTitle(new RegExp(`^${detail().pageTitle} \\|`));
      const info = region(page, detail().infoHeading);
      await expect(info).toBeVisible();
      const source = seedTicket(c.ref);
      await expect(info).toContainText(source.offeringName);
      await expect(info).toContainText(detail().kindLabel);
      await expect(info).toContainText(labels()[c.state]);
      await expect(info).toContainText(copy.entryTicket.description[c.state]);
      await expect(info).toContainText(formatJstDateTime(source.issuedAt as never));
      // Exactly one state label (the state is text, and no other state is mixed in).
      const text = await info.innerText();
      expect(ALL_LABELS().filter((l) => text.includes(l))).toEqual([labels()[c.state]]);

      await expect(info).toContainText(detail().usableLabel);
      if (c.state === "VALID") {
        await expect(info).toContainText(detail().usable);
        await expect(info).not.toContainText(detail().notUsable);
        await expect(mainLink(page, detail().qrLink)).toHaveAttribute("href", ticketQrPath(c.ref));
        await expect(mainButton(page, detail().qrLink)).toHaveCount(0);
      } else {
        await expect(info).toContainText(detail().notUsable);
        await expect(mainLink(page, detail().qrLink)).toHaveCount(0);
        const button = mainButton(page, detail().qrLink);
        await expect(button).toBeDisabled();
        const reason = copy.entryTicket.disabledReason[c.state];
        expect(await describedBy(button)).toBe(reason);
        await expect(info).toContainText(reason);
        // The QR is not offered by any href, hidden or not.
        expect(await hrefsIn(mainOf(page))).not.toContain(ticketQrPath(c.ref));
      }
      await expect(mainLink(page, tickets().orderLink)).toHaveAttribute(
        "href",
        orderPath(source.orderRef),
      );
      await expect(mainLink(page, detail().backToList)).toHaveAttribute("href", PATH.entryTickets);
    });
  }
});

test.describe("TC-PG-MYP-006-702 reloading a Ticket page reads the existing Ticket and issues nothing (SPEC-050 22)", () => {
  test("the Business data is identical after a reload", async ({ page }) => {
    await openAs(page, ticketPath(TICKET.valid));
    await expect(heading1(page)).toHaveText(detail().heading);
    const before = await readDbRaw(page);
    await page.reload();
    await expect(heading1(page)).toHaveText(detail().heading);
    await expect(region(page, detail().infoHeading)).toContainText(labels().VALID);
    expect(await readDbRaw(page)).toBe(before);
  });
});

test.describe("TC-PG-MYP-006-703 loading and a failed read are not shown as a Ticket or as Access Denied (SPEC-050 9, 21, 26.2)", () => {
  test("an unreadable Ticket is an unavailable alert with a retry that recovers", async ({
    page,
  }) => {
    await openAs(page, ticketPath(TICKET.valid), { extra: { [KEYS.db]: "{ not json" } });
    await expect(heading1(page)).toHaveText(detail().heading);
    await expect(alertsOf(page)).toContainText(copy.pageState.unavailable(detail().subject));
    await expect(mainOf(page)).not.toContainText(copy.accessDenied.title);
    await expect(mainOf(page)).not.toContainText(labels().VALID);
    await writeStorage(page, KEYS.db, JSON.stringify(seedState()));
    await retryButtons(mainOf(page)).click();
    await expect(region(page, detail().infoHeading)).toContainText(labels().VALID);
  });

  test("while loading only the loading state is shown", async ({ page }) => {
    await openAs(page, ticketPath(TICKET.valid), {
      scenario: { latency: "long", latencyLongMs: 2500 },
    });
    await expect(heading1(page)).toHaveText(detail().heading);
    await expect(mainOf(page).locator('[role="status"]').first()).toContainText(
      copy.pageState.loading,
    );
    const early = await mainOf(page).innerText();
    for (const label of ALL_LABELS()) expect(early).not.toContain(label);
    await expect(region(page, detail().infoHeading)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("TC-PG-MYP-007-701 the Entry QR page of a VALID Ticket shows the Entry title, the state and the QR together (E2E 17, SPEC-050 18.7, 24.2)", () => {
  test("has the Entry title in the document title, the h1 and next to the QR, the Ticket state, the mock notice and a way back", async ({
    page,
  }) => {
    await openAs(page, ticketQrPath(TICKET.valid));
    await expect(heading1(page)).toHaveText(copy.qr.ENTRY);
    await expect(heading1(page)).toHaveCount(1);
    await expect(page).toHaveTitle(`${copy.qr.ENTRY} | ${SITE_NAME}`);
    const figure = figureOf(page);
    await expect(figure).toHaveCount(1);
    await expect(figure).toContainText(copy.qr.ENTRY);
    await expect(figure).toContainText(copy.mypage.qr.ticketStateLabel);
    await expect(figure).toContainText(labels().VALID);
    await expect(figure).toContainText(copy.mypage.qr.mockNotice);
    await expect(
      figure.getByRole("img", { name: copy.mypage.qr.imageLabel.ENTRY, exact: true }),
    ).toBeVisible();
    await expect(qrImages(page)).toHaveCount(1);
    await expect(mainLink(page, copy.mypage.qr.backToTicket)).toHaveAttribute(
      "href",
      ticketPath(TICKET.valid),
    );
    // Nothing of the Karaoke purpose is on this page.
    await expect(mainOf(page)).not.toContainText(copy.qr.KARAOKE);
    await expect(
      page.getByRole("img", { name: copy.mypage.qr.imageLabel.KARAOKE, exact: true }),
    ).toHaveCount(0);
    await expect(alertsOf(page)).toHaveCount(0);
  });
});

test.describe("TC-PG-MYP-007-702 a Ticket that is not VALID is never drawn as a QR; its state is the main text (E2E 16, SPEC-050 18.7, 20.2, 25, SEC-QR-012)", () => {
  for (const c of STATES.filter((s) => s.state !== "VALID")) {
    test(`${c.state}: no QR, the state in text and the reason, still the Entry title`, async ({
      page,
    }) => {
      await openAs(page, ticketQrPath(c.ref));
      await expect(heading1(page)).toHaveText(copy.qr.ENTRY);
      await expect(qrImages(page)).toHaveCount(0);
      await expect(qrImage(page, copy.mypage.qr.imageLabel.ENTRY)).toHaveCount(0);
      await expect(mainOf(page)).toContainText(labels()[c.state]);
      await expect(mainOf(page)).toContainText(copy.entryTicket.disabledReason[c.state]);
      await expect(mainOf(page)).not.toContainText(copy.mypage.qr.mockNotice);
      await expect(mainLink(page, copy.mypage.qr.backToTicket)).toHaveAttribute(
        "href",
        ticketPath(c.ref),
      );
      expect(await pageButtons(page).count()).toBe(0);
      // The state is the only state shown.
      const text = await mainOf(page).innerText();
      expect(ALL_LABELS().filter((l) => text.includes(l))).toContain(labels()[c.state]);
    });
  }
});

test.describe("TC-PG-MYP-007-703 the QR page is its own purpose: a Karaoke ref or another user's Ticket is denied (E2E 17 / 20, SEC-QR-012)", () => {
  test("a Reservation ref and another user's Ticket ref show Access Denied with the Entry Ticket list as the way back", async ({
    page,
  }) => {
    await openAs(page, ticketQrPath(TICKET.valid));
    for (const ref of [TICKET.other, RESERVATION.valid]) {
      await gotoHydrated(page, ticketQrPath(ref));
      await expect(heading1(page)).toHaveText(copy.accessDenied.title);
      await expect(qrImages(page)).toHaveCount(0);
      await expect(mainLink(page, copy.accessDenied.entryTicketsLink)).toHaveAttribute(
        "href",
        PATH.entryTickets,
      );
      await expect(mainOf(page)).not.toContainText(copy.qr.ENTRY);
    }
  });
});

test.describe("TC-PG-MYP-007-704 the QR is large, has margins and does not overflow on Mobile (SPEC-050 18.7, 24.1, 24.2)", () => {
  test("at 390px the QR is at least 200px square, has margin inside its figure and the page does not scroll sideways", async ({
    page,
  }) => {
    await openAs(page, ticketQrPath(TICKET.valid));
    await page.setViewportSize({ width: 390, height: 844 });
    const image = qrImage(page, copy.mypage.qr.imageLabel.ENTRY);
    await expect(image).toBeVisible();
    const box = await image.boundingBox();
    const figureBox = await figureOf(page).boundingBox();
    expect(box).not.toBeNull();
    expect(figureBox).not.toBeNull();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(200);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(200);
    expect((figureBox?.width ?? 0) - (box?.width ?? 0)).toBeGreaterThanOrEqual(16);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    // The state is visible with the QR on the same screen.
    await expect(figureOf(page)).toContainText(labels().VALID);
  });
});
