import { describe, expect, it } from "vitest";
import {
  createRateLimiter,
  parseRateLimitConfig,
  RATE_LIMIT_REGISTRY,
  type RateLimitDecision,
  type RateLimiterOptions,
  type RateLimitObserver,
  type RouteClassId,
} from "../../packages/security/src/index.ts";
import { ceilingConfigText } from "../harness/rate-limit/api.ts";
import { withFault } from "../harness/rate-limit/faults.ts";
import { createMemoryStore } from "../harness/rate-limit/memory-store.ts";

const hmacKey = new Uint8Array(32).fill(5);
const IP = "203.0.113.5";
const SUBJECT = "aef69f82-c9b7-4fd1-9a6f-126f5748e9ae";

function build(extra: Partial<RateLimiterOptions> = {}, overrides: Record<string, unknown> = {}) {
  const store = createMemoryStore();
  const limiter = createRateLimiter({
    store,
    config: parseRateLimitConfig(ceilingConfigText(overrides)),
    hmacKey,
    hmacKeyVersion: 1,
    ...extra,
  });
  return { store, limiter };
}
const rulesOf = (calls: ReturnType<typeof createMemoryStore>["calls"]) =>
  calls.map((call) => ({
    mode: call.mode,
    rules: call.rules.map((rule) => [rule.limit, rule.windowMs / 1000]),
  }));

describe("rule planning per stage (SEC-ABU-017, §68)", () => {
  it("TC-RLM-004-102 each class evaluates exactly its SPEC-140 §68 rules in the specified stage", async () => {
    type Plan = {
      pre?: number[][];
      guard?: boolean;
      subject?: number[][];
      resource?: { values: Record<string, string>; rules: number[][] };
    };
    const burstSustained = (id: RouteClassId) => [
      [RATE_LIMIT_REGISTRY[id].burst, 10],
      [RATE_LIMIT_REGISTRY[id].sustained, 60],
    ];
    const plans: Record<RouteClassId, Plan> = {
      public_read: { pre: [...burstSustained("public_read"), [10000, 60]] },
      auth_form_proxy: { pre: [...burstSustained("auth_form_proxy"), [5, 600]] },
      auth_session: { pre: burstSustained("auth_session") },
      self_read: { pre: [[240, 60]], subject: burstSustained("self_read") },
      purchase_checkout: {
        guard: true,
        subject: burstSustained("purchase_checkout"),
        resource: { values: { "purchase_checkout.resource": "offering" }, rules: [[60, 60]] },
      },
      qr_display: {
        guard: true,
        subject: burstSustained("qr_display"),
        resource: { values: { "qr_display.ticket": "ticket" }, rules: [[12, 60]] },
      },
      profile_mutation: { guard: true, subject: burstSustained("profile_mutation") },
      staff_checkin: {
        pre: [[300, 60]],
        subject: burstSustained("staff_checkin"),
        resource: { values: { "staff_checkin.qr_digest": "digest" }, rules: [[30, 60]] },
      },
      goods_handoff: {
        guard: true,
        subject: burstSustained("goods_handoff"),
        resource: { values: { "goods_handoff.item": "item" }, rules: [[10, 60]] },
      },
      admin_mutation: {
        guard: true,
        subject: burstSustained("admin_mutation"),
        resource: { values: { "admin_mutation.resource": "target" }, rules: [[15, 60]] },
      },
      role_assignment: {
        guard: true,
        subject: burstSustained("role_assignment"),
        resource: { values: { "role_assignment.profile": "profile" }, rules: [[5, 600]] },
      },
      high_risk_recovery: {
        guard: true,
        subject: burstSustained("high_risk_recovery"),
        resource: {
          values: {
            "high_risk_recovery.resource_minute": "target",
            "high_risk_recovery.resource_hour": "target",
          },
          rules: [
            [2, 60],
            [10, 3600],
          ],
        },
      },
      stripe_webhook: { pre: [...burstSustained("stripe_webhook"), [3000, 60]] },
      resend_webhook: { pre: [...burstSustained("resend_webhook"), [3000, 60]] },
    };
    for (const [classId, plan] of Object.entries(plans) as [RouteClassId, Plan][]) {
      const { store, limiter } = build();
      await limiter.preAuth({ classId, ip: IP, loginIdentifier: "user@example.com" });
      const expectedPre = [
        ...(plan.guard
          ? [
              {
                mode: "check",
                rules: [
                  [20, 10],
                  [50, 60],
                ],
              },
            ]
          : []),
        ...(plan.pre ? [{ mode: "admit", rules: plan.pre }] : []),
      ];
      expect(rulesOf(store.calls), `${classId} stage 1`).toEqual(expectedPre);
      store.calls.length = 0;
      await limiter.subject({ classId, subject: SUBJECT });
      expect(rulesOf(store.calls), `${classId} subject`).toEqual(
        plan.subject ? [{ mode: "admit", rules: plan.subject }] : [],
      );
      store.calls.length = 0;
      if (plan.resource) {
        await limiter.resource({ classId, values: plan.resource.values });
        expect(rulesOf(store.calls), `${classId} resource`).toEqual([
          { mode: "admit", rules: plan.resource.rules },
        ]);
      }
    }
  });

  it("TC-RLM-004-103 an unmatched path or unsupported method evaluates only the public_read per-IP burst/sustained (no global)", async () => {
    const { store, limiter } = build();
    expect((await limiter.unmatched(IP)).result).toBe("allowed");
    expect(rulesOf(store.calls)).toEqual([
      {
        mode: "admit",
        rules: [
          [20, 10],
          [120, 60],
        ],
      },
    ]);
  });

  it("TC-RLM-004-104 a missing resource key is a programming error and never skips the rule", async () => {
    const { store, limiter } = build();
    await expect(limiter.resource({ classId: "qr_display", values: {} })).rejects.toThrow();
    expect(store.calls).toHaveLength(0);
  });

  it("TC-RLM-004-105 the effective limits come from RATE_LIMIT_CONFIG, not from the ceilings", async () => {
    const { store, limiter } = build(
      {},
      {
        public_read: {
          burst_limit: 2,
          sustained_limit: 3,
          additional: { "public_read.global": { limit: 4, window_seconds: 60 } },
        },
      },
    );
    await limiter.preAuth({ classId: "public_read", ip: IP });
    expect(rulesOf(store.calls)[0]?.rules).toEqual([
      [2, 10],
      [3, 60],
      [4, 60],
    ]);
  });
});

describe("decisions and Retry-After (SEC-ABU-007 / 012 / 013)", () => {
  const tight = {
    public_read: {
      burst_limit: 2,
      sustained_limit: 3,
      additional: { "public_read.global": { limit: 10, window_seconds: 60 } },
    },
  };
  it("TC-RLM-002-102 sliding window admits exactly the limit, rejects +1 with an integer Retry-After rounded up, and a rejection consumes nothing", async () => {
    const { store, limiter } = build({}, tight);
    const send = () => limiter.preAuth({ classId: "public_read", ip: IP });
    expect((await send()).result).toBe("allowed");
    store.advance(1500);
    expect((await send()).result).toBe("allowed");
    const keysBefore = store.keys().map((key) => [key, store.count(key)]);
    const rejected = await send();
    expect(rejected).toEqual({ result: "rejected", retryAfterSeconds: 9, ruleCategory: "burst" });
    // 8.5 s remain for the burst window; the rounded-up value is 9 and never 0.
    expect(store.keys().map((key) => [key, store.count(key)])).toEqual(keysBefore);
    store.advance(8499);
    expect(await send()).toMatchObject({ result: "rejected", retryAfterSeconds: 1 });
    store.advance(1);
    expect((await send()).result).toBe("allowed");
  });

  it("TC-RLM-002-103 Retry-After is the longest over all exceeded rules", async () => {
    const { store, limiter } = build({}, tight);
    const send = () => limiter.preAuth({ classId: "public_read", ip: IP });
    await send(); // t0
    store.advance(10_000);
    await send(); // t0+10s (burst window empty again; sustained has 2)
    store.advance(10_000);
    await send(); // sustained now 3 (limit)
    store.advance(10_000);
    // sustained exceeded: the oldest entry ages out 60 s after t0 => 30 s away. Burst is fine.
    expect(await send()).toEqual({
      result: "rejected",
      retryAfterSeconds: 30,
      ruleCategory: "sustained",
    });
  });
});

describe("Authentication-failure guard (SEC-ABU-020 / 021 / 022)", () => {
  const guards = {
    auth_failure_guard_attendee: { burst_limit: 2, sustained_limit: 5 },
    auth_failure_guard_operator: { burst_limit: 3, sustained_limit: 5 },
  };
  it("TC-RLM-005-102 the guard confirms before and records after; only a recorded failure counts, per IP, with independent classes", async () => {
    const { limiter } = build({}, guards);
    const attendee = () => limiter.preAuth({ classId: "purchase_checkout", ip: IP });
    const operator = () => limiter.preAuth({ classId: "admin_mutation", ip: IP });
    // A confirmation alone never counts.
    for (let i = 0; i < 10; i += 1) expect((await attendee()).result).toBe("allowed");
    expect((await limiter.recordAuthFailure("purchase_checkout", IP)).result).toBe("allowed");
    expect((await limiter.recordAuthFailure("qr_display", IP)).result).toBe("allowed");
    // Two attendee failures reached the burst limit of 2.
    expect(await attendee()).toMatchObject({ result: "rejected", ruleCategory: "guard" });
    expect(await limiter.preAuth({ classId: "qr_display", ip: IP })).toMatchObject({
      result: "rejected",
    });
    // The operator guard is a separate counter with its own limit.
    expect((await operator()).result).toBe("allowed");
    // Another IP is not affected.
    expect(
      (await limiter.preAuth({ classId: "purchase_checkout", ip: "203.0.113.6" })).result,
    ).toBe("allowed");
    // Concurrent failures may overrun the guard: recording never rejects (SEC-ABU-021).
    for (let i = 0; i < 20; i += 1)
      expect((await limiter.recordAuthFailure("profile_mutation", IP)).result).toBe("allowed");
    // Classes without a guard (SEC-ABU-023) are not recorded at all.
    expect((await limiter.recordAuthFailure("self_read", IP)).result).toBe("allowed");
    expect((await limiter.recordAuthFailure("public_read", IP)).result).toBe("allowed");
  });

  it("TC-RLM-005-103 a guard record that cannot be stored is reported as store_unavailable, never skipped", async () => {
    const store = withFault(createMemoryStore());
    const limiter = createRateLimiter({
      store,
      config: parseRateLimitConfig(ceilingConfigText()),
      hmacKey,
      hmacKeyVersion: 1,
    });
    store.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
    expect((await limiter.recordAuthFailure("purchase_checkout", IP)).result).toBe(
      "store_unavailable",
    );
  });
});

describe("store failure: Fail Closed (SEC-ABU-019, REL-SEC-003 / 004 / 005)", () => {
  const faulty = (extra: Partial<RateLimiterOptions> = {}) => {
    const base = createMemoryStore();
    const store = withFault(base);
    let clock = 0;
    const limiter = createRateLimiter({
      store,
      config: parseRateLimitConfig(ceilingConfigText()),
      hmacKey,
      hmacKeyVersion: 1,
      deadlineMs: 25,
      monotonicNow: () => clock,
      ...extra,
    });
    return { base, store, limiter, tick: (ms: number) => (clock += ms) };
  };
  const send = (limiter: ReturnType<typeof faulty>["limiter"]) =>
    limiter.preAuth({ classId: "public_read", ip: IP });

  it("TC-RLM-003-102 unreachable/erroring stores yield store_unavailable (never allowed, never rejected)", async () => {
    for (const point of [
      "FP.RATELIMIT.STORE_UNAVAILABLE",
      "FP.RATELIMIT.STORE_MEMORY_FULL",
      "FP.RATELIMIT.SCRIPT_ERROR",
    ] as const) {
      const { store, limiter } = faulty();
      store.inject(point);
      expect(await send(limiter), point).toEqual({ result: "store_unavailable" });
      expect(store.faultedCalls).toBe(1);
    }
  });

  it("TC-RLM-003-103 a store that does not answer within the deadline is unavailable, evaluated exactly once", async () => {
    const { store, limiter } = faulty();
    store.inject("FP.RATELIMIT.STORE_TIMEOUT");
    expect(await send(limiter)).toEqual({ result: "store_unavailable" });
    expect(store.faultedCalls).toBe(1);
  });

  it("TC-RLM-003-104 the short circuit opens after consecutive failures, keeps answering unavailable without store calls, and closes after a successful trial", async () => {
    const { store, limiter, tick, base } = faulty();
    store.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
    for (let i = 0; i < 3; i += 1) expect((await send(limiter)).result).toBe("store_unavailable");
    expect(store.faultedCalls).toBe(3);
    // Open: unavailable, and the store is not asked (the same fault stays at 3 calls).
    for (let i = 0; i < 5; i += 1)
      expect(await send(limiter), "circuit open").toEqual({ result: "store_unavailable" });
    expect(store.faultedCalls).toBe(3);
    // The store recovered, but the circuit is open for at most 2 s.
    store.inject(undefined);
    tick(1999);
    expect((await send(limiter)).result).toBe("store_unavailable");
    expect(base.calls).toHaveLength(0);
    tick(1);
    expect((await send(limiter)).result).toBe("allowed");
    expect(base.calls).toHaveLength(1);
    expect((await send(limiter)).result).toBe("allowed");
  });

  it("TC-RLM-003-105 a failed trial keeps the circuit open for another period", async () => {
    const { store, limiter, tick } = faulty();
    store.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
    for (let i = 0; i < 3; i += 1) await send(limiter);
    tick(2000);
    expect((await send(limiter)).result).toBe("store_unavailable");
    expect(store.faultedCalls).toBe(4); // exactly one trial
    expect((await send(limiter)).result).toBe("store_unavailable");
    expect(store.faultedCalls).toBe(4);
  });
});

describe("observation (OBS-SEC-007 / 008 / 009)", () => {
  it("TC-RLM-009-102 every evaluation reports class, result and category only; store operations report ok/timeout/error", async () => {
    const decisions: unknown[] = [];
    const storeOps: unknown[] = [];
    const observer: RateLimitObserver = {
      decision: (event) => decisions.push(event),
      storeOperation: (event) => storeOps.push(event),
    };
    const base = createMemoryStore();
    const store = withFault(base);
    const limiter = createRateLimiter({
      store,
      config: parseRateLimitConfig(
        ceilingConfigText({
          public_read: {
            burst_limit: 1,
            sustained_limit: 3,
            additional: { "public_read.global": { limit: 10, window_seconds: 60 } },
          },
        }),
      ),
      hmacKey,
      hmacKeyVersion: 1,
      observer,
      deadlineMs: 20,
      circuit: { failureThreshold: 100, openMs: 2000 },
    });
    const call = (): Promise<RateLimitDecision> =>
      limiter.preAuth({ classId: "public_read", ip: IP, operationId: "API-PUB-001" });
    await call();
    await call();
    store.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
    await call();
    store.inject("FP.RATELIMIT.STORE_TIMEOUT");
    await call();
    expect(decisions).toEqual([
      { classId: "public_read", result: "allowed", operationId: "API-PUB-001" },
      {
        classId: "public_read",
        result: "rejected",
        ruleCategory: "burst",
        retryAfterSeconds: 10,
        operationId: "API-PUB-001",
      },
      { classId: "public_read", result: "store_unavailable", operationId: "API-PUB-001" },
      { classId: "public_read", result: "store_unavailable", operationId: "API-PUB-001" },
    ]);
    expect(storeOps.map((op) => (op as { result: string }).result)).toEqual([
      "ok",
      "ok",
      "error",
      "timeout",
    ]);
    const text = JSON.stringify([decisions, storeOps]);
    expect(text).not.toContain(IP);
    expect(text).not.toContain("rl:");
  });

  it("TC-RLM-009-103 an observer that throws cannot change the decision", async () => {
    const { limiter } = build({
      observer: {
        decision: () => {
          throw new Error("observer down");
        },
        storeOperation: () => {
          throw new Error("observer down");
        },
      },
    });
    expect((await limiter.preAuth({ classId: "public_read", ip: IP })).result).toBe("allowed");
  });
});
