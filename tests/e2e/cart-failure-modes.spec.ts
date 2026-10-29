import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  field,
  loginWith,
  MARKER_PROTECTED_TEXT,
  readSession,
  submitButton,
} from "../harness/browser/auth.ts";
import {
  addButton,
  cartEntries,
  describedText,
  entryLine,
  expectedGoodsDetail,
  failCartWrites,
  goodsLine,
  headerCartLink,
  liveRegion,
  mainOf,
  offeringName,
  proceedButton,
  quantityInput,
  readCartRaw,
  readDbRaw,
  removeButton,
  rowByHeading,
} from "../harness/browser/cart.ts";
import { gotoHydrated } from "../harness/browser/hydration.ts";
import { guestButton, slotRoute, slotStateInDb } from "../harness/browser/karaoke-purchase.ts";
import { fixClock } from "../harness/browser/public.ts";
import { newOrders, openAs } from "../harness/browser/purchase.ts";
import { authenticatedSession, KEYS, seedLocalStorage } from "../harness/browser/shell.ts";
import { EMAIL, GOODS, OFFERING, SLOT, TEST_PASSWORD } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Review gap tests for S5 verification (round 1):
// a write that did not happen is never shown as done, an unreadable store is never an empty Cart.
// SPEC-050 26.4, 9.2, 9.3, 12.1, 14A.1, 21, FR-CRT-001 / 003 / 012.

const main = mainOf;
const rows = (page: Page) => main(page).getByRole("listitem");

/** Forces a failing localStorage read for the Cart key (blocked storage). */
async function failCartReads(page: Page): Promise<void> {
  await page.addInitScript((key: string) => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(this: Storage, name: string) {
      if (name === key) throw new DOMException("blocked", "SecurityError");
      return original.call(this, name);
    };
  }, KEYS.cart);
}

test.describe("TC-PG-CRT-001-541 a failed Cart write on the Cart page is never shown as saved or removed (SPEC-050 26.4, 9.3)", () => {
  test("a quantity that cannot be saved keeps storage unchanged and blocks Cart contents and count", async ({
    page,
  }) => {
    const lines = [entryLine(OFFERING.regular, 2)];
    await fixClock(page);
    await seedLocalStorage(page, cartEntries(lines));
    await failCartWrites(page);
    await gotoHydrated(page, "/cart");
    await expect(rows(page)).toHaveCount(1);
    const before = await readCartRaw(page);
    await quantityInput(rows(page).nth(0)).fill("5");
    await expect(main(page).getByRole("alert")).toContainText(copy.cart.lifecycleBlocked.title);
    expect(await readCartRaw(page)).toBe(before);
    await expect(headerCartLink(page, null)).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
    await expect(proceedButton(page)).toHaveCount(0);
    await expect(liveRegion(page)).toHaveCount(0);
  });

  test("a failed removal preserves storage and stops Cart display and editing", async ({
    page,
  }) => {
    const lines = [entryLine(OFFERING.regular, 2), goodsLine(GOODS.tshirt, 1)];
    await fixClock(page);
    await seedLocalStorage(page, cartEntries(lines));
    await failCartWrites(page);
    await gotoHydrated(page, "/cart");
    await expect(rows(page)).toHaveCount(2);
    const before = await readCartRaw(page);
    await removeButton(rows(page).nth(0)).click();
    await expect(main(page).getByRole("alert")).toContainText(copy.cart.lifecycleBlocked.title);
    await expect(rows(page)).toHaveCount(0);
    expect(await readCartRaw(page)).toBe(before);
    await expect(headerCartLink(page, null)).toBeVisible();
    await expect(proceedButton(page)).toHaveCount(0);
  });
});

test.describe("TC-PG-GDS-002-541 a Goods add that cannot be written is reported, never reported as added (SPEC-050 26.4, 9.3, 14.2)", () => {
  test("a storage write failure shows the failure and no success, and stores nothing", async ({
    page,
  }) => {
    const goods = expectedGoodsDetail(GOODS.tshirt);
    await fixClock(page);
    await failCartWrites(page);
    await gotoHydrated(page, `/goods/${GOODS.tshirt}`);
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText(goods.name);
    await addButton(main(page)).click();
    await expect(main(page).getByRole("alert")).toContainText(copy.sales.addFailed);
    await expect(liveRegion(page)).not.toContainText(copy.sales.addSucceeded);
    expect(await readCartRaw(page)).toBeNull();
  });
});

/** Whether the Cart key exists in storage. Does not go through getItem, so it works under failCartReads. */
async function cartKeyStored(page: Page): Promise<boolean> {
  return page.evaluate((key: string) => Object.keys(window.localStorage).includes(key), KEYS.cart);
}

test.describe("TC-PG-CRT-001-542 a Cart store that cannot be read (Guest, no Cart lifecycle metadata) is an unknown state, never an empty Cart, and stops Cart additions (SPEC-050 9.2, 12.1, 14A.1, 21, FR-CRT-012)", () => {
  test("the Cart page reports a failure, shows no empty wording, no rows and no proceed button", async ({
    page,
  }) => {
    await fixClock(page);
    await failCartReads(page);
    await gotoHydrated(page, "/cart");
    await expect(main(page).getByRole("alert")).toContainText(copy.cart.lifecycleBlocked.title);
    await expect(main(page)).not.toContainText(copy.cart.empty);
    await expect(rows(page)).toHaveCount(0);
    await expect(proceedButton(page)).toHaveCount(0);
    await expect(headerCartLink(page, null)).toBeVisible();
  });

  test("the Entry page stays viewable but disables quantity and Add with the Cart stop reason while the store cannot be read", async ({
    page,
  }) => {
    await fixClock(page);
    await failCartReads(page);
    await gotoHydrated(page, "/entry");
    const row = rowByHeading(page, offeringName(OFFERING.regular));
    // The sale stays viewable (SPEC-050 12.1: browsing continues while the Cart is stopped).
    await expect(row).toBeVisible();
    // Auto-wait first: the Cart lifecycle settles to blocked after hydration.
    await expect(addButton(row)).toBeDisabled();
    // Native disabled, not aria-disabled: the form cannot be submitted.
    await expect(addButton(row)).toHaveJSProperty("disabled", true);
    await expect(quantityInput(row)).toBeDisabled();
    // The stop reason is attached to Add (SPEC-050 25), including the link to the Cart.
    const reason = await describedText(addButton(row));
    expect(reason).toContain(copy.cart.lifecycleBlocked.description);
    expect(reason).toContain(copy.cart.corrupted.goToCart);
    await expect(
      row.getByRole("link", { name: copy.cart.corrupted.goToCart, exact: true }),
    ).toHaveAttribute("href", "/cart");
    // No success is announced and no count is shown.
    await expect(liveRegion(page)).not.toContainText(copy.sales.addSucceeded);
    await expect(main(page)).not.toContainText(copy.sales.addSucceeded);
    await expect(headerCartLink(page, null)).toBeVisible();
    // Nothing was stored (the Cart key stays absent).
    expect(await cartKeyStored(page)).toBe(false);
  });
});

type MetadataProvenance = "guest" | "authenticated";

/** Valid Cart lifecycle metadata (no Cart key) for the given provenance, with the matching mock session. */
function lifecycleSeed(provenance: MetadataProvenance): Record<string, string> {
  return {
    [KEYS.cartLifecycle]: JSON.stringify({ version: 1, provenance }),
    ...(provenance === "authenticated" ? { [KEYS.session]: authenticatedSession() } : {}),
  };
}

const unreadableTargets = [
  {
    name: "Entry",
    path: "/entry",
    scope: (page: Page) => rowByHeading(page, offeringName(OFFERING.regular)),
    sale: (page: Page) => rowByHeading(page, offeringName(OFFERING.regular)),
  },
  {
    name: "Goods detail",
    path: `/goods/${GOODS.tshirt}`,
    scope: (page: Page) => main(page),
    sale: (page: Page) =>
      main(page).getByRole("heading", { level: 1, name: expectedGoodsDetail(GOODS.tshirt).name }),
  },
] as const;

test.describe("TC-PG-CRT-001-543 a Cart store that cannot be read stops Cart additions the same way when valid Cart lifecycle metadata exists (guest / authenticated), on Entry and Goods detail; with guest metadata the AuthGate, the Guest Karaoke hand-off, Login and Registration stop instead of crossing into Auth (Q-1) (SPEC-050 12.1, 14.2, 14A.1, 15.6, 25, FR-CRT-012, AR-SES-007)", () => {
  for (const provenance of ["guest", "authenticated"] as const) {
    for (const target of unreadableTargets) {
      test(`${target.name} with ${provenance} metadata: sale stays viewable, quantity and Add are natively disabled with the Cart stop reason`, async ({
        page,
      }) => {
        await fixClock(page);
        await seedLocalStorage(page, lifecycleSeed(provenance));
        await failCartReads(page);
        await gotoHydrated(page, target.path);
        const scope = target.scope(page);
        // (1) The sale information stays viewable (SPEC-050 12.1 / 14.2).
        await expect(target.sale(page)).toBeVisible();
        // (2) Auto-wait first: the lifecycle settles after hydration. Native disabled, not aria-disabled.
        await expect(addButton(scope)).toBeDisabled();
        await expect(addButton(scope)).toHaveJSProperty("disabled", true);
        await expect(quantityInput(scope)).toBeDisabled();
        // (3) The stop reason (not the damaged-Cart alert) is attached to Add, with the link to the Cart.
        const reason = await describedText(addButton(scope));
        expect(reason).toContain(copy.cart.lifecycleBlocked.description);
        expect(reason).toContain(copy.cart.corrupted.goToCart);
        expect(reason).not.toContain(copy.cart.corrupted.title);
        await expect(
          scope.getByRole("link", { name: copy.cart.corrupted.goToCart, exact: true }),
        ).toHaveAttribute("href", "/cart");
        // (4) Nothing can be added, so no success and no damaged-Cart alert appears.
        await expect(liveRegion(page)).not.toContainText(copy.sales.addSucceeded);
        await expect(main(page)).not.toContainText(copy.sales.addSucceeded);
        await expect(
          main(page).getByRole("alert").filter({ hasText: copy.cart.corrupted.title }),
        ).toHaveCount(0);
        // (5) The Header does not show a count.
        await expect(headerCartLink(page, null)).toBeVisible();
        // (6) Nothing was stored: the Cart key stays absent and the seeded metadata is unchanged.
        expect(await cartKeyStored(page)).toBe(false);
      });
    }
  }

  test("the Cart page with guest metadata shows the same stop as without metadata: no rows, no proceed button, no empty wording, no count", async ({
    page,
  }) => {
    await fixClock(page);
    await seedLocalStorage(page, lifecycleSeed("guest"));
    await failCartReads(page);
    await gotoHydrated(page, "/cart");
    await expect(main(page).getByRole("alert")).toContainText(copy.cart.lifecycleBlocked.title);
    await expect(main(page)).not.toContainText(copy.cart.empty);
    await expect(rows(page)).toHaveCount(0);
    await expect(proceedButton(page)).toHaveCount(0);
    await expect(headerCartLink(page, null)).toBeVisible();
    expect(await cartKeyStored(page)).toBe(false);
  });

  // ---- Q-1 (user decision): metadata that says "guest" does not make an unreadable Cart safe ------------------------------
  // Only the Cart key's getItem throws; the metadata is valid and says guest. The Cart cannot be confirmed to hold no
  // authenticated Cart, so everything that would cross into Auth stops and offers the explicit recovery (SPEC-050 15.6,
  // FR-CRT-012, AR-SES-007). Guest-only metadata alone is not taken as proof that the unreadable Cart is safe.
  const recoverButton = (page: Page) =>
    main(page).getByRole("button", { name: copy.cart.lifecycleBlocked.retry, exact: true });
  const recoveryAlert = (page: Page) =>
    main(page).getByRole("alert").filter({ hasText: copy.cart.lifecycleBlocked.title });

  /** Same fault as failCartReads, but the page can make the store readable again (a flag in sessionStorage). */
  async function failCartReadsUntilEnabled(page: Page): Promise<void> {
    await page.addInitScript((key: string) => {
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function getItem(this: Storage, name: string) {
        if (name === key && window.sessionStorage.getItem("test-only-cart-read-enabled") !== "yes")
          throw new DOMException("blocked", "SecurityError");
        return original.call(this, name);
      };
    }, KEYS.cart);
  }
  const enableCartReads = (page: Page) =>
    page.evaluate(() => window.sessionStorage.setItem("test-only-cart-read-enabled", "yes"));

  /** Counts the writes to the mock session key: a raw sign-in / sign-up would write it, a stopped one never does. */
  async function countSessionWrites(page: Page): Promise<void> {
    await page.addInitScript((key: string) => {
      const w = window as unknown as { __sessionWrites: number };
      w.__sessionWrites = 0;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(this: Storage, name: string, value: string) {
        if (name === key) w.__sessionWrites += 1;
        return original.call(this, name, value);
      };
    }, KEYS.session);
  }
  const sessionWrites = (page: Page) =>
    page.evaluate(() => (window as unknown as { __sessionWrites: number }).__sessionWrites);

  /** Every URL (path and query) the main frame reaches after this call, client-side navigation included. */
  function watchNavigation(page: Page): string[] {
    const urls: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      const url = new URL(frame.url());
      urls.push(url.pathname + url.search);
    });
    return urls;
  }

  /** Submits the form without the (disabled) button: what reaches the port when something presses it anyway. */
  const forceSubmit = (page: Page) =>
    main(page)
      .locator("form")
      .evaluate((form) => (form as HTMLFormElement).requestSubmit());

  test("a protected page (/mypage) for a Guest with guest metadata shows the Cart recovery instead of redirecting to Login; recovery lets the redirect happen", async ({
    page,
  }) => {
    await fixClock(page);
    await seedLocalStorage(page, lifecycleSeed("guest"));
    await failCartReadsUntilEnabled(page);
    const urls = watchNavigation(page);
    await gotoHydrated(page, "/mypage");
    await expect(recoveryAlert(page)).toBeVisible();
    await expect(recoverButton(page)).toBeVisible();
    // No redirect, no protected content, no Login page; the URL is kept.
    await expect(page).toHaveURL(/\/mypage$/);
    await expect(main(page)).not.toContainText(MARKER_PROTECTED_TEXT);
    await expect(main(page)).not.toContainText(copy.auth.login.heading);
    await expect(main(page)).not.toContainText(copy.auth.gate.redirecting);
    expect(urls.filter((url) => !url.startsWith("/mypage"))).toEqual([]);
    expect(await cartKeyStored(page)).toBe(false);
    expect(await readSession(page)).toEqual({ kind: "guest" });

    // After the Cart can be read again, the explicit recovery lifts the stop and the Guest is sent to Login.
    await enableCartReads(page);
    await recoverButton(page).click();
    await expect(page).toHaveURL(/\/account\/login\?continue=mypage$/);
    await expect(main(page)).toContainText(copy.auth.login.heading);
  });

  test("a Guest's Karaoke purchase start with guest metadata does not hand off to Login: the Cart recovery is shown, nothing is created, and recovery lets the next press hand off", async ({
    page,
  }) => {
    const path = slotRoute(SLOT.d1_1000);
    await failCartReadsUntilEnabled(page);
    await openAs(page, path, { session: null, extra: lifecycleSeed("guest") });
    await expect(guestButton(page)).toBeEnabled();
    const dbBefore = await readDbRaw(page);
    const urls = watchNavigation(page);
    await guestButton(page).click();
    await expect(recoveryAlert(page)).toBeVisible();
    await expect(recoverButton(page)).toBeVisible();
    // Cart recovery, not a hand-off: the page and the slot stay and the action is stopped.
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(guestButton(page)).toBeDisabled();
    // (The action is named "ログインして購入手続きへ", so the Login page is told apart by its heading.)
    await expect(
      main(page).getByRole("heading", { name: copy.auth.login.heading, exact: true }),
    ).toHaveCount(0);
    expect(urls.filter((url) => !url.startsWith(path))).toEqual([]);
    // No Order and no Hold; the slot and the mock database are untouched; no authentication call.
    expect(await newOrders(page)).toHaveLength(0);
    expect(await slotStateInDb(page, SLOT.d1_1000)).toBe("AVAILABLE");
    expect(await readDbRaw(page)).toBe(dbBefore);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    expect(await cartKeyStored(page)).toBe(false);

    // After the Cart can be read again, the recovery lifts the stop; the next press hands off to Login.
    await enableCartReads(page);
    await recoverButton(page).click();
    await expect(recoverButton(page)).toHaveCount(0);
    await expect(guestButton(page)).toBeEnabled();
    await guestButton(page).click();
    await expect(page).toHaveURL(/\/account\/login\?continue=karaoke-slot/);
    expect(await newOrders(page)).toHaveLength(0);
    expect(await readDbRaw(page)).toBe(dbBefore);
  });

  test("Login with guest metadata and an unreadable Cart is cart_blocked: the recovery is shown, submit is disabled, a forced submit makes no authentication call; after recovery Login works", async ({
    page,
  }) => {
    await fixClock(page);
    await seedLocalStorage(page, lifecycleSeed("guest"));
    await failCartReadsUntilEnabled(page);
    await countSessionWrites(page);
    await gotoHydrated(page, "/account/login");
    const urls = watchNavigation(page);
    await expect(recoveryAlert(page)).toBeVisible();
    await expect(submitButton(page, copy.auth.login.submit)).toBeDisabled();
    await field(page, copy.auth.field.email.label).fill(EMAIL.other);
    await field(page, copy.auth.field.password.label).fill(TEST_PASSWORD);
    await forceSubmit(page);
    // Stopped in the lifecycle port: still on Login, still Guest, the session key was never written, and no failure
    // text of a raw sign-in (credential / service) appears.
    await expect(recoveryAlert(page)).toBeVisible();
    await expect(main(page)).not.toContainText(copy.auth.login.credentialFailure);
    await expect(main(page)).not.toContainText(copy.auth.login.unavailable);
    await expect(page).toHaveURL(/\/account\/login$/);
    expect(urls.filter((url) => !url.startsWith("/account/login"))).toEqual([]);
    expect(await sessionWrites(page)).toBe(0);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    expect(await cartKeyStored(page)).toBe(false);

    // After the Cart can be read again, the explicit recovery lifts the stop and Login proceeds.
    await enableCartReads(page);
    await recoverButton(page).click();
    await expect(recoverButton(page)).toHaveCount(0);
    await expect(submitButton(page, copy.auth.login.submit)).toBeEnabled();
    await loginWith(page, EMAIL.other);
    await expect(page).toHaveURL(/\/mypage$/);
    await expect(main(page)).toContainText(EMAIL.other);
  });

  test("Registration with guest metadata and an unreadable Cart is cart_blocked: the recovery is shown, submit is disabled and a forced submit makes no authentication call", async ({
    page,
  }) => {
    await fixClock(page);
    await seedLocalStorage(page, lifecycleSeed("guest"));
    await failCartReadsUntilEnabled(page);
    await countSessionWrites(page);
    await gotoHydrated(page, "/account/register");
    const urls = watchNavigation(page);
    await expect(recoveryAlert(page)).toBeVisible();
    await expect(submitButton(page, copy.auth.register.submit)).toBeDisabled();
    await field(page, copy.auth.field.email.label).fill("b4c-new@example.com");
    await field(page, copy.auth.field.password.label).fill(TEST_PASSWORD);
    await field(page, copy.auth.field.passwordConfirm.label).fill(TEST_PASSWORD);
    await forceSubmit(page);
    await expect(recoveryAlert(page)).toBeVisible();
    await expect(page).toHaveURL(/\/account\/register$/);
    expect(urls.filter((url) => !url.startsWith("/account/register"))).toEqual([]);
    expect(await sessionWrites(page)).toBe(0);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    expect(await cartKeyStored(page)).toBe(false);
  });
});
