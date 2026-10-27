import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Client } from "pg";

/** Release manifest identity: sorted migration filename NUL source bytes NUL. */
export async function computeMigrationSetHash(): Promise<string> {
  const migration = await migrationIdentity();
  return createHash("sha256")
    .update("0001_foundation.sql\0")
    .update(migration.sql)
    .update("\0")
    .digest("hex");
}

export async function migrationIdentity() {
  // Repository/OCI workdir is the immutable application root. Bundling must not
  // relocate migration identity relative to the generated server entrypoint.
  let root = process.cwd();
  while (!existsSync(resolve(root, "packages/db/migrations/0001_foundation.sql"))) {
    const parent = dirname(root);
    if (parent === root) throw new Error("Immutable application migration sources missing");
    root = parent;
  }
  const sql = await readFile(resolve(root, "packages/db/migrations/0001_foundation.sql"), "utf8");
  return { version: "0001_foundation", hash: createHash("sha256").update(sql).digest("hex"), sql };
}
/** Deployment bootstrap only. Does not create passwords or mutate provider schemas. */
export async function installBaselineRoles(client: Client): Promise<void> {
  for (const [role, login] of [
    ["app_migrator", true],
    ["app_runtime", false],
    ["auth_directory_owner", false],
    ["app_api_runtime", true],
    ["app_email_runtime", true],
    ["app_reconciliation_runtime", true],
  ] as const) {
    const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]);
    if (!exists.rowCount)
      await client.query(
        `CREATE ROLE ${role} ${login ? "LOGIN" : "NOLOGIN"} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
  }
  await client.query(
    "GRANT app_runtime TO app_api_runtime, app_email_runtime, app_reconciliation_runtime",
  );
}
/** Caller supplies a dedicated app_migrator connection, never a runtime pool. */
export async function runMigrations(client: Client): Promise<void> {
  const role = (await client.query("SELECT current_user AS role")).rows[0].role;
  if (role !== "app_migrator") throw new Error("Dedicated app_migrator connection required");
  const migration = await migrationIdentity();
  let held = false;
  try {
    await client.query(
      "SET lock_timeout = '60s'; SET statement_timeout = '60s'; SET timezone = 'UTC'",
    );
    await client.query("SELECT pg_advisory_lock(hashtext('r39x:schema-migration'))");
    held = true;
    await client.query("BEGIN");
    const exists = (await client.query("SELECT to_regclass('app.schema_migrations') AS relation"))
      .rows[0].relation;
    if (exists) {
      const rows = (
        await client.query(
          "SELECT version, source_hash FROM app.schema_migrations ORDER BY version",
        )
      ).rows;
      if (
        rows.length !== 1 ||
        rows[0].version !== migration.version ||
        rows[0].source_hash !== migration.hash
      )
        throw new Error("Migration source hash mismatch");
    } else {
      if (
        (
          await client.query(
            "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='app') AS present",
          )
        ).rows[0].present
      )
        throw new Error("Unjournaled app schema requires review");
      await client.query(migration.sql);
      await client.query(`CREATE TABLE app.schema_migrations (
        version text CONSTRAINT pk_schema_migrations PRIMARY KEY,
        source_hash text NOT NULL CONSTRAINT ck_schema_migrations_hash CHECK (source_hash ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT transaction_timestamp())`);
      await client.query(
        "REVOKE ALL ON app.schema_migrations FROM PUBLIC, app_runtime, app_api_runtime, app_email_runtime, app_reconciliation_runtime",
      );
      await client.query(
        "GRANT SELECT ON app.schema_migrations TO app_api_runtime, app_email_runtime, app_reconciliation_runtime",
      );
      await client.query("INSERT INTO app.schema_migrations(version,source_hash) VALUES ($1,$2)", [
        migration.version,
        migration.hash,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (held) await client.query("SELECT pg_advisory_unlock(hashtext('r39x:schema-migration'))");
  }
}
