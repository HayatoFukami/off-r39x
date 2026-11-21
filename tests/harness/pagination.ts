// Synthetic cursor signing keys for PR-S0-3b and the list cursor key environment for PR-S0-3e
// (SEC-KEY-005, DEV-SEC-004). Test-only: production never imports this file. The bytes are built with
// fill(), so no key text exists in the repository.
export type SyntheticCursorKey = { readonly version: number; readonly key: Uint8Array };

export function syntheticCursorKey(fill: number, version: number): SyntheticCursorKey {
  return { version, key: new Uint8Array(32).fill(fill) };
}

/**
 * Synthetic LIST_CURSOR_HMAC_KEY(_VERSION) environment of the API service (INF-SEC-007). Fill 13 differs
 * from every other fixture key (OBS 3, QR 1/2, rate limit 7/5, auth-subject 9). Deliberately not part
 * of rateLimitEnv(): each fixture spreads it explicitly.
 */
export function listCursorEnv(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Record<string, string | undefined> {
  return {
    LIST_CURSOR_HMAC_KEY: Buffer.alloc(32, 13).toString("base64"),
    LIST_CURSOR_HMAC_KEY_VERSION: "1",
    ...overrides,
  };
}
