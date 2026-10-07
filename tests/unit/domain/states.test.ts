import type {
  EntryTicketState,
  GoodsHandoffState,
  GoodsItemState,
  KaraokeHoldState,
  KaraokeSlotState,
  KaraokeTicketState,
  NotificationState,
  OrderPurpose,
  OrderState,
  PublicationState,
  ReservationState,
} from "@off-r39x/domain";
import * as domain from "@off-r39x/domain";
import { describe, expect, it } from "vitest";

// Canonical lists: SPEC-030 §8.2, §10-§19 and SPEC-050 §20.
const canonical: Record<string, readonly string[]> = {
  ORDER_STATES: [
    "PREPARED",
    "AWAITING_PAYMENT",
    "CONFIRMED",
    "PAYMENT_FAILED",
    "CANCELED",
    "EXPIRED",
    "REVIEW_REQUIRED",
  ],
  ORDER_PURPOSES: [
    "ENTRY_TICKET_PURCHASE",
    "KARAOKE_PURCHASE",
    "GOODS_PURCHASE",
    "ENTRY_GOODS_PURCHASE",
  ],
  ENTRY_TICKET_STATES: ["VALID", "USED", "CANCELED", "EXPIRED"],
  KARAOKE_SLOT_STATES: ["AVAILABLE", "HELD", "SOLD", "SALES_STOPPED"],
  KARAOKE_HOLD_STATES: ["ACTIVE", "COMMITTED", "RELEASED", "EXPIRED"],
  RESERVATION_STATES: ["CONFIRMED", "CANCELED"],
  KARAOKE_TICKET_STATES: ["VALID", "USED", "CANCELED", "EXPIRED"],
  GOODS_ITEM_STATES: ["PENDING_PAYMENT", "FULFILLABLE", "CANCELED"],
  GOODS_HANDOFF_STATES: ["PENDING", "COMPLETED", "VOID"],
  NOTIFICATION_STATES: ["PENDING", "SENT", "FAILED_RETRYABLE", "CANCELED"],
  PUBLICATION_STATES: ["DRAFT", "PUBLISHED", "ARCHIVED"],
};

describe("TC-DEV-TS-010-002 canonical state constants", () => {
  for (const [name, expected] of Object.entries(canonical)) {
    it(`${name} equals the canonical set without duplicates`, () => {
      const actual = (domain as Record<string, unknown>)[name];
      expect(Array.isArray(actual)).toBe(true);
      const list = actual as readonly string[];
      expect(new Set(list).size).toBe(list.length);
      expect([...list].sort()).toEqual([...expected].sort());
    });
  }

  it("exports only the documented constants and assertNever", () => {
    expect(Object.keys(domain).sort()).toEqual([...Object.keys(canonical), "assertNever"].sort());
  });

  it("derived union types accept canonical values (compile-time)", () => {
    const order: OrderState = "REVIEW_REQUIRED";
    const purpose: OrderPurpose = "ENTRY_GOODS_PURCHASE";
    const entry: EntryTicketState = "USED";
    const slot: KaraokeSlotState = "SALES_STOPPED";
    const hold: KaraokeHoldState = "ACTIVE";
    const reservation: ReservationState = "CONFIRMED";
    const karaokeTicket: KaraokeTicketState = "EXPIRED";
    const item: GoodsItemState = "PENDING_PAYMENT";
    const handoff: GoodsHandoffState = "VOID";
    const notification: NotificationState = "FAILED_RETRYABLE";
    const publication: PublicationState = "ARCHIVED";
    expect([
      order,
      purpose,
      entry,
      slot,
      hold,
      reservation,
      karaokeTicket,
      item,
      handoff,
      notification,
      publication,
    ]).toHaveLength(11);
  });
});

describe("TC-DEV-TS-010-001 assertNever", () => {
  it("throws an Error whose message contains 'Unexpected value'", () => {
    const call = () => domain.assertNever("BOGUS" as never);
    expect(call).toThrow(Error);
    expect(call).toThrow(/Unexpected value/);
  });

  it("makes an exhaustive switch fail closed on an unknown runtime value", () => {
    const label = (state: OrderState): string => {
      switch (state) {
        case "PREPARED":
        case "AWAITING_PAYMENT":
        case "CONFIRMED":
        case "PAYMENT_FAILED":
        case "CANCELED":
        case "EXPIRED":
        case "REVIEW_REQUIRED":
          return state;
        default:
          return domain.assertNever(state);
      }
    };
    expect(label("CONFIRMED")).toBe("CONFIRMED");
    expect(() => label("SOMETHING_NEW" as OrderState)).toThrow(/Unexpected value/);
  });
});
