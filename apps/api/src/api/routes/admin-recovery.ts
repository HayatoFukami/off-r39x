// SPEC-110 §6 / §14: Administrator manual recovery commands (§48.5). No route is registered yet, so mounting this module adds nothing to
// app.routes and exposes no path. A route added here must also be registered in ../routes.ts ROUTES
// (DEV-RLM-005), and its Browser RPC type is declared through @off-r39x/api-contract (DEV-API-002).
import { Hono } from "hono";
import type { ApiEnvironment } from "../failure.ts";

export function createAdminRecoveryRoutes() {
  return new Hono<ApiEnvironment>();
}
