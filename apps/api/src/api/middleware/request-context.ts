import { randomUUID } from "node:crypto";
import type { createLogger } from "@off-r39x/observability";
import type { Context, MiddlewareHandler } from "hono";
import { actorContext } from "../actor-context.ts";
import type { ApiEnvironment } from "../failure.ts";
import { LOGGED_ROUTE_TEMPLATES } from "../routes.ts";

export function requestContextMiddleware(dependencies: {
  readonly logger?: ReturnType<typeof createLogger> | undefined;
}): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    const started = Date.now();
    c.set("requestId", randomUUID());
    c.set("logger", dependencies.logger);
    c.set("operationExecutionId", undefined);
    c.set("operationId", undefined);
    c.set("rateLimitClass", undefined);
    c.set("clientIp", undefined);
    c.set("guardSaturated", undefined);
    c.set("verificationSlot", undefined);
    c.set("authSubjectRef", undefined);
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
      http_route: LOGGED_ROUTE_TEMPLATES.has(c.req.routePath) ? c.req.routePath : "/",
      http_status: c.res.status,
      duration_ms: Math.max(0, Date.now() - started),
    });
  };
}

export function operationContext(c: Context<ApiEnvironment>) {
  const execution = c.get("operationExecutionId");
  const operation = c.get("operationId");
  return execution && operation
    ? { operation_id: operation, operation_execution_id: execution }
    : {};
}
