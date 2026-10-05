import { expect, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { readDbRaw } from "../harness/browser/cart.ts";
import { gotoHydrated } from "../harness/browser/hydration.ts";
import {
  freshSession,
  goodsItemPath,
  mainButton,
  mainLink,
  orderPath,
  otherSession,
  PATH,
  pageButtons,
  qrImages,
  reservationPath,
  reservationQrPath,
  ticketPath,
  ticketQrPath,
} from "../harness/browser/mypage.ts";
import { fixClock } from "../harness/browser/public.ts";
import {
  alertsOf,
  heading1,
  mainOf,
  ORDER_STATE_LIST,
  openAs,
  seenTexts,
  watchTexts,
} from "../harness/browser/purchase.ts";
import { seedLocalStorage } from "../harness/browser/shell.ts";
import { GOODS_ITEM, ORDER, RESERVATION, TICKET } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s8-mypage.md section 5.
// SPEC-050 17.1, 19.2 (PG-XFN-003), 26.2, 31 item 20, SPEC-110 22, SPEC-060 AR-AZ-011, INV-010-08, SEC-QR-012.

type Kind = {
  name: string;
  path: (ref: string) => string;
  own: string;
  /** Refs that must all give the same answer: another user's, a missing one, a malformed one, an upper-case one, a wrong-purpose one. */
  others: { name: string; ref: string }[];
  listHref: string;
  listLabel: () => string;
  /** Text that exists only on the ready page of this kind (never on the Access Denied view). */
  readyOnly: () => string[];
};

const MISSING = (prefix: string): string => `${prefix}-0000-4000-8000-0000000009ff`;

const KINDS: Kind[] = [
  {
    name: "Order detail",
    path: orderPath,
    own: ORDER.confirmedEntry,
    others: [
      { name: "another user's Entry Order", ref: ORDER.otherEntry },
      { name: "another user's Goods Order", ref: ORDER.otherGoods },
      { name: "another user's Karaoke Order", ref: ORDER.otherKaraoke },
      { name: "a missing Order", ref: MISSING("0d000000") },
      { name: "a malformed ref", ref: "not-a-uuid" },
      { name: "an upper-case ref", ref: ORDER.otherEntry.toUpperCase() },
    ],
    listHref: PATH.orders,
    listLabel: () => copy.accessDenied.ordersLink,
    readyOnly: () => [copy.purchase.outcomeHeading, copy.purchase.itemsHeading, "14:00-14:15"],
  },
  {
    name: "Entry Ticket detail",
    path: ticketPath,
    own: TICKET.valid,
    others: [
      { name: "another user's Ticket", ref: TICKET.other },
      { name: "a missing Ticket", ref: MISSING("7c000000") },
      { name: "a malformed ref", ref: "not-a-uuid" },
      { name: "an upper-case ref", ref: TICKET.other.toUpperCase() },
      { name: "a Reservation ref (another purpose)", ref: RESERVATION.valid },
    ],
    listHref: PATH.entryTickets,
    listLabel: () => copy.accessDenied.entryTicketsLink,
    readyOnly: () => [copy.mypage.entryTickets.detail.infoHeading],
  },
  {
    name: "Entry QR",
    path: ticketQrPath,
    own: TICKET.valid,
    others: [
      { name: "another user's Ticket", ref: TICKET.other },
      { name: "a missing Ticket", ref: MISSING("7c000000") },
      { name: "a malformed ref", ref: "not-a-uuid" },
      { name: "a Reservation ref (another purpose)", ref: RESERVATION.valid },
    ],
    listHref: PATH.entryTickets,
    listLabel: () => copy.accessDenied.entryTicketsLink,
    readyOnly: () => [copy.mypage.qr.ticketStateLabel, copy.mypage.qr.mockNotice, copy.qr.ENTRY],
  },
  {
    name: "Reservation detail",
    path: reservationPath,
    own: RESERVATION.valid,
    others: [
      { name: "another user's Reservation", ref: RESERVATION.other },
      { name: "a missing Reservation", ref: MISSING("4e000000") },
      { name: "a malformed ref", ref: "not-a-uuid" },
      { name: "an upper-case ref", ref: RESERVATION.other.toUpperCase() },
      { name: "an Entry Ticket ref (another purpose)", ref: TICKET.valid },
    ],
    listHref: PATH.reservations,
    listLabel: () => copy.accessDenied.reservationsLink,
    readyOnly: () => [copy.mypage.reservations.detail.infoHeading, "14:00-14:15"],
  },
  {
    name: "Karaoke QR",
    path: reservationQrPath,
    own: RESERVATION.valid,
    others: [
      { name: "another user's Reservation", ref: RESERVATION.other },
      { name: "a missing Reservation", ref: MISSING("4e000000") },
      { name: "a malformed ref", ref: "not-a-uuid" },
      { name: "an Entry Ticket ref (another purpose)", ref: TICKET.valid },
    ],
    listHref: PATH.reservations,
    listLabel: () => copy.accessDenied.reservationsLink,
    readyOnly: () => [
      copy.mypage.qr.reservationStateLabel,
      copy.mypage.qr.mockNotice,
      copy.qr.KARAOKE,
      "14:00-14:15",
    ],
  },
  {
    name: "Goods detail",
    path: goodsItemPath,
    own: GOODS_ITEM.fulfillable,
    others: [
      { name: "another user's item", ref: GOODS_ITEM.other },
      { name: "a missing item", ref: MISSING("91000000") },
      { name: "a malformed ref", ref: "not-a-uuid" },
      { name: "an upper-case ref", ref: GOODS_ITEM.other.toUpperCase() },
    ],
    listHref: PATH.goodsItems,
    listLabel: () => copy.accessDenied.goodsItemsLink,
    readyOnly: () => [copy.mypage.goodsItems.detail.infoHeading, copy.goods.detail.pickupNotice],
  },
];

const parsed = (raw: string | null): unknown => (raw === null ? null : JSON.parse(raw));

test.describe("TC-PG-XFN-003-701 another user's reference, a missing one, a malformed one and one of another purpose are indistinguishable and reveal nothing (E2E 20, SPEC-050 19.2, 26.2, SPEC-110 22)", () => {
  for (const kind of KINDS) {
    test(`${kind.name}: the same Access Denied view for every one, with the way back, and no ready content at any moment`, async ({
      page,
    }) => {
      const stateLabels = ORDER_STATE_LIST.map((s) => copy.order.state[s]);
      await watchTexts(page, kind.readyOnly());
      await openAs(page, kind.path(kind.others[0]?.ref ?? ""));
      const dbBefore = parsed(await readDbRaw(page));

      const texts: string[] = [];
      for (const target of kind.others) {
        await gotoHydrated(page, kind.path(target.ref));
        const where = `${kind.name} / ${target.name}`;
        await expect(heading1(page), where).toHaveText(copy.accessDenied.title);
        await expect(heading1(page), where).toHaveCount(1);
        await expect(mainOf(page)).toContainText(copy.accessDenied.description);
        // No redirect to a fixed URL that could carry the identifier: the page stays where it was asked.
        expect(new URL(page.url()).pathname.toLowerCase(), where).toBe(
          kind.path(target.ref).toLowerCase(),
        );
        await expect(mainLink(page, copy.accessDenied.mypageLink)).toHaveAttribute(
          "href",
          PATH.overview,
        );
        await expect(mainLink(page, kind.listLabel())).toHaveAttribute("href", kind.listHref);
        // A retry cannot grant access (SPEC-050 19.2): nothing can be pressed, nothing is an alert.
        expect(await pageButtons(page).count(), where).toBe(0);
        await expect(alertsOf(page)).toHaveCount(0);
        await expect(qrImages(page)).toHaveCount(0);
        const text = await mainOf(page).innerText();
        expect(text, where).not.toMatch(/他の|存在|所有/);
        for (const needle of [...kind.readyOnly(), ...stateLabels]) {
          expect(text, `${where}: ${needle}`).not.toContain(needle);
        }
        texts.push(text);
        // The ownership decision precedes any rendering of data: no ready text was ever in the document.
        expect(Object.values(await seenTexts(page)).some(Boolean), where).toBe(false);
      }
      expect(new Set(texts).size, "every answer is the same text").toBe(1);
      expect(parsed(await readDbRaw(page))).toEqual(dbBefore);
    });
  }
});

test.describe("TC-PG-XFN-003-702 ownership follows the signed-in user, not the reference (AR-AZ-011, INV-010-08)", () => {
  test("another verified user is denied demo's pages and sees their own; a user with no purchases is denied everything", async ({
    page,
  }) => {
    await fixClock(page);
    await seedLocalStorage(page, { "r39x.mock.session.v1": otherSession() });

    await gotoHydrated(page, orderPath(ORDER.confirmedEntry));
    await expect(heading1(page)).toHaveText(copy.accessDenied.title);
    await expect(mainOf(page)).not.toContainText(copy.order.state.CONFIRMED);
    await gotoHydrated(page, ticketPath(TICKET.valid));
    await expect(heading1(page)).toHaveText(copy.accessDenied.title);
    await gotoHydrated(page, goodsItemPath(GOODS_ITEM.fulfillable));
    await expect(heading1(page)).toHaveText(copy.accessDenied.title);

    await gotoHydrated(page, ticketPath(TICKET.other));
    await expect(heading1(page)).toHaveText(copy.mypage.entryTickets.detail.heading);
    await gotoHydrated(page, reservationQrPath(RESERVATION.other));
    await expect(heading1(page)).toHaveText(copy.qr.KARAOKE);
    await expect(qrImages(page)).toHaveCount(1);

    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["r39x.mock.session.v1", freshSession()],
    );
    for (const path of [
      orderPath(ORDER.otherEntry),
      ticketPath(TICKET.other),
      ticketQrPath(TICKET.other),
      reservationPath(RESERVATION.other),
      reservationQrPath(RESERVATION.other),
      goodsItemPath(GOODS_ITEM.other),
    ]) {
      await gotoHydrated(page, path);
      await expect(heading1(page), path).toHaveText(copy.accessDenied.title);
    }
  });
});

test.describe("TC-PG-XFN-003-703 Access Denied offers the Mypage and the viewer's own list, and nothing that could grant access (SPEC-050 19.2)", () => {
  test("shows exactly the contracted content: title, description and two links; no button, no input, no alert", async ({
    page,
  }) => {
    await openAs(page, ticketPath(TICKET.other));
    await expect(heading1(page)).toHaveText(copy.accessDenied.title);
    await expect(mainOf(page)).toContainText(copy.accessDenied.description);
    await expect(mainLink(page, copy.accessDenied.mypageLink)).toBeVisible();
    await expect(mainLink(page, copy.accessDenied.entryTicketsLink)).toBeVisible();
    expect(await pageButtons(page).count()).toBe(0);
    await expect(mainButton(page, copy.pageState.retry)).toHaveCount(0);
    await expect(mainOf(page).locator("input, textarea, select")).toHaveCount(0);
    await expect(alertsOf(page)).toHaveCount(0);

    await mainLink(page, copy.accessDenied.mypageLink).click();
    await expect(page).toHaveURL(/\/mypage$/);
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
  });

  test("the way back reaches the viewer's own list", async ({ page }) => {
    await openAs(page, goodsItemPath(GOODS_ITEM.other));
    await mainLink(page, copy.accessDenied.goodsItemsLink).click();
    await expect(page).toHaveURL(/\/mypage\/goods$/);
    await expect(heading1(page)).toHaveText(copy.mypage.goodsItems.heading);
  });
});

test.describe("TC-PG-XFN-003-704 an Access Denied view is not a Not Found page and does not use the HTTP status to tell a missing target from a foreign one (SPEC-050 19.2, SPEC-110 22)", () => {
  test("a foreign ref, a missing ref and a malformed ref all answer HTTP 200 with the same protected headers", async ({
    request,
  }) => {
    const paths = [
      ticketPath(TICKET.other),
      ticketPath(MISSING("7c000000")),
      ticketPath("not-a-uuid"),
      orderPath(ORDER.otherEntry),
      orderPath("not-a-uuid"),
      reservationQrPath(RESERVATION.other),
      reservationQrPath("not-a-uuid"),
      goodsItemPath(GOODS_ITEM.other),
      goodsItemPath("not-a-uuid"),
    ];
    for (const path of paths) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(200);
      expect(response.headers()["cache-control"] ?? "", path).toContain("no-store");
    }
  });

  test("a malformed ref is Access Denied after the AuthGate (not the public Not Found page)", async ({
    page,
  }) => {
    await openAs(page, ticketPath("not-a-uuid"));
    await expect(heading1(page)).toHaveText(copy.accessDenied.title);
    await expect(mainOf(page)).not.toContainText(copy.notFound.title);
  });
});
