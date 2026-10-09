import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  addButton,
  cartEntries,
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
// SPEC-050 26.4, 9.2, 9.3, 14A.1, 21, FR-CRT-001 / 003.

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
  test("a quantity that cannot be saved shows the failure, keeps the stored Cart and the Header count", async ({
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
    await expect(main(page).getByRole("alert")).toContainText(copy.sales.addFailed);
    expect(await readCartRaw(page)).toBe(before);
    await expect(headerCartLink(page, 2)).toBeVisible();
    await expect(liveRegion(page)).toHaveCount(0);
  });

  test("a line that cannot be removed stays in the Cart and in storage", async ({ page }) => {
    const lines = [entryLine(OFFERING.regular, 2), goodsLine(GOODS.tshirt, 1)];
    await fixClock(page);
    await seedLocalStorage(page, cartEntries(lines));
    await failCartWrites(page);
    await gotoHydrated(page, "/cart");
    await expect(rows(page)).toHaveCount(2);
    const before = await readCartRaw(page);
    await removeButton(rows(page).nth(0)).click();
    await expect(rows(page)).toHaveCount(2);
    expect(await readCartRaw(page)).toBe(before);
    await expect(headerCartLink(page, 3)).toBeVisible();
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

test.describe("TC-PG-CRT-001-542 a Cart store that cannot be read is an unknown state, never an empty Cart (SPEC-050 26.4, 9.2, 21)", () => {
  test("the Cart page reports a failure, shows no empty wording, no rows and no proceed button", async ({
    page,
  }) => {
    await fixClock(page);
    await failCartReads(page);
    await gotoHydrated(page, "/cart");
    await expect(main(page).getByRole("alert")).toContainText(copy.cart.corrupted.title);
    await expect(main(page)).not.toContainText(copy.cart.empty);
    await expect(rows(page)).toHaveCount(0);
    await expect(proceedButton(page)).toHaveCount(0);
    await expect(headerCartLink(page, null)).toBeVisible();
  });

  test("an add on the Entry page is not announced as a success while the store cannot be read", async ({
    page,
  }) => {
    await fixClock(page);
    await failCartReads(page);
    await gotoHydrated(page, "/entry");
    const name = offeringName(OFFERING.regular);
    await expect(rowByHeading(page, name)).toBeVisible();
    await addButton(rowByHeading(page, name)).click();
    await expect(main(page).getByRole("alert")).toBeVisible();
    await expect(liveRegion(page)).not.toContainText(copy.sales.addSucceeded);
  });
});
