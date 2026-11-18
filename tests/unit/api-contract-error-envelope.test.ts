import {
  type ErrorCode,
  type ErrorDetails,
  errorRetryable,
  errorSchema,
  type ItemFailure,
} from "@off-r39x/api-contract";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { ServiceResult } from "../../apps/api/src/api/services/result.ts";

// PR-S0-3a C1: the error envelope schema is a discriminated union on `code` (SPEC-110 section 16),
// each variant fixing `retryable` (section 21 Retryable column) and `details` (section 20 / 21,
// SEC-ERR-001, SEC-ERR-002). Expected values come from SPEC-110, not from the implementation.
// Static only: synthetic UUIDs, no network, database or environment variables.

const REQUEST_ID = "00000000-0000-4000-8000-000000000002";
const TARGET_A = "00000000-0000-4000-8000-00000000000a";
const TARGET_B = "00000000-0000-4000-8000-00000000000b";
const TARGET_A_UPPER = "00000000-0000-4000-8000-00000000000A";

// SPEC-110 section 21, in table order. "conditional" is the table's 条件付き (SPEC-110 section 21).
const SPEC_RETRYABLE: [ErrorCode, boolean | "conditional"][] = [
  ["MALFORMED_REQUEST", false],
  ["VALIDATION_FAILED", false],
  ["AUTHENTICATION_REQUIRED", "conditional"],
  ["EMAIL_VERIFICATION_REQUIRED", false],
  ["AUTHORIZATION_DENIED", false],
  ["RESOURCE_NOT_FOUND", false],
  ["METHOD_NOT_ALLOWED", false],
  ["STATE_CONFLICT", false],
  ["SOLD_OUT", false],
  ["SLOT_UNAVAILABLE", false],
  ["SLOT_GENERATION_OVERLAP", false],
  ["INVENTORY_UNAVAILABLE", false],
  ["PURCHASE_LIMIT_EXCEEDED", false],
  ["IDEMPOTENCY_KEY_REUSED", false],
  ["BUSINESS_OPPORTUNITY_EXPIRED", false],
  ["PAYLOAD_TOO_LARGE", false],
  ["UNSUPPORTED_MEDIA_TYPE", false],
  ["RATE_LIMIT_EXCEEDED", true],
  ["DOMAIN_RULE_VIOLATION", false],
  ["OUTSIDE_CHECKIN_WINDOW", false],
  ["STRIPE_TEMPORARY_FAILURE", true],
  ["DATABASE_TEMPORARY_FAILURE", true],
  ["AUTH_SERVICE_TEMPORARY_FAILURE", true],
  ["TEMPORARY_UNAVAILABLE", true],
  ["CONSISTENCY_REVIEW_REQUIRED", false],
  ["INTERNAL_ERROR", "conditional"],
];
const FIXED = SPEC_RETRYABLE.filter(
  (entry): entry is [ErrorCode, boolean] => entry[1] !== "conditional",
);
const CONDITIONAL = SPEC_RETRYABLE.filter(([, retryable]) => retryable === "conditional");

// API-PUR-ELG-001 Reasons: "この順で重複なく列挙".
const ELG_REASONS = [
  "NOT_PUBLIC_OR_NOT_FOUND",
  "SALES_NOT_STARTED",
  "SALES_CLOSED",
  "SALES_STOPPED",
  "SOLD_OUT",
  "INSUFFICIENT_QUANTITY",
  "PURCHASE_LIMIT_EXCEEDED",
  "SLOT_UNAVAILABLE",
  "PAYMENT_WINDOW_TOO_SHORT",
] as const;

function envelope(
  code: string,
  retryable: boolean,
  details: unknown = null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    error: {
      code,
      message: "synthetic message",
      request_id: REQUEST_ID,
      retryable,
      details,
      ...extra,
    },
  };
}
function stateConflict(details: unknown): Record<string, unknown> {
  return envelope("STATE_CONFLICT", false, details);
}
function failureItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: "ENTRY", target_ref: TARGET_A, reasons: ["SOLD_OUT"], ...overrides };
}
function uuidN(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}
const passes = (input: unknown) => errorSchema.safeParse(input).success;

describe("TC-DEV-API-003-002 errorSchema variants, retryable and details allowlist", () => {
  it("errorRetryable matches the SPEC-110 section 21 Retryable column, in errorStatuses order", () => {
    expect(Object.entries(errorRetryable)).toEqual(SPEC_RETRYABLE);
  });

  it.each(SPEC_RETRYABLE)(
    "%s: a null-details envelope with the section 21 retryable parses",
    (code, retryable) => {
      const parsed = errorSchema.safeParse(envelope(code, retryable === true));
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.error.code).toBe(code);
    },
  );

  it.each(FIXED)("%s: the opposite retryable value is rejected", (code, retryable) => {
    expect(passes(envelope(code, !retryable))).toBe(false);
  });

  it.each(CONDITIONAL)("%s: a conditional code accepts both boolean values", (code) => {
    expect(passes(envelope(code, true))).toBe(true);
    expect(passes(envelope(code, false))).toBe(true);
  });

  it("rejects a retryable that is not a boolean for every code", () => {
    for (const [code] of SPEC_RETRYABLE) {
      expect(passes(envelope(code, "false" as unknown as boolean)), code).toBe(false);
    }
  });

  describe("STATE_CONFLICT details (API-PUR-CART-001 item_failures)", () => {
    it("accepts null and a well-formed item_failures", () => {
      expect(passes(stateConflict(null))).toBe(true);
      expect(passes(stateConflict({ item_failures: [failureItem()] }))).toBe(true);
    });

    it("accepts 1 and 50 items, ENTRY and GOODS mixed", () => {
      expect(passes(stateConflict({ item_failures: [failureItem({ kind: "GOODS" })] }))).toBe(true);
      const fifty = Array.from({ length: 50 }, (_, n) =>
        failureItem({ kind: n % 2 === 0 ? "ENTRY" : "GOODS", target_ref: uuidN(n + 1) }),
      );
      expect(passes(stateConflict({ item_failures: fifty }))).toBe(true);
    });

    it("keeps the same target_ref under different kinds (uniqueness is per kind and target)", () => {
      expect(
        passes(
          stateConflict({
            item_failures: [failureItem({ kind: "ENTRY" }), failureItem({ kind: "GOODS" })],
          }),
        ),
      ).toBe(true);
    });

    it("accepts several reasons in the API-PUR-ELG-001 order, including all nine", () => {
      expect(
        passes(
          stateConflict({
            item_failures: [
              failureItem({ reasons: ["SALES_CLOSED", "SOLD_OUT", "SLOT_UNAVAILABLE"] }),
            ],
          }),
        ),
      ).toBe(true);
      expect(
        passes(stateConflict({ item_failures: [failureItem({ reasons: [...ELG_REASONS] })] })),
      ).toBe(true);
    });

    it("rejects 0 and 51 items", () => {
      expect(passes(stateConflict({ item_failures: [] }))).toBe(false);
      const fiftyOne = Array.from({ length: 51 }, (_, n) =>
        failureItem({ target_ref: uuidN(n + 1) }),
      );
      expect(passes(stateConflict({ item_failures: fiftyOne }))).toBe(false);
    });

    it.each([
      ["quantity", { quantity: 3 }],
      ["raw_input", { raw_input: "synthetic-echo-marker" }],
    ])("rejects an extra key %s on an item", (_label, extra) => {
      expect(passes(stateConflict({ item_failures: [failureItem(extra)] }))).toBe(false);
    });

    it("rejects an extra key beside item_failures and an empty object", () => {
      expect(passes(stateConflict({ item_failures: [failureItem()], note: "x" }))).toBe(false);
      expect(passes(stateConflict({}))).toBe(false);
    });

    it("rejects kind KARAOKE and other kinds", () => {
      expect(passes(stateConflict({ item_failures: [failureItem({ kind: "KARAOKE" })] }))).toBe(
        false,
      );
      expect(passes(stateConflict({ item_failures: [failureItem({ kind: "entry" })] }))).toBe(
        false,
      );
    });

    it("rejects a target_ref that is not a UUID or has uppercase letters (SPEC-110 section 9)", () => {
      expect(
        passes(stateConflict({ item_failures: [failureItem({ target_ref: "not-a-uuid" })] })),
      ).toBe(false);
      expect(
        passes(stateConflict({ item_failures: [failureItem({ target_ref: TARGET_A_UPPER })] })),
      ).toBe(false);
      expect(
        passes(stateConflict({ item_failures: [failureItem({ target_ref: TARGET_A })] })),
      ).toBe(true);
    });

    it("rejects an unknown reason, empty reasons, duplicates and an order that differs from ELG", () => {
      for (const reasons of [
        ["NOT_A_REASON"],
        [],
        ["SOLD_OUT", "SOLD_OUT"],
        ["SOLD_OUT", "SALES_CLOSED"],
        ["PAYMENT_WINDOW_TOO_SHORT", "NOT_PUBLIC_OR_NOT_FOUND"],
      ]) {
        expect(
          passes(stateConflict({ item_failures: [failureItem({ reasons })] })),
          reasons.join(),
        ).toBe(false);
      }
    });

    it("rejects a duplicate (kind, target_ref) pair", () => {
      expect(
        passes(
          stateConflict({
            item_failures: [failureItem(), failureItem({ reasons: ["SALES_CLOSED"] })],
          }),
        ),
      ).toBe(false);
      expect(
        passes(
          stateConflict({
            item_failures: [failureItem(), failureItem({ target_ref: TARGET_B })],
          }),
        ),
      ).toBe(true);
    });
  });

  describe("details of every other code is null only", () => {
    const others = SPEC_RETRYABLE.filter(([code]) => code !== "STATE_CONFLICT");
    it("covers the 25 other codes", () => {
      expect(others).toHaveLength(25);
    });
    it.each(others)("%s rejects item_failures and a field detail", (code, retryable) => {
      const retry = retryable === true;
      expect(passes(envelope(code, retry, { item_failures: [failureItem()] })), code).toBe(false);
      expect(passes(envelope(code, retry, { field: "name", value: "synthetic" })), code).toBe(
        false,
      );
      expect(passes(envelope(code, retry, {})), code).toBe(false);
    });
    it.each(["SOLD_OUT", "VALIDATION_FAILED", "RATE_LIMIT_EXCEEDED"] as const)(
      "%s names the producer-side cases from the plan",
      (code) => {
        const retry = code === "RATE_LIMIT_EXCEEDED";
        expect(passes(envelope(code, retry, { item_failures: [failureItem()] }))).toBe(false);
        expect(passes(envelope(code, retry, { field: "x", value: "y" }))).toBe(false);
        expect(passes(envelope(code, retry, null))).toBe(true);
      },
    );
  });

  it("stays strict: extra keys in error or at the top level are rejected", () => {
    expect(passes(envelope("SOLD_OUT", false, null, { extra: 1 }))).toBe(false);
    expect(passes({ ...envelope("SOLD_OUT", false), extra: 1 })).toBe(false);
  });

  it("types: the code type of a parsed error equals ErrorCode (compile-time only)", () => {
    expectTypeOf<z.infer<typeof errorSchema>["error"]["code"]>().toEqualTypeOf<ErrorCode>();
  });

  it("types: details is fixed per code, and a service cannot reject SOLD_OUT with details", () => {
    expectTypeOf<ErrorDetails<"SOLD_OUT">>().toEqualTypeOf<null>();
    expectTypeOf<ErrorDetails<"STATE_CONFLICT">>().toEqualTypeOf<null | {
      item_failures: ItemFailure[];
    }>();
    const accepted: ServiceResult<null> = { kind: "rejected", code: "SOLD_OUT" };
    const failures: ItemFailure[] = [];
    const rejected: ServiceResult<null> = {
      kind: "rejected",
      code: "SOLD_OUT",
      // @ts-expect-error SOLD_OUT details is null only (SEC-ERR-002)
      details: { item_failures: failures },
    };
    void accepted;
    void rejected;
  });
});
