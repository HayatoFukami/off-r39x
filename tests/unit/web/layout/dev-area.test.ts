import { describe, expect, it } from "vitest";
import { isDevAreaEnabled } from "../../../../apps/web/src/config/ui-mock.ts";

// Contract: tests/contracts/s3-layout.md section 2.3 / 8.1 (DEV-WEB-011, DEV-WEB-012).

describe("TC-DEV-WEB-012-101 isDevAreaEnabled guards /dev/* (DEV-WEB-012)", () => {
  it("is true only when UI mock mode is exactly '1'", () => {
    expect(isDevAreaEnabled({ NEXT_PUBLIC_UI_MOCK: "1" })).toBe(true);
  });

  it.each([["0"], ["true"], ["yes"], [" 1"], [""], [undefined]])(
    "is false for NEXT_PUBLIC_UI_MOCK=%j (fail closed)",
    (value) => {
      expect(isDevAreaEnabled({ NEXT_PUBLIC_UI_MOCK: value })).toBe(false);
    },
  );

  it("is false when the variable is absent", () => {
    expect(isDevAreaEnabled({})).toBe(false);
  });

  it("is false in a production deployment even if mock mode leaked in", () => {
    expect(isDevAreaEnabled({ NEXT_PUBLIC_UI_MOCK: "1", VERCEL_ENV: "production" })).toBe(false);
  });

  it("stays enabled for preview / development deployments", () => {
    expect(isDevAreaEnabled({ NEXT_PUBLIC_UI_MOCK: "1", VERCEL_ENV: "preview" })).toBe(true);
    expect(isDevAreaEnabled({ NEXT_PUBLIC_UI_MOCK: "1", VERCEL_ENV: "development" })).toBe(true);
  });
});
