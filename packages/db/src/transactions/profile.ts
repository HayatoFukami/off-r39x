// SPEC-100 §55: business transaction module for the caller's own Business Profile
// (API-AUTH-002 read, API-AUTH-004 update, API-AUTH-003 provision). One use case per function,
// database work only. The target row is always resolved from the verified Auth Subject
// (AR-OWN-006, DB-ID-002); the only INSERT path is provisioning, which writes auth_subject alone.
import { DrizzleQueryError, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { type Pool, types } from "pg";
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

export type CurrentProfileProvision =
  | { status: "created"; profile: CurrentBusinessProfile }
  | { status: "existing"; profile: CurrentBusinessProfile }
  | { status: "commit_unknown" }
  | { status: "unavailable" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// node-postgres's own timestamptz parser (pg-types / postgres-date). drizzle maps a timestamptz
// column with `new Date(text)`, which reads a year below 0100 as 19xx / 20xx; this parser keeps the
// year, the offset and the BC era of the text PostgreSQL sends.
const parseTimestamptz = types.getTypeParser(types.builtins.TIMESTAMPTZ) as (text: string) => Date;
// The three columns both statements return; their types come from the table declaration (DEV-DB-004).
// updated_at is the same column, decoded with node-postgres's parser instead of drizzle's.
const profileColumns = {
  publicRef: businessProfiles.publicRef,
  displayName: businessProfiles.displayName,
  updatedAt: sql<Date>`${businessProfiles.updatedAt}`.mapWith(parseTimestamptz),
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
        // SPEC-110 §50/§51: the same classification as the HTTP boundary (errorFromException), so a
        // failure is answered the same way here and on the update path. Only the driver's rejection
        // (the cause drizzle wraps in DrizzleQueryError) came from the database: the read is one
        // statement on the pool, so such a rejection without a SQLSTATE (EAI_AGAIN, a pool
        // acquisition timeout, a dropped connection) is typed as unavailable first, as transaction()
        // does. An error drizzle throws itself, such as while mapping rows the database answered, is
        // not typed and so is not a temporary failure.
        const fromDriver = caught instanceof DrizzleQueryError && caught.cause !== undefined;
        const error = fromDriver ? caught.cause : caught;
        if (isDatabaseTemporaryFailure(fromDriver ? typeDirectQueryFailure(error) : error))
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
    async provisionCurrentBusinessProfile(authSubject: string): Promise<CurrentProfileProvision> {
      requireSubject(authSubject);
      try {
        // DB-AUTH-001 / AR-ID-004: INSERT ... ON CONFLICT (auth_subject) DO NOTHING, then reselect by
        // the same subject. Only auth_subject is written; public_ref and timestamps are DB defaults
        // and display_name stays NULL (SPEC-030 §9.2). READ COMMITTED lets the reselect see the row
        // committed by the writer that ON CONFLICT waited for.
        const result = await transaction(
          pool,
          async (client) => {
            try {
              const tx = drizzle(client);
              const inserted = await tx
                .insert(businessProfiles)
                .values({ authSubject })
                .onConflictDoNothing({ target: businessProfiles.authSubject })
                .returning(profileColumns);
              if (inserted.length === 1) return { created: true, row: inserted[0] as Row };
              const existing = await tx
                .select(profileColumns)
                .from(businessProfiles)
                .where(eq(businessProfiles.authSubject, authSubject));
              // REL-AUTH-005: never re-create on a missing row; surface the inconsistency.
              if (existing.length !== 1) {
                throw new Error("Business Profile reselect cardinality violation");
              }
              return { created: false, row: existing[0] as Row };
            } catch (error) {
              // transaction() needs the driver's error for retry, unavailability and constraints.
              throw driverError(error);
            }
          },
          { queryName: "profile.provision_current" },
        );
        if (result.status === "commit_unknown") return { status: "commit_unknown" };
        const { created, row } = result.value;
        return { status: created ? "created" : "existing", profile: toProfile(row) };
      } catch (error) {
        // transaction() has already typed a database-originated failure without a SQLSTATE.
        if (isDatabaseTemporaryFailure(error)) return { status: "unavailable" };
        throw error;
      }
    },
  };
}
