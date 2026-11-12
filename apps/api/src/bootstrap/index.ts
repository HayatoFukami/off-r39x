import { serve } from "@hono/node-server";
import { createTokenVerifier } from "@off-r39x/auth";
import { getBuildMigrationSetHash, parseServerConfig } from "@off-r39x/config";
import { checkReadiness, createDatabase, createPrincipalRepository } from "@off-r39x/db";
import { createLogger, createRateLimitMetrics } from "@off-r39x/observability";
import { createRedisRateLimitStore } from "@off-r39x/rate-limit-redis";
import { createRateLimiter, RATE_LIMIT_CLASS_IDS, type RateLimitStore } from "@off-r39x/security";
import { createApp } from "../api/app.ts";
import { createAuthProxy } from "../api/auth-proxy.ts";
import { createRateLimitMetricsObserver } from "../api/rate-limit.ts";
import { startRateLimitStoreProbe } from "../api/store-probe.ts";

export interface BootstrapOverrides {
  /** Test seam (DI only): replaces the Redis store adapter. Never reads configuration. */
  readonly rateLimitStore?: RateLimitStore;
}

export function bootstrap(
  env: Readonly<Record<string, string | undefined>>,
  overrides: BootstrapOverrides = {},
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
  const authProxy = config.auth.baseUrl
    ? createAuthProxy({
        baseUrl: config.auth.baseUrl,
        publicAuthOrigin: config.http.publicAuthOrigin,
        webOrigin,
      })
    : undefined;
  // UCR-140-003: the shared rate limit is mandatory. Invalid configuration already failed in
  // parseServerConfig; a store outage is reported by readiness (INF-HLT-004) and fails requests closed.
  const rateLimitMetrics = createRateLimitMetrics({
    environment: config.environment,
    classIds: RATE_LIMIT_CLASS_IDS,
  });
  const rateLimitStore =
    overrides.rateLimitStore ?? createRedisRateLimitStore({ url: config.rateLimit.storeUrl });
  const limiter = createRateLimiter({
    store: rateLimitStore,
    config: config.rateLimit.config,
    hmacKey: config.rateLimit.hmacKey(),
    hmacKeyVersion: config.rateLimit.hmacKeyVersion,
    observer: createRateLimitMetricsObserver(rateLimitMetrics),
  });

  let draining = false;
  const app = createApp({
    webOrigin,
    allowedHosts: config.http.allowedHosts,
    logger,
    auth: { verifier, store: principals },
    ...(authProxy ? { authProxy } : {}),
    rateLimit: { limiter, trustedProxyHops: config.rateLimit.trustedProxyHops },
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
      if (!observed.ready || !authProxy || draining) return false;
      await limiter.assertReady();
      return !draining;
    },
  });
  // INF-HLT-004 / OBS-ALT-042: the store probe is independent of request handling (<= 30 s).
  const storeProbe = startRateLimitStoreProbe({
    check: () => limiter.assertReady(),
    metrics: rateLimitMetrics,
  });
  const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
  const close = async () => {
    storeProbe.stop();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await limiter.close();
    await database.close();
  };
  const beginDrain = () => {
    draining = true;
  };
  return { app, server, close, beginDrain, verifier, principals, rateLimitMetrics };
}
