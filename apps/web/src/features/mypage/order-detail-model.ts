import type { OrderDetail } from "../../api-client/types";
import type { Loadable } from "../../presentation/components/list-state";
import {
  buildPurchaseStatusModel,
  type PurchaseStatusModel,
} from "../purchase/purchase-status-model";

// View model of PG-MYP-004 (SPEC-050 18.4). The same Order outcome as PG-XFN-001 without the link
// to this very page; every other action keeps its order and content.

export function buildMypageOrderDetailModel(input: Loadable<OrderDetail>): PurchaseStatusModel {
  const model = buildPurchaseStatusModel(input);
  if (model.kind !== "ready") return model;
  return {
    ...model,
    actions: model.actions.filter(
      (action) => !(action.kind === "link" && action.action === "view_purchase"),
    ),
  };
}
