import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  type ApiEnvironment,
  ApiFailure,
  createApp,
  requireCapability,
  requirePrincipal,
  requireVerifiedEmail,
} from "../../apps/api/src/api/app.ts";
import { createAuthProxy } from "../../apps/api/src/api/auth-proxy.ts";
import {
  createPrincipalRateLimitHooks,
  createRateLimitMetricsObserver,
  createRateLimitStageOne,
  markAuthorizationConfirmed,
  requireResourceRateLimit,
  requireWebhookGlobalRateLimit,
} from "../../apps/api/src/api/rate-limit.ts";
import { CANONICAL_AUTH_ALLOWLIST } from "../../apps/api/src/api/routes.ts";
import { AuthFailure } from "../../packages/auth/src/index.ts";
import { createLogger, createRateLimitMetrics } from "../../packages/observability/src/index.ts";
import {
  RATE_LIMIT_CLASS_IDS,
  RATE_LIMIT_REGISTRY,
  RateLimitStoreError,
  type RouteClassId,
} from "../../packages/security/src/index.ts";
import { createTestRateLimit, peer, type TestRateLimit } from "../harness/rate-limit/api.ts";

const SUBJECT = "aef69f82-c9b7-4fd1-9a6f-126f5748e9ae";
const PROFILE_REF = "5c2d5d1e-7f4a-4a3b-9d0e-3a1b2c4d5e6f";
const IP = "203.0.113.9";
const GOOD = "e30.e30.c2ln";
const BAD = "e30.e30.YmFk";
const WEB = "https://web.example.test";

/** A complete per-class override (RATE_LIMIT_CONFIG replaces a class as a whole). */
const selfRead = (burst: number, sustained: number, ip = 240) => ({
  self_read: {
    burst_limit: burst,
    sustained_limit: sustained,
    additional: { "self_read.ip": { limit: ip, window_seconds: 60 } },
  },
});
const guard = (burst: number, sustained = 50) => ({
  burst_limit: burst,
  sustained_limit: sustained,
});

interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly trs: TestRateLimit;
  readonly order: string[];
  readonly lines: string[];
  readonly events: () => Record<string, unknown>[];
  verified: boolean;
  get(init?: {
    token?: string;
    ip?: string;
    headers?: Record<string, string>;
  }): Response | Promise<Response>;
}
function harness(options: Parameters<typeof createTestRateLimit>[0] = {}): Harness {
  const order: string[] = [];
  const lines: string[] = [];
  const trs = createTestRateLimit(options);
  const evaluate = trs.store.evaluate.bind(trs.store);
  trs.store.evaluate = async (mode, rules, id) => {
    order.push(`store:${mode}`);
    return evaluate(mode, rules, id);
  };
  const state = { verified: true };
  const app = createApp({
    webOrigin: WEB,
    ready: async () => true,
    logger: createLogger({ service: "API", environment: "test", actor_type: "GUEST" }, (line) => {
      lines.push(line);
    }),
    auth: {
      verifier: {
        verify: async (token) => {
          order.push("verify");
          if (token.endsWith("YmFk")) throw new AuthFailure("unauthenticated");
          return { subject: SUBJECT };
        },
      },
      store: {
        findByAuthSubject: async () => {
          order.push("db");
          return {
            directory: { authSubject: SUBJECT, emailVerified: state.verified },
            profile: { id: "1", publicRef: PROFILE_REF, authSubject: SUBJECT },
            roles: [],
          };
        },
      },
    },
    rateLimit: trs.rateLimit,
  });
  const result: Harness = {
    app,
    trs,
    order,
    lines,
    events: () => lines.map((line) => JSON.parse(line)),
    get verified() {
      return state.verified;
    },
    set verified(value: boolean) {
      state.verified = value;
    },
    get: (init = {}) =>
      app.request(
        "/api/v1/self/principal",
        { headers: { Authorization: `Bearer ${init.token ?? GOOD}`, ...init.headers } },
        peer(init.ip ?? IP),
      ),
  };
  return result;
}

describe("evaluation order and result mapping (TST-RLM-004)", () => {
  it("TC-RLM-004-201 Stage 1 -> token verification -> Stage 2 -> DB, in the SPEC-110 §24.1 order", async () => {
    const h = harness();
    const res = await h.get();
    expect(res.status).toBe(200);
    expect(h.order).toEqual(["store:admit", "verify", "store:admit", "db"]);
  });

  it("TC-RLM-004-202 a Stage 1 rejection is a 429 with an integer Retry-After and never reaches verification or the DB", async () => {
    const h = harness({ overrides: selfRead(30, 120, 1) });
    expect((await h.get()).status).toBe(200);
    h.order.length = 0;
    const res = await h.get();
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get("Retry-After") ?? "";
    expect(retryAfter).toMatch(/^[1-9]\d*$/);
    expect(Number(retryAfter)).toBeLessThanOrEqual(60);
    expect(h.order).toEqual(["store:admit"]);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.error).toMatchObject({
      code: "RATE_LIMIT_EXCEEDED",
      retryable: true,
      details: null,
    });
    for (const secret of [IP, SUBJECT, "self_read", "rl:v", "a@example.test"])
      expect(text).not.toContain(secret);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("TC-RLM-004-203 a Stage 2 rejection stops before the DB lookup and before the Email verified check", async () => {
    const h = harness({ overrides: selfRead(1, 120) });
    h.verified = false;
    // First request is admitted by Stage 2 and then stopped by the Email verified check (403).
    expect((await h.get()).status).toBe(403);
    h.order.length = 0;
    const res = await h.get();
    expect(res.status).toBe(429);
    expect(h.order).toEqual(["store:admit", "verify", "store:admit"]);
    expect(res.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
  });

  it("TC-RLM-004-204 a store failure is a 503 TEMPORARY_UNAVAILABLE at both stages, distinct from 429, and never reaches the DB", async () => {
    const h = harness();
    h.trs.faults.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
    let res = await h.get();
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBeNull();
    expect((await res.json()).error).toMatchObject({
      code: "TEMPORARY_UNAVAILABLE",
      retryable: true,
      details: null,
    });
    expect(h.order.filter((entry) => entry === "verify" || entry === "db")).toEqual([]);
    h.trs.faults.inject(undefined);
    // Fault between Stage 1 and Stage 2: Stage 1 is admitted, Stage 2 fails closed.
    const app2 = harness();
    const original = app2.trs.faults.evaluate;
    let calls = 0;
    app2.trs.faults.evaluate = (mode, rules, id) => {
      calls += 1;
      if (calls === 2) app2.trs.faults.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
      return original(mode, rules, id);
    };
    res = await app2.get();
    expect(res.status).toBe(503);
    expect(app2.order).not.toContain("db");
  });

  it("TC-RLM-004-218 each evaluation is independent: a request admitted by Stage 1 and rejected by Stage 2 consumes the Stage 1 counter, never the Stage 2 one (SEC-ABU-013)", async () => {
    // Stage 1 rule: IP 3/min. Stage 2 rule: subject burst 1 per 10 s.
    const h = harness({ overrides: selfRead(1, 120, 3) });
    expect((await h.get()).status).toBe(200); // IP 1, subject burst 1
    h.trs.store.advance(5_000);
    h.order.length = 0;
    const rejected = await h.get(); // Stage 1 admits (IP 2); Stage 2 rejects
    expect(rejected.status).toBe(429);
    expect(h.order).toEqual(["store:admit", "verify", "store:admit"]);
    // The first record has left the 10 s burst window. Had the rejected evaluation recorded
    // itself, the burst counter would still be full and this request would be rejected.
    h.trs.store.advance(5_500);
    expect((await h.get()).status).toBe(200); // IP 3
    // The rejected request did count against Stage 1: the IP rule (3/min) is now exhausted.
    h.order.length = 0;
    const exhausted = await h.get();
    expect(exhausted.status).toBe(429);
    expect(h.order).toEqual(["store:admit"]);
  });

  it("TC-RLM-004-219 a Stage 2 rejection (429) or failure (503) performs no Principal DB lookup (SPEC-110 §24.1)", async () => {
    const rejected = harness({ overrides: selfRead(1, 120) });
    expect((await rejected.get()).status).toBe(200);
    expect(rejected.order.filter((entry) => entry === "db")).toHaveLength(1);
    rejected.order.length = 0;
    expect((await rejected.get()).status).toBe(429);
    expect(rejected.order).toEqual(["store:admit", "verify", "store:admit"]);

    const failed = harness();
    const original = failed.trs.faults.evaluate;
    let evaluations = 0;
    failed.trs.faults.evaluate = (mode, rules, id) => {
      evaluations += 1;
      if (evaluations === 2) failed.trs.faults.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
      return original(mode, rules, id);
    };
    expect((await failed.get()).status).toBe(503);
    expect(failed.order).toEqual(["store:admit", "verify"]);
  });

  it("TC-RLM-004-205 health endpoints and CORS preflight never query the store, even when it is down", async () => {
    const h = harness();
    h.trs.faults.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
    h.trs.store.calls.length = 0;
    const env = peer();
    expect((await h.app.request("/internal/health/live", {}, env)).status).toBe(200);
    expect((await h.app.request("/internal/health/ready", {}, env)).status).toBe(200);
    expect((await h.app.request("/internal/health/live", { method: "HEAD" }, env)).status).toBe(
      200,
    );
    const preflight = await h.app.request(
      "/api/v1/self/principal",
      {
        method: "OPTIONS",
        headers: {
          Origin: WEB,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization",
        },
      },
      env,
    );
    expect(preflight.status).toBe(204);
    expect(h.trs.store.calls).toEqual([]);
    expect(h.trs.faults.faultedCalls).toBe(0);
  });

  it("TC-RLM-004-206 an unmatched path or unsupported method is evaluated by public_read per-IP rules only (no global rule)", async () => {
    const h = harness({
      overrides: {
        public_read: {
          burst_limit: 2,
          sustained_limit: 120,
          additional: { "public_read.global": { limit: 10000, window_seconds: 60 } },
        },
      },
    });
    const env = peer();
    expect((await h.app.request("/nope", {}, env)).status).toBe(404);
    expect((await h.app.request("/internal/health/live", { method: "PUT" }, env)).status).toBe(405);
    for (const call of h.trs.store.calls) {
      expect(call.mode).toBe("admit");
      expect(call.rules.map((rule) => [rule.limit, rule.windowMs])).toEqual([
        [2, 10_000],
        [120, 60_000],
      ]);
    }
    // The limit applies before the 404 / 405 decision.
    const third = await h.app.request("/nope", {}, env);
    expect(third.status).toBe(429);
    expect(third.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
  });

  it("TC-RLM-004-207 without a configured limiter every registered route fails closed, other routes are unaffected", async () => {
    const app = createApp({ webOrigin: WEB, ready: async () => true });
    const env = peer();
    expect((await app.request("/api/v1/self/principal", {}, env)).status).toBe(503);
    expect((await app.request("/auth/token", {}, env)).status).toBe(503);
    expect((await app.request("/nope", {}, env)).status).toBe(404);
    expect((await app.request("/internal/health/live", {}, env)).status).toBe(200);
  });

  it("TC-RLM-004-208 an unknown Client IP cannot be evaluated and fails closed without a store call", async () => {
    const h = harness();
    const res = await h.app.request("/api/v1/self/principal", {
      headers: { Authorization: `Bearer ${GOOD}` },
    });
    expect(res.status).toBe(503);
    expect(h.trs.store.calls).toEqual([]);
    expect(h.order).toEqual([]);
  });

  it("TC-RLM-004-209 with TRUSTED_PROXY_HOPS=0 a client-supplied forwarded header never changes the counted IP", async () => {
    const h = harness({ overrides: selfRead(30, 120, 1) });
    expect((await h.get({ headers: { "X-Forwarded-For": "198.51.100.1" } })).status).toBe(200);
    expect((await h.get({ headers: { "X-Forwarded-For": "198.51.100.2" } })).status).toBe(429);
    const proxied = harness({ overrides: selfRead(30, 120, 1), trustedProxyHops: 1 });
    expect((await proxied.get({ headers: { "X-Forwarded-For": "198.51.100.1" } })).status).toBe(
      200,
    );
    expect((await proxied.get({ headers: { "X-Forwarded-For": "198.51.100.2" } })).status).toBe(
      200,
    );
    expect((await proxied.get({ headers: { "X-Forwarded-For": "198.51.100.2" } })).status).toBe(
      429,
    );
  });

  it("TC-RLM-004-210 the login identifier rule counts one identifier across IPs and rejects before the proxy", async () => {
    let transportCalls = 0;
    const proxy = createAuthProxy(
      {
        baseUrl: "https://neon.example.test/auth",
        publicAuthOrigin: "https://api.example.test",
        webOrigin: WEB,
      },
      async () => {
        transportCalls += 1;
        return Response.json({ ok: true });
      },
    );
    const trs = createTestRateLimit({
      overrides: {
        auth_form_proxy: {
          burst_limit: 5,
          sustained_limit: 20,
          additional: { "auth_form_proxy.identifier": { limit: 2, window_seconds: 600 } },
        },
      },
    });
    const app = createApp({
      webOrigin: WEB,
      ready: async () => true,
      authProxy: proxy,
      rateLimit: trs.rateLimit,
    });
    const post = (email: string, ip: string, size = 0) =>
      app.request(
        new Request("https://api.example.test/auth/sign-in/email", {
          method: "POST",
          headers: { Origin: WEB, "Content-Type": "application/json" },
          body: JSON.stringify({ email, password: "synthetic", pad: "x".repeat(size) }),
        }),
        undefined,
        peer(ip),
      );
    expect((await post("User@Example.test", "203.0.113.1")).status).toBe(200);
    expect((await post(" user@example.test ", "203.0.113.2")).status).toBe(200);
    const blocked = await post("USER@example.test", "203.0.113.3");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
    expect(transportCalls).toBe(2);
    expect((await post("other@example.test", "203.0.113.3")).status).toBe(200);
    const text = await blocked.clone().text();
    expect(text).not.toContain("example.test");
    // An oversized body leaves only the IP rules in force and never turns into a 500.
    expect((await post("big@example.test", "203.0.113.4", 70_000)).status).not.toBe(500);
    expect(JSON.stringify(trs.store.keys())).not.toContain("example.test");
  });
});

describe("browser visibility of rate limit responses (SEC-ABU-007, SPEC-110 §21)", () => {
  it("TC-RLM-004-214 a Stage 1 429 or 503 is readable by the exact Web origin (Retry-After exposed) and by no other origin", async () => {
    const h = harness({ overrides: selfRead(30, 120, 1) });
    expect((await h.get({ headers: { Origin: WEB } })).status).toBe(200);
    const rejected = await h.get({ headers: { Origin: WEB } });
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("Access-Control-Allow-Origin")).toBe(WEB);
    expect(rejected.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id, Retry-After");
    expect(rejected.headers.get("Vary")).toContain("Origin");
    // SEC-ABU-025 / SEC-API-007: no credentialed CORS on /api/v1/*, and never a wildcard.
    expect(rejected.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(rejected.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
    const none = await h.get();
    expect(none.status).toBe(429);
    expect(none.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(none.headers.get("Access-Control-Expose-Headers")).toBeNull();
    const foreign = await h.get({ headers: { Origin: "https://evil.example.test" } });
    expect(foreign.status).toBe(429);
    expect(foreign.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(foreign.headers.get("Access-Control-Expose-Headers")).toBeNull();
    h.trs.faults.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
    const unavailable = await h.get({ ip: "203.0.113.50", headers: { Origin: WEB } });
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("Access-Control-Allow-Origin")).toBe(WEB);
    expect(unavailable.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("TC-RLM-004-215 a Stage 1 429 on /auth/* is readable by the exact Web origin only", async () => {
    const { app, trs } = authApp({ burst: 1 });
    const post = (headers: Record<string, string>) =>
      app.request(
        new Request("https://api.example.test/auth/sign-in/email", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ email: "cors@example.test", password: "synthetic" }),
        }),
        undefined,
        peer("203.0.113.60"),
      );
    expect((await post({ Origin: WEB })).status).toBe(200);
    const rejected = await post({ Origin: WEB });
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("Access-Control-Allow-Origin")).toBe(WEB);
    expect(rejected.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id, Retry-After");
    expect(rejected.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
    // SEC-ABU-025: /auth/* is credentialed for the exact Web origin (unlike /api/v1/*).
    expect(rejected.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(rejected.headers.get("Vary")).toContain("Origin");
    const foreign = await post({ Origin: "https://evil.example.test" });
    expect(foreign.status).toBe(429);
    expect(foreign.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(foreign.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    const none = await post({});
    expect(none.status).toBe(429);
    expect(none.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(none.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(trs.store.calls.length).toBeGreaterThan(0);
  });
});

/** The production app with the real auth proxy; the identifier rule allows 1 and the IP burst is configurable. */
function authApp(options: { burst: number }) {
  let transportCalls = 0;
  const proxy = createAuthProxy(
    {
      baseUrl: "https://neon.example.test/auth",
      publicAuthOrigin: "https://api.example.test",
      webOrigin: WEB,
    },
    async () => {
      transportCalls += 1;
      return Response.json({ ok: true });
    },
  );
  const trs = createTestRateLimit({
    overrides: {
      auth_form_proxy: {
        burst_limit: options.burst,
        sustained_limit: 20,
        additional: { "auth_form_proxy.identifier": { limit: 1, window_seconds: 600 } },
      },
    },
  });
  const app = createApp({
    webOrigin: WEB,
    ready: async () => true,
    authProxy: proxy,
    rateLimit: trs.rateLimit,
  });
  return { app, trs, transportCalls: () => transportCalls };
}
const IDENTIFIER_WINDOW_MS = 600_000;
const hasIdentifierRule = (call: { rules: readonly { windowMs: number }[] }) =>
  call.rules.some((rule) => rule.windowMs === IDENTIFIER_WINDOW_MS);

describe("login identifier extraction (SEC-ABU-024, TST-RLM-004)", () => {
  const login = (body: BodyInit | ReadableStream) =>
    new Request("https://api.example.test/auth/sign-in/email", {
      method: "POST",
      headers: { Origin: WEB, "Content-Type": "application/json" },
      body,
      ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
    } as RequestInit);

  it("TC-RLM-004-216 an unreadable identifier (over 64 KiB, invalid JSON, no email) skips only the identifier rule; the per-IP rule still applies", async () => {
    const { app, trs, transportCalls } = authApp({ burst: 4 });
    const ip = peer("203.0.113.70");
    const oversized = JSON.stringify({ email: "same@example.test", pad: "x".repeat(70_000) });
    const bodies = [oversized, oversized, "{ not json", JSON.stringify({ password: "synthetic" })];
    // The proxy may refuse such a body itself (413 / 400); what matters is that Stage 1 never
    // answers 429 for it: with an identifier limit of 1 a counted identifier would have.
    for (const body of bodies)
      expect((await app.request(login(body), undefined, ip)).status).not.toBe(429);
    expect(trs.store.calls).toHaveLength(4);
    for (const call of trs.store.calls) expect(hasIdentifierRule(call)).toBe(false);
    const rejected = await app.request(login(oversized), undefined, ip);
    expect(rejected.status).toBe(429);
    expect(transportCalls()).toBeLessThanOrEqual(1);
    // A readable identifier is still counted: the rule is on and its limit of 1 is spent.
    const other = peer("203.0.113.71");
    const readable = (email: string) => login(JSON.stringify({ email }));
    expect((await app.request(readable("ok@example.test"), undefined, other)).status).toBe(200);
    expect((await app.request(readable("OK@example.test"), undefined, other)).status).toBe(429);
    expect(JSON.stringify(trs.store.keys())).not.toContain("example.test");
  });

  it("TC-RLM-004-217 a body that stalls past 3 seconds leaves only the identifier rule out", async () => {
    const { app, trs } = authApp({ burst: 4 });
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        c.enqueue(new TextEncoder().encode('{"email":"slow@example.test",'));
      },
    });
    const pending = app.request(login(stream), undefined, peer("203.0.113.72"));
    await new Promise((resolve) => setTimeout(resolve, 3_400));
    expect(trs.store.calls).toHaveLength(1);
    expect(hasIdentifierRule(trs.store.calls[0] ?? { rules: [] })).toBe(false);
    try {
      controller?.close();
    } catch {
      // the proxy may already have cancelled the stalled stream
    }
    await Promise.resolve(pending).catch(() => undefined);
  }, 15_000);
});

describe("auth_session and auth_form_proxy routing (SEC-ABU-027, TST-RLM-004)", () => {
  type Call = { rules: readonly { limit: number; windowMs: number }[] };
  const shape = (call: Call | undefined) =>
    (call?.rules ?? []).map((rule) => [rule.limit, rule.windowMs]);
  const send = (app: ReturnType<typeof authApp>["app"], method: string, path: string, ip: string) =>
    app.request(
      new Request(`https://api.example.test${path}`, {
        method,
        headers: { Origin: WEB, "Content-Type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({ email: "route@example.test" }) } : {}),
      }),
      undefined,
      peer(ip),
    );

  it("TC-RLM-004-227 get-session, token and sign-out are auth_session: per-IP 100/10 s and 600/60 s only, no identifier rule", async () => {
    for (const [method, path, ip] of [
      ["GET", "/auth/get-session", "203.0.113.90"],
      ["GET", "/auth/token", "203.0.113.91"],
      ["POST", "/auth/sign-out", "203.0.113.92"],
    ] as const) {
      const { app, trs } = authApp({ burst: 4 });
      expect((await send(app, method, path, ip)).status, `${method} ${path}`).toBe(200);
      expect(trs.store.calls, `${method} ${path}`).toHaveLength(1);
      expect(shape(trs.store.calls[0]), `${method} ${path}`).toEqual([
        [100, 10_000],
        [600, 60_000],
      ]);
    }
  });

  it("TC-RLM-004-228 every other allowed /auth/* route stays auth_form_proxy (burst, sustained and, for POST, the identifier rule)", async () => {
    const { app, trs } = authApp({ burst: 4 });
    expect((await send(app, "POST", "/auth/sign-in/email", "203.0.113.93")).status).toBe(200);
    expect(shape(trs.store.calls[0])).toEqual([
      [4, 10_000],
      [20, 60_000],
      [1, 600_000],
    ]);
    const other = authApp({ burst: 4 });
    expect(
      (await send(other.app, "POST", "/auth/request-password-reset", "203.0.113.94")).status,
    ).toBe(200);
    expect(shape(other.trs.store.calls[0])).toEqual([
      [4, 10_000],
      [20, 60_000],
      [1, 600_000],
    ]);
  });
  it("TC-RLM-004-238 auth_form_proxy at its canonical ceiling: 10 attempts per 10 s from one IP are admitted, the 11th is a 429; the rules are 10/10 s, 40/60 s and 5 per identifier per 10 min", async () => {
    const trs = createTestRateLimit();
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
      rateLimit: trs.rateLimit,
    });
    const attempt = (n: number) =>
      app.request(
        new Request("https://api.example.test/auth/sign-in/email", {
          method: "POST",
          headers: { Origin: WEB, "Content-Type": "application/json" },
          body: JSON.stringify({ email: `shared-${n}@example.test` }),
        }),
        undefined,
        peer("203.0.113.140"),
      );
    for (let n = 1; n <= 10; n++) expect((await attempt(n)).status, `attempt ${n}`).toBe(200);
    expect((await attempt(11)).status).toBe(429);
    expect((trs.store.calls[0]?.rules ?? []).map((rule) => [rule.limit, rule.windowMs])).toEqual([
      [10, 10_000],
      [40, 60_000],
      [5, 600_000],
    ]);
  });

  it("TC-RLM-004-235 GET /auth/verify-email and GET /auth/magic-link/verify are auth_callback (per-IP 30/10 s and 120/60 s, no identifier rule); the OTP POST stays auth_form_proxy", async () => {
    for (const [path, ip] of [
      ["/auth/verify-email", "203.0.113.130"],
      ["/auth/magic-link/verify", "203.0.113.131"],
    ] as const) {
      const { app, trs } = authApp({ burst: 4 });
      expect((await send(app, "GET", path, ip)).status, path).toBe(200);
      expect(trs.store.calls, path).toHaveLength(1);
      expect(shape(trs.store.calls[0]), path).toEqual([
        [30, 10_000],
        [120, 60_000],
      ]);
    }
    const otp = authApp({ burst: 4 });
    expect(
      (await send(otp.app, "POST", "/auth/email-otp/verify-email", "203.0.113.132")).status,
    ).toBe(200);
    expect(shape(otp.trs.store.calls[0])).toEqual([
      [4, 10_000],
      [20, 60_000],
      [1, 600_000],
    ]);
    // A wrong method on a callback path is not auth_callback either.
    const wrong = authApp({ burst: 4 });
    await send(wrong.app, "POST", "/auth/verify-email", "203.0.113.133");
    expect(shape(wrong.trs.store.calls[0])).not.toContainEqual([30, 10_000]);
  });

  it("TC-RLM-004-229 an unregistered /auth/* path or a wrong method on a session path is public_read, not auth_session", async () => {
    for (const [method, path, ip] of [
      ["GET", "/auth/unknown-path", "203.0.113.95"],
      ["POST", "/auth/get-session", "203.0.113.96"],
      ["GET", "/auth/sign-out", "203.0.113.97"],
    ] as const) {
      const { app, trs } = authApp({ burst: 4 });
      const response = await send(app, method, path, ip);
      expect(response.status, `${method} ${path}`).not.toBe(429);
      expect(trs.store.calls.length, `${method} ${path}`).toBeGreaterThanOrEqual(1);
      const rules = shape(trs.store.calls[0]);
      expect(rules, `${method} ${path}`).toContainEqual([20, 10_000]);
      expect(rules, `${method} ${path}`).not.toContainEqual([100, 10_000]);
    }
  });

  it("TC-RLM-004-230 auth_session does not read the request body and its 429 carries the credentialed CORS of /auth/*", async () => {
    const { app, trs } = authApp({ burst: 4 });
    const ip = "203.0.113.98";
    let responseStatus = 200;
    for (let i = 0; i < 101 && responseStatus === 200; i++)
      responseStatus = (await send(app, "GET", "/auth/get-session", ip)).status;
    // The 101st request in the burst window is the first rejection (auth_form_proxy would stop at 10).
    expect(responseStatus).toBe(429);
    const rejected = await send(app, "GET", "/auth/get-session", ip);
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("Access-Control-Allow-Origin")).toBe(WEB);
    expect(rejected.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(rejected.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
    for (const call of trs.store.calls) expect(call.rules).toHaveLength(2);
  });
});

describe("login identifier normalization through the API (SEC-ABU-024, TST-RLM-004)", () => {
  const loginWith = (email: unknown) =>
    new Request("https://api.example.test/auth/sign-in/email", {
      method: "POST",
      headers: { Origin: WEB, "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

  it("TC-RLM-004-231 case, surrounding whitespace and NFKC variants of one identifier share a single counter", async () => {
    const { app } = authApp({ burst: 5 });
    expect(
      (await app.request(loginWith("User@Example.test"), undefined, peer("203.0.113.100"))).status,
    ).toBe(200);
    for (const [i, variant] of [
      "user@example.test",
      "  USER@EXAMPLE.TEST  ",
      "\u0055ser@Example.test\n",
      "ｕｓｅｒ@ｅｘａｍｐｌｅ.test",
    ].entries())
      expect(
        (await app.request(loginWith(variant), undefined, peer(`203.0.113.${101 + i}`))).status,
        JSON.stringify(variant),
      ).toBe(429);
    // A different identifier is not affected.
    expect(
      (await app.request(loginWith("other@example.test"), undefined, peer("203.0.113.110"))).status,
    ).toBe(200);
  });

  it("TC-RLM-004-232 a non-string, empty, whitespace-only or over-320-character identifier omits only the identifier rule; the per-IP rules are still evaluated", async () => {
    const { app, trs } = authApp({ burst: 5 });
    const values: unknown[] = [
      123,
      null,
      ["a@example.test"],
      { a: 1 },
      "",
      "   ",
      `${"a".repeat(320)}@example.test`,
    ];
    for (const [i, value] of values.entries()) {
      const before = trs.store.calls.length;
      const response = await app.request(loginWith(value), undefined, peer(`203.0.113.${120 + i}`));
      expect(response.status, JSON.stringify(value)?.slice(0, 40)).toBe(200);
      const calls = trs.store.calls.slice(before);
      expect(calls, JSON.stringify(value)?.slice(0, 40)).toHaveLength(1);
      const rules = (calls[0]?.rules ?? []).map((rule) => [rule.limit, rule.windowMs]);
      expect(rules).toEqual([
        [5, 10_000],
        [20, 60_000],
      ]);
    }
  });
});

describe("Client IP derivation through the API (SEC-API-031, TST-RLM-008)", () => {
  it("TC-RLM-008-002 only X-Forwarded-For is read; other forwarded headers and missing, short or unreadable chains use the direct peer", async () => {
    const proxied = harness({ overrides: selfRead(30, 120, 1), trustedProxyHops: 1 });
    const spoof = (value: string) => ({ Forwarded: `for=${value}`, "X-Real-IP": value });
    // Same peer, different spoofed alternatives: all collapse onto the peer, so the 2nd is limited.
    expect((await proxied.get({ headers: spoof("198.51.100.1") })).status).toBe(200);
    expect((await proxied.get({ headers: spoof("198.51.100.2") })).status).toBe(429);
    for (const forwarded of ["not-an-ip", "198.51.100.5, not-an-ip"]) {
      const h = harness({ overrides: selfRead(30, 120, 1), trustedProxyHops: 1 });
      expect((await h.get({ headers: { "X-Forwarded-For": forwarded } })).status).toBe(200);
      expect((await h.get({ headers: { "X-Forwarded-For": forwarded } })).status).toBe(429);
    }
    const short = harness({ overrides: selfRead(30, 120, 1), trustedProxyHops: 2 });
    expect((await short.get({ headers: { "X-Forwarded-For": "198.51.100.7" } })).status).toBe(200);
    expect((await short.get({ headers: { "X-Forwarded-For": "198.51.100.8" } })).status).toBe(429);
    // With a long enough chain the Nth entry from the right identifies the client.
    const full = harness({ overrides: selfRead(30, 120, 1), trustedProxyHops: 2 });
    const chain = (client: string) => ({ "X-Forwarded-For": `192.0.2.1, ${client}, 10.0.0.1` });
    expect((await full.get({ headers: chain("198.51.100.7") })).status).toBe(200);
    expect((await full.get({ headers: chain("198.51.100.8") })).status).toBe(200);
    expect((await full.get({ headers: chain("198.51.100.8") })).status).toBe(429);
  });
});

/** A minimal app that mounts the production Stage 1 / Stage 2 middleware on synthetic routes. */
function miniApp(
  trs: TestRateLimit,
  routes: Record<string, RouteClassId>,
  options: {
    verify?: (token: string) => Promise<{ subject: string }>;
    /** Per-subject roles (default: the shared `setRoles` value). */
    rolesFor?: (subject: string) => ("STAFF" | "ADMINISTRATOR")[];
  } = {},
) {
  const order: string[] = [];
  const app = new Hono<ApiEnvironment>();
  app.use("*", async (c, next) => {
    c.set("requestId", randomUUID());
    await next();
  });
  app.use(
    "*",
    createRateLimitStageOne({
      rateLimit: trs.rateLimit,
      classify: (_method, path) => {
        const classId = routes[path.split("/").slice(0, 2).join("/")];
        return classId ? { classId, operationId: null } : undefined;
      },
    }),
  );
  app.onError((error, c) => {
    if (error instanceof ApiFailure) {
      if (error.code === "RATE_LIMIT_EXCEEDED")
        c.header("Retry-After", String(error.retryAfterSeconds));
      return c.json({ code: error.code }, error.code === "RATE_LIMIT_EXCEEDED" ? 429 : 503);
    }
    if (error instanceof AuthFailure)
      return c.json({ code: error.kind }, error.kind === "unauthenticated" ? 401 : 403);
    return c.json({ code: "INTERNAL_ERROR" }, 500);
  });
  const hooks = createPrincipalRateLimitHooks(trs.rateLimit.limiter);
  let verified = true;
  let roles: ("STAFF" | "ADMINISTRATOR")[] = [];
  const principal = requirePrincipal(
    {
      verify: async (token) => {
        order.push("verify");
        if (options.verify) return options.verify(token);
        if (token.endsWith("YmFk")) throw new AuthFailure("unauthenticated");
        return { subject: SUBJECT };
      },
    },
    {
      findByAuthSubject: async (subject: string) => {
        order.push("db");
        return {
          directory: { authSubject: subject, emailVerified: verified },
          profile: { id: "1", publicRef: PROFILE_REF, authSubject: subject },
          roles: options.rolesFor ? options.rolesFor(subject) : roles,
        };
      },
    },
    hooks,
  );
  return {
    app,
    order,
    principal,
    hooks,
    setVerified: (value: boolean) => {
      verified = value;
    },
    setRoles: (value: typeof roles) => {
      roles = value;
    },
  };
}
const call = (app: Hono<ApiEnvironment>, path: string, token = GOOD, ip = IP) =>
  app.request(path, { headers: { Authorization: `Bearer ${token}` } }, peer(ip));
const records = (trs: TestRateLimit) => trs.store.calls.filter((entry) => entry.mode === "record");

describe("Authentication-failure guard at the API layer (TST-RLM-005)", () => {
  it("TC-RLM-005-201 only token verification failures are recorded; valid tokens, unverified Email, denial and Business failures are not", async () => {
    const trs = createTestRateLimit();
    const m = miniApp(trs, { "/buy": "purchase_checkout" });
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    m.app.get("/buy/email", m.principal, requireVerifiedEmail(), (c) => c.json({ ok: true }));
    m.app.get("/buy/cap", m.principal, requireCapability("entry_checkin.execute"), (c) =>
      c.json({ ok: true }),
    );
    m.app.get("/buy/rule", m.principal, (c) => c.json({ code: "DOMAIN_RULE_VIOLATION" }, 422));
    const step = () => trs.store.advance(11_000); // keep the per-subject burst window empty
    expect((await call(m.app, "/buy/ok")).status).toBe(200);
    step();
    m.setVerified(false);
    expect((await call(m.app, "/buy/email")).status).toBe(403);
    m.setVerified(true);
    step();
    expect((await call(m.app, "/buy/cap")).status).toBe(403);
    step();
    expect((await call(m.app, "/buy/rule")).status).toBe(422);
    expect(records(trs)).toEqual([]);
    expect((await call(m.app, "/buy/ok", BAD)).status).toBe(401);
    expect((await call(m.app, "/buy/ok", BAD)).status).toBe(401);
    expect(records(trs)).toHaveLength(2);
    // A request without a usable Authorization header is also a failed verification.
    expect((await m.app.request("/buy/ok", {}, peer())).status).toBe(401);
    expect(records(trs)).toHaveLength(3);
  });

  it("TC-RLM-005-202 at or above the limit Stage 1 answers 429 and token verification is not reached, even for a valid token", async () => {
    const trs = createTestRateLimit({
      overrides: { auth_failure_guard_attendee: guard(2) },
    });
    const m = miniApp(trs, { "/buy": "purchase_checkout" });
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    expect((await call(m.app, "/buy/ok", BAD)).status).toBe(401);
    expect((await call(m.app, "/buy/ok", BAD)).status).toBe(401);
    m.order.length = 0;
    const res = await call(m.app, "/buy/ok", GOOD);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
    expect(m.order).toEqual([]);
    // Another IP is not affected.
    expect((await call(m.app, "/buy/ok", GOOD, "203.0.113.77")).status).toBe(200);
  });

  it("TC-RLM-005-203 attendee and operator guards are configured and evaluated independently", async () => {
    const trs = createTestRateLimit({
      overrides: {
        auth_failure_guard_attendee: guard(1),
        auth_failure_guard_operator: guard(3),
      },
    });
    const m = miniApp(trs, { "/buy": "purchase_checkout", "/handoff": "goods_handoff" });
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    m.app.get("/handoff/ok", m.principal, (c) => c.json({ ok: true }));
    expect((await call(m.app, "/buy/ok", BAD)).status).toBe(401);
    expect((await call(m.app, "/buy/ok")).status).toBe(429);
    // Operator routes use their own counter and limit.
    expect((await call(m.app, "/handoff/ok")).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await call(m.app, "/handoff/ok", BAD)).status).toBe(401);
    expect((await call(m.app, "/handoff/ok")).status).toBe(429);
  });

  it("TC-RLM-005-204 an unavailable auth service is not counted, and a store failure while recording is a 503, not a 401", async () => {
    const trs = createTestRateLimit();
    const unavailable = miniApp(
      trs,
      { "/buy": "purchase_checkout" },
      {
        verify: async () => {
          throw new AuthFailure("unavailable");
        },
      },
    );
    unavailable.app.get("/buy/ok", unavailable.principal, (c) => c.json({ ok: true }));
    expect((await call(unavailable.app, "/buy/ok")).status).toBe(403);
    expect(records(trs)).toEqual([]);

    const trs2 = createTestRateLimit();
    const m = miniApp(
      trs2,
      { "/buy": "purchase_checkout" },
      {
        verify: async () => {
          trs2.faults.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
          throw new AuthFailure("unauthenticated");
        },
      },
    );
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    const res = await call(m.app, "/buy/ok", BAD);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("TEMPORARY_UNAVAILABLE");
  });

  it("TC-RLM-005-205 concurrent failures may overrun the guard limit, but a non-guard rule never admits more than its limit", async () => {
    const trs = createTestRateLimit({ overrides: { auth_failure_guard_attendee: guard(2) } });
    const m = miniApp(trs, { "/buy": "purchase_checkout" });
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    const batch = await Promise.all(Array.from({ length: 8 }, () => call(m.app, "/buy/ok", BAD)));
    expect(batch.every((res) => res.status === 401)).toBe(true);
    expect(records(trs).length).toBe(8);
    expect((await call(m.app, "/buy/ok", BAD)).status).toBe(429);

    const strict = createTestRateLimit({ overrides: selfRead(3, 120) });
    const s = miniApp(strict, { "/self": "self_read" });
    s.app.get("/self/ok", s.principal, (c) => c.json({ ok: true }));
    const statuses = (
      await Promise.all(Array.from({ length: 10 }, () => call(s.app, "/self/ok")))
    ).map((res) => res.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(3);
    expect(statuses.filter((status) => status === 429)).toHaveLength(7);
  });
});

const OTHER = "0d6a2a35-1a52-4d3a-8f55-42b5d4ad06a1";
const ADMIN_SUBJECT = "6f1c7d3a-5b0e-4a6d-9f21-8c3e4d5a6b7c";
const ADMIN_TOKEN = "e30.e30.YWRtaW4";
const OTHER_TOKEN = "e30.e30.b3RoZXI";
const subjectOf = (token: string) =>
  token.endsWith("YWRtaW4") ? ADMIN_SUBJECT : token.endsWith("b3RoZXI") ? OTHER : SUBJECT;
/** Roles by subject: the administrator has them, the ordinary valid-JWT holder has none. */
const rolesBySubject = (subject: string): ("STAFF" | "ADMINISTRATOR")[] =>
  subject === ADMIN_SUBJECT ? ["ADMINISTRATOR", "STAFF"] : [];
const authedApp = (trs: TestRateLimit, routes: Record<string, RouteClassId>) =>
  miniApp(trs, routes, {
    verify: async (token) => {
      if (token.endsWith("YmFk")) throw new AuthFailure("unauthenticated");
      return { subject: subjectOf(token) };
    },
    rolesFor: rolesBySubject,
  });
/** A complete override that only lowers `limit` of one Stage 3 rule (and keeps the Stage 2 subject rules out of the way). */
const stage3Override = (
  classId: string,
  rules: Record<string, [limit: number, windowSeconds: number]>,
  burst: number,
  sustained: number,
) => ({
  [classId]: {
    burst_limit: burst,
    sustained_limit: sustained,
    additional: Object.fromEntries(
      Object.entries(rules).map(([id, [limit, window_seconds]]) => [id, { limit, window_seconds }]),
    ),
  },
});
/** Number of times a rule of this exact shape was presented to the store. */
const evaluationsOf = (trs: TestRateLimit, limit: number, windowMs: number) =>
  trs.store.calls.filter(
    (entry) =>
      entry.mode === "admit" &&
      entry.rules.some((rule) => rule.limit === limit && rule.windowMs === windowMs),
  ).length;

describe("resource rule evaluation (TST-RLM-004)", () => {
  it("TC-RLM-004-211 the Stage 3 key is evaluated before any lookup, so existing and missing resources behave identically for an authorized principal", async () => {
    const outcome = async (resource: string) => {
      const trs = createTestRateLimit({
        overrides: {
          qr_display: {
            burst_limit: 6,
            sustained_limit: 30,
            additional: { "qr_display.ticket": { limit: 3, window_seconds: 60 } },
          },
        },
      });
      const m = miniApp(trs, { "/qr": "qr_display" });
      let lookups = 0;
      m.app.get(
        "/qr/:id",
        m.principal,
        // The owner relation (SPEC-110 §24 step 6) is what authorizes this request.
        async (c, next) => {
          markAuthorizationConfirmed(c);
          await next();
        },
        requireResourceRateLimit(trs.rateLimit.limiter, (c) => ({
          "qr_display.ticket": c.req.param("id") ?? "",
        })),
        (c) => {
          lookups += 1;
          return c.req.param("id") === "exists"
            ? c.json({ ok: true })
            : c.json({ code: "NOT_FOUND" }, 404);
        },
      );
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await call(m.app, `/qr/${resource}`);
        statuses.push(res.status === 429 ? 429 : 0);
      }
      return { statuses, lookups, keys: trs.store.keys().length };
    };
    const existing = await outcome("exists");
    const missing = await outcome("missing");
    expect(existing).toEqual(missing);
    expect(existing.statuses).toEqual([0, 0, 0, 429, 429]);
    expect(existing.lookups).toBe(3);
  });

  it("TC-RLM-004-212 a Stage 3 store failure is a 503 before the handler runs", async () => {
    const trs = createTestRateLimit();
    const m = miniApp(trs, { "/qr": "qr_display" });
    let handled = 0;
    m.app.get(
      "/qr/:id",
      m.principal,
      async (c, next) => {
        markAuthorizationConfirmed(c);
        await next();
      },
      requireResourceRateLimit(trs.rateLimit.limiter, (c) => ({
        "qr_display.ticket": c.req.param("id") ?? "",
      })),
      (c) => {
        handled += 1;
        return c.json({ ok: true });
      },
    );
    // Stages 1 and 2 pass; only the third store operation (Stage 3) fails.
    const evaluate = trs.store.evaluate.bind(trs.store);
    let operations = 0;
    trs.store.evaluate = async (mode, rules, id) => {
      operations += 1;
      if (operations === 3) throw new RateLimitStoreError("error");
      return evaluate(mode, rules, id);
    };
    const res = await call(m.app, "/qr/a");
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("TEMPORARY_UNAVAILABLE");
    expect(operations).toBe(3);
    expect(handled).toBe(0);
  });
});

describe("Stage 3 shared resource counters after authorization (SEC-ABU-029, TST-RLM-004)", () => {
  it("TC-RLM-004-239 Stage 3 runs after Role + Capability and before the Domain precondition: guard check, verify, store, db, then store", async () => {
    const trs = createTestRateLimit();
    const m = authedApp(trs, { "/adm": "role_assignment" });
    const order = m.order;
    const evaluate = trs.store.evaluate.bind(trs.store);
    trs.store.evaluate = async (mode, rules, id) => {
      order.push(`store:${mode}`);
      return evaluate(mode, rules, id);
    };
    m.app.get(
      "/adm/roles/:target",
      m.principal,
      requireCapability("role_assignment.manage"),
      requireResourceRateLimit(trs.rateLimit.limiter, (c) => ({
        "role_assignment.profile": c.req.param("target") ?? "",
      })),
      (c) => {
        order.push("domain");
        return c.json({ ok: true });
      },
    );
    const res = await call(m.app, "/adm/roles/P1", ADMIN_TOKEN);
    expect(res.status).toBe(200);
    expect(order).toEqual(["store:check", "verify", "store:admit", "db", "store:admit", "domain"]);
  });

  it("TC-RLM-004-240 a valid-JWT holder without Administrator cannot consume the target-profile slot of API-ADM-ROL-002: the 403s leave the counter untouched and the real administrator can still grant", async () => {
    const trs = createTestRateLimit({
      overrides: stage3Override("role_assignment", { "role_assignment.profile": [5, 600] }, 3, 10),
    });
    const m = authedApp(trs, { "/adm": "role_assignment" });
    let granted = 0;
    m.app.get(
      "/adm/roles/:target",
      m.principal,
      requireCapability("role_assignment.manage"),
      requireResourceRateLimit(trs.rateLimit.limiter, (c) => ({
        "role_assignment.profile": c.req.param("target") ?? "",
      })),
      (c) => {
        granted += 1;
        return c.json({ ok: true });
      },
    );
    // An ordinary principal names the victim profile again and again (403 every time).
    for (let i = 0; i < 12; i++) {
      trs.store.advance(11_000);
      expect((await call(m.app, "/adm/roles/VICTIM", OTHER_TOKEN)).status).toBe(403);
    }
    expect(evaluationsOf(trs, 5, 600_000)).toBe(0);
    expect(granted).toBe(0);
    // The legitimate administrator still has the whole slot for the same target.
    for (let i = 0; i < 5; i++) {
      trs.store.advance(11_000);
      expect((await call(m.app, "/adm/roles/VICTIM", ADMIN_TOKEN)).status).toBe(200);
    }
    expect(granted).toBe(5);
    // The principal that holds the Capability consumes Stage 3: limit + 1 is a 429.
    trs.store.advance(11_000);
    const res = await call(m.app, "/adm/roles/VICTIM", ADMIN_TOKEN);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
    expect(granted).toBe(5);
  });

  const cases: {
    name: string;
    classId: RouteClassId;
    rule: string;
    limit: number;
    windowSeconds: number;
    /** Every additional rule of the class (a class override is complete). */
    rules: Record<string, [limit: number, windowSeconds: number]>;
    stepMs: number;
    burst: number;
    sustained: number;
    capability?: Parameters<typeof requireCapability>[0];
    /** Owner-relation (step 6) route: the Ticket belongs to SUBJECT only. */
    ownerOnly?: boolean;
  }[] = [
    {
      name: "high_risk_recovery target resource (per minute)",
      classId: "high_risk_recovery",
      rule: "high_risk_recovery.resource_minute",
      limit: 2,
      windowSeconds: 60,
      rules: {
        "high_risk_recovery.resource_minute": [2, 60],
        "high_risk_recovery.resource_hour": [10, 3600],
      },
      stepMs: 11_000,
      burst: 2,
      sustained: 6,
      capability: "recovery.exception.execute",
    },
    {
      name: "high_risk_recovery target resource (per hour)",
      classId: "high_risk_recovery",
      rule: "high_risk_recovery.resource_hour",
      limit: 4,
      windowSeconds: 3600,
      rules: {
        "high_risk_recovery.resource_minute": [2, 60],
        "high_risk_recovery.resource_hour": [4, 3600],
      },
      stepMs: 31_000,
      burst: 2,
      sustained: 6,
      capability: "recovery.exception.execute",
    },
    {
      name: "admin_mutation target resource",
      classId: "admin_mutation",
      rule: "admin_mutation.resource",
      limit: 4,
      windowSeconds: 60,
      rules: { "admin_mutation.resource": [4, 60] },
      stepMs: 11_000,
      burst: 10,
      sustained: 30,
      capability: "public_content.manage",
    },
    {
      name: "goods_handoff Goods Item",
      classId: "goods_handoff",
      rule: "goods_handoff.item",
      limit: 4,
      windowSeconds: 60,
      rules: { "goods_handoff.item": [4, 60] },
      stepMs: 11_000,
      burst: 10,
      sustained: 60,
      capability: "goods_handoff.execute",
    },
    {
      name: "staff_checkin QR digest",
      classId: "staff_checkin",
      rule: "staff_checkin.qr_digest",
      limit: 4,
      windowSeconds: 60,
      rules: { "staff_checkin.qr_digest": [4, 60], "staff_checkin.ip": [300, 60] },
      stepMs: 11_000,
      burst: 40,
      sustained: 180,
      capability: "entry_checkin.execute",
    },
    {
      name: "qr_display Ticket (another principal's Ticket is a 404)",
      classId: "qr_display",
      rule: "qr_display.ticket",
      limit: 4,
      windowSeconds: 60,
      rules: { "qr_display.ticket": [4, 60] },
      stepMs: 11_000,
      burst: 6,
      sustained: 30,
      ownerOnly: true,
    },
  ];
  for (const scenario of cases)
    it(`TC-RLM-004-241 ${scenario.name}: a 403 / 404 leaves the shared counter untouched; the authorized principal consumes it and limit + 1 is a 429 that never reaches the Domain precondition`, async () => {
      const trs = createTestRateLimit({
        overrides: stage3Override(
          scenario.classId,
          scenario.rules,
          scenario.burst,
          scenario.sustained,
        ),
      });
      const prefix = `/${scenario.classId}`;
      const m = authedApp(trs, { [prefix]: scenario.classId });
      let digestDerivations = 0;
      let domain = 0;
      const owner: import("hono").MiddlewareHandler<ApiEnvironment> = async (c, next) => {
        // Owner relation (SPEC-110 §24 step 6): only SUBJECT owns the Ticket.
        if (c.get("principal").subject !== SUBJECT)
          return c.json({ code: "RESOURCE_NOT_FOUND" }, 404);
        markAuthorizationConfirmed(c);
        await next();
        return;
      };
      m.app.get(
        `${prefix}/:resource`,
        m.principal,
        scenario.ownerOnly ? owner : requireCapability(scenario.capability as never),
        requireResourceRateLimit(trs.rateLimit.limiter, (c) => {
          digestDerivations += 1; // the QR digest is derived only after authorization
          // Every resource-phase rule of the class needs its key (the `.ip` rule is Stage 1).
          return Object.fromEntries(
            Object.keys(scenario.rules)
              .filter((rule) => !rule.endsWith(".ip"))
              .map((rule) => [rule, `digest-of-${c.req.param("resource")}`]),
          );
        }),
        (c) => {
          domain += 1;
          return c.json({ ok: true });
        },
      );
      const authorized = scenario.ownerOnly ? GOOD : ADMIN_TOKEN;
      const outsider = OTHER_TOKEN;
      for (let i = 0; i < 12; i++) {
        trs.store.advance(scenario.stepMs);
        const res = await call(m.app, `${prefix}/TARGET`, outsider);
        expect([403, 404]).toContain(res.status);
      }
      expect(digestDerivations).toBe(0);
      expect(domain).toBe(0);
      expect(
        evaluationsOf(trs, scenario.limit, scenario.windowSeconds * 1000),
        "no Stage 3 evaluation for the unauthorized principal",
      ).toBe(0);
      for (let i = 0; i < scenario.limit; i++) {
        trs.store.advance(scenario.stepMs);
        expect((await call(m.app, `${prefix}/TARGET`, authorized)).status).toBe(200);
      }
      expect(domain).toBe(scenario.limit);
      trs.store.advance(scenario.stepMs);
      const over = await call(m.app, `${prefix}/TARGET`, authorized);
      expect(over.status).toBe(429);
      expect(over.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
      expect(domain).toBe(scenario.limit);
      expect(digestDerivations).toBe(scenario.limit + 1);
    });

  it("TC-RLM-004-242 a failed authentication never reaches Stage 3, and distinct targets have distinct Stage 3 keys", async () => {
    const trs = createTestRateLimit({
      overrides: stage3Override("admin_mutation", { "admin_mutation.resource": [2, 60] }, 10, 30),
    });
    const m = authedApp(trs, { "/adm": "admin_mutation" });
    m.app.get(
      "/adm/:id",
      m.principal,
      requireCapability("public_content.manage"),
      requireResourceRateLimit(trs.rateLimit.limiter, (c) => ({
        "admin_mutation.resource": c.req.param("id") ?? "",
      })),
      (c) => c.json({ ok: true }),
    );
    expect((await call(m.app, "/adm/X", BAD)).status).toBe(401);
    expect(evaluationsOf(trs, 2, 60_000)).toBe(0);
    expect((await call(m.app, "/adm/X", ADMIN_TOKEN)).status).toBe(200);
    expect((await call(m.app, "/adm/X", ADMIN_TOKEN)).status).toBe(200);
    expect((await call(m.app, "/adm/X", ADMIN_TOKEN)).status).toBe(429);
    // A different target of the same administrator is a different Stage 3 key.
    expect((await call(m.app, "/adm/Y", ADMIN_TOKEN)).status).toBe(200);
  });

  it("TC-RLM-004-243 a route that evaluates Stage 3 without an authorization check is refused (500) and never touches the shared counters", async () => {
    const trs = createTestRateLimit();
    const m = authedApp(trs, { "/qr": "qr_display" });
    m.app.get(
      "/qr/:id",
      m.principal,
      requireResourceRateLimit(trs.rateLimit.limiter, (c) => ({
        "qr_display.ticket": c.req.param("id") ?? "",
      })),
      (c) => c.json({ ok: true }),
    );
    const res = await call(m.app, "/qr/a");
    expect(res.status).toBe(500);
    expect(evaluationsOf(trs, 12, 60_000)).toBe(0);
  });
});

describe("Webhook global rule after signature verification (SEC-ABU-030, TST-RLM-004)", () => {
  /** A mini Webhook endpoint: the signature check stands in for the provider verification (no DB). */
  const webhookApp = (trs: TestRateLimit, classId: "stripe_webhook" | "resend_webhook") => {
    const app = new Hono<ApiEnvironment>();
    const seen = { signatureChecks: 0, receipts: 0 };
    app.use("*", async (c, next) => {
      c.set("requestId", randomUUID());
      await next();
    });
    app.use(
      "*",
      createRateLimitStageOne({
        rateLimit: trs.rateLimit,
        classify: () => ({ classId, operationId: null }),
      }),
    );
    app.onError((error, c) => {
      if (error instanceof ApiFailure) {
        if (error.code === "RATE_LIMIT_EXCEEDED")
          c.header("Retry-After", String(error.retryAfterSeconds));
        return c.json({ code: error.code }, error.code === "RATE_LIMIT_EXCEEDED" ? 429 : 503);
      }
      return c.json({ code: "INTERNAL_ERROR" }, 500);
    });
    app.post(
      "/hook",
      async (c, next) => {
        seen.signatureChecks += 1;
        if (c.req.header("x-signature") !== "valid")
          return c.json({ code: "INVALID_SIGNATURE" }, 400);
        await next();
        return;
      },
      requireWebhookGlobalRateLimit(trs.rateLimit.limiter),
      (c) => {
        seen.receipts += 1; // receipt dedupe / creation (DB access)
        return c.json({ ok: true });
      },
    );
    const send = (ip: string, signature: string) =>
      app.request("/hook", { method: "POST", headers: { "x-signature": signature } }, peer(ip));
    return { send, seen };
  };
  const globalOverride = (classId: "stripe_webhook" | "resend_webhook", limit: number) =>
    stage3Override(classId, { [`${classId}.global`]: [limit, 60] }, 100, 300);

  for (const classId of ["stripe_webhook", "resend_webhook"] as const)
    it(`TC-RLM-004-251 ${classId}: invalid signatures from many source IPs never consume the global rule, so a valid signature is still processed; only verified requests count and global + 1 is a 429`, async () => {
      const trs = createTestRateLimit({ overrides: globalOverride(classId, 6) });
      const hook = webhookApp(trs, classId);
      // 60 source IPs, each far inside its own burst limit, all with invalid signatures.
      for (let ip = 1; ip <= 60; ip++)
        for (let i = 0; i < 3; i++)
          expect((await hook.send(`198.51.100.${ip}`, "forged")).status).toBe(400);
      expect(hook.seen.receipts).toBe(0);
      expect(evaluationsOf(trs, 6, 60_000)).toBe(0);
      for (let i = 0; i < 6; i++)
        expect((await hook.send("203.0.113.77", "valid")).status).toBe(200);
      expect(hook.seen.receipts).toBe(6);
      const over = await hook.send("203.0.113.77", "valid");
      expect(over.status).toBe(429);
      expect(over.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
      expect((await over.json()).code).toBe("RATE_LIMIT_EXCEEDED");
      expect(hook.seen.receipts).toBe(6);
      // An invalid signature after the global limit is still a plain 400, not a 429.
      expect((await hook.send("198.51.100.200", "forged")).status).toBe(400);
    });

  it("TC-RLM-004-252 before the signature check only the source IP burst / sustained rules are evaluated: the global rule is absent from Stage 1", async () => {
    const trs = createTestRateLimit();
    const hook = webhookApp(trs, "stripe_webhook");
    await hook.send("203.0.113.5", "forged");
    const stage1 = trs.store.calls[0];
    expect(stage1?.rules.map((rule) => rule.limit).sort((a, b) => a - b)).toEqual([100, 300]);
    expect(stage1?.rules.some((rule) => rule.limit === 3000)).toBe(false);
    await hook.send("203.0.113.5", "valid");
    const stage2 = trs.store.calls[2];
    expect(stage2?.rules.map((rule) => [rule.limit, rule.windowMs])).toEqual([[3000, 60_000]]);
  });

  it("TC-RLM-004-253 a source IP over its own burst limit is rejected in Stage 1 before the signature check, and a Stage 2 store failure is a 503 that creates no Receipt", async () => {
    const trs = createTestRateLimit({
      overrides: stage3Override("stripe_webhook", { "stripe_webhook.global": [3000, 60] }, 2, 300),
    });
    const hook = webhookApp(trs, "stripe_webhook");
    expect((await hook.send("203.0.113.9", "valid")).status).toBe(200);
    expect((await hook.send("203.0.113.9", "valid")).status).toBe(200);
    const checksBefore = hook.seen.signatureChecks;
    expect((await hook.send("203.0.113.9", "valid")).status).toBe(429);
    expect(hook.seen.signatureChecks).toBe(checksBefore);

    const evaluate = trs.store.evaluate.bind(trs.store);
    let operations = 0;
    trs.store.evaluate = async (mode, rules, id) => {
      operations += 1;
      if (operations === 2) throw new RateLimitStoreError("error"); // the post-signature global rule
      return evaluate(mode, rules, id);
    };
    const receipts = hook.seen.receipts;
    expect((await hook.send("203.0.113.44", "valid")).status).toBe(503);
    expect(hook.seen.receipts).toBe(receipts);
  });
});

describe("/auth/* allowlist at runtime (API-RLC-004, TST-RLM-007)", () => {
  const proxied: string[] = [];
  const authApp = (trs: TestRateLimit) =>
    createApp({
      webOrigin: WEB,
      ready: async () => true,
      rateLimit: trs.rateLimit,
      authProxy: {
        handle: async (request: Request) => {
          proxied.push(`${request.method} ${new URL(request.url).pathname}`);
          return new Response(null, { status: 204 });
        },
      } as never,
    });

  it("TC-RLM-007-201 every route of the SPEC-110 §23.1 table is served in its class; a route or method outside it is a 404 / 405 evaluated by public_read per-IP only", async () => {
    const trs = createTestRateLimit();
    const app = authApp(trs);
    proxied.length = 0;
    for (const [method, path, classId] of CANONICAL_AUTH_ALLOWLIST) {
      trs.store.calls.length = 0;
      const res = await app.request(
        path,
        {
          method,
          ...(method === "POST"
            ? {
                body: JSON.stringify({ email: `user-${path.length}-${method}@example.com` }),
                headers: { "content-type": "application/json" },
              }
            : {}),
        },
        peer(),
      );
      expect(res.status, `${method} ${path}`).toBe(204);
      const first = trs.store.calls[0];
      expect(first?.mode).toBe("admit");
      const expectedBurst = RATE_LIMIT_REGISTRY[classId].burst;
      expect(first?.rules[0]?.limit, `${path} is evaluated as ${classId}`).toBe(expectedBurst);
    }
    expect(proxied).toHaveLength(15);
    proxied.length = 0;
    for (const [method, path] of [
      ["GET", "/auth/sign-in/email"],
      ["POST", "/auth/get-session"],
      ["POST", "/auth/verify-email"],
      ["POST", "/auth/sign-in/phone"],
      ["GET", "/auth/callback/google"],
      ["GET", "/auth/ok"],
    ] as const) {
      trs.store.calls.length = 0;
      const res = await app.request(path, { method }, peer());
      expect([404, 405], `${method} ${path}`).toContain(res.status);
      expect(trs.store.calls).toHaveLength(1);
      expect(trs.store.calls[0]?.rules.map((rule) => [rule.limit, rule.windowMs])).toEqual([
        [RATE_LIMIT_REGISTRY.public_read.burst, 10_000],
        [RATE_LIMIT_REGISTRY.public_read.sustained, 60_000],
      ]);
    }
    expect(proxied).toEqual([]);
  });
});

describe("rate limit events and metrics at the API layer (TST-RLM-009)", () => {
  const collect = (lines: string[]) =>
    lines.map((line) => JSON.parse(line) as Record<string, unknown>);

  it("TC-RLM-009-201 rejected and store_unavailable are logged without key, IP or Subject; allowed is metric only", async () => {
    const metrics = createRateLimitMetrics({ environment: "test", classIds: RATE_LIMIT_CLASS_IDS });
    const h = harness({
      overrides: selfRead(30, 120, 2),
      limiter: { observer: createRateLimitMetricsObserver(metrics) },
    });
    expect((await h.get()).status).toBe(200);
    expect(collect(h.lines).filter((e) => e.event_name === "ratelimit.decision.completed")).toEqual(
      [],
    );
    expect((await h.get()).status).toBe(200);
    expect((await h.get()).status).toBe(429);
    h.trs.faults.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
    expect((await h.get({ ip: "203.0.113.200" })).status).toBe(503);
    const decisions = collect(h.lines).filter(
      (e) => e.event_name === "ratelimit.decision.completed",
    );
    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toMatchObject({
      result: "REJECTED",
      error_code: "RATE_LIMIT_EXCEEDED",
      failure_class: "SECURITY_FAILURE",
      class_id: "self_read",
      rule_category: "sustained",
      retry_after_seconds: expect.any(Number),
      operation_id: "API-AUTH-001",
    });
    expect(decisions[1]).toMatchObject({
      result: "FAILED",
      error_code: "TEMPORARY_UNAVAILABLE",
      // SPEC-150 REL-SEC-007: the HTTP result is a 503, the classification is a security failure.
      failure_class: "SECURITY_FAILURE",
      class_id: "self_read",
    });
    expect(decisions[1]).not.toHaveProperty("retry_after_seconds");
    const failClosed = collect(h.lines).filter(
      (e) => e.event_name === "security.fail_closed.triggered",
    );
    expect(failClosed).toHaveLength(1);
    expect(failClosed[0]).toMatchObject({
      control_category: "rate_limit",
      error_code: "TEMPORARY_UNAVAILABLE",
      failure_class: "SECURITY_FAILURE",
    });
    const all = h.lines.join("\n");
    for (const secret of [IP, "203.0.113.200", SUBJECT, "rl:v", GOOD])
      expect(all).not.toContain(secret);
    const snapshot = metrics.snapshot();
    const count = (result: string) =>
      snapshot.decisions.filter((d) => d.result === result).reduce((sum, d) => sum + d.value, 0);
    // Every evaluation is counted: allowed ones appear in the metric although they are not logged.
    expect(count("allowed")).toBeGreaterThanOrEqual(3);
    expect(count("rejected")).toBe(1);
    expect(count("store_unavailable")).toBe(1);
    for (const series of snapshot.decisions) {
      expect(Object.keys(series).sort()).toEqual(["class_id", "environment", "result", "value"]);
      expect(RATE_LIMIT_CLASS_IDS).toContain(series.class_id);
    }
  });

  it("TC-RLM-009-202 store_unavailable is never dropped: every failed evaluation is logged", async () => {
    const h = harness();
    h.trs.faults.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
    for (let i = 0; i < 12; i++) await h.get({ ip: `203.0.113.${100 + i}` });
    const failed = collect(h.lines).filter(
      (e) => e.event_name === "ratelimit.decision.completed" && e.result === "FAILED",
    );
    expect(failed).toHaveLength(12);
    for (const event of failed) expect(event).toMatchObject({ failure_class: "SECURITY_FAILURE" });
  });
});
