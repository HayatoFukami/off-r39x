import { copy } from "../../presentation/copy/ja";

// The authentication methods PG-AUTH-001 / 003 offer, in the specified order (SPEC-050 15.0).
// Only methods that complete inside the page are offered here.
export type AuthMethod = "password" | "email-otp";

export const AUTH_METHODS: readonly AuthMethod[] = ["password", "email-otp"];

export const DEFAULT_AUTH_METHOD: AuthMethod = "password";

export function authMethodLabel(method: AuthMethod): string {
  switch (method) {
    case "password":
      return copy.auth.method.password;
    case "email-otp":
      return copy.auth.method.emailOtp;
  }
}
