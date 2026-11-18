import { type Context, type Env, Hono, type MiddlewareHandler } from "hono";
import {
  type CurrentProfile,
  currentProfileSchema,
  type PrincipalNavigation,
  principalNavigationSchema,
} from "./schemas/profile.ts";

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
    body: MiddlewareHandler<E>;
    save: (c: Context<E>) => Promise<CurrentProfile>;
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
      async (c: Context<E>) =>
        c.json({
          data: currentProfileSchema.parse(await dependencies.profileUpdate.save(c)),
          meta: { request_id: dependencies.requestId(c) },
        }),
    );
}
export type AppType = ReturnType<typeof createPublicRpc>;
