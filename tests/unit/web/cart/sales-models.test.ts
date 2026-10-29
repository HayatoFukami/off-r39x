import { describe, expect, it } from "vitest";
import { cartLineKey } from "../../../../apps/web/src/api-client/cart-line-key.ts";
import type {
  EntryOffering,
  GoodsDetail,
  PurchaseEligibility,
  Ref,
  SaleAvailability,
  UtcInstant,
} from "../../../../apps/web/src/api-client/types.ts";
import { buildEntryModel } from "../../../../apps/web/src/features/entry/entry-model.ts";
import {
  buildGoodsDetailModel,
  buildGoodsDetailModel as buildGoodsDetailModelWithEligibility,
  type GoodsDetailModel,
  goodsEligibilityTarget,
} from "../../../../apps/web/src/features/goods/goods-detail-model.ts";
import { parseGoodsRef } from "../../../../apps/web/src/features/public/route-params.ts";
import type { EligibilityInput } from "../../../../apps/web/src/features/purchase/eligibility-model.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { formatJstDateTime } from "../../../../apps/web/src/presentation/format/datetime.ts";
import {
  presentAvailability,
  presentPurchaseReasons,
} from "../../../../apps/web/src/presentation/state-mapping/availability.ts";

// Contract: tests/contracts/s5-cart.md sections 4.1 - 4.3 (SPEC-050 12.1 state table, 14.2 state table, 9, 21,
// 31 items 4 and 6). Pure view models of the Entry sales page and the Goods detail page.

const t = (value: string) => value as UtcInstant;
const STARTS = t("2027-02-01T03:00:00Z");
const ENDS = t("2027-04-30T14:59:59Z"); // 2027-04-30 23:59:59 JST
const SOON = t("2027-03-04T03:00:00Z");

const offering = (
  n: number,
  availability: SaleAvailability,
  perAccountLimit: number | null = null,
): EntryOffering => ({
  offeringRef: `e0000000-0000-4000-8000-00000000000${n}` as Ref<"offering">,
  name: `Offering ${n}`,
  description: `Description ${n}\nsecond line`,
  unitPrice: { amount: String(1000 * n), currency: "JPY" },
  salesPeriod: { startsAt: STARTS, endsAt: ENDS },
  availability,
  perAccountLimit,
});

const SIX: EntryOffering[] = [
  offering(1, { kind: "ON_SALE", maxSelectableQuantity: 4 }, 4),
  offering(2, { kind: "BEFORE_SALES", startsAt: SOON }),
  offering(3, { kind: "SALES_ENDED" }),
  offering(4, { kind: "SUSPENDED" }),
  offering(5, { kind: "SOLD_OUT" }),
  offering(6, { kind: "PURCHASE_LIMIT_EXCEEDED" }, 2),
];

describe("TC-PG-TKT-001-411 buildEntryModel shows the six sale states with their reasons (SPEC-050 12.1, 31 item 4)", () => {
  it("keeps the port order and one item per offering", () => {
    const model = buildEntryModel({ kind: "ok", data: SIX });
    expect(model.kind).toBe("items");
    if (model.kind !== "items") return;
    expect(model.items.map((item) => item.offeringRef)).toEqual(SIX.map((o) => o.offeringRef));
    expect(model.items.map((item) => item.name)).toEqual(SIX.map((o) => o.name));
  });

  it("derives the status from the S1 availability mapping and enables adding only for ON_SALE", () => {
    const model = buildEntryModel({ kind: "ok", data: SIX });
    if (model.kind !== "items") throw new Error("expected items");
    for (const [index, item] of model.items.entries()) {
      const source = SIX[index];
      expect(item.status).toEqual(
        presentAvailability(source?.availability ?? { kind: "unavailable" }),
      );
      expect(item.addable).toBe(source?.availability.kind === "ON_SALE");
      expect(item.addable).toBe(item.status.purchasable);
    }
  });

  it("shows six distinct state labels", () => {
    const model = buildEntryModel({ kind: "ok", data: SIX });
    if (model.kind !== "items") throw new Error("expected items");
    const labels = model.items.map((item) => item.status.label);
    expect(new Set(labels).size).toBe(6);
  });

  it("states the sale start of an offering that has not started (a configured value, not a guess)", () => {
    const model = buildEntryModel({ kind: "ok", data: SIX });
    if (model.kind !== "items") throw new Error("expected items");
    expect(model.items[1]?.status.description).toContain(formatJstDateTime(SOON));
  });

  it("formats the price from the port's amount with bigint (no floating point)", () => {
    const big: EntryOffering = {
      ...offering(1, { kind: "ON_SALE", maxSelectableQuantity: null }),
      unitPrice: { amount: "9007199254740993", currency: "JPY" },
    };
    const model = buildEntryModel({ kind: "ok", data: [big] });
    if (model.kind !== "items") throw new Error("expected items");
    expect(model.items[0]?.priceText).toBe("¥9,007,199,254,740,993");
    expect(model.items[0]?.unitPrice).toEqual({ amount: "9007199254740993", currency: "JPY" });
  });

  it("builds the sales period text from the JST start and end", () => {
    const model = buildEntryModel({ kind: "ok", data: [SIX[0] as EntryOffering] });
    if (model.kind !== "items") throw new Error("expected items");
    expect(model.items[0]?.salesPeriodText).toBe(
      copy.home.period.range(formatJstDateTime(STARTS), formatJstDateTime(ENDS)),
    );
    expect(model.items[0]?.salesPeriodText).toContain("2027/04/30");
  });

  it("announces the maximum only for an on-sale offering and passes the per-account limit through", () => {
    const model = buildEntryModel({ kind: "ok", data: SIX });
    if (model.kind !== "items") throw new Error("expected items");
    expect(model.items.map((item) => item.maxSelectableQuantity)).toEqual([
      4,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(model.items.map((item) => item.perAccountLimit)).toEqual([4, null, null, null, null, 2]);
  });

  it("keeps an on-sale offering whose maximum is not announced as null (the UI invents no limit)", () => {
    const model = buildEntryModel({
      kind: "ok",
      data: [offering(1, { kind: "ON_SALE", maxSelectableQuantity: null })],
    });
    if (model.kind !== "items") throw new Error("expected items");
    expect(model.items[0]?.maxSelectableQuantity).toBeNull();
    expect(model.items[0]?.addable).toBe(true);
  });

  it("separates loading, empty and unavailable (a failed read never becomes empty or sold out)", () => {
    expect(buildEntryModel({ kind: "loading" })).toEqual({ kind: "loading" });
    expect(buildEntryModel({ kind: "ok", data: [] })).toEqual({ kind: "empty" });
    for (const kind of ["unavailable", "not_found", "auth_required", "email_unverified"] as const) {
      expect(buildEntryModel({ kind })).toEqual({ kind: "unavailable" });
    }
  });

  it("does not mutate its input", () => {
    const frozen = Object.freeze(SIX.map((o) => Object.freeze(o)));
    expect(buildEntryModel({ kind: "ok", data: frozen }).kind).toBe("items");
  });

  it("reads the public conditions only when the eligibility is not applicable (guest and unverified users)", () => {
    expect(buildEntryModel({ kind: "ok", data: SIX }, { kind: "not_applicable" })).toEqual(
      buildEntryModel({ kind: "ok", data: SIX }),
    );
  });
});

describe("TC-PG-TKT-001-413 buildEntryModel shows the owner-scoped eligibility on top of the public state and never shows an unconfirmed offering as on sale (API-PUR-ELG-001, SPEC-050 12.1, FR-TKT-026)", () => {
  const lineKeyOf = (n: number): string => `ENTRY_TICKET:e0000000-0000-4000-8000-00000000000${n}`;
  const eligible = (n: number, patch: Partial<PurchaseEligibility> = {}): PurchaseEligibility => ({
    lineKey: lineKeyOf(n),
    purchasable: true,
    reasons: [],
    maxPurchasableQuantity: 4,
    ...patch,
  });
  const unknown = presentAvailability({ kind: "unavailable" });
  const itemsOf = (model: ReturnType<typeof buildEntryModel>) => {
    if (model.kind !== "items") throw new Error(`expected items but got ${model.kind}`);
    return model.items;
  };

  it.each([
    ["loading", { kind: "loading" }],
    ["unavailable", { kind: "unavailable" }],
    ["ok without an entry for the offering", { kind: "ok", data: [] }],
  ] as const)(
    "an on-sale offering is shown as cannot-confirm and cannot be added while the eligibility is %s",
    (_name, eligibility) => {
      const items = itemsOf(buildEntryModel({ kind: "ok", data: SIX }, eligibility));
      const first = items[0];
      expect(first?.status).toEqual(unknown);
      expect(first?.status.label).not.toBe(copy.availability.label.ON_SALE);
      expect(first?.addable).toBe(false);
      expect(first?.maxSelectableQuantity).toBeNull();
    },
  );

  it("adds with the smaller of the public maximum and the owner's maximum when the eligibility says purchasable", () => {
    const publicMax4 = offering(1, { kind: "ON_SALE", maxSelectableQuantity: 4 }, 4);
    const lower = itemsOf(
      buildEntryModel(
        { kind: "ok", data: [publicMax4] },
        { kind: "ok", data: [eligible(1, { maxPurchasableQuantity: 2 })] },
      ),
    );
    expect(lower[0]?.status).toEqual(
      presentAvailability({ kind: "ON_SALE", maxSelectableQuantity: 2 }),
    );
    expect(lower[0]?.addable).toBe(true);
    expect(lower[0]?.maxSelectableQuantity).toBe(2);
    const higher = itemsOf(
      buildEntryModel(
        { kind: "ok", data: [publicMax4] },
        { kind: "ok", data: [eligible(1, { maxPurchasableQuantity: 9 })] },
      ),
    );
    expect(higher[0]?.maxSelectableQuantity).toBe(4);
    const noPublicMax = itemsOf(
      buildEntryModel(
        { kind: "ok", data: [offering(1, { kind: "ON_SALE", maxSelectableQuantity: null })] },
        { kind: "ok", data: [eligible(1, { maxPurchasableQuantity: 3 })] },
      ),
    );
    expect(noPublicMax[0]?.maxSelectableQuantity).toBe(3);
    expect(noPublicMax[0]?.addable).toBe(true);
  });

  it("shows the reasons and cannot add when the eligibility refuses an on-sale offering", () => {
    const refused = eligible(1, {
      purchasable: false,
      reasons: ["PURCHASE_LIMIT_EXCEEDED"],
      maxPurchasableQuantity: 0,
    });
    const items = itemsOf(
      buildEntryModel(
        { kind: "ok", data: [offering(1, { kind: "ON_SALE", maxSelectableQuantity: 4 }, 4)] },
        { kind: "ok", data: [refused] },
      ),
    );
    expect(items[0]?.status).toEqual(presentPurchaseReasons(["PURCHASE_LIMIT_EXCEEDED"], 0));
    expect(items[0]?.status.label).toBe(copy.availability.label.PURCHASE_LIMIT_EXCEEDED);
    expect(items[0]?.addable).toBe(false);
    expect(items[0]?.maxSelectableQuantity).toBeNull();
  });

  it("leaves an offering that is not on sale publicly as it is, whatever the eligibility says", () => {
    const publicOnly = itemsOf(
      buildEntryModel({ kind: "ok", data: SIX }, { kind: "not_applicable" }),
    );
    for (const eligibility of [
      { kind: "loading" },
      { kind: "unavailable" },
      {
        kind: "ok",
        data: [2, 3, 4, 5, 6].map((n) => eligible(n)),
      },
    ] as const) {
      const items = itemsOf(buildEntryModel({ kind: "ok", data: SIX }, eligibility));
      for (const index of [1, 2, 3, 4, 5]) {
        expect(items[index], `${eligibility.kind} #${index}`).toEqual(publicOnly[index]);
      }
    }
    // BEFORE_SALES keeps the configured start time.
    expect(publicOnly[1]?.status.description).toContain(formatJstDateTime(SOON));
  });

  it("keeps the per-account limit text input, the order and the price as they are", () => {
    const publicOnly = itemsOf(buildEntryModel({ kind: "ok", data: SIX }));
    const items = itemsOf(
      buildEntryModel(
        { kind: "ok", data: SIX },
        { kind: "ok", data: [eligible(1, { maxPurchasableQuantity: 1 })] },
      ),
    );
    expect(items.map((item) => item.offeringRef)).toEqual(
      publicOnly.map((item) => item.offeringRef),
    );
    expect(items.map((item) => item.perAccountLimit)).toEqual([4, null, null, null, null, 2]);
    expect(items.map((item) => item.priceText)).toEqual(publicOnly.map((item) => item.priceText));
  });

  it("keeps loading, empty and unavailable as they are and does not mutate its inputs", () => {
    for (const eligibility of [{ kind: "loading" }, { kind: "unavailable" }] as const) {
      expect(buildEntryModel({ kind: "loading" }, eligibility)).toEqual({ kind: "loading" });
      expect(buildEntryModel({ kind: "ok", data: [] }, eligibility)).toEqual({ kind: "empty" });
      expect(buildEntryModel({ kind: "unavailable" }, eligibility)).toEqual({
        kind: "unavailable",
      });
    }
    const data = Object.freeze([Object.freeze(eligible(1))]);
    const frozen = Object.freeze(SIX.map((o) => Object.freeze(o)));
    expect(buildEntryModel({ kind: "ok", data: frozen }, { kind: "ok", data }).kind).toBe("items");
  });
});

const goodsDetail = (availability: SaleAvailability): GoodsDetail => ({
  goodsRef: "a0000000-0000-4000-8000-000000000001" as Ref<"goods">,
  name: "T-shirt",
  description: "Soft cotton\nsecond line",
  unitPrice: { amount: "4000", currency: "JPY" },
  salesPeriod: { startsAt: STARTS, endsAt: ENDS },
  availability,
  venuePickupOnly: true,
});

describe("TC-PG-GDS-002-411 buildGoodsDetailModel shows the Goods state table and the venue-pickup notice (SPEC-050 14.2, 31 item 6)", () => {
  it("is ready with name, description, price, period, status and the pickup notice", () => {
    const model = buildGoodsDetailModel({
      kind: "ok",
      data: goodsDetail({ kind: "ON_SALE", maxSelectableQuantity: 20 }),
    });
    expect(model.kind).toBe("ready");
    if (model.kind !== "ready") return;
    expect(model.goodsRef).toBe("a0000000-0000-4000-8000-000000000001");
    expect(model.name).toBe("T-shirt");
    expect(model.description).toBe("Soft cotton\nsecond line");
    expect(model.priceText).toBe("¥4,000");
    expect(model.unitPrice).toEqual({ amount: "4000", currency: "JPY" });
    expect(model.salesPeriodText).toBe(
      copy.home.period.range(formatJstDateTime(STARTS), formatJstDateTime(ENDS)),
    );
    expect(model.status).toEqual(
      presentAvailability({ kind: "ON_SALE", maxSelectableQuantity: 20 }),
    );
    expect(model.addable).toBe(true);
    expect(model.maxSelectableQuantity).toBe(20);
    expect(model.pickupNotice).toBe(copy.goods.detail.pickupNotice);
  });

  it.each([
    ["BEFORE_SALES", { kind: "BEFORE_SALES", startsAt: SOON }],
    ["SALES_ENDED", { kind: "SALES_ENDED" }],
    ["SUSPENDED", { kind: "SUSPENDED" }],
    ["SOLD_OUT", { kind: "SOLD_OUT" }],
    ["PURCHASE_LIMIT_EXCEEDED", { kind: "PURCHASE_LIMIT_EXCEEDED" }],
  ] as const)("a %s Goods cannot be added and shows its own reason", (_label, availability) => {
    const model = buildGoodsDetailModel({ kind: "ok", data: goodsDetail(availability) });
    expect(model.kind).toBe("ready");
    if (model.kind !== "ready") return;
    expect(model.addable).toBe(false);
    expect(model.maxSelectableQuantity).toBeNull();
    expect(model.status).toEqual(presentAvailability(availability));
  });

  it("separates not found (not public / unknown) from an unavailable read", () => {
    expect(buildGoodsDetailModel({ kind: "loading" })).toEqual({ kind: "loading" });
    expect(buildGoodsDetailModel({ kind: "not_found" })).toEqual({ kind: "not_found" });
    for (const kind of ["unavailable", "auth_required", "email_unverified"] as const) {
      expect(buildGoodsDetailModel({ kind })).toEqual({ kind: "unavailable" });
    }
  });

  it("has no shipping concept: the ready model carries no address, carrier or tracking field", () => {
    const model = buildGoodsDetailModel({
      kind: "ok",
      data: goodsDetail({ kind: "ON_SALE", maxSelectableQuantity: null }),
    });
    expect(JSON.stringify(model)).not.toMatch(/address|carrier|tracking|shipping|delivery/i);
  });
});

describe("TC-PG-GDS-002-413 buildGoodsDetailModel narrows an on-sale Goods by the owner-scoped eligibility and fails closed; goodsEligibilityTarget (B4c, SPEC-050 12.1 / 14.2, API-PUR-ELG-001, SEC-API-029, FR-GDS-004)", () => {
  const ON_SALE_20: SaleAvailability = { kind: "ON_SALE", maxSelectableQuantity: 20 };
  const ref = "a0000000-0000-4000-8000-000000000001" as Ref<"goods">;
  const key = cartLineKey({ kind: "GOODS", goodsRef: ref, quantity: 1 });
  const loaded = (availability: SaleAvailability = ON_SALE_20) =>
    ({ kind: "ok", data: goodsDetail(availability) }) as const;
  const answer = (over: Partial<PurchaseEligibility> = {}): EligibilityInput => ({
    kind: "ok",
    data: [{ lineKey: key, purchasable: true, reasons: [], maxPurchasableQuantity: 5, ...over }],
  });
  const readyOf = (model: GoodsDetailModel) => {
    if (model.kind !== "ready") throw new Error(`expected ready but got ${model.kind}`);
    return model;
  };

  it("(a) is the public model, to the last field, for not_applicable (Guest and unverified) and when the second argument is omitted", () => {
    const publicModel = buildGoodsDetailModel(loaded());
    expect(buildGoodsDetailModelWithEligibility(loaded(), { kind: "not_applicable" })).toEqual(
      publicModel,
    );
    const ready = readyOf(publicModel);
    expect(ready.status).toEqual(presentAvailability(ON_SALE_20));
    expect(ready.addable).toBe(true);
    expect(ready.maxSelectableQuantity).toBe(20);
  });

  it.each([
    ["loading", { kind: "loading" }],
    ["unavailable", { kind: "unavailable" }],
    ["an ok answer without any item", { kind: "ok", data: [] }],
    [
      "an ok answer with the item of another key only",
      answer({ lineKey: "GOODS:a0000000-0000-4000-8000-000000000002" }),
    ],
  ] as const)(
    "(b) shows 'cannot confirm' with adding disabled and no maximum when the answer is %s, and keeps the name, description, price and period",
    (_name, eligibility) => {
      const publicReady = readyOf(buildGoodsDetailModel(loaded()));
      const ready = readyOf(buildGoodsDetailModelWithEligibility(loaded(), eligibility));
      expect(ready.status).toEqual(presentAvailability({ kind: "unavailable" }));
      expect(ready.status.label).toBe(copy.availability.label.UNAVAILABLE);
      expect(ready.status.label).not.toBe(copy.availability.label.ON_SALE);
      expect(ready.addable).toBe(false);
      expect(ready.maxSelectableQuantity).toBeNull();
      expect({ ...ready, status: null, addable: null, maxSelectableQuantity: null }).toEqual({
        ...publicReady,
        status: null,
        addable: null,
        maxSelectableQuantity: null,
      });
      expect(ready.name).toBe("T-shirt");
      expect(ready.priceText).toBe("¥4,000");
      expect(ready.pickupNotice).toBe(copy.goods.detail.pickupNotice);
    },
  );

  it("(c) shows on sale with the smaller of the public and the owner maximum when the owner answer is purchasable", () => {
    const ready = readyOf(buildGoodsDetailModelWithEligibility(loaded(), answer()));
    expect(ready.status).toEqual(
      presentAvailability({ kind: "ON_SALE", maxSelectableQuantity: 5 }),
    );
    expect(ready.addable).toBe(true);
    expect(ready.maxSelectableQuantity).toBe(5);
    const publicSmaller = readyOf(
      buildGoodsDetailModelWithEligibility(
        loaded({ kind: "ON_SALE", maxSelectableQuantity: 3 }),
        answer(),
      ),
    );
    expect(publicSmaller.maxSelectableQuantity).toBe(3);
  });

  it("(d) shows the owner-scoped reasons with adding disabled when the owner answer is not purchasable", () => {
    const ready = readyOf(
      buildGoodsDetailModelWithEligibility(
        loaded(),
        answer({ purchasable: false, reasons: ["SOLD_OUT"], maxPurchasableQuantity: 0 }),
      ),
    );
    expect(ready.status).toEqual(presentPurchaseReasons(["SOLD_OUT"], 0));
    expect(ready.status.label).toBe(copy.availability.label.SOLD_OUT);
    expect(ready.addable).toBe(false);
    expect(ready.maxSelectableQuantity).toBeNull();
  });

  it.each([
    { kind: "BEFORE_SALES", startsAt: SOON },
    { kind: "SALES_ENDED" },
    { kind: "SUSPENDED" },
    { kind: "SOLD_OUT" },
    { kind: "INSUFFICIENT_QUANTITY", maxSelectableQuantity: 3 },
    { kind: "PURCHASE_LIMIT_EXCEEDED" },
  ] as const)(
    "(e) keeps the public state of a %j Goods whatever the owner answer is",
    (availability) => {
      const publicModel = buildGoodsDetailModel(loaded(availability));
      for (const eligibility of [
        { kind: "loading" },
        { kind: "unavailable" },
        { kind: "ok", data: [] },
        answer(),
        answer({ purchasable: false, reasons: ["SOLD_OUT"], maxPurchasableQuantity: 0 }),
      ] as const) {
        expect(buildGoodsDetailModelWithEligibility(loaded(availability), eligibility)).toEqual(
          publicModel,
        );
      }
    },
  );

  it("(f) keeps loading, not_found and unavailable as they are whatever the owner answer is", () => {
    for (const eligibility of [{ kind: "loading" }, { kind: "unavailable" }, answer()] as const) {
      expect(buildGoodsDetailModelWithEligibility({ kind: "loading" }, eligibility)).toEqual({
        kind: "loading",
      });
      expect(buildGoodsDetailModelWithEligibility({ kind: "not_found" }, eligibility)).toEqual({
        kind: "not_found",
      });
      for (const kind of ["unavailable", "auth_required", "email_unverified"] as const) {
        expect(buildGoodsDetailModelWithEligibility({ kind }, eligibility)).toEqual({
          kind: "unavailable",
        });
      }
    }
  });

  it("goodsEligibilityTarget is the quantity-1 GOODS line of a Goods that is on sale publicly, and null otherwise", () => {
    expect(goodsEligibilityTarget(loaded())).toEqual({ kind: "GOODS", goodsRef: ref, quantity: 1 });
    expect(
      goodsEligibilityTarget(loaded({ kind: "ON_SALE", maxSelectableQuantity: null })),
    ).toEqual({ kind: "GOODS", goodsRef: ref, quantity: 1 });
    for (const availability of [
      { kind: "BEFORE_SALES", startsAt: SOON },
      { kind: "SALES_ENDED" },
      { kind: "SUSPENDED" },
      { kind: "SOLD_OUT" },
      { kind: "INSUFFICIENT_QUANTITY", maxSelectableQuantity: 3 },
      { kind: "PURCHASE_LIMIT_EXCEEDED" },
    ] as const) {
      expect(goodsEligibilityTarget(loaded(availability)), availability.kind).toBeNull();
    }
    for (const input of [
      { kind: "loading" },
      { kind: "not_found" },
      { kind: "unavailable" },
      { kind: "auth_required" },
      { kind: "email_unverified" },
    ] as const) {
      expect(goodsEligibilityTarget(input), input.kind).toBeNull();
    }
  });

  it("does not mutate its inputs", () => {
    const input = Object.freeze({
      kind: "ok" as const,
      data: Object.freeze(goodsDetail(ON_SALE_20)),
    });
    const eligibility = Object.freeze(answer());
    const before = JSON.stringify([input, eligibility]);
    buildGoodsDetailModelWithEligibility(input, eligibility);
    goodsEligibilityTarget(input);
    expect(JSON.stringify([input, eligibility])).toBe(before);
  });
});

describe("TC-PG-GDS-002-412 parseGoodsRef accepts only a canonical lowercase UUID (SPEC-050 5.2, 14.2)", () => {
  it("returns the ref for a canonical UUID", () => {
    expect(parseGoodsRef("a0000000-0000-4000-8000-000000000001")).toBe(
      "a0000000-0000-4000-8000-000000000001",
    );
  });

  it.each([
    [""],
    [" a0000000-0000-4000-8000-000000000001"],
    ["a0000000-0000-4000-8000-000000000001 "],
    ["A0000000-0000-4000-8000-000000000001"],
    ["a0000000-0000-4000-8000-00000000000"],
    ["a0000000-0000-4000-8000-0000000000011"],
    ["not-a-uuid"],
    ["%61%30000000-0000-4000-8000-000000000001"],
    ["a0000000000040008000000000000001"],
    ["../cart"],
  ])("rejects %j without repairing it", (raw) => {
    expect(parseGoodsRef(raw)).toBeNull();
  });
});
