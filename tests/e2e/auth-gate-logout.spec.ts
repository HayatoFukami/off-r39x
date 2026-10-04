import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  accountMenuButton,
  alertsIn,
  authScenario,
  headerLogin,
  headerMypage,
  heading1,
  loginWith,
  logoutViaMenu,
  MARKER_PROTECTED_TEXT,
  mainOf,
  readSession,
  readSessionRaw,
  sawProtectedText,
  statusesIn,
  unverifiedSession,
  urlOf,
  watchForProtectedText,
} from "../harness/browser/auth.ts";
import {
  cartEntries,
  entryLine,
  goodsLine,
  headerCartLink,
  openSecondTab,
  readCartRaw,
  writeStorage,
} from "../harness/browser/cart.ts";
import { gotoHydrated, reloadHydrated } from "../harness/browser/hydration.ts";
import { fixClock } from "../harness/browser/public.ts";
import {
  authenticatedSession,
  KEYS,
  seedLocalStorage,
  sessionJson,
} from "../harness/browser/shell.ts";
import { EMAIL, GOODS, OFFERING } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s6-auth.md sections 3, 6.6, 6.7.
// SPEC-050 8.2 / 8.3 / 15.6 / 17.1 / 31 item 24 (second half), SPEC-060 AR-SES-007 / AR-SES-009 / AR-AZ-011,
// SPEC-020 FR-CRT-012.

const CART = [entryLine(OFFERING.regular, 2), goodsLine(GOODS.tshirt, 1)];

async function open(page: Page, path: string, entries: Record<string, string> = {}) {
  await fixClock(page);
  await seedLocalStorage(page, entries);
  await gotoHydrated(page, path);
}

const guestStays = (page: Page) => readSession(page).then((s) => s.kind === "guest");

test.describe("TC-AR-SES-007-301 AuthGate keeps protected content from a guest (AR-SES-007, SPEC-050 17.1)", () => {
  test("a guest opening /mypage is sent to Login with continue=mypage and never sees the protected content", async ({
    page,
  }) => {
    await fixClock(page);
    await watchForProtectedText(page, MARKER_PROTECTED_TEXT);
    await seedLocalStorage(page, {});
    await gotoHydrated(page, "/mypage");
    await expect(page).toHaveURL(/\/account\/login\?continue=mypage$/);
    await expect(heading1(page)).toHaveText(copy.auth.login.heading);
    expect(await sawProtectedText(page)).toBe(false);
    expect(await guestStays(page)).toBe(true);
  });

  test("an authenticated user with a verified email sees the protected content", async ({
    page,
  }) => {
    await open(page, "/mypage", { [KEYS.session]: authenticatedSession() });
    await expect(page).toHaveURL(/\/mypage$/);
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    await expect(mainOf(page)).toContainText(copy.mypage.protectedMarker);
    await expect(headerMypage(page)).toBeVisible();
    await expect(accountMenuButton(page)).toBeVisible();
    await expect(headerLogin(page)).toHaveCount(0);
  });

  test("an authenticated user whose email is unverified is sent to Email Verification, not shown the content", async ({
    page,
  }) => {
    await fixClock(page);
    await watchForProtectedText(page, MARKER_PROTECTED_TEXT);
    await seedLocalStorage(page, { [KEYS.session]: unverifiedSession() });
    await gotoHydrated(page, "/mypage");
    await expect(page).toHaveURL(/\/account\/email-verification\?continue=mypage$/);
    await expect(heading1(page)).toHaveText(copy.auth.verify.heading);
    expect(await sawProtectedText(page)).toBe(false);
  });

  test("an unavailable session shows a retryable error and neither the content nor a Login redirect", async ({
    page,
  }) => {
    await fixClock(page);
    await watchForProtectedText(page, MARKER_PROTECTED_TEXT);
    await seedLocalStorage(page, {
      ...authScenario({ session: "unavailable" }),
      [KEYS.session]: authenticatedSession(),
    });
    await gotoHydrated(page, "/mypage");
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toContainText(copy.pageState.unavailable(copy.auth.gate.subject));
    await expect(
      mainOf(page).getByRole("button", { name: copy.pageState.retry, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await sawProtectedText(page)).toBe(false);
    await expect(mainOf(page)).not.toContainText(copy.mypage.protectedMarker);
  });

  test("the gate does not wrongly lock a verified user out after a reload", async ({ page }) => {
    await open(page, "/mypage", { [KEYS.session]: authenticatedSession() });
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    await reloadHydrated(page);
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    expect(urlOf(page).pathname).toBe("/mypage");
  });
});

test.describe("TC-PG-AUTH-003-311 Logout goes Home, keeps the Cart, and back never shows protected content (SPEC-050 15.6, AR-SES-009, FR-CRT-012)", () => {
  test("Logout from Mypage ends on Home (/), as a guest, and stays there", async ({ page }) => {
    await open(page, "/mypage", { [KEYS.session]: authenticatedSession() });
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    await logoutViaMenu(page);
    await expect(page).toHaveURL(/\/$/);
    expect(urlOf(page).pathname).toBe("/");
    await expect(headerLogin(page)).toBeVisible();
    await expect(headerMypage(page)).toHaveCount(0);
    await expect(accountMenuButton(page)).toHaveCount(0);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    // The gate must not turn the Logout into a later redirect to Login.
    await page.waitForLoadState("networkidle");
    expect(urlOf(page).pathname).toBe("/");
    await expect(mainOf(page).getByRole("textbox")).toHaveCount(0);
  });

  test("browser Back after Logout does not show Mypage content and ends at Login", async ({
    page,
  }) => {
    await open(page, "/mypage", { [KEYS.session]: authenticatedSession() });
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    await logoutViaMenu(page);
    await expect(page).toHaveURL(/\/$/);
    // From here on, record whether the protected text appears in this document or after client navigation.
    await page.evaluate((needle: string) => {
      const w = window as unknown as { __sawProtected?: boolean };
      w.__sawProtected = false;
      new MutationObserver(() => {
        if (document.body.innerText.includes(needle)) w.__sawProtected = true;
      }).observe(document, { childList: true, subtree: true, characterData: true });
    }, MARKER_PROTECTED_TEXT);
    await page.goBack();
    await expect(page).toHaveURL(/\/account\/login\?continue=mypage$/);
    await expect(heading1(page)).toHaveText(copy.auth.login.heading);
    expect(await sawProtectedText(page)).toBe(false);
    await expect(mainOf(page)).not.toContainText(copy.mypage.protectedMarker);
    expect(await readSession(page)).toEqual({ kind: "guest" });
  });

  test("Logout from a public page also ends on Home and does not touch the Cart or the mock DB (FR-CRT-012)", async ({
    page,
  }) => {
    await open(page, "/cart", {
      [KEYS.session]: authenticatedSession(),
      ...cartEntries(CART),
    });
    await expect(headerCartLink(page, 3)).toBeVisible();
    const cartBefore = await readCartRaw(page);
    const dbBefore = await page.evaluate((key) => window.localStorage.getItem(key), KEYS.db);
    await logoutViaMenu(page);
    await expect(page).toHaveURL(/\/$/);
    await expect(headerCartLink(page, 3)).toBeVisible();
    expect(await readCartRaw(page)).toBe(cartBefore);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), KEYS.db)).toBe(dbBefore);
  });

  test("Logout still discards the local session when the provider side fails (AR-SES-009)", async ({
    page,
  }) => {
    await open(page, "/entry", {
      ...authScenario({ logout: "provider_failure" }),
      [KEYS.session]: authenticatedSession(),
    });
    await logoutViaMenu(page);
    await expect(page).toHaveURL(/\/$/);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    await expect(headerLogin(page)).toBeVisible();
  });
});

test.describe("TC-AR-SES-007-302 the gate follows session changes made elsewhere (AR-SES-007, SPEC-050 15.6)", () => {
  test("a Logout in another tab sends this tab's protected page to Login", async ({
    page,
    context,
  }) => {
    await open(page, "/mypage", { [KEYS.session]: authenticatedSession() });
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    const other = await openSecondTab(context);
    await gotoHydrated(other, "/");
    await writeStorage(other, KEYS.session, sessionJson({ kind: "guest" }));
    await expect(page).toHaveURL(/\/account\/login\?continue=mypage$/);
    await expect(mainOf(page)).not.toContainText(copy.mypage.protectedMarker);
  });

  test("a restored page (pageshow with persisted=true, as after bfcache) re-checks the session", async ({
    page,
  }) => {
    await open(page, "/mypage", { [KEYS.session]: authenticatedSession() });
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    // The stored session becomes guest without any event reaching this tab (as when the tab was frozen).
    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [KEYS.session, sessionJson({ kind: "guest" })],
    );
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await expect(page).toHaveURL(/\/account\/login\?continue=mypage$/, { timeout: 20_000 });
    await expect(mainOf(page)).not.toContainText(copy.mypage.protectedMarker);
  });
});

test.describe("TC-PG-AUTH-003-312 Header and Cart across Login and Logout (SPEC-050 8.2 / 8.3, 31 item 24 second half, FR-CRT-012)", () => {
  test("Login then Logout: the Header switches both ways without a reload and the Cart is unchanged throughout", async ({
    page,
  }) => {
    await open(page, "/account/login", cartEntries(CART));
    const cartRaw = await readCartRaw(page);
    await expect(headerLogin(page)).toBeVisible();
    await expect(accountMenuButton(page)).toHaveCount(0);
    await expect(headerCartLink(page, 3)).toBeVisible();

    await loginWith(page, EMAIL.demo);
    await expect(page).toHaveURL(/\/mypage$/);
    await expect(headerMypage(page)).toBeVisible();
    await expect(accountMenuButton(page)).toBeVisible();
    await expect(headerLogin(page)).toHaveCount(0);
    await expect(headerCartLink(page, 3)).toBeVisible();
    expect(await readCartRaw(page)).toBe(cartRaw);

    await logoutViaMenu(page);
    await expect(page).toHaveURL(/\/$/);
    await expect(headerLogin(page)).toBeVisible();
    await expect(headerMypage(page)).toHaveCount(0);
    await expect(headerCartLink(page, 3)).toBeVisible();
    expect(await readCartRaw(page)).toBe(cartRaw);
  });

  test("a guest adds to the Cart, logs in from the Cart flow, and the lines are still there on /cart", async ({
    page,
  }) => {
    await open(page, "/entry");
    const addButton = mainOf(page)
      .getByRole("listitem")
      .filter({ hasText: copy.availability.label.ON_SALE })
      .first()
      .getByRole("button", { name: copy.sales.add });
    await addButton.click();
    await expect(statusesIn(page)).toContainText(copy.sales.addSucceeded);
    await expect(headerCartLink(page, 1)).toBeVisible();
    const cartRaw = await readCartRaw(page);
    await gotoHydrated(page, "/account/login?continue=cart");
    await loginWith(page, EMAIL.demo);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(mainOf(page).getByRole("listitem")).toHaveCount(1);
    await expect(headerCartLink(page, 1)).toBeVisible();
    expect(await readCartRaw(page)).toBe(cartRaw);
  });

  test("the session survives a reload (Authenticated stays authenticated, no Login flash for the Header)", async ({
    page,
  }) => {
    await open(page, "/mypage", { [KEYS.session]: authenticatedSession() });
    const raw = await readSessionRaw(page);
    await reloadHydrated(page);
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    expect(await readSessionRaw(page)).toBe(raw);
    await expect(headerMypage(page)).toBeVisible();
  });
});
