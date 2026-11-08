import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client, Pool } from "pg";
import { expect, it } from "vitest";
import { computeMigrationSetHash, runMigrations } from "../../packages/db/src/migrations.ts";
import { checkReadiness } from "../../packages/db/src/readiness.ts";

it("TC-DB-FOUNDATION-001 applies ordered migrations once and rejects altered, missing or unknown history", async () => {
  const original = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "r39x-migrations-"));
  const dir = join(root, "packages/db/migrations");
  await mkdir(dir, { recursive: true });
  await copyFile(
    resolve(original, "../packages/db/migrations/0001_foundation.sql"),
    join(dir, "0001_foundation.sql"),
  );
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const database = (await client.query("SELECT current_database() AS name")).rows[0]
      .name as string;
    await client.query(`GRANT CREATE ON DATABASE "${database}" TO app_migrator`);
    await client.query("SET ROLE app_migrator");
    process.chdir(root);
    await runMigrations(client);
    await copyFile(
      resolve(original, "fixtures/migrations/0002_synthetic.sql"),
      join(dir, "0002_synthetic.sql"),
    );
    const files = ["0001_foundation.sql", "0002_synthetic.sql"];
    const hash = createHash("sha256");
    for (const name of files)
      hash
        .update(name)
        .update("\0")
        .update(await readFile(join(dir, name)))
        .update("\0");
    expect(await computeMigrationSetHash()).toBe(hash.digest("hex"));
    await runMigrations(client);
    await runMigrations(client);
    expect(
      (await client.query("SELECT version FROM app.schema_migrations ORDER BY version")).rows.map(
        (row) => row.version,
      ),
    ).toEqual(["0001_foundation", "0002_synthetic"]);
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    try {
      const expected = {
        environment: "test",
        environmentMarkerSetting: "r39x.environment",
        migrationSetHash: await computeMigrationSetHash(),
      };
      expect((await checkReadiness(pool, expected)).failures).not.toContain("migration_hash");
      await client.query(
        "UPDATE app.schema_migrations SET source_hash=$1 WHERE version='0002_synthetic'",
        ["a".repeat(64)],
      );
      expect((await checkReadiness(pool, expected)).failures).toContain("migration_hash");
      await client.query(
        "UPDATE app.schema_migrations SET source_hash=$1 WHERE version='0002_synthetic'",
        [
          createHash("sha256")
            .update(await readFile(join(dir, "0002_synthetic.sql")))
            .digest("hex"),
        ],
      );
    } finally {
      await pool.end();
    }
    const second = join(dir, "0002_synthetic.sql");
    const source = await readFile(second);
    await writeFile(second, "SELECT 1;\n");
    await expect(runMigrations(client)).rejects.toThrow();
    await writeFile(second, source);
    await client.query(
      "INSERT INTO app.schema_migrations(version, source_hash) VALUES ('9999_unknown', $1)",
      ["a".repeat(64)],
    );
    await expect(runMigrations(client)).rejects.toThrow();
    await client.query("DELETE FROM app.schema_migrations WHERE version='9999_unknown'");
    await copyFile(
      resolve(original, "fixtures/migrations/0003_failure.sql"),
      join(dir, "0003_failure.sql"),
    );
    await expect(runMigrations(client)).rejects.toThrow();
    expect(
      (await client.query("SELECT to_regclass('app.synthetic_rollback_test') AS name")).rows[0]
        .name,
    ).toBeNull();
    expect(
      (await client.query("SELECT count(*)::int AS count FROM app.schema_migrations")).rows[0]
        .count,
    ).toBe(2);
    await rm(join(dir, "0003_failure.sql"));
    await client.query("BEGIN");
    await client.query("DELETE FROM app.schema_migrations WHERE version='0001_foundation'");
    await client.query("COMMIT");
    await expect(runMigrations(client)).rejects.toThrow();
    await client.query("DELETE FROM app.schema_migrations WHERE version='0002_synthetic'");
    await expect(runMigrations(client)).rejects.toThrow();
    await client.query("DROP SCHEMA app CASCADE");
    await runMigrations(client);
    expect(
      (await client.query("SELECT count(*)::int AS count FROM app.schema_migrations")).rows[0]
        .count,
    ).toBe(2);
    expect(
      (await client.query("SELECT to_regclass('app.synthetic_migration_test') AS name")).rows[0]
        .name,
    ).toBe("app.synthetic_migration_test");
  } finally {
    process.chdir(original);
    await client.end();
    await rm(root, { recursive: true, force: true });
  }
});
