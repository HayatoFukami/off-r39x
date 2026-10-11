import { ORDER_PURPOSES, ORDER_STATES, type OrderPurpose, type OrderState } from "@off-r39x/domain";
import { describe, expect, it } from "vitest";
import type {
  Money,
  OrderDetail,
  OrderEntitlements,
  OrderItem,
  Read,
  Ref,
  UtcInstant,
} from "../../../../apps/web/src/api-client/types.ts";
import {
  buildPurchaseStatusModel,
  type PurchaseStatusModel,
  recheckAnnouncement,
} from "../../../../apps/web/src/features/purchase/purchase-status-model.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { formatJstDateTime } from "../../../../apps/web/src/presentation/format/datetime.ts";
import { presentOrderState } from "../../../../apps/web/src/presentation/state-mapping/order.ts";
import { presentPurpose } from "../../../../apps/web/src/presentation/state-mapping/purpose.ts";

// Contract: tests/contracts/s7a-purchase.md section 3.3 (SPEC-050 16.2 / 16.4 / 16.5 / 16.7, 20.1,
// BR-ORD-015, INV-010-07 / 08, PAY-BRW-001). Synthetic data only.

const ORDER = "0d000000-0000-4000-8000-000000000003" as Ref<"order">;
const T0 = "2027-03-01T00:00:00Z" as UtcInstant;
const jpy = (amount: string): Money => ({ amount, currency: "JPY" });

const entryItem: OrderItem = {
  kind: "ENTRY_TICKET",
  offeringRef: "e0000000-0000-4000-8000-000000000006" as Ref<"offering">,
  name: "Entry Item",
  quantity: 2,
  unitPrice: jpy("2500"),
  subtotal: jpy("5000"),
};
const goodsItem: OrderItem = {
  kind: "GOODS",
  goodsRef: "a0000000-0000-4000-8000-000000000001" as Ref<"goods">,
  name: "Goods Item",
  quantity: 3,
  unitPrice: jpy("4000"),
  subtotal: jpy("12000"),
};
const karaokeItem: OrderItem = {
  kind: "KARAOKE",
  slotRef: "5a000000-0000-4000-8000-000000011220" as Ref<"slot">,
  name: "Karaoke Slot",
  // 2027-03-08 12:20-12:35 JST (UTC 03:20-03:35)
  usageStart: "2027-03-08T03:20:00Z" as UtcInstant,
  usageEnd: "2027-03-08T03:35:00Z" as UtcInstant,
  quantity: 1,
  unitPrice: jpy("1000"),
  subtotal: jpy("1000"),
};

const NONE: OrderEntitlements = { entryTicketRefs: [], reservationRef: null, goodsItems: [] };
const ticket = (n: number) => `7c000000-0000-4000-8000-00000000000${n}` as Ref<"ticket">;
const goodsEnt = (
  n: number,
  itemState: OrderEntitlements["goodsItems"][number]["itemState"] = "FULFILLABLE",
  handoffState: OrderEntitlements["goodsItems"][number]["handoffState"] = "PENDING",
) => ({
  ref: `91000000-0000-4000-8000-00000000000${n}` as Ref<"goodsItem">,
  itemState,
  handoffState,
});
const RESERVATION = "4e000000-0000-4000-8000-000000000001" as Ref<"reservation">;

function detail(
  over: Partial<OrderDetail> & { state: OrderState; purpose: OrderPurpose },
): OrderDetail {
  return {
    orderRef: ORDER,
    createdAt: T0,
    total: jpy("17000"),
    summary: "summary",
    items: [entryItem, goodsItem],
    entitlements: NONE,
    receiptUrl: null,
    notice: null,
    ...over,
  };
}
const ok = (data: OrderDetail): Read<OrderDetail> => ({ kind: "ok", data });
function ready(model: PurchaseStatusModel) {
  if (model.kind !== "ready") throw new Error(`expected ready but got ${model.kind}`);
  return model;
}

const FULL_COMPOSITE: OrderEntitlements = {
  entryTicketRefs: [ticket(1), ticket(2)],
  reservationRef: null,
  goodsItems: [goodsEnt(1), goodsEnt(2, "FULFILLABLE", "COMPLETED")],
};

describe("TC-PG-XFN-001-621 buildPurchaseStatusModel separates loading, denied and unavailable (SPEC-050 9, 16.8, 26.2)", () => {
  it("maps loading to loading, not_found to denied, and every failed read to unavailable", () => {
    expect(buildPurchaseStatusModel({ kind: "loading" })).toEqual({ kind: "loading" });
    expect(buildPurchaseStatusModel({ kind: "not_found" })).toEqual({ kind: "denied" });
    for (const kind of ["unavailable", "auth_required", "email_unverified"] as const) {
      expect(buildPurchaseStatusModel({ kind }), kind).toEqual({ kind: "unavailable" });
    }
  });

  it("never turns a failed read into denied or into a ready Order", () => {
    expect(buildPurchaseStatusModel({ kind: "unavailable" }).kind).not.toBe("denied");
    expect(buildPurchaseStatusModel({ kind: "not_found" }).kind).not.toBe("unavailable");
  });
});

describe("TC-PG-XFN-001-622 a ready model carries the Order's own facts (SPEC-050 16.2, 20.1)", () => {
  it("takes the state label, description, tone and Purpose from the shared presentations", () => {
    for (const state of ORDER_STATES) {
      for (const purpose of ORDER_PURPOSES) {
        const model = ready(buildPurchaseStatusModel(ok(detail({ state, purpose }))));
        const expected = presentOrderState(state);
        expect(model.orderRef).toBe(ORDER);
        expect(model.stateKey).toBe(state);
        expect(model.stateLabel).toBe(expected.label);
        expect(model.description).toBe(expected.description);
        expect(model.tone).toBe(expected.tone);
        expect(model.purposeLabel).toBe(presentPurpose(purpose).label);
      }
    }
  });

  it("formats the creation time in JST and the total as money from the snapshot", () => {
    const model = ready(
      buildPurchaseStatusModel(
        ok(detail({ state: "AWAITING_PAYMENT", purpose: "ENTRY_GOODS_PURCHASE" })),
      ),
    );
    expect(model.createdAtText).toBe(formatJstDateTime(T0));
    expect(model.createdAtText).toBe("2027/03/01 09:00");
    expect(model.totalText).toBe("¥17,000");
  });

  it("lists the snapshot items in order, Entry and Goods with a quantity and Karaoke with its date and time", () => {
    const model = ready(
      buildPurchaseStatusModel(
        ok(
          detail({
            state: "CONFIRMED",
            purpose: "ENTRY_GOODS_PURCHASE",
            items: [goodsItem, entryItem],
          }),
        ),
      ),
    );
    expect(model.items.map((i) => i.kind)).toEqual(["GOODS", "ENTRY_TICKET"]);
    expect(model.items.map((i) => i.name)).toEqual(["Goods Item", "Entry Item"]);
    expect(model.items.map((i) => i.kindLabel)).toEqual([
      copy.purchase.itemKind.GOODS,
      copy.purchase.itemKind.ENTRY_TICKET,
    ]);
    expect(model.items.map((i) => i.quantityText)).toEqual([
      copy.purchase.quantity(3),
      copy.purchase.quantity(2),
    ]);
    expect(model.items.map((i) => i.unitPriceText)).toEqual(["¥4,000", "¥2,500"]);
    expect(model.items.map((i) => i.subtotalText)).toEqual(["¥12,000", "¥5,000"]);
    expect(new Set(model.items.map((i) => i.key)).size).toBe(2);

    const karaoke = ready(
      buildPurchaseStatusModel(
        ok(detail({ state: "CONFIRMED", purpose: "KARAOKE_PURCHASE", items: [karaokeItem] })),
      ),
    );
    const row = karaoke.items[0];
    expect(row?.kind).toBe("KARAOKE");
    expect(row?.quantityText).toBeNull();
    expect(row?.usageText).toBe(copy.purchase.usage("2027/03/08", "12:20-12:35"));
    expect(row?.kindLabel).toBe(copy.purchase.itemKind.KARAOKE);
  });

  it("does not mutate its input", () => {
    const input = detail({
      state: "CONFIRMED",
      purpose: "ENTRY_GOODS_PURCHASE",
      entitlements: FULL_COMPOSITE,
    });
    const before = structuredClone(input);
    buildPurchaseStatusModel(ok(input));
    expect(input).toEqual(before);
  });
});

describe("TC-PG-XFN-001-623 entitlements are shown only for a CONFIRMED Order whose Purpose is complete (BR-ORD-015, INV-010-07, SPEC-050 16.5)", () => {
  it("hides entitlements for every state except CONFIRMED, even when the port returned them", () => {
    for (const state of ORDER_STATES) {
      if (state === "CONFIRMED") continue;
      const model = ready(
        buildPurchaseStatusModel(
          ok(detail({ state, purpose: "ENTRY_GOODS_PURCHASE", entitlements: FULL_COMPOSITE })),
        ),
      );
      expect(model.entitlements, state).toBeNull();
    }
  });

  it("shows both Entry Tickets and Goods items of a complete composite Order, separately, with state labels", () => {
    const model = ready(
      buildPurchaseStatusModel(
        ok(
          detail({
            state: "CONFIRMED",
            purpose: "ENTRY_GOODS_PURCHASE",
            entitlements: FULL_COMPOSITE,
          }),
        ),
      ),
    );
    const e = model.entitlements;
    expect(e).not.toBeNull();
    expect(e?.entryTickets.map((t) => t.href)).toEqual([
      `/mypage/entry-tickets/${ticket(1)}`,
      `/mypage/entry-tickets/${ticket(2)}`,
    ]);
    expect(e?.entryTickets.map((t) => t.label)).toEqual([
      copy.purchase.entitlements.entryLink(1),
      copy.purchase.entitlements.entryLink(2),
    ]);
    expect(e?.reservation).toBeNull();
    expect(e?.goodsItems.map((g) => g.href)).toEqual([
      `/mypage/goods/${goodsEnt(1).ref}`,
      `/mypage/goods/${goodsEnt(2).ref}`,
    ]);
    expect(e?.goodsItems.map((g) => g.label)).toEqual([
      copy.purchase.entitlements.goodsLink(1),
      copy.purchase.entitlements.goodsLink(2),
    ]);
    expect(e?.goodsItems.map((g) => g.itemLabel)).toEqual([
      copy.goods.item.FULFILLABLE,
      copy.goods.item.FULFILLABLE,
    ]);
    expect(e?.goodsItems.map((g) => g.handoffLabel)).toEqual([
      copy.goods.handoff.PENDING,
      copy.goods.handoff.COMPLETED,
    ]);
  });

  it("hides ALL entitlements of a composite Order when either side is missing (no partial entitlement)", () => {
    const onlyEntry: OrderEntitlements = { ...NONE, entryTicketRefs: [ticket(1)] };
    const onlyGoods: OrderEntitlements = { ...NONE, goodsItems: [goodsEnt(1)] };
    for (const entitlements of [onlyEntry, onlyGoods, NONE]) {
      const model = ready(
        buildPurchaseStatusModel(
          ok(detail({ state: "CONFIRMED", purpose: "ENTRY_GOODS_PURCHASE", entitlements })),
        ),
      );
      expect(model.entitlements).toBeNull();
    }
  });

  it("requires the Purpose's own kind: Entry needs tickets, Goods needs items, Karaoke needs a reservation", () => {
    const cases: [OrderPurpose, OrderEntitlements, OrderEntitlements][] = [
      [
        "ENTRY_TICKET_PURCHASE",
        { ...NONE, entryTicketRefs: [ticket(1)] },
        { ...NONE, goodsItems: [goodsEnt(1)] },
      ],
      [
        "GOODS_PURCHASE",
        { ...NONE, goodsItems: [goodsEnt(1)] },
        { ...NONE, entryTicketRefs: [ticket(1)] },
      ],
      ["KARAOKE_PURCHASE", { ...NONE, reservationRef: RESERVATION }, NONE],
    ];
    for (const [purpose, complete, wrong] of cases) {
      const shown = ready(
        buildPurchaseStatusModel(
          ok(detail({ state: "CONFIRMED", purpose, entitlements: complete })),
        ),
      );
      expect(shown.entitlements, `${purpose} complete`).not.toBeNull();
      const hidden = ready(
        buildPurchaseStatusModel(ok(detail({ state: "CONFIRMED", purpose, entitlements: wrong }))),
      );
      expect(hidden.entitlements, `${purpose} wrong kind`).toBeNull();
    }
  });

  it("a Karaoke Order links its Reservation and has no Entry or Goods entries", () => {
    const model = ready(
      buildPurchaseStatusModel(
        ok(
          detail({
            state: "CONFIRMED",
            purpose: "KARAOKE_PURCHASE",
            items: [karaokeItem],
            entitlements: { ...NONE, reservationRef: RESERVATION },
          }),
        ),
      ),
    );
    expect(model.entitlements?.reservation).toEqual({
      ref: RESERVATION,
      label: copy.purchase.entitlements.reservationLink,
      href: `/mypage/karaoke/${RESERVATION}`,
    });
    expect(model.entitlements?.entryTickets).toEqual([]);
    expect(model.entitlements?.goodsItems).toEqual([]);
  });

  it("shows unfulfilled Goods states as they are (a CONFIRMED Order may carry a later CANCELED / VOID item)", () => {
    const model = ready(
      buildPurchaseStatusModel(
        ok(
          detail({
            state: "CONFIRMED",
            purpose: "GOODS_PURCHASE",
            entitlements: { ...NONE, goodsItems: [goodsEnt(1, "CANCELED", "VOID")] },
          }),
        ),
      ),
    );
    expect(model.entitlements?.goodsItems[0]?.itemLabel).toBe(copy.goods.item.CANCELED);
    expect(model.entitlements?.goodsItems[0]?.handoffLabel).toBe(copy.goods.handoff.VOID);
  });
});

describe("TC-PG-XFN-001-624 the actions follow the Order state and never offer a retry that could create rights (SPEC-050 16.4, 21, INV-010-07)", () => {
  const labelsOf = (state: OrderState, purpose: OrderPurpose, entitlements = NONE) =>
    ready(buildPurchaseStatusModel(ok(detail({ state, purpose, entitlements })))).actions.map(
      (a) => a.label,
    );

  it("PREPARED offers only the checkout retry", () => {
    expect(labelsOf("PREPARED", "ENTRY_TICKET_PURCHASE")).toEqual([
      copy.order.action.retry_checkout,
    ]);
  });

  it("AWAITING_PAYMENT and REVIEW_REQUIRED offer only the status recheck (no purchase again, no checkout retry)", () => {
    for (const state of ["AWAITING_PAYMENT", "REVIEW_REQUIRED"] as const) {
      for (const purpose of ORDER_PURPOSES) {
        expect(labelsOf(state, purpose), `${state} ${purpose}`).toEqual([
          copy.order.action.recheck_status,
        ]);
      }
    }
    const model = ready(
      buildPurchaseStatusModel(
        ok(detail({ state: "AWAITING_PAYMENT", purpose: "GOODS_PURCHASE" })),
      ),
    );
    expect(model.actions).toEqual([
      { kind: "recheck_status", label: copy.order.action.recheck_status },
    ]);
  });

  it("the three terminal states offer purchase again, targeting the Cart or Karaoke by Purpose", () => {
    for (const state of ["PAYMENT_FAILED", "CANCELED", "EXPIRED"] as const) {
      for (const purpose of ORDER_PURPOSES) {
        const model = ready(buildPurchaseStatusModel(ok(detail({ state, purpose }))));
        expect(model.actions, `${state} ${purpose}`).toEqual([
          {
            kind: "purchase_again",
            label: copy.order.action.purchase_again,
            target: purpose === "KARAOKE_PURCHASE" ? "karaoke" : "cart",
          },
        ]);
      }
    }
  });

  it("CONFIRMED offers links only: the order detail and, when entitlements are shown, the entitlement list", () => {
    const model = ready(
      buildPurchaseStatusModel(
        ok(
          detail({
            state: "CONFIRMED",
            purpose: "ENTRY_GOODS_PURCHASE",
            entitlements: FULL_COMPOSITE,
          }),
        ),
      ),
    );
    expect(model.actions).toEqual([
      {
        kind: "link",
        action: "view_purchase",
        label: copy.order.action.view_purchase,
        href: `/mypage/orders/${ORDER}`,
      },
      {
        kind: "link",
        action: "view_entitlements",
        label: copy.order.action.view_entitlements,
        href: "/mypage/entry-tickets",
      },
    ]);
    expect(model.actions.some((a) => a.kind !== "link")).toBe(false);
  });

  it("CONFIRMED without displayable entitlements keeps the order link but drops the entitlement link", () => {
    const model = ready(
      buildPurchaseStatusModel(
        ok(
          detail({
            state: "CONFIRMED",
            purpose: "ENTRY_GOODS_PURCHASE",
            entitlements: { ...NONE, entryTicketRefs: [ticket(1)] },
          }),
        ),
      ),
    );
    expect(model.actions.map((a) => (a.kind === "link" ? a.action : a.kind))).toEqual([
      "view_purchase",
    ]);
  });

  it("the entitlement link goes to the list that matches the Purpose", () => {
    const hrefOf = (purpose: OrderPurpose, entitlements: OrderEntitlements): string | null => {
      const model = ready(
        buildPurchaseStatusModel(ok(detail({ state: "CONFIRMED", purpose, entitlements }))),
      );
      const link = model.actions.find((a) => a.kind === "link" && a.action === "view_entitlements");
      return link?.kind === "link" ? link.href : null;
    };
    expect(hrefOf("ENTRY_TICKET_PURCHASE", { ...NONE, entryTicketRefs: [ticket(1)] })).toBe(
      "/mypage/entry-tickets",
    );
    expect(hrefOf("GOODS_PURCHASE", { ...NONE, goodsItems: [goodsEnt(1)] })).toBe("/mypage/goods");
    expect(hrefOf("KARAOKE_PURCHASE", { ...NONE, reservationRef: RESERVATION })).toBe(
      "/mypage/karaoke",
    );
  });
});

describe("TC-PG-XFN-001-625 the Email notice is non-blocking and only for a CONFIRMED Order (SPEC-050 16.7, 20.5)", () => {
  const delayed = { kind: "email_delayed" } as const;

  it("shows the contracted notice on a CONFIRMED Order and keeps the state and the entitlements", () => {
    const model = ready(
      buildPurchaseStatusModel(
        ok(
          detail({
            state: "CONFIRMED",
            purpose: "ENTRY_GOODS_PURCHASE",
            entitlements: FULL_COMPOSITE,
            notice: delayed,
          }),
        ),
      ),
    );
    expect(model.notice).toEqual({
      label: copy.notification.FAILED_RETRYABLE.label,
      message: copy.notification.FAILED_RETRYABLE.message,
    });
    expect(model.stateLabel).toBe(copy.order.state.CONFIRMED);
    expect(model.entitlements).not.toBeNull();
    // No Business retry action may be offered for a failed notification.
    expect(model.actions.every((a) => a.kind === "link")).toBe(true);
  });

  it("shows no notice without a notice field, and none on a state that is not CONFIRMED", () => {
    expect(
      ready(buildPurchaseStatusModel(ok(detail({ state: "CONFIRMED", purpose: "GOODS_PURCHASE" }))))
        .notice,
    ).toBeNull();
    for (const state of ORDER_STATES) {
      if (state === "CONFIRMED") continue;
      expect(
        ready(
          buildPurchaseStatusModel(
            ok(detail({ state, purpose: "GOODS_PURCHASE", notice: delayed })),
          ),
        ).notice,
        state,
      ).toBeNull();
    }
  });
});

describe("TC-PG-XFN-001-626 the Receipt link is an https URL on a CONFIRMED Order only (SPEC-050 23, SEC-WEB-016)", () => {
  const receipt = (state: OrderState, receiptUrl: string | null) =>
    ready(buildPurchaseStatusModel(ok(detail({ state, purpose: "GOODS_PURCHASE", receiptUrl }))))
      .receiptHref;

  it("returns a safe https URL for CONFIRMED", () => {
    expect(receipt("CONFIRMED", "https://receipts.example.com/r/1")).toBe(
      "https://receipts.example.com/r/1",
    );
  });

  it("returns null when absent, not https, or carrying credentials", () => {
    expect(receipt("CONFIRMED", null)).toBeNull();
    expect(receipt("CONFIRMED", "http://receipts.example.com/r/1")).toBeNull();
    expect(receipt("CONFIRMED", "javascript:alert(1)")).toBeNull();
    expect(receipt("CONFIRMED", "https://user:pw@receipts.example.com/r/1")).toBeNull();
  });

  it("returns null for any state that is not CONFIRMED, even with a URL", () => {
    for (const state of ORDER_STATES) {
      if (state === "CONFIRMED") continue;
      expect(receipt(state, "https://receipts.example.com/r/1"), state).toBeNull();
    }
  });
});

describe("TC-PG-XFN-001-627 recheckAnnouncement tells a screen reader whether the state changed (SPEC-050 25, 21)", () => {
  it("announces the new label when the state changed (AWAITING_PAYMENT to CONFIRMED)", () => {
    expect(recheckAnnouncement("AWAITING_PAYMENT", "CONFIRMED")).toBe(
      "購入状態が『購入確定』に更新されました",
    );
    expect(recheckAnnouncement("AWAITING_PAYMENT", "CONFIRMED")).toBe(
      copy.purchase.recheck.changed(copy.order.state.CONFIRMED),
    );
  });

  it("announces the new label for every distinct pair and says unchanged for an equal pair", () => {
    for (const previous of ORDER_STATES) {
      for (const next of ORDER_STATES) {
        const text = recheckAnnouncement(previous, next);
        if (previous === next) {
          expect(text).toBe(copy.purchase.recheck.unchanged);
        } else {
          expect(text).toBe(copy.purchase.recheck.changed(copy.order.state[next]));
        }
      }
    }
  });
});
