// SEC-ABU-010 / INF-RLS-009 / SEC-API-030: two-layer configuration. The canonical ceiling lives
// in the registry; RATE_LIMIT_CONFIG supplies the effective values. There is no implicit fallback
// to the ceiling: a missing/zero/negative/non-integer/unparsable/over-ceiling value is an error.
import { z } from "zod";
import {
  type AdditionalRuleId,
  classDefinition,
  RATE_LIMIT_CLASS_IDS,
  type RateLimitClassId,
} from "./registry.ts";

const positiveInteger = z.number().int().positive().max(2147483647);

function additionalSchema(id: RateLimitClassId) {
  const shape: Record<string, z.ZodType> = {};
  for (const [ruleId, rule] of Object.entries(classDefinition(id).additional))
    shape[ruleId] = z.strictObject({
      limit: positiveInteger.max(rule.ceiling),
      // The window is part of the canonical rule; only the limit may be tightened.
      window_seconds: z.literal(rule.windowSeconds),
    });
  return z.strictObject(shape);
}

function classSchema(id: RateLimitClassId) {
  const definition = classDefinition(id);
  const hasAdditional = Object.keys(definition.additional).length > 0;
  return z.strictObject({
    burst_limit: positiveInteger.max(definition.burst),
    sustained_limit: positiveInteger.max(definition.sustained),
    // Classes without additional rules may omit the object (it is then empty) but not fill it.
    additional: hasAdditional ? additionalSchema(id) : additionalSchema(id).optional(),
  });
}

/** Built from the registry: every Class ID is required (no implicit fallback). */
export const rateLimitConfigSchema = z.strictObject(
  Object.fromEntries(RATE_LIMIT_CLASS_IDS.map((id) => [id, classSchema(id)])),
);

export type RateLimitClassConfig<C extends RateLimitClassId = RateLimitClassId> = {
  readonly burstLimit: number;
  readonly sustainedLimit: number;
  readonly additional: { readonly [R in AdditionalRuleId<C>]: number };
};
export type RateLimitConfig = { readonly [C in RateLimitClassId]: RateLimitClassConfig<C> };

/** Parses the RATE_LIMIT_CONFIG JSON text. Any failure throws a value-free error. */
export function parseRateLimitConfig(raw: string | undefined): RateLimitConfig {
  if (raw === undefined || raw.trim() === "") throw new Error("Invalid rate limit configuration");
  let parsed: z.infer<typeof rateLimitConfigSchema>;
  try {
    parsed = rateLimitConfigSchema.parse(JSON.parse(raw));
  } catch {
    // Neither the Zod message nor the raw value is surfaced.
    throw new Error("Invalid rate limit configuration");
  }
  const result: Record<string, unknown> = {};
  for (const id of RATE_LIMIT_CLASS_IDS) {
    const value = (
      parsed as Record<
        string,
        {
          burst_limit: number;
          sustained_limit: number;
          additional?: Record<string, { limit: number }>;
        }
      >
    )[id];
    if (!value) throw new Error("Invalid rate limit configuration");
    result[id] = Object.freeze({
      burstLimit: value.burst_limit,
      sustainedLimit: value.sustained_limit,
      additional: Object.freeze(
        Object.fromEntries(
          Object.entries(value.additional ?? {}).map(([ruleId, rule]) => [ruleId, rule.limit]),
        ),
      ),
    });
  }
  return Object.freeze(result) as RateLimitConfig;
}

/** SEC-API-030: a non-negative integer; 0 is the explicit direct-peer value, absence is an error. */
export function parseTrustedProxyHops(raw: string | undefined): number {
  if (raw === undefined || !/^(0|[1-9]\d{0,2})$/.test(raw))
    throw new Error("Invalid trusted proxy configuration");
  return Number(raw);
}

export interface RateLimitSecretSettings {
  readonly hmacKey: Uint8Array;
  readonly hmacKeyVersion: number;
}
/** RATE_LIMIT_HMAC_KEY (32-byte base64) and RATE_LIMIT_HMAC_KEY_VERSION (positive integer). */
export function parseRateLimitHmac(
  key: string | undefined,
  version: string | undefined,
  decode: (encoded: string) => Uint8Array,
): RateLimitSecretSettings {
  if (key === undefined || version === undefined || !/^[1-9]\d{0,9}$/.test(version))
    throw new Error("Invalid rate limit key configuration");
  const parsedVersion = Number(version);
  if (!Number.isSafeInteger(parsedVersion) || parsedVersion > 2147483647)
    throw new Error("Invalid rate limit key configuration");
  let hmacKey: Uint8Array;
  try {
    hmacKey = decode(key);
  } catch {
    throw new Error("Invalid rate limit key configuration");
  }
  return Object.freeze({ hmacKey, hmacKeyVersion: parsedVersion });
}
