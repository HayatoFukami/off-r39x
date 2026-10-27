import { expect, it } from "vitest";
import { createApp } from "../../apps/api/src/api/app.ts";

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
