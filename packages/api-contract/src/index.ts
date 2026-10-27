import { Hono } from "hono";
import { z } from "zod";

export const errorStatuses = {
  MALFORMED_REQUEST: 400,
  VALIDATION_FAILED: 400,
  AUTHENTICATION_REQUIRED: 401,
  EMAIL_VERIFICATION_REQUIRED: 403,
  AUTHORIZATION_DENIED: 403,
  RESOURCE_NOT_FOUND: 404,
  STATE_CONFLICT: 409,
  SOLD_OUT: 409,
  SLOT_UNAVAILABLE: 409,
  SLOT_GENERATION_OVERLAP: 409,
  INVENTORY_UNAVAILABLE: 409,
  PURCHASE_LIMIT_EXCEEDED: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  BUSINESS_OPPORTUNITY_EXPIRED: 410,
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
export const errorSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(Object.keys(errorStatuses) as [ErrorCode, ...ErrorCode[]]),
    message: z.string(),
    request_id: z.uuid(),
    retryable: z.boolean(),
    details: z.null(),
  }),
});
export const successSchema = <T extends z.ZodType>(data: T) =>
  z.strictObject({ data, meta: z.strictObject({ request_id: z.uuid() }) });
// Deliberately empty: no business operation is implemented in this foundation.
export const createPublicRpc = () => new Hono();
export type AppType = ReturnType<typeof createPublicRpc>;
