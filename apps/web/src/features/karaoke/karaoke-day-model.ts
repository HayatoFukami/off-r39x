import type { BusinessDateJst, KaraokeDay, Ref } from "../../api-client/types";
import { karaokeDayHref, karaokeSlotHref } from "../../config/public-routes";
import type { Loadable } from "../../presentation/components/list-state";
import { copy } from "../../presentation/copy/ja";
import { formatBusinessDate, formatJstTimeRange } from "../../presentation/format/datetime";
import { presentSlot } from "../../presentation/state-mapping/karaoke";
import {
  type KaraokeSaleStatusPresentation,
  presentKaraokeSaleStatus,
} from "../../presentation/state-mapping/karaoke-sale-status";
import type { Tone } from "../../presentation/state-mapping/order";

// View model for PG-KRK-002 (SPEC-050 13.2). Counts come from the port; slot state is shown as text.

export type DayLink = { date: BusinessDateJst; href: string; text: string };

export type SlotModel = {
  slotRef: Ref<"slot">;
  href: string | null;
  timeText: string;
  stateLabel: string;
  description: string;
  tone: Tone;
  selectable: boolean;
};

export type BucketModel = {
  startHour: number;
  label: string;
  countText: string;
  totalSlots: number;
  availableSlots: number;
  slots: readonly SlotModel[];
};

export type KaraokeDayModel =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "unavailable" }
  | {
      kind: "ready";
      date: BusinessDateJst;
      dateText: string;
      saleStatus: KaraokeSaleStatusPresentation;
      previous: DayLink | null;
      next: DayLink | null;
      buckets: readonly BucketModel[];
    };

const pad = (value: number): string => String(value).padStart(2, "0");

function toDayLink(date: BusinessDateJst | null): DayLink | null {
  return date === null
    ? null
    : { date, href: karaokeDayHref(date), text: formatBusinessDate(date) };
}

function toSlotModel(
  slot: KaraokeDay["buckets"][number]["slots"][number],
  sale: KaraokeSaleStatusPresentation,
): SlotModel {
  const timeText = formatJstTimeRange(slot.usageStart, slot.usageEnd);
  if (slot.state !== "AVAILABLE") {
    const presented = presentSlot(slot.state);
    return {
      slotRef: slot.slotRef,
      href: null,
      timeText,
      stateLabel: presented.label,
      description: presented.description,
      tone: presented.tone,
      selectable: false,
    };
  }
  if (!sale.onSale) {
    // A free slot is not "selectable" unless the sale is running (SPEC-050 13.2).
    return {
      slotRef: slot.slotRef,
      href: null,
      timeText,
      stateLabel: sale.label,
      description: sale.description,
      tone: sale.tone,
      selectable: false,
    };
  }
  const presented = presentSlot("AVAILABLE");
  return {
    slotRef: slot.slotRef,
    href: karaokeSlotHref(slot.slotRef),
    timeText,
    stateLabel: presented.label,
    description: presented.description,
    tone: presented.tone,
    selectable: true,
  };
}

function buildBuckets(day: KaraokeDay, sale: KaraokeSaleStatusPresentation): BucketModel[] {
  const seen = new Set<string>();
  return [...day.buckets]
    .sort((a, b) => a.startHour - b.startHour)
    .map((bucket) => {
      const slots = [...bucket.slots]
        .sort((a, b) => Date.parse(a.usageStart) - Date.parse(b.usageStart))
        .filter((slot) => {
          // One slot is shown in one bucket only (first occurrence).
          if (seen.has(slot.slotRef)) return false;
          seen.add(slot.slotRef);
          return true;
        })
        .map((slot) => toSlotModel(slot, sale));
      return {
        startHour: bucket.startHour,
        label: `${pad(bucket.startHour)}:00-${pad(bucket.startHour + 1)}:00`,
        countText: copy.karaoke.day.bucketCount(bucket.availableSlots, bucket.totalSlots),
        totalSlots: bucket.totalSlots,
        availableSlots: bucket.availableSlots,
        slots,
      };
    });
}

export function buildKaraokeDayModel(input: Loadable<KaraokeDay>): KaraokeDayModel {
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
      const saleStatus = presentKaraokeSaleStatus(input.data.saleStatus);
      return {
        kind: "ready",
        date: input.data.date,
        dateText: formatBusinessDate(input.data.date),
        saleStatus,
        previous: toDayLink(input.data.previousDate),
        next: toDayLink(input.data.nextDate),
        buckets: buildBuckets(input.data, saleStatus),
      };
    }
    default: {
      const unreachable: never = input;
      return unreachable;
    }
  }
}
