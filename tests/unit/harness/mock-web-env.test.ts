import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mockWebEnv } from "../../harness/browser/mock-web-env.mts";
import { REPO_ROOT } from "../../harness/script-fixtures.ts";

// The environment of the E2E webServer build (TST-E2E-004: the UI mock suite is auxiliary; DEV-REP-004: environment
// assembly lives under tests/harness; DEV-WEB-011 / INF-ENV-001: a mock build needs an explicit non-production APP_ENV).
// Contract: tests/contracts/s3-layout.md section 10 / 13.3.

const REMOVED = [
  "NODE_ENV",
  "SPONSOR_IMAGE_ALLOWED_ORIGINS",
  "VERCEL_ENV",
  "NEXT_PUBLIC_UI_MOCK",
] as const;

describe("TC-DEV-WEB-011-208 the E2E webServer builds the mock with APP_ENV=test", () => {
  it.each([
    ["unset", undefined],
    ["production", "production"],
    ["staging", "staging"],
    ["development", "development"],
    ["an invalid name", "prod-sentinel-7c1e"],
  ])(
    "sets VITE_UI_MOCK=1 and APP_ENV=test whatever the parent APP_ENV is (%s)",
    (_label, parentAppEnv) => {
      const env = mockWebEnv({ PATH: "/synthetic/bin", APP_ENV: parentAppEnv });
      expect(env.VITE_UI_MOCK).toBe("1");
      expect(env.APP_ENV).toBe("test");
    },
  );

  it("overrides a parent VITE_UI_MOCK that is not 1", () => {
    expect(mockWebEnv({ VITE_UI_MOCK: "0" }).VITE_UI_MOCK).toBe("1");
    expect(mockWebEnv({ VITE_UI_MOCK: undefined }).VITE_UI_MOCK).toBe("1");
  });

  it("removes the variables that could change the build or that belong to the former stack", () => {
    const env = mockWebEnv({
      NODE_ENV: "production",
      SPONSOR_IMAGE_ALLOWED_ORIGINS: '["https://sponsor.example.com"]',
      VERCEL_ENV: "production",
      NEXT_PUBLIC_UI_MOCK: "1",
    });
    for (const name of REMOVED) expect(Object.hasOwn(env, name), name).toBe(false);
    expect(env.APP_ENV).toBe("test");
  });

  it("keeps the other variables of the parent", () => {
    const env = mockWebEnv({ SYNTHETIC_KEEP: "1", PATH: "/synthetic/bin", APP_ENV: "production" });
    expect(env.SYNTHETIC_KEEP).toBe("1");
    expect(env.PATH).toBe("/synthetic/bin");
  });

  it("does not change the parent object", () => {
    const parent = Object.freeze({
      APP_ENV: "production",
      NODE_ENV: "production",
      SYNTHETIC_KEEP: "1",
    });
    const env = mockWebEnv(parent);
    expect(env).not.toBe(parent);
    expect(parent).toEqual({ APP_ENV: "production", NODE_ENV: "production", SYNTHETIC_KEEP: "1" });
  });

  it("start-mock-web.mjs takes the environment of both children from mockWebEnv (static check)", () => {
    const source = readFileSync(
      join(REPO_ROOT, "tests", "harness", "browser", "start-mock-web.mjs"),
      "utf8",
    );
    expect(source).toMatch(
      /import\s*\{[^}]*\bmockWebEnv\b[^}]*\}\s*from\s*["']\.\/mock-web-env\.mts["']/,
    );
    expect(source).toMatch(/\bconst\s+env\s*=\s*mockWebEnv\(\s*process\.env\s*\)/);
    // Both children (the build and the static server) are given that object, not a copy or a rebuilt one.
    expect(source).toMatch(
      /spawnSync\(\s*"pnpm --filter @off-r39x\/web build",\s*\{[^}]*\benv\s*,/,
    );
    expect(source).toMatch(
      /spawn\(\s*process\.execPath,\s*\[serveScript[^\]]*\],\s*\{[^}]*\benv\s*,/,
    );
    expect(source).not.toMatch(/env\s*:\s*\{/);
    // The launcher no longer assembles the variables itself: no APP_ENV deletion and no inline VITE_UI_MOCK.
    expect(source).not.toMatch(/delete\s+env\[/);
    expect(source).not.toMatch(/VITE_UI_MOCK\s*:\s*"1"/);
  });
});
