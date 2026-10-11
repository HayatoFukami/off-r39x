import { describe, expect, it } from "vitest";
import { decideGate } from "../../../../apps/web/src/auth/gate-decision.ts";
import type { SessionState } from "../../../../apps/web/src/auth/use-session.ts";

// tests/contracts/s6-auth.md section 3. SPEC-060 AR-SES-007 / AR-AZ-011, SPEC-050 15.6 / 17.1.

const UUID = "91000000-0000-4000-8000-000000000001";
const guest: SessionState = { status: "ready", session: { kind: "guest" } };
const verified: SessionState = {
  status: "ready",
  session: { kind: "authenticated", email: "demo@example.com", emailVerified: true },
};
const unverified: SessionState = {
  status: "ready",
  session: { kind: "authenticated", email: "unverified@example.com", emailVerified: false },
};

describe("TC-AR-SES-007-111 AuthGate decision never allows protected content without a verified session (AR-SES-007, AR-AZ-011)", () => {
  it("loading and unavailable sessions are neither allowed nor redirected as guest", () => {
    expect(decideGate({ status: "loading" }, "/mypage")).toEqual({ kind: "loading" });
    expect(decideGate({ status: "unavailable" }, "/mypage")).toEqual({ kind: "unavailable" });
  });

  it("allows only an authenticated session with a verified email", () => {
    expect(decideGate(verified, "/mypage")).toEqual({ kind: "allow" });
    expect(decideGate(verified, `/mypage/orders/${UUID}`)).toEqual({ kind: "allow" });
  });

  it("sends a guest to Login with the logical return destination of the path", () => {
    expect(decideGate(guest, "/mypage")).toEqual({
      kind: "redirect",
      reason: "guest",
      to: "/account/login?continue=mypage",
    });
    const to = (decideGate(guest, `/mypage/orders/${UUID}`) as { to: string }).to;
    expect(new URL(to, "http://localhost").searchParams.get("continue")).toBe(
      `mypage-order:${UUID}`,
    );
    expect(new URL(to, "http://localhost").pathname).toBe("/account/login");
  });

  it("falls back to mypage for a protected path without a key", () => {
    for (const path of [`/mypage/entry-tickets/${UUID}/qr`, "/mypage/unknown", "/purchase"]) {
      expect(decideGate(guest, path), path).toEqual({
        kind: "redirect",
        reason: "guest",
        to: "/account/login?continue=mypage",
      });
    }
  });

  it("sends an unverified authenticated user to Email Verification, keeping the destination", () => {
    expect(decideGate(unverified, "/mypage")).toEqual({
      kind: "redirect",
      reason: "email_unverified",
      to: "/account/email-verification?continue=mypage",
    });
    const to = (decideGate(unverified, `/purchase/orders/${UUID}`) as { to: string }).to;
    expect(new URL(to, "http://localhost").pathname).toBe("/account/email-verification");
    expect(new URL(to, "http://localhost").searchParams.get("continue")).toBe(
      `purchase-order:${UUID}`,
    );
  });

  it("does not mutate its input", () => {
    const input = structuredClone(verified);
    decideGate(input, "/mypage");
    expect(input).toEqual(verified);
  });
});
