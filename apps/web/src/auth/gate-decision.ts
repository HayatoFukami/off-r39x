import { accountPath, continuationForPath } from "./continuation";
import type { SessionState } from "./use-session";

export type GateDecision =
  | { kind: "loading" }
  | { kind: "allow" }
  | { kind: "unavailable" }
  | { kind: "redirect"; reason: "guest" | "email_unverified"; to: string };

/**
 * What a protected page may do for the current Session (AR-SES-007, SPEC-050 15.6). A Session
 * that cannot be confirmed is neither Authenticated nor Guest.
 */
export function decideGate(state: SessionState, pathname: string): GateDecision {
  if (state.status === "loading") return { kind: "loading" };
  if (state.status === "unavailable") return { kind: "unavailable" };
  const { session } = state;
  const intent = continuationForPath(pathname) ?? { key: "mypage", ref: null };
  if (session.kind === "guest") {
    return { kind: "redirect", reason: "guest", to: accountPath("login", intent) };
  }
  if (!session.emailVerified) {
    return {
      kind: "redirect",
      reason: "email_unverified",
      to: accountPath("email-verification", intent),
    };
  }
  return { kind: "allow" };
}
