// SEC-API-024 / 025 / 030, TST-RLM-008. The forwarded header name and the hop count are external
// facts about the Railway ingress (SPEC-180 §17.2 #1); they are inputs, never constants of truth.
import { normalizeIp } from "./keys.ts";

export interface ClientIpInput {
  /** Socket peer of the API process. */
  readonly peer: string | undefined;
  /** Raw value of the forwarded header; ignored when `trustedProxyHops` is 0. */
  readonly forwarded: string | null | undefined;
  /** Number of trusted proxies in front of the API (0 = the direct peer is the client). */
  readonly trustedProxyHops: number;
}

/**
 * With N trusted proxies the nearest one appended its peer as the last entry, so the client is
 * the Nth entry from the right; anything left of it is client-controlled and never used. When the
 * chain cannot be established the direct peer is used (SEC-API-025). Returns undefined only when
 * not even the peer is known.
 */
export function deriveClientIp(input: ClientIpInput): string | undefined {
  if (!Number.isSafeInteger(input.trustedProxyHops) || input.trustedProxyHops < 0)
    throw new Error("Invalid trusted proxy configuration");
  const peer = normalizeIp(input.peer);
  if (input.trustedProxyHops === 0 || !input.forwarded) return peer;
  const entries = input.forwarded.split(",").map((entry) => entry.trim());
  if (entries.length < input.trustedProxyHops) return peer;
  return normalizeIp(entries[entries.length - input.trustedProxyHops]) ?? peer;
}
