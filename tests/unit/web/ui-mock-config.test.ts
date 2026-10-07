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
  ])("NEXT_PUBLIC_UI_MOCK=%j -> %s", (value, expected) => {
    expect(isUiMockEnabled({ NEXT_PUBLIC_UI_MOCK: value })).toBe(expected);
  });

  it("is false when the variable is absent", () => {
    expect(isUiMockEnabled({})).toBe(false);
  });
});

describe("TC-DEV-WEB-011-002 assertUiMockNotInProductionBuild", () => {
  it("throws when mock is enabled for a production deployment", () => {
    const run = () =>
      assertUiMockNotInProductionBuild({ NEXT_PUBLIC_UI_MOCK: "1", VERCEL_ENV: "production" });
    expect(run).toThrow(Error);
    expect(run).toThrow(/UI mock/);
  });

  it.each([
    [{ NEXT_PUBLIC_UI_MOCK: "1", VERCEL_ENV: "preview" }],
    [{ NEXT_PUBLIC_UI_MOCK: "1", VERCEL_ENV: "development" }],
    [{ NEXT_PUBLIC_UI_MOCK: "1" }],
    [{ NEXT_PUBLIC_UI_MOCK: "0", VERCEL_ENV: "production" }],
    [{ NEXT_PUBLIC_UI_MOCK: undefined, VERCEL_ENV: "production" }],
    [{ VERCEL_ENV: "production" }],
    [{}],
  ])("does not throw for %j", (env) => {
    expect(() => assertUiMockNotInProductionBuild(env)).not.toThrow();
  });

  it("returns undefined when allowed", () => {
    expect(assertUiMockNotInProductionBuild({})).toBeUndefined();
  });
});
