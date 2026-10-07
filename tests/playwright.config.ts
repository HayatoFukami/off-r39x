import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const launcher = fileURLToPath(new URL("./harness/browser/start-mock-web.mjs", import.meta.url));

// UI mock suite (TST-E2E-004): auxiliary suite, not G8. Runner retry is 0 (SPEC-170 §69).
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  // Default parallelism is deliberately low: with 4 Chromium workers on the Windows dev host,
  // loopback stalls (reproduced against a plain node http server, up to ~20 s) caused sporadic
  // timeouts unrelated to the app. SPEC-170 §69 forbids retries, not low parallelism; every test
  // still gets a fresh browser context (TST-FLK-001 / §65). Override with --workers=N.
  workers: 2,
  reporter: "list",
  outputDir: "./test-results",
  use: {
    baseURL: BASE_URL,
    timezoneId: "UTC",
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `node "${launcher}"`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
