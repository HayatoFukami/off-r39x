import { decodeSecretKey, parseQrKeyring } from "@off-r39x/security";
import { getDomain } from "tldts";
import { z } from "zod";

export { getBuildMigrationSetHash } from "./build.ts";

const text = z.string().min(1).max(4096);
const positive = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().int().max(2147483647));
const https = text.refine((value) => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.hash;
  } catch {
    return false;
  }
});
const common = z.object({
  PORT: positive.pipe(z.number().max(65535)),
  DATABASE_ENV_MARKER_SETTING: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
  NEON_PROJECT_ID_SETTING: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
  NEON_BRANCH_ID_SETTING: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
  APP_ENV: z.enum(["production", "staging", "development", "test"]),
  DATABASE_URL: text,
  EXPECTED_NEON_PROJECT_ID: text,
  EXPECTED_NEON_BRANCH_ID: text,
  EXPECTED_NEON_DATABASE_NAME: text,
  EXPECTED_STRIPE_MODE: z.enum(["live", "test"]),
  EXPECTED_RESEND_ENV_ID: text,
  EXPECTED_OBSERVABILITY_ENV: z.enum(["production", "staging", "development", "test"]),
  EXPECTED_DATABASE_ENV_MARKER: text,
  OBS_CORRELATION_HMAC_KEY: text,
  OBS_CORRELATION_HMAC_KEY_VERSION: positive,
});
const identifier = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/);
const directoryMappingSchema = z
  .object({
    deploymentConfirmed: z.literal(true),
    providerSchemaVersion: z.string().trim().min(1).max(128),
    schema: identifier,
    table: identifier,
    subjectColumn: identifier,
    emailColumn: identifier,
    verifiedColumn: identifier,
  })
  .strict()
  .refine(
    (value) => new Set([value.subjectColumn, value.emailColumn, value.verifiedColumn]).size === 3,
  );
/** Deployment assertion only; readiness must verify provider types, cardinality and grants. */
export type DirectorySourceMapping = z.infer<typeof directoryMappingSchema>;
const auth = z.object({ AUTH_ISSUER: https, AUTH_AUDIENCE: text, AUTH_JWKS_URL: https });
const origin = https.refine(
  (value) => new URL(value).origin === value && !new URL(value).hostname.includes("*"),
);
const host = text.refine((value) => {
  try {
    const parsed = new URL(`https://${value}`);
    return (
      parsed.host === value &&
      !parsed.hostname.includes("*") &&
      parsed.pathname === "/" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash
    );
  } catch {
    return false;
  }
});
const origins = text
  .transform((value) => value.split(","))
  .pipe(z.array(origin).min(1))
  .refine((values) => new Set(values).size === values.length);
const hosts = text
  .transform((value) => value.split(","))
  .pipe(z.array(host).min(1))
  .refine((values) => new Set(values).size === values.length);
const http = z.object({
  PORT: positive.pipe(z.number().max(65535)),
  APP_BASE_URL: origin,
  PUBLIC_WEB_ORIGIN: origin,
  PUBLIC_API_ORIGIN: origin,
  PUBLIC_AUTH_ORIGIN: origin,
  ALLOWED_HOSTS: hosts,
  ALLOWED_ORIGINS: origins,
});
const email = z.object({
  EMAIL_FROM: z.email(),
  EMAIL_REPLY_TO: z.email().optional(),
  APP_BASE_URL: origin,
});
const qr = z.object({
  QR_PROTECTION_CURRENT_VERSION: text,
  QR_ALLOWED_READ_VERSIONS: text,
  QR_KEYRING: text,
});
const provider = z.object({ RESEND_API_KEY: text });
const stripe = z.object({ STRIPE_SECRET_KEY: text });
export type Service = "api" | "email-worker" | "reconciliation-worker";
const roles = {
  api: "app_api_runtime",
  "email-worker": "app_email_runtime",
  "reconciliation-worker": "app_reconciliation_runtime",
} as const;
const forbiddenAll = [
  "MIGRATION_DATABASE_URL",
  "BACKUP_DATABASE_URL",
  "EMERGENCY_DATABASE_URL",
  "NEON_API_KEY",
  "GOOGLE_CLIENT_SECRET",
  "AUTH_SMTP_PASSWORD",
  "R2_SECRET_ACCESS_KEY",
];
function parse(service: Service, env: Readonly<Record<string, string | undefined>>) {
  const base = common.parse(env);
  if (
    new Set([
      base.DATABASE_ENV_MARKER_SETTING,
      base.NEON_PROJECT_ID_SETTING,
      base.NEON_BRANCH_ID_SETTING,
    ]).size !== 3
  )
    throw new Error();
  const directoryMapping =
    env.AUTH_DIRECTORY_SOURCE_MAPPING === undefined
      ? undefined
      : Object.freeze(directoryMappingSchema.parse(JSON.parse(env.AUTH_DIRECTORY_SOURCE_MAPPING)));
  if (
    base.EXPECTED_OBSERVABILITY_ENV !== base.APP_ENV ||
    (base.APP_ENV === "production"
      ? base.EXPECTED_STRIPE_MODE !== "live"
      : base.EXPECTED_STRIPE_MODE !== "test")
  )
    throw new Error();
  const forbidden = [
    ...forbiddenAll,
    ...(service === "email-worker"
      ? [
          "STRIPE_SECRET_KEY",
          "STRIPE_WEBHOOK_SECRET",
          "RESEND_WEBHOOK_SECRET",
          "QR_KEYRING",
          "QR_PROTECTION_CURRENT_VERSION",
          "QR_ALLOWED_READ_VERSIONS",
        ]
      : service === "reconciliation-worker"
        ? ["STRIPE_WEBHOOK_SECRET", "RESEND_WEBHOOK_SECRET"]
        : []),
  ];
  if (forbidden.some((key) => env[key] !== undefined)) throw new Error();
  const url = new URL(base.DATABASE_URL);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    (url.port && url.port !== "5432") ||
    url.hostname.includes("-pooler") ||
    url.searchParams.get("sslmode") !== "verify-full" ||
    decodeURIComponent(url.username) !== roles[service] ||
    decodeURIComponent(url.pathname.slice(1)) !== base.EXPECTED_NEON_DATABASE_NAME ||
    !url.password
  )
    throw new Error();
  const credentials = provider.parse(env);
  const correlationKey = decodeSecretKey(base.OBS_CORRELATION_HMAC_KEY);
  const shared = {
    environment: base.APP_ENV,
    http: Object.freeze({ port: base.PORT }),
    database: Object.freeze({
      ...(directoryMapping ? { directoryMapping } : {}),
      environmentMarkerSetting: base.DATABASE_ENV_MARKER_SETTING,
      metadata: Object.freeze([
        Object.freeze({
          setting: base.NEON_PROJECT_ID_SETTING,
          expected: base.EXPECTED_NEON_PROJECT_ID,
        }),
        Object.freeze({
          setting: base.NEON_BRANCH_ID_SETTING,
          expected: base.EXPECTED_NEON_BRANCH_ID,
        }),
      ]),
      connectionString: base.DATABASE_URL,
      role: roles[service],
      tls: Object.freeze({ rejectUnauthorized: true as const, servername: url.hostname }),
      applicationName: `r39x/${base.APP_ENV}/${service}`,
      expectedProjectId: base.EXPECTED_NEON_PROJECT_ID,
      expectedBranchId: base.EXPECTED_NEON_BRANCH_ID,
      expectedDatabaseName: base.EXPECTED_NEON_DATABASE_NAME,
      expectedEnvironmentMarker: base.EXPECTED_DATABASE_ENV_MARKER,
    }),
    observability: Object.freeze({
      environment: base.EXPECTED_OBSERVABILITY_ENV,
      correlationKeyVersion: base.OBS_CORRELATION_HMAC_KEY_VERSION,
      correlationKey: () => correlationKey.slice(),
    }),
    resend: Object.freeze({
      apiKey: credentials.RESEND_API_KEY,
      expectedEnvironmentId: base.EXPECTED_RESEND_ENV_ID,
    }),
  };
  if (service === "email-worker") {
    const input = email.parse(env);
    return Object.freeze({
      service,
      ...shared,
      email: Object.freeze({
        from: input.EMAIL_FROM,
        ...(input.EMAIL_REPLY_TO ? { replyTo: input.EMAIL_REPLY_TO } : {}),
        appBaseUrl: input.APP_BASE_URL,
      }),
    });
  }
  const qrInput = qr.parse(env);
  const keyring = parseQrKeyring(
    qrInput.QR_KEYRING,
    qrInput.QR_PROTECTION_CURRENT_VERSION,
    qrInput.QR_ALLOWED_READ_VERSIONS,
  );
  const stripeInput = stripe.parse(env);
  if (
    !stripeInput.STRIPE_SECRET_KEY.startsWith(
      base.EXPECTED_STRIPE_MODE === "live" ? "sk_live_" : "sk_test_",
    )
  )
    throw new Error();
  const protectedConfig = {
    ...shared,
    qrKeyring: keyring,
    stripe: Object.freeze({
      secretKey: stripeInput.STRIPE_SECRET_KEY,
      expectedMode: base.EXPECTED_STRIPE_MODE,
    }),
  };
  if (service === "reconciliation-worker") return Object.freeze({ service, ...protectedConfig });
  const authInput = auth.parse(env);
  const httpInput = http.parse(env);
  if (
    httpInput.PUBLIC_AUTH_ORIGIN !== httpInput.PUBLIC_API_ORIGIN ||
    httpInput.APP_BASE_URL !== httpInput.PUBLIC_WEB_ORIGIN ||
    !httpInput.ALLOWED_HOSTS.includes(new URL(httpInput.PUBLIC_API_ORIGIN).host) ||
    !httpInput.ALLOWED_ORIGINS.includes(httpInput.PUBLIC_WEB_ORIGIN)
  )
    throw new Error();
  if (base.APP_ENV === "production") {
    const webHost = new URL(httpInput.PUBLIC_WEB_ORIGIN).hostname;
    const apiHost = new URL(httpInput.PUBLIC_API_ORIGIN).hostname;
    const webDomain = getDomain(webHost, { allowPrivateDomains: true }),
      apiDomain = getDomain(apiHost, { allowPrivateDomains: true });
    if (!webDomain || webDomain !== apiDomain) throw new Error();
  }
  const webhooks = z
    .object({ STRIPE_WEBHOOK_SECRET: text, RESEND_WEBHOOK_SECRET: text })
    .parse(env);
  return Object.freeze({
    service,
    ...protectedConfig,
    http: Object.freeze({
      port: httpInput.PORT,
      appBaseUrl: httpInput.APP_BASE_URL,
      publicWebOrigin: httpInput.PUBLIC_WEB_ORIGIN,
      publicApiOrigin: httpInput.PUBLIC_API_ORIGIN,
      publicAuthOrigin: httpInput.PUBLIC_AUTH_ORIGIN,
      allowedHosts: Object.freeze(httpInput.ALLOWED_HOSTS),
      allowedOrigins: Object.freeze(httpInput.ALLOWED_ORIGINS),
    }),
    auth: Object.freeze({
      issuer: authInput.AUTH_ISSUER,
      audience: authInput.AUTH_AUDIENCE,
      jwksUrl: authInput.AUTH_JWKS_URL,
    }),
    webhooks: Object.freeze({
      stripe: webhooks.STRIPE_WEBHOOK_SECRET,
      resend: webhooks.RESEND_WEBHOOK_SECRET,
    }),
  });
}
export type ServerConfig = ReturnType<typeof parse>;
/** Syntactic startup validation only. DB/provider identity must be checked before readiness. */
export function parseServerConfig(
  service: Service,
  env: Readonly<Record<string, string | undefined>>,
): ServerConfig {
  try {
    if (!Object.hasOwn(roles, service)) throw new Error();
    return parse(service, env);
  } catch {
    throw new Error("Invalid server configuration");
  }
}
