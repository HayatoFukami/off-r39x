// Synthetic cursor signing keys for PR-S0-3b (SEC-KEY-005, DEV-SEC-004). Test-only: production never
// imports this file. The bytes are built with fill(), so no key text exists in the repository.
export type SyntheticCursorKey = { readonly version: number; readonly key: Uint8Array };

export function syntheticCursorKey(fill: number, version: number): SyntheticCursorKey {
  return { version, key: new Uint8Array(32).fill(fill) };
}
