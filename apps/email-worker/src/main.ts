import { pathToFileURL } from "node:url";
import { createWorker } from "@off-r39x/application/worker";
import { getBuildMigrationSetHash, parseServerConfig } from "@off-r39x/config";
import { checkReadiness, createDatabase } from "@off-r39x/db";
import { createLogger } from "@off-r39x/observability";
import { createResendSender } from "@off-r39x/provider-resend";
import { systemClock } from "@off-r39x/reliability";
import { startWorkerHost } from "./bootstrap/host.ts";

export function bootstrapEmailWorker(env: Readonly<Record<string, string | undefined>>) {
  const config = parseServerConfig("email-worker", env);
  const migrationSetHash = getBuildMigrationSetHash();
  // Config verifies sslmode=verify-full; DB factory supplies equivalent explicit TLS
  // and deliberately rejects URL TLS overrides. Preserve all other validation.
  const databaseUrl = new URL(config.database.connectionString);
  databaseUrl.searchParams.delete("sslmode");
  const database = createDatabase({
    connectionString: databaseUrl.toString(),
    environment: config.environment,
    service: "email-worker",
  });
  const logger = createLogger({
    service: "EMAIL_WORKER",
    environment: config.environment,
    actor_type: "SYSTEM_WORKER",
  });
  const failure = () =>
    logger.log({
      event_name: "security.fail_closed.triggered",
      level: "ERROR",
      result: "FAILED",
      failure_class: "TEMPORARY_FAILURE",
      is_retry: false,
    });
  const sender = createResendSender(config.resend.apiKey, fetch, logger);
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
  // No notification business handlers are registered by this foundation.
  return { ...host, sender, worker };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const runtime = bootstrapEmailWorker(process.env);
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
      createLogger({ service: "EMAIL_WORKER", environment, actor_type: "SYSTEM_WORKER" }).log({
        event_name: "security.fail_closed.triggered",
        level: "ERROR",
        result: "FAILED",
        failure_class: "SECURITY_FAILURE",
        is_retry: false,
      });
    process.exitCode = 1;
  }
}
