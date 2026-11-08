import { cartLineKey } from "../../api-client/cart-line-key";
import type { CartLine, CartLineResolution } from "../../api-client/types";
import type { Loadable } from "../../presentation/components/list-state";
import { copy } from "../../presentation/copy/ja";
import { formatMoney, multiplyMoney, sumMoney } from "../../presentation/format/money";
import {
  type AvailabilityPresentation,
  presentAvailability,
  presentPurchaseReasons,
} from "../../presentation/state-mapping/availability";
import {
  type EligibilityInput,
  eligibilityTargets,
  findEligibility,
} from "../purchase/eligibility-model";
import { canProceed, type ProceedDecision } from "./can-proceed";
import type { CartSnapshot } from "./cart-store";

// View model of PG-CRT-001 (SPEC-050 9, 14A.1, 21, 26.4). Names, prices and states come from the
// resolved lines only; the stored Cart contributes references and quantities.

export type CartInput = {
  cart: { kind: "loading" } | CartSnapshot;
  resolutions: Loadable<readonly CartLineResolution[]>;
  /** The lines or the session changed and the reads are not yet repeated for the current Cart and session. */
  refreshing: boolean;
  /**
   * API-PUR-ELG-001 answer for a verified owner; not_applicable for Guest and unverified users. The
   * container passes only the part read for the current session and quantities (eligibilityForSession /
   * eligibilityForLines).
   */
  eligibility: EligibilityInput;
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

/** The state of a line that is purchasable on the public conditions, from the owner-scoped answer. */
function eligibilityStatus(
  line: CartLine,
  eligibility: Exclude<EligibilityInput, { kind: "not_applicable" }>,
): AvailabilityPresentation {
  const item = findEligibility(eligibility, cartLineKey(line));
  if (item === undefined) return presentAvailability({ kind: "unavailable" });
  return item.purchasable
    ? presentAvailability({ kind: "ON_SALE", maxSelectableQuantity: item.maxPurchasableQuantity })
    : presentPurchaseReasons(item.reasons, item.maxPurchasableQuantity);
}

export function buildCartPageModel(input: CartInput): CartPageModel {
  const { cart, resolutions, refreshing, eligibility } = input;
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
  // The first owner-scoped answer is pending: show no state it could contradict. While re-reading,
  // the rows keep their public parts and the open lines are "cannot confirm".
  if (eligibility.kind === "loading" && !refreshing) return { kind: "loading" };
  const find = (line: CartLine): CartLineResolution | undefined =>
    data.find((resolution) => resolution.lineKey === cartLineKey(line));
  const rows = lines.map((line) => {
    const resolution = find(line);
    const row = resolvedRow(line, resolution);
    // Only a line that is purchasable on the public conditions takes its state from the eligibility.
    if (
      eligibility.kind === "not_applicable" ||
      resolution === undefined ||
      eligibilityTargets([line], [resolution]).length === 0
    ) {
      return row;
    }
    return { ...row, status: eligibilityStatus(line, eligibility) };
  });
  const subtotals = lines.flatMap((line) => {
    const resolution = find(line);
    return resolution?.status === "resolved"
      ? [multiplyMoney(resolution.unitPrice, line.quantity)]
      : [];
  });
  // The total is claimed only when every line has a price.
  const totalText = subtotals.length === lines.length ? formatMoney(sumMoney(subtotals)) : null;
  const proceed: ProceedDecision = refreshing
    ? { canProceed: false, reasons: [{ kind: "unresolved" }] }
    : canProceed(lines, data, eligibility);
  if (eligibility.kind === "unavailable") return { kind: "unavailable", rows, proceed };
  return { kind: "ready", rows, totalText, proceed };
}
