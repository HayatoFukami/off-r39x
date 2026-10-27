import { describe, expect, it } from "vitest";
import {
  DISPLAY_NAME_MAX_CODE_POINTS,
  normalizeDisplayName,
} from "../../../../apps/web/src/api-client/display-name-policy.ts";
import { combining, emojis } from "../../../harness/display-name.ts";

// Contract: tests/contracts/s2-mock-backend.md (Display name rule), tests/contracts/s8-mypage.md section 3.8
// (SPEC-030 9.2, API-AUTH-004, SPEC-050 18.2). The module is pure: no mock, no React, no clock.

const normalize = async (input: string) => normalizeDisplayName(input);

describe("TC-FR-AUTH-011-001 the Display name rule: trim, blank clears, 1-80 code points, no Cc (SPEC-030 9.2, API-AUTH-004)", () => {
  it("states the maximum as 80 code points", async () => {
    expect(DISPLAY_NAME_MAX_CODE_POINTS).toBe(80);
  });

  it.each(["", " ", "　", " \t\n ", "\r\n", " ", "　 　"])(
    "clears the blank input %j to null (unset), never to an empty string",
    async (blank) => {
      expect(await normalize(blank)).toEqual({ ok: true, value: null });
    },
  );

  it("trims ordinary and ideographic whitespace and keeps the inside as it is", async () => {
    expect(await normalize("  名前  ")).toEqual({ ok: true, value: "名前" });
    expect(await normalize("　名前　")).toEqual({ ok: true, value: "名前" });
    expect(await normalize("\t名前\n")).toEqual({ ok: true, value: "名前" });
    expect(await normalize("山田 太郎")).toEqual({ ok: true, value: "山田 太郎" });
  });

  it("accepts exactly 80 code points and rejects 81 (ASCII)", async () => {
    expect(await normalize("a".repeat(80))).toEqual({ ok: true, value: "a".repeat(80) });
    expect(await normalize("a".repeat(81))).toEqual({ ok: false, reason: "too_long" });
  });

  it("counts code points, not UTF-16 code units: 80 emoji (160 units) pass and 81 fail", async () => {
    expect(emojis(80)).toHaveLength(160);
    expect(await normalize(emojis(80))).toEqual({ ok: true, value: emojis(80) });
    expect(await normalize(emojis(81))).toEqual({ ok: false, reason: "too_long" });
  });

  it("counts a combining mark as its own code point: 80 pass and 81 fail", async () => {
    expect([...combining(80)]).toHaveLength(80);
    expect(await normalize(combining(80))).toEqual({ ok: true, value: combining(80) });
    expect(await normalize(`${combining(80)}か`)).toEqual({ ok: false, reason: "too_long" });
  });

  it("counts the length after the trim: spaces around 80 code points do not count", async () => {
    expect(await normalize(`  ${"a".repeat(80)}  `)).toEqual({
      ok: true,
      value: "a".repeat(80),
    });
    expect(await normalize(`　${"a".repeat(81)}　`)).toEqual({ ok: false, reason: "too_long" });
  });

  it.each([
    ["a tab inside", "名\t前"],
    ["a NUL inside", "名\u0000前"],
    ["a NUL at the start (not removed by trim)", "\u0000名前"],
    ["DEL at the end (not removed by trim)", "名前\u007F"],
    ["NEL (U+0085) at the end", "名前\u0085"],
    ["a line feed inside", "名\n前"],
    ["a carriage return inside", "名\r前"],
  ])("rejects %s as control_character", async (_label, input) => {
    expect(await normalize(input)).toEqual({ ok: false, reason: "control_character" });
  });

  it("does not treat Cf (format) characters as control: a zero width space is accepted as it is", async () => {
    expect(await normalize("名​前")).toEqual({ ok: true, value: "名​前" });
  });

  it("reports control_character when both the Cc and the length rules are violated (the order is fixed)", async () => {
    expect(await normalize(`${"a".repeat(81)}\u0000`)).toEqual({
      ok: false,
      reason: "control_character",
    });
    expect(await normalize(`${"a".repeat(90)}\u0007`)).toEqual({
      ok: false,
      reason: "control_character",
    });
  });

  it("does not normalize the Unicode form and never builds a name from anything but the input", async () => {
    const composed = "が";
    const decomposed = "が";
    expect(await normalize(composed)).toEqual({ ok: true, value: composed });
    expect(await normalize(decomposed)).toEqual({ ok: true, value: decomposed });
  });

  it("is a pure function: the same input gives the same answer", async () => {
    const input = "  名前  ";
    const first = await normalize(input);
    const second = await normalize(input);
    expect(second).toEqual(first);
    expect(input).toBe("  名前  ");
  });
});
