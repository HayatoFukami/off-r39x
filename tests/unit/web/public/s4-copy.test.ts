import { describe, expect, it } from "vitest";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { stringLeaves } from "../../../harness/presentation.ts";

// Contract: tests/contracts/s4-public.md section 1 (SPEC-050 9, 11.1, 13.1, 13.2, 14.1, 21).

describe("TC-PG-PUB-001-611 copy carries the SPEC-050 fixed public wording", () => {
  it("has the loading / empty / unavailable / retry wording", () => {
    expect(copy.pageState.loading).toBe("読み込み中です");
    expect(copy.pageState.empty).toBe("現在公開中の情報はありません");
    expect(copy.pageState.unavailable("FAQ")).toBe("FAQを取得できません");
    expect(copy.pageState.retry).toBe("再読み込み");
  });

  it("names the page titles, headings and Home sections", () => {
    expect(copy.pageTitle).toEqual({
      announcements: "お知らせ",
      announcementDetail: "お知らせ詳細",
      karaoke: "Karaoke販売案内",
      karaokeDay: "Karaoke空き状況",
      goods: "Goods",
    });
    expect(copy.home.sections).toEqual({
      news: "お知らせ",
      salesShortcut: "販売のご案内",
      overview: "Event概要",
      schedule: "開催日時",
      venue: "会場・アクセス",
      notices: "注意事項",
      faq: "FAQ",
    });
    expect(copy.home.news.viewAll).toBe("すべて見る");
    expect(copy.home.shortcut).toEqual({
      entry: "Entry Ticketを見る",
      karaoke: "Karaokeを見る",
      goods: "Goodsを見る",
    });
    expect(copy.home.fallbackHeading).toBe("Event Home");
    expect(copy.announcements.heading).toBe("お知らせ");
    expect(copy.goods.list.heading).toBe("Goods");
  });

  it("uses the SPEC-050 13.2 literals for the day schedule", () => {
    expect(copy.karaoke.day.empty).toBe("この日に販売対象の枠はありません");
    expect(copy.karaoke.day.unavailable).toBe("空き状況を取得できません");
    expect(copy.karaoke.day.bucketCount(1, 3)).toBe("空き 1 / 全 3 枠");
    expect(copy.karaoke.day.bucketCount(0, 1)).toBe("空き 0 / 全 1 枠");
    expect(copy.karaoke.day.slotLink("10:00-10:15")).toBe("10:00-10:15の枠を選ぶ");
  });

  it("states the Karaoke guide facts without inventing numbers", () => {
    expect(copy.karaoke.guide.duration).toContain("15分");
    expect(copy.karaoke.guide.duration).toContain("5分");
    expect(copy.karaoke.guide.purchaseLimit).not.toMatch(/[0-9０-９]/);
    expect(copy.karaoke.guide.datesEmpty).toBe("現在、販売対象日はありません");
    expect(copy.karaoke.guide.dateLink("2027/03/08(月)")).toBe("2027/03/08(月)の空き状況を見る");
  });

  it("has four distinct sale status descriptions and never claims a cancellation", () => {
    const descriptions = copy.karaoke.saleStatus.description;
    const values = [
      descriptions.ON_SALE,
      descriptions.BEFORE_SALES,
      descriptions.SALES_ENDED,
      descriptions.SUSPENDED,
    ];
    expect(new Set(values).size).toBe(4);
    for (const text of values)
      expect(text).not.toMatch(/(取り消|取消|キャンセル)(されました|しました)/);
    // The suspended note keeps existing reservations intact (SPEC-050 13.1).
    expect(descriptions.SUSPENDED).toMatch(
      /(取り消|取消|キャンセル)(されません|されない|はありません)|影響/,
    );
  });

  it("keeps the dictionary free of English placeholder text and brand material", () => {
    for (const text of stringLeaves(copy)) {
      expect(text.toLowerCase()).not.toContain("lorem");
      expect(text).not.toContain("未設定");
    }
  });
});
