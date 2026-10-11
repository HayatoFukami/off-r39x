import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  alertsIn,
  authScenario,
  CONTEXT_VALUE,
  describedText,
  dumpStorage,
  field,
  focused,
  guestWithPending,
  headerLogin,
  heading1,
  linkIn,
  loginWith,
  mainOf,
  readSession,
  SENTINEL_PASSWORD,
  statusesIn,
  submitButton,
  unverifiedSession,
  urlOf,
} from "../harness/browser/auth.ts";
import { writeStorage } from "../harness/browser/cart.ts";
import { gotoHydrated } from "../harness/browser/hydration.ts";
import { fixClock } from "../harness/browser/public.ts";
import { KEYS, seedLocalStorage } from "../harness/browser/shell.ts";
import { EMAIL } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s6-auth.md sections 6.2, 6.3.
// SPEC-050 15.1, 15.2, 25, 31 item 22, SPEC-060 AR-AUTH-006 / 007, SPEC-140 SEC-AUTH-016 / 017 / 018,
// SEC-API-027.

const NEW_EMAIL = "newcomer@example.com";

async function openRegister(page: Page, query = "", entries: Record<string, string> = {}) {
  await fixClock(page);
  await seedLocalStorage(page, entries);
  await gotoHydrated(page, `/account/register${query}`);
  await expect(heading1(page)).toHaveText(copy.auth.register.heading);
}

async function fillRegister(page: Page, email: string, password: string, confirm = password) {
  await field(page, copy.auth.field.email.label).fill(email);
  await field(page, copy.auth.field.password.label).fill(password);
  await field(page, copy.auth.field.passwordConfirm.label).fill(confirm);
}

const submit = (page: Page) => submitButton(page, copy.auth.register.submit);

test.describe("TC-PG-AUTH-001-301 registration that needs email confirmation goes to Email Verification (SPEC-050 15.1 Success, AR-AUTH-006)", () => {
  test("the default scenario: the user is not signed in and sees the confirmation-required state", async ({
    page,
  }) => {
    await openRegister(page);
    await fillRegister(page, NEW_EMAIL, SENTINEL_PASSWORD);
    await submit(page).click();
    await expect(page).toHaveURL(/\/account\/email-verification$/);
    await expect(heading1(page)).toHaveText(copy.auth.verify.heading);
    await expect(statusesIn(page)).toHaveText(copy.auth.verify.required);
    await expect(mainOf(page)).not.toContainText(copy.auth.verify.verified);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    await expect(headerLogin(page)).toBeVisible();
    expect(await dumpStorage(page)).not.toContain(SENTINEL_PASSWORD);
    expect(page.url()).not.toContain(SENTINEL_PASSWORD);
  });

  test("the destination travels to Email Verification", async ({ page }) => {
    await openRegister(page, "?continue=cart");
    await fillRegister(page, NEW_EMAIL, SENTINEL_PASSWORD);
    await submit(page).click();
    await expect(page).toHaveURL(/\/account\/email-verification\?continue=cart$/);
  });

  test("an already registered email gets the same result (account existence is not disclosed, SEC-API-027)", async ({
    page,
  }) => {
    await openRegister(page);
    await fillRegister(page, EMAIL.demo, SENTINEL_PASSWORD);
    await submit(page).click();
    await expect(page).toHaveURL(/\/account\/email-verification$/);
    await expect(statusesIn(page)).toHaveText(copy.auth.verify.required);
    expect(await readSession(page)).toEqual({ kind: "guest" });
  });
});

test.describe("TC-PG-AUTH-001-302 registration outcomes other than confirmation (SPEC-050 15.1 Success / Failure)", () => {
  test("signed in: goes to the destination (or Mypage) with an authenticated session", async ({
    page,
  }) => {
    await openRegister(page, "?continue=cart", authScenario({ signup: "signed_in" }));
    await fillRegister(page, NEW_EMAIL, SENTINEL_PASSWORD);
    await submit(page).click();
    await expect(page).toHaveURL(/\/cart$/);
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: NEW_EMAIL,
      emailVerified: true,
    });
  });

  test("signed in without a destination: Mypage", async ({ page }) => {
    await openRegister(page, "", authScenario({ signup: "signed_in" }));
    await fillRegister(page, NEW_EMAIL, SENTINEL_PASSWORD);
    await submit(page).click();
    await expect(page).toHaveURL(/\/mypage$/);
  });

  test("rejected: shown as registration not completed, still a guest, no navigation", async ({
    page,
  }) => {
    await openRegister(page, "", authScenario({ signup: "rejected" }));
    await fillRegister(page, NEW_EMAIL, SENTINEL_PASSWORD);
    await submit(page).click();
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toHaveText(copy.auth.register.rejected);
    await expect(page).toHaveURL(/\/account\/register$/);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    expect(await dumpStorage(page)).not.toContain(SENTINEL_PASSWORD);
  });

  test("service outage: a different message from a rejection, still a guest", async ({ page }) => {
    await openRegister(page, "", authScenario({ signup: "unavailable" }));
    await fillRegister(page, NEW_EMAIL, SENTINEL_PASSWORD);
    await submit(page).click();
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toHaveText(copy.auth.register.unavailable);
    await expect(page).toHaveURL(/\/account\/register$/);
    expect(await readSession(page)).toEqual({ kind: "guest" });
  });
});

test.describe("TC-PG-AUTH-001-303 password rule at registration: 12 to 128 characters, never trimmed (SEC-AUTH-016 / 017, U13 mirror)", () => {
  test("the password field explains the rule through aria-describedby and has no maxlength", async ({
    page,
  }) => {
    await openRegister(page);
    const password = field(page, copy.auth.field.password.label);
    expect(await describedText(password)).toContain(copy.auth.field.password.hint);
    await expect(password).not.toHaveAttribute("maxlength");
    await expect(password).toHaveAttribute("type", "password");
    await expect(field(page, copy.auth.field.passwordConfirm.label)).toHaveAttribute(
      "type",
      "password",
    );
  });

  test("11 characters are refused with the too-short message, linked and focused", async ({
    page,
  }) => {
    await openRegister(page, "", authScenario({ signup: "unavailable" }));
    await fillRegister(page, NEW_EMAIL, "a".repeat(11));
    await submit(page).click();
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toContainText(copy.auth.form.errorSummaryTitle);
    await expect(
      alertsIn(page).getByRole("link", { name: copy.auth.field.password.tooShort }),
    ).toBeVisible();
    expect((await focused(page)).role).toBe("alert");
    const password = field(page, copy.auth.field.password.label);
    await expect(password).toHaveAttribute("aria-invalid", "true");
    const described = await describedText(password);
    expect(described).toContain(copy.auth.field.password.tooShort);
    expect(described).toContain(copy.auth.field.password.hint);
    // The port was not called (the outage scenario would have shown its message).
    await expect(mainOf(page)).not.toContainText(copy.auth.register.unavailable);
  });

  test("129 characters are refused with the too-long message (not silently truncated)", async ({
    page,
  }) => {
    await openRegister(page);
    await fillRegister(page, NEW_EMAIL, "a".repeat(129));
    await submit(page).click();
    await expect(alertsIn(page)).toContainText(copy.auth.field.password.tooLong);
    await expect(page).toHaveURL(/\/account\/register$/);
    await expect(field(page, copy.auth.field.password.label)).toHaveValue("a".repeat(129));
  });

  test("12 and 128 characters pass", async ({ page }) => {
    await openRegister(page);
    await fillRegister(page, NEW_EMAIL, "a".repeat(128));
    await submit(page).click();
    await expect(page).toHaveURL(/\/account\/email-verification$/);
    await gotoHydrated(page, "/account/register");
    await fillRegister(page, "second@example.com", "b".repeat(12));
    await submit(page).click();
    await expect(page).toHaveURL(/\/account\/email-verification$/);
  });

  test("surrounding spaces count: 2 spaces + 8 letters + 2 spaces is 12 characters and passes (no trim)", async ({
    page,
  }) => {
    await openRegister(page);
    await fillRegister(page, NEW_EMAIL, `  ${"a".repeat(8)}  `);
    await submit(page).click();
    await expect(page).toHaveURL(/\/account\/email-verification$/);
  });

  test("a confirmation mismatch is reported on the confirmation field", async ({ page }) => {
    await openRegister(page);
    await fillRegister(page, NEW_EMAIL, "a".repeat(12), "a".repeat(13));
    await submit(page).click();
    await expect(
      alertsIn(page).getByRole("link", { name: copy.auth.field.passwordConfirm.mismatch }),
    ).toBeVisible();
    await expect(field(page, copy.auth.field.passwordConfirm.label)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(field(page, copy.auth.field.password.label)).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page).toHaveURL(/\/account\/register$/);
  });

  test("an empty submit lists the email and password errors", async ({ page }) => {
    await openRegister(page);
    await submit(page).click();
    await expect(
      alertsIn(page).getByRole("link", { name: copy.auth.field.email.required }),
    ).toBeVisible();
    await expect(
      alertsIn(page).getByRole("link", { name: copy.auth.field.password.required }),
    ).toBeVisible();
    await expect(field(page, copy.auth.field.email.label)).toHaveAttribute("aria-invalid", "true");
  });
});

test.describe("TC-PG-AUTH-001-304 the registration page keeps the destination visible and linked (SPEC-050 15.1 Actions)", () => {
  test("shows the authentication-required notice and a Login link that keeps the destination", async ({
    page,
  }) => {
    await openRegister(page, "?continue=cart");
    await expect(mainOf(page)).toContainText(copy.auth.continuation.notice);
    await expect(mainOf(page)).toContainText(copy.auth.continuation.purpose.cart);
    await expect(mainOf(page)).toContainText(copy.auth.continuation.returnAfter);
    const href = await linkIn(page, copy.auth.register.toLogin).getAttribute("href");
    expect(new URL(href ?? "", "http://x").pathname).toBe("/account/login");
    expect(new URL(href ?? "", "http://x").searchParams.get("continue")).toBe("cart");
  });

  test("without a destination there is no notice and the Login link has no query", async ({
    page,
  }) => {
    await openRegister(page);
    await expect(mainOf(page)).not.toContainText(copy.auth.continuation.notice);
    expect(await linkIn(page, copy.auth.register.toLogin).getAttribute("href")).toBe(
      "/account/login",
    );
  });
});

test.describe("TC-PG-AUTH-002-301 Email Verification separates its states (SPEC-050 15.2, AR-AUTH-007)", () => {
  async function openVerify(page: Page, query: string, entries: Record<string, string> = {}) {
    await fixClock(page);
    await seedLocalStorage(page, entries);
    await gotoHydrated(page, `/account/email-verification${query}`);
    await expect(heading1(page)).toHaveText(copy.auth.verify.heading);
  }

  test("without a context it only asks for the confirmation and never says verified", async ({
    page,
  }) => {
    await openVerify(page, "");
    await expect(statusesIn(page)).toHaveText(copy.auth.verify.required);
    await expect(mainOf(page)).not.toContainText(copy.auth.verify.verified);
    await expect(alertsIn(page)).toHaveCount(0);
    expect(await linkIn(page, copy.auth.verify.toLogin).getAttribute("href")).toBe(
      "/account/login",
    );
  });

  test("a valid context verifies: the context leaves the URL and is never rendered or stored", async ({
    page,
  }) => {
    await openVerify(page, `?continue=cart&context=${CONTEXT_VALUE}`, {
      [KEYS.session]: guestWithPending(EMAIL.unverified),
    });
    await expect(statusesIn(page)).toHaveText(copy.auth.verify.verified);
    await expect(alertsIn(page)).toHaveCount(0);
    expect(urlOf(page).searchParams.has("context")).toBe(false);
    expect(urlOf(page).searchParams.get("continue")).toBe("cart");
    expect(page.url()).not.toContain(CONTEXT_VALUE);
    await expect(mainOf(page)).not.toContainText(CONTEXT_VALUE);
    expect(await dumpStorage(page)).not.toContain(CONTEXT_VALUE);
    const href = await linkIn(page, copy.auth.verify.toLogin).getAttribute("href");
    expect(new URL(href ?? "", "http://x").pathname).toBe("/account/login");
    expect(new URL(href ?? "", "http://x").searchParams.get("continue")).toBe("cart");
  });

  test("after verification the user can log in and reaches Mypage without being sent back to verification", async ({
    page,
  }) => {
    await openVerify(page, `?context=${CONTEXT_VALUE}`, {
      [KEYS.session]: guestWithPending(EMAIL.unverified),
    });
    await expect(statusesIn(page)).toHaveText(copy.auth.verify.verified);
    await linkIn(page, copy.auth.verify.toLogin).click();
    await expect(heading1(page)).toHaveText(copy.auth.login.heading);
    await loginWith(page, EMAIL.unverified);
    await expect(page).toHaveURL(/\/mypage$/);
  });

  test("an authenticated unverified user is offered the way on after verification", async ({
    page,
  }) => {
    await openVerify(page, `?continue=cart&context=${CONTEXT_VALUE}`, {
      [KEYS.session]: unverifiedSession(),
    });
    await expect(statusesIn(page)).toHaveText(copy.auth.verify.verified);
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: EMAIL.unverified,
      emailVerified: true,
    });
    await linkIn(page, copy.auth.verify.continue).click();
    await expect(page).toHaveURL(/\/cart$/);
  });

  test("an invalid or expired link is not shown as verified and claims nothing was deleted", async ({
    page,
  }) => {
    await openVerify(
      page,
      `?context=${CONTEXT_VALUE}`,
      authScenario({ verify: "invalid_or_expired" }),
    );
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toHaveText(copy.auth.verify.invalid);
    await expect(mainOf(page)).not.toContainText(copy.auth.verify.verified);
    await expect(mainOf(page)).not.toContainText(/削除|取り消/);
    await expect(linkIn(page, copy.auth.verify.toLogin)).toBeVisible();
    expect(page.url()).not.toContain(CONTEXT_VALUE);
  });

  test("a service outage can be retried with the same (already removed) context", async ({
    page,
  }) => {
    await openVerify(page, `?context=${CONTEXT_VALUE}`, {
      ...authScenario({ verify: "unavailable" }),
      [KEYS.session]: guestWithPending(EMAIL.unverified),
    });
    await expect(alertsIn(page)).toHaveText(copy.auth.verify.unavailable);
    await expect(mainOf(page)).not.toContainText(copy.auth.verify.verified);
    expect(page.url()).not.toContain(CONTEXT_VALUE);
    await writeStorage(
      page,
      KEYS.scenario,
      authScenario({ verify: "ok" })[KEYS.scenario] as string,
    );
    await mainOf(page).getByRole("button", { name: copy.auth.verify.retry, exact: true }).click();
    await expect(statusesIn(page)).toHaveText(copy.auth.verify.verified);
    await expect(alertsIn(page)).toHaveCount(0);
  });
});
