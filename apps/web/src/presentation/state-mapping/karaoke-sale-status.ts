import { assertNever } from "@off-r39x/domain";
import type { KaraokeSaleStatus } from "../../api-client/types";
import { copy } from "../copy/ja";
import type { Tone } from "./order";

// Public sale status of the Karaoke sale (SPEC-050 13.1, 20.3). Before / ended / suspended are separate.

export type KaraokeSaleStatusPresentation = {
  label: string;
  description: string;
  tone: Tone;
  onSale: boolean;
};

export function presentKaraokeSaleStatus(status: KaraokeSaleStatus): KaraokeSaleStatusPresentation {
  switch (status) {
    case "ON_SALE":
      return {
        label: copy.availability.label.ON_SALE,
        description: copy.karaoke.saleStatus.description.ON_SALE,
        tone: "success",
        onSale: true,
      };
    case "BEFORE_SALES":
      return {
        label: copy.availability.label.BEFORE_SALES,
        description: copy.karaoke.saleStatus.description.BEFORE_SALES,
        tone: "pending",
        onSale: false,
      };
    case "SALES_ENDED":
      return {
        label: copy.availability.label.SALES_ENDED,
        description: copy.karaoke.saleStatus.description.SALES_ENDED,
        tone: "neutral",
        onSale: false,
      };
    case "SUSPENDED":
      return {
        label: copy.availability.label.SUSPENDED,
        description: copy.karaoke.saleStatus.description.SUSPENDED,
        tone: "neutral",
        onSale: false,
      };
    default:
      return assertNever(status);
  }
}
