import { assertNever, type GoodsHandoffState, type GoodsItemState } from "@off-r39x/domain";
import { copy } from "../copy/ja";
import type { Tone } from "./order";

export type GoodsItemPresentation = {
  readonly label: string;
  readonly itemLabel: string;
  readonly handoffLabel: string;
  readonly description: string;
  readonly tone: Tone;
  readonly receivable: boolean;
};

function itemLabel(item: GoodsItemState): string {
  switch (item) {
    case "PENDING_PAYMENT":
      return copy.goods.item.PENDING_PAYMENT;
    case "FULFILLABLE":
      return copy.goods.item.FULFILLABLE;
    case "CANCELED":
      return copy.goods.item.CANCELED;
    default:
      return assertNever(item);
  }
}

function handoffLabel(handoff: GoodsHandoffState): string {
  switch (handoff) {
    case "PENDING":
      return copy.goods.handoff.PENDING;
    case "COMPLETED":
      return copy.goods.handoff.COMPLETED;
    case "VOID":
      return copy.goods.handoff.VOID;
    default:
      return assertNever(handoff);
  }
}

export function presentGoodsItem(
  item: GoodsItemState,
  handoff: GoodsHandoffState,
): GoodsItemPresentation {
  const base = { itemLabel: itemLabel(item), handoffLabel: handoffLabel(handoff) };

  if (item === "CANCELED" || handoff === "VOID") {
    return {
      ...base,
      label: copy.goods.item.CANCELED,
      description: copy.goods.description.canceled,
      tone: "neutral",
      receivable: false,
    };
  }
  if (item === "PENDING_PAYMENT") {
    return {
      ...base,
      label: copy.goods.item.PENDING_PAYMENT,
      description: copy.goods.description.pendingPayment,
      tone: "pending",
      receivable: false,
    };
  }
  if (handoff === "COMPLETED") {
    return {
      ...base,
      label: copy.goods.handoff.COMPLETED,
      description: copy.goods.description.completed,
      tone: "success",
      receivable: false,
    };
  }
  return {
    ...base,
    label: copy.goods.awaiting,
    description: copy.goods.description.awaiting,
    tone: "pending",
    receivable: true,
  };
}
