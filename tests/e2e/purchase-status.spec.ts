import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { formatJstDateTime } from "../../apps/web/src/presentation/format/datetime.ts";
import {
  entryLine,
  expectedGoodsDetail,
  expectedOfferings,
  goodsLine,
  readCartRaw,
  readDbRaw,
  writeStorage,
} from "../harness/browser/cart.ts";
import { hasLevelSkip, mainHeadingLevels, seedState } from "../harness/browser/public.ts";
import {
  actionButton,
  alertsOf,
  entitlementHrefs,
  entitlementsRegion,
  heading1,
  INTERNAL_IDS_IN_TEXT,
  itemsRegion,
  mainOf,
  newOrders,
  ORDER_STATE_LIST,
  type OrderStateName as OrderState,
  openAs,
  orderByRef,
  ordersOf,
  outcomeRegion,
  proceedToMockCheckout,
  readState,
  remainingOf,
  SUCCESS_WORDING,
  seedOrder,
  setScenario,
  statusLive,
  UUID_IN_TEXT,
} from "../harness/browser/purchase.ts";
import { KEYS } from "../harness/browser/shell.ts";
import { GOODS, NOW_ISO, OFFERING, ORDER, RESERVATION } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s7a-purchase.md section 6.
// SPEC-050 16 (PG-XFN-001), 20.1, 21, 22, 25, 31 items 7 / 8 / 9 / 10 / 11 / 19 / 27, SPEC-070 PAY-BRW-001 .. 003,
// SPEC-030 BR-ORD-015, INV-010-07. Expected DB postconditions are the mock DB (no real DB / provider here).

const COMPOSITE = [entryLine(OFFERING.regular, 1), goodsLine(GOODS.tshirt, 1)];
const label = copy.order.state;
const desc = copy.order.description;
const act = copy.order.action;
const entryPrice = (ref: string) => {
  const found = expectedOfferings().find((o) => o.ref === ref);
  if (found === undefined) throw new Error(`unknown offering ${ref}`);
  return found;
};
const yen = (n: number) => `¥${n.toLocaleString("en-US")}`;

/** From the Cart to the mock Checkout, then back through "支払う（モック）". Returns the Order ref. */
async function viaCartToStatus(
  page: Page,
  scenario: Record<string, unknown> = {},
  lines = COMPOSITE,
): Promise<string> {
  await openAs(page, "/cart", { lines, scenario });
  const ref = await proceedToMockCheckout(page);
  await page.getByRole("link", { name: copy.mockCheckout.pay, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/purchase/orders/${ref}$`));
  await expect(heading1(page)).toHaveText(copy.purchase.heading);
  await expect(outcomeRegion(page)).toBeVisible({ timeout: 15_000 });
  return ref;
}

/** The buttons and the links of the outcome region (the actions), by accessible name. */
async function actionsOf(page: Page): Promise<{ buttons: string[]; links: string[] }> {
  const region = outcomeRegion(page);
  const names = async (role: "button" | "link"): Promise<string[]> =>
    (await region.getByRole(role).allInnerTexts()).map((t) => t.trim());
  return { buttons: await names("button"), links: await names("link") };
}

const otherLabels = (state: OrderState): string[] =>
  ORDER_STATE_LIST.filter((s) => s !== state).map((s) => label[s]);

test.describe("TC-PG-XFN-001-661 Browser Return shows AWAITING_PAYMENT, never success, rights or a new Order (E2E 8, SPEC-050 16.3, PAY-BRW-001 / 002)", () => {
  test("after returning from the mock Checkout the first read is AWAITING_PAYMENT with only the recheck action", async ({
    page,
  }) => {
    const ref = await viaCartToStatus(page);
    await expect(heading1(page)).toHaveCount(1);
    const region = outcomeRegion(page);
    await expect(region).toContainText(label.AWAITING_PAYMENT);
    await expect(region).toContainText(desc.AWAITING_PAYMENT);
    await expect(region).toContainText(copy.purpose.ENTRY_GOODS_PURCHASE);
    await expect(region).toContainText(copy.purchase.purposeLabel);
    await expect(region).toContainText(formatJstDateTime(NOW_ISO));

    // No success wording, no CONFIRMED label or description, no link to any right.
    await expect(mainOf(page)).not.toContainText(label.CONFIRMED);
    await expect(mainOf(page)).not.toContainText(desc.CONFIRMED);
    await expect(mainOf(page)).not.toContainText(SUCCESS_WORDING);
    expect(await entitlementHrefs(page)).toEqual([]);
    await expect(entitlementsRegion(page)).toHaveCount(0);

    // Only "状態を再確認": neither a checkout retry nor a purchase-again (that would create a new right / Order).
    expect(await actionsOf(page)).toEqual({ buttons: [act.recheck_status], links: [] });
    await expect(mainOf(page).getByRole("button")).toHaveCount(1);

    // The page-level live region exists (one status in main) and has announced nothing yet.
    await expect(statusLive(page)).toHaveCount(1);
    await expect(statusLive(page)).toHaveText("");

    // The Order, its items and the total come from the server snapshot; no internal id is shown.
    const items = itemsRegion(page).getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText(entryPrice(OFFERING.regular).name);
    await expect(items.nth(0)).toContainText(copy.purchase.quantity(1));
    await expect(items.nth(1)).toContainText(expectedGoodsDetail(GOODS.tshirt).name);
    await expect(itemsRegion(page)).toContainText(
      yen(
        Number(entryPrice(OFFERING.regular).unitPrice.amount) +
          Number(expectedGoodsDetail(GOODS.tshirt).unitPrice.amount),
      ),
    );
    const text = await mainOf(page).innerText();
    expect(text).not.toMatch(UUID_IN_TEXT);
    expect(text).not.toMatch(INTERNAL_IDS_IN_TEXT);

    const order = await orderByRef(page, ref);
    expect(order?.state).toBe("AWAITING_PAYMENT");
    expect(await newOrders(page)).toHaveLength(1);
  });
});

test.describe("TC-PG-XFN-001-662 the recheck confirms the Order, announces the change and shows both rights of a composite Order (E2E 9 / 11 / 27, SPEC-050 16.5, 25, BR-ORD-015)", () => {
  test("AWAITING_PAYMENT to CONFIRMED by keyboard: live-region announcement, then Entry Ticket and Goods under separate headings, no new Order", async ({
    page,
  }) => {
    const ref = await viaCartToStatus(page);
    await expect(mainOf(page)).not.toContainText(label.CONFIRMED);
    const before = (await ordersOf(page)).length;

    const recheck = actionButton(page, act.recheck_status);
    await recheck.focus();
    await page.keyboard.press("Enter");

    await expect(statusLive(page)).toContainText(copy.purchase.recheck.changed(label.CONFIRMED));
    await expect(outcomeRegion(page)).toContainText(label.CONFIRMED);
    await expect(outcomeRegion(page)).toContainText(desc.CONFIRMED);

    // Rights appear only now, both kinds, distinguishable on the same screen.
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
    const state = await readState(page);
    const tickets = state.tickets.filter((t) => t.orderRef === ref);
    const goodsItems = state.goodsItems.filter((g) => g.orderRef === ref);
    expect(tickets).toHaveLength(1);
    expect(goodsItems).toHaveLength(1);
    await expect(
      rights.getByRole("link", { name: copy.purchase.entitlements.entryLink(1), exact: true }),
    ).toHaveAttribute("href", `/mypage/entry-tickets/${tickets[0]?.ref}`);
    await expect(
      rights.getByRole("link", { name: copy.purchase.entitlements.goodsLink(1), exact: true }),
    ).toHaveAttribute("href", `/mypage/goods/${goodsItems[0]?.ref}`);
    await expect(rights).toContainText(copy.goods.item.FULFILLABLE);
    await expect(rights).toContainText(copy.goods.handoff.PENDING);
    await expect(rights).toContainText(copy.goods.detail.pickupNotice);

    // Actions: links only, no button (a CONFIRMED Order offers no Business retry).
    expect(await actionsOf(page)).toEqual({
      buttons: [],
      links: [act.view_purchase, act.view_entitlements],
    });
    await expect(actionsOfLink(page, act.view_purchase)).toHaveAttribute(
      "href",
      `/mypage/orders/${ref}`,
    );
    await expect(actionsOfLink(page, act.view_entitlements)).toHaveAttribute(
      "href",
      "/mypage/entry-tickets",
    );
    await expect(mainOf(page).getByRole("button")).toHaveCount(0);

    // Rechecking created no Order; the Order is CONFIRMED in the mock DB; the live region is the only status.
    expect(await ordersOf(page)).toHaveLength(before);
    expect((await orderByRef(page, ref))?.state).toBe("CONFIRMED");
    await expect(statusLive(page)).toHaveCount(1);
    const levels = await mainHeadingLevels(page);
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(hasLevelSkip(levels)).toBe(false);
  });

  test("remain_awaiting: the recheck announces 'not changed' and keeps AWAITING_PAYMENT; repeated rechecks create no Order and no right", async ({
    page,
  }) => {
    const ref = await viaCartToStatus(page, { paymentOutcome: "remain_awaiting" });
    const before = (await ordersOf(page)).length;
    for (let round = 1; round <= 3; round += 1) {
      await actionButton(page, act.recheck_status).click();
      await expect(statusLive(page)).toContainText(copy.purchase.recheck.unchanged);
      await expect(outcomeRegion(page)).toContainText(label.AWAITING_PAYMENT);
      await expect(actionButton(page, act.recheck_status)).toBeEnabled();
      expect(await entitlementHrefs(page)).toEqual([]);
    }
    expect(await ordersOf(page)).toHaveLength(before);
    expect((await orderByRef(page, ref))?.state).toBe("AWAITING_PAYMENT");
    expect((await readState(page)).tickets.filter((t) => t.orderRef === ref)).toHaveLength(0);
  });

  test("while rechecking, the button is busy and the live region says so", async ({ page }) => {
    await viaCartToStatus(page, { latency: "long", latencyLongMs: 2000 });
    const button = actionButton(page, act.recheck_status);
    await button.click();
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(statusLive(page)).toContainText(copy.purchase.recheck.inProgress);
    await expect(statusLive(page)).toContainText(copy.purchase.recheck.changed(label.CONFIRMED), {
      timeout: 15_000,
    });
  });

  test("a reload re-reads the same Order and creates nothing (SPEC-050 22)", async ({ page }) => {
    const ref = await viaCartToStatus(page, { paymentOutcome: "remain_awaiting" });
    const before = (await ordersOf(page)).length;
    await page.reload();
    await expect(outcomeRegion(page)).toContainText(label.AWAITING_PAYMENT);
    expect(await ordersOf(page)).toHaveLength(before);
    expect((await orderByRef(page, ref))?.webhookReads).toBe(2);
  });
});

function actionsOfLink(page: Page, name: string) {
  return outcomeRegion(page).getByRole("link", { name, exact: true });
}

test.describe("TC-PG-XFN-001-663 each terminal or review outcome is shown separately with its own action (E2E 10 / 11, SPEC-050 16.4, 20.1)", () => {
  const outcomes: { scenario: string; state: OrderState; buttons: string[] }[] = [
    { scenario: "payment_failed", state: "PAYMENT_FAILED", buttons: [act.purchase_again] },
    { scenario: "cancel", state: "CANCELED", buttons: [act.purchase_again] },
    { scenario: "expire", state: "EXPIRED", buttons: [act.purchase_again] },
    { scenario: "review_required", state: "REVIEW_REQUIRED", buttons: [act.recheck_status] },
  ];

  for (const o of outcomes) {
    test(`${o.scenario}: shows ${o.state} with its own wording and actions, no rights and no success`, async ({
      page,
    }) => {
      const ref = await viaCartToStatus(page, { paymentOutcome: o.scenario });
      const region = outcomeRegion(page);
      await expect(region).toContainText(label[o.state]);
      await expect(region).toContainText(desc[o.state]);
      for (const other of otherLabels(o.state)) {
        await expect(region, other).not.toContainText(other);
      }
      await expect(mainOf(page)).not.toContainText(SUCCESS_WORDING);
      expect(await entitlementHrefs(page)).toEqual([]);
      await expect(entitlementsRegion(page)).toHaveCount(0);
      expect(await actionsOf(page)).toEqual({ buttons: o.buttons, links: [] });
      expect((await orderByRef(page, ref))?.state).toBe(o.state);
      expect(await newOrders(page)).toHaveLength(1);
      // A review is not a success and offers no retry that could create rights.
      if (o.state === "REVIEW_REQUIRED") {
        await expect(mainOf(page).getByRole("button", { name: act.purchase_again })).toHaveCount(0);
        await expect(mainOf(page).getByRole("button", { name: act.retry_checkout })).toHaveCount(0);
      }
    });
  }

  test("REVIEW_REQUIRED stays under repeated rechecks and creates no Order or right (E2E 11)", async ({
    page,
  }) => {
    const ref = await viaCartToStatus(page, { paymentOutcome: "review_required" });
    const before = (await ordersOf(page)).length;
    for (let i = 0; i < 2; i += 1) {
      await actionButton(page, act.recheck_status).click();
      await expect(statusLive(page)).toContainText(copy.purchase.recheck.unchanged);
    }
    await expect(outcomeRegion(page)).toContainText(label.REVIEW_REQUIRED);
    expect(await ordersOf(page)).toHaveLength(before);
    expect((await orderByRef(page, ref))?.state).toBe("REVIEW_REQUIRED");
    expect(await entitlementHrefs(page)).toEqual([]);
  });
});

test.describe("TC-PG-XFN-001-664 a Checkout start failure keeps the same PREPARED Order and a retry reuses it (E2E 7, SPEC-050 16.4 / 16.6 / 21)", () => {
  test("Cart to start_failed lands on the PREPARED Order, a failing retry says so, and a later retry goes to the mock Checkout with the same Order", async ({
    page,
  }) => {
    await openAs(page, "/cart", { lines: COMPOSITE, scenario: { checkout: "start_failed" } });
    await expect(
      page.getByRole("button", { name: copy.cart.proceed.label, exact: true }),
    ).toBeEnabled();
    const regularBefore = await remainingOf(page, "offering", OFFERING.regular);
    await page.getByRole("button", { name: copy.cart.proceed.label, exact: true }).click();
    await page.waitForURL(/\/purchase\/orders\/[0-9a-f-]{36}$/);

    // The Order exists exactly once, PREPARED, with its allocation held; the included lines left the Cart.
    const created = await newOrders(page);
    expect(created).toHaveLength(1);
    const ref = created[0]?.ref ?? "";
    expect(created[0]?.state).toBe("PREPARED");
    expect(created[0]?.pendingWebhook).toBe(false);
    expect(await ordersOf(page)).toHaveLength(14);
    expect(await remainingOf(page, "offering", OFFERING.regular)).toBe((regularBefore ?? 0) - 1);
    expect(await readCartRaw(page)).toBe(JSON.stringify({ version: 1, lines: [] }));

    // PREPARED: recorded, not confirmed; only the checkout retry is offered.
    await expect(outcomeRegion(page)).toContainText(label.PREPARED);
    await expect(outcomeRegion(page)).toContainText(desc.PREPARED);
    await expect(mainOf(page)).not.toContainText(SUCCESS_WORDING);
    await expect(mainOf(page)).not.toContainText(label.CONFIRMED);
    expect(await actionsOf(page)).toEqual({ buttons: [act.retry_checkout], links: [] });
    expect(await entitlementHrefs(page)).toEqual([]);

    // The retry fails again: the contracted notice appears, nothing changes, the retry stays available.
    await actionButton(page, act.retry_checkout).click();
    await expect(alertsOf(page)).toHaveCount(1);
    await expect(alertsOf(page)).toContainText(copy.purchase.checkoutStartFailed);
    await expect(outcomeRegion(page)).toContainText(label.PREPARED);
    expect(await ordersOf(page)).toHaveLength(14);
    expect((await orderByRef(page, ref))?.state).toBe("PREPARED");
    await expect(actionButton(page, act.retry_checkout)).toBeEnabled();

    // The condition is gone: the same Order goes to the mock Checkout (no new Order).
    await setScenario(page, { checkout: "ok" });
    await actionButton(page, act.retry_checkout).click();
    await page.waitForURL(new RegExp(`/dev/mock-checkout/${ref}$`));
    expect(await ordersOf(page)).toHaveLength(14);
    expect((await orderByRef(page, ref))?.state).toBe("AWAITING_PAYMENT");

    await page.getByRole("link", { name: copy.mockCheckout.pay, exact: true }).click();
    await expect(outcomeRegion(page)).toContainText(label.AWAITING_PAYMENT);
    await actionButton(page, act.recheck_status).click();
    await expect(outcomeRegion(page)).toContainText(label.CONFIRMED);
    expect(await ordersOf(page)).toHaveLength(14);
  });

  test("the seeded PREPARED Order can be retried from its status page into the mock Checkout without a new Order", async ({
    page,
  }) => {
    await openAs(page, `/purchase/orders/${ORDER.prepared}`);
    await expect(outcomeRegion(page)).toContainText(label.PREPARED);
    const before = await ordersOf(page);
    await actionButton(page, act.retry_checkout).click();
    await page.waitForURL(new RegExp(`/dev/mock-checkout/${ORDER.prepared}$`));
    expect(await ordersOf(page)).toHaveLength(before.length);
    expect((await orderByRef(page, ORDER.prepared))?.state).toBe("AWAITING_PAYMENT");
  });

  test("opportunity_expired: the Order becomes EXPIRED, the allocation is released and purchase-again replaces the retry", async ({
    page,
  }) => {
    await openAs(page, "/cart", {
      lines: COMPOSITE,
      scenario: { checkout: "opportunity_expired" },
    });
    const regularBefore = await remainingOf(page, "offering", OFFERING.regular);
    await expect(
      page.getByRole("button", { name: copy.cart.proceed.label, exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: copy.cart.proceed.label, exact: true }).click();
    await page.waitForURL(/\/purchase\/orders\/[0-9a-f-]{36}$/);
    await expect(outcomeRegion(page)).toContainText(label.EXPIRED);
    expect(await actionsOf(page)).toEqual({ buttons: [act.purchase_again], links: [] });
    await expect(mainOf(page).getByRole("button", { name: act.retry_checkout })).toHaveCount(0);
    expect(await newOrders(page)).toHaveLength(1);
    expect((await newOrders(page))[0]?.state).toBe("EXPIRED");
    expect(await remainingOf(page, "offering", OFFERING.regular)).toBe(regularBefore);
  });

  test("a retry whose opportunity has expired shows the terminal state instead of a start-failure notice", async ({
    page,
  }) => {
    await openAs(page, `/purchase/orders/${ORDER.prepared}`, {
      scenario: { checkout: "opportunity_expired" },
    });
    await actionButton(page, act.retry_checkout).click();
    await expect(outcomeRegion(page)).toContainText(label.EXPIRED);
    await expect(alertsOf(page)).toHaveCount(0);
    expect(await actionsOf(page)).toEqual({ buttons: [act.purchase_again], links: [] });
    expect((await orderByRef(page, ORDER.prepared))?.state).toBe("EXPIRED");
  });
});

test.describe("TC-PG-XFN-001-665 the seven Canonical Order states are distinct and offer only their own actions (SPEC-050 16.4, 20.1, 31 item 10)", () => {
  const table: {
    name: string;
    ref: string;
    state: OrderState;
    buttons: string[];
    links: string[];
  }[] = [
    {
      name: "prepared",
      ref: ORDER.prepared,
      state: "PREPARED",
      buttons: [act.retry_checkout],
      links: [],
    },
    {
      name: "awaiting",
      ref: ORDER.awaiting,
      state: "AWAITING_PAYMENT",
      buttons: [act.recheck_status],
      links: [],
    },
    {
      name: "confirmed_entry",
      ref: ORDER.confirmedEntry,
      state: "CONFIRMED",
      buttons: [],
      links: [act.view_purchase, act.view_entitlements],
    },
    {
      name: "payment_failed",
      ref: ORDER.paymentFailed,
      state: "PAYMENT_FAILED",
      buttons: [act.purchase_again],
      links: [],
    },
    {
      name: "canceled",
      ref: ORDER.canceled,
      state: "CANCELED",
      buttons: [act.purchase_again],
      links: [],
    },
    {
      name: "expired",
      ref: ORDER.expired,
      state: "EXPIRED",
      buttons: [act.purchase_again],
      links: [],
    },
    {
      name: "review",
      ref: ORDER.review,
      state: "REVIEW_REQUIRED",
      buttons: [act.recheck_status],
      links: [],
    },
  ];

  for (const row of table) {
    test(`${row.name} (${row.state})`, async ({ page }) => {
      await openAs(page, `/purchase/orders/${row.ref}`);
      const region = outcomeRegion(page);
      await expect(region).toContainText(label[row.state]);
      await expect(region).toContainText(desc[row.state]);
      for (const other of otherLabels(row.state))
        await expect(region, other).not.toContainText(other);
      expect(await actionsOf(page)).toEqual({ buttons: row.buttons, links: row.links });
      const rights = await entitlementHrefs(page);
      if (row.state === "CONFIRMED") {
        expect(rights.length).toBeGreaterThan(0);
      } else {
        expect(rights).toEqual([]);
        await expect(entitlementsRegion(page)).toHaveCount(0);
        // A Goods item that is still waiting for payment is not shown as a right (BR-ORD-015, INV-010-07).
        await expect(mainOf(page)).not.toContainText(copy.goods.item.PENDING_PAYMENT);
      }
      // The Order is displayed from the seed's snapshot: its total and its item names.
      const seed = seedOrder(row.ref);
      for (const item of seed.items) await expect(itemsRegion(page)).toContainText(item.name);
      await expect(itemsRegion(page)).toContainText(yen(Number(seed.total.amount)));
      // Reading an Order never changes seeded states.
      expect((await orderByRef(page, row.ref))?.state).toBe(row.state);
    });
  }

  test("a composite Order that is REVIEW_REQUIRED or AWAITING_PAYMENT shows neither Entry Ticket nor Goods as a right (E2E 27)", async ({
    page,
  }) => {
    await openAs(page, `/purchase/orders/${ORDER.review}`);
    await expect(outcomeRegion(page)).toContainText(label.REVIEW_REQUIRED);
    await expect(outcomeRegion(page)).toContainText(copy.purpose.ENTRY_GOODS_PURCHASE);
    expect(await entitlementHrefs(page)).toEqual([]);
    await expect(
      mainOf(page).getByRole("heading", {
        name: copy.purchase.entitlements.entryHeading,
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      mainOf(page).getByRole("heading", {
        name: copy.purchase.entitlements.goodsHeading,
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(mainOf(page)).not.toContainText(copy.goods.item.PENDING_PAYMENT);
  });
});

test.describe("TC-PG-XFN-001-666 a CONFIRMED Order shows the rights of its Purpose, the Receipt only when there is one (SPEC-050 16.5, 23, E2E 9 / 27)", () => {
  test("Entry: one link per purchased ticket, no Goods heading, an external Receipt link", async ({
    page,
  }) => {
    await openAs(page, `/purchase/orders/${ORDER.confirmedEntry}`);
    const tickets = (await readState(page)).tickets.filter(
      (t) => t.orderRef === ORDER.confirmedEntry,
    );
    expect(tickets).toHaveLength(4);
    expect(await entitlementHrefs(page)).toEqual(
      expect.arrayContaining(tickets.map((t) => `/mypage/entry-tickets/${t.ref}`)),
    );
    const rights = entitlementsRegion(page);
    await expect(rights.getByRole("link")).toHaveCount(4);
    await expect(
      rights.getByRole("heading", { name: copy.purchase.entitlements.entryHeading, exact: true }),
    ).toBeVisible();
    await expect(
      rights.getByRole("heading", { name: copy.purchase.entitlements.goodsHeading, exact: true }),
    ).toHaveCount(0);
    const receipt = mainOf(page).getByRole("link", {
      name: new RegExp(copy.purchase.receipt.link),
    });
    await expect(receipt).toHaveCount(1);
    await expect(receipt).toHaveAttribute("href", /^https:\/\//);
    await expect(receipt).toHaveAttribute("target", "_blank");
    await expect(receipt).toHaveAttribute("rel", /noopener/);
    await expect(receipt).toHaveAttribute("rel", /noreferrer/);
  });

  test("Goods: item and handoff states are shown as text with the pick-up guidance, no Entry heading", async ({
    page,
  }) => {
    await openAs(page, `/purchase/orders/${ORDER.confirmedGoods}`);
    const rights = entitlementsRegion(page);
    await expect(
      rights.getByRole("heading", { name: copy.purchase.entitlements.goodsHeading, exact: true }),
    ).toBeVisible();
    await expect(
      rights.getByRole("heading", { name: copy.purchase.entitlements.entryHeading, exact: true }),
    ).toHaveCount(0);
    await expect(rights).toContainText(copy.goods.item.FULFILLABLE);
    await expect(rights).toContainText(copy.goods.handoff.COMPLETED);
    await expect(rights).toContainText(copy.goods.detail.pickupNotice);
    expect(await actionsOf(page)).toEqual({
      buttons: [],
      links: [act.view_purchase, act.view_entitlements],
    });
    await expect(actionsOfLink(page, act.view_entitlements)).toHaveAttribute(
      "href",
      "/mypage/goods",
    );
  });

  test("composite: Entry Ticket and Goods are separate groups with their own states (E2E 27)", async ({
    page,
  }) => {
    await openAs(page, `/purchase/orders/${ORDER.confirmedComposite}`);
    const rights = entitlementsRegion(page);
    await expect(
      rights.getByRole("heading", { name: copy.purchase.entitlements.entryHeading, exact: true }),
    ).toBeVisible();
    await expect(
      rights.getByRole("heading", { name: copy.purchase.entitlements.goodsHeading, exact: true }),
    ).toBeVisible();
    await expect(rights).toContainText(copy.goods.item.FULFILLABLE);
    await expect(rights).toContainText(copy.goods.handoff.PENDING);
    await expect(rights.getByRole("link")).toHaveCount(2);
    await expect(outcomeRegion(page)).toContainText(copy.purpose.ENTRY_GOODS_PURCHASE);
    await expect(itemsRegion(page).getByRole("listitem")).toHaveCount(2);
  });

  test("Karaoke: the Reservation link and the usage date and time; no Receipt link when the Order has none", async ({
    page,
  }) => {
    await openAs(page, `/purchase/orders/${ORDER.kValid}`);
    await expect(outcomeRegion(page)).toContainText(copy.purpose.KARAOKE_PURCHASE);
    const rights = entitlementsRegion(page);
    await expect(
      rights.getByRole("heading", { name: copy.purchase.entitlements.karaokeHeading, exact: true }),
    ).toBeVisible();
    await expect(
      rights.getByRole("link", { name: copy.purchase.entitlements.reservationLink, exact: true }),
    ).toHaveAttribute("href", `/mypage/karaoke/${RESERVATION.valid}`);
    const item = seedOrder(ORDER.kValid).items[0];
    expect(item?.kind).toBe("KARAOKE");
    await expect(itemsRegion(page).getByRole("listitem")).toHaveCount(1);
    await expect(itemsRegion(page)).toContainText("利用日時");
    await expect(
      mainOf(page).getByRole("link", { name: new RegExp(copy.purchase.receipt.link) }),
    ).toHaveCount(0);
    await expect(actionsOfLink(page, act.view_entitlements)).toHaveAttribute(
      "href",
      "/mypage/karaoke",
    );
  });
});

test.describe("TC-PG-XFN-001-667 an Email failure is a non-blocking notice and never undoes the purchase (E2E 19, SPEC-050 16.7, 20.5)", () => {
  test("a CONFIRMED Order with a delayed Email keeps the success state and the rights and shows the contracted notice", async ({
    page,
  }) => {
    await openAs(page, `/purchase/orders/${ORDER.confirmedEntry}`, {
      scenario: { notification: "failed_retryable" },
    });
    await expect(outcomeRegion(page)).toContainText(label.CONFIRMED);
    await expect(outcomeRegion(page)).toContainText(copy.notification.FAILED_RETRYABLE.message);
    await expect(outcomeRegion(page)).toContainText(copy.notification.FAILED_RETRYABLE.label);
    await expect(entitlementsRegion(page).getByRole("link")).toHaveCount(4);
    // Non-blocking: no alert, no button (no Business retry), the state is not shown as a failure.
    await expect(alertsOf(page)).toHaveCount(0);
    await expect(mainOf(page).getByRole("button")).toHaveCount(0);
    await expect(mainOf(page)).not.toContainText(label.PAYMENT_FAILED);
    expect((await orderByRef(page, ORDER.confirmedEntry))?.state).toBe("CONFIRMED");
  });

  test("without a delayed Email there is no notice", async ({ page }) => {
    await openAs(page, `/purchase/orders/${ORDER.confirmedEntry}`);
    await expect(outcomeRegion(page)).toContainText(label.CONFIRMED);
    await expect(mainOf(page)).not.toContainText(copy.notification.FAILED_RETRYABLE.message);
  });

  test("the notice appears when the recheck confirms the Order, together with the rights", async ({
    page,
  }) => {
    await viaCartToStatus(page, { notification: "failed_retryable" });
    await expect(mainOf(page)).not.toContainText(copy.notification.FAILED_RETRYABLE.message);
    await actionButton(page, act.recheck_status).click();
    await expect(outcomeRegion(page)).toContainText(label.CONFIRMED);
    await expect(outcomeRegion(page)).toContainText(copy.notification.FAILED_RETRYABLE.message);
    await expect(entitlementsRegion(page)).toBeVisible();
    await expect(alertsOf(page)).toHaveCount(0);
  });
});

test.describe("TC-PG-XFN-001-668 a failed read is not an empty or denied page, and a failed recheck keeps what was shown (SPEC-050 9.3, 21, 26.2)", () => {
  test("when the Order cannot be read: an unavailable alert with a retry, no state, no denied view; the retry recovers", async ({
    page,
  }) => {
    await openAs(page, `/purchase/orders/${ORDER.confirmedEntry}`, {
      extra: { [KEYS.db]: "{ not json" },
    });
    await expect(alertsOf(page)).toHaveCount(1);
    await expect(alertsOf(page)).toContainText(copy.pageState.unavailable(copy.purchase.subject));
    await expect(heading1(page)).toHaveText(copy.purchase.heading);
    await expect(mainOf(page)).not.toContainText(label.CONFIRMED);
    await expect(mainOf(page)).not.toContainText(copy.accessDenied.title);
    await expect(entitlementsRegion(page)).toHaveCount(0);

    await writeStorage(page, KEYS.db, JSON.stringify(seedState()));
    await mainOf(page).getByRole("button", { name: copy.pageState.retry, exact: true }).click();
    await expect(outcomeRegion(page)).toContainText(label.CONFIRMED);
    await expect(alertsOf(page)).toHaveCount(0);
  });

  test("a failed recheck shows the failure but keeps the Order that was already shown, then a later recheck works", async ({
    page,
  }) => {
    const ref = await viaCartToStatus(page);
    const goodDb = await readDbRaw(page);
    expect(goodDb).not.toBeNull();
    await writeStorage(page, KEYS.db, "{ not json");
    await actionButton(page, act.recheck_status).click();
    await expect(alertsOf(page)).toHaveCount(1);
    await expect(alertsOf(page)).toContainText(copy.purchase.recheck.failed);
    // What was shown stays (not replaced by an empty or denied page, not shown as success).
    await expect(outcomeRegion(page)).toContainText(label.AWAITING_PAYMENT);
    await expect(itemsRegion(page).getByRole("listitem")).toHaveCount(2);
    await expect(mainOf(page)).not.toContainText(copy.accessDenied.title);

    await writeStorage(page, KEYS.db, goodDb ?? "");
    await actionButton(page, act.recheck_status).click();
    await expect(outcomeRegion(page)).toContainText(label.CONFIRMED);
    await expect(alertsOf(page)).toHaveCount(0);
    expect((await orderByRef(page, ref))?.state).toBe("CONFIRMED");
  });

  test("while the Order is being read, only a loading status is shown (no state, no amount)", async ({
    page,
  }) => {
    await openAs(page, `/purchase/orders/${ORDER.confirmedEntry}`, {
      scenario: { latency: "long", latencyLongMs: 2500 },
    });
    await expect(mainOf(page).locator('[role="status"]').first()).toContainText(
      copy.pageState.loading,
    );
    await expect(mainOf(page)).not.toContainText(label.CONFIRMED);
    await expect(mainOf(page)).not.toContainText(/[¥￥]\s*\d/);
    await expect(outcomeRegion(page)).toBeVisible({ timeout: 15_000 });
  });
});
