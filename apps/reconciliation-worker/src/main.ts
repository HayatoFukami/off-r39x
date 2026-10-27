import { pathToFileURL } from "node:url";
import { createWorker } from "@off-r39x/application/worker";
import { getBuildMigrationSetHash, parseServerConfig } from "@off-r39x/config";
import { checkReadiness, createDatabase } from "@off-r39x/db";
import { createLogger } from "@off-r39x/observability";
import { createResendLookup } from "@off-r39x/provider-resend";
import { createStripeLookup } from "@off-r39x/provider-stripe";
import { systemClock } from "@off-r39x/reliability";
import { createAdvisoryLock } from "./bootstrap/advisory-lock.ts";
import { startWorkerHost } from "./bootstrap/host.ts";

export function bootstrapReconciliationWorker(env: Readonly<Record<string, string | undefined>>) {
  const config = parseServerConfig("reconciliation-worker", env);
  const migrationSetHash = getBuildMigrationSetHash();
  if (config.service !== "reconciliation-worker") throw new Error("Worker configuration mismatch");
  // Translate validated verify-full URL syntax into DB factory's explicit TLS contract.
  const logger = createLogger({
    service: "RECONCILIATION_WORKER",
    environment: config.environment,
    actor_type: "SCHEDULED_RECONCILIATION",
  });
  const databaseUrl = new URL(config.database.connectionString);
  databaseUrl.searchParams.delete("sslmode");
  const database = createDatabase({
    connectionString: databaseUrl.toString(),
    environment: config.environment,
    service: "reconciliation-worker",
    logger,
  });

  const failure = () =>
    logger.log({
      event_name: "security.fail_closed.triggered",
      level: "ERROR",
      result: "FAILED",
      failure_class: "TEMPORARY_FAILURE",
      is_retry: false,
    });
  const providers = {
    email: createResendLookup(config.resend.apiKey, fetch, logger),
    payment: createStripeLookup(config.stripe.secretKey, logger),
  };
  const locks = createAdvisoryLock(database.pool);
  const worker = createWorker(systemClock, [], failure);
  const host = startWorkerHost({
    worker,
    port: config.http.port,
    checkReadiness: async () =>
      (
        await checkReadiness(database.pool, {
          environment: config.environment,
          ...(migrationSetHash ? { migrationSetHash } : {}),
          expectedEnvironmentMarker: config.database.expectedEnvironmentMarker,
          environmentMarkerSetting: config.database.environmentMarkerSetting,
          metadata: config.database.metadata,
          ...(config.database.directoryMapping
            ? { directoryMapping: config.database.directoryMapping }
            : {}),
        })
      ).ready,
    close: database.close,
    failure,
  });
  // Empty registry has no invented operation keys, side effects or success metrics.
  return { ...host, providers, worker, locks };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const runtime = bootstrapReconciliationWorker(process.env);
    const stop = () => {
      void runtime.stop().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  } catch {
    const environment = process.env.APP_ENV;
    if (
      environment === "production" ||
      environment === "staging" ||
      environment === "development" ||
      environment === "test"
    )
      createLogger({
        service: "RECONCILIATION_WORKER",
        environment,
        actor_type: "SCHEDULED_RECONCILIATION",
      }).log({
        event_name: "security.fail_closed.triggered",
        level: "ERROR",
        result: "FAILED",
        failure_class: "SECURITY_FAILURE",
        is_retry: false,
      });
    process.exitCode = 1;
  }
}
