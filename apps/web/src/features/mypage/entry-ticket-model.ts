import type { EntryTicketState } from "@off-r39x/domain";
import type { EntryTicketDetail, EntryTicketSummary, Ref } from "../../api-client/types";
import { entryQrHref } from "../../config/mypage-routes";
import { entryTicketHref, mypageOrderHref } from "../../config/purchase-routes";
import {
  type ListState,
  type Loadable,
  toListState,
} from "../../presentation/components/list-state";
import { copy } from "../../presentation/copy/ja";
import { formatJstDateTime } from "../../presentation/format/datetime";
import { presentEntryTicket } from "../../presentation/state-mapping/entry-ticket";
import type { Tone } from "../../presentation/state-mapping/order";

// View models of PG-MYP-005 / 006 (SPEC-050 18.5, 18.6, 20.2, 25). Pure: the Ticket state is the
// server's; the QR is offered only for a VALID Ticket.

export type EntryTicketRow = {
  ticketRef: Ref<"ticket">;
  href: string;
  name: string;
  stateKey: EntryTicketState;
  stateLabel: string;
  tone: Tone;
  orderHref: string;
  linkLabel: string;
};

export function buildEntryTicketListModel(
  input: Loadable<readonly EntryTicketSummary[]>,
): ListState<EntryTicketRow> {
  return toListState(input, (ticket): EntryTicketRow => {
    const presented = presentEntryTicket(ticket.state);
    return {
      ticketRef: ticket.ticketRef,
      href: entryTicketHref(ticket.ticketRef),
      name: ticket.offeringName,
      stateKey: ticket.state,
      stateLabel: presented.label,
      tone: presented.tone,
      orderHref: mypageOrderHref(ticket.orderRef),
      linkLabel: copy.mypage.entryTickets.detailLink(ticket.offeringName),
    };
  });
}

export type EntryTicketDetailModel =
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "unavailable" }
  | {
      kind: "ready";
      ticketRef: Ref<"ticket">;
      name: string;
      stateKey: EntryTicketState;
      stateLabel: string;
      description: string;
      tone: Tone;
      issuedAtText: string;
      usable: boolean;
      usableText: string;
      qr:
        | { kind: "link"; label: string; href: string }
        | { kind: "disabled"; label: string; reason: string };
      orderHref: string;
    };

export function buildEntryTicketDetailModel(
  input: Loadable<EntryTicketDetail>,
): EntryTicketDetailModel {
  switch (input.kind) {
    case "loading":
      return { kind: "loading" };
    case "not_found":
      // Another user's Ticket and a missing Ticket are the same answer (SPEC-110 22).
      return { kind: "denied" };
    case "unavailable":
    case "auth_required":
    case "email_unverified":
      return { kind: "unavailable" };
    case "ok": {
      const ticket = input.data;
      const presented = presentEntryTicket(ticket.state);
      const usable = ticket.state === "VALID";
      const label = copy.mypage.entryTickets.detail.qrLink;
      return {
        kind: "ready",
        ticketRef: ticket.ticketRef,
        name: ticket.offeringName,
        stateKey: ticket.state,
        stateLabel: presented.label,
        description: presented.description,
        tone: presented.tone,
        issuedAtText: formatJstDateTime(ticket.issuedAt),
        usable,
        usableText: usable
          ? copy.mypage.entryTickets.detail.usable
          : copy.mypage.entryTickets.detail.notUsable,
        qr:
          presented.qrPresentable && usable
            ? { kind: "link", label, href: entryQrHref(ticket.ticketRef) }
            : { kind: "disabled", label, reason: presented.disabledReason ?? "" },
        orderHref: mypageOrderHref(ticket.orderRef),
      };
    }
    default: {
      const unreachable: never = input;
      return unreachable;
    }
  }
}
