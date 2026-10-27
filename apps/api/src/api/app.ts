import { randomUUID } from "node:crypto";
import { createPublicRpc } from "@off-r39x/api-contract";
import {
  AuthFailure,
  type Capability,
  hasCapability,
  type Principal,
  type PrincipalStore,
  resolvePrincipal,
  type TokenVerifier,
} from "@off-r39x/auth";
import type { createLogger, LogEvent } from "@off-r39x/observability";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { TrieRouter } from "hono/router/trie-router";
import { secureHeaders } from "hono/secure-headers";
import { type ErrorCode, errorSchema, errorStatuses } from "./schemas/common.ts";

export type ApiEnvironment = {
  Variables: {
    requestId: string;
    principal: Principal;
    validatedJson: unknown;
    logger: ReturnType<typeof createLogger> | undefined;
  };
};
export class ApiFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly statusOverride?: 400 | 405 | 413 | 415,
  ) {
    super(code);
  }
}
export interface AppDependencies {
  webOrigin: string;
  allowedHosts?: readonly string[];
  ready: () => Promise<boolean>;
  logger?: ReturnType<typeof createLogger>;
  draining?: () => boolean;
}
function failure(
  c: import("hono").Context<ApiEnvironment>,
  code: ErrorCode,
  statusOverride?: 400 | 405 | 413 | 415,
) {
  c.header("Cache-Control", "no-store");
  const status = statusOverride ?? errorStatuses[code];
  return c.json(
    errorSchema.parse({
      error: {
        code,
        message:
          code === "RESOURCE_NOT_FOUND"
            ? "Requested resource was not found."
            : "Request could not be completed.",
        request_id: c.get("requestId"),
        retryable: status === 503 || status === 424,
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
    c.header("X-Request-Id", c.get("requestId"));
    c.header("Cache-Control", "no-store");
    await next();
    dependencies.logger?.log({
      event_name: "http.request.completed",
      level: c.res.status >= 500 ? "ERROR" : "INFO",
      result: c.res.status < 400 ? "SUCCESS" : c.res.status >= 500 ? "FAILED" : "REJECTED",
      is_retry: false,
      request_id: c.get("requestId"),
      http_method: (["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(
        c.req.method,
      )
        ? c.req.method
        : "GET") as "GET",
      http_route:
        c.req.routePath === "/internal/health/live"
          ? "/internal/health/live"
          : c.req.routePath === "/internal/health/ready"
            ? "/internal/health/ready"
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
  app.onError((error, c) => {
    if (error instanceof AuthFailure)
      dependencies.logger?.log({
        event_name: "security.fail_closed.triggered",
        level: "ERROR",
        result: "FAILED",
        is_retry: false,
        request_id: c.get("requestId"),
        error_code: error instanceof ApiFailure ? error.code : "INTERNAL_ERROR",
        failure_class:
          error.kind === "database" || error.kind === "unavailable"
            ? "TEMPORARY_FAILURE"
            : error.kind === "consistency"
              ? "CONSISTENCY_FAILURE"
              : "SECURITY_FAILURE",
      });
    if (error instanceof ApiFailure) return failure(c, error.code, error.statusOverride);
    if (error instanceof AuthFailure)
      return failure(
        c,
        (
          {
            unauthenticated: "AUTHENTICATION_REQUIRED",
            unavailable: "AUTH_SERVICE_TEMPORARY_FAILURE",
            database: "DATABASE_TEMPORARY_FAILURE",
            denied: "AUTHORIZATION_DENIED",
            consistency: "CONSISTENCY_REVIEW_REQUIRED",
            email: "EMAIL_VERIFICATION_REQUIRED",
          } as const
        )[error.kind],
      );
    return failure(c, "INTERNAL_ERROR");
  });
  app.use("/api/v1/*", async (c, next) => {
    const requestOrigin = c.req.header("Origin");
    c.header("Vary", "Origin");
    if (requestOrigin && requestOrigin !== origin) throw new ApiFailure("AUTHORIZATION_DENIED");
    if (requestOrigin === origin) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Expose-Headers", "X-Request-Id");
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
    bodyLimit({ maxSize: 65536, onError: (c) => failure(c, "MALFORMED_REQUEST", 413) }),
  );
  app.route("/", createPublicRpc());
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
    if (methods.has("GET")) methods.add("HEAD");
    if (methods.size) {
      c.header("Allow", [...methods].sort().join(", "));
      return failure(c, "MALFORMED_REQUEST", 405);
    }
    return failure(c, "RESOURCE_NOT_FOUND");
  });
  return app;
}
export function requirePrincipal(
  verifier: TokenVerifier,
  store: PrincipalStore,
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
      throw error;
    }
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
    await next();
  };
}
export interface SharedRateLimitGuard {
  assertAvailable(): Promise<void>;
  middleware: MiddlewareHandler<ApiEnvironment>;
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
export async function protectedMountGuard(
  guard: SharedRateLimitGuard | undefined,
): Promise<MiddlewareHandler<ApiEnvironment>> {
  if (!guard) throw new Error("Shared multi-instance rate limiter contract is required");
  await guard.assertAvailable();
  return guard.middleware;
}

function securityEvent(
  c: import("hono").Context<ApiEnvironment>,
  event_name: LogEvent["event_name"],
  error_code?: string,
): void {
  const principal = c.get("principal");
  c.get("logger")?.log({
    event_name,
    level: error_code ? "WARN" : "INFO",
    result: error_code ? "REJECTED" : "SUCCESS",
    is_retry: false,
    request_id: c.get("requestId"),
    actor_type: principal
      ? principal.roles.includes("ADMINISTRATOR")
        ? "ADMINISTRATOR"
        : principal.roles.includes("STAFF")
          ? "STAFF"
          : "AUTHENTICATED_USER"
      : "GUEST",
    ...(principal ? { actor_ref: principal.profileRef } : {}),
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
