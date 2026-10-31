import { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { bootstrap } from "../../apps/api/src/bootstrap/index.ts";
import { computeMigrationSetHash } from "../../packages/db/src/migrations.ts";
import { installSyntheticDirectory, prepareFoundationDatabase } from "../harness/db/foundation.ts";

const release = vi.hoisted(() => ({ hash: "" }));
// Harness-only release identity and test CA. Production never reads either from
// an environment bypass. All other config, bootstrap, TLS and DB checks are real.
vi.mock("@off-r39x/config", async (get) => ({
  ...(await get<typeof import("@off-r39x/config")>()),
  getBuildMigrationSetHash: () => release.hash,
}));
vi.mock("@off-r39x/db", async (get) => {
  const real = await get<typeof import("@off-r39x/db")>();
  const { readFileSync } = await import("node:fs");
  return {
    ...real,
    createDatabase: (options: import("../../packages/db/src/database.ts").DatabaseOptions) =>
      real.createDatabase({
        ...options,
        ca: readFileSync(process.env.TEST_DATABASE_CA as string, "utf8"),
      }),
  };
});

it("TC-STARTUP-AUDIT-001 actual API bootstrap moves Ready->notReady->Ready on DB/enforcement faults, then drains", async () => {
  if (!process.env.TEST_DATABASE_URL || !process.env.TEST_DATABASE_CA)
    throw new Error("Real verified-TLS PG17 required");
  const databaseName = new URL(process.env.TEST_DATABASE_URL).pathname.slice(1);
  const databaseIdentifier = `"${databaseName.replaceAll('"', '""')}"`;
  const setup = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  const client = await setup.connect();
  try {
    await prepareFoundationDatabase(client);
    await installSyntheticDirectory(client);
    await client.query(
      `ALTER DATABASE ${databaseIdentifier} SET r39x.environment='test'; ALTER DATABASE ${databaseIdentifier} SET r39x.project_id='synthetic-project'; ALTER DATABASE ${databaseIdentifier} SET r39x.branch_id='synthetic-branch'`,
    );
  } finally {
    client.release();
  }
  release.hash = await computeMigrationSetHash();
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.username = "app_api_runtime";
  url.password = "synthetic";
  url.search = "?sslmode=verify-full";
  const env = {
    PORT: "18931",
    APP_ENV: "test",
    DATABASE_URL: url.href,
    DATABASE_ENV_MARKER_SETTING: "r39x.environment",
    NEON_PROJECT_ID_SETTING: "r39x.project_id",
    NEON_BRANCH_ID_SETTING: "r39x.branch_id",
    EXPECTED_NEON_PROJECT_ID: "synthetic-project",
    EXPECTED_NEON_BRANCH_ID: "synthetic-branch",
    EXPECTED_NEON_DATABASE_NAME: decodeURIComponent(url.pathname.slice(1)),
    EXPECTED_STRIPE_MODE: "test",
    EXPECTED_RESEND_ENV_ID: "synthetic-resend",
    EXPECTED_OBSERVABILITY_ENV: "test",
    EXPECTED_DATABASE_ENV_MARKER: "test",
    OBS_CORRELATION_HMAC_KEY: Buffer.alloc(32, 3).toString("base64"),
    OBS_CORRELATION_HMAC_KEY_VERSION: "1",
    RESEND_API_KEY: "synthetic",
    STRIPE_SECRET_KEY: ["sk", "test", "synthetic"].join("_"),
    STRIPE_WEBHOOK_SECRET: "synthetic",
    RESEND_WEBHOOK_SECRET: "synthetic",
    QR_PROTECTION_CURRENT_VERSION: "1",
    QR_ALLOWED_READ_VERSIONS: "1",
    QR_KEYRING: JSON.stringify([
      {
        version: 1,
        hmacKey: Buffer.alloc(32, 1).toString("base64"),
        aeadKey: Buffer.alloc(32, 2).toString("base64"),
      },
    ]),
    AUTH_ISSUER: "https://neon.example.test/auth",
    AUTH_AUDIENCE: "synthetic-api",
    AUTH_JWKS_URL: "https://neon.example.test/auth/.well-known/jwks.json",
    NEON_AUTH_BASE_URL: "https://neon.example.test/auth",
    AUTH_DIRECTORY_SOURCE_MAPPING: JSON.stringify({
      deploymentConfirmed: true,
      providerSchemaVersion: "synthetic-test-v1",
      schema: "synthetic_provider",
      table: "identities",
      subjectColumn: "subject",
      emailColumn: "current_email",
      verifiedColumn: "verified",
    }),
    APP_BASE_URL: "https://web.example.test",
    PUBLIC_WEB_ORIGIN: "https://web.example.test",
    PUBLIC_API_ORIGIN: "https://api.example.test",
    PUBLIC_AUTH_ORIGIN: "https://api.example.test",
    ALLOWED_HOSTS: "api.example.test",
    ALLOWED_ORIGINS: "https://web.example.test",
  };
  let unavailable = false;
  let runtime: ReturnType<typeof bootstrap> | undefined;
  let dropped = false;
  try {
    runtime = bootstrap(env, {
      assertAvailable: async () => {
        if (unavailable) throw new Error("synthetic-limiter-private");
      },
      middleware: async (_c, next) => {
        await next();
      },
    });
    await new Promise<void>((resolve, reject) => {
      runtime?.server.once("listening", resolve);
      runtime?.server.once("error", reject);
    });
    const get = (path = "ready") => fetch(`http://127.0.0.1:18931/internal/health/${path}`);
    expect((await get("live")).status).toBe(200);
    expect((await get()).status).toBe(200);
    unavailable = true;
    expect((await get()).status).toBe(503);
    expect((await get("live")).status).toBe(200);
    unavailable = false;
    expect((await get()).status).toBe(200);
    await setup.query(
      "ALTER TABLE app.business_profiles DROP CONSTRAINT uq_business_profiles_auth_subject",
    );
    dropped = true;
    expect((await get()).status).toBe(503);
    await setup.query(
      "ALTER TABLE app.business_profiles ADD CONSTRAINT uq_business_profiles_auth_subject UNIQUE(auth_subject)",
    );
    dropped = false;
    expect((await get()).status).toBe(200);
    runtime.beginDrain();
    expect((await get()).status).toBe(503);
  } finally {
    if (dropped)
      await setup.query(
        "ALTER TABLE app.business_profiles ADD CONSTRAINT uq_business_profiles_auth_subject UNIQUE(auth_subject)",
      );
    await runtime?.close();
    await setup.query(
      `ALTER DATABASE ${databaseIdentifier} RESET r39x.environment; ALTER DATABASE ${databaseIdentifier} RESET r39x.project_id; ALTER DATABASE ${databaseIdentifier} RESET r39x.branch_id`,
    );
    await setup.end();
  }
});
