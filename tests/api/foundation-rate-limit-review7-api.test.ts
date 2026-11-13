// SPEC-140 SEC-ABU-021 / 029 / 031 / 033, SPEC-160 §24.1, SPEC-110 §24.1 (seventh PR #41 review and
// the PR #46 review follow-ups) at the API layer: the signature verification budget, guard Class ID
// and Actor Type in the decision logs, multi-resource Stage 3 through the middleware, the purchase
// start pre-check, and Connection: close on every early auth_form_proxy refusal.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { type ApiEnvironment, ApiFailure, requirePrincipal } from "../../apps/api/src/api/app.ts";
import {
  createPrincipalRateLimitHooks,
  createRateLimitMetricsObserver,
  createRateLimitStageOne,
  createVerificationBudget,
  markAuthorizationConfirmed,
  requirePurchaseStartRateLimit,
  requireResourceRateLimit,
} from "../../apps/api/src/api/rate-limit.ts";
import { AuthFailure, createTokenVerifier } from "../../packages/auth/src/index.ts";
import { createLogger, createRateLimitMetrics } from "../../packages/observability/src/index.ts";
import { RATE_LIMIT_CLASS_IDS, type RouteClassId } from "../../packages/security/src/index.ts";
import { createTestRateLimit, peer, type TestRateLimit } from "../harness/rate-limit/api.ts";

const ISSUER = "https://issuer.example.com";
const AUDIENCE = "api";
const PROFILE_REF = "5c2d5d1e-7f4a-4a3b-9d0e-3a1b2c4d5e6f";
const IP = "203.0.113.9";
const subjectN = (n: number) => `aef69f82-c9b7-4fd1-9a6f-126f5748e9a${n}`;

let signing: Awaited<ReturnType<typeof generateKeyPair>>;
let foreign: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  signing = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  foreign = await generateKeyPair("EdDSA", { crv: "Ed25519" });
});

async function mint(
  options: {
    subject?: string;
    key?: "signing" | "foreign";
    iss?: string;
    expiresIn?: string;
    kid?: string | null;
  } = {},
) {
  const key = options.key === "foreign" ? foreign.privateKey : signing.privateKey;
  return await new SignJWT({
    sub: options.subject ?? subjectN(1),
    iss: options.iss ?? ISSUER,
    aud: AUDIENCE,
  })
    .setProtectedHeader({
      alg: "EdDSA",
      ...(options.kid === null ? {} : { kid: options.kid ?? "kid-1" }),
    })
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "15m")
    .sign(key);
}

interface Counting {
  verifications: number;
}
/** The production verifier (structure check + signature) with the signature work counted. */
function countingVerifier(counter: Counting) {
  const real = createTokenVerifier(
    { issuer: ISSUER, audience: AUDIENCE, jwksUrl: "https://issuer.example.com/jwks" },
    async () => signing.publicKey,
  );
  return {
    ...(real.inspect ? { inspect: real.inspect } : {}),
    verify: async (token: string) => {
      counter.verifications += 1;
      return real.verify(token);
    },
  };
}

interface MiniOptions {
  readonly verifier?: Parameters<typeof requirePrincipal>[0];
  readonly budget?: ReturnType<typeof createVerificationBudget>;
  readonly roles?: ("STAFF" | "ADMINISTRATOR")[];
  readonly operationId?: string;
  readonly noLimiter?: boolean;
}
function mini(trs: TestRateLimit, routes: Record<string, RouteClassId>, options: MiniOptions = {}) {
  const lines: string[] = [];
  const metrics = createRateLimitMetrics({ environment: "test", classIds: RATE_LIMIT_CLASS_IDS });
  const app = new Hono<ApiEnvironment>();
  const logger = createLogger(
    { service: "API", environment: "test", actor_type: "GUEST" },
    (line) => {
      lines.push(line);
    },
  );
  app.use("*", async (c, next) => {
    c.set("requestId", randomUUID());
    c.set("logger", logger);
    await next();
  });
  const rateLimit = options.noLimiter ? undefined : trs.rateLimit;
  app.use(
    "*",
    createRateLimitStageOne({
      rateLimit,
      classify: (_method, path) => {
        const classId = routes[path.split("/").slice(0, 2).join("/")];
        return classId ? { classId, operationId: options.operationId ?? null } : undefined;
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
  const hooks = createPrincipalRateLimitHooks(
    trs.rateLimit.limiter,
    options.budget ? { verificationBudget: options.budget } : {},
  );
  const principal = requirePrincipal(
    options.verifier ?? {
      verify: async (token) => {
        if (token.endsWith("YmFk")) throw new AuthFailure("unauthenticated");
        return { subject: subjectN(Number(token.slice(-1)) || 1) };
      },
    },
    {
      findByAuthSubject: async (subject: string) => ({
        directory: { authSubject: subject, emailVerified: true },
        profile: { id: "1", publicRef: PROFILE_REF, authSubject: subject },
        roles: options.roles ?? [],
      }),
    },
    hooks,
  );
  return {
    app,
    principal,
    lines,
    metrics,
    events: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    observer: createRateLimitMetricsObserver(metrics),
  };
}
const send = (
  app: Hono<ApiEnvironment>,
  path: string,
  token: string | undefined,
  ip = IP,
  init: RequestInit = {},
) =>
  app.request(
    path,
    {
      ...init,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    },
    peer(ip),
  );
const guardRecords = (trs: TestRateLimit) =>
  trs.store
    .keys()
    .filter((key) => key.includes("auth_failure_guard") && key.includes(".burst:"))
    .reduce((total, key) => total + trs.store.count(key), 0);
const guardOverride = (burst: number) => ({
  auth_failure_guard_attendee: { burst_limit: burst, sustained_limit: 50 },
});

describe("signature verification budget (SEC-ABU-033)", () => {
  it("TC-RLM-005-220 a token that fails the structure check never reaches signature verification, and counts as a guard failure", async () => {
    const trs = createTestRateLimit();
    const counter: Counting = { verifications: 0 };
    const m = mini(trs, { "/buy": "purchase_checkout" }, { verifier: countingVerifier(counter) });
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    const bad: (string | undefined)[] = [
      undefined,
      "not-a-jwt",
      "a.b.c",
      await mint({ iss: "https://evil.example.com" }),
      await mint({ expiresIn: "-10s" }),
      await mint({ kid: null }),
      `${"x".repeat(4096)}.${"y".repeat(10)}.z`,
    ];
    for (const token of bad) expect((await send(m.app, "/buy/ok", token)).status).toBe(401);
    expect(counter.verifications).toBe(0);
    expect(guardRecords(trs)).toBe(bad.length);
  });

  it("TC-RLM-005-221 a flood of well-formed, badly signed tokens from one IP runs at most the guard limit plus the process budget of signature verifications; the rest are 429 with Retry-After: 1 and are not counted", async () => {
    const trs = createTestRateLimit({ overrides: guardOverride(3) });
    const counter: Counting = { verifications: 0 };
    let clock = 1_000;
    const budget = createVerificationBudget({ perSecond: 50, now: () => clock });
    const m = mini(
      trs,
      { "/buy": "purchase_checkout" },
      { verifier: countingVerifier(counter), budget },
    );
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    const forged = await mint({ key: "foreign" });
    const statuses: number[] = [];
    const retryAfters = new Set<string | null>();
    for (let i = 0; i < 200; i += 1) {
      const res = await send(m.app, "/buy/ok", forged);
      statuses.push(res.status);
      if (res.status === 429) retryAfters.add(res.headers.get("Retry-After"));
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3).every((status) => status === 429)).toBe(true);
    // Guard limit (3, normal budget) + the process budget (50 in this second).
    expect(counter.verifications).toBe(3 + 50);
    expect(guardRecords(trs)).toBe(3);
    // Guard refusals carry the window's Retry-After; budget refusals carry exactly 1 (SEC-ABU-033 (b)).
    expect(retryAfters.has("1")).toBe(true);
    for (const value of retryAfters) expect(value).toMatch(/^[1-9]\d*$/);
    // The budget refused requests are logged as rule_category=concurrency; guard refusals as guard.
    const rejected = m.events().filter((e) => e.event_name === "ratelimit.decision.completed");
    expect(rejected.filter((e) => e.rule_category === "concurrency")).toHaveLength(200 - 3 - 50);
    expect(rejected.filter((e) => e.rule_category === "guard")).toHaveLength(50);
    // A second later the budget is back.
    clock += 1_000;
    const before = counter.verifications;
    expect((await send(m.app, "/buy/ok", forged)).status).toBe(429);
    expect(counter.verifications).toBe(before + 1);
  });

  it("TC-RLM-005-222 valid tokens are verified on the normal budget while the IP's guard is below its limit, however many other IPs have drained the process budget", async () => {
    const trs = createTestRateLimit({ overrides: guardOverride(1) });
    const counter: Counting = { verifications: 0 };
    const budget = createVerificationBudget({ perSecond: 50, now: () => 1_000 });
    const m = mini(
      trs,
      { "/buy": "purchase_checkout" },
      { verifier: countingVerifier(counter), budget },
    );
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    const forged = await mint({ key: "foreign" });
    // Saturate one IP's guard and drain the process budget from several saturated IPs.
    for (let ip = 1; ip <= 3; ip += 1) {
      await send(m.app, "/buy/ok", forged, `198.51.100.${ip}`);
      for (let i = 0; i < 30; i += 1) await send(m.app, "/buy/ok", forged, `198.51.100.${ip}`);
    }
    const before = counter.verifications;
    // An IP with no failures: its valid tokens are never limited by the budget.
    for (let i = 0; i < 5; i += 1) {
      const valid = await mint({ subject: subjectN(i + 2) });
      expect((await send(m.app, "/buy/ok", valid, "192.0.2.77")).status).toBe(200);
    }
    expect(counter.verifications).toBe(before + 5);
    // A saturated IP's valid token is refused without verification while the budget is empty (the
    // residual effect of SEC-ABU-033 (d)); the refusal is not a guard failure.
    const recordsBefore = guardRecords(trs);
    const verifiedBefore = counter.verifications;
    const refused = await send(m.app, "/buy/ok", await mint(), "198.51.100.1");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("1");
    expect(counter.verifications).toBe(verifiedBefore);
    expect(guardRecords(trs)).toBe(recordsBefore);
  });

  it("TC-RLM-005-223 the budget is one bucket per process: a refill after 1 s admits 50 more verifications across all saturated IPs", async () => {
    let clock = 5_000;
    const budget = createVerificationBudget({ perSecond: 50, now: () => clock });
    const taken = () => {
      let n = 0;
      while (budget.tryTake()) n += 1;
      return n;
    };
    expect(taken()).toBe(50);
    expect(budget.tryTake()).toBe(false);
    clock += 500;
    expect(taken()).toBe(25);
    clock += 10_000;
    expect(taken()).toBe(50);
    // A clock that does not advance, or goes back, never creates tokens.
    clock -= 5_000;
    expect(taken()).toBe(0);
  });

  it("TC-RLM-005-224 stage 1 reads the guard counter in check mode: after the per-IP rule, read only, and a store failure there is a 503", async () => {
    const trs = createTestRateLimit();
    const m = mini(trs, { "/buy": "purchase_checkout" });
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    expect((await send(m.app, "/buy/ok", "e30.e30.c2ln")).status).toBe(200);
    expect(trs.store.calls.map((call) => call.mode)).toEqual(["check", "admit"]);
    expect(guardRecords(trs)).toBe(0);
    trs.faults.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
    const res = await send(m.app, "/buy/ok", "e30.e30.c2ln");
    expect(res.status).toBe(503);
  });
});

describe("decision log fields (SPEC-160 §24.1)", () => {
  it("TC-RLM-009-211 a guard decision is logged, and counted, under the guard's Class ID, never the route class", async () => {
    const metrics = createRateLimitMetrics({ environment: "test", classIds: RATE_LIMIT_CLASS_IDS });
    const trs = createTestRateLimit({
      overrides: guardOverride(1),
      limiter: { observer: createRateLimitMetricsObserver(metrics) },
    });
    const m = mini(trs, { "/buy": "purchase_checkout", "/handoff": "goods_handoff" });
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    m.app.get("/handoff/ok", m.principal, (c) => c.json({ ok: true }));
    expect((await send(m.app, "/buy/ok", "e30.e30.YmFk")).status).toBe(401);
    expect((await send(m.app, "/buy/ok", "e30.e30.YmFk")).status).toBe(429);
    const guardLog = m.events().find((e) => e.event_name === "ratelimit.decision.completed");
    expect(guardLog).toMatchObject({
      class_id: "auth_failure_guard_attendee",
      rule_category: "guard",
      result: "REJECTED",
    });
    const rejected = metrics.snapshot().decisions.filter((d) => d.result === "rejected");
    expect(rejected.map((d) => d.class_id)).toEqual([guardLog?.class_id]);
    // The operator guard is logged under its own Class ID.
    const op = createTestRateLimit({
      overrides: { auth_failure_guard_operator: { burst_limit: 1, sustained_limit: 50 } },
    });
    const o = mini(op, { "/handoff": "goods_handoff" });
    o.app.get("/handoff/ok", o.principal, (c) => c.json({ ok: true }));
    await send(o.app, "/handoff/ok", "e30.e30.YmFk");
    await send(o.app, "/handoff/ok", "e30.e30.YmFk");
    expect(o.events().find((e) => e.event_name === "ratelimit.decision.completed")).toMatchObject({
      class_id: "auth_failure_guard_operator",
    });
  });

  it("TC-RLM-009-212 a guard store failure is logged (decision and fail-closed) under the guard's Class ID", async () => {
    const trs = createTestRateLimit();
    let armed = false;
    const m = mini(
      trs,
      { "/buy": "purchase_checkout" },
      {
        verifier: {
          verify: async () => {
            armed = true;
            trs.faults.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
            throw new AuthFailure("unauthenticated");
          },
        },
      },
    );
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    expect((await send(m.app, "/buy/ok", "e30.e30.YmFk")).status).toBe(503);
    expect(armed).toBe(true);
    const events = m.events();
    expect(events.find((e) => e.event_name === "ratelimit.decision.completed")).toMatchObject({
      class_id: "auth_failure_guard_attendee",
      result: "FAILED",
    });
    expect(events.find((e) => e.event_name === "security.fail_closed.triggered")).toMatchObject({
      class_id: "auth_failure_guard_attendee",
    });
  });

  it("TC-RLM-009-213 before the Principal is resolved the actor is GUEST; a Stage 3 rejection carries the resolved Actor Type and Profile Public Reference", async () => {
    const trs = createTestRateLimit({
      overrides: {
        qr_display: {
          burst_limit: 6,
          sustained_limit: 30,
          additional: { "qr_display.ticket": { limit: 1, window_seconds: 60 } },
        },
      },
    });
    const m = mini(trs, { "/qr": "qr_display" }, { roles: ["STAFF"] });
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
      (c) => c.json({ ok: true }),
    );
    expect((await send(m.app, "/qr/t1", "e30.e30.c2ln")).status).toBe(200);
    expect((await send(m.app, "/qr/t1", "e30.e30.c2ln")).status).toBe(429);
    const stage3 = m.events().find((e) => e.event_name === "ratelimit.decision.completed");
    expect(stage3).toMatchObject({
      actor_type: "STAFF",
      actor_ref: PROFILE_REF,
      rule_category: "resource",
    });
    // A Stage 1 refusal precedes authentication: GUEST, no actor_ref.
    const stageOne = createTestRateLimit({
      overrides: {
        self_read: {
          burst_limit: 30,
          sustained_limit: 120,
          additional: { "self_read.ip": { limit: 1, window_seconds: 60 } },
        },
      },
    });
    const s = mini(stageOne, { "/self": "self_read" });
    s.app.get("/self/:id", s.principal, (c) => c.json({ ok: true }));
    await send(s.app, "/self/t1", "e30.e30.c2ln");
    await send(s.app, "/self/t1", "e30.e30.c2ln");
    const refused = s.events().find((e) => e.event_name === "ratelimit.decision.completed");
    expect(refused).toMatchObject({ actor_type: "GUEST" });
    expect(refused).not.toHaveProperty("actor_ref");
  });
});

describe("Stage 3 through the middleware (SEC-ABU-029, API-RLC-006)", () => {
  const cartOverride = (limit: number) => ({
    purchase_checkout: {
      burst_limit: 3,
      sustained_limit: 12,
      additional: { "purchase_checkout.resource": { limit, window_seconds: 60 } },
    },
  });
  const uuids = (n: number) =>
    Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  const cartApp = (trs: TestRateLimit) => {
    const m = mini(trs, { "/cart": "purchase_checkout" });
    m.app.post(
      "/cart",
      m.principal,
      async (c, next) => {
        markAuthorizationConfirmed(c);
        await next();
      },
      requireResourceRateLimit(trs.rateLimit.limiter, async (c) => ({
        "purchase_checkout.resource": ((await c.req.json()) as { items: string[] }).items,
      })),
      (c) => c.json({ ok: true }),
    );
    const post = (items: string[]) =>
      m.app.request(
        "/cart",
        {
          method: "POST",
          headers: { Authorization: "Bearer e30.e30.c2ln", "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        },
        peer(),
      );
    return { ...m, post };
  };

  it("TC-RLM-004-275 a cart of 50 items is one atomic evaluation through the middleware, and a full counter refuses the whole cart without recording any item", async () => {
    const trs = createTestRateLimit({ overrides: cartOverride(2) });
    const m = cartApp(trs);
    const fifty = uuids(50);
    const resourceCalls = () =>
      trs.store.calls.filter((call) => call.mode === "admit" && call.rules.length === 50);
    expect((await m.post(fifty)).status).toBe(200);
    expect(resourceCalls()).toHaveLength(1);
    expect((await m.post(fifty)).status).toBe(200);
    trs.store.advance(11_000);
    const refused = await m.post(fifty);
    expect(refused.status).toBe(429);
    expect(resourceCalls()).toHaveLength(3);
    for (const key of trs.store.keys().filter((k) => k.includes("purchase_checkout.resource")))
      expect(trs.store.count(key)).toBe(2);
    // One full item blocks the whole cart and records nothing for the others.
    const first = createTestRateLimit({ overrides: cartOverride(1) });
    const f = cartApp(first);
    const [a, b, c] = uuids(3) as [string, string, string];
    expect((await f.post([a])).status).toBe(200);
    first.store.advance(11_000);
    expect((await f.post([a, b, c])).status).toBe(429);
    // (The memory store creates an empty log on a read; what a refusal must not do is record.)
    const recorded = () =>
      first.store
        .keys()
        .filter((k) => k.includes("purchase_checkout.resource") && first.store.count(k) > 0);
    expect(recorded()).toHaveLength(1);
    // The same UUID in different case is one resource, one counter, and one item in a cart.
    const upper = uuids(1)[0]?.toUpperCase() ?? "";
    first.store.advance(11_000);
    expect((await f.post([upper])).status).toBe(429);
    expect(recorded()).toHaveLength(1);
  });
});

describe("purchase start pre-check (SEC-ABU-029 pre-check)", () => {
  const unitOverride = {
    purchase_checkout: {
      burst_limit: 3,
      sustained_limit: 12,
      additional: { "purchase_checkout.resource": { limit: 3, window_seconds: 60 } },
    },
  };
  const unknown = Array.from(
    { length: 50 },
    (_, i) => `ffffffff-ffff-4fff-8fff-${String(i).padStart(12, "0")}`,
  );
  const REAL = "11111111-1111-4111-8111-111111111111";

  function purchaseApp(trs: TestRateLimit, eligibility: (items: string[]) => boolean) {
    const m = mini(trs, { "/buy": "purchase_checkout" }, { operationId: "API-PUR-CART-001" });
    const order: string[] = [];
    m.app.post(
      "/buy",
      m.principal,
      async (c, next) => {
        markAuthorizationConfirmed(c);
        order.push("authorized");
        await next();
      },
      requirePurchaseStartRateLimit(trs.rateLimit.limiter, {
        eligibility: async (c) => {
          order.push("precheck");
          return eligibility(((await c.req.json()) as { items: string[] }).items);
        },
        valuesOf: async (c) => ({
          "purchase_checkout.resource": ((await c.req.json()) as { items: string[] }).items,
        }),
      }),
      async (c) => {
        order.push("transaction");
        const items = ((await c.req.json()) as { items: string[] }).items;
        return items.every((item) => item === REAL)
          ? c.json({ ok: true })
          : c.json({ code: "STATE_CONFLICT", item_failures: items.length }, 409);
      },
    );
    const buy = (token: string, items: string[], ip = IP) =>
      m.app.request(
        "/buy",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        },
        peer(ip),
      );
    return { ...m, order, buy };
  }
  const resourceKeys = (trs: TestRateLimit) =>
    trs.store.keys().filter((key) => key.includes("purchase_checkout.resource"));

  it("TC-RLM-004-276 five authenticated principals repeating carts that cannot be purchased (unknown UUIDs x 50) leave the product counter and the key space unchanged, and a legitimate purchase is not a 429", async () => {
    const trs = createTestRateLimit({ overrides: unitOverride });
    const m = purchaseApp(trs, (items) => items.every((item) => item === REAL));
    for (let subject = 1; subject <= 5; subject += 1)
      for (let round = 0; round < 3; round += 1) {
        const res = await m.buy(`e30.e30.${subject}`, unknown, `198.51.100.${subject}`);
        expect(res.status).toBe(409);
      }
    expect(resourceKeys(trs)).toHaveLength(0);
    expect(trs.store.calls.filter((call) => call.rules.length >= 50)).toHaveLength(0);
    // The authoritative Transaction ran for each (it returns the 409 item_failures).
    expect(m.order.filter((step) => step === "transaction")).toHaveLength(15);
    // Pre-check ran after authorization and before the Transaction.
    expect(m.order.slice(0, 3)).toEqual(["authorized", "precheck", "transaction"]);
    for (let n = 0; n < 3; n += 1) {
      trs.store.advance(11_000);
      expect((await m.buy("e30.e30.1", [REAL])).status).toBe(200);
    }
    expect(resourceKeys(trs)).toHaveLength(1);
    // Limit 3 is now used by legitimate purchases only: the 4th is a 429.
    trs.store.advance(11_000);
    expect((await m.buy("e30.e30.1", [REAL])).status).toBe(429);
  });

  it("TC-RLM-004-277 when the pre-check passes but the Transaction fails, Stage 3 stays recorded; one unpurchasable item among purchasable ones skips Stage 3 for the whole request", async () => {
    const trs = createTestRateLimit({ overrides: unitOverride });
    const m = purchaseApp(trs, () => true);
    const res = await m.buy("e30.e30.1", [REAL, unknown[0] ?? ""]);
    expect(res.status).toBe(409);
    expect(resourceKeys(trs)).toHaveLength(2);
    expect(resourceKeys(trs).every((key) => trs.store.count(key) === 1)).toBe(true);
    const skipped = createTestRateLimit({ overrides: unitOverride });
    const s = purchaseApp(skipped, (items) => items.every((item) => item === REAL));
    expect((await s.buy("e30.e30.1", [REAL, unknown[0] ?? ""])).status).toBe(409);
    expect(resourceKeys(skipped)).toHaveLength(0);
  });

  it("TC-RLM-004-278 a purchase start Operation cannot use the plain Stage 3 middleware, and the pre-check middleware needs the authorization check first", async () => {
    const trs = createTestRateLimit({ overrides: unitOverride });
    const m = mini(trs, { "/buy": "purchase_checkout" }, { operationId: "API-PUR-CART-001" });
    m.app.post(
      "/buy",
      m.principal,
      async (c, next) => {
        markAuthorizationConfirmed(c);
        await next();
      },
      requireResourceRateLimit(trs.rateLimit.limiter, () => ({
        "purchase_checkout.resource": REAL,
      })),
      (c) => c.json({ ok: true }),
    );
    expect((await send(m.app, "/buy", "e30.e30.1", IP, { method: "POST" })).status).toBe(500);
    expect(resourceKeys(trs)).toHaveLength(0);

    const unauthorized = mini(
      trs,
      { "/pre": "purchase_checkout" },
      { operationId: "API-PUR-CART-001" },
    );
    let reached = false;
    unauthorized.app.post(
      "/pre",
      unauthorized.principal,
      requirePurchaseStartRateLimit(trs.rateLimit.limiter, {
        eligibility: async () => {
          reached = true;
          return true;
        },
        valuesOf: () => ({ "purchase_checkout.resource": REAL }),
      }),
      (c) => c.json({ ok: true }),
    );
    expect((await send(unauthorized.app, "/pre", "e30.e30.1", IP, { method: "POST" })).status).toBe(
      500,
    );
    expect(reached).toBe(false);
  });

  it("TC-RLM-004-279 API-CHK-001 / API-ORD-002 keep the owner-relation order: the plain Stage 3 middleware is allowed for them", async () => {
    const trs = createTestRateLimit({ overrides: unitOverride });
    const m = mini(trs, { "/chk": "purchase_checkout" }, { operationId: "API-CHK-001" });
    m.app.post(
      "/chk",
      m.principal,
      async (c, next) => {
        markAuthorizationConfirmed(c);
        await next();
      },
      requireResourceRateLimit(trs.rateLimit.limiter, () => ({
        "purchase_checkout.resource": REAL,
      })),
      (c) => c.json({ ok: true }),
    );
    expect((await send(m.app, "/chk", "e30.e30.1", IP, { method: "POST" })).status).toBe(200);
    expect(resourceKeys(trs)).toHaveLength(1);
  });
});

describe("auth_form_proxy early refusals close the connection (SEC-ABU-031)", () => {
  const FORM_ROUTES = { "/auth": "auth_form_proxy" } as const;
  const post = (app: Hono<ApiEnvironment>, env?: unknown) =>
    app.request(
      "/auth/sign-in",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "a@example.test" }),
      },
      env as never,
    );

  it("TC-RLM-004-280 an undeterminable Client IP (503) answers Connection: close and reads no body", async () => {
    const trs = createTestRateLimit();
    const m = mini(trs, FORM_ROUTES);
    m.app.post("/auth/sign-in", (c) => c.json({ ok: true }));
    const res = await post(m.app);
    expect(res.status).toBe(503);
    expect(res.headers.get("Connection")).toBe("close");
    expect(trs.store.calls).toHaveLength(0);
  });

  it("TC-RLM-004-281 a missing rate limit configuration (503) answers Connection: close; other classes are not affected", async () => {
    const trs = createTestRateLimit();
    const m = mini(trs, { ...FORM_ROUTES, "/self": "self_read" }, { noLimiter: true });
    m.app.post("/auth/sign-in", (c) => c.json({ ok: true }));
    m.app.get("/self/x", (c) => c.json({ ok: true }));
    const res = await post(m.app, peer());
    expect(res.status).toBe(503);
    expect(res.headers.get("Connection")).toBe("close");
    const other = await m.app.request("/self/x", {}, peer());
    expect(other.status).toBe(503);
    expect(other.headers.get("Connection")).toBeNull();
  });
});
