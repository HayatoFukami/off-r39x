import type { Locator, Page } from "@playwright/test";
import { copy } from "../../../apps/web/src/presentation/copy/ja.ts";
import { TEST_PASSWORD } from "../mock-seed.ts";
import { KEYS, scenarioJson } from "./shell.ts";

// Browser-side helpers for the S6 authentication suite (tests/contracts/s6-auth.md section 7).
// Test-only. All data is synthetic: example.com addresses and sentinel passwords that exist nowhere else,
// so that any leak of them (URL, storage, DOM text, console) is unambiguous.

/** A password that is not any seed value. It must never appear in a URL, storage, DOM text or console. */
export const SENTINEL_PASSWORD = "Sentinel-Pass-Phrase-9876";
/** An opaque verification / reset context (mock). It must be removed from the URL and never rendered. */
export const CONTEXT_VALUE = "ctx-opaque-sentinel-4321";
export const MARKER_PROTECTED_TEXT = "ログイン中の方だけに表示される内容です";

export { TEST_PASSWORD };

const DEFAULT_AUTH = {
  session: "ok",
  login: "ok",
  signup: "confirmation_required",
  verify: "ok",
  reset: "ok",
  resetContext: "valid",
  logout: "ok",
} as const;

/** localStorage entry for a scenario whose auth switches are overridden (the rest are S2 defaults). */
export function authScenario(auth: Record<string, string> = {}): Record<string, string> {
  return { [KEYS.scenario]: scenarioJson({ auth: { ...DEFAULT_AUTH, ...auth } }) };
}

export function guestWithPending(email: string | null): string {
  return JSON.stringify({
    version: 1,
    session: { kind: "guest" },
    pendingVerificationEmail: email,
  });
}

export function unverifiedSession(): string {
  return JSON.stringify({
    version: 1,
    session: { kind: "authenticated", email: "unverified@example.com", emailVerified: false },
    pendingVerificationEmail: null,
  });
}

// ---- locators ------------------------------------------------------------------------------

export const mainOf = (page: Page): Locator => page.getByRole("main");
export const heading1 = (page: Page): Locator => page.getByRole("heading", { level: 1 });

export const field = (page: Page, label: string): Locator =>
  mainOf(page).getByLabel(label, { exact: true });
export const submitButton = (page: Page, name: string): Locator =>
  mainOf(page).getByRole("button", { name, exact: true });
export const linkIn = (page: Page, name: string): Locator =>
  mainOf(page).getByRole("link", { name, exact: true });
export const alertsIn = (page: Page): Locator => mainOf(page).locator('[role="alert"]');
export const statusesIn = (page: Page): Locator => mainOf(page).locator('[role="status"]');

export const headerBanner = (page: Page): Locator => page.getByRole("banner");
export const headerLogin = (page: Page): Locator =>
  headerBanner(page).getByRole("link", { name: copy.layout.account.login, exact: true });
export const headerMypage = (page: Page): Locator =>
  headerBanner(page).getByRole("link", { name: copy.layout.account.mypage, exact: true });
export const accountMenuButton = (page: Page): Locator =>
  headerBanner(page).getByRole("button", { name: copy.layout.account.menuButton, exact: true });

/** Fills Login and submits with the form's own button (the Header also has a "ログイン" link). */
export async function loginWith(
  page: Page,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<void> {
  await field(page, copy.auth.field.email.label).fill(email);
  await field(page, copy.auth.field.password.label).fill(password);
  await submitButton(page, copy.auth.login.submit).click();
}

/** Opens the Account menu and presses Logout. */
export async function logoutViaMenu(page: Page): Promise<void> {
  await accountMenuButton(page).click();
  await page
    .getByRole("navigation", { name: copy.layout.account.menuLabel })
    .getByRole("button", { name: copy.layout.account.logout, exact: true })
    .click();
}

// ---- state readers -------------------------------------------------------------------------

export type StoredSession = {
  version: number;
  session: { kind: "guest" } | { kind: "authenticated"; email: string; emailVerified: boolean };
  pendingVerificationEmail: string | null;
};

export async function readSessionRaw(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), KEYS.session);
}

/** The stored mock session; a missing key is the guest default. */
export async function readSession(page: Page): Promise<StoredSession["session"]> {
  const raw = await readSessionRaw(page);
  if (raw === null) return { kind: "guest" };
  return (JSON.parse(raw) as StoredSession).session;
}

/** Every key and value of localStorage and sessionStorage, as one string (for leak checks). */
export async function dumpStorage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const local: Record<string, string | null> = {};
    const session: Record<string, string | null> = {};
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key !== null) local[key] = window.localStorage.getItem(key);
    }
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key !== null) session[key] = window.sessionStorage.getItem(key);
    }
    return JSON.stringify({ local, session });
  });
}

export const urlOf = (page: Page): URL => new URL(page.url());

/** The element that currently has focus: role, tag and accessible-name basics. */
export async function focused(
  page: Page,
): Promise<{ role: string | null; tag: string; id: string }> {
  return page.evaluate(() => {
    const el = document.activeElement;
    return {
      role: el?.getAttribute("role") ?? null,
      tag: el?.tagName.toLowerCase() ?? "",
      id: el?.id ?? "",
    };
  });
}

/** Text of every element referenced by aria-describedby of the element, joined by a space. */
export async function describedText(locator: Locator): Promise<string> {
  return locator.evaluate((el) => {
    const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
  });
}

/**
 * Records, from document start, whether protected text ever appeared in the DOM (also across client-side
 * navigation). A full reload resets the flag, which is fine: a fresh document starts without protected text.
 */
export async function watchForProtectedText(page: Page, text: string): Promise<void> {
  await page.addInitScript((needle: string) => {
    const w = window as unknown as { __sawProtected?: boolean };
    w.__sawProtected = false;
    const check = (): void => {
      if (document.body?.innerText.includes(needle)) w.__sawProtected = true;
    };
    new MutationObserver(check).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }, text);
}

export async function sawProtectedText(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as { __sawProtected?: boolean }).__sawProtected === true,
  );
}

/** Collects every console message text (all types) for leak checks. */
export function watchConsole(page: Page): { messages: string[] } {
  const messages: string[] = [];
  page.on("console", (message) => {
    messages.push(message.text());
  });
  page.on("pageerror", (error) => {
    messages.push(error.message);
  });
  return { messages };
}
