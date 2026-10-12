import { expect, type Page } from "@playwright/test";
import type { DbState } from "../../../apps/web/src/mock/backend/db.ts";
import { copy } from "../../../apps/web/src/presentation/copy/ja.ts";
import { readDbRaw, writeStorage } from "./cart.ts";
import { awaitingWithWebhook } from "./mypage.ts";
import {
  actionButton,
  alertsOf,
  entitlementsRegion,
  mainOf,
  ORDER_STATE_LIST,
  openAs,
  orderByRef,
  ordersOf,
  outcomeRegion,
  setScenario,
  statusLive,
} from "./purchase.ts";
import { KEYS, watchRuntimeErrors } from "./shell.ts";

// Browser-side helpers for the "only the last-started Order read is shown" tests (tests/contracts/s7a-purchase.md
// section 6 and s8-mypage.md section 4.6; DEV-WEB-009, SPEC-050 16 / 18.4 / 22, PAY-BRW-002). Test-only.
//
// The page cannot overlap two Order reads by itself (every action button is disabled while one is pending, and the
// mock reads the DB after its latency), so these helpers check the observable consequences: slow reads and
// consecutive operations stay ordered, a read that is abandoned by leaving the page is not reflected, and no read
// is repeated. The number of reads is observed through the mock's `webhookReads` counter, which is incremented once
// per Order read of an AWAITING_PAYMENT Order that waits for a simulated webhook (and saved in the mock DB).

const act = copy.order.action;
const label = copy.order.state;
const LATENCY_MS = 2500;

type Scenario = Record<string, unknown>;

/** The number of reads the mock has served for the Order (undefined if the Order does not exist). */
export async function webhookReadsOf(page: Page, ref: string): Promise<number | undefined> {
  return (await orderByRef(page, ref))?.webhookReads;
}

/** `webhookReads` of an Order in a raw DB snapshot (the DB that is not currently in storage). */
export function webhookReadsInRaw(raw: string | null, ref: string): number | undefined {
  if (raw === null) return undefined;
  return (JSON.parse(raw) as DbState).orders.find((o) => o.ref === ref)?.webhookReads;
}

async function openAwaiting(
  page: Page,
  path: string,
  ref: string,
  scenario: Scenario,
): Promise<void> {
  await openAs(page, path, {
    scenario,
    dbEdit: (state) => awaitingWithWebhook(state, ref),
  });
}

/** Presses the recheck and checks the pending state, the announcement and the end of the pending state. */
async function recheckAndExpectUnchanged(page: Page): Promise<void> {
  const recheck = actionButton(page, act.recheck_status);
  await recheck.click();
  await expect(recheck).toBeDisabled();
  await expect(recheck).toHaveAttribute("aria-busy", "true");
  await expect(statusLive(page)).toHaveText(copy.purchase.recheck.inProgress);
  await expect(statusLive(page)).toHaveText(copy.purchase.recheck.unchanged, { timeout: 15_000 });
  await expect(recheck).toBeEnabled();
  await expect(recheck).not.toHaveAttribute("aria-busy", "true");
  await expect(alertsOf(page)).toHaveCount(0);
}

/**
 * Slow reads and consecutive operations on one Order page: one read on mount, one per press, the pending state
 * ends with every read and the last read decides what is shown (the final press confirms the Order).
 */
export async function exerciseSlowConsecutiveReads(
  page: Page,
  path: string,
  ref: string,
): Promise<void> {
  await openAwaiting(page, path, ref, {
    paymentOutcome: "remain_awaiting",
    latency: "long",
    latencyLongMs: LATENCY_MS,
  });
  // The first read is still running: only the loading state is shown (no state, no action).
  await expect(mainOf(page).locator('[role="status"]').first()).toContainText(
    copy.pageState.loading,
  );
  await expect(actionButton(page, act.recheck_status)).toHaveCount(0);
  await expect(outcomeRegion(page)).toContainText(label.AWAITING_PAYMENT, { timeout: 15_000 });
  await expect(entitlementsRegion(page)).toHaveCount(0);
  // One read per mount.
  await expect.poll(() => webhookReadsOf(page, ref)).toBe(1);

  await recheckAndExpectUnchanged(page);
  await expect.poll(() => webhookReadsOf(page, ref)).toBe(2);
  await recheckAndExpectUnchanged(page);
  await expect.poll(() => webhookReadsOf(page, ref)).toBe(3);

  // A later read decides: the same slow press, now answered with CONFIRMED.
  const ordersBefore = (await ordersOf(page)).length;
  await setScenario(page, {
    paymentOutcome: "confirm",
    latency: "long",
    latencyLongMs: LATENCY_MS,
  });
  const recheck = actionButton(page, act.recheck_status);
  await recheck.click();
  await expect(recheck).toBeDisabled();
  await expect(recheck).toHaveAttribute("aria-busy", "true");
  await expect(statusLive(page)).toHaveText(copy.purchase.recheck.changed(label.CONFIRMED), {
    timeout: 15_000,
  });
  await expect(outcomeRegion(page)).toContainText(label.CONFIRMED);
  await expect(entitlementsRegion(page)).toBeVisible();
  await expect(alertsOf(page)).toHaveCount(0);
  expect((await orderByRef(page, ref))?.state).toBe("CONFIRMED");
  expect((await ordersOf(page)).length).toBe(ordersBefore);
}

/**
 * Leaving the page while a recheck is still being answered: the abandoned read still completes in the mock
 * (observed by the counter) but nothing of it appears on the destination and nothing is thrown.
 * `leave` navigates on the client and asserts that the destination is shown; `absent` is text that belongs to the
 * abandoned page and must not be on the destination.
 */
export async function exerciseLeaveDuringRecheck(
  page: Page,
  path: string,
  ref: string,
  leave: () => Promise<void>,
  absent: readonly string[],
): Promise<void> {
  const runtime = watchRuntimeErrors(page);
  await openAwaiting(page, path, ref, { paymentOutcome: "remain_awaiting" });
  await expect(outcomeRegion(page)).toContainText(label.AWAITING_PAYMENT);
  await expect.poll(() => webhookReadsOf(page, ref)).toBe(1);

  await setScenario(page, {
    paymentOutcome: "remain_awaiting",
    latency: "long",
    latencyLongMs: LATENCY_MS + 500,
  });
  const recheck = actionButton(page, act.recheck_status);
  await recheck.click();
  await expect(recheck).toBeDisabled();
  await expect(recheck).toHaveAttribute("aria-busy", "true");

  await leave();
  // The abandoned read completes (the mock counted it) while the destination is shown.
  await expect.poll(() => webhookReadsOf(page, ref), { timeout: 15_000 }).toBe(2);
  for (const text of [
    ...absent,
    copy.purchase.recheck.inProgress,
    copy.purchase.recheck.unchanged,
    copy.purchase.recheck.failed,
    copy.purchase.outcomeHeading,
    act.recheck_status,
  ]) {
    await expect(mainOf(page)).not.toContainText(text);
  }
  expect((await orderByRef(page, ref))?.state).toBe("AWAITING_PAYMENT");
  expect(runtime.errors).toEqual([]);
}

/**
 * An unavailable read followed by a slow retry: the retry is one read, the loading state is shown while it runs
 * (no alert, no retry, no state), and the result is the Order.
 */
export async function exerciseRetryAfterUnavailable(
  page: Page,
  path: string,
  ref: string,
): Promise<void> {
  await openAwaiting(page, path, ref, { paymentOutcome: "remain_awaiting" });
  await expect(outcomeRegion(page)).toContainText(label.AWAITING_PAYMENT);
  await expect.poll(() => webhookReadsOf(page, ref)).toBe(1);
  const good = await readDbRaw(page);
  expect(good).not.toBeNull();
  const readsBefore = webhookReadsInRaw(good, ref);
  expect(readsBefore).toBe(1);

  await writeStorage(page, KEYS.db, "{ not json");
  await page.reload();
  await expect(alertsOf(page)).toHaveCount(1);
  await expect(alertsOf(page)).toContainText(copy.pageState.unavailable(copy.purchase.subject));
  const retry = mainOf(page).getByRole("button", { name: copy.pageState.retry, exact: true });
  await expect(retry).toBeVisible();

  await writeStorage(page, KEYS.db, good ?? "");
  await setScenario(page, {
    paymentOutcome: "remain_awaiting",
    latency: "long",
    latencyLongMs: LATENCY_MS,
  });
  await retry.click();
  await expect(mainOf(page).locator('[role="status"]').first()).toContainText(
    copy.pageState.loading,
  );
  await expect(alertsOf(page)).toHaveCount(0);
  await expect(retry).toHaveCount(0);
  await expect(actionButton(page, act.recheck_status)).toHaveCount(0);
  for (const state of ORDER_STATE_LIST) {
    await expect(mainOf(page)).not.toContainText(label[state]);
  }
  await expect(outcomeRegion(page)).toContainText(label.AWAITING_PAYMENT, { timeout: 15_000 });
  await expect(alertsOf(page)).toHaveCount(0);
  // Exactly one read for the retry (the failed read before it was never served by the mock).
  await expect.poll(() => webhookReadsOf(page, ref)).toBe((readsBefore ?? 0) + 1);
}
