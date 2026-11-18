// SPEC-110 §25 API-AUTH-001. The route declaration and the response schema live in the
// @off-r39x/api-contract builder (DEV-API-002/003); this file only injects the guard and the
// Principal -> response mapping (DEV-API-001).
import { createPublicRpc } from "@off-r39x/api-contract";
import {
  capabilities,
  hasCapability,
  type PrincipalStore,
  type TokenVerifier,
} from "@off-r39x/auth";
import { type ApiEnvironment, ApiFailure } from "../failure.ts";
import { requirePrincipal, requireVerifiedEmail } from "../middleware/principal.ts";
import type { PrincipalRateLimitHooks } from "../rate-limit.ts";

export interface SelfProfileRouteDependencies {
  readonly app: {
    readonly auth?: { verifier: TokenVerifier; store: PrincipalStore } | undefined;
  };
  readonly principalHooks: PrincipalRateLimitHooks | undefined;
}

export function createSelfProfileRoutes(dependencies: SelfProfileRouteDependencies) {
  const { principalHooks } = dependencies;
  return createPublicRpc<ApiEnvironment>({
    guard: async (c, next) => {
      if (!dependencies.app.auth || !principalHooks) throw new ApiFailure("TEMPORARY_UNAVAILABLE");
      await requirePrincipal(
        dependencies.app.auth.verifier,
        dependencies.app.auth.store,
        principalHooks,
      )(c, async () => {
        await requireVerifiedEmail()(c, next);
      });
    },
    principal: (c) => {
      const principal = c.get("principal");
      return {
        profile_ref: principal.profileRef,
        capabilities: capabilities.filter((capability) => hasCapability(principal, capability)),
        has_staff_role: principal.roles.includes("STAFF"),
        has_administrator_role: principal.roles.includes("ADMINISTRATOR"),
      };
    },
    requestId: (c) => c.get("requestId"),
  });
}
