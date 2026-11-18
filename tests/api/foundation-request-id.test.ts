// PR-S0-1b addendum T1: an incoming X-Request-Id that is a canonical UUID is adopted (SPEC-110 §17,
// v2.4.0; UCR-110-005). Anything else is dropped, replaced by a server-generated UUID v4 and never
// written to a log or a response. request_id is correlation only (SEC-API-023, OBS-COR-001,
// REL-GEN-005). Synthetic data only. The relayed /auth/* answer keeps carrying no X-Request-Id
// (UCR-110-004 is PROPOSED and not an implementation contract).
import { describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/api/app.ts";
import { createAuthProxy } from "../../apps/api/src/api/auth-proxy.ts";
import { createLogger } from "../../packages/observability/src/index.ts";
import { createTestRateLimit, peer, type TestRateLimit } from "../harness/rate-limit/api.ts";

const WEB = "https://web.example.test";
const API = "https://api.example.test";
const EVIL = "https://evil.example.test";
const GOOD = "e30.e30.c2ln";
const SUBJECT = "00000000-0000-4000-8000-000000000090";
const PROFILE_REF = "00000000-0000-4000-8000-000000000091";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const V4 = "00000000-0000-4000-8000-000000000081";
const V7 = "00000000-0000-7000-8000-000000000082";
const V1_VARIANT_B = "00000000-0000-1000-b000-000000000083";
const UPPER = "0000000A-0000-4000-8000-000000000084";
const NIL = "00000000-0000-0000-0000-000000000000";
const MAX = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const VERSION_0 = "00000000-0000-0000-8000-000000000085";
const VERSION_9 = "00000000-0000-9000-8000-000000000085";
const VARIANT_C = "00000000-0000-4000-c000-000000000086";
const BRACED = "{00000000-0000-4000-8000-000000000087}";
const URN = "urn:uuid:00000000-0000-4000-8000-000000000087";
const TOO_LONG = "00000000-0000-4000-8000-0000000000870";
const NO_HYPHENS = "00000000000040008000000000000087";
const INJECTED = 'x"},{"injected":"1';

const SELF_READ_BURST_1 = {
  self_read: {
    burst_limit: 1,
    sustained_limit: 120,
    additional: { "self_read.ip": { limit: 240, window_seconds: 60 } },
  },
};

interface Rig {
  readonly app: ReturnType<typeof createApp>;
  readonly trs: TestRateLimit;
  readonly records: Record<string, unknown>[];
  readonly lines: string[];
  /** The headers the stub Neon Auth transport received, one entry per call. */
  readonly upstreamHeaders: Headers[];
  send(path: string, headers?: HeadersInit): Promise<Response>;
}

function rig(overrides: Record<string, unknown> = {}): Rig {
  const records: Record<string, unknown>[] = [];
  const lines: string[] = [];
  const upstreamHeaders: Headers[] = [];
  const trs = createTestRateLimit({ overrides });
  const logger = createLogger(
    { service: "API", environment: "test", actor_type: "GUEST" },
    (line) => {
      lines.push(line);
      records.push(JSON.parse(line) as Record<string, unknown>);
    },
  );
  const proxy = createAuthProxy(
    { baseUrl: "https://neon.example.test/auth", publicAuthOrigin: API, webOrigin: WEB },
    async (_url, init) => {
      upstreamHeaders.push(new Headers(init.headers));
      return Response.json({ ok: true });
    },
  );
  const app = createApp({
    webOrigin: WEB,
    ready: async () => true,
    logger,
    auth: {
      verifier: {
        verify: async () => ({ subject: SUBJECT }),
      },
      store: {
        findByAuthSubject: async () => ({
          directory: { authSubject: SUBJECT, emailVerified: true },
          profile: { id: "1", publicRef: PROFILE_REF, authSubject: SUBJECT },
          roles: [],
        }),
      },
    },
    rateLimit: trs.rateLimit,
    authProxy: proxy,
  });
  return {
    app,
    trs,
    records,
    lines,
    upstreamHeaders,
    send: async (path, headers) =>
      app.request(
        path.startsWith("http") ? path : `${API}${path}`,
        headers ? { headers } : {},
        peer(),
      ),
  };
}

const bearer = { Authorization: `Bearer ${GOOD}` };
const completions = (r: Rig) => r.records.filter((x) => x.event_name === "http.request.completed");
const errorRequestId = async (res: Response) =>
  ((await res.json()) as { error: { request_id: string } }).error.request_id;

describe("TC-SEC-API-023-002 an incoming canonical X-Request-Id is adopted; anything else is replaced (SEC-API-023, OBS-COR-001, SPEC-110 §17, SPEC-160 §8)", () => {
  describe("a canonical UUID is adopted as is", () => {
    for (const [label, id] of [
      ["version 4", V4],
      ["version 7", V7],
      ["version 1 with variant b", V1_VARIANT_B],
    ] as const) {
      it(`${label}: header, meta.request_id, error request_id and every log record carry it`, async () => {
        const ok = rig();
        const okRes = await ok.send("/api/v1/self/principal", { ...bearer, "X-Request-Id": id });
        expect(okRes.status).toBe(200);
        expect(okRes.headers.get("X-Request-Id")).toBe(id);
        expect(((await okRes.json()) as { meta: { request_id: string } }).meta.request_id).toBe(id);
        expect(ok.records.length).toBeGreaterThan(1);
        for (const record of ok.records) expect(record.request_id).toBe(id);

        const failures: [string, string, Record<string, string>, number][] = [
          ["401", "/api/v1/self/principal", { Origin: WEB }, 401],
          ["403", "/api/v1/self/principal", { ...bearer, Origin: EVIL }, 403],
          ["404", "/api/v1/missing", {}, 404],
        ];
        for (const [name, path, headers, status] of failures) {
          const r = rig();
          const res = await r.send(path, { ...headers, "X-Request-Id": id });
          expect(res.status, name).toBe(status);
          expect(res.headers.get("X-Request-Id"), name).toBe(id);
          expect(await errorRequestId(res), name).toBe(id);
          expect(r.records.length, name).toBeGreaterThan(0);
          for (const record of r.records) expect(record.request_id, name).toBe(id);
        }
      });
    }
  });

  describe("a missing value is replaced by a fresh server-generated UUID v4", () => {
    it("two requests without the header get different UUID v4 values that match everywhere", async () => {
      const r = rig();
      const first = await r.send("/api/v1/missing");
      const second = await r.send("/api/v1/missing");
      const a = first.headers.get("X-Request-Id") ?? "";
      const b = second.headers.get("X-Request-Id") ?? "";
      expect(a).toMatch(UUID_V4);
      expect(b).toMatch(UUID_V4);
      expect(a).not.toBe(b);
      expect(await errorRequestId(first)).toBe(a);
      expect(await errorRequestId(second)).toBe(b);
    });
  });

  describe("an invalid value is never adopted and never written", () => {
    const cases: [string, HeadersInit, readonly string[]][] = [
      ["empty", { "X-Request-Id": "" }, []],
      ["upper-case", { "X-Request-Id": UPPER }, [UPPER, UPPER.toLowerCase()]],
      ["nil", { "X-Request-Id": NIL }, [NIL]],
      ["max", { "X-Request-Id": MAX }, [MAX]],
      ["version 0", { "X-Request-Id": VERSION_0 }, [VERSION_0]],
      ["version 9", { "X-Request-Id": VERSION_9 }, [VERSION_9]],
      ["variant c", { "X-Request-Id": VARIANT_C }, [VARIANT_C]],
      ["braced", { "X-Request-Id": BRACED }, [BRACED]],
      ["URN prefixed", { "X-Request-Id": URN }, [URN]],
      ["37 characters", { "X-Request-Id": TOO_LONG }, [TOO_LONG]],
      ["32 characters without hyphens", { "X-Request-Id": NO_HYPHENS }, [NO_HYPHENS]],
      [
        "two header values (a combined value)",
        new Headers([
          ["X-Request-Id", V4],
          ["X-Request-Id", V7],
        ]),
        [V4, V7],
      ],
      ["quotes and braces", { "X-Request-Id": INJECTED }, [INJECTED, "injected"]],
    ];
    for (const [label, headers, forbidden] of cases) {
      it(`${label}: a fresh UUID v4 is used and the received text appears in no header, body or log line`, async () => {
        const r = rig();
        const res = await r.send("/api/v1/missing", headers);
        const id = res.headers.get("X-Request-Id") ?? "";
        expect(res.status).toBe(404);
        expect(id).toMatch(UUID_V4);
        const body = await res.text();
        expect(JSON.parse(body).error.request_id).toBe(id);
        expect(r.records.length).toBeGreaterThan(0);
        for (const record of r.records) expect(record.request_id).toBe(id);
        const headerLines: string[] = [];
        res.headers.forEach((value, name) => {
          headerLines.push(`${name}: ${value}`);
        });
        const everything = [body, ...r.lines, ...headerLines].join("\n");
        for (const text of forbidden) expect(everything, text).not.toContain(text);
      });
    }

    it("an invalid value on an authenticated request is replaced in the success envelope and all logs", async () => {
      const r = rig();
      const res = await r.send("/api/v1/self/principal", { ...bearer, "X-Request-Id": UPPER });
      const id = res.headers.get("X-Request-Id") ?? "";
      expect(res.status).toBe(200);
      expect(id).toMatch(UUID_V4);
      expect(((await res.json()) as { meta: { request_id: string } }).meta.request_id).toBe(id);
      for (const record of r.records) expect(record.request_id).toBe(id);
      expect(r.lines.join("\n").toLowerCase()).not.toContain(UPPER.toLowerCase());
    });
  });

  describe("surrounding white space is not part of the HTTP field value", () => {
    it("a canonical value padded with spaces is adopted without the padding", async () => {
      const r = rig();
      const res = await r.send("/api/v1/missing", { "X-Request-Id": `  ${V4}  ` });
      expect(res.headers.get("X-Request-Id")).toBe(V4);
      expect(await errorRequestId(res)).toBe(V4);
      for (const record of r.records) expect(record.request_id).toBe(V4);
    });
  });

  describe("request_id is correlation only", () => {
    it("two requests carrying the same adopted value are both counted by the rate limit and get different operation_execution_id values", async () => {
      const r = rig(SELF_READ_BURST_1);
      const first = await r.send("/api/v1/self/principal", { ...bearer, "X-Request-Id": V4 });
      const second = await r.send("/api/v1/self/principal", { ...bearer, "X-Request-Id": V4 });
      expect([first.status, second.status]).toEqual([200, 429]);
      // Stage 1 and Stage 2 evaluate each request; the limiter uses its own identifier.
      expect(r.trs.store.calls).toHaveLength(4);
      const done = completions(r);
      expect(done).toHaveLength(2);
      const executions = done.map((x) => String(x.operation_execution_id));
      for (const execution of executions) expect(execution).toMatch(UUID_ANY);
      expect(executions[0]).not.toBe(executions[1]);
      // The adoption is the last assertion on purpose: the behavior above holds before and after it.
      expect(first.headers.get("X-Request-Id")).toBe(V4);
      expect(second.headers.get("X-Request-Id")).toBe(V4);
      expect(done.map((x) => x.request_id)).toEqual([V4, V4]);
    });
  });

  describe("the auth proxy (/auth/*)", () => {
    it("logs the adopted value, neither forwards the header upstream nor adds it to the relayed answer (UCR-110-004 is PROPOSED)", async () => {
      const r = rig();
      const res = await r.send(`${API}/auth/get-session`, {
        Origin: WEB,
        "X-Request-Id": V4,
      });
      expect(res.status).toBe(200);
      expect(r.upstreamHeaders).toHaveLength(1);
      expect(r.upstreamHeaders[0]?.has("x-request-id")).toBe(false);
      expect(res.headers.get("X-Request-Id")).toBeNull();
      expect(res.headers.get("Access-Control-Expose-Headers")).toBeNull();
      const done = completions(r);
      expect(done).toHaveLength(1);
      expect(done[0]).toMatchObject({ http_route: "/auth/get-session", http_status: 200 });
      // The adoption is the last assertion on purpose: the behavior above holds before and after it.
      expect(done[0]?.request_id).toBe(V4);
    });

    it("an invalid value is not logged and the upstream still receives no x-request-id", async () => {
      const r = rig();
      await r.send(`${API}/auth/get-session`, { Origin: WEB, "X-Request-Id": UPPER });
      expect(r.upstreamHeaders[0]?.has("x-request-id")).toBe(false);
      const done = completions(r);
      expect(done).toHaveLength(1);
      expect(String(done[0]?.request_id)).toMatch(UUID_V4);
      expect(r.lines.join("\n").toLowerCase()).not.toContain(UPPER.toLowerCase());
    });
  });
});
