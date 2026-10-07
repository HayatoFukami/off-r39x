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
  workers: 4,
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
