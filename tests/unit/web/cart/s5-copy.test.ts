import { describe, expect, it } from "vitest";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { stringLeaves } from "../../../harness/presentation.ts";

// Contract: tests/contracts/s5-cart.md section 1 (SPEC-050 12.1, 14.2, 14A.1, 24.3, 25).

describe("TC-PG-CRT-001-451 copy carries the SPEC-050 fixed Cart wording", () => {
  it("has the Cart add / result / view wording of 12.1 and 14.2 literally", () => {
    expect(copy.sales.add).toBe("Cartに追加");
    expect(copy.sales.addSucceeded).toBe("Cartに追加しました。購入はまだ確定していません");
    expect(copy.sales.viewCart).toBe("Cartを見る");
  });

  it("has the Cart page wording of 14A.1 literally", () => {
    expect(copy.cart.empty).toBe("カートは空です");
    expect(copy.cart.proceed.label).toBe("購入手続きへ進む");
    expect(copy.cart.corrupted.title).toBe("カートを読み込めません");
    expect(copy.cart.heading).toBe("カート");
    expect(copy.cart.summary.recalcNote).toBe("購入時の金額はサーバーで再計算されます");
    expect(copy.sales.displayTotalNote).toBe("購入時の金額はサーバーで再計算されます");
    expect(copy.quantity.label).toBe("数量");
  });

  it("keeps the S5 page titles out of copy.pageTitle (S4 pins that object) and names the three pages", () => {
    expect(Object.keys(copy.pageTitle).sort()).toEqual(
      [
        "announcementDetail",
        "announcements",
        "goods",
        "karaoke",
        "karaokeDay",
        "karaokeSlot",
      ].sort(),
    );
    expect(copy.entry.pageTitle).toBe("Entry Ticket");
    expect(copy.cart.pageTitle).toBe("カート");
    expect(copy.goods.detail.pageTitle).toBe("Goods詳細");
    expect(copy.entry.heading).toBe("Entry Ticket");
    expect(copy.goods.detail.heading).toBe("Goods詳細");
  });

  it("says that Karaoke cannot be put in the Cart and is a separate purchase and payment", () => {
    const body = copy.cart.karaoke.body;
    expect(body).toContain("カート");
    expect(body).toContain("別");
    expect(body).toContain("支払");
    expect(body).not.toMatch(/追加できます|カートに入れられます/);
    expect(copy.cart.karaoke.link).toContain("Karaoke");
  });

  it("says that Entry Ticket and Goods are paid together", () => {
    expect(copy.cart.summary.onePayment).toContain("1回の支払い");
  });

  it("separates the two reasons that disable proceeding and gives a way out for a blocked line", () => {
    expect(copy.cart.proceed.blocked).not.toBe(copy.cart.proceed.unknown);
    expect(copy.cart.proceed.blocked).toMatch(/削除/);
    expect(copy.cart.proceed.blocked).toMatch(/数量/);
    expect(copy.cart.proceed.unknown.length).toBeGreaterThan(0);
  });

  it("explains a damaged Cart without calling it empty and offers an explicit reset", () => {
    expect(copy.cart.corrupted.description).not.toBe("");
    expect(copy.cart.corrupted.description).toMatch(/空/);
    expect(copy.cart.corrupted.reset).toContain("リセット");
    expect(copy.cart.corrupted.title).not.toContain(copy.cart.empty);
  });

  it("has no amount, number or price in the unknown-total wording and the recalculation note", () => {
    expect(copy.cart.summary.totalUnknown).not.toMatch(/[0-9０-９¥￥円]/);
    expect(copy.cart.summary.recalcNote).not.toMatch(/[0-9０-９¥￥円]/);
  });

  it("builds quantity guidance and errors with the maximum", () => {
    expect(copy.quantity.guidance(4)).toContain("4");
    expect(copy.quantity.guidance(20)).toContain("20");
    expect(copy.quantity.exceedsMax(3)).toContain("3");
    expect(copy.quantity.exceedsMax(3)).not.toBe(copy.quantity.invalid);
    expect(copy.quantity.invalid).toContain("1以上");
  });

  it("states the per-account purchase limit with its number", () => {
    expect(copy.entry.perAccountLimit(2)).toContain("2");
    expect(copy.entry.perAccountLimit(4)).toContain("4");
    expect(copy.entry.perAccountLimit(2)).not.toBe(copy.entry.perAccountLimit(4));
  });

  it("states the venue pickup without any shipping field wording (SPEC-050 14.2)", () => {
    expect(copy.goods.detail.pickupNotice).toContain("会場");
    expect(copy.goods.detail.pickupNotice).not.toMatch(/配送先|住所|配送業者|配送追跡|お届け/);
  });

  it("never words a failed add as a success", () => {
    expect(copy.sales.addFailed).not.toContain("追加しました");
    expect(copy.sales.addFailed.length).toBeGreaterThan(0);
  });

  it("has only trimmed, non-empty leaves in the S5 groups", () => {
    for (const group of [copy.cart, copy.quantity, copy.sales, copy.entry, copy.goods.detail]) {
      for (const leaf of stringLeaves(group)) {
        expect(leaf.length, leaf).toBeGreaterThan(0);
        expect(leaf, leaf).toBe(leaf.trim());
      }
    }
  });
});
