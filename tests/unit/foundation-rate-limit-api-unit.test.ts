import { describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/api/app.ts";
import { AuthFailure } from "../../packages/auth/src/index.ts";
import { createLogger } from "../../packages/observability/src/index.ts";
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
