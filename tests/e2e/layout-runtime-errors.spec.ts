import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  authenticatedSession,
  isDesktop,
  KEYS,
  scenarioJson,
  seedLocalStorage,
  watchRuntimeErrors,
} from "../harness/browser/shell.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Verification-phase gap test.
// Interactions (drawer, account menu, logout, broken sponsor image) must not raise hydration or runtime errors.

const header = (page: Page) => page.getByRole("banner");

test.describe("TC-PG-PUB-001-505 interactions run without runtime or hydration errors (SPEC-050 25, DEV-WEB-001)", () => {
  test("drawer (mobile), account menu, logout and a broken sponsor image raise no pageerror or console.error", async ({
    page,
  }) => {
    const runtime = watchRuntimeErrors(page);
    await seedLocalStorage(page, {
      [KEYS.session]: authenticatedSession(),
      [KEYS.scenario]: scenarioJson({ sponsorLogos: "image_broken" }),
    });
    await page.goto("/");
    await expect(header(page)).toBeVisible();
    await page.waitForLoadState("networkidle");

    if (!isDesktop(page)) {
      await header(page)
        .getByRole("button", { name: copy.layout.drawer.open, exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: copy.layout.drawer.title, exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }

    const menuButton = header(page).getByRole("button", {
      name: copy.layout.account.menuButton,
      exact: true,
    });
    await menuButton.click();
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");
    await expect(menuButton).toBeFocused();

    await menuButton.click();
    await page.getByRole("button", { name: copy.layout.account.logout, exact: true }).click();
    await expect(
      header(page).getByRole("link", { name: copy.layout.account.login, exact: true }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");

    expect(runtime.errors).toEqual([]);
  });
});
