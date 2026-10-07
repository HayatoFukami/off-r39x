import { expect, test } from "@playwright/test";

// TC-SEC-WEB-009-001 (UI mock suite, TST-E2E-004: auxiliary, not G8; G5 header check)
// Headers are asserted regardless of the body: a 404 for a route that does not exist yet is fine.
for (const path of ["/mypage", "/purchase/anything", "/account/login"]) {
  test(`TC-SEC-WEB-009-001 ${path} responds with Cache-Control no-store`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });
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
  expect(response.headers()["cache-control"] ?? "").not.toContain("private");
});
