import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { entryLine, goodsLine, readDbRaw } from "../harness/browser/cart.ts";
import { gotoHydrated } from "../harness/browser/hydration.ts";
import { fixClock, horizontalOverflow } from "../harness/browser/public.ts";
import {
  heading1,
  mainOf,
  openAs,
  orderByRef,
  proceedToMockCheckout,
  readState,
  statusLive,
} from "../harness/browser/purchase.ts";
import {
  allHrefs,
  FORBIDDEN_AREA,
  pathOf,
  watchRequestHosts,
  watchRuntimeErrors,
} from "../harness/browser/shell.ts";
import { GOODS, OFFERING } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s7a-purchase.md section 5.
// Design section 6 (mock Checkout), SPEC-070 PAY-BRW-001 .. 003, SPEC-050 16.3, SPEC-190 DEV-WEB-012.
// The mock Checkout never decides an Order: only the scenario paymentOutcome does, at the next getOrder read.

const LINES = [entryLine(OFFERING.regular, 1), goodsLine(GOODS.tshirt, 1)];
const parsed = (raw: string | null): unknown => (raw === null ? null : JSON.parse(raw));

async function atMockCheckout(page: Page, scenario: Record<string, unknown> = {}): Promise<string> {
  await openAs(page, "/cart", { lines: LINES, scenario });
  return proceedToMockCheckout(page);
}

test.describe("TC-PAY-BRW-001-611 the mock Checkout is a labelled stand-in with no payment input (design 6, PAY-BRW-001)", () => {
  test("shows the stand-in notice as the heading, two return links to the same Purchase Status, and no input field", async ({
    page,
  }) => {
    const ref = await atMockCheckout(page);
    await expect(heading1(page)).toHaveCount(1);
    await expect(heading1(page)).toHaveText(copy.mockCheckout.heading);
    await expect(heading1(page)).toContainText("実際の決済は行われません");
    await expect(mainOf(page)).toContainText(copy.mockCheckout.note);
    await expect(page).toHaveTitle(new RegExp(`^${copy.mockCheckout.pageTitle}`));

    const pay = mainOf(page).getByRole("link", { name: copy.mockCheckout.pay, exact: true });
    const back = mainOf(page).getByRole("link", { name: copy.mockCheckout.back, exact: true });
    await expect(pay).toHaveAttribute("href", `/purchase/orders/${ref}`);
    await expect(back).toHaveAttribute("href", `/purchase/orders/${ref}`);

    // No card number, no form control of any kind (the mock never handles payment data).
    await expect(mainOf(page).locator("input, textarea, select, form")).toHaveCount(0);
    await expect(mainOf(page).getByRole("textbox")).toHaveCount(0);
    await expect(mainOf(page).getByRole("spinbutton")).toHaveCount(0);
    await expect(mainOf(page).locator('[role="alert"]')).toHaveCount(0);
  });

  test("is a dev-only surface: noindex, no Admin / Staff link, no external request, no runtime error, no horizontal scroll at 390px", async ({
    page,
  }) => {
    const errors = watchRuntimeErrors(page);
    const hosts = watchRequestHosts(page);
    await atMockCheckout(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(heading1(page)).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    for (const href of await allHrefs(page)) {
      expect(FORBIDDEN_AREA.test(pathOf(href)), href).toBe(false);
    }
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    expect([...hosts.hosts].every((host) => host === "127.0.0.1:3100")).toBe(true);
    expect(errors.errors).toEqual([]);
  });

  test("a well-formed ref is shown whether or not that Order exists (the stand-in reads nothing); a malformed ref is a 404", async ({
    page,
  }) => {
    await fixClock(page);
    const unknown = "0d000000-0000-4000-8000-0000000009ff";
    const ok = await gotoHydrated(page, `/dev/mock-checkout/${unknown}`);
    expect(ok?.status()).toBe(200);
    await expect(heading1(page)).toHaveText(copy.mockCheckout.heading);

    const bad = await page.goto("/dev/mock-checkout/not-a-uuid");
    expect(bad?.status()).toBe(404);
    await expect(heading1(page)).toHaveText(copy.notFound.title);
    await expect(mainOf(page)).not.toContainText(copy.mockCheckout.heading);
  });
});

test.describe("TC-PAY-BRW-001-612 visiting the mock Checkout changes nothing (PAY-BRW-001 / 002)", () => {
  test("the Order stays AWAITING_PAYMENT with zero status reads, and a reload of the Checkout page creates nothing", async ({
    page,
  }) => {
    const ref = await atMockCheckout(page);
    const dbAtArrival = parsed(await readDbRaw(page));
    const order = await orderByRef(page, ref);
    expect(order?.state).toBe("AWAITING_PAYMENT");
    expect(order?.webhookReads).toBe(0);

    await page.reload();
    await expect(heading1(page)).toHaveText(copy.mockCheckout.heading);
    expect(parsed(await readDbRaw(page))).toEqual(dbAtArrival);
    const after = await readState(page);
    expect(after.orders.find((o) => o.ref === ref)?.webhookReads).toBe(0);
  });
});

test.describe("TC-PAY-BRW-001-613 the Return buttons do not decide the Order: the scenario outcome does (PAY-BRW-001 .. 003, SPEC-050 16.3)", () => {
  for (const button of ["pay", "back"] as const) {
    test(`'${button}' returns to the Purchase Status; the default outcome shows AWAITING_PAYMENT after exactly one status read`, async ({
      page,
    }) => {
      const ref = await atMockCheckout(page);
      await mainOf(page)
        .getByRole("link", { name: copy.mockCheckout[button], exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`/purchase/orders/${ref}$`));
      await expect(mainOf(page)).toContainText(copy.order.state.AWAITING_PAYMENT);
      await expect(mainOf(page)).not.toContainText(copy.order.state.CONFIRMED);
      const order = await orderByRef(page, ref);
      expect(order?.state).toBe("AWAITING_PAYMENT");
      expect(order?.webhookReads).toBe(1);
    });
  }

  test("under 'confirm', even 'back' shows CONFIRMED: the server outcome, not the button, decides", async ({
    page,
  }) => {
    const ref = await atMockCheckout(page, { paymentOutcome: "confirm" });
    await mainOf(page).getByRole("link", { name: copy.mockCheckout.back, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/purchase/orders/${ref}$`));
    await expect(mainOf(page)).toContainText(copy.order.state.CONFIRMED);
    expect((await orderByRef(page, ref))?.state).toBe("CONFIRMED");
  });

  test("under 'payment_failed', pressing 'pay' still shows a failure, never success", async ({
    page,
  }) => {
    const ref = await atMockCheckout(page, { paymentOutcome: "payment_failed" });
    await mainOf(page).getByRole("link", { name: copy.mockCheckout.pay, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/purchase/orders/${ref}$`));
    await expect(mainOf(page)).toContainText(copy.order.state.PAYMENT_FAILED);
    await expect(mainOf(page)).not.toContainText(copy.order.state.CONFIRMED);
    // The page-level live region exists and has not announced a success.
    await expect(statusLive(page)).not.toContainText(copy.order.state.CONFIRMED);
    expect((await orderByRef(page, ref))?.state).toBe("PAYMENT_FAILED");
  });
});
