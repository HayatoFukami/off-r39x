import { expect, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { formatMoney } from "../../apps/web/src/presentation/format/money.ts";
import { readDbRaw, writeStorage } from "../harness/browser/cart.ts";
import {
  freshSession,
  goodsItemPath,
  hrefsIn,
  mainLink,
  orderPath,
  otherSession,
  PATH,
  pageButtons,
  region,
  retryButtons,
  rowsIn,
  rowWithHref,
  seedGoodsItem,
} from "../harness/browser/mypage.ts";
import { seedState } from "../harness/browser/public.ts";
import { alertsOf, heading1, mainOf, openAs } from "../harness/browser/purchase.ts";
import { KEYS } from "../harness/browser/shell.ts";
import { GOODS_ITEM, ORDER } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s8-mypage.md sections 4.13 and 4.14.
// SPEC-050 18.11 / 18.12 (PG-MYP-011 / 012), 20.4, 23, 31 items 18 / 19, INV-010-07 / 08 / 10, BR-GDS.

const list = () => copy.mypage.goodsItems;
const detail = () => copy.mypage.goodsItems.detail;
const g = copy.goods;

type Case = {
  name: string;
  ref: string;
  order: string;
  orderState: keyof typeof copy.order.state;
  primary: string;
  itemLabel: string;
  handoffLabel: string;
  receivable: boolean;
  completed: boolean;
  receipt: boolean;
  /** Primary labels of the other outcomes, which this item must not show. */
  not: string[];
};

const AWAITING_PICKUP = g.awaiting;
const UNPAID = g.item.PENDING_PAYMENT;
const HANDED_OVER = g.handoff.COMPLETED;
const VOID_LABEL = g.item.CANCELED;

const CASES: Case[] = [
  {
    name: "pending payment (AWAITING_PAYMENT Order)",
    ref: GOODS_ITEM.pendingPayment,
    order: ORDER.awaiting,
    orderState: "AWAITING_PAYMENT",
    primary: UNPAID,
    itemLabel: g.item.PENDING_PAYMENT,
    handoffLabel: g.handoff.PENDING,
    receivable: false,
    completed: false,
    receipt: false,
    not: [AWAITING_PICKUP, HANDED_OVER],
  },
  {
    name: "handed over (FULFILLABLE + COMPLETED)",
    ref: GOODS_ITEM.completed,
    order: ORDER.confirmedGoods,
    orderState: "CONFIRMED",
    primary: HANDED_OVER,
    itemLabel: g.item.FULFILLABLE,
    handoffLabel: g.handoff.COMPLETED,
    receivable: false,
    completed: true,
    receipt: true,
    not: [AWAITING_PICKUP, UNPAID],
  },
  {
    name: "awaiting pickup (FULFILLABLE + PENDING)",
    ref: GOODS_ITEM.fulfillable,
    order: ORDER.confirmedComposite,
    orderState: "CONFIRMED",
    primary: AWAITING_PICKUP,
    itemLabel: g.item.FULFILLABLE,
    handoffLabel: g.handoff.PENDING,
    receivable: true,
    completed: false,
    receipt: true,
    not: [UNPAID, HANDED_OVER, VOID_LABEL],
  },
  {
    name: "canceled (CANCELED + VOID)",
    ref: GOODS_ITEM.canceled,
    order: ORDER.paymentFailed,
    orderState: "PAYMENT_FAILED",
    primary: VOID_LABEL,
    itemLabel: g.item.CANCELED,
    handoffLabel: g.handoff.VOID,
    receivable: false,
    completed: false,
    receipt: false,
    not: [AWAITING_PICKUP, HANDED_OVER],
  },
  {
    name: "pending payment (REVIEW_REQUIRED composite Order)",
    ref: GOODS_ITEM.review,
    order: ORDER.review,
    orderState: "REVIEW_REQUIRED",
    primary: UNPAID,
    itemLabel: g.item.PENDING_PAYMENT,
    handoffLabel: g.handoff.PENDING,
    receivable: false,
    completed: false,
    receipt: false,
    not: [AWAITING_PICKUP, HANDED_OVER],
  },
];

test.describe("TC-PG-MYP-011-701 the Goods list shows what can be received at the venue, item by item (E2E 18, SPEC-050 18.11, 20.4)", () => {
  test("lists demo's five items in order, each with its main outcome, both states and the Order state", async ({
    page,
  }) => {
    await openAs(page, PATH.goodsItems);
    await expect(heading1(page)).toHaveText(list().heading);
    await expect(heading1(page)).toHaveCount(1);
    await expect(page).toHaveTitle(new RegExp(`^${list().pageTitle} \\|`));
    const rows = rowsIn(mainOf(page));
    await expect(rows).toHaveCount(5);
    expect(await hrefsIn(rows)).toEqual(
      [
        GOODS_ITEM.pendingPayment,
        GOODS_ITEM.completed,
        GOODS_ITEM.fulfillable,
        GOODS_ITEM.canceled,
        GOODS_ITEM.review,
      ].flatMap((ref) => {
        const found = CASES.find((c) => c.ref === ref);
        return found === undefined ? [] : [goodsItemPath(ref), orderPath(found.order)];
      }),
    );
    for (const c of CASES) {
      const source = seedGoodsItem(c.ref);
      const row = rowWithHref(mainOf(page), goodsItemPath(c.ref));
      await expect(row, c.name).toHaveCount(1);
      await expect(row).toContainText(source.goodsName);
      await expect(row).toContainText(copy.purchase.quantity(source.quantity));
      await expect(row).toContainText(c.primary);
      await expect(row).toContainText(list().itemStateLabel);
      await expect(row).toContainText(c.itemLabel);
      await expect(row).toContainText(list().handoffStateLabel);
      await expect(row).toContainText(c.handoffLabel);
      await expect(row).toContainText(list().orderStateLabel);
      await expect(row).toContainText(copy.order.state[c.orderState]);
      await expect(row.locator(`a[href="${orderPath(c.order)}"]`)).toHaveCount(1);
      const text = await row.innerText();
      for (const wrong of c.not) expect(text, `${c.name}: ${wrong}`).not.toContain(wrong);
    }
  });

  test("an unpaid item is never shown as awaiting pickup, and only the paid, not yet handed-over item is", async ({
    page,
  }) => {
    await openAs(page, PATH.goodsItems);
    const awaiting = [];
    for (const c of CASES) {
      const text = await rowWithHref(mainOf(page), goodsItemPath(c.ref)).innerText();
      if (text.includes(AWAITING_PICKUP)) awaiting.push(c.ref);
    }
    expect(awaiting).toEqual([GOODS_ITEM.fulfillable]);
  });

  test("a row opens the Goods detail", async ({ page }) => {
    await openAs(page, PATH.goodsItems);
    await mainLink(page, list().detailLink("Tシャツ")).first().click();
    await expect(page).toHaveURL(/\/mypage\/goods\/[0-9a-f-]{36}$/);
    await expect(heading1(page)).toHaveText(detail().heading);
  });
});

test.describe("TC-PG-MYP-011-702 loading, Empty and a failed read are three different states, and only the viewer's items are listed (SPEC-050 9, 18.11, INV-010-08)", () => {
  test("a user without Goods purchases sees the Empty message only", async ({ page }) => {
    await openAs(page, PATH.goodsItems, { session: freshSession() });
    await expect(mainOf(page)).toContainText(list().empty);
    await expect(rowsIn(mainOf(page))).toHaveCount(0);
    await expect(alertsOf(page)).toHaveCount(0);
  });

  test("another user sees only their own item", async ({ page }) => {
    await openAs(page, PATH.goodsItems, { session: otherSession() });
    await expect(rowsIn(mainOf(page))).toHaveCount(1);
    await expect(rowWithHref(mainOf(page), goodsItemPath(GOODS_ITEM.other))).toHaveCount(1);
    await expect(rowWithHref(mainOf(page), goodsItemPath(GOODS_ITEM.fulfillable))).toHaveCount(0);
  });

  test("an unreadable list is an unavailable alert with a retry, never the Empty message", async ({
    page,
  }) => {
    await openAs(page, PATH.goodsItems, { extra: { [KEYS.db]: "{ not json" } });
    await expect(alertsOf(page)).toContainText(copy.pageState.unavailable(list().subject));
    await expect(mainOf(page)).not.toContainText(list().empty);
    await writeStorage(page, KEYS.db, JSON.stringify(seedState()));
    await retryButtons(mainOf(page)).click();
    await expect(rowsIn(mainOf(page))).toHaveCount(5);
  });

  test("while loading no item and no Empty message is shown", async ({ page }) => {
    await openAs(page, PATH.goodsItems, { scenario: { latency: "long", latencyLongMs: 2500 } });
    await expect(mainOf(page).locator('[role="status"]').first()).toContainText(
      copy.pageState.loading,
    );
    expect(await mainOf(page).innerText()).not.toContain(list().empty);
    await expect(rowsIn(mainOf(page))).toHaveCount(5, { timeout: 15_000 });
  });
});

test.describe("TC-PG-MYP-012-701 the Goods detail states the outcome, the purchase-time price and the pickup guidance only when it applies (E2E 18, SPEC-050 18.12, 20.4)", () => {
  for (const c of CASES) {
    test(c.name, async ({ page }) => {
      await openAs(page, goodsItemPath(c.ref));
      await expect(heading1(page)).toHaveText(detail().heading);
      await expect(heading1(page)).toHaveCount(1);
      await expect(page).toHaveTitle(new RegExp(`^${detail().pageTitle} \\|`));
      const info = region(page, detail().infoHeading);
      await expect(info).toBeVisible();
      const source = seedGoodsItem(c.ref);
      const order = seedState().orders.find((o) => o.ref === c.order);
      const line = order?.items.find((i) => i.kind === "GOODS");
      if (line === undefined) throw new Error("seed Goods line missing");

      await expect(info).toContainText(detail().nameLabel);
      await expect(info).toContainText(source.goodsName);
      await expect(info).toContainText(copy.purchase.quantity(source.quantity));
      await expect(info).toContainText(copy.cart.unitPriceLabel);
      await expect(info).toContainText(formatMoney(line.unitPrice));
      await expect(info).toContainText(copy.cart.subtotalLabel);
      await expect(info).toContainText(
        formatMoney({
          amount: String(Number(line.unitPrice.amount) * source.quantity),
          currency: "JPY",
        }),
      );
      await expect(info).toContainText(list().itemStateLabel);
      await expect(info).toContainText(c.itemLabel);
      await expect(info).toContainText(list().handoffStateLabel);
      await expect(info).toContainText(c.handoffLabel);
      await expect(info).toContainText(c.primary);
      await expect(info).toContainText(list().orderStateLabel);
      await expect(info).toContainText(copy.order.state[c.orderState]);
      const text = await info.innerText();
      for (const wrong of c.not) expect(text, `${c.name}: ${wrong}`).not.toContain(wrong);

      // Pickup guidance only where the item can be received; the second pickup is excluded once handed over.
      if (c.receivable) {
        await expect(info).toContainText(g.detail.pickupNotice);
      } else {
        await expect(mainOf(page)).not.toContainText(g.detail.pickupNotice);
      }
      if (c.completed) {
        await expect(info).toContainText(detail().noSecondHandoff);
      } else {
        await expect(mainOf(page)).not.toContainText(detail().noSecondHandoff);
      }

      // Nothing can be pressed: a handed-over item can never be set back to pending by a customer.
      expect(await pageButtons(page).count()).toBe(0);
      await expect(mainLink(page, list().orderLink)).toHaveAttribute("href", orderPath(c.order));
      await expect(mainLink(page, detail().backToList)).toHaveAttribute("href", PATH.goodsItems);

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

test.describe("TC-PG-MYP-012-702 loading and a failed read are not shown as an item or as Access Denied; reloading changes nothing (SPEC-050 9, 21, 22, 26.2)", () => {
  test("an unreadable item is an unavailable alert with a retry that recovers", async ({
    page,
  }) => {
    await openAs(page, goodsItemPath(GOODS_ITEM.fulfillable), {
      extra: { [KEYS.db]: "{ not json" },
    });
    await expect(heading1(page)).toHaveText(detail().heading);
    await expect(alertsOf(page)).toContainText(copy.pageState.unavailable(detail().subject));
    await expect(mainOf(page)).not.toContainText(copy.accessDenied.title);
    await expect(mainOf(page)).not.toContainText(AWAITING_PICKUP);
    await writeStorage(page, KEYS.db, JSON.stringify(seedState()));
    await retryButtons(mainOf(page)).click();
    await expect(region(page, detail().infoHeading)).toContainText(AWAITING_PICKUP);
  });

  test("while loading only the loading state is shown", async ({ page }) => {
    await openAs(page, goodsItemPath(GOODS_ITEM.fulfillable), {
      scenario: { latency: "long", latencyLongMs: 2500 },
    });
    await expect(mainOf(page).locator('[role="status"]').first()).toContainText(
      copy.pageState.loading,
    );
    const early = await mainOf(page).innerText();
    expect(early).not.toContain(AWAITING_PICKUP);
    expect(early).not.toMatch(/[¥￥]\s*\d/);
    await expect(region(page, detail().infoHeading)).toBeVisible({ timeout: 15_000 });
  });

  test("a reload reads the same item and leaves the Business data unchanged", async ({ page }) => {
    await openAs(page, goodsItemPath(GOODS_ITEM.fulfillable));
    await expect(region(page, detail().infoHeading)).toContainText(AWAITING_PICKUP);
    const before = await readDbRaw(page);
    await page.reload();
    await expect(region(page, detail().infoHeading)).toContainText(AWAITING_PICKUP);
    expect(await readDbRaw(page)).toBe(before);
  });
});

test.describe("TC-PG-MYP-012-703 Email failure does not take away a confirmed item or its pickup guidance (E2E 19, SPEC-050 18.12, INV-010-06)", () => {
  test("with a delayed Email the CONFIRMED Order's item is still awaiting pickup with the guidance", async ({
    page,
  }) => {
    await openAs(page, goodsItemPath(GOODS_ITEM.fulfillable), {
      scenario: { notification: "failed_retryable" },
    });
    const info = region(page, detail().infoHeading);
    await expect(info).toContainText(AWAITING_PICKUP);
    await expect(info).toContainText(g.detail.pickupNotice);
    await expect(info).toContainText(copy.order.state.CONFIRMED);
    await expect(alertsOf(page)).toHaveCount(0);
    await expect(mainLink(page, copy.purchase.receipt.link)).toHaveCount(1);
  });
});

test.describe("TC-PG-MYP-012-704 the list and the detail agree about the same item (SPEC-050 18.11 / 18.12, INV-010-10)", () => {
  test("the main outcome shown in the list is the one shown in the detail", async ({ page }) => {
    await openAs(page, PATH.goodsItems);
    for (const c of CASES) {
      await expect(rowWithHref(mainOf(page), goodsItemPath(c.ref))).toContainText(c.primary);
    }
    for (const c of CASES.filter((x) => x.receivable || x.completed)) {
      await mainLink(page, list().detailLink(seedGoodsItem(c.ref).goodsName))
        .and(page.locator(`a[href="${goodsItemPath(c.ref)}"]`))
        .click();
      await expect(region(page, detail().infoHeading)).toContainText(c.primary);
      await page.goBack();
      await expect(rowsIn(mainOf(page))).toHaveCount(5);
    }
  });
});
