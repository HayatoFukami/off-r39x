// SPEC-140 SEC-ABU-021 / 029 / 031 / 033, SPEC-160 §24.1, SPEC-110 §24.1 (seventh PR #41 review and
// the PR #46 review follow-ups) at the API layer: the signature verification budget, guard Class ID
// and Actor Type in the decision logs, multi-resource Stage 3 through the middleware, the purchase
// start pre-check, and Connection: close on every early auth_form_proxy refusal.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { type ApiEnvironment, ApiFailure, requirePrincipal } from "../../apps/api/src/api/app.ts";
import {
  createPrincipalRateLimitHooks,
  createRateLimitMetricsObserver,
  createRateLimitStageOne,
  markAuthorizationConfirmed,
  requireResourceRateLimit,
} from "../../apps/api/src/api/rate-limit.ts";
import { AuthFailure } from "../../packages/auth/src/index.ts";
import { createLogger, createRateLimitMetrics } from "../../packages/observability/src/index.ts";
import { RATE_LIMIT_CLASS_IDS, type RouteClassId } from "../../packages/security/src/index.ts";
import {
  createTestRateLimit,
  peer,
  type TestRateLimit,
  testAuthSubjectRef,
} from "../harness/rate-limit/api.ts";

const PROFILE_REF = "5c2d5d1e-7f4a-4a3b-9d0e-3a1b2c4d5e6f";
const IP = "203.0.113.9";
const subjectN = (n: number) => `aef69f82-c9b7-4fd1-9a6f-126f5748e9a${n}`;

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
const guardOverride = (burst: number) => ({
  auth_failure_guard_attendee: { burst_limit: burst, sustained_limit: 50 },
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
    const m = mini(trs, { "/qr": "qr_display" }, { roles: ["STAFF"], operationId: "API-TKT-003" });
    m.app.get(
      "/qr/:id",
      m.principal,
      async (c, next) => {
        markAuthorizationConfirmed(c);
        await next();
      },
      requireResourceRateLimit(trs.rateLimit.limiter, (c) => ({
        ticket_ref: c.req.param("id") ?? "",
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

describe("PR #46 concurrent verification and observation regressions", () => {
  it("TC-RLM-009-214 every restricted-lane refusal is included in the rejected counter under the guard Class ID", async () => {
    const metrics = createRateLimitMetrics({ environment: "test", classIds: RATE_LIMIT_CLASS_IDS });
    const trs = createTestRateLimit({
      overrides: guardOverride(1),
      limiter: { observer: createRateLimitMetricsObserver(metrics) },
      gate: { perIpPerSecond: 0, now: () => 1000 },
    });
    const m = mini(trs, { "/buy": "purchase_checkout" });
    m.app.get("/buy/ok", m.principal, (c) => c.json({ ok: true }));
    await send(m.app, "/buy/ok", "e30.e30.YmFk");
    for (let i = 0; i < 100; i++)
      expect((await send(m.app, "/buy/ok", "e30.e30.YmFk")).status).toBe(429);
    const rejected = metrics.snapshot().decisions.filter((d) => d.result === "rejected");
    expect(rejected.reduce((n, d) => n + d.value, 0)).toBe(100);
    // SPEC-160 §24.1: the event and the metric both use the guard's Class ID, not the route class.
    expect(new Set(rejected.map((d) => d.class_id))).toEqual(
      new Set(["auth_failure_guard_attendee"]),
    );
    const events = m.events().filter((e) => e.event_name === "ratelimit.decision.completed");
    expect(events).toHaveLength(100);
    expect(events.every((e) => e.class_id === "auth_failure_guard_attendee")).toBe(true);
    expect(events.every((e) => e.actor_type === "GUEST")).toBe(true);
  });

  it("TC-RLM-009-215 a body-slot refusal records both its event and rejected counter without an extra store call", async () => {
    const metrics = createRateLimitMetrics({ environment: "test", classIds: RATE_LIMIT_CLASS_IDS });
    const trs = createTestRateLimit({
      limiter: { observer: createRateLimitMetricsObserver(metrics) },
    });
    const m = mini(trs, { "/auth": "auth_form_proxy" });
    m.app.post("/auth/form", (c) => c.json({ ok: true }));
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
    const held = Array.from({ length: 3 }, () =>
      m.app.request(
        "/auth/form",
        {
          method: "POST",
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controllers.push(controller);
            },
          }),
          duplex: "half",
        } as RequestInit,
        peer(),
      ),
    );
    try {
      await vi.waitFor(() => expect(trs.store.calls).toHaveLength(3));
      const before = trs.store.calls.length;
      expect(
        (await m.app.request("/auth/form", { method: "POST", body: "{}" }, peer())).status,
      ).toBe(429);
      expect(trs.store.calls.length - before).toBe(1);
      expect(
        metrics
          .snapshot()
          .decisions.find((d) => d.class_id === "auth_form_proxy" && d.result === "rejected")
          ?.value,
      ).toBe(1);
      // A body-read slot refusal keeps the route class (SPEC-160 §24.1).
      const concurrency = m.events().filter((e) => e.rule_category === "concurrency");
      expect(concurrency).toHaveLength(1);
      expect(concurrency[0]?.class_id).toBe("auth_form_proxy");
    } finally {
      for (const controller of controllers) controller.error(new Error("synthetic disconnect"));
      await Promise.allSettled(held);
    }
  });

  it("TC-RLM-009-216 a Stage 2 refusal is attributed to AUTHENTICATED_USER with the auth-subject fingerprint, never a guessed Role or Profile reference", async () => {
    const trs = createTestRateLimit({
      overrides: {
        self_read: {
          burst_limit: 1,
          sustained_limit: 120,
          additional: { "self_read.ip": { limit: 240, window_seconds: 60 } },
        },
      },
    });
    const m = mini(trs, { "/self": "self_read" }, { roles: ["STAFF"] });
    m.app.get("/self/x", m.principal, (c) => c.json({ ok: true }));
    expect((await send(m.app, "/self/x", "e30.e30.c2ln")).status).toBe(200);
    expect((await send(m.app, "/self/x", "e30.e30.c2ln")).status).toBe(429);
    const refused = m.events().find((e) => e.event_name === "ratelimit.decision.completed");
    expect(refused).toMatchObject({
      actor_type: "AUTHENTICATED_USER",
      actor_ref: testAuthSubjectRef(subjectN(1)),
      rule_category: "burst",
    });
    expect(refused?.actor_ref).not.toBe(PROFILE_REF);
  });

  it("TC-RLM-009-217 an undeterminable Client IP (503) is one decision event under the route class and is not counted in the decision metric", async () => {
    const metrics = createRateLimitMetrics({ environment: "test", classIds: RATE_LIMIT_CLASS_IDS });
    const trs = createTestRateLimit({
      limiter: { observer: createRateLimitMetricsObserver(metrics) },
    });
    const m = mini(trs, { "/buy": "purchase_checkout" });
    m.app.get("/buy/ok", (c) => c.json({ ok: true }));
    // No socket peer: the Client IP cannot be derived (SEC-API-031).
    expect((await m.app.request("/buy/ok")).status).toBe(503);
    expect((await m.app.request("/unknown/path")).status).toBe(503);
    const events = m.events();
    const decisions = events.filter((e) => e.event_name === "ratelimit.decision.completed");
    expect(decisions.map((e) => e.class_id)).toEqual(["purchase_checkout", "public_read"]);
    for (const event of decisions) {
      expect(event).toMatchObject({
        result: "FAILED",
        error_code: "TEMPORARY_UNAVAILABLE",
        actor_type: "GUEST",
      });
      expect(event).not.toHaveProperty("rule_category");
    }
    // It is not a store decision: no fail-closed event, no counter (OBS-ALT-041 must not fire).
    expect(events.some((e) => e.event_name === "security.fail_closed.triggered")).toBe(false);
    expect(metrics.snapshot().decisions.reduce((n, d) => n + d.value, 0)).toBe(0);
    expect(trs.store.calls).toHaveLength(0);
  });
});
