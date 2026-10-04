import type { ContinuationIntent, ContinuationKey } from "../../auth/continuation";
import { copy } from "../../presentation/copy/ja";

export type ContinuationNotice = {
  notice: string;
  purposeLabel: string;
  returnAfter: string;
  revalidate: string;
};

const purposeOf = (key: ContinuationKey): string => {
  switch (key) {
    case "cart":
      return copy.auth.continuation.purpose.cart;
    case "karaoke-slot":
      return copy.auth.continuation.purpose.karaokeSlot;
    case "purchase-order":
      return copy.auth.continuation.purpose.purchaseOrder;
    case "mypage":
    case "mypage-profile":
    case "mypage-orders":
    case "mypage-order":
    case "mypage-entry-tickets":
    case "mypage-entry-ticket":
    case "mypage-karaoke":
    case "mypage-reservation":
    case "mypage-goods":
    case "mypage-goods-item":
      return copy.auth.continuation.purpose.mypage;
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
};

/** A general-purpose description only: no price, quantity or slot detail (SPEC-050 15.3). */
export function describeContinuation(intent: ContinuationIntent | null): ContinuationNotice | null {
  if (intent === null) return null;
  return {
    notice: copy.auth.continuation.notice,
    purposeLabel: purposeOf(intent.key),
    returnAfter: copy.auth.continuation.returnAfter,
    revalidate: copy.auth.continuation.revalidate,
  };
}
