import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { formatJstDateTime } from "../../apps/web/src/presentation/format/datetime.ts";
import { formatMoney, multiplyMoney } from "../../apps/web/src/presentation/format/money.ts";
import {
  addButton,
  cartEntries,
  describedText,
  EMPTY_CART_JSON,
  entryLine,
  expectedGoodsDetail,
  expectedOfferings,
  FORBIDDEN_IN_CART_STORAGE,
  goodsLine,
  headerCartLink,
  mainOf,
  offeringName,
  openSecondTab,
  priceEdit,
  proceedButton,
  quantityInput,
  readCart,
  readCartRaw,
  readDbRaw,
  removeButton,
  rowByHeading,
  type StoredLine,
  writeStorage,
} from "../harness/browser/cart.ts";
import { gotoHydrated, reloadHydrated } from "../harness/browser/hydration.ts";
import {
  dbJson,
  fixClock,
  hasLevelSkip,
  LOADING_FORBIDDEN,
  mainHeadingLevels,
  publicScenario,
} from "../harness/browser/public.ts";
import {
  authenticatedSession,
  KEYS,
  scenarioJson,
  seedLocalStorage,
  sessionJson,
} from "../harness/browser/shell.ts";
import { GOODS, MARKER, NOW_ISO, OFFERING } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s5-cart.md sections 5.3, 6.
// PG-CRT-001 (SPEC-050 14A.1) without purchase start: 9, 21, 22, 24, 25, 26.4, 31 items 24 (first half) / 25 / 28,
// FR-CRT-001 / 003 / 005 / 012, BR-ORD-020.

const main = mainOf;
const h1 = (page: Page) => main(page).getByRole("heading", { level: 1 });
const rows = (page: Page) => main(page).getByRole("listitem");
const alert = (page: Page) => main(page).getByRole("alert");
const label = copy.availability;
const money = (amount: number) => `¥${amount.toLocaleString("en-US")}`;
const stored = (lines: StoredLine[]) => ({ version: 1, lines });

async function open(
  page: Page,
  lines: readonly StoredLine[] | null,
  entries: Record<string, string> = {},
): Promise<void> {
  await fixClock(page);
  await seedLocalStorage(page, lines === null ? entries : { ...cartEntries(lines), ...entries });
  await gotoHydrated(page, "/cart");
}

async function openRows(
  page: Page,
  lines: readonly StoredLine[],
  entries: Record<string, string> = {},
): Promise<void> {
  await open(page, lines, entries);
  await expect(rows(page)).toHaveCount(lines.length);
  await expect(proceedButton(page)).toBeVisible();
}

const price = (ref: string) => {
  const found = expectedOfferings().find((o) => o.ref === ref);
  if (found === undefined) throw new Error(`unknown offering ${ref}`);
  return found.unitPrice;
};
const goodsPrice = (ref: string) => expectedGoodsDetail(ref).unitPrice;

/** The text of the reason attached to the disabled proceed button. */
const proceedReason = (page: Page) => describedText(proceedButton(page));

test.describe("TC-PG-CRT-001-501 a guest adds Entry and Goods, changes the quantity and deletes, and the Cart persists (SPEC-050 31 item 24 first half, 14A.1)", () => {
  test("adds from the Entry page and a Goods page, edits in the Cart, reloads, and empties it", async ({
    page,
  }) => {
    await fixClock(page);
    await seedLocalStorage(page, {});
    await gotoHydrated(page, "/entry");
    const regular = rowByHeading(page, offeringName(OFFERING.regular));
    await expect(regular).toBeVisible();
    await quantityInput(regular).fill("2");
    await addButton(regular).click();
    await expect(headerCartLink(page, 2)).toBeVisible();

    await gotoHydrated(page, `/goods/${GOODS.tshirt}`);
    await expect(h1(page)).toHaveText(expectedGoodsDetail(GOODS.tshirt).name);
    await addButton(main(page)).click();
    await expect(headerCartLink(page, 3)).toBeVisible();

    await headerCartLink(page, 3).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(h1(page)).toHaveText(copy.cart.heading);
    await expect(rows(page)).toHaveCount(2);

    const regularRow = rowByHeading(page, offeringName(OFFERING.regular));
    const tshirtRow = rowByHeading(page, expectedGoodsDetail(GOODS.tshirt).name);
    await expect(quantityInput(regularRow)).toHaveValue("2");
    await expect(regularRow).toContainText(formatMoney(multiplyMoney(price(OFFERING.regular), 2)));
    await expect(tshirtRow).toContainText(formatMoney(goodsPrice(GOODS.tshirt)));

    await quantityInput(regularRow).fill("3");
    await expect
      .poll(() => readCart(page))
      .toEqual(stored([entryLine(OFFERING.regular, 3), goodsLine(GOODS.tshirt, 1)]));
    await expect(regularRow).toContainText(formatMoney(multiplyMoney(price(OFFERING.regular), 3)));
    await expect(headerCartLink(page, 4)).toBeVisible();

    await removeButton(tshirtRow).click();
    await expect(rows(page)).toHaveCount(1);
    await expect.poll(() => readCart(page)).toEqual(stored([entryLine(OFFERING.regular, 3)]));
    await expect(headerCartLink(page, 3)).toBeVisible();

    await reloadHydrated(page);
    await expect(rows(page)).toHaveCount(1);
    await expect(quantityInput(rowByHeading(page, offeringName(OFFERING.regular)))).toHaveValue(
      "3",
    );
    await expect(headerCartLink(page, 3)).toBeVisible();

    await removeButton(rowByHeading(page, offeringName(OFFERING.regular))).click();
    await expect(main(page)).toContainText(copy.cart.empty);
    await expect(rows(page)).toHaveCount(0);
    await expect(headerCartLink(page, null)).toBeVisible();
    expect(await readCart(page)).toEqual(stored([]));
  });
});

test.describe("TC-PG-CRT-001-502 each line shows name, unit price, quantity, subtotal and state; the summary is display-only (SPEC-050 14A.1 Fields / Summary)", () => {
  const lines = [entryLine(OFFERING.regular, 2), goodsLine(GOODS.tshirt, 1)];

  test("shows the line fields, the display total, the recalculation note and the one-payment note", async ({
    page,
  }) => {
    await openRows(page, lines);
    await expect(h1(page)).toHaveCount(1);
    const regular = rowByHeading(page, offeringName(OFFERING.regular));
    await expect(regular).toContainText(copy.cart.kind.ENTRY_TICKET);
    await expect(regular).toContainText(formatMoney(price(OFFERING.regular)));
    await expect(regular).toContainText(formatMoney(multiplyMoney(price(OFFERING.regular), 2)));
    await expect(regular).toContainText(label.label.ON_SALE);
    await expect(quantityInput(regular)).toHaveValue("2");
    await expect(removeButton(regular)).toBeVisible();
    const tshirt = rowByHeading(page, expectedGoodsDetail(GOODS.tshirt).name);
    await expect(tshirt).toContainText(copy.cart.kind.GOODS);
    await expect(tshirt).toContainText(formatMoney(goodsPrice(GOODS.tshirt)));
    await expect(tshirt).toContainText(label.label.ON_SALE);

    const summary = main(page).getByRole("region", {
      name: copy.cart.summary.heading,
      exact: true,
    });
    await expect(summary).toContainText(copy.cart.summary.totalLabel);
    await expect(summary).toContainText(
      formatMoney({ amount: String(3000 * 2 + 4000), currency: "JPY" }),
    );
    await expect(summary).toContainText(copy.cart.summary.recalcNote);
    await expect(summary).toContainText(copy.cart.summary.onePayment);
  });

  test("headings form one hierarchy: one h1, then h2 sections, no skipped level", async ({
    page,
  }) => {
    await openRows(page, lines);
    const levels = await mainHeadingLevels(page);
    expect(levels[0]).toBe(1);
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(hasLevelSkip(levels), `heading levels ${levels.join(",")}`).toBe(false);
    await expect(
      main(page).getByRole("heading", { level: 2, name: copy.cart.summary.heading, exact: true }),
    ).toBeVisible();
    await expect(
      main(page).getByRole("heading", { level: 2, name: copy.cart.karaoke.heading, exact: true }),
    ).toBeVisible();
  });

  test("lists exactly the lines as list items (summary and guidance are not list items)", async ({
    page,
  }) => {
    await openRows(page, lines);
    await expect(rows(page)).toHaveCount(2);
  });

  test("offers links back to the sales pages", async ({ page }) => {
    await openRows(page, lines);
    await expect(
      main(page).getByRole("link", { name: copy.cart.backToEntry, exact: true }),
    ).toHaveAttribute("href", "/entry");
    await expect(
      main(page).getByRole("link", { name: copy.cart.backToGoods, exact: true }),
    ).toHaveAttribute("href", "/goods");
  });

  test("a guest and an authenticated user see the same Cart page (no auth gate, same content)", async ({
    page,
    context,
  }) => {
    await openRows(page, lines);
    const guestText = await main(page).innerText();
    const other = await context.newPage();
    await other.clock.setFixedTime(new Date(NOW_ISO));
    await seedLocalStorage(other, { [KEYS.session]: authenticatedSession() });
    await other.goto("/cart");
    await expect(rows(other)).toHaveCount(2);
    await expect(other).toHaveURL(/\/cart$/);
    expect(await main(other).innerText()).toBe(guestText);
    await expect(proceedButton(other)).toBeEnabled();
  });
});

test.describe("TC-PG-CRT-001-503 every purchase-blocking reason is shown per line and proceeding stays disabled (SPEC-050 14A.1, FR-CRT-005, 31 item 25)", () => {
  test("Entry lines: before sales, ended, suspended, sold out and over the limit are distinct; the on-sale line is not blocked", async ({
    page,
  }) => {
    const lines = [
      entryLine(OFFERING.early, 1),
      entryLine(OFFERING.ended, 1),
      entryLine(OFFERING.suspended, 1),
      entryLine(OFFERING.soldout, 1),
      entryLine(OFFERING.limit, 3),
      entryLine(OFFERING.regular, 1),
    ];
    await openRows(page, lines);
    const early = expectedOfferings().find((o) => o.ref === OFFERING.early);
    const expected = [
      [
        label.label.BEFORE_SALES,
        copy.availability.beforeSales(formatJstDateTime(early?.startsAt ?? ("" as never))),
      ],
      [label.label.SALES_ENDED, label.description.SALES_ENDED],
      [label.label.SUSPENDED, label.description.SUSPENDED],
      [label.label.SOLD_OUT, label.description.SOLD_OUT],
      [label.label.PURCHASE_LIMIT_EXCEEDED, label.description.PURCHASE_LIMIT_EXCEEDED],
      [label.label.ON_SALE, label.description.ON_SALE],
    ] as const;
    expect(new Set(expected.map(([text]) => text)).size).toBe(6);
    for (const [index, [text, reason]] of expected.entries()) {
      const item = rows(page).nth(index);
      await expect(item).toContainText(text);
      await expect(item).toContainText(reason);
      const body = await item.innerText();
      for (const [other] of expected.filter(([o]) => o !== text)) {
        expect(body, `row ${index} must not show ${other}`).not.toContain(other);
      }
    }
    await expect(proceedButton(page)).toBeDisabled();
    expect(await proceedReason(page)).toContain(copy.cart.proceed.blocked);
    // The display total is still shown when every price is known (blocked lines keep their server price).
    const total = 3500 + 2000 + 2500 + 3000 + 2500 * 3 + 3000;
    await expect(
      main(page).getByRole("region", { name: copy.cart.summary.heading, exact: true }),
    ).toContainText(money(total));
  });

  test("Goods lines: not public, short stock, sold out, before sales, ended and suspended are distinct", async ({
    page,
  }) => {
    const lines = [
      goodsLine(GOODS.hidden, 1),
      goodsLine(GOODS.towel, 5),
      goodsLine(GOODS.badge, 1),
      goodsLine(GOODS.poster, 1),
      goodsLine(GOODS.sticker, 1),
      goodsLine(GOODS.lanyard, 1),
      goodsLine(GOODS.tshirt, 1),
    ];
    await openRows(page, lines);
    const poster = expectedGoodsDetail(GOODS.poster);
    const expected = [
      [label.label.NOT_PUBLIC, label.description.NOT_PUBLIC],
      [label.label.INSUFFICIENT_QUANTITY, copy.availability.insufficientQuantity("3")],
      [label.label.SOLD_OUT, label.description.SOLD_OUT],
      [label.label.BEFORE_SALES, copy.availability.beforeSales(formatJstDateTime(poster.startsAt))],
      [label.label.SALES_ENDED, label.description.SALES_ENDED],
      [label.label.SUSPENDED, label.description.SUSPENDED],
      [label.label.ON_SALE, label.description.ON_SALE],
    ] as const;
    expect(new Set(expected.map(([text]) => text)).size).toBe(7);
    for (const [index, [text, reason]] of expected.entries()) {
      const item = rows(page).nth(index);
      await expect(item).toContainText(text);
      await expect(item).toContainText(reason);
    }
    // A non-public item shows no name and no amount, and its title is never leaked.
    await expect(rows(page).nth(0)).not.toContainText(MARKER.hiddenGoods);
    await expect(rows(page).nth(0)).not.toContainText(/[¥￥]\s*\d/);
    await expect(main(page)).not.toContainText(MARKER.hiddenGoods);
    await expect(proceedButton(page)).toBeDisabled();
    expect(await proceedReason(page)).toContain(copy.cart.proceed.blocked);
    // One line has no price, so no total is claimed.
    const summary = main(page).getByRole("region", {
      name: copy.cart.summary.heading,
      exact: true,
    });
    await expect(summary).toContainText(copy.cart.summary.totalUnknown);
    await expect(summary).not.toContainText(/[¥￥]\s*\d/);
  });

  test("deleting every blocked line (or fixing the quantity) enables proceeding again", async ({
    page,
  }) => {
    const lines = [
      entryLine(OFFERING.early, 1),
      entryLine(OFFERING.soldout, 1),
      entryLine(OFFERING.limit, 3),
      entryLine(OFFERING.regular, 1),
    ];
    await openRows(page, lines);
    await expect(proceedButton(page)).toBeDisabled();
    await removeButton(rows(page).nth(0)).click();
    await expect(rows(page)).toHaveCount(3);
    await expect(proceedButton(page)).toBeDisabled();
    await removeButton(rows(page).nth(0)).click();
    await expect(rows(page)).toHaveCount(2);
    await expect(proceedButton(page)).toBeDisabled();
    // The over-limit line (3 > 2) becomes purchasable by lowering its quantity.
    await quantityInput(rows(page).nth(0)).fill("2");
    await expect(rows(page).nth(0)).toContainText(label.label.ON_SALE);
    await expect(proceedButton(page)).toBeEnabled();
  });

  test("the over-limit reason is also reached by raising a quantity in the Cart (the Cart does not cap it)", async ({
    page,
  }) => {
    await openRows(page, [entryLine(OFFERING.regular, 2)]);
    await expect(proceedButton(page)).toBeEnabled();
    const input = quantityInput(rows(page).nth(0));
    await input.fill("5");
    await expect.poll(() => readCart(page)).toEqual(stored([entryLine(OFFERING.regular, 5)]));
    await expect(rows(page).nth(0)).toContainText(label.label.PURCHASE_LIMIT_EXCEEDED);
    await expect(proceedButton(page)).toBeDisabled();
    expect(await proceedReason(page)).toContain(copy.cart.proceed.blocked);
    await input.fill("4");
    await expect(rows(page).nth(0)).toContainText(label.label.ON_SALE);
    await expect(proceedButton(page)).toBeEnabled();
  });

  test("an authenticated user who already used the limit sees it blocked in the Cart", async ({
    page,
  }) => {
    await openRows(page, [entryLine(OFFERING.limit, 1)], {
      [KEYS.session]: authenticatedSession(),
    });
    await expect(rows(page).nth(0)).toContainText(label.label.PURCHASE_LIMIT_EXCEEDED);
    await expect(proceedButton(page)).toBeDisabled();
  });
});

test.describe("TC-PG-CRT-001-504 proceeding is enabled only when every line is purchasable and does nothing yet (SPEC-050 14A.1; S7a wires the start)", () => {
  const lines = [entryLine(OFFERING.regular, 1), goodsLine(GOODS.tshirt, 1)];

  for (const viewer of ["guest", "user"] as const) {
    test(`${viewer}: the button is enabled, and clicking it creates no Order, changes nothing and goes nowhere`, async ({
      page,
    }) => {
      await openRows(
        page,
        lines,
        viewer === "user" ? { [KEYS.session]: authenticatedSession() } : {},
      );
      const button = proceedButton(page);
      await expect(button).toBeEnabled();
      const dbBefore = await readDbRaw(page);
      const cartBefore = await readCartRaw(page);
      await button.click();
      // Two animation frames: any (unwanted) asynchronous reaction to the click has started by then.
      await page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
      await expect(page).toHaveURL(/\/cart$/);
      expect(await readDbRaw(page)).toBe(dbBefore);
      expect(await readCartRaw(page)).toBe(cartBefore);
      await expect(rows(page)).toHaveCount(2);
      await expect(alert(page)).toHaveCount(0);
      await expect(main(page)).not.toContainText(/支払い画面|購入条件を確認/);
    });
  }

  test("is disabled with a reason tied to it while the Cart has a blocked or unknown line", async ({
    page,
  }) => {
    await openRows(page, [entryLine(OFFERING.regular, 1), entryLine(OFFERING.soldout, 1)]);
    const button = proceedButton(page);
    await expect(button).toBeDisabled();
    expect(await describedText(button)).toContain(copy.cart.proceed.blocked);
    await expect(main(page)).toContainText(copy.cart.proceed.blocked);
  });

  test("is not rendered for an empty or a damaged Cart", async ({ page }) => {
    await open(page, []);
    await expect(main(page)).toContainText(copy.cart.empty);
    await expect(proceedButton(page)).toHaveCount(0);
  });
});

test.describe("TC-PG-CRT-001-505 Empty is shown only for a verified empty Cart (SPEC-050 14A.1 State, 9.2)", () => {
  for (const [name, lines, entries] of [
    ["no stored Cart", null, {}],
    ["a stored empty Cart", [] as StoredLine[], {}],
    [
      "a stored empty Cart while the state read fails",
      [] as StoredLine[],
      publicScenario({ publicFetch: "fail" }),
    ],
    [
      "a stored empty Cart while the Cart state read fails",
      [] as StoredLine[],
      { [KEYS.scenario]: scenarioJson({ cart: { state: "fail", purchaseStart: "ok" } }) },
    ],
  ] as const) {
    test(`${name}: shows the empty wording, the way back to sales and the Karaoke guidance`, async ({
      page,
    }) => {
      await open(page, lines, entries);
      await expect(h1(page)).toHaveText(copy.cart.heading);
      await expect(main(page)).toContainText(copy.cart.empty);
      await expect(rows(page)).toHaveCount(0);
      await expect(
        main(page).getByRole("link", { name: copy.cart.backToEntry, exact: true }),
      ).toHaveAttribute("href", "/entry");
      await expect(
        main(page).getByRole("link", { name: copy.cart.backToGoods, exact: true }),
      ).toHaveAttribute("href", "/goods");
      await expect(
        main(page).getByRole("heading", { name: copy.cart.karaoke.heading, exact: true }),
      ).toBeVisible();
      await expect(alert(page)).toHaveCount(0);
      await expect(proceedButton(page)).toHaveCount(0);
      await expect(headerCartLink(page, null)).toBeVisible();
    });
  }

  test("an unknown state of a non-empty Cart is never shown as empty", async ({ page }) => {
    await open(page, [entryLine(OFFERING.regular, 1)], publicScenario({ publicFetch: "fail" }));
    await expect(alert(page)).toBeVisible();
    await expect(main(page)).not.toContainText(copy.cart.empty);
  });
});

test.describe("TC-PG-CRT-001-506 loading shows no amount, no result and no purchase control (SPEC-050 9.1, 14A.1 State, 21)", () => {
  test("while the lines are resolved: a status, no rows, no amount, no empty text, no proceed button", async ({
    page,
  }) => {
    await open(
      page,
      [entryLine(OFFERING.regular, 2)],
      publicScenario({ latency: "long", latencyLongMs: 6000 }),
    );
    await expect(h1(page)).toHaveText(copy.cart.heading);
    await expect(main(page).locator('[role="status"]').first()).toContainText(
      copy.pageState.loading,
    );
    await expect(main(page)).not.toContainText(LOADING_FORBIDDEN);
    await expect(main(page)).not.toContainText(copy.cart.empty);
    await expect(rows(page)).toHaveCount(0);
    await expect(proceedButton(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(1, { timeout: 20_000 });
    await expect(proceedButton(page)).toBeEnabled();
  });
});

test.describe("TC-PG-CRT-001-507 a failed state read is 'unknown', never purchasable, and can be retried (SPEC-050 14A.1 Failure, FR-CRT-005, 31 item 2)", () => {
  const lines = [entryLine(OFFERING.regular, 2), goodsLine(GOODS.tshirt, 1)];
  const failures = [
    [
      "Cart state read fails",
      { [KEYS.scenario]: scenarioJson({ cart: { state: "fail", purchaseStart: "ok" } }) },
    ],
    ["public read fails", publicScenario({ publicFetch: "fail" })],
  ] as const;

  for (const [name, entries] of failures) {
    test(`${name}: an alert with retry, unresolved lines, no amount, no on-sale wording, proceed disabled`, async ({
      page,
    }) => {
      await open(page, lines, entries);
      await expect(alert(page)).toContainText(copy.pageState.unavailable(copy.cart.subject));
      await expect(
        alert(page).getByRole("button", { name: copy.pageState.retry, exact: true }),
      ).toBeVisible();
      await expect(rows(page)).toHaveCount(2);
      for (const index of [0, 1]) {
        const item = rows(page).nth(index);
        await expect(item).toContainText(copy.cart.unknownItemName);
        await expect(item).toContainText(label.label.UNAVAILABLE);
      }
      await expect(rows(page).nth(0)).toContainText(copy.cart.kind.ENTRY_TICKET);
      await expect(rows(page).nth(1)).toContainText(copy.cart.kind.GOODS);
      await expect(quantityInput(rows(page).nth(0))).toHaveValue("2");
      await expect(main(page)).not.toContainText(/[¥￥]\s*\d/);
      await expect(main(page)).not.toContainText(label.label.ON_SALE);
      await expect(main(page)).not.toContainText(label.description.ON_SALE);
      await expect(main(page)).not.toContainText(copy.cart.empty);
      await expect(proceedButton(page)).toBeDisabled();
      expect(await proceedReason(page)).toContain(copy.cart.proceed.unknown);
    });
  }

  test("the lines can still be edited and deleted while the state is unknown", async ({ page }) => {
    await open(page, lines, {
      [KEYS.scenario]: scenarioJson({ cart: { state: "fail", purchaseStart: "ok" } }),
    });
    await expect(alert(page)).toBeVisible();
    await quantityInput(rows(page).nth(0)).fill("3");
    await expect
      .poll(() => readCart(page))
      .toEqual(stored([entryLine(OFFERING.regular, 3), goodsLine(GOODS.tshirt, 1)]));
    await removeButton(rows(page).nth(1)).click();
    await expect(rows(page)).toHaveCount(1);
    await expect.poll(() => readCart(page)).toEqual(stored([entryLine(OFFERING.regular, 3)]));
  });

  test("retry re-reads the state and resolves the lines when it works again", async ({ page }) => {
    await open(page, lines, {
      [KEYS.scenario]: scenarioJson({ cart: { state: "fail", purchaseStart: "ok" } }),
    });
    await expect(alert(page)).toBeVisible();
    await writeStorage(page, KEYS.scenario, scenarioJson());
    await alert(page).getByRole("button", { name: copy.pageState.retry, exact: true }).click();
    await expect(alert(page)).toHaveCount(0);
    await expect(rowByHeading(page, offeringName(OFFERING.regular))).toContainText(
      label.label.ON_SALE,
    );
    await expect(proceedButton(page)).toBeEnabled();
    await expect(main(page)).toContainText(money(10000));
  });

  test("retry only reads: the Cart and the mock database are unchanged", async ({ page }) => {
    await open(page, lines, {
      [KEYS.scenario]: scenarioJson({ cart: { state: "fail", purchaseStart: "ok" } }),
    });
    await expect(alert(page)).toBeVisible();
    const cartBefore = await readCartRaw(page);
    const dbBefore = await readDbRaw(page);
    await alert(page).getByRole("button", { name: copy.pageState.retry, exact: true }).click();
    await expect(alert(page)).toBeVisible();
    expect(await readCartRaw(page)).toBe(cartBefore);
    expect(await readDbRaw(page)).toBe(dbBefore);
  });
});

test.describe("TC-PG-CRT-001-508 a partial failure leaves only the unresolved line unknown (FR-CRT-005, SPEC-050 14A.1 Cart Itemの購入不可理由)", () => {
  test("the first line is 'cannot confirm', the second is normal, the total is withheld, proceed is disabled", async ({
    page,
  }) => {
    await open(page, [entryLine(OFFERING.regular, 1), goodsLine(GOODS.tshirt, 1)], {
      [KEYS.scenario]: scenarioJson({ cart: { state: "partial", purchaseStart: "ok" } }),
    });
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).nth(0)).toContainText(label.label.UNAVAILABLE);
    await expect(rows(page).nth(0)).not.toContainText(/[¥￥]\s*\d/);
    await expect(rows(page).nth(1)).toContainText(expectedGoodsDetail(GOODS.tshirt).name);
    await expect(rows(page).nth(1)).toContainText(label.label.ON_SALE);
    await expect(rows(page).nth(1)).toContainText(formatMoney(goodsPrice(GOODS.tshirt)));
    const summary = main(page).getByRole("region", {
      name: copy.cart.summary.heading,
      exact: true,
    });
    await expect(summary).toContainText(copy.cart.summary.totalUnknown);
    await expect(summary).not.toContainText(/[¥￥]\s*\d/);
    await expect(proceedButton(page)).toBeDisabled();
    expect(await proceedReason(page)).toContain(copy.cart.proceed.blocked);
  });
});

test.describe("TC-PG-CRT-001-509 Karaoke cannot be added and the Cart says it is a separate purchase and payment (SPEC-050 14A.1 Karaoke案内, 31 item 28, FR-CRT-002)", () => {
  test("shows the guidance with a link to the Karaoke guide, and no Karaoke add control", async ({
    page,
  }) => {
    await openRows(page, [entryLine(OFFERING.regular, 1)]);
    const guidance = main(page).getByRole("region", {
      name: copy.cart.karaoke.heading,
      exact: true,
    });
    await expect(guidance).toContainText(copy.cart.karaoke.body);
    const link = guidance.getByRole("link", { name: copy.cart.karaoke.link, exact: true });
    await expect(link).toHaveAttribute("href", "/karaoke");
    // Nothing in the page main lets a Karaoke slot be added to the Cart.
    const controls = main(page).getByRole("button");
    for (const name of await controls.evaluateAll((els) =>
      els.map((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim()),
    )) {
      expect(name, "a button that mentions Karaoke").not.toMatch(/Karaoke|カラオケ/);
    }
    const links = await main(page)
      .getByRole("link")
      .evaluateAll((els) =>
        els.map((el) => ({
          text: (el.textContent ?? "").trim(),
          href: el.getAttribute("href") ?? "",
        })),
      );
    for (const item of links.filter((l) => /karaoke/i.test(l.text) || /karaoke/i.test(l.href))) {
      expect(item.href).toBe("/karaoke");
      expect(item.text).toBe(copy.cart.karaoke.link);
    }
    await link.click();
    await expect(page).toHaveURL(/\/karaoke$/);
  });

  test("is shown for an empty Cart too, and a Karaoke line in storage is rejected (cannot be in the Cart)", async ({
    page,
  }) => {
    await open(page, []);
    await expect(
      main(page).getByRole("region", { name: copy.cart.karaoke.heading, exact: true }),
    ).toContainText(copy.cart.karaoke.body);
    const raw = JSON.stringify({
      version: 1,
      lines: [{ kind: "KARAOKE", slotRef: "5a000000-0000-4000-8000-000000011000", quantity: 1 }],
    });
    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [KEYS.cart, raw],
    );
    await reloadHydrated(page);
    await expect(alert(page)).toContainText(copy.cart.corrupted.title);
    await expect(rows(page)).toHaveCount(0);
    expect(await readCartRaw(page)).toBe(raw);
  });
});

test.describe("TC-PG-CRT-001-510 a damaged Cart is reported with an explicit reset, never shown as empty or silently emptied (SPEC-050 26.4, Design 4)", () => {
  const bad = [
    ["not JSON", "not-json"],
    [
      "a price on a line",
      JSON.stringify({
        version: 1,
        lines: [
          { kind: "ENTRY_TICKET", offeringRef: OFFERING.regular, quantity: 1, unitPrice: 3000 },
        ],
      }),
    ],
    [
      "a zero quantity",
      JSON.stringify({
        version: 1,
        lines: [{ kind: "GOODS", goodsRef: GOODS.tshirt, quantity: 0 }],
      }),
    ],
    ["an unknown version", JSON.stringify({ version: 2, lines: [] })],
    [
      "a Karaoke line",
      JSON.stringify({
        version: 1,
        lines: [{ kind: "KARAOKE", slotRef: GOODS.tshirt, quantity: 1 }],
      }),
    ],
  ] as const;

  for (const [name, raw] of bad) {
    test(`${name}: shows the failure, not an empty Cart, and leaves the stored text alone`, async ({
      page,
    }) => {
      await open(page, null, { [KEYS.cart]: raw });
      await expect(h1(page)).toHaveText(copy.cart.heading);
      await expect(alert(page)).toContainText(copy.cart.corrupted.title);
      await expect(
        alert(page).getByRole("button", { name: copy.cart.corrupted.reset, exact: true }),
      ).toBeVisible();
      await expect(main(page)).not.toContainText(copy.cart.empty);
      await expect(rows(page)).toHaveCount(0);
      await expect(proceedButton(page)).toHaveCount(0);
      await expect(main(page)).not.toContainText(/[¥￥]\s*\d/);
      await expect(headerCartLink(page, null)).toBeVisible();
      await expect(
        page.getByRole("banner").getByRole("link", { name: /カート（\d+点）/ }),
      ).toHaveCount(0);
      await reloadHydrated(page);
      await expect(alert(page)).toContainText(copy.cart.corrupted.title);
      expect(await readCartRaw(page)).toBe(raw);
    });
  }

  test("the reset button writes an empty Cart and the page then shows the empty state", async ({
    page,
  }) => {
    await open(page, null, { [KEYS.cart]: "not-json" });
    await alert(page).getByRole("button", { name: copy.cart.corrupted.reset, exact: true }).click();
    await expect(main(page)).toContainText(copy.cart.empty);
    await expect(alert(page)).toHaveCount(0);
    expect(await readCartRaw(page)).toBe(EMPTY_CART_JSON);
  });
});

test.describe("TC-PG-CRT-001-511 the quantity field accepts a positive integer, saves it at once, and never loses focus (SPEC-050 14A.1 Actions, 25)", () => {
  for (const value of ["0", "-1", "1.5", ""]) {
    test(`quantity ${JSON.stringify(value)} is rejected: aria-invalid, an error tied to the field, nothing saved`, async ({
      page,
    }) => {
      await openRows(page, [entryLine(OFFERING.regular, 2)]);
      const item = rows(page).nth(0);
      const input = quantityInput(item);
      await input.fill(value);
      await expect(input).toHaveAttribute("aria-invalid", "true");
      expect(await describedText(input)).toContain(copy.quantity.invalid);
      expect(await readCart(page)).toEqual(stored([entryLine(OFFERING.regular, 2)]));
      await expect(item).toContainText(formatMoney(multiplyMoney(price(OFFERING.regular), 2)));
      await expect(headerCartLink(page, 2)).toBeVisible();
    });
  }

  test("a valid quantity is saved, the subtotal follows, and the field keeps focus through the refresh", async ({
    page,
  }) => {
    await openRows(page, [entryLine(OFFERING.regular, 2)]);
    const input = quantityInput(rows(page).nth(0));
    await input.focus();
    await input.fill("3");
    await expect.poll(() => readCart(page)).toEqual(stored([entryLine(OFFERING.regular, 3)]));
    await expect(rows(page).nth(0)).toContainText(
      formatMoney(multiplyMoney(price(OFFERING.regular), 3)),
    );
    await expect(proceedButton(page)).toBeEnabled();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("3");
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
  });

  test("while the lines are re-read after a change, the rows and the field stay and proceeding is blocked", async ({
    page,
  }) => {
    await openRows(page, [entryLine(OFFERING.regular, 2)]);
    await writeStorage(page, KEYS.scenario, scenarioJson({ latency: "long", latencyLongMs: 2500 }));
    const input = quantityInput(rows(page).nth(0));
    await input.fill("3");
    await expect(proceedButton(page)).toBeDisabled();
    expect(await proceedReason(page)).toContain(copy.cart.proceed.unknown);
    await expect(rows(page)).toHaveCount(1);
    await expect(input).toBeVisible();
    await expect(input).toHaveValue("3");
    await expect(main(page)).not.toContainText(copy.cart.empty);
    await expect(proceedButton(page)).toBeEnabled({ timeout: 15_000 });
  });

  test("keyboard: quantity, then Delete by Tab, and Enter on Delete removes the line", async ({
    page,
  }) => {
    await openRows(page, [entryLine(OFFERING.regular, 2), goodsLine(GOODS.tshirt, 1)]);
    const item = rows(page).nth(0);
    await quantityInput(item).focus();
    await page.keyboard.press("Tab");
    await expect(removeButton(item)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(rows(page)).toHaveCount(1);
    await expect.poll(() => readCart(page)).toEqual(stored([goodsLine(GOODS.tshirt, 1)]));
  });
});

test.describe("TC-PG-CRT-001-512 prices come from the port on every load and never from the Cart (SPEC-050 22, 26.4, FR-CRT-003, DEV-TS-006)", () => {
  test("a changed unit price is shown after a reload, and the stored Cart never held a price", async ({
    page,
  }) => {
    await openRows(page, [entryLine(OFFERING.regular, 2)]);
    await expect(rows(page).nth(0)).toContainText("¥3,000");
    await writeStorage(
      page,
      KEYS.db,
      dbJson(priceEdit("offering", OFFERING.regular, "3300"))[KEYS.db] ?? "",
    );
    await reloadHydrated(page);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).nth(0)).toContainText("¥3,300");
    await expect(rows(page).nth(0)).toContainText("¥6,600");
    await expect(rows(page).nth(0)).not.toContainText("¥3,000");
    const raw = (await readCartRaw(page)) ?? "";
    expect(raw).not.toMatch(FORBIDDEN_IN_CART_STORAGE);
    expect(raw).not.toMatch(/3300|3000/);
  });

  test("money is exact beyond double precision (unit price, subtotal and total)", async ({
    page,
  }) => {
    await open(
      page,
      [entryLine(OFFERING.regular, 3)],
      dbJson(priceEdit("offering", OFFERING.regular, "9007199254740993")),
    );
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).nth(0)).toContainText("¥9,007,199,254,740,993");
    await expect(rows(page).nth(0)).toContainText("¥27,021,597,764,222,979");
    await expect(
      main(page).getByRole("region", { name: copy.cart.summary.heading, exact: true }),
    ).toContainText("¥27,021,597,764,222,979");
  });

  test("the display total is labelled as recalculated by the server", async ({ page }) => {
    await openRows(page, [entryLine(OFFERING.regular, 1)]);
    await expect(main(page)).toContainText(copy.cart.summary.recalcNote);
  });
});

test.describe("TC-PG-CRT-001-513 a session that changes while the Cart page is open changes the line state and the proceed button without a reload (FR-CRT-005, FR-CRT-012, SPEC-050 14A.1)", () => {
  test("a login in another tab blocks the limit line and the proceed button here; the stored Cart is unchanged", async ({
    page,
    context,
  }) => {
    await openRows(page, [entryLine(OFFERING.limit, 1)]);
    await expect(rows(page).nth(0)).toContainText(label.label.ON_SALE);
    await expect(proceedButton(page)).toBeEnabled();
    const cartBefore = await readCartRaw(page);
    await expect(headerCartLink(page, 1)).toBeVisible();
    const other = await openSecondTab(context);
    await other.goto("/");

    await writeStorage(other, KEYS.session, authenticatedSession());
    await expect(rows(page).nth(0)).toContainText(label.label.PURCHASE_LIMIT_EXCEEDED);
    await expect(rows(page).nth(0)).toContainText(label.description.PURCHASE_LIMIT_EXCEEDED);
    await expect(rows(page).nth(0)).not.toContainText(label.label.ON_SALE);
    await expect(proceedButton(page)).toBeDisabled();
    expect(await proceedReason(page)).toContain(copy.cart.proceed.blocked);
    expect(await readCartRaw(page)).toBe(cartBefore);
    expect(await readCart(page)).toEqual(stored([entryLine(OFFERING.limit, 1)]));
    await expect(headerCartLink(page, 1)).toBeVisible();

    await writeStorage(other, KEYS.session, sessionJson());
    await expect(rows(page).nth(0)).toContainText(label.label.ON_SALE);
    await expect(proceedButton(page)).toBeEnabled();
    expect(await readCartRaw(page)).toBe(cartBefore);
    await other.close();
  });
});
