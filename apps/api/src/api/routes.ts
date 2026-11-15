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

/**
 * SPEC-110 §23.1 "Canonical `/auth/*` allowlist" (15 routes: method, path, class). The table is the
 * single authority (API-RLC-004); the implementation's allowlist (`AUTH_ROUTES` + class
 * assignment) must equal it exactly. Changing it is a SPEC-110 change made together with the
 * implementation's allowlist. Google OAuth callbacks are not in it (UCR-110-002 is unresolved).
 */
export const CANONICAL_AUTH_ALLOWLIST: readonly (readonly [
  method: string,
  path: string,
  classId: RouteClassId,
])[] = Object.freeze([
  ["GET", "/auth/get-session", "auth_session"],
  ["GET", "/auth/token", "auth_session"],
  ["POST", "/auth/sign-out", "auth_session"],
  ["GET", "/auth/verify-email", "auth_callback"],
  ["GET", "/auth/magic-link/verify", "auth_callback"],
  ["POST", "/auth/sign-up/email", "auth_form_proxy"],
  ["POST", "/auth/sign-in/email", "auth_form_proxy"],
  ["POST", "/auth/sign-in/social", "auth_form_proxy"],
  ["POST", "/auth/sign-in/email-otp", "auth_form_proxy"],
  ["POST", "/auth/sign-in/magic-link", "auth_form_proxy"],
  ["POST", "/auth/send-verification-email", "auth_form_proxy"],
  ["POST", "/auth/request-password-reset", "auth_form_proxy"],
  ["POST", "/auth/reset-password", "auth_form_proxy"],
  ["POST", "/auth/email-otp/send-verification-otp", "auth_form_proxy"],
  ["POST", "/auth/email-otp/verify-email", "auth_form_proxy"],
]);

/**
 * API-RLC-004: the implementation's `/auth/*` entries (method, path, class) must equal the allowlist
 * exactly: an extra route, a missing route or a different class is an error (the service must not
 * become Ready). Operation-ID-less routes outside the table are never admitted as `auth_form_proxy`.
 */
export function assertAuthAllowlist(
  implemented: readonly { method: string; path: string; classId: string }[],
  canonical: readonly (readonly [string, string, string])[] = CANONICAL_AUTH_ALLOWLIST,
): void {
  const key = (method: string, path: string, classId: string) => `${method} ${path} ${classId}`;
  const expected = new Set(canonical.map(([m, p, c]) => key(m, p, c)));
  const actual = new Map<string, number>();
  for (const route of implemented)
    actual.set(
      key(route.method, route.path, route.classId),
      (actual.get(key(route.method, route.path, route.classId)) ?? 0) + 1,
    );
  const extra = [...actual.keys()].filter((entry) => !expected.has(entry));
  const missing = [...expected].filter((entry) => !actual.has(entry));
  const duplicated = [...actual].filter(([, count]) => count > 1).map(([entry]) => entry);
  if (extra.length || missing.length || duplicated.length)
    throw new Error(
      `/auth/* allowlist does not match SPEC-110 §23.1 (extra: ${extra.join("; ") || "none"}; missing: ${missing.join("; ") || "none"}; duplicated: ${duplicated.join("; ") || "none"})`,
    );
}

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
assertAuthAllowlist(
  ROUTES.filter((route) => route.path.startsWith("/auth/")).map((route) => ({
    method: route.method,
    path: route.path,
    classId: route.rateLimitClass,
  })),
);

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

/**
 * API-RLC-004 at app construction: the `/auth/*` routes actually mounted (OPTIONS and middleware
 * aside) are exactly the §23.1 allowlist when the auth proxy is configured, and none otherwise.
 */
export function assertMountedAuthRoutes(
  mounted: readonly MountedRoute[],
  authProxyConfigured: boolean,
  classify: RouteClassifier = classifyRequest,
): void {
  const entries = mounted
    .filter(
      (route) =>
        route.path.startsWith("/auth/") && route.method !== "OPTIONS" && route.method !== "ALL",
    )
    .map((route) => ({
      method: route.method,
      path: route.path,
      classId: classify(route.method, route.path)?.classId ?? "unregistered",
    }));
  assertAuthAllowlist(entries, authProxyConfigured ? CANONICAL_AUTH_ALLOWLIST : []);
}

/** SEC-ABU-018: the only requests that never query the store. */
export function isRateLimitExempt(method: string, path: string): boolean {
  if (method === "OPTIONS") return true;
  return (
    (method === "GET" || method === "HEAD") &&
    (path === "/internal/health/live" || path === "/internal/health/ready")
  );
}
