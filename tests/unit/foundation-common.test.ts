import { describe, expect, it } from "vitest";
import { parseServerConfig } from "../../packages/config/src/index.ts";
import { createLogger } from "../../packages/observability/src/index.ts";
import {
  DeadlineError,
  isDatabaseRetryable,
  RETRY_POLICIES,
  retryDelay,
  withDeadline,
} from "../../packages/reliability/src/index.ts";
import { fingerprint, parseQrKeyring } from "../../packages/security/src/index.ts";

describe("common foundation contracts", () => {
  it("TC-COMMON-001 OBS-COR-005 fingerprint domain separation and bounded output", () => {
    const key = Buffer.alloc(32, 7);
    expect(fingerprint("auth-subject", "synthetic", key)).toBe("e1711cddf69ef8b8fa26674ccba61b4c");
    expect(fingerprint("auth-subject", "synthetic", key)).toMatch(/^[a-f0-9]{32}$/);
    expect(fingerprint("auth-subject", "synthetic", key)).not.toBe(
      fingerprint("network-source", "synthetic", key),
    );
  });
  it("TC-COMMON-002 INF-SEC-004 rejects invalid QR keyring without exposing input", () => {
    expect(() => parseQrKeyring("sensitive-invalid-input", "1", "1")).toThrow("Invalid QR keyring");
    const raw = JSON.stringify([
      {
        version: 1,
        hmacKey: Buffer.alloc(32, 1).toString("base64"),
        aeadKey: Buffer.alloc(32, 2).toString("base64"),
      },
    ]);
    const ring = parseQrKeyring(raw, "1", "1");
    expect(Object.isFrozen(ring)).toBe(true);
    expect(Object.isFrozen(ring.allowedReadVersions)).toBe(true);
    expect(() =>
      parseQrKeyring(
        raw.replace(Buffer.alloc(32, 2).toString("base64"), Buffer.alloc(32, 1).toString("base64")),
        "1",
        "1",
      ),
    ).toThrow();
    expect(() => parseQrKeyring(raw, "2", "1")).toThrow();
    expect(() => parseQrKeyring(raw, "1", "1,1")).toThrow();
    expect(() => parseQrKeyring(raw, "1", "1,2")).toThrow();
    const entries = JSON.parse(raw) as unknown[];
    expect(() => parseQrKeyring(JSON.stringify([...entries, ...entries]), "1", "1")).toThrow();
    expect(() => parseQrKeyring(raw, "1.1", "1")).toThrow();
    expect(() =>
      parseQrKeyring(raw.replace(Buffer.alloc(32, 1).toString("base64"), "invalid"), "1", "1"),
    ).toThrow();
    ring.keyFor(1).hmacKey.fill(99);
    expect(ring.keyFor(1).hmacKey[0]).toBe(1);
    expect(() => ring.keyFor(2)).toThrow();
  });
  it("TC-COMMON-003 REL-DB-001 retry is restricted to exact SQLSTATE allowlist", () => {
    expect(isDatabaseRetryable({ code: "40001" })).toBe(true);
    expect(isDatabaseRetryable({ code: "40P01" })).toBe(true);
    for (const code of ["55P03", "23505", "23P01", "08006"])
      expect(isDatabaseRetryable({ code })).toBe(false);
  });
  it("TC-COMMON-004 REL-TMO-003 deadline aborts and settles even when operation ignores abort", async () => {
    let signal: AbortSignal | undefined;
    await expect(
      withDeadline((s) => {
        signal = s;
        return new Promise(() => {});
      }, 5),
    ).rejects.toBeInstanceOf(DeadlineError);
    expect(signal?.aborted).toBe(true);
  });
  it("TC-COMMON-005 OBS-LOG-001 strict fields and sink isolation", () => {
    const logger = createLogger(
      { service: "API", environment: "test", actor_type: "SYSTEM_WORKER" },
      () => {
        throw new Error("private");
      },
    );
    expect(() =>
      logger.log({
        event_name: "security.fail_closed.triggered",
        level: "WARN",
        result: "REJECTED",
        is_retry: false,
      }),
    ).not.toThrow();
    expect(() =>
      logger.log({
        event_name: "security.fail_closed.triggered",
        level: "WARN",
        result: "REJECTED",
        is_retry: false,
        body: "secret",
      } as never),
    ).toThrow("Invalid log record");
  });
  it("TC-COMMON-006 INF-ENV-006 configuration errors never serialize secret values", () => {
    expect(() => parseServerConfig("api", { APP_ENV: "invalid-sensitive-value" })).toThrow(
      "Invalid server configuration",
    );
  });
  it("TC-COMMON-007 INF-SEC-003 email role has no QR or Stripe secret access", () => {
    const env = {
      PORT: "8080",
      DATABASE_ENV_MARKER_SETTING: "deployment.environment",
      NEON_PROJECT_ID_SETTING: "deployment.project_id",
      NEON_BRANCH_ID_SETTING: "deployment.branch_id",
      APP_ENV: "test",
      DATABASE_URL: syntheticDatabaseUrl("app_email_runtime"),
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
      EMAIL_FROM: "sender@example.test",
      APP_BASE_URL: "https://web.example.test",
    };
    const result = parseServerConfig("email-worker", env);
    expect(result.service).toBe("email-worker");
    expect("qrKeyring" in result).toBe(false);
    expect(result.database.tls.rejectUnauthorized).toBe(true);
    expect(() =>
      parseServerConfig("email-worker", { ...env, QR_KEYRING: "must-not-be-readable" }),
    ).toThrow();
    expect(() =>
      parseServerConfig("email-worker", {
        ...env,
        DATABASE_URL: env.DATABASE_URL.replace("verify-full", "disable"),
      }),
    ).toThrow();
    expect(() => parseServerConfig("email-worker", { ...env, APP_ENV: "production" })).toThrow();
  });
  it("TC-COMMON-008 DEV-REL-003 retry full jitter follows canonical policy bounds", () => {
    expect(RETRY_POLICIES["40001"]).toEqual({
      initialMs: 50,
      multiplier: 2,
      maxDelayMs: 400,
      maxAttempts: 4,
      maxElapsedMs: 2000,
      jitter: "full",
    });
    expect(RETRY_POLICIES["40P01"].maxElapsedMs).toBe(3000);
    for (const policy of Object.values(RETRY_POLICIES)) {
      for (let attempt = 1; attempt < policy.maxAttempts; attempt++) {
        expect(retryDelay(policy, attempt, () => 0)).toBe(0);
        expect(retryDelay(policy, attempt, () => 0.5)).toBe(
          Math.min(policy.maxDelayMs, policy.initialMs * 2 ** (attempt - 1)) / 2,
        );
      }
      expect(() => retryDelay(policy, policy.maxAttempts)).toThrow();
      expect(() => retryDelay(policy, 1, () => 1)).toThrow();
    }
  });
  it("TC-COMMON-009 DEV-REL-002 aborted and invalid deadlines never call operation", async () => {
    let called = false;
    const operation = async () => {
      called = true;
      return 1;
    };
    const controller = new AbortController();
    controller.abort();
    await expect(withDeadline(operation, 100, controller.signal)).rejects.toThrow(
      "Operation aborted",
    );
    await expect(withDeadline(operation, 0)).rejects.toThrow("Invalid deadline");
    expect(called).toBe(false);
  });
  it("TC-COMMON-010 OBS-LOG-001 serialized fields and async sink failures", async () => {
    const lines: string[] = [];
    const logger = createLogger(
      { service: "API", environment: "test", actor_type: "GUEST" },
      (line) => {
        lines.push(line);
        return Promise.reject(new Error("sensitive"));
      },
    );
    const input = {
      event_name: "http.request.completed",
      level: "INFO",
      result: "SUCCESS",
      is_retry: false,
      request_id: "10000000-0000-4000-8000-000000000001",
      http_method: "GET",
      http_route: "/health",
      http_status: 200,
    } as const;
    logger.log(input);
    await Promise.resolve();
    await Promise.resolve();
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      ...input,
      service: "API",
      environment: "test",
      actor_type: "GUEST",
      schema_version: 1,
    });
    expect(JSON.parse(lines[0] ?? "").timestamp).toMatch(/^\d{4}-.*\.\d{3}Z$/);
    expect(() => logger.log({ ...input, request_id: undefined } as never)).toThrow();
    for (const field of ["http_method", "http_route", "http_status"])
      expect(() => logger.log({ ...input, [field]: undefined } as never)).toThrow();
    for (const extra of [
      { body: "private" },
      { email: "person@example.test" },
      { unknown: "value" },
    ])
      expect(() => logger.log({ ...input, ...extra } as never)).toThrow();
  });
  it("TC-COMMON-012 INF-ENV-006 deployment mapping and metadata selectors are explicit strict configuration", () => {
    const env = serviceEnvironment("api");
    expect(parseServerConfig("api", env).database.directoryMapping).toBeUndefined();
    const mapping = {
      deploymentConfirmed: true,
      providerSchemaVersion: "synthetic-v1",
      schema: "provider_source",
      table: "identities",
      subjectColumn: "subject",
      emailColumn: "email_address",
      verifiedColumn: "verified",
    };
    const configured = parseServerConfig("api", {
      ...env,
      AUTH_DIRECTORY_SOURCE_MAPPING: JSON.stringify(mapping),
    });
    expect(configured.database.directoryMapping).toEqual(mapping);
    expect(Object.isFrozen(configured.database.directoryMapping)).toBe(true);
    expect(configured.database.metadata).toEqual([
      { setting: "deployment.project_id", expected: "synthetic-project" },
      { setting: "deployment.branch_id", expected: "synthetic-branch" },
    ]);
    for (const invalid of [
      { ...mapping, deploymentConfirmed: false },
      { ...mapping, table: "identities;DROP" },
      { ...mapping, providerSchemaVersion: "" },
      { ...mapping, extra: "unapproved" },
      { ...mapping, emailColumn: "subject" },
    ])
      expect(() =>
        parseServerConfig("api", {
          ...env,
          AUTH_DIRECTORY_SOURCE_MAPPING: JSON.stringify(invalid),
        }),
      ).toThrow("Invalid server configuration");
    expect(() =>
      parseServerConfig("api", { ...env, DATABASE_ENV_MARKER_SETTING: "unsafe;statement" }),
    ).toThrow();
  });
  it("TC-COMMON-011 INF-ENV-001 parses all service configs and rejects unsafe API origins", () => {
    for (const service of ["api", "email-worker", "reconciliation-worker"] as const) {
      const env = serviceEnvironment(service);
      const config = parseServerConfig(service, env);
      expect(config.service).toBe(service);
      expect(config.http.port).toBe(8080);
      if (config.service === "api") expect(config.http.port).toBe(8080);
      if (config.service === "email-worker") expect(config.email.from).toBe("sender@example.test");
    }
    const env = serviceEnvironment("api");
    for (const patch of [
      { APP_BASE_URL: "https://web.example.test/path" },
      { ALLOWED_ORIGINS: "*" },
      { ALLOWED_HOSTS: "*.example.test" },
      { ALLOWED_HOSTS: "api.example.test,*.example.test" },
      { ALLOWED_ORIGINS: "https://web.example.test,https://*.example.test" },
      { PUBLIC_AUTH_ORIGIN: "https://other.example.test" },
      { PORT: "0" },
      { PUBLIC_WEB_ORIGIN: "https://user:pass@web.example.test" },
      { APP_BASE_URL: "http://web.example.test" },
    ])
      expect(() => parseServerConfig("api", { ...env, ...patch })).toThrow();
    const prod = {
      ...env,
      APP_ENV: "production",
      EXPECTED_OBSERVABILITY_ENV: "production",
      EXPECTED_STRIPE_MODE: "live",
      STRIPE_SECRET_KEY: ["sk", "live", "synthetic"].join("_"),
    };
    expect(parseServerConfig("api", prod).environment).toBe("production");
    expect(() =>
      parseServerConfig("api", {
        ...prod,
        PUBLIC_WEB_ORIGIN: "https://web.other.test",
        APP_BASE_URL: "https://web.other.test",
        ALLOWED_ORIGINS: "https://web.other.test",
      }),
    ).toThrow();
    expect(() =>
      parseServerConfig("api", {
        ...prod,
        PUBLIC_WEB_ORIGIN: "https://a.github.io",
        APP_BASE_URL: "https://a.github.io",
        ALLOWED_ORIGINS: "https://a.github.io",
        PUBLIC_API_ORIGIN: "https://b.github.io",
        PUBLIC_AUTH_ORIGIN: "https://b.github.io",
        ALLOWED_HOSTS: "b.github.io",
      }),
    ).toThrow();
  });
});

function syntheticDatabaseUrl(role: string): string {
  const url = new URL("postgresql:" + "//db.example.test/business");
  url.username = role;
  url.password = "synthetic";
  url.port = "5432";
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}
function serviceEnvironment(
  service: "api" | "email-worker" | "reconciliation-worker",
): Record<string, string> {
  const roles = {
    api: "app_api_runtime",
    "email-worker": "app_email_runtime",
    "reconciliation-worker": "app_reconciliation_runtime",
  };
  const env: Record<string, string> = {
    PORT: "8080",
    DATABASE_ENV_MARKER_SETTING: "deployment.environment",
    NEON_PROJECT_ID_SETTING: "deployment.project_id",
    NEON_BRANCH_ID_SETTING: "deployment.branch_id",
    APP_ENV: "test",
    DATABASE_URL: syntheticDatabaseUrl(roles[service]),
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
  };
  if (service === "email-worker")
    return {
      ...env,
      EMAIL_FROM: "sender@example.test",
      EMAIL_REPLY_TO: "reply@example.test",
      APP_BASE_URL: "https://web.example.test",
    };
  Object.assign(env, {
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
  });
  if (service === "api")
    Object.assign(env, {
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
    });
  return env;
}
