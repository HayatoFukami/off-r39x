import { describe, expect, it } from "vitest";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { stringLeaves } from "../../../harness/presentation.ts";

function leafKinds(value: unknown, out: string[] = []): string[] {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) leafKinds(child, out);
  } else {
    out.push(typeof value);
  }
  return out;
}

describe("TC-PG-XFN-001-003 copy dictionary (SPEC-050 24.3 / 27, DEV-WEB-009)", () => {
  it("is a nested object whose leaves are only strings or template functions", () => {
    expect(copy).toBeTypeOf("object");
    const kinds = new Set(leafKinds(copy));
    for (const kind of kinds) expect(["string", "function"]).toContain(kind);
    expect(stringLeaves(copy).length).toBeGreaterThan(20);
  });

  it("has non-empty, trimmed strings", () => {
    for (const text of stringLeaves(copy)) {
      expect(text.length).toBeGreaterThan(0);
      expect(text).toBe(text.trim());
    }
  });

  it("contains the SPEC-050 fixed Order labels, QR titles and notice literally", () => {
    const leaves = new Set(stringLeaves(copy));
    for (const literal of [
      "支払い手続き未開始 / 準備済み",
      "支払い結果を確認中",
      "購入確定",
      "支払い不成立",
      "購入手続き取消済み",
      "購入手続き失効",
      "購入状態を確認中",
      "Entry Ticket / 入場受付用",
      "Karaoke Ticket / Karaoke受付用",
      "購入は確定済みです。確認Emailの送信に失敗または遅延しています。購入内容はこの画面とMypageで確認できます",
    ]) {
      expect(leaves.has(literal), literal).toBe(true);
    }
  });

  it("contains no external brand material or staff / admin links", () => {
    for (const text of stringLeaves(copy)) {
      expect(text.toLowerCase()).not.toContain("hololive");
      expect(text).not.toContain("/admin");
      expect(text).not.toContain("/staff");
    }
  });
});
