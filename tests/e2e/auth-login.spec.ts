import { expect, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  alertsIn,
  authScenario,
  describedText,
  dumpStorage,
  field,
  focused,
  headerLogin,
  headerMypage,
  heading1,
  linkIn,
  loginWith,
  MARKER_PROTECTED_TEXT,
  mainOf,
  readSession,
  SENTINEL_PASSWORD,
  statusesIn,
  submitButton,
  urlOf,
} from "../harness/browser/auth.ts";
import {
  cartEntries,
  entryLine,
  goodsLine,
  headerCartLink,
  readCartRaw,
} from "../harness/browser/cart.ts";
import { gotoHydrated } from "../harness/browser/hydration.ts";
import { fixClock } from "../harness/browser/public.ts";
import { ORIGIN_HOST, seedLocalStorage, watchRequestHosts } from "../harness/browser/shell.ts";
import { EMAIL, GOODS, OFFERING, SLOT } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s6-auth.md sections 2, 6.1, 7.
// SPEC-050 10, 15.3, 25, 31 items 3 and 24 (second half), SPEC-060 AR-CONT-001..004, AR-AUTH-008,
// SPEC-140 SEC-WEB-013, SEC-AUTH-018.

async function openLogin(page: import("@playwright/test").Page, query = "", entries = {}) {
  await fixClock(page);
  await seedLocalStorage(page, entries);
  await gotoHydrated(page, `/account/login${query}`);
  await expect(heading1(page)).toHaveText(copy.auth.login.heading);
}

test.describe("TC-PG-AUTH-003-301 Login returns to the logical destination: Cart and Karaoke slot (SPEC-050 31 item 3, AR-CONT-001, AR-CONT-004)", () => {
  test("continue=cart: after Login the Cart page is shown with its lines intact (item 24, second half)", async ({
    page,
  }) => {
    const lines = [entryLine(OFFERING.regular, 2), goodsLine(GOODS.tshirt, 1)];
    await openLogin(page, "?continue=cart", cartEntries(lines));
    const before = await readCartRaw(page);
    await loginWith(page, EMAIL.demo);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(heading1(page)).toHaveText(copy.cart.heading);
    await expect(mainOf(page).getByRole("listitem")).toHaveCount(2);
    await expect(headerCartLink(page, 3)).toBeVisible();
    expect(await readCartRaw(page)).toBe(before);
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: EMAIL.demo,
      emailVerified: true,
    });
  });

  test("continue=karaoke-slot:<ref>: after Login the same slot page URL is opened", async ({
    page,
  }) => {
    await openLogin(page, `?continue=karaoke-slot:${SLOT.d1_1000}`);
    await loginWith(page, EMAIL.demo);
    await expect(page).toHaveURL(new RegExp(`/karaoke/slots/${SLOT.d1_1000}$`));
    expect(urlOf(page).search).toBe("");
  });

  test("continue=mypage and no continue both land on the Mypage Overview (PG-MYP-001)", async ({
    page,
  }) => {
    await openLogin(page, "?continue=mypage");
    await loginWith(page, EMAIL.demo);
    await expect(page).toHaveURL(/\/mypage$/);
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    await expect(mainOf(page)).toContainText(MARKER_PROTECTED_TEXT);
  });

  test("no continue: PG-MYP-001 (/mypage), and the Header switches to the member controls", async ({
    page,
  }) => {
    await openLogin(page);
    await expect(headerLogin(page)).toBeVisible();
    await loginWith(page, EMAIL.fresh);
    await expect(page).toHaveURL(/\/mypage$/);
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    await expect(headerMypage(page)).toBeVisible();
    await expect(headerLogin(page)).toHaveCount(0);
  });
});

test.describe("TC-AR-CONT-003-301 an unsafe continue value never leaves the site or reaches /admin /staff (SEC-WEB-013, AR-CONT-003, U9 mirror)", () => {
  const UNSAFE = [
    "https://evil.example.com/",
    "//evil.example.com",
    "/admin",
    "%2Fadmin",
    "/staff/checkin",
    "javascript:alert(1)",
    "cart:../../admin",
    "karaoke-slot:not-a-uuid",
    "\\\\evil.example.com",
  ];
  for (const value of UNSAFE) {
    test(`continue=${JSON.stringify(value)} -> /mypage, shown as the Mypage purpose, no external request`, async ({
      page,
    }) => {
      const seen = watchRequestHosts(page);
      await openLogin(page, `?continue=${encodeURIComponent(value)}`);
      await expect(mainOf(page)).toContainText(copy.auth.continuation.notice);
      await expect(mainOf(page)).toContainText(copy.auth.continuation.purpose.mypage);
      await loginWith(page, EMAIL.demo);
      await expect(page).toHaveURL(/\/mypage$/);
      await expect(heading1(page)).toHaveText(copy.mypage.heading);
      await page.waitForLoadState("networkidle");
      expect([...seen.hosts]).toEqual([ORIGIN_HOST]);
      expect(urlOf(page).pathname).toBe("/mypage");
    });
  }
});

test.describe("TC-PG-AUTH-003-302 the authentication-required notice and the way out (SPEC-050 10.1 / 15.3, AR-CONT-004)", () => {
  test("shows the purpose in general words and states that the current state is re-checked", async ({
    page,
  }) => {
    await openLogin(page, "?continue=cart");
    const main = mainOf(page);
    await expect(main).toContainText(copy.auth.continuation.notice);
    await expect(main).toContainText(copy.auth.continuation.purpose.cart);
    await expect(main).toContainText(copy.auth.continuation.returnAfter);
    await expect(main).toContainText(copy.auth.continuation.revalidate);
    await expect(main).not.toContainText(/[¥￥]/);
    await expect(main).not.toContainText(OFFERING.regular);
  });

  test("names the Karaoke purpose for a slot and shows no slot reference or time", async ({
    page,
  }) => {
    await openLogin(page, `?continue=karaoke-slot:${SLOT.d1_1000}`);
    await expect(mainOf(page)).toContainText(copy.auth.continuation.purpose.karaokeSlot);
    await expect(mainOf(page)).not.toContainText(SLOT.d1_1000);
  });

  test("shows no notice for a plain Login", async ({ page }) => {
    await openLogin(page);
    await expect(mainOf(page)).not.toContainText(copy.auth.continuation.notice);
    await expect(mainOf(page)).not.toContainText(copy.auth.continuation.returnAfter);
  });

  test("cancel returns to the public page: Cart for cart, the slot for karaoke-slot, Home otherwise", async ({
    page,
  }) => {
    await openLogin(page, "?continue=cart");
    await linkIn(page, copy.auth.login.cancel).click();
    await expect(page).toHaveURL(/\/cart$/);

    await gotoHydrated(page, `/account/login?continue=karaoke-slot:${SLOT.d1_1000}`);
    await linkIn(page, copy.auth.login.cancel).click();
    await expect(page).toHaveURL(new RegExp(`/karaoke/slots/${SLOT.d1_1000}$`));

    await gotoHydrated(page, "/account/login");
    await linkIn(page, copy.auth.login.cancel).click();
    await expect(page).toHaveURL(/\/$/);
    expect(urlOf(page).pathname).toBe("/");
    expect(await readSession(page)).toEqual({ kind: "guest" });
  });

  test("the register and reset links keep the destination", async ({ page }) => {
    await openLogin(page, "?continue=cart");
    const register = await linkIn(page, copy.auth.login.toRegister).getAttribute("href");
    const reset = await linkIn(page, copy.auth.login.toPasswordReset).getAttribute("href");
    expect(new URL(register ?? "", "http://x").pathname).toBe("/account/register");
    expect(new URL(register ?? "", "http://x").searchParams.get("continue")).toBe("cart");
    expect(new URL(reset ?? "", "http://x").pathname).toBe("/account/password-reset");
    expect(new URL(reset ?? "", "http://x").searchParams.get("continue")).toBe("cart");
  });

  test("without a destination the links carry no query", async ({ page }) => {
    await openLogin(page);
    expect(await linkIn(page, copy.auth.login.toRegister).getAttribute("href")).toBe(
      "/account/register",
    );
    expect(await linkIn(page, copy.auth.login.toPasswordReset).getAttribute("href")).toBe(
      "/account/password-reset",
    );
  });
});

test.describe("TC-PG-AUTH-003-303 Login failures do not authenticate and do not reveal the cause (SPEC-050 15.3, SEC-API-027, AR-AUTH-008)", () => {
  test("credential failure: one generic alert, still a guest, nothing leaks", async ({ page }) => {
    await openLogin(page, "?continue=cart", authScenario({ login: "credential_failure" }));
    await loginWith(page, EMAIL.demo, SENTINEL_PASSWORD);
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toHaveText(copy.auth.login.credentialFailure);
    await expect(page).toHaveURL(/\/account\/login\?continue=cart$/);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    await expect(headerLogin(page)).toBeVisible();
    await expect(headerMypage(page)).toHaveCount(0);
    expect(await dumpStorage(page)).not.toContain(SENTINEL_PASSWORD);
    expect(page.url()).not.toContain(SENTINEL_PASSWORD);
    await expect(mainOf(page)).not.toContainText(SENTINEL_PASSWORD);
  });

  test("an unknown email gets the same message as a wrong password", async ({ page }) => {
    await openLogin(page);
    await loginWith(page, "nobody@example.com");
    await expect(alertsIn(page)).toHaveText(copy.auth.login.credentialFailure);
    expect(await readSession(page)).toEqual({ kind: "guest" });
  });

  test("service outage: a different message, still a guest, no purchase flow opened", async ({
    page,
  }) => {
    await openLogin(page, "?continue=cart", authScenario({ login: "unavailable" }));
    await loginWith(page, EMAIL.demo);
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toHaveText(copy.auth.login.unavailable);
    await expect(page).toHaveURL(/\/account\/login/);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    await expect(headerMypage(page)).toHaveCount(0);
  });

  test("an unverified user is sent to Email Verification with the destination, not to the purchase flow", async ({
    page,
  }) => {
    await openLogin(page, "?continue=cart");
    await loginWith(page, EMAIL.unverified);
    await expect(page).toHaveURL(/\/account\/email-verification\?continue=cart$/);
    await expect(heading1(page)).toHaveText(copy.auth.verify.heading);
    await expect(mainOf(page)).not.toContainText(copy.auth.verify.verified);
  });

  test("the password-updated notice appears only for the exact notice value", async ({ page }) => {
    await openLogin(page, "?notice=password-updated");
    await expect(statusesIn(page)).toHaveCount(1);
    await expect(statusesIn(page)).toHaveText(copy.auth.login.passwordUpdated);
    await gotoHydrated(page, "/account/login?notice=anything-else");
    await expect(statusesIn(page)).toHaveCount(0);
    await gotoHydrated(page, "/account/login");
    await expect(statusesIn(page)).toHaveCount(0);
  });
});

test.describe("TC-PG-AUTH-003-304 form validation: error summary, focus and aria (SPEC-050 25, 31 item 22, U13 mirror)", () => {
  test("an empty submit shows the summary, focuses it, and marks both fields invalid without calling the port", async ({
    page,
  }) => {
    await openLogin(page, "", authScenario({ login: "unavailable" }));
    await submitButton(page, copy.auth.login.submit).click();
    const summary = alertsIn(page);
    await expect(summary).toHaveCount(1);
    await expect(summary).toContainText(copy.auth.form.errorSummaryTitle);
    await expect(summary.getByRole("link", { name: copy.auth.field.email.required })).toBeVisible();
    await expect(
      summary.getByRole("link", { name: copy.auth.field.password.required }),
    ).toBeVisible();
    expect((await focused(page)).role).toBe("alert");

    const email = field(page, copy.auth.field.email.label);
    const password = field(page, copy.auth.field.password.label);
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(password).toHaveAttribute("aria-invalid", "true");
    expect(await describedText(email)).toContain(copy.auth.field.email.required);
    expect(await describedText(password)).toContain(copy.auth.field.password.required);
    // The outage scenario would have shown copy.auth.login.unavailable had the port been called.
    await expect(mainOf(page)).not.toContainText(copy.auth.login.unavailable);
    expect(await readSession(page)).toEqual({ kind: "guest" });
  });

  test("an error-summary link moves focus to its field, and a malformed email names the format", async ({
    page,
  }) => {
    await openLogin(page);
    await field(page, copy.auth.field.email.label).fill("not-an-email");
    await field(page, copy.auth.field.password.label).fill("x");
    await submitButton(page, copy.auth.login.submit).click();
    await expect(alertsIn(page)).toContainText(copy.auth.field.email.invalidFormat);
    await expect(field(page, copy.auth.field.password.label)).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await alertsIn(page).getByRole("link", { name: copy.auth.field.email.invalidFormat }).click();
    await expect(field(page, copy.auth.field.email.label)).toBeFocused();
  });

  test("the form is operable with the keyboard alone (Tab order, Enter submits)", async ({
    page,
  }) => {
    await openLogin(page, "?continue=cart");
    await field(page, copy.auth.field.email.label).focus();
    await page.keyboard.type(EMAIL.demo);
    await page.keyboard.press("Tab");
    await expect(field(page, copy.auth.field.password.label)).toBeFocused();
    await page.keyboard.type("keyboard-only-pass-1");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/cart$/);
  });

  test("a long password is not truncated by the field (no maxlength) and Login does not enforce the length rule", async ({
    page,
  }) => {
    await openLogin(page);
    await expect(field(page, copy.auth.field.password.label)).not.toHaveAttribute("maxlength");
    await expect(field(page, copy.auth.field.email.label)).not.toHaveAttribute("maxlength");
    await expect(field(page, copy.auth.field.password.label)).toHaveAttribute("type", "password");
    await field(page, copy.auth.field.email.label).fill(EMAIL.demo);
    await field(page, copy.auth.field.password.label).fill("short");
    await submitButton(page, copy.auth.login.submit).click();
    await expect(page).toHaveURL(/\/mypage$/);
  });
});
