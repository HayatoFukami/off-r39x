// SPEC-100 §55: business transaction module for the caller's own Business Profile
// (API-AUTH-002 read, API-AUTH-004 update, API-AUTH-003 provision). One use case per function,
// database work only. The target row is always resolved from the verified Auth Subject
// (AR-OWN-006, DB-ID-002); the only INSERT path is provisioning, which writes auth_subject alone.
import { isDatabaseRetryable } from "@off-r39x/reliability";
import type { Pool } from "pg";
import { sqlState, TransactionDeadlineError, transaction } from "../transaction.ts";

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
const NETWORK_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);
// node-postgres raises these without a `code` (pool connect timeout, dropped connection).
const POOL_CONNECTION_MESSAGE =
  /^(timeout exceeded when trying to connect|Connection terminated|Client has encountered a connection error|Cannot use a pool after calling end)/;

/**
 * SPEC-110 §50: only availability failures are temporary. Constraint (`23xxx`), data (`22xxx`) and
 * syntax/privilege (`42xxx`) errors are implementation defects and must surface as errors.
 */
function isUnavailable(error: unknown): boolean {
  if (error instanceof TransactionDeadlineError || isDatabaseRetryable(error)) return true;
  const code = sqlState(error);
  if (code) {
    return (
      /^(08|53|57|58)/.test(code) || // 57014 (statement timeout) is in class 57
      NETWORK_CODES.has(code)
    );
  }
  return error instanceof Error && POOL_CONNECTION_MESSAGE.test(error.message);
}

type Row = { public_ref: string; display_name: string | null; updated_at: Date };
const toProfile = (row: Row): CurrentBusinessProfile => ({
  publicRef: row.public_ref,
  displayName: row.display_name,
  updatedAt: row.updated_at.toISOString(),
});
function requireSubject(authSubject: string): void {
  if (!UUID.test(authSubject)) throw new Error("Verified UUID subject required");
}

export function createCurrentProfileRepository(pool: Pool) {
  return {
    async readCurrentBusinessProfile(authSubject: string): Promise<CurrentProfileRead> {
      requireSubject(authSubject);
      let rows: Row[];
      try {
        rows = (
          await pool.query<Row>(
            `SELECT public_ref::text AS public_ref, display_name, updated_at
             FROM app.business_profiles WHERE auth_subject = $1::uuid`,
            [authSubject],
          )
        ).rows;
      } catch (error) {
        if (isUnavailable(error)) return { status: "unavailable" };
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
          (client) =>
            // DB-TIM-003: updated_at is set in the same statement. SET touches display_name and
            // updated_at only; the row is the caller's own (WHERE auth_subject).
            client.query<Row>(
              `UPDATE app.business_profiles
               SET display_name = $2, updated_at = transaction_timestamp()
               WHERE auth_subject = $1::uuid
               RETURNING public_ref::text AS public_ref, display_name, updated_at`,
              [authSubject, displayName],
            ),
          { queryName: "profile.update_current" },
        );
        if (result.status === "commit_unknown") return { status: "commit_unknown" };
        const rows = result.value.rows;
        if (rows.length === 0) return { status: "not_found" };
        if (rows.length > 1) throw new Error("Business Profile cardinality violation");
        return { status: "updated", profile: toProfile(rows[0] as Row) };
      } catch (error) {
        if (isUnavailable(error)) return { status: "unavailable" };
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
            const inserted = await client.query<Row>(
              `INSERT INTO app.business_profiles (auth_subject) VALUES ($1::uuid)
               ON CONFLICT (auth_subject) DO NOTHING
               RETURNING public_ref::text AS public_ref, display_name, updated_at`,
              [authSubject],
            );
            if (inserted.rows.length === 1) return { created: true, row: inserted.rows[0] as Row };
            const existing = await client.query<Row>(
              `SELECT public_ref::text AS public_ref, display_name, updated_at
               FROM app.business_profiles WHERE auth_subject = $1::uuid`,
              [authSubject],
            );
            // REL-AUTH-005: never re-create on a missing row; surface the inconsistency.
            if (existing.rows.length !== 1) {
              throw new Error("Business Profile reselect cardinality violation");
            }
            return { created: false, row: existing.rows[0] as Row };
          },
          { queryName: "profile.provision_current" },
        );
        if (result.status === "commit_unknown") return { status: "commit_unknown" };
        const { created, row } = result.value;
        return { status: created ? "created" : "existing", profile: toProfile(row) };
      } catch (error) {
        if (isUnavailable(error)) return { status: "unavailable" };
        throw error;
      }
    },
  };
}
