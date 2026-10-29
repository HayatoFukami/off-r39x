import { assertNever } from "@off-r39x/domain";
import { cartLineKey } from "./cart-line-key";
import type { EligibilityTarget } from "./types";

/** Stable key of an eligibility target: cartLineKey for Cart lines, `KARAOKE:${slotRef}` for a Slot. */
export function eligibilityTargetKey(target: EligibilityTarget): string {
  switch (target.kind) {
    case "KARAOKE":
      return `KARAOKE:${target.slotRef}`;
    case "ENTRY_TICKET":
    case "GOODS":
      return cartLineKey(target);
    default:
      return assertNever(target);
  }
}
