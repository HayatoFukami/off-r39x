import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Client } from "pg";

/** Sorted immutable SQL sources and their source-byte hashes. */
export async function migrationIdentities(start = process.cwd()) {
  let root = resolve(start);
  while (!existsSync(resolve(root, "packages/db/migrations/0001_foundation.sql"))) {
    const parent = dirname(root);
    if (parent === root) throw new Error("Immutable application migration sources missing");
    root = parent;
  }
  const dir = resolve(root, "packages/db/migrations");
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  if (!names.length) throw new Error("Immutable application migration sources missing");
  return Promise.all(
    names.map(async (name) => {
      const bytes = await readFile(resolve(dir, name));
      return {
        name,
        version: name.slice(0, -4),
        hash: createHash("sha256").update(bytes).digest("hex"),
        sql: bytes.toString("utf8"),
        bytes,
      };
    }),
  );
}
/** Release manifest identity: sorted migration filename NUL source bytes NUL. */
export async function computeMigrationSetHash(start?: string): Promise<string> {
  const digest = createHash("sha256");
  for (const migration of await migrationIdentities(start))
    digest.update(migration.name).update("\0").update(migration.bytes).update("\0");
  return digest.digest("hex");
}
export async function migrationIdentity() {
  return (await migrationIdentities())[0];
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
  const migrations = await migrationIdentities();
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
    let applied = 0;
    if (exists) {
      const rows = (
        await client.query(
          "SELECT version, source_hash FROM app.schema_migrations ORDER BY version",
        )
      ).rows;
      if (
        !rows.length ||
        rows.length > migrations.length ||
        rows.some(
          (row, i) =>
            row.version !== migrations[i]?.version || row.source_hash !== migrations[i]?.hash,
        )
      )
        throw new Error("Migration source hash mismatch");
      applied = rows.length;
    } else {
      if (
        (
          await client.query(
            "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='app') AS present",
          )
        ).rows[0].present
      )
        throw new Error("Unjournaled app schema requires review");
      const first = migrations[0];
      if (!first) throw new Error("Immutable application migration sources missing");
      await client.query(first.sql);
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
        first.version,
        first.hash,
      ]);
      applied = 1;
    }
    for (const migration of migrations.slice(applied)) {
      await client.query(migration.sql);
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
