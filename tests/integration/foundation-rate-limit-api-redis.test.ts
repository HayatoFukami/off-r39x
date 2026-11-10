import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/api/app.ts";
import { createRedisRateLimitStore } from "../../packages/rate-limit-redis/src/index.ts";
import { createRateLimiter, parseRateLimitConfig } from "../../packages/security/src/index.ts";
import { ceilingConfigText, peer, TEST_HMAC_KEY } from "../harness/rate-limit/api.ts";
import { openRedisTestSession, type RedisTestSession } from "../harness/rate-limit/redis.ts";

const SUBJECT = "aef69f82-c9b7-4fd1-9a6f-126f5748e9ae";
const WEB = "https://web.example.test";
const TOKEN = "e30.e30.c2ln";

let session: RedisTestSession;
beforeAll(async () => {
  session = await openRedisTestSession();
});
afterAll(async () => {
  await session.close();
});

function buildApp(url: string, ipLimit: number) {
  const store = createRedisRateLimitStore({ url });
  const limiter = createRateLimiter({
    store,
    config: parseRateLimitConfig(
      ceilingConfigText({
        self_read: {
          burst_limit: 30,
          sustained_limit: 120,
          additional: { "self_read.ip": { limit: ipLimit, window_seconds: 60 } },
        },
      }),
    ),
    hmacKey: TEST_HMAC_KEY,
    hmacKeyVersion: session.keyVersion,
  });
  let verified = 0;
  const app = createApp({
    webOrigin: WEB,
    ready: async () => true,
    auth: {
      verifier: {
        verify: async () => {
          verified += 1;
          return { subject: SUBJECT };
        },
      },
      store: {
        findByAuthSubject: async () => ({
          directory: { authSubject: SUBJECT, emailVerified: true },
          profile: { id: "1", publicRef: SUBJECT, authSubject: SUBJECT },
          roles: [],
        }),
      },
    },
    rateLimit: { limiter, trustedProxyHops: 0 },
  });
  return { app, limiter, verifiedCount: () => verified };
}
const get = (app: ReturnType<typeof createApp>, ip: string) =>
  app.request(
    "/api/v1/self/principal",
    { headers: { Authorization: `Bearer ${TOKEN}` } },
    peer(ip),
  );

describe("API with the real Redis store (TST-RLM-001..004)", () => {
  it("TC-RLM-004-213 the API answers 200, then 429 with Retry-After from the real Redis counters, and readiness runs the script", async () => {
    const { app, limiter } = buildApp(session.url, 2);
    try {
      await expect(limiter.assertReady()).resolves.toBeUndefined();
      expect((await get(app, "203.0.113.31")).status).toBe(200);
      expect((await get(app, "203.0.113.31")).status).toBe(200);
      const rejected = await get(app, "203.0.113.31");
      expect(rejected.status).toBe(429);
      expect(rejected.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
      expect((await rejected.json()).error.code).toBe("RATE_LIMIT_EXCEEDED");
      // Another client address is counted separately.
      expect((await get(app, "203.0.113.32")).status).toBe(200);
      const keys = await session.keys();
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.join(" ")).not.toContain("203.0.113");
    } finally {
      await limiter.close();
    }
  });

  it("TC-RLM-003-007 an unreachable Redis fails every registered route closed with 503, never 429, and never reaches verification", async () => {
    const { app, limiter, verifiedCount } = buildApp("redis://127.0.0.1:1", 2);
    try {
      for (let i = 0; i < 5; i++) {
        const res = await get(app, "203.0.113.33");
        expect(res.status).toBe(503);
        expect(res.headers.get("Retry-After")).toBeNull();
        expect((await res.json()).error.code).toBe("TEMPORARY_UNAVAILABLE");
      }
      expect(verifiedCount()).toBe(0);
      await expect(limiter.assertReady()).rejects.toThrow();
      // Health stays answerable: it never queries the store.
      expect((await app.request("/internal/health/live", {}, peer())).status).toBe(200);
    } finally {
      await limiter.close();
    }
  });
});
