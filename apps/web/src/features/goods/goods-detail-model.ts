import type { GoodsDetail, Money, Ref } from "../../api-client/types";
import type { Loadable } from "../../presentation/components/list-state";
import { copy } from "../../presentation/copy/ja";
import { formatMoney } from "../../presentation/format/money";
import { formatSalesPeriod } from "../../presentation/format/sales-period";
import {
  type AvailabilityPresentation,
  presentAvailability,
} from "../../presentation/state-mapping/availability";

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

export function buildGoodsDetailModel(input: Loadable<GoodsDetail>): GoodsDetailModel {
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
      const status = presentAvailability(goods.availability);
      return {
        kind: "ready",
        goodsRef: goods.goodsRef,
        name: goods.name,
        description: goods.description,
        unitPrice: goods.unitPrice,
        priceText: formatMoney(goods.unitPrice),
        salesPeriodText: formatSalesPeriod(goods.salesPeriod),
        status,
        addable: status.purchasable,
        maxSelectableQuantity:
          goods.availability.kind === "ON_SALE" ? goods.availability.maxSelectableQuantity : null,
        pickupNotice: copy.goods.detail.pickupNotice,
      };
    }
    default: {
      const unreachable: never = input;
      return unreachable;
    }
  }
}
