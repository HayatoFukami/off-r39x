import { describe, expect, it } from "vitest";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { stringLeaves } from "../../../harness/presentation.ts";

// Contract: tests/contracts/s7b-karaoke.md section 2 (SPEC-050 13.3, 20.3, 25, 33 / design section 4 and 6).

const detail = copy.karaoke.slotDetail;

describe("TC-PG-KRK-003-601 the Karaoke slot detail copy is the contracted wording (SPEC-050 13.3)", () => {
  it("has the page title, headings and labels literally", () => {
    expect(copy.pageTitle.karaokeSlot).toBe("Karaoke枠の詳細");
    expect(detail.heading).toBe("Karaoke 枠の詳細");
    expect(detail.subject).toBe("Karaoke枠の情報");
    expect(detail.infoHeading).toBe("枠の情報");
    expect(detail.actionHeading).toBe("購入手続き");
    expect(detail.dateLabel).toBe("対象日");
    expect(detail.timeLabel).toBe("利用時刻");
    expect(detail.stateLabel).toBe("この枠の状態");
    expect(detail.purchasableLabel).toBe("予約購入可能");
  });

  it("has the action wording literally", () => {
    expect(detail.proceed).toBe("購入手続きへ進む");
    expect(detail.proceedGuest).toBe("ログインして購入手続きへ");
    expect(detail.backToDay).toBe("空き状況へ戻る");
    expect(detail.chooseAgain).toBe("空き状況から選び直す");
  });

  it("has the SPEC-050 13.3 purchase-start wording (hold in progress, conflict, expired) literally", () => {
    expect(detail.holding).toBe("枠を確保しています");
    expect(detail.failure.conflict).toBe("他の利用者が先に確保したため購入を開始できません");
    expect(detail.failure.expired).toBe("枠の確保期限が切れたため選び直してください");
  });

  it("has the remaining failure and disabled-reason wording literally", () => {
    expect(detail.failure.limit).toBe("購入上限に達しているため、この枠の購入を開始できません");
    expect(detail.failure.notOnSale).toBe(
      "現在は販売期間外または販売停止中のため、購入を開始できません",
    );
    expect(detail.failure.unavailable).toBe(
      "枠の購入条件を確認できませんでした。時間をおいて、もう一度お試しください",
    );
    expect(detail.disabledReason.HELD).toContain("他の購入試行で確保中");
    expect(detail.disabledReason.SOLD).toContain("販売済み");
    expect(detail.disabledReason.SALES_STOPPED).toContain("販売停止");
    expect(detail.disabledReason.NOT_ON_SALE).toContain("販売期間外");
    expect(detail.notPurchasableLabel).toBe("現在購入不可");
    expect(detail.notPurchasableDescription).toBe("この枠は現在購入できません。");
    expect(detail.disabledReason.NOT_PURCHASABLE).toBe(
      "現在この枠は購入できないため、購入手続きへ進めません。空き状況から別の枠を選んでください。",
    );
    expect(detail.separateNote).toBe(
      "Karaokeの購入はカートを使いません。Entry TicketやGoodsとは別の購入、別の支払いになります。",
    );
  });

  it("every leaf is a trimmed non-empty string", () => {
    const leaves = stringLeaves(detail);
    expect(leaves.length).toBeGreaterThan(15);
    for (const leaf of leaves) {
      expect(leaf.trim(), leaf).toBe(leaf);
      expect(leaf.length, leaf).toBeGreaterThan(0);
    }
  });
});

describe("TC-PG-KRK-003-602 no copy fragment contains another, so negative assertions cannot misfire (lesson of S7a)", () => {
  const group: [string, string][] = [
    ["disabledReason.HELD", detail.disabledReason.HELD],
    ["disabledReason.SOLD", detail.disabledReason.SOLD],
    ["disabledReason.SALES_STOPPED", detail.disabledReason.SALES_STOPPED],
    ["disabledReason.NOT_ON_SALE", detail.disabledReason.NOT_ON_SALE],
    ["disabledReason.NOT_PURCHASABLE", detail.disabledReason.NOT_PURCHASABLE],
    ["notPurchasableDescription", detail.notPurchasableDescription],
    ["failure.conflict", detail.failure.conflict],
    ["failure.limit", detail.failure.limit],
    ["failure.notOnSale", detail.failure.notOnSale],
    ["failure.expired", detail.failure.expired],
    ["failure.unavailable", detail.failure.unavailable],
    ["holding", detail.holding],
    ["purchasableDescription", detail.purchasableDescription],
  ];

  it("no member of the group contains another member", () => {
    for (const [nameA, a] of group) {
      for (const [nameB, b] of group) {
        if (nameA === nameB) continue;
        expect(a.includes(b), `${nameA} contains ${nameB}`).toBe(false);
      }
    }
  });

  it("the not-purchasable label is not part of any group member and does not contain the purchasable label", () => {
    for (const [name, text] of group)
      expect(text.includes(detail.notPurchasableLabel), name).toBe(false);
    expect(detail.notPurchasableLabel.includes(detail.purchasableLabel)).toBe(false);
  });

  it("the purchasable label is not part of any group member, nor of the day-page slot labels", () => {
    for (const [name, text] of group)
      expect(text.includes(detail.purchasableLabel), name).toBe(false);
    for (const label of Object.values(copy.karaoke.slot.label)) {
      expect(label.includes(detail.purchasableLabel), label).toBe(false);
    }
  });

  it("the preparing wording shared with Purchase Status is not contained in the group either", () => {
    for (const [name, text] of group) {
      expect(text.includes(copy.purchase.checkoutPreparing), name).toBe(false);
      expect(copy.purchase.checkoutPreparing.includes(text), name).toBe(false);
    }
  });
});

describe("TC-PG-KRK-003-603 the slot detail copy carries no hold duration and no cancellation wording (SPEC-050 13.3 last paragraph, 33)", () => {
  it("has no number of minutes or seconds in any leaf", () => {
    for (const leaf of stringLeaves(detail)) {
      expect(leaf, leaf).not.toMatch(/[0-9０-９]+\s*(分|秒)/);
      expect(leaf, leaf).not.toMatch(/残り|カウントダウン/);
    }
  });

  it("never says that a reservation was cancelled", () => {
    for (const leaf of stringLeaves(detail))
      expect(leaf, leaf).not.toMatch(/取り消されました|取消されました|キャンセルされました/);
  });
});
