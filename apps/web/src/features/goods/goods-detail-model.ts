import { cartLineKey } from "../../api-client/cart-line-key";
import type { CartLine, GoodsDetail, Money, Ref } from "../../api-client/types";
import type { Loadable } from "../../presentation/components/list-state";
import { copy } from "../../presentation/copy/ja";
import { formatMoney } from "../../presentation/format/money";
import { formatSalesPeriod } from "../../presentation/format/sales-period";
import type { AvailabilityPresentation } from "../../presentation/state-mapping/availability";
import { decideSaleState, type EligibilityInput } from "../purchase/eligibility-model";

// View model of PG-GDS-002 (SPEC-050 14.2). A failed read is never Not Found.

export type GoodsDetailModel =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "unavailable" }
  | {
      kind: "ready";
      goodsRef: Ref<"goods">;
      name: string;
      description: string;
      unitPrice: Money;
      priceText: string;
      salesPeriodText: string;
      status: AvailabilityPresentation;
      addable: boolean;
      maxSelectableQuantity: number | null;
      pickupNotice: string;
    };

/** The target to read the owner-scoped eligibility for: only a Goods that is on sale publicly (quantity 1). */
export function goodsEligibilityTarget(input: Loadable<GoodsDetail>): CartLine | null {
  if (input.kind !== "ok" || input.data.availability.kind !== "ON_SALE") return null;
  return { kind: "GOODS", goodsRef: input.data.goodsRef, quantity: 1 };
}

export function buildGoodsDetailModel(
  input: Loadable<GoodsDetail>,
  eligibility: EligibilityInput = { kind: "not_applicable" },
): GoodsDetailModel {
  switch (input.kind) {
    case "loading":
      return { kind: "loading" };
    case "not_found":
      return { kind: "not_found" };
    case "unavailable":
    case "auth_required":
    case "email_unverified":
      return { kind: "unavailable" };
    case "ok": {
      const goods = input.data;
      const decision = decideSaleState(
        goods.availability,
        eligibility,
        cartLineKey({ kind: "GOODS", goodsRef: goods.goodsRef, quantity: 1 }),
      );
      return {
        kind: "ready",
        goodsRef: goods.goodsRef,
        name: goods.name,
        description: goods.description,
        unitPrice: goods.unitPrice,
        priceText: formatMoney(goods.unitPrice),
        salesPeriodText: formatSalesPeriod(goods.salesPeriod),
        status: decision.status,
        addable: decision.addable,
        maxSelectableQuantity: decision.maxSelectableQuantity,
        pickupNotice: copy.goods.detail.pickupNotice,
      };
    }
    default: {
      const unreachable: never = input;
      return unreachable;
    }
  }
}
