import { ENTRY_TICKET_STATES } from "@off-r39x/domain";
import { describe, expect, it } from "vitest";
import type { EntryTicketDetail, Ref } from "../../../../apps/web/src/api-client/types.ts";
import {
  buildEntryTicketDetailModel,
  buildEntryTicketListModel,
} from "../../../../apps/web/src/features/mypage/entry-ticket-model.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { formatJstDateTime } from "../../../../apps/web/src/presentation/format/datetime.ts";
import { presentEntryTicket } from "../../../../apps/web/src/presentation/state-mapping/entry-ticket.ts";
import { createBackend, okData } from "../../../harness/mock-backend.ts";
import { EMAIL, ORDER, TICKET } from "../../../harness/mock-seed.ts";

// Contract: tests/contracts/s8-mypage.md section 3.4 (SPEC-050 18.5, 18.6, 20.2, 25, INV-010-05 / 08).

async function demo() {
  const backend = createBackend();
  await backend.signInAs(EMAIL.demo);
  return backend;
}

describe("TC-PG-MYP-005-621 the Entry Ticket list model shows each Ticket with its own state (SPEC-050 18.5, 20.2)", () => {
  it("lists demo's five Tickets in port order with name, state label, detail href and the Order href", async () => {
    const { api } = await demo();
    const data = okData(await api.self.listEntryTickets());
    const model = buildEntryTicketListModel({ kind: "ok", data });
    if (model.kind !== "items") throw new Error(`expected items but got ${model.kind}`);
    expect(model.items).toHaveLength(5);
    expect(model.items.map((i) => i.ticketRef)).toEqual(data.map((t) => t.ticketRef));
    for (const [index, row] of model.items.entries()) {
      const source = data[index];
      expect(row.href).toBe(`/mypage/entry-tickets/${source?.ticketRef}`);
      expect(row.name).toBe(source?.offeringName);
      expect(row.stateKey).toBe(source?.state);
      expect(row.stateLabel).toBe(presentEntryTicket(source?.state ?? "VALID").label);
      expect(row.tone).toBe(presentEntryTicket(source?.state ?? "VALID").tone);
      expect(row.orderHref).toBe(`/mypage/orders/${source?.orderRef}`);
      expect(row.linkLabel).toBe(copy.mypage.entryTickets.detailLink(row.name));
    }
    // The four Canonical states are four different labels (E2E 16).
    expect(new Set(model.items.map((i) => i.stateKey))).toEqual(new Set(ENTRY_TICKET_STATES));
    expect(new Set(model.items.map((i) => i.stateLabel)).size).toBe(ENTRY_TICKET_STATES.length);
    expect(model.items.find((i) => i.ticketRef === TICKET.composite)?.orderHref).toBe(
      `/mypage/orders/${ORDER.confirmedComposite}`,
    );
  });

  it("does not list another user's Ticket", async () => {
    const { api } = await demo();
    const data = okData(await api.self.listEntryTickets());
    const model = buildEntryTicketListModel({ kind: "ok", data });
    expect(JSON.stringify(model)).not.toContain(TICKET.other);
  });

  it("separates loading, Empty and a failed read", async () => {
    expect(buildEntryTicketListModel({ kind: "loading" })).toEqual({ kind: "loading" });
    expect(buildEntryTicketListModel({ kind: "ok", data: [] })).toEqual({ kind: "empty" });
    const backend = createBackend();
    await backend.signInAs(EMAIL.fresh);
    expect(
      buildEntryTicketListModel({
        kind: "ok",
        data: okData(await backend.api.self.listEntryTickets()),
      }),
    ).toEqual({ kind: "empty" });
    for (const kind of ["unavailable", "not_found", "auth_required", "email_unverified"] as const) {
      expect(buildEntryTicketListModel({ kind }), kind).toEqual({ kind: "unavailable" });
    }
  });
});

describe("TC-PG-MYP-006-621 the Entry Ticket detail model offers the QR only for a VALID Ticket (SPEC-050 18.6, 20.2, 25, INV-010-05)", () => {
  const cases = [
    { name: "valid", ref: TICKET.valid, state: "VALID" },
    { name: "used", ref: TICKET.used, state: "USED" },
    { name: "canceled", ref: TICKET.canceled, state: "CANCELED" },
    { name: "expired", ref: TICKET.expired, state: "EXPIRED" },
  ] as const;

  for (const c of cases) {
    it(`${c.name}: label, description, tone, usability, QR action and Order link follow the state`, async () => {
      const { api } = await demo();
      const read = await api.self.getEntryTicket(c.ref);
      const model = buildEntryTicketDetailModel(read);
      if (model.kind !== "ready") throw new Error(`expected ready but got ${model.kind}`);
      const presented = presentEntryTicket(c.state);
      const source = okData(read);
      expect(model.stateKey).toBe(c.state);
      expect(model.stateLabel).toBe(presented.label);
      expect(model.description).toBe(presented.description);
      expect(model.tone).toBe(presented.tone);
      expect(model.name).toBe(source.offeringName);
      expect(model.issuedAtText).toBe(formatJstDateTime(source.issuedAt));
      expect(model.orderHref).toBe(`/mypage/orders/${source.orderRef}`);
      expect(model.usable).toBe(c.state === "VALID");
      expect(model.usableText).toBe(
        c.state === "VALID"
          ? copy.mypage.entryTickets.detail.usable
          : copy.mypage.entryTickets.detail.notUsable,
      );
      if (c.state === "VALID") {
        expect(model.qr).toEqual({
          kind: "link",
          label: copy.mypage.entryTickets.detail.qrLink,
          href: `/mypage/entry-tickets/${c.ref}/qr`,
        });
      } else {
        expect(model.qr).toEqual({
          kind: "disabled",
          label: copy.mypage.entryTickets.detail.qrLink,
          reason: presented.disabledReason,
        });
      }
    });
  }

  it("the four non-QR / QR outcomes are different texts, so a state is never told by the QR action alone", async () => {
    const { api } = await demo();
    const reasons = new Set<string>();
    for (const c of cases.filter((x) => x.state !== "VALID")) {
      const model = buildEntryTicketDetailModel(await api.self.getEntryTicket(c.ref));
      if (model.kind === "ready" && model.qr.kind === "disabled") reasons.add(model.qr.reason);
    }
    expect(reasons.size).toBe(3);
  });

  it("fails closed on an unknown state (never a QR link)", () => {
    const broken = {
      ticketRef: TICKET.valid,
      offeringName: "x",
      state: "UNKNOWN",
      orderRef: ORDER.confirmedEntry,
      issuedAt: "2027-03-01T00:00:00Z",
    } as unknown as EntryTicketDetail;
    let model: ReturnType<typeof buildEntryTicketDetailModel> | undefined;
    try {
      model = buildEntryTicketDetailModel({ kind: "ok", data: broken });
    } catch {
      model = undefined; // an exhaustive mapping may throw: it must not produce a QR link
    }
    if (model !== undefined && model.kind === "ready") expect(model.qr.kind).not.toBe("link");
  });
});

describe("TC-PG-MYP-006-622 detail reads separate denied, unavailable and loading (SPEC-110 22, SPEC-050 26.2)", () => {
  it("maps loading, denied (not_found) and every other failure", () => {
    expect(buildEntryTicketDetailModel({ kind: "loading" })).toEqual({ kind: "loading" });
    expect(buildEntryTicketDetailModel({ kind: "not_found" })).toEqual({ kind: "denied" });
    for (const kind of ["unavailable", "auth_required", "email_unverified"] as const) {
      expect(buildEntryTicketDetailModel({ kind }), kind).toEqual({ kind: "unavailable" });
    }
  });

  it("another user's Ticket and a missing Ticket are both denied for the viewer", async () => {
    const { api } = await demo();
    for (const ref of [TICKET.other, "7c000000-0000-4000-8000-0000000009ff" as Ref<"ticket">]) {
      expect(buildEntryTicketDetailModel(await api.self.getEntryTicket(ref)), ref).toEqual({
        kind: "denied",
      });
    }
  });
});
