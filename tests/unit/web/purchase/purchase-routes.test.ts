import { ORDER_PURPOSES } from "@off-r39x/domain";
import { describe, expect, it } from "vitest";
import {
  continuationForPath,
  isSafeRelativePath,
} from "../../../../apps/web/src/auth/continuation.ts";
import {
  entitlementsListHref,
  entryTicketHref,
  goodsItemHref,
  mockCheckoutHref,
  mypageOrderHref,
  parseOrderRef,
  purchaseOrderHref,
  reservationHref,
} from "../../../../apps/web/src/config/purchase-routes.ts";

// Contract: tests/contracts/s7a-purchase.md section 3.1 (SPEC-050 5.2 route identifiers, 16.4 / 16.5 links).

const REF = "0d000000-0000-4000-8000-000000000003";

describe("TC-PG-XFN-001-611 parseOrderRef accepts only a canonical lowercase UUID (SPEC-050 5.2, 19.2)", () => {
  it("accepts a canonical UUID unchanged", () => {
    expect(parseOrderRef(REF)).toBe(REF);
  });

  it.each([
    ["empty", ""],
    ["upper case", REF.toUpperCase()],
    ["surrounding space", ` ${REF} `],
    ["trailing newline", `${REF}\n`],
    ["braces", `{${REF}}`],
    ["missing group", "0d000000-0000-4000-8000"],
    ["not hex", "0d00000g-0000-4000-8000-000000000003"],
    ["a path", `../${REF}`],
    ["a percent-encoded dash", "0d000000%2D0000-4000-8000-000000000003"],
    ["a scheme", `https://example.com/${REF}`],
    ["a number", "12"],
  ])("rejects %s without repairing it", (_name, raw) => {
    expect(parseOrderRef(raw)).toBeNull();
  });
});

describe("TC-PG-XFN-001-612 the hrefs are same-origin relative paths for the contracted routes (SPEC-050 7, 16.5)", () => {
  it("builds the Purchase Status, Mypage and dev paths from a ref", () => {
    expect(purchaseOrderHref(REF)).toBe(`/purchase/orders/${REF}`);
    expect(mypageOrderHref(REF)).toBe(`/mypage/orders/${REF}`);
    expect(entryTicketHref(REF)).toBe(`/mypage/entry-tickets/${REF}`);
    expect(reservationHref(REF)).toBe(`/mypage/karaoke/${REF}`);
    expect(goodsItemHref(REF)).toBe(`/mypage/goods/${REF}`);
    expect(mockCheckoutHref(REF)).toBe(`/dev/mock-checkout/${REF}`);
  });

  it("every built path is safe under the Continuation path rule (no /admin, /staff, scheme or //)", () => {
    for (const href of [
      purchaseOrderHref(REF),
      mypageOrderHref(REF),
      entryTicketHref(REF),
      reservationHref(REF),
      goodsItemHref(REF),
      mockCheckoutHref(REF),
    ]) {
      expect(isSafeRelativePath(href), href).toBe(true);
    }
  });

  it("the Purchase Status path is the one S6 maps to the purchase-order Continuation key", () => {
    expect(continuationForPath(purchaseOrderHref(REF))).toEqual({
      key: "purchase-order",
      ref: REF,
    });
    expect(continuationForPath(mypageOrderHref(REF))).toEqual({ key: "mypage-order", ref: REF });
  });
});

describe("TC-PG-XFN-001-613 entitlementsListHref picks the list that matches the Purpose (SPEC-050 16.4 / 16.5)", () => {
  it("maps each of the four purposes; a composite Order leads with the Entry Ticket list", () => {
    expect(entitlementsListHref("ENTRY_TICKET_PURCHASE")).toBe("/mypage/entry-tickets");
    expect(entitlementsListHref("KARAOKE_PURCHASE")).toBe("/mypage/karaoke");
    expect(entitlementsListHref("GOODS_PURCHASE")).toBe("/mypage/goods");
    expect(entitlementsListHref("ENTRY_GOODS_PURCHASE")).toBe("/mypage/entry-tickets");
  });

  it("covers every canonical purpose with a safe path", () => {
    for (const purpose of ORDER_PURPOSES) {
      expect(isSafeRelativePath(entitlementsListHref(purpose)), purpose).toBe(true);
    }
  });
});
