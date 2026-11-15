import { TIMEOUTS } from "@off-r39x/reliability";
import { errors, exportJWK, importJWK, type JWK, type JWTVerifyGetKey, jwtVerify } from "jose";

/** The key material jose verifies with (a CryptoKey / KeyObject / secret), as importJWK returns it. */
type VerificationKey = Awaited<ReturnType<typeof importJWK>>;

import { z } from "zod";

export class AuthFailure extends Error {
  constructor(
    public readonly kind:
      | "unauthenticated"
      | "unavailable"
      | "database"
      | "denied"
      | "consistency"
      | "email",
  ) {
    super(kind);
  }
}
export interface VerifiedIdentity {
  readonly subject: string;
}
/** Result of the structural pre-check of an Authorization header (SEC-ABU-033 (a)). */
export type TokenInspection =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false };
export interface TokenVerifier {
  /**
   * SEC-ABU-033 (a): the structure check that runs before any signature verification and does no
   * cryptographic work. A verifier without it falls back to the plain Bearer format check.
   */
  inspect?(authorization: string | undefined): TokenInspection;
  verify(token: string): Promise<VerifiedIdentity>;
}
/** SPEC-150 REL-AUTH-002: a JWKS refresh starts at most once per 30 seconds per process. */
export const JWKS_MIN_REFRESH_INTERVAL_MS = 30_000;
/** SPEC-150 REL-AUTH-002: a cached trusted key is used for at most 600 seconds without revalidation. */
export const JWKS_KEY_MAX_AGE_MS = 600_000;
/** SPEC-140 SEC-ABU-033 (a): the longest token that is inspected at all. */
export const MAX_TOKEN_BYTES = 4096;

/** Elapsed time is measured on the monotonic clock, never the wall clock (REL-AUTH-002). */
const monotonicNow = (): number => performance.now();

const jwksDocument = z.object({ keys: z.array(z.record(z.string(), z.unknown())) });

export interface JwksKeyResolverOptions {
  readonly jwksUrl: string;
  /** Test seams. `now` is a monotonic millisecond clock. */
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly minRefreshIntervalMs?: number;
  readonly maxKeyAgeMs?: number;
  readonly timeoutMs?: number;
}

/**
 * The trusted key resolver (REL-AUTH-002). Keys are cached by `kid` for at most 600 seconds. An
 * unknown `kid`, or one whose cached key has expired, needs a refresh: single-flight and started at
 * most once per 30 seconds. While a refresh is in flight, or within the interval, a token that the
 * cache cannot verify is `unavailable` at once (never waited for, never counted as an auth failure,
 * and an expired key is never used). The request that starts a refresh waits for it; a `kid` absent
 * from the refreshed JWKS is `unauthenticated` (the expired key is discarded). A refresh that cannot
 * be completed is `unavailable`. All elapsed times use a monotonic clock.
 */
export function createJwksKeyResolver(options: JwksKeyResolverOptions): JWTVerifyGetKey {
  const url = new URL(options.jwksUrl);
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? monotonicNow;
  const interval = options.minRefreshIntervalMs ?? JWKS_MIN_REFRESH_INTERVAL_MS;
  const maxAge = options.maxKeyAgeMs ?? JWKS_KEY_MAX_AGE_MS;
  const timeoutMs = options.timeoutMs ?? TIMEOUTS.jwksMs;
  let cache = new Map<string, { key: VerificationKey; expiresAt: number }>();
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | undefined;

  async function refresh(startedAt: number): Promise<void> {
    try {
      const response = await fetcher(url, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
      if (!response.ok) throw new Error("JWKS endpoint failed");
      const document = jwksDocument.parse(await response.json());
      const fresh = new Map<string, { key: VerificationKey; expiresAt: number }>();
      for (const entry of document.keys) {
        if (typeof entry.kid !== "string" || entry.kty !== "OKP" || entry.crv !== "Ed25519")
          continue;
        fresh.set(entry.kid, {
          key: await importJWK(entry as JWK, "EdDSA"),
          expiresAt: startedAt + maxAge,
        });
      }
      // A key that is present is revalidated (its lifetime restarts); an absent one is discarded.
      cache = fresh;
    } catch {
      throw new AuthFailure("unavailable");
    }
  }

  return async (header) => {
    const kid = typeof header.kid === "string" ? header.kid : undefined;
    if (kid === undefined) throw new AuthFailure("unauthenticated");
    const cached = cache.get(kid);
    if (cached && now() < cached.expiresAt) return cached.key;
    if (inFlight || now() - lastStartedAt < interval) throw new AuthFailure("unavailable");
    const startedAt = now();
    lastStartedAt = startedAt;
    inFlight = refresh(startedAt).finally(() => {
      inFlight = undefined;
    });
    await inFlight;
    const refreshed = cache.get(kid);
    if (!refreshed) throw new AuthFailure("unauthenticated");
    return refreshed.key;
  };
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;
function decodeSegment(segment: string): Record<string, unknown> | undefined {
  if (!BASE64URL.test(segment)) return undefined;
  try {
    const base64 = segment.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * SEC-ABU-033 (a): the structural check made before a signature is verified. It does no cryptographic
 * work: the Bearer format, the length (4,096 bytes), three base64url segments, the header `alg` (only
 * an allowed one) and `kid`, the payload `iss` (exact) and an `exp` in the future.
 */
export function inspectBearerToken(
  authorization: string | undefined,
  rules: {
    readonly issuer: string;
    readonly algorithms: readonly string[];
    /** Epoch seconds. */
    readonly nowSeconds?: () => number;
  },
): TokenInspection {
  const rejected = { ok: false } as const;
  if (authorization === undefined || !authorization.startsWith("Bearer ")) return rejected;
  const token = authorization.slice("Bearer ".length);
  if (new TextEncoder().encode(token).byteLength > MAX_TOKEN_BYTES) return rejected;
  const segments = token.split(".");
  if (segments.length !== 3 || !segments.every((segment) => BASE64URL.test(segment)))
    return rejected;
  const header = decodeSegment(segments[0] ?? "");
  const payload = decodeSegment(segments[1] ?? "");
  if (!header || !payload) return rejected;
  if (typeof header.alg !== "string" || !rules.algorithms.includes(header.alg)) return rejected;
  if (typeof header.kid !== "string" || header.kid.length === 0) return rejected;
  if (payload.iss !== rules.issuer) return rejected;
  const nowSeconds = (rules.nowSeconds ?? (() => Date.now() / 1000))();
  if (typeof payload.exp !== "number" || !(payload.exp > nowSeconds)) return rejected;
  return { ok: true, token };
}

export function createTokenVerifier(
  config: { issuer: string; audience: string; jwksUrl: string },
  key?: JWTVerifyGetKey,
): TokenVerifier {
  const url = new URL(config.jwksUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Error("Invalid JWKS configuration");
  const resolve = key ?? createJwksKeyResolver({ jwksUrl: config.jwksUrl });
  return {
    inspect: (authorization) =>
      inspectBearerToken(authorization, { issuer: config.issuer, algorithms: ["EdDSA"] }),
    async verify(token) {
      try {
        const { payload, protectedHeader } = await jwtVerify(
          token,
          async (header, token) => {
            // Separate trusted key acquisition failures from token verification failures.
            // jose also uses ordinary JOSEError for upstream HTTP/JSON failures.
            let resolved: Awaited<ReturnType<JWTVerifyGetKey>>;
            try {
              resolved = await resolve(header, token);
            } catch (error) {
              if (error instanceof AuthFailure) throw error;
              if (
                error instanceof errors.JWKSNoMatchingKey ||
                error instanceof errors.JOSENotSupported
              )
                throw new AuthFailure("unauthenticated");
              throw new AuthFailure("unavailable");
            }
            const jwk =
              "kty" in resolved
                ? resolved
                : await exportJWK(resolved as Parameters<typeof exportJWK>[0]);
            if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519")
              throw new AuthFailure("unauthenticated");
            return resolved;
          },
          {
            issuer: config.issuer,
            audience: config.audience,
            algorithms: ["EdDSA"],
            requiredClaims: ["sub", "iat", "exp"],
            clockTolerance: 0,
            maxTokenAge: 900,
          },
        );
        if (
          protectedHeader.alg !== "EdDSA" ||
          !z.uuid().safeParse(payload.sub).success ||
          typeof payload.iat !== "number" ||
          typeof payload.exp !== "number" ||
          !Number.isInteger(payload.iat) ||
          !Number.isInteger(payload.exp) ||
          payload.exp <= payload.iat ||
          payload.exp - payload.iat > 900 ||
          payload.iat > Math.floor(Date.now() / 1000)
        )
          throw new AuthFailure("unauthenticated");
        return { subject: payload.sub as string };
      } catch (error) {
        if (error instanceof AuthFailure) throw error;
        if (
          error instanceof errors.JWKSTimeout ||
          error instanceof errors.JWKSInvalid ||
          (error instanceof TypeError && !key)
        )
          throw new AuthFailure("unavailable");
        if (error instanceof errors.JOSEError) throw new AuthFailure("unauthenticated");
        throw new AuthFailure("unavailable");
      }
    },
  };
}

export const capabilities = [
  "public.read",
  "profile.self.read",
  "profile.self.update",
  "orders.self.read",
  "tickets.self.read",
  "karaoke.self.read",
  "goods.self.read",
  "purchase.start",
  "entry_checkin.execute",
  "karaoke_checkin.execute",
  "goods_handoff.execute",
  "orders.manage.read",
  "tickets.manage.read",
  "entry_sales.manage",
  "karaoke_slots.manage",
  "karaoke_sales.manage",
  "karaoke_reservations.manage.read",
  "goods_inventory.manage",
  "goods_handoff.manage",
  "public_content.manage",
  "role_assignment.manage",
  "recovery.review",
  "recovery.exception.execute",
] as const;
export type Capability = (typeof capabilities)[number];
export type OperationalRole = "STAFF" | "ADMINISTRATOR";
export interface Principal {
  readonly subject: string;
  readonly profileRef: string;
  readonly emailVerified: boolean;
  readonly roles: readonly OperationalRole[];
}
export interface PrincipalRecord {
  directory: { authSubject: string; emailVerified: boolean } | null;
  profile: { id: string; publicRef: string; authSubject: string } | null;
  roles: readonly string[];
}
export interface PrincipalStore {
  findByAuthSubject(subject: string): Promise<PrincipalRecord>;
}
export async function resolvePrincipal(
  identity: VerifiedIdentity,
  store: PrincipalStore,
): Promise<Principal> {
  let row: PrincipalRecord;
  try {
    row = await store.findByAuthSubject(identity.subject);
  } catch {
    throw new AuthFailure("database");
  }
  if (!row.directory) throw new AuthFailure("unauthenticated");
  if (!row.profile) throw new AuthFailure("denied");
  if (
    row.directory.authSubject !== identity.subject ||
    row.profile.authSubject !== identity.subject ||
    !z.uuid().safeParse(row.profile.publicRef).success ||
    typeof row.directory.emailVerified !== "boolean" ||
    row.roles.some((role) => role !== "STAFF" && role !== "ADMINISTRATOR")
  )
    throw new AuthFailure("consistency");
  return {
    subject: identity.subject,
    profileRef: row.profile.publicRef,
    emailVerified: row.directory.emailVerified,
    roles: row.roles as OperationalRole[],
  };
}
export function hasCapability(principal: Principal, capability: Capability): boolean {
  if (!Object.hasOwn(capabilityAuthorities, capability)) return false;
  const authority = capabilityAuthorities[capability];
  // Self paths still require ownership; recovery exceptions require canonical operation constraints.
  return authority === "AUTHENTICATED" || principal.roles.includes(authority);
}
export const capabilityAuthorities = {
  "public.read": "AUTHENTICATED",
  "profile.self.read": "AUTHENTICATED",
  "profile.self.update": "AUTHENTICATED",
  "orders.self.read": "AUTHENTICATED",
  "tickets.self.read": "AUTHENTICATED",
  "karaoke.self.read": "AUTHENTICATED",
  "goods.self.read": "AUTHENTICATED",
  "purchase.start": "AUTHENTICATED",
  "entry_checkin.execute": "STAFF",
  "karaoke_checkin.execute": "STAFF",
  "goods_handoff.execute": "STAFF",
  "orders.manage.read": "ADMINISTRATOR",
  "tickets.manage.read": "ADMINISTRATOR",
  "entry_sales.manage": "ADMINISTRATOR",
  "karaoke_slots.manage": "ADMINISTRATOR",
  "karaoke_sales.manage": "ADMINISTRATOR",
  "karaoke_reservations.manage.read": "ADMINISTRATOR",
  "goods_inventory.manage": "ADMINISTRATOR",
  "goods_handoff.manage": "ADMINISTRATOR",
  "public_content.manage": "ADMINISTRATOR",
  "role_assignment.manage": "ADMINISTRATOR",
  "recovery.review": "ADMINISTRATOR",
  "recovery.exception.execute": "ADMINISTRATOR",
} as const satisfies Record<Capability, "AUTHENTICATED" | OperationalRole>;
