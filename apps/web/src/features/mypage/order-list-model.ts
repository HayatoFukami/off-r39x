import type { OrderState } from "@off-r39x/domain";
import type { OrderSummary, Ref } from "../../api-client/types";
import { mypageOrderHref } from "../../config/purchase-routes";
import {
  type ListState,
  type Loadable,
  toListState,
} from "../../presentation/components/list-state";
import { copy } from "../../presentation/copy/ja";
import { formatJstDateTime } from "../../presentation/format/datetime";
import { formatMoney } from "../../presentation/format/money";
import { presentOrderState, type Tone } from "../../presentation/state-mapping/order";
import { presentPurpose } from "../../presentation/state-mapping/purpose";

// View model of the Order list (PG-MYP-003, SPEC-050 18.3, 20.1). Pure: each Order shows its own
// Canonical state as text; a failed read is never empty.

export type OrderListRow = {
  orderRef: Ref<"order">;
  href: string;
  purposeLabel: string;
  summary: string;
  stateKey: OrderState;
  stateLabel: string;
  tone: Tone;
  createdAtText: string;
  totalText: string;
  linkLabel: string;
};

function toRow(order: OrderSummary): OrderListRow {
  const presented = presentOrderState(order.state);
  const createdAtText = formatJstDateTime(order.createdAt);
  return {
    orderRef: order.orderRef,
    href: mypageOrderHref(order.orderRef),
    purposeLabel: presentPurpose(order.purpose).label,
    summary: order.summary,
    stateKey: order.state,
    stateLabel: presented.label,
    tone: presented.tone,
    createdAtText,
    totalText: formatMoney(order.total),
    linkLabel: copy.mypage.orders.detailLink(createdAtText),
  };
}

/** Newest first; the input order is kept on a tie (stable) and the input is not changed. */
export function sortNewestFirst(orders: readonly OrderSummary[]): OrderSummary[] {
  return orders
    .map((order, index) => ({ order, index }))
    .sort(
      (a, b) => Date.parse(b.order.createdAt) - Date.parse(a.order.createdAt) || a.index - b.index,
    )
    .map(({ order }) => order);
}

export function buildOrderListModel(
  input: Loadable<readonly OrderSummary[]>,
): ListState<OrderListRow> {
  return toListState(
    input.kind === "ok" ? { kind: "ok", data: sortNewestFirst(input.data) } : input,
    toRow,
  );
}
