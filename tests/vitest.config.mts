import { defineConfig } from "vitest/config";

// SPEC-170 §69: runner retry is always 0. E2E specs (Playwright) are never collected here.
export default defineConfig({
  test: {
    retry: 0,
    passWithNoTests: false,
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["unit/**/*.test.ts"],
          retry: 0,
        },
      },
      {
        test: {
          name: "security",
          environment: "node",
          include: ["security/**/*.test.ts"],
          // Real Redis (G5): run by the backend config's own project, never by the unit run.
          exclude: ["security/foundation-*redis.test.ts", "**/node_modules/**"],
          retry: 0,
        },
      },
    ],
  },
});
