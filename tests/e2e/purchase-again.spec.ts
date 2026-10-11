import { expect, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  cartEntries,
  proceedButton as cartProceed,
  entryLine,
  expectedGoodsDetail,
  FORBIDDEN_IN_CART_STORAGE,
  failCartWrites,
  goodsLine,
  headerCartLink,
  offeringName,
  readCart,
  readCartRaw,
  readDbRaw,
  rowByHeading,
} from "../harness/browser/cart.ts";
import {
  actionButton,
  alertsOf,
  mainOf,
  openAs,
  ordersOf,
  outcomeRegion,
} from "../harness/browser/purchase.ts";
import { KEYS } from "../harness/browser/shell.ts";
import { GOODS, OFFERING, ORDER } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s7a-purchase.md sections 3.4, 6.2.
// SPEC-050 16.4 (purchase again), 14A.1, 18.4, 31 item 12, SPEC-020 FR-CRT-011, FR-CRT-002, SPEC-170 TST-E2E-003.
// Purchase again re-inserts references and quantities into the Cart and shows current prices and sale states;
// it never creates an Order. Karaoke restarts from slot selection.

const act = copy.order.action;
const parsed = (raw: string | null): unknown => (raw === null ? null : JSON.parse(raw));
const parsedOrders = async (page: Parameters<typeof ordersOf>[0]) => ordersOf(page);

test.describe("TC-PG-XFN-001-671 purchase again for Goods / Entry returns the items to the Cart and creates no Order (E2E 12, SPEC-050 16.4)", () => {
  test("PAYMENT_FAILED Goods Order: the item goes to /cart with its current state (suspended), proceeding stays blocked", async ({
    page,
  }) => {
    await openAs(page, `/purchase/orders/${ORDER.paymentFailed}`);
    await expect(outcomeRegion(page)).toContainText(copy.order.state.PAYMENT_FAILED);
    const dbBefore = parsed(await readDbRaw(page));
    const ordersBefore = await parsedOrders(page);

    await actionButton(page, act.purchase_again).click();
    await expect(page).toHaveURL(/\/cart$/);
    const lanyard = expectedGoodsDetail(GOODS.lanyard);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.cart.heading);
    const row = rowByHeading(page, lanyard.name);
    await expect(row).toBeVisible();
    // Price and sale state are the current ones, read again: the lanyard is suspended.
    await expect(row).toContainText(copy.availability.label.SUSPENDED);
    await expect(cartProceed(page)).toBeDisabled();
    await expect(mainOf(page)).toContainText(copy.cart.proceed.blocked);

    // Only a reference and a quantity were stored (FR-CRT-003); nothing else changed.
    expect(await readCart(page)).toEqual({ version: 1, lines: [goodsLine(GOODS.lanyard, 1)] });
    expect(await readCartRaw(page)).not.toMatch(FORBIDDEN_IN_CART_STORAGE);
    await expect(headerCartLink(page, 1)).toBeVisible();
    expect(parsed(await readDbRaw(page))).toEqual(dbBefore);
    expect(await parsedOrders(page)).toEqual(ordersBefore);
  });

  test("CANCELED Entry Order: the ticket line returns to the Cart; the Purchase Limit is evaluated again, not remembered", async ({
    page,
  }) => {
    await openAs(page, `/purchase/orders/${ORDER.canceled}`);
    await expect(outcomeRegion(page)).toContainText(copy.order.state.CANCELED);
    await actionButton(page, act.purchase_again).click();
    await expect(page).toHaveURL(/\/cart$/);
    expect(await readCart(page)).toEqual({ version: 1, lines: [entryLine(OFFERING.limit, 1)] });
    const row = rowByHeading(page, offeringName(OFFERING.limit));
    await expect(row).toBeVisible();
    // demo already holds more than the per-account limit of this offering.
    await expect(row).toContainText(copy.availability.label.PURCHASE_LIMIT_EXCEEDED);
    await expect(cartProceed(page)).toBeDisabled();
  });

  test("a terminal composite Order is merged into an existing Cart: same item adds up, the other item is appended", async ({
    page,
  }) => {
    await openAs(page, `/purchase/orders/${ORDER.review}`, {
      dbEdit: (state) => {
        const target = state.orders.find((o) => o.ref === ORDER.review);
        if (target === undefined) throw new Error("seed order missing");
        target.state = "CANCELED";
      },
      extra: cartEntries([goodsLine(GOODS.tshirt, 2)]),
    });
    await expect(outcomeRegion(page)).toContainText(copy.order.state.CANCELED);
    await expect(headerCartLink(page, 2)).toBeVisible();
    await actionButton(page, act.purchase_again).click();
    await expect(page).toHaveURL(/\/cart$/);
    expect(await readCart(page)).toEqual({
      version: 1,
      lines: [goodsLine(GOODS.tshirt, 3), entryLine(OFFERING.limit, 1)],
    });
    await expect(headerCartLink(page, 4)).toBeVisible();
    await expect(mainOf(page).getByRole("listitem")).toHaveCount(2);
  });

  test("works from the keyboard and never starts a purchase: no Order is created by re-inserting", async ({
    page,
  }) => {
    await openAs(page, `/purchase/orders/${ORDER.canceled}`, { lines: [] });
    const button = actionButton(page, act.purchase_again);
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/cart$/);
    expect(await readCart(page)).toEqual({ version: 1, lines: [entryLine(OFFERING.limit, 1)] });
    expect(await parsedOrders(page)).toHaveLength(13);
  });
});

test.describe("TC-PG-XFN-001-672 purchase again for Karaoke restarts from slot selection and leaves the Cart alone (E2E 12, SPEC-050 16.4, FR-CRT-002)", () => {
  test("an EXPIRED Karaoke Order goes to /karaoke; the Cart and the DB do not change", async ({
    page,
  }) => {
    await openAs(page, `/purchase/orders/${ORDER.expired}`, {
      extra: cartEntries([entryLine(OFFERING.regular, 2)]),
    });
    await expect(outcomeRegion(page)).toContainText(copy.order.state.EXPIRED);
    const cartBefore = await readCartRaw(page);
    const dbBefore = parsed(await readDbRaw(page));
    await actionButton(page, act.purchase_again).click();
    await expect(page).toHaveURL(/\/karaoke$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.karaoke.guide.heading);
    expect(await readCartRaw(page)).toBe(cartBefore);
    expect(parsed(await readDbRaw(page))).toEqual(dbBefore);
  });

  test("without a Cart, Karaoke purchase-again does not create one", async ({ page }) => {
    await openAs(page, `/purchase/orders/${ORDER.expired}`);
    const cartBefore = await readCartRaw(page);
    await actionButton(page, act.purchase_again).click();
    await expect(page).toHaveURL(/\/karaoke$/);
    expect(await readCartRaw(page)).toBe(cartBefore);
  });
});

test.describe("TC-PG-XFN-001-673 purchase again never overwrites an unreadable Cart and never claims a write that failed (SPEC-050 26.4, FR-CRT-003)", () => {
  test("a damaged Cart is kept as it is: the user lands on /cart, which shows the unreadable-Cart alert", async ({
    page,
  }) => {
    await openAs(page, `/purchase/orders/${ORDER.paymentFailed}`, {
      extra: { [KEYS.cart]: "{ damaged" },
    });
    await actionButton(page, act.purchase_again).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(alertsOf(page)).toContainText(copy.cart.corrupted.title);
    expect(await readCartRaw(page)).toBe("{ damaged");
  });

  test("when the browser cannot save the Cart, the page stays, says so and shows no success", async ({
    page,
  }) => {
    await failCartWrites(page);
    await openAs(page, `/purchase/orders/${ORDER.paymentFailed}`);
    await actionButton(page, act.purchase_again).click();
    await expect(alertsOf(page)).toHaveCount(1);
    await expect(alertsOf(page)).toContainText(copy.sales.addFailed);
    await expect(page).toHaveURL(new RegExp(`/purchase/orders/${ORDER.paymentFailed}$`));
    await expect(outcomeRegion(page)).toContainText(copy.order.state.PAYMENT_FAILED);
    expect(await readCartRaw(page)).toBeNull();
  });
});
