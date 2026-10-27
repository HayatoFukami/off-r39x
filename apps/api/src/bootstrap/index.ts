import { serve } from "@hono/node-server";
import { createTokenVerifier } from "@off-r39x/auth";
import { getBuildMigrationSetHash, parseServerConfig } from "@off-r39x/config";
import { checkReadiness, createDatabase, createPrincipalRepository } from "@off-r39x/db";
import { createLogger } from "@off-r39x/observability";
import { createApp, type SharedRateLimitGuard } from "../api/app.ts";

export function bootstrap(
  env: Readonly<Record<string, string | undefined>>,
  enforcement?: SharedRateLimitGuard,
) {
  const config = parseServerConfig("api", env);
  if (config.service !== "api") throw new Error("Invalid API service configuration");
  const { publicWebOrigin: webOrigin, port } = config.http;
  const logger = createLogger({
    service: "API",
    environment: config.environment,
    actor_type: "GUEST",
  });
  const databaseUrl = new URL(config.database.connectionString);
  if (
    [...databaseUrl.searchParams].some(
      ([name, value]) => name !== "sslmode" || value !== "verify-full",
    )
  )
    throw new Error("Unsupported database URL options");
  // pg receives verified TLS as explicit connection options, never URL overrides.
  databaseUrl.search = "";
  const database = createDatabase({
    connectionString: databaseUrl.href,
    environment: config.environment,
    service: "api",
    logger,
  });
  const verifier = createTokenVerifier(config.auth);
  const migrationSetHash = getBuildMigrationSetHash();
  const principals = createPrincipalRepository(database.pool);
  // No protected routes until shared rate limiting and deployment identity evidence exist.
  // A live listener is not production readiness.

  let draining = false;
  const app = createApp({
    webOrigin,
    allowedHosts: config.http.allowedHosts,
    logger,
    draining: () => draining,
    ready: async () => {
      const observed = await checkReadiness(database.pool, {
        environment: config.environment,
        expectedEnvironmentMarker: config.database.expectedEnvironmentMarker,
        environmentMarkerSetting: config.database.environmentMarkerSetting,
        metadata: config.database.metadata,
        ...(migrationSetHash ? { migrationSetHash } : {}),
        ...(config.database.directoryMapping
          ? { directoryMapping: config.database.directoryMapping }
          : {}),
      });
      if (!observed.ready || !enforcement || draining) return false;
      await enforcement.assertAvailable();
      return !draining;
    },
  });
  const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
  const close = async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await database.close();
  };
  const beginDrain = () => {
    draining = true;
  };
  return { app, server, close, beginDrain, verifier, principals };
}
