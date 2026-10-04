import type { KaraokeSlotState } from "@off-r39x/domain";
import { describe, expect, it } from "vitest";
import type {
  KaraokeSaleStatus,
  KaraokeSlotDetail,
  Ref,
} from "../../../../apps/web/src/api-client/types.ts";
import {
  buildKaraokeSlotModel,
  type KaraokeSlotModel,
} from "../../../../apps/web/src/features/karaoke/karaoke-slot-model.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import {
  formatBusinessDate,
  formatJstTimeRange,
} from "../../../../apps/web/src/presentation/format/datetime.ts";
import { formatMoney } from "../../../../apps/web/src/presentation/format/money.ts";
import { presentSlot } from "../../../../apps/web/src/presentation/state-mapping/karaoke.ts";
import { presentKaraokeSaleStatus } from "../../../../apps/web/src/presentation/state-mapping/karaoke-sale-status.ts";
import { createBackend, okData } from "../../../harness/mock-backend.ts";
import { D1, SLOT } from "../../../harness/mock-seed.ts";

// Contract: tests/contracts/s7b-karaoke.md section 3.2 (SPEC-050 13.3 state / action table, 20.3, INV-010-04).

type Ready = Extract<KaraokeSlotModel, { kind: "ready" }>;
const detail = copy.karaoke.slotDetail;

function readyOf(model: KaraokeSlotModel): Ready {
  if (model.kind !== "ready") throw new Error(`expected ready but got ${model.kind}`);
  return model;
}

async function seeded(
  slot: Ref<"slot">,
  saleStatus: KaraokeSaleStatus = "ON_SALE",
): Promise<KaraokeSlotDetail> {
  const backend = createBackend();
  backend.setScenario({ karaokeSales: saleStatus });
  return okData(await backend.api.public.getKaraokeSlot(slot));
}

const build = (data: KaraokeSlotDetail): Ready =>
  readyOf(buildKaraokeSlotModel({ kind: "ok", data }));

describe("TC-PG-KRK-003-611 the read result decides the model kind and the facts come from the port (SPEC-050 13.3 Fields, 9)", () => {
  it("maps loading and every non-ok read, keeping unavailable apart from not_found", () => {
    expect(buildKaraokeSlotModel({ kind: "loading" })).toEqual({ kind: "loading" });
    expect(buildKaraokeSlotModel({ kind: "not_found" })).toEqual({ kind: "not_found" });
    for (const kind of ["unavailable", "auth_required", "email_unverified"] as const) {
      expect(buildKaraokeSlotModel({ kind }), kind).toEqual({ kind: "unavailable" });
    }
  });

  it("formats the date, the JST time range and the price through the shared formatters", async () => {
    const data = await seeded(SLOT.d1_1000);
    const model = build(data);
    expect(model.slotRef).toBe(SLOT.d1_1000);
    expect(model.dateText).toBe(formatBusinessDate(D1));
    expect(model.timeText).toBe(formatJstTimeRange(data.usageStart, data.usageEnd));
    expect(model.timeText).toBe("10:00-10:15");
    expect(model.priceText).toBe(formatMoney(data.price));
    expect(model.priceText).toBe("¥1,000");
    expect(model.dayHref).toBe(`/karaoke/schedule/${D1}`);
  });

  it("does not mutate its input and never throws", async () => {
    const data = await seeded(SLOT.d1_1000);
    const before = JSON.stringify(data);
    build(data);
    expect(JSON.stringify(data)).toBe(before);
  });
});

describe("TC-PG-KRK-003-612 an AVAILABLE slot under an ON_SALE sale is purchasable and says so (SPEC-050 13.3 table row 1)", () => {
  it("shows the purchasable label and description, with no disabled reason", async () => {
    const model = build(await seeded(SLOT.d1_1000));
    expect(model.purchasable).toBe(true);
    expect(model.disabledReason).toBeNull();
    expect(model.stateLabel).toBe(detail.purchasableLabel);
    expect(model.description).toBe(detail.purchasableDescription);
    expect(model.tone).toBe(presentSlot("AVAILABLE").tone);
  });
});

describe("TC-PG-KRK-003-613 HELD, SOLD and SALES_STOPPED are shown by their own text and are never purchasable (SPEC-050 13.3 table, 20.3, INV-010-04)", () => {
  it.each([
    ["HELD", SLOT.d1_1020],
    ["SOLD", SLOT.d1_1040],
    ["SALES_STOPPED", SLOT.d1_1200],
  ] as const)("%s uses presentSlot and a state-specific reason", async (state, slot) => {
    const data = await seeded(slot);
    expect(data.state).toBe(state);
    const model = build(data);
    const presented = presentSlot(state);
    expect(model.purchasable).toBe(false);
    expect(model.stateLabel).toBe(presented.label);
    expect(model.description).toBe(presented.description);
    expect(model.tone).toBe(presented.tone);
    expect(model.disabledReason).toBe(detail.disabledReason[state]);
    expect(model.stateLabel).not.toBe(detail.purchasableLabel);
  });

  it("keeps the slot state even when the sale is not ON_SALE (the slot state wins)", async () => {
    const model = build(await seeded(SLOT.d1_1020, "SUSPENDED"));
    expect(model.stateLabel).toBe(copy.karaoke.slot.label.HELD);
    expect(model.disabledReason).toBe(detail.disabledReason.HELD);
  });

  it("the four state labels shown to the user are all different (text, not colour alone)", async () => {
    const labels = [
      build(await seeded(SLOT.d1_1000)).stateLabel,
      build(await seeded(SLOT.d1_1020)).stateLabel,
      build(await seeded(SLOT.d1_1040)).stateLabel,
      build(await seeded(SLOT.d1_1200)).stateLabel,
    ];
    expect(new Set(labels).size).toBe(4);
  });
});

describe("TC-PG-KRK-003-614 an AVAILABLE slot outside the sales period or under a suspension is not purchasable (SPEC-050 13.3 table last row, 13.2)", () => {
  it.each(["BEFORE_SALES", "SALES_ENDED", "SUSPENDED"] as const)(
    "%s shows the sale status and never the purchasable label",
    async (status) => {
      const data = await seeded(SLOT.d1_1000, status);
      expect(data.state).toBe("AVAILABLE");
      const model = build(data);
      const presented = presentKaraokeSaleStatus(status);
      expect(model.purchasable).toBe(false);
      expect(model.stateLabel).toBe(presented.label);
      expect(model.description).toBe(presented.description);
      expect(model.tone).toBe(presented.tone);
      expect(model.disabledReason).toBe(detail.disabledReason.NOT_ON_SALE);
      expect(model.stateLabel).not.toBe(detail.purchasableLabel);
      expect(model.stateLabel).not.toBe(copy.karaoke.slot.label.AVAILABLE);
    },
  );

  it("purchasable and disabledReason are always consistent", async () => {
    for (const slot of [SLOT.d1_1000, SLOT.d1_1020, SLOT.d1_1040, SLOT.d1_1200]) {
      for (const sale of ["ON_SALE", "BEFORE_SALES", "SALES_ENDED", "SUSPENDED"] as const) {
        const model = build(await seeded(slot, sale));
        expect(model.purchasable === (model.disabledReason === null), `${slot} ${sale}`).toBe(true);
      }
    }
  });

  it("defends against an inconsistent port flag: purchasable true on a non-AVAILABLE or non-ON_SALE slot stays false (INV-010-04)", async () => {
    const base = await seeded(SLOT.d1_1000);
    for (const state of ["HELD", "SOLD", "SALES_STOPPED"] as KaraokeSlotState[]) {
      const model = build({ ...base, state, purchasable: true });
      expect(model.purchasable, state).toBe(false);
      expect(model.disabledReason, state).not.toBeNull();
    }
    const suspended = build({ ...base, saleStatus: "SUSPENDED", purchasable: true });
    expect(suspended.purchasable).toBe(false);
    expect(suspended.disabledReason).not.toBeNull();
  });
});
