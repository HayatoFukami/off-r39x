import { type Context, type Env, Hono, type MiddlewareHandler } from "hono";
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
export const principalNavigationSchema = z.strictObject({
  profile_ref: z.uuid(),
  capabilities: z.array(z.string()),
  has_staff_role: z.boolean(),
  has_administrator_role: z.boolean(),
});
export type PrincipalNavigation = z.infer<typeof principalNavigationSchema>;
// The server mounts this same builder: no parallel route declaration or import
// of server authority into the client-visible contract package.
export function createPublicRpc<E extends Env>(dependencies: {
  guard: MiddlewareHandler<E>;
  principal: (c: Context<E>) => PrincipalNavigation;
  requestId: (c: Context<E>) => string;
}) {
  return new Hono<E>().get("/api/v1/self/principal", dependencies.guard, (c: Context<E>) =>
    c.json({
      data: principalNavigationSchema.parse(dependencies.principal(c)),
      meta: { request_id: dependencies.requestId(c) },
    }),
  );
}
export type AppType = ReturnType<typeof createPublicRpc>;
