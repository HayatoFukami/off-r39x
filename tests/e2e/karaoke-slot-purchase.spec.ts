import { expect, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { loginWith, unverifiedSession } from "../harness/browser/auth.ts";
import { entryLine, readCartRaw, readDbRaw } from "../harness/browser/cart.ts";
import {
  guestButton,
  karaokeOrders,
  mainOf,
  purchaseButton,
  slotRoute,
  slotStateInDb,
  slotStates,
} from "../harness/browser/karaoke-purchase.ts";
import {
  actionButton,
  entitlementHrefs,
  heading1,
  newOrders,
  openAs,
  orderRefFromUrl,
  outcomeRegion,
  SUCCESS_WORDING,
  setScenario,
  storedOrders,
} from "../harness/browser/purchase.ts";
import { EMAIL, OFFERING, SLOT } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s7b-karaoke.md sections 4.2, 4.3, 5.
// SPEC-050 13.3 Purchase start, 16, 31 items 3 / 7 / 8 / 9 (Karaoke side), SPEC-030 BR-ORD-019, PAY-BRW-001 .. 003.

const label = copy.order.state;

test.describe("TC-PG-KRK-003-651 a Guest goes to Login with the slot intent and returns to the same slot without any purchase (E2E 3, SPEC-050 13.3 step 1)", () => {
  test("Guest button -> Login with the slot intent; nothing created; Login returns to the slot", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000), { session: null });
    const dbBefore = await readDbRaw(page);
    await guestButton(page).click();
    await expect(page).toHaveURL(
      new RegExp(`/account/login\\?continue=karaoke-slot%3A${SLOT.d1_1000}$`),
    );
    expect(await readDbRaw(page)).toBe(dbBefore);
    await loginWith(page, EMAIL.demo);
    await expect(page).toHaveURL(new RegExp(`${slotRoute(SLOT.d1_1000)}$`));
    await expect(purchaseButton(page)).toBeEnabled();
    await expect(guestButton(page)).toHaveCount(0);
    expect(await newOrders(page)).toHaveLength(0);
    expect(await slotStateInDb(page, SLOT.d1_1000)).toBe("AVAILABLE");
  });

  test("an unverified user is sent to Email Verification with the slot intent; no Order, no Hold", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000), { session: unverifiedSession() });
    await purchaseButton(page).click();
    await expect(page).toHaveURL(
      new RegExp(`/account/email-verification\\?continue=karaoke-slot%3A${SLOT.d1_1000}$`),
    );
    expect(await newOrders(page)).toHaveLength(0);
    expect(await slotStateInDb(page, SLOT.d1_1000)).toBe("AVAILABLE");
  });
});

test.describe("TC-PG-KRK-003-652 the purchase start holds the slot, creates one separate Karaoke Order and reaches the mock Checkout (E2E 7, BR-ORD-019)", () => {
  test("held: one KARAOKE_PURCHASE Order in AWAITING_PAYMENT, slot HELD, other slots and the Cart unchanged", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000), { lines: [entryLine(OFFERING.regular, 2)] });
    const cartBefore = await readCartRaw(page);
    const slotsBefore = await slotStates(page);
    await purchaseButton(page).click();
    await page.waitForURL(/\/dev\/mock-checkout\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const ref = orderRefFromUrl(page.url());
    const created = await newOrders(page);
    expect(created).toHaveLength(1);
    expect(karaokeOrders(created)).toHaveLength(1);
    expect(created[0]?.ref).toBe(ref);
    expect(created[0]?.ownerEmail).toBe(EMAIL.demo);
    expect(created[0]?.items).toHaveLength(1);
    expect(created[0]?.items[0]).toMatchObject({
      kind: "KARAOKE",
      slotRef: SLOT.d1_1000,
      quantity: 1,
    });
    expect(created[0]?.state).toBe("AWAITING_PAYMENT");
    expect(await slotStateInDb(page, SLOT.d1_1000)).toBe("HELD");
    const slotsAfter = await slotStates(page);
    for (const [slot, state] of Object.entries(slotsBefore)) {
      if (slot !== SLOT.d1_1000) expect(slotsAfter[slot], slot).toBe(state);
    }
    expect(await readCartRaw(page)).toBe(cartBefore);
  });

  test("double click creates exactly one Order", async ({ page }) => {
    await openAs(page, slotRoute(SLOT.d1_1000));
    await purchaseButton(page).dblclick();
    await page.waitForURL(/\/dev\/mock-checkout\//, { timeout: 30_000 });
    expect(await newOrders(page)).toHaveLength(1);
  });

  test("while starting, the status says the slot is being held and the button is disabled and busy", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000), {
      scenario: { latency: "long", latencyLongMs: 1500 },
    });
    await purchaseButton(page).click();
    await expect(mainOf(page).locator('[role="status"]')).toHaveText(
      copy.karaoke.slotDetail.holding,
    );
    await expect(purchaseButton(page)).toBeDisabled();
    await expect(purchaseButton(page)).toHaveAttribute("aria-busy", "true");
  });
});

test.describe("TC-PG-KRK-003-653 Browser Return shows AWAITING_PAYMENT; the recheck confirms the Reservation right (E2E 8 / 9 Karaoke side, PAY-BRW-001 / 002)", () => {
  test("pay (mock) -> AWAITING_PAYMENT with no success wording or rights; recheck -> CONFIRMED with the Reservation link; slot SOLD", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000));
    await purchaseButton(page).click();
    await page.waitForURL(/\/dev\/mock-checkout\//, { timeout: 30_000 });
    const ref = orderRefFromUrl(page.url());
    await page.getByRole("link", { name: copy.mockCheckout.pay, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/purchase/orders/${ref}$`));
    await expect(outcomeRegion(page)).toContainText(label.AWAITING_PAYMENT, { timeout: 15_000 });
    await expect(outcomeRegion(page)).toContainText(copy.purpose.KARAOKE_PURCHASE);
    await expect(mainOf(page)).not.toContainText(label.CONFIRMED);
    await expect(mainOf(page)).not.toContainText(SUCCESS_WORDING);
    expect(await entitlementHrefs(page)).toEqual([]);
    expect(await slotStateInDb(page, SLOT.d1_1000)).toBe("HELD");

    await actionButton(page, copy.order.action.recheck_status).click();
    await expect(outcomeRegion(page)).toContainText(label.CONFIRMED, { timeout: 15_000 });
    const hrefs = await entitlementHrefs(page);
    expect(hrefs.some((h) => /^\/mypage\/karaoke\/[0-9a-f-]{36}$/.test(h))).toBe(true);
    expect(await slotStateInDb(page, SLOT.d1_1000)).toBe("SOLD");
    expect(karaokeOrders(await newOrders(page))).toHaveLength(1);
  });
});

test.describe("TC-PG-KRK-003-654 a failed Checkout start leaves a PREPARED Karaoke Order that is retried in place (E2E 7, SPEC-050 13.3 step 6, 16.6)", () => {
  test("start_failed -> Purchase Status shows PREPARED and the retry; the retry reuses the same Order and the Hold", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000), { scenario: { checkout: "start_failed" } });
    await purchaseButton(page).click();
    await expect(page).toHaveURL(/\/purchase\/orders\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const ref = orderRefFromUrl(page.url());
    await expect(heading1(page)).toHaveText(copy.purchase.heading);
    await expect(outcomeRegion(page)).toContainText(label.PREPARED, { timeout: 15_000 });
    await expect(actionButton(page, copy.order.action.retry_checkout)).toBeVisible();
    expect(await slotStateInDb(page, SLOT.d1_1000)).toBe("HELD");
    expect((await storedOrders(page)).filter((o) => o.ref === ref)).toHaveLength(1);

    await setScenario(page, { checkout: "ok" });
    await actionButton(page, copy.order.action.retry_checkout).click();
    await page.waitForURL(/\/dev\/mock-checkout\//, { timeout: 30_000 });
    expect(orderRefFromUrl(page.url())).toBe(ref);
    expect(karaokeOrders(await newOrders(page))).toHaveLength(1);
  });
});
