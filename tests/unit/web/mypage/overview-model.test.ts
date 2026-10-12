import { describe, expect, it } from "vitest";
import type {
  EntryTicketSummary,
  GoodsItemSummary,
  OrderSummary,
  ReservationSummary,
} from "../../../../apps/web/src/api-client/types.ts";
import {
  buildMypageOverviewModel,
  type OverviewInput,
} from "../../../../apps/web/src/features/mypage/overview-model.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { formatBusinessDate } from "../../../../apps/web/src/presentation/format/datetime.ts";
import { createBackend, okData } from "../../../harness/mock-backend.ts";
import { EMAIL, GOODS_ITEM, ORDER, RESERVATION } from "../../../harness/mock-seed.ts";

// Contract: tests/contracts/s8-mypage.md section 3.9 (SPEC-050 18.1, 9.2, 21, 20.1, INV-010-01 / 07 / 08).
// The data come from the S2 mock port with the seed (UI mock test double, not API / DB coverage).

async function inputFor(email: string): Promise<OverviewInput> {
  const backend = createBackend();
  await backend.signInAs(email);
  const { self } = backend.api;
  return {
    profile: await self.getProfile(),
    orders: await self.listOrders(),
    tickets: await self.listEntryTickets(),
    reservations: await self.listReservations(),
    goodsItems: await self.listGoodsItems(),
  };
}

const FAIL = { kind: "unavailable" } as const;

describe("TC-PG-MYP-001-621 the Overview of a user with every state (demo) summarises each area (SPEC-050 18.1)", () => {
  it("shows the profile, three unconfirmed Orders, the newest Order, Ticket counts, upcoming Karaoke and pickups", async () => {
    const model = buildMypageOverviewModel(await inputFor(EMAIL.demo));

    expect(model.profile).toEqual({
      kind: "ready",
      displayName: "デモ太郎",
      email: EMAIL.demo,
      href: "/mypage/profile",
    });

    if (model.pending.kind !== "items") throw new Error(`pending: ${model.pending.kind}`);
    expect(model.pending.items.map((r) => r.orderRef)).toEqual([
      ORDER.prepared,
      ORDER.awaiting,
      ORDER.review,
    ]);
    expect(model.pending.items.map((r) => r.stateKey)).toEqual([
      "PREPARED",
      "AWAITING_PAYMENT",
      "REVIEW_REQUIRED",
    ]);

    if (model.latest.kind !== "ready") throw new Error(`latest: ${model.latest.kind}`);
    expect(model.latest.row.orderRef).toBe(ORDER.prepared);
    expect(model.latest.row.href).toBe(`/mypage/orders/${ORDER.prepared}`);

    if (model.tickets.kind !== "ready") throw new Error(`tickets: ${model.tickets.kind}`);
    expect(model.tickets).toMatchObject({
      validCount: 2,
      totalCount: 5,
      href: "/mypage/entry-tickets",
    });
    expect(model.tickets.summary).toBe(copy.mypage.overview.ticketsSummary(2, 5));

    if (model.reservations.kind !== "items")
      throw new Error(`reservations: ${model.reservations.kind}`);
    expect(model.reservations.items).toHaveLength(1);
    const reservation = model.reservations.items[0];
    expect(reservation?.reservationRef).toBe(RESERVATION.valid);
    expect(reservation?.href).toBe(`/mypage/karaoke/${RESERVATION.valid}`);
    expect(reservation?.timeText).toBe("12:20-12:35");

    if (model.goods.kind !== "ready") throw new Error(`goods: ${model.goods.kind}`);
    expect(model.goods).toMatchObject({ count: 1, href: "/mypage/goods" });
    expect(model.goods.summary).toBe(copy.mypage.overview.goodsSummary(1));
  });

  it("an unconfirmed Order row carries no right: only the Order's own state, Purpose, total, date and its detail link (INV-010-07)", async () => {
    const model = buildMypageOverviewModel(await inputFor(EMAIL.demo));
    if (model.pending.kind !== "items") throw new Error("expected items");
    const json = JSON.stringify(model.pending);
    expect(json).not.toMatch(/entry-tickets|\/mypage\/karaoke|\/mypage\/goods/);
    for (const row of model.pending.items) {
      expect(row.href).toBe(`/mypage/orders/${row.orderRef}`);
      expect(["PREPARED", "AWAITING_PAYMENT", "REVIEW_REQUIRED"]).toContain(row.stateKey);
    }
  });

  it("counts only what can be received at the venue: an unpaid item is not 'awaiting pickup', a handed-over one is not either (INV-010-07)", async () => {
    const input = await inputFor(EMAIL.demo);
    const items = okData(input.goodsItems as { kind: "ok"; data: readonly GoodsItemSummary[] });
    expect(items.find((g) => g.goodsItemRef === GOODS_ITEM.pendingPayment)?.handoffState).toBe(
      "PENDING",
    );
    const model = buildMypageOverviewModel(input);
    if (model.goods.kind !== "ready") throw new Error("expected ready");
    expect(model.goods.count).toBe(1);
  });
});

describe("TC-PG-MYP-001-622 the Overview of a user with no purchases shows five distinct Empty states, not failures (SPEC-050 9.2, 18.1)", () => {
  it("is empty in every area and unavailable in none", async () => {
    const model = buildMypageOverviewModel(await inputFor(EMAIL.fresh));
    expect(model.profile).toMatchObject({ kind: "ready", displayName: "新規さん" });
    expect(model.pending).toEqual({ kind: "empty" });
    expect(model.latest).toEqual({ kind: "empty" });
    expect(model.tickets).toEqual({ kind: "empty" });
    expect(model.reservations).toEqual({ kind: "empty" });
    expect(model.goods).toEqual({ kind: "empty" });
  });

  it("another user's data is not part of the viewer's Overview", async () => {
    const model = buildMypageOverviewModel(await inputFor(EMAIL.fresh));
    expect(JSON.stringify(model)).not.toContain(ORDER.otherEntry);
    const other = buildMypageOverviewModel(await inputFor(EMAIL.other));
    expect(other.pending).toEqual({ kind: "empty" });
    if (other.latest.kind !== "ready") throw new Error("expected ready");
    expect(other.latest.row.orderRef).toBe(ORDER.otherEntry);
    expect(other.tickets).toMatchObject({ kind: "ready", validCount: 1, totalCount: 1 });
  });
});

describe("TC-PG-MYP-001-623 a failed area is unavailable and never changes another area (SPEC-050 18.1 State, 21)", () => {
  const areas = ["profile", "orders", "tickets", "reservations", "goodsItems"] as const;

  for (const failing of areas) {
    it(`when only ${failing} fails, every other area is exactly what it was`, async () => {
      const healthy = await inputFor(EMAIL.demo);
      const baseline = buildMypageOverviewModel(healthy);
      const broken = buildMypageOverviewModel({ ...healthy, [failing]: FAIL });
      const unavailableAreas: Record<(typeof areas)[number], (keyof typeof baseline)[]> = {
        profile: ["profile"],
        orders: ["pending", "latest"],
        tickets: ["tickets"],
        reservations: ["reservations"],
        goodsItems: ["goods"],
      };
      for (const key of Object.keys(baseline) as (keyof typeof baseline)[]) {
        if (unavailableAreas[failing].includes(key)) {
          expect(broken[key], `${failing} -> ${String(key)}`).toEqual({ kind: "unavailable" });
        } else {
          expect(broken[key], `${failing} -> ${String(key)}`).toEqual(baseline[key]);
        }
      }
    });
  }

  it("a failed read is unavailable (never empty) for every failure kind, including not_found", async () => {
    const healthy = await inputFor(EMAIL.demo);
    for (const kind of ["unavailable", "not_found", "auth_required", "email_unverified"] as const) {
      const model = buildMypageOverviewModel({
        profile: { kind },
        orders: { kind },
        tickets: { kind },
        reservations: { kind },
        goodsItems: { kind },
      });
      expect(
        Object.values(model).map((v) => v.kind),
        kind,
      ).toEqual(Array(6).fill("unavailable"));
      expect(healthy).toBeDefined();
    }
  });

  it("while loading, every area is loading: no empty text and no business result", () => {
    const model = buildMypageOverviewModel({
      profile: { kind: "loading" },
      orders: { kind: "loading" },
      tickets: { kind: "loading" },
      reservations: { kind: "loading" },
      goodsItems: { kind: "loading" },
    });
    expect(Object.values(model).map((v) => v.kind)).toEqual(Array(6).fill("loading"));
  });
});

describe("TC-PG-MYP-001-624 the Overview selection rules (SPEC-050 18.1, 20.3, INV-010-08)", () => {
  const order = (n: number, state: OrderSummary["state"], createdAt: string): OrderSummary => ({
    orderRef: `0d000000-0000-4000-8000-0000000000${n}` as OrderSummary["orderRef"],
    purpose: "ENTRY_TICKET_PURCHASE",
    state,
    createdAt: createdAt as OrderSummary["createdAt"],
    total: { amount: "1000", currency: "JPY" },
    summary: `item ${n}`,
  });

  it("takes the newest Order as the latest one regardless of the input order, and the first of a tie", async () => {
    const healthy = await inputFor(EMAIL.fresh);
    const a = order(21, "CONFIRMED", "2027-03-01T01:00:00Z");
    const b = order(22, "CANCELED", "2027-03-01T02:00:00Z");
    const c = order(23, "EXPIRED", "2027-03-01T02:00:00Z");
    const model = buildMypageOverviewModel({ ...healthy, orders: { kind: "ok", data: [a, c, b] } });
    if (model.latest.kind !== "ready") throw new Error("expected ready");
    expect(model.latest.row.orderRef).toBe(c.orderRef);
    expect(model.pending).toEqual({ kind: "empty" });
  });

  it("lists unconfirmed Orders newest first and never lists a CONFIRMED, FAILED, CANCELED or EXPIRED one", async () => {
    const healthy = await inputFor(EMAIL.fresh);
    const data = [
      order(31, "PREPARED", "2027-03-01T01:00:00Z"),
      order(32, "CONFIRMED", "2027-03-01T05:00:00Z"),
      order(33, "REVIEW_REQUIRED", "2027-03-01T03:00:00Z"),
      order(34, "PAYMENT_FAILED", "2027-03-01T04:00:00Z"),
      order(35, "AWAITING_PAYMENT", "2027-03-01T02:00:00Z"),
      order(36, "CANCELED", "2027-03-01T06:00:00Z"),
      order(37, "EXPIRED", "2027-03-01T07:00:00Z"),
    ];
    const model = buildMypageOverviewModel({ ...healthy, orders: { kind: "ok", data } });
    if (model.pending.kind !== "items") throw new Error("expected items");
    expect(model.pending.items.map((r) => r.stateKey)).toEqual([
      "REVIEW_REQUIRED",
      "AWAITING_PAYMENT",
      "PREPARED",
    ]);
  });

  it("lists only CONFIRMED + VALID Reservations, soonest first, and is empty when every Reservation has ended (no clock is read)", async () => {
    const healthy = await inputFor(EMAIL.demo);
    const base = okData(
      healthy.reservations as { kind: "ok"; data: readonly ReservationSummary[] },
    );
    const make = (
      reservationState: ReservationSummary["reservationState"],
      ticketState: ReservationSummary["ticketState"],
      start: string,
      n: number,
    ): ReservationSummary => ({
      ...(base[0] as ReservationSummary),
      reservationRef:
        `4e000000-0000-4000-8000-0000000000${n}` as ReservationSummary["reservationRef"],
      reservationState,
      ticketState,
      usageStart: start as ReservationSummary["usageStart"],
      usageEnd: new Date(Date.parse(start) + 15 * 60 * 1000)
        .toISOString()
        .replace(".000Z", "Z") as ReservationSummary["usageEnd"],
    });
    const later = make("CONFIRMED", "VALID", "2027-03-09T03:00:00Z", 41);
    const sooner = make("CONFIRMED", "VALID", "2027-03-08T03:00:00Z", 42);
    const data = [
      later,
      make("CONFIRMED", "USED", "2027-03-07T03:00:00Z", 43),
      make("CANCELED", "CANCELED", "2027-03-07T04:00:00Z", 44),
      make("CONFIRMED", "EXPIRED", "2027-03-07T05:00:00Z", 45),
      sooner,
    ];
    const model = buildMypageOverviewModel({ ...healthy, reservations: { kind: "ok", data } });
    if (model.reservations.kind !== "items") throw new Error("expected items");
    expect(model.reservations.items.map((r) => r.reservationRef)).toEqual([
      sooner.reservationRef,
      later.reservationRef,
    ]);
    expect(model.reservations.items[0]?.dateText).toBe(formatBusinessDate(sooner.date));

    const none = buildMypageOverviewModel({
      ...healthy,
      reservations: { kind: "ok", data: data.filter((r) => r.ticketState !== "VALID") },
    });
    expect(none.reservations).toEqual({ kind: "empty" });
  });

  it("does not change its input and does not throw on unusual lists", async () => {
    const healthy = await inputFor(EMAIL.demo);
    const snapshot = JSON.stringify(healthy);
    buildMypageOverviewModel(healthy);
    expect(JSON.stringify(healthy)).toBe(snapshot);
    expect(() =>
      buildMypageOverviewModel({
        ...healthy,
        tickets: { kind: "ok", data: [] as readonly EntryTicketSummary[] },
      }),
    ).not.toThrow();
  });
});
