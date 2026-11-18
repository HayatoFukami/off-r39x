// SPEC-110 §15. Only the Browser RPC namespaces (public / self / staff / admin) are mounted here.
// Webhook (§6, DEV-API-002, DEV-API-008), health and the /auth/* proxy are not RPC, so app.ts
// mounts them separately. The AppType definition lives in @off-r39x/api-contract only.
import type { Hono } from "hono";
import type { ApiEnvironment } from "./failure.ts";
import { createAdminContentRoutes } from "./routes/admin-content.ts";
import { createAdminGoodsRoutes } from "./routes/admin-goods.ts";
import { createAdminHandoffsRoutes } from "./routes/admin-handoffs.ts";
import { createAdminKaraokeRoutes } from "./routes/admin-karaoke.ts";
import { createAdminOrdersRoutes } from "./routes/admin-orders.ts";
import { createAdminRecoveryRoutes } from "./routes/admin-recovery.ts";
import { createAdminRolesRoutes } from "./routes/admin-roles.ts";
import { createAdminSalesRoutes } from "./routes/admin-sales.ts";
import { createAdminTicketsRoutes } from "./routes/admin-tickets.ts";
import { createPublicRoutes } from "./routes/public.ts";
import { createSelfGoodsRoutes } from "./routes/self-goods.ts";
import { createSelfKaraokeRoutes } from "./routes/self-karaoke.ts";
import { createSelfOrdersRoutes } from "./routes/self-orders.ts";
import {
  createSelfProfileRoutes,
  type SelfProfileRouteDependencies,
} from "./routes/self-profile.ts";
import { createSelfTicketsRoutes } from "./routes/self-tickets.ts";
import { createStaffCheckinRoutes } from "./routes/staff-checkin.ts";
import { createStaffGoodsRoutes } from "./routes/staff-goods.ts";

export type { AppType } from "@off-r39x/api-contract";

export function mountRpcRoutes(
  app: Hono<ApiEnvironment>,
  dependencies: SelfProfileRouteDependencies,
): void {
  app.route("/", createPublicRoutes());
  app.route("/", createSelfProfileRoutes(dependencies));
  app.route("/", createSelfOrdersRoutes());
  app.route("/", createSelfTicketsRoutes());
  app.route("/", createSelfKaraokeRoutes());
  app.route("/", createSelfGoodsRoutes());
  app.route("/", createStaffCheckinRoutes());
  app.route("/", createStaffGoodsRoutes());
  app.route("/", createAdminOrdersRoutes());
  app.route("/", createAdminTicketsRoutes());
  app.route("/", createAdminKaraokeRoutes());
  app.route("/", createAdminSalesRoutes());
  app.route("/", createAdminGoodsRoutes());
  app.route("/", createAdminHandoffsRoutes());
  app.route("/", createAdminContentRoutes());
  app.route("/", createAdminRolesRoutes());
  app.route("/", createAdminRecoveryRoutes());
}
