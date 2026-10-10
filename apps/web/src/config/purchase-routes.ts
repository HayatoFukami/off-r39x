import { assertNever, type OrderPurpose } from "@off-r39x/domain";
import type { Ref } from "../api-client/types";

// Same-origin relative paths of the purchase flow (SPEC-050 5.2, 7, 16.4, 16.5). Pure.

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A route parameter is a canonical lowercase UUID or nothing: it is never repaired. */
export function parseOrderRef(raw: string): Ref<"order"> | null {
  return CANONICAL_UUID.test(raw) ? (raw as Ref<"order">) : null;
}

export const purchaseOrderHref = (ref: string): string => `/purchase/orders/${ref}`;
export const mypageOrderHref = (ref: string): string => `/mypage/orders/${ref}`;
export const entryTicketHref = (ref: string): string => `/mypage/entry-tickets/${ref}`;
export const reservationHref = (ref: string): string => `/mypage/karaoke/${ref}`;
export const goodsItemHref = (ref: string): string => `/mypage/goods/${ref}`;
export const mockCheckoutHref = (ref: string): string => `/dev/mock-checkout/${ref}`;

/** A composite Order leads with the Entry Ticket list; its Goods are reachable from the same screen. */
export function entitlementsListHref(purpose: OrderPurpose): string {
  switch (purpose) {
    case "ENTRY_TICKET_PURCHASE":
    case "ENTRY_GOODS_PURCHASE":
      return "/mypage/entry-tickets";
    case "KARAOKE_PURCHASE":
      return "/mypage/karaoke";
    case "GOODS_PURCHASE":
      return "/mypage/goods";
    default:
      return assertNever(purpose);
  }
}
