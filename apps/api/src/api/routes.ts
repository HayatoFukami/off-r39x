// DEV-RLM-005 / API-RLC-001: every mounted route is registered with its Operation ID and rate
// limit class. The class must equal the SPEC-110 §56.1 assignment; a route registered without a
// class, with an unlisted Operation ID, or with a different class is a type error here and is
// rejected again at startup by assertRouteRegistry.
import { assertRouteRegistry, type RouteClassId, type RouteRegistration } from "@off-r39x/security";
import { TrieRouter } from "hono/router/trie-router";
import { AUTH_ROUTES } from "./auth-proxy.ts";

const authTransportRoutes: readonly RouteRegistration[] = Object.entries(AUTH_ROUTES).map(
  ([path, method]) => ({
    method,
    path: `/auth/${path}`,
    operationId: null,
    rateLimitClass: "auth_form_proxy",
  }),
);

export const ROUTES: readonly RouteRegistration[] = Object.freeze([
  {
    method: "GET",
    path: "/api/v1/self/principal",
    operationId: "API-AUTH-001",
    rateLimitClass: "self_read",
  },
  ...authTransportRoutes,
]);
assertRouteRegistry(ROUTES);

export interface RouteClassification {
  readonly classId: RouteClassId;
  readonly operationId: string | null;
}
export type RouteClassifier = (method: string, path: string) => RouteClassification | undefined;

/** Builds a classifier over registered routes (Hono path matching, so `:param` routes work). */
export function createRouteClassifier(routes: readonly RouteRegistration[]): RouteClassifier {
  const router = new TrieRouter<RouteClassification>();
  for (const route of routes)
    router.add(route.method, route.path, {
      classId: route.rateLimitClass,
      operationId: route.operationId,
    });
  return (method, path) => {
    // HEAD is served by the GET handler, except for the auth transport (no HEAD there).
    const lookup = method === "HEAD" && !path.startsWith("/auth/") ? "GET" : method;
    return router.match(lookup, path)[0][0]?.[0];
  };
}
export const classifyRequest: RouteClassifier = createRouteClassifier(ROUTES);

/** SEC-ABU-018: the only requests that never query the store. */
export function isRateLimitExempt(method: string, path: string): boolean {
  if (method === "OPTIONS") return true;
  return (
    (method === "GET" || method === "HEAD") &&
    (path === "/internal/health/live" || path === "/internal/health/ready")
  );
}
