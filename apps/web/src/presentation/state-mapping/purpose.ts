import { assertNever, type OrderPurpose } from "@off-r39x/domain";
import { copy } from "../copy/ja";

export type OrderPurposeIncludes = "ENTRY_TICKET" | "GOODS" | "KARAOKE";

export type PurposePresentation = {
  readonly label: string;
  readonly includes: readonly OrderPurposeIncludes[];
  readonly isComposite: boolean;
};

export function presentPurpose(purpose: OrderPurpose): PurposePresentation {
  switch (purpose) {
    case "ENTRY_TICKET_PURCHASE":
      return {
        label: copy.purpose.ENTRY_TICKET_PURCHASE,
        includes: ["ENTRY_TICKET"],
        isComposite: false,
      };
    case "KARAOKE_PURCHASE":
      return { label: copy.purpose.KARAOKE_PURCHASE, includes: ["KARAOKE"], isComposite: false };
    case "GOODS_PURCHASE":
      return { label: copy.purpose.GOODS_PURCHASE, includes: ["GOODS"], isComposite: false };
    case "ENTRY_GOODS_PURCHASE":
      return {
        label: copy.purpose.ENTRY_GOODS_PURCHASE,
        includes: ["ENTRY_TICKET", "GOODS"],
        isComposite: true,
      };
    default:
      return assertNever(purpose);
  }
}

export type QrPurpose = "ENTRY" | "KARAOKE";

export function presentQrTitle(purpose: QrPurpose): string {
  switch (purpose) {
    case "ENTRY":
      return copy.qr.ENTRY;
    case "KARAOKE":
      return copy.qr.KARAOKE;
    default:
      return assertNever(purpose);
  }
}

export type PurchaseAgainTarget = "cart" | "karaoke";

export function purchaseAgainTarget(purpose: OrderPurpose): PurchaseAgainTarget {
  switch (purpose) {
    case "KARAOKE_PURCHASE":
      return "karaoke";
    case "ENTRY_TICKET_PURCHASE":
    case "GOODS_PURCHASE":
    case "ENTRY_GOODS_PURCHASE":
      return "cart";
    default:
      return assertNever(purpose);
  }
}
