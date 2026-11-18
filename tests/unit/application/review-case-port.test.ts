import {
  type KaraokeReservationId,
  type OrderId,
  type PaymentBindingId,
  REVIEW_REASON_CODES,
  type ReviewCaseOpenInput,
  reviewCaseOpenInputSchema,
} from "@off-r39x/application/review-case";
import { describe, expect, expectTypeOf, it } from "vitest";

// PR-S0-5 C1: port contract tests for the Consistency Review open input (SPEC-150 §43-§44,
// SPEC-100 §43, SPEC-120 §43.1). They prove the shape of the input type only. They do NOT prove
// the CHECK / UNIQUE constraints, the INSERT, or deduplication on a real PostgreSQL (TST-UNT-001;
// PR-L1-1c).
//
// Scope decision D-4 (approved 2026-11-18): the dedupe_key derivation and its parts are NOT part
// of this PR (SPEC-150 REL-REC-007 leaves primary_entity_type and cause_discriminator undefined).
// The open input is { reasonCode, targets, details }; a dedupe key must not be accepted from
// callers here.
//
// All values are synthetic. Email-looking strings use the reserved example.com domain and appear
// only as inputs that must be rejected (TST-EML-001).

// SPEC-150 §43 canonical reason codes.
const SPEC_150_REASON_CODES = [
  "AUTH_PROFILE_RELATION_INCONSISTENT",
  "ROLE_ADMIN_SET_INCONSISTENT",
  "PAY_CHECKOUT_RESULT_UNRESOLVED",
  "PAY_BINDING_INCONSISTENT",
  "PAY_CONFIRMATION_INCONSISTENT",
  "PAY_LATE_SUCCESS_RESOURCE_REUSED",
  "REFUND_RESULT_UNRESOLVED",
  "REFUND_DOMAIN_CANCELLATION_INCOMPLETE",
  "WEBHOOK_CORRELATION_UNRESOLVED",
  "TQR_TOKEN_CORRELATION_INCONSISTENT",
  "TQR_KEY_MIGRATION_FAILED",
  "TQR_CHECKIN_STATE_INCONSISTENT",
  "KRK_HOLD_SLOT_INCONSISTENT",
  "KRK_RESERVATION_TICKET_INCONSISTENT",
  "GDS_INVENTORY_COUNTER_INCONSISTENT",
  "GDS_HANDOFF_STATE_INCONSISTENT",
  "EML_NOTIFICATION_CAUSE_INCONSISTENT",
  "EML_PROVIDER_RESULT_UNRESOLVED",
  "EML_RECIPIENT_RELATION_INCONSISTENT",
  "EML_RENDER_CONTEXT_INVALID",
  "EML_WEBHOOK_UNMATCHED",
  "SECURITY_KEY_VERSION_INCONSISTENT",
] as const;

// SPEC-110 §48.3.8 reason_category enum, written out separately from the list above so that a
// drift between the two owners is visible.
const SPEC_110_REASON_CATEGORIES = [
  "AUTH_PROFILE_RELATION_INCONSISTENT",
  "ROLE_ADMIN_SET_INCONSISTENT",
  "PAY_CHECKOUT_RESULT_UNRESOLVED",
  "PAY_BINDING_INCONSISTENT",
  "PAY_CONFIRMATION_INCONSISTENT",
  "PAY_LATE_SUCCESS_RESOURCE_REUSED",
  "REFUND_RESULT_UNRESOLVED",
  "REFUND_DOMAIN_CANCELLATION_INCOMPLETE",
  "WEBHOOK_CORRELATION_UNRESOLVED",
  "TQR_TOKEN_CORRELATION_INCONSISTENT",
  "TQR_KEY_MIGRATION_FAILED",
  "TQR_CHECKIN_STATE_INCONSISTENT",
  "KRK_HOLD_SLOT_INCONSISTENT",
  "KRK_RESERVATION_TICKET_INCONSISTENT",
  "GDS_INVENTORY_COUNTER_INCONSISTENT",
  "GDS_HANDOFF_STATE_INCONSISTENT",
  "EML_NOTIFICATION_CAUSE_INCONSISTENT",
  "EML_PROVIDER_RESULT_UNRESOLVED",
  "EML_RECIPIENT_RELATION_INCONSISTENT",
  "EML_RENDER_CONTEXT_INVALID",
  "EML_WEBHOOK_UNMATCHED",
  "SECURITY_KEY_VERSION_INCONSISTENT",
] as const;

// SPEC-100 §43: the ten target FK columns, in camelCase as the port property names.
const TARGET_KEYS = [
  "orderId",
  "checkoutAttemptId",
  "paymentBindingId",
  "refundRecordId",
  "karaokeSlotId",
  "karaokeHoldId",
  "karaokeReservationId",
  "entryTicketId",
  "karaokeTicketId",
  "goodsOrderItemId",
] as const;

// SPEC-120 §43.1: Email consistency reasons use source_order_id / source_reservation_id only.
const EML_REASON_CODES = SPEC_150_REASON_CODES.filter((code) => code.startsWith("EML_"));
const NON_EML_REASON_CODES = SPEC_150_REASON_CODES.filter((code) => !code.startsWith("EML_"));

const SYNTHETIC_UUID = "00000000-0000-4000-8000-000000000001";
const UPPER_UUID = "0000000A-0000-4000-8000-00000000000B";
const SYNTHETIC_QR = `r39x1.ent.${"A".repeat(43)}`;

function openInput(overrides: Record<string, unknown> = {}) {
  return {
    reasonCode: "PAY_BINDING_INCONSISTENT",
    targets: { orderId: 1n },
    details: {},
    ...overrides,
  };
}

function accepts(input: unknown): boolean {
  return reviewCaseOpenInputSchema.safeParse(input).success;
}

function acceptsTargets(reasonCode: string, targets: unknown): boolean {
  return accepts(openInput({ reasonCode, targets }));
}

function acceptsDetails(details: unknown): boolean {
  return accepts(openInput({ details }));
}

describe("TC-REVIEW-PORT-001 reason codes equal the SPEC-150 §43 canonical set [REL-REC-006]", () => {
  it("the canonical lists of SPEC-150 §43 and SPEC-110 §48.3.8 agree", () => {
    expect(SPEC_150_REASON_CODES).toHaveLength(22);
    expect([...SPEC_110_REASON_CATEGORIES].sort()).toEqual([...SPEC_150_REASON_CODES].sort());
  });

  it("REVIEW_REASON_CODES is exactly the 22 canonical codes without duplicates", () => {
    expect(new Set(REVIEW_REASON_CODES).size).toBe(REVIEW_REASON_CODES.length);
    expect([...REVIEW_REASON_CODES].sort()).toEqual([...SPEC_150_REASON_CODES].sort());
    expect([...REVIEW_REASON_CODES].sort()).toEqual([...SPEC_110_REASON_CATEGORIES].sort());
  });

  for (const code of SPEC_150_REASON_CODES) {
    it(`accepts ${code} with a valid target`, () => {
      expect(accepts(openInput({ reasonCode: code, targets: { orderId: 1n } }))).toBe(true);
    });
  }

  for (const code of [
    "EMAIL_PROVIDER_RESULT_UNRESOLVED",
    "pay_binding_inconsistent",
    "PAY_BINDING_INCONSISTENT ",
    "UNKNOWN_REASON",
    "",
  ]) {
    it(`rejects the non-canonical reason code ${JSON.stringify(code)}`, () => {
      expect(accepts(openInput({ reasonCode: code }))).toBe(false);
    });
  }

  it("rejects a non-string reason code and a missing reasonCode", () => {
    for (const reasonCode of [1, null, undefined, ["PAY_BINDING_INCONSISTENT"]]) {
      expect(accepts(openInput({ reasonCode }))).toBe(false);
    }
    const { reasonCode: _omitted, ...rest } = openInput();
    expect(accepts(rest)).toBe(false);
  });
});

describe("TC-REVIEW-PORT-002 targets follow SPEC-100 §43 and SPEC-120 §43.1", () => {
  it("lists exactly the ten SPEC-100 §43 target columns", () => {
    expect(TARGET_KEYS).toHaveLength(10);
    expect(EML_REASON_CODES).toHaveLength(5);
    expect(NON_EML_REASON_CODES).toHaveLength(17);
  });

  for (const key of TARGET_KEYS) {
    it(`accepts a non-EML reason with only ${key}`, () => {
      expect(acceptsTargets("PAY_BINDING_INCONSISTENT", { [key]: 7n })).toBe(true);
    });
  }

  it("accepts several targets at once for a non-EML reason", () => {
    expect(
      acceptsTargets("PAY_BINDING_INCONSISTENT", {
        orderId: 1n,
        checkoutAttemptId: 2n,
        paymentBindingId: 3n,
        refundRecordId: 4n,
        karaokeSlotId: 5n,
        karaokeHoldId: 6n,
        karaokeReservationId: 7n,
        entryTicketId: 8n,
        karaokeTicketId: 9n,
        goodsOrderItemId: 10n,
      }),
    ).toBe(true);
  });

  for (const code of SPEC_150_REASON_CODES) {
    it(`${code} rejects an empty targets object (at least one FK, SPEC-100 §43 CHECK)`, () => {
      expect(acceptsTargets(code, {})).toBe(false);
    });
  }

  it("rejects targets whose every value is undefined or null", () => {
    expect(acceptsTargets("PAY_BINDING_INCONSISTENT", { orderId: undefined })).toBe(false);
    expect(acceptsTargets("PAY_BINDING_INCONSISTENT", { orderId: null })).toBe(false);
  });

  it("rejects a missing targets item", () => {
    const { targets: _omitted, ...rest } = openInput();
    expect(accepts(rest)).toBe(false);
  });

  it("rejects unknown target keys, including a Notification Request (SPEC-120 §43.1)", () => {
    for (const extra of [
      { notificationRequestId: 1n },
      { emailDeliveryJobId: 1n },
      { order_id: 1n },
      { businessProfileId: 1n },
      { customerEmail: "user@example.com" },
    ]) {
      expect(acceptsTargets("PAY_BINDING_INCONSISTENT", { orderId: 1n, ...extra })).toBe(false);
      expect(acceptsTargets("PAY_BINDING_INCONSISTENT", extra)).toBe(false);
    }
  });

  // Every one of the ten SPEC-100 §43 columns is a positive bigint: a number, zero, a negative
  // value and a numeric string are each rejected for a non-EML reason code.
  for (const key of TARGET_KEYS) {
    for (const bad of [1, 0n, -1n, "1"]) {
      it(`${key} rejects ${String(bad)} (${typeof bad}) for a non-EML reason`, () => {
        expect(acceptsTargets("PAY_BINDING_INCONSISTENT", { [key]: bad })).toBe(false);
        expect(acceptsTargets("PAY_BINDING_INCONSISTENT", { orderId: 1n, [key]: bad })).toBe(false);
      });
    }
    it(`${key} accepts a positive bigint for a non-EML reason`, () => {
      expect(acceptsTargets("PAY_BINDING_INCONSISTENT", { [key]: 1n })).toBe(true);
    });
  }

  for (const key of ["orderId", "karaokeReservationId"]) {
    for (const bad of [1, 0n, -1n, "1", 1.5, SYNTHETIC_UUID]) {
      it(`rejects ${key}=${String(bad)} (${typeof bad}); internal ids are positive bigint only`, () => {
        expect(acceptsTargets("PAY_BINDING_INCONSISTENT", { [key]: bad })).toBe(false);
      });
    }
  }

  // PostgreSQL bigint is signed 64-bit (SPEC-100 §7.1): the upper bound is accepted and the next
  // value is rejected for every one of the ten target columns.
  for (const key of TARGET_KEYS) {
    it(`${key} accepts the bigint upper bound and rejects the value above it`, () => {
      expect(acceptsTargets("PAY_BINDING_INCONSISTENT", { [key]: 9223372036854775807n })).toBe(
        true,
      );
      expect(acceptsTargets("PAY_BINDING_INCONSISTENT", { [key]: 9223372036854775808n })).toBe(
        false,
      );
    });
  }

  for (const code of EML_REASON_CODES) {
    describe(code, () => {
      it("accepts orderId only, karaokeReservationId only, and both", () => {
        expect(acceptsTargets(code, { orderId: 1n })).toBe(true);
        expect(acceptsTargets(code, { karaokeReservationId: 2n })).toBe(true);
        expect(acceptsTargets(code, { orderId: 1n, karaokeReservationId: 2n })).toBe(true);
      });

      for (const key of TARGET_KEYS.filter(
        (name) => name !== "orderId" && name !== "karaokeReservationId",
      )) {
        it(`rejects ${key} alone`, () => {
          expect(acceptsTargets(code, { [key]: 3n })).toBe(false);
        });
        it(`rejects ${key} next to orderId`, () => {
          expect(acceptsTargets(code, { orderId: 1n, [key]: 3n })).toBe(false);
        });
      }
    });
  }

  for (const code of NON_EML_REASON_CODES) {
    it(`${code} is not restricted to Order / Reservation targets`, () => {
      expect(acceptsTargets(code, { orderId: 1n })).toBe(true);
      expect(acceptsTargets(code, { paymentBindingId: 3n })).toBe(true);
    });
  }
});

describe("TC-REVIEW-PORT-003 details and top-level items follow the REL-REC-008 allowlist [REL-REC-008]", () => {
  const VALID_DETAILS: Record<string, unknown> = {
    public_ref: { kind: "public_ref", value: SYNTHETIC_UUID },
    money: { kind: "money", amount: "3500", currency: "JPY" },
    timestamp: { kind: "timestamp", value: "2027-01-02T03:04:05.006Z" },
  };

  it("accepts an empty details object (DB default '{}')", () => {
    expect(acceptsDetails({})).toBe(true);
  });

  for (const [kind, value] of Object.entries(VALID_DETAILS)) {
    it(`accepts a ${kind} entry`, () => {
      expect(acceptsDetails({ sample: value })).toBe(true);
    });
  }

  it("accepts all accepted kinds together", () => {
    expect(acceptsDetails({ ...VALID_DETAILS })).toBe(true);
  });

  describe("rejects values outside the accepted REL-REC-008 kinds", () => {
    const outsiders: Array<[string, unknown]> = [
      ["a bare string", "CONFIRMED"],
      ["a bare free-text string", "free text note"],
      ["a number (internal id shape)", 123],
      ["a bigint (internal id shape)", 123n],
      ["a boolean", true],
      ["null", null],
      ["an array", [{ kind: "public_ref", value: SYNTHETIC_UUID }]],
      ["an object without kind", { value: "CONFIRMED" }],
      ["an unknown kind", { kind: "raw_body", value: "CONFIRMED" }],
      ["a free-text kind", { kind: "note", value: "CONFIRMED" }],
      ["a public_ref with an extra item", { kind: "public_ref", value: SYNTHETIC_UUID, note: "x" }],
      ["a nested object", { kind: "public_ref", value: { nested: SYNTHETIC_UUID } }],
      ["a money with an extra item", { kind: "money", amount: "1", currency: "JPY", note: "x" }],
      ["a kind with a missing value", { kind: "public_ref" }],
    ];
    for (const [label, value] of outsiders) {
      it(`rejects ${label}`, () => {
        expect(acceptsDetails({ sample: value })).toBe(false);
      });
    }
  });

  // SPEC-150 REL-REC-008 names "allowlisted state" and "provider status category", but no owner
  // defines the vocabulary (UCR U-6). A token shape check cannot tell an allowlisted value from an
  // unknown one or from a secret made of upper-case letters, digits and "_", so both kinds are
  // refused whatever the value, until a specification fixes the vocabulary.
  describe("refuses the state and provider_status_category kinds until a vocabulary is specified", () => {
    for (const kind of ["state", "provider_status_category"]) {
      for (const [label, value] of [
        ["a well-formed token", "CONFIRMED"],
        ["an undefined state-shaped token", "UNRECOGNIZED_STATE"],
        ["a secret-shaped upper-case token", "SK_TEST_SYNTHETIC_0123456789"],
        ["an email address", "user@example.com"],
        ["a raw QR payload", SYNTHETIC_QR],
        ["a lowercase token", "confirmed"],
        ["an empty string", ""],
      ] as const) {
        it(`${kind} rejects ${label}`, () => {
          expect(acceptsDetails({ sample: { kind, value } })).toBe(false);
        });
      }
    }
  });

  describe("value shapes of public_ref, money and timestamp", () => {
    it("public_ref accepts only a lowercase canonical UUID", () => {
      for (const value of ["123", 123, UPPER_UUID, "user@example.com", ""]) {
        expect(acceptsDetails({ sample: { kind: "public_ref", value } })).toBe(false);
      }
    });
    it("money accepts only a decimal string amount and a 3-letter uppercase currency", () => {
      for (const bad of [
        { amount: 3500, currency: "JPY" },
        { amount: "35.00", currency: "JPY" },
        { amount: "-1", currency: "JPY" },
        { amount: "9223372036854775808", currency: "JPY" },
        { amount: "3500", currency: "jpy" },
      ]) {
        expect(acceptsDetails({ sample: { kind: "money", ...bad } })).toBe(false);
      }
      expect(
        acceptsDetails({
          sample: { kind: "money", amount: "9223372036854775807", currency: "JPY" },
        }),
      ).toBe(true);
    });
    it("timestamp accepts only the canonical UTC ISO form", () => {
      for (const value of [
        "2027-01-02T03:04:05.006+09:00",
        "2027-01-02T03:04:05Z",
        "2027-02-30T00:00:00.000Z",
        1798859045006,
      ]) {
        expect(acceptsDetails({ sample: { kind: "timestamp", value } })).toBe(false);
      }
    });
  });

  describe("details keys", () => {
    it("accepts snake_case lowercase keys up to 64 characters", () => {
      for (const key of ["a", "order_state", "provider_status_2", `a${"b".repeat(63)}`]) {
        expect(acceptsDetails({ [key]: VALID_DETAILS.public_ref })).toBe(true);
      }
    });
    it("rejects uppercase, hyphenated, digit-leading, empty and over-long keys", () => {
      for (const key of [
        "State",
        "order-state",
        "1state",
        "",
        "a b",
        "a.b",
        `a${"b".repeat(64)}`,
      ]) {
        expect(acceptsDetails({ [key]: VALID_DETAILS.public_ref })).toBe(false);
      }
    });
  });

  describe("top-level items", () => {
    it("accepts exactly { reasonCode, targets, details }", () => {
      expect(accepts(openInput())).toBe(true);
    });
    // Generated or later-owned columns and the dedupe key (D-4: out of this PR) have no slot.
    for (const [key, value] of [
      ["publicRef", SYNTHETIC_UUID],
      ["openedAt", "2027-01-02T03:04:05.006Z"],
      ["resolvedAt", "2027-01-02T03:04:05.006Z"],
      ["resolutionNote", "synthetic note"],
      ["dedupeKey", "r150:PAY_BINDING_INCONSISTENT:ORDER:synthetic:synthetic"],
      ["dedupe", { primaryEntityType: "ORDER" }],
      ["reason_code", "PAY_BINDING_INCONSISTENT"],
    ] as const) {
      it(`rejects the top-level item ${key}`, () => {
        expect(accepts(openInput({ [key]: value }))).toBe(false);
      });
    }
  });
});

// The public input type carries the target constraints, so a caller that holds a
// ReviewCaseOpenInput has already satisfied them at compile time. These assertions are checked by
// `pnpm typecheck`; vitest does not evaluate them.
describe("TC-REVIEW-PORT-004 ReviewCaseOpenInput expresses the target constraints in its type [REL-REC-006]", () => {
  type Details = ReviewCaseOpenInput["details"];
  const details: Details = {};

  it("accepts an input with at least one target", () => {
    const input: ReviewCaseOpenInput = {
      reasonCode: "PAY_BINDING_INCONSISTENT",
      targets: { paymentBindingId: 3n as PaymentBindingId },
      details,
    };
    expect(input.reasonCode).toBe("PAY_BINDING_INCONSISTENT");
  });

  it("rejects empty targets and targets that hold only undefined at compile time", () => {
    const empty: ReviewCaseOpenInput = {
      reasonCode: "PAY_BINDING_INCONSISTENT",
      // @ts-expect-error SPEC-100 §43 CHECK: at least one target is required
      targets: {},
      details,
    };
    const undef: ReviewCaseOpenInput = {
      reasonCode: "PAY_BINDING_INCONSISTENT",
      // @ts-expect-error an explicitly undefined target is not a target
      targets: { orderId: undefined },
      details,
    };
    expect([empty, undef]).toHaveLength(2);
  });

  it("limits an EML_* reason to order / reservation targets at compile time", () => {
    const ok: ReviewCaseOpenInput = {
      reasonCode: "EML_RENDER_CONTEXT_INVALID",
      targets: { orderId: 1n as OrderId, karaokeReservationId: 2n as KaraokeReservationId },
      details,
    };
    // @ts-expect-error SPEC-120 §43.1: an email reason cannot target a payment binding
    const bad: ReviewCaseOpenInput = {
      reasonCode: "EML_RENDER_CONTEXT_INVALID",
      targets: { paymentBindingId: 3n as PaymentBindingId },
      details,
    };
    expect([ok, bad]).toHaveLength(2);
  });

  it("rejects an EML_* target variable that mixes an allowed and a forbidden key", () => {
    // A variable, not a literal: excess property checks do not apply, so the type itself must
    // forbid the other target keys.
    const mixed = { orderId: 1n as OrderId, paymentBindingId: 3n as PaymentBindingId };
    // @ts-expect-error SPEC-120 §43.1: a forbidden target next to an allowed one is still refused
    const input: ReviewCaseOpenInput = {
      reasonCode: "EML_RENDER_CONTEXT_INVALID",
      targets: mixed,
      details,
    };
    expect(input.reasonCode).toBe("EML_RENDER_CONTEXT_INVALID");
  });

  it("keeps the schema output assignable to the public type", () => {
    const parsed = reviewCaseOpenInputSchema.parse(openInput());
    expectTypeOf(parsed).toEqualTypeOf<ReviewCaseOpenInput>();
  });
});
