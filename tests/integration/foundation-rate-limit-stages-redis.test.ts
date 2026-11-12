// Real Redis (SEC-ABU-026, SEC-ABU-013, TST-RLM-002 / 004). TEST_REDIS_URL is mandatory.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/api/app.ts";
import { createAuthProxy } from "../../apps/api/src/api/auth-proxy.ts";
import { createRedisRateLimitStore } from "../../packages/rate-limit-redis/src/index.ts";
import {
  createCounterKeyFactory,
  createRateLimiter,
  parseRateLimitConfig,
  type RateLimitStore,
  type StoreRule,
} from "../../packages/security/src/index.ts";
import { ceilingConfigText, peer, TEST_HMAC_KEY } from "../harness/rate-limit/api.ts";
import { openRedisTestSession, type RedisTestSession } from "../harness/rate-limit/redis.ts";

const WEB = "https://web.example.test";
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

/** The production app with the real auth proxy (synthetic transport) over the real Redis store. */
function authApp() {
  const store = createRedisRateLimitStore({ url: session.url });
  stores.push(store);
  const limiter = createRateLimiter({
    store,
    config: parseRateLimitConfig(ceilingConfigText()),
    hmacKey: TEST_HMAC_KEY,
    hmacKeyVersion: session.keyVersion,
  });
  const proxy = createAuthProxy(
    {
      baseUrl: "https://neon.example.test/auth",
      publicAuthOrigin: "https://api.example.test",
      webOrigin: WEB,
    },
    async () => Response.json({ ok: true }),
  );
  const app = createApp({
    webOrigin: WEB,
    ready: async () => true,
    authProxy: proxy,
    rateLimit: { limiter, trustedProxyHops: 0 },
  });
  const call = (method: string, path: string, address: string) =>
    app.request(
      new Request(`https://api.example.test${path}`, {
        method,
        headers: { Origin: WEB, "Content-Type": "application/json" },
        ...(method === "POST"
          ? { body: JSON.stringify({ email: `${unique("u")}@example.test` }) }
          : {}),
      }),
      undefined,
      peer(address),
    );
  const keyFactory = createCounterKeyFactory(TEST_HMAC_KEY, session.keyVersion);
  const count = async (ruleId: string, address: string) =>
    session.redis.zcard(keyFactory.key(ruleId, "ip", address));
  return { call, count };
}

describe("auth_session against the real Redis (SEC-ABU-027, TST-RLM-002 / 004)", () => {
  it("TC-RLM-004-233 100 concurrent get-session calls from one IP are all admitted (auth_form_proxy would stop at 5) and the 101st is a 429", async () => {
    const { call } = authApp();
    const address = ip(90);
    const first = await Promise.all(
      Array.from({ length: 100 }, () => call("GET", "/auth/get-session", address)),
    );
    expect(first.map((response) => response.status).filter((status) => status !== 200)).toEqual([]);
    const rejected = await call("GET", "/auth/get-session", address);
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
    // GET /auth/token and POST /auth/sign-out share the same auth_session counters.
    expect((await call("GET", "/auth/token", address)).status).toBe(429);
    expect((await call("POST", "/auth/sign-out", address)).status).toBe(429);
  });

  it("TC-RLM-004-234 auth_session and auth_form_proxy counters are independent in both directions, and auth_session writes only its two per-IP rules", async () => {
    const { call, count } = authApp();
    const address = ip(91);
    for (let i = 0; i < 3; i++)
      expect((await call("GET", "/auth/get-session", address)).status).toBe(200);
    expect(await count("auth_session.burst", address)).toBe(3);
    expect(await count("auth_session.sustained", address)).toBe(3);
    // Session lookups left the form counters untouched (the form class would have rejected the 6th).
    expect(await count("auth_form_proxy.burst", address)).toBe(0);
    for (let i = 0; i < 2; i++)
      expect((await call("POST", "/auth/sign-in/email", address)).status).toBe(200);
    expect(await count("auth_form_proxy.burst", address)).toBe(2);
    expect(await count("auth_form_proxy.sustained", address)).toBe(2);
    // ... and form attempts did not touch the session counters.
    expect(await count("auth_session.burst", address)).toBe(3);
    expect(await count("auth_session.sustained", address)).toBe(3);
    // Exhausting the form burst does not block session lookups from the same IP.
    for (let i = 0; i < 4; i++) await call("POST", "/auth/sign-in/email", address);
    expect((await call("POST", "/auth/sign-in/email", address)).status).toBe(429);
    expect((await call("GET", "/auth/get-session", address)).status).toBe(200);
    expect((await call("POST", "/auth/sign-out", address)).status).toBe(200);
    // Only the two per-IP rule kinds exist for auth_session: no identifier and no guard counter.
    const owned = (await session.keys()).filter((key) => key.includes(":auth_session."));
    expect([...new Set(owned.map((key) => key.split(":")[2]))].sort()).toEqual([
      "auth_session.burst",
      "auth_session.sustained",
    ]);
  });
});

describe("auth_callback against the real Redis (SEC-ABU-028, TST-RLM-002 / 004)", () => {
  it("TC-RLM-004-236 after auth_form_proxy is used up for an IP (5 per 10 s), both email-link GETs are still admitted and leave the other classes' counters unchanged", async () => {
    const { call, count } = authApp();
    const address = ip(92);
    for (let i = 0; i < 5; i++)
      expect((await call("POST", "/auth/sign-in/email", address)).status).toBe(200);
    expect((await call("POST", "/auth/sign-in/email", address)).status).toBe(429);
    const formBefore = await count("auth_form_proxy.burst", address);
    for (const path of ["/auth/verify-email", "/auth/magic-link/verify"])
      expect((await call("GET", path, address)).status, path).toBe(200);
    expect(await count("auth_callback.burst", address)).toBe(2);
    expect(await count("auth_callback.sustained", address)).toBe(2);
    expect(await count("auth_form_proxy.burst", address)).toBe(formBefore);
    expect(await count("auth_session.burst", address)).toBe(0);
    // The OTP POST is a form attempt: it is rejected by the used-up auth_form_proxy class and does
    // not touch the callback counters.
    expect((await call("POST", "/auth/email-otp/verify-email", address)).status).toBe(429);
    expect(await count("auth_callback.burst", address)).toBe(2);
  });

  it("TC-RLM-004-237 auth_callback stops at 30 per 10 s without changing the auth_form_proxy or auth_session counters, and form attempts do not change the callback counters", async () => {
    const { call, count } = authApp();
    const address = ip(93);
    const admitted = await Promise.all(
      Array.from({ length: 30 }, () => call("GET", "/auth/verify-email", address)),
    );
    expect(admitted.map((response) => response.status).filter((status) => status !== 200)).toEqual(
      [],
    );
    const rejected = await call("GET", "/auth/magic-link/verify", address);
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
    expect(await count("auth_callback.burst", address)).toBe(30);
    expect(await count("auth_form_proxy.burst", address)).toBe(0);
    expect(await count("auth_form_proxy.sustained", address)).toBe(0);
    expect(await count("auth_session.burst", address)).toBe(0);
    // The other classes keep working for the same IP, and do not move the callback counters.
    expect((await call("GET", "/auth/get-session", address)).status).toBe(200);
    expect((await call("POST", "/auth/sign-in/email", address)).status).toBe(200);
    expect(await count("auth_form_proxy.burst", address)).toBe(1);
    expect(await count("auth_session.burst", address)).toBe(1);
    expect(await count("auth_callback.burst", address)).toBe(30);
    expect(await count("auth_callback.sustained", address)).toBe(30);
    // Only the two per-IP rule kinds exist for auth_callback: no identifier and no guard counter.
    const owned = (await session.keys()).filter((key) => key.includes(":auth_callback."));
    expect([...new Set(owned.map((key) => key.split(":")[2]))].sort()).toEqual([
      "auth_callback.burst",
      "auth_callback.sustained",
    ]);
  });
});
