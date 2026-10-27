import { cartLineKey } from "../../api-client/cart-line-key";
import type {
  CartLine,
  CartLineResolution,
  PurchaseEligibility,
  PurchaseEligibilityRead,
} from "../../api-client/types";
import type { SessionState } from "../../auth/use-session";

// Pure rules for the owner-scoped purchase eligibility (SPEC-110 API-PUR-ELG-001, SPEC-050 12.1 /
// 14A.1 / 26.2, SEC-API-029, DEV-WEB-007). No React, storage, port or mock: the container reads the
// port and keeps the answer in memory only. A failed or pending read is never "under the limit".

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

export function findEligibility(
  input: EligibilityInput,
  lineKey: string,
): PurchaseEligibility | undefined {
  return input.kind === "ok" ? input.data.find((item) => item.lineKey === lineKey) : undefined;
}
