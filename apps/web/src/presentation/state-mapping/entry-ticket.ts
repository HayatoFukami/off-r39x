import { assertNever, type EntryTicketState } from "@off-r39x/domain";
import { copy } from "../copy/ja";
import type { Tone } from "./order";

export type EntryTicketPresentation = {
  readonly label: string;
  readonly description: string;
  readonly tone: Tone;
  readonly qrPresentable: boolean;
  readonly disabledReason: string | null;
};

export function presentEntryTicket(state: EntryTicketState): EntryTicketPresentation {
  switch (state) {
    case "VALID":
      return {
        label: copy.entryTicket.label.VALID,
        description: copy.entryTicket.description.VALID,
        tone: "success",
        qrPresentable: true,
        disabledReason: null,
      };
    case "USED":
      return {
        label: copy.entryTicket.label.USED,
        description: copy.entryTicket.description.USED,
        tone: "neutral",
        qrPresentable: false,
        disabledReason: copy.entryTicket.disabledReason.USED,
      };
    case "CANCELED":
      return {
        label: copy.entryTicket.label.CANCELED,
        description: copy.entryTicket.description.CANCELED,
        tone: "neutral",
        qrPresentable: false,
        disabledReason: copy.entryTicket.disabledReason.CANCELED,
      };
    case "EXPIRED":
      return {
        label: copy.entryTicket.label.EXPIRED,
        description: copy.entryTicket.description.EXPIRED,
        tone: "neutral",
        qrPresentable: false,
        disabledReason: copy.entryTicket.disabledReason.EXPIRED,
      };
    default:
      return assertNever(state);
  }
}
