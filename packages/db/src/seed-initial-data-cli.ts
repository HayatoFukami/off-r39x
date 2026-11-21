import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { performance } from "node:perf_hooks";
import { checkServerIdentity } from "node:tls";
import { createLogger, type LogEvent } from "@off-r39x/observability";
import { TIMEOUTS } from "@off-r39x/reliability";
import { Client } from "pg";
import {
  failedOutcome,
  outcomeExitCode,
  outcomeLogFields,
  SEED_OPERATION_ID,
  type SeedFailureClass,
  type SeedOutcome,
  seedInitialData,
} from "./initial-data/seed.ts";
import {
  acquireMigrationLock,
  type MigrationLock,
  MigrationLockTimeoutError,
  MigrationPrincipalError,
} from "./migration-lock.ts";

// Initial data seeding command (SPEC-180 section 45.3, INF-SEED-001..006). It runs as app_migrator on a
// direct TLS connection under the migration lock. stdout carries exactly one JSON line (the business
// specific result); stderr carries the common log lines. No exception message or stack, no input value,
// no connection string and no SQLSTATE is ever written (INF-SEED-005, INF-SEC-001, OBS-LOG-005).
// Exit codes: 0 CREATED / NOOP, 2 FAILED, 3 UNKNOWN_RESULT. Node itself exits 1 on a crash, which is
// treated like UNKNOWN_RESULT: run the command again.

const APP_ENVIRONMENTS = ["production", "staging", "development", "test"] as const;
type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];
const SAFE_REF = /^[A-Za-z0-9_:-]{1,128}$/;
const CLOSE_WAIT_MS = 3000;

type Logger = { log(event: LogEvent): void };

// A failure before any seed attempt ran is reported as attempt 1 (is_retry false).
const failedBeforeSeed = (
  operationExecutionId: string,
  failureClass: SeedFailureClass,
  errorCode: string,
): SeedOutcome => failedOutcome(operationExecutionId, 1, failureClass, errorCode);

/** The same conditions as migrate-cli.ts: a dedicated, direct app_migrator URL. */
function migrationUrl(connectionString: string | undefined): URL | undefined {
  if (!connectionString) return undefined;
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return undefined;
  }
  let username: string;
  try {
    username = decodeURIComponent(url.username);
  } catch {
    return undefined;
  }
  if (
    username !== "app_migrator" ||
    url.search ||
    url.hostname.includes("-pooler") ||
    (url.port && url.port !== "5432")
  )
    return undefined;
  return url;
}

async function closeQuietly(work: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work.catch(() => undefined),
      new Promise((resolve) => {
        timer = setTimeout(resolve, CLOSE_WAIT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function run(): Promise<void> {
  const startedAt = performance.now();
  const fallbackExecutionId = randomUUID();
  const environment = process.env.APP_ENV;
  const appEnv = (APP_ENVIRONMENTS as readonly string[]).includes(environment ?? "")
    ? (environment as AppEnvironment)
    : undefined;
  const actorRef = SAFE_REF.test(process.env.INITIAL_DATA_SEED_ACTOR_REF ?? "")
    ? (process.env.INITIAL_DATA_SEED_ACTOR_REF as string)
    : undefined;
  let logger: Logger | undefined;
  if (appEnv !== undefined) {
    logger = createLogger(
      {
        service: "RECOVERY",
        environment: appEnv,
        actor_type: "INFRASTRUCTURE_OPERATOR",
        ...(actorRef === undefined ? {} : { actor_ref: actorRef }),
      },
      (line) => {
        process.stderr.write(`${line}\n`);
      },
    );
  }

  const url = migrationUrl(process.env.MIGRATION_DATABASE_URL);
  let outcome: SeedOutcome;
  if (appEnv === undefined || actorRef === undefined || url === undefined) {
    outcome = failedBeforeSeed(fallbackExecutionId, "PERMANENT_FAILURE", "CONFIGURATION_INVALID");
  } else {
    outcome = await execute(url, actorRef, logger, fallbackExecutionId);
  }

  const fields = outcomeLogFields(outcome);
  try {
    logger?.log({
      event_name: "provision.initial_data_seed.completed",
      level: fields.level,
      result: fields.result,
      failure_class: fields.failure_class,
      is_retry: outcome.attemptNumber > 1,
      operation_id: SEED_OPERATION_ID,
      operation_execution_id: outcome.operationExecutionId,
      attempt_number: outcome.attemptNumber,
      error_code: "errorCode" in outcome ? outcome.errorCode : null,
      duration_ms: Math.round(performance.now() - startedAt),
    });
  } catch {
    // Logging is not business authority.
  }

  const created = outcome.outcome === "CREATED" ? outcome.created : undefined;
  const events = [...(created?.events ?? [])];
  const offerings = [...(created?.entry_ticket_offerings ?? [])];
  process.stdout.write(
    `${JSON.stringify({
      schema_version: 1,
      operation_id: SEED_OPERATION_ID,
      operation_execution_id: outcome.operationExecutionId,
      outcome: outcome.outcome,
      actor_ref: actorRef ?? null,
      created: { events, entry_ticket_offerings: offerings },
      counts: { events: events.length, entry_ticket_offerings: offerings.length },
      audit_event_ids: outcome.outcome === "CREATED" ? [...outcome.auditEventIds] : [],
      error_code: "errorCode" in outcome ? outcome.errorCode : null,
    })}\n`,
  );
  process.exitCode = outcomeExitCode(outcome);
}

async function execute(
  url: URL,
  actorRef: string,
  logger: Logger | undefined,
  executionId: string,
): Promise<SeedOutcome> {
  const connectionString = url.href;
  // Node warns (to stderr) when the TLS server name is an IP address; the certificate is then matched
  // against the address by checkServerIdentity itself.
  const servername = isIP(url.hostname) === 0 ? url.hostname : undefined;
  const newClient = (): Client => {
    const client = new Client({
      connectionString,
      ssl: {
        rejectUnauthorized: true,
        ...(servername === undefined ? {} : { servername }),
        checkServerIdentity,
      },
      connectionTimeoutMillis: TIMEOUTS.poolAcquireMs,
      application_name: "r39x/deployment/initial-data-seed",
    });
    // A connection error after connect must not become an unhandled event (it would print a stack).
    client.on("error", () => {});
    return client;
  };

  let client: Client;
  try {
    client = newClient();
  } catch {
    return failedBeforeSeed(executionId, "PERMANENT_FAILURE", "CONFIGURATION_INVALID");
  }
  let lock: MigrationLock | undefined;
  try {
    try {
      await client.connect();
    } catch {
      return failedBeforeSeed(executionId, "TEMPORARY_FAILURE", "DATABASE_TEMPORARY_FAILURE");
    }
    try {
      lock = await acquireMigrationLock(client);
    } catch (error) {
      if (error instanceof MigrationPrincipalError)
        return failedBeforeSeed(executionId, "PERMANENT_FAILURE", "MIGRATION_PRINCIPAL_INVALID");
      if (error instanceof MigrationLockTimeoutError)
        return failedBeforeSeed(executionId, "TEMPORARY_FAILURE", "MIGRATION_LOCK_TIMEOUT");
      return failedBeforeSeed(executionId, "TEMPORARY_FAILURE", "DATABASE_TEMPORARY_FAILURE");
    }
    // No catch here: seedInitialData classifies every error of its own attempts. A throw that still
    // reaches this point is a bug or a pre-flight refusal, and cannot be proven to have happened before
    // COMMIT, so it must not be reported as FAILED (a rolled-back result). It leaves through the outer
    // handler as a crash (exit 1), which the README treats like UNKNOWN_RESULT: run the command again.
    return await seedInitialData({
      lock,
      connect: async () => {
        const next = newClient();
        try {
          await next.connect();
        } catch (error) {
          await closeQuietly(next.end());
          throw error;
        }
        return next;
      },
      readInput: () => process.env.INITIAL_DATA_SEED_JSON,
      actorRef,
      ...(logger === undefined ? {} : { logger }),
    });
  } finally {
    if (lock) await closeQuietly(lock.release());
    await closeQuietly(client.end());
  }
}

try {
  await run();
} catch {
  // Never print the exception. Whether COMMIT was reached is unknown here, so no FAILED result line
  // is claimed: exit 1 like a crash, and run the command again (it is idempotent).
  process.exitCode = 1;
}
