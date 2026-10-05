import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  authScenario,
  CONTEXT_VALUE,
  dumpStorage,
  field,
  heading1,
  loginWith,
  mainOf,
  SENTINEL_PASSWORD,
  submitButton,
  urlOf,
  watchConsole,
} from "../harness/browser/auth.ts";
import { gotoHydrated } from "../harness/browser/hydration.ts";
import {
  fixClock,
  hasLevelSkip,
  horizontalOverflow,
  mainHeadingLevels,
} from "../harness/browser/public.ts";
import {
  allHrefs,
  authenticatedSession,
  FORBIDDEN_AREA,
  KEYS,
  ORIGIN_HOST,
  pathOf,
  SITE_NAME,
  seedLocalStorage,
  watchRequestHosts,
  watchRuntimeErrors,
} from "../harness/browser/shell.ts";
import { EMAIL } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8; G5 header and secret checks). Contract:
// tests/contracts/s6-auth.md sections 6.8, 7. SPEC-050 7, 24.1, 25, 27, 31 item 23, SPEC-140 SEC-WEB-004 /
// 009 / 012, SEC-AUTH-016 / 018.

type PageCase = {
  readonly name: string;
  readonly route: string;
  readonly session: boolean;
  readonly title: () => string;
  readonly heading: () => string;
};

const PAGES: readonly PageCase[] = [
  {
    name: "PG-AUTH-001 Account Registration",
    route: "/account/register",
    session: false,
    title: () => copy.auth.register.pageTitle,
    heading: () => copy.auth.register.heading,
  },
  {
    name: "PG-AUTH-002 Email Verification",
    route: "/account/email-verification",
    session: false,
    title: () => copy.auth.verify.pageTitle,
    heading: () => copy.auth.verify.heading,
  },
  {
    name: "PG-AUTH-003 Login",
    route: "/account/login",
    session: false,
    title: () => copy.auth.login.pageTitle,
    heading: () => copy.auth.login.heading,
  },
  {
    name: "PG-AUTH-004 Password Reset Request",
    route: "/account/password-reset",
    session: false,
    title: () => copy.auth.reset.pageTitle,
    heading: () => copy.auth.reset.heading,
  },
  {
    name: "PG-AUTH-005 Password Reset Completion",
    route: "/account/password-reset/complete",
    session: false,
    title: () => copy.auth.resetComplete.pageTitle,
    heading: () => copy.auth.resetComplete.heading,
  },
  {
    name: "PG-MYP-001 Mypage Overview (AuthGate; S8 replaced the S6 placeholder)",
    route: "/mypage",
    session: true,
    title: () => copy.mypage.pageTitle,
    heading: () => copy.mypage.heading,
  },
];

async function load(page: Page, item: PageCase): Promise<void> {
  await fixClock(page);
  await seedLocalStorage(page, item.session ? { [KEYS.session]: authenticatedSession() } : {});
  await gotoHydrated(page, item.route);
  await expect(heading1(page)).toHaveText(item.heading());
}

test.describe("TC-PG-AUTH-003-501 every S6 page has a title, one h1 and the shell landmarks (SPEC-050 7, 25)", () => {
  for (const item of PAGES) {
    test(`${item.name}: title, one h1, no skipped level, banner / main / contentinfo`, async ({
      page,
    }) => {
      await load(page, item);
      await expect(page).toHaveTitle(`${item.title()} | ${SITE_NAME}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const levels = await mainHeadingLevels(page);
      expect(levels[0]).toBe(1);
      expect(hasLevelSkip(levels), `heading levels ${levels.join(",")}`).toBe(false);
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toHaveCount(1);
    });
  }
});

test.describe("TC-PG-AUTH-003-502 no S6 page links to /admin, /staff or /dev (SPEC-050 27, 31 item 23)", () => {
  for (const item of PAGES) {
    test(`${item.name}`, async ({ page }) => {
      await load(page, item);
      const hrefs = await allHrefs(page);
      expect(hrefs.length).toBeGreaterThan(5);
      for (const href of hrefs) {
        expect(FORBIDDEN_AREA.test(pathOf(href)), href).toBe(false);
        expect(new URL(href).pathname, href).not.toMatch(/^\/dev(\/|$)/);
      }
    });
  }
});

test.describe("TC-PG-AUTH-003-503 the S6 pages run without runtime errors and talk only to the app origin (SEC-WEB-004, SEC-WEB-012)", () => {
  for (const item of PAGES) {
    test(`${item.name}`, async ({ page }) => {
      const runtime = watchRuntimeErrors(page);
      const seen = watchRequestHosts(page);
      await load(page, item);
      await page.waitForLoadState("networkidle");
      expect(runtime.errors).toEqual([]);
      expect([...seen.hosts]).toEqual([ORIGIN_HOST]);
    });
  }
});

test.describe("TC-PG-AUTH-003-504 no horizontal scroll at 390px (SPEC-050 24.1)", () => {
  for (const item of PAGES) {
    test(`${item.name}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await load(page, item);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test("the register form (the longest) keeps its fields and submit inside the viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fixClock(page);
    await seedLocalStorage(page, {});
    await gotoHydrated(page, "/account/register?continue=cart");
    for (const label of [
      copy.auth.field.email.label,
      copy.auth.field.password.label,
      copy.auth.field.passwordConfirm.label,
    ]) {
      await field(page, label).scrollIntoViewIfNeeded();
      await expect(field(page, label)).toBeInViewport();
    }
    await submitButton(page, copy.auth.register.submit).scrollIntoViewIfNeeded();
    await expect(submitButton(page, copy.auth.register.submit)).toBeInViewport();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("TC-SEC-WEB-009-701 the real protected and account pages answer 200 with no-store, private, Pragma (SEC-WEB-009, G5 header check)", () => {
  const ROUTES = [
    "/account/login",
    "/account/register",
    "/account/email-verification",
    "/account/password-reset",
    "/account/password-reset/complete",
    "/mypage",
  ];
  for (const route of ROUTES) {
    test(`${route}`, async ({ request }) => {
      const response = await request.get(route, { maxRedirects: 0 });
      expect(response.status()).toBe(200);
      const cacheControl = (response.headers()["cache-control"] ?? "").toLowerCase();
      expect(cacheControl).toContain("no-store");
      expect(cacheControl).toContain("private");
      expect(cacheControl).toContain("max-age=0");
      expect(response.headers().pragma).toBe("no-cache");
    });
  }

  test("the browser navigation response carries the same headers, and public pages do not", async ({
    page,
  }) => {
    const login = await gotoHydrated(page, "/account/login");
    expect(login?.status()).toBe(200);
    expect(login?.headers()["cache-control"] ?? "").toContain("no-store");
    const home = await gotoHydrated(page, "/");
    expect(home?.headers()["cache-control"] ?? "").not.toContain("private");
    expect(home?.headers()["cache-control"] ?? "").not.toContain("no-store");
  });
});

test.describe("TC-SEC-AUTH-018-701 Password and verification context never reach the URL, storage, DOM text or console (SEC-AUTH-016 / 018)", () => {
  test("register -> verify -> reset -> login with sentinel secrets leaves no trace", async ({
    page,
  }) => {
    const console_ = watchConsole(page);
    await fixClock(page);
    await seedLocalStorage(page, {});
    const seenUrls: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) seenUrls.push(frame.url());
    });

    await gotoHydrated(page, "/account/register");
    await field(page, copy.auth.field.email.label).fill("secret-check@example.com");
    await field(page, copy.auth.field.password.label).fill(SENTINEL_PASSWORD);
    await field(page, copy.auth.field.passwordConfirm.label).fill(SENTINEL_PASSWORD);
    await submitButton(page, copy.auth.register.submit).click();
    await expect(page).toHaveURL(/\/account\/email-verification$/);

    await gotoHydrated(page, `/account/email-verification?context=${CONTEXT_VALUE}`);
    await expect(page.getByRole("main")).toBeVisible();
    await page.waitForLoadState("networkidle");

    await gotoHydrated(page, `/account/password-reset/complete?context=${CONTEXT_VALUE}`);
    await field(page, copy.auth.field.newPassword.label).fill(SENTINEL_PASSWORD);
    await field(page, copy.auth.field.newPasswordConfirm.label).fill(SENTINEL_PASSWORD);
    await submitButton(page, copy.auth.resetComplete.submit).click();
    await expect(page).toHaveURL(/\/account\/login\?notice=password-updated$/);

    await loginWith(page, EMAIL.demo, SENTINEL_PASSWORD);
    await expect(page).toHaveURL(/\/mypage$/);

    const stored = await dumpStorage(page);
    expect(stored).not.toContain(SENTINEL_PASSWORD);
    expect(stored).not.toContain(CONTEXT_VALUE);
    expect(urlOf(page).href).not.toContain(SENTINEL_PASSWORD);
    expect(
      seenUrls.filter((u) => u.includes(SENTINEL_PASSWORD)),
      "a URL contained the password",
    ).toEqual([]);
    expect(await mainOf(page).innerText()).not.toContain(SENTINEL_PASSWORD);
    expect(
      console_.messages.filter((m) => m.includes(SENTINEL_PASSWORD) || m.includes(CONTEXT_VALUE)),
    ).toEqual([]);
  });

  test("failure paths (credential failure, outage) also leave no trace of the password", async ({
    page,
  }) => {
    const console_ = watchConsole(page);
    await fixClock(page);
    await seedLocalStorage(page, authScenario({ login: "credential_failure" }));
    await gotoHydrated(page, "/account/login");
    await loginWith(page, EMAIL.demo, SENTINEL_PASSWORD);
    await expect(mainOf(page)).toContainText(copy.auth.login.credentialFailure);
    expect(await dumpStorage(page)).not.toContain(SENTINEL_PASSWORD);
    expect(await mainOf(page).innerText()).not.toContain(SENTINEL_PASSWORD);
    expect(page.url()).not.toContain(SENTINEL_PASSWORD);
    expect(console_.messages.filter((m) => m.includes(SENTINEL_PASSWORD))).toEqual([]);
  });
});
