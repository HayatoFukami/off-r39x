// Test harness only (SPEC-170 §8, TST-GEN-006): builds and starts apps/web in UI mock mode.
// Cross-platform: pnpm is spawned through the shell so that pnpm.cmd resolves on Windows.
import { spawn, spawnSync } from "node:child_process";

const PORT = "3100";
const env = { ...process.env, NEXT_PUBLIC_UI_MOCK: "1", PORT };
delete env.VERCEL_ENV;
delete env.NODE_ENV;

const build = spawnSync("pnpm --filter @off-r39x/web build", {
  env,
  shell: true,
  stdio: "inherit",
});
if (build.status !== 0) {
  process.stderr.write("apps/web build failed in UI mock mode\n");
  process.exit(build.status ?? 1);
}

const server = spawn(`pnpm --filter @off-r39x/web exec next start -p ${PORT} -H 127.0.0.1`, {
  env,
  shell: true,
  stdio: "inherit",
});

// Readiness is gated by Playwright's webServer.url poll (HTTP 2xx on the base URL); no sleeps here.
function stop() {
  if (server.pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync(`taskkill /pid ${server.pid} /T /F`, { shell: true, stdio: "ignore" });
  } else {
    server.kill("SIGTERM");
  }
}

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
server.on("exit", (code) => process.exit(code ?? 0));
