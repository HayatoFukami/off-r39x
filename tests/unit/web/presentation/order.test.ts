import { ORDER_STATES, type OrderState } from "@off-r39x/domain";
import { describe, expect, it } from "vitest";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import {
  orderActionLabel,
  presentOrderState,
  visibleEntitlements,
} from "../../../../apps/web/src/presentation/state-mapping/order.ts";
import { stringLeaves, TONES } from "../../../harness/presentation.ts";

// Expected values are hardcoded from SPEC-050 section 16.4 (labels / actions) and
// section 20.1 (category / entitlement display). They are never imported from the implementation.
const EXPECTED: Record<
  OrderState,
  {
    label: string;
    category: string;
    tone: string;
    showsEntitlements: boolean;
    actions: string[];
  }
> = {
  PREPARED: {
    label: "支払い手続き未開始 / 準備済み",
    category: "pending_retryable",
    tone: "pending",
    showsEntitlements: false,
    actions: ["retry_checkout"],
  },
  AWAITING_PAYMENT: {
    label: "支払い結果を確認中",
    category: "pending",
    tone: "pending",
    showsEntitlements: false,
    actions: ["recheck_status"],
  },
  CONFIRMED: {
    label: "購入確定",
    category: "success",
    tone: "success",
    showsEntitlements: true,
    actions: ["view_purchase", "view_entitlements"],
  },
  PAYMENT_FAILED: {
    label: "支払い不成立",
    category: "terminal_failure",
    tone: "failure",
    showsEntitlements: false,
    actions: ["purchase_again"],
  },
  CANCELED: {
    label: "購入手続き取消済み",
    category: "terminal",
    tone: "neutral",
    showsEntitlements: false,
    actions: ["purchase_again"],
  },
  EXPIRED: {
    label: "購入手続き失効",
    category: "terminal",
    tone: "neutral",
    showsEntitlements: false,
    actions: ["purchase_again"],
  },
  REVIEW_REQUIRED: {
    label: "購入状態を確認中",
    category: "recovery_pending",
    tone: "review",
    showsEntitlements: false,
    actions: ["recheck_status"],
  },
};

describe("TC-PG-XFN-001-001 presentOrderState (SPEC-050 16.4 / 20.1)", () => {
  it.each(ORDER_STATES)(
    "%s matches the SPEC-050 primary label, category, tone and actions",
    (state) => {
      const presented = presentOrderState(state);
      const expected = EXPECTED[state];
      expect(presented.label).toBe(expected.label);
      expect(presented.category).toBe(expected.category);
      expect(presented.tone).toBe(expected.tone);
      expect(presented.showsEntitlements).toBe(expected.showsEntitlements);
      expect([...presented.actions]).toEqual(expected.actions);
      expect(presented.description.length).toBeGreaterThan(0);
      expect(TONES).toContain(presented.tone);
    },
  );

  it("covers every canonical Order state in the expectation table", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ORDER_STATES].sort());
  });

  it("gives all 7 states distinct labels and 6 distinct categories (CANCELED / EXPIRED share terminal)", () => {
    const presented = ORDER_STATES.map((s) => presentOrderState(s));
    expect(new Set(presented.map((p) => p.label)).size).toBe(7);
    expect(new Set(presented.map((p) => p.category)).size).toBe(6);
  });

  it("shows entitlements only for CONFIRMED (INV-010-07)", () => {
    const shown = ORDER_STATES.filter((s) => presentOrderState(s).showsEntitlements);
    expect(shown).toEqual(["CONFIRMED"]);
  });

  it.each(["AWAITING_PAYMENT", "REVIEW_REQUIRED"] as const)(
    "%s offers no purchase-again, checkout retry or entitlement action (SPEC-050 16.4 / 21)",
    (state) => {
      const actions = presentOrderState(state).actions;
      expect(actions).toEqual(["recheck_status"]);
      expect(actions).not.toContain("purchase_again");
      expect(actions).not.toContain("retry_checkout");
      expect(actions).not.toContain("view_entitlements");
    },
  );

  it("never presents a non-CONFIRMED state with a success tone or the success label", () => {
    for (const state of ORDER_STATES) {
      if (state === "CONFIRMED") continue;
      const presented = presentOrderState(state);
      expect(presented.tone).not.toBe("success");
      expect(presented.category).not.toBe("success");
      expect(presented.label).not.toBe("購入確定");
    }
  });

  it("returns only labels and descriptions that exist in the copy dictionary", () => {
    const dictionary = new Set(stringLeaves(copy));
    for (const state of ORDER_STATES) {
      const presented = presentOrderState(state);
      expect(dictionary.has(presented.label), `${state} label`).toBe(true);
      expect(dictionary.has(presented.description), `${state} description`).toBe(true);
    }
  });

  it("fails closed on an unknown runtime state (assertNever)", () => {
    expect(() => presentOrderState("SOMETHING_NEW" as OrderState)).toThrow(/Unexpected value/);
  });
});

describe("TC-PG-XFN-001-001 orderActionLabel", () => {
  it.each([
    ["retry_checkout", "支払い開始を再試行"],
    ["recheck_status", "状態を再確認"],
    ["view_purchase", "購入内容を見る"],
    ["view_entitlements", "Ticket / Reservation / Goodsを見る"],
    ["purchase_again", "もう一度購入する"],
  ] as const)("%s -> %s", (action, label) => {
    expect(orderActionLabel(action)).toBe(label);
    expect(stringLeaves(copy)).toContain(label);
  });

  it("fails closed on an unknown action", () => {
    expect(() => orderActionLabel("bogus" as never)).toThrow(/Unexpected value/);
  });
});

describe("TC-PG-XFN-001-001 visibleEntitlements (INV-010-07, BR-ORD-015)", () => {
  const composite = {
    entryTicketRefs: ["t1", "t2"],
    goodsItems: [{ ref: "g1", itemState: "FULFILLABLE", handoffState: "PENDING" }],
  };

  it("passes the same reference through for CONFIRMED", () => {
    expect(visibleEntitlements("CONFIRMED", composite)).toBe(composite);
  });

  it.each(ORDER_STATES.filter((s) => s !== "CONFIRMED"))(
    "hides both Entry Ticket and Goods of a composite order in %s",
    (state) => {
      expect(visibleEntitlements(state, composite)).toBeNull();
    },
  );

  it("fails closed on an unknown state", () => {
    expect(() => visibleEntitlements("SOMETHING_NEW" as OrderState, composite)).toThrow(
      /Unexpected value/,
    );
  });
});
