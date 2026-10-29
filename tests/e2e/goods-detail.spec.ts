import { expect, type Page, test } from "@playwright/test";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { formatJstDateTime } from "../../apps/web/src/presentation/format/datetime.ts";
import { formatMoney, multiplyMoney } from "../../apps/web/src/presentation/format/money.ts";
import {
  addButton,
  describedText,
  expectedGoodsDetail,
  FORBIDDEN_ELIGIBILITY_IN_STORAGE,
  FORBIDDEN_IN_CART_STORAGE,
  headerCartLink,
  liveRegion,
  mainOf,
  openSecondTab,
  priceEdit,
  quantityInput,
  readCart,
  readCartRaw,
  readDbRaw,
  recordedTexts,
  recordTextsIn,
  storedText,
  writeStorage,
} from "../harness/browser/cart.ts";
import { gotoHydrated, reloadHydrated } from "../harness/browser/hydration.ts";
import { dbJson, fixClock, LOADING_FORBIDDEN, publicScenario } from "../harness/browser/public.ts";
import {
  authenticatedSession,
  KEYS,
  scenarioJson,
  seedLocalStorage,
  sessionJson,
} from "../harness/browser/shell.ts";
import { EMAIL, GOODS, MARKER, NOW_ISO } from "../harness/mock-seed.ts";

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
  test("a reference that is not a canonical UUID shows the Not Found page (the static shell answers HTTP 200)", async ({
    page,
  }) => {
    for (const bad of ["not-a-uuid", GOODS.tshirt.toUpperCase(), "1", "abc%20def"]) {
      await fixClock(page);
      const response = await gotoHydrated(page, `/goods/${bad}`);
      expect(response?.status(), bad).toBe(200);
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

// B4c: the owner-scoped eligibility (API-PUR-ELG-001) on the Goods detail. Goods has no Purchase Limit (SPEC-030 10.3), so a verified
// owner's answer equals the public state in the seed; the tests below check the fail-closed and session rules (SPEC-050 12.1 / 14.2).
const statusOf = (page: Page) =>
  main(page)
    .locator("div")
    .filter({ has: page.getByText(copy.sales.statusLabel, { exact: true }) })
    .last();
const alertOf = (page: Page) => main(page).getByRole("alert");
const retryOf = (page: Page) =>
  alertOf(page).getByRole("button", { name: copy.pageState.retry, exact: true });
const failScenario = () =>
  scenarioJson({ cart: { state: "eligibility_fail", purchaseStart: "ok" } });

test.describe("TC-PG-GDS-002-507 a verified owner whose eligibility cannot be read cannot add the Goods ('cannot confirm', alert and retry); a Guest and an unverified user are not affected; nothing is persisted (API-PUR-ELG-001, SEC-API-029, SPEC-050 12.1 / 14.2 / 21)", () => {
  const label = () => copy.availability.label;
  const description = () => copy.availability.description;

  test("a verified user: 'cannot confirm', Add disabled with the reason attached, no maximum, one alert with retry; the facts stay; only reading happens", async ({
    page,
  }) => {
    const goods = detail(GOODS.tshirt);
    await openReady(page, GOODS.tshirt, {
      [KEYS.session]: authenticatedSession(),
      [KEYS.scenario]: failScenario(),
    });
    await expect(alertOf(page)).toHaveCount(1);
    await expect(alertOf(page)).toContainText(
      copy.pageState.unavailable(copy.entry.eligibilitySubject),
    );
    await expect(retryOf(page)).toBeVisible();
    await expect(statusOf(page)).toContainText(label().UNAVAILABLE);
    await expect(statusOf(page)).not.toContainText(label().ON_SALE);
    await expect(main(page)).not.toContainText(label().ON_SALE);
    await expect(addButton(main(page))).toBeDisabled();
    expect(await describedText(addButton(main(page)))).toContain(description().UNAVAILABLE);
    await expect(main(page)).not.toContainText(copy.quantity.guidance(20));
    // The facts of the public read are still shown.
    await expect(h1(page)).toHaveText(goods.name);
    await expect(main(page)).toContainText(goods.description);
    await expect(main(page)).toContainText(formatMoney(goods.unitPrice));
    await expect(main(page)).toContainText(formatJstDateTime(goods.startsAt));
    await expect(main(page)).toContainText(formatJstDateTime(goods.endsAt));

    // Reading again only reads: the Cart and the mock database are untouched and the answer is not stored.
    const dbBefore = await readDbRaw(page);
    await retryOf(page).click();
    await expect(alertOf(page)).toHaveCount(1);
    await expect(addButton(main(page))).toBeDisabled();
    expect(await readCartRaw(page)).toBeNull();
    expect(await readDbRaw(page)).toBe(dbBefore);
    expect(await storedText(page, [KEYS.scenario])).not.toMatch(FORBIDDEN_ELIGIBILITY_IN_STORAGE);
  });

  test("retry recovers without a reload once the eligibility works: on sale, Add enabled, the maximum announced again", async ({
    page,
  }) => {
    await openReady(page, GOODS.tshirt, {
      [KEYS.session]: authenticatedSession(),
      [KEYS.scenario]: failScenario(),
    });
    await expect(alertOf(page)).toHaveCount(1);
    await writeStorage(page, KEYS.scenario, scenarioJson());
    await retryOf(page).click();
    await expect(alertOf(page)).toHaveCount(0);
    await expect(statusOf(page)).toContainText(label().ON_SALE);
    await expect(statusOf(page)).not.toContainText(label().UNAVAILABLE);
    await expect(addButton(main(page))).toBeEnabled();
    await expect(main(page)).toContainText(copy.quantity.guidance(20));
    expect(await readCartRaw(page)).toBeNull();
    expect(await storedText(page, [KEYS.scenario])).not.toMatch(FORBIDDEN_ELIGIBILITY_IN_STORAGE);
  });

  test("a verified user with a working eligibility sees the same state as before: on sale, Add enabled, adding stores a reference and a quantity only", async ({
    page,
  }) => {
    await openReady(page, GOODS.towel, { [KEYS.session]: authenticatedSession() });
    await expect(alertOf(page)).toHaveCount(0);
    await expect(statusOf(page)).toContainText(label().ON_SALE);
    await expect(main(page)).toContainText(copy.quantity.guidance(3));
    await addButton(main(page)).click();
    await expect
      .poll(() => readCart(page))
      .toEqual(cartWith([{ goodsRef: GOODS.towel, quantity: 1 }]));
    expect(await readCartRaw(page)).not.toMatch(FORBIDDEN_IN_CART_STORAGE);
    expect(await storedText(page, [KEYS.scenario])).not.toMatch(FORBIDDEN_ELIGIBILITY_IN_STORAGE);
  });

  test("a Guest and an unverified user get the public state only: the eligibility is not read, so its failure is invisible", async ({
    page,
    context,
  }) => {
    await openReady(page, GOODS.tshirt, { [KEYS.scenario]: failScenario() });
    await expect(alertOf(page)).toHaveCount(0);
    await expect(statusOf(page)).toContainText(label().ON_SALE);
    await expect(addButton(main(page))).toBeEnabled();
    await expect(main(page)).toContainText(copy.quantity.guidance(20));

    const other = await context.newPage();
    await other.clock.setFixedTime(new Date(NOW_ISO));
    await seedLocalStorage(other, {
      [KEYS.scenario]: failScenario(),
      [KEYS.session]: sessionJson({
        kind: "authenticated",
        email: EMAIL.unverified,
        emailVerified: false,
      }),
    });
    await gotoHydrated(other, `/goods/${GOODS.tshirt}`);
    await expect(h1(other)).toHaveText(detail(GOODS.tshirt).name);
    await expect(alertOf(other)).toHaveCount(0);
    await expect(statusOf(other)).toContainText(label().ON_SALE);
    await expect(addButton(main(other))).toBeEnabled();
    await other.close();
  });

  test("a Goods that is not on sale publicly keeps its public state for a verified user too, with or without a failing eligibility (it cannot improve)", async ({
    page,
  }) => {
    await openReady(page, GOODS.badge, {
      [KEYS.session]: authenticatedSession(),
      [KEYS.scenario]: failScenario(),
    });
    await expect(alertOf(page)).toHaveCount(0);
    await expect(statusOf(page)).toContainText(label().SOLD_OUT);
    await expect(statusOf(page)).not.toContainText(label().UNAVAILABLE);
    await expect(addButton(main(page))).toBeDisabled();
    expect(await describedText(addButton(main(page)))).toContain(description().SOLD_OUT);
  });
});

test.describe("TC-PG-GDS-002-508 after a session change the public Goods stays and nothing of the previous viewer is shown: 'cannot confirm' until the new owner's answer arrives (B4b-F-1 rule E, SEC-API-029, DEV-WEB-007, SPEC-050 12.1 / 26.2)", () => {
  // The in-between states are checked with a long latency switched on after the first display, and by a recorder that
  // notices a state shown only for a moment (the final display alone cannot). Same method as TC-PG-TKT-001-511.
  const label = () => copy.availability.label;
  const description = () => copy.availability.description;
  const NEEDLES = () => [label().ON_SALE, label().UNAVAILABLE];
  const MID = { timeout: 2_000 };
  const DONE = { timeout: 20_000 };
  const slow = (page: Page) =>
    writeStorage(page, KEYS.scenario, scenarioJson({ latency: "long", latencyLongMs: 5000 }));

  test("after a Guest becomes a verified user: 'cannot confirm' with Add disabled until the owner's answer arrives; the name, price and typed quantity stay; no alert", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const goods = detail(GOODS.tshirt);
    await openReady(page, GOODS.tshirt);
    await expect(statusOf(page)).toContainText(label().ON_SALE);
    await expect(addButton(main(page))).toBeEnabled();
    await quantityInput(main(page)).fill("2");
    const dbBefore = await readDbRaw(page);
    const other = await openSecondTab(context);
    await other.goto("/");
    await slow(page);
    await recordTextsIn(statusOf(page), "status", NEEDLES());
    await writeStorage(other, KEYS.session, authenticatedSession());

    await expect(statusOf(page)).toContainText(label().UNAVAILABLE, MID);
    await expect(statusOf(page)).not.toContainText(label().ON_SALE, MID);
    await expect(addButton(main(page))).toBeDisabled(MID);
    expect(await describedText(addButton(main(page)))).toContain(description().UNAVAILABLE);
    await expect(main(page)).not.toContainText(copy.quantity.guidance(20), MID);
    await expect(alertOf(page)).toHaveCount(0, MID);
    await expect(h1(page)).toHaveText(goods.name, MID);
    await expect(main(page)).toContainText(formatMoney(goods.unitPrice), MID);
    await expect(main(page)).toContainText(formatJstDateTime(goods.startsAt), MID);
    // The form is not unmounted: the typed quantity is kept.
    await expect(quantityInput(main(page))).toHaveValue("2", MID);

    await expect(statusOf(page)).toContainText(label().ON_SALE, DONE);
    await expect(addButton(main(page))).toBeEnabled(DONE);
    await expect(main(page)).toContainText(copy.quantity.guidance(20), DONE);
    await expect(quantityInput(main(page))).toHaveValue("2");

    const recorded = await recordedTexts(page, "status");
    expect(recorded[0]).toBeDefined();
    expect(recorded[0]).toContain(label().UNAVAILABLE);
    expect(recorded[0]).not.toContain(label().ON_SALE);
    expect(await readCartRaw(page)).toBeNull();
    expect(await readDbRaw(page)).toBe(dbBefore);
    await other.close();
  });

  test("after a verified user whose eligibility failed becomes a Guest: the alert disappears at once, never shown again, and the public state returns (Add enabled)", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await openReady(page, GOODS.tshirt, {
      [KEYS.session]: authenticatedSession(),
      [KEYS.scenario]: failScenario(),
    });
    await expect(alertOf(page)).toHaveCount(1);
    await expect(addButton(main(page))).toBeDisabled();
    const dbBefore = await readDbRaw(page);
    const other = await openSecondTab(context);
    await other.goto("/");
    await slow(page);
    await recordTextsIn(main(page), "alert", [
      copy.pageState.unavailable(copy.entry.eligibilitySubject),
    ]);
    await writeStorage(other, KEYS.session, sessionJson());

    await expect(alertOf(page)).toHaveCount(0, MID);
    await expect(statusOf(page)).toContainText(label().ON_SALE, MID);
    await expect(statusOf(page)).not.toContainText(label().UNAVAILABLE, MID);
    await expect(addButton(main(page))).toBeEnabled(MID);

    // Nothing of the previous viewer's failure is shown again after the change (the recorder starts before it).
    await expect(statusOf(page)).toContainText(label().ON_SALE, DONE);
    const recorded = await recordedTexts(page, "alert");
    expect(
      recorded.filter((seen) =>
        seen.includes(copy.pageState.unavailable(copy.entry.eligibilitySubject)),
      ),
    ).toEqual([]);
    expect(await readCartRaw(page)).toBeNull();
    expect(await readDbRaw(page)).toBe(dbBefore);
    await other.close();
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
