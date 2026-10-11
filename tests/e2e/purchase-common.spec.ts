import { expect, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { entryLine, goodsLine } from "../harness/browser/cart.ts";
import { hasLevelSkip, horizontalOverflow, mainHeadingLevels } from "../harness/browser/public.ts";
import {
  heading1,
  mainOf,
  ORDER_STATE_LIST,
  openAs,
  outcomeRegion,
  proceedToMockCheckout,
} from "../harness/browser/purchase.ts";
import {
  allHrefs,
  FORBIDDEN_AREA,
  pathOf,
  SITE_NAME,
  watchRequestHosts,
  watchRuntimeErrors,
} from "../harness/browser/shell.ts";
import { GOODS, OFFERING, ORDER } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s7a-purchase.md section 7.
// SPEC-050 5.3 / 24 / 25 / 27, SPEC-140 SEC-WEB-009 (G5 header check at the UI mock level), SEC-WEB-004, DEV-WEB-012.

const states: { name: string; ref: string }[] = [
  { name: "prepared", ref: ORDER.prepared },
  { name: "awaiting", ref: ORDER.awaiting },
  { name: "confirmed composite", ref: ORDER.confirmedComposite },
  { name: "payment failed", ref: ORDER.paymentFailed },
  { name: "review", ref: ORDER.review },
  { name: "karaoke", ref: ORDER.kValid },
];

test.describe("TC-PG-XFN-001-691 Purchase Status page quality: title, one h1, ordered headings, no runtime error, no outside request, no Admin / Staff link (SPEC-050 24 / 25 / 27, SEC-WEB-004)", () => {
  for (const s of states) {
    test(`${s.name}`, async ({ page }) => {
      const errors = watchRuntimeErrors(page);
      const hosts = watchRequestHosts(page);
      await openAs(page, `/purchase/orders/${s.ref}`);
      await expect(outcomeRegion(page)).toBeVisible();
      await expect(page).toHaveTitle(`${copy.purchase.pageTitle} | ${SITE_NAME}`);
      await expect(heading1(page)).toHaveCount(1);
      await expect(heading1(page)).toHaveText(copy.purchase.heading);
      const levels = await mainHeadingLevels(page);
      expect(levels.filter((l) => l === 1)).toHaveLength(1);
      expect(hasLevelSkip(levels)).toBe(false);
      for (const href of await allHrefs(page)) {
        expect(FORBIDDEN_AREA.test(pathOf(href)), href).toBe(false);
      }
      expect([...hosts.hosts].every((host) => host === "127.0.0.1:3100")).toBe(true);
      expect(errors.errors).toEqual([]);
      // Every state is shown with a text label (not by colour alone, SPEC-050 25).
      const labels = ORDER_STATE_LIST.map((st) => copy.order.state[st]);
      const text = await outcomeRegion(page).innerText();
      expect(labels.filter((l) => text.includes(l))).toHaveLength(1);
    });
  }

  test("no horizontal scroll at 390px, and the actions stay reachable", async ({ page }) => {
    await openAs(page, `/purchase/orders/${ORDER.confirmedComposite}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(outcomeRegion(page)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await openAs(page, `/purchase/orders/${ORDER.awaiting}`);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expect(
      mainOf(page).getByRole("button", { name: copy.order.action.recheck_status, exact: true }),
    ).toBeVisible();
  });
});

test.describe("TC-SEC-WEB-009-711 the Purchase Status route is never cached (SEC-WEB-009, G5 header check at the UI mock level)", () => {
  test("GET of a Purchase Status page is HTTP 200 with no-store, private and Pragma no-cache", async ({
    request,
  }) => {
    const response = await request.get(`/purchase/orders/${ORDER.confirmedEntry}`, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(200);
    const cacheControl = response.headers()["cache-control"] ?? "";
    expect(cacheControl).toContain("no-store");
    expect(cacheControl).toContain("private");
    expect(response.headers().pragma).toBe("no-cache");
  });

  test("a malformed ref is still a protected, uncached 200 (the Access Denied view), not a 404", async ({
    request,
  }) => {
    const response = await request.get("/purchase/orders/not-a-uuid", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"] ?? "").toContain("no-store");
  });
});

test.describe("TC-DEV-WEB-012-611 the dev-only mock Checkout is not reachable from the general navigation (DEV-WEB-012, SPEC-050 27)", () => {
  test("no public page, the Header, the Footer or the Cart links to /dev/*", async ({ page }) => {
    for (const path of ["/", "/entry", "/cart", "/goods", "/karaoke"]) {
      await openAs(page, path, { session: null });
      for (const href of await allHrefs(page)) {
        expect(pathOf(href).startsWith("/dev/"), `${path} -> ${href}`).toBe(false);
      }
    }
  });

  test("a full purchase flow passes through /dev/mock-checkout and the Cart page itself never links there", async ({
    page,
  }) => {
    await openAs(page, "/cart", {
      lines: [entryLine(OFFERING.regular, 1), goodsLine(GOODS.tshirt, 1)],
    });
    for (const href of await allHrefs(page)) {
      expect(pathOf(href).startsWith("/dev/"), href).toBe(false);
    }
    await proceedToMockCheckout(page);
    expect(new URL(page.url()).pathname.startsWith("/dev/mock-checkout/")).toBe(true);
  });
});
