import type { Page, Request, Response } from "@playwright/test";

// Hydration-ready signal for the UI mock suite (SPEC-170 section 69 / TST-FLK-001: runner retry is 0, so a
// test must not act before the page is interactive). The Web app sets `data-hydrated="true"` on <html>
// from a tiny client component in the root layout once React has hydrated (tests/contracts/s5-cart.md
// section 12). Test-only; no business data is read.
//
// Host stalls (tests/contracts/s5-cart.md section 9.3): the first wait is HYDRATION_TIMEOUT_MS. If it
// expires, the helper inspects a request ledger. Only when NO request failed, NO page error / console
// error occurred (i.e. nothing points at an app defect) is the wait extended ONCE, to a bounded
// HYDRATION_STALL_EXTENSION_MS. Any failed request, page error or console error fails strictly with
// diagnostics. This is a bounded wait, not a retry: the test action is never repeated.

const HYDRATION_TIMEOUT_MS = 15_000;
const HYDRATION_STALL_EXTENSION_MS = 15_000; // total bound 30 s

export const HYDRATED_SELECTOR = 'html[data-hydrated="true"]';

interface Ledger {
  pending: Set<Request>;
  finished: number;
  failed: string[];
  errors: string[];
}

const ledgers = new WeakMap<Page, Ledger>();

function path(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname; // no query: avoid leaking anything
  } catch {
    return "<unparsable>";
  }
}

function observe(page: Page): Ledger {
  const existing = ledgers.get(page);
  if (existing) return existing;
  const ledger: Ledger = { pending: new Set(), finished: 0, failed: [], errors: [] };
  ledgers.set(page, ledger);
  page.on("request", (r) => ledger.pending.add(r));
  page.on("requestfinished", (r) => {
    ledger.pending.delete(r);
    ledger.finished += 1;
  });
  page.on("requestfailed", (r) => {
    ledger.pending.delete(r);
    ledger.failed.push(`${r.method()} ${path(r.url())} (${r.failure()?.errorText ?? "unknown"})`);
  });
  page.on("pageerror", (e) => ledger.errors.push(`pageerror: ${e.name}`));
  page.on("console", (m) => {
    if (m.type() === "error") ledger.errors.push(`console.error: ${m.text().slice(0, 120)}`);
  });
  return ledger;
}

function describe(ledger: Ledger): string {
  const pending = [...ledger.pending].map((r) => `${r.method()} ${path(r.url())}`);
  return (
    `finished=${ledger.finished} pending=[${pending.join(", ")}] ` +
    `failed=[${ledger.failed.join(", ")}] errors=[${ledger.errors.join(" | ")}]`
  );
}

async function waitSelector(page: Page, timeout: number): Promise<boolean> {
  try {
    await page.waitForSelector(HYDRATED_SELECTOR, { state: "attached", timeout });
    return true;
  } catch {
    return false;
  }
}

export async function waitForHydration(
  page: Page,
  timeoutMs: number = HYDRATION_TIMEOUT_MS,
): Promise<void> {
  const ledger = observe(page);
  if (await waitSelector(page, timeoutMs)) return;
  const appDefectSuspected = ledger.failed.length > 0 || ledger.errors.length > 0;
  if (!appDefectSuspected) {
    if (await waitSelector(page, HYDRATION_STALL_EXTENSION_MS)) return;
  }
  const waited = appDefectSuspected ? timeoutMs : timeoutMs + HYDRATION_STALL_EXTENSION_MS;
  const verdict = appDefectSuspected
    ? "APP-DEFECT-SUSPECTED (failed request / page error present)"
    : "HOST-STALL-SUSPECTED (no failed request or error; bounded wait exhausted)";
  throw new Error(
    `Hydration signal not observed within ${waited} ms: expected <html data-hydrated="true"> ` +
      `(set by a client component in the root layout). ${verdict}. ${describe(ledger)}. ` +
      "If the attribute is not implemented yet, this is a missing production signal " +
      "(tests/contracts/s5-cart.md section 9), not a page timing problem.",
  );
}

/** `page.goto` that resolves only after the new document has hydrated. */
export async function gotoHydrated(page: Page, url: string): Promise<Response | null> {
  observe(page);
  const response = await page.goto(url);
  await waitForHydration(page);
  return response;
}

/** `page.reload` that resolves only after the reloaded document has hydrated. */
export async function reloadHydrated(page: Page): Promise<Response | null> {
  observe(page);
  const response = await page.reload();
  await waitForHydration(page);
  return response;
}
