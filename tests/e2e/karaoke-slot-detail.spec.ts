import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { formatBusinessDate } from "../../apps/web/src/presentation/format/datetime.ts";
import { authScenario, unverifiedSession } from "../harness/browser/auth.ts";
import {
  describedText,
  FORBIDDEN_ELIGIBILITY_IN_STORAGE,
  openSecondTab,
  readDbRaw,
  recordedTexts,
  recordTextsIn,
  storedText,
  writeStorage,
} from "../harness/browser/cart.ts";
import { gotoHydrated } from "../harness/browser/hydration.ts";
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
  slotStateInDb,
  statusesOf,
} from "../harness/browser/karaoke-purchase.ts";
import { hasLevelSkip, horizontalOverflow, mainHeadingLevels } from "../harness/browser/public.ts";
import { newOrders, openAs } from "../harness/browser/purchase.ts";
import { authenticatedSession, KEYS, scenarioJson, sessionJson } from "../harness/browser/shell.ts";
import { D1, EMAIL, SLOT } from "../harness/mock-seed.ts";

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

  test("a malformed slot ref shows the shared Not Found view with no purchase button (the static shell answers HTTP 200)", async ({
    page,
  }) => {
    for (const raw of ["not-a-uuid", "5A000000-0000-4000-8000-000000011000"]) {
      const response = await gotoHydrated(page, slotRoute(raw));
      expect(response?.status(), raw).toBe(200);
      expect(response?.headers()["content-type"] ?? "", raw).toMatch(/^text\/html/);
      await expect(heading1(page), raw).toHaveText(copy.notFound.title);
      await expect(purchaseButton(page), raw).toHaveCount(0);
      await expect(guestButton(page), raw).toHaveCount(0);
      await expect(mainOf(page).getByRole("button"), raw).toHaveCount(0);
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

// ---- B4c: the owner-scoped eligibility (API-PUR-ELG-001) before the purchase start -------------------------
// Karaoke has no Purchase Limit number in the mock; the scenario karaokeHold "limit" stands for "the owner reached it"
// (tests/contracts/s2-mock-backend.md 11.5 / 16 item 9). Guest and unverified users are not asked (KRK-AVL-003).

const limitScenario = { karaokeHold: "limit" } as const;
const failScenario = { cart: { state: "eligibility_fail", purchaseStart: "ok" } } as const;
const eligibilityAlert = (page: Page) => alertsOf(page);
const retryIn = (page: Page) =>
  alertsOf(page).getByRole("button", { name: copy.pageState.retry, exact: true });
const availability = copy.availability;

test.describe("TC-PG-KRK-003-646 a verified user sees the Purchase Limit before the purchase start and cannot start; a failed eligibility is 'cannot confirm' with retry; Guest and unverified users are not asked (API-PUR-ELG-001, FR-KRK-007, KRK-AVL-003, SEC-API-029, SPEC-050 12.1 / 13.3 / 21)", () => {
  test("a verified user at the limit: the limit label and description, the button disabled with the limit reason, no alert, no Order, the slot still AVAILABLE", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000), { scenario: limitScenario });
    const info = infoRegion(page);
    await expect(info).toContainText(availability.label.PURCHASE_LIMIT_EXCEEDED);
    await expect(info).toContainText(availability.description.PURCHASE_LIMIT_EXCEEDED);
    await expect(info).not.toContainText(d.purchasableLabel);
    await expect(info).not.toContainText(availability.label.UNAVAILABLE);
    await expect(purchaseButton(page)).toBeDisabled();
    const described = await describedText(purchaseButton(page));
    expect(described).toContain(copy.karaoke.slotDetail.disabledReason.PURCHASE_LIMIT_EXCEEDED);
    expect(described).not.toContain(d.failure.limit);
    await expect(alertsOf(page)).toHaveCount(0);
    await expect(statusesOf(page)).toHaveCount(0);
    // The facts of the slot stay and the generic guidance stays.
    await expect(info).toContainText(formatBusinessDate(D1));
    await expect(info).toContainText("10:00-10:15");
    await expect(info).toContainText("¥1,000");
    await expect(info).toContainText(copy.karaoke.guide.purchaseLimit);
    await expect(backToDayLink(page)).toBeVisible();
    // Nothing was created or changed by the pre-check, and nothing of the answer is stored.
    const dbBefore = await readDbRaw(page);
    expect(await newOrders(page)).toHaveLength(0);
    expect(await slotStateInDb(page, SLOT.d1_1000)).toBe("AVAILABLE");
    expect(await readDbRaw(page)).toBe(dbBefore);
    expect(await storedText(page, [KEYS.scenario])).not.toMatch(FORBIDDEN_ELIGIBILITY_IN_STORAGE);
  });

  test("a Guest at the same scenario is not asked: the public state, the Login action enabled, no alert", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000), { session: null, scenario: limitScenario });
    await expect(infoRegion(page)).toContainText(d.purchasableLabel);
    await expect(infoRegion(page)).not.toContainText(availability.label.PURCHASE_LIMIT_EXCEEDED);
    await expect(guestButton(page)).toBeEnabled();
    await expect(alertsOf(page)).toHaveCount(0);
    expect(await storedText(page, [KEYS.scenario])).not.toMatch(FORBIDDEN_ELIGIBILITY_IN_STORAGE);
  });

  test("an unverified user at the same scenario is not asked: the public state, the action enabled, no alert (the server sends them to the Email verification)", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000), {
      session: unverifiedSession(),
      scenario: limitScenario,
    });
    await expect(infoRegion(page)).toContainText(d.purchasableLabel);
    await expect(infoRegion(page)).not.toContainText(availability.label.PURCHASE_LIMIT_EXCEEDED);
    await expect(purchaseButton(page)).toBeEnabled();
    await expect(alertsOf(page)).toHaveCount(0);
    expect(await storedText(page, [KEYS.scenario])).not.toMatch(FORBIDDEN_ELIGIBILITY_IN_STORAGE);
  });

  test("a verified user whose eligibility cannot be read: 'cannot confirm', the button disabled with the unconfirmed reason, one alert with retry; retry recovers", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000), { scenario: failScenario });
    await expect(eligibilityAlert(page)).toHaveCount(1);
    await expect(eligibilityAlert(page)).toContainText(
      copy.pageState.unavailable(copy.entry.eligibilitySubject),
    );
    await expect(retryIn(page)).toBeVisible();
    const info = infoRegion(page);
    await expect(info).toContainText(availability.label.UNAVAILABLE);
    await expect(info).toContainText(availability.description.UNAVAILABLE);
    await expect(info).not.toContainText(d.purchasableLabel);
    await expect(purchaseButton(page)).toBeDisabled();
    expect(await describedText(purchaseButton(page))).toContain(
      copy.karaoke.slotDetail.disabledReason.UNCONFIRMED,
    );
    await expect(info).toContainText("10:00-10:15");
    await expect(info).toContainText("¥1,000");
    expect(await newOrders(page)).toHaveLength(0);
    expect(await slotStateInDb(page, SLOT.d1_1000)).toBe("AVAILABLE");
    expect(await storedText(page, [KEYS.scenario])).not.toMatch(FORBIDDEN_ELIGIBILITY_IN_STORAGE);

    await writeStorage(page, KEYS.scenario, scenarioJson());
    await retryIn(page).click();
    await expect(alertsOf(page)).toHaveCount(0);
    await expect(infoRegion(page)).toContainText(d.purchasableLabel);
    await expect(purchaseButton(page)).toBeEnabled();
    expect(await newOrders(page)).toHaveLength(0);
  });

  test("a session that cannot be determined (auth.session unavailable) fails closed (K-Q4): the button disabled with the unconfirmed reason, one alert with retry, nothing created", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000), {
      extra: authScenario({ session: "unavailable" }),
    });
    await expect(eligibilityAlert(page)).toHaveCount(1);
    await expect(eligibilityAlert(page)).toContainText(
      copy.pageState.unavailable(copy.entry.eligibilitySubject),
    );
    await expect(retryIn(page)).toBeVisible();
    const info = infoRegion(page);
    await expect(info).toContainText(availability.label.UNAVAILABLE);
    await expect(info).not.toContainText(d.purchasableLabel);
    await expect(purchaseButton(page)).toBeDisabled();
    expect(await describedText(purchaseButton(page))).toContain(d.disabledReason.UNCONFIRMED);
    // The facts of the public read stay shown.
    await expect(info).toContainText("10:00-10:15");
    await expect(info).toContainText("¥1,000");

    // Even a forced press starts nothing: no Order, no Hold, the mock database and the slot are untouched.
    const dbBefore = await readDbRaw(page);
    await purchaseButton(page).click({ force: true });
    await expect(eligibilityAlert(page)).toHaveCount(1);
    expect(await newOrders(page)).toHaveLength(0);
    expect(await slotStateInDb(page, SLOT.d1_1000)).toBe("AVAILABLE");
    expect(await readDbRaw(page)).toBe(dbBefore);
    expect(await storedText(page, [KEYS.scenario])).not.toMatch(FORBIDDEN_ELIGIBILITY_IN_STORAGE);
  });

  test("a Guest and an unverified user do not see the failure of the eligibility (it is not read)", async ({
    page,
    context,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1000), { session: null, scenario: failScenario });
    await expect(infoRegion(page)).toContainText(d.purchasableLabel);
    await expect(guestButton(page)).toBeEnabled();
    await expect(alertsOf(page)).toHaveCount(0);

    const other = await context.newPage();
    await openAs(other, slotRoute(SLOT.d1_1000), {
      session: unverifiedSession(),
      scenario: failScenario,
    });
    await expect(infoRegion(other)).toContainText(d.purchasableLabel);
    await expect(purchaseButton(other)).toBeEnabled();
    await expect(alertsOf(other)).toHaveCount(0);
    await other.close();
  });

  test("a slot that is not purchasable publicly keeps its public state for a verified user, with or without a failing eligibility (it cannot improve)", async ({
    page,
  }) => {
    await openAs(page, slotRoute(SLOT.d1_1020), { scenario: failScenario });
    await expect(infoRegion(page)).toContainText(copy.karaoke.slot.label.HELD);
    await expect(infoRegion(page)).not.toContainText(availability.label.UNAVAILABLE);
    await expect(alertsOf(page)).toHaveCount(0);
    await expect(purchaseButton(page)).toBeDisabled();
    expect(await describedText(purchaseButton(page))).toContain(d.disabledReason.HELD);
  });
});

test.describe("TC-PG-KRK-003-647 after a session change the public slot stays and nothing of the previous viewer is shown: 'cannot confirm' until the new owner's answer arrives (B4b-F-1 rule E, SEC-API-029, DEV-WEB-007, SPEC-050 12.1 / 13.3 / 26.2)", () => {
  // Same method as TC-PG-GDS-002-508: a long latency switched on after the first display, and a recorder that notices a
  // state shown only for a moment. The latency scenario keeps the other switches of the test (karaokeHold).
  const NEEDLES = () => [
    d.purchasableLabel,
    availability.label.UNAVAILABLE,
    availability.label.PURCHASE_LIMIT_EXCEEDED,
  ];
  const MID = { timeout: 2_000 };
  const DONE = { timeout: 20_000 };
  const slow = (page: Page, patch: Record<string, unknown> = {}) =>
    writeStorage(
      page,
      KEYS.scenario,
      scenarioJson({ ...patch, latency: "long", latencyLongMs: 5000 }),
    );
  const verifiedNew = () =>
    sessionJson({ kind: "authenticated", email: EMAIL.fresh, emailVerified: true });

  test("after a Guest becomes a verified user: 'cannot confirm' with the button disabled until the owner's answer arrives; the date, time and price stay; no alert", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await openAs(page, slotRoute(SLOT.d1_1000), { session: null });
    await expect(infoRegion(page)).toContainText(d.purchasableLabel);
    await expect(guestButton(page)).toBeEnabled();
    const other = await openSecondTab(context);
    await other.goto("/");
    await slow(page);
    await recordTextsIn(infoRegion(page), "info", NEEDLES());
    await writeStorage(other, KEYS.session, authenticatedSession());

    await expect(infoRegion(page)).toContainText(availability.label.UNAVAILABLE, MID);
    await expect(infoRegion(page)).not.toContainText(d.purchasableLabel, MID);
    await expect(purchaseButton(page)).toBeDisabled(MID);
    await expect(alertsOf(page)).toHaveCount(0, MID);
    await expect(infoRegion(page)).toContainText(formatBusinessDate(D1), MID);
    await expect(infoRegion(page)).toContainText("10:00-10:15", MID);
    await expect(infoRegion(page)).toContainText("¥1,000", MID);

    await expect(infoRegion(page)).toContainText(d.purchasableLabel, DONE);
    await expect(purchaseButton(page)).toBeEnabled(DONE);

    const recorded = await recordedTexts(page, "info");
    expect(recorded[0]).toBeDefined();
    expect(recorded[0]).toContain(availability.label.UNAVAILABLE);
    expect(recorded[0]).not.toContain(d.purchasableLabel);
    expect(await newOrders(page)).toHaveLength(0);
    await other.close();
  });

  test("after a verified user at the limit becomes a Guest the previous user's limit disappears at once and the public state returns", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await openAs(page, slotRoute(SLOT.d1_1000), { scenario: limitScenario });
    await expect(infoRegion(page)).toContainText(availability.label.PURCHASE_LIMIT_EXCEEDED);
    await expect(purchaseButton(page)).toBeDisabled();
    const other = await openSecondTab(context);
    await other.goto("/");
    await slow(page, limitScenario);
    await recordTextsIn(infoRegion(page), "info", NEEDLES());
    await writeStorage(other, KEYS.session, sessionJson());

    await expect(infoRegion(page)).toContainText(d.purchasableLabel, MID);
    await expect(infoRegion(page)).not.toContainText(
      availability.label.PURCHASE_LIMIT_EXCEEDED,
      MID,
    );
    await expect(guestButton(page)).toBeEnabled(MID);
    await expect(alertsOf(page)).toHaveCount(0, MID);

    await expect(infoRegion(page)).toContainText(d.purchasableLabel, DONE);
    const recorded = await recordedTexts(page, "info");
    expect(
      recorded.filter((seen) => seen.includes(availability.label.PURCHASE_LIMIT_EXCEEDED)),
    ).toEqual([]);
    expect(await newOrders(page)).toHaveLength(0);
    await other.close();
  });

  test("a switch from one verified user to another shows 'cannot confirm' until the new owner's answer arrives; the previous owner's limit never appears for them, and it comes back only as their own answer", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await openAs(page, slotRoute(SLOT.d1_1000), { scenario: limitScenario });
    await expect(infoRegion(page)).toContainText(availability.label.PURCHASE_LIMIT_EXCEEDED);
    const other = await openSecondTab(context);
    await other.goto("/");
    await slow(page, limitScenario);
    await recordTextsIn(infoRegion(page), "info", NEEDLES());
    await writeStorage(other, KEYS.session, verifiedNew());

    await expect(infoRegion(page)).toContainText(availability.label.UNAVAILABLE, MID);
    await expect(infoRegion(page)).not.toContainText(
      availability.label.PURCHASE_LIMIT_EXCEEDED,
      MID,
    );
    await expect(infoRegion(page)).not.toContainText(d.purchasableLabel, MID);
    await expect(purchaseButton(page)).toBeDisabled(MID);
    await expect(alertsOf(page)).toHaveCount(0, MID);

    // The scenario applies to every user, so the new owner's own answer is the limit as well.
    await expect(infoRegion(page)).toContainText(availability.label.PURCHASE_LIMIT_EXCEEDED, DONE);
    await expect(purchaseButton(page)).toBeDisabled();

    const recorded = await recordedTexts(page, "info");
    expect(recorded[0]).toBeDefined();
    expect(recorded[0]).toContain(availability.label.UNAVAILABLE);
    expect(recorded[0]).not.toContain(availability.label.PURCHASE_LIMIT_EXCEEDED);
    expect(recorded[0]).not.toContain(d.purchasableLabel);
    expect(await newOrders(page)).toHaveLength(0);
    await other.close();
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
