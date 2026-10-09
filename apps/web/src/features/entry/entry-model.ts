import type { EntryOffering, Money, Ref } from "../../api-client/types";
import {
  type ListState,
  type Loadable,
  toListState,
} from "../../presentation/components/list-state";
import { formatMoney } from "../../presentation/format/money";
import { formatSalesPeriod } from "../../presentation/format/sales-period";
import {
  type AvailabilityPresentation,
  presentAvailability,
} from "../../presentation/state-mapping/availability";

// View model of PG-ENTRY sales (SPEC-050 12.1). Price and availability come from the port only.

export type EntryOfferingItem = {
  offeringRef: Ref<"offering">;
  name: string;
  description: string;
  unitPrice: Money;
  priceText: string;
  salesPeriodText: string;
  status: AvailabilityPresentation;
  addable: boolean;
  maxSelectableQuantity: number | null;
  perAccountLimit: number | null;
};

export function buildEntryModel(
  input: Loadable<readonly EntryOffering[]>,
): ListState<EntryOfferingItem> {
  return toListState(input, (offering): EntryOfferingItem => {
    const status = presentAvailability(offering.availability);
    return {
      offeringRef: offering.offeringRef,
      name: offering.name,
      description: offering.description,
      unitPrice: offering.unitPrice,
      priceText: formatMoney(offering.unitPrice),
      salesPeriodText: formatSalesPeriod(offering.salesPeriod),
      status,
      addable: status.purchasable,
      maxSelectableQuantity:
        offering.availability.kind === "ON_SALE"
          ? offering.availability.maxSelectableQuantity
          : null,
      perAccountLimit: offering.perAccountLimit,
    };
  });
}
