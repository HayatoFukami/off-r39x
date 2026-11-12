// DEV-RLM-005 / API-RLC-001: every mounted route is registered with its Operation ID and rate
// limit class. The class must equal the SPEC-110 §56.1 assignment; a route registered without a
// class, with an unlisted Operation ID, or with a different class is a type error here and is
// rejected again at startup by assertRouteRegistry.
import { assertRouteRegistry, type RouteClassId, type RouteRegistration } from "@off-r39x/security";
import { TrieRouter } from "hono/router/trie-router";
import { AUTH_ROUTES } from "./auth-proxy.ts";

// SEC-ABU-027 / 028, SPEC-110 §56.1: session lookup and sign-out are auth_session, the email-link
// completion GETs are auth_callback, every other allowed `/auth/*` route (including the OTP POST
// `email-otp/verify-email`) is auth_form_proxy (authentication attempts).
const AUTH_SESSION_ROUTES: ReadonlySet<string> = new Set([
  "GET /auth/get-session",
  "GET /auth/token",
  "POST /auth/sign-out",
]);
const AUTH_CALLBACK_ROUTES: ReadonlySet<string> = new Set([
  "GET /auth/verify-email",
  "GET /auth/magic-link/verify",
]);
const authClassOf = (method: string, path: string) =>
  AUTH_SESSION_ROUTES.has(`${method} ${path}`)
    ? ("auth_session" as const)
    : AUTH_CALLBACK_ROUTES.has(`${method} ${path}`)
      ? ("auth_callback" as const)
      : ("auth_form_proxy" as const);
const authTransportRoutes: readonly RouteRegistration[] = Object.entries(AUTH_ROUTES).map(
  ([path, method]) => ({
    method,
    path: `/auth/${path}`,
    operationId: null,
    rateLimitClass: authClassOf(method, `/auth/${path}`),
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

export interface MountedRoute {
  readonly method: string;
  readonly path: string;
}

/**
 * DEV-RLM-005: the mounted routes (`app.routes`) that have no entry in the registry. Middleware
 * (`use` with a wildcard), OPTIONS and the health endpoints are the only explicit exceptions; any
 * other mounted route that the classifier does not recognise would fall through to the unmatched
 * public_read rule and lose its own class (global / resource rules, guard).
 */
export function findUnclassifiedRoutes(
  mounted: readonly MountedRoute[],
  classify: RouteClassifier = classifyRequest,
): string[] {
  const missing: string[] = [];
  for (const route of mounted) {
    if (route.method === "ALL" && route.path.includes("*")) continue; // use(): middleware
    if (route.method === "OPTIONS") continue;
    if (isRateLimitExempt(route.method, route.path)) continue;
    if (!classify(route.method, route.path)) missing.push(`${route.method} ${route.path}`);
  }
  return missing;
}

/** Startup check: refuses an app whose mounted routes are not all in the registry. */
export function assertMountedRoutesClassified(
  mounted: readonly MountedRoute[],
  classify: RouteClassifier = classifyRequest,
): void {
  const missing = findUnclassifiedRoutes(mounted, classify);
  if (missing.length)
    throw new Error(`Routes without a rate limit class registration: ${missing.join(", ")}`);
}

/** SEC-ABU-018: the only requests that never query the store. */
export function isRateLimitExempt(method: string, path: string): boolean {
  if (method === "OPTIONS") return true;
  return (
    (method === "GET" || method === "HEAD") &&
    (path === "/internal/health/live" || path === "/internal/health/ready")
  );
}
