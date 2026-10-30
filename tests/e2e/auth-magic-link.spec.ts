import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  type AuthPageName,
  alertsIn,
  authScenario,
  cartEntriesWithExternal,
  chooseMethod,
  describedText,
  dumpStorage,
  field,
  formOf,
  headerLogin,
  heading1,
  loginWith,
  logoutViaMenu,
  MARKER_PROTECTED_TEXT,
  MOCK_MAGIC_LINK_PATH,
  magicFailurePath,
  magicRadio,
  magicResendButton,
  magicReturnPath,
  magicSendButton,
  mainOf,
  mockMagicLinkUrl,
  openAuthPage,
  openMockMagicLink,
  openValidLink,
  readCartLifecycle,
  readSession,
  readUsers,
  sendMagicLink,
  sessionEntry,
  setAuthScenario,
  standInEmailField,
  standInLinkButton,
  statusesIn,
  submitButton,
  unverifiedSession,
  urlOf,
  watchConsole,
  watchDocumentRequests,
} from "../harness/browser/auth.ts";
import {
  addButton,
  cartEntries,
  entryLine,
  goodsLine,
  headerCartLink,
  offeringName,
  openSecondTab,
  quantityInput,
  readCartRaw,
} from "../harness/browser/cart.ts";
import { gotoHydrated, reloadHydrated } from "../harness/browser/hydration.ts";
import { fixClock } from "../harness/browser/public.ts";
import {
  allHrefs,
  KEYS,
  ORIGIN_HOST,
  seedLocalStorage,
  watchRequestHosts,
  watchRuntimeErrors,
} from "../harness/browser/shell.ts";
import { EMAIL, GOODS, OFFERING } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s6-auth.md sections 5B, 6.1D, 6.2C, 6.10, 7,
// 10A and tests/contracts/s2-mock-backend.md section 14.3. SPEC-050 15.0 / 15.1 / 15.3, SPEC-020 FR-CRT-012 (the
// external-completion rule), SPEC-060 AR-CONT-001 / AR-AUTH-004, SPEC-140 SEC-API-027 / SEC-AUTH-018 / SEC-WEB-013.
// Magic Link is the second external-completion method. Unlike Google the user does not leave the page to authenticate:
// the page only sends the link and shows the sent state. The link is opened later - in this Tab, in another Tab or on
// another device - and the screen that navigation shows (PG-AUTH-003 / PG-AUTH-001 with `returned=magic-link`) receives
// the result. The mock's stand-in screen (/dev/mock-magic-link) replaces the mailbox: the developer types the address of
// the link's owner and opens it as valid or expired.

const NEW_LINK_EMAIL = "magic.new@example.com";
const SENDER_EMAIL = "magic.sender@example.com";
const LINES = [entryLine(OFFERING.regular, 2), goodsLine(GOODS.tshirt, 1)];
const PAGES: readonly AuthPageName[] = ["login", "register"];
const pageHeading = (name: AuthPageName): string =>
  name === "login" ? copy.auth.login.heading : copy.auth.register.heading;

/** A document load of an auth page that is expected to navigate away on its own (no heading wait). */
async function openReturn(
  page: Page,
  path: string,
  entries: Record<string, string> = {},
): Promise<void> {
  await fixClock(page);
  await seedLocalStorage(page, entries);
  await gotoHydrated(page, path);
}

const lifecycleOf = async (page: Page) => await readCartLifecycle(page);

/** The seed's users (s2-mock-backend.md section 8.1). The mock DB key is written lazily, so a clean page has none. */
const SEED_EMAILS: readonly string[] = Object.values(EMAIL);
/** The emails of the mock DB's users: the stored ones, or the seed's while nothing has written the DB. */
const userEmails = async (page: Page): Promise<string[]> => {
  const users = await readUsers(page);
  return users === null ? [...SEED_EMAILS] : users.map((u) => u.email);
};

/** What a visitor can see of a sent state: the statuses, the alert count, every button name. */
async function sentSnapshot(page: Page) {
  return {
    statuses: await statusesIn(page).allInnerTexts(),
    alerts: await alertsIn(page).count(),
    buttons: await mainOf(page).getByRole("button").allInnerTexts(),
    fields: await mainOf(page).getByRole("textbox").count(),
  };
}

test.describe("TC-PG-AUTH-003-309 Magic Link on Login and Registration: the link is sent from the page, the sent state states the validity period and discloses no account, and the link opened later returns to the same screen (SPEC-050 15.0 / 15.1 / 15.3, SEC-API-027, FR-CRT-012)", () => {
  test("Login, send: one status that says the link is valid for 5 minutes, a re-send button instead of the send button, nothing navigates, and the Session, the Cart and the users are untouched but the pending record is written", async ({
    page,
  }) => {
    const runtime = watchRuntimeErrors(page);
    const seen = watchRequestHosts(page);
    await openAuthPage(page, "login", "?continue=cart", cartEntries(LINES, "guest"));
    const documents = watchDocumentRequests(page);
    const url = page.url();
    const cartBefore = await readCartRaw(page);
    const usersBefore = await readUsers(page);

    await chooseMethod(page, copy.auth.method.magicLink);
    await expect(magicRadio(page)).toBeChecked();
    // Before the send: the address field and the send button only. No status and no alert on a fresh page.
    await expect(field(page, copy.auth.field.email.label)).toBeVisible();
    await expect(field(page, copy.auth.field.password.label)).toHaveCount(0);
    await expect(submitButton(page, copy.auth.login.submit)).toHaveCount(0);
    await expect(magicSendButton(page)).toBeEnabled();
    await expect(magicResendButton(page)).toHaveCount(0);
    await expect(statusesIn(page)).toHaveCount(0);
    await expect(alertsIn(page)).toHaveCount(0);

    await field(page, copy.auth.field.email.label).fill(EMAIL.demo);
    await magicSendButton(page).click();
    await expect(statusesIn(page)).toHaveCount(1);
    await expect(statusesIn(page)).toHaveText(copy.auth.magicLink.sent);
    await expect(statusesIn(page)).toContainText("5分");
    await expect(alertsIn(page)).toHaveCount(0);
    await expect(magicResendButton(page)).toBeEnabled();
    await expect(magicSendButton(page)).toHaveCount(0);

    expect(page.url()).toBe(url);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    expect(await readCartRaw(page)).toBe(cartBefore);
    expect(await readUsers(page)).toEqual(usersBefore);
    // Starting is the authentication transition of an external-completion method (FR-CRT-012 steps 2 to 4): the Guest
    // Cart is kept, the pending record exists, and the page navigated nowhere.
    expect(await lifecycleOf(page)).toEqual({
      version: 1,
      provenance: "guest",
      external: "pending",
    });
    expect(documents.filter((entry) => entry.startsWith("/dev/"))).toEqual([]);
    await page.waitForLoadState("networkidle");
    expect(runtime.errors).toEqual([]);
    expect([...seen.hosts]).toEqual([ORIGIN_HOST]);
  });

  for (const name of PAGES) {
    test(`${name}: a registered, an unverified and an unregistered address get the identical sent state, which says nothing about whether the address is registered`, async ({
      page,
    }) => {
      const snapshots = [];
      for (const email of [EMAIL.demo, EMAIL.unverified, "nobody@example.com"]) {
        await openAuthPage(page, name);
        await sendMagicLink(page, email);
        snapshots.push(await sentSnapshot(page));
        await expect(mainOf(page)).not.toContainText(
          /登録されていません|存在しません|見つかりません/,
        );
        await expect(statusesIn(page)).not.toContainText(/登録|存在/);
        expect(await readSession(page)).toEqual({ kind: "guest" });
        await expect(heading1(page)).toHaveText(pageHeading(name));
      }
      expect(snapshots[1]).toEqual(snapshots[0]);
      expect(snapshots[2]).toEqual(snapshots[0]);
      expect(snapshots[0]?.statuses).toEqual([copy.auth.magicLink.sent]);
      // Sending for an address created nobody.
      expect(((await readUsers(page)) ?? []).some((u) => u.email === "nobody@example.com")).toBe(
        false,
      );
    });
  }

  test("Login, a valid link opened through the stand-in: the returned=magic-link document of Login, then Mypage as the link's owner; an existing account adds no user", async ({
    page,
  }) => {
    await openAuthPage(page, "login");
    await sendMagicLink(page, EMAIL.demo);
    const emailsBefore = await userEmails(page);
    const documents = watchDocumentRequests(page);

    await openValidLink(page, "login", EMAIL.demo);
    await expect(page).toHaveURL(/\/mypage$/);
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    await expect(mainOf(page)).toContainText(MARKER_PROTECTED_TEXT);
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: EMAIL.demo,
      emailVerified: true,
    });
    // The result came back as a document load of the Login page, and the marker left the URL.
    expect(documents).toContain(magicReturnPath("login"));
    expect(urlOf(page).search).toBe("");
    // An existing account adds nobody (the mock DB may stay unwritten, so compare against the seed).
    expect(await userEmails(page)).toEqual(emailsBefore);
    expect(emailsBefore).toHaveLength(SEED_EMAILS.length);
  });

  test("Login, a valid link for an address that is no account: one verified user with no display name is created and Mypage shows 未設定", async ({
    page,
  }) => {
    await openAuthPage(page, "login");
    await sendMagicLink(page, NEW_LINK_EMAIL);
    expect(await userEmails(page)).not.toContain(NEW_LINK_EMAIL);
    await openValidLink(page, "login", NEW_LINK_EMAIL);
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: NEW_LINK_EMAIL,
      emailVerified: true,
    });
    const users = (await readUsers(page)) ?? [];
    expect(users.filter((u) => u.email === NEW_LINK_EMAIL)).toEqual([
      { email: NEW_LINK_EMAIL, displayName: null, emailVerified: true },
    ]);
    expect(users).toHaveLength(SEED_EMAILS.length + 1);
    const account = mainOf(page).getByRole("region", {
      name: copy.mypage.overview.profileHeading,
      exact: true,
    });
    await expect(
      account.locator("p").filter({ hasText: copy.mypage.overview.displayNameLabel }),
    ).toHaveText(`${copy.mypage.overview.displayNameLabel} 未設定`);
  });

  test("Login, a valid link for the Email-unverified account: opening the link proves the mailbox, so the user and the Session become verified and nobody is added", async ({
    page,
  }) => {
    await openAuthPage(page, "login");
    await sendMagicLink(page, EMAIL.unverified);
    // The seed has this user unverified (s2-mock-backend.md section 8.1); the DB is written only by the link.
    expect(await userEmails(page)).toContain(EMAIL.unverified);
    await openValidLink(page, "login", EMAIL.unverified);
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: EMAIL.unverified,
      emailVerified: true,
    });
    const users = (await readUsers(page)) ?? [];
    expect(users).toHaveLength(SEED_EMAILS.length);
    expect(users.find((u) => u.email === EMAIL.unverified)?.emailVerified).toBe(true);
  });

  test("Login with continue=cart and a Guest Cart: a valid link arrives at /cart with the lines byte-identical, the authenticated provenance recorded and the pending record removed", async ({
    page,
  }) => {
    await openAuthPage(page, "login", "?continue=cart", cartEntries(LINES, "guest"));
    await expect(headerCartLink(page, 3)).toBeVisible();
    const cartBefore = await readCartRaw(page);
    await sendMagicLink(page, EMAIL.demo);
    expect(await lifecycleOf(page)).toEqual({
      version: 1,
      provenance: "guest",
      external: "pending",
    });
    const documents = watchDocumentRequests(page);

    await openValidLink(page, "login", EMAIL.demo, "cart");
    await expect(page).toHaveURL(/\/cart$/);
    await expect(heading1(page)).toHaveText(copy.cart.heading);
    await expect(mainOf(page).getByRole("listitem")).toHaveCount(2);
    await expect(headerCartLink(page, 3)).toBeVisible();
    expect(documents).toContain(magicReturnPath("login", "cart"));
    expect(await readCartRaw(page)).toBe(cartBefore);
    expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: EMAIL.demo,
      emailVerified: true,
    });
  });

  test("Registration: a valid link for an address that is no account registers it (Mypage, 未設定, one user added); a valid link for an existing account gives no 'already registered' answer and adds nobody", async ({
    page,
  }) => {
    await openAuthPage(page, "register");
    await sendMagicLink(page, NEW_LINK_EMAIL);
    await openValidLink(page, "register", NEW_LINK_EMAIL);
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: NEW_LINK_EMAIL,
      emailVerified: true,
    });
    const afterNew = (await readUsers(page)) ?? [];
    expect(afterNew.filter((u) => u.email === NEW_LINK_EMAIL)).toEqual([
      { email: NEW_LINK_EMAIL, displayName: null, emailVerified: true },
    ]);

    await openValidLink(page, "register", EMAIL.demo);
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: EMAIL.demo,
      emailVerified: true,
    });
    await expect(alertsIn(page)).toHaveCount(0);
    expect((await readUsers(page)) ?? []).toHaveLength(afterNew.length);
  });

  test("Registration with continue=cart and a Guest Cart: a valid link arrives at /cart with the lines kept", async ({
    page,
  }) => {
    await openAuthPage(page, "register", "?continue=cart", cartEntries(LINES, "guest"));
    const cartBefore = await readCartRaw(page);
    await sendMagicLink(page, NEW_LINK_EMAIL);
    await openValidLink(page, "register", NEW_LINK_EMAIL, "cart");
    await expect(page).toHaveURL(/\/cart$/);
    await expect(mainOf(page).getByRole("listitem")).toHaveCount(2);
    expect(await readCartRaw(page)).toBe(cartBefore);
    expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
  });

  for (const name of PAGES) {
    test(`${name}, an expired link: back on the same screen with exactly one failure alert, still Guest, nothing created, the Guest Cart and the pending record kept; the link can be sent again and another method can be chosen`, async ({
      page,
    }) => {
      await openAuthPage(page, name, "?continue=cart", cartEntries(LINES, "guest"));
      const cartBefore = await readCartRaw(page);
      await sendMagicLink(page, EMAIL.demo);
      const usersBefore = await readUsers(page);

      await openMockMagicLink(page, name, "cart");
      await standInEmailField(page).fill(EMAIL.demo);
      const documents = watchDocumentRequests(page);
      await standInLinkButton(page, "openExpired").click();
      await expect(page).toHaveURL(new RegExp(`/account/${name}\\?continue=cart`));
      await expect(heading1(page)).toHaveText(pageHeading(name));
      await expect(alertsIn(page)).toHaveCount(1);
      await expect(alertsIn(page)).toHaveText(copy.auth.magicLink.failed);
      expect(documents).toContain(magicFailurePath(name, "cart"));
      expect(urlOf(page).searchParams.has("returned")).toBe(false);
      expect(urlOf(page).searchParams.get("continue")).toBe("cart");
      expect(await readSession(page)).toEqual({ kind: "guest" });
      await expect(headerLogin(page)).toBeVisible();
      expect(await readUsers(page)).toEqual(usersBefore);
      expect(await readCartRaw(page)).toBe(cartBefore);
      await expect(headerCartLink(page, 3)).toBeVisible();
      // Not a result: the pending record of the send stays (FR-CRT-012 external-completion rule step 7).
      expect(await lifecycleOf(page)).toEqual({
        version: 1,
        provenance: "guest",
        external: "pending",
      });

      // Another method can be chosen again ...
      await chooseMethod(page, copy.auth.method.password);
      await expect(field(page, copy.auth.field.password.label)).toBeVisible();
      // ... and the link can be sent again (the send replaces the failure alert with the sent state).
      await chooseMethod(page, copy.auth.method.magicLink);
      await expect(magicSendButton(page)).toBeEnabled();
      await field(page, copy.auth.field.email.label).fill(EMAIL.demo);
      await magicSendButton(page).click();
      await expect(statusesIn(page)).toHaveText(copy.auth.magicLink.sent);
      await expect(alertsIn(page)).toHaveCount(0);
      expect((await lifecycleOf(page))?.external).toBe("pending");
    });
  }

  test("when the sign-in service is unavailable (auth.login) the send shows one alert and no status, stays on the page and can be tried again; the pending record is written before the request", async ({
    page,
  }) => {
    const documents = watchDocumentRequests(page);
    await openAuthPage(page, "login", "", authScenario({ login: "unavailable" }));
    await chooseMethod(page, copy.auth.method.magicLink);
    await field(page, copy.auth.field.email.label).fill(EMAIL.demo);
    await magicSendButton(page).click();
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toHaveText(copy.auth.magicLink.unavailable);
    await expect(statusesIn(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/account\/login$/);
    await expect(magicSendButton(page)).toBeEnabled();
    expect(documents.filter((entry) => entry.startsWith("/dev/"))).toEqual([]);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    // FR-CRT-012 external-completion rule steps 3 and 7: an outcome that is not a success never takes the record back.
    expect((await lifecycleOf(page))?.external).toBe("pending");

    await setAuthScenario(page, {});
    await magicSendButton(page).click();
    await expect(statusesIn(page)).toHaveText(copy.auth.magicLink.sent);
    await expect(alertsIn(page)).toHaveCount(0);
  });

  test("an empty or malformed address is refused before the port: one error summary naming the field, no status, and the Cart lifecycle is not touched", async ({
    page,
  }) => {
    await openAuthPage(page, "login");
    await chooseMethod(page, copy.auth.method.magicLink);
    const before = await lifecycleOf(page);

    await magicSendButton(page).click();
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toContainText(copy.auth.field.email.required);
    await expect(field(page, copy.auth.field.email.label)).toHaveAttribute("aria-invalid", "true");
    await expect(statusesIn(page)).toHaveCount(0);

    await field(page, copy.auth.field.email.label).fill("not-an-email");
    await magicSendButton(page).click();
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toContainText(copy.auth.field.email.invalidFormat);
    await expect(statusesIn(page)).toHaveCount(0);
    expect(await lifecycleOf(page)).toEqual(before);
    expect((await lifecycleOf(page))?.external).toBeUndefined();
    expect(await readSession(page)).toEqual({ kind: "guest" });

    await field(page, copy.auth.field.email.label).fill(EMAIL.demo);
    await magicSendButton(page).click();
    await expect(statusesIn(page)).toHaveText(copy.auth.magicLink.sent);
    await expect(alertsIn(page)).toHaveCount(0);
  });

  test("the send is one natively submitted form with browser validation off, and the send state sets aria-busy while it runs", async ({
    page,
  }) => {
    await openAuthPage(page, "login");
    await chooseMethod(page, copy.auth.method.magicLink);
    const form = formOf(magicSendButton(page));
    await expect(form).toHaveAttribute("novalidate", "");
    await expect(field(page, copy.auth.field.email.label)).toHaveAttribute("type", "email");
    await expect(field(page, copy.auth.field.email.label)).toHaveAttribute("autocomplete", "email");
    await expect(form).not.toHaveAttribute("aria-busy", "true");
  });

  test("Magic Link is a button, not a link: no /dev, /admin or /staff href, no external origin, no document request for the stand-in, on either page", async ({
    page,
  }) => {
    const seen = watchRequestHosts(page);
    for (const name of PAGES) {
      await openAuthPage(page, name, "?continue=cart");
      const documents = watchDocumentRequests(page);
      await chooseMethod(page, copy.auth.method.magicLink);
      await expect(magicSendButton(page)).toBeVisible();
      await sendMagicLink(page, EMAIL.demo);
      await expect(mainOf(page).getByRole("link", { name: /ログインリンク/ })).toHaveCount(0);
      for (const href of await allHrefs(page)) {
        expect(new URL(href).pathname, href).not.toMatch(/^\/(dev|admin|staff)(\/|$)/i);
      }
      expect(documents.filter((entry) => entry.startsWith("/dev/"))).toEqual([]);
    }
    expect([...seen.hosts]).toEqual([ORIGIN_HOST]);
  });
});

test.describe("TC-PG-AUTH-003-309 the stand-in screen is a dev-only replacement of the mailbox that refuses return paths it cannot trust and keeps the address out of the URL (DEV-WEB-012 / 013, SEC-WEB-013, SEC-AUTH-018)", () => {
  const unsafe: readonly (readonly [string, { success?: string; failure?: string }])[] = [
    [
      "an absolute success URL",
      { success: "https://evil.example.com/account/login?returned=magic-link" },
    ],
    ["a protocol-relative failure URL", { failure: "//evil.example.com/account/login" }],
    ["a success path that is not Login or Registration", { success: "/mypage" }],
    ["a failure path under /dev", { failure: "/dev/scenarios" }],
    ["a success path with a dot segment", { success: "/account/../admin" }],
    ["a backslash success path", { success: "/account\\login?returned=magic-link" }],
  ];

  test.beforeEach(async ({ page }) => {
    await fixClock(page);
  });

  for (const [name, override] of unsafe) {
    test(`${name}: both actions are natively disabled and nothing is changed or followed`, async ({
      page,
    }) => {
      const documents = watchDocumentRequests(page);
      const seen = watchRequestHosts(page);
      await openMockMagicLink(page, "login", null, override);
      const stayed = page.url();
      for (const which of ["openValid", "openExpired"] as const) {
        await expect(standInLinkButton(page, which)).toBeDisabled();
      }
      await standInEmailField(page).fill(EMAIL.demo);
      await standInLinkButton(page, "openValid").click({ force: true });
      await standInLinkButton(page, "openExpired").click({ force: true });
      await page.waitForLoadState("networkidle");
      expect(page.url()).toBe(stayed);
      expect(await readSession(page)).toEqual({ kind: "guest" });
      expect(documents.filter((url) => !url.startsWith(MOCK_MAGIC_LINK_PATH))).toEqual([]);
      expect([...seen.hosts]).toEqual([ORIGIN_HOST]);
    });
  }

  test("without success and failure both actions are natively disabled", async ({ page }) => {
    await gotoHydrated(page, MOCK_MAGIC_LINK_PATH);
    await expect(heading1(page)).toHaveText(copy.mockMagicLink.heading);
    for (const which of ["openValid", "openExpired"] as const) {
      await expect(standInLinkButton(page, which)).toBeDisabled();
    }
    expect(await readSession(page)).toEqual({ kind: "guest" });
  });

  test("it says it is a stand-in, labels its address field and its actions literally, and has no link to any real service or to the app's areas", async ({
    page,
  }) => {
    await openMockMagicLink(page, "login");
    expect(await page.title()).toContain(copy.mockMagicLink.pageTitle);
    await expect(mainOf(page)).toContainText(copy.mockMagicLink.note);
    await expect(standInEmailField(page)).toBeVisible();
    await expect(standInEmailField(page)).toHaveAttribute("type", "email");
    await expect(standInEmailField(page)).toHaveValue("");
    await expect(standInLinkButton(page, "openValid")).toBeEnabled();
    await expect(standInLinkButton(page, "openExpired")).toBeEnabled();
    for (const href of await allHrefs(page)) {
      expect(new URL(href).pathname, href).not.toMatch(/^\/(admin|staff)(\/|$)/i);
    }
  });

  test("opening it, and typing into its field, change nothing: the Session, the users, the Cart and the metadata stay, and the address is in no URL and no storage entry", async ({
    page,
  }) => {
    await openMockMagicLink(page, "login");
    const usersBefore = await readUsers(page);
    const url = page.url();
    await standInEmailField(page).fill("typed.only@example.com");
    expect(page.url()).toBe(url);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    expect(await readUsers(page)).toEqual(usersBefore);
    expect(await readCartRaw(page)).toBeNull();
    expect((await lifecycleOf(page))?.external).toBeUndefined();
    expect(await dumpStorage(page)).not.toContain("typed.only@example.com");
  });

  test("an empty or malformed address opened as a valid link does nothing: no navigation, no Session, no user", async ({
    page,
  }) => {
    await openMockMagicLink(page, "login");
    const usersBefore = await readUsers(page);
    const url = page.url();
    const documents = watchDocumentRequests(page);
    for (const email of ["", "   ", "not-an-email"]) {
      await standInEmailField(page).fill(email);
      await standInLinkButton(page, "openValid").click({ force: true });
    }
    await page.waitForLoadState("networkidle");
    expect(page.url()).toBe(url);
    expect(documents).toEqual([]);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    expect(await readUsers(page)).toEqual(usersBefore);
  });

  test("an expired link needs no address and changes nothing: it only returns to the failure path", async ({
    page,
  }) => {
    await openMockMagicLink(page, "login");
    const usersBefore = await readUsers(page);
    await standInLinkButton(page, "openExpired").click();
    await expect(page).toHaveURL(/\/account\/login\?notice=link-failed|\/account\/login$/);
    await expect(alertsIn(page)).toHaveText(copy.auth.magicLink.failed);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    expect(await readUsers(page)).toEqual(usersBefore);
  });

  test("the address typed into the stand-in never reaches a URL: the return path is the contracted fixed one", async ({
    page,
  }) => {
    await fixClock(page);
    const documents = watchDocumentRequests(page);
    const typed = "private.mailbox@example.com";
    await gotoHydrated(page, mockMagicLinkUrl("login", "cart"));
    await standInEmailField(page).fill(typed);
    await standInLinkButton(page, "openValid").click();
    await expect(page).toHaveURL(/\/cart$/);
    expect(documents).toContain(magicReturnPath("login", "cart"));
    for (const entry of documents) {
      expect(entry).not.toContain(typed);
      expect(entry).not.toContain(encodeURIComponent(typed));
      expect(entry).not.toMatch(/%40|@/);
    }
  });
});

test.describe("TC-PG-AUTH-003-310 the screen shown by the return of a link decides: verified goes on to the Continuation, unverified to PG-AUTH-002, a Guest sees a failure; the return is read once and leaves the URL; the page that sent the link receives nothing (SPEC-050 15.0, AR-AUTH-004, FR-CRT-012 external-completion rule)", () => {
  test("Login returned=magic-link with a verified Session: Mypage without a Continuation, and the pending record is gone", async ({
    page,
  }) => {
    await openReturn(page, magicReturnPath("login"), {
      ...sessionEntry(EMAIL.demo),
      ...cartEntriesWithExternal([entryLine(OFFERING.regular, 1)], "pending"),
    });
    await expect(page).toHaveURL(/\/mypage$/);
    await expect(mainOf(page)).toContainText(MARKER_PROTECTED_TEXT);
    expect(urlOf(page).search).toBe("");
    expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
  });

  for (const name of PAGES) {
    test(`${name} returned=magic-link with a verified Session and continue=cart: /cart with the Guest Cart kept and the pending record gone`, async ({
      page,
    }) => {
      const entries = {
        ...sessionEntry(EMAIL.demo),
        ...cartEntriesWithExternal(LINES, "pending"),
      };
      await openReturn(page, magicReturnPath(name, "cart"), entries);
      await expect(page).toHaveURL(/\/cart$/);
      await expect(mainOf(page).getByRole("listitem")).toHaveCount(2);
      await expect(headerCartLink(page, 3)).toBeVisible();
      expect(await readCartRaw(page)).toBe(entries[KEYS.cart]);
      expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
    });
  }

  test("Registration returned=magic-link with a verified Session and no Continuation: Mypage (the same order as Login)", async ({
    page,
  }) => {
    await openReturn(page, magicReturnPath("register"), {
      ...sessionEntry(EMAIL.demo),
      ...cartEntriesWithExternal([entryLine(OFFERING.regular, 1)], "pending"),
    });
    await expect(page).toHaveURL(/\/mypage$/);
    expect(urlOf(page).search).toBe("");
    expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
  });

  for (const name of PAGES) {
    test(`${name} returned=magic-link with an Email-unverified Session: PG-AUTH-002 with the Continuation kept, the Cart kept, and the result received`, async ({
      page,
    }) => {
      await openReturn(page, magicReturnPath(name, "cart"), {
        [KEYS.session]: unverifiedSession(),
        ...cartEntriesWithExternal(LINES, "pending"),
      });
      await expect(page).toHaveURL(/\/account\/email-verification\?continue=cart$/);
      await expect(heading1(page)).toHaveText(copy.auth.verify.heading);
      expect(await readSession(page)).toEqual({
        kind: "authenticated",
        email: "unverified@example.com",
        emailVerified: false,
      });
      expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
      await expect(headerCartLink(page, 3)).toBeVisible();
    });
  }

  for (const name of PAGES) {
    test(`${name} returned=magic-link as a Guest (the link was opened on another device): the failure alert, the Cart and the pending record stay, and returned leaves the URL`, async ({
      page,
    }) => {
      const entries = cartEntriesWithExternal(LINES, "pending");
      await openReturn(page, magicReturnPath(name, "cart"), entries);
      await expect(heading1(page)).toHaveText(pageHeading(name));
      await expect(alertsIn(page)).toHaveCount(1);
      await expect(alertsIn(page)).toHaveText(copy.auth.magicLink.failed);
      await expect(page).toHaveURL(new RegExp(`/account/${name}\\?continue=cart$`));
      expect(urlOf(page).searchParams.has("returned")).toBe(false);
      expect(await readSession(page)).toEqual({ kind: "guest" });
      expect(await readCartRaw(page)).toBe(entries[KEYS.cart]);
      expect(await lifecycleOf(page)).toEqual({
        version: 1,
        provenance: "guest",
        external: "pending",
      });
      await expect(headerCartLink(page, 3)).toBeVisible();
    });
  }

  for (const name of PAGES) {
    test(`${name} notice=link-failed: the failure alert is shown and the pending record is kept`, async ({
      page,
    }) => {
      const entries = cartEntriesWithExternal(LINES, "pending");
      await openReturn(page, magicFailurePath(name, "cart"), entries);
      await expect(alertsIn(page)).toHaveCount(1);
      await expect(alertsIn(page)).toHaveText(copy.auth.magicLink.failed);
      expect(await readSession(page)).toEqual({ kind: "guest" });
      expect(await readCartRaw(page)).toBe(entries[KEYS.cart]);
      expect(await lifecycleOf(page)).toEqual({
        version: 1,
        provenance: "guest",
        external: "pending",
      });
    });
  }

  test("notice=link-failed with a signed-in Session still shows the failure and keeps the record (the failed link is not this Session's result)", async ({
    page,
  }) => {
    const entries = {
      ...sessionEntry(EMAIL.demo),
      ...cartEntriesWithExternal(LINES, "superseded", "authenticated"),
    };
    await openReturn(page, magicFailurePath("login"), entries);
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toHaveText(copy.auth.magicLink.failed);
    await expect(page).toHaveURL(/\/account\/login/);
    expect(await readCartRaw(page)).toBe(entries[KEYS.cart]);
    expect((await lifecycleOf(page))?.external).toBe("superseded");
  });

  test("unknown returned and notice values are ignored: no alert, no navigation, no change", async ({
    page,
  }) => {
    const entries = cartEntriesWithExternal(LINES, "pending");
    await openReturn(page, "/account/login?returned=magic_link&notice=magic-link-failed", entries);
    await expect(heading1(page)).toHaveText(copy.auth.login.heading);
    await expect(alertsIn(page)).toHaveCount(0);
    await expect(statusesIn(page)).toHaveCount(0);
    expect(await lifecycleOf(page)).toEqual({
      version: 1,
      provenance: "guest",
      external: "pending",
    });
    expect(await readCartRaw(page)).toBe(entries[KEYS.cart]);
  });

  test("the return of Google and the return of Magic Link are told apart: returned=google does not trigger the Magic Link failure wording and the reverse", async ({
    page,
  }) => {
    await openReturn(
      page,
      "/account/login?notice=google-failed",
      cartEntriesWithExternal(LINES, "pending"),
    );
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toHaveText(copy.auth.google.failed);
    await expect(alertsIn(page)).not.toHaveText(copy.auth.magicLink.failed);
  });

  test("a superseded record is received once by the screen shown by the return of a link: the Cart is cleared and the record is gone", async ({
    page,
  }) => {
    await openReturn(page, magicReturnPath("login"), {
      ...sessionEntry("other@example.com"),
      ...cartEntriesWithExternal(LINES, "superseded", "authenticated"),
    });
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readCartRaw(page)).toBeNull();
    expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
    await expect(headerCartLink(page, null)).toBeVisible();
  });

  test("a reload after the return was processed decides nothing again: no returned, no alert, and the Cart and the metadata are as they were", async ({
    page,
  }) => {
    const entries = cartEntriesWithExternal(LINES, "pending");
    await openReturn(page, magicReturnPath("login", "cart"), entries);
    await expect(alertsIn(page)).toHaveCount(1);
    const cartBefore = await readCartRaw(page);
    const metadataBefore = await lifecycleOf(page);
    expect(urlOf(page).searchParams.has("returned")).toBe(false);

    await reloadHydrated(page);
    await expect(heading1(page)).toHaveText(copy.auth.login.heading);
    expect(urlOf(page).searchParams.has("returned")).toBe(false);
    await expect(alertsIn(page)).toHaveCount(0);
    expect(await readCartRaw(page)).toBe(cartBefore);
    expect(await lifecycleOf(page)).toEqual(metadataBefore);
    expect(await readSession(page)).toEqual({ kind: "guest" });
  });

  test("after the return reached Mypage a reload keeps the Cart and the metadata (no second decision)", async ({
    page,
  }) => {
    await openReturn(page, magicReturnPath("login"), {
      ...sessionEntry(EMAIL.demo),
      ...cartEntriesWithExternal(LINES, "pending"),
    });
    await expect(page).toHaveURL(/\/mypage$/);
    const cartBefore = await readCartRaw(page);
    const metadataBefore = await lifecycleOf(page);
    expect(cartBefore).not.toBeNull();
    await reloadHydrated(page);
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readCartRaw(page)).toBe(cartBefore);
    expect(await lifecycleOf(page)).toEqual(metadataBefore);
    await expect(headerCartLink(page, 3)).toBeVisible();
  });

  test("the Browser's back and forward never return to the returned=magic-link entry", async ({
    page,
  }) => {
    await fixClock(page);
    await seedLocalStorage(page, cartEntriesWithExternal(LINES, "pending"));
    await gotoHydrated(page, "/");
    await gotoHydrated(page, magicReturnPath("login", "cart"));
    await expect(alertsIn(page)).toHaveCount(1);
    expect(urlOf(page).searchParams.has("returned")).toBe(false);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/account\/login/);
    expect(urlOf(page).searchParams.has("returned")).toBe(false);
    expect(await lifecycleOf(page)).toEqual({
      version: 1,
      provenance: "guest",
      external: "pending",
    });
    expect(await readSession(page)).toEqual({ kind: "guest" });
  });

  test("a screen that is not the one shown by the return never receives the result: an ordinary visit with a signed-in Session keeps the pending record and the Cart", async ({
    page,
  }) => {
    await fixClock(page);
    await seedLocalStorage(page, {
      ...sessionEntry(EMAIL.demo),
      ...cartEntriesWithExternal(LINES, "pending"),
    });
    for (const path of ["/cart", "/account/login", "/account/register", "/mypage"]) {
      await gotoHydrated(page, path);
      await expect(headerCartLink(page, 3)).toBeVisible();
      expect((await lifecycleOf(page))?.external, path).toBe("pending");
    }
  });

  test("the page that sent the link receives nothing when the link is opened in another Tab: it stays in the sent state, does not navigate, shows no failure, and a reload decides nothing", async ({
    page,
  }) => {
    await openAuthPage(page, "login", "", cartEntries([entryLine(OFFERING.regular, 1)], "guest"));
    await sendMagicLink(page, SENDER_EMAIL);
    const sentUrl = page.url();
    const cartBefore = await readCartRaw(page);

    const second = await openSecondTab(page.context());
    await openValidLink(second, "login", NEW_LINK_EMAIL);
    await expect(second).toHaveURL(/\/mypage$/);
    expect(await readSession(second)).toEqual({
      kind: "authenticated",
      email: NEW_LINK_EMAIL,
      emailVerified: true,
    });

    // The sending Tab sees the new Session (its Header may show the signed-in state) but it is not the screen shown
    // by the return: it does not navigate, does not decide anything and shows no failure.
    await page.bringToFront();
    await expect(page).toHaveURL(sentUrl);
    expect(page.url()).toBe(sentUrl);
    expect(urlOf(page).searchParams.has("returned")).toBe(false);
    await expect(statusesIn(page)).toHaveText(copy.auth.magicLink.sent);
    await expect(alertsIn(page)).toHaveCount(0);
    // The result was received by the Tab the link opened: the record is gone and the Cart is the Guest's.
    expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
    expect(await readCartRaw(page)).toBe(cartBefore);

    await reloadHydrated(page);
    await expect(page).toHaveURL(sentUrl);
    await expect(heading1(page)).toHaveText(copy.auth.login.heading);
    await expect(alertsIn(page)).toHaveCount(0);
    expect(await readCartRaw(page)).toBe(cartBefore);
    expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
    await second.close();
  });

  test("the link opened in the very Tab that sent it (the sent state is left by a document load) is received there like any returned screen", async ({
    page,
  }) => {
    await openAuthPage(page, "login", "?continue=cart", cartEntries(LINES, "guest"));
    await sendMagicLink(page, EMAIL.demo);
    await openValidLink(page, "login", EMAIL.demo, "cart");
    await expect(page).toHaveURL(/\/cart$/);
    await expect(mainOf(page).getByRole("listitem")).toHaveCount(2);
    expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
  });
});

test.describe("TC-PG-AUTH-003-313 a signed-in visitor (verified or not) cannot send a Magic Link: the button is disabled with the reason attached, nothing is recorded, and Email+Password stays (SPEC-050 15.0, FR-CRT-012 external-completion rule step 1)", () => {
  const sessions = [
    ["a verified Session", sessionEntry(EMAIL.demo)],
    ["an Email-unverified Session", { [KEYS.session]: unverifiedSession() }],
  ] as const;

  for (const [label, entries] of sessions) {
    for (const name of PAGES) {
      test(`${name} with ${label}: the send is natively disabled and described by the Logout hint; a press goes nowhere and records nothing; the existing form is shown`, async ({
        page,
      }) => {
        const documents = watchDocumentRequests(page);
        await openAuthPage(page, name, "", entries);
        await chooseMethod(page, copy.auth.method.magicLink);
        const send = magicSendButton(page);
        await expect(send).toBeDisabled();
        await expect(send).toHaveJSProperty("disabled", true);
        expect(await describedText(send)).toContain(copy.auth.magicLink.signedIn);
        const before = page.url();
        await field(page, copy.auth.field.email.label).fill(EMAIL.demo);
        await send.click({ force: true });
        await page.waitForLoadState("networkidle");
        expect(page.url()).toBe(before);
        await expect(statusesIn(page)).toHaveCount(0);
        expect(documents.filter((entry) => entry.startsWith("/dev/"))).toEqual([]);
        // Refused before anything is recorded: no pending record is written.
        expect((await lifecycleOf(page))?.external).toBeUndefined();

        // Email+Password is still offered (the specification does not say whether signing in again is allowed).
        await chooseMethod(page, copy.auth.method.password);
        await expect(field(page, copy.auth.field.password.label)).toBeVisible();
        await expect(
          submitButton(page, name === "login" ? copy.auth.login.submit : copy.auth.register.submit),
        ).toBeVisible();
      });
    }
  }

  test("a Guest sees the send enabled and no signed-in hint", async ({ page }) => {
    await openAuthPage(page, "login");
    await chooseMethod(page, copy.auth.method.magicLink);
    await expect(magicSendButton(page)).toBeEnabled();
    expect(await describedText(magicSendButton(page))).not.toContain(copy.auth.magicLink.signedIn);
    await expect(mainOf(page)).not.toContainText(copy.auth.magicLink.signedIn);
  });

  test("a Session that becomes valid in another Tab disables the send on the open page, in the sent state too (the link was opened elsewhere)", async ({
    page,
  }) => {
    await openAuthPage(page, "login");
    await sendMagicLink(page, SENDER_EMAIL);
    await expect(magicResendButton(page)).toBeEnabled();
    const second = await openSecondTab(page.context());
    await openValidLink(second, "login", NEW_LINK_EMAIL);
    await expect(second).toHaveURL(/\/mypage$/);
    await page.bringToFront();
    await expect(magicResendButton(page)).toBeDisabled();
    expect(await describedText(magicResendButton(page))).toContain(copy.auth.magicLink.signedIn);
    // The sent state is still shown: the page that sent the link is not a screen that receives the result.
    await expect(statusesIn(page)).toHaveText(copy.auth.magicLink.sent);
    await second.close();
  });

  test("a Session that becomes valid in another Tab disables the send on a page that has not sent anything yet", async ({
    page,
  }) => {
    await openAuthPage(page, "login");
    await chooseMethod(page, copy.auth.method.magicLink);
    await expect(magicSendButton(page)).toBeEnabled();
    const second = await openSecondTab(page.context());
    await gotoHydrated(second, "/account/login");
    await loginWith(second, EMAIL.demo);
    await expect(second).toHaveURL(/\/mypage$/);
    await page.bringToFront();
    await expect(magicSendButton(page)).toBeDisabled();
    expect(await describedText(magicSendButton(page))).toContain(copy.auth.magicLink.signedIn);
    await second.close();
  });
});

test.describe("TC-FR-CRT-012-020 the screens: a link that arrives after another method signed in is received as a different Account's Cart boundary, a failed link keeps the Cart, a link opened in another Tab or from another Browser is judged by what the lifecycle recorded, and a send without another login keeps the Guest Cart (FR-CRT-012 external-completion rule steps 5 to 7, 9)", () => {
  const ENTRY_ONE = cartEntries([entryLine(OFFERING.regular, 1)], "guest");

  /** Adds one Entry of the regular offering to the open Cart (the page is /entry; the Cart then has one more line). */
  async function addEntry(page: Page, expectedCount: number): Promise<void> {
    await gotoHydrated(page, "/entry");
    const offering = mainOf(page)
      .getByRole("listitem")
      .filter({
        has: page.getByRole("heading", { name: offeringName(OFFERING.regular), exact: true }),
      });
    await quantityInput(offering).fill("1");
    await addButton(offering).click();
    await expect(headerCartLink(page, expectedCount)).toBeVisible();
  }

  /** Guest with one Entry in the Cart sends a link from Login and stays on the sent state. */
  async function startWithGuestCart(page: Page): Promise<void> {
    await openAuthPage(page, "login", "", ENTRY_ONE);
    await expect(headerCartLink(page, 1)).toBeVisible();
    await sendMagicLink(page, SENDER_EMAIL);
    expect(await lifecycleOf(page)).toEqual({
      version: 1,
      provenance: "guest",
      external: "pending",
    });
  }

  /** In the same Tab: Email+Password Login as demo@example.com (the pending record becomes superseded) and one more Entry. */
  async function loginAsDemoAndAddEntry(page: Page): Promise<void> {
    await chooseMethod(page, copy.auth.method.password);
    await loginWith(page, EMAIL.demo);
    await expect(page).toHaveURL(/\/mypage$/);
    // The Login kept the Guest Cart and turned the pending record into a superseded one.
    expect((await lifecycleOf(page))?.external).toBe("superseded");
    await addEntry(page, 2);
  }

  async function expectCartIsEmpty(page: Page): Promise<void> {
    expect(await readCartRaw(page)).toBeNull();
    expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
    await expect(headerCartLink(page, null)).toBeVisible();
    await gotoHydrated(page, "/cart");
    await expect(heading1(page)).toHaveText(copy.cart.heading);
    await expect(mainOf(page)).toContainText(copy.cart.empty);
    await expect(mainOf(page).getByRole("listitem")).toHaveCount(0);
    await expect(headerCartLink(page, null)).toBeVisible();
  }

  test("send, another method signs in as demo@example.com and adds an Entry, then the link of other@example.com is opened: the Cart is empty and the record is gone", async ({
    page,
  }) => {
    await startWithGuestCart(page);
    await loginAsDemoAndAddEntry(page);

    await openValidLink(page, "login", EMAIL.other);
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: EMAIL.other,
      emailVerified: true,
    });
    await expectCartIsEmpty(page);
  });

  test("the failed return of a send that another method has superseded keeps the Cart and the record; the next valid link then clears it", async ({
    page,
  }) => {
    await startWithGuestCart(page);
    await loginAsDemoAndAddEntry(page);

    // An expired link first: the alert shows, demo@example.com keeps the Cart, the record is not consumed.
    await openMockMagicLink(page, "login");
    await standInLinkButton(page, "openExpired").click();
    await expect(page).toHaveURL(/\/account\/login/);
    await expect(alertsIn(page)).toHaveText(copy.auth.magicLink.failed);
    await expect(headerCartLink(page, 2)).toBeVisible();
    expect((await lifecycleOf(page))?.external).toBe("superseded");
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: EMAIL.demo,
      emailVerified: true,
    });

    // The valid link of another account is then received and clears the Cart.
    await openValidLink(page, "login", EMAIL.other);
    await expect(page).toHaveURL(/\/mypage$/);
    await expectCartIsEmpty(page);
  });

  test("comparison: a send with no other login keeps the Guest Cart when the link is opened, for a new account and for an existing one", async ({
    page,
  }) => {
    await startWithGuestCart(page);
    const cartBefore = await readCartRaw(page);
    await openValidLink(page, "login", EMAIL.fresh);
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readCartRaw(page)).toBe(cartBefore);
    await expect(headerCartLink(page, 1)).toBeVisible();
    expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
  });

  test("a Logout between the send and the link removes the record and the Cart; a link opened afterwards finds nothing to keep", async ({
    page,
  }) => {
    await startWithGuestCart(page);
    const second = await openSecondTab(page.context());
    await gotoHydrated(second, "/account/login");
    await loginWith(second, EMAIL.demo);
    await expect(second).toHaveURL(/\/mypage$/);
    await logoutViaMenu(second);
    await expect(second).toHaveURL(/\/$/);
    expect(await readCartRaw(second)).toBeNull();
    expect((await lifecycleOf(second))?.external).toBeUndefined();

    await page.bringToFront();
    await openValidLink(page, "login", NEW_LINK_EMAIL);
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readCartRaw(page)).toBeNull();
    await expect(headerCartLink(page, null)).toBeVisible();
    await second.close();
  });

  test("the link opened in another Tab while the sending Tab stays on the sent state: the Guest Cart is kept, the sending Tab decides nothing, and a later visit of /cart still shows the Entry", async ({
    page,
  }) => {
    await startWithGuestCart(page);
    const cartBefore = await readCartRaw(page);
    const sentUrl = page.url();

    const second = await openSecondTab(page.context());
    await openValidLink(second, "login", NEW_LINK_EMAIL);
    await expect(second).toHaveURL(/\/mypage$/);
    // The Tab the link opened is the screen shown by the return: the pending record is received and the Cart kept.
    expect(await lifecycleOf(second)).toEqual({ version: 1, provenance: "authenticated" });
    expect(await readCartRaw(second)).toBe(cartBefore);

    // The sending Tab is not: nothing changes there, however often it observes the new Session.
    await page.bringToFront();
    await expect(page).toHaveURL(sentUrl);
    await expect(statusesIn(page)).toHaveText(copy.auth.magicLink.sent);
    await expect(alertsIn(page)).toHaveCount(0);
    expect(await readCartRaw(page)).toBe(cartBefore);

    await reloadHydrated(page);
    await expect(page).toHaveURL(sentUrl);
    expect(await readCartRaw(page)).toBe(cartBefore);
    await gotoHydrated(page, "/cart");
    await expect(heading1(page)).toHaveText(copy.cart.heading);
    await expect(mainOf(page).getByRole("listitem")).toHaveCount(1);
    await expect(headerCartLink(page, 1)).toBeVisible();
    expect(await readCartRaw(page)).toBe(cartBefore);
    await second.close();
  });

  test("a link from another Browser, with no record here (after a Logout), opened while another account is signed in: the Cart that account used is cleared (step 9)", async ({
    page,
  }) => {
    await startWithGuestCart(page);
    // Another method signs in and the user signs out again: the record is gone and so is the Cart (step 7).
    await chooseMethod(page, copy.auth.method.password);
    await loginWith(page, EMAIL.demo);
    await expect(page).toHaveURL(/\/mypage$/);
    await logoutViaMenu(page);
    await expect(page).toHaveURL(/\/$/);
    expect(await readCartRaw(page)).toBeNull();
    expect((await lifecycleOf(page))?.external).toBeUndefined();

    // demo@example.com signs in again and fills a Cart; nothing was sent from this Browser.
    await gotoHydrated(page, "/account/login");
    await loginWith(page, EMAIL.demo);
    await expect(page).toHaveURL(/\/mypage$/);
    await addEntry(page, 1);
    expect((await lifecycleOf(page))?.external).toBeUndefined();

    // A link for another account, sent from another Browser, is opened here.
    await openValidLink(page, "login", EMAIL.other);
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: EMAIL.other,
      emailVerified: true,
    });
    await expectCartIsEmpty(page);
  });
});

test.describe("TC-SEC-AUTH-018-702 the address typed to send or open a link never reaches the URL, the storage, the page text or the console, beyond the user record the stand-in writes on purpose (SEC-AUTH-018, SEC-API-027)", () => {
  test("a send, a re-send, a failure return and a valid link leave no trace of the sender's address, and no address is ever in a URL", async ({
    page,
  }) => {
    const console_ = watchConsole(page);
    const sender = "private.sender@example.com";
    const owner = "private.owner@example.com";
    await fixClock(page);
    const seenUrls: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) seenUrls.push(frame.url());
    });
    const documents = watchDocumentRequests(page);
    await openAuthPage(page, "login", "?continue=cart");

    const expectNoSenderTrace = async (): Promise<void> => {
      expect(await dumpStorage(page)).not.toContain(sender);
      expect(urlOf(page).href).not.toContain(sender);
      expect(await mainOf(page).innerText()).not.toContain(sender);
      expect(await page.locator("body").innerText()).not.toContain(sender);
      expect(console_.messages.filter((m) => m.includes(sender))).toEqual([]);
    };

    await sendMagicLink(page, sender);
    await expectNoSenderTrace();
    // A re-send replaces the sent state in place.
    await magicResendButton(page).click();
    await expect(statusesIn(page)).toHaveText(copy.auth.magicLink.sent);
    await expectNoSenderTrace();
    // An outage and a failed return.
    await setAuthScenario(page, { login: "unavailable" });
    await magicResendButton(page).click();
    await expect(alertsIn(page)).toHaveText(copy.auth.magicLink.unavailable);
    await expectNoSenderTrace();
    await setAuthScenario(page, {});

    await openMockMagicLink(page, "login", "cart");
    await standInEmailField(page).fill(owner);
    expect(await dumpStorage(page)).not.toContain(owner);
    await standInLinkButton(page, "openExpired").click();
    await expect(alertsIn(page)).toHaveText(copy.auth.magicLink.failed);
    await expectNoSenderTrace();
    expect(await dumpStorage(page)).not.toContain(owner);

    // A valid link creates the owner's user record on purpose; it still appears in no URL, request, text or console.
    await openValidLink(page, "login", owner, "cart");
    await expect(page).toHaveURL(/\/cart$/);
    await page.waitForLoadState("networkidle");
    await expectNoSenderTrace();
    expect(await mainOf(page).innerText()).not.toContain(owner);
    expect(console_.messages.filter((m) => m.includes(owner))).toEqual([]);
    for (const url of [...seenUrls, ...documents, page.url()]) {
      expect(url).not.toContain(sender);
      expect(url).not.toContain(owner);
      expect(url).not.toContain(encodeURIComponent(sender));
      expect(url).not.toContain(encodeURIComponent(owner));
      expect(url).not.toMatch(/%40|@/);
    }
    // Only the fixed words of the contract (and the Continuation) appear in the paths the screens return to.
    expect(documents).toContain(magicReturnPath("login", "cart"));
    expect(documents).toContain(magicFailurePath("login", "cart"));
  });
});
