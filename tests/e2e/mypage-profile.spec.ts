import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { readDbRaw, writeStorage } from "../harness/browser/cart.ts";
import { gotoHydrated, reloadHydrated } from "../harness/browser/hydration.ts";
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
import {
  alertsOf,
  heading1,
  mainOf,
  openAs,
  readState,
  setScenario,
} from "../harness/browser/purchase.ts";
import { KEYS } from "../harness/browser/shell.ts";
import { combining, emojis } from "../harness/display-name.ts";
import { EMAIL } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s8-mypage.md section 4.4.
// SPEC-050 18.2 (PG-MYP-002), 25, 31 items 14 / 22, SPEC-030 9.2 / API-AUTH-004, SEC-AUTH-018. Expected DB postconditions are the mock DB.

const profile = () => copy.mypage.profile;
const nameField = (page: Page) =>
  mainOf(page).getByLabel(profile().displayNameLabel, { exact: true });
const saveButton = (page: Page) => mainButton(page, profile().save);
const statusOf = (page: Page) => mainOf(page).locator('[role="status"]');
/** The stored display name of a user: null = unset, undefined = no such user. */
const nameOf = async (page: Page, email: string): Promise<string | null | undefined> =>
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

  test("shows 未設定 as the placeholder and the optional / 80 code points hint as the field description, without a maxlength", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    await expect(nameField(page)).toHaveValue(DEMO_NAME);
    await expect(nameField(page)).toHaveAttribute("placeholder", "未設定");
    await expect(nameField(page)).toHaveAttribute("placeholder", profile().unset);
    expect(await describedBy(nameField(page))).toContain(profile().displayNameHint);
    await expect(mainOf(page)).toContainText(profile().displayNameHint);
    // maxlength counts UTF-16 code units and would reject 80 emoji (SPEC-030 9.2 counts code points).
    expect(await nameField(page).getAttribute("maxlength")).toBeNull();
    // No error is claimed before anything is submitted.
    await expect(nameField(page)).not.toHaveAttribute("aria-invalid", "true");
    expect(await describedBy(nameField(page))).not.toContain(profile().error.tooLong);
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

  test("while saving, the input stays editable and the button is busy; a value typed meanwhile survives the successful save (dirty), and the DB holds the submitted value", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    await expect(nameField(page)).toHaveValue(DEMO_NAME);
    await setScenario(page, { latency: "long", latencyLongMs: 2500 });
    await nameField(page).fill("提出した名前");
    await saveButton(page).click();
    await expect(saveButton(page)).toBeDisabled();
    await expect(saveButton(page)).toHaveAttribute("aria-busy", "true");
    await expect(statusOf(page)).toHaveText(profile().status.saving);
    // The field is never locked while saving.
    await expect(nameField(page)).toBeEnabled();
    await expect(nameField(page)).toBeEditable();
    await nameField(page).fill("保存中に打った名前");
    await expect(saveButton(page)).toBeEnabled({ timeout: 15_000 });
    await expect(nameField(page)).toHaveValue("保存中に打った名前");
    await expect(statusOf(page)).toHaveText(profile().status.dirty);
    await expect(alertsOf(page)).toHaveCount(0);
    expect(await nameOf(page, EMAIL.demo)).toBe("提出した名前");
    // The newer value is then saved by the next press.
    await setScenario(page, { latency: "none" });
    await saveButton(page).click();
    await expect(statusOf(page)).toHaveText(profile().status.saved);
    await expect(nameField(page)).toHaveValue("保存中に打った名前");
    expect(await nameOf(page, EMAIL.demo)).toBe("保存中に打った名前");
  });

  test("without a further edit, the input takes the value the server confirmed and the status is saved", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    await setScenario(page, { latency: "long", latencyLongMs: 2500 });
    await nameField(page).fill("編集しない名前");
    await saveButton(page).click();
    await expect(saveButton(page)).toBeDisabled();
    await expect(saveButton(page)).toHaveAttribute("aria-busy", "true");
    await expect(saveButton(page)).toBeEnabled({ timeout: 15_000 });
    await expect(nameField(page)).toHaveValue("編集しない名前");
    await expect(statusOf(page)).toHaveText(profile().status.saved);
    await expect(alertsOf(page)).toHaveCount(0);
    expect(await nameOf(page, EMAIL.demo)).toBe("編集しない名前");
  });

  test("editing while saving and typing the submitted value again before the save completes ends as saved", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    await setScenario(page, { latency: "long", latencyLongMs: 2500 });
    await nameField(page).fill("戻す名前");
    await saveButton(page).click();
    await expect(saveButton(page)).toBeDisabled();
    await nameField(page).fill("途中で変えた名前");
    await expect(nameField(page)).toHaveValue("途中で変えた名前");
    await nameField(page).fill("戻す名前");
    await expect(saveButton(page)).toBeEnabled({ timeout: 15_000 });
    await expect(nameField(page)).toHaveValue("戻す名前");
    await expect(statusOf(page)).toHaveText(profile().status.saved);
    expect(await nameOf(page, EMAIL.demo)).toBe("戻す名前");
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

test.describe("TC-PG-MYP-002-703 a rejected name is reported by an error summary that takes focus and is tied to the field (E2E 22, SPEC-050 25, SPEC-030 9.2)", () => {
  test("an 81-character name: alert with focus, aria-invalid, description, a link to the field, and no DB change", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    const before = await readDbRaw(page);
    await nameField(page).fill("あ".repeat(81));
    await saveButton(page).click();
    await expect(alertsOf(page)).toHaveCount(1);
    await expect(alertsOf(page)).toContainText(profile().error.tooLong);
    await expect(alertsOf(page)).not.toContainText(profile().error.controlCharacter);
    await expect(alertsOf(page)).toBeFocused();
    await expect(nameField(page)).toHaveAttribute("aria-invalid", "true");
    const described = await describedBy(nameField(page));
    expect(described).toContain(profile().error.tooLong);
    expect(described).toContain(profile().displayNameHint);
    await expect(statusOf(page)).not.toContainText(profile().status.saved);
    await expect(statusOf(page)).not.toContainText(profile().status.cleared);
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

  test("a name with a control character inside: the control-character message, the field is tied to it, and no DB change", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    const before = await readDbRaw(page);
    await nameField(page).fill("名\u0009前");
    await saveButton(page).click();
    await expect(alertsOf(page)).toHaveCount(1);
    await expect(alertsOf(page)).toContainText(profile().error.controlCharacter);
    await expect(alertsOf(page)).not.toContainText(profile().error.tooLong);
    await expect(alertsOf(page)).toBeFocused();
    await expect(nameField(page)).toHaveAttribute("aria-invalid", "true");
    expect(await describedBy(nameField(page))).toContain(profile().error.controlCharacter);
    await expect(statusOf(page)).not.toContainText(profile().status.saved);
    expect(await readDbRaw(page)).toBe(before);
    expect(await nameOf(page, EMAIL.demo)).toBe(DEMO_NAME);

    // Editing the field takes the error away; the corrected name is saved.
    await nameField(page).fill("名前");
    await expect(alertsOf(page)).toHaveCount(0);
    await expect(nameField(page)).not.toHaveAttribute("aria-invalid", "true");
    await saveButton(page).click();
    await expect(statusOf(page)).toHaveText(profile().status.saved);
    expect(await nameOf(page, EMAIL.demo)).toBe("名前");
  });

  test("a blank field is not an error: it is saved as unset (the UI does not require a name)", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    await nameField(page).fill("");
    await saveButton(page).click();
    await expect(statusOf(page)).toHaveText(profile().status.cleared);
    await expect(alertsOf(page)).toHaveCount(0);
    await expect(nameField(page)).not.toHaveAttribute("aria-invalid", "true");
    expect(await nameOf(page, EMAIL.demo)).toBeNull();
  });
});

test.describe("TC-PG-MYP-002-706 an empty or blank name is saved as unset and shown as 未設定, never as the email (SPEC-050 18.2 / 18.1, SPEC-030 9.2)", () => {
  test("saving an empty field: cleared status, no alert, DB null, empty input with the placeholder, survives a reload; Overview shows 未設定", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    await nameField(page).fill("");
    await expect(statusOf(page)).toHaveText(profile().status.dirty);
    await saveButton(page).click();
    await expect(statusOf(page)).toHaveText(profile().status.cleared);
    await expect(alertsOf(page)).toHaveCount(0);
    await expect(nameField(page)).toHaveValue("");
    await expect(nameField(page)).toHaveAttribute("placeholder", profile().unset);
    expect(await nameOf(page, EMAIL.demo)).toBeNull();
    expect(await nameOf(page, EMAIL.other)).toBe(OTHER_NAME);
    expect(await nameOf(page, EMAIL.fresh)).toBe(
      seedState().users.find((u) => u.email === EMAIL.fresh)?.displayName,
    );

    await reloadHydrated(page);
    await expect(nameField(page)).toHaveValue("");
    await expect(nameField(page)).toHaveAttribute("placeholder", "未設定");
    await expect(statusOf(page)).toHaveText("");
    // The email stays the Account email; it is never put into the name field.
    await expect(mainOf(page)).toContainText(EMAIL.demo);

    await gotoHydrated(page, PATH.overview);
    const account = region(page, copy.mypage.overview.profileHeading);
    await expect(
      account.locator("p").filter({ hasText: copy.mypage.overview.displayNameLabel }),
    ).toHaveText(`${copy.mypage.overview.displayNameLabel} 未設定`);
    await expect(account).toContainText(EMAIL.demo);
    await expect(account).not.toContainText(DEMO_NAME);
    expect(await nameOf(page, EMAIL.demo)).toBeNull();
  });

  test("saving only blank characters (an ideographic space and a space) is the same: unset", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    await nameField(page).fill("　 ");
    await saveButton(page).click();
    await expect(statusOf(page)).toHaveText(profile().status.cleared);
    await expect(alertsOf(page)).toHaveCount(0);
    await expect(nameField(page)).toHaveValue("");
    expect(await nameOf(page, EMAIL.demo)).toBeNull();
    expect(await nameOf(page, EMAIL.other)).toBe(OTHER_NAME);
  });

  test("a name can be set again after it was cleared, and the saved status is not the cleared one", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    await nameField(page).fill("");
    await saveButton(page).click();
    await expect(statusOf(page)).toHaveText(profile().status.cleared);
    await nameField(page).fill("戻した名前");
    await expect(statusOf(page)).toHaveText(profile().status.dirty);
    await saveButton(page).click();
    await expect(statusOf(page)).toHaveText(profile().status.saved);
    expect(await nameOf(page, EMAIL.demo)).toBe("戻した名前");
  });
});

test.describe("TC-PG-MYP-002-707 the name is trimmed by the server and the 80 limit is counted in code points (SPEC-050 18.2, SPEC-030 9.2)", () => {
  test("a name with surrounding spaces is stored trimmed and the input takes the stored value", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    await nameField(page).fill("  名前  ");
    await saveButton(page).click();
    await expect(statusOf(page)).toHaveText(profile().status.saved);
    await expect(alertsOf(page)).toHaveCount(0);
    await expect(nameField(page)).toHaveValue("名前");
    expect(await nameOf(page, EMAIL.demo)).toBe("名前");
  });

  test("80 emoji (160 UTF-16 code units) are saved and 81 are rejected with the too-long message, leaving the DB unchanged", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    await nameField(page).fill(emojis(80));
    await saveButton(page).click();
    await expect(statusOf(page)).toHaveText(profile().status.saved);
    await expect(alertsOf(page)).toHaveCount(0);
    expect(await nameOf(page, EMAIL.demo)).toBe(emojis(80));

    const before = await readDbRaw(page);
    await nameField(page).fill(emojis(81));
    await saveButton(page).click();
    await expect(alertsOf(page)).toHaveCount(1);
    await expect(alertsOf(page)).toContainText(profile().error.tooLong);
    await expect(nameField(page)).toHaveAttribute("aria-invalid", "true");
    expect(await readDbRaw(page)).toBe(before);
    expect(await nameOf(page, EMAIL.demo)).toBe(emojis(80));
  });

  test("a name of 80 code points built with combining marks is saved and one more code point is rejected", async ({
    page,
  }) => {
    await openAs(page, PATH.profile);
    await nameField(page).fill(combining(80));
    await saveButton(page).click();
    await expect(statusOf(page)).toHaveText(profile().status.saved);
    expect(await nameOf(page, EMAIL.demo)).toBe(combining(80));

    await nameField(page).fill(`${combining(80)}か`);
    await saveButton(page).click();
    await expect(alertsOf(page)).toContainText(profile().error.tooLong);
    expect(await nameOf(page, EMAIL.demo)).toBe(combining(80));
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
