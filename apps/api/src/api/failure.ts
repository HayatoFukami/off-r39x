import type { Principal } from "@off-r39x/auth";
import type { createLogger } from "@off-r39x/observability";
import type { RouteClassId } from "@off-r39x/security";
import type { ErrorCode } from "./schemas/common.ts";

export type ApiEnvironment = {
  Variables: {
    requestId: string;
    principal: Principal;
    validatedJson: unknown;
    logger: ReturnType<typeof createLogger> | undefined;
    operationExecutionId: string | undefined;
    /** Set by the rate limit Stage 1 middleware from the route registry (SEC-ABU-017). */
    operationId: string | undefined;
    rateLimitClass: RouteClassId | undefined;
    clientIp: string | undefined;
    /** SEC-ABU-029: set once the target's authorization check (owner relation / Capability) passed. */
    authorizationConfirmed: boolean | undefined;
  };
};

export class ApiFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly statusOverride?: 400 | 405 | 413 | 415,
    /** Only for RATE_LIMIT_EXCEEDED: the integer-second Retry-After value (SEC-ABU-007). */
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}
