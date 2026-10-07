import { expect, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { SITE_NAME } from "../harness/browser/shell.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s3-layout.md section 6.
// PG-XFN-002 (SPEC-050 19.1) and the error surface (SEC-WEB-012).

const MISSING = "/no-such-route-r39x/deeper";

test.describe("TC-PG-XFN-002-301 Not Found page (SPEC-050 19.1)", () => {
  test("answers 404 with a page that says it cannot be shown and links back Home", async ({
    page,
  }) => {
    const response = await page.goto(MISSING);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.notFound.title);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("main")).toContainText(copy.notFound.description);
    const home = page
      .getByRole("main")
      .getByRole("link", { name: copy.notFound.homeLink, exact: true });
    await expect(home).toHaveAttribute("href", "/");
    // The shell stays around the message so that navigation is recovered.
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
  });

  test("leaks no internal information (requested path, framework default text)", async ({
    page,
  }) => {
    await page.goto(MISSING);
    const main = page.getByRole("main");
    await expect(main).not.toContainText(/no-such-route|deeper/);
    await expect(main).not.toContainText(/This page could not be found|404|stack|Error/);
    await expect(page.locator("title")).not.toHaveText(/404/);
  });

  test("the Home link returns to the Event Home", async ({ page }) => {
    await page.goto(MISSING);
    await page
      .getByRole("main")
      .getByRole("link", { name: copy.notFound.homeLink, exact: true })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: SITE_NAME })).toBeVisible();
  });
});

test.describe("TC-SEC-WEB-012-101 error page does not leak internals (SEC-WEB-012)", () => {
  const MARKERS = ["SENSITIVE-MARKER-9f3a", "r39x-error-probe", "leak.ts", "secret"];

  test("shows generic wording, a retry action and a Home link", async ({ page }) => {
    await page.goto("/dev/error-probe");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.errorPage.title);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("main")).toContainText(copy.errorPage.description);
    await expect(
      page.getByRole("main").getByRole("button", { name: copy.errorPage.retry, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByRole("link", { name: copy.errorPage.homeLink, exact: true }),
    ).toHaveAttribute("href", "/");
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
  });

  test("renders none of the thrown message, path or stack in text or attributes", async ({
    page,
  }) => {
    await page.goto("/dev/error-probe");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.errorPage.title);
    const leaked = await page.evaluate((markers) => {
      const hits: string[] = [];
      const text = document.body.innerText;
      for (const marker of markers) if (text.includes(marker)) hits.push(`text:${marker}`);
      for (const el of Array.from(document.body.querySelectorAll("*"))) {
        if (el.tagName === "SCRIPT" || el.tagName === "TEMPLATE") continue;
        for (const attr of Array.from(el.attributes)) {
          for (const marker of markers) {
            if (attr.value.includes(marker)) hits.push(`attr:${attr.name}:${marker}`);
          }
        }
      }
      if (/\bat\s+\S+\s+\(|\.tsx?:\d+/.test(text)) hits.push("stack-like text");
      return hits;
    }, MARKERS);
    expect(leaked).toEqual([]);
  });

  test("the retry action re-renders without crashing the shell", async ({ page }) => {
    await page.goto("/dev/error-probe");
    await page
      .getByRole("main")
      .getByRole("button", { name: copy.errorPage.retry, exact: true })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.errorPage.title);
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page).toHaveURL(/\/dev\/error-probe$/);
  });

  test("the Home link leaves the error surface", async ({ page }) => {
    await page.goto("/dev/error-probe");
    await page
      .getByRole("main")
      .getByRole("link", { name: copy.errorPage.homeLink, exact: true })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: SITE_NAME })).toBeVisible();
  });
});
