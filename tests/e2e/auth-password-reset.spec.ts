import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  alertsIn,
  authScenario,
  CONTEXT_VALUE,
  dumpStorage,
  field,
  focused,
  heading1,
  linkIn,
  mainOf,
  readSessionRaw,
  SENTINEL_PASSWORD,
  statusesIn,
  submitButton,
  urlOf,
} from "../harness/browser/auth.ts";
import { gotoHydrated } from "../harness/browser/hydration.ts";
import { fixClock } from "../harness/browser/public.ts";
import { seedLocalStorage } from "../harness/browser/shell.ts";
import { EMAIL } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s6-auth.md sections 6.4, 6.5.
// SPEC-050 15.4 / 15.5, SPEC-140 SEC-API-027 / SEC-AUTH-016 / 018.

async function open(page: Page, path: string, entries: Record<string, string> = {}) {
  await fixClock(page);
  await seedLocalStorage(page, entries);
  await gotoHydrated(page, path);
}

test.describe("TC-PG-AUTH-004-301 Password Reset Request answers every email alike (SPEC-050 15.4, SEC-API-027)", () => {
  test("a registered and an unregistered email get the identical acceptance text and change no session", async ({
    page,
  }) => {
    await open(page, "/account/password-reset");
    await expect(heading1(page)).toHaveText(copy.auth.reset.heading);
    const before = await readSessionRaw(page);
    const texts: string[] = [];
    for (const email of [EMAIL.demo, "nobody@example.com"]) {
      await field(page, copy.auth.field.email.label).fill(email);
      await submitButton(page, copy.auth.reset.submit).click();
      await expect(statusesIn(page)).toHaveCount(1);
      await expect(statusesIn(page)).toHaveText(copy.auth.reset.accepted);
      texts.push((await statusesIn(page).textContent()) ?? "");
      await expect(alertsIn(page)).toHaveCount(0);
    }
    expect(texts[0]).toBe(texts[1]);
    expect(await readSessionRaw(page)).toBe(before);
    await expect(mainOf(page)).not.toContainText(/登録されていません|存在しません/);
  });

  test("a service outage says the reset was not completed and does not show the acceptance", async ({
    page,
  }) => {
    await open(page, "/account/password-reset", authScenario({ reset: "unavailable" }));
    await field(page, copy.auth.field.email.label).fill(EMAIL.demo);
    await submitButton(page, copy.auth.reset.submit).click();
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toHaveText(copy.auth.reset.unavailable);
    await expect(statusesIn(page)).toHaveCount(0);
    await expect(mainOf(page)).not.toContainText(copy.auth.reset.accepted);
  });

  test("an empty or malformed email is refused in the form (summary, focus, aria-invalid)", async ({
    page,
  }) => {
    await open(page, "/account/password-reset", authScenario({ reset: "unavailable" }));
    await submitButton(page, copy.auth.reset.submit).click();
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(
      alertsIn(page).getByRole("link", { name: copy.auth.field.email.required }),
    ).toBeVisible();
    expect((await focused(page)).role).toBe("alert");
    await expect(field(page, copy.auth.field.email.label)).toHaveAttribute("aria-invalid", "true");
    await field(page, copy.auth.field.email.label).fill("nope");
    await submitButton(page, copy.auth.reset.submit).click();
    await expect(alertsIn(page)).toContainText(copy.auth.field.email.invalidFormat);
    // The port was not called in either case.
    await expect(mainOf(page)).not.toContainText(copy.auth.reset.unavailable);
  });

  test("links back to Login keeping the destination", async ({ page }) => {
    await open(page, "/account/password-reset?continue=cart");
    const href = await linkIn(page, copy.auth.reset.backToLogin).getAttribute("href");
    expect(new URL(href ?? "", "http://x").pathname).toBe("/account/login");
    expect(new URL(href ?? "", "http://x").searchParams.get("continue")).toBe("cart");
  });
});

test.describe("TC-PG-AUTH-005-301 Password Reset Completion needs a reset context (SPEC-050 15.5, AR-AUTH-006)", () => {
  test("without a context there is no password form, only the invalid state and a way to ask again", async ({
    page,
  }) => {
    await open(page, "/account/password-reset/complete");
    await expect(heading1(page)).toHaveText(copy.auth.resetComplete.heading);
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toHaveText(copy.auth.resetComplete.invalid);
    await expect(mainOf(page).locator('input[type="password"]')).toHaveCount(0);
    expect(await linkIn(page, copy.auth.resetComplete.requestAgain).getAttribute("href")).toBe(
      "/account/password-reset",
    );
  });

  test("with a context the form is shown and the context leaves the URL at once", async ({
    page,
  }) => {
    await open(page, `/account/password-reset/complete?context=${CONTEXT_VALUE}`);
    await expect(field(page, copy.auth.field.newPassword.label)).toBeVisible();
    await expect(field(page, copy.auth.field.newPasswordConfirm.label)).toBeVisible();
    await expect(alertsIn(page)).toHaveCount(0);
    expect(urlOf(page).searchParams.has("context")).toBe(false);
    expect(page.url()).not.toContain(CONTEXT_VALUE);
    await expect(mainOf(page)).not.toContainText(CONTEXT_VALUE);
    expect(await dumpStorage(page)).not.toContain(CONTEXT_VALUE);
  });

  test("the new password follows the 12-128 rule and the confirmation must match; nothing is sent when invalid", async ({
    page,
  }) => {
    await open(
      page,
      `/account/password-reset/complete?context=${CONTEXT_VALUE}`,
      authScenario({ reset: "unavailable" }),
    );
    const newPassword = field(page, copy.auth.field.newPassword.label);
    const confirm = field(page, copy.auth.field.newPasswordConfirm.label);
    await newPassword.fill("a".repeat(11));
    await confirm.fill("a".repeat(11));
    await submitButton(page, copy.auth.resetComplete.submit).click();
    await expect(
      alertsIn(page).getByRole("link", { name: copy.auth.field.password.tooShort }),
    ).toBeVisible();
    await expect(newPassword).toHaveAttribute("aria-invalid", "true");
    expect((await focused(page)).role).toBe("alert");
    await expect(mainOf(page)).not.toContainText(copy.auth.resetComplete.unavailable);

    await newPassword.fill("a".repeat(12));
    await confirm.fill("b".repeat(12));
    await submitButton(page, copy.auth.resetComplete.submit).click();
    await expect(
      alertsIn(page).getByRole("link", { name: copy.auth.field.passwordConfirm.mismatch }),
    ).toBeVisible();
    await expect(confirm).toHaveAttribute("aria-invalid", "true");
    await expect(mainOf(page)).not.toContainText(copy.auth.resetComplete.unavailable);

    await newPassword.fill("a".repeat(129));
    await confirm.fill("a".repeat(129));
    await submitButton(page, copy.auth.resetComplete.submit).click();
    await expect(alertsIn(page)).toContainText(copy.auth.field.password.tooLong);
    await expect(newPassword).not.toHaveAttribute("maxlength");
  });

  test("success goes to Login with the notice, does not sign in, and leaks nothing", async ({
    page,
  }) => {
    await open(page, `/account/password-reset/complete?context=${CONTEXT_VALUE}`);
    const before = await readSessionRaw(page);
    await field(page, copy.auth.field.newPassword.label).fill(SENTINEL_PASSWORD);
    await field(page, copy.auth.field.newPasswordConfirm.label).fill(SENTINEL_PASSWORD);
    await submitButton(page, copy.auth.resetComplete.submit).click();
    await expect(page).toHaveURL(/\/account\/login\?notice=password-updated$/);
    await expect(heading1(page)).toHaveText(copy.auth.login.heading);
    await expect(statusesIn(page)).toHaveText(copy.auth.login.passwordUpdated);
    expect(await readSessionRaw(page)).toBe(before);
    expect(await dumpStorage(page)).not.toContain(SENTINEL_PASSWORD);
    expect(await dumpStorage(page)).not.toContain(CONTEXT_VALUE);
    expect(page.url()).not.toContain(SENTINEL_PASSWORD);
    await expect(mainOf(page)).not.toContainText(SENTINEL_PASSWORD);
  });

  test("an invalid or expired context replaces the form with the invalid state", async ({
    page,
  }) => {
    await open(
      page,
      `/account/password-reset/complete?context=${CONTEXT_VALUE}`,
      authScenario({ resetContext: "invalid" }),
    );
    await field(page, copy.auth.field.newPassword.label).fill(SENTINEL_PASSWORD);
    await field(page, copy.auth.field.newPasswordConfirm.label).fill(SENTINEL_PASSWORD);
    await submitButton(page, copy.auth.resetComplete.submit).click();
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toHaveText(copy.auth.resetComplete.invalid);
    await expect(mainOf(page).locator('input[type="password"]')).toHaveCount(0);
    await expect(linkIn(page, copy.auth.resetComplete.requestAgain)).toBeVisible();
    await expect(page).toHaveURL(/\/account\/password-reset\/complete$/);
    expect(await dumpStorage(page)).not.toContain(SENTINEL_PASSWORD);
  });

  test("a service outage keeps the form so the user can retry, and stays on the page", async ({
    page,
  }) => {
    await open(
      page,
      `/account/password-reset/complete?context=${CONTEXT_VALUE}`,
      authScenario({ reset: "unavailable" }),
    );
    await field(page, copy.auth.field.newPassword.label).fill(SENTINEL_PASSWORD);
    await field(page, copy.auth.field.newPasswordConfirm.label).fill(SENTINEL_PASSWORD);
    await submitButton(page, copy.auth.resetComplete.submit).click();
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toHaveText(copy.auth.resetComplete.unavailable);
    await expect(field(page, copy.auth.field.newPassword.label)).toBeVisible();
    await expect(page).toHaveURL(/\/account\/password-reset\/complete$/);
    await expect(page.locator("main")).not.toContainText(copy.auth.login.passwordUpdated);
  });
});
