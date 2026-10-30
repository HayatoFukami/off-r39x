import { describe, expect, it } from "vitest";
import * as methods from "../../../../apps/web/src/features/auth/auth-methods.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";

// B5 C1 (tests/contracts/s6-auth.md section 5A). SPEC-050 15.0: PG-AUTH-001 / 003 offer the methods in the
// specified order (Email+Password, Google, Email OTP, Magic Link) and never GitHub / Discord. C1 offers the
// two methods that complete inside the page; Google (C2) and Magic Link (C3) are added in their commits and
// this test is then updated to the specified four-method order.

describe("TC-PG-AUTH-003-212 the method list is the specified order with Email+Password as the default and no other provider (SPEC-050 15.0, 15.1, 15.3)", () => {
  it("lists Email+Password then Email OTP, and defaults to Email+Password", async () => {
    expect([...methods.AUTH_METHODS]).toEqual(["password", "email-otp"]);
    expect(methods.DEFAULT_AUTH_METHOD).toBe("password");
    expect(methods.AUTH_METHODS).toContain(methods.DEFAULT_AUTH_METHOD);
    expect(methods.AUTH_METHODS[0]).toBe(methods.DEFAULT_AUTH_METHOD);
  });

  it("labels each method with its own copy and the labels are distinct", async () => {
    expect(methods.authMethodLabel("password")).toBe(copy.auth.method.password);
    expect(methods.authMethodLabel("email-otp")).toBe(copy.auth.method.emailOtp);
    const labels = methods.AUTH_METHODS.map((m) => methods.authMethodLabel(m));
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("never offers GitHub, Discord, LINE or Apple (SPEC-050 15.0)", async () => {
    for (const method of methods.AUTH_METHODS) {
      expect(method).not.toMatch(/github|discord|line|apple/i);
      expect(methods.authMethodLabel(method)).not.toMatch(/github|discord|\bline\b|\bapple\b/i);
    }
  });
});
