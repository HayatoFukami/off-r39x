import { expect, type Page, test } from "@playwright/test";
import type { UtcInstant } from "../../apps/web/src/api-client/types.ts";
import { copy } from "../../apps/web/src/presentation/copy/ja.ts";
import { formatJstDateTime } from "../../apps/web/src/presentation/format/datetime.ts";
import { formatMoney } from "../../apps/web/src/presentation/format/money.ts";
import {
  expectedGoods,
  fixClock,
  LOADING_FORBIDDEN,
  publicScenario,
} from "../harness/browser/public.ts";
import { KEYS, scenarioJson, seedLocalStorage } from "../harness/browser/shell.ts";
import { GOODS, MARKER } from "../harness/mock-seed.ts";

// UI mock suite (TST-E2E-004: auxiliary, not G8). Contract: tests/contracts/s4-public.md sections 3.5, 4.
// PG-GDS-001 (SPEC-050 14.1), 31 items 1, 2 and 6, 24.1, 25, 33, INV-010-09.

const main = (page: Page) => page.getByRole("main");
const h1 = (page: Page) => main(page).getByRole("heading", { level: 1 });

async function open(page: Page, entries: Record<string, string> = {}): Promise<number | undefined> {
  await fixClock(page);
  await seedLocalStorage(page, entries);
  const response = await page.goto("/goods");
  return response?.status();
}

const rowOf = (page: Page, name: string) =>
  main(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name, exact: true }) });

test.describe("TC-PG-GDS-001-611 the goods list shows name, summary, price, state and reason and links to the detail (SPEC-050 14.1, 31 item 1)", () => {
  test("lists the six public goods in order with one h1", async ({ page }) => {
    const goods = expectedGoods();
    expect(goods).toHaveLength(6);
    expect(await open(page)).toBe(200);
    await expect(h1(page)).toHaveText(copy.goods.list.heading);
    await expect(h1(page)).toHaveCount(1);
    const rows = main(page).getByRole("listitem");
    await expect(rows).toHaveCount(goods.length);
    for (const [index, item] of goods.entries()) {
      const row = rows.nth(index);
      await expect(row.getByRole("link", { name: item.name, exact: true })).toHaveAttribute(
        "href",
        `/goods/${item.goodsRef}`,
      );
      await expect(row).toContainText(item.shortDescription);
      await expect(row).toContainText(formatMoney(item.unitPrice));
    }
  });

  test("never lists the non-public goods", async ({ page }) => {
    await open(page);
    await expect(main(page).getByRole("listitem")).toHaveCount(6);
    await expect(main(page)).not.toContainText(MARKER.hiddenGoods);
    await expect(main(page).locator(`a[href$='${GOODS.hidden}']`)).toHaveCount(0);
  });

  test("selecting a goods item goes to its detail page", async ({ page }) => {
    const goods = expectedGoods();
    await open(page);
    await main(page)
      .getByRole("link", { name: goods[0]?.name ?? "", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/goods/${goods[0]?.goodsRef}$`));
  });
});

test.describe("TC-PG-GDS-001-612 out-of-period, suspended and sold-out goods are different states, each with a reason (SPEC-050 14.1, 31 item 6, 25)", () => {
  test("shows a distinct label and a reason for every sales state", async ({ page }) => {
    const goods = expectedGoods();
    await open(page);
    await expect(main(page).getByRole("listitem")).toHaveCount(goods.length);
    const name = (ref: string): string => goods.find((g) => g.goodsRef === ref)?.name ?? "";
    const label = copy.availability.label;
    const description = copy.availability.description;
    await expect(rowOf(page, name(GOODS.tshirt))).toContainText(label.ON_SALE);
    await expect(rowOf(page, name(GOODS.badge))).toContainText(label.SOLD_OUT);
    await expect(rowOf(page, name(GOODS.badge))).toContainText(description.SOLD_OUT);
    await expect(rowOf(page, name(GOODS.sticker))).toContainText(label.SALES_ENDED);
    await expect(rowOf(page, name(GOODS.sticker))).toContainText(description.SALES_ENDED);
    await expect(rowOf(page, name(GOODS.lanyard))).toContainText(label.SUSPENDED);
    await expect(rowOf(page, name(GOODS.lanyard))).toContainText(description.SUSPENDED);
    await expect(rowOf(page, name(GOODS.poster))).toContainText(label.BEFORE_SALES);
    const poster = goods.find((g) => g.goodsRef === GOODS.poster);
    expect(poster).toBeDefined();
    await expect(rowOf(page, name(GOODS.poster))).toContainText(
      formatJstDateTime(poster?.startsAt as UtcInstant),
    );
  });

  test("a row never shows another state's label (so the text alone tells them apart)", async ({
    page,
  }) => {
    const goods = expectedGoods();
    await open(page);
    await expect(main(page).getByRole("listitem")).toHaveCount(goods.length);
    const label = copy.availability.label;
    const cases = [
      [GOODS.badge, label.SOLD_OUT],
      [GOODS.sticker, label.SALES_ENDED],
      [GOODS.lanyard, label.SUSPENDED],
      [GOODS.poster, label.BEFORE_SALES],
      [GOODS.tshirt, label.ON_SALE],
    ] as const;
    const all = [
      label.SOLD_OUT,
      label.SALES_ENDED,
      label.SUSPENDED,
      label.BEFORE_SALES,
      label.ON_SALE,
    ];
    for (const [ref, own] of cases) {
      const name = goods.find((g) => g.goodsRef === ref)?.name ?? "";
      const text = await rowOf(page, name).innerText();
      expect(text).toContain(own);
      for (const other of all.filter((l) => l !== own)) {
        expect(text, `${name} must not show ${other}`).not.toContain(other);
      }
    }
  });
});

test.describe("TC-PG-GDS-001-613 the list has no direct purchase or Cart action (SPEC-050 14.1 Actions, 33)", () => {
  test("offers links to the detail page only", async ({ page }) => {
    await open(page);
    await expect(main(page).getByRole("listitem")).toHaveCount(6);
    await expect(main(page).getByRole("button")).toHaveCount(0);
    await expect(main(page).locator("form, input, select")).toHaveCount(0);
    await expect(main(page)).not.toContainText(/カートに追加|今すぐ購入|購入手続き|購入する/);
  });
});

test.describe("TC-PG-GDS-001-614 empty is a successful zero; a failure is never shown as no products (SPEC-050 14.1, 9.2, 21, 31 item 2)", () => {
  test("a successful empty read says nothing is published", async ({ page }) => {
    await open(page, publicScenario({ publicFetch: "empty" }));
    await expect(h1(page)).toHaveText(copy.goods.list.heading);
    await expect(main(page)).toContainText(copy.pageState.empty);
    await expect(main(page).getByRole("listitem")).toHaveCount(0);
    await expect(main(page).getByRole("alert")).toHaveCount(0);
  });

  test("a failed read shows an error with a retry and no product, empty or zero wording", async ({
    page,
  }) => {
    await open(page, publicScenario({ publicFetch: "fail" }));
    await expect(h1(page)).toHaveText(copy.goods.list.heading);
    const alert = main(page).getByRole("alert");
    await expect(alert).toContainText(copy.pageState.unavailable(copy.goods.list.subject));
    await expect(
      alert.getByRole("button", { name: copy.pageState.retry, exact: true }),
    ).toBeVisible();
    await expect(main(page)).not.toContainText(copy.pageState.empty);
    await expect(main(page)).not.toContainText(/0件|売り切れ/);
    await expect(main(page).getByRole("listitem")).toHaveCount(0);
  });

  test("retry recovers when the read succeeds again", async ({ page }) => {
    await open(page, publicScenario({ publicFetch: "fail" }));
    await expect(main(page).getByRole("alert")).toBeVisible();
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [
      KEYS.scenario,
      scenarioJson(),
    ] as const);
    await main(page).getByRole("button", { name: copy.pageState.retry, exact: true }).click();
    await expect(main(page).getByRole("listitem")).toHaveCount(6);
    await expect(main(page).getByRole("alert")).toHaveCount(0);
  });

  test("loading shows a status, no product, no sold-out wording and no amounts", async ({
    page,
  }) => {
    await open(page, publicScenario({ latency: "long", latencyLongMs: 6000 }));
    await expect(h1(page)).toHaveText(copy.goods.list.heading);
    await expect(main(page).getByRole("status").first()).toContainText(copy.pageState.loading);
    await expect(main(page)).not.toContainText(LOADING_FORBIDDEN);
    await expect(main(page).getByRole("listitem")).toHaveCount(0);
    await expect(main(page).getByRole("listitem")).toHaveCount(6, { timeout: 20_000 });
  });
});

test.describe("TC-PG-GDS-001-615 the goods list is operable by keyboard (SPEC-050 25)", () => {
  test("Tab reaches a goods link and Enter opens its detail page", async ({ page }) => {
    const goods = expectedGoods();
    await open(page);
    await expect(main(page).getByRole("listitem")).toHaveCount(6);
    const link = main(page).getByRole("link", { name: goods[0]?.name ?? "", exact: true });
    let reached = false;
    for (let step = 0; step < 80 && !reached; step += 1) {
      await page.keyboard.press("Tab");
      reached = await link.evaluate((el) => el === document.activeElement);
    }
    expect(reached, "the first goods link must be reachable with Tab").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/goods/${goods[0]?.goodsRef}$`));
  });
});
