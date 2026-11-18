import {
  AuthFailure,
  type PrincipalStore,
  resolvePrincipal,
  type TokenVerifier,
} from "@off-r39x/auth";
import type { Context, MiddlewareHandler } from "hono";
import type { ApiEnvironment } from "../failure.ts";
import type { PrincipalRateLimitHooks } from "../rate-limit.ts";
import { type VerifiedIdentity, verifyAccessToken } from "./auth.ts";
import { securityEvent } from "./request-context.ts";

export function requirePrincipal(
  verifier: TokenVerifier,
  store: PrincipalStore,
  hooks?: PrincipalRateLimitHooks,
): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    const identity = await verifyAccessToken(c, verifier, hooks);
    // Stage 2 (SEC-ABU-017): per-subject rules, before the DB-backed Principal resolution.
    await hooks?.verified(c, identity);
    await resolveRequestPrincipal(c, identity, store);
    await next();
  };
}
async function resolveRequestPrincipal(
  c: Context<ApiEnvironment>,
  identity: VerifiedIdentity,
  store: PrincipalStore,
): Promise<void> {
  try {
    c.set("principal", await resolvePrincipal(identity, store));
    securityEvent(c, "auth.business_profile_resolution.completed");
    securityEvent(c, "authorization.role_resolution.completed");
  } catch (error) {
    const kind = error instanceof AuthFailure ? error.kind : "database";
    securityEvent(
      c,
      "auth.business_profile_resolution.completed",
      kind === "consistency"
        ? "BUSINESS_PROFILE_INCONSISTENT"
        : kind === "database"
          ? "ROLE_RESOLUTION_UNAVAILABLE"
          : "BUSINESS_PROFILE_UNRESOLVED",
    );
    throw error;
  }
}
export function requireVerifiedEmail(): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    if (!c.get("principal")) throw new AuthFailure("unauthenticated");
    if (!c.get("principal").emailVerified) {
      securityEvent(c, "auth.email_verified_resolution.completed", "EMAIL_VERIFICATION_REQUIRED");
      throw new AuthFailure("email");
    }
    securityEvent(c, "auth.email_verified_resolution.completed");
    await next();
  };
}
