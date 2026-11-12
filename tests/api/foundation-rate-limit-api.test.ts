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
  requireResourceRateLimit,
} from "../../apps/api/src/api/rate-limit.ts";
import { AuthFailure } from "../../packages/auth/src/index.ts";
import { createLogger, createRateLimitMetrics } from "../../packages/observability/src/index.ts";
import { RATE_LIMIT_CLASS_IDS, type RouteClassId } from "../../packages/security/src/index.ts";
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
    // The 101st request in the burst window is the first rejection (auth_form_proxy would stop at 5).
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
  options: { verify?: (token: string) => Promise<{ subject: string }> } = {},
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
      findByAuthSubject: async () => {
        order.push("db");
        return {
          directory: { authSubject: SUBJECT, emailVerified: verified },
          profile: { id: "1", publicRef: PROFILE_REF, authSubject: SUBJECT },
          roles,
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

describe("resource rule evaluation (TST-RLM-004)", () => {
  it("TC-RLM-004-211 the resource key is evaluated before any lookup, so existing and missing resources behave identically", async () => {
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

  it("TC-RLM-004-212 a resource rule rejection is a 429 / store failure a 503 before the handler runs", async () => {
    const trs = createTestRateLimit();
    const m = miniApp(trs, { "/qr": "qr_display" });
    let handled = 0;
    m.app.get(
      "/qr/:id",
      m.principal,
      requireResourceRateLimit(trs.rateLimit.limiter, (c) => ({
        "qr_display.ticket": c.req.param("id") ?? "",
      })),
      (c) => {
        handled += 1;
        return c.json({ ok: true });
      },
    );
    trs.faults.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
    expect((await call(m.app, "/qr/a")).status).toBe(503);
    expect(handled).toBe(0);
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
