// SPEC-110 §25 API-AUTH-001 / API-AUTH-002 / API-AUTH-004. The route declarations and the response
// schemas live in the @off-r39x/api-contract builder (DEV-API-002/003); this file only injects the
// guards, the body validation and the service result -> HTTP mapping (DEV-API-001).
import {
  type CurrentProfile,
  createPublicRpc,
  provisionCurrentProfileRequestSchema,
  updateCurrentProfileRequestSchema,
} from "@off-r39x/api-contract";
import {
  type Capability,
  capabilities,
  hasCapability,
  type PrincipalStore,
  type TokenVerifier,
} from "@off-r39x/auth";
import type { MiddlewareHandler } from "hono";
import { type ApiEnvironment, ApiFailure } from "../failure.ts";
import { requireCapability } from "../middleware/capability.ts";
import { validateJson } from "../middleware/json.ts";
import {
  requirePrincipal,
  requireProvisioningPrincipal,
  requireVerifiedEmail,
} from "../middleware/principal.ts";
import type { PrincipalRateLimitHooks } from "../rate-limit.ts";
import {
  type CurrentProfileStore,
  type ProfileRecord,
  provisionCurrentProfile,
  readCurrentProfile,
  updateCurrentProfile,
} from "../services/index.ts";

export interface SelfProfileRouteDependencies {
  readonly app: {
    readonly auth?: { verifier: TokenVerifier; store: PrincipalStore } | undefined;
    readonly profiles?: CurrentProfileStore | undefined;
  };
  readonly principalHooks: PrincipalRateLimitHooks | undefined;
}

// camelCase record -> snake_case response DTO. Built field by field (no spread of a DB row).
const toResponse = (profile: ProfileRecord): CurrentProfile => ({
  profile_ref: profile.publicRef,
  display_name: profile.displayName,
  updated_at: profile.updatedAt,
});

export function createSelfProfileRoutes(dependencies: SelfProfileRouteDependencies) {
  const { principalHooks } = dependencies;
  const { auth, profiles } = dependencies.app;
  // Fail closed when any dependency is missing; checked before the Principal store is touched.
  // API-AUTH-001 (no capability) does not need the Profile store.
  const guardFor =
    (capability: Capability | undefined): MiddlewareHandler<ApiEnvironment> =>
    async (c, next) => {
      if (!auth || !principalHooks || (capability && !profiles))
        throw new ApiFailure("TEMPORARY_UNAVAILABLE");
      await requirePrincipal(
        auth.verifier,
        auth.store,
        principalHooks,
      )(c, async () => {
        await requireVerifiedEmail()(c, async () => {
          if (capability) await requireCapability(capability)(c, next);
          else await next();
        });
      });
    };
  // API-AUTH-003: no requireVerifiedEmail (the resolution always checks the Email) and no Capability
  // (SPEC-110 names none; authorization is the verified token, the Email and the subject itself).
  const provisionGuard: MiddlewareHandler<ApiEnvironment> = async (c, next) => {
    if (!auth || !principalHooks || !profiles) throw new ApiFailure("TEMPORARY_UNAVAILABLE");
    await requireProvisioningPrincipal(auth.verifier, auth.store, principalHooks)(c, next);
  };
  const store = (): CurrentProfileStore => {
    if (!profiles) throw new ApiFailure("TEMPORARY_UNAVAILABLE");
    return profiles;
  };
  return createPublicRpc<ApiEnvironment>({
    guard: guardFor(undefined),
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
    profileRead: {
      guard: guardFor("profile.self.read"),
      load: async (c) => {
        // The only selector is the verified Auth Subject (AR-OWN-006, DEV-API-005).
        const result = await readCurrentProfile(store(), c.get("principal").subject);
        if (result.kind === "ok") return toResponse(result.profile);
        // OI-2: a guarded Principal whose row vanished is an inconsistency, never a created row.
        if (result.kind === "profile_missing") throw new ApiFailure("INTERNAL_ERROR");
        throw new ApiFailure("DATABASE_TEMPORARY_FAILURE");
      },
    },
    profileUpdate: {
      guard: guardFor("profile.self.update"),
      body: validateJson(updateCurrentProfileRequestSchema),
      save: async (c) => {
        const request = updateCurrentProfileRequestSchema.parse(c.get("validatedJson"));
        const result = await updateCurrentProfile(store(), c.get("principal").subject, request);
        if (result.kind === "ok") return toResponse(result.profile);
        if (result.kind === "invalid_display_name") throw new ApiFailure("VALIDATION_FAILED");
        if (result.kind === "profile_missing") throw new ApiFailure("INTERNAL_ERROR");
        // SPEC-110 §51: an unknown commit result is never reported as a success.
        throw new ApiFailure("DATABASE_TEMPORARY_FAILURE");
      },
    },
    profileProvision: {
      guard: provisionGuard,
      body: validateJson(provisionCurrentProfileRequestSchema),
      provision: async (c) => {
        // The only selector is the verified Auth Subject set by the guard; nothing in the request is read.
        const subject = c.get("provisioningSubject");
        if (!subject) throw new ApiFailure("INTERNAL_ERROR");
        // Always through the repository, even for an existing Profile (the DB primitive is the contract).
        const result = await provisionCurrentProfile(store(), subject);
        if (result.kind === "created" || result.kind === "existing")
          return { created: result.kind === "created", profile: toResponse(result.profile) };
        // SPEC-110 §51: an unknown commit result is never reported as a success.
        throw new ApiFailure("DATABASE_TEMPORARY_FAILURE");
      },
    },
  });
}
