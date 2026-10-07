import { describe, expect, it } from "vitest";
import { cartLineKey } from "../../../../apps/web/src/api-client/cart-line-key.ts";
import type { CartLine } from "../../../../apps/web/src/api-client/types.ts";
import { createBackend, createFakeClock, okData } from "../../../harness/mock-backend.ts";
import {
  ANNOUNCEMENT,
  D1,
  D2,
  DAY_MS,
  GOODS,
  jstDatePlus,
  MARKER,
  NOW_ISO,
  OFFERING,
  SLOT,
  SPONSOR,
} from "../../../harness/mock-seed.ts";

const nowMs = Date.parse(NOW_ISO);

describe("TC-PG-PUB-001-101 getEvent and listFaqs (BR-EVT-001/002, FR-PUB-013, 11.1)", () => {
  it("returns the event with every field when eventFields is complete", async () => {
    const { api } = createBackend();
    const event = okData(await api.public.getEvent());
    expect(event.name.length).toBeGreaterThan(0);
    for (const key of [
      "overview",
      "startsAt",
      "endsAt",
      "venueName",
      "venueGuide",
      "accessInfo",
    ] as const) {
      expect(event[key], key).not.toBeNull();
    }
    expect(event.notices?.length).toBeGreaterThan(0);
  });

  it("returns null for every optional field (never a guessed value) under missing_optional", async () => {
    const backend = createBackend();
    backend.setScenario({ eventFields: "missing_optional" });
    const event = okData(await backend.api.public.getEvent());
    expect(event.name.length).toBeGreaterThan(0);
    expect(event).toMatchObject({
      overview: null,
      startsAt: null,
      endsAt: null,
      venueName: null,
      venueGuide: null,
      accessInfo: null,
      notices: null,
    });
  });

  it("returns only PUBLISHED FAQ items", async () => {
    const { api } = createBackend();
    const faqs = okData(await api.public.listFaqs());
    expect(faqs.length).toBe(3);
    expect(JSON.stringify(faqs)).not.toContain(MARKER.draftFaq);
    for (const faq of faqs) {
      expect(faq.question.length).toBeGreaterThan(0);
      expect(faq.answer.length).toBeGreaterThan(0);
    }
  });
});

describe("TC-PG-PUB-002-101 announcements: PUBLISHED only, newest first (BR-EVT-002, INV-010-08)", () => {
  it("lists the 3 PUBLISHED announcements in publishedAt descending order", async () => {
    const { api } = createBackend();
    const list = okData(await api.public.listAnnouncements());
    expect(list.map((a) => a.announcementRef)).toEqual([
      ANNOUNCEMENT.latest,
      ANNOUNCEMENT.script,
      ANNOUNCEMENT.older,
    ]);
    const times = list.map((a) => Date.parse(a.publishedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(times[0]).toBe(nowMs - DAY_MS);
    expect(times[1]).toBe(nowMs - 2 * DAY_MS);
    expect(times[2]).toBe(nowMs - 10 * DAY_MS);
  });

  it("never leaks DRAFT or ARCHIVED announcements", async () => {
    const { api } = createBackend();
    const raw = JSON.stringify(okData(await api.public.listAnnouncements()));
    expect(raw).not.toContain(MARKER.draftAnnouncement);
    expect(raw).not.toContain(MARKER.archivedAnnouncement);
    expect(await api.public.getAnnouncement(ANNOUNCEMENT.draft)).toEqual({ kind: "not_found" });
    expect(await api.public.getAnnouncement(ANNOUNCEMENT.archived)).toEqual({ kind: "not_found" });
  });

  it("applies limit after sorting", async () => {
    const { api } = createBackend();
    const two = okData(await api.public.listAnnouncements({ limit: 2 }));
    expect(two.map((a) => a.announcementRef)).toEqual([ANNOUNCEMENT.latest, ANNOUNCEMENT.script]);
    const one = okData(await api.public.listAnnouncements({ limit: 1 }));
    expect(one.map((a) => a.announcementRef)).toEqual([ANNOUNCEMENT.latest]);
  });
});

describe("TC-PG-PUB-003-101 announcement detail returns the body verbatim (SEC-WEB-017..019)", () => {
  it("keeps <script> markup as the original text without escaping or stripping", async () => {
    const { api } = createBackend();
    const detail = okData(await api.public.getAnnouncement(ANNOUNCEMENT.script));
    expect(detail.body).toContain(MARKER.scriptMarkup);
    expect(detail.announcementRef).toBe(ANNOUNCEMENT.script);
    expect(detail.title.length).toBeGreaterThan(0);
  });

  it("returns not_found for an unknown or malformed ref, not an empty body", async () => {
    const { api } = createBackend();
    const unknown = "11111111-1111-4111-8111-111111111111" as typeof ANNOUNCEMENT.latest;
    expect(await api.public.getAnnouncement(unknown)).toEqual({ kind: "not_found" });
    expect(await api.public.getAnnouncement("not-a-uuid" as typeof ANNOUNCEMENT.latest)).toEqual({
      kind: "not_found",
    });
  });
});

describe("TC-PG-PUB-002-102 public fetch scenarios keep unavailable distinct from empty (FR-PUB-013, 9.2, 21)", () => {
  it("fail makes every public read unavailable", async () => {
    const backend = createBackend();
    backend.setScenario({ publicFetch: "fail" });
    const { api } = backend;
    const lines: CartLine[] = [
      { kind: "ENTRY_TICKET", offeringRef: OFFERING.regular, quantity: 1 },
    ];
    const results = [
      await api.public.getEvent(),
      await api.public.listFaqs(),
      await api.public.listAnnouncements(),
      await api.public.getAnnouncement(ANNOUNCEMENT.latest),
      await api.public.listEntryOfferings(),
      await api.public.getKaraokeSales(),
      await api.public.getKaraokeDay(D1),
      await api.public.getKaraokeSlot(SLOT.d1_1000),
      await api.public.listGoods(),
      await api.public.getGoods(GOODS.tshirt),
      await api.public.resolveCartLines(lines),
    ];
    for (const result of results) expect(result).toEqual({ kind: "unavailable" });
  });

  it("empty returns ok with zero items for list reads, which differs from unavailable", async () => {
    const backend = createBackend();
    backend.setScenario({ publicFetch: "empty" });
    const { api } = backend;
    expect(await api.public.listFaqs()).toEqual({ kind: "ok", data: [] });
    expect(await api.public.listAnnouncements()).toEqual({ kind: "ok", data: [] });
    expect(await api.public.listEntryOfferings()).toEqual({ kind: "ok", data: [] });
    expect(await api.public.listGoods()).toEqual({ kind: "ok", data: [] });
    expect(okData(await api.public.getKaraokeSales()).salesDates).toEqual([]);
    const day = okData(await api.public.getKaraokeDay(D1));
    expect(day.buckets).toEqual([]);
  });

  it("empty leaves single-item reads and cart resolution as in ok", async () => {
    const backend = createBackend();
    backend.setScenario({ publicFetch: "empty" });
    const { api } = backend;
    expect(okData(await api.public.getEvent()).name.length).toBeGreaterThan(0);
    expect((await api.public.getAnnouncement(ANNOUNCEMENT.latest)).kind).toBe("ok");
    expect((await api.public.getGoods(GOODS.tshirt)).kind).toBe("ok");
    expect((await api.public.getKaraokeSlot(SLOT.d1_1000)).kind).toBe("ok");
  });

  it("applies latency to every public call using the injected sleep only", async () => {
    const backend = createBackend();
    backend.setScenario({ latency: "long", latencyLongMs: 777 });
    await backend.api.public.getEvent();
    await backend.api.public.listFaqs();
    await backend.api.public.listGoods();
    expect(backend.sleep.calls).toEqual([777, 777, 777]);
    const none = createBackend();
    await none.api.public.getEvent();
    expect(none.sleep.calls).toEqual([]);
  });
});

describe("TC-BR-EVT-005-101 sponsor logos: PUBLISHED only in display order (BR-EVT-005, 8.5)", () => {
  it("returns only PUBLISHED logos sorted by display order, not by seed order", async () => {
    const { api } = createBackend();
    const logos = okData(await api.public.listSponsorLogos());
    expect(logos.map((l) => l.sponsorRef)).toEqual([SPONSOR.alpha, SPONSOR.bravo, SPONSOR.charlie]);
    expect(logos.map((l) => l.name)).toEqual(["Sponsor Alpha", "Sponsor Bravo", "Sponsor Charlie"]);
    const raw = JSON.stringify(logos);
    expect(raw).not.toContain(MARKER.draftSponsor);
    expect(raw).not.toContain(MARKER.archivedSponsor);
  });

  it("exposes link URLs only where configured and image URLs as relative paths", async () => {
    const { api } = createBackend();
    const logos = okData(await api.public.listSponsorLogos());
    expect(logos.map((l) => l.linkUrl)).toEqual([
      "https://sponsor-alpha.example.com/",
      null,
      "https://sponsor-charlie.example.com/",
    ]);
    for (const logo of logos) {
      expect(logo.imageUrl).toMatch(/^\/mock\/sponsors\/.+\.svg$/);
    }
  });

  it("none is ok with zero logos and fail is unavailable (never the same)", async () => {
    const none = createBackend();
    none.setScenario({ sponsorLogos: "none" });
    expect(await none.api.public.listSponsorLogos()).toEqual({ kind: "ok", data: [] });
    const fail = createBackend();
    fail.setScenario({ sponsorLogos: "fail" });
    expect(await fail.api.public.listSponsorLogos()).toEqual({ kind: "unavailable" });
  });

  it("image_broken keeps the same logos but points every image at a missing file", async () => {
    const backend = createBackend();
    backend.setScenario({ sponsorLogos: "image_broken" });
    const logos = okData(await backend.api.public.listSponsorLogos());
    expect(logos.map((l) => l.name)).toEqual(["Sponsor Alpha", "Sponsor Bravo", "Sponsor Charlie"]);
    for (const logo of logos) expect(logo.imageUrl).toBe(MARKER.brokenImage);
  });

  it("is not affected by the public fetch scenario (the footer must not break navigation)", async () => {
    const backend = createBackend();
    backend.setScenario({ publicFetch: "fail" });
    expect((await backend.api.public.listSponsorLogos()).kind).toBe("ok");
  });
});

describe("TC-PG-TKT-001-101 entry offerings cover the 6 sales states (SPEC-050 12.1, FR-CRT-005)", () => {
  it("returns the 6 public offerings in seed order with the documented availability for a guest", async () => {
    const { api } = createBackend();
    const offerings = okData(await api.public.listEntryOfferings());
    expect(offerings.map((o) => o.offeringRef)).toEqual([
      OFFERING.regular,
      OFFERING.early,
      OFFERING.ended,
      OFFERING.suspended,
      OFFERING.soldout,
      OFFERING.limit,
    ]);
    const byRef = new Map(offerings.map((o) => [o.offeringRef, o]));
    expect(byRef.get(OFFERING.regular)?.availability).toEqual({
      kind: "ON_SALE",
      maxSelectableQuantity: 4,
    });
    expect(byRef.get(OFFERING.early)?.availability).toEqual({
      kind: "BEFORE_SALES",
      startsAt: new Date(nowMs + 3 * DAY_MS).toISOString().replace(".000Z", "Z"),
    });
    expect(byRef.get(OFFERING.ended)?.availability).toEqual({ kind: "SALES_ENDED" });
    expect(byRef.get(OFFERING.suspended)?.availability).toEqual({ kind: "SUSPENDED" });
    expect(byRef.get(OFFERING.soldout)?.availability).toEqual({ kind: "SOLD_OUT" });
    expect(byRef.get(OFFERING.limit)?.availability).toEqual({
      kind: "ON_SALE",
      maxSelectableQuantity: 2,
    });
  });

  it("carries decimal-string JPY prices and a limit note per offering", async () => {
    const { api } = createBackend();
    const offerings = okData(await api.public.listEntryOfferings());
    const prices = Object.fromEntries(offerings.map((o) => [o.offeringRef, o.unitPrice]));
    expect(prices[OFFERING.regular]).toEqual({ amount: "3000", currency: "JPY" });
    expect(prices[OFFERING.early]).toEqual({ amount: "3500", currency: "JPY" });
    expect(prices[OFFERING.limit]).toEqual({ amount: "2500", currency: "JPY" });
    const limits = Object.fromEntries(offerings.map((o) => [o.offeringRef, o.perAccountLimit]));
    expect(limits[OFFERING.regular]).toBe(4);
    expect(limits[OFFERING.limit]).toBe(2);
    expect(limits[OFFERING.early]).toBeNull();
  });

  it("evaluates sales windows against the injected clock (half-open at the end)", async () => {
    const clock = createFakeClock();
    const backend = createBackend({ clock });
    const before = okData(await backend.api.public.listEntryOfferings());
    expect(before.find((o) => o.offeringRef === OFFERING.early)?.availability.kind).toBe(
      "BEFORE_SALES",
    );
    clock.advance(3 * DAY_MS); // exactly the start instant
    const atStart = okData(await backend.api.public.listEntryOfferings());
    expect(atStart.find((o) => o.offeringRef === OFFERING.early)?.availability.kind).toBe(
      "ON_SALE",
    );
  });
});

describe("TC-PG-TKT-001-102 purchase limit is viewer specific (UCR-110-001, 12.1)", () => {
  it("shows PURCHASE_LIMIT_EXCEEDED only to a viewer who used the limit", async () => {
    const backend = createBackend();
    await backend.signInAs("demo@example.com");
    const demo = okData(await backend.api.public.listEntryOfferings());
    expect(demo.find((o) => o.offeringRef === OFFERING.limit)?.availability).toEqual({
      kind: "PURCHASE_LIMIT_EXCEEDED",
    });
    expect(demo.find((o) => o.offeringRef === OFFERING.regular)?.availability).toEqual({
      kind: "ON_SALE",
      maxSelectableQuantity: 4,
    });
    await backend.signOut();
    const guest = okData(await backend.api.public.listEntryOfferings());
    expect(guest.find((o) => o.offeringRef === OFFERING.limit)?.availability.kind).toBe("ON_SALE");
    await backend.signInAs("new@example.com");
    const fresh = okData(await backend.api.public.listEntryOfferings());
    expect(fresh.find((o) => o.offeringRef === OFFERING.limit)?.availability).toEqual({
      kind: "ON_SALE",
      maxSelectableQuantity: 2,
    });
  });
});

describe("TC-PG-GDS-001-101 goods list and detail states (SPEC-050 14.1/14.2, BR-SAL-005)", () => {
  it("lists the 6 public goods with distinct availability and hides the non-public one", async () => {
    const { api } = createBackend();
    const goods = okData(await api.public.listGoods());
    expect(goods.map((g) => g.goodsRef)).toEqual([
      GOODS.tshirt,
      GOODS.towel,
      GOODS.badge,
      GOODS.poster,
      GOODS.sticker,
      GOODS.lanyard,
    ]);
    const byRef = new Map(goods.map((g) => [g.goodsRef, g.availability]));
    expect(byRef.get(GOODS.tshirt)).toEqual({ kind: "ON_SALE", maxSelectableQuantity: 20 });
    expect(byRef.get(GOODS.towel)).toEqual({ kind: "ON_SALE", maxSelectableQuantity: 3 });
    expect(byRef.get(GOODS.badge)).toEqual({ kind: "SOLD_OUT" });
    expect(byRef.get(GOODS.poster)).toEqual({
      kind: "BEFORE_SALES",
      startsAt: new Date(nowMs + 5 * DAY_MS).toISOString().replace(".000Z", "Z"),
    });
    expect(byRef.get(GOODS.sticker)).toEqual({ kind: "SALES_ENDED" });
    expect(byRef.get(GOODS.lanyard)).toEqual({ kind: "SUSPENDED" });
    expect(JSON.stringify(goods)).not.toContain(MARKER.hiddenGoods);
  });

  it("returns goods detail as venue-pickup only and not_found for the non-public goods", async () => {
    const { api } = createBackend();
    const detail = okData(await api.public.getGoods(GOODS.tshirt));
    expect(detail.venuePickupOnly).toBe(true);
    expect(detail.unitPrice).toEqual({ amount: "4000", currency: "JPY" });
    expect(detail.availability).toEqual({ kind: "ON_SALE", maxSelectableQuantity: 20 });
    expect(await api.public.getGoods(GOODS.hidden)).toEqual({ kind: "not_found" });
    expect(
      await api.public.getGoods("22222222-2222-4222-8222-222222222222" as typeof GOODS.tshirt),
    ).toEqual({ kind: "not_found" });
  });
});

describe("TC-PG-CRT-001-101 resolveCartLines returns per-line availability (FR-CRT-005, 14A.1)", () => {
  const entry = (offeringRef: typeof OFFERING.regular, quantity: number): CartLine => ({
    kind: "ENTRY_TICKET",
    offeringRef,
    quantity,
  });
  const goods = (goodsRef: typeof GOODS.tshirt, quantity: number): CartLine => ({
    kind: "GOODS",
    goodsRef,
    quantity,
  });

  it("resolves each line in input order with name, current unit price and availability", async () => {
    const { api } = createBackend();
    const lines = [entry(OFFERING.regular, 2), goods(GOODS.tshirt, 1)];
    const resolved = okData(await api.public.resolveCartLines(lines));
    expect(resolved.map((r) => r.lineKey)).toEqual(lines.map(cartLineKey));
    expect(resolved[0]).toMatchObject({
      status: "resolved",
      unitPrice: { amount: "3000", currency: "JPY" },
      availability: { kind: "ON_SALE", maxSelectableQuantity: 4 },
    });
    expect(resolved[1]).toMatchObject({
      status: "resolved",
      unitPrice: { amount: "4000", currency: "JPY" },
      availability: { kind: "ON_SALE", maxSelectableQuantity: 20 },
    });
    for (const line of resolved) {
      if (line.status === "resolved") expect(line.name.length).toBeGreaterThan(0);
    }
  });

  it("uses the line key format kind:ref", () => {
    expect(cartLineKey(entry(OFFERING.regular, 1))).toBe(`ENTRY_TICKET:${OFFERING.regular}`);
    expect(cartLineKey(goods(GOODS.towel, 1))).toBe(`GOODS:${GOODS.towel}`);
  });

  it("maps every non-purchasable state per line (7 reasons are distinguishable)", async () => {
    const { api } = createBackend();
    const resolved = okData(
      await api.public.resolveCartLines([
        entry(OFFERING.early, 1),
        entry(OFFERING.ended, 1),
        entry(OFFERING.suspended, 1),
        entry(OFFERING.soldout, 1),
        goods(GOODS.towel, 4),
        entry(OFFERING.regular, 5),
        goods(GOODS.badge, 1),
      ]),
    );
    const kinds = resolved.map((r) => (r.status === "resolved" ? r.availability.kind : r.status));
    expect(kinds).toEqual([
      "BEFORE_SALES",
      "SALES_ENDED",
      "SUSPENDED",
      "SOLD_OUT",
      "INSUFFICIENT_QUANTITY",
      "PURCHASE_LIMIT_EXCEEDED",
      "SOLD_OUT",
    ]);
    const towel = resolved[4];
    expect(towel?.status === "resolved" ? towel.availability : null).toEqual({
      kind: "INSUFFICIENT_QUANTITY",
      maxSelectableQuantity: 3,
    });
  });

  it("evaluates the per-account quota with the viewer's used quantity", async () => {
    const backend = createBackend();
    await backend.signInAs("demo@example.com");
    const resolved = okData(await backend.api.public.resolveCartLines([entry(OFFERING.limit, 1)]));
    expect(resolved[0]).toMatchObject({
      status: "resolved",
      availability: { kind: "PURCHASE_LIMIT_EXCEEDED" },
    });
  });

  it("returns not_public for non-public or unknown refs and keeps resolving the other lines", async () => {
    const { api } = createBackend();
    const unknown = "33333333-3333-4333-8333-333333333333" as typeof GOODS.tshirt;
    const resolved = okData(
      await api.public.resolveCartLines([
        goods(GOODS.hidden, 1),
        goods(unknown, 1),
        goods(GOODS.tshirt, 1),
      ]),
    );
    expect(resolved[0]).toEqual({
      lineKey: cartLineKey(goods(GOODS.hidden, 1)),
      status: "not_public",
    });
    expect(resolved[1]).toEqual({ lineKey: cartLineKey(goods(unknown, 1)), status: "not_public" });
    expect(resolved[2]?.status).toBe("resolved");
  });

  it("returns ok with an empty list for no lines", async () => {
    const { api } = createBackend();
    expect(await api.public.resolveCartLines([])).toEqual({ kind: "ok", data: [] });
  });
});

describe("TC-PG-CRT-001-102 cart state scenarios (SPEC-050 14A.1, 21)", () => {
  const lines: CartLine[] = [
    { kind: "ENTRY_TICKET", offeringRef: OFFERING.regular, quantity: 1 },
    { kind: "GOODS", goodsRef: GOODS.tshirt, quantity: 1 },
  ];

  it("fail makes the whole resolution unavailable (never an empty cart)", async () => {
    const backend = createBackend();
    backend.setScenario({ cart: { state: "fail" } });
    expect(await backend.api.public.resolveCartLines(lines)).toEqual({ kind: "unavailable" });
  });

  it("partial marks only the first line unavailable and resolves the rest", async () => {
    const backend = createBackend();
    backend.setScenario({ cart: { state: "partial" } });
    const resolved = okData(await backend.api.public.resolveCartLines(lines));
    expect(resolved[0]).toEqual({
      lineKey: cartLineKey(lines[0] as CartLine),
      status: "unavailable",
    });
    expect(resolved[1]?.status).toBe("resolved");
  });
});

describe("TC-PG-KRK-001-101 karaoke sales guide (SPEC-050 13.1, FR-KRK)", () => {
  it("returns price, sales period, sale status and the two sales dates", async () => {
    const { api } = createBackend();
    const sales = okData(await api.public.getKaraokeSales());
    expect(sales.price).toEqual({ amount: "1000", currency: "JPY" });
    expect(sales.saleStatus).toBe("ON_SALE");
    expect(sales.salesDates).toEqual([D1, D2]);
    expect(D1).toBe(jstDatePlus(NOW_ISO, 7));
    expect(Date.parse(sales.salesPeriod.startsAt)).toBe(nowMs - 30 * DAY_MS);
    expect(Date.parse(sales.salesPeriod.endsAt)).toBe(nowMs + 30 * DAY_MS);
  });

  it.each(["BEFORE_SALES", "SALES_ENDED", "SUSPENDED"] as const)(
    "reflects the %s scenario in the sale status",
    async (status) => {
      const backend = createBackend();
      backend.setScenario({ karaokeSales: status });
      expect(okData(await backend.api.public.getKaraokeSales()).saleStatus).toBe(status);
    },
  );
});

describe("TC-PG-KRK-002-103 karaoke day schedule buckets via the API (13.2, API-PUB-007/008)", () => {
  it("D1 has the documented JST half-open buckets with total and available counts", async () => {
    const { api } = createBackend();
    const day = okData(await api.public.getKaraokeDay(D1));
    expect(day.date).toBe(D1);
    expect(day.saleStatus).toBe("ON_SALE");
    expect(day.buckets.map((b) => [b.startHour, b.totalSlots, b.availableSlots])).toEqual([
      [10, 3, 1],
      [11, 3, 3],
      [12, 3, 0],
      [13, 1, 1],
      [14, 1, 0],
    ]);
    expect(day.previousDate).toBeNull();
    expect(day.nextDate).toBe(D2);
    const all = day.buckets.flatMap((b) => b.slots.map((s) => s.slotRef));
    expect(all.length).toBe(11);
    expect(new Set(all).size).toBe(11);
  });

  it("D2 buckets by the JST hour even though 08:40 JST falls on the previous UTC day", async () => {
    const { api } = createBackend();
    const day = okData(await api.public.getKaraokeDay(D2));
    expect(day.buckets.map((b) => [b.startHour, b.totalSlots, b.availableSlots])).toEqual([
      [8, 1, 1],
      [9, 1, 1],
    ]);
    expect(day.buckets[0]?.slots[0]?.slotRef).toBe(SLOT.d2_0840);
    expect(day.buckets[1]?.slots[0]?.slotRef).toBe(SLOT.d2_0900);
    expect(day.previousDate).toBe(D1);
    expect(day.nextDate).toBeNull();
  });

  it("exposes the four slot states in the buckets", async () => {
    const { api } = createBackend();
    const day = okData(await api.public.getKaraokeDay(D1));
    const states = new Map(day.buckets.flatMap((b) => b.slots.map((s) => [s.slotRef, s.state])));
    expect(states.get(SLOT.d1_1000)).toBe("AVAILABLE");
    expect(states.get(SLOT.d1_1020)).toBe("HELD");
    expect(states.get(SLOT.d1_1040)).toBe("SOLD");
    expect(states.get(SLOT.d1_1200)).toBe("SALES_STOPPED");
  });

  it("returns not_found for a date that is not a sales date", async () => {
    const { api } = createBackend();
    expect(await api.public.getKaraokeDay(jstDatePlus(NOW_ISO, 9))).toEqual({ kind: "not_found" });
    expect(await api.public.getKaraokeDay(jstDatePlus(NOW_ISO, 0))).toEqual({ kind: "not_found" });
    expect(await api.public.getKaraokeDay("not-a-date" as typeof D1)).toEqual({
      kind: "not_found",
    });
  });

  it("keeps totals but reports zero available slots when the sale is not ON_SALE", async () => {
    const backend = createBackend();
    backend.setScenario({ karaokeSales: "SUSPENDED" });
    const day = okData(await backend.api.public.getKaraokeDay(D1));
    expect(day.saleStatus).toBe("SUSPENDED");
    expect(day.buckets.map((b) => [b.totalSlots, b.availableSlots])).toEqual([
      [3, 0],
      [3, 0],
      [3, 0],
      [1, 0],
      [1, 0],
    ]);
  });
});

describe("TC-PG-KRK-003-101 karaoke slot detail (13.3, BR-KRK-004)", () => {
  it("returns the date, JST-derived times, price and purchasability per state", async () => {
    const { api } = createBackend();
    const available = okData(await api.public.getKaraokeSlot(SLOT.d1_1000));
    expect(available).toMatchObject({
      slotRef: SLOT.d1_1000,
      date: D1,
      state: "AVAILABLE",
      saleStatus: "ON_SALE",
      purchasable: true,
      price: { amount: "1000", currency: "JPY" },
    });
    // 2027-03-08 10:00 JST = 01:00Z; usage lasts 15 minutes.
    expect(available.usageStart).toBe("2027-03-08T01:00:00Z");
    expect(Date.parse(available.usageEnd) - Date.parse(available.usageStart)).toBe(15 * 60 * 1000);
    for (const [slot, state] of [
      [SLOT.d1_1020, "HELD"],
      [SLOT.d1_1040, "SOLD"],
      [SLOT.d1_1200, "SALES_STOPPED"],
    ] as const) {
      const detail = okData(await api.public.getKaraokeSlot(slot));
      expect(detail.state).toBe(state);
      expect(detail.purchasable).toBe(false);
    }
  });

  it("is not purchasable when the sale is not ON_SALE even for an AVAILABLE slot", async () => {
    const backend = createBackend();
    backend.setScenario({ karaokeSales: "BEFORE_SALES" });
    const detail = okData(await backend.api.public.getKaraokeSlot(SLOT.d1_1000));
    expect(detail.state).toBe("AVAILABLE");
    expect(detail.saleStatus).toBe("BEFORE_SALES");
    expect(detail.purchasable).toBe(false);
  });

  it("returns not_found for an unknown slot", async () => {
    const { api } = createBackend();
    expect(
      await api.public.getKaraokeSlot(
        "44444444-4444-4444-8444-444444444444" as typeof SLOT.d1_1000,
      ),
    ).toEqual({ kind: "not_found" });
  });
});

describe("TC-DEV-REL-001-102 seed times are relative to the injected clock (DEV-REL-001)", () => {
  it("shifts the relative seed values when the clock starts at another instant", async () => {
    const later = "2027-06-15T09:30:00Z";
    const backend = createBackend({ clock: createFakeClock(later) });
    const laterMs = Date.parse(later);
    const offerings = okData(await backend.api.public.listEntryOfferings());
    const early = offerings.find((o) => o.offeringRef === OFFERING.early);
    expect(early?.availability).toEqual({
      kind: "BEFORE_SALES",
      startsAt: new Date(laterMs + 3 * DAY_MS).toISOString().replace(".000Z", "Z"),
    });
    const list = okData(await backend.api.public.listAnnouncements());
    expect(Date.parse(list[0]?.publishedAt ?? "")).toBe(laterMs - DAY_MS);
    const sales = okData(await backend.api.public.getKaraokeSales());
    expect(sales.salesDates).toEqual([jstDatePlus(later, 7), jstDatePlus(later, 8)]);
    expect(jstDatePlus(later, 7)).not.toBe(D1);
  });
});
