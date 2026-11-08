import { expect, test } from "@playwright/test";

// TC-SEC-WEB-009-001 (UI mock suite, TST-E2E-004: auxiliary, not G8; G5 header check)
// SEC-WEB-009: the six protected prefixes (/account, /auth, /purchase, /mypage, /admin, /staff) answer with
// Cache-Control no-store + private and Pragma no-cache. The headers come from dist/_headers (SPEC-180 13.1) and are
// asserted regardless of the body: /auth, /admin and /staff have no page yet and are the static SPA shell
// (HTTP 200) with the same headers. Public routes are not forced to no-store (SEC-WEB-010).
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
    const cacheControl = response.headers()["cache-control"] ?? "";
    expect(cacheControl).toContain("no-store");
    expect(cacheControl).toContain("private");
    expect(response.headers().pragma).toBe("no-cache");
  });
}

test("TC-SEC-WEB-009-001 public routes are not forced to no-store by the protected rule", async ({
  request,
}) => {
  const response = await request.get("/");
  const cacheControl = response.headers()["cache-control"] ?? "";
  expect(cacheControl).not.toContain("private");
  expect(cacheControl).not.toContain("no-store");
});
