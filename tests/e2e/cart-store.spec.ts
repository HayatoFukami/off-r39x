import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import {
  addButton,
  cartEntries,
  entryLine,
  goodsLine,
  headerCartLink,
  mainOf,
  offeringName,
  openSecondTab,
  quantityInput,
  readCart,
  readCartRaw,
  rowByHeading,
  type StoredLine,
  writeStorage,
} from "../harness/browser/cart.ts";
import { fixClock } from "../harness/browser/public.ts";
import { authenticatedSession, KEYS, seedLocalStorage } from "../harness/browser/shell.ts";
import { GOODS, OFFERING } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s5-cart.md sections 2.3, 2.4.
// SPEC-050 8.5, 14A.1 Cartの保持, 22, 26.4, FR-CRT-003 / 004 / 012, BR-ORD-020.

const main = mainOf;
const rows = (page: Page) => main(page).getByRole("listitem");
const stored = (lines: StoredLine[]) => ({ version: 1, lines });

async function openCart(page: Page, lines: StoredLine[], entries: Record<string, string> = {}) {
  await fixClock(page);
  await seedLocalStorage(page, { ...cartEntries(lines), ...entries });
  await page.goto("/cart");
  await expect(rows(page)).toHaveCount(lines.length);
}

test.describe("TC-PG-CRT-001-521 the Header count follows every change in the same tab at once (SPEC-050 8.5)", () => {
  test("changing and deleting on the Cart page updates the Header without a reload", async ({
    page,
  }) => {
    await openCart(page, [entryLine(OFFERING.regular, 1), goodsLine(GOODS.tshirt, 1)]);
    await expect(headerCartLink(page, 2)).toBeVisible();
    await quantityInput(rowByHeading(page, offeringName(OFFERING.regular))).fill("4");
    await expect(headerCartLink(page, 5)).toBeVisible();
    await page.getByRole("main").getByRole("button", { name: copy.cart.remove }).first().click();
    await expect(headerCartLink(page, 1)).toBeVisible();
    await page.getByRole("main").getByRole("button", { name: copy.cart.remove }).first().click();
    await expect(headerCartLink(page, null)).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link", { name: /カート（\d+点）/ }),
    ).toHaveCount(0);
  });

  test("adding on the Entry page shows the new count in the Header at once, and it is the same count on /cart", async ({
    page,
  }) => {
    await fixClock(page);
    await seedLocalStorage(page, {});
    await page.goto("/entry");
    const row = rowByHeading(page, offeringName(OFFERING.regular));
    await addButton(row).click();
    await expect(headerCartLink(page, 1)).toBeVisible();
    await addButton(row).click();
    await expect(headerCartLink(page, 2)).toBeVisible();
    await headerCartLink(page, 2).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(rows(page)).toHaveCount(1);
    await expect(headerCartLink(page, 2)).toBeVisible();
  });
});

test.describe("TC-PG-CRT-001-522 another tab's change reaches this tab, including damage and clear (SPEC-050 14A.1 Cartの保持, 26.4)", () => {
  test("a line added in another tab appears on this Cart page and in the Header", async ({
    page,
    context,
  }) => {
    await openCart(page, [entryLine(OFFERING.regular, 1)]);
    await expect(headerCartLink(page, 1)).toBeVisible();
    const other = await openSecondTab(context);
    await other.goto("/entry");
    const row = rowByHeading(other, offeringName(OFFERING.limit));
    await quantityInput(row).fill("2");
    await addButton(row).click();
    await expect
      .poll(() => readCart(other))
      .toEqual(stored([entryLine(OFFERING.regular, 1), entryLine(OFFERING.limit, 2)]));
    await expect(rows(page)).toHaveCount(2);
    await expect(headerCartLink(page, 3)).toBeVisible();
    await expect(rowByHeading(page, offeringName(OFFERING.limit))).toBeVisible();
    await other.close();
  });

  test("a quantity changed in another tab is shown here, and removing the Cart there shows the empty state here", async ({
    page,
    context,
  }) => {
    await openCart(page, [entryLine(OFFERING.regular, 1)]);
    const other = await openSecondTab(context);
    await other.goto("/");
    await writeStorage(other, KEYS.cart, JSON.stringify(stored([entryLine(OFFERING.regular, 3)])));
    await expect(quantityInput(rows(page).nth(0))).toHaveValue("3");
    await expect(headerCartLink(page, 3)).toBeVisible();
    await other.evaluate((key) => window.localStorage.removeItem(key), KEYS.cart);
    await expect(main(page)).toContainText(copy.cart.empty);
    await expect(rows(page)).toHaveCount(0);
    await other.close();
  });

  test("damage written in another tab is reported here (not shown as empty) and a reset there recovers", async ({
    page,
    context,
  }) => {
    await openCart(page, [entryLine(OFFERING.regular, 1)]);
    const other = await openSecondTab(context);
    await other.goto("/");
    await writeStorage(other, KEYS.cart, "not-json");
    await expect(main(page).getByRole("alert")).toContainText(copy.cart.corrupted.title);
    await expect(main(page)).not.toContainText(copy.cart.empty);
    expect(await readCartRaw(page)).toBe("not-json");
    await writeStorage(other, KEYS.cart, JSON.stringify(stored([])));
    await expect(main(page)).toContainText(copy.cart.empty);
    await other.close();
  });

  test("clearing the browser storage in another tab removes the count from this tab's Header", async ({
    page,
    context,
  }) => {
    await fixClock(page);
    await seedLocalStorage(page, cartEntries([goodsLine(GOODS.tshirt, 3)]));
    await page.goto("/");
    await expect(headerCartLink(page, 3)).toBeVisible();
    const other = await openSecondTab(context);
    await other.goto("/");
    await other.evaluate(() => window.localStorage.clear());
    await expect(headerCartLink(page, null)).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link", { name: /カート（\d+点）/ }),
    ).toHaveCount(0);
    await other.close();
  });

  test("a new tab opened later shows the same Cart (the Cart is the browser's, not a tab's)", async ({
    page,
    context,
  }) => {
    await openCart(page, [entryLine(OFFERING.regular, 2), goodsLine(GOODS.towel, 1)]);
    const other = await openSecondTab(context);
    await other.goto("/cart");
    await expect(rows(other)).toHaveCount(2);
    await expect(headerCartLink(other, 3)).toBeVisible();
    await other.close();
  });
});

test.describe("TC-PG-CRT-001-523 Login state never changes the Cart and the Cart never holds account data (FR-CRT-012, FR-CRT-003, SPEC-050 26.4)", () => {
  test("logging out keeps the Cart content, the Header count and the page", async ({ page }) => {
    await openCart(page, [entryLine(OFFERING.regular, 2)], {
      [KEYS.session]: authenticatedSession(),
    });
    const before = await readCartRaw(page);
    await expect(headerCartLink(page, 2)).toBeVisible();
    await page.getByRole("button", { name: copy.layout.account.menuButton, exact: true }).click();
    await page.getByRole("button", { name: copy.layout.account.logout, exact: true }).click();
    await expect(
      page.getByRole("banner").getByRole("link", { name: copy.layout.account.login, exact: true }),
    ).toBeVisible();
    expect(await readCartRaw(page)).toBe(before);
    await expect(headerCartLink(page, 2)).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
    await expect(page).toHaveURL(/\/cart$/);
  });

  test("adding as an authenticated user stores no account, email or role", async ({ page }) => {
    await fixClock(page);
    await seedLocalStorage(page, { [KEYS.session]: authenticatedSession() });
    await page.goto("/entry");
    await addButton(rowByHeading(page, offeringName(OFFERING.regular))).click();
    await expect.poll(() => readCartRaw(page)).not.toBeNull();
    const raw = (await readCartRaw(page)) ?? "";
    expect(raw).not.toMatch(/demo@example\.com|email|owner|role|session|user/i);
    expect(JSON.parse(raw)).toEqual(stored([entryLine(OFFERING.regular, 1)]));
  });

  test("the Cart written as a guest is the same Cart after a session appears", async ({ page }) => {
    await fixClock(page);
    await seedLocalStorage(page, {});
    await page.goto("/entry");
    await addButton(rowByHeading(page, offeringName(OFFERING.regular))).click();
    await expect.poll(() => readCart(page)).toEqual(stored([entryLine(OFFERING.regular, 1)]));
    await writeStorage(page, KEYS.session, authenticatedSession());
    await page.goto("/cart");
    await expect(rows(page)).toHaveCount(1);
    expect(await readCart(page)).toEqual(stored([entryLine(OFFERING.regular, 1)]));
  });
});
