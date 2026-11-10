import { describe, expect, it } from "vitest";
import { parseServerConfig } from "../../packages/config/src/index.ts";
import { ceilingConfigText, rateLimitEnv } from "../harness/rate-limit/api.ts";

function url(role: string): string {
  const value = new URL("postgresql:" + "//db.example.test/business");
  value.username = role;
  value.password = "synthetic";
  value.searchParams.set("sslmode", "verify-full");
  return value.href;
}
function apiEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    DATABASE_ENV_MARKER_SETTING: "deployment.environment",
    NEON_PROJECT_ID_SETTING: "deployment.project_id",
    NEON_BRANCH_ID_SETTING: "deployment.branch_id",
    APP_ENV: "test",
    DATABASE_URL: url("app_api_runtime"),
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
    ...overrides,
  };
}
const parse = (overrides: Record<string, string | undefined>) =>
  parseServerConfig("api", apiEnv(overrides));
const config = (value: unknown) => JSON.stringify(value);
const base = JSON.parse(ceilingConfigText());

describe("API startup validation of the rate limit configuration (TST-RLM-006, INF-RLS-009, INF-HLT-004)", () => {
  it("TC-RLM-006-101 a complete valid configuration is parsed; development/test may use values below the ceiling", () => {
    const parsed = parse({});
    if (parsed.service !== "api") throw new Error("expected api");
    expect(parsed.rateLimit.trustedProxyHops).toBe(0);
    expect(parsed.rateLimit.hmacKeyVersion).toBe(1);
    expect(parsed.rateLimit.hmacKey()).toHaveLength(32);
    expect(parsed.rateLimit.config.self_read.burstLimit).toBe(30);
    const small = parse({
      RATE_LIMIT_CONFIG: config({ ...base, self_read: { ...base.self_read, burst_limit: 2 } }),
    });
    if (small.service !== "api") throw new Error("expected api");
    expect(small.rateLimit.config.self_read.burstLimit).toBe(2);
  });

  for (const [name, value] of [
    ["missing", undefined],
    ["empty", ""],
    ["unparsable", "{not json"],
    ["not an object", "[]"],
    ["a Class ID missing", config({ ...base, self_read: undefined })],
    ["an unknown Class ID", config({ ...base, made_up_class: base.self_read })],
    ["zero", config({ ...base, self_read: { ...base.self_read, burst_limit: 0 } })],
    ["negative", config({ ...base, self_read: { ...base.self_read, burst_limit: -1 } })],
    ["non-integer", config({ ...base, self_read: { ...base.self_read, burst_limit: 1.5 } })],
    [
      "above the canonical ceiling",
      config({ ...base, self_read: { ...base.self_read, burst_limit: 31 } }),
    ],
    [
      "a missing additional rule",
      config({ ...base, public_read: { burst_limit: 20, sustained_limit: 120 } }),
    ],
  ] as [string, string | undefined][])
    it(`TC-RLM-006-102 RATE_LIMIT_CONFIG ${name} makes the API configuration invalid (no implicit fallback)`, () => {
      expect(() => parse({ RATE_LIMIT_CONFIG: value })).toThrow("Invalid server configuration");
    });

  for (const [name, value, valid] of [
    ["missing", undefined, false],
    ["empty", "", false],
    ["negative", "-1", false],
    ["non-integer", "1.5", false],
    ["text", "one", false],
    ["padded", " 1", false],
    ["zero is the explicit direct-peer value", "0", true],
    ["one hop", "1", true],
  ] as [string, string | undefined, boolean][])
    it(`TC-RLM-006-103 TRUSTED_PROXY_HOPS ${name}`, () => {
      const run = () => parse({ TRUSTED_PROXY_HOPS: value });
      if (valid) expect(run).not.toThrow();
      else expect(run).toThrow("Invalid server configuration");
    });

  for (const [name, overrides] of [
    ["RATE_LIMIT_HMAC_KEY missing", { RATE_LIMIT_HMAC_KEY: undefined }],
    [
      "RATE_LIMIT_HMAC_KEY not 32 bytes",
      { RATE_LIMIT_HMAC_KEY: Buffer.alloc(16).toString("base64") },
    ],
    ["RATE_LIMIT_HMAC_KEY_VERSION missing", { RATE_LIMIT_HMAC_KEY_VERSION: undefined }],
    ["RATE_LIMIT_HMAC_KEY_VERSION zero", { RATE_LIMIT_HMAC_KEY_VERSION: "0" }],
    ["RATE_LIMIT_REDIS_URL missing", { RATE_LIMIT_REDIS_URL: undefined }],
    [
      "RATE_LIMIT_REDIS_URL not a Redis URL",
      { RATE_LIMIT_REDIS_URL: "https://redis.example.test" },
    ],
  ] as [string, Record<string, string | undefined>][])
    it(`TC-RLM-006-104 ${name} makes the API configuration invalid`, () => {
      expect(() => parse(overrides)).toThrow("Invalid server configuration");
    });

  it("TC-RLM-006-105 the configuration error never contains the offending value", () => {
    try {
      parse({ RATE_LIMIT_HMAC_KEY: "super-secret-not-a-key" });
      throw new Error("expected failure");
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("super-secret");
    }
  });

  it("TC-RLM-006-106 the rate limit Secrets are readable only by the API service (INF-SEC-003)", () => {
    const worker = (
      service: "email-worker" | "reconciliation-worker",
      extra: Record<string, string>,
    ) => {
      const env = apiEnv({
        DATABASE_URL: url(
          service === "email-worker" ? "app_email_runtime" : "app_reconciliation_runtime",
        ),
      });
      for (const key of [
        "STRIPE_WEBHOOK_SECRET",
        "RESEND_WEBHOOK_SECRET",
        "RATE_LIMIT_REDIS_URL",
        "RATE_LIMIT_HMAC_KEY",
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
      return () => parseServerConfig(service, { ...env, ...extra });
    };
    for (const service of ["email-worker", "reconciliation-worker"] as const) {
      expect(worker(service, {})).not.toThrow();
      expect(worker(service, { RATE_LIMIT_REDIS_URL: "redis://127.0.0.1:6379" })).toThrow();
      expect(
        worker(service, { RATE_LIMIT_HMAC_KEY: Buffer.alloc(32, 7).toString("base64") }),
      ).toThrow();
    }
  });
});
