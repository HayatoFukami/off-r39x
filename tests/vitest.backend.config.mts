import { defineConfig } from "vitest/config";

// A foundation slice, not evidence that the completed system's G1–G10 pass.
export default defineConfig({
  test: {
    retry: 0,
    passWithNoTests: false,
    projects: ["unit", "api", "security", "db", "integration", "reliability", "observability"].map(
      (level) => ({
        test: {
          name: `backend-${level}`,
          environment: "node",
          include: [`${level}/foundation-*.test.ts`],
          retry: 0,
          fileParallelism: level !== "db" && level !== "integration",
        },
      }),
    ),
  },
});
