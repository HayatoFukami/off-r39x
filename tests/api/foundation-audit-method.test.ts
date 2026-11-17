import { expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../apps/api/src/api/app.ts";
import { validateJson } from "../../apps/api/src/api/middleware/json.ts";
import { errorStatuses } from "../../packages/api-contract/src/index.ts";
import { TransactionDeadlineError } from "../../packages/db/src/index.ts";
import { createLogger } from "../../packages/observability/src/index.ts";
import { createTestRateLimit, peer } from "../harness/rate-limit/api.ts";

it("TC-HTTP-AUDIT-001 returns405 and Allow for known paths,404 for unknown paths", async () => {
  const app = createApp({ webOrigin: "https://web.example.test", ready: async () => true });
  app.get("/api/v1/test/:ref", (c) => c.json({ ok: true }));
  for (const path of [
    "/internal/health/live",
    "/internal/health/ready",
    "/api/v1/test/synthetic",
  ]) {
    const res = await app.request(path, {
      method: "PUT",
      headers: { Origin: "https://web.example.test" },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toContain("GET");
    expect(res.headers.get("Allow")).toContain("HEAD");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  }
  expect(
    (
      await app.request("/api/v1/missing", {
        method: "PUT",
        headers: { Origin: "https://web.example.test" },
      })
    ).status,
  ).toBe(404);
  expect((await app.request("/internal/health/live", { method: "HEAD" })).status).toBe(200);
});

it("TC-HTTP-AUDIT-002 SEC-API-022 SEC-ABU-018 unsupported method is METHOD_NOT_ALLOWED with Allow, not a status-only override", async () => {
  const app = createApp({ webOrigin: "https://web.example.test", ready: async () => true });
  app.get("/api/v1/test/:ref", (c) => c.json({ ok: true }));
  for (const path of [
    "/internal/health/live",
    "/internal/health/ready",
    "/api/v1/test/synthetic",
  ]) {
    const res = await app.request(path, {
      method: "PUT",
      headers: { Origin: "https://web.example.test" },
    });
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error).toMatchObject({
      code: "METHOD_NOT_ALLOWED",
      retryable: false,
      details: null,
    });
    expect(body.error.request_id).toBe(res.headers.get("X-Request-Id"));
    expect(res.headers.get("Allow")).toContain("GET");
    expect(res.headers.get("Allow")).toContain("HEAD");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  }
  // An unknown path is still a plain 404 and carries no Allow header.
  const missing = await app.request("/api/v1/missing", {
    method: "PUT",
    headers: { Origin: "https://web.example.test" },
  });
  expect(missing.status).toBe(404);
  expect((await missing.json()).error).toMatchObject({
    code: "RESOURCE_NOT_FOUND",
    retryable: false,
  });
  expect(missing.headers.get("Allow")).toBeNull();
  // The public error table itself lists the code (SPEC-110 section 21).
  expect((errorStatuses as Record<string, number>).METHOD_NOT_ALLOWED).toBe(405);
});

it("TC-HTTP-AUDIT-003 SEC-API-022 unsupported media type is UNSUPPORTED_MEDIA_TYPE and never reaches the handler", async () => {
  const app = createApp({ webOrigin: "https://web.example.test", ready: async () => true });
  let handled = 0;
  // Harness-only route; the production app exports no demo/business operation.
  app.post("/api/v1/test", validateJson(z.strictObject({ name: z.string() })), (c) => {
    handled++;
    return c.json({ ok: true });
  });
  const post = (init: { body?: string; contentType?: string }) =>
    app.request("/api/v1/test", {
      method: "POST",
      headers: {
        Origin: "https://web.example.test",
        ...(init.contentType ? { "Content-Type": init.contentType } : {}),
      },
      ...(init.body === undefined ? {} : { body: init.body }),
    });

  const wrongType = await post({ body: '{"name":"a"}', contentType: "text/plain" });
  expect(wrongType.status).toBe(415);
  expect((await wrongType.json()).error).toMatchObject({
    code: "UNSUPPORTED_MEDIA_TYPE",
    retryable: false,
    details: null,
  });
  const noType = await post({});
  expect(noType.status).toBe(415);
  expect((await noType.json()).error).toMatchObject({
    code: "UNSUPPORTED_MEDIA_TYPE",
    retryable: false,
  });
  expect(handled).toBe(0);

  // A malformed JSON body with the right media type stays a 400 MALFORMED_REQUEST.
  const malformed = await post({ body: "{", contentType: "application/json" });
  expect(malformed.status).toBe(400);
  expect((await malformed.json()).error).toMatchObject({
    code: "MALFORMED_REQUEST",
    retryable: false,
  });
  expect(handled).toBe(0);
  const ok = await post({ body: '{"name":"a"}', contentType: "application/json" });
  expect(ok.status).toBe(200);
  expect(handled).toBe(1);
  // The public error table itself lists the code (SPEC-110 section 21).
  expect((errorStatuses as Record<string, number>).UNSUPPORTED_MEDIA_TYPE).toBe(415);
});

it("TC-HTTP-AUDIT-004 REL-DB-011 a retry-exhausted DB error or deadline is a 503 DATABASE_TEMPORARY_FAILURE, never 404, 409 or a leaked SQLSTATE", async () => {
  const app = createApp({ webOrigin: "https://web.example.test", ready: async () => true });
  const failures: Record<string, () => unknown> = {
    lock: () => Object.assign(new Error("synthetic-private"), { code: "55P03" }),
    serialization: () => Object.assign(new Error("synthetic-private"), { code: "40001" }),
    deadlock: () => Object.assign(new Error("synthetic-private"), { code: "40P01" }),
    deadline: () => new TransactionDeadlineError(),
    constraint: () => Object.assign(new Error("synthetic-private"), { code: "23505" }),
  };
  // Harness-only routes standing in for a future Operation whose transaction() budget ran out.
  app.get("/api/v1/test/db-failure/:kind", (c) => {
    const make = failures[c.req.param("kind")];
    if (!make) return c.json({ ok: true });
    throw make();
  });
  for (const kind of ["lock", "serialization", "deadlock", "deadline"]) {
    const res = await app.request(`/api/v1/test/db-failure/${kind}`);
    expect(res.status, kind).toBe(503);
    const { request_id: requestId, ...error } = (await res.json()).error;
    expect(error, kind).toMatchObject({
      code: "DATABASE_TEMPORARY_FAILURE",
      retryable: true,
      details: null,
    });
    expect(requestId).toBe(res.headers.get("X-Request-Id"));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // SPEC-110 section 20: no SQLSTATE and no raw error message in the public body
    // (request_id is a random UUID and is left out of the text match).
    expect(JSON.stringify(error)).not.toMatch(
      /55P03|40001|40P01|synthetic-private|deadline exceeded/i,
    );
  }
  // A constraint violation is not a temporary failure and is not turned into a 503 or a 409 here.
  const constraint = await app.request("/api/v1/test/db-failure/constraint");
  expect(constraint.status).toBe(500);
  const body = await constraint.json();
  expect(body.error).toMatchObject({ code: "INTERNAL_ERROR", retryable: false });
  expect(JSON.stringify({ ...body.error, request_id: undefined })).not.toMatch(
    /23505|synthetic-private/,
  );
});

it("TC-RPC-AUDIT-001 public Hono RPC type is the mounted canonical principal route", async () => {
  const { hc } = await import("hono/client");
  const subject = "00000000-0000-4000-8000-000000000061";
  const lines: string[] = [];
  const app = createApp({
    webOrigin: "https://web.example.test",
    ready: async () => true,
    logger: createLogger({ service: "API", environment: "test", actor_type: "GUEST" }, (line) => {
      lines.push(line);
    }),
    auth: {
      verifier: { verify: async () => ({ subject }) },
      store: {
        findByAuthSubject: async () => ({
          directory: { authSubject: subject, emailVerified: true },
          profile: { id: "1", publicRef: subject, authSubject: subject },
          roles: ["ADMINISTRATOR"],
        }),
      },
    },
    rateLimit: createTestRateLimit().rateLimit,
  });
  const client = hc<import("../../packages/api-contract/src/index.ts").AppType>(
    "https://api.example.test",
    {
      fetch: async (input: string | URL | Request, init?: RequestInit) =>
        app.request(String(input), init, peer()),
    },
  );
  const response = await client.api.v1.self.principal.$get(
    {},
    { headers: { Authorization: "Bearer e30.e30.c2ln" } },
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data).toMatchObject({
    profile_ref: subject,
    has_staff_role: false,
    has_administrator_role: true,
  });
  expect(body.data.capabilities).not.toContain("entry_checkin.execute");
  expect(body).not.toHaveProperty("data.auth_subject");
  expect(body.meta.request_id).toBe(response.headers.get("X-Request-Id"));
  const events = lines
    .map((line) => JSON.parse(line))
    .filter((e) => e.request_id === body.meta.request_id);
  expect(events.length).toBeGreaterThan(1);
  expect(events.every((e) => e.operation_id === "API-AUTH-001")).toBe(true);
  // Before current DB roles resolve, verification must not claim an admin Actor.
  expect(events.find((e) => e.event_name === "auth.verification.completed").actor_type).toBe(
    "GUEST",
  );
  expect(
    events
      .filter((e) => e.event_name !== "auth.verification.completed")
      .every((e) => e.actor_type === "ADMINISTRATOR"),
  ).toBe(true);
  expect(new Set(events.map((e) => e.operation_execution_id)).size).toBe(1);
  expect(events).toContainEqual(
    expect.objectContaining({
      event_name: "http.request.completed",
      http_route: "/api/v1/self/principal",
    }),
  );
  expect((await app.request("/api/v1/self/principal", {}, peer())).status).toBe(401);
  const unavailable = createApp({
    webOrigin: "https://web.example.test",
    ready: async () => false,
  });
  expect((await unavailable.request("/api/v1/self/principal")).status).toBe(503);
});
