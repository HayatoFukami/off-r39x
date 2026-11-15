// SPEC-140 SEC-ABU-021 / 029 / 031 / 033, SPEC-160 §24.1, SPEC-110 §24.1 (seventh PR #41 review and
// the PR #46 review follow-ups) at the API layer: the signature verification budget, guard Class ID
// and Actor Type in the decision logs, multi-resource Stage 3 through the middleware, the purchase
// start pre-check, and Connection: close on every early auth_form_proxy refusal.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  type ApiEnvironment,
  ApiFailure,
  requireCapability,
  requirePrincipal,
  requireVerifiedEmail,
} from "../../apps/api/src/api/app.ts";
import {
  createPrincipalRateLimitHooks,
  createRateLimitMetricsObserver,
  createRateLimitStageOne,
  createVerificationGate,
  markAuthorizationConfirmed,
  requirePurchaseStartRateLimit,
  requireResourceRateLimit,
} from "../../apps/api/src/api/rate-limit.ts";
import { AuthFailure, createTokenVerifier } from "../../packages/auth/src/index.ts";
import { createLogger, createRateLimitMetrics } from "../../packages/observability/src/index.ts";
import {
  assertResourceReferenceTable,
  assertRouteRegistry,
  createCounterKeyFactory,
  isPurchaseStartOperation,
  OPERATION_CLASS_ASSIGNMENT,
  RATE_LIMIT_CLASS_IDS,
  RATE_LIMIT_REGISTRY,
  type RouteClassId,
  type RouteRegistration,
  rateLimitClassOf,
  resourceReferencesOf,
} from "../../packages/security/src/index.ts";
import {
  createTestRateLimit,
  peer,
  TEST_HMAC_KEY,
  type TestRateLimit,
} from "../harness/rate-limit/api.ts";
import { createMemoryStore } from "../harness/rate-limit/memory-store.ts";

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
  readonly roles?: ("STAFF" | "ADMINISTRATOR")[];
  readonly operationId?: string;
  readonly noLimiter?: boolean;
  readonly emailVerified?: boolean;
  /** The Auth directory row exists but no Business Profile (SPEC-110 §24 step 4). */
  readonly noProfile?: boolean;
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
  const hooks = createPrincipalRateLimitHooks(trs.rateLimit.limiter, {
    ...(trs.rateLimit.gate ? { gate: trs.rateLimit.gate } : {}),
    authSubjectRef: trs.rateLimit.authSubjectRef,
  });
  const principal = requirePrincipal(
    options.verifier ?? {
      verify: async (token) => {
        if (token.endsWith("YmFk")) throw new AuthFailure("unauthenticated");
        return { subject: subjectN(Number(token.slice(-1)) || 1) };
      },
    },
    {
      findByAuthSubject: async (subject: string) => ({
        directory: { authSubject: subject, emailVerified: options.emailVerified ?? true },
        profile: options.noProfile
          ? null
          : { id: "1", publicRef: PROFILE_REF, authSubject: subject },
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

for (const outcome of ["saturated", "store_unavailable"] as const)
  it(`TC-RLM-005-230 the guard is read once in Stage 1 after the slot, not again before verification: ${outcome}`, async () => {
    const trs = createTestRateLimit({ gate: { slotsPerIp: 1 } });
    const base = trs.rateLimit.limiter;
    let reads = 0;
    let verifications = 0;
    const wrapped: TestRateLimit = {
      ...trs,
      rateLimit: {
        ...trs.rateLimit,
        limiter: {
          ...base,
          guardState: async (classId, ip) => {
            reads += 1;
            if (reads === 1)
              return outcome === "saturated"
                ? { result: "ok", saturated: true }
                : { result: "store_unavailable" };
            return base.guardState(classId, ip);
          },
        },
      },
    };
    const m = mini(
      wrapped,
      { "/buy": "purchase_checkout" },
      {
        verifier: {
          verify: async () => {
            verifications += 1;
            return { subject: subjectN(1) };
          },
        },
      },
    );
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    // A saturated IP's valid token is still verified, in the restricted lane (no re-read of the
    // counter); a store failure at the single read is a 503 with no verification.
    expect((await send(m.app, "/buy/ok", "e30.e30.c2ln")).status).toBe(
      outcome === "saturated" ? 200 : 503,
    );
    expect(reads).toBe(1);
    expect(verifications).toBe(outcome === "saturated" ? 1 : 0);
    // The slot (slotsPerIp 1) was released in both cases.
    expect((await send(m.app, "/buy/ok", "e30.e30.c2ln")).status).toBe(200);
    expect(reads).toBe(2);
  });

describe("signature verification gate (SEC-ABU-033, SEC-ABU-021, SPEC-110 §24.1)", () => {
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

  it("TC-RLM-005-221 a flood of well-formed, badly signed tokens from one IP runs at most the guard limit plus the per-IP restricted bucket (10/s) of signature verifications; the rest are 429 with Retry-After: 1 under the guard Class ID and are not counted", async () => {
    let clock = 1_000;
    const trs = createTestRateLimit({ overrides: guardOverride(3), gate: { now: () => clock } });
    const counter: Counting = { verifications: 0 };
    const m = mini(trs, { "/buy": "purchase_checkout" }, { verifier: countingVerifier(counter) });
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
    // Guard limit (3, normal lane) + the IP's restricted bucket (10 in this second). The process-wide
    // bucket (50) is not what binds one IP.
    expect(counter.verifications).toBe(3 + 10);
    expect(guardRecords(trs)).toBe(3);
    // Guard refusals carry the window's Retry-After; restricted-lane refusals carry exactly 1.
    expect(retryAfters.has("1")).toBe(true);
    for (const value of retryAfters) expect(value).toMatch(/^[1-9]\d*$/);
    // Restricted-lane refusals are rule_category=concurrency under the guard's Class ID (SPEC-160 §24.1).
    const decisions = m.events().filter((e) => e.event_name === "ratelimit.decision.completed");
    const concurrency = decisions.filter((e) => e.rule_category === "concurrency");
    expect(concurrency).toHaveLength(200 - 3 - 10);
    expect(concurrency.every((e) => e.class_id === "auth_failure_guard_attendee")).toBe(true);
    expect(decisions.filter((e) => e.rule_category === "guard")).toHaveLength(10);
    // A second later the IP's bucket is back (10 tokens).
    clock += 1_000;
    const before = counter.verifications;
    expect((await send(m.app, "/buy/ok", forged)).status).toBe(429);
    expect(counter.verifications).toBe(before + 1);
  });

  it("TC-RLM-005-222 valid tokens are verified in the normal lane while the IP's guard is below its limit, however many other IPs have drained the process-wide bucket", async () => {
    const trs = createTestRateLimit({ overrides: guardOverride(1), gate: { now: () => 1_000 } });
    const counter: Counting = { verifications: 0 };
    const m = mini(trs, { "/buy": "purchase_checkout" }, { verifier: countingVerifier(counter) });
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    const forged = await mint({ key: "foreign" });
    // Saturate six IPs' guards, then let each use its restricted bucket: IP 1..5 take 10 each and the
    // process-wide bucket (50) is empty for IP 6.
    for (let ip = 1; ip <= 6; ip += 1) {
      await send(m.app, "/buy/ok", forged, `198.51.100.${ip}`);
      for (let i = 0; i < 12; i += 1) await send(m.app, "/buy/ok", forged, `198.51.100.${ip}`);
    }
    const before = counter.verifications;
    // An IP with no failures: its valid tokens are never limited by the restricted lane.
    for (let i = 0; i < 5; i += 1) {
      const valid = await mint({ subject: subjectN(i + 2) });
      expect((await send(m.app, "/buy/ok", valid, "192.0.2.77")).status).toBe(200);
    }
    expect(counter.verifications).toBe(before + 5);
    // A saturated IP's valid token is refused without verification while its restricted bucket (IP 1)
    // or the process-wide bucket (IP 6) is empty (the residual effect of SEC-ABU-032 (7)); the refusal
    // is not a guard failure.
    const recordsBefore = guardRecords(trs);
    const verifiedBefore = counter.verifications;
    for (const ip of [1, 6]) {
      const refused = await send(m.app, "/buy/ok", await mint(), `198.51.100.${ip}`);
      expect(refused.status).toBe(429);
      expect(refused.headers.get("Retry-After")).toBe("1");
    }
    expect(counter.verifications).toBe(verifiedBefore);
    expect(guardRecords(trs)).toBe(recordsBefore);
  });

  it("TC-RLM-005-223 the restricted lane is a per-IP bucket of 10/s and a process-wide bucket of 50/s; a refusal takes nothing from the other bucket", () => {
    let clock = 5_000;
    const gate = createVerificationGate({ now: () => clock });
    const taken = (ip: string) => {
      let n = 0;
      while (gate.takeRestricted(ip)) n += 1;
      return n;
    };
    expect(taken("198.51.100.1")).toBe(10);
    // 500 ms refills half of the IP's bucket; a clock that goes back creates nothing.
    clock += 500;
    expect(taken("198.51.100.1")).toBe(5);
    clock -= 5_000;
    expect(taken("198.51.100.1")).toBe(0);
    clock += 5_000 + 10_000;
    // The process-wide bucket (50) is shared by every IP: five full IPs drain it, a sixth gets nothing,
    // and the refused IP's own bucket was not charged for it.
    for (let ip = 2; ip <= 6; ip += 1) expect(taken(`198.51.100.${ip}`)).toBe(10);
    expect(taken("198.51.100.7")).toBe(0);
    clock += 1_000;
    expect(taken("198.51.100.7")).toBe(10);
    // A refusal by the IP's own bucket does not consume a process-wide token.
    const small = createVerificationGate({
      perProcessPerSecond: 5,
      perIpPerSecond: 2,
      now: () => clock,
    });
    expect([
      small.takeRestricted("a"),
      small.takeRestricted("a"),
      small.takeRestricted("a"),
    ]).toEqual([true, true, false]);
    expect([
      small.takeRestricted("b"),
      small.takeRestricted("b"),
      small.takeRestricted("c"),
    ]).toEqual([true, true, true]);
    expect(small.takeRestricted("d")).toBe(false);
  });

  it("TC-RLM-005-233 per-IP buckets live in process memory for at most 1,024 IPs and are discarded 60 s after last use; at the cap a new IP is not admitted to the restricted lane", () => {
    let clock = 10_000;
    const gate = createVerificationGate({ perProcessPerSecond: 1_000_000, now: () => clock });
    for (let i = 0; i < 1_024; i += 1) expect(gate.takeRestricted(`ip-${i}`)).toBe(true);
    // The table is full: a new IP is refused, an IP already in the table is not.
    expect(gate.takeRestricted("ip-new")).toBe(false);
    expect(gate.takeRestricted("ip-0")).toBe(true);
    // 59.999 s after the last use of the other buckets they are still retained ...
    clock += 59_999;
    expect(gate.takeRestricted("ip-new")).toBe(false);
    // ... and 60 s after, they are discarded and the new IP is admitted again.
    clock += 1;
    expect(gate.takeRestricted("ip-new")).toBe(true);
    // An IP idle for 60 s starts with a full bucket again.
    expect(gate.takeRestricted("ip-1")).toBe(true);
  });

  it("TC-RLM-005-234 a normal-lane slot is one of 8 concurrent verifications per IP; the 9th gets none, another IP is independent, and a release is idempotent", () => {
    const gate = createVerificationGate();
    const slots = Array.from({ length: 8 }, () => gate.acquireSlot("198.51.100.1"));
    expect(slots.every((slot) => slot !== undefined)).toBe(true);
    expect(gate.acquireSlot("198.51.100.1")).toBeUndefined();
    expect(gate.acquireSlot("198.51.100.2")).toBeDefined();
    slots[0]?.release();
    slots[0]?.release();
    expect(gate.acquireSlot("198.51.100.1")).toBeDefined();
    expect(gate.acquireSlot("198.51.100.1")).toBeUndefined();
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
    const m = mini(trs, { "/cart": "purchase_checkout" }, { operationId: "API-PUR-CART-001" });
    m.app.post(
      "/cart",
      m.principal,
      async (c, next) => {
        markAuthorizationConfirmed(c);
        await next();
      },
      requirePurchaseStartRateLimit(trs.rateLimit.limiter, {
        eligibility: () => true,
        referencesOf: async (c) => ({
          offering_ref: ((await c.req.json()) as { items: string[] }).items,
        }),
      }),
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
        referencesOf: async (c) => ({
          offering_ref: ((await c.req.json()) as { items: string[] }).items,
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
      requireResourceRateLimit(trs.rateLimit.limiter, () => ({ offering_ref: REAL })),
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
        referencesOf: () => ({ offering_ref: REAL }),
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
      requireResourceRateLimit(trs.rateLimit.limiter, () => ({ order_ref: REAL })),
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

describe("PR #46 concurrent verification and observation regressions", () => {
  it("TC-RLM-005-226 the 9th concurrent verification of one IP takes no slot: it reads no guard counter and calls no store, and goes to the restricted lane (per-IP bucket)", async () => {
    // One restricted token per IP: the 9th verifies in the restricted lane, the 10th is refused.
    const trs = createTestRateLimit({ gate: { perIpPerSecond: 1, now: () => 1_000 } });
    const base = trs.rateLimit.limiter;
    let guardReads = 0;
    const spied: TestRateLimit = {
      ...trs,
      rateLimit: {
        ...trs.rateLimit,
        limiter: {
          ...base,
          guardState: async (classId, ip) => {
            guardReads += 1;
            return base.guardState(classId, ip);
          },
        },
      },
    };
    let attempts = 0;
    const holders: (() => void)[] = [];
    const m = mini(
      spied,
      { "/buy": "purchase_checkout" },
      {
        verifier: {
          verify: async () => {
            attempts += 1;
            if (attempts <= 8)
              await new Promise<void>((resolve) => {
                holders.push(resolve);
              });
            return { subject: subjectN(1) };
          },
        },
      },
    );
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    const held = Array.from({ length: 8 }, () => send(m.app, "/buy/ok", "e30.e30.c2ln"));
    try {
      await vi.waitFor(() => expect(attempts).toBe(8));
      // Stage 1 read the guard counter once per request that took a slot.
      expect(guardReads).toBe(8);
      const callsBefore = trs.store.calls.length;
      const ninth = await send(m.app, "/buy/ok", "e30.e30.c2ln");
      expect(ninth.status).toBe(200);
      expect(attempts).toBe(9);
      expect(guardReads).toBe(8);
      // The 9th request called the store only for its own Stage 2 subject rule: no guard read.
      expect(trs.store.calls.slice(callsBefore).every((call) => call.mode === "admit")).toBe(true);
      // The per-IP bucket is now empty: the 10th request is refused before verification and before any
      // store call, and it is not counted in the guard.
      const callsAfterNinth = trs.store.calls.length;
      const tenth = await send(m.app, "/buy/ok", "e30.e30.c2ln");
      expect(tenth.status).toBe(429);
      expect(tenth.headers.get("Retry-After")).toBe("1");
      expect(attempts).toBe(9);
      expect(guardReads).toBe(8);
      expect(trs.store.calls.length).toBe(callsAfterNinth);
      expect(guardRecords(trs)).toBe(0);
    } finally {
      for (const release of holders) release();
      await Promise.allSettled(held);
    }
  });

  it("TC-RLM-005-227 a normal verification slot remains held until its failure has been recorded, then is released", async () => {
    const trs = createTestRateLimit({ gate: { slotsPerIp: 1, perIpPerSecond: 0 } });
    const original = trs.store.evaluate.bind(trs.store);
    let release: (() => void) | undefined;
    let recording = false;
    trs.store.evaluate = async (mode, rules, id) => {
      if (mode === "admit" && rules.some((rule) => rule.key.includes("auth_failure_guard"))) {
        recording = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return original(mode, rules, id);
    };
    let attempts = 0;
    const m = mini(
      trs,
      { "/buy": "purchase_checkout" },
      {
        verifier: {
          verify: async () => {
            attempts += 1;
            throw new AuthFailure("unauthenticated");
          },
        },
      },
    );
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    const first = send(m.app, "/buy/ok", "e30.e30.c2ln");
    try {
      await vi.waitFor(() => expect(recording).toBe(true));
      // The only slot is held and the restricted lane has no token: refused without verification.
      expect((await send(m.app, "/buy/ok", "e30.e30.c2ln")).status).toBe(429);
      expect(attempts).toBe(1);
    } finally {
      release?.();
    }
    expect((await first).status).toBe(401);
    trs.store.evaluate = original;
    expect((await send(m.app, "/buy/ok", "e30.e30.c2ln")).status).toBe(401);
    expect(attempts).toBe(2);
  });

  for (const result of ["success", "unavailable", "record_failure"] as const)
    it(`TC-RLM-005-228 the normal slot is released after ${result}`, async () => {
      const trs = createTestRateLimit({ gate: { slotsPerIp: 1, perIpPerSecond: 0 } });
      let attempts = 0;
      const m = mini(
        trs,
        { "/buy": "purchase_checkout" },
        {
          verifier: {
            verify: async () => {
              attempts += 1;
              if (result === "unavailable") throw new AuthFailure("unavailable");
              if (result === "record_failure") {
                trs.faults.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
                throw new AuthFailure("unauthenticated");
              }
              return { subject: subjectN(1) };
            },
          },
        },
      );
      m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
      await send(m.app, "/buy/ok", "e30.e30.c2ln");
      trs.faults.inject(undefined);
      await send(m.app, "/buy/ok", "e30.e30.c2ln");
      expect(attempts).toBe(2);
    });

  it("TC-RLM-005-235 the normal slot is released when the handler fails after verification, and when the guard read fails (503)", async () => {
    const trs = createTestRateLimit({ gate: { slotsPerIp: 1, perIpPerSecond: 0 } });
    let attempts = 0;
    const m = mini(
      trs,
      { "/buy": "purchase_checkout" },
      {
        verifier: {
          verify: async () => {
            attempts += 1;
            return { subject: subjectN(1) };
          },
        },
      },
    );
    m.app.get("/buy/boom", m.principal, () => {
      throw new Error("handler failure after verification");
    });
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    expect((await send(m.app, "/buy/boom", "e30.e30.c2ln")).status).toBe(500);
    // Guard read failure (Stage 1, slot already taken): 503, and the slot is not left behind.
    trs.faults.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
    expect((await send(m.app, "/buy/ok", "e30.e30.c2ln")).status).toBe(503);
    trs.faults.inject(undefined);
    expect(attempts).toBe(1);
  });

  it("TC-RLM-005-229 one IP shares its normal slots across guard classes while another IP can verify", async () => {
    const trs = createTestRateLimit({ gate: { slotsPerIp: 1, perIpPerSecond: 0 } });
    let release: (() => void) | undefined;
    let attempts = 0;
    const m = mini(
      trs,
      { "/buy": "purchase_checkout", "/handoff": "goods_handoff" },
      {
        verifier: {
          verify: async () => {
            attempts += 1;
            if (attempts === 1)
              await new Promise<void>((resolve) => {
                release = resolve;
              });
            return { subject: subjectN(attempts) };
          },
        },
      },
    );
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    m.app.get("/handoff/ok", m.principal, (c) => c.json({ ok: true }));
    const first = send(m.app, "/buy/ok", "e30.e30.c2ln");
    try {
      await vi.waitFor(() => expect(attempts).toBe(1));
      expect((await send(m.app, "/handoff/ok", "e30.e30.c2ln")).status).toBe(429);
      expect((await send(m.app, "/handoff/ok", "e30.e30.c2ln", "198.51.100.20")).status).toBe(200);
    } finally {
      release?.();
    }
    await first;
    expect((await send(m.app, "/buy/ok", "e30.e30.c2ln")).status).toBe(200);
  });

  it("TC-RLM-005-232 slots, buckets and the retention cap are per API process while the guard counter is shared: with the cap reached a valid token gets 429 without verification", async () => {
    const shared = createMemoryStore();
    const common = { overrides: guardOverride(1), store: shared };
    // Two API processes: separate gates, one store.
    const a = createTestRateLimit({ ...common, gate: { maxIps: 2, now: () => 1_000 } });
    const b = createTestRateLimit({ ...common, gate: { maxIps: 2, now: () => 1_000 } });
    const counterA: Counting = { verifications: 0 };
    const counterB: Counting = { verifications: 0 };
    const routes = { "/buy": "purchase_checkout" } as const;
    const ma = mini(a, routes, { verifier: countingVerifier(counterA) });
    const mb = mini(b, routes, { verifier: countingVerifier(counterB) });
    ma.app.get("/buy/ok", ma.principal, (c) => c.json({ ok: true }));
    mb.app.get("/buy/ok", mb.principal, (c) => c.json({ ok: true }));
    const forged = await mint({ key: "foreign" });
    // The guard counter is shared: a failure through process A saturates the IP for process B too.
    expect((await send(ma.app, "/buy/ok", forged, "198.51.100.1")).status).toBe(401);
    expect(counterB.verifications).toBe(0);
    // Process B puts IP 1 into its restricted lane (its own bucket) ...
    expect((await send(mb.app, "/buy/ok", forged, "198.51.100.1")).status).toBe(429);
    expect(counterB.verifications).toBe(1);
    // ... and IP 2 (saturated through process A) fills B's retention table (cap 2 in this test).
    await send(ma.app, "/buy/ok", forged, "198.51.100.2");
    expect((await send(mb.app, "/buy/ok", forged, "198.51.100.2")).status).toBe(429);
    expect(counterB.verifications).toBe(2);
    // Process A has not retained any bucket: the same IP 1 is a new entry there.
    expect((await send(ma.app, "/buy/ok", forged, "198.51.100.1")).status).toBe(429);
    expect(counterA.verifications).toBe(3);
    // IP 3 is saturated, and B's table is full: a valid token is refused with Retry-After: 1, with no
    // signature verification and without being counted in the guard (SEC-ABU-032 (7)).
    await send(ma.app, "/buy/ok", forged, "198.51.100.3");
    const recordsBefore = guardRecords({
      ...a,
      store: shared as unknown as TestRateLimit["store"],
    });
    const verifiedBefore = counterB.verifications;
    const refused = await send(mb.app, "/buy/ok", await mint(), "198.51.100.3");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("1");
    expect(counterB.verifications).toBe(verifiedBefore);
    expect(guardRecords({ ...a, store: shared as unknown as TestRateLimit["store"] })).toBe(
      recordsBefore,
    );
    // An IP that holds a slot in process A still has all of its slots in process B.
    const hold = createTestRateLimit({ store: shared, gate: { slotsPerIp: 1, perIpPerSecond: 0 } });
    const other = createTestRateLimit({
      store: shared,
      gate: { slotsPerIp: 1, perIpPerSecond: 0 },
    });
    let unblock: (() => void) | undefined;
    let held = 0;
    const mh = mini(hold, routes, {
      verifier: {
        verify: async () => {
          held += 1;
          await new Promise<void>((resolve) => {
            unblock = resolve;
          });
          return { subject: subjectN(1) };
        },
      },
    });
    mh.app.get("/buy/ok", mh.principal, (c) => c.json({ ok: true }));
    const mo = mini(other, routes);
    mo.app.get("/buy/ok", mo.principal, (c) => c.json({ ok: true }));
    const pending = send(mh.app, "/buy/ok", "e30.e30.c2ln", "192.0.2.50");
    try {
      await vi.waitFor(() => expect(held).toBe(1));
      expect((await send(mo.app, "/buy/ok", "e30.e30.c2ln", "192.0.2.50")).status).toBe(200);
    } finally {
      unblock?.();
    }
    expect((await pending).status).toBe(200);
  });
});

describe("Stage 3 resource references per Operation (SPEC-110 API-RLC-006 / API-RLC-007, SPEC-190 DEV-RLM-005)", () => {
  // The SPEC-110 API-RLC-006 / API-RLC-007 tables, written out independently of the implementation.
  const SPEC_REFERENCES: Record<string, readonly string[]> = {
    "API-PUR-CART-001": ["offering_ref", "goods_ref"],
    "API-PUR-ENTRY-001": ["offering_ref"],
    "API-PUR-GDS-001": ["goods_ref"],
    "API-PUR-KRK-001": ["slot_ref"],
    "API-CHK-001": ["order_ref"],
    "API-ORD-002": ["order_ref"],
    "API-TKT-003": ["ticket_ref"],
    "API-KRK-SELF-003": ["reservation_ref"],
    "API-STF-CHK-001": ["qr_digest"],
    "API-STF-CHK-002": ["qr_digest"],
    "API-STF-GDS-001": ["goods_item_ref"],
    "API-ADM-CNT-002": ["event"],
    "API-ADM-CNT-005": [],
    "API-ADM-CNT-011": [],
    "API-ADM-CNT-019": [],
    "API-ADM-CNT-006": ["faq_ref"],
    "API-ADM-CNT-007": ["faq_ref"],
    "API-ADM-CNT-008": ["faq_ref"],
    "API-ADM-CNT-015": ["faq_ref"],
    "API-ADM-CNT-012": ["announcement_ref"],
    "API-ADM-CNT-013": ["announcement_ref"],
    "API-ADM-CNT-014": ["announcement_ref"],
    "API-ADM-CNT-016": ["announcement_ref"],
    "API-ADM-CNT-020": ["logo_ref"],
    "API-ADM-CNT-021": ["logo_ref"],
    "API-ADM-KRK-003": [],
    "API-ADM-KRK-004": ["slot_ref"],
    "API-ADM-KRK-005": ["slot_ref"],
    "API-ADM-KRK-006": ["slot_ref"],
    "API-ADM-KRK-007": ["reservation_ref"],
    "API-ADM-ENT-SALES-003": ["offering_ref"],
    "API-ADM-KRK-SALES-003": ["sales_configuration_ref"],
    "API-ADM-GDS-004": ["goods_ref"],
    "API-ADM-GDS-005": ["goods_ref"],
    "API-ADM-HOF-003": ["handoff_ref"],
    "API-ADM-ROL-002": ["target_profile_ref"],
    "API-ADM-ROL-003": ["target_profile_ref"],
    "API-ADM-PAY-001": ["order_ref"],
    "API-ADM-REC-004": ["order_ref"],
    "API-ADM-REC-005": ["order_ref"],
    "API-ADM-TQR-001": ["ticket_ref"],
    "API-ADM-EML-004": ["notification_ref"],
    "API-ADM-EML-005": ["notification_ref"],
    "API-ADM-REC-006": ["notification_ref"],
    "API-ADM-REC-003": ["checkout_attempt_ref"],
    "API-ADM-REC-007": ["case_ref"],
  };
  const RESOURCE_CLASSES = [
    "purchase_checkout",
    "qr_display",
    "staff_checkin",
    "goods_handoff",
    "admin_mutation",
    "role_assignment",
    "high_risk_recovery",
  ] as const;
  const resourceRuleIds = (classId: RouteClassId) =>
    Object.entries(RATE_LIMIT_REGISTRY[classId].additional as Record<string, { phase: string }>)
      .filter(([, rule]) => rule.phase === "resource")
      .map(([id]) => id);
  const keyFactory = createCounterKeyFactory(TEST_HMAC_KEY, 1);
  const authorize = async (
    c: Parameters<typeof markAuthorizationConfirmed>[0],
    next: () => Promise<void>,
  ) => {
    markAuthorizationConfirmed(c);
    await next();
  };

  it("TC-RLM-004-290 the route registry's Stage 3 references equal the API-RLC-006 / 007 tables, and every Operation of a resource-rule class is in them", () => {
    const inClasses = [...OPERATION_CLASS_ASSIGNMENT]
      .filter(([, classId]) => (RESOURCE_CLASSES as readonly string[]).includes(classId))
      .map(([id]) => id)
      .sort();
    expect(Object.keys(SPEC_REFERENCES).sort()).toEqual(inClasses);
    for (const [operationId, kinds] of Object.entries(SPEC_REFERENCES))
      expect([...(resourceReferencesOf(operationId) ?? ["<none>"])].sort(), operationId).toEqual(
        [...kinds].sort(),
      );
    expect(() => assertResourceReferenceTable()).not.toThrow();
    // A matching registration passes; a different, a missing or an unexpected declaration is refused.
    const ok = {
      method: "GET",
      path: "/t",
      operationId: "API-TKT-003",
      rateLimitClass: "qr_display",
    };
    expect(() =>
      assertRouteRegistry([{ ...ok, resourceReferences: ["ticket_ref"] } as RouteRegistration]),
    ).not.toThrow();
    expect(() =>
      assertRouteRegistry([{ ...ok, resourceReferences: ["order_ref"] } as RouteRegistration]),
    ).toThrow(/API-RLC-007/);
    expect(() => assertRouteRegistry([ok as unknown as RouteRegistration])).toThrow(/API-RLC-007/);
    expect(() =>
      assertRouteRegistry([
        {
          method: "GET",
          path: "/s",
          operationId: "API-ADM-CNT-005",
          rateLimitClass: "admin_mutation",
          resourceReferences: ["faq_ref"],
        } as RouteRegistration,
      ]),
    ).toThrow(/API-RLC-007/);
    // An Operation without a reference declares an empty list (it is not missing).
    expect(() =>
      assertRouteRegistry([
        {
          method: "POST",
          path: "/n",
          operationId: "API-ADM-CNT-005",
          rateLimitClass: "admin_mutation",
          resourceReferences: [],
        } as RouteRegistration,
      ]),
    ).not.toThrow();
  });

  it("TC-RLM-004-291 each Operation records exactly its table references in Stage 3 (kind and canonical reference in the key, no Operation ID), and an Operation without a reference evaluates no resource rule", async () => {
    for (const [operationId, kinds] of Object.entries(SPEC_REFERENCES)) {
      const classId = rateLimitClassOf(operationId) as RouteClassId;
      const trs = createTestRateLimit();
      const m = mini(trs, { "/x": classId }, { operationId });
      let evaluated = 0;
      const referencesOf = () => {
        evaluated += 1;
        return Object.fromEntries(kinds.map((kind) => [kind, `${kind}-value`]));
      };
      const stage3 = isPurchaseStartOperation(operationId)
        ? requirePurchaseStartRateLimit(trs.rateLimit.limiter, {
            eligibility: () => true,
            referencesOf,
          })
        : requireResourceRateLimit(trs.rateLimit.limiter, referencesOf);
      m.app.post("/x", m.principal, authorize, stage3, (c) => c.json({ ok: true }));
      expect(
        (await send(m.app, "/x", "e30.e30.c2ln", IP, { method: "POST" })).status,
        operationId,
      ).toBe(200);
      const resourceKeys = trs.store
        .keys()
        .filter((key) => resourceRuleIds(classId).some((id) => key.includes(id)));
      if (kinds.length === 0) {
        expect(evaluated, operationId).toBe(0);
        expect(resourceKeys, operationId).toHaveLength(0);
        continue;
      }
      expect(evaluated, operationId).toBe(1);
      for (const kind of kinds)
        for (const ruleId of resourceRuleIds(classId))
          expect(
            trs.store.count(keyFactory.key(ruleId, "resource", `${kind}\0${kind}-value`)),
            `${operationId} ${ruleId} ${kind}`,
          ).toBe(1);
      expect(resourceKeys, operationId).toHaveLength(
        kinds.length * resourceRuleIds(classId).length,
      );
    }
  });

  it("TC-RLM-004-292 one class and one reference kind share a counter across Operations; a different class never shares it, and a different kind is a different counter", async () => {
    const overrides = {
      high_risk_recovery: {
        burst_limit: 2,
        sustained_limit: 6,
        additional: {
          "high_risk_recovery.resource_minute": { limit: 2, window_seconds: 60 },
          "high_risk_recovery.resource_hour": { limit: 10, window_seconds: 3600 },
        },
      },
      admin_mutation: {
        burst_limit: 3,
        sustained_limit: 12,
        additional: { "admin_mutation.resource": { limit: 2, window_seconds: 60 } },
      },
      qr_display: {
        burst_limit: 3,
        sustained_limit: 12,
        additional: { "qr_display.ticket": { limit: 2, window_seconds: 60 } },
      },
    };
    const trs = createTestRateLimit({ overrides });
    const call = async (operationId: string, ref: Record<string, string>, ip: string) => {
      trs.store.advance(11_000);
      const classId = rateLimitClassOf(operationId) as RouteClassId;
      const m = mini(trs, { "/x": classId }, { operationId });
      m.app.post(
        "/x",
        m.principal,
        authorize,
        requireResourceRateLimit(trs.rateLimit.limiter, () => ref),
        (c) => c.json({ ok: true }),
      );
      return (await send(m.app, "/x", "e30.e30.c2ln", ip, { method: "POST" })).status;
    };
    const order = "00000000-0000-4000-8000-0000000000aa";
    // API-ADM-PAY-001 / REC-004 / REC-005 share the per-Order counter (2 per minute).
    expect(await call("API-ADM-PAY-001", { order_ref: order }, "198.51.100.1")).toBe(200);
    expect(await call("API-ADM-REC-004", { order_ref: order.toUpperCase() }, "198.51.100.2")).toBe(
      200,
    );
    expect(await call("API-ADM-REC-005", { order_ref: order }, "198.51.100.3")).toBe(429);
    // A different reference kind of the same class (notification_ref) is a different counter.
    expect(await call("API-ADM-EML-004", { notification_ref: order }, "198.51.100.4")).toBe(200);
    expect(await call("API-ADM-REC-006", { notification_ref: order }, "198.51.100.5")).toBe(200);
    expect(await call("API-ADM-EML-005", { notification_ref: order }, "198.51.100.6")).toBe(429);
    // The same reservation_ref in two classes is two counters (admin_mutation vs qr_display).
    const reservation = "00000000-0000-4000-8000-0000000000bb";
    expect(await call("API-ADM-KRK-007", { reservation_ref: reservation }, "198.51.100.7")).toBe(
      200,
    );
    expect(await call("API-ADM-KRK-007", { reservation_ref: reservation }, "198.51.100.8")).toBe(
      200,
    );
    expect(await call("API-KRK-SELF-003", { reservation_ref: reservation }, "198.51.100.9")).toBe(
      200,
    );
    expect(await call("API-KRK-SELF-003", { reservation_ref: reservation }, "198.51.100.10")).toBe(
      200,
    );
    expect(await call("API-ADM-KRK-007", { reservation_ref: reservation }, "198.51.100.11")).toBe(
      429,
    );
    expect(await call("API-KRK-SELF-003", { reservation_ref: reservation }, "198.51.100.12")).toBe(
      429,
    );
  });

  it("TC-RLM-004-293 a Stage 3 reference that is not listed for the Operation, or an Operation outside the tables, is an implementation defect (500), never a silent pass", async () => {
    const trs = createTestRateLimit();
    const wrongKind = mini(trs, { "/x": "qr_display" }, { operationId: "API-TKT-003" });
    wrongKind.app.post(
      "/x",
      wrongKind.principal,
      authorize,
      requireResourceRateLimit(trs.rateLimit.limiter, () => ({ order_ref: "o" })),
      (c) => c.json({ ok: true }),
    );
    expect((await send(wrongKind.app, "/x", "e30.e30.c2ln", IP, { method: "POST" })).status).toBe(
      500,
    );
    const unknown = mini(trs, { "/y": "qr_display" }, { operationId: "API-NOT-LISTED-001" });
    unknown.app.post(
      "/y",
      unknown.principal,
      authorize,
      requireResourceRateLimit(trs.rateLimit.limiter, () => ({ ticket_ref: "t" })),
      (c) => c.json({ ok: true }),
    );
    expect((await send(unknown.app, "/y", "e30.e30.c2ln", IP, { method: "POST" })).status).toBe(
      500,
    );
    expect(trs.store.keys().filter((key) => key.includes("qr_display.ticket"))).toHaveLength(0);
  });

  it("TC-RLM-004-294 an unauthorized principal cannot consume a shared resource counter: a 403 leaves the role_assignment target counter unchanged and the Administrator is not 429", async () => {
    const overrides = {
      role_assignment: {
        burst_limit: 3,
        sustained_limit: 10,
        additional: { "role_assignment.profile": { limit: 5, window_seconds: 600 } },
      },
    };
    const trs = createTestRateLimit({ overrides });
    const target = "00000000-0000-4000-8000-0000000000cc";
    const build = (roles: ("STAFF" | "ADMINISTRATOR")[]) => {
      const m = mini(trs, { "/x": "role_assignment" }, { operationId: "API-ADM-ROL-002", roles });
      m.app.post(
        "/x",
        m.principal,
        requireCapability("role_assignment.manage"),
        requireResourceRateLimit(trs.rateLimit.limiter, () => ({ target_profile_ref: target })),
        (c) => c.json({ ok: true }),
      );
      return m;
    };
    const attendee = build([]);
    for (let i = 0; i < 12; i += 1) {
      trs.store.advance(11_000);
      expect(
        (await send(attendee.app, "/x", "e30.e30.c2ln", `198.51.100.${i + 1}`, { method: "POST" }))
          .status,
      ).toBe(403);
    }
    expect(trs.store.keys().filter((key) => key.includes("role_assignment.profile"))).toHaveLength(
      0,
    );
    const admin = build(["ADMINISTRATOR"]);
    for (let i = 0; i < 5; i += 1) {
      trs.store.advance(11_000);
      expect(
        (await send(admin.app, "/x", "e30.e30.c2ln", "203.0.113.200", { method: "POST" })).status,
      ).toBe(200);
    }
    trs.store.advance(11_000);
    expect(
      (await send(admin.app, "/x", "e30.e30.c2ln", "203.0.113.200", { method: "POST" })).status,
    ).toBe(429);
  });

  it("TC-RLM-004-295 purchase start: a request refused before the purchase.start check (no token, email not verified, Business Profile unresolved) reaches neither the pre-check nor Stage 3; after it the order is pre-check, Stage 3, Transaction", async () => {
    const trs = createTestRateLimit();
    const steps: string[] = [];
    const build = (options: Omit<MiniOptions, "operationId"> = {}) => {
      const m = mini(
        trs,
        { "/buy": "purchase_checkout" },
        { ...options, operationId: "API-PUR-ENTRY-001" },
      );
      m.app.post(
        "/buy",
        m.principal,
        requireVerifiedEmail(),
        requireCapability("purchase.start"),
        requirePurchaseStartRateLimit(trs.rateLimit.limiter, {
          eligibility: () => {
            steps.push("precheck");
            return true;
          },
          referencesOf: () => ({ offering_ref: "11111111-1111-4111-8111-111111111111" }),
        }),
        (c) => {
          steps.push("transaction");
          return c.json({ ok: true });
        },
      );
      return m;
    };
    const post = (m: ReturnType<typeof build>, token: string | undefined) =>
      send(m.app, "/buy", token, IP, { method: "POST" });
    const stage3Keys = () =>
      trs.store.keys().filter((key) => key.includes("purchase_checkout.resource"));
    expect((await post(build(), undefined)).status).toBe(401);
    expect((await post(build({ emailVerified: false }), "e30.e30.c2ln")).status).toBe(403);
    expect((await post(build({ noProfile: true }), "e30.e30.c2ln")).status).toBe(403);
    expect(steps).toEqual([]);
    expect(stage3Keys()).toHaveLength(0);
    expect((await post(build(), "e30.e30.c2ln")).status).toBe(200);
    expect(steps).toEqual(["precheck", "transaction"]);
    expect(stage3Keys()).toHaveLength(1);
  });
});

describe("signature verification under concurrency (SEC-ABU-033 (a), (c), (f))", () => {
  it("TC-RLM-005-236 200 concurrent badly signed tokens from one IP, every request reading the same guard count, run at most 8 verifications in the normal lane and at most the IP's bucket in the restricted lane", async () => {
    const trs = createTestRateLimit({ gate: { now: () => 1_000 } });
    // A store that answers slowly: every request reads the guard count before any failure is recorded.
    const original = trs.store.evaluate.bind(trs.store);
    trs.store.evaluate = async (mode, rules, id) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return original(mode, rules, id);
    };
    const base = trs.rateLimit.limiter;
    let guardReads = 0;
    const spied: TestRateLimit = {
      ...trs,
      rateLimit: {
        ...trs.rateLimit,
        limiter: {
          ...base,
          guardState: async (classId, ip) => {
            guardReads += 1;
            return base.guardState(classId, ip);
          },
        },
      },
    };
    const counter: Counting = { verifications: 0 };
    let inFlight = 0;
    let peak = 0;
    const real = countingVerifier(counter);
    const m = mini(
      spied,
      { "/buy": "purchase_checkout" },
      {
        verifier: {
          ...(real.inspect ? { inspect: real.inspect } : {}),
          verify: async (token) => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            try {
              await new Promise((resolve) => setTimeout(resolve, 2));
              return await real.verify(token);
            } finally {
              inFlight -= 1;
            }
          },
        },
      },
    );
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    const forged = await mint({ key: "foreign" });
    const responses = await Promise.all(
      Array.from({ length: 200 }, () => send(m.app, "/buy/ok", forged)),
    );
    // 8 slots in the normal lane (each read the guard once) and the IP's 10 restricted tokens.
    expect(guardReads).toBeLessThanOrEqual(8);
    expect(counter.verifications).toBeLessThanOrEqual(8 + 10);
    expect(counter.verifications).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(8 + 10);
    expect(responses.every((res) => res.status === 401 || res.status === 429)).toBe(true);
    expect(responses.filter((res) => res.status === 429).length).toBeGreaterThanOrEqual(200 - 18);
    // Failures are recorded in either lane; the guard limit of 20 is never exceeded.
    expect(guardRecords(trs)).toBeLessThanOrEqual(8 + 10);
  });

  it("TC-RLM-005-237 one saturated IP cannot use up the process-wide bucket: another saturated IP's valid token is still verified", async () => {
    const trs = createTestRateLimit({ overrides: guardOverride(1), gate: { now: () => 1_000 } });
    const counter: Counting = { verifications: 0 };
    const m = mini(trs, { "/buy": "purchase_checkout" }, { verifier: countingVerifier(counter) });
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    const forged = await mint({ key: "foreign" });
    for (const ip of ["198.51.100.1", "198.51.100.2"]) await send(m.app, "/buy/ok", forged, ip);
    for (let i = 0; i < 300; i += 1) await send(m.app, "/buy/ok", forged, "198.51.100.1");
    // 1 (normal lane) + 10 (IP 1's bucket); the process-wide 50 is far from used up.
    expect(counter.verifications).toBe(1 + 1 + 10);
    const valid = await send(
      m.app,
      "/buy/ok",
      await mint({ subject: subjectN(2) }),
      "198.51.100.2",
    );
    expect(valid.status).toBe(200);
  });

  it("TC-RLM-005-238 up to 8 concurrent valid tokens from one IP (NAT-shared staff) are all verified in the normal lane, never the restricted lane", async () => {
    // The restricted lane has no tokens at all: any request that fell into it would be a 429.
    const trs = createTestRateLimit({ gate: { perIpPerSecond: 0, now: () => 1_000 } });
    let inside = 0;
    const holders: (() => void)[] = [];
    const m = mini(
      trs,
      { "/handoff": "goods_handoff" },
      {
        verifier: {
          verify: async () => {
            inside += 1;
            await new Promise<void>((resolve) => {
              holders.push(resolve);
            });
            return { subject: subjectN(inside) };
          },
        },
      },
    );
    m.app.get("/handoff/ok", m.principal, (c) => c.json({ ok: true }));
    const requests = Array.from({ length: 8 }, () => send(m.app, "/handoff/ok", "e30.e30.c2ln"));
    await vi.waitFor(() => expect(inside).toBe(8));
    for (const release of holders) release();
    expect((await Promise.all(requests)).map((res) => res.status)).toEqual(Array(8).fill(200));
  });
});
