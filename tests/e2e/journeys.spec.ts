import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { formatBusinessDate } from "../../apps/web/src/presentation/format/datetime.ts";
import {
  accountMenuButton,
  loginWith,
  logoutViaMenu,
  readSession,
} from "../harness/browser/auth.ts";
import {
  addButton,
  headerCartLink,
  offeringName,
  readCart,
  rowByHeading,
} from "../harness/browser/cart.ts";
import { slotRoute, slotStateInDb } from "../harness/browser/karaoke-purchase.ts";
import { expectNoMatrixSeed, mainLink } from "../harness/browser/mypage.ts";
import { horizontalOverflow } from "../harness/browser/public.ts";
import {
  actionButton,
  entitlementHrefs,
  heading1,
  mainOf,
  newOrders,
  openAs,
  orderRefFromUrl,
  outcomeRegion,
  proceedButton,
  proceedToMockCheckout,
  SUCCESS_WORDING,
} from "../harness/browser/purchase.ts";
import { isDesktop, watchRuntimeErrors } from "../harness/browser/shell.ts";
import { D1, EMAIL, GOODS, OFFERING, SLOT } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s9-finalize.md section 5.
// SPEC-050 section 31 item 21 (Mobile and Desktop both complete the main flows), plus items 1, 3, 9, 17, 24.
// The same test runs under desktop-chromium and mobile-chromium; each journey asserts which one it is on.

const state = copy.order.state;

function expectProject(page: Page): void {
  const name = test.info().project.name;
  expect(isDesktop(page), name).toBe(name === "desktop-chromium");
}

/** Opens a primary navigation page the way a user does: the Desktop nav, or the Mobile drawer. */
async function gotoPrimary(page: Page, label: string): Promise<void> {
  if (isDesktop(page)) {
    await page
      .getByRole("navigation", { name: copy.layout.nav.primaryLabel, exact: true })
      .getByRole("link", { name: label, exact: true })
      .click();
    return;
  }
  await page
    .getByRole("banner")
    .getByRole("button", { name: copy.layout.drawer.open, exact: true })
    .click();
  const drawer = page.getByRole("dialog", { name: copy.layout.drawer.title, exact: true });
  await drawer.getByRole("link", { name: label, exact: true }).click();
}

test.describe("TC-SPEC-050-31-21-001 Entry Ticket + Goods purchase journey from guest to QR to logout (SPEC-050 31 items 3, 9, 17, 21, 24)", () => {
  test("guest -> browse -> cart -> login -> purchase -> status -> Mypage -> Entry QR -> logout", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    expectProject(page);
    const errors = watchRuntimeErrors(page);

    // 1. Guest browses. No session exists.
    await openAs(page, "/", { session: null });
    await expect(
      page.getByRole("banner").getByRole("link", { name: copy.layout.account.login, exact: true }),
    ).toBeVisible();
    expect(await readSession(page)).toEqual({ kind: "guest" });

    // 2. Entry Ticket from the header CTA, then Goods from the primary navigation; both go to the Cart.
    await page
      .getByRole("banner")
      .getByRole("link", { name: copy.layout.cta.buyTickets, exact: true })
      .click();
    await expect(page).toHaveURL(/\/entry$/);
    const ticket = rowByHeading(page, offeringName(OFFERING.regular));
    await addButton(ticket).click();
    await expect(headerCartLink(page, 1)).toBeVisible();

    await gotoPrimary(page, copy.layout.nav.items.goods);
    await expect(page).toHaveURL(/\/goods$/);
    await page.locator(`a[href="/goods/${GOODS.tshirt}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/goods/${GOODS.tshirt}$`));
    await addButton(mainOf(page)).click();
    await expect(headerCartLink(page, 2)).toBeVisible();

    // 3. Cart: the lines hold references and quantities only; the Guest is sent to Login with the Cart intent.
    await headerCartLink(page, 2).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(mainOf(page).getByRole("listitem")).toHaveCount(2);
    const cartBefore = JSON.stringify(await readCart(page));
    await expect(proceedButton(page)).toBeEnabled({ timeout: 15_000 });
    await proceedButton(page).click();
    await expect(page).toHaveURL(/\/account\/login\?continue=cart$/);
    expect(await newOrders(page)).toHaveLength(0);

    // 4. Login returns to the same Cart, content kept.
    await loginWith(page, EMAIL.demo);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(mainOf(page).getByRole("listitem")).toHaveCount(2);
    expect(JSON.stringify(await readCart(page))).toBe(cartBefore);

    // 5. Purchase start creates one composite Order and reaches the mock Checkout (no card input).
    const orderRef = await proceedToMockCheckout(page);
    const created = await newOrders(page);
    expect(created).toHaveLength(1);
    expect(created[0]?.ref).toBe(orderRef);
    expect(created[0]?.purpose).toBe("ENTRY_GOODS_PURCHASE");
    expect(created[0]?.state).toBe("AWAITING_PAYMENT");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.mockCheckout.heading);
    await expect(page.locator("input")).toHaveCount(0);

    // 6. Browser Return alone does not confirm anything.
    await page.getByRole("link", { name: copy.mockCheckout.pay, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/purchase/orders/${orderRef}$`));
    await expect(outcomeRegion(page)).toContainText(state.AWAITING_PAYMENT, { timeout: 15_000 });
    await expect(mainOf(page)).not.toContainText(SUCCESS_WORDING);
    expect(await entitlementHrefs(page)).toEqual([]);

    // 7. Recheck confirms; both rights appear; no second Order; the included lines left the Cart.
    await actionButton(page, copy.order.action.recheck_status).click();
    await expect(outcomeRegion(page)).toContainText(state.CONFIRMED, { timeout: 15_000 });
    const hrefs = await entitlementHrefs(page);
    const ticketHref = hrefs.find((h) => /^\/mypage\/entry-tickets\/[0-9a-f-]{36}$/.test(h));
    expect(ticketHref).toBeDefined();
    expect(hrefs.some((h) => /^\/mypage\/goods\/[0-9a-f-]{36}$/.test(h))).toBe(true);
    expect(await newOrders(page)).toHaveLength(1);
    await expect(headerCartLink(page)).toBeVisible();

    // 8. Mypage: the Order list has the new Order as CONFIRMED.
    await page
      .getByRole("banner")
      .getByRole("link", { name: copy.layout.account.mypage, exact: true })
      .click();
    await expect(page).toHaveURL(/\/mypage$/);
    await page.goto("/mypage/orders");
    await expect(page.locator(`a[href="/mypage/orders/${orderRef}"]`)).toHaveCount(1);
    expect(await newOrders(page)).toHaveLength(1);

    // 9. Entry Ticket detail, then its QR page: Entry title, synthetic QR, no seed anywhere.
    await page.goto(ticketHref ?? "/mypage/entry-tickets");
    await mainLink(page, copy.mypage.entryTickets.detail.qrLink).click();
    await expect(heading1(page)).toHaveText(copy.qr.ENTRY);
    await expect(
      page.getByRole("img", { name: copy.mypage.qr.imageLabel.ENTRY, exact: true }),
    ).toBeVisible();
    await expectNoMatrixSeed(page);
    await expect(mainOf(page)).not.toContainText(copy.qr.KARAOKE);

    // 10. Logout ends on Home as a guest; Mypage is no longer reachable.
    await logoutViaMenu(page);
    await expect(page).toHaveURL(/\/$/);
    await expect(accountMenuButton(page)).toHaveCount(0);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    await page.goto("/mypage");
    await expect(page).toHaveURL(/\/account\/login\?continue=mypage$/);

    expect(errors.errors).toEqual([]);
  });
});

test.describe("TC-SPEC-050-31-21-002 Karaoke purchase journey from guest to Reservation QR (SPEC-050 31 items 3, 5, 9, 13, 17, 21)", () => {
  test("guest -> Karaoke guide -> day -> slot -> login -> hold -> pay -> confirm -> Reservation QR -> logout", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    expectProject(page);
    const errors = watchRuntimeErrors(page);

    await openAs(page, "/", { session: null });
    await gotoPrimary(page, copy.layout.nav.items.karaoke);
    await expect(page).toHaveURL(/\/karaoke$/);
    await mainOf(page)
      .getByRole("link", { name: copy.karaoke.guide.dateLink(formatBusinessDate(D1)), exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/karaoke/schedule/${D1}$`));
    await page.locator(`a[href="${slotRoute(SLOT.d1_1000)}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${slotRoute(SLOT.d1_1000)}$`));

    // Karaoke has no Cart operation (item 28) and the Guest goes to Login with the slot intent.
    await expect(mainOf(page).getByRole("button", { name: copy.sales.add })).toHaveCount(0);
    await mainOf(page)
      .getByRole("button", { name: copy.karaoke.slotDetail.proceedGuest, exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/account/login\\?continue=karaoke-slot%3A${SLOT.d1_1000}$`),
    );
    await loginWith(page, EMAIL.demo);
    await expect(page).toHaveURL(new RegExp(`${slotRoute(SLOT.d1_1000)}$`));
    expect(await slotStateInDb(page, SLOT.d1_1000)).toBe("AVAILABLE");

    await mainOf(page)
      .getByRole("button", { name: copy.karaoke.slotDetail.proceed, exact: true })
      .click();
    await page.waitForURL(/\/dev\/mock-checkout\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const orderRef = orderRefFromUrl(page.url());
    expect(await slotStateInDb(page, SLOT.d1_1000)).toBe("HELD");
    const created = await newOrders(page);
    expect(created).toHaveLength(1);
    expect(created[0]?.purpose).toBe("KARAOKE_PURCHASE");

    await page.getByRole("link", { name: copy.mockCheckout.pay, exact: true }).click();
    await expect(outcomeRegion(page)).toContainText(state.AWAITING_PAYMENT, { timeout: 15_000 });
    expect(await entitlementHrefs(page)).toEqual([]);
    await actionButton(page, copy.order.action.recheck_status).click();
    await expect(outcomeRegion(page)).toContainText(state.CONFIRMED, { timeout: 15_000 });
    expect(await slotStateInDb(page, SLOT.d1_1000)).toBe("SOLD");
    const reservationHref = (await entitlementHrefs(page)).find((h) =>
      /^\/mypage\/karaoke\/[0-9a-f-]{36}$/.test(h),
    );
    expect(reservationHref).toBeDefined();
    expect(await newOrders(page)).toHaveLength(1);
    expect((await newOrders(page))[0]?.ref).toBe(orderRef);

    await page.goto(reservationHref ?? "/mypage/karaoke");
    await mainLink(page, copy.mypage.reservations.detail.qrLink).click();
    await expect(heading1(page)).toHaveText(copy.qr.KARAOKE);
    await expect(
      page.getByRole("img", { name: copy.mypage.qr.imageLabel.KARAOKE, exact: true }),
    ).toBeVisible();
    await expect(mainOf(page)).not.toContainText(copy.qr.ENTRY);
    await expectNoMatrixSeed(page);

    await logoutViaMenu(page);
    await expect(page).toHaveURL(/\/$/);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    expect(errors.errors).toEqual([]);
  });
});

test.describe("TC-SPEC-050-31-21-003 a guest reaches every public page by navigation without authentication (SPEC-050 31 items 1, 21, 29)", () => {
  test("Home, Entry, Karaoke (guide, day, slot), Goods (list, detail), Announcements and Cart open as a guest with one h1 and no overflow", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    expectProject(page);
    const errors = watchRuntimeErrors(page);
    await openAs(page, "/", { session: null });
    const visited: string[] = [];
    const settle = async (pattern: RegExp): Promise<void> => {
      await expect(page).toHaveURL(pattern);
      await expect(heading1(page)).toHaveCount(1);
      await expect(page).not.toHaveURL(/\/account\/login/);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      visited.push(new URL(page.url()).pathname);
    };
    await settle(/\/$/);
    await gotoPrimary(page, copy.layout.nav.items.entry);
    await settle(/\/entry$/);
    await gotoPrimary(page, copy.layout.nav.items.karaoke);
    await settle(/\/karaoke$/);
    await mainOf(page)
      .getByRole("link", { name: copy.karaoke.guide.dateLink(formatBusinessDate(D1)), exact: true })
      .click();
    await settle(new RegExp(`/karaoke/schedule/${D1}$`));
    await page.locator(`a[href="${slotRoute(SLOT.d1_1000)}"]`).click();
    await settle(new RegExp(`${slotRoute(SLOT.d1_1000)}$`));
    await gotoPrimary(page, copy.layout.nav.items.goods);
    await settle(/\/goods$/);
    await page.locator(`a[href="/goods/${GOODS.tshirt}"]`).click();
    await settle(new RegExp(`/goods/${GOODS.tshirt}$`));
    await page.goto("/announcements");
    await settle(/\/announcements$/);
    await page.locator('a[href^="/announcements/"]').first().click();
    await settle(/\/announcements\/[0-9a-f-]{36}$/);
    await headerCartLink(page).click();
    await settle(/\/cart$/);
    expect(visited).toHaveLength(10);
    expect(errors.errors).toEqual([]);
  });
});
