import { type Context, type Env, Hono, type MiddlewareHandler } from "hono";
import type { z } from "zod";
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
      c.json({
        data: principalNavigationSchema.parse(dependencies.principal(c)),
        meta: { request_id: dependencies.requestId(c) },
      }),
    )
    .get("/api/v1/self/profile", dependencies.profileRead.guard, async (c: Context<E>) =>
      c.json({
        data: currentProfileSchema.parse(await dependencies.profileRead.load(c)),
        meta: { request_id: dependencies.requestId(c) },
      }),
    )
    .patch(
      "/api/v1/self/profile",
      dependencies.profileUpdate.guard,
      dependencies.profileUpdate.body,
      // The handler repeats the Input; annotating it as plain Context<E> would make Hono infer {} and
      // drop the JSON input from AppType.
      async (c: Context<E, "/api/v1/self/profile", ProfileUpdateInput>) =>
        c.json({
          data: currentProfileSchema.parse(await dependencies.profileUpdate.save(c)),
          meta: { request_id: dependencies.requestId(c) },
        }),
    )
    .post(
      "/api/v1/self/profile/provision",
      dependencies.profileProvision.guard,
      dependencies.profileProvision.body,
      async (c: Context<E, "/api/v1/self/profile/provision", ProfileProvisionInput>) => {
        const result = await dependencies.profileProvision.provision(c);
        return c.json(
          {
            data: currentProfileSchema.parse(result.profile),
            meta: { request_id: dependencies.requestId(c) },
          },
          result.created ? 201 : 200,
        );
      },
    );
}
export type AppType = ReturnType<typeof createPublicRpc>;
