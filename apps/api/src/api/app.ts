import { randomUUID } from "node:crypto";
import { createPublicRpc } from "@off-r39x/api-contract";
import {
  AuthFailure,
  type Capability,
  capabilities,
  hasCapability,
  type PrincipalStore,
  resolvePrincipal,
  type TokenVerifier,
} from "@off-r39x/auth";
import type { createLogger, LogEvent } from "@off-r39x/observability";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { TrieRouter } from "hono/router/trie-router";
import { secureHeaders } from "hono/secure-headers";
import { AUTH_ROUTES, type AuthProxy } from "./auth-proxy.ts";
import { type ApiEnvironment, ApiFailure } from "./failure.ts";
import {
  type AppRateLimit,
  createPrincipalRateLimitHooks,
  createRateLimitStageOne,
  markAuthorizationConfirmed,
  type PrincipalRateLimitHooks,
} from "./rate-limit.ts";
import { assertMountedAuthRoutes, assertMountedRoutesClassified } from "./routes.ts";
import { type ErrorCode, errorSchema, errorStatuses } from "./schemas/common.ts";

export { type ApiEnvironment, ApiFailure } from "./failure.ts";
export type { AppRateLimit } from "./rate-limit.ts";

const authErrorCodes = {
  unauthenticated: "AUTHENTICATION_REQUIRED",
  unavailable: "AUTH_SERVICE_TEMPORARY_FAILURE",
  database: "DATABASE_TEMPORARY_FAILURE",
  denied: "AUTHORIZATION_DENIED",
  consistency: "CONSISTENCY_REVIEW_REQUIRED",
  email: "EMAIL_VERIFICATION_REQUIRED",
} as const satisfies Record<AuthFailure["kind"], ErrorCode>;
export interface AppDependencies {
  webOrigin: string;
  allowedHosts?: readonly string[];
  ready: () => Promise<boolean>;
  logger?: ReturnType<typeof createLogger>;
  draining?: () => boolean;
  auth?: { verifier: TokenVerifier; store: PrincipalStore };
  /** Shared rate limit (UCR-140-003). Absent => every registered route fails closed (503). */
  rateLimit?: AppRateLimit;
  authProxy?: AuthProxy;
}
const EXPOSED_HEADERS = "X-Request-Id, Retry-After";
function failure(
  c: import("hono").Context<ApiEnvironment>,
  code: ErrorCode,
  statusOverride?: 400 | 405 | 413 | 415,
  retryAfterSeconds?: number,
) {
  c.header("Cache-Control", "no-store");
  const status = statusOverride ?? errorStatuses[code];
  // SEC-ABU-007: a 429 always carries an integer-second Retry-After (min 1).
  if (code === "RATE_LIMIT_EXCEEDED")
    c.header("Retry-After", String(Math.max(1, retryAfterSeconds ?? 1)));
  return c.json(
    errorSchema.parse({
      error: {
        code,
        message:
          code === "RESOURCE_NOT_FOUND"
            ? "Requested resource was not found."
            : "Request could not be completed.",
        request_id: c.get("requestId"),
        retryable: status === 503 || status === 424 || status === 429,
        details: null,
      },
    }),
    status,
  );
}
export function createApp(dependencies: AppDependencies) {
  const origin = new URL(dependencies.webOrigin).origin;
  if (origin !== dependencies.webOrigin) throw new Error("Expected exact Web origin");
  const app = new Hono<ApiEnvironment>();
  app.use("*", async (c, next) => {
    const started = Date.now();
    c.set("requestId", randomUUID());
    c.set("logger", dependencies.logger);
    c.set("operationExecutionId", undefined);
    c.set("operationId", undefined);
    c.set("rateLimitClass", undefined);
    c.set("clientIp", undefined);
    c.set("authorizationConfirmed", false);
    c.header("X-Request-Id", c.get("requestId"));
    c.header("Cache-Control", "no-store");
    await next();
    dependencies.logger?.log({
      event_name: "http.request.completed",
      level: c.res.status >= 500 ? "ERROR" : "INFO",
      result: c.res.status < 400 ? "SUCCESS" : c.res.status >= 500 ? "FAILED" : "REJECTED",
      is_retry: false,
      request_id: c.get("requestId"),
      ...operationContext(c),
      ...actorContext(c),
      http_method: (["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(
        c.req.method,
      )
        ? c.req.method
        : "GET") as "GET",
      http_route: [
        "/internal/health/live",
        "/internal/health/ready",
        "/api/v1/self/principal",
        ...Object.keys(AUTH_ROUTES).map((path) => `/auth/${path}`),
      ].includes(c.req.routePath)
        ? c.req.routePath
        : "/",
      http_status: c.res.status,
      duration_ms: Math.max(0, Date.now() - started),
    });
  });
  app.use("*", secureHeaders({ strictTransportSecurity: "max-age=63072000; includeSubDomains" }));
  app.use("/api/v1/*", async (c, next) => {
    if (dependencies.allowedHosts && !dependencies.allowedHosts.includes(new URL(c.req.url).host))
      return failure(c, "MALFORMED_REQUEST");
    await next();
    return;
  });
  app.use("*", async (c, next) => {
    if (dependencies.draining?.()) return failure(c, "TEMPORARY_UNAVAILABLE");
    await next();
    return;
  });
  // A 429 / 503 produced by Stage 1 precedes the CORS middleware below, but the Web origin must
  // still be able to read it (including Retry-After). Only the exact Web origin is ever echoed.
  // SEC-ABU-025. `/api/v1/*` never gets Access-Control-Allow-Credentials (SEC-API-007); the auth
  // proxy already answers its own credentialed CORS on `/auth/*`, so a Stage 1 answer there matches it.
  app.use("/api/v1/*", async (c, next) => {
    if (c.req.header("Origin") === origin) {
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Expose-Headers", EXPOSED_HEADERS);
    }
    await next();
  });
  app.use("/auth/*", async (c, next) => {
    if (c.req.header("Origin") === origin) {
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Allow-Credentials", "true");
      c.header("Access-Control-Expose-Headers", EXPOSED_HEADERS);
    }
    await next();
  });
  // Stage 1 (SEC-ABU-017): after the drain check, before any origin/CORS/body/auth/DB work.
  app.use("*", createRateLimitStageOne({ rateLimit: dependencies.rateLimit }));
  app.onError((error, c) => {
    if (error instanceof AuthFailure)
      dependencies.logger?.log({
        event_name: "security.fail_closed.triggered",
        level: "ERROR",
        result: "FAILED",
        is_retry: false,
        request_id: c.get("requestId"),
        ...operationContext(c),
        ...actorContext(c),
        error_code: authErrorCodes[error.kind],
        failure_class:
          error.kind === "database" || error.kind === "unavailable"
            ? "TEMPORARY_FAILURE"
            : error.kind === "consistency"
              ? "CONSISTENCY_FAILURE"
              : "SECURITY_FAILURE",
      });
    if (error instanceof ApiFailure)
      return failure(c, error.code, error.statusOverride, error.retryAfterSeconds);
    if (error instanceof AuthFailure) return failure(c, authErrorCodes[error.kind]);
    return failure(c, "INTERNAL_ERROR");
  });
  app.use("/api/v1/*", async (c, next) => {
    const requestOrigin = c.req.header("Origin");
    c.header("Vary", "Origin");
    if (requestOrigin && requestOrigin !== origin) throw new ApiFailure("AUTHORIZATION_DENIED");
    if (requestOrigin === origin) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Expose-Headers", EXPOSED_HEADERS);
    }
    if (c.req.method === "OPTIONS") {
      const method = c.req.header("Access-Control-Request-Method") ?? "";
      const headers = (c.req.header("Access-Control-Request-Headers") ?? "")
        .toLowerCase()
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (
        requestOrigin !== origin ||
        !["GET", "HEAD", "POST", "PATCH", "DELETE"].includes(method) ||
        headers.some(
          (h) => !["authorization", "content-type", "idempotency-key", "x-request-id"].includes(h),
        )
      )
        throw new ApiFailure("AUTHORIZATION_DENIED");
      c.header("Access-Control-Allow-Methods", "GET, HEAD, POST, PATCH, DELETE");
      c.header(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, Idempotency-Key, X-Request-Id",
      );
      return c.body(null, 204);
    }
    if (!["GET", "HEAD"].includes(c.req.method)) {
      if (
        requestOrigin !== origin ||
        (c.req.header("Sec-Fetch-Site") &&
          !["same-origin", "same-site"].includes(c.req.header("Sec-Fetch-Site") as string))
      )
        throw new ApiFailure("AUTHORIZATION_DENIED");
    }
    await next();
    return;
  });
  app.use(
    "/api/v1/*",
    bodyLimit({ maxSize: 65536, onError: (c) => failure(c, "PAYLOAD_TOO_LARGE") }),
  );
  const principalHooks = dependencies.rateLimit
    ? createPrincipalRateLimitHooks(dependencies.rateLimit.limiter)
    : undefined;
  app.route(
    "/",
    createPublicRpc<ApiEnvironment>({
      guard: async (c, next) => {
        if (!dependencies.auth || !principalHooks) throw new ApiFailure("TEMPORARY_UNAVAILABLE");
        await requirePrincipal(
          dependencies.auth.verifier,
          dependencies.auth.store,
          principalHooks,
        )(c, async () => {
          await requireVerifiedEmail()(c, next);
        });
      },
      principal: (c) => {
        const principal = c.get("principal");
        return {
          profile_ref: principal.profileRef,
          capabilities: capabilities.filter((capability) => hasCapability(principal, capability)),
          has_staff_role: principal.roles.includes("STAFF"),
          has_administrator_role: principal.roles.includes("ADMINISTRATOR"),
        };
      },
      requestId: (c) => c.get("requestId"),
    }),
  );
  if (dependencies.authProxy) {
    for (const [path, method] of Object.entries(AUTH_ROUTES)) {
      app.on([method, "OPTIONS"], `/auth/${path}`, async (c) => {
        if (
          dependencies.allowedHosts &&
          !dependencies.allowedHosts.includes(new URL(c.req.url).host)
        )
          return failure(c, "MALFORMED_REQUEST");
        const proxy = dependencies.authProxy;
        if (!proxy) throw new ApiFailure("TEMPORARY_UNAVAILABLE");
        // Stage 1 already ran (and failed closed without a limiter) before this handler.
        return proxy.handle(c.req.raw);
      });
    }
  }
  app.get("/internal/health/live", (c) => c.json({ status: "ok" }));
  app.get("/internal/health/ready", async (c) => {
    try {
      if (await dependencies.ready()) return c.json({ status: "ok" });
    } catch {
      /* generic dependency failure */
    }
    return c.json({ status: "unavailable" }, 503);
  });
  app.notFound((c) => {
    // Middleware wildcards do not establish an endpoint. Reuse Hono's path
    // matching so parameterized routes have the same 405 semantics as literals.
    const paths = new TrieRouter<string>();
    for (const route of app.routes)
      if (route.method !== "ALL") paths.add("ALL", route.path, route.method);
    const methods = new Set(paths.match("ALL", c.req.path)[0].map(([method]) => method));
    if (methods.has("GET") && !c.req.path.startsWith("/auth/")) methods.add("HEAD");
    if (methods.size) {
      c.header("Allow", [...methods].sort().join(", "));
      return failure(c, "MALFORMED_REQUEST", 405);
    }
    return failure(c, "RESOURCE_NOT_FOUND");
  });
  // DEV-RLM-005: every mounted route must be in the rate limit registry (startup failure otherwise).
  assertMountedRoutesClassified(app.routes);
  // API-RLC-004: the mounted `/auth/*` routes equal the SPEC-110 §23.1 allowlist (method, path, class).
  assertMountedAuthRoutes(app.routes, Boolean(dependencies.authProxy));
  return app;
}
export function requirePrincipal(
  verifier: TokenVerifier,
  store: PrincipalStore,
  hooks?: PrincipalRateLimitHooks,
): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    let identity: Awaited<ReturnType<TokenVerifier["verify"]>>;
    try {
      const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
        c.req.header("Authorization") ?? "",
      );
      if (!match?.[1]) throw new AuthFailure("unauthenticated");
      identity = await verifier.verify(match[1]);
      securityEvent(c, "auth.verification.completed");
    } catch (error) {
      securityEvent(
        c,
        "auth.verification.completed",
        error instanceof AuthFailure && error.kind === "unavailable"
          ? "AUTH_SERVICE_UNAVAILABLE"
          : "AUTHENTICATION_REQUIRED",
      );
      // SEC-ABU-021 (3): record the failed verification for the Authentication-failure guard.
      await hooks?.verificationFailed(c, error);
      throw error;
    }
    // Stage 2 (SEC-ABU-017): per-subject rules, before the DB-backed Principal resolution.
    await hooks?.verified(c, identity);
    try {
      c.set("principal", await resolvePrincipal(identity, store));
      securityEvent(c, "auth.business_profile_resolution.completed");
      securityEvent(c, "authorization.role_resolution.completed");
    } catch (error) {
      const kind = error instanceof AuthFailure ? error.kind : "database";
      securityEvent(
        c,
        "auth.business_profile_resolution.completed",
        kind === "consistency"
          ? "BUSINESS_PROFILE_INCONSISTENT"
          : kind === "database"
            ? "ROLE_RESOLUTION_UNAVAILABLE"
            : "BUSINESS_PROFILE_UNRESOLVED",
      );
      throw error;
    }
    await next();
  };
}
export function requireCapability(capability: Capability): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    if (!c.get("principal") || !hasCapability(c.get("principal"), capability)) {
      securityEvent(c, "authorization.decision.completed", "CAPABILITY_DENIED");
      throw new AuthFailure("denied");
    }
    securityEvent(c, "authorization.decision.completed");
    // SEC-ABU-029: Role + Capability passed (step 7); Stage 3 resource rules may now be evaluated.
    markAuthorizationConfirmed(c);
    await next();
  };
}
export function requireVerifiedEmail(): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    if (!c.get("principal")) throw new AuthFailure("unauthenticated");
    if (!c.get("principal").emailVerified) {
      securityEvent(c, "auth.email_verified_resolution.completed", "EMAIL_VERIFICATION_REQUIRED");
      throw new AuthFailure("email");
    }
    securityEvent(c, "auth.email_verified_resolution.completed");
    await next();
  };
}

function securityEvent(
  c: import("hono").Context<ApiEnvironment>,
  event_name: LogEvent["event_name"],
  error_code?: string,
): void {
  c.get("logger")?.log({
    event_name,
    level: error_code ? "WARN" : "INFO",
    result: error_code ? "REJECTED" : "SUCCESS",
    is_retry: false,
    request_id: c.get("requestId"),
    ...operationContext(c),
    ...actorContext(c),
    ...(error_code
      ? {
          error_code,
          failure_class: error_code.endsWith("UNAVAILABLE")
            ? "TEMPORARY_FAILURE"
            : "SECURITY_FAILURE",
        }
      : {}),
  });
}

function operationContext(c: import("hono").Context<ApiEnvironment>) {
  const execution = c.get("operationExecutionId");
  const operation = c.get("operationId");
  return execution && operation
    ? { operation_id: operation, operation_execution_id: execution }
    : {};
}

function actorContext(c: import("hono").Context<ApiEnvironment>): {
  actor_type: NonNullable<LogEvent["actor_type"]>;
  actor_ref?: string;
} {
  const principal = c.get("principal");
  return principal
    ? {
        actor_type: principal.roles.includes("ADMINISTRATOR")
          ? "ADMINISTRATOR"
          : principal.roles.includes("STAFF")
            ? "STAFF"
            : "AUTHENTICATED_USER",
        actor_ref: principal.profileRef,
      }
    : { actor_type: "GUEST" };
}
