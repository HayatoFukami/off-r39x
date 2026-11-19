// SPEC-030 §9.2 Display name. Pure rule shared by the API; no external or framework import.
export const DISPLAY_NAME_MAX_CODE_POINTS = 80;

export type DisplayNameResult =
  | { ok: true; value: string | null }
  | { ok: false; reason: "not_well_formed" | "too_long" | "control_character" };

// With the `u` flag a lone surrogate is read as its own code point of General Category Cs, while a
// correctly paired surrogate is read as one supplementary code point. A match is therefore exactly
// `!String.prototype.isWellFormed()` (ES2024, outside this repository's ES2023 lib).
const LONE_SURROGATE = /\p{Cs}/u;

/**
 * ECMAScript `trim()`, empty -> NULL, then a well-formed value only (UCR-030-001: a lone surrogate is
 * rejected, never replaced by U+FFFD or removed), no Cc (General Category Control) in the trimmed value,
 * and 1..80 code points, judged in that order. No Unicode normalization is applied.
 */
export function normalizeDisplayName(input: string | null): DisplayNameResult {
  if (input === null) return { ok: true, value: null };
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (LONE_SURROGATE.test(trimmed)) return { ok: false, reason: "not_well_formed" };
  if (/\p{Cc}/u.test(trimmed)) return { ok: false, reason: "control_character" };
  if ([...trimmed].length > DISPLAY_NAME_MAX_CODE_POINTS) return { ok: false, reason: "too_long" };
  return { ok: true, value: trimmed };
}
