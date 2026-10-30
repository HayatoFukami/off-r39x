import { accountPath, type ContinuationIntent } from "../../auth/continuation";
import { NOTICE_PARAM } from "./login-notice";

// The paths an external-completion sign-in returns to (SPEC-050 15.0). The user comes back to the page
// that shows the result, by a full-page navigation: the page that started a Google sign-in, or the page
// the link of a Magic Link opens. The paths are built from fixed words and the Continuation Intent only:
// no email, token, code or identifier (SEC-AUTH-018, SEC-WEB-013).

/** The query name of a successful return. */
export const RETURNED_PARAM = "returned";

type ExternalMethod = "google" | "magic-link";
type ExternalPage = "login" | "register";

// The words of the query: the value of `returned` for a success, the value of `notice` for a failure.
const RETURNED: Record<ExternalMethod, string> = { google: "google", "magic-link": "magic-link" };
const FAILED: Record<ExternalMethod, string> = {
  google: "google-failed",
  "magic-link": "link-failed",
};

const withQuery = (
  page: ExternalPage,
  intent: ContinuationIntent | null,
  name: string,
  value: string,
): string => `${accountPath(page, intent)}${intent === null ? "?" : "&"}${name}=${value}`;

/** Where the user returns after the external service succeeded. */
export function externalReturnPath(
  method: ExternalMethod,
  page: ExternalPage,
  intent: ContinuationIntent | null,
): string {
  return withQuery(page, intent, RETURNED_PARAM, RETURNED[method]);
}

/** Where the user returns after the external service was cancelled or failed. */
export function externalFailurePath(
  method: ExternalMethod,
  page: ExternalPage,
  intent: ContinuationIntent | null,
): string {
  return withQuery(page, intent, NOTICE_PARAM, FAILED[method]);
}

/** Only exactly `google` or `magic-link` is a return; anything else is ignored. */
export function parseReturned(raw: string | null | undefined): ExternalMethod | null {
  if (raw === RETURNED.google) return "google";
  if (raw === RETURNED["magic-link"]) return "magic-link";
  return null;
}

/** Only exactly `google-failed` or `link-failed` is a failed return; other notices (`password-updated`) are not. */
export function parseFailureNotice(raw: string | null | undefined): ExternalMethod | null {
  if (raw === FAILED.google) return "google";
  if (raw === FAILED["magic-link"]) return "magic-link";
  return null;
}
