import { describe, expect, it } from "vitest";
import type { ContinuationKey } from "../../../../apps/web/src/auth/continuation.ts";
import { describeContinuation } from "../../../../apps/web/src/features/auth/continuation-view.ts";
import { copy } from "../../../../apps/web/src/presentation/copy/ja.ts";

// tests/contracts/s6-auth.md section 5. SPEC-050 10.1 / 15.1 / 15.3, AR-CONT-004.

const UUID = "5a000000-0000-4000-8000-000000011000";

describe("TC-PG-AUTH-003-211 the Login notice names the purpose in general words (SPEC-050 15.3, AR-CONT-004)", () => {
  it("shows nothing without an intent", () => {
    expect(describeContinuation(null)).toBeNull();
  });

  it.each<[ContinuationKey, string | null, string]>([
    ["cart", null, "cart"],
    ["karaoke-slot", UUID, "karaokeSlot"],
    ["purchase-order", UUID, "purchaseOrder"],
    ["mypage", null, "mypage"],
    ["mypage-profile", null, "mypage"],
    ["mypage-orders", null, "mypage"],
    ["mypage-order", UUID, "mypage"],
    ["mypage-entry-tickets", null, "mypage"],
    ["mypage-entry-ticket", UUID, "mypage"],
    ["mypage-karaoke", null, "mypage"],
    ["mypage-reservation", UUID, "mypage"],
    ["mypage-goods", null, "mypage"],
    ["mypage-goods-item", UUID, "mypage"],
  ])("%s -> purpose %s", (key, ref, purpose) => {
    const notice = describeContinuation({ key, ref });
    const labels = copy.auth.continuation.purpose as Record<string, string>;
    expect(notice).toEqual({
      notice: copy.auth.continuation.notice,
      purposeLabel: labels[purpose],
      returnAfter: copy.auth.continuation.returnAfter,
      revalidate: copy.auth.continuation.revalidate,
    });
  });

  it("carries no price, quantity, reference or time from the intent", () => {
    const notice = describeContinuation({ key: "karaoke-slot", ref: UUID });
    expect(JSON.stringify(notice)).not.toContain(UUID);
    expect(JSON.stringify(notice)).not.toMatch(/[¥￥0-9]/);
  });

  it("does not promise the pre-login display (AR-CONT-004: it is not a purchase guarantee)", () => {
    const notice = describeContinuation({ key: "cart", ref: null });
    expect(notice?.revalidate).toMatch(/確認し直/);
  });
});
