import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
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
  removeButton,
  rowByHeading,
} from "../harness/browser/cart.ts";
import { gotoHydrated } from "../harness/browser/hydration.ts";
import { fixClock } from "../harness/browser/public.ts";
import { KEYS, seedLocalStorage } from "../harness/browser/shell.ts";
import { GOODS, OFFERING } from "../harness/mock-seed.ts";

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

test.describe("TC-PG-CRT-001-542 a Cart store that cannot be read is an unknown state, never an empty Cart, and stops Cart additions (SPEC-050 9.2, 12.1, 14A.1, 21, FR-CRT-012)", () => {
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
