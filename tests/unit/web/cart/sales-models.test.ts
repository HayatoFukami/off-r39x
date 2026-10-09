import { describe, expect, it } from "vitest";
import type {
  EntryOffering,
  GoodsDetail,
  Ref,
  SaleAvailability,
  UtcInstant,
} from "../../../../apps/web/src/api-client/types.ts";
import { buildEntryModel } from "../../../../apps/web/src/features/entry/entry-model.ts";
import { buildGoodsDetailModel } from "../../../../apps/web/src/features/goods/goods-detail-model.ts";
import { parseGoodsRef } from "../../../../apps/web/src/features/public/route-params.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { formatJstDateTime } from "../../../../apps/web/src/presentation/format/datetime.ts";
import { presentAvailability } from "../../../../apps/web/src/presentation/state-mapping/availability.ts";

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
