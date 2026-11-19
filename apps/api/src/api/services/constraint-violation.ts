import { classifyDatabaseError } from "@off-r39x/db";
import type { ServiceResult } from "./result.ts";

/**
 * Known constraint names (SPEC-100 explicit naming, DB-ARC-007) and how to settle each one.
 * `resolve` re-reads the current state in a new transaction and returns the converged result.
 */
export type ConstraintTable<T> = Readonly<
  Record<
    string,
    {
      readonly sqlstate: "23505" | "23P01" | "23503" | "23514";
      readonly resolve: () => Promise<ServiceResult<T>>;
    }
  >
>;

/**
 * A known constraint loser is settled by re-reading current state, never by re-running the original
 * operation (SPEC-110 section 21, REL-DB-002, DEV-API-010). An unknown constraint, a missing name, a
 * SQLSTATE that differs from the table, and every non-constraint error are rethrown untouched so the
 * HTTP layer answers INTERNAL_ERROR or 503. A `resolve` failure propagates as it is.
 */
export async function resolveConstraintViolation<T>(
  error: unknown,
  table: ConstraintTable<T>,
): Promise<ServiceResult<T>> {
  const classified = classifyDatabaseError(error);
  if (classified.kind === "constraint" && classified.constraint !== undefined) {
    const known = Object.hasOwn(table, classified.constraint)
      ? table[classified.constraint]
      : undefined;
    if (known && known.sqlstate === classified.sqlstate) return known.resolve();
  }
  throw error;
}
