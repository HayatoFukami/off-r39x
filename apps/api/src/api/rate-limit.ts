// SEC-ABU-017/018/019/021/029/030, SPEC-110 §24.1: the three rate limit stages. Stage 1 (before
// authentication) and Stage 2 (after token / Webhook signature verification) run before DB access.
// Stage 3 (resource / QR digest / target) runs only after the target's authorization check
// succeeded, so an unauthorized principal never reaches a shared counter. A 429 and a 503 are
// different results and never read as one another (SEC-ABU-009).
import { randomUUID } from "node:crypto";
import { AuthFailure } from "@off-r39x/auth";
import type { RateLimitMetrics } from "@off-r39x/observability";
import {
  deriveClientIp,
  guardFor,
  isPurchaseStartOperation,
  normalizeLoginIdentifier,
  type RateLimitClassId,
  type RateLimitDecision,
  type RateLimiter,
  type RateLimitObserver,
  type ResourceInput,
  type RouteClassId,
} from "@off-r39x/security";
import type { Context, MiddlewareHandler } from "hono";
import { actorContext } from "./actor-context.ts";
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
  classId: RateLimitClassId,
  decision: Exclude<RateLimitDecision, { result: "allowed" }>,
): void {
  const logger = c.get("logger");
  if (!logger) return;
  const context = requestContext(c);
  // SPEC-160 §24.1: GUEST until the Principal is resolved, then the resolved Actor Type and Profile ref.
  const actor = actorContext(c);
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
    // SPEC-150 REL-SEC-007: a rate limit store failure is classified SECURITY_FAILURE (the HTTP
    // result stays 503 TEMPORARY_UNAVAILABLE).
    failure_class: "SECURITY_FAILURE",
  });
  failClosed(c, classId);
}
function failClosed(c: AppContext, classId?: RateLimitClassId): void {
  c.get("logger")?.log({
    event_name: "security.fail_closed.triggered",
    level: "ERROR",
    result: "FAILED",
    is_retry: false,
    ...requestContext(c),
    ...actorContext(c),
    control_category: "rate_limit",
    ...(classId ? { class_id: classId } : {}),
    error_code: "TEMPORARY_UNAVAILABLE",
    // SPEC-150 REL-SEC-007: a rate limit store failure is classified SECURITY_FAILURE (the HTTP
    // result stays 503 TEMPORARY_UNAVAILABLE).
    failure_class: "SECURITY_FAILURE",
  });
}

/** Maps a decision to the HTTP result. `store_unavailable` is a 503, never a 429 or a pass. */
export function enforceDecision(
  c: AppContext,
  classId: RateLimitClassId,
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
 * Stage 1 (SEC-ABU-017): the per-IP / global rules before anything else. `auth_form_proxy` then reads
 * its body (bounded, SEC-ABU-031) and evaluates the (IP, identifier) rule as stage 1b (SEC-ABU-024).
 * The guard counter is read, never recorded or enforced here (SEC-ABU-021 (1)). Without a configured limiter every registered route
 * fails closed (INF-HLT-004); health and preflight are never evaluated (SEC-ABU-018).
 */
export function createRateLimitStageOne(
  options: StageOneOptions,
): MiddlewareHandler<ApiEnvironment> {
  const classify = options.classify ?? classifyRequest;
  const peerOf = options.peerOf ?? peerAddress;
  const bodySlots = createBodyReadSlots();
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
    // SEC-ABU-031: every refusal of an auth_form_proxy request before its body is read closes the
    // connection, whichever check produced it.
    const closesConnection = route?.classId === "auth_form_proxy" && method === "POST";
    if (!rateLimit) {
      if (route) {
        if (closesConnection) c.header("Connection", "close");
        throw new ApiFailure("TEMPORARY_UNAVAILABLE");
      }
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
      if (closesConnection) c.header("Connection", "close");
      failClosed(c);
      throw new ApiFailure("TEMPORARY_UNAVAILABLE");
    }
    c.set("clientIp", ip);
    if (!route) {
      enforceDecision(c, "public_read", await rateLimit.limiter.unmatched(ip));
      await next();
      return;
    }
    const operationId = route.operationId ?? undefined;
    const formProxy = closesConnection;
    // SEC-ABU-031: the per-IP rule is evaluated before the body is read. A refusal answers without
    // reading the body and closes the connection.
    const stageOne = await rateLimit.limiter.preAuth({ classId: route.classId, ip, operationId });
    if (formProxy && stageOne.result !== "allowed") c.header("Connection", "close");
    enforceDecision(c, route.classId, stageOne);
    // SEC-ABU-021 (1): the guard counter is only read here. Whether this IP's failures reached the
    // limit selects the signature verification budget (SEC-ABU-033); it never refuses a request.
    const guardClass = guardFor(route.classId);
    if (guardClass) {
      const guardState = await rateLimit.limiter.guardState(route.classId, ip);
      if (guardState.result === "store_unavailable")
        enforceDecision(c, guardClass, { result: "store_unavailable" });
      else c.set("guardSaturated", guardState.saturated);
    }
    if (formProxy) {
      // SEC-ABU-031: at most 3 concurrent body reads per IP and 256 per process; over that the request
      // is refused without reading and without a store call (rule_category=concurrency).
      const release = bodySlots.acquire(ip);
      if (!release) {
        c.header("Connection", "close");
        logDecision(c, route.classId, {
          result: "rejected",
          ruleCategory: "concurrency",
          retryAfterSeconds: 1,
        });
        throw new ApiFailure("RATE_LIMIT_EXCEEDED", undefined, 1);
      }
      let loginIdentifier: string | undefined;
      try {
        loginIdentifier = await readLoginIdentifier(c.req.raw);
      } finally {
        release();
      }
      // SEC-ABU-024 stage 1b: the (source IP, identifier) pair, after the body and before the relay.
      enforceDecision(
        c,
        route.classId,
        await rateLimit.limiter.loginIdentifier({
          classId: "auth_form_proxy",
          ip,
          loginIdentifier,
          operationId,
        }),
      );
    }
    await next();
  };
}

/** SEC-ABU-031: process-local bounds on concurrent body reads (connection and memory protection). */
export const BODY_READ_SLOTS_PER_IP = 3;
export const BODY_READ_SLOTS_PER_PROCESS = 256;

export interface BodyReadSlots {
  /** Returns the release function of the slot, or undefined when a bound is reached. */
  acquire(ip: string): (() => void) | undefined;
}
export function createBodyReadSlots(
  perIp: number = BODY_READ_SLOTS_PER_IP,
  perProcess: number = BODY_READ_SLOTS_PER_PROCESS,
): BodyReadSlots {
  const byIp = new Map<string, number>();
  let total = 0;
  return {
    acquire(ip) {
      const current = byIp.get(ip) ?? 0;
      if (current >= perIp || total >= perProcess) return undefined;
      byIp.set(ip, current + 1);
      total += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        total -= 1;
        const remaining = (byIp.get(ip) ?? 1) - 1;
        if (remaining > 0) byIp.set(ip, remaining);
        else byIp.delete(ip);
      };
    },
  };
}

/** SEC-ABU-033 (b): the process-wide signature verification budget for guard-saturated IPs. */
export const VERIFICATION_BUDGET_PER_SECOND = 50;
export interface VerificationBudget {
  /** Takes one verification from the process-local token bucket; false when it is empty. */
  tryTake(): boolean;
}
export function createVerificationBudget(
  options: { readonly perSecond?: number; readonly now?: () => number } = {},
): VerificationBudget {
  const perSecond = options.perSecond ?? VERIFICATION_BUDGET_PER_SECOND;
  const now = options.now ?? (() => performance.now());
  let tokens = perSecond;
  let last = now();
  return {
    tryTake() {
      const current = now();
      if (current > last)
        tokens = Math.min(perSecond, tokens + ((current - last) * perSecond) / 1000);
      last = current;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

/** Stage 2 hooks run inside `requirePrincipal` (SEC-ABU-021, SEC-ABU-033 and the per-subject rules). */
export interface PrincipalRateLimitHooks {
  /** SEC-ABU-033 (b): called after the structure check, before the signature is verified. */
  beforeVerification(c: AppContext): Promise<void>;
  verificationFailed(c: AppContext, error: unknown): Promise<void>;
  verified(c: AppContext, identity: { readonly subject: string }): Promise<void>;
}
export function createPrincipalRateLimitHooks(
  limiter: RateLimiter,
  options: { readonly verificationBudget?: VerificationBudget } = {},
): PrincipalRateLimitHooks {
  const budget = options.verificationBudget ?? createVerificationBudget();
  const classOf = (c: AppContext): RouteClassId => {
    const classId = c.get("rateLimitClass");
    if (!classId) throw new ApiFailure("TEMPORARY_UNAVAILABLE");
    return classId;
  };
  return {
    async beforeVerification(c) {
      // An IP below its guard limit verifies on the normal budget. At the limit, the signature is
      // verified only inside the process-wide budget; an exhausted budget is a 429 (Retry-After: 1),
      // not an authentication failure, so it is not counted by the guard.
      if (c.get("guardSaturated") !== true || budget.tryTake()) return;
      logDecision(c, classOf(c), {
        result: "rejected",
        ruleCategory: "concurrency",
        retryAfterSeconds: 1,
      });
      throw new ApiFailure("RATE_LIMIT_EXCEEDED", undefined, 1);
    },
    async verificationFailed(c, error) {
      // SEC-ABU-020: only a token that failed the structure check or verification counts. An
      // unreachable auth service (`unavailable`) says nothing about the token.
      if (!(error instanceof AuthFailure) || error.kind !== "unauthenticated") return;
      const classId = classOf(c);
      const guard = guardFor(classId);
      const ip = c.get("clientIp");
      if (!ip) throw new ApiFailure("TEMPORARY_UNAVAILABLE");
      // SPEC-160 §24.1: the decision is logged under the Class ID that was evaluated (the guard's).
      enforceDecision(c, guard ?? classId, await limiter.recordAuthFailure(classId, ip));
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

/**
 * SEC-ABU-029: records that the target's authorization check (SPEC-110 §24 step 6 owner relation,
 * or step 7 Role + Capability) succeeded. `requireCapability` does it; an owner-relation check (and
 * an Operation without an owner relation, after step 6) calls it itself. Stage 3 refuses to run
 * without it, so a route can never evaluate a shared resource counter before authorization.
 */
export function markAuthorizationConfirmed(c: AppContext): void {
  c.set("authorizationConfirmed", true);
}

/**
 * Stage 3 (SEC-ABU-017 / SEC-ABU-029): resource / QR digest / target resource / target profile
 * rules. Mount it after the authorization check and before the Domain precondition and the
 * mutation. `valuesOf` runs only after authorization (the QR digest is derived from the QR token
 * only then); the key input must already be syntactically validated. A 403 / 404 ending the
 * request earlier therefore never changes a Stage 3 counter, and a 429 / 503 here stops the
 * request before the Domain precondition.
 */
export function requireResourceRateLimit(
  limiter: RateLimiter,
  valuesOf: ResourceValues,
): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    assertAuthorized(c);
    // A purchase start Operation must run its eligibility pre-check first (requirePurchaseStartRateLimit).
    if (isPurchaseStartOperation(c.get("operationId")))
      throw new Error("Purchase start Stage 3 evaluated without the eligibility pre-check");
    await evaluateResources(c, limiter, valuesOf);
    await next();
  };
}

/** Key input of Stage 3 rules; a rule may name several resources (a cart, at most 50 distinct). */
type ResourceValues = (c: AppContext) => ResourceInput["values"] | Promise<ResourceInput["values"]>;

function assertAuthorized(c: AppContext): void {
  // A route that reaches Stage 3 without an authorization check is an implementation defect;
  // it is never admitted to the shared counters (500, not a silent pass).
  if (c.get("authorizationConfirmed") !== true)
    throw new Error("Stage 3 rate limit evaluated before the authorization check");
}
async function evaluateResources(
  c: AppContext,
  limiter: RateLimiter,
  valuesOf: ResourceValues,
): Promise<void> {
  const classId = c.get("rateLimitClass");
  if (!classId) throw new ApiFailure("TEMPORARY_UNAVAILABLE");
  const operationId = c.get("operationId");
  enforceDecision(
    c,
    classId,
    await limiter.resource({
      classId,
      values: await valuesOf(c),
      ...(operationId ? { operationId } : {}),
    }),
  );
}

/**
 * Stage 3 of a purchase start Operation (SEC-ABU-029, API-RLC-006): after the authorization check, a
 * read-only eligibility pre-check (the same decision as API-PUR-ELG-001: no write, no lock) runs for
 * every target. Only when every target is purchasable is Stage 3 evaluated. Otherwise Stage 3 is
 * neither evaluated nor recorded and the request goes on to the Transaction, which returns the
 * authoritative 409 `item_failures`. Unknown references therefore never create a counter key, and an
 * unpurchasable request never consumes the shared product counter.
 */
export function requirePurchaseStartRateLimit(
  limiter: RateLimiter,
  options: {
    readonly eligibility: (c: AppContext) => boolean | Promise<boolean>;
    readonly valuesOf: ResourceValues;
  },
): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    assertAuthorized(c);
    if (!isPurchaseStartOperation(c.get("operationId")))
      throw new Error("The purchase pre-check applies to the purchase start Operations only");
    if (await options.eligibility(c)) await evaluateResources(c, limiter, options.valuesOf);
    await next();
  };
}

/**
 * Stage 2 for Webhooks (SEC-ABU-030): the class's global rule, evaluated only after the signature
 * verification succeeded and before any DB access (receipt dedupe). Mount it right after the
 * signature verification step; an invalid signature ends the request earlier and never counts.
 * The `429` carries `Retry-After`; the request does not reach the Receipt creation.
 */
export function requireWebhookGlobalRateLimit(
  limiter: RateLimiter,
): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    const classId = c.get("rateLimitClass");
    if (!classId) throw new ApiFailure("TEMPORARY_UNAVAILABLE");
    const operationId = c.get("operationId");
    enforceDecision(
      c,
      classId,
      await limiter.webhookVerified({ classId, ...(operationId ? { operationId } : {}) }),
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
