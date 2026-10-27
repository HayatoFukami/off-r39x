import { describe, expect, it } from "vitest";
import { cartLineKey } from "../../../../apps/web/src/api-client/cart-line-key.ts";
import type {
  CartLine,
  CartLineResolution,
  PurchaseEligibility,
  PurchaseEligibilityRead,
  Ref,
  SaleAvailability,
  UtcInstant,
} from "../../../../apps/web/src/api-client/types.ts";
import type { SessionState } from "../../../../apps/web/src/auth/use-session.ts";
import * as model from "../../../../apps/web/src/features/purchase/eligibility-model.ts";

// Contract: tests/contracts/s5-cart.md section 3.3 (eligibility-model.ts; SPEC-110 API-PUR-ELG-001,
// SPEC-050 12.1 / 14A.1 / 26.2, SEC-API-029, DEV-WEB-007). Pure functions: no React, no storage.

const OFFERING = "e0000000-0000-4000-8000-000000000001" as Ref<"offering">;
const OFFERING_2 = "e0000000-0000-4000-8000-000000000006" as Ref<"offering">;
const GOODS = "a0000000-0000-4000-8000-000000000001" as Ref<"goods">;
const SOON = "2027-03-04T03:00:00Z" as UtcInstant;

const entry = (quantity = 1, ref: Ref<"offering"> = OFFERING): CartLine => ({
  kind: "ENTRY_TICKET",
  offeringRef: ref,
  quantity,
});
const goods = (quantity = 1): CartLine => ({ kind: "GOODS", goodsRef: GOODS, quantity });

const resolved = (line: CartLine, availability: SaleAvailability): CartLineResolution => ({
  lineKey: cartLineKey(line),
  status: "resolved",
  name: "Item",
  unitPrice: { amount: "1000", currency: "JPY" },
  availability,
});
const onSale = (line: CartLine, max: number | null = null) =>
  resolved(line, { kind: "ON_SALE", maxSelectableQuantity: max });

const verified: SessionState = {
  status: "ready",
  session: { kind: "authenticated", email: "user@example.com", emailVerified: true },
};
const unverified: SessionState = {
  status: "ready",
  session: { kind: "authenticated", email: "user@example.com", emailVerified: false },
};
const guest: SessionState = { status: "ready", session: { kind: "guest" } };

describe("TC-PG-CRT-001-625 eligibilityMode: only a verified Authenticated User reads the owner-scoped eligibility (SEC-API-029, SPEC-050 12.1 / 26.2, DEV-WEB-007)", () => {
  it("waits while the session is loading and never reads before it is known", () => {
    expect(model.eligibilityMode({ status: "loading" })).toBe("wait");
  });

  it("does not read for a guest or for an unverified user (public conditions only; the server sends them to login or verification)", () => {
    expect(model.eligibilityMode(guest)).toBe("not_applicable");
    expect(model.eligibilityMode(unverified)).toBe("not_applicable");
  });

  it("reads for a verified Authenticated User", () => {
    expect(model.eligibilityMode(verified)).toBe("read");
  });

  it("fails closed without calling when the session cannot be determined", () => {
    expect(model.eligibilityMode({ status: "unavailable" })).toBe("unavailable");
  });
});

describe("TC-PG-CRT-001-625 eligibilityTargets: only lines that are purchasable on the public conditions are sent (API-PUR-ELG-001 limits)", () => {
  it("returns the on-sale lines whose quantity fits the public maximum, in Cart order", () => {
    const a = entry(2);
    const b = goods(3);
    const c = entry(1, OFFERING_2);
    // The resolutions arrive in another order than the Cart lines: the result follows the Cart.
    const targets = model.eligibilityTargets(
      [a, b, c],
      [onSale(c, 2), onSale(b, 3), onSale(a, null)],
    );
    expect(targets).toEqual([a, b, c]);
  });

  it("drops not-public, unavailable, not-on-sale and over-maximum lines, and lines without a resolution", () => {
    const keep = entry(1);
    const notPublic = goods(1);
    const unresolvedLine = entry(1, OFFERING_2);
    const over = entry(5, "e0000000-0000-4000-8000-000000000002" as Ref<"offering">);
    const ended = entry(1, "e0000000-0000-4000-8000-000000000003" as Ref<"offering">);
    const soldOut = entry(1, "e0000000-0000-4000-8000-000000000005" as Ref<"offering">);
    const early = entry(1, "e0000000-0000-4000-8000-000000000007" as Ref<"offering">);
    const broken = entry(1, "e0000000-0000-4000-8000-000000000008" as Ref<"offering">);
    const lines = [keep, notPublic, unresolvedLine, over, ended, soldOut, early, broken];
    const resolutions: CartLineResolution[] = [
      onSale(keep, 1),
      { lineKey: cartLineKey(notPublic), status: "not_public" },
      onSale(over, 4),
      resolved(ended, { kind: "SALES_ENDED" }),
      resolved(soldOut, { kind: "SOLD_OUT" }),
      resolved(early, { kind: "BEFORE_SALES", startsAt: SOON }),
      { lineKey: cartLineKey(broken), status: "unavailable" },
    ];
    expect(model.eligibilityTargets(lines, resolutions)).toEqual([keep]);
  });

  it("drops a line whose public answer is a purchase limit or a quantity shortage (the answer cannot improve)", () => {
    const limit = entry(3);
    const short = goods(9);
    const targets = model.eligibilityTargets(
      [limit, short],
      [
        resolved(limit, { kind: "PURCHASE_LIMIT_EXCEEDED" }),
        resolved(short, { kind: "INSUFFICIENT_QUANTITY", maxSelectableQuantity: 3 }),
      ],
    );
    expect(targets).toEqual([]);
  });

  it("returns an empty list for an empty Cart and ignores resolutions that belong to no line", () => {
    expect(model.eligibilityTargets([], [])).toEqual([]);
    expect(model.eligibilityTargets([entry()], [onSale(goods())])).toEqual([]);
  });

  it("does not mutate its inputs", () => {
    const line = entry(1);
    const lines = Object.freeze([Object.freeze(line)]);
    const resolutions = Object.freeze([Object.freeze(onSale(line, 4))]);
    expect(model.eligibilityTargets(lines, resolutions)).toEqual([line]);
  });
});

describe("TC-PG-CRT-001-625 toEligibilityInput and findEligibility: anything but an ok answer is a failure (fail closed, never 'under the limit')", () => {
  const items: PurchaseEligibility[] = [
    { lineKey: "ENTRY_TICKET:a", purchasable: true, reasons: [], maxPurchasableQuantity: 4 },
    {
      lineKey: "GOODS:b",
      purchasable: false,
      reasons: ["PURCHASE_LIMIT_EXCEEDED"],
      maxPurchasableQuantity: 0,
    },
  ];

  it("keeps an ok answer", () => {
    expect(model.toEligibilityInput({ kind: "ok", data: items })).toEqual({
      kind: "ok",
      data: items,
    });
  });

  it.each([
    [{ kind: "unavailable" }],
    [{ kind: "auth_required" }],
    [{ kind: "email_unverified" }],
  ] as const)("turns %j into unavailable (the session change re-reads it)", (read) => {
    expect(model.toEligibilityInput(read as PurchaseEligibilityRead)).toEqual({
      kind: "unavailable",
    });
  });

  it("finds an item by its line key only in an ok answer", () => {
    const ok = model.toEligibilityInput({ kind: "ok", data: items });
    expect(model.findEligibility(ok, "GOODS:b")).toEqual(items[1]);
    expect(model.findEligibility(ok, "ENTRY_TICKET:a")).toEqual(items[0]);
    expect(model.findEligibility(ok, "ENTRY_TICKET:zzz")).toBeUndefined();
    for (const input of [
      { kind: "not_applicable" },
      { kind: "loading" },
      { kind: "unavailable" },
    ] as const) {
      expect(model.findEligibility(input, "GOODS:b"), input.kind).toBeUndefined();
    }
  });

  it("does not mutate the answer", () => {
    const frozen = Object.freeze(items.map((item) => Object.freeze({ ...item })));
    expect(model.toEligibilityInput({ kind: "ok", data: frozen }).kind).toBe("ok");
  });
});
