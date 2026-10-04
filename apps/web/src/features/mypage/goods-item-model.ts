import type { GoodsItemDetail, GoodsItemSummary, Ref } from "../../api-client/types";
import { goodsItemHref, mypageOrderHref } from "../../config/purchase-routes";
import {
  type ListState,
  type Loadable,
  toListState,
} from "../../presentation/components/list-state";
import { safeExternalHref } from "../../presentation/components/safe-url";
import { copy } from "../../presentation/copy/ja";
import { formatMoney } from "../../presentation/format/money";
import { presentGoodsItem } from "../../presentation/state-mapping/goods";
import type { Tone } from "../../presentation/state-mapping/order";

// View models of PG-MYP-011 / 012 (SPEC-050 18.11, 18.12, 20.4, INV-010-07 / 10). Pure: an item is
// receivable only when it is FULFILLABLE and its Handoff is still PENDING; nothing here can move a
// COMPLETED item back.

export type GoodsItemRow = {
  goodsItemRef: Ref<"goodsItem">;
  href: string;
  name: string;
  quantityText: string;
  primaryLabel: string;
  itemLabel: string;
  handoffLabel: string;
  tone: Tone;
  receivable: boolean;
  orderStateLabel: string;
  orderHref: string;
  linkLabel: string;
};

export function buildGoodsItemListModel(
  input: Loadable<readonly GoodsItemSummary[]>,
): ListState<GoodsItemRow> {
  return toListState(input, (item): GoodsItemRow => {
    const presented = presentGoodsItem(item.itemState, item.handoffState);
    return {
      goodsItemRef: item.goodsItemRef,
      href: goodsItemHref(item.goodsItemRef),
      name: item.goodsName,
      quantityText: copy.purchase.quantity(item.quantity),
      primaryLabel: presented.label,
      itemLabel: presented.itemLabel,
      handoffLabel: presented.handoffLabel,
      tone: presented.tone,
      receivable: presented.receivable,
      orderStateLabel: copy.order.state[item.orderState],
      orderHref: mypageOrderHref(item.orderRef),
      linkLabel: copy.mypage.goodsItems.detailLink(item.goodsName),
    };
  });
}

export type GoodsItemDetailModel =
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "unavailable" }
  | {
      kind: "ready";
      goodsItemRef: Ref<"goodsItem">;
      name: string;
      quantityText: string;
      unitPriceText: string;
      subtotalText: string;
      primaryLabel: string;
      itemLabel: string;
      handoffLabel: string;
      description: string;
      tone: Tone;
      receivable: boolean;
      pickupNotice: string | null;
      noSecondHandoff: string | null;
      orderStateLabel: string;
      orderHref: string;
      receiptHref: string | null;
    };

export function buildGoodsItemDetailModel(input: Loadable<GoodsItemDetail>): GoodsItemDetailModel {
  switch (input.kind) {
    case "loading":
      return { kind: "loading" };
    case "not_found":
      // Another user's item and a missing item are the same answer (SPEC-110 22).
      return { kind: "denied" };
    case "unavailable":
    case "auth_required":
    case "email_unverified":
      return { kind: "unavailable" };
    case "ok": {
      const item = input.data;
      const presented = presentGoodsItem(item.itemState, item.handoffState);
      return {
        kind: "ready",
        goodsItemRef: item.goodsItemRef,
        name: item.goodsName,
        quantityText: copy.purchase.quantity(item.quantity),
        unitPriceText: formatMoney(item.unitPrice),
        subtotalText: formatMoney(item.subtotal),
        primaryLabel: presented.label,
        itemLabel: presented.itemLabel,
        handoffLabel: presented.handoffLabel,
        description: presented.description,
        tone: presented.tone,
        receivable: presented.receivable,
        pickupNotice: presented.receivable ? copy.goods.detail.pickupNotice : null,
        noSecondHandoff:
          item.itemState === "FULFILLABLE" && item.handoffState === "COMPLETED"
            ? copy.mypage.goodsItems.detail.noSecondHandoff
            : null,
        orderStateLabel: copy.order.state[item.orderState],
        orderHref: mypageOrderHref(item.orderRef),
        receiptHref: item.orderState === "CONFIRMED" ? safeExternalHref(item.receiptUrl) : null,
      };
    }
    default: {
      const unreachable: never = input;
      return unreachable;
    }
  }
}
