import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { loginWith, readSession } from "../harness/browser/auth.ts";
import { entryLine, headerCartLink, mainOf, readCartRaw } from "../harness/browser/cart.ts";
import { gotoHydrated, waitForHydration } from "../harness/browser/hydration.ts";
import { openAs } from "../harness/browser/purchase.ts";
import { KEYS } from "../harness/browser/shell.ts";
import { EMAIL, OFFERING } from "../harness/mock-seed.ts";

const CART = [entryLine(OFFERING.regular, 2)];
const LOCK = "r39x.cart-auth-transition.v1";
const retry = (page: Page) =>
  mainOf(page).getByRole("button", { name: copy.cart.lifecycleBlocked.retry, exact: true });

// UI mock auxiliary suite; the native-lock case exercises real Chromium tab coordination.
test.describe("TC-FR-CRT-012-014 Browser runtime lock errors preserve Cart isolation", () => {
  for (const mode of ["absent", "SecurityError"] as const) {
    test(`${mode}: Login succeeds with a Guest Cart and a later Login clears it`, async ({
      page,
    }) => {
      await page.addInitScript((mode) => {
        Object.defineProperty(navigator, "locks", {
          configurable: true,
          value:
            mode === "absent"
              ? undefined
              : {
                  request: async () => {
                    throw new DOMException("test-only unavailable API", mode);
                  },
                },
        });
      }, mode);
      await openAs(page, "/account/login", { session: null, lines: CART });
      await loginWith(page, EMAIL.other);
      await expect(page).toHaveURL(/\/mypage$/);
      expect(await readSession(page)).toMatchObject({ kind: "authenticated", email: EMAIL.other });
      await expect(headerCartLink(page, 2)).toBeVisible();
      // Stay in the same document and use the already selected coordinator for another Login.
      // The real Login page is reached using a client link after the Session is discarded externally.
      await page.evaluate((key) => {
        window.localStorage.removeItem(key);
        window.dispatchEvent(new StorageEvent("storage", { key }));
      }, KEYS.session);
      await page
        .getByRole("banner")
        .getByRole("link", { name: copy.layout.account.login, exact: true })
        .click();
      await loginWith(page, EMAIL.demo);
      await expect(page).toHaveURL(/\/mypage$/);
      expect(await readCartRaw(page)).toBeNull();
      await expect(headerCartLink(page, 2)).toHaveCount(0);
    });
  }

  test("an unclassified rejection does not authenticate or clear the old Cart", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "locks", {
        value: {
          request: async () => {
            throw new Error("test-only unknown lock state");
          },
        },
      });
    });
    await openAs(page, "/account/login", { session: null, lines: CART });
    const before = await readCartRaw(page);
    await loginWith(page, EMAIL.other);
    await expect(retry(page)).toBeVisible();
    await expect(page).toHaveURL(/\/account\/login$/);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    await retry(page).click();
    await expect(mainOf(page)).toContainText(copy.cart.lifecycleBlocked.failed);
    expect(await readCartRaw(page)).toBe(before);
  });

  test("initial storage denial can recover safely when Web Locks is also unavailable", async ({
    page,
  }) => {
    await page.addInitScript(
      ({ cartKey, metadataKey, lines }) => {
        const storage = window.localStorage;
        if (window.sessionStorage.getItem("test-only-combined-seeded") !== "yes") {
          storage.setItem(cartKey, JSON.stringify({ version: 1, lines }));
          storage.setItem(metadataKey, JSON.stringify({ version: 1, provenance: "authenticated" }));
          window.sessionStorage.setItem("test-only-combined-seeded", "yes");
        }
        Object.defineProperty(window, "localStorage", {
          get() {
            if (window.sessionStorage.getItem("test-only-combined-enabled") !== "yes")
              throw new DOMException("test-only storage denied", "SecurityError");
            return storage;
          },
        });
        Object.defineProperty(navigator, "locks", {
          value: {
            request: async () => {
              throw new DOMException("test-only manager unavailable", "SecurityError");
            },
          },
        });
      },
      { cartKey: KEYS.cart, metadataKey: KEYS.cartLifecycle, lines: CART },
    );
    await gotoHydrated(page, "/cart");
    await expect(retry(page)).toBeVisible();
    await page.evaluate(() => window.sessionStorage.setItem("test-only-combined-enabled", "yes"));
    await Promise.all([page.waitForEvent("load"), retry(page).click()]);
    await waitForHydration(page);
    await expect(mainOf(page)).toContainText(copy.cart.empty);
    expect(await readCartRaw(page)).toBeNull();
  });

  test("a marker plus an unavailable API cannot be cleared until a native Lock can be acquired", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const locks = navigator.locks;
      const request = locks.request.bind(locks);
      locks.request = ((...args: Parameters<typeof locks.request>) => {
        if (window.sessionStorage.getItem("test-only-native-locks") !== "yes")
          return Promise.reject(new DOMException("test-only unavailable API", "SecurityError"));
        return request(...args);
      }) as typeof locks.request;
    });
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
    const before = await readCartRaw(page);
    await expect(retry(page)).toBeVisible();
    await retry(page).click();
    await expect(mainOf(page)).toContainText(copy.cart.lifecycleBlocked.failed);
    expect(await readCartRaw(page)).toBe(before);
    await expect(headerCartLink(page, 2)).toHaveCount(0);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    await page.evaluate(() => window.sessionStorage.setItem("test-only-native-locks", "yes"));
    await retry(page).click();
    await expect(retry(page)).toHaveCount(0);
    expect(await readCartRaw(page)).toBeNull();
    await loginWith(page, EMAIL.other);
    await expect(page).toHaveURL(/\/mypage$/);
  });

  test("a native Lock held in another tab keeps Login busy until released", async ({
    page,
    context,
  }) => {
    await openAs(page, "/account/login", { session: null, lines: CART });
    const other = await context.newPage();
    await gotoHydrated(other, "/");
    await other.evaluate(
      async ({ name, key }) => {
        await new Promise<void>((started) => {
          void navigator.locks.request(name, async () => {
            window.localStorage.setItem(
              key,
              JSON.stringify({ version: 1, provenance: "guest", transitioning: true }),
            );
            started();
            await new Promise<void>((release) => {
              Object.assign(window, { testOnlyReleaseCartLock: release });
            });
          });
        });
      },
      { name: LOCK, key: KEYS.cartLifecycle },
    );
    await expect(mainOf(page)).toContainText(copy.auth.login.cartBusy);
    await loginWith(page, EMAIL.other);
    await expect(page).toHaveURL(/\/account\/login$/);
    await expect(headerCartLink(page, 2)).toHaveCount(0);
    expect(await readSession(page)).toEqual({ kind: "guest" });
    await other.evaluate((key) => {
      window.localStorage.setItem(key, JSON.stringify({ version: 1, provenance: "guest" }));
      (window as unknown as { testOnlyReleaseCartLock: () => void }).testOnlyReleaseCartLock();
    }, KEYS.cartLifecycle);
    await expect(
      mainOf(page).getByRole("button", { name: copy.auth.login.submit, exact: true }),
    ).toBeEnabled();
    await loginWith(page, EMAIL.other);
    await expect(page).toHaveURL(/\/mypage$/);
    expect(await readCartRaw(page)).toBe(JSON.stringify({ version: 1, lines: CART }));
    await other.close();
  });
});
