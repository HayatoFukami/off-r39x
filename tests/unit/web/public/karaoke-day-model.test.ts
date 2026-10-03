import type { KaraokeSlotState } from "@off-r39x/domain";
import { describe, expect, it } from "vitest";
import type {
  BusinessDateJst,
  KaraokeBucket,
  KaraokeDay,
  KaraokeSaleStatus,
  Ref,
  UtcInstant,
} from "../../../../apps/web/src/api-client/types.ts";
import {
  type BucketModel,
  buildKaraokeDayModel,
  type KaraokeDayModel,
} from "../../../../apps/web/src/features/karaoke/karaoke-day-model.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { formatBusinessDate } from "../../../../apps/web/src/presentation/format/datetime.ts";
import { createBackend, okData } from "../../../harness/mock-backend.ts";
import { D1, D2, SLOT, slotRef } from "../../../harness/mock-seed.ts";

// Contract: tests/contracts/s4-public.md section 2.9 (SPEC-050 13.2, 20.3, 25, 33, INV-010-04, TST-DAT-007/008).

type Ready = Extract<KaraokeDayModel, { kind: "ready" }>;

function readyOf(model: KaraokeDayModel): Ready {
  if (model.kind !== "ready") throw new Error(`expected ready but got ${model.kind}`);
  return model;
}

async function seedDay(
  date: BusinessDateJst,
  saleStatus: KaraokeSaleStatus = "ON_SALE",
): Promise<KaraokeDay> {
  const backend = createBackend();
  backend.setScenario({ karaokeSales: saleStatus });
  return okData(await backend.api.public.getKaraokeDay(date));
}

const slotsOf = (buckets: readonly BucketModel[]) => buckets.flatMap((b) => b.slots);
const modelSlot = (model: Ready, ref: Ref<"slot">) =>
  slotsOf(model.buckets).find((s) => s.slotRef === ref);

const slot = (hhmm: string, state: KaraokeSlotState, n: number) => {
  const startMs = Date.parse(`2027-03-08T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00+09:00`);
  return {
    slotRef: slotRef(1, String(n).padStart(4, "0")),
    usageStart: new Date(startMs).toISOString().replace(".000Z", "Z") as UtcInstant,
    usageEnd: new Date(startMs + 15 * 60_000).toISOString().replace(".000Z", "Z") as UtcInstant,
    state,
  };
};

const day = (buckets: readonly KaraokeBucket[], patch: Partial<KaraokeDay> = {}): KaraokeDay => ({
  date: D1,
  saleStatus: "ON_SALE",
  buckets,
  previousDate: null,
  nextDate: D2,
  ...patch,
});

describe("TC-PG-KRK-002-601 day model buckets and slot times (SPEC-050 13.2, TST-DAT-007/008)", () => {
  it("builds the seed day D1 as five 1-hour buckets with n / m counts as text", async () => {
    const model = readyOf(buildKaraokeDayModel({ kind: "ok", data: await seedDay(D1) }));
    expect(model.date).toBe(D1);
    expect(model.dateText).toBe(formatBusinessDate(D1));
    expect(
      model.buckets.map((b) => [b.startHour, b.label, b.totalSlots, b.availableSlots, b.countText]),
    ).toEqual([
      [10, "10:00-11:00", 3, 1, copy.karaoke.day.bucketCount(1, 3)],
      [11, "11:00-12:00", 3, 3, copy.karaoke.day.bucketCount(3, 3)],
      [12, "12:00-13:00", 3, 0, copy.karaoke.day.bucketCount(0, 3)],
      [13, "13:00-14:00", 1, 1, copy.karaoke.day.bucketCount(1, 1)],
      [14, "14:00-15:00", 1, 0, copy.karaoke.day.bucketCount(0, 1)],
    ]);
  });

  it("shows each slot's usage start and end in JST, 15 minutes apart", async () => {
    const model = readyOf(buildKaraokeDayModel({ kind: "ok", data: await seedDay(D1) }));
    expect(modelSlot(model, SLOT.d1_1000)?.timeText).toBe("10:00-10:15");
    expect(modelSlot(model, SLOT.d1_1020)?.timeText).toBe("10:20-10:35");
    expect(modelSlot(model, SLOT.d1_1240)?.timeText).toBe("12:40-12:55");
  });

  it("keeps a slot that starts at 08:40 JST (23:40 UTC the day before) in the 8 o'clock bucket", async () => {
    const model = readyOf(buildKaraokeDayModel({ kind: "ok", data: await seedDay(D2) }));
    expect(model.buckets.map((b) => [b.startHour, b.label, b.countText])).toEqual([
      [8, "08:00-09:00", copy.karaoke.day.bucketCount(1, 1)],
      [9, "09:00-10:00", copy.karaoke.day.bucketCount(1, 1)],
    ]);
    expect(modelSlot(model, SLOT.d2_0840)?.timeText).toBe("08:40-08:55");
    expect(modelSlot(model, SLOT.d2_0900)?.timeText).toBe("09:00-09:15");
  });

  it("labels the last hour of the day as 23:00-24:00", () => {
    const model = readyOf(
      buildKaraokeDayModel({
        kind: "ok",
        data: day([
          {
            startHour: 23,
            totalSlots: 1,
            availableSlots: 1,
            slots: [slot("2300", "AVAILABLE", 1)],
          },
        ]),
      }),
    );
    expect(model.buckets[0]?.label).toBe("23:00-24:00");
  });

  it("sorts buckets by hour and slots by start time even if the port order is shuffled", () => {
    const model = readyOf(
      buildKaraokeDayModel({
        kind: "ok",
        data: day([
          {
            startHour: 11,
            totalSlots: 1,
            availableSlots: 1,
            slots: [slot("1100", "AVAILABLE", 3)],
          },
          {
            startHour: 10,
            totalSlots: 2,
            availableSlots: 2,
            slots: [slot("1040", "AVAILABLE", 2), slot("1000", "AVAILABLE", 1)],
          },
        ]),
      }),
    );
    expect(model.buckets.map((b) => b.startHour)).toEqual([10, 11]);
    expect(model.buckets[0]?.slots.map((s) => s.timeText)).toEqual(["10:00-10:15", "10:40-10:55"]);
  });

  it("shows a slot only once even if the port repeats it in two buckets (SPEC-050 13.2)", () => {
    const shared = slot("1055", "AVAILABLE", 7);
    const model = readyOf(
      buildKaraokeDayModel({
        kind: "ok",
        data: day([
          { startHour: 10, totalSlots: 1, availableSlots: 1, slots: [shared] },
          { startHour: 11, totalSlots: 1, availableSlots: 1, slots: [shared] },
        ]),
      }),
    );
    expect(slotsOf(model.buckets).filter((s) => s.slotRef === shared.slotRef)).toHaveLength(1);
  });

  it("never lists one slot ref twice across the seed buckets", async () => {
    const model = readyOf(buildKaraokeDayModel({ kind: "ok", data: await seedDay(D1) }));
    const refs = slotsOf(model.buckets).map((s) => s.slotRef);
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs).toHaveLength(11);
  });
});

describe("TC-PG-KRK-002-602 day model slot states are text-distinct and only AVAILABLE is selectable (SPEC-050 13.2, 20.3, 25)", () => {
  it("makes only AVAILABLE slots selectable, each linking to its slot detail", async () => {
    const model = readyOf(buildKaraokeDayModel({ kind: "ok", data: await seedDay(D1) }));
    for (const s of slotsOf(model.buckets)) {
      const seeded = [
        SLOT.d1_1000,
        SLOT.d1_1100,
        SLOT.d1_1120,
        SLOT.d1_1140,
        SLOT.d1_1300,
      ].includes(s.slotRef);
      expect(s.selectable, s.slotRef).toBe(seeded);
      expect(s.href, s.slotRef).toBe(seeded ? `/karaoke/slots/${s.slotRef}` : null);
    }
  });

  it("labels the four states with four different texts from the shared copy", async () => {
    const model = readyOf(buildKaraokeDayModel({ kind: "ok", data: await seedDay(D1) }));
    expect(modelSlot(model, SLOT.d1_1000)?.stateLabel).toBe(copy.karaoke.slot.label.AVAILABLE);
    expect(modelSlot(model, SLOT.d1_1020)?.stateLabel).toBe(copy.karaoke.slot.label.HELD);
    expect(modelSlot(model, SLOT.d1_1040)?.stateLabel).toBe(copy.karaoke.slot.label.SOLD);
    expect(modelSlot(model, SLOT.d1_1200)?.stateLabel).toBe(copy.karaoke.slot.label.SALES_STOPPED);
    const labels = [SLOT.d1_1000, SLOT.d1_1020, SLOT.d1_1040, SLOT.d1_1200].map(
      (ref) => modelSlot(model, ref)?.stateLabel,
    );
    expect(new Set(labels).size).toBe(4);
    for (const s of slotsOf(model.buckets)) {
      expect(s.stateLabel.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it("does not call an AVAILABLE slot 'selectable' while the sale is not running", async () => {
    for (const status of ["BEFORE_SALES", "SALES_ENDED", "SUSPENDED"] as const) {
      const model = readyOf(buildKaraokeDayModel({ kind: "ok", data: await seedDay(D1, status) }));
      expect(model.saleStatus.onSale, status).toBe(false);
      for (const s of slotsOf(model.buckets)) {
        expect(s.selectable, `${status} ${s.slotRef}`).toBe(false);
        expect(s.href, `${status} ${s.slotRef}`).toBeNull();
        expect(s.stateLabel, `${status} ${s.slotRef}`).not.toBe(copy.karaoke.slot.label.AVAILABLE);
      }
      // The AVAILABLE seed slot reads as the sale status, not as a free slot.
      expect(modelSlot(model, SLOT.d1_1000)?.stateLabel).toBe(model.saleStatus.label);
      // SOLD / HELD stay themselves under any sale status.
      expect(modelSlot(model, SLOT.d1_1040)?.stateLabel).toBe(copy.karaoke.slot.label.SOLD);
      expect(modelSlot(model, SLOT.d1_1020)?.stateLabel).toBe(copy.karaoke.slot.label.HELD);
    }
  });

  it("reports zero candidates in every bucket when the sale is not running", async () => {
    const model = readyOf(
      buildKaraokeDayModel({ kind: "ok", data: await seedDay(D1, "SUSPENDED") }),
    );
    for (const b of model.buckets) {
      expect(b.availableSlots).toBe(0);
      expect(b.countText).toBe(copy.karaoke.day.bucketCount(0, b.totalSlots));
    }
  });
});

describe("TC-PG-KRK-002-603 day model navigation, empty, loading and failure (SPEC-050 13.2, 9, 21)", () => {
  it("links to the previous / next sales date only where one exists", async () => {
    const first = readyOf(buildKaraokeDayModel({ kind: "ok", data: await seedDay(D1) }));
    expect(first.previous).toBeNull();
    expect(first.next).toEqual({
      date: D2,
      href: `/karaoke/schedule/${D2}`,
      text: formatBusinessDate(D2),
    });
    const second = readyOf(buildKaraokeDayModel({ kind: "ok", data: await seedDay(D2) }));
    expect(second.previous).toEqual({
      date: D1,
      href: `/karaoke/schedule/${D1}`,
      text: formatBusinessDate(D1),
    });
    expect(second.next).toBeNull();
  });

  it("is ready with no buckets (the empty message) when a successful read has no slots", async () => {
    const backend = createBackend();
    backend.setScenario({ publicFetch: "empty" });
    const data = okData(await backend.api.public.getKaraokeDay(D1));
    expect(data.buckets).toEqual([]);
    const model = readyOf(buildKaraokeDayModel({ kind: "ok", data }));
    expect(model.buckets).toEqual([]);
    expect(model.next?.date).toBe(D2);
  });

  it("separates Not Found, loading and a failed read", () => {
    expect(buildKaraokeDayModel({ kind: "not_found" })).toEqual({ kind: "not_found" });
    expect(buildKaraokeDayModel({ kind: "loading" })).toEqual({ kind: "loading" });
    for (const kind of ["unavailable", "auth_required", "email_unverified"] as const) {
      expect(buildKaraokeDayModel({ kind }), kind).toEqual({ kind: "unavailable" });
    }
  });

  it("never turns a failed read into an empty day", async () => {
    const backend = createBackend();
    backend.setScenario({ publicFetch: "fail" });
    const model = buildKaraokeDayModel(await backend.api.public.getKaraokeDay(D1));
    expect(model).toEqual({ kind: "unavailable" });
  });

  it("contains no purchase, Cart or hold wording", async () => {
    const model = buildKaraokeDayModel({ kind: "ok", data: await seedDay(D1) });
    expect(JSON.stringify(model)).not.toMatch(/cart|カート|ttl|expires/i);
  });
});
