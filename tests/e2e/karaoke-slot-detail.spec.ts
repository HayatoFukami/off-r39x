import { expect, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { formatBusinessDate } from "../../apps/web/src/presentation/format/datetime.ts";
import { describedText } from "../harness/browser/cart.ts";
import {
  actionRegion,
  alertsOf,
  backToDayLink,
  guestButton,
  HOLD_DURATION_IN_TEXT,
  heading1,
  infoRegion,
  mainOf,
  purchaseButton,
  slotRoute,
  statusesOf,
} from "../harness/browser/karaoke-purchase.ts";
import { hasLevelSkip, horizontalOverflow, mainHeadingLevels } from "../harness/browser/public.ts";
import { openAs } from "../harness/browser/purchase.ts";
import { D1, SLOT } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s7b-karaoke.md sections 4.1, 6.
// SPEC-050 13.3 (Fields, State / Action), 20.3, 31 items 5 / 28, INV-010-04.

const d = copy.karaoke.slotDetail;

test.describe("TC-PG-KRK-003-641 an AVAILABLE slot shows its facts and an enabled purchase action (SPEC-050 13.3 row 1)", () => {
  test("shows date, JST time, price, state and the limit guidance; one enabled button; no Cart operation", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000));
    await expect(heading1(page)).toHaveText(d.heading);
    await expect(heading1(page)).toHaveCount(1);
    const info = infoRegion(page);
    await expect(info).toContainText(formatBusinessDate(D1));
    await expect(info).toContainText("10:00-10:15");
    await expect(info).toContainText("¥1,000");
    await expect(info).toContainText(d.purchasableLabel);
    await expect(info).toContainText(d.purchasableDescription);
    await expect(info).toContainText(copy.karaoke.guide.purchaseLimit);
    await expect(purchaseButton(page)).toBeEnabled();
    await expect(mainOf(page).getByRole("button")).toHaveCount(1);
    await expect(actionRegion(page)).toContainText(d.separateNote);
    await expect(mainOf(page)).not.toContainText(copy.sales.add);
    await expect(mainOf(page).getByRole("link", { name: copy.sales.viewCart })).toHaveCount(0);
    await expect(statusesOf(page)).toHaveCount(0);
    await expect(alertsOf(page)).toHaveCount(0);
    await expect(backToDayLink(page)).toHaveAttribute("href", `/karaoke/schedule/${D1}`);
    expect(await mainOf(page).innerText()).not.toMatch(HOLD_DURATION_IN_TEXT);
  });
});

test.describe("TC-PG-KRK-003-642 HELD, SOLD and SALES_STOPPED are disabled with their own text and a way back (SPEC-050 13.3 table, INV-010-04)", () => {
  const cases = [
    ["HELD", SLOT.d1_1020, copy.karaoke.slot.label.HELD, d.disabledReason.HELD],
    ["SOLD", SLOT.d1_1040, copy.karaoke.slot.label.SOLD, d.disabledReason.SOLD],
    [
      "SALES_STOPPED",
      SLOT.d1_1200,
      copy.karaoke.slot.label.SALES_STOPPED,
      d.disabledReason.SALES_STOPPED,
    ],
  ] as const;
  for (const [state, slot, label, reason] of cases) {
    test(`${state}: label, reason, disabled button described by the reason, back link`, async ({
      page,
    }) => {
      await openAs(page, slotRoute(slot));
      await expect(infoRegion(page)).toContainText(label);
      await expect(actionRegion(page)).toContainText(reason);
      await expect(mainOf(page)).not.toContainText(d.purchasableLabel);
      await expect(purchaseButton(page)).toBeDisabled();
      expect(await describedText(purchaseButton(page))).toContain(reason);
      await expect(backToDayLink(page)).toBeVisible();
    });
  }
});

test.describe("TC-PG-KRK-003-643 an AVAILABLE slot outside the sales period is not purchasable (SPEC-050 13.3 last row)", () => {
  for (const status of ["BEFORE_SALES", "SALES_ENDED", "SUSPENDED"] as const) {
    test(`${status} shows the sale status, never the purchasable label`, async ({ page }) => {
      await openAs(page, slotRoute(SLOT.d1_1000), { scenario: { karaokeSales: status } });
      await expect(infoRegion(page)).toContainText(copy.availability.label[status]);
      await expect(infoRegion(page)).toContainText(copy.karaoke.saleStatus.description[status]);
      await expect(mainOf(page)).not.toContainText(d.purchasableLabel);
      await expect(purchaseButton(page)).toBeDisabled();
      expect(await describedText(purchaseButton(page))).toContain(d.disabledReason.NOT_ON_SALE);
    });
  }
});

test.describe("TC-PG-KRK-003-644 not found, malformed and failed reads are different (SPEC-050 13.3, 9, 19.1)", () => {
  test("an unknown slot shows the shared Not Found view", async ({ page }) => {
    await openAs(page, slotRoute("77777777-7777-4777-8777-777777777777"));
    await expect(heading1(page)).toHaveText(copy.notFound.title);
    await expect(mainOf(page).getByRole("button")).toHaveCount(0);
  });

  test("a malformed slot ref is HTTP 404", async ({ request }) => {
    for (const raw of ["not-a-uuid", "5A000000-0000-4000-8000-000000011000"]) {
      const response = await request.get(slotRoute(raw), { maxRedirects: 0 });
      expect(response.status(), raw).toBe(404);
    }
  });

  test("a failed read is an alert with a retry and no purchase button, not Not Found", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000), { scenario: { publicFetch: "fail" } });
    await expect(alertsOf(page)).toContainText(copy.pageState.unavailable(d.subject));
    await expect(
      mainOf(page).getByRole("button", { name: copy.pageState.retry, exact: true }),
    ).toBeVisible();
    await expect(purchaseButton(page)).toHaveCount(0);
    await expect(mainOf(page)).not.toContainText(copy.notFound.title);
  });
});

test.describe("TC-PG-KRK-003-645 a Guest can view the slot and sees the Login action; layout rules hold (SPEC-050 13.3, 24, 25)", () => {
  test("Guest: readable without redirect, action named for Login", async ({ page }) => {
    await openAs(page, slotRoute(SLOT.d1_1000), { session: null });
    await expect(page).toHaveURL(new RegExp(`${slotRoute(SLOT.d1_1000)}$`));
    await expect(guestButton(page)).toBeEnabled();
    await expect(purchaseButton(page)).toHaveCount(0);
  });

  test("heading levels do not skip, no horizontal scroll at 390px, no admin / staff / dev link", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000));
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(infoRegion(page)).toBeVisible();
    expect(hasLevelSkip(await mainHeadingLevels(page))).toBe(false);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href") ?? ""),
    );
    for (const href of hrefs) expect(href).not.toMatch(/^\/(admin|staff|dev)(\/|$)/);
  });
});
