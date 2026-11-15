import { describe, expect, it } from "vitest";
import {
  createRateLimiter,
  parseRateLimitConfig,
  type RateLimiterOptions,
} from "../../packages/security/src/index.ts";
import { ceilingConfigText } from "../harness/rate-limit/api.ts";
import { withFault } from "../harness/rate-limit/faults.ts";
import { createMemoryStore } from "../harness/rate-limit/memory-store.ts";

const hmacKey = new Uint8Array(32).fill(5);
const IP = "203.0.113.5";
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
