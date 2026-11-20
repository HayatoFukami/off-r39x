// PR-S0-1b C1: characterization of the current HTTP behavior of apps/api, so that the file split
// (middleware/*, routes/*, rpc.ts) can be shown to change nothing. This file is NOT edited by the
// split. Every expected value below was recorded by running the pre-split code; random values
// (X-Request-Id, operation_execution_id, duration_ms, timestamp) are checked by shape and replaced
// with a placeholder before the literal comparison. Synthetic data only.
// Revised after SPEC-110 v2.6.0 (§17 adoption of a canonical incoming X-Request-Id, §24.1 order of
// the Email verified check): those expectations changed by the specification, not by the split.
// See the TC-SEC-API-023-001 and TC-SEC-ABU-017-001 titles.
// Revised again for PR-L2-1a (API-AUTH-002 / API-AUTH-004, SPEC-110 §25): GET and PATCH
// /api/v1/self/profile are new registered routes, so the http_route list (TC-TST-OBS-001-001) and the
// mounted route list (TC-DEV-API-002-002) gain them. Those expectations changed by the specification;
// every other recorded value is untouched.
// Revised for PR-L2-3 (API-PUB-001..005, API-PUB-012, SPEC-110 section 26.1): the six public read routes are
// registered, so the http_route list (TC-TST-OBS-001-001) and the mounted route list (TC-DEV-API-002-002)
// gain them and the "no public path" check becomes "no public path but the six". These expectations
// changed by the specification, not by the implementation; every other recorded value is untouched.
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type ApiEnvironment,
  type AppDependencies,
  type AppRateLimit,
  createApp,
  requireCapability,
  requirePrincipal,
  requireVerifiedEmail,
} from "../../apps/api/src/api/app.ts";
import { createAuthProxy } from "../../apps/api/src/api/auth-proxy.ts";
import { AuthFailure } from "../../packages/auth/src/index.ts";
import { createLogger } from "../../packages/observability/src/index.ts";
import { createRecordingPublicContentStore } from "../harness/api/public-read.ts";
import { createRecordingProfileStore } from "../harness/api/self-profile.ts";
import { createTestRateLimit, peer, type TestRateLimit } from "../harness/rate-limit/api.ts";

const WEB = "https://web.example.test";
const API = "https://api.example.test";
const GOOD = "e30.e30.c2ln";
const BAD = "e30.e30.YmFk";
const SUBJECT = "00000000-0000-4000-8000-000000000071";
const PROFILE_REF = "00000000-0000-4000-8000-000000000072";
const INCOMING_REQUEST_ID = "00000000-0000-4000-8000-000000000079";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Role = "STAFF" | "ADMINISTRATOR";
interface RigOptions {
  readonly rateLimit?: boolean;
  readonly authProxy?: boolean;
  readonly drain?: boolean;
  readonly allowedHosts?: readonly string[];
  readonly overrides?: Record<string, unknown>;
}
interface Rig {
  readonly app: ReturnType<typeof createApp>;
  readonly trs: TestRateLimit | undefined;
  /** Store calls, verification, directory lookups, handler calls and log events, in time order. */
  readonly order: string[];
  readonly records: Record<string, unknown>[];
  readonly lines: string[];
  readonly state: {
    draining: boolean;
    emailVerified: boolean;
    dbFails: boolean;
    transportCalls: number;
  };
  send(path: string, init?: RequestInit): Promise<Response>;
  reset(): void;
}

function rig(options: RigOptions = {}): Rig {
  const order: string[] = [];
  const records: Record<string, unknown>[] = [];
  const lines: string[] = [];
  const state = { draining: false, emailVerified: true, dbFails: false, transportCalls: 0 };
  const trs = options.rateLimit
    ? createTestRateLimit({ overrides: options.overrides ?? {} })
    : undefined;
  if (trs) {
    const evaluate = trs.store.evaluate.bind(trs.store);
    trs.store.evaluate = async (mode, rules, id) => {
      order.push(`store:${mode}`);
      return evaluate(mode, rules, id);
    };
  }
  const logger = createLogger(
    { service: "API", environment: "test", actor_type: "GUEST" },
    (line) => {
      const record = JSON.parse(line) as Record<string, unknown>;
      lines.push(line);
      records.push(record);
      order.push(
        `log:${String(record.event_name)}${record.error_code ? `:${String(record.error_code)}` : ""}`,
      );
    },
  );
  const proxy = createAuthProxy(
    { baseUrl: "https://neon.example.test/auth", publicAuthOrigin: API, webOrigin: WEB },
    async () => {
      state.transportCalls += 1;
      return Response.json({ ok: true });
    },
  );
  const app = createApp({
    webOrigin: WEB,
    ready: async () => true,
    logger,
    auth: {
      verifier: {
        verify: async (token: string) => {
          order.push("verify");
          if (token.endsWith("YmFk")) throw new AuthFailure("unauthenticated");
          return { subject: SUBJECT };
        },
      },
      store: {
        findByAuthSubject: async () => {
          order.push("db");
          if (state.dbFails) throw new Error("synthetic directory failure");
          return {
            directory: { authSubject: SUBJECT, emailVerified: state.emailVerified },
            profile: { id: "1", publicRef: PROFILE_REF, authSubject: SUBJECT },
            roles: [],
          };
        },
      },
    },
    profiles: createRecordingProfileStore({
      [SUBJECT]: {
        publicRef: PROFILE_REF,
        displayName: null,
        updatedAt: "2026-11-01T00:00:00.000Z",
      },
    }),
    publicContent: createRecordingPublicContentStore(),
    ...(trs ? { rateLimit: trs.rateLimit } : {}),
    ...(options.authProxy ? { authProxy: proxy } : {}),
    ...(options.drain ? { draining: () => state.draining } : {}),
    ...(options.allowedHosts ? { allowedHosts: options.allowedHosts } : {}),
  });
  return {
    app,
    trs,
    order,
    records,
    lines,
    state,
    send: async (path, init) =>
      app.request(path.startsWith("http") ? path : `${API}${path}`, init, peer()),
    reset: () => {
      order.length = 0;
      records.length = 0;
      lines.length = 0;
      if (trs) trs.store.calls.length = 0;
    },
  };
}
const minimalRig = () => rig();
const fullRig = (options: RigOptions = {}) => rig({ rateLimit: true, authProxy: true, ...options });
const bearer = { Authorization: `Bearer ${GOOD}` };
const withOrigin = (headers: Record<string, string> = {}) => ({ ...headers, Origin: WEB });
const completions = (r: Rig) => r.records.filter((x) => x.event_name === "http.request.completed");

/** Header names are lower-case; the list is sorted by name; the random request ID is masked. */
const maskedHeaders = (res: Response): [string, string][] => {
  const entries: [string, string][] = [];
  res.headers.forEach((value, name) => {
    entries.push([name, name === "x-request-id" ? "<uuid>" : value]);
  });
  return entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
};

/** The secure-headers set plus the HSTS value that every response of the API carries. */
const SECURITY_HEADERS: Record<string, string> = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "origin-agent-cluster": "?1",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-dns-prefetch-control": "off",
  "x-download-options": "noopen",
  "x-frame-options": "SAMEORIGIN",
  "x-permitted-cross-domain-policies": "none",
  "x-xss-protection": "0",
};
const expectedHeaders = (extra: Record<string, string>): [string, string][] =>
  Object.entries({ ...SECURITY_HEADERS, ...extra }).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
const CORS_EXPOSE = "X-Request-Id, Retry-After";

const errorBody = (code: string, message: string, requestId: string, retryable: boolean) => ({
  error: { code, message, request_id: requestId, retryable, details: null },
});
const NOT_FOUND_MESSAGE = "Requested resource was not found.";
const GENERIC_MESSAGE = "Request could not be completed.";

interface HeaderCase {
  readonly name: string;
  readonly status: number;
  readonly headers: [string, string][];
  readonly send: () => Promise<Response>;
}
const headerCases = (): HeaderCase[] => {
  const minimal = minimalRig();
  const full = fullRig();
  return [
    {
      name: "1 health live (minimal app)",
      status: 200,
      send: () => minimal.send("/internal/health/live"),
      headers: expectedHeaders({
        "cache-control": "no-store",
        "content-type": "application/json",
        "x-request-id": "<uuid>",
      }),
    },
    {
      name: "2 principal 200 with the Web origin",
      status: 200,
      send: () => full.send("/api/v1/self/principal", { headers: withOrigin(bearer) }),
      headers: expectedHeaders({
        "access-control-allow-origin": WEB,
        "access-control-expose-headers": CORS_EXPOSE,
        "cache-control": "no-store",
        "content-type": "application/json",
        vary: "Origin",
        "x-request-id": "<uuid>",
      }),
    },
    {
      name: "3 principal 200 without an Origin",
      status: 200,
      send: () => full.send("/api/v1/self/principal", { headers: bearer }),
      headers: expectedHeaders({
        "cache-control": "no-store",
        "content-type": "application/json",
        vary: "Origin",
        "x-request-id": "<uuid>",
      }),
    },
    {
      name: "4 preflight 204",
      status: 204,
      send: () =>
        full.send("/api/v1/self/principal", {
          method: "OPTIONS",
          headers: withOrigin({
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
          }),
        }),
      headers: expectedHeaders({
        "access-control-allow-headers":
          "Authorization, Content-Type, Idempotency-Key, X-Request-Id",
        "access-control-allow-methods": "GET, HEAD, POST, PATCH, DELETE",
        "access-control-allow-origin": WEB,
        "access-control-expose-headers": CORS_EXPOSE,
        "cache-control": "no-store",
        vary: "Origin",
        "x-request-id": "<uuid>",
      }),
    },
    {
      name: "5 principal 401 without a token",
      status: 401,
      send: () => full.send("/api/v1/self/principal", { headers: withOrigin() }),
      headers: expectedHeaders({
        "access-control-allow-origin": WEB,
        "access-control-expose-headers": CORS_EXPOSE,
        "cache-control": "no-store",
        "content-type": "application/json",
        vary: "Origin",
        "x-request-id": "<uuid>",
      }),
    },
    {
      name: "6 principal 403 from another origin",
      status: 403,
      send: () =>
        full.send("/api/v1/self/principal", {
          headers: { ...bearer, Origin: "https://evil.example.test" },
        }),
      headers: expectedHeaders({
        "cache-control": "no-store",
        "content-type": "application/json",
        vary: "Origin",
        "x-request-id": "<uuid>",
      }),
    },
    {
      name: "7 unknown path 404",
      status: 404,
      send: () => full.send("/api/v1/missing", { headers: withOrigin() }),
      headers: expectedHeaders({
        "access-control-allow-origin": WEB,
        "access-control-expose-headers": CORS_EXPOSE,
        "cache-control": "no-store",
        "content-type": "application/json",
        vary: "Origin",
        "x-request-id": "<uuid>",
      }),
    },
    {
      // Observed before the split: the auth proxy builds its own Response and the answer carries
      // no X-Request-Id and no Access-Control-Expose-Headers. Pinned as is (behavior-preserving).
      name: "8 auth proxy relay 200",
      status: 200,
      send: () => full.send(`${API}/auth/get-session`, { headers: withOrigin() }),
      headers: expectedHeaders({
        "access-control-allow-credentials": "true",
        "access-control-allow-origin": WEB,
        "cache-control": "no-store",
        "content-type": "application/json",
        vary: "Origin",
      }),
    },
  ];
};

describe("TC-SEC-API-007-001 response headers (SEC-API-006/007, SEC-WEB-007, SEC-ABU-025)", () => {
  it("each representative response keeps its full header set (names and values)", async () => {
    for (const c of headerCases()) {
      const res = await c.send();
      expect(res.status, c.name).toBe(c.status);
      expect(maskedHeaders(res), c.name).toEqual(c.headers);
    }
  });

  it("every response is no-store with HSTS; credentials are allowed only on the auth proxy relay", async () => {
    for (const c of headerCases()) {
      const res = await c.send();
      expect(res.headers.get("Cache-Control"), c.name).toBe("no-store");
      expect(res.headers.get("Strict-Transport-Security"), c.name).toBe(
        "max-age=63072000; includeSubDomains",
      );
      const credentials = res.headers.get("Access-Control-Allow-Credentials");
      if (c.name.startsWith("8 ")) expect(credentials, c.name).toBe("true");
      else expect(credentials, c.name).toBeNull();
    }
  });
});

describe("TC-SEC-API-023-001 X-Request-Id (SEC-API-023, OBS-COR-001, SPEC-110 §17)", () => {
  it("every API response carries a server-generated UUID v4; the relayed auth proxy answer carries none", async () => {
    for (const c of headerCases()) {
      const res = await c.send();
      const id = res.headers.get("X-Request-Id");
      if (c.name.startsWith("8 ")) expect(id, c.name).toBeNull();
      else expect(id, c.name).toMatch(UUID_V4);
    }
    const draining = fullRig({ drain: true });
    draining.state.draining = true;
    expect((await draining.send("/api/v1/self/principal")).headers.get("X-Request-Id")).toMatch(
      UUID_V4,
    );
  });

  it("the value differs per request without an incoming value, and an incoming canonical UUID is adopted (SPEC-110 §17)", async () => {
    const r = fullRig();
    const first = await r.send("/api/v1/self/principal", { headers: bearer });
    const second = await r.send("/api/v1/self/principal", { headers: bearer });
    expect(first.headers.get("X-Request-Id")).not.toBe(second.headers.get("X-Request-Id"));
    const withIncoming = await r.send("/api/v1/self/principal", {
      headers: { ...bearer, "X-Request-Id": INCOMING_REQUEST_ID },
    });
    expect(withIncoming.headers.get("X-Request-Id")).toBe(INCOMING_REQUEST_ID);
  });

  it("the header equals the error request_id, the meta request_id and every log record of the request", async () => {
    const success = fullRig();
    const ok = await success.send("/api/v1/self/principal", { headers: bearer });
    const okId = ok.headers.get("X-Request-Id");
    expect(((await ok.json()) as { meta: { request_id: string } }).meta.request_id).toBe(okId);
    expect(success.order.filter((x) => x.startsWith("log:"))).toEqual([
      "log:auth.verification.completed",
      "log:auth.email_verified_resolution.completed",
      "log:auth.business_profile_resolution.completed",
      "log:authorization.role_resolution.completed",
      "log:http.request.completed",
    ]);
    expect(success.records).toHaveLength(5);
    for (const record of success.records) expect(record.request_id).toBe(okId);

    const failures: [string, string, RequestInit, number][] = [
      ["401", "/api/v1/self/principal", { headers: withOrigin() }, 401],
      [
        "403",
        "/api/v1/self/principal",
        { headers: { ...bearer, Origin: "https://evil.example.test" } },
        403,
      ],
      ["404", "/api/v1/missing", {}, 404],
    ];
    for (const [name, path, init, status] of failures) {
      const r = fullRig();
      const res = await r.send(path, init);
      expect(res.status, name).toBe(status);
      const id = res.headers.get("X-Request-Id");
      expect(((await res.json()) as { error: { request_id: string } }).error.request_id, name).toBe(
        id,
      );
      expect(r.records.length, name).toBeGreaterThan(0);
      for (const record of r.records) expect(record.request_id, name).toBe(id);
    }
  });
});

describe("TC-INF-RWY-005-001 draining answers 503 first (INF-RWY-005, SEC-ABU-001, SPEC-110 §21)", () => {
  const DRAIN_HEADERS = expectedHeaders({
    "cache-control": "no-store",
    "content-type": "application/json",
    "x-request-id": "<uuid>",
  });
  const cases: [string, string, RequestInit, string][] = [
    ["1 principal", "/api/v1/self/principal", { headers: withOrigin(bearer) }, "GET"],
    [
      "2 auth proxy",
      `${API}/auth/sign-in/email`,
      {
        method: "POST",
        headers: withOrigin({ "content-type": "application/json" }),
        body: JSON.stringify({}),
      },
      "POST",
    ],
    ["3 unknown path", "/api/v1/missing", {}, "GET"],
    ["4 method not allowed", "/internal/health/live", { method: "PUT" }, "PUT"],
    ["5 health ready", "/internal/health/ready", {}, "GET"],
  ];

  it("API, auth proxy, unknown, 405 and health paths answer 503 TEMPORARY_UNAVAILABLE before any dependency is called", async () => {
    const r = fullRig({ drain: true });
    r.state.draining = true;
    for (const [name, path, init, method] of cases) {
      r.reset();
      const res = await r.send(path, init);
      const id = res.headers.get("X-Request-Id") ?? "";
      expect(id, name).toMatch(UUID_V4);
      expect(res.status, name).toBe(503);
      expect(await res.json(), name).toEqual(
        errorBody("TEMPORARY_UNAVAILABLE", GENERIC_MESSAGE, id, true),
      );
      expect(maskedHeaders(res), name).toEqual(DRAIN_HEADERS);
      expect(res.headers.get("Access-Control-Allow-Origin"), name).toBeNull();
      expect(res.headers.get("Allow"), name).toBeNull();
      // Only the completion log is observed: no store call, no verification, no directory lookup.
      expect(r.order, name).toEqual(["log:http.request.completed"]);
      expect(r.state.transportCalls, name).toBe(0);
      const logs = completions(r);
      expect(logs, name).toHaveLength(1);
      expect(logs[0], name).toMatchObject({
        level: "ERROR",
        result: "FAILED",
        request_id: id,
        http_method: method,
        http_route: "/",
        http_status: 503,
      });
    }
  });

  it("the host check answers 400 before the drain check, and clearing the flag restores service", async () => {
    const hosted = fullRig({ drain: true, allowedHosts: ["api.example.test"] });
    hosted.state.draining = true;
    const res = await hosted.send("https://evil.example.test/api/v1/self/principal", {
      headers: withOrigin(bearer),
    });
    const id = res.headers.get("X-Request-Id") ?? "";
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(errorBody("MALFORMED_REQUEST", GENERIC_MESSAGE, id, false));
    expect(
      completions(hosted).map((x) => [x.http_status, x.http_route, x.level, x.result]),
    ).toEqual([[400, "/", "INFO", "REJECTED"]]);

    const r = fullRig({ drain: true });
    r.state.draining = true;
    expect((await r.send("/internal/health/ready")).status).toBe(503);
    r.state.draining = false;
    expect((await r.send("/api/v1/self/principal", { headers: withOrigin(bearer) })).status).toBe(
      200,
    );
    expect((await r.send("/internal/health/ready")).status).toBe(200);
  });
});

describe("TC-SEC-API-022-001 unknown paths and namespace roots (SEC-API-022, SPEC-110 §14/§21)", () => {
  const PATHS = [
    "/",
    "/api",
    "/api/v1",
    "/api/v1/public",
    "/api/v1/public/",
    "/api/v1/public/events",
    "/api/v1/self",
    "/api/v1/self/orders",
    "/api/v1/staff",
    "/api/v1/staff/checkins",
    "/api/v1/admin",
    "/api/v1/admin/orders",
    "/api/v1/webhooks/stripe",
    "/api/v2/self/principal",
    "/internal/health",
    "/auth",
  ];
  for (const [label, make, storeCalls] of [
    ["minimal app", minimalRig, [] as string[]],
    ["full app", fullRig, ["admit:20/10000,120/60000"]],
  ] as const) {
    it(`${label}: every path without an Operation is a 404 RESOURCE_NOT_FOUND without Allow`, async () => {
      const r = make();
      for (const path of PATHS) {
        r.reset();
        const res = await r.send(path);
        const id = res.headers.get("X-Request-Id") ?? "";
        expect(res.status, path).toBe(404);
        expect(await res.json(), path).toEqual(
          errorBody("RESOURCE_NOT_FOUND", NOT_FOUND_MESSAGE, id, false),
        );
        expect(res.headers.get("Allow"), path).toBeNull();
        expect(res.headers.get("Cache-Control"), path).toBe("no-store");
        // The unmatched request is evaluated once (Stage 1, public_read per-IP) in the full app.
        expect(
          (r.trs?.store.calls ?? []).map(
            (call) => `${call.mode}:${call.rules.map((x) => `${x.limit}/${x.windowMs}`).join(",")}`,
          ),
          path,
        ).toEqual(storeCalls);
        expect(
          completions(r).map((x) => [x.http_status, x.http_route]),
          path,
        ).toEqual([[404, "/"]]);
      }
    });
  }

  it("a POST to the webhook path is refused by the Origin check first (403) and is a 404 with the Web origin", async () => {
    const r = fullRig();
    const refused = await r.send("/api/v1/webhooks/stripe", { method: "POST" });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual(
      errorBody(
        "AUTHORIZATION_DENIED",
        GENERIC_MESSAGE,
        refused.headers.get("X-Request-Id") ?? "",
        false,
      ),
    );
    expect(refused.headers.get("Allow")).toBeNull();
    const withWeb = await r.send("/api/v1/webhooks/stripe", {
      method: "POST",
      headers: { Origin: WEB },
    });
    expect(withWeb.status).toBe(404);
    expect(await withWeb.json()).toEqual(
      errorBody(
        "RESOURCE_NOT_FOUND",
        NOT_FOUND_MESSAGE,
        withWeb.headers.get("X-Request-Id") ?? "",
        false,
      ),
    );
    expect(withWeb.headers.get("Allow")).toBeNull();
  });
});

describe("TC-TST-OBS-001-001 completion log and http_route (TST-OBS-001, SPEC-160 §15, OBS-LOG-006)", () => {
  const AUTH_ROUTES: [string, string][] = [
    ["GET", "get-session"],
    ["GET", "token"],
    ["GET", "verify-email"],
    ["GET", "magic-link/verify"],
    ["POST", "sign-up/email"],
    ["POST", "sign-in/email"],
    ["POST", "sign-in/social"],
    ["POST", "sign-in/email-otp"],
    ["POST", "sign-in/magic-link"],
    ["POST", "sign-out"],
    ["POST", "send-verification-email"],
    ["POST", "request-password-reset"],
    ["POST", "reset-password"],
    ["POST", "email-otp/send-verification-otp"],
    ["POST", "email-otp/verify-email"],
  ];
  /** The 25 values http_route may take; anything else is logged as "/". */
  const ALLOWED_ROUTES = [
    "/internal/health/live",
    "/internal/health/ready",
    "/api/v1/public/event",
    "/api/v1/public/faqs",
    "/api/v1/public/announcements",
    "/api/v1/public/announcements/:announcement_ref",
    "/api/v1/public/entry-offerings",
    "/api/v1/public/sponsor-logos",
    "/api/v1/self/principal",
    "/api/v1/self/profile",
    "/auth/get-session",
    "/auth/token",
    "/auth/verify-email",
    "/auth/magic-link/verify",
    "/auth/sign-up/email",
    "/auth/sign-in/email",
    "/auth/sign-in/social",
    "/auth/sign-in/email-otp",
    "/auth/sign-in/magic-link",
    "/auth/sign-out",
    "/auth/send-verification-email",
    "/auth/request-password-reset",
    "/auth/reset-password",
    "/auth/email-otp/send-verification-otp",
    "/auth/email-otp/verify-email",
  ];
  const authRequest = (method: string): RequestInit =>
    method === "POST"
      ? { method, headers: withOrigin({ "content-type": "application/json" }), body: "{}" }
      : { method, headers: withOrigin() };

  interface Row {
    readonly name: string;
    readonly rig: Rig;
    readonly path: string;
    readonly init: RequestInit;
    readonly method: string;
    readonly route: string;
    readonly status: number;
    readonly level: "INFO" | "ERROR";
    readonly result: "SUCCESS" | "REJECTED" | "FAILED";
  }
  const rows = (): Row[] => {
    const full = fullRig();
    const make = (
      name: string,
      path: string,
      init: RequestInit,
      method: string,
      route: string,
      status: number,
      r: Rig = full,
    ): Row => ({
      name,
      rig: r,
      path,
      init,
      method,
      route,
      status,
      level: status >= 500 ? "ERROR" : "INFO",
      result: status < 400 ? "SUCCESS" : status >= 500 ? "FAILED" : "REJECTED",
    });
    return [
      make("1 health live", "/internal/health/live", {}, "GET", "/internal/health/live", 200),
      make("2 health ready", "/internal/health/ready", {}, "GET", "/internal/health/ready", 200),
      make(
        "3 principal 200",
        "/api/v1/self/principal",
        { headers: bearer },
        "GET",
        "/api/v1/self/principal",
        200,
      ),
      make("4 principal 401", "/api/v1/self/principal", {}, "GET", "/api/v1/self/principal", 401),
      ...(
        [
          ["API-PUB-001", "/api/v1/public/event", "/api/v1/public/event"],
          ["API-PUB-002", "/api/v1/public/faqs", "/api/v1/public/faqs"],
          ["API-PUB-003", "/api/v1/public/announcements", "/api/v1/public/announcements"],
          [
            "API-PUB-004",
            "/api/v1/public/announcements/00000000-0000-4000-8000-0000000000a1",
            "/api/v1/public/announcements/:announcement_ref",
          ],
          ["API-PUB-005", "/api/v1/public/entry-offerings", "/api/v1/public/entry-offerings"],
          ["API-PUB-012", "/api/v1/public/sponsor-logos", "/api/v1/public/sponsor-logos"],
        ] as const
      ).map(([id, path, route]) => make(`public ${id} 200`, path, {}, "GET", route, 200)),
      make(
        "4b profile 200",
        "/api/v1/self/profile",
        { headers: bearer },
        "GET",
        "/api/v1/self/profile",
        200,
      ),
      make(
        "4c profile patch 200",
        "/api/v1/self/profile",
        {
          method: "PATCH",
          headers: withOrigin({ ...bearer, "content-type": "application/json" }),
          body: '{"display_name":"synthetic name"}',
        },
        "PATCH",
        "/api/v1/self/profile",
        200,
      ),
      ...AUTH_ROUTES.map(([method, path]) =>
        make(
          `auth ${method} ${path}`,
          `${API}/auth/${path}`,
          authRequest(method),
          method,
          `/auth/${path}`,
          // A body of `{}` is refused by the proxy for the social sign-in only (recorded value).
          path === "sign-in/social" ? 400 : 200,
        ),
      ),
      make("20 unknown path 404", "/api/v1/missing", {}, "GET", "/", 404),
      make("21 405", "/internal/health/live", { method: "PUT" }, "PUT", "/", 405),
      make(
        "23 principal on an app without a rate limit (Stage 1 fails closed)",
        "/api/v1/self/principal",
        { headers: bearer },
        "GET",
        "/",
        503,
        minimalRig(),
      ),
    ];
  };

  it("each request emits exactly one completion record, last, with the recorded route, method, status, level and result", async () => {
    const seenRoutes = new Set<string>();
    for (const row of rows()) {
      row.rig.reset();
      const res = await row.rig.send(row.path, row.init);
      expect(res.status, row.name).toBe(row.status);
      const logs = completions(row.rig);
      expect(logs, row.name).toHaveLength(1);
      expect(row.rig.records.at(-1), row.name).toBe(logs[0]);
      expect(logs[0], row.name).toMatchObject({
        http_route: row.route,
        http_method: row.method,
        http_status: row.status,
        level: row.level,
        result: row.result,
        is_retry: false,
      });
      if (row.route !== "/") seenRoutes.add(row.route);
    }
    expect([...seenRoutes].sort()).toEqual([...ALLOWED_ROUTES].sort());
    expect(ALLOWED_ROUTES).toHaveLength(25);
  });

  it("a route added after createApp is not in the registry and is logged as '/'", async () => {
    const r = fullRig();
    r.app.get("/api/v1/test/:ref", (c) => c.json({ ok: true }));
    const res = await r.send("/api/v1/test/synthetic", { headers: bearer });
    expect(res.status).toBe(200);
    expect(completions(r).map((x) => [x.http_route, x.level, x.result])).toEqual([
      ["/", "INFO", "SUCCESS"],
    ]);
  });

  it("the record keys are fixed and the log never carries a token, a query or a URL", async () => {
    const r = fullRig();
    await r.send("/internal/health/live");
    expect(Object.keys(completions(r)[0] ?? {}).sort()).toEqual([
      "actor_type",
      "duration_ms",
      "environment",
      "event_name",
      "http_method",
      "http_route",
      "http_status",
      "is_retry",
      "level",
      "request_id",
      "result",
      "schema_version",
      "service",
      "timestamp",
    ]);
    expect(completions(r)[0]).not.toHaveProperty("operation_id");

    r.reset();
    await r.send("/api/v1/self/principal?probe=1", { headers: bearer });
    const principal = completions(r)[0] ?? {};
    expect(Object.keys(principal).sort()).toEqual([
      "actor_ref",
      "actor_type",
      "duration_ms",
      "environment",
      "event_name",
      "http_method",
      "http_route",
      "http_status",
      "is_retry",
      "level",
      "operation_execution_id",
      "operation_id",
      "request_id",
      "result",
      "schema_version",
      "service",
      "timestamp",
    ]);
    expect(principal).toMatchObject({
      operation_id: "API-AUTH-001",
      actor_type: "AUTHENTICATED_USER",
      actor_ref: PROFILE_REF,
      http_route: "/api/v1/self/principal",
    });
    expect(principal.operation_execution_id).toMatch(UUID_V4);
    expect(principal.request_id).toMatch(UUID_V4);
    expect(typeof principal.duration_ms).toBe("number");
    const text = r.lines.join("\n");
    expect(text).not.toContain(GOOD);
    expect(text).not.toContain("?");
    expect(text).not.toContain("https://");
  });

  it("the unauthenticated request keeps the Operation and a GUEST actor", async () => {
    const r = fullRig();
    await r.send("/api/v1/self/principal");
    const record = completions(r)[0] ?? {};
    expect(record).toMatchObject({
      operation_id: "API-AUTH-001",
      actor_type: "GUEST",
      http_status: 401,
      level: "INFO",
      result: "REJECTED",
    });
    expect(record).not.toHaveProperty("actor_ref");
  });
});

describe("TC-SEC-ABU-017-001 authentication pipeline order (SEC-ABU-017, SPEC-110 §24/§24.1, OBS-AUTH-001)", () => {
  const SELF_READ_BURST_1 = {
    self_read: {
      burst_limit: 1,
      sustained_limit: 120,
      additional: { "self_read.ip": { limit: 240, window_seconds: 60 } },
    },
  };
  const get = (r: Rig, headers: Record<string, string> = bearer) =>
    r.send("/api/v1/self/principal", { headers });
  /** A harness-only route: Principal, email and Capability checks without the Stage 2 hooks. */
  const capabilityRoute = (r: Rig, roles: Role[]) =>
    r.app.get(
      "/api/v1/test/cap",
      requirePrincipal(
        {
          verify: async () => {
            r.order.push("verify");
            return { subject: SUBJECT };
          },
        },
        {
          findByAuthSubject: async () => {
            r.order.push("db");
            return {
              directory: { authSubject: SUBJECT, emailVerified: true },
              profile: { id: "1", publicRef: PROFILE_REF, authSubject: SUBJECT },
              roles,
            };
          },
        },
      ),
      requireVerifiedEmail(),
      requireCapability("entry_checkin.execute"),
      (c) => {
        r.order.push("handler");
        return c.json({ ok: true });
      },
    );

  it("success: Stage 1, verification, Stage 2, directory, email before the Business Profile, completion", async () => {
    const r = fullRig();
    expect((await get(r)).status).toBe(200);
    expect(r.order).toEqual([
      "store:admit",
      "verify",
      "log:auth.verification.completed",
      "store:admit",
      "db",
      "log:auth.email_verified_resolution.completed",
      "log:auth.business_profile_resolution.completed",
      "log:authorization.role_resolution.completed",
      "log:http.request.completed",
    ]);
  });

  it("no token: rejected before verification and the directory", async () => {
    const r = fullRig();
    expect((await get(r, {})).status).toBe(401);
    expect(r.order).toEqual([
      "store:admit",
      "log:auth.verification.completed:AUTHENTICATION_REQUIRED",
      "log:security.fail_closed.triggered:AUTHENTICATION_REQUIRED",
      "log:http.request.completed",
    ]);
  });

  it("failed verification: no Stage 2 and no directory lookup", async () => {
    const r = fullRig();
    expect((await get(r, { Authorization: `Bearer ${BAD}` })).status).toBe(401);
    expect(r.order).toEqual([
      "store:admit",
      "verify",
      "log:auth.verification.completed:AUTHENTICATION_REQUIRED",
      "log:security.fail_closed.triggered:AUTHENTICATION_REQUIRED",
      "log:http.request.completed",
    ]);
  });

  it("Stage 2 rejection (429): the directory is not reached", async () => {
    const r = fullRig({ overrides: SELF_READ_BURST_1 });
    expect((await get(r)).status).toBe(200);
    r.reset();
    const res = await get(r);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
    expect(r.order).toEqual([
      "store:admit",
      "verify",
      "log:auth.verification.completed",
      "store:admit",
      "log:ratelimit.decision.completed:RATE_LIMIT_EXCEEDED",
      "log:http.request.completed",
    ]);
  });

  it("directory failure (503): the unavailable event precedes the fail-closed event", async () => {
    const r = fullRig();
    r.state.dbFails = true;
    expect((await get(r)).status).toBe(503);
    expect(r.order).toEqual([
      "store:admit",
      "verify",
      "log:auth.verification.completed",
      "store:admit",
      "db",
      "log:auth.business_profile_resolution.completed:ROLE_RESOLUTION_UNAVAILABLE",
      "log:security.fail_closed.triggered:DATABASE_TEMPORARY_FAILURE",
      "log:http.request.completed",
    ]);
  });

  it("unverified email (403): the email refusal comes before any Business Profile or Role event (SPEC-110 §24.1)", async () => {
    const r = fullRig();
    r.state.emailVerified = false;
    expect((await get(r)).status).toBe(403);
    expect(r.order).toEqual([
      "store:admit",
      "verify",
      "log:auth.verification.completed",
      "store:admit",
      "db",
      "log:auth.email_verified_resolution.completed:EMAIL_VERIFICATION_REQUIRED",
      "log:security.fail_closed.triggered:EMAIL_VERIFICATION_REQUIRED",
      "log:http.request.completed",
    ]);
  });

  it("capability denied (403): the handler is not called", async () => {
    const r = fullRig();
    capabilityRoute(r, []);
    const res = await r.send("/api/v1/test/cap", { headers: bearer });
    expect(res.status).toBe(403);
    expect(r.order).toEqual([
      "store:admit",
      "verify",
      "log:auth.verification.completed",
      "db",
      "log:auth.email_verified_resolution.completed",
      "log:auth.business_profile_resolution.completed",
      "log:authorization.role_resolution.completed",
      "log:authorization.decision.completed:CAPABILITY_DENIED",
      "log:security.fail_closed.triggered:AUTHORIZATION_DENIED",
      "log:http.request.completed",
    ]);
  });

  it("capability granted (200): decision, handler, then the completion log", async () => {
    const r = fullRig();
    capabilityRoute(r, ["STAFF"]);
    const res = await r.send("/api/v1/test/cap", { headers: bearer });
    expect(res.status).toBe(200);
    expect(r.order).toEqual([
      "store:admit",
      "verify",
      "log:auth.verification.completed",
      "db",
      "log:auth.email_verified_resolution.completed",
      "log:auth.business_profile_resolution.completed",
      "log:authorization.role_resolution.completed",
      "log:authorization.decision.completed",
      "handler",
      "log:http.request.completed",
    ]);
  });
});

describe("TC-DEV-API-002-002 route table and public surface of app.ts (DEV-API-002, DEV-RLM-005, SPEC-110 §14/§15)", () => {
  const MIDDLEWARE_AND_RPC = [
    ["ALL", "/*"],
    ["ALL", "/*"],
    ["ALL", "/api/v1/*"],
    ["ALL", "/*"],
    ["ALL", "/api/v1/*"],
    ["ALL", "/auth/*"],
    ["ALL", "/*"],
    ["ALL", "/api/v1/*"],
    ["ALL", "/api/v1/*"],
    // PR-L2-3: the six public read routes are mounted first (mountRpcRoutes), each as a guard entry, a
    // query validator entry and a handler entry, in the order API-PUB-001, 002, 003, 004, 005, 012.
    ...[
      "/api/v1/public/event",
      "/api/v1/public/faqs",
      "/api/v1/public/announcements",
      "/api/v1/public/announcements/:announcement_ref",
      "/api/v1/public/entry-offerings",
      "/api/v1/public/sponsor-logos",
    ].flatMap((path) => [
      ["GET", path],
      ["GET", path],
      ["GET", path],
    ]),
    // The RPC route is registered as a guard entry and a handler entry.
    ["GET", "/api/v1/self/principal"],
    ["GET", "/api/v1/self/principal"],
    // API-AUTH-002 (guard + handler) and API-AUTH-004 (guard + body validator + handler).
    ["GET", "/api/v1/self/profile"],
    ["GET", "/api/v1/self/profile"],
    ["PATCH", "/api/v1/self/profile"],
    ["PATCH", "/api/v1/self/profile"],
    ["PATCH", "/api/v1/self/profile"],
  ];
  const HEALTH = [
    ["GET", "/internal/health/live"],
    ["GET", "/internal/health/ready"],
  ];
  const AUTH_PATHS = [
    ["GET", "/auth/get-session"],
    ["GET", "/auth/token"],
    ["GET", "/auth/verify-email"],
    ["GET", "/auth/magic-link/verify"],
    ["POST", "/auth/sign-up/email"],
    ["POST", "/auth/sign-in/email"],
    ["POST", "/auth/sign-in/social"],
    ["POST", "/auth/sign-in/email-otp"],
    ["POST", "/auth/sign-in/magic-link"],
    ["POST", "/auth/sign-out"],
    ["POST", "/auth/send-verification-email"],
    ["POST", "/auth/request-password-reset"],
    ["POST", "/auth/reset-password"],
    ["POST", "/auth/email-otp/send-verification-otp"],
    ["POST", "/auth/email-otp/verify-email"],
  ];
  const routesOf = (r: Rig) => r.app.routes.map(({ method, path }) => [method, path]);

  it("exports exactly the five runtime names and keeps the three type exports", async () => {
    const module = await import("../../apps/api/src/api/app.ts");
    expect(Object.keys(module).sort()).toEqual([
      "ApiFailure",
      "createApp",
      "requireCapability",
      "requirePrincipal",
      "requireVerifiedEmail",
    ]);
    expectTypeOf<AppDependencies>().toHaveProperty("webOrigin");
    expectTypeOf<AppDependencies>().toHaveProperty("ready");
    expectTypeOf<AppRateLimit>().toHaveProperty("limiter");
    expectTypeOf<ApiEnvironment>().toHaveProperty("Variables");
  });

  it("the minimal app mounts the recorded (method, path) list", () => {
    expect(routesOf(minimalRig())).toEqual([...MIDDLEWARE_AND_RPC, ...HEALTH]);
  });

  it("the app with an auth proxy and a rate limit mounts the recorded (method, path) list", () => {
    const authRoutes = AUTH_PATHS.flatMap(([method, path]) => [
      [method, path],
      ["OPTIONS", path],
    ]);
    expect(routesOf(fullRig())).toEqual([...MIDDLEWARE_AND_RPC, ...authRoutes, ...HEALTH]);
  });

  it("no staff, admin or webhook path, no public path but the six public read paths and no self path other than principal and profile is mounted", () => {
    const publicReadPaths = [
      "/api/v1/public/event",
      "/api/v1/public/faqs",
      "/api/v1/public/announcements",
      "/api/v1/public/announcements/:announcement_ref",
      "/api/v1/public/entry-offerings",
      "/api/v1/public/sponsor-logos",
    ];
    for (const r of [minimalRig(), fullRig()]) {
      for (const [method, path] of routesOf(r) as [string, string][]) {
        if (path.startsWith("/api/v1/public")) {
          expect(publicReadPaths, path).toContain(path);
          expect(method, path).toBe("GET");
        }
        for (const prefix of ["/api/v1/staff", "/api/v1/admin", "/api/v1/webhooks"])
          expect(path.startsWith(prefix), path).toBe(false);
        if (path.startsWith("/api/v1/self/"))
          expect(["/api/v1/self/principal", "/api/v1/self/profile"]).toContain(path);
      }
    }
  });
});
