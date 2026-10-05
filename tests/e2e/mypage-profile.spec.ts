import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { readDbRaw, writeStorage } from "../harness/browser/cart.ts";
import { gotoHydrated } from "../harness/browser/hydration.ts";
import {
  DEMO_NAME,
  describedBy,
  mainButton,
  mainLink,
  OTHER_NAME,
  otherSession,
  PATH,
  region,
  retryButtons,
} from "../harness/browser/mypage.ts";
import { seedState } from "../harness/browser/public.ts";
import { alertsOf, heading1, mainOf, openAs, readState } from "../harness/browser/purchase.ts";
import { KEYS } from "../harness/browser/shell.ts";
import { EMAIL } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s8-mypage.md section 4.4.
// SPEC-050 18.2 (PG-MYP-002), 25, 31 items 14 / 22, UCR-100-001, SEC-AUTH-018. Expected DB postconditions are the mock DB.

const profile = () => copy.mypage.profile;
const nameField = (page: Page) =>
  mainOf(page).getByLabel(profile().displayNameLabel, { exact: true });
const saveButton = (page: Page) => mainButton(page, profile().save);
const statusOf = (page: Page) => mainOf(page).locator('[role="status"]');
const nameOf = async (page: Page, email: string): Promise<string | undefined> =>
  (await readState(page)).users.find((u) => u.email === email)?.displayName;

test.describe("TC-PG-MYP-002-701 the Profile shows the account email as text and one editable field (SPEC-050 18.2)", () => {
  test("has the title, one h1, the email as plain text, the display name in the only input and the Password pointer", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    await expect(heading1(page)).toHaveText(profile().heading);
    await expect(heading1(page)).toHaveCount(1);
    await expect(page).toHaveTitle(new RegExp(`^${profile().pageTitle} \\|`));
    await expect(nameField(page)).toHaveValue(DEMO_NAME);
    await expect(mainOf(page)).toContainText(profile().emailLabel);
    await expect(mainOf(page)).toContainText(EMAIL.demo);
    await expect(mainOf(page)).toContainText(profile().emailNote);
    // The email is not an input; nothing else can be edited or addressed (no ref, no owner selection).
    await expect(mainOf(page).getByRole("textbox")).toHaveCount(1);
    await expect(mainOf(page).locator("input, textarea, select")).toHaveCount(1);
    await expect(mainOf(page).locator('input[type="hidden"]')).toHaveCount(0);
    await expect(saveButton(page)).toBeEnabled();
    await expect(mainOf(page)).toContainText(profile().passwordNote);
    await expect(mainLink(page, profile().passwordReset)).toHaveAttribute(
      "href",
      "/account/password-reset",
    );
    // Nothing is claimed about an update that has not happened.
    await expect(statusOf(page)).toHaveText("");
    await expect(alertsOf(page)).toHaveCount(0);
    expect(await mainOf(page).innerText()).not.toContain(profile().status.saved);
  });
});

test.describe("TC-PG-MYP-002-702 saving the display name changes only this user's Profile and survives a reload (SPEC-050 18.2, 22)", () => {
  test("marks the change as unsaved, saves it, reports it and keeps it after a reload; other users are unchanged", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    await expect(nameField(page)).toHaveValue(DEMO_NAME);
    await nameField(page).fill("新しい表示名");
    await expect(statusOf(page)).toHaveText(profile().status.dirty);
    await saveButton(page).click();
    await expect(statusOf(page)).toHaveText(profile().status.saved);
    await expect(alertsOf(page)).toHaveCount(0);
    await expect(nameField(page)).toHaveValue("新しい表示名");

    expect(await nameOf(page, EMAIL.demo)).toBe("新しい表示名");
    expect(await nameOf(page, EMAIL.other)).toBe(OTHER_NAME);
    expect(await nameOf(page, EMAIL.fresh)).toBe(
      seedState().users.find((u) => u.email === EMAIL.fresh)?.displayName,
    );

    await gotoHydrated(page, PATH.profile);
    await expect(nameField(page)).toHaveValue("新しい表示名");
    await expect(statusOf(page)).toHaveText("");
    await gotoHydrated(page, PATH.overview);
    await expect(region(page, copy.mypage.overview.profileHeading)).toContainText("新しい表示名");
  });

  test("after saving, a further edit is unsaved again and an unchanged value is not", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    await nameField(page).fill("一度目");
    await saveButton(page).click();
    await expect(statusOf(page)).toHaveText(profile().status.saved);
    await nameField(page).fill("二度目");
    await expect(statusOf(page)).toHaveText(profile().status.dirty);
    await nameField(page).fill("一度目");
    await expect(statusOf(page)).not.toHaveText(profile().status.dirty);
  });

  test("the saved name belongs to the signed-in user: another user edits their own Profile only", async ({
    page,
  }) => {
    await openAs(page, PATH.profile, { session: otherSession() });
    await expect(nameField(page)).toHaveValue(OTHER_NAME);
    await expect(mainOf(page)).not.toContainText(DEMO_NAME);
    await expect(mainOf(page)).not.toContainText(EMAIL.demo);
    await expect(mainOf(page)).toContainText(EMAIL.other);
    await nameField(page).fill("別の名前");
    await saveButton(page).click();
    await expect(statusOf(page)).toHaveText(profile().status.saved);
    expect(await nameOf(page, EMAIL.other)).toBe("別の名前");
    expect(await nameOf(page, EMAIL.demo)).toBe(DEMO_NAME);
  });
});

test.describe("TC-PG-MYP-002-703 a rejected name is reported by an error summary that takes focus and is tied to the field (E2E 22, SPEC-050 25)", () => {
  test("a blank name: alert with focus, aria-invalid, description, a link to the field, and no DB change", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    const before = await readDbRaw(page);
    await nameField(page).fill("   ");
    await saveButton(page).click();
    await expect(alertsOf(page)).toHaveCount(1);
    await expect(alertsOf(page)).toContainText(profile().error.required);
    await expect(alertsOf(page)).toBeFocused();
    await expect(nameField(page)).toHaveAttribute("aria-invalid", "true");
    expect(await describedBy(nameField(page))).toContain(profile().error.required);
    await expect(statusOf(page)).not.toContainText(profile().status.saved);
    expect(await readDbRaw(page)).toBe(before);
    expect(await nameOf(page, EMAIL.demo)).toBe(DEMO_NAME);

    // The summary leads to the field.
    await alertsOf(page).getByRole("link").click();
    await expect(nameField(page)).toBeFocused();

    // Correcting the name clears the error and saves.
    await nameField(page).fill("直した名前");
    await saveButton(page).click();
    await expect(statusOf(page)).toHaveText(profile().status.saved);
    await expect(alertsOf(page)).toHaveCount(0);
    await expect(nameField(page)).not.toHaveAttribute("aria-invalid", "true");
    expect(await nameOf(page, EMAIL.demo)).toBe("直した名前");
  });

  test("an empty field is rejected the same way (the server decides what a blank name is)", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    await nameField(page).fill("");
    await saveButton(page).click();
    await expect(alertsOf(page)).toContainText(profile().error.required);
    expect(await nameOf(page, EMAIL.demo)).toBe(DEMO_NAME);
  });
});

test.describe("TC-PG-MYP-002-704 a failed read or a failed save is its own state and never falls back to another Profile (SPEC-050 18.2 Failure, 9.3, 21)", () => {
  test("when the Profile cannot be read, an unavailable alert with a retry appears and no form or other Profile is shown", async ({
    page,
  }) => {
    await openAs(page, PATH.profile, { extra: { [KEYS.db]: "{ not json" } });
    await expect(heading1(page)).toHaveText(profile().heading);
    await expect(alertsOf(page)).toHaveCount(1);
    await expect(alertsOf(page)).toContainText(copy.pageState.unavailable(profile().subject));
    await expect(mainOf(page).locator("input, textarea, select")).toHaveCount(0);
    await expect(mainOf(page)).not.toContainText(DEMO_NAME);
    await expect(mainOf(page)).not.toContainText(OTHER_NAME);
    await expect(mainOf(page)).not.toContainText(copy.accessDenied.title);
    await writeStorage(page, KEYS.db, JSON.stringify(seedState()));
    await retryButtons(mainOf(page)).click();
    await expect(nameField(page)).toHaveValue(DEMO_NAME);
    await expect(alertsOf(page)).toHaveCount(0);
  });

  test("when saving fails, the typed value stays, the failure is shown (not as saved), and a later save works", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    const good = await readDbRaw(page);
    expect(good).not.toBeNull();
    await nameField(page).fill("保存したい名前");
    await writeStorage(page, KEYS.db, "{ not json");
    await saveButton(page).click();
    await expect(alertsOf(page)).toHaveCount(1);
    await expect(alertsOf(page)).toContainText(profile().error.unavailable);
    await expect(nameField(page)).toHaveValue("保存したい名前");
    await expect(statusOf(page)).not.toContainText(profile().status.saved);
    await expect(nameField(page)).not.toHaveAttribute("aria-invalid", "true");

    await writeStorage(page, KEYS.db, good ?? "");
    await saveButton(page).click();
    await expect(statusOf(page)).toHaveText(profile().status.saved);
    await expect(alertsOf(page)).toHaveCount(0);
    expect(await nameOf(page, EMAIL.demo)).toBe("保存したい名前");
  });

  test("while the Profile is loading, only the loading state is shown (no name, no form)", async ({
    page,
  }) => {
    await openAs(page, PATH.profile, { scenario: { latency: "long", latencyLongMs: 2500 } });
    await expect(heading1(page)).toHaveText(profile().heading);
    await expect(mainOf(page).locator('[role="status"]').first()).toContainText(
      copy.pageState.loading,
    );
    await expect(mainOf(page)).not.toContainText(DEMO_NAME);
    await expect(mainOf(page).locator("input")).toHaveCount(0);
    await expect(nameField(page)).toHaveValue(DEMO_NAME, { timeout: 15_000 });
  });
});

test.describe("TC-PG-MYP-002-705 the Profile route takes no reference and shows only the signed-in user's Profile (SPEC-050 18.2 Failure, 17.1)", () => {
  test("a query that names another user changes nothing: the Profile is still the signed-in user's", async ({
    page,
  }) => {
    await openAs(page, `${PATH.profile}?email=${EMAIL.other}&user=${EMAIL.other}`);
    await expect(nameField(page)).toHaveValue(DEMO_NAME);
    await expect(mainOf(page)).toContainText(EMAIL.demo);
    await expect(mainOf(page)).not.toContainText(EMAIL.other);
  });
});
