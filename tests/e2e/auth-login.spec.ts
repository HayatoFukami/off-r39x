import { expect, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  alertsIn,
  authScenario,
  chooseMethod,
  describedText,
  dumpStorage,
  expectMethodRadios,
  field,
  focused,
  googleRadio,
  googleStartButton,
  headerLogin,
  headerMypage,
  heading1,
  linkIn,
  loginWith,
  MARKER_PROTECTED_TEXT,
  mainOf,
  methodGroup,
  methodRadio,
  OTP_CODE,
  otpButton,
  otpCodeField,
  readSession,
  readUsers,
  SENTINEL_OTP_CODE,
  SENTINEL_PASSWORD,
  sendOtp,
  setAuthScenario,
  statusesIn,
  submitButton,
  submitOtpCode,
  urlOf,
} from "../harness/browser/auth.ts";
import {
  addButton,
  cartEntries,
  entryLine,
  goodsLine,
  headerCartLink,
  offeringName,
  quantityInput,
  readCartRaw,
  readDbRaw,
} from "../harness/browser/cart.ts";
import { gotoHydrated } from "../harness/browser/hydration.ts";
import { fixClock } from "../harness/browser/public.ts";
import {
  KEYS,
  ORIGIN_HOST,
  seedLocalStorage,
  watchRequestHosts,
  watchRuntimeErrors,
} from "../harness/browser/shell.ts";
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
    await openLogin(page);
    await gotoHydrated(page, "/entry");
    const entry = mainOf(page)
      .getByRole("listitem")
      .filter({
        has: page.getByRole("heading", { name: offeringName(OFFERING.regular), exact: true }),
      });
    await quantityInput(entry).fill("2");
    await addButton(entry).click();
    await gotoHydrated(page, `/goods/${GOODS.tshirt}`);
    await addButton(mainOf(page)).click();
    await gotoHydrated(page, "/account/login?continue=cart");
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

// ---- B5 C1: method selection and Email OTP (tests/contracts/s6-auth.md sections 6.1A, 6.1B) ------------------
// SPEC-050 15.0 / 15.3 / 25, SPEC-060 AR-AUTH-008 / AR-CONT-001, SPEC-040 UF-AUTH-002, SPEC-140 SEC-API-027 /
// SEC-AUTH-018, SPEC-020 FR-CRT-012. The mock never compares a code; scenarios auth.login / auth.verify decide.

const otp = () => copy.auth.otp;
const method = () => copy.auth.method;

test.describe("TC-PG-AUTH-003-305 Login offers a method selection that starts on Email+Password, keeps the Continuation and the existing form, and offers no other provider (SPEC-050 15.0 / 15.3, AR-CONT-001)", () => {
  test("the radio group is named by its legend, lists the methods in the specified order, and the existing form is shown unchanged with Email+Password checked", async ({
    page,
  }) => {
    await openLogin(page, "?continue=cart");
    const group = methodGroup(page, method().legendLogin);
    await expect(group).toBeVisible();
    // The specified order (SPEC-050 15.0): Email+Password, Google, Email OTP (and Magic Link last once it exists).
    await expectMethodRadios(group);
    // The existing Email+Password form: same labels, same submit, no OTP control.
    await expect(field(page, copy.auth.field.email.label)).toBeVisible();
    await expect(field(page, copy.auth.field.password.label)).toBeVisible();
    await expect(submitButton(page, copy.auth.login.submit)).toBeVisible();
    await expect(otpButton(page, otp().send)).toHaveCount(0);
    await expect(otpCodeField(page)).toHaveCount(0);
    // Continuation notice and the register / reset / cancel links are kept.
    await expect(mainOf(page)).toContainText(copy.auth.continuation.notice);
    await expect(linkIn(page, copy.auth.login.toRegister)).toBeVisible();
    // No other provider and no alert or status on a fresh page.
    await expect(mainOf(page)).not.toContainText(/GitHub|Discord/i);
    await expect(alertsIn(page)).toHaveCount(0);
    await expect(statusesIn(page)).toHaveCount(0);
  });

  test("choosing Email OTP swaps the password form for the code request without changing the URL, the Session or the focus; choosing Email+Password again restores an empty password field", async ({
    page,
  }) => {
    await openLogin(page, "?continue=cart");
    const url = page.url();
    await field(page, copy.auth.field.password.label).fill(SENTINEL_PASSWORD);

    await chooseMethod(page, method().emailOtp);
    await expect(methodRadio(page, method().emailOtp)).toBeChecked();
    await expect(methodRadio(page, method().emailOtp)).toBeFocused();
    await expect(field(page, copy.auth.field.password.label)).toHaveCount(0);
    await expect(submitButton(page, copy.auth.login.submit)).toHaveCount(0);
    await expect(field(page, copy.auth.field.email.label)).toBeVisible();
    await expect(otpButton(page, otp().send)).toBeVisible();
    await expect(otpCodeField(page)).toHaveCount(0);
    expect(page.url()).toBe(url);
    await expect(mainOf(page)).toContainText(copy.auth.continuation.notice);
    await expect(alertsIn(page)).toHaveCount(0);
    expect(await readSession(page)).toEqual({ kind: "guest" });

    await chooseMethod(page, method().password);
    await expect(field(page, copy.auth.field.password.label)).toBeVisible();
    await expect(field(page, copy.auth.field.password.label)).toHaveValue("");
    await expect(otpButton(page, otp().send)).toHaveCount(0);
    expect(page.url()).toBe(url);
    expect(await dumpStorage(page)).not.toContain(SENTINEL_PASSWORD);
  });

  test("the method radio group is operable with the keyboard alone (arrow keys select, no navigation)", async ({
    page,
  }) => {
    await openLogin(page);
    await methodRadio(page, method().password).focus();
    // Email+Password, Google, Email OTP: the arrow keys walk the specified order.
    await page.keyboard.press("ArrowDown");
    await expect(googleRadio(page)).toBeChecked();
    await expect(googleStartButton(page, "login")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(methodRadio(page, method().emailOtp)).toBeChecked();
    await expect(otpButton(page, otp().send)).toBeVisible();
    await page.keyboard.press("ArrowUp");
    await expect(googleRadio(page)).toBeChecked();
    await page.keyboard.press("ArrowUp");
    await expect(methodRadio(page, method().password)).toBeChecked();
    await expect(submitButton(page, copy.auth.login.submit)).toBeVisible();
    await expect(page).toHaveURL(/\/account\/login$/);
  });
});

test.describe("TC-PG-AUTH-003-306 Email OTP Login: send the code, enter it, and arrive at the destination as a verified user with the Cart handled like Login (SPEC-050 15.0 / 15.3, AR-AUTH-008, FR-CRT-012, SEC-API-027)", () => {
  const goToCodeStep = async (page: import("@playwright/test").Page, email: string) => {
    await chooseMethod(page, method().emailOtp);
    await sendOtp(page, email);
    await expect(statusesIn(page)).toHaveCount(1);
    await expect(statusesIn(page)).toHaveText(otp().sent);
  };

  test("send then verify: the code step appears with its status, resend and change-email controls; the code signs in and goes to Mypage", async ({
    page,
  }) => {
    const runtime = watchRuntimeErrors(page);
    const seen = watchRequestHosts(page);
    await openLogin(page);
    await goToCodeStep(page, EMAIL.demo);
    await expect(otpCodeField(page)).toBeVisible();
    await expect(otpCodeField(page)).toHaveAttribute("autocomplete", "one-time-code");
    await expect(otpCodeField(page)).toHaveAttribute("inputmode", "numeric");
    await expect(otpCodeField(page)).not.toHaveAttribute("maxlength");
    await expect(otpButton(page, otp().submitLogin)).toBeEnabled();
    await expect(otpButton(page, otp().resend)).toBeEnabled();
    await expect(otpButton(page, otp().changeEmail)).toBeEnabled();
    await expect(otpButton(page, otp().submitRegister)).toHaveCount(0);
    await expect(alertsIn(page)).toHaveCount(0);
    expect(await readSession(page)).toEqual({ kind: "guest" });

    await submitOtpCode(page, OTP_CODE, otp().submitLogin);
    await expect(page).toHaveURL(/\/mypage$/);
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    await expect(mainOf(page)).toContainText(MARKER_PROTECTED_TEXT);
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: EMAIL.demo,
      emailVerified: true,
    });
    await expect(headerMypage(page)).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(runtime.errors).toEqual([]);
    expect([...seen.hosts]).toEqual([ORIGIN_HOST]);
  });

  test("change email returns to the first step; resend keeps the code step with a fresh sent status", async ({
    page,
  }) => {
    await openLogin(page);
    await goToCodeStep(page, EMAIL.demo);
    await otpButton(page, otp().resend).click();
    await expect(statusesIn(page)).toHaveCount(1);
    await expect(statusesIn(page)).toHaveText(otp().sent);
    await expect(otpCodeField(page)).toBeVisible();
    await expect(alertsIn(page)).toHaveCount(0);

    await otpButton(page, otp().changeEmail).click();
    await expect(otpCodeField(page)).toHaveCount(0);
    await expect(otpButton(page, otp().send)).toBeVisible();
    await expect(statusesIn(page)).toHaveCount(0);
    await expect(alertsIn(page)).toHaveCount(0);
    expect(await readSession(page)).toEqual({ kind: "guest" });
  });

  test("continue=cart with a Guest Cart: the Cart is kept byte-identical, its provenance becomes authenticated, and /cart shows the lines", async ({
    page,
  }) => {
    const lines = [entryLine(OFFERING.regular, 2), goodsLine(GOODS.tshirt, 1)];
    await openLogin(page, "?continue=cart", cartEntries(lines, "guest"));
    await expect(headerCartLink(page, 3)).toBeVisible();
    const before = await readCartRaw(page);
    await goToCodeStep(page, EMAIL.demo);
    await submitOtpCode(page, OTP_CODE, otp().submitLogin);
    await expect(page).toHaveURL(/\/cart$/);
    await expect(heading1(page)).toHaveText(copy.cart.heading);
    await expect(mainOf(page).getByRole("listitem")).toHaveCount(2);
    await expect(headerCartLink(page, 3)).toBeVisible();
    expect(await readCartRaw(page)).toBe(before);
    const lifecycle = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      KEYS.cartLifecycle,
    );
    expect(JSON.parse(lifecycle ?? "null")).toEqual({ version: 1, provenance: "authenticated" });
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: EMAIL.demo,
      emailVerified: true,
    });
  });

  test("a Cart of authenticated provenance left in this Browser is cleared by an OTP Login, exactly like a password Login", async ({
    page,
  }) => {
    const lines = [entryLine(OFFERING.regular, 2)];
    await openLogin(page, "?continue=cart", cartEntries(lines, "authenticated"));
    expect(await readCartRaw(page)).not.toBeNull();
    await goToCodeStep(page, EMAIL.other);
    await submitOtpCode(page, OTP_CODE, otp().submitLogin);
    await expect(page).toHaveURL(/\/cart$/);
    await expect.poll(() => readCartRaw(page)).toBeNull();
    await expect(mainOf(page)).toContainText(copy.cart.empty);
    await expect(headerCartLink(page, null)).toBeVisible();
  });

  test("an unverified user is verified by the code (the mailbox is proven): Login goes to the destination, the stored user and Session are verified", async ({
    page,
  }) => {
    await openLogin(page, "?continue=cart");
    await goToCodeStep(page, EMAIL.unverified);
    await submitOtpCode(page, OTP_CODE, otp().submitLogin);
    await expect(page).toHaveURL(/\/cart$/);
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: EMAIL.unverified,
      emailVerified: true,
    });
    const users = (await readUsers(page)) ?? [];
    expect(users.find((u) => u.email === EMAIL.unverified)?.emailVerified).toBe(true);
  });

  test("the answer to the code request is the same for a registered and an unregistered email, and nothing about the account is stored (SEC-API-027)", async ({
    page,
  }) => {
    const unknown = "nobody-otp@example.com";
    await openLogin(page);
    const observed: { text: string; buttons: string[] }[] = [];
    for (const email of [EMAIL.demo, unknown]) {
      await gotoHydrated(page, "/account/login");
      await chooseMethod(page, method().emailOtp);
      const dbBefore = await readDbRaw(page);
      await sendOtp(page, email);
      await expect(statusesIn(page)).toHaveText(otp().sent);
      const text = (await mainOf(page).innerText()).replaceAll(email, "<email>");
      const buttons = await mainOf(page).getByRole("button").allInnerTexts();
      observed.push({ text, buttons });
      await expect(alertsIn(page)).toHaveCount(0);
      expect(await readDbRaw(page)).toBe(dbBefore);
      expect(await readSession(page)).toEqual({ kind: "guest" });
    }
    expect(observed[1]).toEqual(observed[0]);
    expect(await dumpStorage(page)).not.toContain(unknown);
    expect((await readUsers(page))?.some((u) => u.email === unknown) ?? false).toBe(false);
  });
});

test.describe("TC-PG-AUTH-003-307 Email OTP failures leave the visitor a Guest on the same page, say what to do next, and never authenticate (SPEC-050 15.0 / 15.3, AR-AUTH-008, AR-FAIL-001, UF-AUTH-002)", () => {
  const goToCodeStep = async (page: import("@playwright/test").Page, email = EMAIL.demo) => {
    await chooseMethod(page, method().emailOtp);
    await sendOtp(page, email);
    await expect(statusesIn(page)).toHaveText(otp().sent);
  };

  test("a wrong code: one alert asks to enter it again, the code field stays (emptied), nothing changes; a correct code afterwards signs in", async ({
    page,
  }) => {
    await openLogin(page, "?continue=cart", authScenario({ login: "credential_failure" }));
    const url = page.url();
    await goToCodeStep(page);
    const dbBefore = await readDbRaw(page);
    await submitOtpCode(page, OTP_CODE, otp().submitLogin);
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toHaveText(otp().codeInvalid);
    await expect(mainOf(page)).not.toContainText(copy.auth.login.credentialFailure);
    await expect(otpCodeField(page)).toBeVisible();
    await expect(otpCodeField(page)).toHaveValue("");
    await expect(otpButton(page, otp().resend)).toBeVisible();
    expect(page.url()).toBe(url);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    expect(await readDbRaw(page)).toBe(dbBefore);
    await expect(headerLogin(page)).toBeVisible();
    await expect(headerMypage(page)).toHaveCount(0);

    await setAuthScenario(page, { login: "ok" });
    await submitOtpCode(page, OTP_CODE, otp().submitLogin);
    await expect(page).toHaveURL(/\/cart$/);
    expect((await readSession(page)).kind).toBe("authenticated");
  });

  test("an expired or exhausted code: one alert asks for a new code, resend is offered and brings a fresh sent status; a new code then signs in", async ({
    page,
  }) => {
    await openLogin(page, "", authScenario({ verify: "invalid_or_expired" }));
    await goToCodeStep(page);
    const dbBefore = await readDbRaw(page);
    await submitOtpCode(page, OTP_CODE, otp().submitLogin);
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toHaveText(otp().codeExpired);
    await expect(alertsIn(page)).not.toHaveText(otp().codeInvalid);
    await expect(otpButton(page, otp().resend)).toBeEnabled();
    expect(await readSession(page)).toEqual({ kind: "guest" });
    expect(await readDbRaw(page)).toBe(dbBefore);

    await otpButton(page, otp().resend).click();
    await expect(statusesIn(page)).toHaveText(otp().sent);
    await expect(alertsIn(page)).toHaveCount(0);

    await setAuthScenario(page, { verify: "ok" });
    await submitOtpCode(page, OTP_CODE, otp().submitLogin);
    await expect(page).toHaveURL(/\/mypage$/);
    expect((await readSession(page)).kind).toBe("authenticated");
  });

  test("the service is unavailable when the code is requested: one alert, still the first step, no code field, still a Guest", async ({
    page,
  }) => {
    await openLogin(page, "?continue=cart", authScenario({ login: "unavailable" }));
    await chooseMethod(page, method().emailOtp);
    await sendOtp(page, EMAIL.demo);
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toHaveText(otp().unavailable);
    await expect(statusesIn(page)).toHaveCount(0);
    await expect(otpCodeField(page)).toHaveCount(0);
    await expect(otpButton(page, otp().send)).toBeEnabled();
    await expect(page).toHaveURL(/\/account\/login\?continue=cart$/);
    expect(await readSession(page)).toEqual({ kind: "guest" });
  });

  test("the service becomes unavailable at the code step: one alert, the code field stays, still a Guest; the code is never stored", async ({
    page,
  }) => {
    await openLogin(page);
    await goToCodeStep(page);
    await setAuthScenario(page, { login: "unavailable" });
    await submitOtpCode(page, SENTINEL_OTP_CODE, otp().submitLogin);
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toHaveText(otp().unavailable);
    await expect(otpCodeField(page)).toBeVisible();
    await expect(otpCodeField(page)).toHaveValue("");
    expect(await readSession(page)).toEqual({ kind: "guest" });
    expect(await dumpStorage(page)).not.toContain(SENTINEL_OTP_CODE);
  });

  test("an empty or malformed email never reaches the port: the error summary takes focus, names the field, and the outage scenario's alert does not appear", async ({
    page,
  }) => {
    await openLogin(page, "", authScenario({ login: "unavailable" }));
    await chooseMethod(page, method().emailOtp);
    await otpButton(page, otp().send).click();
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toContainText(copy.auth.form.errorSummaryTitle);
    await expect(
      alertsIn(page).getByRole("link", { name: copy.auth.field.email.required }),
    ).toBeVisible();
    expect((await focused(page)).role).toBe("alert");
    await expect(field(page, copy.auth.field.email.label)).toHaveAttribute("aria-invalid", "true");
    await expect(mainOf(page)).not.toContainText(otp().unavailable);

    await field(page, copy.auth.field.email.label).fill("not-an-email");
    await otpButton(page, otp().send).click();
    await expect(alertsIn(page)).toContainText(copy.auth.field.email.invalidFormat);
    await expect(mainOf(page)).not.toContainText(otp().unavailable);
    await expect(otpCodeField(page)).toHaveCount(0);
  });

  test("an empty code never reaches the port: the error summary links to the code field, which is invalid and described", async ({
    page,
  }) => {
    await openLogin(page);
    await goToCodeStep(page);
    await setAuthScenario(page, { login: "unavailable" });
    await otpButton(page, otp().submitLogin).click();
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toContainText(copy.auth.form.errorSummaryTitle);
    const link = alertsIn(page).getByRole("link", { name: copy.auth.field.otpCode.required });
    await expect(link).toBeVisible();
    expect((await focused(page)).role).toBe("alert");
    await expect(otpCodeField(page)).toHaveAttribute("aria-invalid", "true");
    expect(await describedText(otpCodeField(page))).toContain(copy.auth.field.otpCode.required);
    await expect(mainOf(page)).not.toContainText(otp().unavailable);
    await link.click();
    await expect(otpCodeField(page)).toBeFocused();
    expect(await readSession(page)).toEqual({ kind: "guest" });
  });
});
