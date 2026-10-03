import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validatePassword,
} from "../../../../apps/web/src/auth/password-policy.ts";

describe("TC-SEC-AUTH-016-101 password length 12..128 (SEC-AUTH-016, U13)", () => {
  it("exposes the bounds", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });

  it.each([
    [11, { ok: false, reason: "too_short" }],
    [12, { ok: true }],
    [13, { ok: true }],
    [127, { ok: true }],
    [128, { ok: true }],
    [129, { ok: false, reason: "too_long" }],
    [0, { ok: false, reason: "too_short" }],
    [1000, { ok: false, reason: "too_long" }],
  ])("%d characters -> %j", (length, expected) => {
    expect(validatePassword("a".repeat(length))).toEqual(expected);
  });

  it("counts Unicode code points, not UTF-16 units", () => {
    expect(validatePassword("あ".repeat(12))).toEqual({ ok: true });
    expect(validatePassword("あ".repeat(11))).toEqual({ ok: false, reason: "too_short" });
    // U+1F600 is one code point but two UTF-16 units.
    expect(validatePassword("\u{1F600}".repeat(12))).toEqual({ ok: true });
    expect(validatePassword("\u{1F600}".repeat(11))).toEqual({ ok: false, reason: "too_short" });
    expect(validatePassword("\u{1F600}".repeat(128))).toEqual({ ok: true });
    expect(validatePassword("\u{1F600}".repeat(129))).toEqual({ ok: false, reason: "too_long" });
  });
});

describe("TC-SEC-AUTH-017-101 no trim and no composition rule (SEC-AUTH-016/017, U13)", () => {
  it("does not trim: surrounding whitespace counts toward the length", () => {
    expect(validatePassword(`${"a".repeat(10)}  `)).toEqual({ ok: true });
    expect(validatePassword(`  ${"a".repeat(10)}`)).toEqual({ ok: true });
    expect(validatePassword(`  ${"a".repeat(9)}  `)).toEqual({ ok: false, reason: "too_short" });
  });

  it("accepts whitespace only when it reaches the length (no trimming to empty)", () => {
    expect(validatePassword(" ".repeat(12))).toEqual({ ok: true });
    expect(validatePassword("\t".repeat(12))).toEqual({ ok: true });
    expect(validatePassword(" ".repeat(11))).toEqual({ ok: false, reason: "too_short" });
  });

  it("does not normalize Unicode (NFC and NFD forms are measured as given)", () => {
    const nfd = "é".repeat(6); // 12 code points that would be 6 after NFC
    expect(validatePassword(nfd)).toEqual({ ok: true });
  });

  it("adds no fixed complexity rule: single-class passwords are accepted", () => {
    expect(validatePassword("aaaaaaaaaaaa")).toEqual({ ok: true });
    expect(validatePassword("111111111111")).toEqual({ ok: true });
    expect(validatePassword("ABCDEFGHIJKL")).toEqual({ ok: true });
    expect(validatePassword("............")).toEqual({ ok: true });
  });
});
