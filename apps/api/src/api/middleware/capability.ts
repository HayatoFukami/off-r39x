import { AuthFailure, type Capability, hasCapability } from "@off-r39x/auth";
import type { MiddlewareHandler } from "hono";
import type { ApiEnvironment } from "../failure.ts";
import { markAuthorizationConfirmed } from "../rate-limit.ts";
import { securityEvent } from "./request-context.ts";

export function requireCapability(capability: Capability): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    if (!c.get("principal") || !hasCapability(c.get("principal"), capability)) {
      securityEvent(c, "authorization.decision.completed", "CAPABILITY_DENIED");
      throw new AuthFailure("denied");
    }
    securityEvent(c, "authorization.decision.completed");
    // SEC-ABU-029: Role + Capability passed (step 7); Stage 3 resource rules may now be evaluated.
    markAuthorizationConfirmed(c);
    await next();
  };
}
