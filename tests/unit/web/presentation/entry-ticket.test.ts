import { ENTRY_TICKET_STATES, type EntryTicketState } from "@off-r39x/domain";
import { describe, expect, it } from "vitest";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { presentEntryTicket } from "../../../../apps/web/src/presentation/state-mapping/entry-ticket.ts";
import { stringLeaves, TONES } from "../../../harness/presentation.ts";

// Hardcoded from SPEC-050 section 20.2 / 18.6 / 18.7.
const LABELS: Record<EntryTicketState, string> = {
  VALID: "利用可能",
  USED: "使用済み",
  CANCELED: "取消済み",
  EXPIRED: "失効済み",
};

describe("TC-PG-MYP-006-001 presentEntryTicket (SPEC-050 20.2, INV-010-05, SEC-QR-012)", () => {
  it.each(ENTRY_TICKET_STATES)("%s uses the SPEC-050 label", (state) => {
    const presented = presentEntryTicket(state);
    expect(presented.label).toBe(LABELS[state]);
    expect(presented.description.length).toBeGreaterThan(0);
    expect(TONES).toContain(presented.tone);
  });

  it("allows QR presentation only for VALID", () => {
    const presentable = ENTRY_TICKET_STATES.filter((s) => presentEntryTicket(s).qrPresentable);
    expect(presentable).toEqual(["VALID"]);
  });

  it("explains why the QR action is unavailable for every non-VALID state (SPEC-050 25)", () => {
    expect(presentEntryTicket("VALID").disabledReason).toBeNull();
    for (const state of ENTRY_TICKET_STATES.filter((s) => s !== "VALID")) {
      const reason = presentEntryTicket(state).disabledReason;
      expect(typeof reason, state).toBe("string");
      expect((reason ?? "").length, state).toBeGreaterThan(0);
    }
  });

  it("never marks a non-VALID ticket with a success tone", () => {
    expect(presentEntryTicket("VALID").tone).toBe("success");
    for (const state of ENTRY_TICKET_STATES.filter((s) => s !== "VALID")) {
      expect(presentEntryTicket(state).tone, state).not.toBe("success");
    }
  });

  it("uses 4 distinct labels that all come from the copy dictionary", () => {
    const dictionary = new Set(stringLeaves(copy));
    const labels = ENTRY_TICKET_STATES.map((s) => presentEntryTicket(s).label);
    expect(new Set(labels).size).toBe(4);
    for (const state of ENTRY_TICKET_STATES) {
      const presented = presentEntryTicket(state);
      expect(dictionary.has(presented.label), `${state} label`).toBe(true);
      expect(dictionary.has(presented.description), `${state} description`).toBe(true);
      if (presented.disabledReason !== null) {
        expect(dictionary.has(presented.disabledReason), `${state} reason`).toBe(true);
      }
    }
  });

  it("fails closed on an unknown runtime state", () => {
    expect(() => presentEntryTicket("REVOKED" as EntryTicketState)).toThrow(/Unexpected value/);
  });
});
