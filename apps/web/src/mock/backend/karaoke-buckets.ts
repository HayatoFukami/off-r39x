import type { KaraokeSlotState } from "@off-r39x/domain";
import type {
  BusinessDateJst,
  KaraokeBucket,
  KaraokeSaleStatus,
  Ref,
  UtcInstant,
} from "../../api-client/types";
import { bucketStartHourJst, toBusinessDateJst } from "../../presentation/format/datetime";

export type BucketInputSlot = {
  slotRef: Ref<"slot">;
  usageStart: UtcInstant;
  usageEnd: UtcInstant;
  state: KaraokeSlotState;
};

const byUsageStart = (a: BucketInputSlot, b: BucketInputSlot): number =>
  Date.parse(a.usageStart) - Date.parse(b.usageStart);

/** Slots whose usage start falls on the given JST business date (not the UTC date), in input order. */
export function filterSlotsByBusinessDate(
  slots: readonly BucketInputSlot[],
  date: BusinessDateJst,
): BucketInputSlot[] {
  return slots.filter((slot) => toBusinessDateJst(slot.usageStart) === date);
}

/**
 * API-PUB-007: groups slots into JST half-open hour buckets [hh:00, hh+1:00) by usage start.
 * Buckets are ordered by hour and never empty. availableSlots is 0 unless the sale is ON_SALE.
 */
export function buildKaraokeBuckets(
  slots: readonly BucketInputSlot[],
  opts: { saleStatus: KaraokeSaleStatus },
): KaraokeBucket[] {
  const groups = new Map<number, BucketInputSlot[]>();
  for (const slot of slots) {
    const hour = bucketStartHourJst(slot.usageStart);
    const group = groups.get(hour);
    if (group === undefined) {
      groups.set(hour, [slot]);
    } else {
      group.push(slot);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([startHour, members]) => {
      const sorted = [...members].sort(byUsageStart);
      const availableSlots =
        opts.saleStatus === "ON_SALE" ? sorted.filter((s) => s.state === "AVAILABLE").length : 0;
      return {
        startHour,
        totalSlots: sorted.length,
        availableSlots,
        slots: sorted.map((s) => ({
          slotRef: s.slotRef,
          usageStart: s.usageStart,
          usageEnd: s.usageEnd,
          state: s.state,
        })),
      };
    });
}
