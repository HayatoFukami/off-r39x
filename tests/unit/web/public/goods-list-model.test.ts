import { describe, expect, it } from "vitest";
import type { GoodsSummary, Ref, UtcInstant } from "../../../../apps/web/src/api-client/types.ts";
import { buildGoodsListModel } from "../../../../apps/web/src/features/goods/goods-list-model.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { formatMoney } from "../../../../apps/web/src/presentation/format/money.ts";
import { createBackend, okData } from "../../../harness/mock-backend.ts";
import { GOODS, MARKER } from "../../../harness/mock-seed.ts";

// Contract: tests/contracts/s4-public.md section 2.10 (SPEC-050 14.1, 9.2, 21, 33, FR-GDS-001/002).

async function seedModel() {
  const { api } = createBackend();
  const data = okData(await api.public.listGoods());
  const model = buildGoodsListModel({ kind: "ok", data });
  if (model.kind !== "items") throw new Error(`expected items but got ${model.kind}`);
  return { data, items: model.items };
}

describe("TC-PG-GDS-001-601 goods list model (SPEC-050 14.1)", () => {
  it("lists the six public goods in port order with name, description, price and a detail href", async () => {
    const { data, items } = await seedModel();
    expect(items).toHaveLength(6);
    expect(items.map((i) => i.goodsRef)).toEqual(data.map((g) => g.goodsRef));
    for (const [index, item] of items.entries()) {
      const source = data[index];
      expect(item.href).toBe(`/goods/${item.goodsRef}`);
      expect(item.name).toBe(source?.name);
      expect(item.shortDescription).toBe(source?.shortDescription);
      expect(item.priceText).toBe(
        formatMoney(source?.unitPrice ?? { amount: "0", currency: "JPY" }),
      );
    }
    expect(items.find((i) => i.goodsRef === GOODS.tshirt)?.priceText).toBe("¥4,000");
    expect(items.find((i) => i.goodsRef === GOODS.towel)?.priceText).toBe("¥1,800");
  });

  it("never includes the hidden (non-public) goods", async () => {
    const { items } = await seedModel();
    expect(items.some((i) => i.goodsRef === GOODS.hidden)).toBe(false);
    expect(JSON.stringify(items)).not.toContain(MARKER.hiddenGoods);
  });

  it("separates before-sales, ended, suspended and sold-out by label and gives a reason for each", async () => {
    const { items } = await seedModel();
    const status = (ref: Ref<"goods">) => items.find((i) => i.goodsRef === ref)?.status;
    expect(status(GOODS.tshirt)).toMatchObject({
      label: copy.availability.label.ON_SALE,
      purchasable: true,
    });
    expect(status(GOODS.badge)).toMatchObject({
      label: copy.availability.label.SOLD_OUT,
      purchasable: false,
    });
    expect(status(GOODS.poster)).toMatchObject({
      label: copy.availability.label.BEFORE_SALES,
      purchasable: false,
    });
    expect(status(GOODS.sticker)).toMatchObject({
      label: copy.availability.label.SALES_ENDED,
      purchasable: false,
    });
    expect(status(GOODS.lanyard)).toMatchObject({
      label: copy.availability.label.SUSPENDED,
      purchasable: false,
    });
    const blocked = [GOODS.badge, GOODS.poster, GOODS.sticker, GOODS.lanyard].map(
      (r) => status(r)?.label,
    );
    expect(new Set(blocked).size).toBe(4);
    for (const item of items) {
      expect(item.status.description.length, item.name).toBeGreaterThan(0);
      expect(item.status.label.length, item.name).toBeGreaterThan(0);
    }
  });

  it("shows when a goods item starts selling, without guessing (BEFORE_SALES reason carries the JST start)", async () => {
    const { data, items } = await seedModel();
    const poster = data.find((g) => g.goodsRef === GOODS.poster);
    expect(poster?.availability.kind).toBe("BEFORE_SALES");
    const reason = items.find((i) => i.goodsRef === GOODS.poster)?.status.description ?? "";
    expect(reason).toMatch(/\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/);
  });

  it("keeps empty only for a successful empty read and unavailable for every failure", () => {
    expect(buildGoodsListModel({ kind: "ok", data: [] })).toEqual({ kind: "empty" });
    expect(buildGoodsListModel({ kind: "loading" })).toEqual({ kind: "loading" });
    for (const kind of ["unavailable", "not_found", "auth_required", "email_unverified"] as const) {
      expect(buildGoodsListModel({ kind }), kind).toEqual({ kind: "unavailable" });
    }
  });

  it("formats large amounts exactly (no floating point)", () => {
    const big: GoodsSummary = {
      goodsRef: "a0000000-0000-4000-8000-000000000099" as Ref<"goods">,
      name: "big",
      shortDescription: "d",
      unitPrice: { amount: "9007199254740993", currency: "JPY" },
      availability: { kind: "BEFORE_SALES", startsAt: "2027-03-06T00:00:00Z" as UtcInstant },
    };
    const model = buildGoodsListModel({ kind: "ok", data: [big] });
    expect(model.kind === "items" && model.items[0]?.priceText).toBe("¥9,007,199,254,740,993");
  });
});
