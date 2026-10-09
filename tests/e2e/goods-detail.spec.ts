import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { formatJstDateTime } from "../../apps/web/src/presentation/format/datetime.ts";
import { formatMoney, multiplyMoney } from "../../apps/web/src/presentation/format/money.ts";
import {
  addButton,
  describedText,
  expectedGoodsDetail,
  FORBIDDEN_IN_CART_STORAGE,
  headerCartLink,
  liveRegion,
  mainOf,
  priceEdit,
  quantityInput,
  readCart,
  readCartRaw,
  readDbRaw,
  writeStorage,
} from "../harness/browser/cart.ts";
import { gotoHydrated, reloadHydrated } from "../harness/browser/hydration.ts";
import { dbJson, fixClock, LOADING_FORBIDDEN, publicScenario } from "../harness/browser/public.ts";
import {
  authenticatedSession,
  KEYS,
  scenarioJson,
  seedLocalStorage,
} from "../harness/browser/shell.ts";
import { GOODS, MARKER } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s5-cart.md sections 5.2, 6.
// PG-GDS-002 (SPEC-050 14.2), 9, 21, 25, 26.4, 31 items 6 / 24 (first half), FR-CRT-001 / 003, BR-ORD-020.

const main = mainOf;
const h1 = (page: Page) => main(page).getByRole("heading", { level: 1 });
const detail = (ref: string) => expectedGoodsDetail(ref);
const cartWith = (lines: { goodsRef: string; quantity: number }[]) => ({
  version: 1,
  lines: lines.map((l) => ({ kind: "GOODS", ...l })),
});

async function open(
  page: Page,
  ref: string,
  entries: Record<string, string> = {},
): Promise<number | undefined> {
  await fixClock(page);
  await seedLocalStorage(page, entries);
  const response = await gotoHydrated(page, `/goods/${ref}`);
  return response?.status();
}

async function openReady(page: Page, ref: string, entries: Record<string, string> = {}) {
  await open(page, ref, entries);
  await expect(h1(page)).toHaveText(detail(ref).name);
}

test.describe("TC-PG-GDS-002-501 the detail page shows the Goods facts and the venue-pickup notice without shipping fields (SPEC-050 14.2)", () => {
  test("shows name, description, price, sales period, state, pickup notice, quantity and the Cart actions", async ({
    page,
  }) => {
    const goods = detail(GOODS.tshirt);
    expect(await open(page, GOODS.tshirt)).toBe(200);
    await expect(h1(page)).toHaveText(goods.name);
    await expect(h1(page)).toHaveCount(1);
    await expect(main(page)).toContainText(goods.description);
    await expect(main(page)).toContainText(formatMoney(goods.unitPrice));
    await expect(main(page)).toContainText(formatJstDateTime(goods.startsAt));
    await expect(main(page)).toContainText(formatJstDateTime(goods.endsAt));
    await expect(main(page)).toContainText(copy.availability.label.ON_SALE);
    await expect(main(page)).toContainText(copy.goods.detail.pickupNotice);
    await expect(quantityInput(main(page))).toHaveValue("1");
    await expect(addButton(main(page))).toBeEnabled();
    await expect(
      main(page).getByRole("link", { name: copy.sales.viewCart, exact: true }),
    ).toHaveAttribute("href", "/cart");
    await expect(
      main(page).getByRole("link", { name: copy.goods.detail.backToList, exact: true }),
    ).toHaveAttribute("href", "/goods");
    await expect(main(page)).toContainText(copy.sales.displayTotalLabel);
    await expect(main(page)).toContainText(copy.sales.displayTotalNote);
  });

  test("has no shipping address, carrier or tracking field or wording; the only input is the quantity", async ({
    page,
  }) => {
    await openReady(page, GOODS.tshirt);
    await expect(main(page).locator("input, select, textarea")).toHaveCount(1);
    await expect(main(page).getByRole("spinbutton")).toHaveCount(1);
    await expect(main(page)).not.toContainText(/配送先|住所|配送業者|配送追跡|お届け|送料/);
    await expect(main(page).getByRole("listitem")).toHaveCount(0);
  });

  test("announces the selectable maximum from the port", async ({ page }) => {
    await openReady(page, GOODS.towel);
    await expect(main(page)).toContainText(copy.quantity.guidance(3));
    await openReady(page, GOODS.tshirt);
    await expect(main(page)).toContainText(copy.quantity.guidance(20));
  });

  test("shows the description as plain text (no markup is interpreted)", async ({ page }) => {
    await openReady(page, GOODS.tshirt);
    await expect(main(page).locator("script, img, b, a[href^='javascript']")).toHaveCount(0);
  });
});

test.describe("TC-PG-GDS-002-502 out-of-period, suspended and sold-out Goods are different states and cannot be added (SPEC-050 14.2, 31 item 6, 25)", () => {
  const states = [
    {
      ref: GOODS.tshirt,
      label: () => copy.availability.label.ON_SALE,
      reason: () => copy.availability.description.ON_SALE,
      enabled: true,
    },
    {
      ref: GOODS.towel,
      label: () => copy.availability.label.ON_SALE,
      reason: () => copy.availability.description.ON_SALE,
      enabled: true,
    },
    {
      ref: GOODS.badge,
      label: () => copy.availability.label.SOLD_OUT,
      reason: () => copy.availability.description.SOLD_OUT,
      enabled: false,
    },
    {
      ref: GOODS.poster,
      label: () => copy.availability.label.BEFORE_SALES,
      reason: () => copy.availability.beforeSales(formatJstDateTime(detail(GOODS.poster).startsAt)),
      enabled: false,
    },
    {
      ref: GOODS.sticker,
      label: () => copy.availability.label.SALES_ENDED,
      reason: () => copy.availability.description.SALES_ENDED,
      enabled: false,
    },
    {
      ref: GOODS.lanyard,
      label: () => copy.availability.label.SUSPENDED,
      reason: () => copy.availability.description.SUSPENDED,
      enabled: false,
    },
  ] as const;

  for (const state of states) {
    test(`${state.ref.slice(-2)}: shows its own label and reason; Cart add is ${state.enabled ? "enabled" : "disabled with the reason tied to it"}`, async ({
      page,
    }) => {
      await openReady(page, state.ref);
      await expect(main(page)).toContainText(state.label());
      await expect(main(page)).toContainText(state.reason());
      const add = addButton(main(page));
      await expect(add).toBeVisible();
      if (state.enabled) {
        await expect(add).toBeEnabled();
      } else {
        await expect(add).toBeDisabled();
        expect(await describedText(add)).toContain(state.reason());
      }
    });
  }

  test("a page never shows another state's label (text alone tells the states apart)", async ({
    page,
  }) => {
    const labels = copy.availability.label;
    const all = [
      labels.ON_SALE,
      labels.SOLD_OUT,
      labels.BEFORE_SALES,
      labels.SALES_ENDED,
      labels.SUSPENDED,
    ];
    for (const state of states) {
      await openReady(page, state.ref);
      const text = await main(page).innerText();
      expect(text).toContain(state.label());
      for (const other of all.filter((l) => l !== state.label())) {
        expect(text, `${state.ref} must not show ${other}`).not.toContain(other);
      }
    }
  });

  test("an authenticated user sees the same states and the same enabled add", async ({ page }) => {
    await openReady(page, GOODS.tshirt, { [KEYS.session]: authenticatedSession() });
    await expect(addButton(main(page))).toBeEnabled();
    await openReady(page, GOODS.badge);
    await expect(addButton(main(page))).toBeDisabled();
  });
});

test.describe("TC-PG-GDS-002-503 adding Goods stores a reference and a quantity and is not a purchase (SPEC-050 14.2, FR-CRT-001 / 003)", () => {
  test("guest: add stores a Goods line, announces the result, updates the Header at once", async ({
    page,
  }) => {
    await openReady(page, GOODS.towel);
    expect(await readCartRaw(page)).toBeNull();
    await quantityInput(main(page)).fill("2");
    await addButton(main(page)).click();
    await expect(liveRegion(page)).toContainText(copy.sales.addSucceeded);
    await expect
      .poll(() => readCart(page))
      .toEqual(cartWith([{ goodsRef: GOODS.towel, quantity: 2 }]));
    expect(await readCartRaw(page)).not.toMatch(FORBIDDEN_IN_CART_STORAGE);
    await expect(headerCartLink(page, 2)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/goods/${GOODS.towel}$`));
  });

  test("adding the same Goods again sums the quantity", async ({ page }) => {
    await openReady(page, GOODS.tshirt);
    await addButton(main(page)).click();
    await quantityInput(main(page)).fill("3");
    await addButton(main(page)).click();
    await expect
      .poll(() => readCart(page))
      .toEqual(cartWith([{ goodsRef: GOODS.tshirt, quantity: 4 }]));
    await expect(headerCartLink(page, 4)).toBeVisible();
  });

  test("the Cart keeps lines of two Goods pages and survives a reload", async ({ page }) => {
    await openReady(page, GOODS.tshirt);
    await addButton(main(page)).click();
    await expect(headerCartLink(page, 1)).toBeVisible();
    await openReady(page, GOODS.towel);
    await addButton(main(page)).click();
    await expect(headerCartLink(page, 2)).toBeVisible();
    await reloadHydrated(page);
    await expect(headerCartLink(page, 2)).toBeVisible();
    await expect
      .poll(() => readCart(page))
      .toEqual(
        cartWith([
          { goodsRef: GOODS.tshirt, quantity: 1 },
          { goodsRef: GOODS.towel, quantity: 1 },
        ]),
      );
  });

  test("the quantity must be a positive integer within the announced maximum", async ({ page }) => {
    await openReady(page, GOODS.towel);
    const input = quantityInput(main(page));
    for (const [value, text] of [
      ["0", copy.quantity.invalid],
      ["-3", copy.quantity.invalid],
      ["2.5", copy.quantity.invalid],
      ["", copy.quantity.invalid],
      ["4", copy.quantity.exceedsMax(3)],
    ] as const) {
      await input.fill(value);
      await expect(input, value).toHaveAttribute("aria-invalid", "true");
      expect(await describedText(input), value).toContain(text);
      await expect(addButton(main(page)), value).toBeDisabled();
    }
    expect(await readCartRaw(page)).toBeNull();
    await input.fill("3");
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    await expect(addButton(main(page))).toBeEnabled();
    await expect(main(page)).toContainText(
      formatMoney(multiplyMoney(detail(GOODS.towel).unitPrice, 3)),
    );
  });

  test("no Order is made and the mock database is not touched; no purchase control exists here", async ({
    page,
  }) => {
    await openReady(page, GOODS.tshirt);
    const before = await readDbRaw(page);
    await addButton(main(page)).click();
    await expect.poll(() => readCartRaw(page)).not.toBeNull();
    expect(await readDbRaw(page)).toBe(before);
    await expect(
      main(page).getByRole("button", { name: /購入手続き|今すぐ購入|支払/ }),
    ).toHaveCount(0);
    await expect(main(page).getByRole("link", { name: /購入手続き|今すぐ購入|支払/ })).toHaveCount(
      0,
    );
  });

  test("an authenticated user adds in exactly the same way", async ({ page }) => {
    await openReady(page, GOODS.tshirt, { [KEYS.session]: authenticatedSession() });
    await addButton(main(page)).click();
    await expect
      .poll(() => readCart(page))
      .toEqual(cartWith([{ goodsRef: GOODS.tshirt, quantity: 1 }]));
  });

  test("the live region is present and empty before the add, then holds the result text", async ({
    page,
  }) => {
    await openReady(page, GOODS.tshirt);
    await expect(liveRegion(page)).toHaveCount(1);
    expect((await liveRegion(page).textContent())?.trim()).toBe("");
    await addButton(main(page)).click();
    await expect(liveRegion(page)).toHaveText(copy.sales.addSucceeded);
  });

  test("keyboard: Tab from the quantity reaches Add and Enter adds", async ({ page }) => {
    await openReady(page, GOODS.tshirt);
    await quantityInput(main(page)).fill("2");
    await page.keyboard.press("Tab");
    await expect(addButton(main(page))).toBeFocused();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => readCart(page))
      .toEqual(cartWith([{ goodsRef: GOODS.tshirt, quantity: 2 }]));
  });

  test("a damaged stored Cart is not overwritten and no success is announced", async ({ page }) => {
    await openReady(page, GOODS.tshirt, { [KEYS.cart]: "not-json" });
    await addButton(main(page)).click();
    await expect(main(page).getByRole("alert")).toContainText(copy.cart.corrupted.title);
    expect(await readCartRaw(page)).toBe("not-json");
    await expect(liveRegion(page)).not.toContainText(copy.sales.addSucceeded);
  });

  test("the price shown is the port's current price, and the stored Cart carries no price", async ({
    page,
  }) => {
    await openReady(page, GOODS.tshirt, dbJson(priceEdit("goods", GOODS.tshirt, "4400")));
    await expect(main(page)).toContainText("¥4,400");
    await expect(main(page)).not.toContainText("¥4,000");
    await addButton(main(page)).click();
    await expect.poll(() => readCartRaw(page)).not.toBeNull();
    expect((await readCartRaw(page)) ?? "").not.toMatch(/4400|4,400/);
  });
});

test.describe("TC-PG-GDS-002-504 an unknown or non-public Goods is Not Found without revealing why (SPEC-050 14.2, 19.1, INV-010-09)", () => {
  test("a reference that is not a canonical UUID answers HTTP 404 with the Not Found page", async ({
    page,
  }) => {
    for (const bad of ["not-a-uuid", GOODS.tshirt.toUpperCase(), "1", "abc%20def"]) {
      await fixClock(page);
      const response = await gotoHydrated(page, `/goods/${bad}`);
      expect(response?.status(), bad).toBe(404);
      await expect(h1(page), bad).toHaveText(copy.notFound.title);
    }
  });

  test("a non-public Goods and a never-existing one look identical and show nothing about the item", async ({
    page,
  }) => {
    await open(page, GOODS.hidden);
    await expect(h1(page)).toHaveText(copy.notFound.title);
    await expect(main(page)).not.toContainText(MARKER.hiddenGoods);
    await expect(main(page)).not.toContainText(/非公開/);
    await expect(addButton(main(page))).toHaveCount(0);
    const hidden = await main(page).innerText();
    await gotoHydrated(page, "/goods/a0000000-0000-4000-8000-0000000000ff");
    await expect(h1(page)).toHaveText(copy.notFound.title);
    expect(await main(page).innerText()).toBe(hidden);
  });
});

test.describe("TC-PG-GDS-002-505 a failed read is unknown, never purchasable; loading shows no result (SPEC-050 9, 14.2 取得Failure, 21)", () => {
  test("a failed read shows an error with retry and no enabled add", async ({ page }) => {
    await open(page, GOODS.tshirt, publicScenario({ publicFetch: "fail" }));
    await expect(h1(page)).toHaveText(copy.goods.detail.heading);
    const alert = main(page).getByRole("alert");
    await expect(alert).toContainText(copy.pageState.unavailable(copy.goods.detail.subject));
    await expect(
      alert.getByRole("button", { name: copy.pageState.retry, exact: true }),
    ).toBeVisible();
    for (const add of await main(page).getByRole("button", { name: copy.sales.add }).all()) {
      await expect(add).toBeDisabled();
    }
    await expect(main(page)).not.toContainText(copy.notFound.title);
    await expect(main(page)).not.toContainText(/売り切れ|販売中/);
    await expect(main(page)).not.toContainText(/[¥￥]\s*\d/);
  });

  test("retry recovers when the read succeeds again", async ({ page }) => {
    await open(page, GOODS.tshirt, publicScenario({ publicFetch: "fail" }));
    await expect(main(page).getByRole("alert")).toBeVisible();
    await writeStorage(page, KEYS.scenario, scenarioJson());
    await main(page).getByRole("button", { name: copy.pageState.retry, exact: true }).click();
    await expect(h1(page)).toHaveText(detail(GOODS.tshirt).name);
    await expect(addButton(main(page))).toBeEnabled();
  });

  test("loading shows a status, no result wording, no amount and no add button", async ({
    page,
  }) => {
    await open(page, GOODS.tshirt, publicScenario({ latency: "long", latencyLongMs: 6000 }));
    await expect(h1(page)).toHaveText(copy.goods.detail.heading);
    await expect(main(page).locator('[role="status"]').first()).toContainText(
      copy.pageState.loading,
    );
    await expect(main(page)).not.toContainText(LOADING_FORBIDDEN);
    await expect(addButton(main(page))).toHaveCount(0);
    await expect(h1(page)).toHaveText(detail(GOODS.tshirt).name, { timeout: 20_000 });
  });
});

test.describe("TC-PG-GDS-002-506 the Goods list links resolve to the detail page and back (SPEC-050 14.1, 14.2)", () => {
  test("opens a detail page from the list, adds, and returns to the list", async ({ page }) => {
    await fixClock(page);
    await seedLocalStorage(page, {});
    await gotoHydrated(page, "/goods");
    const goods = detail(GOODS.tshirt);
    await expect(main(page).getByRole("listitem")).toHaveCount(6);
    await main(page).getByRole("link", { name: goods.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/goods/${GOODS.tshirt}$`));
    await expect(h1(page)).toHaveText(goods.name);
    await addButton(main(page)).click();
    await expect(headerCartLink(page, 1)).toBeVisible();
    await main(page).getByRole("link", { name: copy.goods.detail.backToList, exact: true }).click();
    await expect(page).toHaveURL(/\/goods$/);
    await expect(headerCartLink(page, 1)).toBeVisible();
  });
});
