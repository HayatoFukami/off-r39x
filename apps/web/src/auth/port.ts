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
}
