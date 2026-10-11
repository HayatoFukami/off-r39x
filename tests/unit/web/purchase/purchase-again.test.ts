import { ORDER_PURPOSES, type OrderPurpose } from "@off-r39x/domain";
import { describe, expect, it } from "vitest";
import type {
  Money,
  OrderItem,
  Ref,
  UtcInstant,
} from "../../../../apps/web/src/api-client/types.ts";
import { addFromOrder, EMPTY_CART } from "../../../../apps/web/src/features/cart/cart-model.ts";
import { planPurchaseAgain } from "../../../../apps/web/src/features/purchase/purchase-again.ts";

// Contract: tests/contracts/s7a-purchase.md section 3.4 (SPEC-050 16.4 purchase again, 31 item 12, FR-CRT-002 / 011).
// Re-insertion carries references and quantities only; Karaoke restarts from slot selection.

const jpy = (amount: string): Money => ({ amount, currency: "JPY" });
const entry: OrderItem = {
  kind: "ENTRY_TICKET",
  offeringRef: "e0000000-0000-4000-8000-000000000001" as Ref<"offering">,
  name: "Entry Item",
  quantity: 2,
  unitPrice: jpy("3000"),
  subtotal: jpy("6000"),
};
const goods: OrderItem = {
  kind: "GOODS",
  goodsRef: "a0000000-0000-4000-8000-000000000001" as Ref<"goods">,
  name: "Goods Item",
  quantity: 1,
  unitPrice: jpy("4000"),
  subtotal: jpy("4000"),
};
const karaoke: OrderItem = {
  kind: "KARAOKE",
  slotRef: "5a000000-0000-4000-8000-000000011220" as Ref<"slot">,
  name: "Karaoke Slot",
  usageStart: "2027-03-08T03:20:00Z" as UtcInstant,
  usageEnd: "2027-03-08T03:35:00Z" as UtcInstant,
  quantity: 1,
  unitPrice: jpy("1000"),
  subtotal: jpy("1000"),
};

describe("TC-PG-XFN-001-631 planPurchaseAgain returns Entry / Goods to the Cart and Karaoke to slot selection (SPEC-050 16.4, 31 item 12)", () => {
  it("an Entry, Goods or composite Order goes to the Cart with its Entry and Goods items, in order", () => {
    expect(planPurchaseAgain("ENTRY_TICKET_PURCHASE", [entry])).toEqual({
      kind: "cart",
      href: "/cart",
      items: [entry],
    });
    expect(planPurchaseAgain("GOODS_PURCHASE", [goods])).toEqual({
      kind: "cart",
      href: "/cart",
      items: [goods],
    });
    expect(planPurchaseAgain("ENTRY_GOODS_PURCHASE", [goods, entry])).toEqual({
      kind: "cart",
      href: "/cart",
      items: [goods, entry],
    });
  });

  it("a Karaoke Order goes to /karaoke and carries nothing for the Cart", () => {
    expect(planPurchaseAgain("KARAOKE_PURCHASE", [karaoke])).toEqual({
      kind: "karaoke",
      href: "/karaoke",
    });
  });

  it("drops any Karaoke item from a Cart plan (Karaoke can never be a Cart line)", () => {
    expect(planPurchaseAgain("ENTRY_GOODS_PURCHASE", [entry, karaoke, goods])).toEqual({
      kind: "cart",
      href: "/cart",
      items: [entry, goods],
    });
  });

  it("an Order without items still returns to the Cart (it shows the Cart as it is)", () => {
    expect(planPurchaseAgain("ENTRY_TICKET_PURCHASE", [])).toEqual({
      kind: "cart",
      href: "/cart",
      items: [],
    });
  });

  it("decides by Purpose for all four purposes", () => {
    for (const purpose of ORDER_PURPOSES) {
      const plan = planPurchaseAgain(purpose as OrderPurpose, [entry]);
      expect(plan.kind, purpose).toBe(purpose === "KARAOKE_PURCHASE" ? "karaoke" : "cart");
    }
  });

  it("does not mutate its input", () => {
    const items = [entry, karaoke, goods];
    const before = structuredClone(items);
    planPurchaseAgain("ENTRY_GOODS_PURCHASE", items);
    expect(items).toEqual(before);
  });
});

describe("TC-PG-XFN-001-632 the planned items re-enter the Cart as references and quantities only (FR-CRT-003 / 011, SPEC-050 16.4)", () => {
  it("addFromOrder of a planned list yields lines without name, price or subtotal", () => {
    const plan = planPurchaseAgain("ENTRY_GOODS_PURCHASE", [entry, goods]);
    if (plan.kind !== "cart") throw new Error("expected a cart plan");
    const cart = addFromOrder(EMPTY_CART, plan.items);
    expect(cart.lines).toEqual([
      {
        kind: "ENTRY_TICKET",
        offeringRef: entry.kind === "ENTRY_TICKET" ? entry.offeringRef : "",
        quantity: 2,
      },
      { kind: "GOODS", goodsRef: goods.kind === "GOODS" ? goods.goodsRef : "", quantity: 1 },
    ]);
    expect(JSON.stringify(cart)).not.toMatch(/price|subtotal|Entry Item|Goods Item|JPY/);
  });

  it("merges with an existing Cart line of the same item by adding the quantity (no new Order is involved)", () => {
    const base = addFromOrder(EMPTY_CART, [goods]);
    const plan = planPurchaseAgain("GOODS_PURCHASE", [goods]);
    if (plan.kind !== "cart") throw new Error("expected a cart plan");
    const merged = addFromOrder(base, plan.items);
    expect(merged.lines).toHaveLength(1);
    expect(merged.lines[0]?.quantity).toBe(2);
  });
});
