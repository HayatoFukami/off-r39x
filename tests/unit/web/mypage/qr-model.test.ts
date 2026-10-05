import { describe, expect, it } from "vitest";
import type {
  EntryTicketDetail,
  QrPresentation,
  ReservationDetail,
} from "../../../../apps/web/src/api-client/types.ts";
import {
  buildEntryQrModel,
  buildKaraokeQrModel,
} from "../../../../apps/web/src/features/mypage/qr-model.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import {
  formatBusinessDate,
  formatJstTimeRange,
} from "../../../../apps/web/src/presentation/format/datetime.ts";
import { presentEntryTicket } from "../../../../apps/web/src/presentation/state-mapping/entry-ticket.ts";
import { presentReservationTicket } from "../../../../apps/web/src/presentation/state-mapping/karaoke.ts";
import { createBackend, okData } from "../../../harness/mock-backend.ts";
import { EMAIL, RESERVATION, TICKET } from "../../../harness/mock-seed.ts";

// Contract: tests/contracts/s8-mypage.md section 3.7 (SPEC-050 18.7, 18.10, 20.2, 20.3, 24.2, 25, SEC-QR-012 / 013,
// INV-010-05). Only a synthetic, non-secret mock seed exists here (AGENTS.md section 3).

async function demo() {
  const backend = createBackend();
  await backend.signInAs(EMAIL.demo);
  return backend;
}

const SEED = /mock-seed-\d+/;
const ok = <T>(data: T) => ({ kind: "ok", data }) as const;

async function entryInputs(ref: typeof TICKET.valid) {
  const { api } = await demo();
  return { ticket: await api.self.getEntryTicket(ref), qr: await api.self.getEntryQr(ref) };
}
async function karaokeInputs(ref: typeof RESERVATION.valid) {
  const { api } = await demo();
  return { reservation: await api.self.getReservation(ref), qr: await api.self.getKaraokeQr(ref) };
}

function ready(model: ReturnType<typeof buildEntryQrModel>) {
  if (model.kind !== "ready") throw new Error(`expected ready but got ${model.kind}`);
  return model;
}

describe("TC-PG-MYP-007-621 the Entry QR model draws only a VALID Ticket and names the purpose in text (SPEC-050 18.7, 20.2, SEC-QR-012)", () => {
  it("VALID: presentable, the mock seed is for drawing only, the title and image label are the Entry ones", async () => {
    const { ticket, qr } = await entryInputs(TICKET.valid);
    const model = ready(buildEntryQrModel(ticket, qr));
    expect(model.purpose).toBe("ENTRY");
    expect(model.title).toBe(copy.qr.ENTRY);
    expect(model.imageLabel).toBe(copy.mypage.qr.imageLabel.ENTRY);
    expect(model.presentable).toBe(true);
    expect(model.matrixSeed).toMatch(SEED);
    expect(model.disabledReason).toBeNull();
    expect(model.mockNotice).toBe(copy.mypage.qr.mockNotice);
    expect(model.primaryLabel).toBe(presentEntryTicket("VALID").label);
    expect(model.lines).toEqual([
      { label: copy.mypage.qr.ticketStateLabel, value: presentEntryTicket("VALID").label },
    ]);
    expect(model.backHref).toBe(`/mypage/entry-tickets/${TICKET.valid}`);
    expect(model.backLabel).toBe(copy.mypage.qr.backToTicket);
  });

  for (const [name, ref, state] of [
    ["used", TICKET.used, "USED"],
    ["canceled", TICKET.canceled, "CANCELED"],
    ["expired", TICKET.expired, "EXPIRED"],
  ] as const) {
    it(`${state}: not presentable, no seed anywhere in the model, the state is the main text and the reason is given`, async () => {
      const { ticket, qr } = await entryInputs(ref);
      const model = ready(buildEntryQrModel(ticket, qr));
      expect(model.presentable, name).toBe(false);
      expect(model.matrixSeed).toBeNull();
      expect(model.mockNotice).toBeNull();
      expect(model.primaryLabel).toBe(presentEntryTicket(state).label);
      expect(model.disabledReason).toBe(presentEntryTicket(state).disabledReason);
      expect(model.title).toBe(copy.qr.ENTRY);
      expect(JSON.stringify(model)).not.toMatch(SEED);
    });
  }

  it("never draws a QR for a state that is not VALID, even if the QR presentation claims it is presentable", async () => {
    const { ticket } = await entryInputs(TICKET.used);
    const lying: QrPresentation = {
      kind: "presentable",
      purpose: "ENTRY",
      mockMatrixSeed: "mock-seed-12345678",
    };
    const model = ready(buildEntryQrModel(ticket, ok(lying)));
    expect(model.presentable).toBe(false);
    expect(model.matrixSeed).toBeNull();
    expect(JSON.stringify(model)).not.toMatch(SEED);
  });
});

describe("TC-PG-MYP-007-622 the Entry QR model fails closed and never mixes the purposes (SEC-QR-012, SPEC-050 26.2)", () => {
  it("a VALID Ticket whose QR presentation is not presentable is unavailable, not a QR and not an Empty", async () => {
    const { ticket } = await entryInputs(TICKET.valid);
    const refused: QrPresentation = { kind: "not_presentable", ticketState: "USED" };
    expect(buildEntryQrModel(ticket, ok(refused))).toEqual({ kind: "unavailable" });
  });

  it("a Karaoke presentation on the Entry page is never drawn", async () => {
    const { ticket } = await entryInputs(TICKET.valid);
    const wrongPurpose: QrPresentation = {
      kind: "presentable",
      purpose: "KARAOKE",
      mockMatrixSeed: "mock-seed-87654321",
    };
    const model = buildEntryQrModel(ticket, ok(wrongPurpose));
    expect(model).toEqual({ kind: "unavailable" });
    expect(JSON.stringify(model)).not.toMatch(SEED);
  });

  it("combines the two reads: denied beats loading, loading beats unavailable, and any failure is unavailable", async () => {
    const { ticket, qr } = await entryInputs(TICKET.valid);
    expect(buildEntryQrModel({ kind: "not_found" }, { kind: "loading" })).toEqual({
      kind: "denied",
    });
    expect(buildEntryQrModel({ kind: "loading" }, { kind: "not_found" })).toEqual({
      kind: "denied",
    });
    expect(buildEntryQrModel({ kind: "not_found" }, { kind: "unavailable" })).toEqual({
      kind: "denied",
    });
    expect(buildEntryQrModel({ kind: "loading" }, { kind: "loading" })).toEqual({
      kind: "loading",
    });
    expect(buildEntryQrModel(ticket, { kind: "loading" })).toEqual({ kind: "loading" });
    expect(buildEntryQrModel({ kind: "loading" }, qr)).toEqual({ kind: "loading" });
    expect(buildEntryQrModel({ kind: "loading" }, { kind: "unavailable" })).toEqual({
      kind: "loading",
    });
    for (const kind of ["unavailable", "auth_required", "email_unverified"] as const) {
      expect(buildEntryQrModel(ticket, { kind }), kind).toEqual({ kind: "unavailable" });
      expect(buildEntryQrModel({ kind }, qr), kind).toEqual({ kind: "unavailable" });
    }
  });

  it("another user's Ticket and a Reservation ref are both denied (no cross-purpose lookup)", async () => {
    const { api } = await demo();
    for (const ref of [TICKET.other, RESERVATION.valid as unknown as typeof TICKET.valid]) {
      const model = buildEntryQrModel(
        await api.self.getEntryTicket(ref),
        await api.self.getEntryQr(ref),
      );
      expect(model, ref).toEqual({ kind: "denied" });
    }
  });

  it("does not change its inputs", async () => {
    const { ticket, qr } = await entryInputs(TICKET.valid);
    const snapshot = JSON.stringify([ticket, qr]);
    buildEntryQrModel(ticket, qr);
    expect(JSON.stringify([ticket, qr])).toBe(snapshot);
    expect((okData(ticket) as EntryTicketDetail).ticketRef).toBe(TICKET.valid);
  });
});

describe("TC-PG-MYP-010-621 the Karaoke QR model carries the Reservation date and states next to the QR (SPEC-050 18.10, 24.2)", () => {
  it("CONFIRMED + VALID: presentable with the Karaoke title, image label and the four lines", async () => {
    const { reservation, qr } = await karaokeInputs(RESERVATION.valid);
    const model = ready(buildKaraokeQrModel(reservation, qr));
    const source = okData(reservation) as ReservationDetail;
    const presented = presentReservationTicket("CONFIRMED", "VALID");
    expect(model.purpose).toBe("KARAOKE");
    expect(model.title).toBe(copy.qr.KARAOKE);
    expect(model.title).not.toBe(copy.qr.ENTRY);
    expect(model.imageLabel).toBe(copy.mypage.qr.imageLabel.KARAOKE);
    expect(model.presentable).toBe(true);
    expect(model.matrixSeed).toMatch(SEED);
    expect(model.mockNotice).toBe(copy.mypage.qr.mockNotice);
    expect(model.disabledReason).toBeNull();
    expect(model.primaryLabel).toBe(presented.primaryLabel);
    expect(model.lines).toEqual([
      { label: copy.mypage.qr.dateLabel, value: formatBusinessDate(source.date) },
      {
        label: copy.mypage.qr.timeLabel,
        value: formatJstTimeRange(source.usageStart, source.usageEnd),
      },
      { label: copy.mypage.qr.reservationStateLabel, value: presented.reservationLabel },
      { label: copy.mypage.qr.ticketStateLabel, value: presented.ticketLabel },
    ]);
    expect(model.backHref).toBe(`/mypage/karaoke/${RESERVATION.valid}`);
    expect(model.backLabel).toBe(copy.mypage.qr.backToReservation);
  });

  for (const [name, ref, reservationState, ticketState] of [
    ["used", RESERVATION.used, "CONFIRMED", "USED"],
    ["canceled", RESERVATION.canceled, "CANCELED", "CANCELED"],
    ["expired", RESERVATION.expired, "CONFIRMED", "EXPIRED"],
  ] as const) {
    it(`${name}: ${reservationState} + ${ticketState} is not drawn; the state is the main text and still has the date`, async () => {
      const { reservation, qr } = await karaokeInputs(ref);
      const model = ready(buildKaraokeQrModel(reservation, qr));
      const presented = presentReservationTicket(reservationState, ticketState);
      expect(model.presentable).toBe(false);
      expect(model.matrixSeed).toBeNull();
      expect(model.mockNotice).toBeNull();
      expect(model.primaryLabel).toBe(presented.primaryLabel);
      expect(model.disabledReason).toBe(presented.disabledReason);
      expect(model.lines).toHaveLength(4);
      expect(JSON.stringify(model)).not.toMatch(SEED);
    });
  }

  it("a canceled Reservation and a canceled Ticket are both shown as cancelled (取消済み)", async () => {
    const { reservation, qr } = await karaokeInputs(RESERVATION.canceled);
    expect(ready(buildKaraokeQrModel(reservation, qr)).primaryLabel).toBe(
      copy.karaoke.primary.CANCELED,
    );
  });
});

describe("TC-PG-MYP-010-622 the Karaoke QR model fails closed and never mixes the purposes (SEC-QR-012)", () => {
  it("an Entry presentation on the Karaoke page is never drawn, and a refused VALID reservation is unavailable", async () => {
    const { reservation } = await karaokeInputs(RESERVATION.valid);
    const entry: QrPresentation = {
      kind: "presentable",
      purpose: "ENTRY",
      mockMatrixSeed: "mock-seed-11112222",
    };
    const model = buildKaraokeQrModel(reservation, ok(entry));
    expect(model).toEqual({ kind: "unavailable" });
    expect(JSON.stringify(model)).not.toMatch(SEED);
    expect(
      buildKaraokeQrModel(
        reservation,
        ok({ kind: "not_presentable", ticketState: "USED" } as QrPresentation),
      ),
    ).toEqual({ kind: "unavailable" });
  });

  it("never draws a QR for a Reservation that is not CONFIRMED + VALID, whatever the presentation says", async () => {
    const { reservation } = await karaokeInputs(RESERVATION.canceled);
    const lying: QrPresentation = {
      kind: "presentable",
      purpose: "KARAOKE",
      mockMatrixSeed: "mock-seed-33334444",
    };
    const model = ready(buildKaraokeQrModel(reservation, ok(lying)));
    expect(model.presentable).toBe(false);
    expect(model.matrixSeed).toBeNull();
  });

  it("combines the two reads like the Entry model and denies another user's Reservation and a Ticket ref", async () => {
    const { reservation, qr } = await karaokeInputs(RESERVATION.valid);
    expect(buildKaraokeQrModel({ kind: "not_found" }, { kind: "loading" })).toEqual({
      kind: "denied",
    });
    expect(buildKaraokeQrModel(reservation, { kind: "loading" })).toEqual({ kind: "loading" });
    expect(buildKaraokeQrModel({ kind: "loading" }, { kind: "unavailable" })).toEqual({
      kind: "loading",
    });
    for (const kind of ["unavailable", "auth_required", "email_unverified"] as const) {
      expect(buildKaraokeQrModel(reservation, { kind }), kind).toEqual({ kind: "unavailable" });
      expect(buildKaraokeQrModel({ kind }, qr), kind).toEqual({ kind: "unavailable" });
    }
    const { api } = await demo();
    for (const ref of [RESERVATION.other, TICKET.valid as unknown as typeof RESERVATION.valid]) {
      const model = buildKaraokeQrModel(
        await api.self.getReservation(ref),
        await api.self.getKaraokeQr(ref),
      );
      expect(model, ref).toEqual({ kind: "denied" });
    }
  });
});
