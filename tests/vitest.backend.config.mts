import { defineConfig } from "vitest/config";

// The real-Redis files act on server-global state (CLIENT PAUSE / CLIENT KILL, CONFIG SET maxmemory),
// so they run one file at a time in their own project and never next to another Redis user.
const REDIS_FILES = "integration/foundation-*redis.test.ts";

// A foundation slice, not evidence that the completed system's G1–G10 pass.
export default defineConfig({
  test: {
    retry: 0,
    passWithNoTests: false,
    projects: [
      ...["unit", "api", "security", "db", "integration", "reliability", "observability"].map(
        (level) => ({
          test: {
            name: `backend-${level}`,
            environment: "node",
            include: [`${level}/foundation-*.test.ts`],
            ...(level === "integration" ? { exclude: [REDIS_FILES, "**/node_modules/**"] } : {}),
            retry: 0,
            setupFiles: level === "db" ? ["./harness/db/isolated-database.ts"] : [],
          },
        }),
      ),
      {
        test: {
          name: "backend-redis",
          environment: "node",
          include: [REDIS_FILES],
          // One worker process, so the files run strictly one after another.
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          retry: 0,
        },
      },
    ],
  },
});
