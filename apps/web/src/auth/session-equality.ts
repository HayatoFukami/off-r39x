import type { SessionState } from "./use-session";

/** True when two session states describe the same session, so a re-read of an unchanged session changes nothing. */
export function sameSessionState(a: SessionState, b: SessionState): boolean {
  if (a.status !== b.status) return false;
  if (a.status !== "ready" || b.status !== "ready") return true;
  if (a.session.kind !== b.session.kind) return false;
  if (a.session.kind !== "authenticated" || b.session.kind !== "authenticated") return true;
  return a.session.email === b.session.email && a.session.emailVerified === b.session.emailVerified;
}
