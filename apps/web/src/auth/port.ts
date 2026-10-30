export type Session =
  | { kind: "guest" }
  | { kind: "authenticated"; email: string; emailVerified: boolean };

export interface AuthPort {
  getSession(): Promise<{ kind: "ok"; session: Session } | { kind: "unavailable" }>;
  /** Registers a listener called with no arguments after the session changed. Returns the unsubscribe function. */
  onSessionChange(cb: () => void): () => void;
  signUp(i: {
    email: string;
    password: string;
  }): Promise<
    | { kind: "confirmation_required" }
    | { kind: "signed_in" }
    | { kind: "rejected" }
    | { kind: "unavailable" }
    | { kind: "cart_busy" }
    | { kind: "cart_blocked" }
  >;
  verifyEmail(i: {
    context: string | null;
  }): Promise<{ kind: "verified" } | { kind: "invalid_or_expired" } | { kind: "unavailable" }>;
  signIn(i: {
    email: string;
    password: string;
  }): Promise<
    | { kind: "signed_in"; emailVerified: boolean }
    | { kind: "credential_failure" }
    | { kind: "unavailable" }
    | { kind: "cart_busy" }
    | { kind: "cart_blocked" }
  >;
  /** The local session is always discarded, even when the provider fails (AR-SES-009). */
  signOut(): Promise<{ kind: "signed_out" }>;
  /** The response never reveals whether the email is registered (SEC-API-027). */
  requestPasswordReset(i: {
    email: string;
  }): Promise<{ kind: "accepted" } | { kind: "unavailable" }>;
  completePasswordReset(i: {
    context: string | null;
    newPassword: string;
  }): Promise<{ kind: "updated" } | { kind: "invalid_context" } | { kind: "unavailable" }>;
  /**
   * Sends a one-time code to the email. A Neon Auth transport (SPEC-110 section 23.1): it has no
   * business Operation ID. The answer never reveals whether the email is registered (SEC-API-027).
   */
  requestEmailOtp(i: {
    email: string;
  }): Promise<
    { kind: "sent" } | { kind: "unavailable" } | { kind: "cart_busy" } | { kind: "cart_blocked" }
  >;
  /**
   * Signs in (or registers a first-time email) with the code. A Neon Auth transport (SPEC-110
   * section 23.1): it has no business Operation ID. The code is never kept (SEC-AUTH-018).
   * `code_expired` covers an expired code and too many attempts alike; both need a resend.
   */
  signInWithEmailOtp(i: {
    email: string;
    code: string;
  }): Promise<
    | { kind: "signed_in"; emailVerified: boolean }
    | { kind: "code_invalid" }
    | { kind: "code_expired" }
    | { kind: "unavailable" }
    | { kind: "cart_busy" }
    | { kind: "cart_blocked" }
  >;
  /**
   * Starts signing in (or registering) with Google. A Neon Auth transport (SPEC-110 section 23.1): it
   * has no business Operation ID. A `redirect` carries a `url` on the same origin as a relative path;
   * the user moves to it with a full-page navigation. The outcome of the sign-in is not this
   * promise's result: the screen the user returns to decides it. `successPath` and `failurePath` are
   * the paths of PG-AUTH-003 / PG-AUTH-001 only (AR-CONT-001, SEC-WEB-013); they carry no value.
   */
  startGoogleSignIn(i: {
    successPath: string;
    failurePath: string;
  }): Promise<
    | { kind: "redirect"; url: string }
    | { kind: "unavailable" }
    | { kind: "already_signed_in" }
    | { kind: "cart_busy" }
    | { kind: "cart_blocked" }
  >;
  /**
   * Sends a login link to the email. A Neon Auth transport (SPEC-110 section 23.1): it has no business
   * Operation ID. `sent` never reveals whether the email is registered (SEC-API-027). The link is opened
   * outside the page (in the mail, in another Tab or on another device), so the outcome of the sign-in
   * is not this promise's result: the screen shown by opening the link decides it. `successPath` and
   * `failurePath` are same origin relative paths of PG-AUTH-003 / PG-AUTH-001 only (AR-CONT-001,
   * SEC-WEB-013); they carry no value.
   */
  requestMagicLink(i: {
    email: string;
    successPath: string;
    failurePath: string;
  }): Promise<
    | { kind: "sent" }
    | { kind: "unavailable" }
    | { kind: "already_signed_in" }
    | { kind: "cart_busy" }
    | { kind: "cart_blocked" }
  >;
}
