import { z } from "zod";

export const EVENT_NAMES = [
  "http.request.completed",
  "auth.verification.completed",
  "authorization.decision.completed",
  "db.transaction.completed",
  "db.pool.acquire.completed",
  "db.statement.completed",
  "db.constraint_loser.completed",
  "db.availability.failed",
  "auth.email_verified_resolution.completed",
  "auth.business_profile_resolution.completed",
  "authorization.role_resolution.completed",
  "db.transaction.retry_scheduled",
  "payment.checkout.provider_call",
  "payment.confirmation.completed",
  "refund.provider_call",
  "webhook.stripe.received",
  "webhook.resend.completed",
  "ticket.issuance.completed",
  "qr.rotation.completed",
  "checkin.entry.completed",
  "karaoke.hold.completed",
  "goods.handoff.completed",
  "email.delivery.provider_call",
  "reconciliation.item.completed",
  "consistency_review.lifecycle.changed",
  "recovery.execution.completed",
  "security.fail_closed.triggered",
  "ratelimit.decision.completed",
  "observability.audit.write_failed",
  "reliability.timeout.occurred",
  "reliability.retry.scheduled",
  "reliability.retry.attempted",
  "reliability.retry.exhausted",
  "reliability.retry_budget.exhausted",
  "reliability.unknown_result.opened",
  "reliability.unknown_result.resolved",
  "reliability.stuck.detected",
  "reconciliation.run.started",
  "reconciliation.run.completed",
  "recovery.automatic.completed",
] as const;
const safe = z.string().regex(/^[A-Za-z0-9_./:-]{1,128}$/);
const optionalSafe = safe.nullable().optional();
const uuid = z.uuid().nullable().optional();
const fp = z
  .string()
  .regex(/^[0-9a-f]{32}$/)
  .nullable()
  .optional();
const context = z
  .object({
    service: z.enum(["WEB", "API", "EMAIL_WORKER", "RECONCILIATION_WORKER", "RECOVERY"]),
    environment: z.enum(["production", "staging", "development", "test"]),
    actor_type: z.enum([
      "GUEST",
      "AUTHENTICATED_USER",
      "STAFF",
      "ADMINISTRATOR",
      "SYSTEM_WORKER",
      "SCHEDULED_RECONCILIATION",
      "EXTERNAL_PROVIDER",
      "INFRASTRUCTURE_OPERATOR",
    ]),
    deployment_ref: optionalSafe,
    actor_ref: optionalSafe,
  })
  .strict();
const event = z
  .object({
    event_name: z.enum(EVENT_NAMES),
    level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]),
    result: z.enum(["SUCCESS", "REJECTED", "FAILED", "PENDING", "NOOP"]),
    is_retry: z.boolean(),
    request_id: uuid,
    operation_id: optionalSafe,
    operation_execution_id: uuid,
    target_type: optionalSafe,
    target_ref: optionalSafe,
    failure_class: z
      .enum([
        "SUCCESS",
        "TEMPORARY_FAILURE",
        "PERMANENT_FAILURE",
        "UNKNOWN_RESULT",
        "CONFLICT_LOSER",
        "CONSISTENCY_FAILURE",
        "SECURITY_FAILURE",
      ])
      .nullable()
      .optional(),
    error_code: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,95}$/)
      .nullable()
      .optional(),
    duration_ms: z.number().int().nonnegative().nullable().optional(),
    attempt_number: z.number().int().positive().nullable().optional(),
    business_cause_ref: optionalSafe,
    transport_idempotency_fp: fp,
    provider: z.enum(["STRIPE", "RESEND", "NEON_AUTH", "NEON_DB"]).nullable().optional(),
    provider_event_ref: optionalSafe,
    provider_object_ref: optionalSafe,
    provider_idempotency_fp: fp,
    correlation_key_version: z.number().int().positive().optional(),
    consistency_review_ref: uuid,
    recovery_execution_id: uuid,
    query_name: optionalSafe,
    sqlstate: z
      .string()
      .regex(/^[0-9A-Z]{5}$/)
      .optional(),
    actor_type: context.shape.actor_type.optional(),
    actor_ref: optionalSafe,
    http_method: z
      .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
      .nullable()
      .optional(),
    http_route: z
      .string()
      .regex(/^\/[A-Za-z0-9_/:{}-]{0,127}$/)
      .nullable()
      .optional(),
    http_status: z.number().int().min(100).max(599).nullable().optional(),
    // SPEC-160 §24.1 ratelimit.decision.completed / security.fail_closed.triggered
    class_id: safe.optional(),
    rule_category: z
      .enum(["burst", "sustained", "resource", "global", "guard", "concurrency"])
      .optional(),
    retry_after_seconds: z.number().int().positive().optional(),
    control_category: safe.optional(),
  })
  .strict();
export type LoggerContext = z.input<typeof context>;
export type LogEvent = z.input<typeof event>;
export type LogSink = (jsonLine: string) => void | Promise<void>;
/** Only schema-parsed fields are serialized. Sink failures never escape. */
export function createLogger(
  input: LoggerContext,
  sink: LogSink = (line) => {
    process.stdout.write(`${line}\n`);
  },
): { log(event: LogEvent): void } {
  const parsed = context.safeParse(input);
  if (!parsed.success) throw new Error("Invalid log context");
  const base = parsed.data;
  return Object.freeze({
    log(inputEvent: LogEvent) {
      const parsedEvent = event.safeParse(inputEvent);
      if (!parsedEvent.success) throw new Error("Invalid log record");
      const value = parsedEvent.data;
      if (
        value.event_name === "http.request.completed" &&
        (!value.request_id || !value.http_method || !value.http_route || !value.http_status)
      )
        throw new Error("Invalid log record");
      if (value.operation_id && !value.operation_execution_id)
        throw new Error("Invalid log record");
      if (value.is_retry && !value.attempt_number) throw new Error("Invalid log record");
      const record = Object.assign(
        { timestamp: new Date().toISOString(), schema_version: 1 },
        base,
        value,
      );
      try {
        const result = sink(JSON.stringify(record));
        if (result) void Promise.resolve(result).catch(() => {});
      } catch {
        /* Logging is not business authority. */
      }
    },
  });
}

// SPEC-160 §24.1 / §42 / §47 (OBS-SEC-007..009, OBS-ALT-041..043): rate limit metrics and the alert
// rules. Nothing here accepts a counter key, IP, Subject, Email, QR digest or resource reference:
// the only inputs are the bounded Class ID registry values and the three result enums.

export const RATE_LIMIT_DECISION_RESULTS = ["allowed", "rejected", "store_unavailable"] as const;
export const RATE_LIMIT_STORE_RESULTS = ["ok", "timeout", "error"] as const;
export type RateLimitDecisionResult = (typeof RATE_LIMIT_DECISION_RESULTS)[number];
export type RateLimitStoreResult = (typeof RATE_LIMIT_STORE_RESULTS)[number];

/**
 * `r39x_rate_limit_store_duration_seconds` buckets. SPEC-160 §41 defines none for this metric
 * (reported as a gap); the choice keeps every bucket within the 250 ms store deadline.
 */
export const RATE_LIMIT_STORE_BUCKETS = Object.freeze([
  0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25,
]);

export interface RateLimitMetricsSnapshot {
  readonly decisions: readonly {
    readonly environment: string;
    readonly class_id: string;
    readonly result: RateLimitDecisionResult;
    readonly value: number;
  }[];
  readonly storeDuration: readonly {
    readonly environment: string;
    readonly result: RateLimitStoreResult;
    readonly count: number;
    readonly sum: number;
    readonly buckets: readonly { readonly le: number; readonly count: number }[];
  }[];
  /**
   * `r39x_rate_limit_store_ready`: one series per environment, absent until the first probe result
   * (OBS-MET-002: an unknown value is never published as 0).
   */
  readonly storeReady: readonly { readonly environment: string; readonly value: 0 | 1 }[];
}
export interface RateLimitMetrics {
  /** `r39x_rate_limit_decisions_total{environment,class_id,result}` */
  decision(classId: string, result: RateLimitDecisionResult): void;
  /** `r39x_rate_limit_store_duration_seconds{environment,result}` */
  storeOperation(result: RateLimitStoreResult, seconds: number): void;
  /** `r39x_rate_limit_store_ready{environment}` Gauge 0/1: the independent store probe (INF-HLT-004). */
  storeReady(ready: boolean): void;
  snapshot(): RateLimitMetricsSnapshot;
}

/** In-process registry; labels outside the bounded sets are refused (OBS-MET-001). */
export function createRateLimitMetrics(options: {
  readonly environment: "production" | "staging" | "development" | "test";
  readonly classIds: readonly string[];
}): RateLimitMetrics {
  const classes = new Set(options.classIds);
  const decisions = new Map<string, number>();
  let ready: 0 | 1 | undefined;
  const durations = new Map<RateLimitStoreResult, { count: number; sum: number; counts: number[] }>(
    RATE_LIMIT_STORE_RESULTS.map((result) => [
      result,
      { count: 0, sum: 0, counts: RATE_LIMIT_STORE_BUCKETS.map(() => 0) },
    ]),
  );
  return Object.freeze({
    decision(classId: string, result: RateLimitDecisionResult) {
      if (!classes.has(classId) || !RATE_LIMIT_DECISION_RESULTS.includes(result))
        throw new Error("Invalid metric label");
      const key = `${classId}\0${result}`;
      decisions.set(key, (decisions.get(key) ?? 0) + 1);
    },
    storeOperation(result: RateLimitStoreResult, seconds: number) {
      const series = durations.get(result);
      if (!series || !Number.isFinite(seconds) || seconds < 0)
        throw new Error("Invalid metric label");
      series.count += 1;
      series.sum += seconds;
      RATE_LIMIT_STORE_BUCKETS.forEach((bound, index) => {
        if (seconds <= bound) series.counts[index] = (series.counts[index] ?? 0) + 1;
      });
    },
    storeReady(value: boolean) {
      ready = value ? 1 : 0;
    },
    snapshot(): RateLimitMetricsSnapshot {
      return {
        decisions: [...decisions].map(([key, value]) => {
          const [class_id = "", result = "allowed"] = key.split("\0");
          return {
            environment: options.environment,
            class_id,
            result: result as RateLimitDecisionResult,
            value,
          };
        }),
        storeDuration: [...durations].map(([result, series]) => ({
          environment: options.environment,
          result,
          count: series.count,
          sum: series.sum,
          buckets: RATE_LIMIT_STORE_BUCKETS.map((le, index) => ({
            le,
            count: series.counts[index] ?? 0,
          })),
        })),
        storeReady: ready === undefined ? [] : [{ environment: options.environment, value: ready }],
      };
    },
  });
}

/**
 * `OBS-ALT-041` Rate-limit store unavailable: `store_unavailable` decisions >= 1 in 1 minute with no
 * minimum request count (OBS-ALT-043), HIGH Security. The first `store_unavailable` opens the
 * alert; later ones are deduplicated (§46.1), never one notification per request.
 */
export const RATE_LIMIT_STORE_UNAVAILABLE_ALERT = Object.freeze({
  ruleId: "OBS-ALT-041",
  threshold: 1,
  windowMs: 60_000,
  severity: "HIGH",
  category: "Security",
  /** SPEC-160 §46.1: HIGH repeats at most every 4 hours while unresolved. */
  repeatMs: 4 * 60 * 60 * 1000,
});

/**
 * `OBS-ALT-042` Rate-limit store readiness failure: `r39x_rate_limit_store_ready` = 0 on 2
 * consecutive 1-minute evaluations, CRITICAL Security. Independent of request volume.
 */
export const RATE_LIMIT_STORE_READINESS_ALERT = Object.freeze({
  ruleId: "OBS-ALT-042",
  consecutiveEvaluations: 2,
  evaluationMs: 60_000,
  windowMs: 60_000,
  severity: "CRITICAL",
  category: "Security",
  /** SPEC-160 §46.1: CRITICAL repeats at most every 60 minutes while unresolved. */
  repeatMs: 60 * 60 * 1000,
});

export interface AlertState {
  readonly open: boolean;
  readonly lastNotifiedMs: number | undefined;
  /** Start of the continuous period in which the condition has been false. */
  readonly clearSinceMs: number | undefined;
  /** Consecutive evaluations in which the raw signal was bad (rules with a consecutive condition). */
  readonly streak: number;
}
export const ALERT_INITIAL_STATE: AlertState = Object.freeze({
  open: false,
  lastNotifiedMs: undefined,
  clearSinceMs: undefined,
  streak: 0,
});
export interface AlertEvaluation {
  readonly firing: boolean;
  readonly notification: "open" | "repeat" | "resolve" | null;
  /** `environment + alert_rule_id` (no bounded dimension for these rules). */
  readonly dedupeKey: string;
  readonly state: AlertState;
}

/** SPEC-160 §46.1 dedupe / cooldown shared by the rate limit rules. */
function advanceAlert(
  rule: { readonly windowMs: number; readonly repeatMs: number },
  dedupeKey: string,
  firing: boolean,
  nowMs: number,
  state: AlertState,
  streak: number,
): AlertEvaluation {
  if (firing) {
    if (!state.open)
      return {
        firing,
        notification: "open",
        dedupeKey,
        state: { open: true, lastNotifiedMs: nowMs, clearSinceMs: undefined, streak },
      };
    const due = (state.lastNotifiedMs ?? 0) + rule.repeatMs <= nowMs;
    return {
      firing,
      notification: due ? "repeat" : null,
      dedupeKey,
      state: {
        open: true,
        lastNotifiedMs: due ? nowMs : state.lastNotifiedMs,
        clearSinceMs: undefined,
        streak,
      },
    };
  }
  if (!state.open) return { firing, notification: null, dedupeKey, state: { ...state, streak } };
  const clearSince = state.clearSinceMs ?? nowMs;
  if (nowMs - clearSince >= rule.windowMs)
    return { firing, notification: "resolve", dedupeKey, state: ALERT_INITIAL_STATE };
  return {
    firing,
    notification: null,
    dedupeKey,
    state: { ...state, clearSinceMs: clearSince, streak },
  };
}

/**
 * Evaluates OBS-ALT-041 at `nowMs` over `storeUnavailableAtMs` (timestamps of store_unavailable
 * decisions). One decision in the last minute fires; one notification opens the alert (never one
 * per request); resolve needs one full window without the condition (§46.1). Pure: the caller keeps
 * `state`.
 */
export function evaluateRateLimitStoreUnavailableAlert(input: {
  readonly environment: string;
  readonly storeUnavailableAtMs: readonly number[];
  readonly nowMs: number;
  readonly state?: AlertState;
}): AlertEvaluation {
  const rule = RATE_LIMIT_STORE_UNAVAILABLE_ALERT;
  const inWindow = input.storeUnavailableAtMs.filter(
    (at) => at > input.nowMs - rule.windowMs && at <= input.nowMs,
  ).length;
  return advanceAlert(
    rule,
    `${input.environment}:${rule.ruleId}`,
    inWindow >= rule.threshold,
    input.nowMs,
    input.state ?? ALERT_INITIAL_STATE,
    0,
  );
}

/**
 * Evaluates OBS-ALT-042; call it once per 1-minute evaluation with the latest
 * `r39x_rate_limit_store_ready` sample (`undefined` = no sample, which says nothing: the streak and
 * the alert are left as they are, and it is never read as 0, OBS-MET-002). Two consecutive
 * evaluations with value 0 fire, whatever the request volume. Pure: the caller keeps `state`.
 */
export function evaluateRateLimitStoreReadinessAlert(input: {
  readonly environment: string;
  readonly ready: 0 | 1 | undefined;
  readonly nowMs: number;
  readonly state?: AlertState;
}): AlertEvaluation {
  const rule = RATE_LIMIT_STORE_READINESS_ALERT;
  const state = input.state ?? ALERT_INITIAL_STATE;
  const dedupeKey = `${input.environment}:${rule.ruleId}`;
  if (input.ready === undefined)
    return {
      firing: state.streak >= rule.consecutiveEvaluations,
      notification: null,
      dedupeKey,
      state,
    };
  const streak = input.ready === 0 ? state.streak + 1 : 0;
  return advanceAlert(
    rule,
    dedupeKey,
    streak >= rule.consecutiveEvaluations,
    input.nowMs,
    state,
    streak,
  );
}

/**
 * Why a readiness evaluation failed. `security_configuration` is the OBS-ALT-014 population
 * (security config / Secret / key invalid); `rate_limit_store_unreachable` is a runtime
 * reachability failure of the store, which `OBS-ALT-041` / `OBS-ALT-042` cover and which
 * OBS-ALT-014 must not be read as (OBS-ALT-043).
 */
export type ReadinessFailureReason =
  | "security_configuration"
  | "rate_limit_store_unreachable"
  | "other";

/** `OBS-ALT-014` Security configuration invalid: Production not Ready due to required security config / Secret / key failure, 1 readiness evaluation, CRITICAL. */
export const SECURITY_CONFIGURATION_ALERT = Object.freeze({
  ruleId: "OBS-ALT-014",
  windowMs: 60_000,
  severity: "CRITICAL",
  category: "Security",
  repeatMs: 60 * 60 * 1000,
});

export function evaluateSecurityConfigurationAlert(input: {
  readonly environment: string;
  readonly failureReasons: readonly ReadinessFailureReason[];
  readonly nowMs: number;
  readonly state?: AlertState;
}): AlertEvaluation {
  const rule = SECURITY_CONFIGURATION_ALERT;
  return advanceAlert(
    rule,
    `${input.environment}:${rule.ruleId}`,
    input.environment === "production" && input.failureReasons.includes("security_configuration"),
    input.nowMs,
    input.state ?? ALERT_INITIAL_STATE,
    0,
  );
}
