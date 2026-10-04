import { expect, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  accountMenuButton,
  loginWith,
  logoutViaMenu,
  unverifiedSession,
} from "../harness/browser/auth.ts";
import { readDbRaw } from "../harness/browser/cart.ts";
import { gotoHydrated } from "../harness/browser/hydration.ts";
import { fixClock } from "../harness/browser/public.ts";
import {
  heading1,
  mainOf,
  ORDER_STATE_LIST,
  openAs,
  outcomeRegion,
  seedOrder,
  seenTexts,
  watchTexts,
} from "../harness/browser/purchase.ts";
import { seedLocalStorage, sessionJson } from "../harness/browser/shell.ts";
import { EMAIL, ORDER } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s7a-purchase.md sections 6, 6.3, 7.
// SPEC-050 16.8, 19.2, 26.2, 31 item 20 (PG-XFN-001 part), SPEC-110 22, SPEC-060 AR-SES-007 / AR-AZ-011.

const MISSING = "0d000000-0000-4000-8000-0000000009ff";
const parsed = (raw: string | null): unknown => (raw === null ? null : JSON.parse(raw));
const allStateLabels = ORDER_STATE_LIST.map((s) => copy.order.state[s]);

test.describe("TC-PG-XFN-001-681 another user's Order, a missing Order and a malformed ref are indistinguishable and reveal nothing (E2E 20, SPEC-050 16.8 / 19.2 / 26.2)", () => {
  const targets: { name: string; ref: string }[] = [
    { name: "another user's Entry Order", ref: ORDER.otherEntry },
    { name: "another user's Goods Order", ref: ORDER.otherGoods },
    { name: "another user's Karaoke Order", ref: ORDER.otherKaraoke },
    { name: "a well-formed ref that does not exist", ref: MISSING },
    { name: "a malformed ref", ref: "not-a-uuid" },
    { name: "an upper-case ref", ref: ORDER.otherEntry.toUpperCase() },
  ];

  test("every one shows the same Access Denied view with the way back, and no Order content at any moment", async ({
    page,
  }) => {
    const otherKaraokeItem = seedOrder(ORDER.otherKaraoke).items[0]?.name ?? "";
    expect(otherKaraokeItem).not.toBe("");
    await watchTexts(page, [
      otherKaraokeItem,
      copy.purpose.KARAOKE_PURCHASE,
      copy.purpose.GOODS_PURCHASE,
      copy.purpose.ENTRY_TICKET_PURCHASE,
      ...allStateLabels,
    ]);
    await openAs(page, `/purchase/orders/${targets[0]?.ref}`);
    const dbBefore = parsed(await readDbRaw(page));

    const texts: string[] = [];
    for (const target of targets) {
      await gotoHydrated(page, `/purchase/orders/${target.ref}`);
      await expect(heading1(page), target.name).toHaveText(copy.accessDenied.title);
      await expect(mainOf(page)).toContainText(copy.accessDenied.description);
      await expect(
        mainOf(page).getByRole("link", { name: copy.accessDenied.mypageLink, exact: true }),
      ).toHaveAttribute("href", "/mypage");
      await expect(
        mainOf(page).getByRole("link", { name: copy.accessDenied.ordersLink, exact: true }),
      ).toHaveAttribute("href", "/mypage/orders");
      // A retry cannot grant access; nothing about the Order, the purchaser or its existence is shown.
      await expect(mainOf(page).getByRole("button")).toHaveCount(0);
      await expect(mainOf(page).locator('[role="alert"]')).toHaveCount(0);
      const text = await mainOf(page).innerText();
      expect(text).not.toMatch(/他の|存在|所有/);
      for (const needle of [otherKaraokeItem, ...allStateLabels]) {
        expect(text, `${target.name}: ${needle}`).not.toContain(needle);
      }
      texts.push(text);
      // The check precedes any rendering of Order data: nothing watched was ever in the document.
      expect(Object.values(await seenTexts(page)).some(Boolean), target.name).toBe(false);
    }
    expect(new Set(texts).size, "the six answers are the same text").toBe(1);
    // No status read happened for any of them (no simulated webhook advanced).
    expect(parsed(await readDbRaw(page))).toEqual(dbBefore);
  });

  test("ownership follows the signed-in user: another verified user sees denied for demo's Order but their own Order normally", async ({
    page,
  }) => {
    await fixClock(page);
    await seedLocalStorage(page, {
      "r39x.mock.session.v1": sessionJson({
        kind: "authenticated",
        email: EMAIL.other,
        emailVerified: true,
      }),
    });
    await gotoHydrated(page, `/purchase/orders/${ORDER.confirmedEntry}`);
    await expect(heading1(page)).toHaveText(copy.accessDenied.title);
    await expect(mainOf(page)).not.toContainText(copy.order.state.CONFIRMED);

    await gotoHydrated(page, `/purchase/orders/${ORDER.otherEntry}`);
    await expect(heading1(page)).toHaveText(copy.purchase.heading);
    await expect(outcomeRegion(page)).toContainText(copy.order.state.CONFIRMED);

    // A user with no purchases at all gets the same denied view for every Order.
    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [
        "r39x.mock.session.v1",
        sessionJson({ kind: "authenticated", email: EMAIL.fresh, emailVerified: true }),
      ],
    );
    await gotoHydrated(page, `/purchase/orders/${ORDER.otherEntry}`);
    await expect(heading1(page)).toHaveText(copy.accessDenied.title);
  });
});

test.describe("TC-PG-XFN-001-682 Purchase Status is behind the AuthGate and returns to the same Order after authentication (AR-SES-007, SPEC-050 10, 31 item 3)", () => {
  test("a guest is sent to Login with the purchase-order intent, never sees the Order, and returns to it after Login", async ({
    page,
  }) => {
    await watchTexts(page, [copy.order.state.PREPARED, copy.purchase.heading]);
    await openAs(page, `/purchase/orders/${ORDER.prepared}`, { session: null });
    await expect(page).toHaveURL(
      new RegExp(`/account/login\\?continue=purchase-order%3A${ORDER.prepared}$`),
    );
    expect(Object.values(await seenTexts(page)).some(Boolean)).toBe(false);
    await expect(mainOf(page)).toContainText(copy.auth.continuation.purpose.purchaseOrder);

    await loginWith(page, EMAIL.demo);
    await expect(page).toHaveURL(new RegExp(`/purchase/orders/${ORDER.prepared}$`));
    await expect(outcomeRegion(page)).toContainText(copy.order.state.PREPARED);
  });

  test("an unverified user is sent to Email Verification with the same intent", async ({
    page,
  }) => {
    await openAs(page, `/purchase/orders/${ORDER.prepared}`, { session: unverifiedSession() });
    await expect(page).toHaveURL(
      new RegExp(`/account/email-verification\\?continue=purchase-order%3A${ORDER.prepared}$`),
    );
    await expect(mainOf(page)).not.toContainText(copy.order.state.PREPARED);
  });

  test("Logout from the status page ends on Home; Back never shows the Order and ends at Login", async ({
    page,
  }) => {
    await openAs(page, `/purchase/orders/${ORDER.confirmedEntry}`);
    await expect(outcomeRegion(page)).toContainText(copy.order.state.CONFIRMED);
    await logoutViaMenu(page);
    await expect(page).toHaveURL(/\/$/);
    await expect(accountMenuButton(page)).toHaveCount(0);
    await page.evaluate((needle: string) => {
      const w = window as unknown as { __saw?: boolean };
      w.__saw = false;
      new MutationObserver(() => {
        if (document.body.innerText.includes(needle)) w.__saw = true;
      }).observe(document, { childList: true, subtree: true, characterData: true });
    }, copy.order.state.CONFIRMED);
    await page.goBack();
    await expect(page).toHaveURL(
      new RegExp(`/account/login\\?continue=purchase-order%3A${ORDER.confirmedEntry}$`),
    );
    expect(
      await page.evaluate(() => (window as unknown as { __saw?: boolean }).__saw === true),
    ).toBe(false);
    await expect(mainOf(page)).not.toContainText(copy.order.state.CONFIRMED);
  });
});
