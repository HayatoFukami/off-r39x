import type { Backend } from "./mock-backend.ts";

// Test-only helper for the Sponsor Logo area (API-PUB-012, BR-EVT-005). Never imported from production code.

/**
 * Rewrites the persisted mock DB: sets `displayOrder` per sponsor ref and stores the sponsors in the given
 * ref order (refs not listed keep their relative order after the listed ones). Throws if the DB is not ready,
 * so a tie-break test can never pass against an unseeded state.
 */
export function rewriteSponsors(
  backend: Backend,
  orders: Readonly<Record<string, number>>,
  storedOrder: readonly string[],
): void {
  const loaded = backend.db.load();
  if (loaded.kind !== "ready") throw new Error("expected a ready DB");
  const rank = (ref: string): number => {
    const index = storedOrder.indexOf(ref);
    return index === -1 ? storedOrder.length : index;
  };
  const sponsors = loaded.state.sponsors
    .map((sponsor) => ({
      ...sponsor,
      displayOrder: orders[sponsor.ref] ?? sponsor.displayOrder,
    }))
    .sort((a, b) => rank(a.ref) - rank(b.ref));
  backend.db.save({ ...loaded.state, sponsors });
}
