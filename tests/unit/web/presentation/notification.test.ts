import { describe, expect, it } from "vitest";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";
import { presentNotificationSummary } from "../../../../apps/web/src/presentation/state-mapping/notification.ts";
import {
  exportsInternalStatePresenter,
  SUMMARY_STATUSES,
} from "../../../harness/notification-summary.ts";
import { stringLeaves, TONES } from "../../../harness/presentation.ts";

// Contract: tests/contracts/s1-presentation.md section 10 (SPEC-050 16.2 / 16.7, API-ORD-003 notification_summary,
// SPEC-120 7.2 EML-NTF-003). The input is the owner-facing summary status, never an internal Notification State.

// SPEC-050 16.7 fixed message.
const ATTENTION_REQUIRED_MESSAGE =
  "購入は確定済みです。確認Emailの送信に失敗または遅延しています。購入内容はこの画面とMypageで確認できます";

describe("TC-PG-XFN-001-002 presentNotificationSummary (SPEC-050 16.2 / 16.7, EML-NTF-003)", () => {
  it("keeps the purchase success and shows the fixed non-blocking notice for ATTENTION_REQUIRED", () => {
    const presented = presentNotificationSummary("ATTENTION_REQUIRED");
    expect(presented).not.toBeNull();
    expect(presented?.message).toBe(ATTENTION_REQUIRED_MESSAGE);
    expect(presented?.blocking).toBe(false);
    expect(presented?.keepsPurchaseSuccess).toBe(true);
    expect(presented?.tone).not.toBe("failure");
  });

  it("offers no action and no retry / purchase-again wording for ATTENTION_REQUIRED", () => {
    const presented = presentNotificationSummary("ATTENTION_REQUIRED");
    expect(presented?.actions).toEqual([]);
    for (const phrase of ["再試行", "再送", "もう一度購入", "やり直"]) {
      expect(presented?.message).not.toContain(phrase);
      expect(presented?.label).not.toContain(phrase);
    }
  });

  it("shows nothing for PENDING, SENT and NONE (SPEC-050 16.7: only ATTENTION_REQUIRED is shown)", () => {
    for (const status of ["PENDING", "SENT", "NONE"] as const) {
      expect(presentNotificationSummary(status), status).toBeNull();
    }
  });

  it("presents exactly one of the four summary statuses, with label and message from the dictionary", () => {
    const dictionary = new Set(stringLeaves(copy));
    const shown = SUMMARY_STATUSES.flatMap((status) => {
      const presented = presentNotificationSummary(status);
      return presented === null ? [] : [presented];
    });
    expect(shown).toHaveLength(1);
    const [presented] = shown;
    expect(dictionary.has(presented?.label ?? ""), presented?.label).toBe(true);
    expect(dictionary.has(presented?.message ?? ""), presented?.message).toBe(true);
    expect(TONES).toContain(presented?.tone);
    expect(presented?.label).toBe(copy.notification.ATTENTION_REQUIRED.label);
    expect(presented?.message).toBe(copy.notification.ATTENTION_REQUIRED.message);
  });

  it("keeps only the ATTENTION_REQUIRED entry in the dictionary (no entry for the shown-nothing statuses)", () => {
    expect(Object.keys(copy.notification).sort()).toEqual(["ATTENTION_REQUIRED"]);
  });

  it("no longer exports a presenter that takes an internal Notification State (SPEC-050 16.2)", () => {
    expect(exportsInternalStatePresenter()).toBe(false);
  });

  it("fails closed on an unknown summary status", () => {
    expect(() => presentNotificationSummary("FAILED_RETRYABLE" as never)).toThrow(
      /Unexpected value/,
    );
    expect(() => presentNotificationSummary("BOUNCED" as never)).toThrow(/Unexpected value/);
  });
});
