import { expect, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  formatJstDate,
  formatJstDateTime,
  formatJstTimeRange,
} from "../../apps/web/src/presentation/format/datetime.ts";
import { formatMoney } from "../../apps/web/src/presentation/format/money.ts";
import { readCart, readDbRaw, writeStorage } from "../harness/browser/cart.ts";
import {
  awaitingWithWebhook,
  demoOrdersNewestFirst,
  freshSession,
  hrefsIn,
  mainButton,
  mainLink,
  orderPath,
  otherSession,
  PATH,
  pageButtons,
  region,
  retryButtons,
  rightsHrefs,
  rowsIn,
  rowWithHref,
} from "../harness/browser/mypage.ts";
import { seedState } from "../harness/browser/public.ts";
import {
  alertsOf,
  entitlementsRegion,
  heading1,
  itemsRegion,
  mainOf,
  ORDER_STATE_LIST,
  openAs,
  orderByRef,
  ordersOf,
  outcomeRegion,
  SUCCESS_WORDING,
  statusLive,
} from "../harness/browser/purchase.ts";
import { KEYS } from "../harness/browser/shell.ts";
import { ORDER, RESERVATION, TICKET } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s8-mypage.md sections 4.5 and 4.6.
// SPEC-050 18.3 / 18.4 (PG-MYP-003 / 004), 16.4 .. 16.7, 20.1, 21, 22, 31 items 15 / 19, BR-ORD-015, INV-010-07,
// PAY-BRW-002. Expected DB postconditions are the mock DB (no real DB / provider here).

const orders = () => copy.mypage.orders;
const label = copy.order.state;
const act = copy.order.action;
const labelOf = (state: string): string =>
  (copy.order.state as Record<string, string>)[state] ?? "";
const summaryOf = (items: readonly { name: string; quantity: number }[]): string =>
  items.map((i) => `${i.name} ×${i.quantity}`).join("、");

test.describe("TC-PG-MYP-003-701 the Order list shows every Order with its own state, Purpose, summary, date and total (E2E 15, SPEC-050 18.3, 20.1)", () => {
  test("lists demo's 13 Orders, newest first, each with exactly one Canonical state label", async ({
    page,
  }) => {
    await openAs(page, PATH.orders);
    await expect(heading1(page)).toHaveText(orders().heading);
    await expect(heading1(page)).toHaveCount(1);
    await expect(page).toHaveTitle(new RegExp(`^${orders().pageTitle} \\|`));
    const rows = rowsIn(mainOf(page));
    await expect(rows).toHaveCount(13);

    const expected = demoOrdersNewestFirst();
    expect(await hrefsIn(rows)).toEqual(expected.map((o) => orderPath(o.ref)));

    const allLabels = ORDER_STATE_LIST.map((s) => label[s]);
    for (const order of expected) {
      const row = rowWithHref(mainOf(page), orderPath(order.ref));
      await expect(row, order.ref).toHaveCount(1);
      await expect(row).toContainText(labelOf(order.state));
      await expect(row).toContainText(copy.purpose[order.purpose]);
      await expect(row).toContainText(summaryOf(order.items));
      await expect(row).toContainText(formatJstDateTime(order.createdAt as never));
      await expect(row).toContainText(formatMoney(order.total));
      // One state per row: the state is told by text, and no other state label is in the row.
      const text = await row.innerText();
      expect(
        allLabels.filter((l) => text.includes(l)),
        `${order.ref} ${order.state}`,
      ).toEqual([labelOf(order.state)]);
    }
  });

  test("distinguishes all seven Canonical Order States and shows all four Purposes", async ({
    page,
  }) => {
    await openAs(page, PATH.orders);
    const rows = rowsIn(mainOf(page));
    await expect(rows).toHaveCount(13);
    const text = await mainOf(page).innerText();
    for (const state of ORDER_STATE_LIST) expect(text, state).toContain(label[state]);
    for (const purpose of Object.values(copy.purpose)) expect(text, purpose).toContain(purpose);
    expect(new Set(ORDER_STATE_LIST.map((s) => label[s])).size).toBe(7);
  });

  test("a row opens the Order detail", async ({ page }) => {
    await openAs(page, PATH.orders);
    await rowWithHref(mainOf(page), orderPath(ORDER.confirmedEntry)).getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`${orderPath(ORDER.confirmedEntry)}$`));
    await expect(heading1(page)).toHaveText(orders().detail.heading);
    await expect(outcomeRegion(page)).toContainText(label.CONFIRMED);
  });
});

test.describe("TC-PG-MYP-003-702 loading, Empty and a failed read are three different states (SPEC-050 9, 21)", () => {
  test("a user with no Order sees the Empty message only", async ({ page }) => {
    await openAs(page, PATH.orders, { session: freshSession() });
    await expect(mainOf(page)).toContainText(orders().empty);
    await expect(rowsIn(mainOf(page))).toHaveCount(0);
    await expect(alertsOf(page)).toHaveCount(0);
  });

  test("an unreadable list is an unavailable alert with a retry, never the Empty message; the retry recovers", async ({
    page,
  }) => {
    await openAs(page, PATH.orders, { extra: { [KEYS.db]: "{ not json" } });
    await expect(alertsOf(page)).toHaveCount(1);
    await expect(alertsOf(page)).toContainText(copy.pageState.unavailable(orders().subject));
    await expect(mainOf(page)).not.toContainText(orders().empty);
    await expect(rowsIn(mainOf(page))).toHaveCount(0);
    await writeStorage(page, KEYS.db, JSON.stringify(seedState()));
    await retryButtons(mainOf(page)).click();
    await expect(rowsIn(mainOf(page))).toHaveCount(13);
    await expect(alertsOf(page)).toHaveCount(0);
  });

  test("while loading no row, no amount and no Empty message is shown", async ({ page }) => {
    await openAs(page, PATH.orders, { scenario: { latency: "long", latencyLongMs: 2500 } });
    await expect(heading1(page)).toHaveText(orders().heading);
    await expect(mainOf(page).locator('[role="status"]').first()).toContainText(
      copy.pageState.loading,
    );
    const early = await mainOf(page).innerText();
    expect(early).not.toContain(orders().empty);
    expect(early).not.toMatch(/[¥￥]\s*\d/);
    await expect(rowsIn(mainOf(page))).toHaveCount(13, { timeout: 15_000 });
  });
});

test.describe("TC-PG-MYP-003-703 the list shows only the viewer's Orders (INV-010-08)", () => {
  test("another user sees their own three Orders and none of demo's", async ({ page }) => {
    await openAs(page, PATH.orders, { session: otherSession() });
    const rows = rowsIn(mainOf(page));
    await expect(rows).toHaveCount(3);
    const hrefs = await hrefsIn(rows);
    expect(hrefs.sort()).toEqual(
      [ORDER.otherEntry, ORDER.otherGoods, ORDER.otherKaraoke].map(orderPath).sort(),
    );
    for (const demoOrder of demoOrdersNewestFirst()) {
      expect(hrefs).not.toContain(orderPath(demoOrder.ref));
    }
  });
});

const COMPOSITE = ORDER.confirmedComposite;

test.describe("TC-PG-MYP-004-701 a CONFIRMED composite Order shows its items and both kinds of rights under separate headings (E2E 14, SPEC-050 18.4, 31 item 27)", () => {
  test("has the shared outcome, two items, the Entry Ticket and Goods rights, the receipt and a way back; no link to itself, no button", async ({
    page,
  }) => {
    await openAs(page, orderPath(COMPOSITE));
    await expect(heading1(page)).toHaveText(orders().detail.heading);
    await expect(heading1(page)).toHaveCount(1);
    await expect(page).toHaveTitle(new RegExp(`^${orders().detail.pageTitle} \\|`));
    await expect(outcomeRegion(page)).toContainText(label.CONFIRMED);
    await expect(outcomeRegion(page)).toContainText(copy.order.description.CONFIRMED);
    await expect(outcomeRegion(page)).toContainText(copy.purpose.ENTRY_GOODS_PURCHASE);
    const order = seedState().orders.find((o) => o.ref === COMPOSITE);
    expect(order).toBeDefined();
    await expect(outcomeRegion(page)).toContainText(formatJstDateTime(order?.createdAt as never));

    const items = itemsRegion(page).getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expect(itemsRegion(page)).toContainText(
      formatMoney(order?.total ?? { amount: "0", currency: "JPY" }),
    );

    // Both kinds of rights, separately (E2E 27).
    const rights = entitlementsRegion(page);
    await expect(rights).toBeVisible();
    await expect(
      rights.getByRole("heading", {
        level: 3,
        name: copy.purchase.entitlements.entryHeading,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      rights.getByRole("heading", {
        level: 3,
        name: copy.purchase.entitlements.goodsHeading,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      rights.getByRole("link", { name: copy.purchase.entitlements.entryLink(1), exact: true }),
    ).toHaveAttribute("href", `/mypage/entry-tickets/${TICKET.composite}`);
    expect(await rightsHrefs(page)).toContain(`/mypage/entry-tickets/${TICKET.composite}`);

    // The page itself is not offered as a link; the rights list is, and so is the way back.
    await expect(mainLink(page, act.view_purchase)).toHaveCount(0);
    await expect(mainLink(page, act.view_entitlements)).toHaveAttribute(
      "href",
      "/mypage/entry-tickets",
    );
    await expect(mainLink(page, orders().detail.backToList)).toHaveAttribute("href", PATH.orders);
    await expect(pageButtons(page)).toHaveCount(0);

    // Receipt: an external link, shown only because a safe https URL exists.
    const receipt = mainLink(page, copy.purchase.receipt.link);
    await expect(receipt).toHaveAttribute("href", `https://receipt.example.com/mock/${COMPOSITE}`);
    await expect(receipt).toHaveAttribute("target", "_blank");
    await expect(receipt).toHaveAttribute("rel", /noopener/);
    await expect(receipt).toHaveAttribute("rel", /noreferrer/);
  });

  test("a CONFIRMED Karaoke Order shows the usage date and time and the Reservation as its right", async ({
    page,
  }) => {
    await openAs(page, orderPath(ORDER.kValid));
    await expect(outcomeRegion(page)).toContainText(label.CONFIRMED);
    const order = seedState().orders.find((o) => o.ref === ORDER.kValid);
    const item = order?.items[0];
    if (item === undefined || item.kind !== "KARAOKE")
      throw new Error("seed Karaoke order missing");
    await expect(itemsRegion(page)).toContainText(
      copy.purchase.usage(
        formatJstDate(item.usageStart as never),
        formatJstTimeRange(item.usageStart as never, item.usageEnd as never),
      ),
    );
    await expect(
      entitlementsRegion(page).getByRole("link", {
        name: copy.purchase.entitlements.reservationLink,
        exact: true,
      }),
    ).toHaveAttribute("href", `/mypage/karaoke/${RESERVATION.valid}`);
    // No Receipt for this seed Order: no link and no heading for it.
    await expect(mainLink(page, copy.purchase.receipt.link)).toHaveCount(0);
  });
});

test.describe("TC-PG-MYP-004-702 an unconfirmed Order shows no right and offers only its own recovery action (E2E 27, BR-ORD-015, INV-010-07)", () => {
  const cases: {
    name: string;
    ref: string;
    state: "PREPARED" | "AWAITING_PAYMENT" | "REVIEW_REQUIRED";
    buttons: string[];
  }[] = [
    { name: "prepared", ref: ORDER.prepared, state: "PREPARED", buttons: [act.retry_checkout] },
    {
      name: "awaiting payment",
      ref: ORDER.awaiting,
      state: "AWAITING_PAYMENT",
      buttons: [act.recheck_status],
    },
    {
      name: "review required (composite)",
      ref: ORDER.review,
      state: "REVIEW_REQUIRED",
      buttons: [act.recheck_status],
    },
  ];
  for (const c of cases) {
    test(`${c.name}: its state, no CONFIRMED wording, no rights, and exactly the contracted action`, async ({
      page,
    }) => {
      await openAs(page, orderPath(c.ref));
      await expect(outcomeRegion(page)).toContainText(label[c.state]);
      await expect(mainOf(page)).not.toContainText(label.CONFIRMED);
      await expect(mainOf(page)).not.toContainText(copy.order.description.CONFIRMED);
      await expect(mainOf(page)).not.toContainText(SUCCESS_WORDING);
      await expect(entitlementsRegion(page)).toHaveCount(0);
      expect(await rightsHrefs(page)).toEqual([]);
      const buttons = (await outcomeRegion(page).getByRole("button").allInnerTexts()).map((t) =>
        t.trim(),
      );
      expect(buttons).toEqual(c.buttons);
      await expect(mainLink(page, act.view_purchase)).toHaveCount(0);
      await expect(mainLink(page, act.view_entitlements)).toHaveCount(0);
      await expect(mainButton(page, act.purchase_again)).toHaveCount(0);
    });
  }
});

test.describe("TC-PG-MYP-004-703 a terminal Order returns to the sales page as a new purchase and creates no Order (E2E 12, SPEC-050 18.4)", () => {
  test("PAYMENT_FAILED Goods: the item goes back to the Cart", async ({ page }) => {
    await openAs(page, orderPath(ORDER.paymentFailed));
    await expect(outcomeRegion(page)).toContainText(label.PAYMENT_FAILED);
    const before = await ordersOf(page);
    await expect(pageButtons(page)).toHaveCount(1);
    await mainButton(page, act.purchase_again).click();
    await expect(page).toHaveURL(/\/cart$/);
    const cart = (await readCart(page)) as { lines: { kind: string }[] };
    expect(cart.lines.map((l) => l.kind)).toEqual(["GOODS"]);
    expect(await ordersOf(page)).toEqual(before);
  });

  test("EXPIRED Karaoke: goes to the Karaoke guide and leaves the Cart alone", async ({ page }) => {
    await openAs(page, orderPath(ORDER.expired));
    await expect(outcomeRegion(page)).toContainText(label.EXPIRED);
    const cartBefore = await readCart(page);
    const before = await ordersOf(page);
    await mainButton(page, act.purchase_again).click();
    await expect(page).toHaveURL(/\/karaoke$/);
    expect(await readCart(page)).toEqual(cartBefore);
    expect(await ordersOf(page)).toEqual(before);
  });
});

test.describe("TC-PG-MYP-004-704 Email failure keeps the purchase confirmed and the rights available, as a non-blocking notice (E2E 19, SPEC-050 16.7, INV-010-06)", () => {
  test("with a delayed Email the Order is still CONFIRMED with its rights and a notice that is not an alert and has no action", async ({
    page,
  }) => {
    await openAs(page, orderPath(COMPOSITE), { scenario: { notification: "failed_retryable" } });
    await expect(outcomeRegion(page)).toContainText(label.CONFIRMED);
    await expect(outcomeRegion(page)).toContainText(copy.notification.FAILED_RETRYABLE.label);
    await expect(outcomeRegion(page)).toContainText(copy.notification.FAILED_RETRYABLE.message);
    await expect(entitlementsRegion(page)).toBeVisible();
    expect((await rightsHrefs(page)).length).toBeGreaterThanOrEqual(2);
    await expect(alertsOf(page)).toHaveCount(0);
    await expect(pageButtons(page)).toHaveCount(0);
    await expect(mainOf(page)).not.toContainText(copy.order.state.PAYMENT_FAILED);
  });

  test("without a failure there is no notice", async ({ page }) => {
    await openAs(page, orderPath(COMPOSITE));
    await expect(outcomeRegion(page)).toContainText(label.CONFIRMED);
    await expect(mainOf(page)).not.toContainText(copy.notification.FAILED_RETRYABLE.message);
  });
});

test.describe("TC-PG-MYP-004-705 re-checking the status never creates an Order and announces a change (E2E 22, SPEC-050 18.4, 22, 25, PAY-BRW-002)", () => {
  test("an Order that the simulated webhook confirms: the live region announces it and the rights appear", async ({
    page,
  }) => {
    await openAs(page, orderPath(ORDER.awaiting), {
      scenario: { paymentOutcome: "confirm_after_recheck" },
      dbEdit: (state) => awaitingWithWebhook(state, ORDER.awaiting),
    });
    await expect(outcomeRegion(page)).toContainText(label.AWAITING_PAYMENT);
    await expect(entitlementsRegion(page)).toHaveCount(0);
    await expect(statusLive(page)).toHaveCount(1);
    await expect(statusLive(page)).toHaveText("");
    const ordersBefore = await ordersOf(page);

    await mainButton(page, act.recheck_status).click();
    await expect(statusLive(page)).toHaveText(copy.purchase.recheck.changed(label.CONFIRMED));
    await expect(outcomeRegion(page)).toContainText(label.CONFIRMED);
    await expect(entitlementsRegion(page)).toBeVisible();
    expect(await rightsHrefs(page)).not.toEqual([]);
    expect((await orderByRef(page, ORDER.awaiting))?.state).toBe("CONFIRMED");
    expect((await ordersOf(page)).length).toBe(ordersBefore.length);
    await expect(mainButton(page, act.recheck_status)).toHaveCount(0);
  });

  test("an Order that stays AWAITING_PAYMENT: 'unchanged' is announced, nothing is created and no right appears", async ({
    page,
  }) => {
    await openAs(page, orderPath(ORDER.awaiting));
    const before = await readDbRaw(page);
    await mainButton(page, act.recheck_status).click();
    await expect(statusLive(page)).toHaveText(copy.purchase.recheck.unchanged);
    await expect(outcomeRegion(page)).toContainText(label.AWAITING_PAYMENT);
    await expect(entitlementsRegion(page)).toHaveCount(0);
    expect(await readDbRaw(page)).toBe(before);
  });

  test("a failed re-check keeps the Order that was shown and reports the failure", async ({
    page,
  }) => {
    await openAs(page, orderPath(ORDER.review));
    const good = await readDbRaw(page);
    await writeStorage(page, KEYS.db, "{ not json");
    await mainButton(page, act.recheck_status).click();
    await expect(alertsOf(page)).toHaveCount(1);
    await expect(alertsOf(page)).toContainText(copy.purchase.recheck.failed);
    await expect(outcomeRegion(page)).toContainText(label.REVIEW_REQUIRED);
    await expect(mainOf(page)).not.toContainText(copy.accessDenied.title);
    await writeStorage(page, KEYS.db, good ?? "");
    await mainButton(page, act.recheck_status).click();
    await expect(alertsOf(page)).toHaveCount(0);
  });
});

test.describe("TC-PG-MYP-004-706 retrying the Checkout of a PREPARED Order uses the same Order (SPEC-050 16.6, 21)", () => {
  test("goes to the mock Checkout of the same Order without creating another", async ({ page }) => {
    await openAs(page, orderPath(ORDER.prepared));
    const before = await ordersOf(page);
    await mainButton(page, act.retry_checkout).click();
    await page.waitForURL(new RegExp(`/dev/mock-checkout/${ORDER.prepared}$`), { timeout: 30_000 });
    expect(await ordersOf(page)).toEqual(before);
  });

  test("an Order that does not exist or belongs to another user is denied and the way back is the Orders list", async ({
    page,
  }) => {
    await openAs(page, orderPath(ORDER.otherGoods));
    await expect(heading1(page)).toHaveText(copy.accessDenied.title);
    await expect(mainLink(page, copy.accessDenied.ordersLink)).toHaveAttribute("href", PATH.orders);
    await expect(mainLink(page, copy.accessDenied.mypageLink)).toHaveAttribute(
      "href",
      PATH.overview,
    );
    await expect(pageButtons(page)).toHaveCount(0);
    await expect(region(page, copy.purchase.outcomeHeading)).toHaveCount(0);
  });
});
