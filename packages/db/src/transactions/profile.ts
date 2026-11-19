// SPEC-100 §55: business transaction module for the caller's own Business Profile
// (API-AUTH-002 read, API-AUTH-004 update). One use case per function, database work only.
// The target row is always resolved from the verified Auth Subject in the same statement's WHERE
// (AR-OWN-006, DB-ID-002); there is no INSERT path (Profile provisioning is API-AUTH-003).
import { DrizzleQueryError, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { isDatabaseTemporaryFailure, typeDirectQueryFailure } from "../errors.ts";
import { businessProfiles } from "../schema/identity.ts";
import { transaction } from "../transaction.ts";

export type CurrentBusinessProfile = {
  publicRef: string;
  displayName: string | null;
  /** `YYYY-MM-DDTHH:mm:ss.sssZ` (SPEC-110 §10). */
  updatedAt: string;
};
export type CurrentProfileRead =
  | { status: "found"; profile: CurrentBusinessProfile }
  | { status: "not_found" }
  | { status: "unavailable" };
export type CurrentProfileUpdate =
  | { status: "updated"; profile: CurrentBusinessProfile }
  | { status: "not_found" }
  | { status: "commit_unknown" }
  | { status: "unavailable" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The three columns both statements return; their types come from the table declaration (DEV-DB-004).
const profileColumns = {
  publicRef: businessProfiles.publicRef,
  displayName: businessProfiles.displayName,
  updatedAt: businessProfiles.updatedAt,
};
type Row = { publicRef: string; displayName: string | null; updatedAt: Date };
const toProfile = (row: Row): CurrentBusinessProfile => ({
  publicRef: row.publicRef,
  displayName: row.displayName,
  updatedAt: row.updatedAt.toISOString(),
});
function requireSubject(authSubject: string): void {
  if (!UUID.test(authSubject)) throw new Error("Verified UUID subject required");
}
// drizzle-orm wraps driver errors in DrizzleQueryError (SQL text and bound values in its message,
// SQLSTATE on `cause`). Classify and rethrow the driver's own error, as insertAuditEvent does.
function driverError(error: unknown): unknown {
  return error instanceof DrizzleQueryError && error.cause !== undefined ? error.cause : error;
}

export function createCurrentProfileRepository(pool: Pool) {
  const db = drizzle(pool);
  return {
    async readCurrentBusinessProfile(authSubject: string): Promise<CurrentProfileRead> {
      requireSubject(authSubject);
      let rows: Row[];
      try {
        rows = await db
          .select(profileColumns)
          .from(businessProfiles)
          .where(eq(businessProfiles.authSubject, authSubject));
      } catch (caught) {
        const error = driverError(caught);
        // SPEC-110 §50/§51: the same classification as the HTTP boundary (errorFromException), so a
        // failure is answered the same way here and on the update path. The read is one statement on
        // the pool, so a rejection without a SQLSTATE (EAI_AGAIN, a pool acquisition timeout, a dropped
        // connection) is typed as unavailable first, as transaction() does.
        if (isDatabaseTemporaryFailure(typeDirectQueryFailure(error)))
          return { status: "unavailable" };
        throw error;
      }
      if (rows.length === 0) return { status: "not_found" };
      if (rows.length > 1) throw new Error("Business Profile cardinality violation");
      return { status: "found", profile: toProfile(rows[0] as Row) };
    },
    async updateCurrentBusinessProfile(
      authSubject: string,
      displayName: string | null,
    ): Promise<CurrentProfileUpdate> {
      requireSubject(authSubject);
      try {
        const result = await transaction(
          pool,
          async (client) => {
            try {
              // DB-TIM-003: updated_at is set in the same statement. SET touches display_name and
              // updated_at only; the row is the caller's own (WHERE auth_subject).
              return await drizzle(client)
                .update(businessProfiles)
                .set({ displayName, updatedAt: sql`transaction_timestamp()` })
                .where(eq(businessProfiles.authSubject, authSubject))
                .returning(profileColumns);
            } catch (error) {
              // transaction() needs the driver's error for retry, unavailability and constraints.
              throw driverError(error);
            }
          },
          { queryName: "profile.update_current" },
        );
        if (result.status === "commit_unknown") return { status: "commit_unknown" };
        const rows = result.value;
        if (rows.length === 0) return { status: "not_found" };
        if (rows.length > 1) throw new Error("Business Profile cardinality violation");
        return { status: "updated", profile: toProfile(rows[0] as Row) };
      } catch (error) {
        // transaction() has already typed a database-originated failure without a SQLSTATE.
        if (isDatabaseTemporaryFailure(error)) return { status: "unavailable" };
        throw error;
      }
    },
  };
}
