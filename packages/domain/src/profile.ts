// SPEC-030 §9.2 Display name. Pure rule shared by the API; no external or framework import.
export const DISPLAY_NAME_MAX_CODE_POINTS = 80;

export type DisplayNameResult =
  | { ok: true; value: string | null }
  | { ok: false; reason: "too_long" | "control_character" };

/**
 * ECMAScript `trim()`, empty -> NULL, no Cc (General Category Control) in the trimmed value, then
 * 1..80 code points. The control check comes first. No Unicode normalization is applied.
 */
export function normalizeDisplayName(input: string | null): DisplayNameResult {
  if (input === null) return { ok: true, value: null };
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (/\p{Cc}/u.test(trimmed)) return { ok: false, reason: "control_character" };
  if ([...trimmed].length > DISPLAY_NAME_MAX_CODE_POINTS) return { ok: false, reason: "too_long" };
  return { ok: true, value: trimmed };
}
