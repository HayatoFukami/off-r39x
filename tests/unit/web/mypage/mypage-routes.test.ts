import { describe, expect, it } from "vitest";
import {
  currentNavKey,
  entryQrHref,
  MYPAGE_NAV_KEYS,
  MYPAGE_PATHS,
  parseGoodsItemRef,
  parseReservationRef,
  parseTicketRef,
  reservationQrHref,
} from "../../../../apps/web/src/config/mypage-routes.ts";
import { GOODS_ITEM, ORDER, RESERVATION, TICKET } from "../../../harness/mock-seed.ts";

// Contract: tests/contracts/s8-mypage.md section 3.1 (SPEC-050 5.2, 7, 17.2, SEC-QR-013).

const UUID = "7c000000-0000-4000-8000-000000000001";

describe("TC-PG-MYP-001-611 the route parameters are canonical UUIDs only and are never repaired (SPEC-050 5.2)", () => {
  const parsers = [
    ["parseTicketRef", parseTicketRef],
    ["parseReservationRef", parseReservationRef],
    ["parseGoodsItemRef", parseGoodsItemRef],
  ] as const;

  for (const [name, parse] of parsers) {
    it(`${name} accepts a canonical lowercase UUID and returns it unchanged`, () => {
      expect(parse(UUID)).toBe(UUID);
      expect(parse(TICKET.valid)).toBe(TICKET.valid);
    });

    it(`${name} rejects upper case, padding, encoding, empty and non-UUID values`, () => {
      for (const raw of [
        UUID.toUpperCase(),
        ` ${UUID}`,
        `${UUID} `,
        `${UUID}\n`,
        encodeURIComponent(UUID).replace(/-/g, "%2D"),
        "",
        "not-a-uuid",
        "7c000000-0000-4000-8000-00000000000",
        "7c000000-0000-4000-8000-0000000000012",
        `${UUID}/qr`,
        `../${UUID}`,
        "0",
      ]) {
        expect(parse(raw), JSON.stringify(raw)).toBeNull();
      }
    });
  }
});

describe("TC-PG-MYP-001-612 the Mypage paths, the QR hrefs and the current navigation entry (SPEC-050 7, 17.2, SEC-QR-013)", () => {
  it("lists the six Mypage areas in the contracted order with their paths", () => {
    expect(MYPAGE_NAV_KEYS).toEqual([
      "overview",
      "profile",
      "orders",
      "entryTickets",
      "reservations",
      "goodsItems",
    ]);
    expect(MYPAGE_PATHS).toEqual({
      overview: "/mypage",
      profile: "/mypage/profile",
      orders: "/mypage/orders",
      entryTickets: "/mypage/entry-tickets",
      reservations: "/mypage/karaoke",
      goodsItems: "/mypage/goods",
    });
  });

  it("builds the QR hrefs from the ref only (no token, no query)", () => {
    expect(entryQrHref(TICKET.valid)).toBe(`/mypage/entry-tickets/${TICKET.valid}/qr`);
    expect(reservationQrHref(RESERVATION.valid)).toBe(`/mypage/karaoke/${RESERVATION.valid}/qr`);
    for (const href of [entryQrHref(TICKET.valid), reservationQrHref(RESERVATION.valid)]) {
      expect(href).not.toMatch(/[?#]/);
      expect(href).not.toMatch(/mock-seed/);
    }
  });

  it("maps every Mypage path (and its detail and QR paths) to one navigation entry", () => {
    const cases: [string, string | null][] = [
      ["/mypage", "overview"],
      ["/mypage/", "overview"],
      ["/mypage?x=1", "overview"],
      ["/mypage/profile", "profile"],
      ["/mypage/orders", "orders"],
      [`/mypage/orders/${ORDER.confirmedEntry}`, "orders"],
      ["/mypage/entry-tickets", "entryTickets"],
      [`/mypage/entry-tickets/${TICKET.valid}`, "entryTickets"],
      [`/mypage/entry-tickets/${TICKET.valid}/qr`, "entryTickets"],
      ["/mypage/karaoke", "reservations"],
      [`/mypage/karaoke/${RESERVATION.valid}`, "reservations"],
      [`/mypage/karaoke/${RESERVATION.valid}/qr`, "reservations"],
      ["/mypage/goods", "goodsItems"],
      [`/mypage/goods/${GOODS_ITEM.completed}`, "goodsItems"],
    ];
    for (const [path, key] of cases) expect(currentNavKey(path), path).toBe(key);
  });

  it("returns null for anything that is not a Mypage area", () => {
    for (const path of [
      "/",
      "/cart",
      "/mypage2",
      "/mypage/unknown",
      "/mypagex/orders",
      "/purchase/orders/x",
    ]) {
      expect(currentNavKey(path), path).toBeNull();
    }
  });
});
