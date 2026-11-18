import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiFailure, createApp } from "../../apps/api/src/api/app.ts";
import type { ServiceResult } from "../../apps/api/src/api/services/result.ts";
import {
  type ErrorCode,
  errorSchema,
  errorStatuses,
} from "../../packages/api-contract/src/index.ts";
import { DatabaseUnavailableError } from "../../packages/db/src/index.ts";
import { createLogger } from "../../packages/observability/src/index.ts";

// PR-S0-3a C1: the error envelope, the success envelope and the domain-result mapping of apps/api,
// driven through harness-only routes added to a test app (TST-GEN-006: nothing is added to the
// production route table). No DB, Redis or network. Expected values come from SPEC-110 sections
// 17, 19, 20, 21, 28 (API-PUR-CART-001), 50, 51 and SPEC-140 SEC-ERR-001..003, not from the code.
// TC-SEC-ERR-001-001 / TC-SEC-API-022-002 describe behavior that already holds for the old
// failure() helper (coverage that must survive the refactor); the other cases need the new
// respond.ts.

const WEB = "https://web.example.test";
const TARGET_A = "00000000-0000-4000-8000-00000000000a";
const FIXED_MESSAGE = "Request could not be completed.";
const NOT_FOUND_MESSAGE = "Requested resource was not found.";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Json = Record<string, unknown>;

function rig() {
  const lines: string[] = [];
  const logger = createLogger(
    { service: "API", environment: "test", actor_type: "GUEST" },
    (line) => {
      lines.push(line);
    },
  );
  const app = createApp({ webOrigin: WEB, ready: async () => true, logger });
  const records = () => lines.map((line) => JSON.parse(line) as Json);
  const completions = (requestId: string) =>
    records().filter(
      (record) => record.event_name === "http.request.completed" && record.request_id === requestId,
    );
  return { app, lines, records, completions };
}
async function readError(response: Response): Promise<{ text: string; error: Json }> {
  const text = await response.text();
  return { text, error: (JSON.parse(text) as { error: Json }).error };
}
/** Every error response, whatever the code: status, schema, headers and request id (SPEC-110 17, 20, 21). */
function expectEnvelope(response: Response, text: string, code: ErrorCode, label: string = code) {
  const parsed = errorSchema.safeParse(JSON.parse(text));
  expect(parsed.success, label).toBe(true);
  const error = (JSON.parse(text) as { error: Json }).error;
  expect(response.status, label).toBe(errorStatuses[code]);
  expect(error.code, label).toBe(code);
  expect(error.request_id, label).toMatch(UUID_V4);
  expect(response.headers.get("X-Request-Id"), label).toBe(error.request_id);
  expect(response.headers.get("Cache-Control"), label).toBe("no-store");
  expect(response.headers.get("Content-Type"), label).toMatch(/^application\/json/);
  return error;
}

// respond.ts is loaded lazily so the cases that only need today's behavior (TC-SEC-ERR-001-001,
// TC-SEC-API-022-002) still run while that module does not exist yet.
const loadRespond = () => import("../../apps/api/src/api/respond.ts");

// SPEC-110 section 21: the codes whose Retryable column is Yes. The two 条件付き codes
// (AUTHENTICATION_REQUIRED, INTERNAL_ERROR) resolve to false in a produced response (S0-3a G-a1 B).
const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "RATE_LIMIT_EXCEEDED",
  "STRIPE_TEMPORARY_FAILURE",
  "DATABASE_TEMPORARY_FAILURE",
  "AUTH_SERVICE_TEMPORARY_FAILURE",
  "TEMPORARY_UNAVAILABLE",
]);

const dataSchema = z.strictObject({ name: z.string() });

describe("TC-SEC-ERR-001-001 every ApiFailure code produces the section 21 envelope", () => {
  const codes = (Object.keys(errorStatuses) as ErrorCode[]).filter(
    (code) => code !== "METHOD_NOT_ALLOWED",
  );

  it("covers 25 codes through a thrown ApiFailure", () => {
    expect(codes).toHaveLength(25);
  });

  it.each(codes)("%s", async (code) => {
    const { app } = rig();
    app.get("/api/v1/test/failure", () => {
      throw code === "RATE_LIMIT_EXCEEDED"
        ? new ApiFailure(code, { retryAfterSeconds: 7 })
        : new ApiFailure(code);
    });
    const response = await app.request("/api/v1/test/failure");
    const { text, error } = await readError(response);
    expectEnvelope(response, text, code);
    // retryable is decided by the code (section 21); a conditional code resolves to false (G-a1 B).
    expect(error.retryable).toBe(RETRYABLE_CODES.has(code));
    expect(error.details).toBeNull();
    expect(error.message).toBe(code === "RESOURCE_NOT_FOUND" ? NOT_FOUND_MESSAGE : FIXED_MESSAGE);
    expect(Object.keys(error).sort()).toEqual([
      "code",
      "details",
      "message",
      "request_id",
      "retryable",
    ]);
    expect(Object.keys(JSON.parse(text) as Json)).toEqual(["error"]);
    expect(response.headers.get("Allow")).toBeNull();
    if (code === "RATE_LIMIT_EXCEEDED") expect(response.headers.get("Retry-After")).toBe("7");
    else expect(response.headers.get("Retry-After")).toBeNull();
  });

  it("RATE_LIMIT_EXCEEDED rounds a Retry-After of 0 up to 1 and keeps details null", async () => {
    const { app } = rig();
    app.get("/api/v1/test/limit/:seconds", (c) => {
      throw new ApiFailure("RATE_LIMIT_EXCEEDED", {
        retryAfterSeconds: Number(c.req.param("seconds")),
      });
    });
    for (const [input, expected] of [
      ["7", "7"],
      ["0", "1"],
    ] as const) {
      const response = await app.request(`/api/v1/test/limit/${input}`);
      const { text, error } = await readError(response);
      expectEnvelope(response, text, "RATE_LIMIT_EXCEEDED");
      expect(response.headers.get("Retry-After"), input).toBe(expected);
      expect(error.retryable).toBe(true);
      expect(error.details).toBeNull();
    }
  });

  it("METHOD_NOT_ALLOWED on a known path carries Allow and the same envelope", async () => {
    const { app } = rig();
    const response = await app.request("/internal/health/live", {
      method: "PUT",
      headers: { Origin: WEB },
    });
    const { text, error } = await readError(response);
    expectEnvelope(response, text, "METHOD_NOT_ALLOWED");
    expect(error).toMatchObject({ retryable: false, details: null, message: FIXED_MESSAGE });
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
  });
});

describe("TC-SEC-API-022-002 405 lists Allow, an unknown path is 404, never a converted status", () => {
  it("lists the methods of a literal path, a parameterized path and a multi-method path in ascending order", async () => {
    const { app } = rig();
    app.get("/api/v1/test/:ref", (c) => c.json({ ok: true }));
    app.get("/api/v1/test/multi", (c) => c.json({ ok: true }));
    app.post("/api/v1/test/multi", (c) => c.json({ ok: true }));
    const cases: [string, string][] = [
      ["/internal/health/live", "GET, HEAD"],
      ["/api/v1/test/synthetic", "GET, HEAD"],
      ["/api/v1/test/multi", "GET, HEAD, POST"],
    ];
    for (const [path, allow] of cases) {
      for (const method of ["PUT", "DELETE"]) {
        const response = await app.request(path, { method, headers: { Origin: WEB } });
        const { text, error } = await readError(response);
        expectEnvelope(response, text, "METHOD_NOT_ALLOWED", `${method} ${path}`);
        expect(error.retryable, path).toBe(false);
        expect(response.headers.get("Allow"), `${method} ${path}`).toBe(allow);
      }
    }
  });

  it("an unknown path is 404 RESOURCE_NOT_FOUND for every method and has no Allow header", async () => {
    const { app } = rig();
    for (const method of ["GET", "PUT", "DELETE", "POST"]) {
      const response = await app.request("/api/v1/missing/path", {
        method,
        headers: { Origin: WEB },
      });
      const { text, error } = await readError(response);
      expectEnvelope(response, text, "RESOURCE_NOT_FOUND", method);
      expect(error).toMatchObject({ retryable: false, details: null });
      expect(response.headers.get("Allow"), method).toBeNull();
      expect([401, 403, 409]).not.toContain(response.status);
    }
  });
});

describe("TC-DEV-API-003-003 the success envelope is built in one place and validated", () => {
  async function routes() {
    const { respond, successResponse } = await loadRespond();
    const harness = rig();
    const { app } = harness;
    app.get("/api/v1/test/success/ok", (c) =>
      successResponse(c, dataSchema, { name: "synthetic" }),
    );
    app.get("/api/v1/test/success/created", (c) =>
      successResponse(c, dataSchema, { name: "synthetic" }, 201),
    );
    app.get("/api/v1/test/success/extra", (c) =>
      successResponse(c, dataSchema, {
        name: "synthetic-data-marker",
        internal_id: "9007199254740993",
      } as never),
    );
    app.get("/api/v1/test/success/wrong-type", (c) =>
      successResponse(c, dataSchema, { name: 12345 } as never),
    );
    app.get("/api/v1/test/respond/ok", (c) =>
      respond(c, { kind: "success", status: 200, data: { name: "synthetic" } }, dataSchema),
    );
    app.get("/api/v1/test/respond/created", (c) =>
      respond(c, { kind: "success", status: 201, data: { name: "synthetic" } }, dataSchema),
    );
    app.get("/api/v1/test/respond/extra", (c) =>
      respond(
        c,
        {
          kind: "success",
          status: 200,
          data: { name: "synthetic-data-marker", internal_id: "9007199254740993" },
        } as never,
        dataSchema,
      ),
    );
    return harness;
  }

  it.each([
    ["/api/v1/test/success/ok", 200],
    ["/api/v1/test/success/created", 201],
    ["/api/v1/test/respond/ok", 200],
    ["/api/v1/test/respond/created", 201],
  ] as const)("%s is %i with exactly { data, meta: { request_id } }", async (path, status) => {
    const { app } = await routes();
    const response = await app.request(path);
    expect(response.status).toBe(status);
    const body = (await response.json()) as Json;
    const requestId = response.headers.get("X-Request-Id");
    expect(requestId).toMatch(UUID_V4);
    expect(body).toEqual({ data: { name: "synthetic" }, meta: { request_id: requestId } });
  });

  it.each([
    "/api/v1/test/success/extra",
    "/api/v1/test/success/wrong-type",
    "/api/v1/test/respond/extra",
  ])(
    "%s: data that does not match the schema is 500 INTERNAL_ERROR with no data in the body",
    async (path) => {
      const { app, lines } = await routes();
      const response = await app.request(path);
      const { text, error } = await readError(response);
      expectEnvelope(response, text, "INTERNAL_ERROR", path);
      expect(error).toMatchObject({ retryable: false, details: null, message: FIXED_MESSAGE });
      for (const leaked of ["internal_id", "9007199254740993", "synthetic-data-marker", "12345"])
        expect(text, `${path} body ${leaked}`).not.toContain(leaked);
      for (const leaked of ["internal_id", "9007199254740993", "synthetic-data-marker"])
        expect(lines.join("\n"), `${path} log ${leaked}`).not.toContain(leaked);
    },
  );
});

describe("TC-DEV-API-003-004 respond() maps a service result to the section 20 / 21 envelope", () => {
  const itemFailure = { kind: "ENTRY", target_ref: TARGET_A, reasons: ["SOLD_OUT"] };
  const results: Record<string, unknown> = {
    a: {
      kind: "rejected",
      code: "STATE_CONFLICT",
      details: { item_failures: [itemFailure] },
    },
    b: { kind: "rejected", code: "STATE_CONFLICT" },
    c: {
      kind: "rejected",
      code: "STATE_CONFLICT",
      details: { item_failures: [{ ...itemFailure, reasons: ["NOT_A_REASON"] }] },
    },
    d: {
      kind: "rejected",
      code: "STATE_CONFLICT",
      details: { item_failures: [{ ...itemFailure, raw_input: "synthetic-echo-marker" }] },
    },
    e: { kind: "rejected", code: "SOLD_OUT", details: { item_failures: [itemFailure] } },
    f: { kind: "temporary", code: "STRIPE_TEMPORARY_FAILURE" },
    g: { kind: "commit_unknown" },
    h: { kind: "rejected", code: "SOLD_OUT" },
    i: { kind: "rejected", code: "SLOT_UNAVAILABLE" },
    j: { kind: "temporary", code: "AUTH_SERVICE_TEMPORARY_FAILURE" },
  };
  async function routes() {
    const { respond } = await loadRespond();
    const harness = rig();
    let responses = 0;
    harness.app.get("/api/v1/test/result/:name", (c) => {
      responses++;
      return respond(
        c,
        results[c.req.param("name")] as ServiceResult<{ name: string }>,
        dataSchema,
      );
    });
    return { ...harness, responses: () => responses };
  }
  async function call(name: string) {
    const harness = await routes();
    const response = await harness.app.request(`/api/v1/test/result/${name}`);
    const { text, error } = await readError(response);
    expect(harness.responses(), name).toBe(1);
    return { response, text, error };
  }

  it("(a) STATE_CONFLICT with valid item_failures is 409 and the details are returned as given", async () => {
    const { response, text, error } = await call("a");
    expectEnvelope(response, text, "STATE_CONFLICT");
    expect(error).toMatchObject({ retryable: false });
    expect(error.details).toEqual({ item_failures: [itemFailure] });
  });

  it("(b) STATE_CONFLICT without details is 409 with details null", async () => {
    const { response, text, error } = await call("b");
    expectEnvelope(response, text, "STATE_CONFLICT");
    expect(error.details).toBeNull();
  });

  it.each([
    ["c", "an unknown reason", ["NOT_A_REASON"]],
    ["d", "an extra key on an item", ["synthetic-echo-marker", "raw_input"]],
    ["e", "item_failures on a code that allows none", ["item_failures"]],
  ])(
    "(%s) %s becomes 500 INTERNAL_ERROR, details null, and nothing of the input is echoed",
    async (name, _label, leaked) => {
      const { response, text, error } = await call(name);
      expectEnvelope(response, text, "INTERNAL_ERROR", name);
      expect(error).toMatchObject({ retryable: false, details: null, message: FIXED_MESSAGE });
      for (const marker of [...leaked, "STATE_CONFLICT", "SOLD_OUT", TARGET_A])
        expect(text, `${name} ${marker}`).not.toContain(marker);
    },
  );

  it("(f) a temporary Stripe failure is 424 and retryable", async () => {
    const { response, text, error } = await call("f");
    expectEnvelope(response, text, "STRIPE_TEMPORARY_FAILURE");
    expect(error).toMatchObject({ retryable: true, details: null });
  });

  it("(g) an unknown commit result is 503 DATABASE_TEMPORARY_FAILURE, retryable (SPEC-110 section 51)", async () => {
    const { response, text, error } = await call("g");
    expectEnvelope(response, text, "DATABASE_TEMPORARY_FAILURE");
    expect(error).toMatchObject({ retryable: true, details: null });
  });

  it("a rejection without details and a temporary code use the table status and retryable", async () => {
    for (const [name, code] of [
      ["h", "SOLD_OUT"],
      ["i", "SLOT_UNAVAILABLE"],
      ["j", "AUTH_SERVICE_TEMPORARY_FAILURE"],
    ] as const) {
      const { response, text, error } = await call(name);
      expectEnvelope(response, text, code);
      expect(error.retryable).toBe(RETRYABLE_CODES.has(code));
      expect(error.details).toBeNull();
    }
  });
});

describe("TC-REL-DB-009-002 database availability failures are 503, never a leaked cause", () => {
  const MARKER = "synthetic-private-marker";
  const failures: Record<string, () => unknown> = {
    sqlstate08: () => Object.assign(new Error(MARKER), { code: "08006" }),
    sqlstate57P01: () => Object.assign(new Error(MARKER), { code: "57P01" }),
    errno: () => Object.assign(new Error(MARKER), { code: "ECONNRESET" }),
    unavailable: () => new DatabaseUnavailableError({ cause: new Error(MARKER) }),
    codeless: () => new Error(MARKER),
    statement_timeout: () => Object.assign(new Error(MARKER), { code: "57014" }),
  };
  async function call(kind: string) {
    const { app, completions } = rig();
    app.get("/api/v1/test/db-failure/:kind", (c) => {
      const make = failures[c.req.param("kind")];
      if (!make) return c.json({ ok: true });
      throw make();
    });
    const response = await app.request(`/api/v1/test/db-failure/${kind}`);
    const { text, error } = await readError(response);
    return { response, text, error, logged: completions(String(error.request_id)) };
  }

  it.each([
    ["sqlstate08", ["08006"]],
    ["sqlstate57P01", ["57P01"]],
    ["errno", ["ECONNRESET"]],
    ["unavailable", []],
  ])(
    "%s is 503 DATABASE_TEMPORARY_FAILURE with no SQLSTATE, errno or message in the body",
    async (kind, codes) => {
      const { response, text, error, logged } = await call(kind);
      expectEnvelope(response, text, "DATABASE_TEMPORARY_FAILURE", kind);
      expect(error).toMatchObject({ retryable: true, details: null });
      for (const leaked of [MARKER, ...codes])
        expect(text, `${kind} ${leaked}`).not.toContain(leaked);
      expect(logged).toHaveLength(1);
      expect(logged[0]?.http_status).toBe(503);
    },
  );

  it("an error with no SQLSTATE and no typed wrapper is a defect: 500 INTERNAL_ERROR, not 503", async () => {
    const { response, text, error, logged } = await call("codeless");
    expectEnvelope(response, text, "INTERNAL_ERROR");
    expect(error).toMatchObject({ retryable: false, details: null });
    expect(text).not.toContain(MARKER);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.http_status).toBe(500);
  });

  it("a statement timeout (57014) stays 500 INTERNAL_ERROR in this PR (S0-3a G-a5 A)", async () => {
    const { response, text, error, logged } = await call("statement_timeout");
    expectEnvelope(response, text, "INTERNAL_ERROR");
    expect(error).toMatchObject({ retryable: false, details: null });
    expect(text).not.toContain("57014");
    expect(text).not.toContain(MARKER);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.http_status).toBe(500);
  });
});
