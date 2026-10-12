import { ORDER_PURPOSES, ORDER_STATES } from "@off-r39x/domain";
import { describe, expect, it } from "vitest";
import type { OrderSummary, Read } from "../../../../apps/web/src/api-client/types.ts";
import { buildMypageOrderDetailModel } from "../../../../apps/web/src/features/mypage/order-detail-model.ts";
import { buildOrderListModel } from "../../../../apps/web/src/features/mypage/order-list-model.ts";
import { buildPurchaseStatusModel } from "../../../../apps/web/src/features/purchase/purchase-status-model.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { formatJstDateTime } from "../../../../apps/web/src/presentation/format/datetime.ts";
import { formatMoney } from "../../../../apps/web/src/presentation/format/money.ts";
import { presentOrderState } from "../../../../apps/web/src/presentation/state-mapping/order.ts";
import { presentPurpose } from "../../../../apps/web/src/presentation/state-mapping/purpose.ts";
import { createBackend, okData } from "../../../harness/mock-backend.ts";
import { EMAIL, ORDER } from "../../../harness/mock-seed.ts";

// Contract: tests/contracts/s8-mypage.md sections 3.2 and 3.3 (SPEC-050 18.3, 18.4, 20.1, 21, BR-ORD-015,
// INV-010-07 / 08). The data come from the S2 mock port with the seed (UI mock test double, not API / DB coverage).

async function demo() {
  const backend = createBackend();
  await backend.signInAs(EMAIL.demo);
  return backend;
}

function itemsOf(model: ReturnType<typeof buildOrderListModel>) {
  if (model.kind !== "items") throw new Error(`expected items but got ${model.kind}`);
  return model.items;
}

describe("TC-PG-MYP-003-621 the Order list model shows every Order of the viewer, newest first, with a state label (SPEC-050 18.3, 20.1)", () => {
  it("lists demo's 13 Orders with Purpose, summary, JST date, total, state label and a detail href", async () => {
    const { api } = await demo();
    const data = okData(await api.self.listOrders());
    const items = itemsOf(buildOrderListModel({ kind: "ok", data }));
    expect(items).toHaveLength(13);
    expect(items.map((i) => i.orderRef)).toEqual(data.map((o) => o.orderRef));
    for (const [index, row] of items.entries()) {
      const source = data[index] as OrderSummary;
      expect(row.href).toBe(`/mypage/orders/${source.orderRef}`);
      expect(row.purposeLabel).toBe(presentPurpose(source.purpose).label);
      expect(row.summary).toBe(source.summary);
      expect(row.stateKey).toBe(source.state);
      expect(row.stateLabel).toBe(presentOrderState(source.state).label);
      expect(row.tone).toBe(presentOrderState(source.state).tone);
      expect(row.createdAtText).toBe(formatJstDateTime(source.createdAt));
      expect(row.totalText).toBe(formatMoney(source.total));
      expect(row.linkLabel).toBe(copy.mypage.orders.detailLink(row.createdAtText));
    }
    expect(items[0]?.orderRef).toBe(ORDER.prepared);
    expect(items.find((i) => i.orderRef === ORDER.confirmedEntry)?.totalText).toBe("¥10,000");
  });

  it("distinguishes all seven Canonical Order States and shows all four Purposes (E2E 15)", async () => {
    const { api } = await demo();
    const items = itemsOf(
      buildOrderListModel({ kind: "ok", data: okData(await api.self.listOrders()) }),
    );
    expect(new Set(items.map((i) => i.stateKey))).toEqual(new Set(ORDER_STATES));
    expect(new Set(items.map((i) => i.stateLabel)).size).toBe(ORDER_STATES.length);
    const purposes = new Set(items.map((i) => i.purposeLabel));
    expect(purposes.size).toBe(ORDER_PURPOSES.length);
  });

  it("sorts by creation time, newest first, keeping the input order on a tie, without changing the input", async () => {
    const { api } = await demo();
    const [template] = okData(await api.self.listOrders()) as [OrderSummary, ...OrderSummary[]];
    const make = (n: number, createdAt: string): OrderSummary => ({
      ...template,
      orderRef: `0d000000-0000-4000-8000-0000000000${n}` as OrderSummary["orderRef"],
      createdAt: createdAt as OrderSummary["createdAt"],
    });
    const a = make(11, "2027-03-01T01:00:00Z");
    const b = make(12, "2027-02-28T23:00:00Z");
    const c = make(13, "2027-03-01T02:00:00Z");
    const d = make(14, "2027-03-01T01:00:00Z"); // same instant as a, later in the input
    const input: OrderSummary[] = [a, b, c, d];
    const snapshot = JSON.stringify(input);
    const items = itemsOf(buildOrderListModel({ kind: "ok", data: input }));
    expect(items.map((i) => i.orderRef)).toEqual([c.orderRef, a.orderRef, d.orderRef, b.orderRef]);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("TC-PG-MYP-003-622 loading, Empty and a failed read are three different list states (SPEC-050 9, 21)", () => {
  it("maps loading to loading and an Empty ok list to empty", async () => {
    expect(buildOrderListModel({ kind: "loading" })).toEqual({ kind: "loading" });
    expect(buildOrderListModel({ kind: "ok", data: [] })).toEqual({ kind: "empty" });
    const backend = createBackend();
    await backend.signInAs(EMAIL.fresh);
    const data = okData(await backend.api.self.listOrders());
    expect(buildOrderListModel({ kind: "ok", data })).toEqual({ kind: "empty" });
  });

  it("never turns a failed read into empty", () => {
    for (const kind of ["unavailable", "not_found", "auth_required", "email_unverified"] as const) {
      const input: Read<readonly OrderSummary[]> = { kind };
      expect(buildOrderListModel(input), kind).toEqual({ kind: "unavailable" });
    }
  });
});

describe("TC-PG-MYP-004-621 the Order detail model is the Purchase Status model without the link to itself (SPEC-050 18.4, 16.4)", () => {
  it("equals the Purchase Status model for loading, denied and unavailable", () => {
    for (const input of [
      { kind: "loading" },
      { kind: "not_found" },
      { kind: "unavailable" },
      { kind: "auth_required" },
      { kind: "email_unverified" },
    ] as const) {
      expect(buildMypageOrderDetailModel(input), input.kind).toEqual(
        buildPurchaseStatusModel(input),
      );
    }
    expect(buildMypageOrderDetailModel({ kind: "not_found" })).toEqual({ kind: "denied" });
  });

  it("drops only the view_purchase link and keeps the rest of the model and the other actions in order", async () => {
    const { api } = await demo();
    for (const [name, ref] of Object.entries(ORDER)) {
      const read = await api.self.getOrder(ref);
      if (read.kind !== "ok") continue; // other users' Orders are not_found for demo
      const shared = buildPurchaseStatusModel(read);
      const detail = buildMypageOrderDetailModel(read);
      if (shared.kind !== "ready" || detail.kind !== "ready")
        throw new Error(`${name}: expected ready`);
      expect(
        detail.actions.some((a) => a.kind === "link" && a.action === "view_purchase"),
        name,
      ).toBe(false);
      expect(detail.actions, name).toEqual(
        shared.actions.filter((a) => !(a.kind === "link" && a.action === "view_purchase")),
      );
      const { actions: _a, ...sharedRest } = shared;
      const { actions: _b, ...detailRest } = detail;
      expect(detailRest, name).toEqual(sharedRest);
    }
  });

  it("a CONFIRMED composite Order keeps its rights link, receipt and both kinds of rights", async () => {
    const { api } = await demo();
    const model = buildMypageOrderDetailModel(await api.self.getOrder(ORDER.confirmedComposite));
    if (model.kind !== "ready") throw new Error("expected ready");
    expect(model.stateKey).toBe("CONFIRMED");
    expect(model.actions.map((a) => (a.kind === "link" ? a.action : a.kind))).toEqual([
      "view_entitlements",
    ]);
    expect(model.entitlements?.entryTickets).toHaveLength(1);
    expect(model.entitlements?.goodsItems).toHaveLength(1);
    expect(model.receiptHref).toBe(`https://receipt.example.com/mock/${ORDER.confirmedComposite}`);
  });
});

describe("TC-PG-MYP-004-622 the Order detail never shows a right before CONFIRMED and denies another user's Order (BR-ORD-015, INV-010-07 / 08, SPEC-110 22)", () => {
  it("AWAITING_PAYMENT and REVIEW_REQUIRED have no entitlements, no purchase-again and no rights link", async () => {
    const { api } = await demo();
    for (const ref of [ORDER.awaiting, ORDER.review, ORDER.prepared]) {
      const model = buildMypageOrderDetailModel(await api.self.getOrder(ref));
      if (model.kind !== "ready") throw new Error("expected ready");
      expect(model.entitlements, ref).toBeNull();
      expect(
        model.actions.some((a) => a.kind === "purchase_again"),
        ref,
      ).toBe(false);
      expect(
        model.actions.some((a) => a.kind === "link"),
        ref,
      ).toBe(false);
    }
  });

  it("another user's Order and a missing Order are both denied for the viewer", async () => {
    const { api } = await demo();
    for (const ref of [
      ORDER.otherEntry,
      ORDER.otherGoods,
      ORDER.otherKaraoke,
      "0d000000-0000-4000-8000-0000000009ff",
    ]) {
      expect(buildMypageOrderDetailModel(await api.self.getOrder(ref as never)), ref).toEqual({
        kind: "denied",
      });
    }
  });
});
