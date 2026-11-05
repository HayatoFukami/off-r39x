import { describe, expect, it } from "vitest";
import { cartLineKey } from "../../../../apps/web/src/api-client/cart-line-key.ts";
import type {
  CartLine,
  CartLineResolution,
  PurchaseEligibility,
  Ref,
  SaleAvailability,
  UtcInstant,
} from "../../../../apps/web/src/api-client/types.ts";
import { canProceed } from "../../../../apps/web/src/features/cart/can-proceed.ts";

// Contract: tests/contracts/s5-cart.md section 3.1 (SPEC-050 14A.1 Actions / Cart Itemの購入不可理由, 31 item 25,
// FR-CRT-005). Enabled only when there is at least one line and every line is shown as purchasable.

const OFFERING = "e0000000-0000-4000-8000-000000000001" as Ref<"offering">;
const OFFERING_2 = "e0000000-0000-4000-8000-000000000006" as Ref<"offering">;
const GOODS = "a0000000-0000-4000-8000-000000000001" as Ref<"goods">;

const entry = (quantity = 1, ref: Ref<"offering"> = OFFERING): CartLine => ({
  kind: "ENTRY_TICKET",
  offeringRef: ref,
  quantity,
});
const goods = (quantity = 1): CartLine => ({ kind: "GOODS", goodsRef: GOODS, quantity });

const resolved = (line: CartLine, availability: SaleAvailability): CartLineResolution => ({
  lineKey: cartLineKey(line),
  status: "resolved",
  name: "Item",
  unitPrice: { amount: "1000", currency: "JPY" },
  availability,
});
const onSale = (line: CartLine, max: number | null = null) =>
  resolved(line, { kind: "ON_SALE", maxSelectableQuantity: max });

const SOON = "2027-03-04T03:00:00Z" as UtcInstant;
const NOT_ON_SALE: readonly [string, SaleAvailability][] = [
  ["BEFORE_SALES", { kind: "BEFORE_SALES", startsAt: SOON }],
  ["SALES_ENDED", { kind: "SALES_ENDED" }],
  ["SUSPENDED", { kind: "SUSPENDED" }],
  ["SOLD_OUT", { kind: "SOLD_OUT" }],
  ["INSUFFICIENT_QUANTITY", { kind: "INSUFFICIENT_QUANTITY", maxSelectableQuantity: 2 }],
  ["PURCHASE_LIMIT_EXCEEDED", { kind: "PURCHASE_LIMIT_EXCEEDED" }],
];

describe("TC-PG-CRT-001-431 canProceed is enabled only for a non-empty Cart whose every line is on sale (SPEC-050 14A.1)", () => {
  it("is enabled for one on-sale line", () => {
    const line = entry(2);
    expect(canProceed([line], [onSale(line)])).toEqual({ canProceed: true });
  });

  it("is enabled for several on-sale lines of both kinds, in any resolution order", () => {
    const a = entry(1);
    const b = goods(3);
    expect(canProceed([a, b], [onSale(b, 20), onSale(a, 4)])).toEqual({ canProceed: true });
  });

  it("accepts an on-sale line whose maximum is not announced (null) and one whose maximum covers the quantity", () => {
    const line = goods(5);
    expect(canProceed([line], [onSale(line, null)])).toEqual({ canProceed: true });
    expect(canProceed([line], [onSale(line, 5)])).toEqual({ canProceed: true });
  });

  it("is disabled with an 'empty' reason for an empty Cart, whatever the resolutions are", () => {
    const expected = { canProceed: false, reasons: [{ kind: "empty" }] };
    expect(canProceed([], [])).toEqual(expected);
    expect(canProceed([], null)).toEqual(expected);
    expect(canProceed([], [onSale(entry())])).toEqual(expected);
  });

  it("treats an omitted eligibility like not_applicable (guest and unverified users: public conditions only)", () => {
    const a = entry(1);
    const b = goods(1);
    const blocked = resolved(b, { kind: "SOLD_OUT" });
    for (const resolutions of [[onSale(a), onSale(b)], [onSale(a), blocked], null]) {
      expect(canProceed([a, b], resolutions, { kind: "not_applicable" })).toEqual(
        canProceed([a, b], resolutions),
      );
    }
  });

  it("is disabled with an 'unresolved' reason when the resolutions were not obtained (loading or failure)", () => {
    expect(canProceed([entry()], null)).toEqual({
      canProceed: false,
      reasons: [{ kind: "unresolved" }],
    });
    expect(canProceed([entry(), goods()], null)).toEqual({
      canProceed: false,
      reasons: [{ kind: "unresolved" }],
    });
  });
});

describe("TC-PG-CRT-001-432 every unavailable reason of a line disables the button and names the line (SPEC-050 14A.1, FR-CRT-005, 31 item 25)", () => {
  it.each(NOT_ON_SALE)("a %s line blocks the whole Cart", (reason, availability) => {
    const line = entry(1);
    expect(canProceed([line], [resolved(line, availability)])).toEqual({
      canProceed: false,
      reasons: [{ kind: "line", lineKey: cartLineKey(line), reason }],
    });
  });

  it("blocks a not-public line", () => {
    const line = goods(1);
    expect(canProceed([line], [{ lineKey: cartLineKey(line), status: "not_public" }])).toEqual({
      canProceed: false,
      reasons: [{ kind: "line", lineKey: cartLineKey(line), reason: "not_public" }],
    });
  });

  it("blocks a line whose state could not be obtained, and never treats it as purchasable", () => {
    const line = goods(1);
    expect(canProceed([line], [{ lineKey: cartLineKey(line), status: "unavailable" }])).toEqual({
      canProceed: false,
      reasons: [{ kind: "line", lineKey: cartLineKey(line), reason: "unavailable" }],
    });
  });

  it("blocks a line that has no resolution at all (treated as unknown, not as purchasable)", () => {
    const a = entry(1);
    const b = goods(1);
    expect(canProceed([a, b], [onSale(a)])).toEqual({
      canProceed: false,
      reasons: [{ kind: "line", lineKey: cartLineKey(b), reason: "unavailable" }],
    });
  });

  it("lists one reason per blocked line in Cart order while on-sale lines add none", () => {
    const a = entry(1);
    const b = goods(1);
    const c = entry(3, OFFERING_2);
    const result = canProceed(
      [a, b, c],
      [
        resolved(c, { kind: "PURCHASE_LIMIT_EXCEEDED" }),
        onSale(a),
        resolved(b, { kind: "SOLD_OUT" }),
      ],
    );
    expect(result).toEqual({
      canProceed: false,
      reasons: [
        { kind: "line", lineKey: cartLineKey(b), reason: "SOLD_OUT" },
        { kind: "line", lineKey: cartLineKey(c), reason: "PURCHASE_LIMIT_EXCEEDED" },
      ],
    });
  });

  it("defends against an on-sale answer whose maximum is below the line quantity", () => {
    const line = goods(5);
    expect(canProceed([line], [onSale(line, 3)])).toEqual({
      canProceed: false,
      reasons: [{ kind: "line", lineKey: cartLineKey(line), reason: "INSUFFICIENT_QUANTITY" }],
    });
  });

  it("ignores a resolution that belongs to no line of the Cart", () => {
    const line = entry(1);
    const stray = onSale(goods(1));
    expect(canProceed([line], [onSale(line), stray])).toEqual({ canProceed: true });
    expect(canProceed([line], [stray])).toEqual({
      canProceed: false,
      reasons: [{ kind: "line", lineKey: cartLineKey(line), reason: "unavailable" }],
    });
  });

  it("does not mutate its inputs", () => {
    const line = entry(1);
    const lines = Object.freeze([Object.freeze(line)]);
    const resolutions = Object.freeze([Object.freeze(onSale(line))]);
    expect(canProceed(lines, resolutions)).toEqual({ canProceed: true });
  });
});

describe("TC-PG-CRT-001-433 canProceed also requires the owner-scoped eligibility of every purchasable line (API-PUR-ELG-001, SPEC-050 12.1 / 14A.1, FR-CRT-005)", () => {
  const eligible = (
    line: CartLine,
    patch: Partial<PurchaseEligibility> = {},
  ): PurchaseEligibility => ({
    lineKey: cartLineKey(line),
    purchasable: true,
    reasons: [],
    maxPurchasableQuantity: 10,
    ...patch,
  });
  const ok = (...data: PurchaseEligibility[]) => ({ kind: "ok", data }) as const;

  it.each([["loading"], ["unavailable"]] as const)(
    "a purchasable line is not purchasable while the eligibility is %s: one 'unresolved' reason, never enabled",
    (kind) => {
      const a = entry(1);
      const b = goods(2);
      const result = canProceed([a, b], [onSale(a), onSale(b)], { kind });
      expect(result.canProceed).toBe(false);
      if (result.canProceed) return;
      expect(result.reasons).toEqual([{ kind: "unresolved" }]);
    },
  );

  it("counts 'unresolved' once even when several lines wait for the eligibility", () => {
    const lines = [entry(1), goods(1), entry(1, OFFERING_2)];
    const resolutions = lines.map((line) => onSale(line));
    const result = canProceed(lines, resolutions, { kind: "unavailable" });
    if (result.canProceed) throw new Error("expected a blocked decision");
    expect(result.reasons.filter((reason) => reason.kind === "unresolved")).toHaveLength(1);
    expect(result.reasons.filter((reason) => reason.kind === "line")).toHaveLength(0);
  });

  it("enables proceeding when the eligibility says purchasable for every line", () => {
    const a = entry(2);
    const b = goods(3);
    expect(canProceed([a, b], [onSale(a, 4), onSale(b, 20)], ok(eligible(a), eligible(b)))).toEqual(
      { canProceed: true },
    );
  });

  it("names the first reason of a line the eligibility refuses, per line, in Cart order", () => {
    const a = entry(1);
    const b = goods(1);
    const c = entry(1, OFFERING_2);
    const result = canProceed(
      [a, b, c],
      [onSale(a), onSale(b), onSale(c)],
      ok(
        eligible(c, {
          purchasable: false,
          reasons: ["INSUFFICIENT_QUANTITY", "PURCHASE_LIMIT_EXCEEDED"],
          maxPurchasableQuantity: 0,
        }),
        eligible(a),
        eligible(b, {
          purchasable: false,
          reasons: ["PURCHASE_LIMIT_EXCEEDED"],
          maxPurchasableQuantity: 0,
        }),
      ),
    );
    expect(result).toEqual({
      canProceed: false,
      reasons: [
        { kind: "line", lineKey: cartLineKey(b), reason: "PURCHASE_LIMIT_EXCEEDED" },
        { kind: "line", lineKey: cartLineKey(c), reason: "INSUFFICIENT_QUANTITY" },
      ],
    });
  });

  it("treats a purchasable line without an eligibility entry as unknown, never as purchasable", () => {
    const a = entry(1);
    const b = goods(1);
    const result = canProceed([a, b], [onSale(a), onSale(b)], ok(eligible(a)));
    expect(result).toEqual({
      canProceed: false,
      reasons: [{ kind: "line", lineKey: cartLineKey(b), reason: "unavailable" }],
    });
  });

  it("defends against a purchasable answer whose maximum is below the line quantity", () => {
    const line = goods(5);
    const result = canProceed(
      [line],
      [onSale(line)],
      ok(eligible(line, { maxPurchasableQuantity: 3 })),
    );
    expect(result).toEqual({
      canProceed: false,
      reasons: [{ kind: "line", lineKey: cartLineKey(line), reason: "INSUFFICIENT_QUANTITY" }],
    });
  });

  it("keeps the public reason of a line that is not purchasable on the public conditions, whatever the eligibility says", () => {
    const sold = entry(1);
    const fine = goods(1);
    const resolutions = [resolved(sold, { kind: "SOLD_OUT" }), onSale(fine)];
    for (const eligibility of [
      { kind: "loading" },
      { kind: "unavailable" },
      ok(eligible(sold), eligible(fine)),
    ] as const) {
      const result = canProceed([sold, fine], resolutions, eligibility);
      if (result.canProceed) throw new Error("expected a blocked decision");
      expect(
        result.reasons.filter(
          (reason) => reason.kind === "line" && reason.lineKey === cartLineKey(sold),
        ),
        eligibility.kind,
      ).toEqual([{ kind: "line", lineKey: cartLineKey(sold), reason: "SOLD_OUT" }]);
    }
  });

  it("does not mutate its inputs", () => {
    const line = entry(1);
    const lines = Object.freeze([Object.freeze(line)]);
    const resolutions = Object.freeze([Object.freeze(onSale(line))]);
    const data = Object.freeze([Object.freeze(eligible(line))]);
    expect(canProceed(lines, resolutions, { kind: "ok", data })).toEqual({ canProceed: true });
  });
});
