import { describe, expect, it } from "vitest";
import {
  ALERT_INITIAL_STATE,
  createLogger,
  createRateLimitMetrics,
  evaluateRateLimitStoreReadinessAlert,
  evaluateRateLimitStoreUnavailableAlert,
  evaluateSecurityConfigurationAlert,
  RATE_LIMIT_STORE_BUCKETS,
  RATE_LIMIT_STORE_READINESS_ALERT,
  RATE_LIMIT_STORE_UNAVAILABLE_ALERT,
} from "../../packages/observability/src/index.ts";
import { RATE_LIMIT_CLASS_IDS } from "../../packages/security/src/index.ts";

const metrics = () =>
  createRateLimitMetrics({ environment: "test", classIds: RATE_LIMIT_CLASS_IDS });

describe("rate limit metrics (OBS-SEC-007..009, SPEC-160 §40/§42)", () => {
  it("TC-RLM-009-101 r39x_rate_limit_decisions_total counts every result with only environment, class_id and result labels", () => {
    const m = metrics();
    m.decision("self_read", "allowed");
    m.decision("self_read", "allowed");
    m.decision("self_read", "rejected");
    m.decision("public_read", "store_unavailable");
    const { decisions } = m.snapshot();
    expect(decisions).toHaveLength(3);
    expect(decisions.find((d) => d.class_id === "self_read" && d.result === "allowed")?.value).toBe(
      2,
    );
    for (const series of decisions) {
      expect(Object.keys(series).sort()).toEqual(["class_id", "environment", "result", "value"]);
      expect(series.environment).toBe("test");
    }
  });

  it("TC-RLM-009-109 labels outside the bounded sets are refused, so a key, IP or Subject can never become a label", () => {
    const m = metrics();
    for (const bad of [
      "203.0.113.9",
      "rl:v1:self_read.burst:abcd",
      "aef69f82-c9b7-4fd1-9a6f-126f5748e9ae",
      "",
    ])
      expect(() => m.decision(bad, "allowed")).toThrow();
    // @ts-expect-error the result is a closed set
    expect(() => m.decision("self_read", "allowed-ish")).toThrow();
    // @ts-expect-error the result is a closed set
    expect(() => m.storeOperation("203.0.113.9", 0.01)).toThrow();
    expect(() => m.storeOperation("ok", -1)).toThrow();
    expect(() => m.storeOperation("ok", Number.NaN)).toThrow();
    expect(m.snapshot().decisions).toEqual([]);
  });

  it("TC-RLM-009-110 r39x_rate_limit_store_duration_seconds is a histogram bounded by the 250 ms store deadline", () => {
    // SPEC-160 §41 fixes the eight boundaries (seconds).
    expect([...RATE_LIMIT_STORE_BUCKETS]).toEqual([
      0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25,
    ]);
    expect(Math.max(...RATE_LIMIT_STORE_BUCKETS)).toBeLessThanOrEqual(0.25);
    expect([...RATE_LIMIT_STORE_BUCKETS]).toEqual(
      [...RATE_LIMIT_STORE_BUCKETS].sort((a, b) => a - b),
    );
    const m = metrics();
    m.storeOperation("ok", 0.004);
    m.storeOperation("ok", 0.2);
    m.storeOperation("timeout", 0.25);
    const { storeDuration } = m.snapshot();
    const ok = storeDuration.find((s) => s.result === "ok");
    expect(ok).toMatchObject({ count: 2 });
    expect(ok?.sum).toBeCloseTo(0.204);
    expect(ok?.buckets.find((b) => b.le === 0.005)?.count).toBe(1);
    expect(ok?.buckets.find((b) => b.le === 0.25)?.count).toBe(2);
    expect(storeDuration.find((s) => s.result === "timeout")?.count).toBe(1);
    expect(storeDuration.map((s) => s.result).sort()).toEqual(["error", "ok", "timeout"]);
  });
});

describe("r39x_rate_limit_store_ready (SPEC-160 §42, INF-HLT-004)", () => {
  it("TC-RLM-009-116 the gauge is 0 or 1 with the environment label only, and is absent until the first probe result (never a published 0)", () => {
    const m = metrics();
    expect(m.snapshot().storeReady).toEqual([]);
    m.storeReady(true);
    expect(m.snapshot().storeReady).toEqual([
      { environment: "test", instance: expect.stringMatching(/^[0-9a-f]{8}$/), value: 1 },
    ]);
    m.storeReady(false);
    expect(m.snapshot().storeReady).toEqual([
      { environment: "test", instance: expect.stringMatching(/^[0-9a-f]{8}$/), value: 0 },
    ]);
    // SPEC-160 §42: environment and the low-cardinality instance label (one series per replica).
    expect(Object.keys(m.snapshot().storeReady[0] ?? {}).sort()).toEqual([
      "environment",
      "instance",
      "value",
    ]);
  });
});

describe("rate limit log event schema (SPEC-160 §24.1)", () => {
  const lines: string[] = [];
  const logger = createLogger({ service: "API", environment: "test", actor_type: "GUEST" }, (l) => {
    lines.push(l);
  });
  it("TC-RLM-009-104 ratelimit.decision.completed accepts the documented fields and rejects unbounded or unknown ones", () => {
    logger.log({
      event_name: "ratelimit.decision.completed",
      level: "WARN",
      result: "REJECTED",
      is_retry: false,
      class_id: "self_read",
      rule_category: "burst",
      retry_after_seconds: 7,
    });
    expect(JSON.parse(lines.at(-1) ?? "{}")).toMatchObject({
      event_name: "ratelimit.decision.completed",
      class_id: "self_read",
      rule_category: "burst",
      retry_after_seconds: 7,
    });
    const base = {
      event_name: "ratelimit.decision.completed",
      level: "WARN",
      result: "REJECTED",
      is_retry: false,
    } as const;
    // @ts-expect-error rule_category is a closed set
    expect(() => logger.log({ ...base, rule_category: "ip:203.0.113.9" })).toThrow();
    expect(() => logger.log({ ...base, class_id: "has space and 203.0.113.9," })).toThrow();
    // @ts-expect-error an IP field does not exist
    expect(() => logger.log({ ...base, client_ip: "203.0.113.9" })).toThrow();
    expect(() => logger.log({ ...base, retry_after_seconds: 0 })).toThrow();
  });
});

describe("OBS-ALT-041 / 042 rate limit store alerts (SPEC-160 §47, §46.1, OBS-ALT-043)", () => {
  const T0 = 1_700_000_000_000;
  const at = (n: number, spacingMs = 1000, start = T0) =>
    Array.from({ length: n }, (_, i) => start + i * spacingMs);

  it("TC-RLM-009-105 the rule is the specified HIGH Security threshold: 1 store_unavailable decision in 1 minute, no minimum request count", () => {
    expect(RATE_LIMIT_STORE_UNAVAILABLE_ALERT).toMatchObject({
      ruleId: "OBS-ALT-041",
      threshold: 1,
      windowMs: 60_000,
      severity: "HIGH",
      category: "Security",
    });
  });

  for (const [name, events, now, firing] of [
    ["1 in the window fires", at(1), T0 + 10_000, true],
    ["4 in the window fires", at(4), T0 + 10_000, true],
    ["5 in the window fires", at(5), T0 + 10_000, true],
    ["a single decision at the window edge fires", [T0 + 1], T0 + 60_000, true],
    ["entries older than 1 minute no longer count", at(5), T0 + 65_000, false],
    ["no events does not fire", [], T0, false],
  ] as [string, number[], number, boolean][])
    it(`TC-RLM-009-106 ${name}`, () => {
      const result = evaluateRateLimitStoreUnavailableAlert({
        environment: "production",
        storeUnavailableAtMs: events,
        nowMs: now,
      });
      expect(result.firing).toBe(firing);
      expect(result.dedupeKey).toBe("production:OBS-ALT-041");
      expect(result.notification).toBe(firing ? "open" : null);
    });

  it("TC-RLM-009-107 one notification opens the alert, repeats are limited to every 4 hours, and it resolves after one clean window", () => {
    const events = at(20);
    let state = ALERT_INITIAL_STATE;
    const step = (nowMs: number, storeUnavailableAtMs: readonly number[]) => {
      const result = evaluateRateLimitStoreUnavailableAlert({
        environment: "staging",
        storeUnavailableAtMs,
        nowMs,
        state,
      });
      state = result.state;
      return result.notification;
    };
    expect(step(T0 + 10_000, events)).toBe("open");
    expect(step(T0 + 11_000, events)).toBeNull();
    expect(step(T0 + 12_000, events)).toBeNull();
    // Still failing four hours later: a repeat, but only then.
    const later = T0 + 4 * 60 * 60 * 1000 + 10_000; // opened at T0 + 10 s
    const sustained = at(10, 1000, later - 10_000);
    expect(step(later - 1, sustained)).toBeNull();
    expect(step(later, sustained)).toBe("repeat");
    // Recovery: nothing fires for one full window before it resolves.
    const clean = later + 5 * 60_000;
    expect(step(clean, [])).toBeNull();
    expect(step(clean + 30_000, [])).toBeNull();
    expect(step(clean + 60_000, [])).toBe("resolve");
    expect(step(clean + 61_000, [])).toBeNull();
    expect(state).toEqual(ALERT_INITIAL_STATE);
  });

  it("TC-RLM-009-108 a relapse inside the resolve window keeps the same open alert", () => {
    let state = ALERT_INITIAL_STATE;
    const first = evaluateRateLimitStoreUnavailableAlert({
      environment: "test",
      storeUnavailableAtMs: at(5),
      nowMs: T0 + 5000,
      state,
    });
    state = first.state;
    const quiet = evaluateRateLimitStoreUnavailableAlert({
      environment: "test",
      storeUnavailableAtMs: [],
      nowMs: T0 + 120_000,
      state,
    });
    state = quiet.state;
    const relapse = evaluateRateLimitStoreUnavailableAlert({
      environment: "test",
      storeUnavailableAtMs: at(5, 1000, T0 + 130_000),
      nowMs: T0 + 140_000,
      state,
    });
    expect(relapse.firing).toBe(true);
    expect(relapse.notification).toBeNull();
    expect(relapse.state.clearSinceMs).toBeUndefined();
  });

  it("TC-RLM-009-111 1 to 4 requests a minute that all end in a 503 still notify OBS-ALT-041 exactly once, not once per request", () => {
    let state = ALERT_INITIAL_STATE;
    const decisions: number[] = [];
    const notifications: (string | null)[] = [];
    for (let minute = 0; minute < 30; minute++) {
      const count = (minute % 4) + 1;
      for (let i = 0; i < count; i++) decisions.push(T0 + minute * 60_000 + i * 5_000);
      const result = evaluateRateLimitStoreUnavailableAlert({
        environment: "production",
        storeUnavailableAtMs: decisions,
        nowMs: T0 + minute * 60_000 + 30_000,
        state,
      });
      state = result.state;
      notifications.push(result.notification);
    }
    expect(notifications.filter((n) => n !== null)).toEqual(["open"]);
    expect(notifications[0]).toBe("open");
  });

  it("TC-RLM-009-112 OBS-ALT-042 is the CRITICAL Security readiness rule: r39x_rate_limit_store_ready = 0 on 2 consecutive 1-minute evaluations", () => {
    expect(RATE_LIMIT_STORE_READINESS_ALERT).toMatchObject({
      ruleId: "OBS-ALT-042",
      consecutiveEvaluations: 2,
      evaluationMs: 60_000,
      severity: "CRITICAL",
      category: "Security",
    });
  });

  it("TC-RLM-009-113 OBS-ALT-042 notifies when the probe reports 0 on two consecutive evaluations, with zero requests and zero decisions", () => {
    const step = (ready: 0 | 1 | undefined, minute: number, state: typeof ALERT_INITIAL_STATE) =>
      evaluateRateLimitStoreReadinessAlert({
        environment: "production",
        ready,
        nowMs: T0 + minute * 60_000,
        state,
      });
    const first = step(0, 0, ALERT_INITIAL_STATE);
    expect(first.firing).toBe(false);
    expect(first.notification).toBeNull();
    const second = step(0, 1, first.state);
    expect(second.firing).toBe(true);
    expect(second.notification).toBe("open");
    expect(second.dedupeKey).toBe("production:OBS-ALT-042");
    // Still failing: no per-evaluation notification, a CRITICAL repeat only after 60 minutes.
    const third = step(0, 2, second.state);
    expect(third.notification).toBeNull();
    const nearRepeat = step(0, 60, third.state);
    expect(nearRepeat.notification).toBeNull();
    const repeat = step(0, 61, nearRepeat.state);
    expect(repeat.notification).toBe("repeat");
    // Recovery: ready=1 clears the streak and resolves after one full evaluation window.
    const recovering = step(1, 62, repeat.state);
    expect(recovering.firing).toBe(false);
    expect(recovering.notification).toBeNull();
    expect(step(1, 63, recovering.state).notification).toBe("resolve");
  });

  it("TC-RLM-009-114 a single 0 between healthy samples never fires OBS-ALT-042, and a missing sample is never read as 0", () => {
    let state = ALERT_INITIAL_STATE;
    for (const [ready, minute] of [
      [0, 0],
      [1, 1],
      [0, 2],
      [1, 3],
    ] as [0 | 1, number][]) {
      const result = evaluateRateLimitStoreReadinessAlert({
        environment: "production",
        ready,
        nowMs: T0 + minute * 60_000,
        state,
      });
      expect(result.notification).toBeNull();
      state = result.state;
    }
    let unknown = ALERT_INITIAL_STATE;
    for (let minute = 0; minute < 5; minute++) {
      const result = evaluateRateLimitStoreReadinessAlert({
        environment: "production",
        ready: undefined,
        nowMs: T0 + minute * 60_000,
        state: unknown,
      });
      expect(result.firing).toBe(false);
      expect(result.notification).toBeNull();
      unknown = result.state;
    }
    // One real 0 followed by a missing sample neither completes nor resets the streak.
    const zero = evaluateRateLimitStoreReadinessAlert({
      environment: "production",
      ready: 0,
      nowMs: T0,
      state: ALERT_INITIAL_STATE,
    });
    const gap = evaluateRateLimitStoreReadinessAlert({
      environment: "production",
      ready: undefined,
      nowMs: T0 + 60_000,
      state: zero.state,
    });
    expect(gap.state.streak).toBe(1);
    expect(gap.notification).toBeNull();
  });

  it("TC-RLM-009-115 OBS-ALT-014 (security configuration) does not fire when only the rate limit store is unreachable; it keeps its own rule ID", () => {
    const storeDown = evaluateSecurityConfigurationAlert({
      environment: "production",
      failureReasons: ["rate_limit_store_unreachable"],
      nowMs: T0,
    });
    expect(storeDown.firing).toBe(false);
    expect(storeDown.notification).toBeNull();
    const misconfigured = evaluateSecurityConfigurationAlert({
      environment: "production",
      failureReasons: ["security_configuration"],
      nowMs: T0,
    });
    expect(misconfigured.firing).toBe(true);
    expect(misconfigured.dedupeKey).toBe("production:OBS-ALT-014");
    expect(
      evaluateSecurityConfigurationAlert({
        environment: "staging",
        failureReasons: ["security_configuration"],
        nowMs: T0,
      }).firing,
    ).toBe(false);
    // The store rules use their own rule IDs and dedupe keys.
    expect(
      evaluateRateLimitStoreUnavailableAlert({
        environment: "production",
        storeUnavailableAtMs: [T0],
        nowMs: T0,
      }).dedupeKey,
    ).toBe("production:OBS-ALT-041");
  });
});
