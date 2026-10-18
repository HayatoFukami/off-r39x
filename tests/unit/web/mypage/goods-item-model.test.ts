import { describe, expect, it } from "vitest";
import type {
  GoodsItemDetail,
  GoodsItemSummary,
} from "../../../../apps/web/src/api-client/types.ts";
import {
  buildGoodsItemDetailModel,
  buildGoodsItemListModel,
} from "../../../../apps/web/src/features/mypage/goods-item-model.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { formatMoney } from "../../../../apps/web/src/presentation/format/money.ts";
import { presentGoodsItem } from "../../../../apps/web/src/presentation/state-mapping/goods.ts";
import { createBackend, okData } from "../../../harness/mock-backend.ts";
import { EMAIL, GOODS_ITEM, ORDER } from "../../../harness/mock-seed.ts";

// Contract: tests/contracts/s8-mypage.md section 3.6 (SPEC-050 18.11, 18.12, 20.4, INV-010-07 / 08 / 10).

async function demo() {
  const backend = createBackend();
  await backend.signInAs(EMAIL.demo);
  return backend;
}

const cases = [
  {
    name: "pending payment",
    ref: GOODS_ITEM.pendingPayment,
    order: ORDER.awaiting,
    item: "PENDING_PAYMENT",
    handoff: "PENDING",
    receivable: false,
  },
  {
    name: "completed",
    ref: GOODS_ITEM.completed,
    order: ORDER.confirmedGoods,
    item: "FULFILLABLE",
    handoff: "COMPLETED",
    receivable: false,
  },
  {
    name: "fulfillable",
    ref: GOODS_ITEM.fulfillable,
    order: ORDER.confirmedComposite,
    item: "FULFILLABLE",
    handoff: "PENDING",
    receivable: true,
  },
  {
    name: "canceled",
    ref: GOODS_ITEM.canceled,
    order: ORDER.paymentFailed,
    item: "CANCELED",
    handoff: "VOID",
    receivable: false,
  },
  {
    name: "review",
    ref: GOODS_ITEM.review,
    order: ORDER.review,
    item: "PENDING_PAYMENT",
    handoff: "PENDING",
    receivable: false,
  },
] as const;

describe("TC-PG-MYP-011-621 the Goods list model states what can be received at the venue (SPEC-050 18.11, 20.4)", () => {
  it("lists demo's five items in port order with name, quantity, both states, the Order state and the hrefs", async () => {
    const { api } = await demo();
    const data = okData(await api.self.listGoodsItems());
    const model = buildGoodsItemListModel({ kind: "ok", data });
    if (model.kind !== "items") throw new Error(`expected items but got ${model.kind}`);
    expect(model.items).toHaveLength(5);
    expect(model.items.map((i) => i.goodsItemRef)).toEqual(data.map((g) => g.goodsItemRef));
    for (const [index, row] of model.items.entries()) {
      const source = data[index] as GoodsItemSummary;
      const presented = presentGoodsItem(source.itemState, source.handoffState);
      expect(row.href).toBe(`/mypage/goods/${source.goodsItemRef}`);
      expect(row.name).toBe(source.goodsName);
      expect(row.quantityText).toBe(copy.purchase.quantity(source.quantity));
      expect(row.primaryLabel).toBe(presented.label);
      expect(row.itemLabel).toBe(presented.itemLabel);
      expect(row.handoffLabel).toBe(presented.handoffLabel);
      expect(row.tone).toBe(presented.tone);
      expect(row.receivable).toBe(presented.receivable);
      expect(row.orderStateLabel).toBe(copy.order.state[source.orderState]);
      expect(row.orderHref).toBe(`/mypage/orders/${source.orderRef}`);
      expect(row.linkLabel).toBe(copy.mypage.goodsItems.detailLink(source.goodsName));
    }
  });

  it("follows the display rule: unpaid is not receivable, fulfillable + pending is awaiting pickup, completed is handed over, canceled is void", async () => {
    const { api } = await demo();
    const model = buildGoodsItemListModel({
      kind: "ok",
      data: okData(await api.self.listGoodsItems()),
    });
    if (model.kind !== "items") throw new Error("expected items");
    const row = (ref: string) => model.items.find((i) => i.goodsItemRef === ref);
    expect(row(GOODS_ITEM.pendingPayment)?.primaryLabel).toBe("支払未確定・受け取り不可");
    expect(row(GOODS_ITEM.review)?.primaryLabel).toBe("支払未確定・受け取り不可");
    expect(row(GOODS_ITEM.fulfillable)?.primaryLabel).toBe("会場受け取り待ち");
    expect(row(GOODS_ITEM.completed)?.primaryLabel).toBe("受け渡し済み");
    expect(row(GOODS_ITEM.canceled)?.primaryLabel).toBe("取消済み・受け取り不可");
    expect(model.items.filter((i) => i.receivable).map((i) => i.goodsItemRef)).toEqual([
      GOODS_ITEM.fulfillable,
    ]);
    // The Order state summary is the Canonical Order label of the corresponding Order.
    expect(row(GOODS_ITEM.pendingPayment)?.orderStateLabel).toBe(copy.order.state.AWAITING_PAYMENT);
    expect(row(GOODS_ITEM.review)?.orderStateLabel).toBe(copy.order.state.REVIEW_REQUIRED);
    expect(row(GOODS_ITEM.fulfillable)?.orderStateLabel).toBe(copy.order.state.CONFIRMED);
  });

  it("separates loading, Empty and a failed read; another user's item is not listed", async () => {
    expect(buildGoodsItemListModel({ kind: "loading" })).toEqual({ kind: "loading" });
    expect(buildGoodsItemListModel({ kind: "ok", data: [] })).toEqual({ kind: "empty" });
    for (const kind of ["unavailable", "not_found", "auth_required", "email_unverified"] as const) {
      expect(buildGoodsItemListModel({ kind }), kind).toEqual({ kind: "unavailable" });
    }
    const { api } = await demo();
    const model = buildGoodsItemListModel({
      kind: "ok",
      data: okData(await api.self.listGoodsItems()),
    });
    expect(JSON.stringify(model)).not.toContain(GOODS_ITEM.other);
  });
});

describe("TC-PG-MYP-012-621 the Goods detail model gives the pickup guidance only when the item can be received (SPEC-050 18.12)", () => {
  for (const c of cases) {
    it(`${c.name}: ${c.item} + ${c.handoff}`, async () => {
      const { api } = await demo();
      const read = await api.self.getGoodsItem(c.ref);
      const model = buildGoodsItemDetailModel(read);
      if (model.kind !== "ready") throw new Error(`expected ready but got ${model.kind}`);
      const source = okData(read) as GoodsItemDetail;
      const presented = presentGoodsItem(c.item, c.handoff);
      expect(model.name).toBe(source.goodsName);
      expect(model.quantityText).toBe(copy.purchase.quantity(source.quantity));
      expect(model.unitPriceText).toBe(formatMoney(source.unitPrice));
      expect(model.subtotalText).toBe(formatMoney(source.subtotal));
      expect(model.primaryLabel).toBe(presented.label);
      expect(model.itemLabel).toBe(presented.itemLabel);
      expect(model.handoffLabel).toBe(presented.handoffLabel);
      expect(model.description).toBe(presented.description);
      expect(model.receivable).toBe(c.receivable);
      expect(model.orderHref).toBe(`/mypage/orders/${c.order}`);
      expect(model.orderStateLabel).toBe(copy.order.state[source.orderState]);
      expect(model.pickupNotice).toBe(c.receivable ? copy.goods.detail.pickupNotice : null);
      expect(model.noSecondHandoff).toBe(
        c.item === "FULFILLABLE" && c.handoff === "COMPLETED"
          ? copy.mypage.goodsItems.detail.noSecondHandoff
          : null,
      );
    });
  }

  it("the line price is the purchase-time snapshot (unit price x quantity)", async () => {
    const { api } = await demo();
    const model = buildGoodsItemDetailModel(await api.self.getGoodsItem(GOODS_ITEM.fulfillable));
    if (model.kind !== "ready") throw new Error("expected ready");
    expect(model.unitPriceText).toBe("¥4,000");
    expect(model.subtotalText).toBe("¥4,000");
  });
});

describe("TC-PG-MYP-012-622 the Receipt link is shown only for a CONFIRMED Order with a safe https URL (SPEC-050 23, INV-010-07)", () => {
  it("shows the receipt of a CONFIRMED Order and none for an unconfirmed or cancelled one", async () => {
    const { api } = await demo();
    const href = async (ref: typeof GOODS_ITEM.completed) => {
      const model = buildGoodsItemDetailModel(await api.self.getGoodsItem(ref));
      return model.kind === "ready" ? model.receiptHref : "not-ready";
    };
    expect(await href(GOODS_ITEM.completed)).toBe(
      `https://receipt.example.com/mock/${ORDER.confirmedGoods}`,
    );
    expect(await href(GOODS_ITEM.fulfillable)).toBe(
      `https://receipt.example.com/mock/${ORDER.confirmedComposite}`,
    );
    expect(await href(GOODS_ITEM.pendingPayment)).toBeNull();
    expect(await href(GOODS_ITEM.canceled)).toBeNull();
  });

  it("does not show a receipt URL of an Order that is not CONFIRMED, nor an unsafe URL", async () => {
    const { api } = await demo();
    const base = okData(await api.self.getGoodsItem(GOODS_ITEM.fulfillable));
    const unconfirmed = buildGoodsItemDetailModel({
      kind: "ok",
      data: {
        ...base,
        orderState: "AWAITING_PAYMENT",
        receiptUrl: "https://receipt.example.com/x",
      },
    });
    if (unconfirmed.kind !== "ready") throw new Error("expected ready");
    expect(unconfirmed.receiptHref).toBeNull();
    for (const receiptUrl of [
      "http://receipt.example.com/x",
      "javascript:alert(1)",
      "https://u:p@receipt.example.com/x",
    ]) {
      const model = buildGoodsItemDetailModel({ kind: "ok", data: { ...base, receiptUrl } });
      if (model.kind !== "ready") throw new Error("expected ready");
      expect(model.receiptHref, receiptUrl).toBeNull();
    }
  });

  it("separates loading, denied and unavailable; another user's item is denied", async () => {
    expect(buildGoodsItemDetailModel({ kind: "loading" })).toEqual({ kind: "loading" });
    expect(buildGoodsItemDetailModel({ kind: "not_found" })).toEqual({ kind: "denied" });
    for (const kind of ["unavailable", "auth_required", "email_unverified"] as const) {
      expect(buildGoodsItemDetailModel({ kind }), kind).toEqual({ kind: "unavailable" });
    }
    const { api } = await demo();
    expect(buildGoodsItemDetailModel(await api.self.getGoodsItem(GOODS_ITEM.other))).toEqual({
      kind: "denied",
    });
  });

  it("never offers a way back from COMPLETED: the model has no action at all", async () => {
    const { api } = await demo();
    const model = buildGoodsItemDetailModel(await api.self.getGoodsItem(GOODS_ITEM.completed));
    if (model.kind !== "ready") throw new Error("expected ready");
    expect(Object.keys(model).some((k) => /action|revert|undo|reset/i.test(k))).toBe(false);
  });
});
