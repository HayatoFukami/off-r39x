// Replaced by the bundler from reviewed source migration bytes, never runtime env.
declare const __R39X_BUILD_MIGRATION_SET_SHA256__: string;

/** Unbundled source has no release identity and must not become Ready. */
export function getBuildMigrationSetHash(): string | undefined {
  if (typeof __R39X_BUILD_MIGRATION_SET_SHA256__ !== "string") return undefined;
  if (!/^[0-9a-f]{64}$/.test(__R39X_BUILD_MIGRATION_SET_SHA256__)) return undefined;
  return __R39X_BUILD_MIGRATION_SET_SHA256__;
}
