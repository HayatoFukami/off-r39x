import { cartLineKey } from "../../api-client/cart-line-key";
import type { CartLine, CartLineResolution } from "../../api-client/types";
import type { Loadable } from "../../presentation/components/list-state";
import { copy } from "../../presentation/copy/ja";
import { formatMoney, multiplyMoney, sumMoney } from "../../presentation/format/money";
import {
  type AvailabilityPresentation,
  presentAvailability,
} from "../../presentation/state-mapping/availability";
import { canProceed, type ProceedDecision } from "./can-proceed";
import type { CartSnapshot } from "./cart-store";

// View model of PG-CRT-001 (SPEC-050 9, 14A.1, 21, 26.4). Names, prices and states come from the
// resolved lines only; the stored Cart contributes references and quantities.

export type CartInput = {
  cart: { kind: "loading" } | CartSnapshot;
  resolutions: Loadable<readonly CartLineResolution[]>;
  /** The quantity changed and the resolutions are not yet re-read for the current Cart. */
  refreshing: boolean;
};

export type CartRow = {
  lineKey: string;
  kind: "ENTRY_TICKET" | "GOODS";
  kindLabel: string;
  quantity: number;
  name: string | null;
  unitPriceText: string | null;
  subtotalText: string | null;
  status: AvailabilityPresentation;
};

export type CartPageModel =
  | { kind: "loading" }
  | { kind: "corrupted" }
  | { kind: "empty" }
  | { kind: "unavailable"; rows: readonly CartRow[]; proceed: ProceedDecision }
  | { kind: "ready"; rows: readonly CartRow[]; totalText: string | null; proceed: ProceedDecision };

function unresolvedRow(line: CartLine): CartRow {
  return {
    lineKey: cartLineKey(line),
    kind: line.kind,
    kindLabel: copy.cart.kind[line.kind],
    quantity: line.quantity,
    name: null,
    unitPriceText: null,
    subtotalText: null,
    status: presentAvailability({ kind: "unavailable" }),
  };
}

function resolvedRow(line: CartLine, resolution: CartLineResolution | undefined): CartRow {
  const base = unresolvedRow(line);
  if (resolution === undefined) return base;
  switch (resolution.status) {
    case "resolved":
      return {
        ...base,
        name: resolution.name,
        unitPriceText: formatMoney(resolution.unitPrice),
        subtotalText: formatMoney(multiplyMoney(resolution.unitPrice, line.quantity)),
        status: presentAvailability(resolution.availability),
      };
    case "not_public":
      return { ...base, status: presentAvailability({ kind: "not_public" }) };
    case "unavailable":
      return base;
    default: {
      const unreachable: never = resolution;
      return unreachable;
    }
  }
}

export function buildCartPageModel(input: CartInput): CartPageModel {
  const { cart, resolutions, refreshing } = input;
  if (cart.kind === "loading") return { kind: "loading" };
  if (cart.kind === "corrupted") return { kind: "corrupted" };
  const lines = cart.cart.lines;
  // Empty only for a verified empty Cart: a failed read is never an empty Cart.
  if (lines.length === 0) return { kind: "empty" };
  if (resolutions.kind === "loading") return { kind: "loading" };
  if (resolutions.kind !== "ok") {
    return {
      kind: "unavailable",
      rows: lines.map((line) => unresolvedRow(line)),
      proceed: canProceed(lines, null),
    };
  }
  const data = resolutions.data;
  const find = (line: CartLine): CartLineResolution | undefined =>
    data.find((resolution) => resolution.lineKey === cartLineKey(line));
  const rows = lines.map((line) => resolvedRow(line, find(line)));
  const subtotals = lines.flatMap((line) => {
    const resolution = find(line);
    return resolution?.status === "resolved"
      ? [multiplyMoney(resolution.unitPrice, line.quantity)]
      : [];
  });
  // The total is claimed only when every line has a price.
  const totalText = subtotals.length === lines.length ? formatMoney(sumMoney(subtotals)) : null;
  return {
    kind: "ready",
    rows,
    totalText,
    proceed: refreshing
      ? { canProceed: false, reasons: [{ kind: "unresolved" }] }
      : canProceed(lines, data),
  };
}
