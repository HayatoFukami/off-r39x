import { expect, it } from "vitest";
import { createApp } from "../../apps/api/src/api/app.ts";
import { createLogger } from "../../packages/observability/src/index.ts";

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
    enforcement: {
      assertAvailable: async () => {},
      middleware: async (_c, next) => {
        await next();
      },
    },
  });
  const client = hc<import("../../packages/api-contract/src/index.ts").AppType>(
    "https://api.example.test",
    {
      fetch: async (input: string | URL | Request, init?: RequestInit) =>
        app.request(String(input), init),
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
  expect((await app.request("/api/v1/self/principal")).status).toBe(401);
  const unavailable = createApp({
    webOrigin: "https://web.example.test",
    ready: async () => false,
  });
  expect((await unavailable.request("/api/v1/self/principal")).status).toBe(503);
});
