// SEC-AUTH-016 / SEC-AUTH-017: length only, counted in Unicode code points. No trim, no
// normalization, no fixed composition rule.

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordPolicyResult = { ok: true } | { ok: false; reason: "too_short" | "too_long" };

export function validatePassword(password: string): PasswordPolicyResult {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: "too_short" };
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true };
}
