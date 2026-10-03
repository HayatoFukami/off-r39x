import {
  KARAOKE_HOLD_STATES,
  KARAOKE_SLOT_STATES,
  KARAOKE_TICKET_STATES,
  type KaraokeHoldState,
  type KaraokeSlotState,
  type KaraokeTicketState,
  RESERVATION_STATES,
  type ReservationState,
} from "@off-r39x/domain";
import { describe, expect, it } from "vitest";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import {
  presentHold,
  presentReservationTicket,
  presentSlot,
} from "../../../../apps/web/src/presentation/state-mapping/karaoke.ts";
import { stringLeaves, TONES } from "../../../harness/presentation.ts";

const dictionary = new Set(stringLeaves(copy));

describe("TC-PG-KRK-002-001 presentSlot (SPEC-050 13.2 / 20.3)", () => {
  it("uses the fixed labels and makes only AVAILABLE selectable", () => {
    expect(presentSlot("AVAILABLE")).toMatchObject({ label: "選択可能", selectable: true });
    expect(presentSlot("HELD").label).toContain("確保中");
    expect(presentSlot("HELD").selectable).toBe(false);
    expect(presentSlot("SOLD")).toMatchObject({ label: "販売済み", selectable: false });
    expect(presentSlot("SALES_STOPPED")).toMatchObject({ label: "販売停止", selectable: false });
  });

  it("selects exactly one of the 4 Slot states", () => {
    const selectable = KARAOKE_SLOT_STATES.filter((s) => presentSlot(s).selectable);
    expect(selectable).toEqual(["AVAILABLE"]);
  });

  it("keeps the 4 labels distinct, dictionary-backed, with valid tones", () => {
    const labels = KARAOKE_SLOT_STATES.map((s) => presentSlot(s).label);
    expect(new Set(labels).size).toBe(4);
    for (const state of KARAOKE_SLOT_STATES) {
      const presented = presentSlot(state);
      expect(dictionary.has(presented.label), `${state} label`).toBe(true);
      expect(dictionary.has(presented.description), `${state} description`).toBe(true);
      expect(TONES).toContain(presented.tone);
      if (state !== "AVAILABLE") expect(presented.tone, state).not.toBe("success");
    }
    expect(presentSlot("AVAILABLE").tone).toBe("success");
  });

  it("fails closed on an unknown Slot state", () => {
    expect(() => presentSlot("OPEN" as KaraokeSlotState)).toThrow(/Unexpected value/);
  });
});

describe("TC-PG-KRK-003-001 presentHold (SPEC-050 20.3)", () => {
  it("names each Hold state with the key phrase of the spec", () => {
    expect(presentHold("ACTIVE").label).toContain("購入試行中");
    expect(presentHold("COMMITTED").label).toContain("確定購入");
    expect(presentHold("RELEASED").label).toContain("終了");
    expect(presentHold("EXPIRED").label).toContain("期限切れ");
  });

  it("keeps the 4 labels distinct and never claims a confirmed reservation", () => {
    const labels = KARAOKE_HOLD_STATES.map((s) => presentHold(s).label);
    expect(new Set(labels).size).toBe(4);
    for (const state of KARAOKE_HOLD_STATES) {
      const presented = presentHold(state);
      expect(presented.label).not.toContain("予約確定");
      expect(presented.description.length).toBeGreaterThan(0);
      expect(dictionary.has(presented.label), `${state} label`).toBe(true);
      expect(dictionary.has(presented.description), `${state} description`).toBe(true);
      expect(TONES).toContain(presented.tone);
    }
  });

  it("fails closed on an unknown Hold state", () => {
    expect(() => presentHold("LEASED" as KaraokeHoldState)).toThrow(/Unexpected value/);
  });
});

describe("TC-PG-MYP-009-001 presentReservationTicket (SPEC-050 18.9 / 18.10 / 20.3, INV-010-05)", () => {
  const RESERVATION_LABELS: Record<ReservationState, string> = {
    CONFIRMED: "予約確定",
    CANCELED: "予約取消済み",
  };
  const TICKET_LABELS: Record<KaraokeTicketState, string> = {
    VALID: "受付利用可能",
    USED: "使用済み",
    CANCELED: "取消済み",
    EXPIRED: "失効済み",
  };
  const combinations = RESERVATION_STATES.flatMap((r) =>
    KARAOKE_TICKET_STATES.map((t) => [r, t] as const),
  );

  it("covers all 8 Reservation x Ticket combinations", () => {
    expect(combinations).toHaveLength(8);
  });

  it.each(combinations)("Reservation %s + Ticket %s", (reservation, ticket) => {
    const presented = presentReservationTicket(reservation, ticket);
    expect(presented.reservationLabel).toBe(RESERVATION_LABELS[reservation]);
    expect(presented.ticketLabel).toBe(TICKET_LABELS[ticket]);
    const expectedPrimary = reservation === "CANCELED" ? "取消済み" : TICKET_LABELS[ticket];
    expect(presented.primaryLabel).toBe(expectedPrimary);

    const expectedPresentable = reservation === "CONFIRMED" && ticket === "VALID";
    expect(presented.qrPresentable).toBe(expectedPresentable);
    if (expectedPresentable) {
      expect(presented.disabledReason).toBeNull();
      expect(presented.tone).toBe("success");
    } else {
      expect((presented.disabledReason ?? "").length).toBeGreaterThan(0);
      expect(presented.tone).not.toBe("success");
    }
    expect(TONES).toContain(presented.tone);
  });

  it("presents the QR only for Reservation CONFIRMED + Ticket VALID", () => {
    const presentable = combinations.filter(
      ([r, t]) => presentReservationTicket(r, t).qrPresentable,
    );
    expect(presentable).toEqual([["CONFIRMED", "VALID"]]);
  });

  it("never presents a canceled Reservation as acceptable even if the Ticket is still VALID", () => {
    const presented = presentReservationTicket("CANCELED", "VALID");
    expect(presented.qrPresentable).toBe(false);
    expect(presented.primaryLabel).toBe("取消済み");
  });

  it("returns only dictionary-backed strings", () => {
    for (const [r, t] of combinations) {
      const presented = presentReservationTicket(r, t);
      for (const text of [
        presented.reservationLabel,
        presented.ticketLabel,
        presented.primaryLabel,
        presented.disabledReason,
      ]) {
        if (text !== null) expect(dictionary.has(text), `${r}/${t}: ${text}`).toBe(true);
      }
    }
  });

  it("fails closed when either argument is unknown, whatever the other is", () => {
    for (const t of KARAOKE_TICKET_STATES) {
      expect(() => presentReservationTicket("HOLD" as ReservationState, t)).toThrow(
        /Unexpected value/,
      );
    }
    for (const r of RESERVATION_STATES) {
      expect(() => presentReservationTicket(r, "REVOKED" as KaraokeTicketState)).toThrow(
        /Unexpected value/,
      );
    }
  });
});
