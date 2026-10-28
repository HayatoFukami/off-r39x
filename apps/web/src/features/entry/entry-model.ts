import { cartLineKey } from "../../api-client/cart-line-key";
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
  presentPurchaseReasons,
} from "../../presentation/state-mapping/availability";
import { type EligibilityInput, findEligibility } from "../purchase/eligibility-model";

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

type Decision = Pick<EntryOfferingItem, "status" | "addable" | "maxSelectableQuantity">;

/** The state of one offering: the public one, narrowed by the owner-scoped answer when it is on sale. */
function decide(offering: EntryOffering, eligibility: EligibilityInput): Decision {
  const availability = offering.availability;
  if (availability.kind !== "ON_SALE" || eligibility.kind === "not_applicable") {
    const status = presentAvailability(availability);
    return {
      status,
      addable: status.purchasable,
      maxSelectableQuantity:
        availability.kind === "ON_SALE" ? availability.maxSelectableQuantity : null,
    };
  }
  const item = findEligibility(
    eligibility,
    cartLineKey({ kind: "ENTRY_TICKET", offeringRef: offering.offeringRef, quantity: 1 }),
  );
  // A pending or failed read, or a missing entry, is never shown as on sale.
  if (item === undefined) {
    return {
      status: presentAvailability({ kind: "unavailable" }),
      addable: false,
      maxSelectableQuantity: null,
    };
  }
  if (!item.purchasable) {
    return {
      status: presentPurchaseReasons(item.reasons, item.maxPurchasableQuantity),
      addable: false,
      maxSelectableQuantity: null,
    };
  }
  return {
    status: presentAvailability({
      kind: "ON_SALE",
      maxSelectableQuantity: item.maxPurchasableQuantity,
    }),
    addable: true,
    maxSelectableQuantity: Math.min(
      availability.maxSelectableQuantity ?? Number.POSITIVE_INFINITY,
      item.maxPurchasableQuantity,
    ),
  };
}

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
      ...decide(offering, eligibility),
      perAccountLimit: offering.perAccountLimit,
    };
  });
}
