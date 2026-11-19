import {
  AuthFailure,
  type PrincipalStore,
  resolvePrincipal,
  resolveProvisioningPrincipal,
  type TokenVerifier,
} from "@off-r39x/auth";
import type { Context, MiddlewareHandler } from "hono";
import type { ApiEnvironment } from "../failure.ts";
import type { PrincipalRateLimitHooks } from "../rate-limit.ts";
import { type VerifiedIdentity, verifyAccessToken } from "./auth.ts";
import { securityEvent } from "./request-context.ts";

/** Token verification and the stage 2 rate limit, before any DB-backed resolution (SEC-ABU-017). */
async function authenticateRequest(
  c: Context<ApiEnvironment>,
  verifier: TokenVerifier,
  hooks: PrincipalRateLimitHooks | undefined,
): Promise<VerifiedIdentity> {
  const identity = await verifyAccessToken(c, verifier, hooks);
  // Stage 2 (SEC-ABU-017): per-subject rules, before the DB-backed Principal resolution.
  await hooks?.verified(c, identity);
  return identity;
}
/** The Email decision is recorded when it is made (step 3), whatever step 5 then decides. */
const emailVerified = (c: Context<ApiEnvironment>) => () =>
  securityEvent(c, "auth.email_verified_resolution.completed");
/** Records the refusal of step 3 / 5 with the same event and reason code for every guard. */
function recordResolutionFailure(c: Context<ApiEnvironment>, error: unknown): void {
  const kind = error instanceof AuthFailure ? error.kind : "database";
  if (kind === "email") {
    securityEvent(c, "auth.email_verified_resolution.completed", "EMAIL_VERIFICATION_REQUIRED");
  } else {
    securityEvent(
      c,
      "auth.business_profile_resolution.completed",
      kind === "consistency"
        ? "BUSINESS_PROFILE_INCONSISTENT"
        : kind === "database"
          ? "ROLE_RESOLUTION_UNAVAILABLE"
          : "BUSINESS_PROFILE_UNRESOLVED",
    );
  }
}
function recordPrincipalResolved(c: Context<ApiEnvironment>): void {
  securityEvent(c, "auth.business_profile_resolution.completed");
  securityEvent(c, "authorization.role_resolution.completed");
}

export function requirePrincipal(
  verifier: TokenVerifier,
  store: PrincipalStore,
  hooks?: PrincipalRateLimitHooks,
): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    const identity = await authenticateRequest(c, verifier, hooks);
    await resolveRequestPrincipal(c, identity, store);
    await next();
  };
}
/** SPEC-110 §24 step 3 (Email verified check) before step 5 (Business Profile), SPEC-110 §24.1. */
async function resolveRequestPrincipal(
  c: Context<ApiEnvironment>,
  identity: VerifiedIdentity,
  store: PrincipalStore,
): Promise<void> {
  try {
    c.set(
      "principal",
      await resolvePrincipal(identity, store, {
        requireVerifiedEmail: true,
        onEmailVerified: emailVerified(c),
      }),
    );
    recordPrincipalResolved(c);
  } catch (error) {
    recordResolutionFailure(c, error);
    throw error;
  }
}
/**
 * API-AUTH-003 guard (SPEC-110 §24.1 step 5, provisioning requirement). Lets through exactly one
 * case the regular guard refuses: a verified Email with no Business Profile. Token, directory, Email,
 * consistency and database refusals are decided by the same resolution and recorded the same way.
 * No Principal is set for a missing Profile; `provisioningSubject` is the verified subject only.
 */
export function requireProvisioningPrincipal(
  verifier: TokenVerifier,
  store: PrincipalStore,
  hooks?: PrincipalRateLimitHooks,
): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    const identity = await authenticateRequest(c, verifier, hooks);
    try {
      const decision = await resolveProvisioningPrincipal(identity, store, {
        onEmailVerified: emailVerified(c),
      });
      if (decision.profile === "present") {
        c.set("principal", decision.principal);
        recordPrincipalResolved(c);
      }
      // "missing" is not a refusal, so it records no BUSINESS_PROFILE_UNRESOLVED event.
      c.set("provisioningSubject", identity.subject);
    } catch (error) {
      recordResolutionFailure(c, error);
      throw error;
    }
    await next();
  };
}
export function requireVerifiedEmail(): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    if (!c.get("principal")) throw new AuthFailure("unauthenticated");
    if (!c.get("principal").emailVerified) {
      securityEvent(c, "auth.email_verified_resolution.completed", "EMAIL_VERIFICATION_REQUIRED");
      throw new AuthFailure("email");
    }
    // The success event is emitted once by requirePrincipal (resolveRequestPrincipal, onEmailVerified).
    await next();
  };
}
