import { type Context, type Env, Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

export { successSchema } from "./schemas/common.ts";
export { type ErrorCode, errorSchema, errorStatuses } from "./schemas/errors.ts";
export const principalNavigationSchema = z.strictObject({
  profile_ref: z.uuid(),
  capabilities: z.array(z.string()),
  has_staff_role: z.boolean(),
  has_administrator_role: z.boolean(),
});
export type PrincipalNavigation = z.infer<typeof principalNavigationSchema>;
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
