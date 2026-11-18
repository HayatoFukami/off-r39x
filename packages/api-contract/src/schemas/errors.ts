import { z } from "zod";

export const errorStatuses = {
  MALFORMED_REQUEST: 400,
  VALIDATION_FAILED: 400,
  AUTHENTICATION_REQUIRED: 401,
  EMAIL_VERIFICATION_REQUIRED: 403,
  AUTHORIZATION_DENIED: 403,
  RESOURCE_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  STATE_CONFLICT: 409,
  SOLD_OUT: 409,
  SLOT_UNAVAILABLE: 409,
  SLOT_GENERATION_OVERLAP: 409,
  INVENTORY_UNAVAILABLE: 409,
  PURCHASE_LIMIT_EXCEEDED: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  BUSINESS_OPPORTUNITY_EXPIRED: 410,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMIT_EXCEEDED: 429,
  DOMAIN_RULE_VIOLATION: 422,
  OUTSIDE_CHECKIN_WINDOW: 422,
  STRIPE_TEMPORARY_FAILURE: 424,
  DATABASE_TEMPORARY_FAILURE: 503,
  AUTH_SERVICE_TEMPORARY_FAILURE: 503,
  TEMPORARY_UNAVAILABLE: 503,
  CONSISTENCY_REVIEW_REQUIRED: 409,
  INTERNAL_ERROR: 500,
} as const;
export type ErrorCode = keyof typeof errorStatuses;

/**
 * SPEC-110 section 21 Retryable column, in `errorStatuses` order. "conditional" is the table's
 * 条件付き: the condition is not defined, so the envelope accepts either boolean and a producer
 * resolves it to false (S0-3a G-a1 B; REL-RTY-007).
 */
export const errorRetryable = {
  MALFORMED_REQUEST: false,
  VALIDATION_FAILED: false,
  AUTHENTICATION_REQUIRED: "conditional",
  EMAIL_VERIFICATION_REQUIRED: false,
  AUTHORIZATION_DENIED: false,
  RESOURCE_NOT_FOUND: false,
  METHOD_NOT_ALLOWED: false,
  STATE_CONFLICT: false,
  SOLD_OUT: false,
  SLOT_UNAVAILABLE: false,
  SLOT_GENERATION_OVERLAP: false,
  INVENTORY_UNAVAILABLE: false,
  PURCHASE_LIMIT_EXCEEDED: false,
  IDEMPOTENCY_KEY_REUSED: false,
  BUSINESS_OPPORTUNITY_EXPIRED: false,
  PAYLOAD_TOO_LARGE: false,
  UNSUPPORTED_MEDIA_TYPE: false,
  RATE_LIMIT_EXCEEDED: true,
  DOMAIN_RULE_VIOLATION: false,
  OUTSIDE_CHECKIN_WINDOW: false,
  STRIPE_TEMPORARY_FAILURE: true,
  DATABASE_TEMPORARY_FAILURE: true,
  AUTH_SERVICE_TEMPORARY_FAILURE: true,
  TEMPORARY_UNAVAILABLE: true,
  CONSISTENCY_REVIEW_REQUIRED: false,
  INTERNAL_ERROR: "conditional",
} as const satisfies Record<ErrorCode, boolean | "conditional">;

// API-PUR-ELG-001 Reasons, in the order the Operation lists them.
const purchaseReasons = [
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

// API-PUR-CART-001 Business conflict: { kind, target_ref, reasons } (SPEC-110 section 9: lowercase UUID).
const itemFailureSchema = z.strictObject({
  kind: z.enum(["ENTRY", "GOODS"]),
  target_ref: z.uuid().refine((value) => value === value.toLowerCase(), "Expected lowercase UUID"),
  reasons: z
    .array(z.enum(purchaseReasons))
    .min(1)
    .refine(
      (reasons) =>
        reasons.every(
          (reason, index) =>
            index === 0 ||
            purchaseReasons.indexOf(reason) >
              purchaseReasons.indexOf(reasons[index - 1] ?? purchaseReasons[0]),
        ),
      "Expected unique reasons in API-PUR-ELG-001 order",
    ),
});
const stateConflictDetailsSchema = z.strictObject({
  item_failures: z
    .array(itemFailureSchema)
    .min(1)
    .max(50)
    .refine(
      (items) =>
        new Set(items.map((item) => `${item.kind}:${item.target_ref}`)).size === items.length,
      "Expected unique (kind, target_ref)",
    ),
});
export type ItemFailure = z.infer<typeof itemFailureSchema>;

type FixedRetryableCode = {
  [C in ErrorCode]: (typeof errorRetryable)[C] extends boolean ? C : never;
}[ErrorCode];

// One strict variant per code (SPEC-110 section 16). `details` is null except where section 20 /
// 21 / an Operation allows a shape (SEC-ERR-001, SEC-ERR-002).
function variant<C extends ErrorCode, R extends z.ZodType, D extends z.ZodType>(
  code: C,
  retryable: R,
  details: D,
) {
  return z.strictObject({
    code: z.literal(code),
    message: z.string(),
    request_id: z.uuid(),
    retryable,
    details,
  });
}
const fixed = <C extends FixedRetryableCode>(code: C) =>
  variant(code, z.literal(errorRetryable[code]), z.null());
const conditional = <C extends ErrorCode>(code: C) => variant(code, z.boolean(), z.null());

export const errorSchema = z.strictObject({
  error: z.discriminatedUnion("code", [
    fixed("MALFORMED_REQUEST"),
    fixed("VALIDATION_FAILED"),
    conditional("AUTHENTICATION_REQUIRED"),
    fixed("EMAIL_VERIFICATION_REQUIRED"),
    fixed("AUTHORIZATION_DENIED"),
    fixed("RESOURCE_NOT_FOUND"),
    fixed("METHOD_NOT_ALLOWED"),
    variant(
      "STATE_CONFLICT",
      z.literal(errorRetryable.STATE_CONFLICT),
      z.union([z.null(), stateConflictDetailsSchema]),
    ),
    fixed("SOLD_OUT"),
    fixed("SLOT_UNAVAILABLE"),
    fixed("SLOT_GENERATION_OVERLAP"),
    fixed("INVENTORY_UNAVAILABLE"),
    fixed("PURCHASE_LIMIT_EXCEEDED"),
    fixed("IDEMPOTENCY_KEY_REUSED"),
    fixed("BUSINESS_OPPORTUNITY_EXPIRED"),
    fixed("PAYLOAD_TOO_LARGE"),
    fixed("UNSUPPORTED_MEDIA_TYPE"),
    fixed("RATE_LIMIT_EXCEEDED"),
    fixed("DOMAIN_RULE_VIOLATION"),
    fixed("OUTSIDE_CHECKIN_WINDOW"),
    fixed("STRIPE_TEMPORARY_FAILURE"),
    fixed("DATABASE_TEMPORARY_FAILURE"),
    fixed("AUTH_SERVICE_TEMPORARY_FAILURE"),
    fixed("TEMPORARY_UNAVAILABLE"),
    fixed("CONSISTENCY_REVIEW_REQUIRED"),
    conditional("INTERNAL_ERROR"),
  ]),
});
/** The `details` type of an error envelope with code `C`. */
export type ErrorDetails<C extends ErrorCode> = Extract<
  z.infer<typeof errorSchema>["error"],
  { code: C }
>["details"];
