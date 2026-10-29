import { cartLineKey } from "../../api-client/cart-line-key";
import type {
  CartLine,
  CartLineResolution,
  PurchaseEligibility,
  PurchaseEligibilityRead,
  SaleAvailability,
} from "../../api-client/types";
import type { SessionState } from "../../auth/use-session";
import {
  type AvailabilityPresentation,
  presentAvailability,
  presentPurchaseReasons,
} from "../../presentation/state-mapping/availability";

// Pure rules for the owner-scoped purchase eligibility (SPEC-110 API-PUR-ELG-001, SPEC-050 12.1 /
// 14A.1 / 26.2, SEC-API-029, DEV-WEB-007). No React, storage, port or mock: the container reads the
// port and keeps the answer in memory only. A failed or pending read is never "under the limit".
// An answer is used only for the session and the quantities it was read for (B4b-F-1).
// decideSaleState is shared by Entry and Goods detail (B4c).

export type EligibilityInput =
  | { kind: "not_applicable" } // Guest or unverified: public conditions only
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ok"; data: readonly PurchaseEligibility[] };

export type EligibilityMode = "wait" | "not_applicable" | "read" | "unavailable";

/** Only a verified Authenticated User reads the owner-scoped eligibility. */
export function eligibilityMode(session: SessionState): EligibilityMode {
  switch (session.status) {
    case "loading":
      return "wait";
    case "unavailable":
      return "unavailable";
    case "ready": {
      const current = session.session;
      return current.kind === "authenticated" && current.emailVerified ? "read" : "not_applicable";
    }
    default: {
      const unreachable: never = session;
      return unreachable;
    }
  }
}

/** Lines that are purchasable on the public conditions, in Cart order. The others cannot improve. */
export function eligibilityTargets(
  lines: readonly CartLine[],
  resolutions: readonly CartLineResolution[],
): CartLine[] {
  return lines.filter((line) => {
    const lineKey = cartLineKey(line);
    const resolution = resolutions.find((candidate) => candidate.lineKey === lineKey);
    if (resolution === undefined || resolution.status !== "resolved") return false;
    const availability = resolution.availability;
    if (availability.kind !== "ON_SALE") return false;
    return availability.maxSelectableQuantity === null
      ? true
      : availability.maxSelectableQuantity >= line.quantity;
  });
}

/** Anything but an ok answer is a failure (a session change re-reads it). */
export function toEligibilityInput(read: PurchaseEligibilityRead): EligibilityInput {
  return read.kind === "ok" ? { kind: "ok", data: read.data } : { kind: "unavailable" };
}

/**
 * B4b-F-1: an owner-scoped answer is used only under the session state it was read for. The
 * SessionProvider keeps the state reference while the session is unchanged (sameSessionState),
 * so a different reference is a different viewer: the previous answer is never shown for it.
 */
export function eligibilityForSession(
  stored: EligibilityInput,
  readSession: SessionState | null,
  session: SessionState,
): EligibilityInput {
  const mode = eligibilityMode(session);
  switch (mode) {
    case "wait":
      return { kind: "loading" };
    case "not_applicable":
      return { kind: "not_applicable" };
    case "unavailable":
      return { kind: "unavailable" };
    case "read":
      return readSession === session && stored.kind !== "not_applicable"
        ? stored
        : { kind: "loading" };
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}

/**
 * B4b-F-1: of an ok answer, only the items whose line is still in the Cart with the quantity it
 * was read for (API-PUR-ELG-001 answers per requested quantity). Other answers are returned as is.
 */
export function eligibilityForLines(
  input: EligibilityInput,
  readLines: readonly CartLine[],
  lines: readonly CartLine[],
): EligibilityInput {
  if (input.kind !== "ok") return input;
  const quantities = (list: readonly CartLine[]): Map<string, number> =>
    new Map(list.map((line) => [cartLineKey(line), line.quantity]));
  const read = quantities(readLines);
  const current = quantities(lines);
  return {
    kind: "ok",
    data: input.data.filter((item) => {
      const readQuantity = read.get(item.lineKey);
      return readQuantity !== undefined && readQuantity === current.get(item.lineKey);
    }),
  };
}

export function findEligibility(
  input: EligibilityInput,
  lineKey: string,
): PurchaseEligibility | undefined {
  return input.kind === "ok" ? input.data.find((item) => item.lineKey === lineKey) : undefined;
}

export type SaleDecision = {
  status: AvailabilityPresentation;
  addable: boolean;
  maxSelectableQuantity: number | null;
};

/** The state of one publicly listed item: the public one, narrowed by the owner-scoped answer when it is on sale. */
export function decideSaleState(
  availability: SaleAvailability,
  eligibility: EligibilityInput,
  targetKey: string,
): SaleDecision {
  if (availability.kind !== "ON_SALE" || eligibility.kind === "not_applicable") {
    const status = presentAvailability(availability);
    return {
      status,
      addable: status.purchasable,
      maxSelectableQuantity:
        availability.kind === "ON_SALE" ? availability.maxSelectableQuantity : null,
    };
  }
  const item = findEligibility(eligibility, targetKey);
  // A pending or failed read, or a missing entry, is never shown as on sale.
  if (item === undefined) {
    return {
      status: presentAvailability({ kind: "unavailable" }),
      addable: false,
      maxSelectableQuantity: null,
    };
  }
  if (!item.purchasable) {
    return {
      status: presentPurchaseReasons(item.reasons, item.maxPurchasableQuantity),
      addable: false,
      maxSelectableQuantity: null,
    };
  }
  return {
    status: presentAvailability({
      kind: "ON_SALE",
      maxSelectableQuantity: item.maxPurchasableQuantity,
    }),
    addable: true,
    maxSelectableQuantity: Math.min(
      availability.maxSelectableQuantity ?? Number.POSITIVE_INFINITY,
      item.maxPurchasableQuantity,
    ),
  };
}
