import { afterEach, describe, expect, it } from "vitest";
import {
  type CheckResult,
  createFixtureRoot,
  type FileMap,
  importAtLine,
  removeFixtureRoot,
  runBoundaryCheck,
  withFiles,
} from "../harness/fixture-repo.ts";

// DEV-DEP-006: scripts/check-import-boundaries.mts is the mechanical gate for the forbidden edges.
// Each test builds a throwaway repository in os.tmpdir() and runs the script with --root.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeFixtureRoot(root);
});

function check(files: FileMap): CheckResult {
  const root = createFixtureRoot(files);
  roots.push(root);
  return runBoundaryCheck(["--root", root]);
}

function expectClean(result: CheckResult): void {
  expect(result.violations).toEqual([]);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/^OK/m);
}

function expectViolation(
  result: CheckResult,
  rule: string,
  file: string,
  line: number,
  specifier: string,
): void {
  expect(result.violations).toContain(`VIOLATION ${rule} ${file}:${line} ${specifier}`);
  expect(result.status).toBe(1);
}

const LINE = 3;
const imp = (specifier: string): string => importAtLine(LINE, `import "${specifier}";`);

// DEV-RLM-002: only the rate limit store adapter imports a Redis client.
describe("TC-RLM-002-201 redis-client-only-in-store-adapter", () => {
  it.each([
    ["packages/security/src/bad.ts", "ioredis"],
    ["packages/auth/src/bad.ts", "ioredis/built/Redis"],
    ["packages/db/src/bad.ts", "redis"],
    ["packages/application/src/bad.ts", "@redis/client"],
    ["apps/api/src/api/bad.ts", "ioredis"],
    ["apps/api/src/bootstrap/bad.ts", "iovalkey"],
    ["apps/email-worker/src/bad.ts", "ioredis"],
  ])("rejects %s importing %s", (file, specifier) => {
    const result = check(withFiles({ [file]: imp(specifier) }));
    expectViolation(result, "redis-client-only-in-store-adapter", file, LINE, specifier);
  });

  it("rejects dynamic import and require of a Redis client outside the adapter", () => {
    const result = check(
      withFiles({
        "apps/api/src/api/dyn.ts": importAtLine(LINE, 'const mod = await import("ioredis");'),
        "packages/security/src/req.ts": importAtLine(LINE, 'const mod = require("redis");'),
      }),
    );
    expectViolation(
      result,
      "redis-client-only-in-store-adapter",
      "apps/api/src/api/dyn.ts",
      LINE,
      "ioredis",
    );
    expectViolation(
      result,
      "redis-client-only-in-store-adapter",
      "packages/security/src/req.ts",
      LINE,
      "redis",
    );
  });

  it("allows the store adapter to import the client, and unrelated packages named like it", () => {
    const result = check(
      withFiles({
        "packages/rate-limit-redis/src/store.ts": imp("ioredis"),
        "packages/security/src/ok.ts": imp("redistribute"),
      }),
    );
    expectClean(result);
  });

  it("rejects importing the adapter package outside the API bootstrap (route handlers and domain stay store-agnostic)", () => {
    const result = check(
      withFiles({
        "apps/api/src/api/bad.ts": imp("@off-r39x/rate-limit-redis"),
        "packages/security/src/bad.ts": imp("@off-r39x/rate-limit-redis"),
        "apps/api/src/bootstrap/ok.ts": imp("@off-r39x/rate-limit-redis"),
      }),
    );
    expectViolation(
      result,
      "rate-limit-adapter-bootstrap-only",
      "apps/api/src/api/bad.ts",
      LINE,
      "@off-r39x/rate-limit-redis",
    );
    expectViolation(
      result,
      "rate-limit-adapter-bootstrap-only",
      "packages/security/src/bad.ts",
      LINE,
      "@off-r39x/rate-limit-redis",
    );
    expect(result.violations.some((v) => v.includes("bootstrap/ok.ts"))).toBe(false);
  });
});
