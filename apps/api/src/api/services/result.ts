import type { ErrorDetails } from "@off-r39x/api-contract";

// Application-service outcome (SPEC-110 section 58 step 5, DEV-TS-012). Services return this and
// never build an HTTP response; `respond()` maps it to the envelope. This file must not import hono,
// routes/, middleware/ or respond.ts. The wire types are imported type-only.

/**
 * The 4xx business codes a service may return. Transport-level codes (MALFORMED_REQUEST,
 * VALIDATION_FAILED, METHOD_NOT_ALLOWED, PAYLOAD_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE,
 * RATE_LIMIT_EXCEEDED, AUTHENTICATION_REQUIRED, EMAIL_VERIFICATION_REQUIRED) and INTERNAL_ERROR
 * belong to the HTTP layer and are not service results.
 */
export type RejectionCode =
  | "RESOURCE_NOT_FOUND"
  | "AUTHORIZATION_DENIED"
  | "STATE_CONFLICT"
  | "SOLD_OUT"
  | "SLOT_UNAVAILABLE"
  | "SLOT_GENERATION_OVERLAP"
  | "INVENTORY_UNAVAILABLE"
  | "PURCHASE_LIMIT_EXCEEDED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "BUSINESS_OPPORTUNITY_EXPIRED"
  | "DOMAIN_RULE_VIOLATION"
  | "OUTSIDE_CHECKIN_WINDOW"
  | "CONSISTENCY_REVIEW_REQUIRED";
export type TemporaryCode =
  | "DATABASE_TEMPORARY_FAILURE"
  | "STRIPE_TEMPORARY_FAILURE"
  | "AUTH_SERVICE_TEMPORARY_FAILURE"
  | "TEMPORARY_UNAVAILABLE";

export type ServiceResult<T> =
  | { kind: "success"; status: 200 | 201; data: T }
  /**
   * A known refusal or conflict. A service returns CONSISTENCY_REVIEW_REQUIRED only after it has
   * opened the Consistency Review case (SPEC-110 section 59, REL-DB-008); the type cannot enforce it.
   */
  | {
      [C in RejectionCode]: { kind: "rejected"; code: C; details?: ErrorDetails<C> };
    }[RejectionCode]
  | { kind: "temporary"; code: TemporaryCode }
  /** COMMIT acknowledgement lost; the service has reconciled or left it to reconciliation (REL-DB-006). */
  | { kind: "commit_unknown" };
