import { expect, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { focused } from "../harness/browser/auth.ts";
import { describedText } from "../harness/browser/cart.ts";
import {
  alertsOf,
  backToDayLink,
  chooseAgainLink,
  infoRegion,
  karaokeOrders,
  mainOf,
  purchaseButton,
  setSlotStateInDb,
  slotRoute,
  slotStateInDb,
  statusesOf,
} from "../harness/browser/karaoke-purchase.ts";
import {
  actionButton,
  heading1,
  newOrders,
  openAs,
  outcomeRegion,
  setScenario,
  storedOrders,
} from "../harness/browser/purchase.ts";
import { D1, SLOT } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s7b-karaoke.md sections 4.3, 4.4.
// SPEC-050 13.3 Purchase start 3-7, 20.3, 21 (Slot conflict / Hold expired / Purchase Limit), 31 item 13, INV-010-04.
// Hold expiry is only produced by the scenario (no TTL in the UI or the mock).

const f = copy.karaoke.slotDetail.failure;
const d = copy.karaoke.slotDetail;

test.describe("TC-PG-KRK-003-661 an expired Hold sends the user back to choosing a slot (E2E 13, SPEC-050 13.3 step 7)", () => {
  test("expire_before_checkout: the expired message and the choose-again link stay on the slot page; Order EXPIRED, slot released", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000), {
      scenario: { karaokeHold: "expire_before_checkout" },
    });
    await purchaseButton(page).click();
    await expect(alertsOf(page)).toHaveText(new RegExp(f.expired), { timeout: 30_000 });
    await expect(alertsOf(page)).toHaveCount(1);
    await expect(page).toHaveURL(new RegExp(`${slotRoute(SLOT.d1_1000)}$`));
    expect((await focused(page)).role).toBe("alert");
    await expect(chooseAgainLink(page)).toHaveAttribute("href", `/karaoke/schedule/${D1}`);
    await expect(purchaseButton(page)).toBeDisabled();
    await expect(mainOf(page)).not.toContainText(f.conflict);
    await expect(statusesOf(page)).toHaveCount(0);

    const created = await newOrders(page);
    expect(karaokeOrders(created)).toHaveLength(1);
    expect(created[0]?.state).toBe("EXPIRED");
    expect(await slotStateInDb(page, SLOT.d1_1000)).toBe("AVAILABLE");

    await chooseAgainLink(page).click();
    await expect(page).toHaveURL(new RegExp(`/karaoke/schedule/${D1}$`));
  });

  test("the expired Order is shown as EXPIRED and Purchase again goes to /karaoke without touching the Cart", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000), {
      scenario: { karaokeHold: "expire_before_checkout" },
    });
    await purchaseButton(page).click();
    await expect(alertsOf(page)).toHaveText(new RegExp(f.expired), { timeout: 30_000 });
    const order = (await newOrders(page))[0];
    await page.goto(`/purchase/orders/${order?.ref}`);
    await expect(outcomeRegion(page)).toContainText(copy.order.state.EXPIRED, { timeout: 15_000 });
    await actionButton(page, copy.order.action.purchase_again).click();
    await expect(page).toHaveURL(/\/karaoke$/);
  });
});

test.describe("TC-PG-KRK-003-662 a conflict shows the conflict message, creates nothing and refreshes the slot (SPEC-050 13.3 step 4, 21 Slot conflict, INV-010-04)", () => {
  test("another buyer took the slot after the page rendered: conflict alert with the way back, the slot now shown as HELD", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000));
    await expect(purchaseButton(page)).toBeEnabled();
    await setSlotStateInDb(page, SLOT.d1_1000, "HELD");
    const ordersBefore = (await storedOrders(page)).length;
    await purchaseButton(page).click();
    await expect(alertsOf(page)).toHaveText(new RegExp(f.conflict), { timeout: 30_000 });
    expect((await focused(page)).role).toBe("alert");
    await expect(chooseAgainLink(page)).toHaveAttribute("href", `/karaoke/schedule/${D1}`);
    await expect(infoRegion(page)).toContainText(copy.karaoke.slot.label.HELD);
    await expect(mainOf(page)).not.toContainText(d.purchasableLabel);
    await expect(purchaseButton(page)).toBeDisabled();
    expect(await describedText(purchaseButton(page))).toContain(d.disabledReason.HELD);
    expect((await storedOrders(page)).length).toBe(ordersBefore);
    expect(await slotStateInDb(page, SLOT.d1_1000)).toBe("HELD");
    await expect(mainOf(page)).not.toContainText(f.expired);
  });

  test("conflict scenario on an AVAILABLE slot: the conflict alert, nothing changed, the action is available again", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000), { scenario: { karaokeHold: "conflict" } });
    const ordersBefore = (await storedOrders(page)).length;
    await purchaseButton(page).click();
    await expect(alertsOf(page)).toHaveText(new RegExp(f.conflict), { timeout: 30_000 });
    expect((await storedOrders(page)).length).toBe(ordersBefore);
    expect(await slotStateInDb(page, SLOT.d1_1000)).toBe("AVAILABLE");
    await expect(purchaseButton(page)).toBeEnabled();
    await expect(backToDayLink(page)).toBeVisible();
  });
});

test.describe("TC-PG-KRK-003-663 Purchase Limit and the sale status are separate failures (SPEC-050 13.3 table, 21)", () => {
  test("limit: the limit message, button disabled with the message as its reason, nothing created", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000), { scenario: { karaokeHold: "limit" } });
    const ordersBefore = (await storedOrders(page)).length;
    await purchaseButton(page).click();
    await expect(alertsOf(page)).toHaveText(new RegExp(f.limit), { timeout: 30_000 });
    await expect(alertsOf(page)).toHaveCount(1);
    await expect(purchaseButton(page)).toBeDisabled();
    expect(await describedText(purchaseButton(page))).toContain(f.limit);
    await expect(mainOf(page)).not.toContainText(f.conflict);
    await expect(mainOf(page)).not.toContainText(f.notOnSale);
    expect((await storedOrders(page)).length).toBe(ordersBefore);
    expect(await slotStateInDb(page, SLOT.d1_1000)).toBe("AVAILABLE");
  });

  test("the sale was suspended after the page rendered: the not-on-sale message and the refreshed status", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000));
    await expect(purchaseButton(page)).toBeEnabled();
    await setScenario(page, { karaokeSales: "SUSPENDED" });
    await purchaseButton(page).click();
    await expect(alertsOf(page)).toHaveText(new RegExp(f.notOnSale), { timeout: 30_000 });
    await expect(infoRegion(page)).toContainText(copy.availability.label.SUSPENDED);
    await expect(mainOf(page)).not.toContainText(d.purchasableLabel);
    await expect(purchaseButton(page)).toBeDisabled();
    expect(karaokeOrders(await newOrders(page))).toHaveLength(0);
    expect(await slotStateInDb(page, SLOT.d1_1000)).toBe("AVAILABLE");
  });
});

test.describe("TC-PG-KRK-003-664 a sold-out slot never starts a purchase and offers the way back (E2E 5, SPEC-050 13.3, 20.3)", () => {
  test("SOLD: disabled, no request creates an Order, back link goes to the day", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1040));
    await expect(purchaseButton(page)).toBeDisabled();
    await expect(heading1(page)).toHaveText(d.heading);
    await expect(backToDayLink(page)).toHaveAttribute("href", `/karaoke/schedule/${D1}`);
    expect(await newOrders(page)).toHaveLength(0);
  });
});
