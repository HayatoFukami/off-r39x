import { describe, expect, it } from "vitest";
import { sameSessionState } from "../../../../apps/web/src/auth/session-equality.ts";
import type { SessionState } from "../../../../apps/web/src/auth/use-session.ts";

// Contract: tests/contracts/s3-layout.md section 3.3 (the provider keeps the state reference while the session is
// unchanged) and tests/contracts/s5-cart.md section 5 (Entry / Cart re-fetch only when the session really changed;
// SPEC-050 14A.1 Cartの現在の販売状態, FR-CRT-005, FR-CRT-012). Pure function: no React, no storage.

const loading: SessionState = { status: "loading" };
const unavailable: SessionState = { status: "unavailable" };
const guest: SessionState = { status: "ready", session: { kind: "guest" } };
const user = (email: string, emailVerified: boolean): SessionState => ({
  status: "ready",
  session: { kind: "authenticated", email, emailVerified },
});

describe("TC-PG-TKT-001-412 sameSessionState tells a real session change from a re-read (FR-CRT-005, FR-CRT-012)", () => {
  it("is true for equal states, including separately built objects", () => {
    expect(sameSessionState(loading, { status: "loading" })).toBe(true);
    expect(sameSessionState(unavailable, { status: "unavailable" })).toBe(true);
    expect(sameSessionState(guest, { status: "ready", session: { kind: "guest" } })).toBe(true);
    expect(sameSessionState(user("a@example.com", true), user("a@example.com", true))).toBe(true);
    expect(sameSessionState(user("a@example.com", false), user("a@example.com", false))).toBe(true);
  });

  it.each([
    ["loading", loading, "ready guest", guest],
    ["loading", loading, "unavailable", unavailable],
    ["unavailable", unavailable, "ready guest", guest],
    ["ready guest", guest, "authenticated", user("a@example.com", true)],
    ["unavailable", unavailable, "authenticated", user("a@example.com", true)],
    ["loading", loading, "authenticated", user("a@example.com", true)],
  ])("is false between %s and %s, in both directions", (_a, a, _b, b) => {
    expect(sameSessionState(a, b)).toBe(false);
    expect(sameSessionState(b, a)).toBe(false);
  });

  it("is false when the email differs", () => {
    expect(sameSessionState(user("a@example.com", true), user("b@example.com", true))).toBe(false);
  });

  it("is false when emailVerified differs", () => {
    expect(sameSessionState(user("a@example.com", true), user("a@example.com", false))).toBe(false);
  });

  it("is symmetric and reflexive over every pair of the sample states", () => {
    const states = [
      loading,
      unavailable,
      guest,
      user("a@example.com", true),
      user("a@example.com", false),
      user("b@example.com", true),
    ];
    for (const a of states) {
      expect(sameSessionState(a, a)).toBe(true);
      for (const b of states) {
        expect(sameSessionState(a, b)).toBe(sameSessionState(b, a));
      }
    }
  });
});
