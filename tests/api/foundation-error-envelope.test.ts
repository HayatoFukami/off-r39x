import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiFailure, createApp } from "../../apps/api/src/api/app.ts";
import type { ServiceResult } from "../../apps/api/src/api/services/result.ts";
import {
  type ErrorCode,
  errorSchema,
  errorStatuses,
} from "../../packages/api-contract/src/index.ts";
import { DatabaseUnavailableError, transaction } from "../../packages/db/src/index.ts";
import { createLogger } from "../../packages/observability/src/index.ts";
import { createFakePool } from "../harness/db/fake-pool.ts";

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
  return { app, lines, records, completions, logger };
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
// (AUTHENTICATION_REQUIRED, INTERNAL_ERROR) resolve to false in a produced response (SPEC-110 section 21).
const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "RATE_LIMIT_EXCEEDED",
  "STRIPE_TEMPORARY_FAILURE",
  "DATABASE_TEMPORARY_FAILURE",
  "AUTH_SERVICE_TEMPORARY_FAILURE",
  "TEMPORARY_UNAVAILABLE",
]);

const dataSchema = z.strictObject({ name: z.string() });
const transformSchema = z.strictObject({ count: z.string().transform((v) => Number(v)) });
// PR #66 review round 3: a schema whose parsed output is undefined would drop `data` from the JSON
// body (SPEC-110 section 19 requires data), so it must fail closed as 500.
const undefinedOutputSchema = z.string().transform((): undefined => undefined);

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
    // retryable is decided by the code (section 21); a conditional code resolves to false.
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
    // Review fix F4: data is the schema INPUT; the parsed (transformed) output is what is sent.
    // These calls are also a type check (tests workspace typecheck): passing an input type that
    // differs from the output type must not be a type error.
    app.get("/api/v1/test/success/transform", (c) =>
      successResponse(c, transformSchema, { count: "3" }),
    );
    app.get("/api/v1/test/respond/transform", (c) =>
      respond(c, { kind: "success", status: 200, data: { count: "3" } }, transformSchema),
    );
    app.get("/api/v1/test/success/undefined-output", (c) =>
      successResponse(c, undefinedOutputSchema, "synthetic-undefined-marker"),
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

  it.each(["/api/v1/test/success/transform", "/api/v1/test/respond/transform"])(
    "%s sends the schema's parsed output (the transform ran), not the input",
    async (path) => {
      const { app } = await routes();
      const response = await app.request(path);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: Json; meta: Json };
      expect(body.data).toEqual({ count: 3 });
      expect(body.data.count).toBe(3);
      expect(body.meta).toEqual({ request_id: response.headers.get("X-Request-Id") });
    },
  );

  it("successResponse: parsed data that is undefined is 500 INTERNAL_ERROR (details null), never a 200 without data", async () => {
    const path = "/api/v1/test/success/undefined-output";
    const { app, lines } = await routes();
    const response = await app.request(path);
    const { text, error } = await readError(response);
    expectEnvelope(response, text, "INTERNAL_ERROR", path);
    expect(error).toMatchObject({ retryable: false, details: null, message: FIXED_MESSAGE });
    expect(text).not.toContain("synthetic-undefined-marker");
    expect(lines.join("\n")).not.toContain("synthetic-undefined-marker");
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
    // Review fix F1: item_failures is defined only for API-PUR-CART-001 (SPEC-110 section 28), so the
    // same details are valid or not depending on the Operation that produced them.
    k: {
      kind: "rejected",
      code: "STATE_CONFLICT",
      details: { item_failures: [itemFailure] },
    },
    l: {
      kind: "rejected",
      code: "STATE_CONFLICT",
      details: { item_failures: [itemFailure] },
    },
  };
  // The operation id each case runs under; "l" runs with none set, every other case with the cart one.
  const operationIds: Record<string, string | undefined> = {
    k: "API-AUTH-001",
    l: undefined,
  };
  async function routes() {
    const { respond } = await loadRespond();
    const harness = rig();
    let responses = 0;
    // The production route table sets operationId per route; the harness stands in for that.
    harness.app.use("/api/v1/test/result/:name", async (c, next) => {
      const name = c.req.param("name");
      const operationId = name in operationIds ? operationIds[name] : "API-PUR-CART-001";
      if (operationId !== undefined)
        (c as unknown as { set(key: string, value: string): void }).set("operationId", operationId);
      await next();
    });
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

  it("(a) STATE_CONFLICT with valid item_failures under API-PUR-CART-001 is 409 and the details are returned as given", async () => {
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
    ["k", "item_failures under an operationId other than API-PUR-CART-001", ["item_failures"]],
    ["l", "item_failures with no operationId set", ["item_failures"]],
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

  it("(m) a success whose parsed data is undefined is 500 INTERNAL_ERROR, details null, never a 200 without data", async () => {
    const { respond } = await loadRespond();
    const { app, lines } = rig();
    app.get("/api/v1/test/result-undefined", (c) =>
      respond(
        c,
        { kind: "success", status: 200, data: "synthetic-undefined-marker" },
        undefinedOutputSchema,
      ),
    );
    const response = await app.request("/api/v1/test/result-undefined");
    const { text, error } = await readError(response);
    expectEnvelope(response, text, "INTERNAL_ERROR", "m");
    expect(error).toMatchObject({ retryable: false, details: null, message: FIXED_MESSAGE });
    expect(text).not.toContain("synthetic-undefined-marker");
    expect(lines.join("\n")).not.toContain("synthetic-undefined-marker");
  });

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
    errnoDns: () => Object.assign(new Error(MARKER), { code: "EAI_AGAIN" }),
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

  // Review fix F2: a bare Node errno does not say the database failed (it may be any socket, e.g. a
  // provider call), and SPEC-110 section 51 makes only a DB connection failure a 503. The DB origin
  // is typed at transaction(); an untyped errno reaching the boundary is a defect. This replaces the
  // earlier expectation of 503 for a bare ECONNRESET.
  it.each([
    ["errno", "ECONNRESET"],
    ["errnoDns", "EAI_AGAIN"],
  ])("a bare errno (%s) is 500 INTERNAL_ERROR, not 503, and leaks nothing", async (kind, errno) => {
    const { response, text, error, logged } = await call(kind);
    expectEnvelope(response, text, "INTERNAL_ERROR", kind);
    expect(error).toMatchObject({ retryable: false, details: null });
    expect(text).not.toContain(errno);
    expect(text).not.toContain(MARKER);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.http_status).toBe(500);
  });

  // PR #66 review round 2: through the real transaction() boundary, an errno from the callback's
  // client.query() is DB-originated (503), but an errno the callback throws itself is not (500).
  describe("through transaction() on a fake pool", () => {
    const PROBE = "SELECT synthetic_probe";
    async function callTx(mode: "query" | "own") {
      const { app, completions, lines, logger } = rig();
      const original = Object.assign(new Error(MARKER), { code: "ECONNRESET" });
      const fake = createFakePool(({ sql }) =>
        mode === "query" && sql === PROBE ? original : undefined,
      );
      app.get("/api/v1/test/tx-failure", async (c) => {
        await transaction(
          fake.pool,
          async (client) => {
            if (mode === "query") await client.query(PROBE);
            else throw original;
          },
          { logger, queryName: "test.tx.errno" },
        );
        return c.json({ ok: true });
      });
      const response = await app.request("/api/v1/test/tx-failure");
      const { text, error } = await readError(response);
      return { response, text, error, logged: completions(String(error.request_id)), lines };
    }

    it("a failing client.query() inside the callback is 503 DATABASE_TEMPORARY_FAILURE", async () => {
      const { response, text, error, logged, lines } = await callTx("query");
      expectEnvelope(response, text, "DATABASE_TEMPORARY_FAILURE");
      expect(error).toMatchObject({ retryable: true, details: null });
      for (const leaked of [MARKER, "ECONNRESET"]) {
        expect(text).not.toContain(leaked);
        expect(lines.join(" ")).not.toContain(leaked);
      }
      expect(logged).toHaveLength(1);
      expect(logged[0]?.http_status).toBe(503);
    });

    it("an errno thrown by the callback itself is 500 INTERNAL_ERROR", async () => {
      const { response, text, error, logged, lines } = await callTx("own");
      expectEnvelope(response, text, "INTERNAL_ERROR");
      expect(error).toMatchObject({ retryable: false, details: null });
      for (const leaked of [MARKER, "ECONNRESET"]) {
        expect(text).not.toContain(leaked);
        expect(lines.join(" ")).not.toContain(leaked);
      }
      expect(logged).toHaveLength(1);
      expect(logged[0]?.http_status).toBe(500);
      // PR #66 review round 3: the callback's own errno is not a database failure, so it is not
      // logged as an availability failure.
      expect(
        lines.filter((line) => (JSON.parse(line) as Json).event_name === "db.availability.failed"),
      ).toHaveLength(0);
    });
  });

  it("an error with no SQLSTATE and no typed wrapper is a defect: 500 INTERNAL_ERROR, not 503", async () => {
    const { response, text, error, logged } = await call("codeless");
    expectEnvelope(response, text, "INTERNAL_ERROR");
    expect(error).toMatchObject({ retryable: false, details: null });
    expect(text).not.toContain(MARKER);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.http_status).toBe(500);
  });

  it("a statement timeout (57014) stays 500 INTERNAL_ERROR in this PR", async () => {
    const { response, text, error, logged } = await call("statement_timeout");
    expectEnvelope(response, text, "INTERNAL_ERROR");
    expect(error).toMatchObject({ retryable: false, details: null });
    expect(text).not.toContain("57014");
    expect(text).not.toContain(MARKER);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.http_status).toBe(500);
  });
});
