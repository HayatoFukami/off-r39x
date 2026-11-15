import { describe, expect, it } from "vitest";
import {
  createRateLimiter,
  parseRateLimitConfig,
  type RateLimitDecision,
  type RateLimiterOptions,
  type RateLimitObserver,
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
