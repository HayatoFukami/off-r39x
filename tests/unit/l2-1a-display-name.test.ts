// PR-L2-1a C1 (TC-API-007-002, G1): the pure Display name rule of SPEC-030 §9.2 (BR-USR-001) as
// normalizeDisplayName in @off-r39x/domain: ECMAScript trim(), empty -> NULL, 1..80 code points, no Cc in
// the trimmed value (Cc is judged before the length), no Unicode normalization. Expected values come from
// the plan's input table and the spec, not from the implementation. A lone surrogate is deliberately not
// asserted (open issue OI-1: it waits for the specification PR). Synthetic strings only.
import { DISPLAY_NAME_MAX_CODE_POINTS, normalizeDisplayName } from "@off-r39x/domain";
import { describe, expect, it } from "vitest";

type Normalized = { ok: true; value: string | null } | { ok: false; reason: string };
const normalize = (input: string | null): Normalized => normalizeDisplayName(input);

const ok = (value: string | null): Normalized => ({ ok: true, value });
const tooLong: Normalized = { ok: false, reason: "too_long" };
const control: Normalized = { ok: false, reason: "control_character" };

const FAMILY = "\u{1F468}‍\u{1F469}‍\u{1F467}"; // 5 code points
const KA = "が"; // か + combining dakuten, 2 code points

const CASES: readonly (readonly [label: string, input: string | null, expected: Normalized])[] = [
  ["null", null, ok(null)],
  ["empty", "", ok(null)],
  ["spaces only", "   ", ok(null)],
  ["ideographic space only (U+3000)", "　", ok(null)],
  ["tab and line feed only", "\t\n", ok(null)],
  ["byte order mark only (U+FEFF, removed by trim)", "﻿", ok(null)],
  ["surrounding spaces", "  name  ", ok("name")],
  ["surrounding U+3000", "　name　", ok("name")],
  ["surrounding tab and line feed", "\tname\n", ok("name")],
  ["inner spaces are kept", "a  b", ok("a  b")],
  ["1 code point", "a", ok("a")],
  ["80 ASCII", "a".repeat(80), ok("a".repeat(80))],
  ["raw length 82, 80 after trim", ` ${"a".repeat(80)} `, ok("a".repeat(80))],
  ["81 ASCII", "a".repeat(81), tooLong],
  ["80 emoji (160 UTF-16 units)", "\u{1F600}".repeat(80), ok("\u{1F600}".repeat(80))],
  ["81 emoji", "\u{1F600}".repeat(81), tooLong],
  ["80 code points of combining sequences (not NFC-composed)", KA.repeat(40), ok(KA.repeat(40))],
  ["81 code points of combining sequences", `${KA.repeat(40)}a`, tooLong],
  ["80 code points of ZWJ sequences", FAMILY.repeat(16), ok(FAMILY.repeat(16))],
  ["81 code points of ZWJ sequences", `${FAMILY.repeat(16)}a`, tooLong],
  ["80 Japanese characters", "あ".repeat(80), ok("あ".repeat(80))],
  ["81 Japanese characters", "あ".repeat(81), tooLong],
  ["NUL inside", "a\u0000b", control],
  ["BEL inside", "a\u0007b", control],
  ["U+001F inside", "a\u001Fb", control],
  ["DEL inside", "a\u007Fb", control],
  ["U+0080 inside", "a\u0080b", control],
  ["NEL (U+0085) inside", "a\u0085b", control],
  ["U+009F inside", "a\u009Fb", control],
  ["tab inside", "a\tb", control],
  ["line feed inside", "a\nb", control],
  ["NEL at the start (not removed by trim)", "\u0085name", control],
  ["NUL at the end (not removed by trim)", "name\u0000", control],
  ["Cc and too long: Cc is judged first", "a\u0000".repeat(50), control],
  ["Cf zero width space is allowed", "a​b", ok("a​b")],
  ["Cf zero width joiner is allowed", "a‍b", ok("a‍b")],
];

describe("TC-API-007-002 normalizeDisplayName (SPEC-030 §9.2, BR-USR-001, SEC-API-029, API-AUTH-004)", () => {
  it("exports the function and the limit named by the plan", () => {
    expect(typeof normalizeDisplayName).toBe("function");
    expect(DISPLAY_NAME_MAX_CODE_POINTS).toBe(80);
  });

  it.each(CASES)("%s", (_label, input, expected) => {
    expect(normalize(input)).toEqual(expected);
  });

  it("is a pure function: the same input gives the same answer and the input string is unchanged", () => {
    for (const [, input, expected] of CASES) {
      const before = input === null ? null : `${input}`;
      expect(normalize(input)).toEqual(expected);
      expect(normalize(input)).toEqual(expected);
      expect(input).toBe(before);
    }
  });

  it("does not apply Unicode normalization (a decomposed sequence stays decomposed)", () => {
    const result = normalize(KA);
    expect(result).toEqual(ok(KA));
    expect(result.ok && result.value).not.toBe("が");
  });

  it("an accepted value is already normalized (normalizing it again changes nothing)", () => {
    for (const [, , expected] of CASES) {
      if (!expected.ok) continue;
      expect(normalize(expected.value)).toEqual(expected);
    }
  });
});
