import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  type AuthPageName,
  alertsIn,
  authScenario,
  cartEntriesWithExternal,
  chooseMethod,
  describedText,
  field,
  googleFailurePath,
  googleReturnPath,
  googleStartButton,
  headerLogin,
  heading1,
  loginWith,
  logoutViaMenu,
  MARKER_PROTECTED_TEXT,
  MOCK_GOOGLE_PATH,
  mainOf,
  openAuthPage,
  openMockGoogle,
  readCartLifecycle,
  readSession,
  readUsers,
  sessionEntry,
  standInButton,
  startGoogle,
  statusesIn,
  submitButton,
  unverifiedSession,
  urlOf,
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
import { fixClock, horizontalOverflow } from "../harness/browser/public.ts";
import {
  allHrefs,
  KEYS,
  ORIGIN_HOST,
  seedLocalStorage,
  watchRequestHosts,
  watchRuntimeErrors,
} from "../harness/browser/shell.ts";
import { EMAIL, GOODS, OFFERING } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s6-auth.md sections 5B, 6.1C, 6.2B, 7, 10A
// and tests/contracts/s2-mock-backend.md section 14.2. SPEC-050 15.0 / 15.1 / 15.3, SPEC-020 FR-CRT-012 (the
// external-completion rule), SPEC-060 AR-CONT-001 / AR-AUTH-004, SPEC-140 SEC-WEB-013.
// Google is the first external-completion method: the mock's stand-in screen (/dev/mock-google) replaces Google, the
// result comes back as a full document load of PG-AUTH-003 / PG-AUTH-001 carrying `returned=google`, and the Cart is
// decided by what the Cart lifecycle recorded when the start was made (never by an Account).

const NEW_GOOGLE_EMAIL = "google.new@example.com";
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

test.describe("TC-PG-AUTH-003-308 Google on Login and Registration: the stand-in screen allows or cancels, the Cart is kept, nothing leaves the origin (SPEC-050 15.0 / 15.1 / 15.3, FR-CRT-012, AR-CONT-001)", () => {
  test("Login, allow demo@example.com: stand-in, then the returned=google document, then Mypage as a signed-in verified user; no user is created", async ({
    page,
  }) => {
    const runtime = watchRuntimeErrors(page);
    const seen = watchRequestHosts(page);
    await openAuthPage(page, "login");
    const documents = watchDocumentRequests(page);

    await startGoogle(page, "login");
    // The start changed nothing: still Guest, and the stand-in carries both paths as safe query values.
    expect(await readSession(page)).toEqual({ kind: "guest" });
    expect(urlOf(page).pathname).toBe(MOCK_GOOGLE_PATH);
    expect(urlOf(page).searchParams.get("success")).toBe(googleReturnPath("login"));
    expect(urlOf(page).searchParams.get("failure")).toBe(googleFailurePath("login"));

    await standInButton(page, "allowDemo").click();
    await expect(page).toHaveURL(/\/mypage$/);
    await expect(heading1(page)).toHaveText(copy.mypage.heading);
    await expect(mainOf(page)).toContainText(MARKER_PROTECTED_TEXT);
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: EMAIL.demo,
      emailVerified: true,
    });
    // The result came back as a document load of the Login page (not a client-side transition).
    expect(documents).toContain(googleReturnPath("login"));
    expect(urlOf(page).search).toBe("");
    const users = (await readUsers(page)) ?? [];
    expect(users.some((u) => u.email === NEW_GOOGLE_EMAIL)).toBe(false);
    expect(users.filter((u) => u.email === EMAIL.demo)).toHaveLength(1);
    await page.waitForLoadState("networkidle");
    expect(runtime.errors).toEqual([]);
    expect([...seen.hosts]).toEqual([ORIGIN_HOST]);
  });

  test("Login, allow the new account: one verified user with no display name is created and shown as 未設定 on Mypage", async ({
    page,
  }) => {
    await openAuthPage(page, "login");
    const before = (await readUsers(page)) ?? [];
    await startGoogle(page, "login");
    await standInButton(page, "allowNew").click();
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: NEW_GOOGLE_EMAIL,
      emailVerified: true,
    });
    const users = (await readUsers(page)) ?? [];
    expect(users.filter((u) => u.email === NEW_GOOGLE_EMAIL)).toEqual([
      { email: NEW_GOOGLE_EMAIL, displayName: null, emailVerified: true },
    ]);
    expect(users.length).toBeGreaterThanOrEqual(before.length + 1);
    const account = mainOf(page).getByRole("region", {
      name: copy.mypage.overview.profileHeading,
      exact: true,
    });
    await expect(
      account.locator("p").filter({ hasText: copy.mypage.overview.displayNameLabel }),
    ).toHaveText(`${copy.mypage.overview.displayNameLabel} 未設定`);
  });

  test("Login, cancel: back on the same screen with exactly one failure alert, still Guest, nothing created, and another method can be chosen", async ({
    page,
  }) => {
    await openAuthPage(page, "login");
    const documents = watchDocumentRequests(page);
    await startGoogle(page, "login");
    await standInButton(page, "cancel").click();
    await expect(page).toHaveURL(/\/account\/login/);
    await expect(heading1(page)).toHaveText(copy.auth.login.heading);
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toHaveText(copy.auth.google.failed);
    expect(documents).toContain(googleFailurePath("login"));
    expect(urlOf(page).searchParams.has("returned")).toBe(false);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    await expect(headerLogin(page)).toBeVisible();
    const users = (await readUsers(page)) ?? [];
    expect(users.some((u) => u.email === NEW_GOOGLE_EMAIL)).toBe(false);

    // Another method can be chosen again (the radio group stays operable).
    await chooseMethod(page, copy.auth.method.password);
    await expect(field(page, copy.auth.field.password.label)).toBeVisible();
    await expect(submitButton(page, copy.auth.login.submit)).toBeVisible();
    await chooseMethod(page, copy.auth.method.emailOtp);
    await expect(
      mainOf(page).getByRole("button", { name: copy.auth.otp.send, exact: true }),
    ).toBeVisible();
    // Google can be tried again from the same screen.
    await chooseMethod(page, copy.auth.method.google);
    await expect(googleStartButton(page, "login")).toBeEnabled();
  });

  test("Login with continue=cart and a Guest Cart: allow keeps the Cart byte-identical, records the authenticated provenance and removes the pending record, and /cart shows the lines", async ({
    page,
  }) => {
    await openAuthPage(page, "login", "?continue=cart", cartEntries(LINES, "guest"));
    await expect(headerCartLink(page, 3)).toBeVisible();
    const cartBefore = await readCartRaw(page);
    await startGoogle(page, "login");
    // The start recorded a pending result and kept the Guest Cart (FR-CRT-012 external-completion rule, steps 2 to 4).
    expect(urlOf(page).searchParams.get("success")).toBe(googleReturnPath("login", "cart"));
    expect(urlOf(page).searchParams.get("failure")).toBe(googleFailurePath("login", "cart"));
    expect(await lifecycleOf(page)).toEqual({
      version: 1,
      provenance: "guest",
      external: "pending",
    });
    expect(await readCartRaw(page)).toBe(cartBefore);

    await standInButton(page, "allowDemo").click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(heading1(page)).toHaveText(copy.cart.heading);
    await expect(mainOf(page).getByRole("listitem")).toHaveCount(2);
    await expect(headerCartLink(page, 3)).toBeVisible();
    expect(await readCartRaw(page)).toBe(cartBefore);
    expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: EMAIL.demo,
      emailVerified: true,
    });
  });

  test("Login with continue=cart and a Guest Cart: cancel keeps the Cart and the pending record (the result of this start is not received)", async ({
    page,
  }) => {
    await openAuthPage(page, "login", "?continue=cart", cartEntries(LINES, "guest"));
    const cartBefore = await readCartRaw(page);
    await startGoogle(page, "login");
    await standInButton(page, "cancel").click();
    await expect(page).toHaveURL(/\/account\/login\?continue=cart/);
    await expect(alertsIn(page)).toHaveText(copy.auth.google.failed);
    expect(urlOf(page).searchParams.get("continue")).toBe("cart");
    expect(urlOf(page).searchParams.has("returned")).toBe(false);
    await expect(headerCartLink(page, 3)).toBeVisible();
    expect(await readCartRaw(page)).toBe(cartBefore);
    expect(await lifecycleOf(page)).toEqual({
      version: 1,
      provenance: "guest",
      external: "pending",
    });
    expect(await readSession(page)).toEqual({ kind: "guest" });
  });

  test("Registration, allow the new account: Mypage, one verified user with no display name; allow an existing account: Mypage, no 'already registered' answer and no new user", async ({
    page,
  }) => {
    await openAuthPage(page, "register");
    await startGoogle(page, "register");
    expect(urlOf(page).searchParams.get("success")).toBe(googleReturnPath("register"));
    expect(urlOf(page).searchParams.get("failure")).toBe(googleFailurePath("register"));
    await standInButton(page, "allowNew").click();
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: NEW_GOOGLE_EMAIL,
      emailVerified: true,
    });
    const afterNew = (await readUsers(page)) ?? [];
    expect(afterNew.filter((u) => u.email === NEW_GOOGLE_EMAIL)).toEqual([
      { email: NEW_GOOGLE_EMAIL, displayName: null, emailVerified: true },
    ]);

    // An existing account in the same browser: the same path, and no existence is disclosed.
    await openMockGoogle(page, "register");
    await standInButton(page, "allowDemo").click();
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: EMAIL.demo,
      emailVerified: true,
    });
    await expect(alertsIn(page)).toHaveCount(0);
    expect((await readUsers(page)) ?? []).toHaveLength(afterNew.length);
  });

  test("Registration with continue=cart and a Guest Cart: allow arrives at /cart with the lines kept; cancel shows the failure alert on Registration and keeps the Cart", async ({
    page,
  }) => {
    await openAuthPage(page, "register", "?continue=cart", cartEntries(LINES, "guest"));
    const cartBefore = await readCartRaw(page);
    await startGoogle(page, "register");
    await standInButton(page, "cancel").click();
    await expect(page).toHaveURL(/\/account\/register\?continue=cart/);
    await expect(heading1(page)).toHaveText(copy.auth.register.heading);
    await expect(alertsIn(page)).toHaveText(copy.auth.google.failed);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    expect(await readCartRaw(page)).toBe(cartBefore);

    await startGoogle(page, "register");
    await standInButton(page, "allowNew").click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(mainOf(page).getByRole("listitem")).toHaveCount(2);
    await expect(headerCartLink(page, 3)).toBeVisible();
    expect(await readCartRaw(page)).toBe(cartBefore);
    expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
  });

  test("the karaoke-slot continuation is carried through the stand-in and back", async ({
    page,
  }) => {
    const slotRef = "5a000000-0000-4000-8000-000000011000";
    await openAuthPage(page, "login", `?continue=${encodeURIComponent(`karaoke-slot:${slotRef}`)}`);
    await startGoogle(page, "login");
    expect(urlOf(page).searchParams.get("success")).toBe(
      googleReturnPath("login", `karaoke-slot:${slotRef}`),
    );
    expect(urlOf(page).searchParams.get("failure")).toBe(
      googleFailurePath("login", `karaoke-slot:${slotRef}`),
    );
  });

  test("the start is a button (a full-page hand-off), not a link: no /dev or /admin or /staff href and no external origin on either page", async ({
    page,
  }) => {
    const seen = watchRequestHosts(page);
    for (const name of PAGES) {
      await openAuthPage(page, name, "?continue=cart");
      await chooseMethod(page, copy.auth.method.google);
      await expect(googleStartButton(page, name)).toBeVisible();
      await expect(mainOf(page).getByRole("link", { name: /Google/ })).toHaveCount(0);
      for (const href of await allHrefs(page)) {
        expect(new URL(href).pathname, href).not.toMatch(/^\/(dev|admin|staff)(\/|$)/i);
      }
    }
    expect([...seen.hosts]).toEqual([ORIGIN_HOST]);
  });

  test("at 390px the Google start fits the viewport on Login and Registration", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const name of PAGES) {
      await openAuthPage(page, name, "?continue=cart");
      await chooseMethod(page, copy.auth.method.google);
      await googleStartButton(page, name).scrollIntoViewIfNeeded();
      await expect(googleStartButton(page, name)).toBeInViewport();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    }
  });

  test("when the sign-in service is unavailable (auth.login) the start shows one alert, stays on the page and can be tried again", async ({
    page,
  }) => {
    const documents = watchDocumentRequests(page);
    await openAuthPage(page, "login", "", authScenario({ login: "unavailable" }));
    await chooseMethod(page, copy.auth.method.google);
    await googleStartButton(page, "login").click();
    await expect(alertsIn(page)).toHaveCount(1);
    await expect(alertsIn(page)).toHaveText(copy.auth.google.unavailable);
    await expect(page).toHaveURL(/\/account\/login$/);
    await expect(googleStartButton(page, "login")).toBeEnabled();
    expect(documents.filter((url) => url.startsWith("/dev/"))).toEqual([]);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    // The record is written before the request and an outcome that is not a success never takes it back
    // (FR-CRT-012 external-completion rule, steps 3 and 7).
    expect((await lifecycleOf(page))?.external).toBe("pending");
  });
});

test.describe("TC-PG-AUTH-003-308 the stand-in screen is a dev-only replacement of Google that refuses return paths it cannot trust (DEV-WEB-012 / 013, SEC-WEB-013)", () => {
  const unsafe: readonly (readonly [string, { success?: string; failure?: string }])[] = [
    [
      "an absolute success URL",
      { success: "https://evil.example.com/account/login?returned=google" },
    ],
    ["a protocol-relative failure URL", { failure: "//evil.example.com/account/login" }],
    ["a success path that is not Login or Registration", { success: "/mypage" }],
    ["a failure path under /dev", { failure: "/dev/scenarios" }],
    ["a success path with a dot segment", { success: "/account/../admin" }],
    ["a backslash success path", { success: "/account\\login?returned=google" }],
  ];

  test.beforeEach(async ({ page }) => {
    await fixClock(page);
  });

  for (const [name, override] of unsafe) {
    test(`${name}: the actions are natively disabled and nothing is changed or followed`, async ({
      page,
    }) => {
      const documents = watchDocumentRequests(page);
      const seen = watchRequestHosts(page);
      await openMockGoogle(page, "login", null, override);
      const stayed = page.url();
      for (const which of ["allowDemo", "allowNew", "cancel"] as const) {
        await expect(standInButton(page, which)).toBeDisabled();
      }
      await standInButton(page, "allowDemo").click({ force: true });
      await standInButton(page, "cancel").click({ force: true });
      await page.waitForLoadState("networkidle");
      expect(page.url()).toBe(stayed);
      expect(await readSession(page)).toEqual({ kind: "guest" });
      expect(documents.filter((url) => !url.startsWith(MOCK_GOOGLE_PATH))).toEqual([]);
      expect([...seen.hosts]).toEqual([ORIGIN_HOST]);
    });
  }

  test("without success and failure the actions are natively disabled", async ({ page }) => {
    await gotoHydrated(page, MOCK_GOOGLE_PATH);
    await expect(heading1(page)).toHaveText(copy.mockGoogle.heading);
    for (const which of ["allowDemo", "allowNew", "cancel"] as const) {
      await expect(standInButton(page, which)).toBeDisabled();
    }
    expect(await readSession(page)).toEqual({ kind: "guest" });
  });

  test("it says it is a stand-in, names the actions literally and has no link to any real service or to the app's areas", async ({
    page,
  }) => {
    await openMockGoogle(page, "login");
    expect(await page.title()).toContain(copy.mockGoogle.pageTitle);
    await expect(mainOf(page)).toContainText(copy.mockGoogle.note);
    await expect(standInButton(page, "allowDemo")).toBeEnabled();
    await expect(standInButton(page, "allowNew")).toBeEnabled();
    await expect(standInButton(page, "cancel")).toBeEnabled();
    for (const href of await allHrefs(page)) {
      expect(new URL(href).pathname, href).not.toMatch(/^\/(admin|staff)(\/|$)/i);
    }
  });

  test("opening it does not change the Session, the mock database or the Cart", async ({
    page,
  }) => {
    await openMockGoogle(page, "login");
    expect(await readSession(page)).toEqual({ kind: "guest" });
    expect(await readCartRaw(page)).toBeNull();
    expect((await lifecycleOf(page))?.external).toBeUndefined();
  });
});

test.describe("TC-PG-AUTH-003-310 the screen shown by the return decides: verified goes on to the Continuation, unverified to PG-AUTH-002, a Guest sees a failure; the return is read once and leaves the URL (SPEC-050 15.0, AR-AUTH-004, FR-CRT-012 external-completion rule)", () => {
  test("Login returned=google with a verified Session: Mypage without a Continuation, and the pending record is gone", async ({
    page,
  }) => {
    await openReturn(page, googleReturnPath("login"), {
      ...sessionEntry(EMAIL.demo),
      ...cartEntriesWithExternal([entryLine(OFFERING.regular, 1)], "pending"),
    });
    await expect(page).toHaveURL(/\/mypage$/);
    await expect(mainOf(page)).toContainText(MARKER_PROTECTED_TEXT);
    expect(urlOf(page).search).toBe("");
    expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
  });

  for (const name of PAGES) {
    test(`${name} returned=google with a verified Session and continue=cart: /cart with the Guest Cart kept and the pending record gone`, async ({
      page,
    }) => {
      const entries = {
        ...sessionEntry(EMAIL.demo),
        ...cartEntriesWithExternal(LINES, "pending"),
      };
      await openReturn(page, googleReturnPath(name, "cart"), entries);
      await expect(page).toHaveURL(/\/cart$/);
      await expect(mainOf(page).getByRole("listitem")).toHaveCount(2);
      await expect(headerCartLink(page, 3)).toBeVisible();
      expect(await readCartRaw(page)).toBe(entries[KEYS.cart]);
      expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
    });
  }

  test("Registration returned=google with a verified Session and no Continuation: Mypage (the same order as Login)", async ({
    page,
  }) => {
    await openReturn(page, googleReturnPath("register"), {
      ...sessionEntry(EMAIL.demo),
      ...cartEntriesWithExternal([entryLine(OFFERING.regular, 1)], "pending"),
    });
    await expect(page).toHaveURL(/\/mypage$/);
    expect(urlOf(page).search).toBe("");
    expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
  });

  for (const name of PAGES) {
    test(`${name} returned=google with an Email-unverified Session: PG-AUTH-002 with the Continuation kept, the Cart kept, and the result received`, async ({
      page,
    }) => {
      await openReturn(page, googleReturnPath(name, "cart"), {
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
    test(`${name} returned=google as a Guest (the link was opened elsewhere): the failure alert, the Cart and the pending record stay, and returned leaves the URL`, async ({
      page,
    }) => {
      const entries = cartEntriesWithExternal(LINES, "pending");
      await openReturn(page, googleReturnPath(name, "cart"), entries);
      await expect(heading1(page)).toHaveText(pageHeading(name));
      await expect(alertsIn(page)).toHaveCount(1);
      await expect(alertsIn(page)).toHaveText(copy.auth.google.failed);
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
    test(`${name} notice=google-failed: the failure alert is shown and the pending record is kept`, async ({
      page,
    }) => {
      const entries = cartEntriesWithExternal(LINES, "pending");
      await openReturn(page, googleFailurePath(name, "cart"), entries);
      await expect(alertsIn(page)).toHaveCount(1);
      await expect(alertsIn(page)).toHaveText(copy.auth.google.failed);
      expect(await readSession(page)).toEqual({ kind: "guest" });
      expect(await readCartRaw(page)).toBe(entries[KEYS.cart]);
      expect(await lifecycleOf(page)).toEqual({
        version: 1,
        provenance: "guest",
        external: "pending",
      });
    });
  }

  test("unknown returned and notice values are ignored: no alert, no navigation, no change", async ({
    page,
  }) => {
    const entries = cartEntriesWithExternal(LINES, "pending");
    await openReturn(page, "/account/login?returned=github&notice=github-failed", entries);
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

  test("a superseded record is received once by the screen shown by the return: the Cart is cleared and the record is gone", async ({
    page,
  }) => {
    await openReturn(page, googleReturnPath("login"), {
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
    await openReturn(page, googleReturnPath("login", "cart"), entries);
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
    await openReturn(page, googleReturnPath("login"), {
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

  test("the Browser's back and forward never return to the returned=google entry", async ({
    page,
  }) => {
    await fixClock(page);
    await seedLocalStorage(page, cartEntriesWithExternal(LINES, "pending"));
    await gotoHydrated(page, "/");
    await gotoHydrated(page, googleReturnPath("login", "cart"));
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
    for (const path of ["/cart", "/account/login", "/mypage"]) {
      await gotoHydrated(page, path);
      await expect(headerCartLink(page, 3)).toBeVisible();
      expect((await lifecycleOf(page))?.external, path).toBe("pending");
    }
  });
});

test.describe("TC-PG-AUTH-003-313 a signed-in visitor (verified or not) cannot start Google: the button is disabled with the reason attached, nothing is followed, and Email+Password stays (SPEC-050 15.0, FR-CRT-012 external-completion rule step 1)", () => {
  const sessions = [
    ["a verified Session", sessionEntry(EMAIL.demo)],
    ["an Email-unverified Session", { [KEYS.session]: unverifiedSession() }],
  ] as const;

  for (const [label, entries] of sessions) {
    for (const name of PAGES) {
      test(`${name} with ${label}: the Google start is natively disabled and described by the Logout hint; a press goes nowhere; the existing form is shown`, async ({
        page,
      }) => {
        const documents = watchDocumentRequests(page);
        await openAuthPage(page, name, "", entries);
        await chooseMethod(page, copy.auth.method.google);
        const start = googleStartButton(page, name);
        await expect(start).toBeDisabled();
        await expect(start).toHaveJSProperty("disabled", true);
        expect(await describedText(start)).toContain(copy.auth.google.signedIn);
        const before = page.url();
        await start.click({ force: true });
        await page.waitForLoadState("networkidle");
        expect(page.url()).toBe(before);
        expect(documents.filter((url) => url.startsWith("/dev/"))).toEqual([]);
        // Refused before anything is recorded: no pending record is written.
        expect((await lifecycleOf(page))?.external).toBeUndefined();

        // Email+Password is still offered (the spec does not say whether signing in again is allowed).
        await chooseMethod(page, copy.auth.method.password);
        await expect(field(page, copy.auth.field.email.label)).toBeVisible();
        await expect(field(page, copy.auth.field.password.label)).toBeVisible();
        await expect(
          submitButton(page, name === "login" ? copy.auth.login.submit : copy.auth.register.submit),
        ).toBeVisible();
      });
    }
  }

  test("a Guest sees the start enabled and no signed-in hint", async ({ page }) => {
    await openAuthPage(page, "login");
    await chooseMethod(page, copy.auth.method.google);
    await expect(googleStartButton(page, "login")).toBeEnabled();
    expect(await describedText(googleStartButton(page, "login"))).not.toContain(
      copy.auth.google.signedIn,
    );
    await expect(mainOf(page)).not.toContainText(copy.auth.google.signedIn);
  });

  test("a Session that becomes valid in another tab disables the start on the open page", async ({
    page,
  }) => {
    await openAuthPage(page, "login");
    await chooseMethod(page, copy.auth.method.google);
    await expect(googleStartButton(page, "login")).toBeEnabled();
    const other = await openSecondTab(page.context());
    await gotoHydrated(other, "/account/login");
    await loginWith(other, EMAIL.demo);
    await expect(other).toHaveURL(/\/mypage$/);
    await page.bringToFront();
    await expect(googleStartButton(page, "login")).toBeDisabled();
    expect(await describedText(googleStartButton(page, "login"))).toContain(
      copy.auth.google.signedIn,
    );
  });
});

test.describe("TC-FR-CRT-012-020 the screens: a result that arrives after another method signed in is received as a different Account's Cart boundary, a failed return keeps the Cart, and a start without another login keeps the Guest Cart (FR-CRT-012 external-completion rule steps 5 to 7)", () => {
  /** Guest on page 1 with one Entry line; Google started and left waiting on the stand-in screen. */
  async function startWithGuestCart(page: Page): Promise<void> {
    await openAuthPage(page, "login", "", cartEntries([entryLine(OFFERING.regular, 1)], "guest"));
    await expect(headerCartLink(page, 1)).toBeVisible();
    await startGoogle(page, "login");
    expect(await lifecycleOf(page)).toEqual({
      version: 1,
      provenance: "guest",
      external: "pending",
    });
  }

  /** Page 2 of the same browser: Email+Password Login as demo@example.com, then one more Entry in the Cart. */
  async function loginOnSecondPageAndAddEntry(page: Page): Promise<Page> {
    const second = await openSecondTab(page.context());
    await gotoHydrated(second, "/account/login");
    await loginWith(second, EMAIL.demo);
    await expect(second).toHaveURL(/\/mypage$/);
    // The Login kept the Guest Cart and turned the pending record into a superseded one.
    expect((await lifecycleOf(second))?.external).toBe("superseded");
    await gotoHydrated(second, "/entry");
    const offering = mainOf(second)
      .getByRole("listitem")
      .filter({
        has: second.getByRole("heading", { name: offeringName(OFFERING.regular), exact: true }),
      });
    await quantityInput(offering).fill("1");
    await addButton(offering).click();
    await expect(headerCartLink(second, 2)).toBeVisible();
    return second;
  }

  test("start, another method signs in as demo@example.com and adds an Entry, then Google succeeds for google.new@example.com: the Cart is empty and the record is gone", async ({
    page,
  }) => {
    await startWithGuestCart(page);
    const second = await loginOnSecondPageAndAddEntry(page);

    await page.bringToFront();
    await standInButton(page, "allowNew").click();
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readSession(page)).toEqual({
      kind: "authenticated",
      email: NEW_GOOGLE_EMAIL,
      emailVerified: true,
    });
    expect(await readCartRaw(page)).toBeNull();
    expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
    await expect(headerCartLink(page, null)).toBeVisible();
    await gotoHydrated(page, "/cart");
    await expect(heading1(page)).toHaveText(copy.cart.heading);
    await expect(mainOf(page)).toContainText(copy.cart.empty);
    await expect(mainOf(page).getByRole("listitem")).toHaveCount(0);
    await expect(headerCartLink(page, null)).toBeVisible();
    await second.close();
  });

  test("the failed return of a start that another method has superseded keeps the Cart and the record; the next successful return then clears it", async ({
    page,
  }) => {
    await startWithGuestCart(page);
    const second = await loginOnSecondPageAndAddEntry(page);

    await page.bringToFront();
    await standInButton(page, "cancel").click();
    await expect(page).toHaveURL(/\/account\/login/);
    await expect(alertsIn(page)).toHaveText(copy.auth.google.failed);
    // The Cart of demo@example.com is shown unchanged and the record is not consumed.
    await expect(headerCartLink(page, 2)).toBeVisible();
    expect((await lifecycleOf(page))?.external).toBe("superseded");

    // A later success (the stand-in is opened directly: a retry of the same start) is received and clears the Cart.
    await openMockGoogle(page, "login");
    await standInButton(page, "allowNew").click();
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readCartRaw(page)).toBeNull();
    expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
    await expect(headerCartLink(page, null)).toBeVisible();
    await second.close();
  });

  test("comparison: a start with no other login keeps the Guest Cart when Google succeeds, for a new account and for an existing one", async ({
    page,
  }) => {
    await startWithGuestCart(page);
    const cartBefore = await readCartRaw(page);
    await standInButton(page, "allowNew").click();
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readCartRaw(page)).toBe(cartBefore);
    await expect(headerCartLink(page, 1)).toBeVisible();
    expect(await lifecycleOf(page)).toEqual({ version: 1, provenance: "authenticated" });
  });

  test("a Logout between the start and the result removes the record and the Cart; a success that arrives afterwards finds nothing to keep", async ({
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
    await standInButton(page, "allowNew").click();
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readCartRaw(page)).toBeNull();
    await expect(headerCartLink(page, null)).toBeVisible();
    await second.close();
  });
});
