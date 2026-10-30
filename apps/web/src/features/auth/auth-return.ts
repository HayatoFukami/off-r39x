import { accountPath, type ContinuationIntent } from "../../auth/continuation";
import { NOTICE_PARAM } from "./login-notice";

// The paths an external-completion sign-in returns to (SPEC-050 15.0). The user comes back to the page
// that started it, by a full-page navigation. The paths are built from fixed words and the
// Continuation Intent only: no email, token, code or identifier (SEC-AUTH-018, SEC-WEB-013).

/** The query name of a successful return. */
export const RETURNED_PARAM = "returned";
const GOOGLE = "google";
const GOOGLE_FAILED = "google-failed";

type ExternalMethod = "google";
type ExternalPage = "login" | "register";

const withQuery = (
  page: ExternalPage,
  intent: ContinuationIntent | null,
  name: string,
  value: string,
): string => `${accountPath(page, intent)}${intent === null ? "?" : "&"}${name}=${value}`;

/** Where the user returns after the external service succeeded. */
export function externalReturnPath(
  _method: ExternalMethod,
  page: ExternalPage,
  intent: ContinuationIntent | null,
): string {
  return withQuery(page, intent, RETURNED_PARAM, GOOGLE);
}

/** Where the user returns after the external service was cancelled or failed. */
export function externalFailurePath(
  _method: ExternalMethod,
  page: ExternalPage,
  intent: ContinuationIntent | null,
): string {
  return withQuery(page, intent, NOTICE_PARAM, GOOGLE_FAILED);
}

/** Only exactly `google` is a return; anything else is ignored. */
export function parseReturned(raw: string | null | undefined): "google" | null {
  return raw === GOOGLE ? GOOGLE : null;
}

/** Only exactly `google-failed` is a failed return; other notices (`password-updated`) are not. */
export function parseFailureNotice(raw: string | null | undefined): "google" | null {
  return raw === GOOGLE_FAILED ? GOOGLE : null;
}
