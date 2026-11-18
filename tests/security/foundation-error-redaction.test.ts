import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../apps/api/src/api/app.ts";
import { createLogger } from "../../packages/observability/src/index.ts";

// PR-S0-3a C1 (G5 security): whatever an unclassified exception carries, the public error body is the
// fixed INTERNAL_ERROR envelope and neither the response nor the log shows the cause (SPEC-110 §20,
// SPEC-140 SEC-ERR-001 / SEC-ERR-003 / SEC-API-020, SPEC-160 OBS-LOG-005, SPEC-190 DEV-API-011).
// Synthetic markers only. Harness-only routes on a test app (nothing is added to the production
// route table). Only thrown Error objects are covered: Hono 4.13.14 rethrows a thrown non-Error
// value (a string, a plain object) past app.onError, so that case is not an envelope question until
// the application decides how to treat it (reported with the S0-3a C1 handoff, not pinned here).
// This file records behavior that already holds and must keep holding when the
// envelope is moved into respond.ts.

const WEB = "https://web.example.test";
const NL = String.fromCharCode(10);
const FORBIDDEN = [
  "synthetic-private-marker",
  "uq_synthetic_private",
  "23505",
  "9007199254740993",
  "synthetic_table",
  "synthetic-zod-value",
  "ZodError",
  "    at ",
  "apps/api",
  "node_modules",
];

const throwers: Record<string, () => never> = {
  error: () => {
    throw new Error("synthetic-private-marker");
  },
  pg: () => {
    throw Object.assign(new Error("synthetic-private-marker"), {
      code: "23505",
      constraint: "uq_synthetic_private",
      detail: "Key (id)=(9007199254740993) already exists.",
      table: "synthetic_table",
      schema: "app",
    });
  },
  bigint: () => {
    // An internal bigint id on the exception object (SPEC-110 section 9: never public).
    throw Object.assign(new Error("synthetic-private-marker"), { id: 9007199254740993n });
  },
  zod: () => {
    z.strictObject({ name: z.number() }).parse({ name: "synthetic-zod-value" });
    throw new Error("unreachable");
  },
  cause: () => {
    throw new Error("synthetic-private-marker", { cause: { code: "23505" } });
  },
};

describe("TC-DEV-API-011-001 an unclassified exception never reaches the response or the log", () => {
  it.each(Object.keys(throwers))("%s", async (kind) => {
    const lines: string[] = [];
    const logger = createLogger(
      { service: "API", environment: "test", actor_type: "GUEST" },
      (line) => {
        lines.push(line);
      },
    );
    const app = createApp({ webOrigin: WEB, ready: async () => true, logger });
    app.get("/api/v1/test/throw/:kind", (c) => {
      const run = throwers[c.req.param("kind")];
      if (!run) return c.json({ ok: true });
      return run();
    });
    const response = await app.request(`/api/v1/test/throw/${kind}`);
    expect(response.status).toBe(500);
    const text = await response.text();
    const requestId = response.headers.get("X-Request-Id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(text)).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Request could not be completed.",
        request_id: requestId,
        retryable: false,
        details: null,
      },
    });
    const headerLines: string[] = [];
    response.headers.forEach((value, name) => {
      headerLines.push(`${name}: ${value}`);
    });
    const headers = headerLines.join(NL);
    const logged = lines.join("\n");
    for (const marker of FORBIDDEN) {
      expect(text, `body ${marker}`).not.toContain(marker);
      expect(headers, `headers ${marker}`).not.toContain(marker);
      expect(logged, `log ${marker}`).not.toContain(marker);
    }
    const completions = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((record) => record.event_name === "http.request.completed");
    expect(completions).toHaveLength(1);
    expect(Object.keys(completions[0] ?? {}).sort()).toEqual([
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
    expect(completions[0]).toMatchObject({ http_status: 500, request_id: requestId });
  });

  it("a success-envelope validation failure (data that does not match) leaks no value either", async () => {
    // Covers the ZodError raised by the success envelope check in respond.ts (case (d) of the plan):
    // the data value is never in the body or the log.
    const { successResponse } = await import("../../apps/api/src/api/respond.ts");
    const lines: string[] = [];
    const logger = createLogger(
      { service: "API", environment: "test", actor_type: "GUEST" },
      (line) => {
        lines.push(line);
      },
    );
    const app = createApp({ webOrigin: WEB, ready: async () => true, logger });
    app.get("/api/v1/test/mismatch", (c) =>
      successResponse(c, z.strictObject({ name: z.number() }), {
        name: "synthetic-zod-value",
      } as never),
    );
    const response = await app.request("/api/v1/test/mismatch");
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text).error).toMatchObject({
      code: "INTERNAL_ERROR",
      retryable: false,
      details: null,
    });
    for (const marker of FORBIDDEN) {
      expect(text, `body ${marker}`).not.toContain(marker);
      expect(lines.join("\n"), `log ${marker}`).not.toContain(marker);
    }
  });
});
