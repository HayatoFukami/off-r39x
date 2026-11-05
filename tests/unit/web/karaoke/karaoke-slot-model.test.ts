import type { KaraokeSlotState } from "@off-r39x/domain";
import { describe, expect, it } from "vitest";
import { eligibilityTargetKey } from "../../../../apps/web/src/api-client/eligibility-target-key.ts";
import type {
  KaraokeSaleStatus,
  KaraokeSlotDetail,
  PurchaseEligibility,
  PurchaseReason,
  Ref,
} from "../../../../apps/web/src/api-client/types.ts";
import type { KaraokeSlotModel } from "../../../../apps/web/src/features/karaoke/karaoke-slot-model.ts";
import {
  buildKaraokeSlotModel,
  karaokeEligibilityTarget,
} from "../../../../apps/web/src/features/karaoke/karaoke-slot-model.ts";
import type { EligibilityInput } from "../../../../apps/web/src/features/purchase/eligibility-model.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import {
  formatBusinessDate,
  formatJstTimeRange,
} from "../../../../apps/web/src/presentation/format/datetime.ts";
import { formatMoney } from "../../../../apps/web/src/presentation/format/money.ts";
import {
  presentAvailability,
  presentPurchaseReasons,
  presentRejectionReason,
} from "../../../../apps/web/src/presentation/state-mapping/availability.ts";
import { presentSlot } from "../../../../apps/web/src/presentation/state-mapping/karaoke.ts";
import { presentKaraokeSaleStatus } from "../../../../apps/web/src/presentation/state-mapping/karaoke-sale-status.ts";
import { createBackend, okData } from "../../../harness/mock-backend.ts";
import { D1, SLOT } from "../../../harness/mock-seed.ts";
import { PURCHASE_REASONS } from "../../../harness/purchase-reasons.ts";

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

describe("TC-PG-KRK-003-615 the port purchasable flag takes part in the judgement and an inconsistent combination is not purchasable (SPEC-050 13.3, 25, INV-010-04)", () => {
  it("AVAILABLE + ON_SALE + purchasable true is purchasable with no reason", async () => {
    const model = build({ ...(await seeded(SLOT.d1_1000)), purchasable: true });
    expect(model.purchasable).toBe(true);
    expect(model.disabledReason).toBeNull();
    expect(model.stateLabel).toBe(detail.purchasableLabel);
  });

  it("AVAILABLE + ON_SALE + purchasable false is not purchasable and shows the new reason", async () => {
    const data = { ...(await seeded(SLOT.d1_1000)), purchasable: false };
    expect(data.state).toBe("AVAILABLE");
    expect(data.saleStatus).toBe("ON_SALE");
    const model = build(data);
    expect(model.purchasable).toBe(false);
    expect(model.stateLabel).toBe(detail.notPurchasableLabel);
    expect(model.description).toBe(detail.notPurchasableDescription);
    expect(model.tone).toBe("neutral");
    expect(model.disabledReason).toBe(detail.disabledReason.NOT_PURCHASABLE);
    expect(model.stateLabel).not.toBe(detail.purchasableLabel);
    expect(model.stateLabel).not.toBe(copy.karaoke.slot.label.AVAILABLE);
  });

  it.each([true, false])(
    "HELD, SOLD and SALES_STOPPED keep their own reason whatever the flag (%s)",
    async (flag) => {
      const base = await seeded(SLOT.d1_1000);
      for (const state of ["HELD", "SOLD", "SALES_STOPPED"] as const) {
        const model = build({ ...base, state, purchasable: flag });
        expect(model.purchasable, state).toBe(false);
        expect(model.disabledReason, state).toBe(detail.disabledReason[state]);
        expect(model.stateLabel, state).toBe(presentSlot(state).label);
      }
    },
  );

  it.each([true, false])(
    "AVAILABLE outside ON_SALE keeps NOT_ON_SALE whatever the flag (%s)",
    async (flag) => {
      for (const status of ["SUSPENDED", "BEFORE_SALES", "SALES_ENDED"] as const) {
        const model = build({ ...(await seeded(SLOT.d1_1000, status)), purchasable: flag });
        expect(model.purchasable, status).toBe(false);
        expect(model.disabledReason, status).toBe(detail.disabledReason.NOT_ON_SALE);
        expect(model.stateLabel, status).toBe(presentKaraokeSaleStatus(status).label);
      }
    },
  );

  it("purchasable is true exactly when disabledReason is null, for every combination", async () => {
    const base = await seeded(SLOT.d1_1000);
    for (const state of ["AVAILABLE", "HELD", "SOLD", "SALES_STOPPED"] as KaraokeSlotState[]) {
      for (const saleStatus of ["ON_SALE", "BEFORE_SALES", "SALES_ENDED", "SUSPENDED"] as const) {
        for (const flag of [true, false]) {
          const model = build({ ...base, state, saleStatus, purchasable: flag });
          expect(
            model.purchasable === (model.disabledReason === null),
            `${state} ${saleStatus} ${flag}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("TC-PG-KRK-003-616 buildKaraokeSlotModel narrows a publicly purchasable slot by the owner-scoped eligibility and fails closed; karaokeEligibilityTarget (B4c, FR-KRK-007, BR-KRK-003, KRK-AVL-003, SEC-API-029, API-PUR-ELG-001, SPEC-050 12.1 / 13.3)", () => {
  const KEY = eligibilityTargetKey({ kind: "KARAOKE", slotRef: SLOT.d1_1000, quantity: 1 });
  const item = (over: Partial<PurchaseEligibility> = {}): PurchaseEligibility => ({
    lineKey: KEY,
    purchasable: true,
    reasons: [],
    maxPurchasableQuantity: 1,
    ...over,
  });
  const answer = (over: Partial<PurchaseEligibility> = {}): EligibilityInput => ({
    kind: "ok",
    data: [item(over)],
  });
  const refused = (reasons: readonly PurchaseReason[], max = 0): EligibilityInput =>
    answer({ purchasable: false, reasons, maxPurchasableQuantity: max });
  const buildWith = (data: KaraokeSlotDetail, eligibility: EligibilityInput): Ready =>
    readyOf(buildKaraokeSlotModel({ kind: "ok", data }, eligibility));
  const UNCONFIRMED = presentAvailability({ kind: "unavailable" });

  const everyAnswer: EligibilityInput[] = [
    { kind: "not_applicable" },
    { kind: "loading" },
    { kind: "unavailable" },
    { kind: "ok", data: [] },
    answer(),
    refused(["PURCHASE_LIMIT_EXCEEDED"]),
  ];

  it("(a) keeps the public model, to the last field, for a slot that is not purchasable publicly, whatever the owner answer is (it cannot improve)", async () => {
    const base = await seeded(SLOT.d1_1000);
    const datas: KaraokeSlotDetail[] = [
      await seeded(SLOT.d1_1020),
      await seeded(SLOT.d1_1040),
      await seeded(SLOT.d1_1200),
      await seeded(SLOT.d1_1000, "BEFORE_SALES"),
      await seeded(SLOT.d1_1000, "SALES_ENDED"),
      await seeded(SLOT.d1_1000, "SUSPENDED"),
      { ...base, purchasable: false },
    ];
    for (const data of datas) {
      const publicModel = build(data);
      expect(publicModel.purchasable).toBe(false);
      for (const eligibility of everyAnswer) {
        expect(
          buildWith(data, eligibility),
          `${data.state} ${data.saleStatus} ${eligibility.kind}`,
        ).toEqual(publicModel);
      }
    }
  });

  it("(b) is the public model for not_applicable (Guest and unverified: public conditions only) and when the second argument is omitted", async () => {
    const data = await seeded(SLOT.d1_1000);
    const publicModel = build(data);
    expect(buildWith(data, { kind: "not_applicable" })).toEqual(publicModel);
    expect(publicModel.stateLabel).toBe(detail.purchasableLabel);
    expect(publicModel.purchasable).toBe(true);
  });

  it.each([
    ["loading", { kind: "loading" }],
    ["unavailable", { kind: "unavailable" }],
    ["an ok answer without any item", { kind: "ok", data: [] }],
    ["an ok answer with the item of another slot only", answer({ lineKey: "KARAOKE:other" })],
    ["a purchasable item whose maximum is 0 (inconsistent)", answer({ maxPurchasableQuantity: 0 })],
  ] as const)(
    "(c) is 'cannot confirm' with the button disabled for a publicly purchasable slot when the answer is %s",
    async (_name, eligibility) => {
      const data = await seeded(SLOT.d1_1000);
      const publicModel = build(data);
      const model = buildWith(data, eligibility);
      expect(model.stateLabel).toBe(copy.availability.label.UNAVAILABLE);
      expect(model.description).toBe(copy.availability.description.UNAVAILABLE);
      expect(model.tone).toBe(UNCONFIRMED.tone);
      expect(model.tone).toBe("review");
      expect(model.purchasable).toBe(false);
      expect(model.disabledReason).toBe(copy.karaoke.slotDetail.disabledReason.UNCONFIRMED);
      expect(model.stateLabel).not.toBe(detail.purchasableLabel);
      expect(model.description).not.toBe(detail.purchasableDescription);
      // The facts of the public read stay shown.
      expect({
        ...model,
        stateLabel: "",
        description: "",
        tone: "",
        purchasable: null,
        disabledReason: null,
      }).toEqual({
        ...publicModel,
        stateLabel: "",
        description: "",
        tone: "",
        purchasable: null,
        disabledReason: null,
      });
    },
  );

  it("(d) is the purchasable model when the owner answer is purchasable with a maximum of at least 1", async () => {
    const data = await seeded(SLOT.d1_1000);
    const model = buildWith(data, answer());
    expect(model).toEqual(build(data));
    expect(model.stateLabel).toBe(detail.purchasableLabel);
    expect(model.purchasable).toBe(true);
    expect(model.disabledReason).toBeNull();
  });

  it("(e) shows 'purchase limit' before the purchase start, with its own reason text", async () => {
    const data = await seeded(SLOT.d1_1000);
    const presented = presentPurchaseReasons(["PURCHASE_LIMIT_EXCEEDED"], 0);
    const model = buildWith(data, refused(["PURCHASE_LIMIT_EXCEEDED"]));
    expect(model.stateLabel).toBe(copy.availability.label.PURCHASE_LIMIT_EXCEEDED);
    expect(model.description).toBe(presented.description);
    expect(model.tone).toBe(presented.tone);
    expect(model.purchasable).toBe(false);
    expect(model.disabledReason).toBe(
      copy.karaoke.slotDetail.disabledReason.PURCHASE_LIMIT_EXCEEDED,
    );
    expect(model.disabledReason).not.toBe(detail.failure.limit);
    expect(model.stateLabel).not.toBe(detail.purchasableLabel);
  });

  it.each([
    ["NOT_PUBLIC_OR_NOT_FOUND", "NOT_PURCHASABLE"],
    ["SALES_NOT_STARTED", "NOT_ON_SALE"],
    ["SALES_CLOSED", "NOT_ON_SALE"],
    ["SALES_STOPPED", "NOT_ON_SALE"],
    ["SOLD_OUT", "NOT_PURCHASABLE"],
    ["INSUFFICIENT_QUANTITY", "NOT_PURCHASABLE"],
    ["PURCHASE_LIMIT_EXCEEDED", "PURCHASE_LIMIT_EXCEEDED"],
    ["SLOT_UNAVAILABLE", "NOT_PURCHASABLE"],
    ["PAYMENT_WINDOW_TOO_SHORT", "NOT_PURCHASABLE"],
  ] as const)(
    "(f) maps the single reason %s to its label and to the disabled reason %s",
    async (code, reasonKey) => {
      const data = await seeded(SLOT.d1_1000);
      const model = buildWith(data, refused([code]));
      expect(model.stateLabel).toBe(presentRejectionReason(code).label);
      expect(model.description).toBe(presentRejectionReason(code).description);
      expect(model.purchasable).toBe(false);
      expect(model.disabledReason).toBe(copy.karaoke.slotDetail.disabledReason[reasonKey]);
    },
  );

  it("(f) covers every reason code of API-PUR-ELG-001 (the table above lists all nine)", () => {
    expect(PURCHASE_REASONS).toHaveLength(9);
  });

  it("(g) decides the disabled reason by the first reason and lists every description in the received order", async () => {
    const data = await seeded(SLOT.d1_1000);
    const reasons = ["SALES_STOPPED", "PURCHASE_LIMIT_EXCEEDED", "SLOT_UNAVAILABLE"] as const;
    const model = buildWith(data, refused(reasons));
    expect(model.stateLabel).toBe(copy.availability.label.SUSPENDED);
    expect(model.disabledReason).toBe(copy.karaoke.slotDetail.disabledReason.NOT_ON_SALE);
    const positions = reasons.map((code) =>
      model.description.indexOf(presentRejectionReason(code).description),
    );
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(model.description).toBe(presentPurchaseReasons(reasons, 0).description);
  });

  it("(h) purchasable is true exactly when disabledReason is null, for every public situation and every owner answer", async () => {
    const base = await seeded(SLOT.d1_1000);
    const answers: EligibilityInput[] = [
      ...everyAnswer,
      answer({ maxPurchasableQuantity: 0 }),
      ...PURCHASE_REASONS.map((code) => refused([code])),
    ];
    for (const state of ["AVAILABLE", "HELD", "SOLD", "SALES_STOPPED"] as KaraokeSlotState[]) {
      for (const saleStatus of ["ON_SALE", "BEFORE_SALES", "SALES_ENDED", "SUSPENDED"] as const) {
        for (const flag of [true, false]) {
          for (const eligibility of answers) {
            const model = buildWith({ ...base, state, saleStatus, purchasable: flag }, eligibility);
            expect(
              model.purchasable === (model.disabledReason === null),
              `${state} ${saleStatus} ${flag} ${eligibility.kind}`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("(i) keeps loading, not_found and unavailable as they are whatever the owner answer is", () => {
    for (const eligibility of everyAnswer) {
      expect(buildKaraokeSlotModel({ kind: "loading" }, eligibility)).toEqual({ kind: "loading" });
      expect(buildKaraokeSlotModel({ kind: "not_found" }, eligibility)).toEqual({
        kind: "not_found",
      });
      for (const kind of ["unavailable", "auth_required", "email_unverified"] as const) {
        expect(buildKaraokeSlotModel({ kind }, eligibility)).toEqual({ kind: "unavailable" });
      }
    }
  });

  it("karaokeEligibilityTarget is the quantity-1 KARAOKE target of a slot that is purchasable publicly, and null otherwise", async () => {
    const data = await seeded(SLOT.d1_1000);
    expect(karaokeEligibilityTarget({ kind: "ok", data })).toEqual({
      kind: "KARAOKE",
      slotRef: SLOT.d1_1000,
      quantity: 1,
    });
    for (const other of [
      await seeded(SLOT.d1_1020),
      await seeded(SLOT.d1_1040),
      await seeded(SLOT.d1_1200),
      await seeded(SLOT.d1_1000, "BEFORE_SALES"),
      await seeded(SLOT.d1_1000, "SALES_ENDED"),
      await seeded(SLOT.d1_1000, "SUSPENDED"),
      { ...data, purchasable: false },
    ]) {
      expect(
        karaokeEligibilityTarget({ kind: "ok", data: other }),
        `${other.state} ${other.saleStatus}`,
      ).toBeNull();
    }
    for (const input of [
      { kind: "loading" },
      { kind: "not_found" },
      { kind: "unavailable" },
      { kind: "auth_required" },
      { kind: "email_unverified" },
    ] as const) {
      expect(karaokeEligibilityTarget(input), input.kind).toBeNull();
    }
  });

  it("does not mutate its inputs", async () => {
    const data = Object.freeze(await seeded(SLOT.d1_1000));
    const eligibility = Object.freeze(refused(["PURCHASE_LIMIT_EXCEEDED"]));
    const before = JSON.stringify([data, eligibility]);
    buildWith(data, eligibility);
    karaokeEligibilityTarget({ kind: "ok", data });
    expect(JSON.stringify([data, eligibility])).toBe(before);
  });
});
