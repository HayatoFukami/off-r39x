import type { GoodsSummary, Ref } from "../../api-client/types";
import { goodsHref } from "../../config/public-routes";
import {
  type ListState,
  type Loadable,
  toListState,
} from "../../presentation/components/list-state";
import { formatMoney } from "../../presentation/format/money";
import { presentAvailability } from "../../presentation/state-mapping/availability";
import type { Tone } from "../../presentation/state-mapping/order";

// View model for PG-GDS-001 (SPEC-050 14.1). Prices and availability come from the port only.

export type GoodsListItem = {
  goodsRef: Ref<"goods">;
  href: string;
  name: string;
  shortDescription: string;
  priceText: string;
  status: { label: string; description: string; tone: Tone; purchasable: boolean };
};

export function buildGoodsListModel(
  input: Loadable<readonly GoodsSummary[]>,
): ListState<GoodsListItem> {
  return toListState(
    input,
    (item): GoodsListItem => ({
      goodsRef: item.goodsRef,
      href: goodsHref(item.goodsRef),
      name: item.name,
      shortDescription: item.shortDescription,
      priceText: formatMoney(item.unitPrice),
      status: presentAvailability(item.availability),
    }),
  );
}
