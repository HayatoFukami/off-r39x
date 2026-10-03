import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { formatJstDateTime } from "../../apps/web/src/presentation/format/datetime.ts";
import { formatMoney, multiplyMoney } from "../../apps/web/src/presentation/format/money.ts";
import {
  addButton,
  describedText,
  expectedOfferings,
  FORBIDDEN_IN_CART_STORAGE,
  failCartWrites,
  headerCartLink,
  liveRegion,
  mainOf,
  offeringName,
  priceEdit,
  quantityInput,
  readCart,
  readCartRaw,
  readDbRaw,
  rowByHeading,
  writeStorage,
} from "../harness/browser/cart.ts";
import { dbJson, fixClock, LOADING_FORBIDDEN, publicScenario } from "../harness/browser/public.ts";
import {
  authenticatedSession,
  KEYS,
  scenarioJson,
  seedLocalStorage,
} from "../harness/browser/shell.ts";
import { OFFERING } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s5-cart.md sections 5.1, 6.
// PG-TKT-001 (SPEC-050 12.1), 8.5, 9, 21, 25, 26.4, 31 items 2 / 4 / 24 (first half), FR-CRT-001 / 003 / 004, BR-ORD-020.

const main = mainOf;
const h1 = (page: Page) => main(page).getByRole("heading", { level: 1 });

async function open(page: Page, entries: Record<string, string> = {}): Promise<number | undefined> {
  await fixClock(page);
  await seedLocalStorage(page, entries);
  const response = await page.goto("/entry");
  return response?.status();
}

async function openReady(page: Page, entries: Record<string, string> = {}): Promise<void> {
  await open(page, entries);
  await expect(main(page).getByRole("listitem")).toHaveCount(6);
}

const row = (page: Page, ref: string) => rowByHeading(page, offeringName(ref));
const find = (ref: string) => {
  const found = expectedOfferings().find((o) => o.ref === ref);
  if (found === undefined) throw new Error(`unknown offering ${ref}`);
  return found;
};
const cartWith = (lines: { offeringRef: string; quantity: number }[]) => ({
  version: 1,
  lines: lines.map((l) => ({ kind: "ENTRY_TICKET", ...l })),
});

test.describe("TC-PG-TKT-001-501 the Entry page lists every offering with name, description, price, period, state and reason (SPEC-050 12.1)", () => {
  test("shows the six offerings in port order under one h1, each with h2, description, price and period", async ({
    page,
  }) => {
    const offerings = expectedOfferings();
    expect(offerings).toHaveLength(6);
    expect(await open(page)).toBe(200);
    await expect(h1(page)).toHaveText(copy.entry.heading);
    await expect(h1(page)).toHaveCount(1);
    const rows = main(page).getByRole("listitem");
    await expect(rows).toHaveCount(offerings.length);
    for (const [index, offering] of offerings.entries()) {
      const item = rows.nth(index);
      await expect(
        item.getByRole("heading", { level: 2, name: offering.name, exact: true }),
      ).toBeVisible();
      await expect(item).toContainText(offering.description);
      await expect(item).toContainText(formatMoney(offering.unitPrice));
      await expect(item).toContainText(formatJstDateTime(offering.startsAt));
      await expect(item).toContainText(formatJstDateTime(offering.endsAt));
    }
  });

  test("announces the per-account limit and the selectable maximum where the port provides them", async ({
    page,
  }) => {
    await openReady(page);
    const regular = row(page, OFFERING.regular);
    await expect(regular).toContainText(copy.entry.perAccountLimit(4));
    await expect(regular).toContainText(copy.quantity.guidance(4));
    const limited = row(page, OFFERING.limit);
    await expect(limited).toContainText(copy.entry.perAccountLimit(2));
    await expect(limited).toContainText(copy.quantity.guidance(2));
    // An offering with no per-account limit does not claim one.
    await expect(row(page, OFFERING.early)).not.toContainText(/1アカウント/);
  });

  test("offers a link to the Cart that goes to /cart", async ({ page }) => {
    await openReady(page);
    const link = main(page).getByRole("link", { name: copy.sales.viewCart, exact: true });
    await expect(link).toHaveAttribute("href", "/cart");
    await link.click();
    await expect(page).toHaveURL(/\/cart$/);
  });
});

test.describe("TC-PG-TKT-001-502 the six sale states differ in text and in the add action, for guests and users (SPEC-050 12.1, 31 item 4, 25)", () => {
  type Expectation = {
    ref: string;
    label: () => string;
    reason: () => string;
    enabled: boolean;
  };
  const label = () => copy.availability.label;
  const description = () => copy.availability.description;
  const earlyStart = () => formatJstDateTime(find(OFFERING.early).startsAt);

  const common = (viewer: "guest" | "user"): Expectation[] => [
    {
      ref: OFFERING.regular,
      label: () => label().ON_SALE,
      reason: () => description().ON_SALE,
      enabled: true,
    },
    {
      ref: OFFERING.early,
      label: () => label().BEFORE_SALES,
      reason: () => copy.availability.beforeSales(earlyStart()),
      enabled: false,
    },
    {
      ref: OFFERING.ended,
      label: () => label().SALES_ENDED,
      reason: () => description().SALES_ENDED,
      enabled: false,
    },
    {
      ref: OFFERING.suspended,
      label: () => label().SUSPENDED,
      reason: () => description().SUSPENDED,
      enabled: false,
    },
    {
      ref: OFFERING.soldout,
      label: () => label().SOLD_OUT,
      reason: () => description().SOLD_OUT,
      enabled: false,
    },
    viewer === "guest"
      ? {
          ref: OFFERING.limit,
          label: () => label().ON_SALE,
          reason: () => description().ON_SALE,
          enabled: true,
        }
      : {
          ref: OFFERING.limit,
          label: () => label().PURCHASE_LIMIT_EXCEEDED,
          reason: () => description().PURCHASE_LIMIT_EXCEEDED,
          enabled: false,
        },
  ];

  for (const viewer of ["guest", "user"] as const) {
    test(`${viewer}: each state shows its own label and reason, and Cart add is enabled only when on sale`, async ({
      page,
    }) => {
      await openReady(page, viewer === "user" ? { [KEYS.session]: authenticatedSession() } : {});
      for (const expectation of common(viewer)) {
        const item = row(page, expectation.ref);
        await expect(item).toContainText(expectation.label());
        await expect(item).toContainText(expectation.reason());
        const add = addButton(item);
        await expect(add).toBeVisible();
        if (expectation.enabled) {
          await expect(add).toBeEnabled();
        } else {
          await expect(add).toBeDisabled();
          expect(await describedText(add), "the disabled reason is tied to the button").toContain(
            expectation.reason(),
          );
        }
      }
    });
  }

  test("a row never shows another state's label, so the text alone tells the states apart", async ({
    page,
  }) => {
    await openReady(page, { [KEYS.session]: authenticatedSession() });
    const all = [
      label().ON_SALE,
      label().BEFORE_SALES,
      label().SALES_ENDED,
      label().SUSPENDED,
      label().SOLD_OUT,
      label().PURCHASE_LIMIT_EXCEEDED,
    ];
    for (const expectation of common("user")) {
      const text = await row(page, expectation.ref).innerText();
      const own = expectation.label();
      expect(text).toContain(own);
      for (const other of all.filter((l) => l !== own)) {
        expect(text, `${expectation.ref} must not show ${other}`).not.toContain(other);
      }
    }
    expect(new Set(all).size).toBe(6);
  });

  test("the sale start of a not-yet-started offering is the configured date, in JST", async ({
    page,
  }) => {
    await openReady(page);
    await expect(row(page, OFFERING.early)).toContainText(earlyStart());
  });
});

test.describe("TC-PG-TKT-001-503 adding to the Cart stores only a reference and a quantity and says it is not a purchase (SPEC-050 12.1, FR-CRT-001 / 003)", () => {
  test("guest: default quantity 1, add stores the line, announces, updates the Header at once", async ({
    page,
  }) => {
    await openReady(page);
    const item = row(page, OFFERING.regular);
    await expect(quantityInput(item)).toHaveValue("1");
    expect(await readCartRaw(page)).toBeNull();
    await addButton(item).click();
    await expect(liveRegion(page)).toContainText(copy.sales.addSucceeded);
    await expect
      .poll(() => readCart(page))
      .toEqual(cartWith([{ offeringRef: OFFERING.regular, quantity: 1 }]));
    expect(await readCartRaw(page)).not.toMatch(FORBIDDEN_IN_CART_STORAGE);
    await expect(headerCartLink(page, 1)).toBeVisible();
    await expect(page).toHaveURL(/\/entry$/);
  });

  test("adding the same offering again sums the quantity into one line", async ({ page }) => {
    await openReady(page);
    const item = row(page, OFFERING.regular);
    await addButton(item).click();
    await quantityInput(item).fill("2");
    await addButton(item).click();
    await expect
      .poll(() => readCart(page))
      .toEqual(cartWith([{ offeringRef: OFFERING.regular, quantity: 3 }]));
    await expect(headerCartLink(page, 3)).toBeVisible();
  });

  test("different offerings become different lines and the Header shows the total quantity", async ({
    page,
  }) => {
    await openReady(page);
    await addButton(row(page, OFFERING.regular)).click();
    const limited = row(page, OFFERING.limit);
    await quantityInput(limited).fill("2");
    await addButton(limited).click();
    await expect
      .poll(() => readCart(page))
      .toEqual(
        cartWith([
          { offeringRef: OFFERING.regular, quantity: 1 },
          { offeringRef: OFFERING.limit, quantity: 2 },
        ]),
      );
    await expect(headerCartLink(page, 3)).toBeVisible();
    expect(await readCartRaw(page)).not.toMatch(FORBIDDEN_IN_CART_STORAGE);
  });

  test("the Cart survives a reload and still holds the line", async ({ page }) => {
    await openReady(page);
    await addButton(row(page, OFFERING.regular)).click();
    await expect(headerCartLink(page, 1)).toBeVisible();
    await page.reload();
    await expect(main(page).getByRole("listitem")).toHaveCount(6);
    await expect(headerCartLink(page, 1)).toBeVisible();
    await expect
      .poll(() => readCart(page))
      .toEqual(cartWith([{ offeringRef: OFFERING.regular, quantity: 1 }]));
  });

  test("an authenticated user adds exactly the same way (same enabled state, same stored shape)", async ({
    page,
  }) => {
    await openReady(page, { [KEYS.session]: authenticatedSession() });
    const item = row(page, OFFERING.regular);
    await expect(addButton(item)).toBeEnabled();
    await addButton(item).click();
    await expect
      .poll(() => readCart(page))
      .toEqual(cartWith([{ offeringRef: OFFERING.regular, quantity: 1 }]));
    await expect(liveRegion(page)).toContainText(copy.sales.addSucceeded);
  });

  test("the result is not a purchase: no Order is made and the mock database is not touched", async ({
    page,
  }) => {
    await openReady(page);
    const before = await readDbRaw(page);
    expect(before).not.toBeNull();
    await addButton(row(page, OFFERING.regular)).click();
    await expect.poll(() => readCartRaw(page)).not.toBeNull();
    expect(await readDbRaw(page)).toBe(before);
    await expect(page).toHaveURL(/\/entry$/);
    await expect(
      main(page).getByRole("button", { name: /購入手続き|今すぐ購入|支払/ }),
    ).toHaveCount(0);
    await expect(main(page).getByRole("link", { name: /購入手続き|今すぐ購入|支払/ })).toHaveCount(
      0,
    );
  });
});

test.describe("TC-PG-TKT-001-504 the quantity selector accepts positive integers up to the announced maximum (SPEC-050 12.1, 25)", () => {
  for (const [value, expected] of [
    ["0", () => copy.quantity.invalid],
    ["-1", () => copy.quantity.invalid],
    ["1.5", () => copy.quantity.invalid],
    ["", () => copy.quantity.invalid],
    ["5", () => copy.quantity.exceedsMax(4)],
    ["100", () => copy.quantity.exceedsMax(4)],
  ] as const) {
    test(`quantity ${JSON.stringify(value)} is rejected: aria-invalid, an error text tied to the field, Add disabled, Cart unchanged`, async ({
      page,
    }) => {
      await openReady(page);
      const item = row(page, OFFERING.regular);
      const input = quantityInput(item);
      await input.fill(value);
      await expect(input).toHaveAttribute("aria-invalid", "true");
      expect(await describedText(input)).toContain(expected());
      await expect(addButton(item)).toBeDisabled();
      expect(await describedText(addButton(item))).toContain(expected());
      expect(await readCartRaw(page)).toBeNull();
      await expect(headerCartLink(page, null)).toBeVisible();
    });
  }

  test("the maximum itself is valid and recovery clears the error", async ({ page }) => {
    await openReady(page);
    const item = row(page, OFFERING.regular);
    const input = quantityInput(item);
    await input.fill("5");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await input.fill("4");
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    await expect(addButton(item)).toBeEnabled();
    await addButton(item).click();
    await expect
      .poll(() => readCart(page))
      .toEqual(cartWith([{ offeringRef: OFFERING.regular, quantity: 4 }]));
  });

  test("the display total follows the quantity with exact money and is labelled as display-only", async ({
    page,
  }) => {
    await openReady(page);
    const item = row(page, OFFERING.regular);
    const unit = find(OFFERING.regular).unitPrice;
    await expect(item).toContainText(copy.sales.displayTotalLabel);
    await expect(item).toContainText(copy.sales.displayTotalNote);
    await quantityInput(item).fill("3");
    await expect(item).toContainText(formatMoney(multiplyMoney(unit, 3)));
    await quantityInput(item).fill("4");
    await expect(item).toContainText(formatMoney(multiplyMoney(unit, 4)));
  });
});

test.describe("TC-PG-TKT-001-505 a failed read is unknown state, never empty or sold out; loading shows no result (SPEC-050 9, 12.1, 21, 31 item 2)", () => {
  test("a failed read shows an error with retry and offers no enabled Cart add", async ({
    page,
  }) => {
    await open(page, publicScenario({ publicFetch: "fail" }));
    await expect(h1(page)).toHaveText(copy.entry.heading);
    const alert = main(page).getByRole("alert");
    await expect(alert).toContainText(copy.pageState.unavailable(copy.entry.subject));
    await expect(
      alert.getByRole("button", { name: copy.pageState.retry, exact: true }),
    ).toBeVisible();
    for (const add of await main(page).getByRole("button", { name: copy.sales.add }).all()) {
      await expect(add).toBeDisabled();
    }
    await expect(main(page).getByRole("listitem")).toHaveCount(0);
    await expect(main(page)).not.toContainText(copy.pageState.empty);
    await expect(main(page)).not.toContainText(/0件|売り切れ|販売中/);
    await expect(main(page)).not.toContainText(/[¥￥]\s*\d/);
    await expect(
      main(page).getByRole("link", { name: copy.sales.viewCart, exact: true }),
    ).toBeVisible();
  });

  test("retry recovers when the read succeeds again", async ({ page }) => {
    await open(page, publicScenario({ publicFetch: "fail" }));
    await expect(main(page).getByRole("alert")).toBeVisible();
    await writeStorage(page, KEYS.scenario, scenarioJson());
    await main(page).getByRole("button", { name: copy.pageState.retry, exact: true }).click();
    await expect(main(page).getByRole("listitem")).toHaveCount(6);
    await expect(main(page).getByRole("alert")).toHaveCount(0);
  });

  test("a successful empty read says nothing is published", async ({ page }) => {
    await open(page, publicScenario({ publicFetch: "empty" }));
    await expect(main(page)).toContainText(copy.pageState.empty);
    await expect(main(page).getByRole("listitem")).toHaveCount(0);
    await expect(main(page).getByRole("alert")).toHaveCount(0);
    await expect(
      main(page).getByRole("link", { name: copy.sales.viewCart, exact: true }),
    ).toBeVisible();
  });

  test("loading shows a status, no offering, no sold-out wording, no amount and no add button", async ({
    page,
  }) => {
    await open(page, publicScenario({ latency: "long", latencyLongMs: 6000 }));
    await expect(h1(page)).toHaveText(copy.entry.heading);
    await expect(main(page).locator('[role="status"]').first()).toContainText(
      copy.pageState.loading,
    );
    await expect(main(page)).not.toContainText(LOADING_FORBIDDEN);
    await expect(main(page).getByRole("listitem")).toHaveCount(0);
    await expect(main(page).getByRole("button", { name: copy.sales.add })).toHaveCount(0);
    await expect(main(page).getByRole("listitem")).toHaveCount(6, { timeout: 20_000 });
  });
});

test.describe("TC-PG-TKT-001-506 a Cart that cannot be written is reported, never reported as added (SPEC-050 26.4, 9.3)", () => {
  test("a damaged stored Cart is not overwritten and the add is not announced as a success", async ({
    page,
  }) => {
    await openReady(page, { [KEYS.cart]: "not-json" });
    await addButton(row(page, OFFERING.regular)).click();
    const alert = main(page).getByRole("alert");
    await expect(alert).toContainText(copy.cart.corrupted.title);
    await expect(
      alert.getByRole("link", { name: copy.cart.corrupted.goToCart, exact: true }),
    ).toHaveAttribute("href", "/cart");
    expect(await readCartRaw(page)).toBe("not-json");
    await expect(liveRegion(page)).not.toContainText(copy.sales.addSucceeded);
    await expect(headerCartLink(page, null)).toBeVisible();
  });

  test("a storage write failure shows the failure and no success", async ({ page }) => {
    await failCartWrites(page);
    await openReady(page);
    await addButton(row(page, OFFERING.regular)).click();
    await expect(main(page).getByRole("alert")).toContainText(copy.sales.addFailed);
    await expect(liveRegion(page)).not.toContainText(copy.sales.addSucceeded);
    expect(await readCartRaw(page)).toBeNull();
  });
});

test.describe("TC-PG-TKT-001-507 the add result reaches assistive technology and the page works by keyboard (SPEC-050 12.1, 25)", () => {
  test("a status live region exists and is empty before the add, then holds the result text", async ({
    page,
  }) => {
    await openReady(page);
    await expect(liveRegion(page)).toHaveCount(1);
    expect((await liveRegion(page).textContent())?.trim()).toBe("");
    await addButton(row(page, OFFERING.regular)).click();
    await expect(liveRegion(page)).toHaveText(copy.sales.addSucceeded);
  });

  test("Tab moves from the quantity to Add, Enter adds, and focus order follows the DOM", async ({
    page,
  }) => {
    await openReady(page);
    const item = row(page, OFFERING.regular);
    await quantityInput(item).fill("2");
    await page.keyboard.press("Tab");
    await expect(addButton(item)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => readCart(page))
      .toEqual(cartWith([{ offeringRef: OFFERING.regular, quantity: 2 }]));
    await expect(liveRegion(page)).toContainText(copy.sales.addSucceeded);
  });

  test("a disabled Add is skipped by Tab and its reason stays readable as text", async ({
    page,
  }) => {
    await openReady(page);
    const item = row(page, OFFERING.soldout);
    await expect(addButton(item)).toBeDisabled();
    await expect(item).toContainText(copy.availability.description.SOLD_OUT);
  });
});

test.describe("TC-PG-TKT-001-508 price comes from the port, never from the Cart (SPEC-050 26.4, FR-CRT-003, INV-010-09)", () => {
  test("a changed unit price in the data is what the page, the display total and nothing else shows", async ({
    page,
  }) => {
    await openReady(page, dbJson(priceEdit("offering", OFFERING.regular, "3300")));
    const item = row(page, OFFERING.regular);
    await expect(item).toContainText("¥3,300");
    await expect(item).not.toContainText("¥3,000");
    await quantityInput(item).fill("2");
    await expect(item).toContainText("¥6,600");
    await addButton(item).click();
    await expect.poll(() => readCartRaw(page)).not.toBeNull();
    const raw = (await readCartRaw(page)) ?? "";
    expect(raw).not.toMatch(/3300|3,300|6600/);
    expect(raw).not.toMatch(FORBIDDEN_IN_CART_STORAGE);
  });
});
