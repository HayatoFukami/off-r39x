import type { ConsoleMessage, Page } from "@playwright/test";

// Browser-side harness for the UI mock suite (tests/contracts/s3-layout.md section 10).
// Test-only. All data is synthetic (example.com addresses, fixed seed UUIDs).

export const KEYS = {
  scenario: "r39x.mock.scenario.v1",
  session: "r39x.mock.session.v1",
  db: "r39x.mock.db.v1",
  cart: "r39x.cart.v1",
} as const;

// Fixed site name (pinned to config/site.ts SITE_NAME by unit/web/layout/site-config.test.ts).
export const SITE_NAME = "off r39'x in 大阪らへん2027";

export const ORIGIN_HOST = "127.0.0.1:3100";

export const OFFERING_REGULAR = "e0000000-0000-4000-8000-000000000001";
export const GOODS_TSHIRT = "a0000000-0000-4000-8000-000000000001";
export const GOODS_TOWEL = "a0000000-0000-4000-8000-000000000002";

const seedCalls = new WeakMap<Page, number>();

/**
 * Preseeds localStorage once per call and tab: a reload does not overwrite later changes, and a later
 * call on the same page (for example a loop that visits several scenarios) seeds again on its next
 * navigation. Each call has its own sessionStorage flag, so an earlier call never masks a later one.
 */
export async function seedLocalStorage(page: Page, entries: Record<string, string>): Promise<void> {
  const callId = (seedCalls.get(page) ?? 0) + 1;
  seedCalls.set(page, callId);
  await page.addInitScript(
    ({ payload, flag }: { payload: Record<string, string>; flag: string }) => {
      if (window.sessionStorage.getItem(flag) === "1") return;
      window.sessionStorage.setItem(flag, "1");
      for (const [key, value] of Object.entries(payload)) window.localStorage.setItem(key, value);
    },
    { payload: entries, flag: `__r39x_seeded_${callId}__` },
  );
}

export function sessionJson(
  session: { kind: "guest" } | { kind: "authenticated"; email: string; emailVerified: boolean } = {
    kind: "guest",
  },
): string {
  return JSON.stringify({ version: 1, session, pendingVerificationEmail: null });
}

export const authenticatedSession = (): string =>
  sessionJson({ kind: "authenticated", email: "demo@example.com", emailVerified: true });

export type ScenarioPatch = Record<string, unknown>;

/** A full valid scenario (S2 defaults) with the given top-level overrides. */
export function scenarioJson(patch: ScenarioPatch = {}): string {
  return JSON.stringify({
    version: 1,
    publicFetch: "ok",
    latency: "none",
    latencyLongMs: 3000,
    sponsorLogos: "published",
    cart: { state: "ok", purchaseStart: "ok" },
    checkout: "ok",
    karaokeHold: "ok",
    karaokeSales: "ON_SALE",
    paymentOutcome: "confirm_after_recheck",
    notification: "sent",
    auth: {
      session: "ok",
      login: "ok",
      signup: "confirmation_required",
      verify: "ok",
      reset: "ok",
      resetContext: "valid",
      logout: "ok",
    },
    eventFields: "complete",
    ...patch,
  });
}

export function cartJson(lines: readonly { kind: "ENTRY_TICKET" | "GOODS"; quantity: number }[]) {
  return JSON.stringify({
    version: 1,
    lines: lines.map((line) =>
      line.kind === "ENTRY_TICKET"
        ? { kind: "ENTRY_TICKET", offeringRef: OFFERING_REGULAR, quantity: line.quantity }
        : { kind: "GOODS", goodsRef: GOODS_TSHIRT, quantity: line.quantity },
    ),
  });
}

export function isDesktop(page: Page): boolean {
  const size = page.viewportSize();
  return (size?.width ?? 0) >= 768;
}

/** Collects pageerror and console.error (ignoring resource-load failures such as intentional 404 images). */
export function watchRuntimeErrors(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("Failed to load resource")) return;
    errors.push(`console.error: ${text}`);
  });
  return { errors };
}

/** Hosts of every request the page makes (data: / blob: are ignored). */
export function watchRequestHosts(page: Page): { hosts: Set<string> } {
  const hosts = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    hosts.add(url.host);
  });
  return { hosts };
}

/** Every anchor href in the document, resolved against the current URL. */
export async function allHrefs(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href),
  );
}

export const FORBIDDEN_AREA = /^\/(admin|staff)(\/|$)/i;

export function pathOf(href: string): string {
  return new URL(href).pathname;
}
