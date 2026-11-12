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
export interface TokenVerifier {
  verify(token: string): Promise<VerifiedIdentity>;
}
/** SPEC-150 REL-AUTH-002: a JWKS refresh starts at most once per 30 seconds per process. */
export const JWKS_MIN_REFRESH_INTERVAL_MS = 30_000;

const jwksDocument = z.object({ keys: z.array(z.record(z.string(), z.unknown())) });

export interface JwksKeyResolverOptions {
  readonly jwksUrl: string;
  /** Test seams. */
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly minRefreshIntervalMs?: number;
  readonly timeoutMs?: number;
}

/**
 * The trusted key resolver. Keys are cached by `kid`. An unknown `kid` starts one refresh, single-
 * flight and at most once per interval: while a refresh is in flight, or within the interval, a token
 * that the cache cannot verify is `unavailable` at once (never waited for, never counted as an auth
 * failure). The request that starts a refresh waits for it; a `kid` still unknown after it is
 * `unauthenticated`. A refresh that cannot be completed is `unavailable`.
 */
export function createJwksKeyResolver(options: JwksKeyResolverOptions): JWTVerifyGetKey {
  const url = new URL(options.jwksUrl);
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? (() => Date.now());
  const interval = options.minRefreshIntervalMs ?? JWKS_MIN_REFRESH_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? TIMEOUTS.jwksMs;
  let cache = new Map<string, VerificationKey>();
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | undefined;

  async function refresh(): Promise<void> {
    try {
      const response = await fetcher(url, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
      if (!response.ok) throw new Error("JWKS endpoint failed");
      const document = jwksDocument.parse(await response.json());
      const fresh = new Map<string, VerificationKey>();
      for (const entry of document.keys) {
        if (typeof entry.kid !== "string" || entry.kty !== "OKP" || entry.crv !== "Ed25519")
          continue;
        fresh.set(entry.kid, await importJWK(entry as JWK, "EdDSA"));
      }
      cache = fresh;
    } catch {
      throw new AuthFailure("unavailable");
    }
  }

  return async (header) => {
    const kid = typeof header.kid === "string" ? header.kid : undefined;
    if (kid === undefined) throw new AuthFailure("unauthenticated");
    const cached = cache.get(kid);
    if (cached) return cached;
    if (inFlight || now() - lastStartedAt < interval) throw new AuthFailure("unavailable");
    lastStartedAt = now();
    inFlight = refresh().finally(() => {
      inFlight = undefined;
    });
    await inFlight;
    const refreshed = cache.get(kid);
    if (!refreshed) throw new AuthFailure("unauthenticated");
    return refreshed;
  };
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
