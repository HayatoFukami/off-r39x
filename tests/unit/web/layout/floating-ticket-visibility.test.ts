import { describe, expect, it } from "vitest";
import { isFloatingTicketVisible } from "../../../../apps/web/src/presentation/layout/floating-ticket-visibility.ts";

// Contract: tests/contracts/s10-header-float-reveal.md section 4.1 (SPEC-050 8.5 Floating Ticket Button).

describe("TC-PG-PUB-001-241 Floating Ticket Button visibility by route (SPEC-050 8.5)", () => {
  it("is hidden on the Entry Ticket sales, Cart, Authentication, Mypage, Purchase Status and dev areas", () => {
    const hidden = [
      "/entry",
      "/entry/",
      "/entry/anything",
      "/cart",
      "/cart/",
      "/account/login",
      "/account/register",
      "/account/email-verification",
      "/account/password-reset",
      "/account/password-reset/complete",
      "/account",
      "/mypage",
      "/mypage/orders",
      "/mypage/orders/00000000-0000-4000-8000-000000000001",
      "/mypage/entry-tickets/x/qr",
      "/purchase/orders/00000000-0000-4000-8000-000000000001",
      "/purchase",
      "/dev",
      "/dev/scenarios",
      "/dev/error-probe",
      "/dev/mock-checkout/x",
    ];
    for (const pathname of hidden) {
      expect(isFloatingTicketVisible(pathname), pathname).toBe(false);
    }
  });

  it("is shown on the other general pages, including Not Found", () => {
    const shown = [
      "/",
      "/karaoke",
      "/karaoke/schedule/2027-01-01",
      "/karaoke/slots/x",
      "/goods",
      "/goods/a0000000-0000-4000-8000-000000000001",
      "/announcements",
      "/announcements/x",
      "/no-such-route-r39x",
    ];
    for (const pathname of shown) {
      expect(isFloatingTicketVisible(pathname), pathname).toBe(true);
    }
  });

  it("compares whole path segments, not string prefixes", () => {
    for (const pathname of [
      "/entry-foo",
      "/entries",
      "/cartoon",
      "/carts",
      "/accounts",
      "/mypage2",
      "/purchases",
      "/devices",
      "/development",
      "/goods/entry",
      "/karaoke/dev",
    ]) {
      expect(isFloatingTicketVisible(pathname), pathname).toBe(true);
    }
  });

  it("is case sensitive like the router and does not special-case /admin or /staff", () => {
    expect(isFloatingTicketVisible("/Entry")).toBe(true);
    expect(isFloatingTicketVisible("/CART")).toBe(true);
    expect(isFloatingTicketVisible("/admin")).toBe(true);
    expect(isFloatingTicketVisible("/staff")).toBe(true);
  });
});
