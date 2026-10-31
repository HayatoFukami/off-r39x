import { describe, expect, it } from "vitest";
import {
  assertUiMockNotInProductionBuild,
  isUiMockAppEnv,
  isUiMockEnabled,
} from "../../../apps/web/src/config/ui-mock.ts";

describe("TC-DEV-WEB-011-001 isUiMockEnabled", () => {
  it.each([
    ["1", true],
    ["true", false],
    ["0", false],
    ["", false],
    [" 1", false],
    ["yes", false],
    [undefined, false],
  ])("VITE_UI_MOCK=%j -> %s", (value, expected) => {
    expect(isUiMockEnabled({ VITE_UI_MOCK: value })).toBe(expected);
  });

  it("is false when the variable is absent", () => {
    expect(isUiMockEnabled({})).toBe(false);
  });

  it("does not read the former Next.js variable: NEXT_PUBLIC_UI_MOCK=1 alone is disabled (fail closed)", () => {
    expect(isUiMockEnabled({ NEXT_PUBLIC_UI_MOCK: "1" })).toBe(false);
    expect(isUiMockEnabled({ NEXT_PUBLIC_UI_MOCK: "1", VITE_UI_MOCK: "0" })).toBe(false);
  });
});

// Fail closed (DEV-WEB-011, INF-ENV-001): with the mock flag on, only APP_ENV exactly development / staging / test
// passes. The messages never carry the offending value.
const MSG_PRODUCTION =
  "UI mock mode must not be enabled in a production build (APP_ENV=production)";
const MSG_UNSET =
  "UI mock mode requires APP_ENV to be development, staging or test (APP_ENV is unset)";
const MSG_INVALID =
  "UI mock mode requires APP_ENV to be development, staging or test (APP_ENV is not one of them)";

describe("TC-DEV-WEB-011-002 assertUiMockNotInProductionBuild", () => {
  it("throws when mock is enabled for a production deployment", () => {
    const run = () =>
      assertUiMockNotInProductionBuild({ VITE_UI_MOCK: "1", APP_ENV: "production" });
    expect(run).toThrow(Error);
    expect(run).toThrow(/UI mock mode must not be enabled in a production build/);
  });

  it("throws when mock is enabled and APP_ENV is unset (fail closed: unset is not 'non-production')", () => {
    const run = () => assertUiMockNotInProductionBuild({ VITE_UI_MOCK: "1" });
    expect(run).toThrow(Error);
    expect(run).toThrow(/APP_ENV is unset/);
    expect(() =>
      assertUiMockNotInProductionBuild({ VITE_UI_MOCK: "1", APP_ENV: undefined }),
    ).toThrow(/APP_ENV is unset/);
  });

  it("does not treat the former VERCEL_ENV as the production signal (APP_ENV is the only one)", () => {
    // An allowed APP_ENV is supplied so that only the VERCEL_ENV axis is under test.
    expect(() =>
      assertUiMockNotInProductionBuild({
        VITE_UI_MOCK: "1",
        APP_ENV: "development",
        VERCEL_ENV: "production",
      }),
    ).not.toThrow();
    expect(() =>
      assertUiMockNotInProductionBuild({ NEXT_PUBLIC_UI_MOCK: "1", APP_ENV: "production" }),
    ).not.toThrow();
  });

  it("does not let VERCEL_ENV stand in for a missing APP_ENV", () => {
    expect(() =>
      assertUiMockNotInProductionBuild({ VITE_UI_MOCK: "1", VERCEL_ENV: "development" }),
    ).toThrow(/APP_ENV is unset/);
  });

  it.each([
    [{ VITE_UI_MOCK: "1", APP_ENV: "staging" }],
    [{ VITE_UI_MOCK: "1", APP_ENV: "development" }],
    [{ VITE_UI_MOCK: "1", APP_ENV: "test" }],
    [{ VITE_UI_MOCK: "0", APP_ENV: "production" }],
    [{ VITE_UI_MOCK: undefined, APP_ENV: "production" }],
    [{ APP_ENV: "production" }],
    [{}],
  ])("does not throw for %j", (env) => {
    expect(() => assertUiMockNotInProductionBuild(env)).not.toThrow();
  });

  it("returns undefined when allowed", () => {
    expect(assertUiMockNotInProductionBuild({})).toBeUndefined();
    expect(
      assertUiMockNotInProductionBuild({ VITE_UI_MOCK: "1", APP_ENV: "test" }),
    ).toBeUndefined();
  });
});

const ALLOWED_APP_ENVS = ["development", "staging", "test"] as const;
// Not exact matches of an allowed name. The empty string is covered here only (no child process, see the plan).
const NOT_ALLOWED_APP_ENVS: readonly (string | undefined)[] = [
  undefined,
  "",
  " development",
  "development ",
  "test\n",
  " test",
  "Development",
  "STAGING",
  "Test",
  "dev",
  "develop",
  "stage",
  "stg",
  "prod",
  "prd",
  "production",
  "Production",
  "PRODUCTION",
  " production",
  "local",
  "preview",
  "ci",
];
const INVALID_NON_PRODUCTION: readonly string[] = NOT_ALLOWED_APP_ENVS.filter(
  (value): value is string => value !== undefined && value !== "production",
);

describe("TC-DEV-WEB-011-003 the APP_ENV allow list and the fail-closed messages (INF-ENV-001)", () => {
  it.each(ALLOWED_APP_ENVS)("isUiMockAppEnv(%j) is true", (value) => {
    expect(isUiMockAppEnv(value)).toBe(true);
  });

  it.each(NOT_ALLOWED_APP_ENVS)(
    "isUiMockAppEnv(%j) is false (exact, case-sensitive, no trim)",
    (value) => {
      expect(isUiMockAppEnv(value)).toBe(false);
    },
  );

  it.each(ALLOWED_APP_ENVS)("VITE_UI_MOCK=1 with APP_ENV=%s does not throw", (appEnv) => {
    expect(() =>
      assertUiMockNotInProductionBuild({ VITE_UI_MOCK: "1", APP_ENV: appEnv }),
    ).not.toThrow();
  });

  it("VITE_UI_MOCK=1 with APP_ENV unset throws the 'unset' message", () => {
    expect(() => assertUiMockNotInProductionBuild({ VITE_UI_MOCK: "1" })).toThrow(MSG_UNSET);
  });

  it("VITE_UI_MOCK=1 with APP_ENV=production throws the production message", () => {
    expect(() =>
      assertUiMockNotInProductionBuild({ VITE_UI_MOCK: "1", APP_ENV: "production" }),
    ).toThrow(MSG_PRODUCTION);
  });

  it.each(INVALID_NON_PRODUCTION)(
    "VITE_UI_MOCK=1 with APP_ENV=%j throws the 'not one of them' message",
    (appEnv) => {
      expect(() =>
        assertUiMockNotInProductionBuild({ VITE_UI_MOCK: "1", APP_ENV: appEnv }),
      ).toThrow(MSG_INVALID);
    },
  );

  it("the 'not one of them' message is not used for unset or production, and the others do not overlap", () => {
    const messageOf = (env: Record<string, string | undefined>): string => {
      try {
        assertUiMockNotInProductionBuild(env);
      } catch (error) {
        return error instanceof Error ? error.message : "";
      }
      return "";
    };
    expect(messageOf({ VITE_UI_MOCK: "1" })).toBe(MSG_UNSET);
    expect(messageOf({ VITE_UI_MOCK: "1", APP_ENV: "production" })).toBe(MSG_PRODUCTION);
    expect(messageOf({ VITE_UI_MOCK: "1", APP_ENV: "prod" })).toBe(MSG_INVALID);
  });

  it.each(["0", "", undefined, "true", " 1"])(
    "VITE_UI_MOCK=%j never throws, whatever APP_ENV is",
    (flag) => {
      for (const appEnv of NOT_ALLOWED_APP_ENVS) {
        expect(
          () => assertUiMockNotInProductionBuild({ VITE_UI_MOCK: flag, APP_ENV: appEnv }),
          `${String(flag)} / ${String(appEnv)}`,
        ).not.toThrow();
      }
      for (const appEnv of ALLOWED_APP_ENVS) {
        expect(() =>
          assertUiMockNotInProductionBuild({ VITE_UI_MOCK: flag, APP_ENV: appEnv }),
        ).not.toThrow();
      }
    },
  );

  it("never puts the offending value in the message", () => {
    const sentinel = "prod-sentinel-7c1e";
    let message = "";
    try {
      assertUiMockNotInProductionBuild({ VITE_UI_MOCK: "1", APP_ENV: sentinel });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toBe(MSG_INVALID);
    expect(message).not.toContain(sentinel);
  });
});
