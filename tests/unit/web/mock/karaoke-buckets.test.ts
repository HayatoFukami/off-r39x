import type { KaraokeSlotState } from "@off-r39x/domain";
import { describe, expect, it } from "vitest";
import type { Ref, UtcInstant } from "../../../../apps/web/src/api-client/types.ts";
import {
  type BucketInputSlot,
  buildKaraokeBuckets,
  filterSlotsByBusinessDate,
} from "../../../../apps/web/src/mock/backend/karaoke-buckets.ts";
import { jstDate, utc } from "../../../harness/presentation.ts";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

function slot(id: string, start: string, state: KaraokeSlotState): BucketInputSlot {
  const end = new Date(Date.parse(start) + FIFTEEN_MIN_MS).toISOString().replace(".000Z", "Z");
  return {
    slotRef: id as Ref<"slot">,
    usageStart: utc(start) as UtcInstant,
    usageEnd: utc(end),
    state,
  };
}

describe("TC-PG-KRK-002-101 buildKaraokeBuckets: JST half-open hour buckets (SPEC-050 13.2, TST-DAT-007/008)", () => {
  it("puts 10:00 <= usage_start < 11:00 JST into the 10 o'clock bucket and 11:00 into the next", () => {
    // 2027-03-08 10:00 JST = 01:00Z, 10:59:59 JST = 01:59:59Z, 11:00 JST = 02:00Z.
    const slots = [
      slot("s-1000", "2027-03-08T01:00:00Z", "AVAILABLE"),
      slot("s-1059", "2027-03-08T01:59:59Z", "AVAILABLE"),
      slot("s-1100", "2027-03-08T02:00:00Z", "AVAILABLE"),
    ];
    const buckets = buildKaraokeBuckets(slots, { saleStatus: "ON_SALE" });
    expect(buckets.map((b) => b.startHour)).toEqual([10, 11]);
    expect(buckets[0]?.slots.map((s) => s.slotRef)).toEqual(["s-1000", "s-1059"]);
    expect(buckets[1]?.slots.map((s) => s.slotRef)).toEqual(["s-1100"]);
  });

  it("uses the JST hour, not the UTC hour (09:00 JST is 00:00Z; 08:59:59 JST is 23:59:59Z the day before)", () => {
    const slots = [
      slot("s-0859", "2027-03-07T23:59:59Z", "AVAILABLE"),
      slot("s-0900", "2027-03-08T00:00:00Z", "AVAILABLE"),
    ];
    const buckets = buildKaraokeBuckets(slots, { saleStatus: "ON_SALE" });
    expect(buckets.map((b) => b.startHour)).toEqual([8, 9]);
  });

  it("counts total (any state) and available (AVAILABLE only), never counting a slot twice", () => {
    const slots = [
      slot("a", "2027-03-08T01:00:00Z", "AVAILABLE"),
      slot("b", "2027-03-08T01:20:00Z", "HELD"),
      slot("c", "2027-03-08T01:40:00Z", "SOLD"),
      slot("d", "2027-03-08T02:00:00Z", "SALES_STOPPED"),
      slot("e", "2027-03-08T02:20:00Z", "AVAILABLE"),
    ];
    const buckets = buildKaraokeBuckets(slots, { saleStatus: "ON_SALE" });
    expect(buckets.map((b) => [b.startHour, b.totalSlots, b.availableSlots])).toEqual([
      [10, 3, 1],
      [11, 2, 1],
    ]);
    const all = buckets.flatMap((b) => b.slots.map((s) => s.slotRef));
    expect(all.length).toBe(new Set(all).size);
    expect(all.length).toBe(slots.length);
  });

  it("sorts buckets by hour and slots by usageStart, and creates no empty bucket", () => {
    const slots = [
      slot("late", "2027-03-08T05:00:00Z", "AVAILABLE"),
      slot("early", "2027-03-08T01:40:00Z", "AVAILABLE"),
      slot("early0", "2027-03-08T01:00:00Z", "AVAILABLE"),
    ];
    const buckets = buildKaraokeBuckets(slots, { saleStatus: "ON_SALE" });
    expect(buckets.map((b) => b.startHour)).toEqual([10, 14]);
    expect(buckets[0]?.slots.map((s) => s.slotRef)).toEqual(["early0", "early"]);
  });

  it("returns [] for no slots", () => {
    expect(buildKaraokeBuckets([], { saleStatus: "ON_SALE" })).toEqual([]);
  });

  it("reports availableSlots 0 unless the sale is ON_SALE, while totals stay", () => {
    const slots = [
      slot("a", "2027-03-08T01:00:00Z", "AVAILABLE"),
      slot("b", "2027-03-08T01:20:00Z", "AVAILABLE"),
    ];
    for (const saleStatus of ["BEFORE_SALES", "SALES_ENDED", "SUSPENDED"] as const) {
      const buckets = buildKaraokeBuckets(slots, { saleStatus });
      expect(buckets[0]?.totalSlots).toBe(2);
      expect(buckets[0]?.availableSlots).toBe(0);
    }
  });

  it("exposes each slot's own state and times in the bucket", () => {
    const only = slot("x", "2027-03-08T01:00:00Z", "HELD");
    const [bucket] = buildKaraokeBuckets([only], { saleStatus: "ON_SALE" });
    expect(bucket?.slots[0]).toEqual({
      slotRef: "x",
      usageStart: only.usageStart,
      usageEnd: only.usageEnd,
      state: "HELD",
    });
  });
});

describe("TC-PG-KRK-002-102 filterSlotsByBusinessDate uses the JST date (TST-DAT-007/008)", () => {
  const slots = [
    slot("before", "2027-03-08T14:59:59Z", "AVAILABLE"), // 03-08 23:59:59 JST
    slot("boundary", "2027-03-08T15:00:00Z", "AVAILABLE"), // 03-09 00:00:00 JST
    slot("after", "2027-03-08T15:00:01Z", "AVAILABLE"), // 03-09 00:00:01 JST
    slot("morning", "2027-03-07T23:40:00Z", "AVAILABLE"), // 03-08 08:40 JST
  ];

  it("keeps a slot at 23:59:59 JST on its own JST date", () => {
    expect(filterSlotsByBusinessDate(slots, jstDate("2027-03-08")).map((s) => s.slotRef)).toEqual([
      "before",
      "morning",
    ]);
  });

  it("moves 00:00:00 JST (15:00Z) and later to the next JST date", () => {
    expect(filterSlotsByBusinessDate(slots, jstDate("2027-03-09")).map((s) => s.slotRef)).toEqual([
      "boundary",
      "after",
    ]);
  });

  it("does not match by the UTC date", () => {
    expect(filterSlotsByBusinessDate(slots, jstDate("2027-03-07"))).toEqual([]);
  });
});
