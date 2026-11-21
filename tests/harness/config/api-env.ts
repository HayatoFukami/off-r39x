// Synthetic API / worker environments shared by the PR-S0-3e tests (TST-DAT-003). Test-only. Key bytes
// are built with Buffer.alloc at run time; hosts use reserved domains.
import { listCursorEnv } from "../pagination.ts";
import { rateLimitEnv } from "../rate-limit/api.ts";

type Env = Record<string, string | undefined>;
export type WorkerService = "email-worker" | "reconciliation-worker";

export function syntheticDatabaseUrl(role: string): string {
  const value = new URL("postgresql:" + "//db.example.test/business");
  value.username = role;
  value.password = "synthetic";
  value.searchParams.set("sslmode", "verify-full");
  return value.href;
}

export function syntheticApiEnv(overrides: Env = {}): Env {
  return {
    DATABASE_ENV_MARKER_SETTING: "deployment.environment",
    NEON_PROJECT_ID_SETTING: "deployment.project_id",
    NEON_BRANCH_ID_SETTING: "deployment.branch_id",
    APP_ENV: "test",
    DATABASE_URL: syntheticDatabaseUrl("app_api_runtime"),
    EXPECTED_NEON_PROJECT_ID: "synthetic-project",
    EXPECTED_NEON_BRANCH_ID: "synthetic-branch",
    EXPECTED_NEON_DATABASE_NAME: "business",
    EXPECTED_STRIPE_MODE: "test",
    EXPECTED_RESEND_ENV_ID: "synthetic-resend",
    EXPECTED_OBSERVABILITY_ENV: "test",
    EXPECTED_DATABASE_ENV_MARKER: "test",
    OBS_CORRELATION_HMAC_KEY: Buffer.alloc(32, 3).toString("base64"),
    OBS_CORRELATION_HMAC_KEY_VERSION: "1",
    RESEND_API_KEY: "synthetic",
    STRIPE_SECRET_KEY: ["sk", "test", "synthetic"].join("_"),
    QR_PROTECTION_CURRENT_VERSION: "1",
    QR_ALLOWED_READ_VERSIONS: "1",
    QR_KEYRING: JSON.stringify([
      {
        version: 1,
        hmacKey: Buffer.alloc(32, 1).toString("base64"),
        aeadKey: Buffer.alloc(32, 2).toString("base64"),
      },
    ]),
    AUTH_ISSUER: "https://auth.example.test",
    AUTH_AUDIENCE: "synthetic-api",
    AUTH_JWKS_URL: "https://auth.example.test/jwks",
    STRIPE_WEBHOOK_SECRET: "synthetic",
    RESEND_WEBHOOK_SECRET: "synthetic",
    PORT: "8080",
    APP_BASE_URL: "https://web.example.test",
    PUBLIC_WEB_ORIGIN: "https://web.example.test",
    PUBLIC_API_ORIGIN: "https://api.example.test",
    PUBLIC_AUTH_ORIGIN: "https://api.example.test",
    ALLOWED_HOSTS: "api.example.test",
    ALLOWED_ORIGINS: "https://web.example.test",
    ...rateLimitEnv(),
    ...listCursorEnv(),
    ...overrides,
  };
}

/** A valid worker environment: API-only Secrets (rate limit, cursor key, webhooks) are removed. */
export function syntheticWorkerEnv(service: WorkerService, overrides: Env = {}): Env {
  const env = syntheticApiEnv({
    DATABASE_URL: syntheticDatabaseUrl(
      service === "email-worker" ? "app_email_runtime" : "app_reconciliation_runtime",
    ),
  });
  for (const key of [
    "STRIPE_WEBHOOK_SECRET",
    "RESEND_WEBHOOK_SECRET",
    "RATE_LIMIT_REDIS_URL",
    "RATE_LIMIT_HMAC_KEY",
    "LIST_CURSOR_HMAC_KEY",
  ])
    delete env[key];
  if (service === "email-worker") {
    for (const key of [
      "STRIPE_SECRET_KEY",
      "QR_KEYRING",
      "QR_PROTECTION_CURRENT_VERSION",
      "QR_ALLOWED_READ_VERSIONS",
    ])
      delete env[key];
    env.EMAIL_FROM = "sender@example.test";
  }
  return { ...env, ...overrides };
}
