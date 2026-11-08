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
import type { EligibilityInput } from "../../../../apps/web/src/features/purchase/eligibility-model.ts";
import * as model from "../../../../apps/web/src/features/purchase/eligibility-model.ts";
import {
  decideSaleState,
  eligibilityForLines,
  eligibilityForSession,
} from "../../../../apps/web/src/features/purchase/eligibility-model.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import {
  presentAvailability,
  presentPurchaseReasons,
} from "../../../../apps/web/src/presentation/state-mapping/availability.ts";

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

describe("TC-PG-CRT-001-625 eligibilityForSession: an answer is used only under the session state it was read for (B4b-F-1, SEC-API-029, SPEC-050 12.1)", () => {
  const previousOwner: EligibilityInput = {
    kind: "ok",
    data: [
      {
        lineKey: "ENTRY_TICKET:limit",
        purchasable: false,
        reasons: ["PURCHASE_LIMIT_EXCEEDED"],
        maxPurchasableQuantity: 0,
      },
      { lineKey: "GOODS:b", purchasable: true, reasons: [], maxPurchasableQuantity: 4 },
    ],
  };
  const stores: EligibilityInput[] = [
    previousOwner,
    { kind: "unavailable" },
    { kind: "loading" },
    { kind: "not_applicable" },
  ];
  const otherVerified: SessionState = {
    status: "ready",
    session: { kind: "authenticated", email: "other@example.com", emailVerified: true },
  };
  /** Equal in content to `verified`, but another object: SessionProvider keeps the reference only while the session is unchanged. */
  const equalButNotSame = (): SessionState => ({
    status: "ready",
    session: { kind: "authenticated", email: "user@example.com", emailVerified: true },
  });

  it("is loading while the current session is loading", () => {
    for (const stored of stores) {
      expect(eligibilityForSession(stored, verified, { status: "loading" })).toEqual({
        kind: "loading",
      });
    }
  });

  it("is not_applicable for a guest or an unverified user, whatever was stored and read before (the previous owner's answer is gone at once)", () => {
    for (const session of [guest, unverified]) {
      for (const stored of stores) {
        for (const readSession of [null, verified, session, otherVerified]) {
          const result = eligibilityForSession(stored, readSession, session);
          expect(result).toEqual({ kind: "not_applicable" });
          expect(JSON.stringify(result)).not.toContain("PURCHASE_LIMIT_EXCEEDED");
        }
      }
    }
  });

  it("is unavailable when the session cannot be determined (fail closed), whatever was stored", () => {
    for (const stored of stores) {
      for (const readSession of [null, verified]) {
        expect(eligibilityForSession(stored, readSession, { status: "unavailable" })).toEqual({
          kind: "unavailable",
        });
      }
    }
  });

  it("returns the stored answer as it is for a verified user when it was read for the same session state", () => {
    const session = equalButNotSame();
    for (const stored of [previousOwner, { kind: "unavailable" }, { kind: "loading" }] as const) {
      expect(eligibilityForSession(stored, session, session)).toBe(stored);
    }
    expect(eligibilityForSession(previousOwner, session, session)).toEqual(previousOwner);
  });

  it("treats a stored not_applicable as not read yet for a verified user", () => {
    expect(eligibilityForSession({ kind: "not_applicable" }, verified, verified)).toEqual({
      kind: "loading",
    });
  });

  it.each([
    ["no session state was recorded", null],
    ["it was read for a guest", guest],
    ["it was read for another verified user", otherVerified],
    ["it was read for an unverified user", unverified],
  ] as const)(
    "is loading for a verified user when %s, and never carries the previous data",
    (_name, readSession) => {
      const result = eligibilityForSession(previousOwner, readSession, verified);
      expect(result).toEqual({ kind: "loading" });
      expect(JSON.stringify(result)).not.toContain("PURCHASE_LIMIT_EXCEEDED");
      expect(result).not.toHaveProperty("data");
    },
  );

  it("is loading when the recorded session state is only equal in content, not the same reference (fail closed)", () => {
    const current = equalButNotSame();
    expect(current).toEqual(verified);
    expect(current).not.toBe(verified);
    expect(eligibilityForSession(previousOwner, verified, current)).toEqual({ kind: "loading" });
    expect(eligibilityForSession({ kind: "unavailable" }, verified, current)).toEqual({
      kind: "loading",
    });
  });

  it("does not mutate its inputs", () => {
    const frozen: EligibilityInput = Object.freeze({
      kind: "ok",
      data: Object.freeze([...previousOwner.data.map((item) => Object.freeze({ ...item }))]),
    });
    const read = Object.freeze({ ...verified });
    const current = Object.freeze({ ...equalButNotSame() });
    const before = JSON.stringify([frozen, read, current]);
    eligibilityForSession(frozen, read, current);
    eligibilityForSession(frozen, read, read);
    expect(JSON.stringify([frozen, read, current])).toBe(before);
  });
});

describe("TC-PG-CRT-001-625 eligibilityForLines: of an ok answer only the items read for the current quantity are kept (B4b-F-1, API-PUR-ELG-001)", () => {
  const e = (quantity: number) => entry(quantity);
  const g = (quantity: number) => goods(quantity);
  const answerFor = (...lines: CartLine[]): EligibilityInput => ({
    kind: "ok",
    data: lines.map((line) => ({
      lineKey: cartLineKey(line),
      purchasable: true,
      reasons: [],
      maxPurchasableQuantity: 4,
    })),
  });
  const keysOf = (input: EligibilityInput): string[] =>
    input.kind === "ok" ? input.data.map((item) => item.lineKey) : [];

  it.each([
    [{ kind: "loading" }],
    [{ kind: "unavailable" }],
    [{ kind: "not_applicable" }],
  ] as const)("returns %j as it is", (input) => {
    expect(eligibilityForLines(input, [e(1)], [e(2)])).toBe(input);
    expect(eligibilityForLines(input, [], [])).toBe(input);
  });

  it("drops the item of a line whose quantity changed and keeps the others", () => {
    const input = answerFor(e(2), g(1));
    const result = eligibilityForLines(input, [e(2), g(1)], [e(3), g(1)]);
    expect(keysOf(result)).toEqual([cartLineKey(g(1))]);
    expect(result.kind).toBe("ok");
  });

  it("keeps every item in its original order when the lines are the same (the Cart order may differ)", () => {
    const input = answerFor(e(2), g(1));
    expect(keysOf(eligibilityForLines(input, [e(2), g(1)], [e(2), g(1)]))).toEqual([
      cartLineKey(e(1)),
      cartLineKey(g(1)),
    ]);
    expect(keysOf(eligibilityForLines(input, [e(2), g(1)], [g(1), e(2)]))).toEqual([
      cartLineKey(e(1)),
      cartLineKey(g(1)),
    ]);
  });

  it("drops items whose line left the Cart or was not among the lines that were read", () => {
    const other = entry(1, OFFERING_2);
    const input = answerFor(e(2), g(1), other);
    // g left the Cart; other was never among the read lines (its item cannot belong to this read).
    const result = eligibilityForLines(input, [e(2), g(1)], [e(2), other]);
    expect(keysOf(result)).toEqual([cartLineKey(e(1))]);
  });

  it("keeps an ok answer with no item when nothing matches (never a different kind)", () => {
    const input = answerFor(e(2));
    expect(eligibilityForLines(input, [e(2)], [e(5)])).toEqual({ kind: "ok", data: [] });
    expect(eligibilityForLines(input, [], [])).toEqual({ kind: "ok", data: [] });
  });

  it("only keeps items whose line has the same quantity now as when it was read", () => {
    const read = [e(1), g(2), entry(3, OFFERING_2)];
    const now = [e(1), g(3), entry(3, OFFERING_2)];
    const result = eligibilityForLines(answerFor(...read), read, now);
    if (result.kind !== "ok") throw new Error("expected an ok answer");
    for (const item of result.data) {
      const before = read.find((line) => cartLineKey(line) === item.lineKey);
      const after = now.find((line) => cartLineKey(line) === item.lineKey);
      expect(before, item.lineKey).toBeDefined();
      expect(after?.quantity, item.lineKey).toBe(before?.quantity);
    }
    expect(result.data).toHaveLength(2);
  });

  it("does not mutate its inputs", () => {
    const input = answerFor(e(2), g(1));
    const readLines = Object.freeze([Object.freeze(e(2)), Object.freeze(g(1))]);
    const lines = Object.freeze([Object.freeze(e(3)), Object.freeze(g(1))]);
    const before = JSON.stringify([input, readLines, lines]);
    eligibilityForLines(input, readLines, lines);
    expect(JSON.stringify([input, readLines, lines])).toBe(before);
  });
});

describe("TC-PG-CRT-001-625 decideSaleState narrows only a publicly on-sale item and fails closed (B4c, SPEC-050 12.1 / 14.2, API-PUR-ELG-001, SEC-API-029)", () => {
  const KEY = cartLineKey(goods(1));
  const OTHER_KEY = cartLineKey(entry(1));
  const item = (over: Partial<PurchaseEligibility> = {}): PurchaseEligibility => ({
    lineKey: KEY,
    purchasable: true,
    reasons: [],
    maxPurchasableQuantity: 5,
    ...over,
  });
  const answer = (...items: PurchaseEligibility[]): EligibilityInput => ({
    kind: "ok",
    data: items,
  });
  const UNCONFIRMED = presentAvailability({ kind: "unavailable" });

  const NOT_ON_SALE: readonly SaleAvailability[] = [
    { kind: "BEFORE_SALES", startsAt: SOON },
    { kind: "SALES_ENDED" },
    { kind: "SUSPENDED" },
    { kind: "SOLD_OUT" },
    { kind: "INSUFFICIENT_QUANTITY", maxSelectableQuantity: 3 },
    { kind: "PURCHASE_LIMIT_EXCEEDED" },
  ];

  it("(a) keeps the public state of an item that is not on sale, whatever the owner-scoped answer is (it cannot improve)", () => {
    const inputs: EligibilityInput[] = [
      { kind: "not_applicable" },
      { kind: "loading" },
      { kind: "unavailable" },
      answer(),
      answer(item()),
      answer(item({ lineKey: OTHER_KEY })),
      answer(item({ purchasable: false, reasons: ["SOLD_OUT"], maxPurchasableQuantity: 0 })),
    ];
    for (const availability of NOT_ON_SALE) {
      for (const eligibility of inputs) {
        const status = presentAvailability(availability);
        expect(decideSaleState(availability, eligibility, KEY), availability.kind).toEqual({
          status,
          addable: status.purchasable,
          maxSelectableQuantity: null,
        });
        expect(status.purchasable).toBe(false);
      }
    }
  });

  it.each([
    [{ kind: "ON_SALE", maxSelectableQuantity: 20 }, 20],
    [{ kind: "ON_SALE", maxSelectableQuantity: null }, null],
  ] as const)(
    "(b) shows %j as it is publicly for not_applicable (Guest and unverified: public conditions only)",
    (availability, max) => {
      expect(decideSaleState(availability, { kind: "not_applicable" }, KEY)).toEqual({
        status: presentAvailability(availability),
        addable: true,
        maxSelectableQuantity: max,
      });
    },
  );

  it.each([
    ["loading", { kind: "loading" }],
    ["unavailable", { kind: "unavailable" }],
    ["an ok answer without any item", answer()],
    ["an ok answer with the item of another key only", answer(item({ lineKey: OTHER_KEY }))],
  ] as const)(
    "(c) is 'cannot confirm' with adding disabled and no maximum for an on-sale item when the answer is %s",
    (_name, eligibility) => {
      const decision = decideSaleState(
        { kind: "ON_SALE", maxSelectableQuantity: 20 },
        eligibility,
        KEY,
      );
      expect(decision).toEqual({
        status: UNCONFIRMED,
        addable: false,
        maxSelectableQuantity: null,
      });
      expect(decision.status.label).toBe(copy.availability.label.UNAVAILABLE);
      expect(decision.status.label).not.toBe(copy.availability.label.ON_SALE);
    },
  );

  it("(d) shows the owner-scoped reasons of an on-sale item that is not purchasable, with adding disabled and no maximum", () => {
    const cases: PurchaseEligibility[] = [
      item({ purchasable: false, reasons: ["SOLD_OUT"], maxPurchasableQuantity: 0 }),
      item({ purchasable: false, reasons: ["PURCHASE_LIMIT_EXCEEDED"], maxPurchasableQuantity: 0 }),
      item({ purchasable: false, reasons: ["INSUFFICIENT_QUANTITY"], maxPurchasableQuantity: 3 }),
      item({
        purchasable: false,
        reasons: ["SALES_STOPPED", "PURCHASE_LIMIT_EXCEEDED", "SLOT_UNAVAILABLE"],
        maxPurchasableQuantity: 0,
      }),
    ];
    for (const one of cases) {
      expect(
        decideSaleState(
          { kind: "ON_SALE", maxSelectableQuantity: 20 },
          answer(item({ lineKey: OTHER_KEY }), one),
          KEY,
        ),
        one.reasons.join(","),
      ).toEqual({
        status: presentPurchaseReasons(one.reasons, one.maxPurchasableQuantity),
        addable: false,
        maxSelectableQuantity: null,
      });
    }
  });

  it.each([
    [20, 5, 5],
    [3, 5, 3],
    [null, 4, 4],
    [5, 5, 5],
  ] as const)(
    "(e) shows an on-sale item that is purchasable as on sale with min(public maximum %s, owner maximum %s) = %s",
    (publicMax, ownerMax, expected) => {
      const decision = decideSaleState(
        { kind: "ON_SALE", maxSelectableQuantity: publicMax },
        answer(item({ maxPurchasableQuantity: ownerMax })),
        KEY,
      );
      expect(decision).toEqual({
        status: presentAvailability({ kind: "ON_SALE", maxSelectableQuantity: ownerMax }),
        addable: true,
        maxSelectableQuantity: expected,
      });
      expect(decision.status.label).toBe(copy.availability.label.ON_SALE);
    },
  );

  it("(f) does not mutate its inputs", () => {
    const eligibility = Object.freeze(
      answer(Object.freeze(item()), Object.freeze(item({ lineKey: OTHER_KEY }))),
    );
    const availability = Object.freeze({
      kind: "ON_SALE" as const,
      maxSelectableQuantity: 20,
    });
    const before = JSON.stringify([eligibility, availability]);
    decideSaleState(availability, eligibility, KEY);
    expect(JSON.stringify([eligibility, availability])).toBe(before);
  });
});
