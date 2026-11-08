// Test harness only (SPEC-170 §8, TST-GEN-006): builds apps/web in UI mock mode and serves apps/web/dist.
// The Web app is a static SPA (Vite + React Router, SPEC-190 DEV-WEB-001): `pnpm --filter @off-r39x/web build`
// writes apps/web/dist and dist/_headers; scripts/serve-web-dist.mts serves them on 127.0.0.1:3100 and applies
// the headers. Cross-platform: pnpm is spawned through the shell so that pnpm.cmd resolves on Windows; the server
// is started with process.execPath and an argument array (no shell).
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mockWebEnv } from "./mock-web-env.mts";

const PORT = "3100";
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const serveScript = fileURLToPath(new URL("../../../scripts/serve-web-dist.mts", import.meta.url));

// The suite fixes its own environment (mock-web-env.mts): VITE_UI_MOCK=1 and APP_ENV=test, and every variable that
// could change the build is removed. The same env is used for the build and for serving.
const env = mockWebEnv(process.env);

const build = spawnSync("pnpm --filter @off-r39x/web build", {
  cwd: repoRoot,
  env,
  shell: true,
  stdio: "inherit",
});
if (build.status !== 0) {
  process.stderr.write("apps/web build failed in UI mock mode\n");
  process.exit(build.status ?? 1);
}

const server = spawn(process.execPath, [serveScript, "--port", PORT, "--host", "127.0.0.1"], {
  cwd: repoRoot,
  env,
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
