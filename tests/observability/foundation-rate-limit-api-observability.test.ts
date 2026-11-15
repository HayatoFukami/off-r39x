import { describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/api/app.ts";
import { createRateLimitMetricsObserver } from "../../apps/api/src/api/rate-limit.ts";
import { AuthFailure } from "../../packages/auth/src/index.ts";
import { createLogger, createRateLimitMetrics } from "../../packages/observability/src/index.ts";
import { RATE_LIMIT_CLASS_IDS } from "../../packages/security/src/index.ts";
import { createTestRateLimit, peer, type TestRateLimit } from "../harness/rate-limit/api.ts";

const SUBJECT = "aef69f82-c9b7-4fd1-9a6f-126f5748e9ae";
const PROFILE_REF = "5c2d5d1e-7f4a-4a3b-9d0e-3a1b2c4d5e6f";
const IP = "203.0.113.9";
const GOOD = "e30.e30.c2ln";
const WEB = "https://web.example.test";

/** A complete per-class override (RATE_LIMIT_CONFIG replaces a class as a whole). */
const selfRead = (burst: number, sustained: number, ip = 240) => ({
  self_read: {
    burst_limit: burst,
    sustained_limit: sustained,
    additional: { "self_read.ip": { limit: ip, window_seconds: 60 } },
  },
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

/** The production app with the real auth proxy; the identifier rule allows 1 and the IP burst is configurable. */

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
