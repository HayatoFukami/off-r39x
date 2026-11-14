// Real Redis (SEC-ABU-026, SEC-ABU-013, TST-RLM-002 / 004). TEST_REDIS_URL is mandatory.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ApiEnvironment,
  ApiFailure,
  createApp,
  requireCapability,
  requirePrincipal,
} from "../../apps/api/src/api/app.ts";
import { createAuthProxy } from "../../apps/api/src/api/auth-proxy.ts";
import {
  createPrincipalRateLimitHooks,
  createRateLimitStageOne,
  requireResourceRateLimit,
} from "../../apps/api/src/api/rate-limit.ts";
import { AuthFailure } from "../../packages/auth/src/index.ts";
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
  it("TC-RLM-004-233 100 concurrent get-session calls from one IP are all admitted (auth_form_proxy would stop at 10) and the 101st is a 429", async () => {
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
    // Session lookups left the form counters untouched (the form class would have rejected the 11th).
    expect(await count("auth_form_proxy.burst", address)).toBe(0);
    for (let i = 0; i < 2; i++)
      expect((await call("POST", "/auth/sign-in/email", address)).status).toBe(200);
    expect(await count("auth_form_proxy.burst", address)).toBe(2);
    expect(await count("auth_form_proxy.sustained", address)).toBe(2);
    // ... and form attempts did not touch the session counters.
    expect(await count("auth_session.burst", address)).toBe(3);
    expect(await count("auth_session.sustained", address)).toBe(3);
    // Exhausting the form burst does not block session lookups from the same IP.
    for (let i = 0; i < 8; i++) await call("POST", "/auth/sign-in/email", address);
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
  it("TC-RLM-004-236 after auth_form_proxy is used up for an IP (10 per 10 s), both email-link GETs are still admitted and leave the other classes' counters unchanged", async () => {
    const { call, count } = authApp();
    const address = ip(92);
    for (let i = 0; i < 10; i++)
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

/**
 * A mini API over the real limiter and the real Redis store, with a Stage 3 route behind
 * Role + Capability (SEC-ABU-029). Tokens map to subjects: `admin-…` / `staff-…` hold the role,
 * every other subject is an ordinary valid-JWT holder.
 */
function authorizedApp(classId: "role_assignment" | "staff_checkin") {
  const store = createRedisRateLimitStore({ url: session.url });
  stores.push(store);
  const limiter = createRateLimiter({
    store,
    config: parseRateLimitConfig(ceilingConfigText()),
    hmacKey: TEST_HMAC_KEY,
    hmacKeyVersion: session.keyVersion,
  });
  const app = new Hono<ApiEnvironment>();
  app.use("*", async (c, next) => {
    c.set("requestId", randomUUID());
    await next();
  });
  app.use(
    "*",
    createRateLimitStageOne({
      rateLimit: { limiter, trustedProxyHops: 0 },
      classify: () => ({ classId, operationId: null }),
    }),
  );
  app.onError((error, c) => {
    if (error instanceof ApiFailure) {
      if (error.code === "RATE_LIMIT_EXCEEDED")
        c.header("Retry-After", String(error.retryAfterSeconds));
      return c.json({ code: error.code }, error.code === "RATE_LIMIT_EXCEEDED" ? 429 : 503);
    }
    if (error instanceof AuthFailure) return c.json({ code: error.kind }, 403);
    return c.json({ code: "INTERNAL_ERROR" }, 500);
  });
  const principal = requirePrincipal(
    { verify: async (token) => ({ subject: token.split(".")[2] ?? "" }) },
    {
      findByAuthSubject: async (subject: string) => ({
        directory: { authSubject: subject, emailVerified: true },
        profile: { id: "1", publicRef: PROFILE, authSubject: subject },
        roles: subject.startsWith("admin-")
          ? ["ADMINISTRATOR"]
          : subject.startsWith("staff-")
            ? ["STAFF"]
            : [],
      }),
    },
    createPrincipalRateLimitHooks(limiter),
  );
  const rule =
    classId === "role_assignment" ? "role_assignment.profile" : "staff_checkin.qr_digest";
  const domain = { executed: 0 };
  app.get(
    "/x/:target",
    principal,
    requireCapability(
      classId === "role_assignment" ? "role_assignment.manage" : "entry_checkin.execute",
    ),
    requireResourceRateLimit(limiter, (c) => ({ [rule]: c.req.param("target") ?? "" })),
    (c) => {
      domain.executed += 1;
      return c.json({ ok: true });
    },
  );
  const call = (subject: string, target: string, address = "203.0.113.150") =>
    app.request(
      `/x/${target}`,
      { headers: { Authorization: `Bearer e30.e30.${subject}` } },
      peer(address),
    );
  const keyFactory = createCounterKeyFactory(TEST_HMAC_KEY, session.keyVersion);
  const count = (ruleId: string, target: string) =>
    session.redis.zcard(keyFactory.key(ruleId, "resource", target));
  return { call, domain, count, rule };
}
const PROFILE = "5c2d5d1e-7f4a-4a3b-9d0e-3a1b2c4d5e6f";

describe("Stage 3 after authorization against the real Redis (SEC-ABU-029, TST-RLM-002 / 004)", () => {
  it("TC-RLM-004-254 ordinary valid-JWT holders naming a victim profile get 403 and leave the role_assignment profile counter at 0; real administrators then use the whole 5 per 10 min slot and the 6th is a 429 that never reaches the Domain precondition", async () => {
    const { call, domain, count, rule } = authorizedApp("role_assignment");
    const victim = unique("victim");
    // 60 distinct attackers (each inside its own burst / sustained limit) name the same profile.
    for (let i = 0; i < 60; i++) {
      const res = await call(unique("user"), victim, ip(100 + (i % 50)));
      expect(res.status).toBe(403);
    }
    expect(await count(rule, victim)).toBe(0);
    expect(domain.executed).toBe(0);
    for (let i = 0; i < 5; i++)
      expect((await call(unique("admin"), victim)).status, `grant ${i + 1}`).toBe(200);
    expect(await count(rule, victim)).toBe(5);
    expect(domain.executed).toBe(5);
    const over = await call(unique("admin"), victim);
    expect(over.status).toBe(429);
    expect(over.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
    expect(domain.executed).toBe(5);
    expect(await count(rule, victim)).toBe(5);
    // Another target of the same class is untouched.
    expect((await call(unique("admin"), unique("other"))).status).toBe(200);
  }, 60_000);

  it("TC-RLM-004-255 staff_checkin: non-Staff principals scanning one QR digest leave its counter at 0; Staff consume the 30 per minute slot and the 31st is a 429 before any QR lookup", async () => {
    const { call, domain, count, rule } = authorizedApp("staff_checkin");
    const digest = unique("digest");
    for (let i = 0; i < 40; i++)
      expect((await call(unique("user"), digest, ip(160 + (i % 40)))).status).toBe(403);
    expect(await count(rule, digest)).toBe(0);
    const staff = unique("staff");
    for (let i = 0; i < 30; i++)
      expect((await call(staff, digest, ip(210))).status, `scan ${i + 1}`).toBe(200);
    expect(domain.executed).toBe(30);
    const over = await call(staff, digest, ip(210));
    expect(over.status).toBe(429);
    expect(domain.executed).toBe(30);
    expect(await count(rule, digest)).toBe(30);
  }, 60_000);
});

describe("Webhook global rule against the real Redis (SEC-ABU-030, TST-RLM-002 / 004)", () => {
  it("TC-RLM-004-256 pre-signature traffic from many source IPs never consumes the stripe_webhook global rule: 4,000 such requests later, 3,000 verified requests are still admitted and the 3,001st is a 429", async () => {
    const { limiter } = build();
    // 80 source IPs x 50 requests: each IP is far inside its own 100/10 s and 300/60 s limits.
    for (let address = 1; address <= 80; address++)
      for (let i = 0; i < 50; i++) {
        const stage1 = await limiter.preAuth({
          classId: "stripe_webhook",
          ip: `198.51.100.${address}`,
        });
        expect(stage1.result).toBe("allowed");
      }
    let admitted = 0;
    for (let i = 0; i < 3000; i++)
      if ((await limiter.webhookVerified({ classId: "stripe_webhook" })).result === "allowed")
        admitted += 1;
    expect(admitted).toBe(3000);
    const over = await limiter.webhookVerified({ classId: "stripe_webhook" });
    expect(over).toMatchObject({ result: "rejected", ruleCategory: "global" });
    if (over.result === "rejected") expect(over.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    // resend_webhook has its own global counter.
    expect((await limiter.webhookVerified({ classId: "resend_webhook" })).result).toBe("allowed");
    // Stage 1 for a source IP is still evaluated on its own rules only.
    const keyFactory = createCounterKeyFactory(TEST_HMAC_KEY, session.keyVersion);
    expect(await session.redis.zcard(keyFactory.key("stripe_webhook.global", "global", ""))).toBe(
      3000,
    );
  }, 180_000);
});
