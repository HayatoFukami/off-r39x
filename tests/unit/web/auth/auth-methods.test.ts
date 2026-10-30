import { describe, expect, it } from "vitest";
import * as methods from "../../../../apps/web/src/features/auth/auth-methods.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";

// B5 C1 / C2 / C3 (tests/contracts/s6-auth.md section 5A). SPEC-050 15.0: PG-AUTH-001 / 003 offer exactly the four
// methods, in the specified order (Email+Password, Google, Email OTP, Magic Link), and never GitHub / Discord.
// C1 offered the two methods that complete inside the page, C2 added Google and C3 adds Magic Link: Google and Magic
// Link are the external-completion methods (FR-CRT-012).

const SPECIFIED_ORDER = ["password", "google", "email-otp", "magic-link"] as const;

describe("TC-PG-AUTH-003-212 the method list is exactly the four specified methods in the specified order with Email+Password as the default and no other provider (SPEC-050 15.0, 15.1, 15.3)", () => {
  it("lists Email+Password, Google, Email OTP and Magic Link in that order, and defaults to Email+Password", async () => {
    expect([...methods.AUTH_METHODS]).toEqual([...SPECIFIED_ORDER]);
    expect(methods.DEFAULT_AUTH_METHOD).toBe("password");
    expect(methods.AUTH_METHODS).toContain(methods.DEFAULT_AUTH_METHOD);
    expect(methods.AUTH_METHODS[0]).toBe(methods.DEFAULT_AUTH_METHOD);
    expect(methods.AUTH_METHODS).toHaveLength(4);
  });

  it("labels each method with its own copy and the labels are distinct", async () => {
    const label = (m: string) =>
      methods.authMethodLabel(m as Parameters<typeof methods.authMethodLabel>[0]);
    expect(label("password")).toBe(copy.auth.method.password);
    expect(label("google")).toBe(copy.auth.method.google);
    expect(label("email-otp")).toBe(copy.auth.method.emailOtp);
    expect(label("magic-link")).toBe(copy.auth.method.magicLink);
    const labels = methods.AUTH_METHODS.map((m) => methods.authMethodLabel(m));
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toHaveLength(4);
    for (const text of labels) {
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("never offers GitHub, Discord, LINE or Apple (SPEC-050 15.0)", async () => {
    for (const method of methods.AUTH_METHODS) {
      expect(method).not.toMatch(/github|discord|line|apple/i);
      expect(methods.authMethodLabel(method)).not.toMatch(/github|discord|\bline\b|\bapple\b/i);
    }
  });
});
