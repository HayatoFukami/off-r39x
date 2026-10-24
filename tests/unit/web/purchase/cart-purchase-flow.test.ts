import { describe, expect, it } from "vitest";
import type {
  CartLine,
  CartPurchaseStart,
  CartRejectionReasonCode,
  CheckoutStart,
  Ref,
} from "../../../../apps/web/src/api-client/types.ts";
import type { SessionState } from "../../../../apps/web/src/auth/use-session.ts";
import {
  describeRejections,
  interpretCartStart,
  interpretCheckoutStart,
  isSafeCheckoutUrl,
  orderedLines,
  planProceed,
} from "../../../../apps/web/src/features/purchase/cart-purchase-flow.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { presentRejectionReason } from "../../../../apps/web/src/presentation/state-mapping/availability.ts";

// Contract: tests/contracts/s7a-purchase.md section 3.2 (SPEC-050 14A.1 Actions / Purchase start result,
// SEC-WEB-005, SPEC-060 AR-CONT-001, AR-AUTH-006..008). Pure decisions; no Order is created here.

const ORDER = "f0000000-0000-4000-8000-000000000001" as Ref<"order">;
const LOGIN_CART = "/account/login?continue=cart";
const VERIFY_CART = "/account/email-verification?continue=cart";

describe("TC-PG-CRT-001-621 planProceed sends only a known Guest to Login and lets the server decide otherwise (SPEC-050 14A.1)", () => {
  it("a guest session goes to Login with the Cart Continuation, without calling the API", () => {
    const state: SessionState = { status: "ready", session: { kind: "guest" } };
    expect(planProceed(state)).toEqual({ kind: "go_login", to: LOGIN_CART });
  });

  it("an authenticated session, verified or not, starts the purchase (the server answers email_unverified)", () => {
    expect(
      planProceed({
        status: "ready",
        session: { kind: "authenticated", email: "demo@example.com", emailVerified: true },
      }),
    ).toEqual({ kind: "start" });
    expect(
      planProceed({
        status: "ready",
        session: { kind: "authenticated", email: "unverified@example.com", emailVerified: false },
      }),
    ).toEqual({ kind: "start" });
  });

  it("a loading or unavailable session is not treated as a guest nor as verified: the server decides", () => {
    expect(planProceed({ status: "loading" })).toEqual({ kind: "start" });
    expect(planProceed({ status: "unavailable" })).toEqual({ kind: "start" });
  });

  it("the Login target carries the Cart key only (no value) and is a safe path", () => {
    const plan = planProceed({ status: "ready", session: { kind: "guest" } });
    expect(plan.kind).toBe("go_login");
    if (plan.kind === "go_login") {
      expect(new URL(plan.to, "http://127.0.0.1").searchParams.get("continue")).toBe("cart");
      expect(plan.to).not.toMatch(/price|amount|quantity|total/i);
    }
  });
});

describe("TC-PG-CRT-001-622 interpretCartStart maps each purchase start result to one next step (SPEC-050 14A.1 Purchase start result)", () => {
  it("created continues to Checkout with the same Order and the included line keys", () => {
    const result: CartPurchaseStart = {
      kind: "created",
      orderRef: ORDER,
      includedLineKeys: ["ENTRY_TICKET:a", "GOODS:b"],
    };
    expect(interpretCartStart(result)).toEqual({
      kind: "checkout",
      orderRef: ORDER,
      includedLineKeys: ["ENTRY_TICKET:a", "GOODS:b"],
    });
  });

  it("rejected stays a rejection with the rejections unchanged, in order (no Order was created)", () => {
    const rejections: { lineKey: string; reason: CartRejectionReasonCode }[] = [
      { lineKey: "GOODS:b", reason: "SOLD_OUT" },
      { lineKey: "ENTRY_TICKET:a", reason: "PURCHASE_LIMIT_EXCEEDED" },
    ];
    expect(interpretCartStart({ kind: "rejected", rejections })).toEqual({
      kind: "rejected",
      rejections,
    });
  });

  it("an empty rejection list is still a rejection, never a created Order", () => {
    expect(interpretCartStart({ kind: "rejected", rejections: [] })).toEqual({
      kind: "rejected",
      rejections: [],
    });
  });

  it("auth_required goes to Login and email_unverified to Email Verification, both keeping the Cart intent", () => {
    expect(interpretCartStart({ kind: "auth_required" })).toEqual({
      kind: "go_login",
      to: LOGIN_CART,
    });
    expect(interpretCartStart({ kind: "email_unverified" })).toEqual({
      kind: "go_verification",
      to: VERIFY_CART,
    });
  });

  it("unavailable is a failure to start, not a success", () => {
    expect(interpretCartStart({ kind: "unavailable" })).toEqual({ kind: "unavailable" });
  });

  it("does not mutate its input", () => {
    const result: CartPurchaseStart = {
      kind: "created",
      orderRef: ORDER,
      includedLineKeys: ["ENTRY_TICKET:a"],
    };
    const copyOf = structuredClone(result);
    interpretCartStart(result);
    expect(result).toEqual(copyOf);
  });
});

describe("TC-SEC-WEB-005-601 interpretCheckoutStart navigates top-level only to a safe URL, otherwise reads the Order again (SEC-WEB-005, SPEC-050 16.6)", () => {
  const status = `/purchase/orders/${ORDER}`;

  it("a safe redirect becomes a top-level assign of that URL", () => {
    expect(
      interpretCheckoutStart(ORDER, { kind: "redirect", url: `/dev/mock-checkout/${ORDER}` }),
    ).toEqual({ kind: "assign", url: `/dev/mock-checkout/${ORDER}` });
    expect(
      interpretCheckoutStart(ORDER, {
        kind: "redirect",
        url: "https://checkout.example.com/c/pay/session-1",
      }),
    ).toEqual({ kind: "assign", url: "https://checkout.example.com/c/pay/session-1" });
  });

  it.each<[string, CheckoutStart]>([
    ["start_failed", { kind: "start_failed" }],
    ["opportunity_expired", { kind: "opportunity_expired" }],
    ["state_conflict", { kind: "state_conflict" }],
    ["auth_required", { kind: "auth_required" }],
    ["unavailable", { kind: "unavailable" }],
  ])(
    "%s goes to the Purchase Status of the same Order (never a new Order, never success)",
    (_n, result) => {
      expect(interpretCheckoutStart(ORDER, result)).toEqual({ kind: "go_status", to: status });
    },
  );

  it("an unsafe redirect URL is not followed: the same Order status page is shown instead", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,x",
      "http://checkout.example.com/x",
      "//evil.example.com/x",
      "/admin/orders",
    ]) {
      expect(interpretCheckoutStart(ORDER, { kind: "redirect", url }), url).toEqual({
        kind: "go_status",
        to: status,
      });
    }
  });
});

describe("TC-SEC-WEB-005-602 isSafeCheckoutUrl allows a same-origin path or an https URL without credentials (SEC-WEB-005, SEC-WEB-013)", () => {
  it.each([
    `/dev/mock-checkout/${ORDER}`,
    "/purchase/orders/x",
    "https://checkout.example.com/c/pay/session-1",
    "https://checkout.example.com/",
  ])("accepts %s", (url) => {
    expect(isSafeCheckoutUrl(url)).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["http", "http://checkout.example.com/x"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,<script>1</script>"],
    ["vbscript scheme", "vbscript:msgbox(1)"],
    ["protocol-relative", "//evil.example.com/x"],
    ["backslash host", "/\\evil.example.com"],
    ["backslash path", "\\evil"],
    ["control character", "/dev/mock-checkout/x\n"],
    ["leading space", " /dev/mock-checkout/x"],
    ["trailing space", "https://checkout.example.com/x "],
    ["admin area", "/admin/x"],
    ["staff area", "/staff"],
    ["encoded admin", "/%61dmin"],
    ["userinfo", "https://user:pw@checkout.example.com/x"],
    ["username only", "https://user@checkout.example.com/x"],
    ["not a URL", "checkout"],
    ["ftp", "ftp://example.com/x"],
  ])("rejects %s", (_name, url) => {
    expect(isSafeCheckoutUrl(url)).toBe(false);
  });

  it("never throws, whatever the input", () => {
    for (const url of ["https://", "https://[", "http://", "::::", "\u0000", "%", "/%"]) {
      expect(() => isSafeCheckoutUrl(url), url).not.toThrow();
    }
  });
});

describe("TC-PG-CRT-001-623 describeRejections names each rejected line with a distinct reason (SPEC-050 14A.1, 21)", () => {
  const names = new Map<string, string | null>([
    ["ENTRY_TICKET:a", "Alpha Ticket"],
    ["GOODS:b", "Bravo Goods"],
    ["GOODS:c", null],
  ]);

  it("keeps the input order, one entry per rejection, with the line's name", () => {
    const lines = describeRejections(
      [
        { lineKey: "GOODS:b", reason: "SOLD_OUT" },
        { lineKey: "ENTRY_TICKET:a", reason: "ALLOCATION_CONFLICT" },
      ],
      names,
    );
    expect(lines.map((l) => l.lineKey)).toEqual(["GOODS:b", "ENTRY_TICKET:a"]);
    expect(lines.map((l) => l.name)).toEqual(["Bravo Goods", "Alpha Ticket"]);
  });

  it("takes label and description from the shared rejection presentation, for all eight reasons", () => {
    const reasons: CartRejectionReasonCode[] = [
      "BEFORE_SALES",
      "SALES_ENDED",
      "SUSPENDED",
      "SOLD_OUT",
      "INSUFFICIENT_QUANTITY",
      "PURCHASE_LIMIT_EXCEEDED",
      "ALLOCATION_CONFLICT",
      "NOT_PUBLIC",
    ];
    const lines = describeRejections(
      reasons.map((reason) => ({ lineKey: "ENTRY_TICKET:a", reason })),
      names,
    );
    expect(lines).toHaveLength(8);
    lines.forEach((line, index) => {
      const reason = reasons[index];
      if (reason === undefined) throw new Error("reason expected");
      const expected = presentRejectionReason(reason);
      expect(line.label).toBe(expected.label);
      expect(line.description).toBe(expected.description);
    });
    expect(new Set(lines.map((l) => l.label)).size).toBe(8);
  });

  it("uses the generic name for a line whose name is unknown (null or not in the map)", () => {
    const lines = describeRejections(
      [
        { lineKey: "GOODS:c", reason: "NOT_PUBLIC" },
        { lineKey: "GOODS:z", reason: "SOLD_OUT" },
      ],
      names,
    );
    expect(lines.map((l) => l.name)).toEqual([
      copy.cart.unknownItemName,
      copy.cart.unknownItemName,
    ]);
  });

  it("returns nothing for no rejections and does not mutate its input", () => {
    expect(describeRejections([], names)).toEqual([]);
    const rejections = [{ lineKey: "GOODS:b", reason: "SOLD_OUT" as const }];
    const before = structuredClone(rejections);
    describeRejections(rejections, names);
    expect(rejections).toEqual(before);
  });
});

describe("TC-PG-CRT-001-624 orderedLines returns the sent lines the Order included, at the sent quantity (FR-CRT-011, BR-ORD-014)", () => {
  const entryLine: CartLine = {
    kind: "ENTRY_TICKET",
    offeringRef: "e0000000-0000-4000-8000-000000000001" as Ref<"offering">,
    quantity: 2,
  };
  const goodsLine: CartLine = {
    kind: "GOODS",
    goodsRef: "a0000000-0000-4000-8000-000000000001" as Ref<"goods">,
    quantity: 3,
  };
  const otherGoods: CartLine = {
    kind: "GOODS",
    goodsRef: "a0000000-0000-4000-8000-000000000002" as Ref<"goods">,
    quantity: 1,
  };
  const keyOf = (line: CartLine): string =>
    line.kind === "ENTRY_TICKET" ? `ENTRY_TICKET:${line.offeringRef}` : `GOODS:${line.goodsRef}`;

  it("returns the included lines in the snapshot order with the sent quantities", () => {
    const sent = [entryLine, goodsLine, otherGoods];
    expect(orderedLines(sent, [keyOf(otherGoods), keyOf(entryLine)])).toEqual([
      entryLine,
      otherGoods,
    ]);
  });

  it("leaves out the sent lines the Order did not include", () => {
    expect(orderedLines([entryLine, goodsLine], [keyOf(goodsLine)])).toEqual([goodsLine]);
    expect(orderedLines([entryLine, goodsLine], [])).toEqual([]);
  });

  it("does not count a line twice when the included keys repeat", () => {
    const result = orderedLines([entryLine], [keyOf(entryLine), keyOf(entryLine)]);
    expect(result).toEqual([entryLine]);
  });

  it("ignores an included key that was never sent", () => {
    expect(orderedLines([entryLine], [keyOf(entryLine), keyOf(otherGoods)])).toEqual([entryLine]);
  });

  it("does not mutate its inputs", () => {
    const sent = Object.freeze([Object.freeze({ ...entryLine }), Object.freeze({ ...goodsLine })]);
    const keys = Object.freeze([keyOf(entryLine)]);
    const before = JSON.stringify({ sent, keys });
    orderedLines(sent, keys);
    expect(JSON.stringify({ sent, keys })).toBe(before);
  });
});
