import { AuthFailure, type TokenInspection, type TokenVerifier } from "@off-r39x/auth";
import type { Context } from "hono";
import type { ApiEnvironment } from "../failure.ts";
import type { PrincipalRateLimitHooks } from "../rate-limit.ts";
import { securityEvent } from "./request-context.ts";

export type VerifiedIdentity = Awaited<ReturnType<TokenVerifier["verify"]>>;

/** Token verification only (SPEC-110 §24 step 2): no PrincipalStore, no database access (§24.1). */
export async function verifyAccessToken(
  c: Context<ApiEnvironment>,
  verifier: TokenVerifier,
  hooks?: PrincipalRateLimitHooks,
): Promise<VerifiedIdentity> {
  let identity: Awaited<ReturnType<TokenVerifier["verify"]>>;
  // SEC-ABU-033 (a): the structure is checked first and does no cryptographic work.
  const inspected = verifier.inspect
    ? verifier.inspect(c.req.header("Authorization"))
    : inspectBearerFormat(c.req.header("Authorization"));
  // SEC-ABU-033 (b): a signature is verified only inside its budget; an exhausted one is a 429 that
  // is not an authentication failure (the token was not judged).
  const releaseVerification = inspected.ok ? await hooks?.beforeVerification(c) : undefined;
  try {
    if (!inspected.ok) throw new AuthFailure("unauthenticated");
    identity = await verifier.verify(inspected.token);
    securityEvent(c, "auth.verification.completed");
  } catch (error) {
    securityEvent(
      c,
      "auth.verification.completed",
      error instanceof AuthFailure && error.kind === "unavailable"
        ? "AUTH_SERVICE_UNAVAILABLE"
        : "AUTHENTICATION_REQUIRED",
    );
    // SEC-ABU-021 (5): record the failed structure check / verification for the guard.
    await hooks?.verificationFailed(c, error);
    throw error;
  } finally {
    releaseVerification?.();
  }
  return identity;
}
/** Plain Bearer format check, for a verifier without its own structure check. */
function inspectBearerFormat(authorization: string | undefined): TokenInspection {
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
    authorization ?? "",
  );
  return match?.[1] ? { ok: true, token: match[1] } : { ok: false };
}
