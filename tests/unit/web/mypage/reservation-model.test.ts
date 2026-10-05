import { describe, expect, it } from "vitest";
import type {
  ReservationDetail,
  ReservationSummary,
  UtcInstant,
} from "../../../../apps/web/src/api-client/types.ts";
import {
  buildReservationDetailModel,
  buildReservationListModel,
} from "../../../../apps/web/src/features/mypage/reservation-model.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import {
  formatBusinessDate,
  formatJstTime,
  formatJstTimeRange,
} from "../../../../apps/web/src/presentation/format/datetime.ts";
import { presentReservationTicket } from "../../../../apps/web/src/presentation/state-mapping/karaoke.ts";
import { createBackend, okData } from "../../../harness/mock-backend.ts";
import { EMAIL, ORDER, RESERVATION } from "../../../harness/mock-seed.ts";

// Contract: tests/contracts/s8-mypage.md section 3.5 (SPEC-050 18.8, 18.9, 20.3, 23, INV-010-05 / 08).

async function demo() {
  const backend = createBackend();
  await backend.signInAs(EMAIL.demo);
  return backend;
}

const cases = [
  {
    name: "valid",
    ref: RESERVATION.valid,
    reservation: "CONFIRMED",
    ticket: "VALID",
    order: ORDER.kValid,
  },
  {
    name: "used",
    ref: RESERVATION.used,
    reservation: "CONFIRMED",
    ticket: "USED",
    order: ORDER.kUsed,
  },
  {
    name: "canceled",
    ref: RESERVATION.canceled,
    reservation: "CANCELED",
    ticket: "CANCELED",
    order: ORDER.kCanceled,
  },
  {
    name: "expired",
    ref: RESERVATION.expired,
    reservation: "CONFIRMED",
    ticket: "EXPIRED",
    order: ORDER.kExpired,
  },
] as const;

describe("TC-PG-MYP-008-621 the Reservation list model shows date, time and both states, in time order (SPEC-050 18.8, 20.3)", () => {
  it("lists demo's four Reservations by usage start, with JST date and time, both state labels and the detail href", async () => {
    const { api } = await demo();
    const data = okData(await api.self.listReservations());
    const model = buildReservationListModel({ kind: "ok", data });
    if (model.kind !== "items") throw new Error(`expected items but got ${model.kind}`);
    expect(model.items).toHaveLength(4);
    const byStart = [...data].sort((a, b) => Date.parse(a.usageStart) - Date.parse(b.usageStart));
    expect(model.items.map((i) => i.reservationRef)).toEqual(byStart.map((r) => r.reservationRef));
    // 10:40 (expired), 11:40 (canceled), 12:20 (valid), 12:40 (used)
    expect(model.items.map((i) => i.reservationRef)).toEqual([
      RESERVATION.expired,
      RESERVATION.canceled,
      RESERVATION.valid,
      RESERVATION.used,
    ]);
    for (const row of model.items) {
      const source = data.find(
        (r) => r.reservationRef === row.reservationRef,
      ) as ReservationSummary;
      const presented = presentReservationTicket(source.reservationState, source.ticketState);
      expect(row.href).toBe(`/mypage/karaoke/${row.reservationRef}`);
      expect(row.dateText).toBe(formatBusinessDate(source.date));
      expect(row.timeText).toBe(formatJstTimeRange(source.usageStart, source.usageEnd));
      expect(row.reservationLabel).toBe(presented.reservationLabel);
      expect(row.ticketLabel).toBe(presented.ticketLabel);
      expect(row.primaryLabel).toBe(presented.primaryLabel);
      expect(row.tone).toBe(presented.tone);
      expect(row.linkLabel).toBe(copy.mypage.reservations.detailLink(row.dateText, row.timeText));
    }
  });

  it("keeps the Reservation state and the Karaoke Ticket state apart: a used Ticket is a Ticket state, not a Reservation state (SPEC-050 18.8)", async () => {
    const { api } = await demo();
    const model = buildReservationListModel({
      kind: "ok",
      data: okData(await api.self.listReservations()),
    });
    if (model.kind !== "items") throw new Error("expected items");
    const used = model.items.find((i) => i.reservationRef === RESERVATION.used);
    expect(used?.reservationLabel).toBe(copy.karaoke.reservation.CONFIRMED);
    expect(used?.ticketLabel).toBe(copy.karaoke.ticket.USED);
    const reservationLabels = new Set(model.items.map((i) => i.reservationLabel));
    expect([...reservationLabels].sort()).toEqual(
      [copy.karaoke.reservation.CONFIRMED, copy.karaoke.reservation.CANCELED].sort(),
    );
    const ticketLabels = new Set(model.items.map((i) => i.ticketLabel));
    expect(ticketLabels.size).toBe(4);
  });

  it("sorts a tie by the input order and does not change the input", async () => {
    const { api } = await demo();
    const data = [...okData(await api.self.listReservations())] as ReservationSummary[];
    const first = data[0] as ReservationSummary;
    const tie = {
      ...(data[1] as ReservationSummary),
      usageStart: first.usageStart,
      usageEnd: first.usageEnd,
    };
    const input = [first, tie];
    const snapshot = JSON.stringify(input);
    const model = buildReservationListModel({ kind: "ok", data: input });
    if (model.kind !== "items") throw new Error("expected items");
    expect(model.items.map((i) => i.reservationRef)).toEqual([
      first.reservationRef,
      tie.reservationRef,
    ]);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("separates loading, Empty and a failed read; another user's Reservation is not listed", async () => {
    expect(buildReservationListModel({ kind: "loading" })).toEqual({ kind: "loading" });
    expect(buildReservationListModel({ kind: "ok", data: [] })).toEqual({ kind: "empty" });
    for (const kind of ["unavailable", "not_found", "auth_required", "email_unverified"] as const) {
      expect(buildReservationListModel({ kind }), kind).toEqual({ kind: "unavailable" });
    }
    const { api } = await demo();
    const model = buildReservationListModel({
      kind: "ok",
      data: okData(await api.self.listReservations()),
    });
    expect(JSON.stringify(model)).not.toContain(RESERVATION.other);
  });
});

describe("TC-PG-MYP-009-621 the Reservation detail model offers the QR only for CONFIRMED + VALID (SPEC-050 18.9, 20.3, INV-010-05)", () => {
  for (const c of cases) {
    it(`${c.name}: ${c.reservation} + ${c.ticket}`, async () => {
      const { api } = await demo();
      const read = await api.self.getReservation(c.ref);
      const model = buildReservationDetailModel(read);
      if (model.kind !== "ready") throw new Error(`expected ready but got ${model.kind}`);
      const source = okData(read) as ReservationDetail;
      const presented = presentReservationTicket(c.reservation, c.ticket);
      expect(model.dateText).toBe(formatBusinessDate(source.date));
      expect(model.startText).toBe(formatJstTime(source.usageStart));
      expect(model.endText).toBe(formatJstTime(source.usageEnd));
      expect(model.timeText).toBe(formatJstTimeRange(source.usageStart, source.usageEnd));
      expect(model.reservationLabel).toBe(presented.reservationLabel);
      expect(model.ticketLabel).toBe(presented.ticketLabel);
      expect(model.primaryLabel).toBe(presented.primaryLabel);
      expect(model.tone).toBe(presented.tone);
      expect(model.orderHref).toBe(`/mypage/orders/${c.order}`);
      if (presented.qrPresentable) {
        expect(model.qr).toEqual({
          kind: "link",
          label: copy.mypage.reservations.detail.qrLink,
          href: `/mypage/karaoke/${c.ref}/qr`,
        });
      } else {
        expect(model.qr).toEqual({
          kind: "disabled",
          label: copy.mypage.reservations.detail.qrLink,
          reason: presented.disabledReason,
        });
      }
    });
  }

  it("a canceled Reservation names the cancellation as the reason, a used one the use, an expired one the expiry", async () => {
    const { api } = await demo();
    const reason = async (ref: typeof RESERVATION.valid) => {
      const model = buildReservationDetailModel(await api.self.getReservation(ref));
      return model.kind === "ready" && model.qr.kind === "disabled" ? model.qr.reason : null;
    };
    expect(await reason(RESERVATION.canceled)).toBe(
      copy.karaoke.disabledReason.reservationCanceled,
    );
    expect(await reason(RESERVATION.used)).toBe(copy.karaoke.disabledReason.USED);
    expect(await reason(RESERVATION.expired)).toBe(copy.karaoke.disabledReason.EXPIRED);
    expect(await reason(RESERVATION.valid)).toBeNull();
  });
});

describe("TC-PG-MYP-009-622 the Receipt link exists only when a safe https URL is available (SPEC-050 23)", () => {
  it("uses the Order's receipt when it is https, and never invents one", async () => {
    const { api } = await demo();
    const withReceipt = buildReservationDetailModel(
      await api.self.getReservation(RESERVATION.used),
    );
    const withoutReceipt = buildReservationDetailModel(
      await api.self.getReservation(RESERVATION.valid),
    );
    if (withReceipt.kind !== "ready" || withoutReceipt.kind !== "ready")
      throw new Error("expected ready");
    expect(withReceipt.receiptHref).toBe(`https://receipt.example.com/mock/${ORDER.kUsed}`);
    expect(withoutReceipt.receiptHref).toBeNull();
  });

  it("rejects an unsafe receipt URL", async () => {
    const { api } = await demo();
    const base = okData(await api.self.getReservation(RESERVATION.used));
    for (const receiptUrl of [
      "http://receipt.example.com/x",
      "javascript:alert(1)",
      "//receipt.example.com/x",
      "https://user:pass@receipt.example.com/x",
      "",
    ]) {
      const model = buildReservationDetailModel({ kind: "ok", data: { ...base, receiptUrl } });
      if (model.kind !== "ready") throw new Error("expected ready");
      expect(model.receiptHref, receiptUrl).toBeNull();
    }
  });

  it("separates loading, denied and unavailable; another user's Reservation is denied", async () => {
    expect(buildReservationDetailModel({ kind: "loading" })).toEqual({ kind: "loading" });
    expect(buildReservationDetailModel({ kind: "not_found" })).toEqual({ kind: "denied" });
    for (const kind of ["unavailable", "auth_required", "email_unverified"] as const) {
      expect(buildReservationDetailModel({ kind }), kind).toEqual({ kind: "unavailable" });
    }
    const { api } = await demo();
    expect(buildReservationDetailModel(await api.self.getReservation(RESERVATION.other))).toEqual({
      kind: "denied",
    });
  });

  it("does not change the input", async () => {
    const { api } = await demo();
    const data = okData(await api.self.getReservation(RESERVATION.valid));
    const snapshot = JSON.stringify(data);
    buildReservationDetailModel({ kind: "ok", data });
    expect(JSON.stringify(data)).toBe(snapshot);
    expect(data.usageStart as UtcInstant).toBeTruthy();
  });
});
