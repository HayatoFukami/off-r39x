import type { BusinessDateJst, UtcInstant } from "../../apps/web/src/api-client/types.ts";

// Test-only helpers for presentation unit tests. Never imported from production code.

export const utc = (value: string): UtcInstant => value as UtcInstant;
export const jstDate = (value: string): BusinessDateJst => value as BusinessDateJst;

/** Collects every string leaf of a nested object. Function leaves (templates) are skipped. */
export function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) stringLeaves(child, out);
  }
  return out;
}

export const TONES = ["success", "pending", "failure", "neutral", "review"] as const;
