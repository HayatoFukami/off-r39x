// Real Redis (SEC-ABU-026, SEC-ABU-013, TST-RLM-002 / 004). TEST_REDIS_URL is mandatory.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRedisRateLimitStore } from "../../packages/rate-limit-redis/src/index.ts";
import {
  createRateLimiter,
  parseRateLimitConfig,
  type RateLimitStore,
  type StoreRule,
} from "../../packages/security/src/index.ts";
import { ceilingConfigText, TEST_HMAC_KEY } from "../harness/rate-limit/api.ts";
import { openRedisTestSession, type RedisTestSession } from "../harness/rate-limit/redis.ts";

let session: RedisTestSession;
const stores: RateLimitStore[] = [];
beforeAll(async () => {
  session = await openRedisTestSession();
});
afterAll(async () => {
  for (const store of stores) await store.close();
  await session.close();
});

/** The real store, recording which rules every evaluation carried. */
function build(overrides: Record<string, unknown> = {}) {
  const real = createRedisRateLimitStore({ url: session.url });
  stores.push(real);
  const evaluations: (readonly StoreRule[])[] = [];
  const store: RateLimitStore = {
    evaluate: (mode, rules, requestId) => {
      evaluations.push(rules);
      return real.evaluate(mode, rules, requestId);
    },
    assertReady: () => real.assertReady(),
    close: () => real.close(),
  };
  const limiter = createRateLimiter({
    store,
    config: parseRateLimitConfig(ceilingConfigText(overrides)),
    hmacKey: TEST_HMAC_KEY,
    hmacKeyVersion: session.keyVersion,
  });
  const shape = (rules: readonly StoreRule[]) => rules.map((r) => [r.limit, r.windowMs]);
  return { limiter, evaluations, shape };
}
let sequence = 0;
const unique = (label: string) => {
  sequence += 1;
  return `${label}-${Date.now()}-${sequence}`;
};
const ip = (n: number) => `203.0.113.${n}`;

describe("which rules each stage evaluates (SEC-ABU-026)", () => {
  it("TC-RLM-002-301 self_read: Stage 1 evaluates only the IP rule 240/60 s, Stage 2 only the subject burst 30/10 s and sustained 120/60 s", async () => {
    const { limiter, evaluations, shape } = build();
    expect((await limiter.preAuth({ classId: "self_read", ip: ip(81) })).result).toBe("allowed");
    expect((await limiter.subject({ classId: "self_read", subject: unique("s") })).result).toBe(
      "allowed",
    );
    expect(evaluations.map(shape)).toEqual([
      [[240, 60_000]],
      [
        [30, 10_000],
        [120, 60_000],
      ],
    ]);
  });

  it("TC-RLM-002-302 staff_checkin: Stage 1 IP 300/60 s, Stage 2 subject 40/10 s and 180/60 s, resource QR digest 30/60 s", async () => {
    const { limiter, evaluations, shape } = build();
    await limiter.preAuth({ classId: "staff_checkin", ip: ip(82) });
    await limiter.subject({ classId: "staff_checkin", subject: unique("staff") });
    await limiter.resource({
      classId: "staff_checkin",
      values: { "staff_checkin.qr_digest": unique("digest") },
    });
    expect(evaluations.map(shape)).toEqual([
      [[300, 60_000]],
      [
        [40, 10_000],
        [180, 60_000],
      ],
      [[30, 60_000]],
    ]);
  });

  it("TC-RLM-004-221 one IP shared by many subjects is limited only by the IP rule: 240 pass, the 241st is a 429 at Stage 1 (no IP burst)", async () => {
    const { limiter } = build();
    const shared = ip(83);
    for (let i = 1; i <= 240; i++) {
      const stage1 = await limiter.preAuth({ classId: "self_read", ip: shared });
      expect(stage1.result, `request ${i}`).toBe("allowed");
      const stage2 = await limiter.subject({ classId: "self_read", subject: unique("shared") });
      expect(stage2.result, `request ${i}`).toBe("allowed");
    }
    const rejected = await limiter.preAuth({ classId: "self_read", ip: shared });
    expect(rejected.result).toBe("rejected");
    // Another IP is unaffected.
    expect((await limiter.preAuth({ classId: "self_read", ip: ip(84) })).result).toBe("allowed");
  });

  it("TC-RLM-004-222 one subject is stopped by its own sustained limit long before the IP rule is reached", async () => {
    // The real 120/60 s needs a minute of wall time; the same rule at a lowered limit shows the
    // order (RATE_LIMIT_CONFIG may only lower a limit).
    const { limiter } = build({
      self_read: {
        burst_limit: 30,
        sustained_limit: 5,
        additional: { "self_read.ip": { limit: 240, window_seconds: 60 } },
      },
    });
    const subject = unique("single");
    const shared = ip(85);
    for (let i = 1; i <= 5; i++) {
      expect((await limiter.preAuth({ classId: "self_read", ip: shared })).result).toBe("allowed");
      expect((await limiter.subject({ classId: "self_read", subject })).result).toBe("allowed");
    }
    expect((await limiter.preAuth({ classId: "self_read", ip: shared })).result).toBe("allowed");
    const stopped = await limiter.subject({ classId: "self_read", subject });
    expect(stopped).toMatchObject({ result: "rejected", ruleCategory: "sustained" });
  });
});
