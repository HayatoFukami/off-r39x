import { assertNever } from "@off-r39x/domain";
import type { KaraokeSlotDetail, Ref } from "../../api-client/types";
import { karaokeDayHref } from "../../config/public-routes";
import type { Loadable } from "../../presentation/components/list-state";
import { copy } from "../../presentation/copy/ja";
import { formatBusinessDate, formatJstTimeRange } from "../../presentation/format/datetime";
import { formatMoney } from "../../presentation/format/money";
import { presentSlot } from "../../presentation/state-mapping/karaoke";
import { presentKaraokeSaleStatus } from "../../presentation/state-mapping/karaoke-sale-status";
import type { Tone } from "../../presentation/state-mapping/order";

// View model for PG-KRK-003 (SPEC-050 13.3). The port result decides purchasability; the flag from the
// port is double-checked here (INV-010-04) and a slot state always wins over the sale status.

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

function describeState(data: KaraokeSlotDetail): Status {
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
  return {
    stateLabel: copy.karaoke.slotDetail.purchasableLabel,
    description: copy.karaoke.slotDetail.purchasableDescription,
    tone: presentSlot("AVAILABLE").tone,
    purchasable: true,
    disabledReason: null,
  };
}

export function buildKaraokeSlotModel(input: Loadable<KaraokeSlotDetail>): KaraokeSlotModel {
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
        ...describeState(data),
        dayHref: karaokeDayHref(data.date),
      };
    }
    default:
      return assertNever(input);
  }
}
