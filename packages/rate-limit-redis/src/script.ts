import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Replaced by the bundler from the reviewed evaluate.lua bytes (scripts/build-backend.mts).
declare const __R39X_RATE_LIMIT_SCRIPT__: string;

export interface RateLimitScript {
  readonly source: string;
  /** SHA-1 as used by EVALSHA / SCRIPT LOAD (an identifier, not a security hash). */
  readonly sha: string;
}

/** DEV-RLM-003: the script is a source-controlled file; nothing request-derived is ever added. */
export function loadRateLimitScript(): RateLimitScript {
  const source =
    typeof __R39X_RATE_LIMIT_SCRIPT__ === "string"
      ? __R39X_RATE_LIMIT_SCRIPT__
      : readFileSync(new URL("./evaluate.lua", import.meta.url), "utf8");
  return Object.freeze({
    source,
    sha: createHash("sha1").update(source, "utf8").digest("hex"),
  });
}
