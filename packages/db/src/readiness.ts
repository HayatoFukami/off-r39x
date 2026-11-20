import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { RETRY_POLICIES, retryDelay } from "@off-r39x/reliability";
import type { Pool, PoolClient } from "pg";
import type { DirectorySourceMapping } from "./directory.ts";
import { sqlState } from "./errors.ts";
import { computeMigrationSetHash, migrationIdentities } from "./migrations.ts";
import { databaseLogger, logDatabase } from "./observability.ts";
import { catalogQuery, requiredCatalog } from "./schema-contract.ts";

type JournalRow = { version: string; source_hash: string };

/**
 * Compares the bundled migration set with the journal (both in byte order). Every bundled
 * migration must sit at the same position of the journal with the same version and hash.
 */
export function compareJournal(
  journal: readonly JournalRow[],
  migrations: readonly { version: string; hash: string }[],
): "behind" | "mismatch" | "same" | "ahead" {
  for (let index = 0; index < migrations.length; index++) {
    if (index >= journal.length) return "behind";
    const row = journal[index];
    if (row?.version !== migrations[index]?.version || row?.source_hash !== migrations[index]?.hash)
      return "mismatch";
  }
  return journal.length === migrations.length ? "same" : "ahead";
}

const NOT_VALID_SUFFIX = " NOT VALID";
// A required NOT VALID constraint that has since been validated differs only in the validation
// state (convalidated) and the NOT VALID suffix of pg_get_constraintdef.
function validatedAfterNotValid(required: unknown[], live: unknown[]): boolean {
  const definition = required[3];
  return (
    required[4] === false &&
    live[4] === true &&
    typeof definition === "string" &&
    definition.endsWith(NOT_VALID_SUFFIX) &&
    definition.slice(0, -NOT_VALID_SUFFIX.length) === live[3] &&
    [0, 1, 2, 5, 6].every((position) => isDeepStrictEqual(required[position], live[position]))
  );
}

function isTuples(value: unknown): value is unknown[][] {
  return Array.isArray(value) && value.every(Array.isArray);
}

/**
 * "exact": the live catalog equals the required one. "contains": every required tuple exists in
 * the live catalog (additional objects are allowed), except that a NOT NULL column without a
 * default added to a required table is rejected, because an older artifact cannot write to it.
 */
export function catalogSatisfies(
  live: unknown,
  required: Record<string, unknown[]>,
  mode: "exact" | "contains",
): boolean {
  if (mode === "exact") return isDeepStrictEqual(live, required);
  if (typeof live !== "object" || live === null || Array.isArray(live)) return false;
  const liveCatalog = live as Record<string, unknown>;
  for (const [key, requiredTuples] of Object.entries(required)) {
    if (!(key in liveCatalog)) return false;
    const liveTuples = liveCatalog[key] ?? [];
    if (!isTuples(liveTuples) || !isTuples(requiredTuples)) return false;
    for (const tuple of requiredTuples) {
      const found = liveTuples.some(
        (candidate) =>
          isDeepStrictEqual(candidate, tuple) ||
          (key === "constraints" && validatedAfterNotValid(tuple, candidate)),
      );
      if (!found) return false;
    }
  }
  const liveColumns = liveCatalog.columns ?? [];
  const liveTables = liveCatalog.tables ?? [];
  if (!isTuples(liveColumns) || !isTuples(liveTables)) return false;
  const requiredColumns = required.columns as unknown[][];
  const requiredTables = new Set((required.tables as unknown[][]).map((table) => table[0]));
  return !liveColumns.some(
    ([relname, attname, , notNull, identity, generated, defaultExpr]) =>
      requiredTables.has(relname) &&
      !requiredColumns.some((column) => column[0] === relname && column[1] === attname) &&
      notNull === true &&
      identity === "" &&
      generated === "" &&
      defaultExpr === null,
  );
}

const JOURNAL_QUERY =
  'SELECT version, source_hash FROM app.schema_migrations ORDER BY version COLLATE "C"';

/**
 * Reads journal, catalog, journal as three separate statements outside an explicit transaction
 * (a transaction would not help: pg_get_* functions read the latest catalog, and REPEATABLE READ
 * would only make both journal reads the same snapshot). runMigrations COMMITs the DDL and the
 * journal row in one transaction, so reading the journal first and last detects a COMMIT in
 * between. Two equal journals are consistent. A differing journal or a 55P03 is retried within
 * the SPEC-150 section 11 55P03 budget shared by all causes.
 */
export async function readSchemaState(
  client: Pick<PoolClient, "query">,
): Promise<
  { status: "consistent"; journal: JournalRow[]; catalog: unknown } | { status: "exhausted" }
> {
  const policy = RETRY_POLICIES["55P03"];
  const start = performance.now();
  for (let attempt = 1; ; attempt++) {
    let consistent: { journal: JournalRow[]; catalog: unknown } | undefined;
    try {
      const before = (await client.query(JOURNAL_QUERY)).rows as JournalRow[];
      const catalog = (await client.query(catalogQuery)).rows[0].catalog;
      const after = (await client.query(JOURNAL_QUERY)).rows as JournalRow[];
      if (isDeepStrictEqual(before, after)) consistent = { journal: before, catalog };
    } catch (error) {
      if (sqlState(error) !== "55P03") throw error;
    }
    if (consistent) {
      if (attempt > 1 && performance.now() > start + policy.maxElapsedMs)
        return { status: "exhausted" };
      return { status: "consistent", ...consistent };
    }
    if (attempt >= policy.maxAttempts) return { status: "exhausted" };
    const delay = retryDelay(policy, attempt);
    if (performance.now() + delay >= start + policy.maxElapsedMs) return { status: "exhausted" };
    await sleep(delay);
  }
}

export type ReadinessExpectations = {
  environment: string;
  expectedEnvironmentMarker?: string;
  /** Deployment-managed DB setting, e.g. r39x.environment, never an invented metadata table. */
  environmentMarkerSetting: string;
  directoryMapping?: DirectorySourceMapping;
  metadata?: readonly { setting: string; expected: string }[];
  connectionBudget?: number;
  /** Required for readiness; absent build/release identity fails closed. */
  migrationSetHash?: string;
};
export type ReadinessFailure =
  | "connection_budget"
  | "database_contract_unverified"
  | "database_unavailable"
  | "deployment_marker_invalid"
  | "deployment_marker_mismatch"
  | "directory_columns"
  | "directory_mapping_unconfirmed"
  | "directory_owner_source_grants"
  | "directory_projection"
  | "directory_public_grants"
  | "directory_source_integrity"
  | "directory_source_mapping"
  | "directory_view"
  | "extensions"
  | "migration_hash"
  | "postgres_major"
  | "release_migration_hash"
  | "release_migration_hash_missing"
  | "release_schema_contract"
  | "runtime_privileges"
  | "runtime_roles"
  | "timezone";
export type DatabaseReadiness = { ready: boolean; failures: ReadinessFailure[] };
export async function checkReadiness(
  pool: Pool,
  expected: ReadinessExpectations,
): Promise<DatabaseReadiness> {
  const failures: ReadinessFailure[] = [];
  const fail = (name: ReadinessFailure, valid: boolean) => {
    if (!valid) failures.push(name);
  };
  const result = (): DatabaseReadiness => {
    for (const name of new Set(failures)) {
      logDatabase(databaseLogger(pool), {
        event_name:
          name === "database_unavailable"
            ? "db.availability.failed"
            : "security.fail_closed.triggered",
        level: "ERROR",
        result: "FAILED",
        is_retry: false,
        failure_class: name === "database_unavailable" ? "TEMPORARY_FAILURE" : "SECURITY_FAILURE",
        query_name: `readiness.${name}`,
      });
    }
    return { ready: failures.length === 0, failures };
  };
  if (!expected.directoryMapping) failures.push("directory_mapping_unconfirmed");
  const client = await pool.connect().catch(() => undefined);
  if (!client) {
    failures.push("database_unavailable");
    return result();
  }
  try {
    const settings = (
      await client.query(
        "SELECT current_setting('server_version_num')::int AS version, current_setting('TimeZone') AS timezone, current_setting('max_connections')::int AS max_connections",
      )
    ).rows[0];
    fail("postgres_major", Math.floor(settings.version / 10000) === 17);
    fail("timezone", settings.timezone === "UTC");
    fail("connection_budget", (expected.connectionBudget ?? 40) <= settings.max_connections * 0.4);
    for (const marker of [
      {
        setting: expected.environmentMarkerSetting,
        expected: expected.expectedEnvironmentMarker ?? expected.environment,
      },
      ...(expected.metadata ?? []),
    ]) {
      if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(marker.setting) || !marker.expected) {
        failures.push("deployment_marker_invalid");
        continue;
      }
      const value = (
        await client.query("SELECT current_setting($1,true) AS value", [marker.setting])
      ).rows[0].value;
      fail("deployment_marker_mismatch", value === marker.expected);
    }
    const extensions = (
      await client.query(
        "SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto','btree_gist')",
      )
    ).rows;
    fail("extensions", extensions.length === 2);
    const schemaState = await readSchemaState(client);
    const migrations = await migrationIdentities();
    if (!expected.migrationSetHash) failures.push("release_migration_hash_missing");
    else
      fail(
        "release_migration_hash",
        expected.migrationSetHash === (await computeMigrationSetHash()),
      );
    if (schemaState.status === "exhausted") {
      // The journal could not be judged, so only the schema contract failure is recorded.
      failures.push("release_schema_contract");
    } else {
      const state = compareJournal(schemaState.journal, migrations);
      fail(
        "release_schema_contract",
        catalogSatisfies(
          schemaState.catalog,
          requiredCatalog,
          state === "ahead" ? "contains" : "exact",
        ),
      );
      fail("migration_hash", state === "same" || state === "ahead");
    }
    const directory = (
      await client.query(
        `SELECT c.relkind, c.reloptions, r.rolname, r.rolcanlogin FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='auth_read' AND c.relname='identity_directory'`,
      )
    ).rows[0];
    fail(
      "directory_view",
      directory?.relkind === "v" &&
        directory.reloptions?.includes("security_barrier=true") &&
        directory.rolname === "auth_directory_owner" &&
        directory.rolcanlogin === false,
    );
    const types = (
      await client.query(
        "SELECT a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS data_type FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth_read' AND c.relname='identity_directory' AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",
      )
    ).rows;
    fail(
      "directory_columns",
      JSON.stringify(types) ===
        JSON.stringify([
          { column_name: "auth_subject", data_type: "uuid" },
          { column_name: "email", data_type: "text" },
          { column_name: "email_verified", data_type: "boolean" },
        ]),
    );
    if (expected.directoryMapping) {
      const mapping = expected.directoryMapping;
      fail(
        "directory_mapping_unconfirmed",
        mapping.deploymentConfirmed === true && !!mapping.providerSchemaVersion,
      );
      const dependencies = (
        await client.query(`SELECT DISTINCT n.nspname, c.relname, a.attname, format_type(a.atttypid,a.atttypmod) AS type
        FROM pg_rewrite rw JOIN pg_class v ON v.oid=rw.ev_class JOIN pg_namespace vn ON vn.oid=v.relnamespace
        JOIN pg_depend d ON d.classid='pg_rewrite'::regclass AND d.objid=rw.oid AND d.refclassid='pg_class'::regclass
        JOIN pg_class c ON c.oid=d.refobjid JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=d.refobjsubid
        WHERE vn.nspname='auth_read' AND v.relname='identity_directory' AND c.oid<>v.oid`)
      ).rows;
      const expectedColumns = [mapping.subjectColumn, mapping.emailColumn, mapping.verifiedColumn];
      fail(
        "directory_source_mapping",
        dependencies.length === 3 &&
          dependencies.every(
            (row) =>
              row.nspname === mapping.schema &&
              row.relname === mapping.table &&
              expectedColumns.includes(row.attname),
          ),
      );
      const sourceIntegrity = (
        await client.query(
          `SELECT
        EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=i.indkey[0]
          WHERE n.nspname=$1 AND c.relname=$2 AND a.attname=$3 AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate AND i.indnkeyatts=1 AND i.indpred IS NULL AND i.indexprs IS NULL) AS unique_subject,
        (SELECT count(*)=2 AND bool_and(a.attnotnull) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND a.attname IN ($3,$4) AND NOT a.attisdropped) AS nonnull_values`,
          [mapping.schema, mapping.table, mapping.subjectColumn, mapping.verifiedColumn],
        )
      ).rows[0];
      fail(
        "directory_source_integrity",
        sourceIntegrity.unique_subject && sourceIntegrity.nonnull_values,
      );
      const projection = (
        await client.query(
          "SELECT pg_get_viewdef(c.oid,true) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth_read' AND c.relname='identity_directory'",
        )
      ).rows[0].definition as string;
      // Accept only a direct projection, never a filtered join, stale literal or
      // transformed verified flag that happens to retain the same dependencies.
      const quoted = (
        await client.query(
          "SELECT quote_ident($1) AS schema_name, quote_ident($2) AS table_name, quote_ident($3) AS subject_name, quote_ident($4) AS email_name, quote_ident($5) AS verified_name",
          [
            mapping.schema,
            mapping.table,
            mapping.subjectColumn,
            mapping.emailColumn,
            mapping.verifiedColumn,
          ],
        )
      ).rows[0];
      const projectionColumn = (source: string, quotedSource: string, target: string) =>
        `${quotedSource}${source === target ? "" : ` AS ${target}`}`;
      const expectedProjection = `SELECT ${projectionColumn(mapping.subjectColumn, quoted.subject_name, "auth_subject")}, ${projectionColumn(mapping.emailColumn, quoted.email_name, "email")}, ${projectionColumn(mapping.verifiedColumn, quoted.verified_name, "email_verified")} FROM ${quoted.schema_name}.${quoted.table_name};`;
      fail("directory_projection", projection.replace(/\s+/g, " ").trim() === expectedProjection);
      const sourceColumns = (
        await client.query(
          `SELECT a.attname, has_column_privilege('auth_directory_owner',c.oid,a.attnum,'SELECT') AS allowed
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
        WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped`,
          [mapping.schema, mapping.table],
        )
      ).rows;
      fail(
        "directory_owner_source_grants",
        sourceColumns.length >= 3 &&
          sourceColumns.every((row) => row.allowed === expectedColumns.includes(row.attname)),
      );
    }
    const roles = (
      await client.query(
        "SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname IN ('app_runtime','app_api_runtime','app_email_runtime','app_reconciliation_runtime')",
      )
    ).rows;
    fail(
      "runtime_roles",
      roles.length === 4 &&
        roles.every(
          (r) =>
            !r.rolsuper &&
            !r.rolcreaterole &&
            !r.rolcreatedb &&
            !r.rolreplication &&
            !r.rolbypassrls,
        ),
    );
    for (const role of ["app_api_runtime", "app_email_runtime", "app_reconciliation_runtime"]) {
      const permissions = (
        await client.query(
          `SELECT
        has_schema_privilege($1,'app','CREATE') AS ddl,
        EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind IN ('r','p') AND has_table_privilege($1,c.oid,'DELETE')) AS deletes,
        EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN ('app','auth_read','neon_auth') AND pg_has_role($1,nspowner,'MEMBER')) AS owns_schema,
        EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='neon_auth' AND c.relkind IN ('r','p','v','m') AND (has_table_privilege($1,c.oid,'SELECT') OR has_any_column_privilege($1,c.oid,'SELECT'))) AS provider_reads,
        has_table_privilege($1,(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth_read' AND c.relname='identity_directory'),'SELECT') AS directory_read,
        has_table_privilege($1,(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth_read' AND c.relname='identity_directory'),'INSERT,UPDATE,DELETE') AS directory_write`,
          [role],
        )
      ).rows[0];
      fail(
        "runtime_privileges",
        !permissions.ddl &&
          !permissions.deletes &&
          !permissions.owns_schema &&
          !permissions.provider_reads &&
          !permissions.directory_write &&
          permissions.directory_read === (role !== "app_reconciliation_runtime"),
      );
    }
    const publicGrant = (
      await client.query(
        `SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='auth_read' AND c.relname='identity_directory' AND acl.grantee=0) AS allowed`,
      )
    ).rows[0];
    fail("directory_public_grants", !publicGrant.allowed);
  } catch {
    failures.push("database_contract_unverified");
  } finally {
    client.release();
  }
  return result();
}
