import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { formatBusinessDate } from "../../apps/web/src/presentation/format/datetime.ts";
import { CONTEXT_VALUE, loginWith } from "../harness/browser/auth.ts";
import { gotoHydrated, reloadHydrated } from "../harness/browser/hydration.ts";
import { dbJson, expectedAnnouncements, fixClock } from "../harness/browser/public.ts";
import { heading1, mainOf, openAs } from "../harness/browser/purchase.ts";
import {
  authenticatedSession,
  KEYS,
  SITE_NAME,
  seedLocalStorage,
} from "../harness/browser/shell.ts";
import {
  ANNOUNCEMENT,
  D1,
  D2,
  EMAIL,
  GOODS,
  GOODS_ITEM,
  ORDER,
  RESERVATION,
  SLOT,
  TICKET,
} from "../harness/mock-seed.ts";
import { REPO_ROOT } from "../harness/script-fixtures.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s3-layout.md section 13 (static hosting)
// and tests/contracts/s9-finalize.md section 8. The Web app is a static SPA served from apps/web/dist by
// scripts/serve-web-dist.mts with dist/_headers applied (SPEC-180 13.1, SPEC-190 DEV-WEB-001, SPEC-050 5.4).
// This suite checks the hosting contract; it does not prove the API, DB or Cloudflare Pages behaviour.

const DIST = join(REPO_ROOT, "apps", "web", "dist");
const UNKNOWN_UUID = "0d000000-0000-4000-8000-0000000009ff";

const m = copy.mypage;
const title = (page: string): string => `${page} | ${SITE_NAME}`;

async function open(page: Page, route: string, session: boolean) {
  await fixClock(page);
  await seedLocalStorage(page, {
    ...dbJson(() => {}),
    ...(session ? { [KEYS.session]: authenticatedSession() } : {}),
  });
  return gotoHydrated(page, route);
}

interface UrlCase {
  readonly route: string;
  readonly session: boolean;
  /** The expected h1 text. */
  readonly h1: () => string;
  readonly title: (() => string) | null;
}

function announcementTitle(): string {
  const found = expectedAnnouncements().find((a) => a.announcementRef === ANNOUNCEMENT.latest);
  if (found === undefined) throw new Error("seed has no latest announcement");
  return found.title;
}

// The 28 general URL patterns and the 3 under /dev, each with a synthetic ref that resolves in the mock seed.
const CASES: readonly UrlCase[] = [
  { route: "/", session: false, h1: () => SITE_NAME, title: () => SITE_NAME },
  {
    route: "/announcements",
    session: false,
    h1: () => copy.announcements.heading,
    title: () => title(copy.pageTitle.announcements),
  },
  {
    route: `/announcements/${ANNOUNCEMENT.latest}`,
    session: false,
    h1: announcementTitle,
    title: () => title(copy.pageTitle.announcementDetail),
  },
  {
    route: "/entry",
    session: false,
    h1: () => copy.entry.heading,
    title: () => title(copy.entry.pageTitle),
  },
  {
    route: "/karaoke",
    session: false,
    h1: () => copy.karaoke.guide.heading,
    title: () => title(copy.pageTitle.karaoke),
  },
  {
    route: `/karaoke/schedule/${D1}`,
    session: false,
    h1: () => copy.karaoke.day.heading,
    title: () => title(copy.pageTitle.karaokeDay),
  },
  {
    route: `/karaoke/slots/${SLOT.d1_1000}`,
    session: false,
    h1: () => copy.karaoke.slotDetail.heading,
    title: () => title(copy.pageTitle.karaokeSlot),
  },
  {
    route: "/goods",
    session: false,
    h1: () => copy.goods.list.heading,
    title: () => title(copy.pageTitle.goods),
  },
  {
    route: `/goods/${GOODS.tshirt}`,
    session: false,
    h1: () => copy.goods.detail.heading,
    title: () => title(copy.goods.detail.pageTitle),
  },
  {
    route: "/cart",
    session: false,
    h1: () => copy.cart.heading,
    title: () => title(copy.cart.pageTitle),
  },
  {
    route: "/account/register",
    session: false,
    h1: () => copy.auth.register.heading,
    title: () => title(copy.auth.register.pageTitle),
  },
  {
    route: "/account/email-verification",
    session: false,
    h1: () => copy.auth.verify.heading,
    title: () => title(copy.auth.verify.pageTitle),
  },
  {
    route: "/account/login",
    session: false,
    h1: () => copy.auth.login.heading,
    title: () => title(copy.auth.login.pageTitle),
  },
  {
    route: "/account/password-reset",
    session: false,
    h1: () => copy.auth.reset.heading,
    title: () => title(copy.auth.reset.pageTitle),
  },
  {
    route: "/account/password-reset/complete",
    session: false,
    h1: () => copy.auth.resetComplete.heading,
    title: () => title(copy.auth.resetComplete.pageTitle),
  },
  {
    route: `/purchase/orders/${ORDER.confirmedComposite}`,
    session: true,
    h1: () => copy.purchase.heading,
    title: () => title(copy.purchase.pageTitle),
  },
  { route: "/mypage", session: true, h1: () => m.heading, title: () => title(m.pageTitle) },
  {
    route: "/mypage/profile",
    session: true,
    h1: () => m.profile.heading,
    title: () => title(m.profile.pageTitle),
  },
  {
    route: "/mypage/orders",
    session: true,
    h1: () => m.orders.heading,
    title: () => title(m.orders.pageTitle),
  },
  {
    route: `/mypage/orders/${ORDER.confirmedComposite}`,
    session: true,
    h1: () => m.orders.detail.heading,
    title: () => title(m.orders.detail.pageTitle),
  },
  {
    route: "/mypage/entry-tickets",
    session: true,
    h1: () => m.entryTickets.heading,
    title: () => title(m.entryTickets.pageTitle),
  },
  {
    route: `/mypage/entry-tickets/${TICKET.valid}`,
    session: true,
    h1: () => m.entryTickets.detail.heading,
    title: () => title(m.entryTickets.detail.pageTitle),
  },
  {
    route: `/mypage/entry-tickets/${TICKET.valid}/qr`,
    session: true,
    h1: () => copy.qr.ENTRY,
    title: () => title(copy.qr.ENTRY),
  },
  {
    route: "/mypage/karaoke",
    session: true,
    h1: () => m.reservations.heading,
    title: () => title(m.reservations.pageTitle),
  },
  {
    route: `/mypage/karaoke/${RESERVATION.valid}`,
    session: true,
    h1: () => m.reservations.detail.heading,
    title: () => title(m.reservations.detail.pageTitle),
  },
  {
    route: `/mypage/karaoke/${RESERVATION.valid}/qr`,
    session: true,
    h1: () => copy.qr.KARAOKE,
    title: () => title(copy.qr.KARAOKE),
  },
  {
    route: "/mypage/goods",
    session: true,
    h1: () => m.goodsItems.heading,
    title: () => title(m.goodsItems.pageTitle),
  },
  {
    route: `/mypage/goods/${GOODS_ITEM.fulfillable}`,
    session: true,
    h1: () => m.goodsItems.detail.heading,
    title: () => title(m.goodsItems.detail.pageTitle),
  },
  {
    route: "/dev/scenarios",
    session: false,
    h1: () => "モックシナリオ",
    title: () => SITE_NAME,
  },
  {
    route: `/dev/mock-checkout/${UNKNOWN_UUID}`,
    session: false,
    h1: () => copy.mockCheckout.heading,
    title: () => title(copy.mockCheckout.pageTitle),
  },
  {
    route: "/dev/error-probe",
    session: false,
    h1: () => copy.errorPage.title,
    title: null,
  },
];

test.describe("TC-STACK-008-301 every application URL works by direct access and after a reload (DEV-WEB-001, SPEC-050 5.4)", () => {
  test("covers all 31 URL patterns once", () => {
    expect(CASES).toHaveLength(31);
    expect(new Set(CASES.map((c) => c.route)).size).toBe(31);
  });

  for (const c of CASES) {
    const label = c.route.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":ref");
    test(`${label}: HTTP 200 shell, the expected h1, the same after a reload`, async ({ page }) => {
      const response = await open(page, c.route, c.session);
      expect(response?.status()).toBe(200);
      expect(response?.headers()["content-type"] ?? "").toMatch(/^text\/html/);
      await expect(heading1(page)).toHaveCount(1, { timeout: 15_000 });
      await expect(heading1(page)).toHaveText(c.h1(), { timeout: 15_000 });
      if (c.title !== null) await expect(page).toHaveTitle(c.title());
      await expect(page.getByRole("main")).toHaveCount(1);

      const reloaded = await reloadHydrated(page);
      expect(reloaded?.status()).toBe(200);
      await expect(heading1(page)).toHaveText(c.h1(), { timeout: 15_000 });
      if (c.title !== null) await expect(page).toHaveTitle(c.title());
      expect(new URL(page.url()).pathname).toBe(c.route);
    });
  }
});

test.describe("TC-STACK-008-302 an unknown URL is the Not Found view, outside the AuthGate (PG-XFN-002, SPEC-050 19.1)", () => {
  for (const route of ["/no-such/deeper", "/mypage/no-such", "/dev/no-such"]) {
    test(`${route} shows Not Found for a Guest without a redirect`, async ({ page }) => {
      await fixClock(page);
      const response = await gotoHydrated(page, route);
      expect(response?.status()).toBe(200);
      await expect(heading1(page)).toHaveText(copy.notFound.title);
      await expect(heading1(page)).toHaveCount(1);
      await expect(mainOf(page)).toContainText(copy.notFound.description);
      expect(new URL(page.url()).pathname).toBe(route);
      await expect(mainOf(page)).not.toContainText(copy.auth.gate.redirecting);
      await expect(page.getByRole("banner")).toBeVisible();
      await expect(page.getByRole("contentinfo")).toBeVisible();
    });
  }

  test("/mypage/no-such is also Not Found for a signed-in user, and the Mypage navigation is absent", async ({
    page,
  }) => {
    await open(page, "/mypage/no-such", true);
    await expect(heading1(page)).toHaveText(copy.notFound.title);
    await expect(page.getByRole("navigation", { name: m.nav.label })).toHaveCount(0);
  });
});

test.describe("TC-STACK-008-303 a missing asset is a non-HTML 404 (SPEC-180 13.1)", () => {
  for (const path of ["/assets/missing-r39x.js", "/mock/sponsors/__broken__.svg"]) {
    test(`${path}`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(404);
      expect(response.headers()["content-type"] ?? "").not.toMatch(/html/);
      expect(await response.text()).not.toMatch(/<html|<!doctype/i);
    });
  }
});

/** The `/*` rule of dist/_headers: the CSP and the other values the response must carry. */
function wildcardRule(): Map<string, string> {
  const lines = readFileSync(join(DIST, "_headers"), "utf8").split("\n");
  const start = lines.indexOf("/*");
  expect(start, "dist/_headers has a /* rule").toBeGreaterThanOrEqual(0);
  const rule = new Map<string, string>();
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("  ")) break;
    const at = line.indexOf(":");
    rule.set(line.slice(2, at).toLowerCase(), line.slice(at + 1).trim());
  }
  return rule;
}

const PROTECTED_ROUTES = [
  "/account/login",
  "/auth/x",
  `/purchase/orders/${ORDER.confirmedComposite}`,
  "/mypage",
  "/admin",
  "/staff/x",
];

test.describe("TC-STACK-008-304 page responses carry the security headers, and no-store only on protected prefixes (SEC-WEB-003 / 007 / 008 / 009 / 010, SPEC-140 22)", () => {
  test("(a)(d) the CSP equals dist/_headers, has no unsafe-inline / unsafe-eval in script-src, and the other security headers are present", async ({
    request,
  }) => {
    const rule = wildcardRule();
    for (const path of ["/", "/goods", "/account/login", "/mypage", "/admin"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      const headers = response.headers();
      expect(headers["content-security-policy"], path).toBe(rule.get("content-security-policy"));
      const scriptSrc =
        (headers["content-security-policy"] ?? "")
          .split("; ")
          .find((part) => part.startsWith("script-src ")) ?? "";
      expect(scriptSrc, path).toMatch(/^script-src 'self'/);
      expect(scriptSrc, path).not.toMatch(/unsafe-inline|unsafe-eval/);
      expect(headers["content-security-policy"], path).toContain("frame-src 'none'");
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(headers["x-frame-options"], path).toBe("DENY");
      expect(headers["strict-transport-security"], path).toBe(
        "max-age=63072000; includeSubDomains",
      );
      expect(headers["cross-origin-opener-policy"], path).toBe("same-origin");
      const permissions = headers["permissions-policy"] ?? "";
      expect(permissions, path).toContain("camera=()");
      expect(permissions, path).not.toMatch(/camera=\((self|\*)/);
    }
  });

  test("(a) a browser navigation response carries the same CSP", async ({ page }) => {
    const response = await gotoHydrated(page, "/");
    expect(response?.headers()["content-security-policy"]).toBe(
      wildcardRule().get("content-security-policy"),
    );
  });

  test("(b) public pages are not private / no-store and use the default Referrer-Policy", async ({
    request,
  }) => {
    for (const path of ["/", "/goods"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      const headers = response.headers();
      expect(headers["cache-control"] ?? "", path).not.toMatch(/private|no-store/);
      expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    }
  });

  test("(c) every protected prefix is no-store with Pragma and an effective no-referrer", async ({
    request,
  }) => {
    for (const path of PROTECTED_ROUTES) {
      const response = await request.get(path, { maxRedirects: 0 });
      const headers = response.headers();
      expect(response.status(), path).toBe(200);
      expect(headers["cache-control"], path).toBe("no-store, private, max-age=0");
      expect(headers.pragma, path).toBe("no-cache");
      const last = (headers["referrer-policy"] ?? "").split(",").pop()?.trim();
      expect(last, path).toBe("no-referrer");
    }
  });
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

test.describe("TC-STACK-008-305 the built artifact has no personal data, no inline script and no source map (SEC-WEB-011, DEV-WEB-002, INF-VCL-005, SPEC-050 5.4)", () => {
  test("the static shell is an empty #root with no text, no seed data and no inline script", () => {
    expect(existsSync(DIST), "apps/web/dist was built by the webServer").toBe(true);
    const htmlFiles = filesUnder(DIST).filter((f) => f.endsWith(".html"));
    expect(htmlFiles.length).toBeGreaterThan(0);
    for (const file of htmlFiles) {
      const html = readFileSync(file, "utf8");
      const name = file.slice(DIST.length + 1);
      expect(html, name).toMatch(/<div id="root"[^>]*><\/div>/);
      const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? "";
      const text = body
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, "")
        .trim();
      expect(text, `${name}: no text in the shell`).toBe("");
      for (const needle of [EMAIL.demo, "デモ太郎", "r39x1.", "r39x.mock"]) {
        expect(html, `${name}: ${needle}`).not.toContain(needle);
      }
      expect(html, name).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    }
  });

  test("dist has no source map", () => {
    const maps = filesUnder(DIST).filter((f) => f.endsWith(".map"));
    expect(maps.map((f) => f.slice(DIST.length + 1))).toEqual([]);
  });

  test("generate-web-headers --check passes: dist/_headers matches the built HTML (CSP hashes)", () => {
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.SPONSOR_IMAGE_ALLOWED_ORIGINS;
    const result = spawnSync(
      process.execPath,
      [join(REPO_ROOT, "scripts", "generate-web-headers.mts"), "--dist", DIST, "--check"],
      { cwd: REPO_ROOT, encoding: "utf8", env: env as NodeJS.ProcessEnv, timeout: 60_000 },
    );
    expect(`${result.stdout}\n${result.stderr}`, "generate-web-headers --check").not.toMatch(
      /^ERROR/m,
    );
    expect(result.status).toBe(0);
  });
});

/** sessionStorage as text, without the keys the test harness itself writes (seeding flags, test-only switches). */
async function sessionStorageDump(page: Page): Promise<string> {
  return page.evaluate(() => {
    const entries: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key === null || key.startsWith("__r39x_seeded_") || key.startsWith("test-only")) continue;
      entries.push(`${key}=${window.sessionStorage.getItem(key) ?? ""}`);
    }
    return entries.join("\n");
  });
}

test.describe("TC-STACK-008-306 the pages run under the CSP and scroll restoration stores no URL (SEC-WEB-003, SEC-AUTH-018)", () => {
  const PAGES: readonly (readonly [string, boolean])[] = [
    ["/", false],
    ["/goods", false],
    ["/cart", false],
    ["/account/login", false],
    ["/mypage", true],
    [`/mypage/entry-tickets/${TICKET.valid}/qr`, true],
    [`/dev/mock-checkout/${UNKNOWN_UUID}`, false],
  ];

  for (const [route, session] of PAGES) {
    test(`${route.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":ref")}: no CSP violation event and no "Refused to" console output`, async ({
      page,
    }) => {
      const refused: string[] = [];
      page.on("console", (message) => {
        if (message.text().includes("Refused to")) refused.push(message.text().slice(0, 160));
      });
      await page.addInitScript(() => {
        const store: string[] = [];
        (window as unknown as { __cspViolations: string[] }).__cspViolations = store;
        document.addEventListener("securitypolicyviolation", (event) => {
          store.push(`${event.violatedDirective}`);
        });
      });
      await open(page, route, session);
      await expect(heading1(page)).toHaveCount(1, { timeout: 15_000 });
      await expect(heading1(page)).not.toHaveText("", { timeout: 15_000 });
      const violations = await page.evaluate(
        () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
      );
      expect(violations).toEqual([]);
      expect(refused).toEqual([]);
    });
  }

  test("after the authentication flows sessionStorage holds no URL, path or context value", async ({
    page,
  }) => {
    await fixClock(page);
    await seedLocalStorage(
      page,
      dbJson(() => {}),
    );
    await gotoHydrated(page, `/account/password-reset/complete?context=${CONTEXT_VALUE}`);
    await expect(heading1(page)).toHaveText(copy.auth.resetComplete.heading);
    expect(page.url()).not.toContain(CONTEXT_VALUE);
    await gotoHydrated(page, "/account/login?continue=/mypage");
    await expect(heading1(page)).toHaveText(copy.auth.login.heading);
    await loginWith(page, EMAIL.demo);
    await expect(page).toHaveURL(/\/mypage$/, { timeout: 15_000 });
    await expect(heading1(page)).toHaveText(m.heading);
    await page.getByRole("banner").getByRole("link", { name: SITE_NAME, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: SITE_NAME })).toBeVisible();

    const dump = await sessionStorageDump(page);
    expect(dump).not.toContain(CONTEXT_VALUE);
    expect(dump).not.toMatch(/context=|continue=|\/account|\/mypage|https?:\/\//);
  });
});

test.describe("TC-STACK-008-307 a route whose param changes remounts its content (DEV-WEB-001)", () => {
  test("Karaoke day: the next-day link shows the next day and nothing of the previous one", async ({
    page,
  }) => {
    await open(page, `/karaoke/schedule/${D1}`, false);
    await expect(
      mainOf(page).getByRole("heading", { level: 2, name: formatBusinessDate(D1) }),
    ).toBeVisible({ timeout: 15_000 });
    await mainOf(page).getByRole("link", { name: copy.karaoke.day.next }).click();
    await expect(page).toHaveURL(new RegExp(`/karaoke/schedule/${D2}$`));
    await expect(
      mainOf(page).getByRole("heading", { level: 2, name: formatBusinessDate(D2) }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      mainOf(page).getByRole("heading", { level: 2, name: formatBusinessDate(D1) }),
    ).toHaveCount(0);
    await expect(mainOf(page).getByRole("link", { name: copy.karaoke.day.next })).toHaveCount(0);
  });

  test("Mypage orders: a history step between two order details shows the other order's content", async ({
    page,
  }) => {
    const detailText = async (ref: string): Promise<string> => {
      await openAs(page, `/mypage/orders/${ref}`);
      await expect(heading1(page)).toHaveText(m.orders.detail.heading, { timeout: 15_000 });
      await expect(page.getByRole("region", { name: copy.purchase.outcomeHeading })).toBeVisible({
        timeout: 15_000,
      });
      return mainOf(page).innerText();
    };
    const textA = await detailText(ORDER.confirmedEntry);
    const textB = await detailText(ORDER.confirmedGoods);
    expect(textA).not.toBe(textB);

    // Client-side only from here: list -> A, back, list -> B; then one history step of two returns to A.
    await openAs(page, "/mypage/orders");
    const link = (ref: string) => mainOf(page).locator(`a[href="/mypage/orders/${ref}"]`).first();
    await link(ORDER.confirmedEntry).click();
    await expect(page).toHaveURL(new RegExp(`/mypage/orders/${ORDER.confirmedEntry}$`));
    await expect.poll(() => mainOf(page).innerText(), { timeout: 15_000 }).toBe(textA);
    await page.goBack();
    await expect(page).toHaveURL(/\/mypage\/orders$/);
    await link(ORDER.confirmedGoods).click();
    await expect(page).toHaveURL(new RegExp(`/mypage/orders/${ORDER.confirmedGoods}$`));
    await expect.poll(() => mainOf(page).innerText(), { timeout: 15_000 }).toBe(textB);
    await page.evaluate(() => window.history.go(-2));
    await expect(page).toHaveURL(new RegExp(`/mypage/orders/${ORDER.confirmedEntry}$`));
    await expect.poll(() => mainOf(page).innerText(), { timeout: 15_000 }).toBe(textA);
  });
});

test.describe("TC-STACK-008-308 scrolling, history and the skip link behave as before (SPEC-050 25, DEV-WEB-001)", () => {
  test("a link to another page starts at the top; the browser Back returns to the previous page", async ({
    page,
  }) => {
    await open(page, "/", false);
    await expect(
      mainOf(page).getByRole("region", { name: copy.home.sections.faq, exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await mainOf(page).getByRole("link", { name: copy.home.shortcut.entry, exact: true }).click();
    await expect(page).toHaveURL(/\/entry$/);
    await expect(heading1(page)).toHaveText(copy.entry.heading);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: SITE_NAME })).toBeVisible();
  });

  test("the skip link focuses main#main-content and the focus survives the re-render", async ({
    page,
  }) => {
    await open(page, "/", false);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: copy.layout.skipLink, exact: true });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main-content$/);
    const main = page.locator("main#main-content");
    await expect(main).toBeFocused();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await expect(main).toBeFocused();
    await expect(page.locator("main")).toHaveCount(1);
  });
});
