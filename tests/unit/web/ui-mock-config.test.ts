import { describe, expect, it } from "vitest";
import {
  assertUiMockNotInProductionBuild,
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

describe("TC-DEV-WEB-011-002 assertUiMockNotInProductionBuild", () => {
  it("throws when mock is enabled for a production deployment", () => {
    const run = () =>
      assertUiMockNotInProductionBuild({ VITE_UI_MOCK: "1", APP_ENV: "production" });
    expect(run).toThrow(Error);
    expect(run).toThrow(/UI mock/);
  });

  it("does not treat the former VERCEL_ENV as the production signal (APP_ENV is the only one)", () => {
    expect(() =>
      assertUiMockNotInProductionBuild({ VITE_UI_MOCK: "1", VERCEL_ENV: "production" }),
    ).not.toThrow();
    expect(() =>
      assertUiMockNotInProductionBuild({ NEXT_PUBLIC_UI_MOCK: "1", APP_ENV: "production" }),
    ).not.toThrow();
  });

  it.each([
    [{ VITE_UI_MOCK: "1", APP_ENV: "staging" }],
    [{ VITE_UI_MOCK: "1", APP_ENV: "development" }],
    [{ VITE_UI_MOCK: "1" }],
    [{ VITE_UI_MOCK: "0", APP_ENV: "production" }],
    [{ VITE_UI_MOCK: undefined, APP_ENV: "production" }],
    [{ APP_ENV: "production" }],
    [{}],
  ])("does not throw for %j", (env) => {
    expect(() => assertUiMockNotInProductionBuild(env)).not.toThrow();
  });

  it("returns undefined when allowed", () => {
    expect(assertUiMockNotInProductionBuild({})).toBeUndefined();
  });
});
