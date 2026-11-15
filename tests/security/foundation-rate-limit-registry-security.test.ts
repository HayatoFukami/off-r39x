import { describe, expect, it } from "vitest";
import { createCounterKeyFactory } from "../../packages/security/src/index.ts";

describe("counter keys (SEC-ABU-015 / 016)", () => {
  const secret = Buffer.alloc(32, 9);
  it("TC-RLM-002-101 keys are HMAC-SHA256 digests that bind rule, subject kind, value and key version", () => {
    const v1 = createCounterKeyFactory(secret, 1);
    const key = v1.key("public_read.burst", "ip", "203.0.113.5");
    expect(key).toMatch(/^rl:v1:public_read\.burst:[0-9a-f]{64}$/);
    expect(key).not.toContain("203.0.113.5");
    expect(v1.key("public_read.burst", "ip", "203.0.113.5")).toBe(key);
    expect(v1.key("public_read.burst", "ip", "203.0.113.6")).not.toBe(key);
    expect(v1.key("public_read.sustained", "ip", "203.0.113.5")).not.toBe(key);
    expect(v1.key("public_read.burst", "identifier", "203.0.113.5")).not.toBe(key);
    const v2 = createCounterKeyFactory(secret, 2).key("public_read.burst", "ip", "203.0.113.5");
    expect(v2).toMatch(/^rl:v2:public_read.burst:/);
    expect(v2).not.toBe(key);
    expect(
      createCounterKeyFactory(Buffer.alloc(32, 8), 1).key("public_read.burst", "ip", "203.0.113.5"),
    ).not.toBe(key);
    expect(() => createCounterKeyFactory(Buffer.alloc(16), 1)).toThrow();
    expect(() => createCounterKeyFactory(secret, 0)).toThrow();
  });
});
