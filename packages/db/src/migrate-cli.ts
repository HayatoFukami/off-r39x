import { checkServerIdentity } from "node:tls";
import { TIMEOUTS } from "@off-r39x/reliability";
import { Client } from "pg";
import { runMigrations } from "./migrations.ts";

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) throw new Error("Deployment migration credential required");
const url = new URL(connectionString);
if (
  decodeURIComponent(url.username) !== "app_migrator" ||
  url.search ||
  url.hostname.includes("-pooler") ||
  (url.port && url.port !== "5432")
)
  throw new Error("Dedicated direct app_migrator URL required");
const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: true, servername: url.hostname, checkServerIdentity },
  connectionTimeoutMillis: TIMEOUTS.poolAcquireMs,
  application_name: "r39x/deployment/migrator",
});
try {
  await client.connect();
  await runMigrations(client);
} finally {
  await client.end();
}
