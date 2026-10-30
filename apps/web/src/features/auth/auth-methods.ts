import { copy } from "../../presentation/copy/ja";

// The authentication methods PG-AUTH-001 / 003 offer, in the specified order (SPEC-050 15.0).
// Google and Magic Link complete outside the page (FR-CRT-012 external-completion rule); the others inside it.
export type AuthMethod = "password" | "google" | "email-otp" | "magic-link";

export const AUTH_METHODS: readonly AuthMethod[] = [
  "password",
  "google",
  "email-otp",
  "magic-link",
];

export const DEFAULT_AUTH_METHOD: AuthMethod = "password";

export function authMethodLabel(method: AuthMethod): string {
  switch (method) {
    case "password":
      return copy.auth.method.password;
    case "google":
      return copy.auth.method.google;
    case "email-otp":
      return copy.auth.method.emailOtp;
    case "magic-link":
      return copy.auth.method.magicLink;
  }
}
