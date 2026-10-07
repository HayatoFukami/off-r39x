import {
  GOODS_HANDOFF_STATES,
  GOODS_ITEM_STATES,
  type GoodsHandoffState,
  type GoodsItemState,
} from "@off-r39x/domain";
import { describe, expect, it } from "vitest";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { presentGoodsItem } from "../../../../apps/web/src/presentation/state-mapping/goods.ts";
import { stringLeaves, TONES } from "../../../harness/presentation.ts";

// Hardcoded from SPEC-050 section 20.4 / 18.11 / 18.12.
const ITEM_LABELS: Record<GoodsItemState, string> = {
  PENDING_PAYMENT: "支払未確定・受け取り不可",
  FULFILLABLE: "支払確定済み",
  CANCELED: "取消済み・受け取り不可",
};
const HANDOFF_LABELS: Record<GoodsHandoffState, string> = {
  PENDING: "未受け渡し",
  COMPLETED: "受け渡し済み",
  VOID: "受け渡し対象外",
};

// Precedence from the contract: CANCELED / VOID > PENDING_PAYMENT > COMPLETED > PENDING.
function expectedMain(item: GoodsItemState, handoff: GoodsHandoffState) {
  if (item === "CANCELED" || handoff === "VOID") {
    return { label: "取消済み・受け取り不可", receivable: false };
  }
  if (item === "PENDING_PAYMENT") return { label: "支払未確定・受け取り不可", receivable: false };
  if (handoff === "COMPLETED") return { label: "受け渡し済み", receivable: false };
  return { label: "会場受け取り待ち", receivable: true };
}

const combinations = GOODS_ITEM_STATES.flatMap((i) =>
  GOODS_HANDOFF_STATES.map((h) => [i, h] as const),
);

describe("TC-PG-MYP-012-001 presentGoodsItem (SPEC-050 18.11 / 18.12 / 20.4, INV-010-07)", () => {
  it("covers all 9 item x handoff combinations", () => {
    expect(combinations).toHaveLength(9);
  });

  it.each(combinations)("Item %s + Handoff %s", (item, handoff) => {
    const presented = presentGoodsItem(item, handoff);
    const expected = expectedMain(item, handoff);
    expect(presented.label).toBe(expected.label);
    expect(presented.receivable).toBe(expected.receivable);
    expect(presented.itemLabel).toBe(ITEM_LABELS[item]);
    expect(presented.handoffLabel).toBe(HANDOFF_LABELS[handoff]);
    expect(presented.description.length).toBeGreaterThan(0);
    expect(TONES).toContain(presented.tone);
  });

  it("is receivable only for FULFILLABLE + PENDING", () => {
    const receivable = combinations.filter(([i, h]) => presentGoodsItem(i, h).receivable);
    expect(receivable).toEqual([["FULFILLABLE", "PENDING"]]);
  });

  it("never lets an unpaid or canceled item look receivable or successful", () => {
    for (const handoff of GOODS_HANDOFF_STATES) {
      for (const item of ["PENDING_PAYMENT", "CANCELED"] as const) {
        const presented = presentGoodsItem(item, handoff);
        expect(presented.receivable, `${item}/${handoff}`).toBe(false);
        expect(presented.tone, `${item}/${handoff}`).not.toBe("success");
      }
    }
  });

  it("keeps the 4 main labels distinct and dictionary-backed", () => {
    const dictionary = new Set(stringLeaves(copy));
    const labels = new Set(combinations.map(([i, h]) => presentGoodsItem(i, h).label));
    expect(labels.size).toBe(4);
    for (const [i, h] of combinations) {
      const presented = presentGoodsItem(i, h);
      for (const text of [
        presented.label,
        presented.itemLabel,
        presented.handoffLabel,
        presented.description,
      ]) {
        expect(dictionary.has(text), `${i}/${h}: ${text}`).toBe(true);
      }
    }
  });

  it("fails closed when either argument is unknown, whatever the other is", () => {
    for (const handoff of GOODS_HANDOFF_STATES) {
      expect(() => presentGoodsItem("SHIPPED" as GoodsItemState, handoff)).toThrow(
        /Unexpected value/,
      );
    }
    for (const item of GOODS_ITEM_STATES) {
      expect(() => presentGoodsItem(item, "RETURNED" as GoodsHandoffState)).toThrow(
        /Unexpected value/,
      );
    }
  });
});
