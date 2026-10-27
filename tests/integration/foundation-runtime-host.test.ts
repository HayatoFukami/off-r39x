import { describe, expect, it } from "vitest";
import { startWorkerHost as emailHost } from "../../apps/email-worker/src/bootstrap/host.ts";
import { startWorkerHost as reconciliationHost } from "../../apps/reconciliation-worker/src/bootstrap/host.ts";
import { createWorker } from "../../packages/application/src/worker.ts";

describe("TC-FOUNDATION-RUNTIME-012 worker platform sockets", () => {
  it.each([
    ["email", emailHost],
    ["reconciliation", reconciliationHost],
  ] as const)(
    "TC-FOUNDATION-RUNTIME-012 %s socket exposes only generic exact platform health paths [INF-HLT-001]",
    async (_name, startWorkerHost) => {
      let checks = 0;
      let closed = false;
      const host = startWorkerHost({
        worker: createWorker({ now: () => new Date(0) }, []),
        port: 0,
        checkReadiness: async () => {
          checks++;
          return true;
        },
        close: async () => {
          closed = true;
        },
        failure: () => {},
      });
      await new Promise<void>((resolve) => host.server.once("listening", resolve));
      const address = host.server.address();
      if (!address || typeof address === "string")
        throw new Error("Synthetic listener unavailable");
      const base = `http://127.0.0.1:${address.port}`;
      try {
        const live = await fetch(`${base}/internal/health/live`);
        expect(live.status).toBe(200);
        expect(await live.json()).toEqual({ status: "ok" });
        expect(checks).toBe(0);
        const ready = await fetch(`${base}/internal/health/ready`);
        expect(ready.status).toBe(503);
        expect(checks).toBe(1);
        expect(await ready.json()).toEqual({ status: "unavailable" });
        expect((await fetch(`${base}/internal/health/live?detail=1`)).status).toBe(404);
        expect((await fetch(`${base}/internal/health/live`, { method: "POST" })).status).toBe(404);
      } finally {
        await host.stop();
      }
      expect(closed).toBe(true);
    },
  );
});
