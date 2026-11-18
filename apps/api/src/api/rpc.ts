// SPEC-110 §15. Only the Browser RPC namespaces (public / self / staff / admin) are mounted here.
// Webhook (§6, DEV-API-002, DEV-API-008), health and the /auth/* proxy are not RPC, so app.ts
// mounts them separately. The AppType definition lives in @off-r39x/api-contract only.
import type { Hono } from "hono";
import type { ApiEnvironment } from "./failure.ts";
import {
  createSelfProfileRoutes,
  type SelfProfileRouteDependencies,
} from "./routes/self-profile.ts";

export type { AppType } from "@off-r39x/api-contract";

export function mountRpcRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: SelfProfileRouteDependencies,
): void {
  app.route("/", createSelfProfileRoutes(dependencies));
}
