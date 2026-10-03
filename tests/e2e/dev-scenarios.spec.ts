import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { SCENARIO_CONTROLS } from "../harness/browser/scenario-controls.ts";
import {
  authenticatedSession,
  KEYS,
  scenarioJson,
  seedLocalStorage,
  watchRuntimeErrors,
} from "../harness/browser/shell.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s3-layout.md section 8.
// DEV-WEB-010 / 012 / 013, design section 8. Scenario failures here are mock switches, not Fault Points (TST-GEN-006).

const read = (page: Page, key: string) => page.evaluate((k) => window.localStorage.getItem(k), key);
const readScenario = async (page: Page): Promise<Record<string, unknown>> => {
  const raw = await read(page, KEYS.scenario);
  return raw === null ? {} : (JSON.parse(raw) as Record<string, unknown>);
};
const control = (page: Page, path: string) => page.getByLabel(path, { exact: true });
const footerRegion = (page: Page) =>
  page
    .getByRole("contentinfo")
    .getByRole("region", { name: copy.layout.sponsors.regionLabel, exact: true });

function getAt(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (typeof acc !== "object" || acc === null) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, value);
}

test.describe("TC-DEV-WEB-012-301 /dev/scenarios loads in mock mode and is kept out of search (DEV-WEB-012)", () => {
  test("renders the panel with a single h1 inside the shell and a noindex robots meta", async ({
    page,
  }) => {
    const response = await page.goto("/dev/scenarios");
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "モックシナリオ", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const robots = await page.locator('meta[name="robots"]').getAttribute("content");
    expect(robots ?? "").toContain("noindex");
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
  });

  test("lists other-user references for ownership checks", async ({ page }) => {
    await page.goto("/dev/scenarios");
    const others = page.getByRole("region", { name: "他者データの参照", exact: true });
    await expect(others).toBeVisible();
    const hrefs = await others
      .getByRole("link")
      .evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).getAttribute("href")));
    for (const expected of [
      "/mypage/orders/0d000000-0000-4000-8000-000000000101",
      "/mypage/entry-tickets/7c000000-0000-4000-8000-000000000101",
      "/mypage/karaoke/4e000000-0000-4000-8000-000000000101",
      "/mypage/goods/91000000-0000-4000-8000-000000000101",
    ]) {
      expect(hrefs).toContain(expected);
    }
    for (const href of hrefs) expect(href ?? "").toMatch(/^\/mypage\//);
  });
});

test.describe("TC-DEV-WEB-013-201 every scenario switch is editable and persisted (design section 8)", () => {
  test("offers a labelled control with exactly the schema values for every switch", async ({
    page,
  }) => {
    await page.goto("/dev/scenarios");
    for (const spec of SCENARIO_CONTROLS) {
      const el = control(page, spec.path);
      await expect(el, spec.path).toBeVisible();
      if (spec.kind === "number") {
        await expect(el, spec.path).toHaveAttribute("type", "number");
        await expect(el, spec.path).toHaveValue("3000");
        continue;
      }
      const values = await el
        .locator("option")
        .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
      expect(values, spec.path).toEqual([...spec.values]);
    }
  });

  test("starts from the stored scenario (defaults when nothing is stored)", async ({ page }) => {
    await seedLocalStorage(page, {
      [KEYS.scenario]: scenarioJson({
        publicFetch: "fail",
        cart: { state: "partial", purchaseStart: "limit" },
      }),
    });
    await page.goto("/dev/scenarios");
    await expect(control(page, "publicFetch")).toHaveValue("fail");
    await expect(control(page, "cart.state")).toHaveValue("partial");
    await expect(control(page, "cart.purchaseStart")).toHaveValue("limit");
    await expect(control(page, "sponsorLogos")).toHaveValue("published");
    // Opening the panel does not rewrite the stored value.
    expect(await read(page, KEYS.scenario)).toBe(
      scenarioJson({ publicFetch: "fail", cart: { state: "partial", purchaseStart: "limit" } }),
    );
  });

  test("writes each changed value to r39x.mock.scenario.v1 immediately, without a save button", async ({
    page,
  }) => {
    await page.goto("/dev/scenarios");
    for (const spec of SCENARIO_CONTROLS) {
      if (spec.kind !== "select") continue;
      for (const value of spec.values) {
        await control(page, spec.path).selectOption(value);
        await expect
          .poll(async () => getAt(await readScenario(page), spec.path), {
            message: `${spec.path}=${value}`,
          })
          .toBe(value);
      }
    }
    const stored = await readScenario(page);
    expect(stored.version).toBe(1);
    expect(Object.keys(stored).sort()).toEqual(Object.keys(JSON.parse(scenarioJson())).sort());
  });

  test("keeps sibling values when one nested switch changes", async ({ page }) => {
    await page.goto("/dev/scenarios");
    await control(page, "cart.state").selectOption("partial");
    await expect
      .poll(async () => (await readScenario(page)).cart)
      .toEqual({ state: "partial", purchaseStart: "ok" });
    await control(page, "auth.login").selectOption("credential_failure");
    await expect
      .poll(async () => (await readScenario(page)).auth)
      .toEqual({
        session: "ok",
        login: "credential_failure",
        signup: "confirmation_required",
        verify: "ok",
        reset: "ok",
        resetContext: "valid",
        logout: "ok",
      });
  });

  test("a change survives a reload and drives the footer sponsor area (published -> none)", async ({
    page,
  }) => {
    await page.goto("/dev/scenarios");
    await footerRegion(page).waitFor({ state: "visible" });
    await control(page, "sponsorLogos").selectOption("none");
    await expect.poll(async () => (await readScenario(page)).sponsorLogos).toBe("none");

    await page.reload();
    await expect(control(page, "sponsorLogos")).toHaveValue("none");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(footerRegion(page)).toHaveCount(0);

    await control(page, "sponsorLogos").selectOption("published");
    await page.reload();
    await expect(footerRegion(page)).toBeVisible();
  });

  test("rejects a latencyLongMs the schema would refuse and keeps the stored value", async ({
    page,
  }) => {
    await page.goto("/dev/scenarios");
    const field = control(page, "latencyLongMs");
    await field.fill("5000");
    await expect.poll(async () => (await readScenario(page)).latencyLongMs).toBe(5000);
    for (const bad of ["0", "60001", "1.5"]) {
      await field.fill(bad);
      // give the handler a chance to (wrongly) persist
      await page.waitForTimeout(150);
      expect((await readScenario(page)).latencyLongMs, bad).toBe(5000);
    }
  });
});

test.describe("TC-DEV-WEB-013-202 corrupted scenario is reported and only an explicit reset recovers (DEV-TS-004, design section 8)", () => {
  const CORRUPT = '{"version":2,"leak":"SENTINEL-VALUE-1234"}';

  test("shows an alert without echoing the stored content and does not overwrite it", async ({
    page,
  }) => {
    await seedLocalStorage(page, { [KEYS.scenario]: CORRUPT });
    await page.goto("/dev/scenarios");
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "保存されているシナリオを読み込めません" });
    await expect(alert).toBeVisible();
    await expect(page.locator("body")).not.toContainText("SENTINEL-VALUE-1234");
    expect(await read(page, KEYS.scenario)).toBe(CORRUPT);
  });

  test("the reset button restores the defaults and clears the alert", async ({ page }) => {
    await seedLocalStorage(page, { [KEYS.scenario]: CORRUPT });
    await page.goto("/dev/scenarios");
    await page.getByRole("button", { name: "シナリオを初期化", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "保存されているシナリオを読み込めません" }),
    ).toHaveCount(0);
    await expect.poll(() => readScenario(page)).toEqual(JSON.parse(scenarioJson()));
    await expect(control(page, "sponsorLogos")).toHaveValue("published");
    await expect(control(page, "latencyLongMs")).toHaveValue("3000");
  });
});

test.describe("TC-DEV-WEB-013-203 DB reset button (design section 8)", () => {
  test("replaces a corrupted mock DB with a fresh seed and leaves session and scenario alone", async ({
    page,
  }) => {
    const scenario = scenarioJson({ sponsorLogos: "none" });
    await seedLocalStorage(page, {
      [KEYS.db]: '{"bad":true}',
      [KEYS.session]: authenticatedSession(),
      [KEYS.scenario]: scenario,
    });
    await page.goto("/dev/scenarios");
    await page.getByRole("button", { name: "モックDBをリセット", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "モックDBをリセットしました" }),
    ).toBeVisible();
    const db = await read(page, KEYS.db);
    expect(db).not.toBeNull();
    expect((JSON.parse(db ?? "{}") as { version?: unknown }).version).toBe(1);
    expect(await read(page, KEYS.session)).toBe(authenticatedSession());
    expect(await read(page, KEYS.scenario)).toBe(scenario);
    // The stored DB holds no password, token or raw QR.
    expect(db ?? "").not.toMatch(/password|token|rawQr/i);
  });
});

test.describe("TC-DEV-WEB-013-204 unavailable browser storage does not crash the shell (contract section 2.4)", () => {
  test("renders Home, the header actions and /dev/scenarios when localStorage throws", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("denied", "SecurityError");
        },
      });
    });
    const runtime = watchRuntimeErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link", { name: copy.layout.cta.buyTickets, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link", { name: copy.layout.cart.label, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link", { name: copy.layout.account.login, exact: true }),
    ).toBeVisible();

    await page.goto("/dev/scenarios");
    await expect(
      page.getByRole("heading", { level: 1, name: "モックシナリオ", exact: true }),
    ).toBeVisible();
    expect(runtime.errors).toEqual([]);
  });
});
