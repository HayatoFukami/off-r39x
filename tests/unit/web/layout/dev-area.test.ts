import { describe, expect, it } from "vitest";
import { isDevAreaEnabled } from "../../../../apps/web/src/config/ui-mock.ts";

// Contract: tests/contracts/s3-layout.md section 2.3 / 8.1 (DEV-WEB-011, DEV-WEB-012, INF-ENV-001).
// /dev/* exists only while the mock flag is "1" AND APP_ENV is exactly development, staging or test. The flag axis
// is checked with an allowed APP_ENV supplied; the APP_ENV axis is checked with the flag on.

describe("TC-DEV-WEB-012-101 isDevAreaEnabled guards /dev/* (DEV-WEB-012)", () => {
  it.each(["development", "staging", "test"])(
    "is true when UI mock mode is '1' and APP_ENV is %s",
    (appEnv) => {
      expect(isDevAreaEnabled({ VITE_UI_MOCK: "1", APP_ENV: appEnv })).toBe(true);
    },
  );

  it.each([["0"], ["true"], ["yes"], [" 1"], [""], [undefined]])(
    "is false for VITE_UI_MOCK=%j even with an allowed APP_ENV (fail closed)",
    (value) => {
      expect(isDevAreaEnabled({ VITE_UI_MOCK: value, APP_ENV: "development" })).toBe(false);
    },
  );

  it("is false when the variable is absent", () => {
    expect(isDevAreaEnabled({})).toBe(false);
    expect(isDevAreaEnabled({ APP_ENV: "development" })).toBe(false);
  });

  it.each([undefined, "", "Development", " test", "prod", "production"])(
    "is false with the flag on and APP_ENV=%j (unset, malformed, alias or production: fail closed)",
    (appEnv) => {
      expect(isDevAreaEnabled({ VITE_UI_MOCK: "1", APP_ENV: appEnv })).toBe(false);
    },
  );

  it("is false in a production deployment even if mock mode leaked in", () => {
    expect(isDevAreaEnabled({ VITE_UI_MOCK: "1", APP_ENV: "production" })).toBe(false);
  });

  it("does not read the former Next.js variables (fail closed; the old names are not aliases)", () => {
    expect(isDevAreaEnabled({ NEXT_PUBLIC_UI_MOCK: "1" })).toBe(false);
    expect(isDevAreaEnabled({ NEXT_PUBLIC_UI_MOCK: "1", APP_ENV: "staging" })).toBe(false);
  });

  it("does not take VERCEL_ENV as a signal in either direction", () => {
    // With an allowed APP_ENV the former production signal changes nothing (the area stays on) ...
    expect(
      isDevAreaEnabled({ VITE_UI_MOCK: "1", APP_ENV: "development", VERCEL_ENV: "production" }),
    ).toBe(true);
    // ... and without APP_ENV it cannot stand in for it.
    expect(isDevAreaEnabled({ VITE_UI_MOCK: "1", VERCEL_ENV: "production" })).toBe(false);
    expect(isDevAreaEnabled({ VITE_UI_MOCK: "1", VERCEL_ENV: "development" })).toBe(false);
  });
});
