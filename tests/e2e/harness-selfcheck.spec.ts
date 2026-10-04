import { expect, test } from "@playwright/test";
import { HYDRATED_SELECTOR, waitForHydration } from "../harness/browser/hydration.ts";
import { seedLocalStorage } from "../harness/browser/shell.ts";

// Harness self-checks (SPEC-170 section 69 / TST-FLK-001). No application code is involved: the pages are
// served from a route handler on a synthetic origin.

const ORIGIN = "http://harness.invalid";

test.describe("TC-TST-FLK-001-001 the hydration helper waits for the signal and fails with a clear message when it is absent", () => {
  test("resolves only after <html data-hydrated> appears", async ({ page }) => {
    await page.route(`${ORIGIN}/**`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html><body>x</body></html>",
      }),
    );
    await page.goto(`${ORIGIN}/`);
    await expect(page.locator(HYDRATED_SELECTOR)).toHaveCount(0);
    const pending = waitForHydration(page, 5_000);
    await page.evaluate(() => {
      setTimeout(() => {
        document.documentElement.dataset.hydrated = "true";
      }, 300);
    });
    await pending;
    await expect(page.locator(HYDRATED_SELECTOR)).toHaveCount(1);
  });

  test("names the missing production signal instead of timing out silently", async ({ page }) => {
    await page.route(`${ORIGIN}/**`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html><body>x</body></html>",
      }),
    );
    await page.goto(`${ORIGIN}/`);
    await expect(waitForHydration(page, 500)).rejects.toThrow(/data-hydrated="true"/);
  });
});

test.describe("TC-TST-FLK-001-002 seedLocalStorage seeds once per call, so later calls on the same page still apply", () => {
  test("a second call seeds on the next navigation and a reload does not re-seed", async ({
    page,
  }) => {
    await page.route(`${ORIGIN}/**`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html><body>x</body></html>",
      }),
    );
    const read = () => page.evaluate(() => window.localStorage.getItem("k"));
    await seedLocalStorage(page, { k: "first" });
    await page.goto(`${ORIGIN}/a`);
    expect(await read()).toBe("first");
    await seedLocalStorage(page, { k: "second" });
    await page.goto(`${ORIGIN}/b`);
    expect(await read()).toBe("second");
    await page.evaluate(() => window.localStorage.setItem("k", "changed"));
    await page.reload();
    expect(await read()).toBe("changed");
  });
});
