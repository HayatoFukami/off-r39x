import { createServer } from "node:http";
import type { Socket } from "node:net";
import type { Worker } from "@off-r39x/application/worker";
import { TIMEOUTS } from "@off-r39x/reliability";

export interface WorkerHostDependencies {
  worker: Worker;
  port: number;
  checkReadiness(): Promise<boolean>;
  close(): Promise<void>;
  failure(): void;
}
/** Platform-only listener. Deployment must not assign a public worker domain. */
export function startWorkerHost(dependencies: WorkerHostDependencies) {
  let stopping = false;
  let drain: Promise<void> | undefined;
  const sockets = new Set<Socket>();
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (
      request.method !== "GET" ||
      !["/internal/health/live", "/internal/health/ready"].includes(request.url ?? "")
    ) {
      response.writeHead(404).end('{"status":"not_found"}');
      return;
    }
    let ready = !stopping;
    if (request.url === "/internal/health/ready") {
      try {
        ready = ready && (await dependencies.checkReadiness()) && dependencies.worker.ready();
      } catch {
        dependencies.failure();
        ready = false;
      }
    }
    response
      .writeHead(ready ? 200 : 503)
      .end(ready ? '{"status":"ok"}' : '{"status":"unavailable"}');
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.listen(dependencies.port, "0.0.0.0");
  // Tick errors are sanitized; no completion or last-success metric is fabricated.
  const tick = () => {
    if (!stopping) void dependencies.worker.tick().catch(dependencies.failure);
  };
  const interval = setInterval(tick, TIMEOUTS.reconciliationItemMs);
  server.on("error", () => {
    dependencies.failure();
    process.exitCode = 1;
    void stop().catch(() => {});
  });
  tick();
  function stop(): Promise<void> {
    if (drain) return drain;
    stopping = true;
    clearInterval(interval);
    let forced = false;
    let dependencyClose: Promise<void> | undefined;
    const closeDependencies = () =>
      (dependencyClose ??= Promise.resolve().then(() => dependencies.close()));
    // This is a process deadline, not a Promise.race that abandons live work.
    // Unknown in-flight results remain unknown; no later item may be started.
    const deadline = setTimeout(() => {
      forced = true;
      process.exitCode = 1;
      // Install the terminal action before any best-effort cleanup can fail.
      setTimeout(() => process.exit(1), TIMEOUTS.poolAcquireMs);
      try {
        dependencies.failure();
      } catch {
        /* Never serialize raw shutdown errors. */
      }
      try {
        server.closeAllConnections();
      } catch {
        /* Best effort; hard exit is armed. */
      }
      for (const socket of sockets) {
        try {
          socket.destroy();
        } catch {
          /* Best effort. */
        }
      }
      void closeDependencies().catch(() => {});
      // Referenced timer bounds best-effort pool close and log flushing to <=2s.
    }, TIMEOUTS.reconciliationItemMs);
    drain = (async () => {
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error ? reject(new Error("Worker health shutdown failed")) : resolve(),
        ),
      );
      let failed = false;
      try {
        await Promise.all([dependencies.worker.stop(), closed]);
      } catch {
        dependencies.failure();
        failed = true;
      } finally {
        try {
          await closeDependencies();
        } catch {
          dependencies.failure();
          failed = true;
        }
      }
      if (failed || forced) throw new Error("Worker shutdown failed");
      clearTimeout(deadline);
    })();
    return drain;
  }
  return { server, stop };
}
