import type { Ref, ReservationDetail, ReservationSummary } from "../../api-client/types";
import { reservationQrHref } from "../../config/mypage-routes";
import { mypageOrderHref, reservationHref } from "../../config/purchase-routes";
import {
  type ListState,
  type Loadable,
  toListState,
} from "../../presentation/components/list-state";
import { safeExternalHref } from "../../presentation/components/safe-url";
import { copy } from "../../presentation/copy/ja";
import {
  formatBusinessDate,
  formatJstTime,
  formatJstTimeRange,
} from "../../presentation/format/datetime";
import { presentReservationTicket } from "../../presentation/state-mapping/karaoke";
import type { Tone } from "../../presentation/state-mapping/order";

// View models of PG-MYP-008 / 009 (SPEC-050 18.8, 18.9, 20.3, 23). Pure: the Reservation state and the
// Karaoke Ticket state stay apart (a used Ticket is a Ticket state, never a Reservation state of its own).

export type ReservationRow = {
  reservationRef: Ref<"reservation">;
  href: string;
  dateText: string;
  timeText: string;
  reservationLabel: string;
  ticketLabel: string;
  primaryLabel: string;
  tone: Tone;
  linkLabel: string;
};

/** Soonest first; the input order is kept on a tie (stable) and the input is not changed. */
export function sortByUsageStart(
  reservations: readonly ReservationSummary[],
): ReservationSummary[] {
  return reservations
    .map((reservation, index) => ({ reservation, index }))
    .sort(
      (a, b) =>
        Date.parse(a.reservation.usageStart) - Date.parse(b.reservation.usageStart) ||
        a.index - b.index,
    )
    .map(({ reservation }) => reservation);
}

export function toReservationRow(reservation: ReservationSummary): ReservationRow {
  const presented = presentReservationTicket(reservation.reservationState, reservation.ticketState);
  const dateText = formatBusinessDate(reservation.date);
  const timeText = formatJstTimeRange(reservation.usageStart, reservation.usageEnd);
  return {
    reservationRef: reservation.reservationRef,
    href: reservationHref(reservation.reservationRef),
    dateText,
    timeText,
    reservationLabel: presented.reservationLabel,
    ticketLabel: presented.ticketLabel,
    primaryLabel: presented.primaryLabel,
    tone: presented.tone,
    linkLabel: copy.mypage.reservations.detailLink(dateText, timeText),
  };
}

export function buildReservationListModel(
  input: Loadable<readonly ReservationSummary[]>,
): ListState<ReservationRow> {
  return toListState(
    input.kind === "ok" ? { kind: "ok", data: sortByUsageStart(input.data) } : input,
    toReservationRow,
  );
}

export type ReservationDetailModel =
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "unavailable" }
  | {
      kind: "ready";
      reservationRef: Ref<"reservation">;
      dateText: string;
      startText: string;
      endText: string;
      timeText: string;
      reservationLabel: string;
      ticketLabel: string;
      primaryLabel: string;
      tone: Tone;
      qr:
        | { kind: "link"; label: string; href: string }
        | { kind: "disabled"; label: string; reason: string };
      orderHref: string;
      receiptHref: string | null;
    };

export function buildReservationDetailModel(
  input: Loadable<ReservationDetail>,
): ReservationDetailModel {
  switch (input.kind) {
    case "loading":
      return { kind: "loading" };
    case "not_found":
      // Another user's Reservation and a missing one are the same answer (SPEC-110 22).
      return { kind: "denied" };
    case "unavailable":
    case "auth_required":
    case "email_unverified":
      return { kind: "unavailable" };
    case "ok": {
      const reservation = input.data;
      const presented = presentReservationTicket(
        reservation.reservationState,
        reservation.ticketState,
      );
      const label = copy.mypage.reservations.detail.qrLink;
      return {
        kind: "ready",
        reservationRef: reservation.reservationRef,
        dateText: formatBusinessDate(reservation.date),
        startText: formatJstTime(reservation.usageStart),
        endText: formatJstTime(reservation.usageEnd),
        timeText: formatJstTimeRange(reservation.usageStart, reservation.usageEnd),
        reservationLabel: presented.reservationLabel,
        ticketLabel: presented.ticketLabel,
        primaryLabel: presented.primaryLabel,
        tone: presented.tone,
        qr: presented.qrPresentable
          ? { kind: "link", label, href: reservationQrHref(reservation.reservationRef) }
          : { kind: "disabled", label, reason: presented.disabledReason ?? "" },
        orderHref: mypageOrderHref(reservation.orderRef),
        receiptHref: safeExternalHref(reservation.receiptUrl),
      };
    }
    default: {
      const unreachable: never = input;
      return unreachable;
    }
  }
}
