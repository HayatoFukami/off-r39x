// SEC-ABU-017/018/019/021, SPEC-110 §24.1: Stage 1 / Stage 2 rate limit middleware. Every stage
// runs before DB access and before Role / Capability evaluation. A 429 and a 503 are different
// results and never read as one another (SEC-ABU-009).
import { randomUUID } from "node:crypto";
import { AuthFailure } from "@off-r39x/auth";
import type { RateLimitMetrics } from "@off-r39x/observability";
import {
  deriveClientIp,
  normalizeLoginIdentifier,
  type RateLimitDecision,
  type RateLimiter,
  type RateLimitObserver,
  type RouteClassId,
} from "@off-r39x/security";
import type { Context, MiddlewareHandler } from "hono";
import { type ApiEnvironment, ApiFailure } from "./failure.ts";
import { classifyRequest, isRateLimitExempt, type RouteClassifier } from "./routes.ts";

export interface AppRateLimit {
  readonly limiter: RateLimiter;
  /** TRUSTED_PROXY_HOPS (SEC-API-030). 0 = the direct peer is the client. */
  readonly trustedProxyHops: number;
}

/** Name of the forwarded header read when trusted proxies exist. External fact (SPEC-180 §17.2 #1). */
const FORWARDED_HEADER = "X-Forwarded-For";
const IDENTIFIER_BODY_LIMIT = 65536;
const IDENTIFIER_READ_DEADLINE_MS = 3000;

type AppContext = Context<ApiEnvironment>;

function peerAddress(c: AppContext): string | undefined {
  const bindings = c.env as { incoming?: { socket?: { remoteAddress?: unknown } } } | undefined;
  const address = bindings?.incoming?.socket?.remoteAddress;
  return typeof address === "string" ? address : undefined;
}

function requestContext(c: AppContext) {
  const execution = c.get("operationExecutionId");
  const operation = c.get("operationId");
  return {
    request_id: c.get("requestId"),
    ...(operation && execution
      ? { operation_id: operation, operation_execution_id: execution }
      : {}),
  };
}

/**
 * OBS-SEC-007..009: logs rejected / store_unavailable only (allowed is metric-only). The record
 * carries the class, rule category and Retry-After; never a key, IP, Subject, Email or resource.
 */
function logDecision(
  c: AppContext,
  classId: RouteClassId,
  decision: Exclude<RateLimitDecision, { result: "allowed" }>,
): void {
  const logger = c.get("logger");
  if (!logger) return;
  const context = requestContext(c);
  const actor = { actor_type: "GUEST" as const };
  if (decision.result === "rejected") {
    logger.log({
      event_name: "ratelimit.decision.completed",
      level: "WARN",
      result: "REJECTED",
      is_retry: false,
      ...context,
      ...actor,
      class_id: classId,
      rule_category: decision.ruleCategory,
      retry_after_seconds: decision.retryAfterSeconds,
      error_code: "RATE_LIMIT_EXCEEDED",
      failure_class: "SECURITY_FAILURE",
    });
    return;
  }
  logger.log({
    event_name: "ratelimit.decision.completed",
    level: "ERROR",
    result: "FAILED",
    is_retry: false,
    ...context,
    ...actor,
    class_id: classId,
    error_code: "TEMPORARY_UNAVAILABLE",
    failure_class: "TEMPORARY_FAILURE",
  });
  failClosed(c, classId);
}
function failClosed(c: AppContext, classId?: RouteClassId): void {
  c.get("logger")?.log({
    event_name: "security.fail_closed.triggered",
    level: "ERROR",
    result: "FAILED",
    is_retry: false,
    ...requestContext(c),
    actor_type: "GUEST",
    control_category: "rate_limit",
    ...(classId ? { class_id: classId } : {}),
    error_code: "TEMPORARY_UNAVAILABLE",
    failure_class: "TEMPORARY_FAILURE",
  });
}

/** Maps a decision to the HTTP result. `store_unavailable` is a 503, never a 429 or a pass. */
export function enforceDecision(
  c: AppContext,
  classId: RouteClassId,
  decision: RateLimitDecision,
): void {
  if (decision.result === "allowed") return;
  logDecision(c, classId, decision);
  if (decision.result === "rejected")
    throw new ApiFailure("RATE_LIMIT_EXCEEDED", undefined, decision.retryAfterSeconds);
  throw new ApiFailure("TEMPORARY_UNAVAILABLE");
}

/** Reads the login identifier (JSON `email`) from a clone; anything unusable yields undefined. */
async function readLoginIdentifier(request: Request): Promise<string | undefined> {
  const source = request.clone().body;
  if (!source) return undefined;
  const reader = source.getReader();
  const read = async (): Promise<string | undefined> => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > IDENTIFIER_BODY_LIMIT) return undefined;
      chunks.push(value);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    return normalizeLoginIdentifier((parsed as { email?: unknown }).email);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), IDENTIFIER_READ_DEADLINE_MS);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

export interface StageOneOptions {
  readonly rateLimit: AppRateLimit | undefined;
  readonly classify?: RouteClassifier;
  readonly peerOf?: (c: AppContext) => string | undefined;
}

/**
 * Stage 1 (SEC-ABU-017): per-IP / webhook / global / login-identifier rules and the guard check.
 * Without a configured limiter every registered route fails closed (INF-HLT-004); health and
 * preflight are never evaluated (SEC-ABU-018).
 */
export function createRateLimitStageOne(
  options: StageOneOptions,
): MiddlewareHandler<ApiEnvironment> {
  const classify = options.classify ?? classifyRequest;
  const peerOf = options.peerOf ?? peerAddress;
  return async (c, next) => {
    const method = c.req.method;
    const path = c.req.path;
    if (isRateLimitExempt(method, path)) {
      await next();
      return;
    }
    const route = classify(method, path);
    if (route) {
      c.set("rateLimitClass", route.classId);
      c.set("operationId", route.operationId ?? undefined);
      if (route.operationId) c.set("operationExecutionId", randomUUID());
    }
    const rateLimit = options.rateLimit;
    if (!rateLimit) {
      if (route) throw new ApiFailure("TEMPORARY_UNAVAILABLE");
      await next();
      return;
    }
    const ip = deriveClientIp({
      peer: peerOf(c),
      forwarded: c.req.header(FORWARDED_HEADER),
      trustedProxyHops: rateLimit.trustedProxyHops,
    });
    if (!ip) {
      // No Client IP can be derived: the per-IP rules cannot be evaluated (fail closed).
      failClosed(c);
      throw new ApiFailure("TEMPORARY_UNAVAILABLE");
    }
    c.set("clientIp", ip);
    if (!route) {
      enforceDecision(c, "public_read", await rateLimit.limiter.unmatched(ip));
      await next();
      return;
    }
    const loginIdentifier =
      route.classId === "auth_form_proxy" && method === "POST"
        ? await readLoginIdentifier(c.req.raw)
        : undefined;
    enforceDecision(
      c,
      route.classId,
      await rateLimit.limiter.preAuth({
        classId: route.classId,
        ip,
        loginIdentifier,
        operationId: route.operationId ?? undefined,
      }),
    );
    await next();
  };
}

/** Stage 2 hooks run inside `requirePrincipal` (SEC-ABU-021 (3) and the per-subject rules). */
export interface PrincipalRateLimitHooks {
  verificationFailed(c: AppContext, error: unknown): Promise<void>;
  verified(c: AppContext, identity: { readonly subject: string }): Promise<void>;
}
export function createPrincipalRateLimitHooks(limiter: RateLimiter): PrincipalRateLimitHooks {
  const classOf = (c: AppContext): RouteClassId => {
    const classId = c.get("rateLimitClass");
    if (!classId) throw new ApiFailure("TEMPORARY_UNAVAILABLE");
    return classId;
  };
  return {
    async verificationFailed(c, error) {
      // SEC-ABU-020: only a token that failed verification counts. An unreachable auth service
      // (`unavailable`) says nothing about the token.
      if (!(error instanceof AuthFailure) || error.kind !== "unauthenticated") return;
      const classId = classOf(c);
      const ip = c.get("clientIp");
      if (!ip) throw new ApiFailure("TEMPORARY_UNAVAILABLE");
      enforceDecision(c, classId, await limiter.recordAuthFailure(classId, ip));
    },
    async verified(c, identity) {
      const classId = classOf(c);
      const operationId = c.get("operationId");
      enforceDecision(
        c,
        classId,
        await limiter.subject({
          classId,
          subject: identity.subject,
          ...(operationId ? { operationId } : {}),
        }),
      );
    },
  };
}

/** Stage 2 (SEC-ABU-017): resource / QR digest rules, evaluated after input validation, before DB. */
export function requireResourceRateLimit(
  limiter: RateLimiter,
  valuesOf: (c: AppContext) => Readonly<Record<string, string>>,
): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    const classId = c.get("rateLimitClass");
    if (!classId) throw new ApiFailure("TEMPORARY_UNAVAILABLE");
    const operationId = c.get("operationId");
    enforceDecision(
      c,
      classId,
      await limiter.resource({
        classId,
        values: valuesOf(c),
        ...(operationId ? { operationId } : {}),
      }),
    );
    await next();
  };
}

/** Feeds the limiter's observations into the SPEC-160 §42 metrics (no key / IP / Subject). */
export function createRateLimitMetricsObserver(metrics: RateLimitMetrics): RateLimitObserver {
  return {
    decision: (event) => metrics.decision(event.classId, event.result),
    storeOperation: (event) => metrics.storeOperation(event.result, event.seconds),
  };
}
