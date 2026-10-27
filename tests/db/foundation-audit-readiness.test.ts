import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { expect, it } from "vitest";
import {
  checkReadiness,
  computeMigrationSetHash,
  createDatabase,
} from "../../packages/db/src/index.ts";
import { installSyntheticDirectory, prepareFoundationDatabase } from "../harness/db/foundation.ts";

it("TC-DB-AUDIT-001 detects missing and altered release schema, constraints and indexes even with an intact journal", async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Real PG17 required");
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await prepareFoundationDatabase(client);
    await installSyntheticDirectory(client);
    await client.query("SET r39x.environment='test'");
  } finally {
    client.release();
  }
  const expected = {
    environment: "test",
    environmentMarkerSetting: "r39x.environment",
    migrationSetHash: await computeMigrationSetHash(),
    directoryMapping: {
      deploymentConfirmed: true as const,
      providerSchemaVersion: "synthetic-test-v1",
      schema: "synthetic_provider",
      table: "identities",
      subjectColumn: "subject",
      emailColumn: "current_email",
      verifiedColumn: "verified",
    },
  };
  try {
    expect(await checkReadiness(pool, expected)).toEqual({ ready: true, failures: [] });
    for (const injection of [
      "ALTER TABLE app.business_profiles DROP CONSTRAINT uq_business_profiles_auth_subject",
      "ALTER TABLE app.business_profiles DROP CONSTRAINT ck_business_profiles_display_name; ALTER TABLE app.business_profiles ADD CONSTRAINT ck_business_profiles_display_name CHECK (true)",
      "ALTER TABLE app.role_assignments DROP CONSTRAINT fk_role_assignments_profile",
      "DROP INDEX app.ux_role_assignments_profile_role_active",
      "DROP INDEX app.ux_role_assignments_profile_role_active; CREATE INDEX ux_role_assignments_profile_role_active ON app.role_assignments(profile_id,role)",
      "ALTER TABLE app.business_profiles ALTER COLUMN auth_subject DROP NOT NULL",
      "ALTER TABLE app.business_profiles ALTER COLUMN created_at DROP DEFAULT",
      "ALTER TABLE app.role_assignments RENAME TO missing_role_assignments",
      "ALTER SCHEMA app RENAME TO missing_app",
      "DROP EXTENSION btree_gist",
      "ALTER TABLE synthetic_provider.identities DROP CONSTRAINT identities_pkey",
      "ALTER TABLE synthetic_provider.identities ALTER COLUMN verified DROP NOT NULL",
      "CREATE OR REPLACE VIEW auth_read.identity_directory WITH (security_barrier=true) AS SELECT subject AS auth_subject,current_email AS email,NOT verified AS email_verified FROM synthetic_provider.identities",
    ]) {
      // A single real backend connection; every fault is reverted without modifying migration sources/journal.
      await pool.query("BEGIN");
      try {
        await pool.query(injection);
        expect((await checkReadiness(pool, expected)).ready, injection).toBe(false);
      } finally {
        await pool.query("ROLLBACK");
      }
      expect((await checkReadiness(pool, expected)).ready, injection).toBe(true);
    }
    // Readiness must inspect catalog metadata without granting Recon access to
    // the auth Directory's rows. Exercise both least-privilege worker identities.
    const ca = await readFile(process.env.TEST_DATABASE_CA as string, "utf8");
    for (const [service, role] of [
      ["email-worker", "app_email_runtime"],
      ["reconciliation-worker", "app_reconciliation_runtime"],
    ] as const) {
      const url = new URL(process.env.TEST_DATABASE_URL);
      url.username = role;
      url.password = "";
      url.search = "";
      const runtime = createDatabase({
        connectionString: url.href,
        environment: "test",
        service,
        ca,
      });
      try {
        await runtime.pool.query("SET r39x.environment='test'");
        expect(await checkReadiness(runtime.pool, expected), service).toEqual({
          ready: true,
          failures: [],
        });
        if (service === "reconciliation-worker")
          await expect(
            runtime.pool.query("SELECT auth_subject FROM auth_read.identity_directory"),
          ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await runtime.close();
      }
    }
  } finally {
    await pool.end();
  }
});
