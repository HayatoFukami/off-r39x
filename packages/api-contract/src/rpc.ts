import { type Context, type Env, Hono, type MiddlewareHandler } from "hono";
import type { z } from "zod";
import { successSchema } from "./schemas/common.ts";
import {
  type CurrentProfile,
  currentProfileSchema,
  type PrincipalNavigation,
  principalNavigationSchema,
  type provisionCurrentProfileRequestSchema,
  type updateCurrentProfileRequestSchema,
} from "./schemas/profile.ts";

// Hono Input type of the PATCH body: what hc<AppType> exposes as the required JSON input. Only `in`
// is declared: validateJson stores the parsed body in `validatedJson`, not in Hono's validated data,
// so declaring `out` would make `c.req.valid("json")` look available when it is not.
type ProfileUpdateInput = {
  in: { json: z.input<typeof updateCurrentProfileRequestSchema> };
};

// Same for the API-AUTH-003 body (`{}`).
type ProfileProvisionInput = {
  in: { json: z.input<typeof provisionCurrentProfileRequestSchema> };
};

/**
 * SPEC-110 section 19 / DEV-API-003: the whole success envelope, meta.request_id included, is checked
 * by the shared successSchema before it is sent; a mismatch throws, so the route answers 500 and never
 * sends the data. The data schema is the route's strict response schema.
 */
function envelope<S extends z.ZodType>(schema: S, data: unknown, requestId: string) {
  return successSchema(schema).parse({ data, meta: { request_id: requestId } });
}

// The server mounts this same builder: no parallel route declaration or import
// of server authority into the client-visible contract package.
export function createPublicRpc<E extends Env>(dependencies: {
  guard: MiddlewareHandler<E>;
  principal: (c: Context<E>) => PrincipalNavigation;
  requestId: (c: Context<E>) => string;
  /** API-AUTH-002. */
  profileRead: {
    guard: MiddlewareHandler<E>;
    load: (c: Context<E>) => Promise<CurrentProfile>;
  };
  /** API-AUTH-004. `body` validates the request after the guard (authenticate, then validate). */
  profileUpdate: {
    guard: MiddlewareHandler<E>;
    body: MiddlewareHandler<E, "/api/v1/self/profile", ProfileUpdateInput>;
    save: (c: Context<E>) => Promise<CurrentProfile>;
  };
  /**
   * API-AUTH-003. `guard` lets a verified Email without a Business Profile through; `provision`
   * reports whether the row was created (201) or already existed (200).
   */
  profileProvision: {
    guard: MiddlewareHandler<E>;
    body: MiddlewareHandler<E, "/api/v1/self/profile/provision", ProfileProvisionInput>;
    provision: (
      c: Context<E, "/api/v1/self/profile/provision", ProfileProvisionInput>,
    ) => Promise<{ created: boolean; profile: CurrentProfile }>;
  };
}) {
  return new Hono<E>()
    .get("/api/v1/self/principal", dependencies.guard, (c: Context<E>) =>
      c.json(
        envelope(principalNavigationSchema, dependencies.principal(c), dependencies.requestId(c)),
      ),
    )
    .get("/api/v1/self/profile", dependencies.profileRead.guard, async (c: Context<E>) =>
      c.json(
        envelope(
          currentProfileSchema,
          await dependencies.profileRead.load(c),
          dependencies.requestId(c),
        ),
      ),
    )
    .patch(
      "/api/v1/self/profile",
      dependencies.profileUpdate.guard,
      dependencies.profileUpdate.body,
      // The handler repeats the Input; annotating it as plain Context<E> would make Hono infer {} and
      // drop the JSON input from AppType.
      async (c: Context<E, "/api/v1/self/profile", ProfileUpdateInput>) =>
        c.json(
          envelope(
            currentProfileSchema,
            await dependencies.profileUpdate.save(c),
            dependencies.requestId(c),
          ),
        ),
    )
    .post(
      "/api/v1/self/profile/provision",
      dependencies.profileProvision.guard,
      dependencies.profileProvision.body,
      async (c: Context<E, "/api/v1/self/profile/provision", ProfileProvisionInput>) => {
        const result = await dependencies.profileProvision.provision(c);
        return c.json(
          envelope(currentProfileSchema, result.profile, dependencies.requestId(c)),
          result.created ? 201 : 200,
        );
      },
    );
}
export type AppType = ReturnType<typeof createPublicRpc>;
