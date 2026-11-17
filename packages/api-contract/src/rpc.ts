import { type Context, type Env, Hono, type MiddlewareHandler } from "hono";
import { type PrincipalNavigation, principalNavigationSchema } from "./schemas/profile.ts";

// The server mounts this same builder: no parallel route declaration or import
// of server authority into the client-visible contract package.
export function createPublicRpc<E extends Env>(dependencies: {
  guard: MiddlewareHandler<E>;
  principal: (c: Context<E>) => PrincipalNavigation;
  requestId: (c: Context<E>) => string;
}) {
  return new Hono<E>().get("/api/v1/self/principal", dependencies.guard, (c: Context<E>) =>
    c.json({
      data: principalNavigationSchema.parse(dependencies.principal(c)),
      meta: { request_id: dependencies.requestId(c) },
    }),
  );
}
export type AppType = ReturnType<typeof createPublicRpc>;
