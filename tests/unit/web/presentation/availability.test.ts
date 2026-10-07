import { describe, expect, it } from "vitest";
import type { SaleAvailability } from "../../../../apps/web/src/api-client/types.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import {
  type AvailabilityInput,
  type CartRejectionReason,
  presentAvailability,
  presentRejectionReason,
} from "../../../../apps/web/src/presentation/state-mapping/availability.ts";
import { stringLeaves, TONES, utc } from "../../../harness/presentation.ts";

// 09:30 JST on 2027-01-15 is 00:30Z.
const startsAt = utc("2027-01-15T00:30:00Z");

const INPUTS: readonly [string, AvailabilityInput, string, boolean][] = [
  ["ON_SALE", { kind: "ON_SALE", maxSelectableQuantity: 4 }, "販売中", true],
  ["BEFORE_SALES", { kind: "BEFORE_SALES", startsAt }, "販売開始前", false],
  ["SALES_ENDED", { kind: "SALES_ENDED" }, "販売終了", false],
  ["SUSPENDED", { kind: "SUSPENDED" }, "販売停止", false],
  ["SOLD_OUT", { kind: "SOLD_OUT" }, "売り切れ", false],
  [
    "INSUFFICIENT_QUANTITY",
    { kind: "INSUFFICIENT_QUANTITY", maxSelectableQuantity: 3 },
    "数量不足",
    false,
  ],
  ["PURCHASE_LIMIT_EXCEEDED", { kind: "PURCHASE_LIMIT_EXCEEDED" }, "購入上限により購入不可", false],
  ["not_public", { kind: "not_public" }, "現在取り扱っていません", false],
];

const dictionary = new Set(stringLeaves(copy));

describe("TC-PG-CRT-001-001 presentAvailability (SPEC-050 10 / 14, FR-CRT-005)", () => {
  it.each(INPUTS)("%s uses the SPEC-050 label and purchasability", (_name, input, label, ok) => {
    const presented = presentAvailability(input);
    expect(presented.label).toBe(label);
    expect(presented.purchasable).toBe(ok);
    expect(presented.description.length).toBeGreaterThan(0);
    expect(TONES).toContain(presented.tone);
    expect(dictionary.has(presented.label)).toBe(true);
  });

  it("states that the status cannot be confirmed for unavailable, without implying it can be bought", () => {
    const presented = presentAvailability({ kind: "unavailable" });
    expect(presented.label).toContain("状態を確認");
    expect(presented.purchasable).toBe(false);
    expect(presented.tone).not.toBe("success");
    expect(presented.description).not.toContain("購入できます");
    expect(dictionary.has(presented.label)).toBe(true);
  });

  it("keeps all 9 outcomes (ON_SALE, 6 reasons, not_public, unavailable) distinct", () => {
    const inputs: AvailabilityInput[] = [
      ...INPUTS.map(([, input]) => input),
      { kind: "unavailable" },
    ];
    const labels = inputs.map((i) => presentAvailability(i).label);
    expect(labels).toHaveLength(9);
    expect(new Set(labels).size).toBe(9);
    // 7 Cart reasons of SPEC-050 section 14 = 6 non-ON_SALE kinds + unavailable; all distinct from each other.
    const reasons = labels.filter((l) => l !== "販売中");
    expect(new Set(reasons).size).toBe(8);
  });

  it("is purchasable only for ON_SALE and shows success only there", () => {
    const inputs: AvailabilityInput[] = [
      ...INPUTS.map(([, input]) => input),
      { kind: "unavailable" },
    ];
    const purchasable = inputs.filter((i) => presentAvailability(i).purchasable);
    expect(purchasable.map((i) => i.kind)).toEqual(["ON_SALE"]);
    for (const input of inputs) {
      const tone = presentAvailability(input).tone;
      if (input.kind === "ON_SALE") expect(tone).toBe("success");
      else expect(tone, input.kind).not.toBe("success");
    }
  });

  it("includes the configured start date-time (JST) for BEFORE_SALES", () => {
    expect(presentAvailability({ kind: "BEFORE_SALES", startsAt }).description).toContain(
      "2027/01/15 09:30",
    );
  });

  it("includes the selectable quantity and asks to change the quantity for INSUFFICIENT_QUANTITY", () => {
    const presented = presentAvailability({
      kind: "INSUFFICIENT_QUANTITY",
      maxSelectableQuantity: 3,
    });
    expect(presented.description).toContain("数量");
    expect(presented.description).toContain("3");
  });

  it("takes static descriptions from the copy dictionary", () => {
    for (const [name, input] of INPUTS) {
      if (name === "BEFORE_SALES" || name === "INSUFFICIENT_QUANTITY") continue;
      expect(dictionary.has(presentAvailability(input).description), name).toBe(true);
    }
  });

  it("fails closed on an unknown kind", () => {
    expect(() => presentAvailability({ kind: "RESERVED" } as unknown as SaleAvailability)).toThrow(
      /Unexpected value/,
    );
  });
});

describe("TC-PG-CRT-001-002 presentRejectionReason (SPEC-050 14 purchase start result)", () => {
  const REASONS: readonly CartRejectionReason[] = [
    "BEFORE_SALES",
    "SALES_ENDED",
    "SUSPENDED",
    "SOLD_OUT",
    "INSUFFICIENT_QUANTITY",
    "PURCHASE_LIMIT_EXCEEDED",
    "ALLOCATION_CONFLICT",
    "NOT_PUBLIC",
  ];

  it("shows 8 distinct, non-empty, dictionary-backed reasons", () => {
    const presented = REASONS.map((r) => presentRejectionReason(r));
    expect(new Set(presented.map((p) => p.label)).size).toBe(8);
    for (const p of presented) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(dictionary.has(p.label), p.label).toBe(true);
      expect(dictionary.has(p.description), p.description).toBe(true);
    }
  });

  it("reuses the availability labels for the shared reasons", () => {
    const pairs: [CartRejectionReason, AvailabilityInput][] = [
      ["BEFORE_SALES", { kind: "BEFORE_SALES", startsAt }],
      ["SALES_ENDED", { kind: "SALES_ENDED" }],
      ["SUSPENDED", { kind: "SUSPENDED" }],
      ["SOLD_OUT", { kind: "SOLD_OUT" }],
      ["INSUFFICIENT_QUANTITY", { kind: "INSUFFICIENT_QUANTITY", maxSelectableQuantity: 1 }],
      ["PURCHASE_LIMIT_EXCEEDED", { kind: "PURCHASE_LIMIT_EXCEEDED" }],
      ["NOT_PUBLIC", { kind: "not_public" }],
    ];
    for (const [reason, input] of pairs) {
      expect(presentRejectionReason(reason).label, reason).toBe(presentAvailability(input).label);
    }
  });

  it("names the allocation conflict separately", () => {
    expect(presentRejectionReason("ALLOCATION_CONFLICT").label).toContain("確保");
  });

  it("fails closed on an unknown reason", () => {
    expect(() => presentRejectionReason("TOO_HEAVY" as CartRejectionReason)).toThrow(
      /Unexpected value/,
    );
  });
});
