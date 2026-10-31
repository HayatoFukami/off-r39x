import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("TC-FOUNDATION-RUNTIME-022 process shutdown bounds ignored cancellation and pending health sockets [INF-RWY-005]", async () => {
  const fixture = fileURLToPath(
    new URL("../harness/providers/runtime-shutdown.mts", import.meta.url),
  );
  const results = await Promise.allSettled(
    ["email", "reconciliation"].flatMap((service) =>
      ["ignored", "cooperative", "health"].map(async (mode) => {
        const start = performance.now();
        const child = spawn(process.execPath, [fixture, service, mode], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (data) => {
          stdout += String(data);
        });
        child.stderr.on("data", (data) => {
          stderr += String(data);
        });
        const watchdog = setTimeout(() => child.kill("SIGKILL"), 19_000);
        try {
          const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
            (resolve, reject) => {
              child.once("error", reject);
              child.once("close", (code, signal) => resolve({ code, signal }));
            },
          );
          expect(stderr).toBe("");
          expect(result.signal).toBeNull();
          expect(result.code).toBe(mode === "cooperative" ? 0 : 1);
          expect(stdout).toContain("dependency-close");
          expect(stdout.includes("drained")).toBe(mode === "cooperative");
          expect(stdout).not.toContain("item-2");
          expect(stdout).not.toContain("later-job");
          if (mode !== "cooperative")
            expect(performance.now() - start).toBeGreaterThanOrEqual(15_000);
          expect(performance.now() - start).toBeLessThan(19_000);
        } finally {
          clearTimeout(watchdog);
          if (child.exitCode === null) child.kill("SIGKILL");
        }
      }),
    ),
  );
  for (const result of results) if (result.status === "rejected") throw result.reason;
}, 20_000);
