import { assertNever } from "@off-r39x/domain";
import { eligibilityTargetKey } from "../../api-client/eligibility-target-key";
import type {
  EligibilityTarget,
  KaraokeSlotDetail,
  PurchaseEligibility,
  Ref,
} from "../../api-client/types";
import { karaokeDayHref } from "../../config/public-routes";
import type { Loadable } from "../../presentation/components/list-state";
import { copy } from "../../presentation/copy/ja";
import { formatBusinessDate, formatJstTimeRange } from "../../presentation/format/datetime";
import { formatMoney } from "../../presentation/format/money";
import {
  presentAvailability,
  presentPurchaseReasons,
} from "../../presentation/state-mapping/availability";
import { presentSlot } from "../../presentation/state-mapping/karaoke";
import { presentKaraokeSaleStatus } from "../../presentation/state-mapping/karaoke-sale-status";
import type { Tone } from "../../presentation/state-mapping/order";
import { type EligibilityInput, findEligibility } from "../purchase/eligibility-model";

// View model for PG-KRK-003 (SPEC-050 13.3). The port result decides purchasability. The port flag is part
// of the condition (INV-010-04): an inconsistent flag is not purchasable. A slot state wins over the sale
// status, and the sale status wins over the flag. The owner-scoped eligibility (API-PUR-ELG-001) narrows only a
// slot that is purchasable publicly (B4c, SPEC-050 12.1 / 13.3); the server re-verifies at purchase start.

export type KaraokeSlotModel =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "unavailable" }
  | {
      kind: "ready";
      slotRef: Ref<"slot">;
      dateText: string;
      timeText: string;
      priceText: string;
      stateLabel: string;
      description: string;
      tone: Tone;
      purchasable: boolean;
      disabledReason: string | null;
      dayHref: string;
    };

type Status = {
  stateLabel: string;
  description: string;
  tone: Tone;
  purchasable: boolean;
  disabledReason: string | null;
};

function isPubliclyPurchasable(data: KaraokeSlotDetail): boolean {
  return data.state === "AVAILABLE" && data.saleStatus === "ON_SALE" && data.purchasable === true;
}

/** The target to read the owner-scoped eligibility for: only a slot that is purchasable publicly. */
export function karaokeEligibilityTarget(
  input: Loadable<KaraokeSlotDetail>,
): EligibilityTarget | null {
  if (input.kind !== "ok" || !isPubliclyPurchasable(input.data)) return null;
  return { kind: "KARAOKE", slotRef: input.data.slotRef, quantity: 1 };
}

function purchasableStatus(): Status {
  return {
    stateLabel: copy.karaoke.slotDetail.purchasableLabel,
    description: copy.karaoke.slotDetail.purchasableDescription,
    tone: presentSlot("AVAILABLE").tone,
    purchasable: true,
    disabledReason: null,
  };
}

/** The disabled reason follows the first (canonical order) reason of the owner-scoped answer. */
function disabledReasonOf(item: PurchaseEligibility): string {
  const reasons = copy.karaoke.slotDetail.disabledReason;
  const first = item.reasons[0];
  if (first === undefined) return reasons.NOT_PURCHASABLE;
  switch (first) {
    case "PURCHASE_LIMIT_EXCEEDED":
      return reasons.PURCHASE_LIMIT_EXCEEDED;
    case "SALES_NOT_STARTED":
    case "SALES_CLOSED":
    case "SALES_STOPPED":
      return reasons.NOT_ON_SALE;
    case "NOT_PUBLIC_OR_NOT_FOUND":
    case "SOLD_OUT":
    case "INSUFFICIENT_QUANTITY":
    case "SLOT_UNAVAILABLE":
    case "PAYMENT_WINDOW_TOO_SHORT":
      return reasons.NOT_PURCHASABLE;
    default:
      return assertNever(first);
  }
}

/** A slot that is purchasable publicly: a pending or failed owner-scoped answer is never "purchasable". */
function narrowByEligibility(data: KaraokeSlotDetail, eligibility: EligibilityInput): Status {
  if (eligibility.kind === "not_applicable") return purchasableStatus();
  const item = findEligibility(
    eligibility,
    eligibilityTargetKey({ kind: "KARAOKE", slotRef: data.slotRef, quantity: 1 }),
  );
  // Fail closed: no answer, or a purchasable answer without a quantity to buy (inconsistent).
  if (item === undefined || (item.purchasable && item.maxPurchasableQuantity < 1)) {
    const unconfirmed = presentAvailability({ kind: "unavailable" });
    return {
      stateLabel: unconfirmed.label,
      description: unconfirmed.description,
      tone: unconfirmed.tone,
      purchasable: false,
      disabledReason: copy.karaoke.slotDetail.disabledReason.UNCONFIRMED,
    };
  }
  if (item.purchasable) return purchasableStatus();
  const presented = presentPurchaseReasons(item.reasons, item.maxPurchasableQuantity);
  return {
    stateLabel: presented.label,
    description: presented.description,
    tone: presented.tone,
    purchasable: false,
    disabledReason: disabledReasonOf(item),
  };
}

function describeState(data: KaraokeSlotDetail, eligibility: EligibilityInput): Status {
  const reasons = copy.karaoke.slotDetail.disabledReason;
  if (data.state !== "AVAILABLE") {
    const presented = presentSlot(data.state);
    return {
      stateLabel: presented.label,
      description: presented.description,
      tone: presented.tone,
      purchasable: false,
      disabledReason: reasons[data.state],
    };
  }
  if (data.saleStatus !== "ON_SALE") {
    const sale = presentKaraokeSaleStatus(data.saleStatus);
    return {
      stateLabel: sale.label,
      description: sale.description,
      tone: sale.tone,
      purchasable: false,
      disabledReason: reasons.NOT_ON_SALE,
    };
  }
  if (data.purchasable !== true) {
    return {
      stateLabel: copy.karaoke.slotDetail.notPurchasableLabel,
      description: copy.karaoke.slotDetail.notPurchasableDescription,
      tone: "neutral",
      purchasable: false,
      disabledReason: reasons.NOT_PURCHASABLE,
    };
  }
  return narrowByEligibility(data, eligibility);
}

export function buildKaraokeSlotModel(
  input: Loadable<KaraokeSlotDetail>,
  eligibility: EligibilityInput = { kind: "not_applicable" },
): KaraokeSlotModel {
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
      const data = input.data;
      return {
        kind: "ready",
        slotRef: data.slotRef,
        dateText: formatBusinessDate(data.date),
        timeText: formatJstTimeRange(data.usageStart, data.usageEnd),
        priceText: formatMoney(data.price),
        ...describeState(data, eligibility),
        dayHref: karaokeDayHref(data.date),
      };
    }
    default:
      return assertNever(input);
  }
}
