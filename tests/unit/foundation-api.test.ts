import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../apps/api/src/api/app.ts";
import { validateJson } from "../../apps/api/src/api/middleware/json.ts";

describe("TC-DEV-API-003-050 foundation transport (not provider proxy evidence)", () => {
  it("enforces configured API hosts and canonical HSTS", async () => {
    const configured = createApp({
      webOrigin: "https://web.example.test",
      allowedHosts: ["api.example.test"],
      ready: async () => false,
    });
    expect(
      (await configured.request("https://evil.example.test/api/v1/public/events")).status,
    ).toBe(400);
    const health = await configured.request("/internal/health/live");
    expect(health.headers.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains",
    );
  });
  const app = createApp({ webOrigin: "https://web.example.com", ready: async () => true });
  it("redacts missing routes and replaces hostile request IDs", async () => {
    const response = await app.request("/auth/login", { headers: { "X-Request-Id": "hostile" } });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.request_id).toBe(response.headers.get("x-request-id"));
    expect(body.error.request_id).not.toBe("hostile");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("does not enable credentialed business CORS", async () => {
    const response = await app.request("/api/v1/self/profile", {
      method: "OPTIONS",
      headers: {
        Origin: "https://web.example.com",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });
  it("requires exact mutation Origin", async () => {
    expect((await app.request("/api/v1/self/profile", { method: "POST" })).status).toBe(403);
  });
  it("keeps health generic and handles readiness failure", async () => {
    const failing = createApp({
      webOrigin: "https://web.example.com",
      ready: async () => {
        throw new Error("secret");
      },
    });
    const response = await failing.request("/internal/health/ready");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
});
it("TC-DEV-API-003-050 JSON guards reject duplicate keys, media types and oversized streams", async () => {
  const app = createApp({ webOrigin: "https://web.example.com", ready: async () => false });
  // Harness-only route; no demo/business operation is exported by production.
  app.post("/api/v1/test", validateJson(z.strictObject({ name: z.string() })), (c) =>
    c.json({ ok: true }),
  );
  const request = (body: string, contentType = "application/json") =>
    app.request("/api/v1/test", {
      method: "POST",
      headers: { Origin: "https://web.example.com", "Content-Type": contentType },
      body,
    });
  expect((await request('{"name":"a","na\\u006de":"b"}')).status).toBe(400);
  expect((await request("{}", "text/plain")).status).toBe(415);
  expect((await request("x".repeat(65537))).status).toBe(413);
  expect((await request('{"name":"ok"}')).status).toBe(200);
});
