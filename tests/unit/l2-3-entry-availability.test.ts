// PR-L2-3 C1. TC-API-009-003 (G1): the public sales state of an Entry Offering (SPEC-110 §26.1 API-PUB-005
// "販売状態", SPEC-030 §7.6 / §10.4, BR-SAL-003, BR-SAL-004, SPEC-100 §8.4) and whether an Entry purchase
// Operation is registered (UCR-110-004: no purchase route => SALES_STOPPED). Pure functions: no clock, no
// database. The judgement time is an input; the sales period is [start, end).
//
// Assumption recorded for the coder (the plan names the arguments but not their types): the three
// timestamps are `YYYY-MM-DDTHH:mm:ss.sssZ` strings as the repository row carries them; `at()` below is the
// only place that builds one.
import { evaluatePublicEntryAvailability } from "@off-r39x/domain";
import type { RouteRegistration } from "@off-r39x/security";
import { describe, expect, it } from "vitest";
import { isEntryPurchaseMounted } from "../../apps/api/src/api/routes/public.ts";
import { ROUTES } from "../../apps/api/src/api/routes.ts";

const START_MS = Date.UTC(2030, 5, 1, 0, 0, 0, 0);
const END_MS = Date.UTC(2030, 5, 30, 0, 0, 0, 0);
const at = (ms: number): string => new Date(ms).toISOString();

type Input = Parameters<typeof evaluatePublicEntryAvailability>[0];
const base = (patch: Partial<Input> & { nowMs?: number } = {}): Input => {
  const { nowMs = START_MS + 1000, ...rest } = patch;
  return {
    now: at(nowMs),
    salesStartsAt: at(START_MS),
    salesEndsAt: at(END_MS),
    saleControlState: "ENABLED",
    hasRemainingCapacity: true,
    purchaseRouteMounted: true,
    ...rest,
  } as Input;
};
const AVAILABLE = { availability: "AVAILABLE", reason: null };
const unavailable = (reason: string) => ({ availability: "UNAVAILABLE", reason });

describe("TC-API-009-003 evaluatePublicEntryAvailability: the sales period is [start, end) (BR-SAL-003, SPEC-100 §8.4)", () => {
  it.each([
    ["start - 1 ms", START_MS - 1, unavailable("SALES_NOT_STARTED")],
    ["start (included)", START_MS, AVAILABLE],
    ["start + 1 ms", START_MS + 1, AVAILABLE],
    ["end - 1 ms", END_MS - 1, AVAILABLE],
    ["end (not included)", END_MS, unavailable("SALES_CLOSED")],
    ["end + 1 ms", END_MS + 1, unavailable("SALES_CLOSED")],
  ])("now = %s", (_label, nowMs, expected) => {
    expect(evaluatePublicEntryAvailability(base({ nowMs }))).toEqual(expected);
  });

  it("compares instants down to the millisecond: a period of 100 ms is judged correctly at 99, 150 and 200 ms", () => {
    const wide = base({
      salesStartsAt: "2030-06-01T00:00:00.100Z",
      salesEndsAt: "2030-06-01T00:00:00.200Z",
      nowMs: Date.UTC(2030, 5, 1, 0, 0, 0, 150),
    });
    expect(evaluatePublicEntryAvailability(wide)).toEqual(AVAILABLE);
    expect(evaluatePublicEntryAvailability({ ...wide, now: "2030-06-01T00:00:00.099Z" })).toEqual(
      unavailable("SALES_NOT_STARTED"),
    );
    expect(evaluatePublicEntryAvailability({ ...wide, now: "2030-06-01T00:00:00.200Z" })).toEqual(
      unavailable("SALES_CLOSED"),
    );
  });
});

describe("TC-API-009-003 evaluatePublicEntryAvailability: reasons in the order SALES_NOT_STARTED, SALES_CLOSED, SALES_STOPPED, SOLD_OUT (SPEC-110 §26.1 API-PUB-005)", () => {
  it("SUSPENDED inside the period is SALES_STOPPED (BR-SAL-004)", () => {
    expect(evaluatePublicEntryAvailability(base({ saleControlState: "SUSPENDED" }))).toEqual(
      unavailable("SALES_STOPPED"),
    );
  });

  it("no Entry purchase route registered inside the period is SALES_STOPPED (UCR-110-004), also with ENABLED and capacity left", () => {
    expect(evaluatePublicEntryAvailability(base({ purchaseRouteMounted: false }))).toEqual(
      unavailable("SALES_STOPPED"),
    );
  });

  it("no remaining capacity (held + committed = capacity, or capacity 0) inside the period is SOLD_OUT", () => {
    expect(evaluatePublicEntryAvailability(base({ hasRemainingCapacity: false }))).toEqual(
      unavailable("SOLD_OUT"),
    );
  });

  it("ENABLED, route registered, capacity left, inside the period is AVAILABLE with a null reason", () => {
    expect(evaluatePublicEntryAvailability(base())).toEqual(AVAILABLE);
  });

  const everyOther = [
    {
      saleControlState: "SUSPENDED" as const,
      hasRemainingCapacity: false,
      purchaseRouteMounted: false,
    },
    {
      saleControlState: "SUSPENDED" as const,
      hasRemainingCapacity: true,
      purchaseRouteMounted: true,
    },
    {
      saleControlState: "ENABLED" as const,
      hasRemainingCapacity: false,
      purchaseRouteMounted: false,
    },
    {
      saleControlState: "ENABLED" as const,
      hasRemainingCapacity: false,
      purchaseRouteMounted: true,
    },
  ];
  it.each(everyOther)(
    "before the start the reason is SALES_NOT_STARTED whatever the rest is (%j)",
    (rest) => {
      expect(evaluatePublicEntryAvailability(base({ nowMs: START_MS - 1, ...rest }))).toEqual(
        unavailable("SALES_NOT_STARTED"),
      );
    },
  );
  it.each(everyOther)(
    "at and after the end the reason is SALES_CLOSED whatever the rest is (%j)",
    (rest) => {
      for (const nowMs of [END_MS, END_MS + 86_400_000])
        expect(evaluatePublicEntryAvailability(base({ nowMs, ...rest }))).toEqual(
          unavailable("SALES_CLOSED"),
        );
    },
  );

  it("inside the period SALES_STOPPED comes before SOLD_OUT: SUSPENDED and no capacity is SALES_STOPPED; no route and no capacity is SALES_STOPPED", () => {
    expect(
      evaluatePublicEntryAvailability(
        base({ saleControlState: "SUSPENDED", hasRemainingCapacity: false }),
      ),
    ).toEqual(unavailable("SALES_STOPPED"));
    expect(
      evaluatePublicEntryAvailability(
        base({ purchaseRouteMounted: false, hasRemainingCapacity: false }),
      ),
    ).toEqual(unavailable("SALES_STOPPED"));
    expect(
      evaluatePublicEntryAvailability(
        base({
          saleControlState: "SUSPENDED",
          purchaseRouteMounted: false,
          hasRemainingCapacity: false,
        }),
      ),
    ).toEqual(unavailable("SALES_STOPPED"));
  });

  it("only the four reasons exist, and a reason is null exactly when AVAILABLE", () => {
    const seen = new Set<string | null>();
    for (const nowMs of [START_MS - 1, START_MS, END_MS])
      for (const saleControlState of ["ENABLED", "SUSPENDED"] as const)
        for (const hasRemainingCapacity of [true, false])
          for (const purchaseRouteMounted of [true, false]) {
            const result = evaluatePublicEntryAvailability(
              base({ nowMs, saleControlState, hasRemainingCapacity, purchaseRouteMounted }),
            );
            seen.add(result.reason);
            expect(result.availability === "AVAILABLE", JSON.stringify(result)).toBe(
              result.reason === null,
            );
          }
    expect([...seen].sort()).toEqual(
      [null, "SALES_CLOSED", "SALES_NOT_STARTED", "SALES_STOPPED", "SOLD_OUT"].sort(),
    );
  });

  it("is a pure function of its input: the same input gives equal results and the input is not changed", () => {
    const input = base({ saleControlState: "SUSPENDED" });
    const copy = structuredClone(input);
    expect(evaluatePublicEntryAvailability(input)).toEqual(evaluatePublicEntryAvailability(input));
    expect(input).toEqual(copy);
  });
});

describe("TC-API-009-003 isEntryPurchaseMounted (UCR-110-004: API-PUR-ENTRY-001 / API-PUR-CART-001 in the route registry)", () => {
  const route = (operationId: string | null, path = "/x"): RouteRegistration =>
    ({
      method: "POST",
      path,
      operationId,
      rateLimitClass: "purchase_checkout",
    }) as RouteRegistration;

  it("is false for the registry of this release (no Entry purchase Operation is registered yet)", () => {
    expect(isEntryPurchaseMounted(ROUTES)).toBe(false);
    expect(isEntryPurchaseMounted([])).toBe(false);
  });

  it("is true when API-PUR-ENTRY-001 is registered, and when API-PUR-CART-001 is registered", () => {
    expect(isEntryPurchaseMounted([...ROUTES, route("API-PUR-ENTRY-001")])).toBe(true);
    expect(isEntryPurchaseMounted([...ROUTES, route("API-PUR-CART-001")])).toBe(true);
    expect(isEntryPurchaseMounted([route("API-PUR-ENTRY-001"), route("API-PUR-CART-001")])).toBe(
      true,
    );
  });

  it("is false for other purchase Operations (Goods, Karaoke, eligibility) and for routes without an Operation ID", () => {
    expect(
      isEntryPurchaseMounted([
        route("API-PUR-GDS-001"),
        route("API-PUR-KRK-001"),
        route("API-PUR-ELG-001"),
        route(null),
      ]),
    ).toBe(false);
  });
});
