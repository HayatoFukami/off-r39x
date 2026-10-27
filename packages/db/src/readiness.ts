import { isDeepStrictEqual } from "node:util";
import type { Pool } from "pg";
import type { DirectorySourceMapping } from "./directory.ts";
import { computeMigrationSetHash, migrationIdentity } from "./migrations.ts";
import { databaseLogger } from "./observability.ts";
import { catalogQuery, requiredCatalog } from "./schema-contract.ts";

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
export type DatabaseReadiness = { ready: boolean; failures: string[] };
export async function checkReadiness(
  pool: Pool,
  expected: ReadinessExpectations,
): Promise<DatabaseReadiness> {
  const failures: string[] = [];
  const fail = (name: string, valid: boolean) => {
    if (!valid) failures.push(name);
  };
  if (!expected.directoryMapping) failures.push("directory_mapping_unconfirmed");
  const client = await pool.connect().catch(() => undefined);
  if (!client) {
    databaseLogger(pool)?.log({
      event_name: "db.availability.failed",
      level: "ERROR",
      result: "FAILED",
      is_retry: false,
      failure_class: "TEMPORARY_FAILURE",
      query_name: "readiness.catalog",
    });
    return { ready: false, failures: [...failures, "database_unavailable"] };
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
    const catalog = (await client.query(catalogQuery)).rows[0].catalog;
    fail("release_schema_contract", isDeepStrictEqual(catalog, requiredCatalog));
    const migration = await migrationIdentity();
    if (!expected.migrationSetHash) failures.push("release_migration_hash_missing");
    else
      fail(
        "release_migration_hash",
        expected.migrationSetHash === (await computeMigrationSetHash()),
      );
    const journal = (
      await client.query("SELECT version, source_hash FROM app.schema_migrations ORDER BY version")
    ).rows;
    fail(
      "migration_hash",
      journal.length === 1 &&
        journal[0].version === migration.version &&
        journal[0].source_hash === migration.hash,
    );
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
        "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='auth_read' AND table_name='identity_directory' ORDER BY ordinal_position",
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
        has_table_privilege($1,'auth_read.identity_directory','SELECT') AS directory_read,
        has_table_privilege($1,'auth_read.identity_directory','INSERT,UPDATE,DELETE') AS directory_write`,
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
  return { ready: failures.length === 0, failures };
}
