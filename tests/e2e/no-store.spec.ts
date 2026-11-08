import { expect, test } from "@playwright/test";
import { rawRequest } from "../harness/web-dist.ts";

// TC-SEC-WEB-009-001 / -002 (UI mock suite, TST-E2E-004: auxiliary, not G8; G5 header check)
// SEC-WEB-009 as revised (SPEC-140 22, approach A): Cache-Control no-store + private + max-age=0 and Pragma
// no-cache are on every response except the exact paths of content-hashed static assets, whatever the spelling
// of the request path. The headers come from the `/*` rule of dist/_headers (SPEC-180 13.1) and are asserted
// regardless of the body: /auth, /admin and /staff have no page yet and are the static SPA shell (HTTP 200) with
// the same headers. Public routes are no-store as well (the cache permission of SEC-WEB-010 does not apply to static responses of the Browser-facing Web, which follow the static-response paragraph of SEC-WEB-009).
const NO_STORE = "no-store, private, max-age=0";

for (const path of [
  "/account/login",
  "/auth/anything",
  "/purchase/anything",
  "/mypage",
  "/admin",
  "/staff/anything",
]) {
  test(`TC-SEC-WEB-009-001 ${path} responds with Cache-Control no-store`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe(NO_STORE);
    expect(response.headers().pragma).toBe("no-cache");
  });
}

test("TC-SEC-WEB-009-001 public routes are also no-store under the revised SEC-WEB-009", async ({
  request,
}) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe(NO_STORE);
  expect(response.headers().pragma).toBe("no-cache");
});

// TC-SEC-WEB-009-002: alternative spellings of a protected path are not special. The request-level cases keep
// the percent escape as written (Playwright builds the URL with WHATWG URL, which does not decode `%6D`). The
// two cases that URL handling would rewrite (`//mypage` becomes a host, `%2e%2e` is folded) go over a raw
// socket request that sends the path exactly as given (tests/harness/web-dist.ts rawRequest).
const SYNTHETIC_UUID = "0d000000-0000-4000-8000-0000000000a2";

function expectNoStoreAndNoReferrer(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  label: string,
): void {
  const value = (name: string): string | undefined => {
    const found = headers[name];
    return Array.isArray(found) ? found.join(", ") : found;
  };
  expect(value("cache-control"), `${label} cache-control`).toBe(NO_STORE);
  expect(value("pragma"), `${label} pragma`).toBe("no-cache");
  expect(value("referrer-policy"), `${label} referrer-policy`).toBe("no-referrer");
}

for (const path of [
  "/%6Dypage",
  "/MYPAGE",
  "/mypage/",
  "/%61ccount/login",
  `/%6Dypage/orders/${SYNTHETIC_UUID}`,
  `/%70urchase/orders/${SYNTHETIC_UUID}`,
]) {
  test(`TC-SEC-WEB-009-002 ${path.replace(SYNTHETIC_UUID, ":ref")} is served no-store, Pragma and no-referrer`, async ({
    request,
  }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"] ?? "").toMatch(/^text\/html/);
    expectNoStoreAndNoReferrer(response.headers(), path);
  });
}

for (const path of ["//mypage", "/x/%2e%2e/mypage"]) {
  test(`TC-SEC-WEB-009-002 ${path} (sent unnormalised) is served no-store, Pragma and no-referrer`, async ({
    baseURL,
  }) => {
    expect(baseURL).toBeTruthy();
    const port = Number(new URL(baseURL ?? "").port);
    // The status is recorded, not asserted: the local server and Cloudflare Pages differ for these spellings.
    const response = await rawRequest(port, "GET", path);
    test.info().annotations.push({ type: "status", description: String(response.status) });
    expectNoStoreAndNoReferrer(response.headers, path);
  });
}

test("TC-SEC-WEB-009-002 the browser document response for /%6Dypage carries the same three values", async ({
  page,
}) => {
  // No hydration wait: nothing is clicked or read from the DOM. The assertion is on the document response,
  // which holds whether Chromium sent `/%6Dypage` or the decoded `/mypage` (the rendered screen is not checked).
  const response = await page.goto("/%6Dypage", { waitUntil: "domcontentloaded" });
  expect(response).not.toBeNull();
  expectNoStoreAndNoReferrer(response?.headers() ?? {}, "/%6Dypage (browser)");
});
