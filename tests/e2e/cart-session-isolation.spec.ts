import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  loginWith,
  logoutViaMenu,
  MARKER_PROTECTED_TEXT,
  readSession,
} from "../harness/browser/auth.ts";
import {
  addButton,
  cartEntries,
  entryLine,
  headerCartLink,
  mainOf,
  offeringName,
  readCartRaw,
  readDbRaw,
} from "../harness/browser/cart.ts";
import { gotoHydrated, waitForHydration } from "../harness/browser/hydration.ts";
import { guestButton, purchaseButton, slotRoute } from "../harness/browser/karaoke-purchase.ts";
import { fixClock } from "../harness/browser/public.ts";
import { openAs, proceedButton } from "../harness/browser/purchase.ts";
import { KEYS, sessionJson } from "../harness/browser/shell.ts";
import { EMAIL, OFFERING, SLOT } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004), auxiliary browser storage isolation; not production G8/API/DB coverage.
const CART = [entryLine(OFFERING.regular, 2)];

async function failClear(page: Page): Promise<void> {
  await page.addInitScript((key: string) => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (name: string) {
      if (name === key && window.sessionStorage.getItem("test-only-clear-enabled") !== "yes") {
        throw new DOMException("test-only blocked clear", "SecurityError");
      }
      return original.call(this, name);
    };
  }, KEYS.cart);
}

const retry = (page: Page) =>
  mainOf(page).getByRole("button", { name: copy.cart.lifecycleBlocked.retry, exact: true });
async function expectBlocked(
  page: Page,
  path: string,
  cartBefore: string | null,
  dbBefore: string | null,
): Promise<void> {
  await expect(retry(page)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(path);
  expect(await readCartRaw(page)).toBe(cartBefore);
  expect(await readDbRaw(page)).toBe(dbBefore);
  await expect(headerCartLink(page, null)).toBeVisible();
  await expect(headerCartLink(page, 2)).toHaveCount(0);
  await retry(page).click({ timeout: 5_000 });
  await expect(retry(page)).toBeVisible();
  await expect(mainOf(page)).toContainText(copy.cart.lifecycleBlocked.failed);
  await expect(retry(page)).toBeEnabled();
  expect(new URL(page.url()).pathname).toBe(path);
  expect(await readCartRaw(page)).toBe(cartBefore);
}

async function enableClear(page: Page): Promise<void> {
  await page.evaluate(() => window.sessionStorage.setItem("test-only-clear-enabled", "yes"));
  await expect(retry(page)).toBeEnabled();
  await retry(page).click({ timeout: 5_000 });
  await expect.poll(() => readCartRaw(page)).toBeNull();
}

test.describe("TC-FR-CRT-012-005 protected page expiry cleanup must succeed before Login (FR-CRT-012, AR-SES-007)", () => {
  test("AuthGate hides protected content, keeps its URL and offers persistent recovery when clear fails", async ({
    page,
  }) => {
    await failClear(page);
    await openAs(page, "/mypage", { session: null, extra: cartEntries(CART, "authenticated") });
    const dbBefore = await readDbRaw(page);
    const cartBefore = await readCartRaw(page);
    await expectBlocked(page, "/mypage", cartBefore, dbBefore);
    await expect(mainOf(page)).not.toContainText(MARKER_PROTECTED_TEXT);
    await enableClear(page);
    await expect(page).toHaveURL(/\/account\/login\?continue=mypage$/);
    expect(await readDbRaw(page)).toBe(dbBefore);
  });
});

test.describe("TC-FR-CRT-012-007 initial storage denial and successful Auth remain recoverable (FR-CRT-012)", () => {
  for (const path of ["/cart"]) {
    test(`${path}: storage acquisition denial recovers all subscriptions and Auth decoration`, async ({
      page,
    }) => {
      await fixClock(page);
      await page.addInitScript(
        ({ entries }) => {
          const storage = window.localStorage;
          if (window.sessionStorage.getItem("test-only-denial-seeded") !== "yes") {
            for (const [key, value] of Object.entries(entries)) storage.setItem(key, value);
            window.sessionStorage.setItem("test-only-denial-seeded", "yes");
          }
          Object.defineProperty(window, "localStorage", {
            configurable: true,
            get() {
              if (window.sessionStorage.getItem("test-only-storage-enabled") !== "yes")
                throw new DOMException("test-only storage denial", "SecurityError");
              return storage;
            },
          });
        },
        { entries: cartEntries(CART, "authenticated") },
      );
      await gotoHydrated(page, path);
      await expect(retry(page)).toBeVisible();
      await expect(headerCartLink(page, null)).toBeVisible();
      await retry(page).click();
      await expect(retry(page)).toBeVisible();
      await expect(mainOf(page)).toContainText(copy.cart.lifecycleBlocked.failed);
      expect(new URL(page.url()).pathname).toBe(path);
      await page.evaluate(() => window.sessionStorage.setItem("test-only-storage-enabled", "yes"));
      await Promise.all([page.waitForEvent("load"), retry(page).click()]);
      await waitForHydration(page);
      await expect.poll(() => readCartRaw(page)).toBeNull();
      await gotoHydrated(page, "/entry");
      const offering = mainOf(page)
        .getByRole("listitem")
        .filter({
          has: page.getByRole("heading", { name: offeringName(OFFERING.regular), exact: true }),
        });
      await addButton(offering).click();
      await expect(headerCartLink(page, 1)).toBeVisible();
      await gotoHydrated(page, "/account/login");
      await loginWith(page, EMAIL.other);
      await expect(page).toHaveURL(/\/mypage$/);
      await expect(headerCartLink(page, 1)).toBeVisible();
      await logoutViaMenu(page);
      await expect(page).toHaveURL(/\/$/);
      await expect.poll(() => readCartRaw(page)).toBeNull();
      await expect(headerCartLink(page, null)).toBeVisible();
    });
  }
  test("/mypage: storage denial does not block AuthGate from sending a Guest to Login", async ({
    page,
  }) => {
    await fixClock(page);
    await page.addInitScript(
      ({ entries }) => {
        const storage = window.localStorage;
        if (window.sessionStorage.getItem("test-only-denial-seeded") !== "yes") {
          for (const [key, value] of Object.entries(entries)) storage.setItem(key, value);
          window.sessionStorage.setItem("test-only-denial-seeded", "yes");
        }
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          get() {
            if (window.sessionStorage.getItem("test-only-storage-enabled") !== "yes")
              throw new DOMException("test-only storage denial", "SecurityError");
            return storage;
          },
        });
      },
      { entries: cartEntries(CART, "authenticated") },
    );
    await gotoHydrated(page, "/mypage");
    await expect(page).toHaveURL(/\/account\/login\?continue=mypage$/);
    await expect(retry(page)).toBeVisible();
    await expect(headerCartLink(page, null)).toBeVisible();
    await expect(mainOf(page)).toContainText(copy.auth.login.heading);
    await expect(mainOf(page)).toContainText(copy.cart.lifecycleBlocked.storageTitle);
    await expect(mainOf(page)).toContainText(copy.cart.lifecycleBlocked.storageUnavailable);
  });
  for (const email of [EMAIL.other, EMAIL.unverified]) {
    test(`${email === EMAIL.other ? "verified" : "unverified"}: final metadata failure preserves successful Auth navigation`, async ({
      page,
    }) => {
      await page.addInitScript((key) => {
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (name, value) {
          if (
            name === key &&
            window.sessionStorage.getItem("test-only-final-write-enabled") !== "yes"
          ) {
            const metadata = JSON.parse(value);
            if (metadata.provenance === "authenticated" && !metadata.transitioning)
              throw new DOMException("test-only metadata failure", "SecurityError");
          }
          return setItem.call(this, name, value);
        };
      }, KEYS.cartLifecycle);
      await openAs(page, "/account/login", { session: null, lines: CART });
      await loginWith(page, email);
      await expect(page).toHaveURL(
        email === EMAIL.other ? /\/mypage$/ : /\/account\/email-verification/,
      );
      expect(await readSession(page)).toMatchObject({ kind: "authenticated", email });
      if (email === EMAIL.other) await expect(mainOf(page)).toContainText(email);
      await expect(headerCartLink(page, null)).toBeVisible();
      await gotoHydrated(page, "/cart");
      await expect(retry(page)).toBeVisible();
      await page.evaluate(() =>
        window.sessionStorage.setItem("test-only-final-write-enabled", "yes"),
      );
      await retry(page).click();
      await expect(mainOf(page)).toContainText(copy.cart.empty);
      expect(await readSession(page)).toMatchObject({ kind: "authenticated", email });
    });
  }
});

test.describe("TC-FR-CRT-012-006 protected purchase expiry and raw Guest preflight fail closed (FR-CRT-012, AR-SES-007)", () => {
  for (const target of ["cart", "karaoke"] as const) {
    for (const source of ["api_expiry", "guest_preflight"] as const) {
      test(`${target} ${source}: clear failure blocks Login and purchase until recovery succeeds`, async ({
        page,
      }) => {
        await failClear(page);
        const path = target === "cart" ? "/cart" : slotRoute(SLOT.d1_1000);
        await openAs(
          page,
          path,
          source === "api_expiry"
            ? { lines: CART }
            : { session: null, extra: cartEntries(CART, "authenticated") },
        );
        const cartBefore = await readCartRaw(page);
        const dbBefore = await readDbRaw(page);
        // Expiry after render is first discovered by the protected API action. No storage event updates the UI cache.
        if (source === "api_expiry")
          await page.evaluate(
            ([key, value]) => window.localStorage.setItem(key as string, value as string),
            [KEYS.session, sessionJson()],
          );
        await (target === "cart"
          ? proceedButton(page)
          : source === "guest_preflight"
            ? guestButton(page)
            : purchaseButton(page)
        ).click({ timeout: 5_000 });
        await expectBlocked(page, path, cartBefore, dbBefore);
        if (target === "karaoke") {
          await expect(
            mainOf(page).getByRole("heading", {
              name: copy.karaoke.slotDetail.heading,
              exact: true,
            }),
          ).toBeVisible();
        }
        if (target === "cart") {
          await expect(mainOf(page).getByRole("listitem")).toHaveCount(0);
          await expect(mainOf(page).getByRole("spinbutton")).toHaveCount(0);
          await expect(proceedButton(page)).toHaveCount(0);
        }
        await enableClear(page);
        // Recovery can complete the pending Login navigation or allow the protected operation to be retried.
        if (new URL(page.url()).pathname === path && target === "karaoke") {
          await purchaseButton(page).or(guestButton(page)).click();
        }
        if (target === "karaoke")
          await expect(page).toHaveURL(/\/account\/login\?continue=karaoke-slot/);
        expect(await readDbRaw(page)).toBe(dbBefore);
        await gotoHydrated(page, "/cart");
        await expect(mainOf(page)).toContainText(copy.cart.empty);
      });
    }
  }
});

test("TC-FR-CRT-012-008 a blocked Cart does not stop authenticated Karaoke browsing or purchase", async ({
  page,
}) => {
  const path = slotRoute(SLOT.d1_1000);
  await openAs(page, path, {
    lines: CART,
    extra: {
      [KEYS.cartLifecycle]: JSON.stringify({
        version: 1,
        provenance: "authenticated",
        transitioning: true,
      }),
    },
  });
  const cartBefore = await readCartRaw(page);
  await expect(
    mainOf(page).getByRole("region", { name: copy.karaoke.slotDetail.infoHeading, exact: true }),
  ).toBeVisible();
  await expect(headerCartLink(page, null)).toBeVisible();
  await purchaseButton(page).click();
  await page.waitForURL(/\/dev\/mock-checkout\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  expect(await readCartRaw(page)).toBe(cartBefore);
});

test("TC-FR-CRT-012-009 Login screen recovers an abandoned Cart transition before authentication", async ({
  page,
}) => {
  await openAs(page, "/account/login", {
    session: null,
    lines: CART,
    extra: {
      [KEYS.cartLifecycle]: JSON.stringify({
        version: 1,
        provenance: "guest",
        transitioning: true,
      }),
    },
  });
  await expect(retry(page)).toBeVisible();
  await expect(page).toHaveURL(/\/account\/login$/);
  await expect.poll(() => readCartRaw(page)).not.toBeNull();
  await expect(
    mainOf(page).getByRole("button", { name: copy.auth.login.submit, exact: true }),
  ).toBeDisabled();

  await retry(page).click();
  await expect(retry(page)).toHaveCount(0);
  await expect.poll(() => readCartRaw(page)).toBeNull();
  await expect(
    mainOf(page).getByRole("button", { name: copy.auth.login.submit, exact: true }),
  ).toBeEnabled();
  await loginWith(page, EMAIL.other);
  await expect(page).toHaveURL(/\/mypage$/);
});

test("TC-FR-CRT-012-009 Register screen offers the same explicit abandoned-transition recovery", async ({
  page,
}) => {
  await openAs(page, "/account/register", {
    session: null,
    lines: CART,
    extra: {
      [KEYS.cartLifecycle]: JSON.stringify({
        version: 1,
        provenance: "guest",
        transitioning: true,
      }),
    },
  });
  await expect(retry(page)).toBeVisible();
  await expect(
    mainOf(page).getByRole("button", { name: copy.auth.register.submit, exact: true }),
  ).toBeDisabled();
  await retry(page).click();
  await expect(retry(page)).toHaveCount(0);
  await expect.poll(() => readCartRaw(page)).toBeNull();
  await expect(
    mainOf(page).getByRole("button", { name: copy.auth.register.submit, exact: true }),
  ).toBeEnabled();
});

test("TC-FR-CRT-012-011 sale details remain viewable while Cart additions are blocked", async ({
  page,
}) => {
  await openAs(page, "/entry", {
    lines: CART,
    extra: {
      [KEYS.cartLifecycle]: JSON.stringify({
        version: 1,
        provenance: "authenticated",
        transitioning: true,
      }),
    },
  });
  const offering = mainOf(page)
    .getByRole("listitem")
    .filter({
      has: page.getByRole("heading", { name: offeringName(OFFERING.regular), exact: true }),
    });
  const cartBefore = await readCartRaw(page);
  await expect(offering).toBeVisible();
  await expect(addButton(offering)).toBeDisabled();
  await expect(offering.getByRole("spinbutton")).toBeDisabled();
  await expect(mainOf(page)).toContainText(copy.cart.lifecycleBlocked.description);
  await expect(headerCartLink(page, null)).toBeVisible();
  expect(await readCartRaw(page)).toBe(cartBefore);
});
