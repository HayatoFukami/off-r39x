import { AuthFailure, type PrincipalStore, type TokenVerifier } from "@off-r39x/auth";
import type { createLogger } from "@off-r39x/observability";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { TrieRouter } from "hono/router/trie-router";
import { secureHeaders } from "hono/secure-headers";
import { actorContext } from "./actor-context.ts";
import { AUTH_ROUTES, type AuthProxy } from "./auth-proxy.ts";
import { type ApiEnvironment, ApiFailure } from "./failure.ts";
import { operationContext, requestContextMiddleware } from "./middleware/request-context.ts";
import {
  type AppRateLimit,
  createPrincipalRateLimitHooks,
  createRateLimitStageOne,
  createVerificationGate,
} from "./rate-limit.ts";
import { errorFromException, errorResponse } from "./respond.ts";
import { assertMountedAuthRoutes, assertMountedRoutesClassified } from "./routes.ts";
import { mountRpcRoutes } from "./rpc.ts";
import type { ErrorCode } from "./schemas/common.ts";
import type { CurrentProfileStore, PublicContentStore } from "./services/index.ts";

export { type ApiEnvironment, ApiFailure } from "./failure.ts";
export { requireCapability } from "./middleware/capability.ts";
export { requirePrincipal, requireVerifiedEmail } from "./middleware/principal.ts";
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
  /**
   * INF-HLT-005: reads the readiness snapshot only. It must not run a check per request (the
   * background probe does that), so health requests cost no database or store call.
   */
  ready: () => boolean | Promise<boolean>;
  logger?: ReturnType<typeof createLogger>;
  draining?: () => boolean;
  auth?: { verifier: TokenVerifier; store: PrincipalStore };
  /** Shared rate limit (UCR-140-003). Absent => every registered route fails closed (503). */
  rateLimit?: AppRateLimit;
  authProxy?: AuthProxy;
  /** API-AUTH-002 / 004. Absent => both routes fail closed (503). */
  profiles?: CurrentProfileStore;
  /** API-PUB-001..005, 012. Absent => all six fail closed (503). */
  publicContent?: PublicContentStore;
}
const EXPOSED_HEADERS = "X-Request-Id, Retry-After";
export function createApp(dependencies: AppDependencies) {
  const origin = new URL(dependencies.webOrigin).origin;
  if (origin !== dependencies.webOrigin) throw new Error("Expected exact Web origin");
  const app = new Hono<ApiEnvironment>();
  app.use("*", requestContextMiddleware(dependencies));
  app.use("*", secureHeaders({ strictTransportSecurity: "max-age=63072000; includeSubDomains" }));
  app.use("/api/v1/*", async (c, next) => {
    if (dependencies.allowedHosts && !dependencies.allowedHosts.includes(new URL(c.req.url).host))
      return errorResponse(c, "MALFORMED_REQUEST");
    await next();
    return;
  });
  app.use("*", async (c, next) => {
    if (dependencies.draining?.()) return errorResponse(c, "TEMPORARY_UNAVAILABLE");
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
  // SEC-ABU-033: one process-local gate serves Stage 1 (slot before the guard read) and the Stage 2 hooks.
  const verificationGate = dependencies.rateLimit?.gate ?? createVerificationGate();
  app.use(
    "*",
    createRateLimitStageOne({ rateLimit: dependencies.rateLimit, gate: verificationGate }),
  );
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
    return errorFromException(c, error, authErrorCodes);
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
    bodyLimit({ maxSize: 65536, onError: (c) => errorResponse(c, "PAYLOAD_TOO_LARGE") }),
  );
  const principalHooks = dependencies.rateLimit
    ? createPrincipalRateLimitHooks(dependencies.rateLimit.limiter, {
        gate: verificationGate,
        authSubjectRef: dependencies.rateLimit.authSubjectRef,
      })
    : undefined;
  mountRpcRoutes(app, { app: dependencies, principalHooks });
  if (dependencies.authProxy) {
    for (const [path, method] of Object.entries(AUTH_ROUTES)) {
      app.on([method, "OPTIONS"], `/auth/${path}`, async (c) => {
        if (
          dependencies.allowedHosts &&
          !dependencies.allowedHosts.includes(new URL(c.req.url).host)
        )
          return errorResponse(c, "MALFORMED_REQUEST");
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
      return errorResponse(c, "METHOD_NOT_ALLOWED");
    }
    return errorResponse(c, "RESOURCE_NOT_FOUND");
  });
  // DEV-RLM-005: every mounted route must be in the rate limit registry (startup failure otherwise).
  assertMountedRoutesClassified(app.routes);
  // API-RLC-004: the mounted `/auth/*` routes equal the SPEC-110 §23.1 allowlist (method, path, class).
  assertMountedAuthRoutes(app.routes, Boolean(dependencies.authProxy));
  return app;
}
