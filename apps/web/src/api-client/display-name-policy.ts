// Display name rule (SPEC-030 9.2, API-AUTH-004): trimmed, a blank value clears the name (null),
// 1..80 Unicode code points after trimming, no internal control character (Unicode Cc).
// The API is the authority (DEV-WEB-009). This pure function serves the UI pre-check (UX only) and the
// UI mock test double. No Unicode normalization is applied (the specification defines none).

export const DISPLAY_NAME_MAX_CODE_POINTS = 80;

export type DisplayNameResult =
  | { ok: true; value: string | null }
  | { ok: false; reason: "too_long" | "control_character" };

export function normalizeDisplayName(input: string): DisplayNameResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, value: null };
  // Checked before the length so that a value violating both reports the control character.
  if (/\p{Cc}/u.test(trimmed)) return { ok: false, reason: "control_character" };
  if ([...trimmed].length > DISPLAY_NAME_MAX_CODE_POINTS) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, value: trimmed };
}
