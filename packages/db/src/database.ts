import { checkServerIdentity } from "node:tls";
import { TIMEOUTS } from "@off-r39x/reliability";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { type DatabaseLogger, observeDatabase } from "./observability.ts";
import * as schema from "./schema.ts";

export type DatabaseOptions = {
  connectionString: string;
  environment: "production" | "staging" | "development" | "test";
  service: "api" | "email-worker" | "reconciliation-worker";
  ca?: string;
  logger?: DatabaseLogger;
};
export function createDatabase(options: DatabaseOptions) {
  const url = new URL(options.connectionString);
  if (
    !/^postgres(ql)?:$/.test(url.protocol) ||
    (url.port && url.port !== "5432") ||
    url.hostname.includes("-pooler") ||
    url.search
  )
    throw new Error("Direct PostgreSQL URL without TLS query overrides required");
  const api = options.service === "api";
  const expectedUser = {
    api: "app_api_runtime",
    "email-worker": "app_email_runtime",
    "reconciliation-worker": "app_reconciliation_runtime",
  }[options.service];
  if (decodeURIComponent(url.username) !== expectedUser)
    throw new Error("Database runtime role mismatch");
  const max =
    options.environment === "production"
      ? api
        ? 8
        : 4
      : options.environment === "staging"
        ? api
          ? 4
          : 2
        : api
          ? 2
          : 1;
  const pool = new Pool({
    connectionString: options.connectionString,
    max,
    min: 0,
    connectionTimeoutMillis: TIMEOUTS.poolAcquireMs,
    idleTimeoutMillis: 30000,
    ssl: {
      rejectUnauthorized: true,
      servername: url.hostname,
      checkServerIdentity,
      ...(options.ca ? { ca: options.ca } : {}),
    },
    application_name: `r39x/${options.environment}/${options.service}`,
    options: `-c timezone=UTC -c statement_timeout=${TIMEOUTS.statementMs} -c lock_timeout=${TIMEOUTS.lockMs} -c idle_in_transaction_session_timeout=${TIMEOUTS.transactionMs}`,
  });
  // Pool errors must not leak connection strings through an unhandled event.
  if (options.logger) observeDatabase(pool, options.logger);
  pool.on("error", () =>
    options.logger?.log({
      event_name: "db.availability.failed",
      level: "ERROR",
      result: "FAILED",
      is_retry: false,
      provider: "NEON_DB",
      failure_class: "TEMPORARY_FAILURE",
    }),
  );
  return { pool, db: drizzle(pool, { schema }), close: () => pool.end() };
}
