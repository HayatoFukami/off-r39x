import { describe, expect, it } from "vitest";
import type {
  CheckoutStart,
  KaraokePurchaseStart,
  Ref,
} from "../../../../apps/web/src/api-client/types.ts";
import type { SessionState } from "../../../../apps/web/src/auth/use-session.ts";
import {
  interpretKaraokeCheckout,
  interpretKaraokeStart,
  planKaraokeProceed,
} from "../../../../apps/web/src/features/karaoke/karaoke-purchase-flow.ts";
import { interpretCheckoutStart } from "../../../../apps/web/src/features/purchase/cart-purchase-flow.ts";
import { SLOT } from "../../../harness/mock-seed.ts";

// Contract: tests/contracts/s7b-karaoke.md section 3.3 (SPEC-050 13.3 Purchase start 1-7, SPEC-060 AR-CONT-001,
// SEC-WEB-005). Pure decisions; no Order or Hold is created here.

const ORDER = "f0000000-0000-4000-8000-000000000001" as Ref<"order">;
const SLOT_REF = SLOT.d1_1000;
const LOGIN = `/account/login?continue=karaoke-slot%3A${SLOT_REF}`;
const VERIFY = `/account/email-verification?continue=karaoke-slot%3A${SLOT_REF}`;

describe("TC-PG-KRK-003-621 planKaraokeProceed sends only a known Guest to Login with the slot Continuation (SPEC-050 13.3 step 1)", () => {
  it("a guest session goes to Login carrying karaoke-slot:<ref>, without calling the API", () => {
    const state: SessionState = { status: "ready", session: { kind: "guest" } };
    expect(planKaraokeProceed(state, SLOT_REF)).toEqual({ kind: "go_login", to: LOGIN });
  });

  it("an authenticated session, verified or not, starts the purchase (the server answers email_unverified)", () => {
    for (const emailVerified of [true, false]) {
      expect(
        planKaraokeProceed(
          {
            status: "ready",
            session: { kind: "authenticated", email: "demo@example.com", emailVerified },
          },
          SLOT_REF,
        ),
      ).toEqual({ kind: "start" });
    }
  });

  it("a loading or unavailable session is not treated as a guest: the server decides", () => {
    expect(planKaraokeProceed({ status: "loading" }, SLOT_REF)).toEqual({ kind: "start" });
    expect(planKaraokeProceed({ status: "unavailable" }, SLOT_REF)).toEqual({ kind: "start" });
  });

  it("the Login path is a safe relative path that carries only the key and the public ref", () => {
    const plan = planKaraokeProceed({ status: "ready", session: { kind: "guest" } }, SLOT_REF);
    if (plan.kind !== "go_login") throw new Error("expected go_login");
    expect(plan.to.startsWith("/account/login?continue=")).toBe(true);
    expect(plan.to).not.toMatch(/price|amount|slotState|available/i);
  });
});

describe("TC-PG-KRK-003-622 interpretKaraokeStart maps every purchase-start result (SPEC-050 13.3 steps 2-5, 21)", () => {
  it("held carries the new Order on to Checkout", () => {
    expect(interpretKaraokeStart({ kind: "held", orderRef: ORDER }, SLOT_REF)).toEqual({
      kind: "checkout",
      orderRef: ORDER,
    });
  });

  it("keeps the three business failures apart (conflict, limit, not on sale)", () => {
    expect(interpretKaraokeStart({ kind: "slot_unavailable" }, SLOT_REF)).toEqual({
      kind: "conflict",
    });
    expect(interpretKaraokeStart({ kind: "purchase_limit_exceeded" }, SLOT_REF)).toEqual({
      kind: "limit",
    });
    expect(interpretKaraokeStart({ kind: "not_on_sale" }, SLOT_REF)).toEqual({
      kind: "not_on_sale",
    });
  });

  it("auth_required goes to Login and email_unverified to Email Verification, both with the slot intent", () => {
    expect(interpretKaraokeStart({ kind: "auth_required" }, SLOT_REF)).toEqual({
      kind: "go_login",
      to: LOGIN,
    });
    expect(interpretKaraokeStart({ kind: "email_unverified" }, SLOT_REF)).toEqual({
      kind: "go_verification",
      to: VERIFY,
    });
  });

  it("unavailable is its own step", () => {
    expect(interpretKaraokeStart({ kind: "unavailable" }, SLOT_REF)).toEqual({
      kind: "unavailable",
    });
  });

  it("every result of the port maps to a distinct step and the input is not mutated", () => {
    const results: KaraokePurchaseStart[] = [
      { kind: "held", orderRef: ORDER },
      { kind: "slot_unavailable" },
      { kind: "purchase_limit_exceeded" },
      { kind: "not_on_sale" },
      { kind: "auth_required" },
      { kind: "email_unverified" },
      { kind: "unavailable" },
    ];
    const before = JSON.stringify(results);
    const kinds = results.map((r) => interpretKaraokeStart(r, SLOT_REF).kind);
    expect(new Set(kinds).size).toBe(results.length);
    expect(JSON.stringify(results)).toBe(before);
  });
});

describe("TC-PG-KRK-003-623 interpretKaraokeCheckout keeps an expired Hold on the slot page and delegates the rest (SPEC-050 13.3 steps 5-7, 16.6, SEC-WEB-005)", () => {
  it("opportunity_expired is the expired step: choose again, never reuse the Hold", () => {
    expect(interpretKaraokeCheckout(ORDER, { kind: "opportunity_expired" })).toEqual({
      kind: "expired",
    });
  });

  it("a redirect to the mock Checkout is a top-level assign", () => {
    const url = `/dev/mock-checkout/${ORDER}`;
    expect(interpretKaraokeCheckout(ORDER, { kind: "redirect", url })).toEqual({
      kind: "assign",
      url,
    });
  });

  it("start_failed, state_conflict, auth_required and unavailable go to Purchase Status of the same Order", () => {
    for (const result of [
      { kind: "start_failed" },
      { kind: "state_conflict" },
      { kind: "auth_required" },
      { kind: "unavailable" },
    ] as CheckoutStart[]) {
      expect(interpretKaraokeCheckout(ORDER, result), result.kind).toEqual({
        kind: "go_status",
        to: `/purchase/orders/${ORDER}`,
      });
    }
  });

  it("an unsafe redirect URL is never assigned", () => {
    for (const url of ["javascript:alert(1)", "http://example.com/x", "//evil.example/x", ""]) {
      expect(interpretKaraokeCheckout(ORDER, { kind: "redirect", url }), url).toEqual({
        kind: "go_status",
        to: `/purchase/orders/${ORDER}`,
      });
    }
  });

  it("agrees with the Cart's interpretation for every result except opportunity_expired", () => {
    const results: CheckoutStart[] = [
      { kind: "redirect", url: `/dev/mock-checkout/${ORDER}` },
      { kind: "start_failed" },
      { kind: "state_conflict" },
      { kind: "auth_required" },
      { kind: "unavailable" },
    ];
    for (const result of results) {
      expect(interpretKaraokeCheckout(ORDER, result), result.kind).toEqual(
        interpretCheckoutStart(ORDER, result),
      );
    }
  });
});
