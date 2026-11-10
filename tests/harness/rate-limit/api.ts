import type { AppRateLimit } from "../../../apps/api/src/api/app.ts";
import {
  createRateLimiter,
  parseRateLimitConfig,
  RATE_LIMIT_CLASS_IDS,
  RATE_LIMIT_REGISTRY,
  type RateLimiterOptions,
  type RateLimitStore,
} from "../../../packages/security/src/index.ts";
import { type FaultyStore, withFault } from "./faults.ts";
import { createMemoryStore, type MemoryStore } from "./memory-store.ts";

/** Every Class ID at its canonical ceiling, optionally replaced per class (synthetic, test only). */
export function ceilingConfigText(overrides: Record<string, unknown> = {}): string {
  const config: Record<string, unknown> = Object.fromEntries(
    RATE_LIMIT_CLASS_IDS.map((id) => {
      const definition = RATE_LIMIT_REGISTRY[id];
      const extra = Object.entries(
        definition.additional as Record<string, { ceiling: number; windowSeconds: number }>,
      );
      return [
        id,
        {
          burst_limit: definition.burst,
          sustained_limit: definition.sustained,
          ...(extra.length
            ? {
                additional: Object.fromEntries(
                  extra.map(([ruleId, rule]) => [
                    ruleId,
                    { limit: rule.ceiling, window_seconds: rule.windowSeconds },
                  ]),
                ),
              }
            : {}),
        },
      ];
    }),
  );
  return JSON.stringify({ ...config, ...overrides });
}

export const TEST_HMAC_KEY = new Uint8Array(32).fill(5);

/** Synthetic RATE_LIMIT_* / TRUSTED_PROXY_HOPS environment for bootstrap / config tests. */
export function rateLimitEnv(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Record<string, string | undefined> {
  return {
    RATE_LIMIT_REDIS_URL: "redis://127.0.0.1:6379",
    RATE_LIMIT_HMAC_KEY: Buffer.alloc(32, 7).toString("base64"),
    RATE_LIMIT_HMAC_KEY_VERSION: "1",
    RATE_LIMIT_CONFIG: ceilingConfigText(),
    TRUSTED_PROXY_HOPS: "0",
    ...overrides,
  };
}

/** Node-server style bindings so `app.request(..., env)` carries a socket peer address. */
export const peer = (ip = "203.0.113.9") => ({ incoming: { socket: { remoteAddress: ip } } });

export interface TestRateLimit {
  readonly rateLimit: AppRateLimit;
  readonly store: MemoryStore;
  readonly faults: FaultyStore;
}
export function createTestRateLimit(
  options: {
    readonly store?: RateLimitStore;
    readonly overrides?: Record<string, unknown>;
    readonly trustedProxyHops?: number;
    readonly limiter?: Partial<RateLimiterOptions>;
  } = {},
): TestRateLimit {
  const store = createMemoryStore();
  const faults = withFault(options.store ?? store);
  const limiter = createRateLimiter({
    store: faults,
    config: parseRateLimitConfig(ceilingConfigText(options.overrides)),
    hmacKey: TEST_HMAC_KEY,
    hmacKeyVersion: 1,
    ...options.limiter,
  });
  return { rateLimit: { limiter, trustedProxyHops: options.trustedProxyHops ?? 0 }, store, faults };
}
