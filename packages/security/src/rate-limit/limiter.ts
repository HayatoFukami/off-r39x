// DEV-RLM-001: rate limit decision logic (rule planning, key derivation, result mapping, Fail
// Closed handling). It never touches Redis; the store port is injected.
import { randomUUID } from "node:crypto";
import { DeadlineError, TIMEOUTS, withDeadline } from "@off-r39x/reliability";
import type { RateLimitConfig } from "./config.ts";
import { type CounterKeyFactory, createCounterKeyFactory } from "./keys.ts";
import {
  BURST_WINDOW_SECONDS,
  classDefinition,
  guardFor,
  type RateLimitClassId,
  type RouteClassId,
  type RuleCategory,
  type RuleSubject,
  SUSTAINED_WINDOW_SECONDS,
} from "./registry.ts";
import {
  type RateLimitStore,
  RateLimitStoreError,
  type StoreMode,
  type StoreOutcome,
  type StoreRule,
} from "./store.ts";

export type RateLimitDecision =
  | { readonly result: "allowed" }
  | {
      readonly result: "rejected";
      /** SEC-ABU-007: integer seconds, >= 1, the longest over all exceeded rules. */
      readonly retryAfterSeconds: number;
      readonly ruleCategory: RuleCategory;
    }
  | { readonly result: "store_unavailable" };

/** SPEC-160 §24.1 / §42. Receives no counter key, IP, Subject, Email, digest or resource value. */
export interface RateLimitObserver {
  decision(event: {
    readonly classId: RateLimitClassId;
    readonly result: RateLimitDecision["result"];
    readonly ruleCategory?: RuleCategory;
    readonly retryAfterSeconds?: number;
    readonly operationId?: string;
  }): void;
  storeOperation(event: {
    readonly result: "ok" | "timeout" | "error";
    readonly seconds: number;
  }): void;
}

export interface CircuitOptions {
  /** Consecutive store failures that open the short circuit. */
  readonly failureThreshold: number;
  /** REL-SEC-005: at most 2 seconds. */
  readonly openMs: number;
}
export const DEFAULT_CIRCUIT: CircuitOptions = Object.freeze({ failureThreshold: 3, openMs: 2000 });

export interface RateLimiterOptions {
  readonly store: RateLimitStore;
  readonly config: RateLimitConfig;
  readonly hmacKey: Uint8Array;
  readonly hmacKeyVersion: number;
  readonly observer?: RateLimitObserver;
  readonly circuit?: CircuitOptions;
  /** Monotonic milliseconds; used for the circuit only, never for window decisions (SEC-ABU-014). */
  readonly monotonicNow?: () => number;
  /** Test seam for the per-evaluation deadline. Defaults to the 250 ms of REL-SEC-003. */
  readonly deadlineMs?: number;
}

export interface PreAuthInput {
  readonly classId: RouteClassId;
  readonly ip: string;
  /** Already normalised login identifier (auth_form_proxy only). */
  readonly loginIdentifier?: string | undefined;
  readonly operationId?: string | undefined;
}
export interface SubjectInput {
  readonly classId: RouteClassId;
  readonly subject: string;
  readonly operationId?: string | undefined;
}
export interface ResourceInput {
  readonly classId: RouteClassId;
  /** Values keyed by additional rule ID of the `resource` phase. */
  readonly values: Readonly<Record<string, string>>;
  readonly operationId?: string | undefined;
}

export interface RateLimiter {
  /** Stage 1 (SEC-ABU-017): per-IP / webhook / global / identifier rules and the guard confirmation. */
  preAuth(input: PreAuthInput): Promise<RateLimitDecision>;
  /** SEC-ABU-018: unmatched path or unsupported method; public_read per-IP burst/sustained only. */
  unmatched(ip: string): Promise<RateLimitDecision>;
  /** Stage 2, after token verification: per-subject rules. */
  subject(input: SubjectInput): Promise<RateLimitDecision>;
  /** Stage 2, after input validation: resource / QR digest rules. */
  resource(input: ResourceInput): Promise<RateLimitDecision>;
  /** SEC-ABU-021 (3): record one token verification failure for the route class's guard. */
  recordAuthFailure(classId: RouteClassId, ip: string): Promise<RateLimitDecision>;
  /** INF-HLT-004. Throws unless the store is usable. */
  assertReady(): Promise<void>;
  close(): Promise<void>;
}

interface PlannedRule {
  readonly ruleId: string;
  readonly subject: RuleSubject;
  readonly value: string;
  readonly limit: number;
  readonly windowSeconds: number;
  readonly category: RuleCategory;
}

const UNAVAILABLE: RateLimitDecision = Object.freeze({ result: "store_unavailable" });
const ALLOWED: RateLimitDecision = Object.freeze({ result: "allowed" });

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const keys: CounterKeyFactory = createCounterKeyFactory(options.hmacKey, options.hmacKeyVersion);
  const circuit = options.circuit ?? DEFAULT_CIRCUIT;
  const now = options.monotonicNow ?? (() => performance.now());
  const deadlineMs = options.deadlineMs ?? TIMEOUTS.rateLimitStoreMs;
  let consecutiveFailures = 0;
  let openUntil = 0;
  let trialInFlight = false;

  const observe = (fn: () => void): void => {
    try {
      fn();
    } catch {
      /* Observation is never authority (and must not turn a decision into a different one). */
    }
  };

  const primaryRules = (
    classId: RateLimitClassId,
    subject: RuleSubject,
    value: string,
  ): PlannedRule[] => {
    const settings = options.config[classId];
    return [
      {
        ruleId: `${classId}.burst`,
        subject,
        value,
        limit: settings.burstLimit,
        windowSeconds: BURST_WINDOW_SECONDS,
        category: "burst",
      },
      {
        ruleId: `${classId}.sustained`,
        subject,
        value,
        limit: settings.sustainedLimit,
        windowSeconds: SUSTAINED_WINDOW_SECONDS,
        category: "sustained",
      },
    ];
  };

  const additionalRules = (
    classId: RateLimitClassId,
    phase: "pre_auth" | "subject" | "resource",
    resolve: (ruleId: string, subject: RuleSubject) => string | undefined,
  ): PlannedRule[] => {
    const planned: PlannedRule[] = [];
    const limits = options.config[classId].additional as Readonly<Record<string, number>>;
    for (const [ruleId, rule] of Object.entries(classDefinition(classId).additional)) {
      if (rule.phase !== phase) continue;
      const value = resolve(ruleId, rule.subject);
      if (value === undefined) continue;
      const limit = limits[ruleId];
      if (limit === undefined) throw new Error("Rate limit configuration is incomplete");
      planned.push({
        ruleId,
        subject: rule.subject,
        value,
        limit,
        windowSeconds: rule.windowSeconds,
        category: rule.category,
      });
    }
    return planned;
  };

  /** Runs one store operation under the deadline, circuit and failure mapping. Never retries. */
  async function execute(
    mode: StoreMode,
    planned: readonly PlannedRule[],
  ): Promise<StoreOutcome | undefined> {
    const clock = now();
    if (consecutiveFailures >= circuit.failureThreshold) {
      // REL-SEC-005: short circuit; the same 503, no store call. After openMs one trial is let through.
      if (clock < openUntil || trialInFlight) return undefined;
      trialInFlight = true;
    }
    const rules: StoreRule[] = planned.map((rule) => ({
      key: keys.key(rule.ruleId, rule.subject, rule.value),
      limit: rule.limit,
      windowMs: rule.windowSeconds * 1000,
    }));
    const started = now();
    try {
      const outcome = await withDeadline(
        () => options.store.evaluate(mode, rules, randomUUID()),
        deadlineMs,
      );
      if (outcome.rules.length !== rules.length) throw new RateLimitStoreError("error");
      observe(() =>
        options.observer?.storeOperation({ result: "ok", seconds: (now() - started) / 1000 }),
      );
      consecutiveFailures = 0;
      return outcome;
    } catch (error) {
      const kind: "timeout" | "error" =
        error instanceof DeadlineError ||
        (error instanceof RateLimitStoreError && error.kind === "timeout")
          ? "timeout"
          : "error";
      observe(() =>
        options.observer?.storeOperation({ result: kind, seconds: (now() - started) / 1000 }),
      );
      consecutiveFailures += 1;
      if (consecutiveFailures >= circuit.failureThreshold) openUntil = now() + circuit.openMs;
      return undefined;
    } finally {
      trialInFlight = false;
    }
  }

  const finish = (
    classId: RateLimitClassId,
    operationId: string | undefined,
    planned: readonly PlannedRule[],
    outcome: StoreOutcome | undefined,
    report = true,
  ): RateLimitDecision => {
    let decision: RateLimitDecision;
    if (!outcome) decision = UNAVAILABLE;
    else if (outcome.allowed) decision = ALLOWED;
    else {
      let longest = 0;
      let category: RuleCategory | undefined;
      outcome.rules.forEach((rule, index) => {
        if (!rule.exceeded) return;
        longest = Math.max(longest, rule.retryAfterMs);
        category ??= planned[index]?.category;
      });
      // SEC-ABU-007: round up to whole seconds, minimum 1.
      decision = {
        result: "rejected",
        retryAfterSeconds: Math.max(1, Math.ceil(longest / 1000)),
        ruleCategory: category ?? "sustained",
      };
    }
    if (report || decision.result === "store_unavailable")
      observe(() =>
        options.observer?.decision({
          classId,
          result: decision.result,
          ...(decision.result === "rejected"
            ? {
                ruleCategory: decision.ruleCategory,
                retryAfterSeconds: decision.retryAfterSeconds,
              }
            : {}),
          ...(operationId ? { operationId } : {}),
        }),
      );
    return decision;
  };

  async function evaluate(
    classId: RateLimitClassId,
    operationId: string | undefined,
    mode: "admit" | "check",
    planned: readonly PlannedRule[],
  ): Promise<RateLimitDecision> {
    if (planned.length === 0) return ALLOWED;
    return finish(classId, operationId, planned, await execute(mode, planned));
  }

  const guardRules = (guardId: RateLimitClassId, ip: string): PlannedRule[] =>
    primaryRules(guardId, "ip", ip).map((rule) => ({ ...rule, category: "guard" }));

  return Object.freeze({
    async preAuth(input: PreAuthInput): Promise<RateLimitDecision> {
      const definition = classDefinition(input.classId);
      const guard = guardFor(input.classId);
      if (guard) {
        // Check only (SEC-ABU-021 (1)); the failure is recorded after verification fails.
        const decision = await evaluate(
          guard,
          input.operationId,
          "check",
          guardRules(guard, input.ip),
        );
        if (decision.result !== "allowed") return decision;
      }
      const planned = [
        ...(definition.primary === "ip" ? primaryRules(input.classId, "ip", input.ip) : []),
        ...additionalRules(input.classId, "pre_auth", (_, subject) =>
          subject === "ip"
            ? input.ip
            : subject === "global"
              ? ""
              : subject === "identifier"
                ? input.loginIdentifier
                : undefined,
        ),
      ];
      return evaluate(input.classId, input.operationId, "admit", planned);
    },
    async unmatched(ip: string): Promise<RateLimitDecision> {
      return evaluate("public_read", undefined, "admit", primaryRules("public_read", "ip", ip));
    },
    async subject(input: SubjectInput): Promise<RateLimitDecision> {
      if (classDefinition(input.classId).primary !== "auth_subject") return ALLOWED;
      return evaluate(input.classId, input.operationId, "admit", [
        ...primaryRules(input.classId, "auth_subject", input.subject),
        ...additionalRules(input.classId, "subject", () => undefined),
      ]);
    },
    async resource(input: ResourceInput): Promise<RateLimitDecision> {
      const required = Object.entries(classDefinition(input.classId).additional).filter(
        ([, rule]) => rule.phase === "resource",
      );
      for (const [ruleId] of required)
        if (typeof input.values[ruleId] !== "string")
          throw new Error("Rate limit resource key is required");
      return evaluate(
        input.classId,
        input.operationId,
        "admit",
        additionalRules(input.classId, "resource", (ruleId) => input.values[ruleId]),
      );
    },
    async recordAuthFailure(classId: RouteClassId, ip: string): Promise<RateLimitDecision> {
      const guard = guardFor(classId);
      if (!guard) return ALLOWED;
      const planned = guardRules(guard, ip);
      // A successful record is not an evaluation outcome (SEC-ABU-021: it is not counted as a
      // decision); a failure to record is, and is never skipped.
      return finish(guard, undefined, planned, await execute("record", planned), false);
    },
    async assertReady(): Promise<void> {
      await withDeadline(() => options.store.assertReady(), deadlineMs);
    },
    close: () => options.store.close(),
  });
}
