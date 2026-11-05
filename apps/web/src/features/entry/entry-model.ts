import { cartLineKey } from "../../api-client/cart-line-key";
import type { EntryOffering, Money, Ref } from "../../api-client/types";
import {
  type ListState,
  type Loadable,
  toListState,
} from "../../presentation/components/list-state";
import { formatMoney } from "../../presentation/format/money";
import { formatSalesPeriod } from "../../presentation/format/sales-period";
import type { AvailabilityPresentation } from "../../presentation/state-mapping/availability";
import { decideSaleState, type EligibilityInput } from "../purchase/eligibility-model";

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
  eligibility: EligibilityInput = { kind: "not_applicable" },
): ListState<EntryOfferingItem> {
  return toListState(input, (offering): EntryOfferingItem => {
    return {
      offeringRef: offering.offeringRef,
      name: offering.name,
      description: offering.description,
      unitPrice: offering.unitPrice,
      priceText: formatMoney(offering.unitPrice),
      salesPeriodText: formatSalesPeriod(offering.salesPeriod),
      ...decideSaleState(
        offering.availability,
        eligibility,
        cartLineKey({ kind: "ENTRY_TICKET", offeringRef: offering.offeringRef, quantity: 1 }),
      ),
      perAccountLimit: offering.perAccountLimit,
    };
  });
}
