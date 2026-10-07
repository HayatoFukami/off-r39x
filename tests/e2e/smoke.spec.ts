import { expect, test } from "@playwright/test";

// TC-PG-PUB-001-001 (UI mock suite, TST-E2E-004: auxiliary, not G8)
test("TC-PG-PUB-001-001 scaffold smoke: GET / renders ja document with the site h1", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByRole("heading", { level: 1, name: /off r39'x/ })).toBeVisible();
});
