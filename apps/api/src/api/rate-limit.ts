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
  resourceReferencesOf,
} from "@off-r39x/security";
import type { Context, MiddlewareHandler } from "hono";
import { actorContext } from "./actor-context.ts";
import { type ApiEnvironment, ApiFailure } from "./failure.ts";
import { classifyRequest, isRateLimitExempt, type RouteClassifier } from "./routes.ts";

export interface AppRateLimit {
  readonly limiter: RateLimiter;
  /** TRUSTED_PROXY_HOPS (SEC-API-030). 0 = the direct peer is the client. */
  readonly trustedProxyHops: number;
  /**
   * SPEC-160 §24.1 / §11: the `r39x/obs/v1/auth-subject` fingerprint of a verified Auth Subject. It is
   * the `actor_ref` of a Stage 2 decision, made before the Principal (Role, Profile) is resolved.
   */
  readonly authSubjectRef: (subject: string) => string;
  /**
   * SEC-ABU-033: the process-local signature verification gate (slots and restricted lane). One gate
   * serves both Stage 1 and the Stage 2 hooks; `createApp` creates it when absent.
   */
  readonly gate?: VerificationGate;
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
/**
 * SPEC-160 §24.1: no Client IP could be derived (SEC-API-031). It is not a store decision, so it is
 * logged as a decision event under the route's class (`public_read` for an unmatched path / method)
 * and is not counted in `r39x_rate_limit_decisions_total` (it must not look like `store_unavailable`
 * and raise OBS-ALT-041 while the store is healthy). No `rule_category`.
 */
function logClientIpUnavailable(c: AppContext, classId: RateLimitClassId): void {
  c.get("logger")?.log({
    event_name: "ratelimit.decision.completed",
    level: "ERROR",
    result: "FAILED",
    is_retry: false,
    ...requestContext(c),
    ...actorContext(c),
    class_id: classId,
    error_code: "TEMPORARY_UNAVAILABLE",
    failure_class: "SECURITY_FAILURE",
  });
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
  /** SEC-ABU-033: must be the gate the Stage 2 hooks use. Defaults to a private one (stage-1-only use). */
  readonly gate?: VerificationGate;
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
  const gate = options.gate ?? options.rateLimit?.gate ?? createVerificationGate();
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
      logClientIpUnavailable(c, route?.classId ?? "public_read");
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
    try {
      // SEC-ABU-031: the per-IP rule is evaluated before the body is read. A refusal answers without
      // reading the body and closes the connection.
      const stageOne = await rateLimit.limiter.preAuth({ classId: route.classId, ip, operationId });
      if (formProxy && stageOne.result !== "allowed") c.header("Connection", "close");
      enforceDecision(c, route.classId, stageOne);
      // SEC-ABU-033 (b) / SEC-ABU-021 (1): the IP's concurrent verification slot is taken before the
      // guard counter is read, and the counter is read once. An IP without a free slot does not read
      // the counter and does not call the store: it uses the restricted lane. A saturated IP (its
      // failures reached the limit) needs no slot either. The slot is released at the end of the
      // verification or the guard evaluation, and in any case when the request ends (finally below).
      const guardClass = guardFor(route.classId);
      if (guardClass) {
        const slot = gate.acquireSlot(ip);
        if (slot) {
          c.set("verificationSlot", slot);
          const guardState = await rateLimit.limiter.guardState(route.classId, ip);
          if (guardState.result === "store_unavailable")
            enforceDecision(c, guardClass, { result: "store_unavailable" });
          else {
            c.set("guardSaturated", guardState.saturated);
            if (guardState.saturated) slot.release();
          }
        }
      }
      if (formProxy) {
        // SEC-ABU-031: at most 3 concurrent body reads per IP and 256 per process; over that the request
        // is refused without reading and without a store call (rule_category=concurrency).
        const release = bodySlots.acquire(ip);
        if (!release) {
          c.header("Connection", "close");
          enforceDecision(
            c,
            route.classId,
            rateLimit.limiter.rejectConcurrency(route.classId, operationId),
          );
          return;
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
    } finally {
      // Whatever ended the request (a refusal, an error, a disconnect), a slot is never left behind.
      c.get("verificationSlot")?.release();
    }
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

/**
 * SEC-ABU-033 / SEC-ABU-021: process-local bounds of signature verification. These are constants of
 * the contract, not runtime configuration. Each API process holds its own (per process, so the
 * environment-wide figure is the replica count times these).
 */
export const VERIFICATION_SLOTS_PER_IP = 8;
export const RESTRICTED_LANE_PER_PROCESS_PER_SECOND = 50;
export const RESTRICTED_LANE_PER_IP_PER_SECOND = 10;
export const RESTRICTED_LANE_MAX_IPS = 1024;
export const RESTRICTED_LANE_IDLE_MS = 60_000;

export interface VerificationSlot {
  /** Idempotent. */
  release(): void;
}
export interface VerificationGate {
  /** Normal lane: takes a concurrent verification slot of the IP; undefined at the limit. No wait. */
  acquireSlot(ip: string): VerificationSlot | undefined;
  /**
   * Restricted lane: takes one from the per-IP bucket and the process-wide bucket. Both must have a
   * token; an IP not yet tracked is refused when the table is full. Nothing is taken on a refusal.
   */
  takeRestricted(ip: string): boolean;
}
interface Bucket {
  tokens: number;
  last: number;
}
export function createVerificationGate(
  options: {
    readonly slotsPerIp?: number;
    readonly perProcessPerSecond?: number;
    readonly perIpPerSecond?: number;
    readonly maxIps?: number;
    readonly idleMs?: number;
    readonly now?: () => number;
  } = {},
): VerificationGate {
  const slotsPerIp = options.slotsPerIp ?? VERIFICATION_SLOTS_PER_IP;
  const processRate = options.perProcessPerSecond ?? RESTRICTED_LANE_PER_PROCESS_PER_SECOND;
  const ipRate = options.perIpPerSecond ?? RESTRICTED_LANE_PER_IP_PER_SECOND;
  const maxIps = options.maxIps ?? RESTRICTED_LANE_MAX_IPS;
  const idleMs = options.idleMs ?? RESTRICTED_LANE_IDLE_MS;
  const now = options.now ?? (() => performance.now());
  const slots = new Map<string, number>();
  const buckets = new Map<string, Bucket>();
  const processBucket: Bucket = { tokens: processRate, last: now() };
  const refill = (bucket: Bucket, rate: number, at: number): void => {
    if (at > bucket.last)
      bucket.tokens = Math.min(rate, bucket.tokens + ((at - bucket.last) * rate) / 1000);
    bucket.last = at;
  };
  return {
    acquireSlot(ip) {
      const current = slots.get(ip) ?? 0;
      if (current >= slotsPerIp) return undefined;
      slots.set(ip, current + 1);
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          const remaining = (slots.get(ip) ?? 1) - 1;
          if (remaining > 0) slots.set(ip, remaining);
          else slots.delete(ip);
        },
      };
    },
    takeRestricted(ip) {
      const at = now();
      let bucket = buckets.get(ip);
      if (!bucket) {
        if (buckets.size >= maxIps) {
          // Discard the buckets idle for 60 s; if the table is still full the new IP is refused.
          for (const [key, value] of buckets) if (at - value.last >= idleMs) buckets.delete(key);
          if (buckets.size >= maxIps) return false;
        }
        bucket = { tokens: ipRate, last: at };
        buckets.set(ip, bucket);
      } else if (at - bucket.last >= idleMs) {
        bucket.tokens = ipRate;
        bucket.last = at;
      } else refill(bucket, ipRate, at);
      refill(processBucket, processRate, at);
      if (bucket.tokens < 1 || processBucket.tokens < 1) return false;
      bucket.tokens -= 1;
      processBucket.tokens -= 1;
      return true;
    },
  };
}

/** Stage 2 hooks run inside `requirePrincipal` (SEC-ABU-021, SEC-ABU-033 and the per-subject rules). */
export interface PrincipalRateLimitHooks {
  /**
   * SEC-ABU-033: called after the structure check, before the signature is verified. Returns the
   * release function of the normal-lane slot, or undefined on the restricted lane (a refusal throws).
   */
  beforeVerification(c: AppContext): Promise<(() => void) | undefined>;
  verificationFailed(c: AppContext, error: unknown): Promise<void>;
  verified(c: AppContext, identity: { readonly subject: string }): Promise<void>;
}
export function createPrincipalRateLimitHooks(
  limiter: RateLimiter,
  options: {
    readonly gate?: VerificationGate;
    readonly authSubjectRef?: (subject: string) => string;
  } = {},
): PrincipalRateLimitHooks {
  const gate = options.gate ?? createVerificationGate();
  const classOf = (c: AppContext): RouteClassId => {
    const classId = c.get("rateLimitClass");
    if (!classId) throw new ApiFailure("TEMPORARY_UNAVAILABLE");
    return classId;
  };
  return {
    async beforeVerification(c) {
      const classId = classOf(c);
      const guard = guardFor(classId);
      if (!guard) return undefined;
      const ip = c.get("clientIp");
      if (!ip) throw new ApiFailure("TEMPORARY_UNAVAILABLE");
      // Stage 1 took the slot before the single guard read. The normal lane is: a slot is held and the
      // guard was read and was below the limit. There is no second read here (SEC-ABU-033).
      const slot = c.get("verificationSlot");
      if (slot && c.get("guardSaturated") === false) return () => slot.release();
      slot?.release();
      if (!gate.takeRestricted(ip))
        // SPEC-160 §24.1: recorded under the guard's Class ID, 429 with Retry-After 1, not counted
        // in the guard and without any signature verification.
        enforceDecision(c, guard, limiter.rejectConcurrency(guard, c.get("operationId")));
      return undefined;
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
      // SPEC-160 §24.1: a Stage 2 decision is made before the Principal is resolved; the actor is
      // AUTHENTICATED_USER with the auth-subject fingerprint, never a guessed Role or Profile ref.
      if (options.authSubjectRef) c.set("authSubjectRef", options.authSubjectRef(identity.subject));
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
 * mutation. `referencesOf` runs only after authorization (the QR digest is derived from the QR token
 * only then) and returns exactly the reference kinds that SPEC-110 API-RLC-006 / API-RLC-007 list for
 * the Operation. An Operation with no reference evaluates no resource rule (it does not even call
 * `referencesOf`). A 403 / 404 ending the request earlier never changes a Stage 3 counter, and a 429 /
 * 503 here stops the request before the Domain precondition.
 */
export function requireResourceRateLimit(
  limiter: RateLimiter,
  referencesOf: ResourceReferences,
): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    assertAuthorized(c);
    // A purchase start Operation must run its eligibility pre-check first (requirePurchaseStartRateLimit).
    if (isPurchaseStartOperation(c.get("operationId")))
      throw new Error("Purchase start Stage 3 evaluated without the eligibility pre-check");
    await evaluateResources(c, limiter, referencesOf);
    await next();
  };
}

/** Stage 3 references by kind; a kind may name several resources (a cart, at most 50 distinct). */
type ResourceReferences = (
  c: AppContext,
) => ResourceInput["references"] | Promise<ResourceInput["references"]>;

function assertAuthorized(c: AppContext): void {
  // A route that reaches Stage 3 without an authorization check is an implementation defect;
  // it is never admitted to the shared counters (500, not a silent pass).
  if (c.get("authorizationConfirmed") !== true)
    throw new Error("Stage 3 rate limit evaluated before the authorization check");
}
async function evaluateResources(
  c: AppContext,
  limiter: RateLimiter,
  referencesOf: ResourceReferences,
): Promise<void> {
  const classId = c.get("rateLimitClass");
  if (!classId) throw new ApiFailure("TEMPORARY_UNAVAILABLE");
  const operationId = c.get("operationId");
  const kinds = resourceReferencesOf(operationId);
  // API-RLC-007: an Operation absent from the tables is an implementation defect, never a silent pass.
  if (!kinds) throw new Error("Operation has no Stage 3 reference definition");
  // No reference (API-ADM-CNT-005 / 011 / 019, API-ADM-KRK-003): no resource rule is evaluated.
  if (kinds.length === 0) return;
  const references = await referencesOf(c);
  // A cart (API-PUR-CART-001) names `offering_ref` and / or `goods_ref` by the kinds of its Items: the
  // kinds given must be listed for the Operation, and at least one reference must exist.
  if (Object.keys(references).some((kind) => !kinds.includes(kind as (typeof kinds)[number])))
    throw new Error("Stage 3 references differ from the SPEC-110 API-RLC-006 / API-RLC-007 tables");
  enforceDecision(
    c,
    classId,
    await limiter.resource({
      classId,
      references,
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
    readonly referencesOf: ResourceReferences;
  },
): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    assertAuthorized(c);
    if (!isPurchaseStartOperation(c.get("operationId")))
      throw new Error("The purchase pre-check applies to the purchase start Operations only");
    if (await options.eligibility(c)) await evaluateResources(c, limiter, options.referencesOf);
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
