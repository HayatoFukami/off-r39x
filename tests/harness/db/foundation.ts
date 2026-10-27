import type { Client } from "pg";
import {
  installBaselineRoles,
  installIdentityDirectory,
  runMigrations,
} from "../../../packages/db/src/index.ts";

export async function prepareFoundationDatabase(client: Client): Promise<void> {
  await installBaselineRoles(client);
  const database = (await client.query("SELECT current_database() AS name")).rows[0].name as string;
  await client.query(
    `GRANT CREATE ON DATABASE "${database.replaceAll('"', '""')}" TO app_migrator`,
  );
  await client.query("SET ROLE app_migrator");
  try {
    await runMigrations(client);
  } finally {
    await client.query("RESET ROLE");
  }
}

/** Synthetic provider representation belongs only in the test harness. */
export async function installSyntheticDirectory(client: Client): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS synthetic_provider;
    CREATE TABLE IF NOT EXISTS synthetic_provider.identities (
      subject uuid PRIMARY KEY, current_email text, verified boolean NOT NULL,
      password_hash text, session_secret text);
    REVOKE ALL ON SCHEMA synthetic_provider FROM PUBLIC;
    REVOKE ALL ON synthetic_provider.identities FROM PUBLIC`);
  await installIdentityDirectory(client, {
    deploymentConfirmed: true,
    providerSchemaVersion: "synthetic-test-v1",
    schema: "synthetic_provider",
    table: "identities",
    subjectColumn: "subject",
    emailColumn: "current_email",
    verifiedColumn: "verified",
  });
}
