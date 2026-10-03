import { NOTIFICATION_STATES, type NotificationState } from "@off-r39x/domain";
import { describe, expect, it } from "vitest";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { presentNotification } from "../../../../apps/web/src/presentation/state-mapping/notification.ts";
import { stringLeaves, TONES } from "../../../harness/presentation.ts";

// SPEC-050 16.7 fixed message.
const FAILED_RETRYABLE_MESSAGE =
  "購入は確定済みです。確認Emailの送信に失敗または遅延しています。購入内容はこの画面とMypageで確認できます";

describe("TC-PG-XFN-001-002 presentNotification (SPEC-050 16.7 / 20.5)", () => {
  it("keeps the purchase success and shows the fixed non-blocking notice for FAILED_RETRYABLE", () => {
    const presented = presentNotification("FAILED_RETRYABLE");
    expect(presented).not.toBeNull();
    expect(presented?.message).toBe(FAILED_RETRYABLE_MESSAGE);
    expect(presented?.blocking).toBe(false);
    expect(presented?.keepsPurchaseSuccess).toBe(true);
    expect(presented?.tone).not.toBe("failure");
  });

  it("offers no action and no retry / purchase-again wording for FAILED_RETRYABLE", () => {
    const presented = presentNotification("FAILED_RETRYABLE");
    expect(presented?.actions).toEqual([]);
    for (const phrase of ["再試行", "再送", "もう一度購入", "やり直"]) {
      expect(presented?.message).not.toContain(phrase);
      expect(presented?.label).not.toContain(phrase);
    }
  });

  it("returns null for CANCELED (notification no longer needed)", () => {
    expect(presentNotification("CANCELED")).toBeNull();
  });

  it("shows PENDING and SENT as auxiliary information that never blocks or changes the purchase", () => {
    for (const state of ["PENDING", "SENT"] as const) {
      const presented = presentNotification(state);
      expect(presented, state).not.toBeNull();
      expect(presented?.label).toContain("Email");
      expect((presented?.message ?? "").length).toBeGreaterThan(0);
      expect(presented?.blocking).toBe(false);
      expect(presented?.keepsPurchaseSuccess).toBe(true);
      expect(presented?.actions).toEqual([]);
    }
    expect(presentNotification("PENDING")?.label).toContain("確認Email");
  });

  it("uses distinct labels for PENDING / SENT / FAILED_RETRYABLE, all from the dictionary", () => {
    const dictionary = new Set(stringLeaves(copy));
    const shown = NOTIFICATION_STATES.flatMap((s) => {
      const presented = presentNotification(s);
      return presented === null ? [] : [presented];
    });
    expect(shown).toHaveLength(3);
    expect(new Set(shown.map((p) => p.label)).size).toBe(3);
    for (const presented of shown) {
      expect(dictionary.has(presented.label), presented.label).toBe(true);
      expect(dictionary.has(presented.message), presented.message).toBe(true);
      expect(TONES).toContain(presented.tone);
    }
  });

  it("fails closed on an unknown Notification state", () => {
    expect(() => presentNotification("BOUNCED" as NotificationState)).toThrow(/Unexpected value/);
  });
});
