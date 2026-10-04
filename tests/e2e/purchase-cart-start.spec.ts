import type { OrderPurpose } from "@off-r39x/domain";
import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { focused, loginWith, unverifiedSession, urlOf } from "../harness/browser/auth.ts";
import {
  EMPTY_CART_JSON,
  entryLine,
  expectedGoodsDetail,
  expectedOfferings,
  goodsLine,
  offeringName,
  quantityInput,
  readCart,
  readCartRaw,
  readDbRaw,
  removeButton,
  rowByHeading,
  type StoredLine,
} from "../harness/browser/cart.ts";
import {
  alertsOf,
  mainOf,
  newOrders,
  openAs,
  ordersOf,
  proceedButton,
  proceedToMockCheckout,
  remainingOf,
  seenTexts,
  setScenario,
  suspendOffering,
  waitSeen,
  watchTexts,
} from "../harness/browser/purchase.ts";
import { EMAIL, GOODS, OFFERING } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s7a-purchase.md sections 4, 9.
// SPEC-050 14A.1 (Actions, Purchase start result), 21, 22, 31 items 3 / 7 (first half) / 24 / 26,
// SPEC-030 BR-ORD-013 / 014 / 016, SPEC-020 FR-CRT-007 .. 011. Expected DB postconditions are the mock DB.

const price = (ref: string) => {
  const found = expectedOfferings().find((o) => o.ref === ref);
  if (found === undefined) throw new Error(`unknown offering ${ref}`);
  return found.unitPrice;
};
const goodsPrice = (ref: string) => expectedGoodsDetail(ref).unitPrice;
const amountOf = (lines: readonly StoredLine[]): number =>
  lines.reduce(
    (sum, line) =>
      sum +
      Number(
        line.kind === "ENTRY_TICKET"
          ? price(line.offeringRef).amount
          : goodsPrice(line.goodsRef).amount,
      ) *
        line.quantity,
    0,
  );

const COMPOSITE = [entryLine(OFFERING.regular, 1), goodsLine(GOODS.tshirt, 1)];
const parsed = (raw: string | null): unknown => (raw === null ? null : JSON.parse(raw));

async function openCart(
  page: Page,
  lines: readonly StoredLine[],
  options: Parameters<typeof openAs>[2] = {},
): Promise<void> {
  await openAs(page, "/cart", { ...options, lines });
  await expect(mainOf(page).getByRole("listitem")).toHaveCount(lines.length, { timeout: 15_000 });
}

test.describe("TC-PG-CRT-001-611 a guest is sent to Login with the Cart intent and comes back to the same Cart (SPEC-050 14A.1, 31 items 3 / 24)", () => {
  test("proceeding as a guest goes to /account/login?continue=cart without creating anything, and Login returns to /cart with the lines", async ({
    page,
  }) => {
    await openCart(page, COMPOSITE, { session: null });
    await expect(proceedButton(page)).toBeEnabled();
    const dbBefore = parsed(await readDbRaw(page));
    const cartBefore = await readCartRaw(page);

    await proceedButton(page).click();
    await expect(page).toHaveURL(/\/account\/login\?continue=cart$/);
    expect(parsed(await readDbRaw(page))).toEqual(dbBefore);
    expect(await readCartRaw(page)).toBe(cartBefore);
    expect(await newOrders(page)).toHaveLength(0);

    await loginWith(page, EMAIL.demo);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(mainOf(page).getByRole("listitem")).toHaveCount(2);
    expect(await readCartRaw(page)).toBe(cartBefore);
    expect(await newOrders(page)).toHaveLength(0);
  });

  test("an unverified Authenticated user is sent to Email Verification with the Cart intent; nothing is created", async ({
    page,
  }) => {
    await openCart(page, COMPOSITE, { session: unverifiedSession() });
    const dbBefore = parsed(await readDbRaw(page));
    const cartBefore = await readCartRaw(page);
    await expect(proceedButton(page)).toBeEnabled();
    await proceedButton(page).click();
    await expect(page).toHaveURL(/\/account\/email-verification\?continue=cart$/);
    expect(parsed(await readDbRaw(page))).toEqual(dbBefore);
    expect(await readCartRaw(page)).toBe(cartBefore);
    expect(await newOrders(page)).toHaveLength(0);
  });
});

test.describe("TC-PG-CRT-001-612 an Authenticated user's purchase start creates one Order with a server-decided Purpose (BR-ORD-013 / 014, SPEC-050 14A.1)", () => {
  const cases: { name: string; lines: StoredLine[]; purpose: OrderPurpose }[] = [
    {
      name: "Entry only",
      lines: [entryLine(OFFERING.regular, 2)],
      purpose: "ENTRY_TICKET_PURCHASE",
    },
    {
      name: "Goods only",
      lines: [goodsLine(GOODS.tshirt, 1), goodsLine(GOODS.towel, 1)],
      purpose: "GOODS_PURCHASE",
    },
    {
      name: "Entry and Goods in one Cart (composite)",
      lines: [entryLine(OFFERING.regular, 1), goodsLine(GOODS.tshirt, 2)],
      purpose: "ENTRY_GOODS_PURCHASE",
    },
  ];

  for (const c of cases) {
    test(`${c.name}: exactly one Order (${c.purpose}), PREPARED then AWAITING_PAYMENT at the mock Checkout, allocation taken, included lines removed`, async ({
      page,
    }) => {
      await openCart(page, c.lines);
      const before = (await ordersOf(page)).length;
      const regularBefore = await remainingOf(page, "offering", OFFERING.regular);
      const tshirtBefore = await remainingOf(page, "goods", GOODS.tshirt);
      const towelBefore = await remainingOf(page, "goods", GOODS.towel);

      const orderRef = await proceedToMockCheckout(page);

      const created = await newOrders(page);
      expect(created).toHaveLength(1);
      expect(await ordersOf(page)).toHaveLength(before + 1);
      const order = created[0];
      expect(order?.ref).toBe(orderRef);
      expect(order?.ownerEmail).toBe(EMAIL.demo);
      expect(order?.purpose).toBe(c.purpose);
      // The Checkout start succeeded: the Order waits for the (simulated) webhook and is not confirmed.
      expect(order?.state).toBe("AWAITING_PAYMENT");
      expect(order?.pendingWebhook).toBe(true);
      expect(order?.webhookReads).toBe(0);
      expect(order?.items.map((i) => [i.kind, i.quantity])).toEqual(
        c.lines.map((l) => [l.kind, l.quantity]),
      );
      expect(Number(order?.total.amount)).toBe(amountOf(c.lines));
      expect(order?.total.currency).toBe("JPY");

      // The allocation was taken for the whole Order (BR-ORD-014) and the included lines left the Cart.
      const taken = (ref: string): number =>
        c.lines
          .filter((l) => (l.kind === "ENTRY_TICKET" ? l.offeringRef : l.goodsRef) === ref)
          .reduce((n, l) => n + l.quantity, 0);
      expect(await remainingOf(page, "offering", OFFERING.regular)).toBe(
        (regularBefore ?? 0) - taken(OFFERING.regular),
      );
      expect(await remainingOf(page, "goods", GOODS.tshirt)).toBe(
        (tshirtBefore ?? 0) - taken(GOODS.tshirt),
      );
      expect(await remainingOf(page, "goods", GOODS.towel)).toBe(
        (towelBefore ?? 0) - taken(GOODS.towel),
      );
      expect(await readCartRaw(page)).toBe(EMPTY_CART_JSON);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.mockCheckout.heading);
    });
  }

  test("the button works from the keyboard (Enter on the focused button) and the Cart quantities are what the Order holds", async ({
    page,
  }) => {
    await openCart(page, [entryLine(OFFERING.regular, 3)]);
    await proceedButton(page).focus();
    await expect(proceedButton(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/dev\/mock-checkout\//);
    const created = await newOrders(page);
    expect(created).toHaveLength(1);
    expect(created[0]?.items.map((i) => i.quantity)).toEqual([3]);
  });
});

test.describe("TC-PG-CRT-001-613 progress is shown without claiming success, and a double click creates one Order (SPEC-050 14A.1 Action実行中, 21)", () => {
  const LATENCY = { latency: "long", latencyLongMs: 2500 };

  test("verifying, then preparing: the button is busy, no empty Cart and no success wording appears", async ({
    page,
  }) => {
    await watchTexts(page, [
      copy.cart.purchase.verifying,
      copy.cart.purchase.preparing,
      copy.cart.empty,
    ]);
    await openCart(page, COMPOSITE, { scenario: LATENCY });
    await expect(proceedButton(page)).toBeEnabled({ timeout: 15_000 });

    await proceedButton(page).click();
    await waitSeen(page, copy.cart.purchase.verifying);
    await expect(mainOf(page).locator('[role="status"]')).toContainText(
      copy.cart.purchase.verifying,
    );
    await expect(proceedButton(page)).toBeDisabled();
    await expect(proceedButton(page)).toHaveAttribute("aria-busy", "true");
    // The lines stay visible while the conditions are being verified.
    await expect(mainOf(page).getByRole("listitem")).toHaveCount(2);
    expect(await newOrders(page)).toHaveLength(0);

    await waitSeen(page, copy.cart.purchase.preparing);
    await expect(mainOf(page).locator('[role="status"]')).toContainText(
      copy.cart.purchase.preparing,
    );
    await expect(mainOf(page)).not.toContainText(copy.order.state.CONFIRMED);
    await expect(mainOf(page)).not.toContainText(/支払い完了|成功|完了しました/);
    const seen = await seenTexts(page);
    expect(
      seen[copy.cart.empty],
      "the empty Cart text must not flash while the Order is being handed off",
    ).toBe(false);
    await expect(proceedButton(page)).toHaveCount(0);

    await page.waitForURL(/\/dev\/mock-checkout\//, { timeout: 20_000 });
    expect(await newOrders(page)).toHaveLength(1);
  });

  test("a double click starts exactly one purchase (the UI suppresses the duplicate send)", async ({
    page,
  }) => {
    await openCart(page, COMPOSITE, { scenario: { latency: "long", latencyLongMs: 1500 } });
    await expect(proceedButton(page)).toBeEnabled({ timeout: 15_000 });
    await proceedButton(page).dblclick();
    await page.waitForURL(/\/dev\/mock-checkout\//, { timeout: 20_000 });
    expect(await newOrders(page)).toHaveLength(1);
    expect(await ordersOf(page)).toHaveLength(14); // 13 seeded demo Orders + 1
  });
});

test.describe("TC-PG-CRT-001-614 a rejected purchase start creates nothing, keeps the Cart and names the lines (E2E 26, BR-ORD-014, SPEC-050 14A.1, 21)", () => {
  const alertOf = (page: Page) => alertsOf(page);

  test("reject_one: 'not started' with the rejected line and its reason, focus on the summary, Cart and DB untouched", async ({
    page,
  }) => {
    await openCart(page, COMPOSITE, {
      scenario: { cart: { state: "ok", purchaseStart: "reject_one" } },
    });
    await expect(proceedButton(page)).toBeEnabled();
    const dbBefore = parsed(await readDbRaw(page));
    const cartBefore = await readCartRaw(page);
    const ordersBefore = (await ordersOf(page)).length;

    await proceedButton(page).click();
    const summary = alertOf(page);
    await expect(summary).toHaveCount(1);
    await expect(summary).toContainText(copy.cart.purchase.rejectedTitle);
    await expect(summary).toContainText(copy.cart.purchase.rejectedBody);
    // Only the first line is rejected (ALLOCATION_CONFLICT); the other line is not blamed.
    await expect(summary).toContainText(offeringName(OFFERING.regular));
    await expect(summary).toContainText(copy.availability.label.ALLOCATION_CONFLICT);
    await expect(summary).toContainText(copy.availability.description.ALLOCATION_CONFLICT);
    await expect(summary).not.toContainText(expectedGoodsDetail(GOODS.tshirt).name);
    expect((await focused(page)).role).toBe("alert");

    // Nothing was created, allocated or removed.
    await expect(page).toHaveURL(/\/cart$/);
    expect(await readCartRaw(page)).toBe(cartBefore);
    expect(parsed(await readDbRaw(page))).toEqual(dbBefore);
    expect(await ordersOf(page)).toHaveLength(ordersBefore);
    expect(await newOrders(page)).toHaveLength(0);
    await expect(mainOf(page).getByRole("listitem")).toHaveCount(2);
    await expect(proceedButton(page)).toBeEnabled();
    await expect(mainOf(page)).not.toContainText(copy.cart.empty);
  });

  test("the Cart stays editable after a rejection: change a quantity, delete a line, then retry once the condition is gone", async ({
    page,
  }) => {
    await openCart(page, COMPOSITE, {
      scenario: { cart: { state: "ok", purchaseStart: "reject_one" } },
    });
    await expect(proceedButton(page)).toBeEnabled();
    await proceedButton(page).click();
    await expect(alertOf(page)).toContainText(copy.cart.purchase.rejectedTitle);

    const regularRow = rowByHeading(page, offeringName(OFFERING.regular));
    await quantityInput(regularRow).fill("2");
    await expect
      .poll(() => readCart(page))
      .toEqual({
        version: 1,
        lines: [entryLine(OFFERING.regular, 2), goodsLine(GOODS.tshirt, 1)],
      });
    await removeButton(rowByHeading(page, expectedGoodsDetail(GOODS.tshirt).name)).click();
    await expect(mainOf(page).getByRole("listitem")).toHaveCount(1);

    // The condition goes away (the same attempt is not replayed by itself): a new attempt succeeds.
    await setScenario(page, { cart: { state: "ok", purchaseStart: "ok" } });
    await expect(proceedButton(page)).toBeEnabled();
    await proceedButton(page).click();
    await page.waitForURL(/\/dev\/mock-checkout\//);
    const created = await newOrders(page);
    expect(created).toHaveLength(1);
    expect(created[0]?.purpose).toBe("ENTRY_TICKET_PURCHASE");
    expect(created[0]?.items.map((i) => i.quantity)).toEqual([2]);
  });

  test("limit: the Purchase Limit reason is named for the first line and nothing is created", async ({
    page,
  }) => {
    await openCart(page, COMPOSITE, {
      scenario: { cart: { state: "ok", purchaseStart: "limit" } },
    });
    await expect(proceedButton(page)).toBeEnabled();
    const dbBefore = parsed(await readDbRaw(page));
    await proceedButton(page).click();
    await expect(alertOf(page)).toContainText(copy.availability.label.PURCHASE_LIMIT_EXCEEDED);
    await expect(alertOf(page)).toContainText(offeringName(OFFERING.regular));
    expect(parsed(await readDbRaw(page))).toEqual(dbBefore);
    expect(await newOrders(page)).toHaveLength(0);
  });

  test("a line that became unpurchasable after the page was rendered is rejected by the server and shown as such (22: the write re-verifies)", async ({
    page,
  }) => {
    await openCart(page, COMPOSITE);
    await expect(proceedButton(page)).toBeEnabled();
    await suspendOffering(page, OFFERING.regular);
    const tshirtBefore = await remainingOf(page, "goods", GOODS.tshirt);
    const ordersBefore = (await ordersOf(page)).length;

    await proceedButton(page).click();
    await expect(alertOf(page)).toContainText(copy.cart.purchase.rejectedTitle);
    await expect(alertOf(page)).toContainText(offeringName(OFFERING.regular));
    await expect(alertOf(page)).toContainText(copy.availability.label.SUSPENDED);
    await expect(alertOf(page)).not.toContainText(expectedGoodsDetail(GOODS.tshirt).name);
    expect(await ordersOf(page)).toHaveLength(ordersBefore);
    expect(await remainingOf(page, "goods", GOODS.tshirt)).toBe(tshirtBefore);

    // The Cart re-reads the current state: the stale "on sale" row now shows the suspension and blocks proceeding.
    const regularRow = rowByHeading(page, offeringName(OFFERING.regular));
    await expect(regularRow).toContainText(copy.availability.label.SUSPENDED);
    await expect(proceedButton(page)).toBeDisabled();
    await expect(mainOf(page)).toContainText(copy.cart.proceed.blocked);
  });

  test("unavailable: a failure to start is shown, not success, and nothing changes", async ({
    page,
  }) => {
    await openCart(page, COMPOSITE, {
      scenario: { cart: { state: "ok", purchaseStart: "unavailable" } },
    });
    await expect(proceedButton(page)).toBeEnabled();
    const dbBefore = parsed(await readDbRaw(page));
    const cartBefore = await readCartRaw(page);
    await proceedButton(page).click();
    await expect(alertOf(page)).toHaveCount(1);
    await expect(alertOf(page)).toContainText(copy.cart.purchase.unavailable);
    await expect(alertOf(page)).not.toContainText(copy.cart.purchase.rejectedBody);
    expect(urlOf(page).pathname).toBe("/cart");
    expect(await readCartRaw(page)).toBe(cartBefore);
    expect(parsed(await readDbRaw(page))).toEqual(dbBefore);
    await expect(proceedButton(page)).toBeEnabled();
  });
});
