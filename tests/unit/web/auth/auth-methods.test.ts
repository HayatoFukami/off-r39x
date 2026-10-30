import { describe, expect, it } from "vitest";
import * as methods from "../../../../apps/web/src/features/auth/auth-methods.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";

// B5 C1 / C2 (tests/contracts/s6-auth.md section 5A). SPEC-050 15.0: PG-AUTH-001 / 003 offer the methods in the
// specified order (Email+Password, Google, Email OTP, Magic Link) and never GitHub / Discord.
// C1 offered the two methods that complete inside the page; C2 adds Google (an external-completion method, FR-CRT-012).
// Magic Link, the last method of the specified order, is added by C3, whose test then pins the exact four methods.
// Until then this test accepts the list with or without it and requires that, when it exists, it comes last.

const SPECIFIED_ORDER = ["password", "google", "email-otp", "magic-link"] as const;
const REQUIRED_NOW = ["password", "google", "email-otp"] as const;

describe("TC-PG-AUTH-003-212 the method list is the specified order with Email+Password as the default and no other provider (SPEC-050 15.0, 15.1, 15.3)", () => {
  it("lists Email+Password, Google and Email OTP in the specified order (Magic Link, when present, is last), and defaults to Email+Password", async () => {
    const list = [...methods.AUTH_METHODS] as string[];
    for (const required of REQUIRED_NOW) expect(list, required).toContain(required);
    // Every method is a specified one, none repeats, and the relative order is the specified order.
    expect(new Set(list).size).toBe(list.length);
    expect(list.every((m) => (SPECIFIED_ORDER as readonly string[]).includes(m))).toBe(true);
    expect(list).toEqual(SPECIFIED_ORDER.filter((m) => list.includes(m)));
    expect(list.slice(0, 3)).toEqual([...REQUIRED_NOW]);
    expect(methods.DEFAULT_AUTH_METHOD).toBe("password");
    expect(methods.AUTH_METHODS).toContain(methods.DEFAULT_AUTH_METHOD);
    expect(methods.AUTH_METHODS[0]).toBe(methods.DEFAULT_AUTH_METHOD);
  });

  it("labels each method with its own copy and the labels are distinct", async () => {
    const label = (m: string) =>
      methods.authMethodLabel(m as Parameters<typeof methods.authMethodLabel>[0]);
    expect(label("password")).toBe(copy.auth.method.password);
    expect(label("google")).toBe(copy.auth.method.google);
    expect(label("email-otp")).toBe(copy.auth.method.emailOtp);
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
