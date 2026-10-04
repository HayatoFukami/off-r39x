import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { loginWith, unverifiedSession } from "../harness/browser/auth.ts";
import {
  goodsItemPath,
  mypageNav,
  NAV_KEYS,
  type NavKey,
  navLink,
  navToggle,
  orderPath,
  PATH,
  reservationPath,
  reservationQrPath,
  ticketPath,
  ticketQrPath,
} from "../harness/browser/mypage.ts";
import { alertsOf, heading1, mainOf, openAs } from "../harness/browser/purchase.ts";
import { isDesktop } from "../harness/browser/shell.ts";
import { EMAIL, GOODS_ITEM, ORDER, RESERVATION, TICKET } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s8-mypage.md sections 4.2 and 6.
// SPEC-050 17.2, 24.1, 25, 31 items 3 / 14 / 22, AR-SES-007, SEC-QR-013.

const heading = (key: NavKey): string => {
  const m = copy.mypage;
  return {
    overview: m.heading,
    profile: m.profile.heading,
    orders: m.orders.heading,
    entryTickets: m.entryTickets.heading,
    reservations: m.reservations.heading,
    goodsItems: m.goodsItems.heading,
  }[key];
};

/** Opens the Mypage navigation on Mobile (a disclosure) and does nothing on Desktop. */
async function revealNav(page: Page): Promise<void> {
  if (isDesktop(page)) return;
  const toggle = navToggle(page);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

test.describe("TC-PG-MYP-001-711 the Mypage local navigation offers the six areas in order, always on Desktop and on demand on Mobile (SPEC-050 17.2, 24.1)", () => {
  test("is a landmark with six links to the six areas, in the contracted order, with no list markup", async ({
    page,
  }) => {
    await openAs(page, PATH.overview);
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    await revealNav(page);
    await expect(mypageNav(page)).toBeVisible();
    const links = mypageNav(page).getByRole("link");
    await expect(links).toHaveCount(6);
    expect(await links.allInnerTexts()).toEqual(NAV_KEYS.map((key) => copy.mypage.nav.items[key]));
    for (const key of NAV_KEYS) {
      await expect(navLink(page, key)).toHaveAttribute("href", PATH[key]);
    }
    await expect(mypageNav(page).locator("ul, ol, li")).toHaveCount(0);
    await expect(mypageNav(page).getByRole("heading")).toHaveCount(0);
  });

  test("Desktop shows it permanently without a toggle; Mobile hides the links behind a toggle that reports its state", async ({
    page,
  }) => {
    await openAs(page, PATH.overview);
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    if (isDesktop(page)) {
      await expect(mypageNav(page)).toBeVisible();
      await expect(navLink(page, "orders")).toBeVisible();
      await expect(navToggle(page)).toBeHidden();
      return;
    }
    const toggle = navToggle(page);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const controls = await toggle.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    await expect(navLink(page, "orders")).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    for (const key of NAV_KEYS) await expect(navLink(page, key)).toBeVisible();
    // aria-controls points at the navigation that holds the links.
    expect(
      await page.evaluate(
        (id) => document.getElementById(id as string)?.querySelectorAll("a").length ?? -1,
        controls,
      ),
    ).toBe(6);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(navLink(page, "orders")).toBeHidden();
  });
});

test.describe("TC-PG-MYP-001-712 each area is reachable from the navigation and the current one is marked (E2E 14, SPEC-050 17.2, 25)", () => {
  test("from the Overview, each link opens its page and only that link is the current page", async ({
    page,
  }) => {
    await openAs(page, PATH.overview);
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    for (const key of NAV_KEYS) {
      await revealNav(page);
      await navLink(page, key).click();
      await expect(page).toHaveURL(new RegExp(`${PATH[key]}$`));
      await expect(heading1(page)).toHaveText(heading(key));
      await revealNav(page);
      const current = mypageNav(page).locator('[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveText(copy.mypage.nav.items[key]);
    }
  });

  test("on Mobile the menu closes after a link was followed", async ({ page }) => {
    test.skip(isDesktop(page), "the toggle exists on Mobile only");
    await openAs(page, PATH.overview);
    await revealNav(page);
    await navLink(page, "entryTickets").click();
    await expect(heading1(page)).toHaveText(copy.mypage.entryTickets.heading);
    await expect(navToggle(page)).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("TC-PG-MYP-001-713 the navigation marks the area of a detail or QR page and stays available when the target is denied (SPEC-050 17.2, 19.2)", () => {
  const cases: [string, string, NavKey][] = [
    ["an Order detail", orderPath(ORDER.confirmedEntry), "orders"],
    ["an Entry Ticket detail", ticketPath(TICKET.valid), "entryTickets"],
    ["an Entry QR", ticketQrPath(TICKET.valid), "entryTickets"],
    ["a Reservation detail", reservationPath(RESERVATION.valid), "reservations"],
    ["a Karaoke QR", reservationQrPath(RESERVATION.valid), "reservations"],
    ["a Goods detail", goodsItemPath(GOODS_ITEM.fulfillable), "goodsItems"],
  ];
  for (const [name, path, key] of cases) {
    test(`${name} marks ${key} as current`, async ({ page }) => {
      await openAs(page, path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await revealNav(page);
      await expect(mypageNav(page).locator('[aria-current="page"]')).toHaveText(
        copy.mypage.nav.items[key],
      );
    });
  }

  test("the navigation is still there on an Access Denied view and the way back is the Overview", async ({
    page,
  }) => {
    await openAs(page, orderPath(ORDER.otherEntry));
    await expect(heading1(page)).toHaveText(copy.accessDenied.title);
    await revealNav(page);
    await expect(mypageNav(page)).toBeVisible();
    await expect(navLink(page, "overview")).toHaveAttribute("href", PATH.overview);
    await expect(alertsOf(page)).toHaveCount(0);
  });
});

test.describe("TC-PG-MYP-001-714 a Guest is sent to Login with the page's own intent and returns to it (E2E 3, AR-SES-007, SPEC-050 10, 17.1)", () => {
  const routes: [string, string, string][] = [
    ["Overview", PATH.overview, "mypage"],
    ["Profile", PATH.profile, "mypage-profile"],
    ["Orders", PATH.orders, "mypage-orders"],
    ["Order detail", orderPath(ORDER.confirmedEntry), `mypage-order%3A${ORDER.confirmedEntry}`],
    ["Entry Tickets", PATH.entryTickets, "mypage-entry-tickets"],
    ["Entry Ticket detail", ticketPath(TICKET.valid), `mypage-entry-ticket%3A${TICKET.valid}`],
    ["Entry QR (never a return destination)", ticketQrPath(TICKET.valid), "mypage"],
    ["Karaoke", PATH.reservations, "mypage-karaoke"],
    [
      "Reservation detail",
      reservationPath(RESERVATION.valid),
      `mypage-reservation%3A${RESERVATION.valid}`,
    ],
    ["Karaoke QR (never a return destination)", reservationQrPath(RESERVATION.valid), "mypage"],
    ["Goods", PATH.goodsItems, "mypage-goods"],
    [
      "Goods detail",
      goodsItemPath(GOODS_ITEM.fulfillable),
      `mypage-goods-item%3A${GOODS_ITEM.fulfillable}`,
    ],
  ];

  test("every Mypage route redirects a Guest to Login with its Continuation key and never renders protected content", async ({
    page,
  }) => {
    for (const [name, path, key] of routes) {
      await openAs(page, path, { session: null });
      await expect(page, name).toHaveURL(new RegExp(`/account/login\\?continue=${key}$`));
      await expect(heading1(page), name).toHaveText(copy.auth.login.heading);
      await expect(mainOf(page), name).not.toContainText("デモ太郎");
      await expect(mypageNav(page), name).toHaveCount(0);
    }
  });

  test("after Login the Guest returns to the same detail page and sees the current content", async ({
    page,
  }) => {
    await openAs(page, orderPath(ORDER.confirmedEntry), { session: null });
    await expect(page).toHaveURL(/\/account\/login\?continue=mypage-order%3A/);
    await loginWith(page, EMAIL.demo);
    await expect(page).toHaveURL(new RegExp(`${orderPath(ORDER.confirmedEntry)}$`));
    await expect(heading1(page)).toHaveText(copy.mypage.orders.detail.heading);
    await expect(mainOf(page)).toContainText(copy.order.state.CONFIRMED);
  });

  test("a QR route is not a return destination: after Login the user lands on the Overview", async ({
    page,
  }) => {
    await openAs(page, ticketQrPath(TICKET.valid), { session: null });
    await expect(page).toHaveURL(/\/account\/login\?continue=mypage$/);
    await loginWith(page, EMAIL.demo);
    await expect(page).toHaveURL(/\/mypage$/);
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
  });

  test("an unverified user is sent to Email Verification with the same intent and sees no content", async ({
    page,
  }) => {
    await openAs(page, orderPath(ORDER.confirmedEntry), { session: unverifiedSession() });
    await expect(page).toHaveURL(
      new RegExp(`/account/email-verification\\?continue=mypage-order%3A${ORDER.confirmedEntry}$`),
    );
    await expect(mainOf(page)).not.toContainText(copy.order.state.CONFIRMED);
  });
});
