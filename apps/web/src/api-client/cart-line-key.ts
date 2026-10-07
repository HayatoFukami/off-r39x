import { assertNever } from "@off-r39x/domain";
import type { CartLine } from "./types";

/** Stable key of a cart line: `${kind}:${ref}`. A cart holds at most one line per key. */
export function cartLineKey(line: CartLine): string {
  switch (line.kind) {
    case "ENTRY_TICKET":
      return `${line.kind}:${line.offeringRef}`;
    case "GOODS":
      return `${line.kind}:${line.goodsRef}`;
    default:
      return assertNever(line);
  }
}
