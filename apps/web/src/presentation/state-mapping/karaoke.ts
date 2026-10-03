import {
  assertNever,
  type KaraokeHoldState,
  type KaraokeSlotState,
  type KaraokeTicketState,
  type ReservationState,
} from "@off-r39x/domain";
import { copy } from "../copy/ja";
import type { Tone } from "./order";

export type SlotPresentation = {
  readonly label: string;
  readonly description: string;
  readonly tone: Tone;
  readonly selectable: boolean;
};

export function presentSlot(state: KaraokeSlotState): SlotPresentation {
  switch (state) {
    case "AVAILABLE":
      return {
        label: copy.karaoke.slot.label.AVAILABLE,
        description: copy.karaoke.slot.description.AVAILABLE,
        tone: "success",
        selectable: true,
      };
    case "HELD":
      return {
        label: copy.karaoke.slot.label.HELD,
        description: copy.karaoke.slot.description.HELD,
        tone: "pending",
        selectable: false,
      };
    case "SOLD":
      return {
        label: copy.karaoke.slot.label.SOLD,
        description: copy.karaoke.slot.description.SOLD,
        tone: "neutral",
        selectable: false,
      };
    case "SALES_STOPPED":
      return {
        label: copy.karaoke.slot.label.SALES_STOPPED,
        description: copy.karaoke.slot.description.SALES_STOPPED,
        tone: "neutral",
        selectable: false,
      };
    default:
      return assertNever(state);
  }
}

export type HoldPresentation = {
  readonly label: string;
  readonly description: string;
  readonly tone: Tone;
};

export function presentHold(state: KaraokeHoldState): HoldPresentation {
  switch (state) {
    case "ACTIVE":
      return {
        label: copy.karaoke.hold.label.ACTIVE,
        description: copy.karaoke.hold.description.ACTIVE,
        tone: "pending",
      };
    case "COMMITTED":
      return {
        label: copy.karaoke.hold.label.COMMITTED,
        description: copy.karaoke.hold.description.COMMITTED,
        tone: "neutral",
      };
    case "RELEASED":
      return {
        label: copy.karaoke.hold.label.RELEASED,
        description: copy.karaoke.hold.description.RELEASED,
        tone: "neutral",
      };
    case "EXPIRED":
      return {
        label: copy.karaoke.hold.label.EXPIRED,
        description: copy.karaoke.hold.description.EXPIRED,
        tone: "neutral",
      };
    default:
      return assertNever(state);
  }
}

export type ReservationTicketPresentation = {
  readonly reservationLabel: string;
  readonly ticketLabel: string;
  readonly primaryLabel: string;
  readonly tone: Tone;
  readonly qrPresentable: boolean;
  readonly disabledReason: string | null;
};

function reservationLabel(state: ReservationState): string {
  switch (state) {
    case "CONFIRMED":
      return copy.karaoke.reservation.CONFIRMED;
    case "CANCELED":
      return copy.karaoke.reservation.CANCELED;
    default:
      return assertNever(state);
  }
}

function ticketLabel(state: KaraokeTicketState): string {
  switch (state) {
    case "VALID":
      return copy.karaoke.ticket.VALID;
    case "USED":
      return copy.karaoke.ticket.USED;
    case "CANCELED":
      return copy.karaoke.ticket.CANCELED;
    case "EXPIRED":
      return copy.karaoke.ticket.EXPIRED;
    default:
      return assertNever(state);
  }
}

function ticketPrimaryLabel(state: KaraokeTicketState): string {
  switch (state) {
    case "VALID":
      return copy.karaoke.primary.VALID;
    case "USED":
      return copy.karaoke.primary.USED;
    case "CANCELED":
      return copy.karaoke.primary.CANCELED;
    case "EXPIRED":
      return copy.karaoke.primary.EXPIRED;
    default:
      return assertNever(state);
  }
}

function ticketDisabledReason(state: Exclude<KaraokeTicketState, "VALID">): string {
  switch (state) {
    case "USED":
      return copy.karaoke.disabledReason.USED;
    case "CANCELED":
      return copy.karaoke.disabledReason.CANCELED;
    case "EXPIRED":
      return copy.karaoke.disabledReason.EXPIRED;
    default:
      return assertNever(state);
  }
}

export function presentReservationTicket(
  reservation: ReservationState,
  ticket: KaraokeTicketState,
): ReservationTicketPresentation {
  // Validate both inputs before deciding (fail closed on any unknown value).
  const base = {
    reservationLabel: reservationLabel(reservation),
    ticketLabel: ticketLabel(ticket),
  };
  const ticketPrimary = ticketPrimaryLabel(ticket);

  if (reservation === "CANCELED") {
    return {
      ...base,
      primaryLabel: copy.karaoke.primary.CANCELED,
      tone: "neutral",
      qrPresentable: false,
      disabledReason: copy.karaoke.disabledReason.reservationCanceled,
    };
  }
  if (ticket === "VALID") {
    return {
      ...base,
      primaryLabel: ticketPrimary,
      tone: "success",
      qrPresentable: true,
      disabledReason: null,
    };
  }
  return {
    ...base,
    primaryLabel: ticketPrimary,
    tone: "neutral",
    qrPresentable: false,
    disabledReason: ticketDisabledReason(ticket),
  };
}
