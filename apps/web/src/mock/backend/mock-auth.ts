import { validatePassword } from "../../auth/password-policy";
import type { AuthPort, Session } from "../../auth/port";
import type { Clock } from "./clock";
import { createMockDb, type MockStorage } from "./db";
import type { IdGenerator } from "./ids";
import { loadScenario, type Scenario } from "./scenario";
import {
  loadSessionState,
  SESSION_STORAGE_KEY,
  type SessionStoreState,
  saveSessionState,
} from "./session-store";

export { SESSION_STORAGE_KEY };

export type MockAuthDeps = { storage: MockStorage; clock: Clock; idGenerator: IdGenerator };

const EMAIL_FORMAT = /^[^@\s]+@[^@\s]+$/;

const sameSession = (a: Session, b: Session): boolean =>
  a.kind === "guest" || b.kind === "guest"
    ? a.kind === b.kind
    : a.email === b.email && a.emailVerified === b.emailVerified;

/**
 * Mock of the Supabase Auth boundary. Users live in the mock DB, the session in its own storage
 * entry. A password is only ever checked for shape: it is never stored, logged or returned
 * (SEC-AUTH-018), and the outcome of every call is decided by the scenario.
 */
export function createMockAuth(deps: MockAuthDeps): AuthPort {
  const { storage, clock } = deps;
  const db = createMockDb({ storage, clock });
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const readScenario = (): Scenario | null => {
    const loaded = loadScenario(storage);
    return loaded.kind === "ok" ? loaded.scenario : null;
  };

  return {
    async getSession() {
      const scenario = readScenario();
      if (scenario === null || scenario.auth.session === "unavailable") {
        return { kind: "unavailable" };
      }
      const loaded = loadSessionState(storage);
      if (loaded.kind === "corrupted") return { kind: "unavailable" };
      return { kind: "ok", session: loaded.state.session };
    },

    onSessionChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    async signUp({ email, password }) {
      const scenario = readScenario();
      if (scenario === null) return { kind: "unavailable" };
      const mode = scenario.auth.signup;
      if (mode === "unavailable") return { kind: "unavailable" };
      if (mode === "rejected") return { kind: "rejected" };
      if (!EMAIL_FORMAT.test(email) || !validatePassword(password).ok) {
        return { kind: "rejected" };
      }
      const loaded = db.load();
      const sessionLoad = loadSessionState(storage);
      if (loaded.kind === "corrupted" || sessionLoad.kind === "corrupted") {
        return { kind: "unavailable" };
      }
      const { state } = loaded;
      // An existing account is never disclosed (SEC-API-027): same result, nothing changes.
      if (state.users.some((u) => u.email === email)) {
        return { kind: "confirmation_required" };
      }
      const displayName = email.slice(0, email.indexOf("@"));
      if (mode === "confirmation_required") {
        state.users.push({ email, displayName, emailVerified: false });
        db.save(state);
        saveSessionState(storage, { ...sessionLoad.state, pendingVerificationEmail: email });
        return { kind: "confirmation_required" };
      }
      state.users.push({ email, displayName, emailVerified: true });
      db.save(state);
      const next: SessionStoreState = {
        ...sessionLoad.state,
        session: { kind: "authenticated", email, emailVerified: true },
      };
      saveSessionState(storage, next);
      notify();
      return { kind: "signed_in" };
    },

    async verifyEmail({ context }) {
      const scenario = readScenario();
      if (scenario === null) return { kind: "unavailable" };
      if (scenario.auth.verify === "unavailable") return { kind: "unavailable" };
      if (scenario.auth.verify === "invalid_or_expired") return { kind: "invalid_or_expired" };
      if (context === null || context === "") return { kind: "invalid_or_expired" };
      const loaded = db.load();
      const sessionLoad = loadSessionState(storage);
      if (loaded.kind === "corrupted" || sessionLoad.kind === "corrupted") {
        return { kind: "unavailable" };
      }
      const { session } = sessionLoad.state;
      const target =
        session.kind === "authenticated"
          ? session.email
          : sessionLoad.state.pendingVerificationEmail;
      const user = loaded.state.users.find((u) => u.email === target);
      if (target === null || user === undefined) return { kind: "invalid_or_expired" };

      user.emailVerified = true;
      db.save(loaded.state);
      const nextSession: Session =
        session.kind === "authenticated" && session.email === target
          ? { kind: "authenticated", email: target, emailVerified: true }
          : session;
      saveSessionState(storage, {
        ...sessionLoad.state,
        session: nextSession,
        pendingVerificationEmail: null,
      });
      if (!sameSession(session, nextSession)) notify();
      return { kind: "verified" };
    },

    async signIn({ email, password }) {
      const scenario = readScenario();
      if (scenario === null) return { kind: "unavailable" };
      if (scenario.auth.login === "unavailable") return { kind: "unavailable" };
      if (scenario.auth.login === "credential_failure") return { kind: "credential_failure" };
      const loaded = db.load();
      const sessionLoad = loadSessionState(storage);
      if (loaded.kind === "corrupted" || sessionLoad.kind === "corrupted") {
        return { kind: "unavailable" };
      }
      // The password is not compared: the mock only rejects an empty one. Unknown email and empty
      // input fail alike, so the cause is not revealed.
      const user = loaded.state.users.find((u) => u.email === email);
      if (email === "" || password === "" || user === undefined) {
        return { kind: "credential_failure" };
      }
      saveSessionState(storage, {
        ...sessionLoad.state,
        session: { kind: "authenticated", email: user.email, emailVerified: user.emailVerified },
      });
      notify();
      return { kind: "signed_in", emailVerified: user.emailVerified };
    },

    async signOut() {
      // The local session is discarded whatever the scenario or the stored value says (AR-SES-009).
      const loaded = loadSessionState(storage);
      if (loaded.kind === "corrupted") {
        storage.removeItem(SESSION_STORAGE_KEY);
        notify();
      } else if (loaded.state.session.kind === "authenticated") {
        saveSessionState(storage, { ...loaded.state, session: { kind: "guest" } });
        notify();
      }
      return { kind: "signed_out" };
    },

    async requestPasswordReset() {
      const scenario = readScenario();
      if (scenario === null || scenario.auth.reset === "unavailable") {
        return { kind: "unavailable" };
      }
      // Known and unknown emails get the identical answer and no state change (SEC-API-027).
      return { kind: "accepted" };
    },

    async completePasswordReset({ context, newPassword }) {
      if (!validatePassword(newPassword).ok) {
        throw new RangeError("The new password violates the password policy");
      }
      const scenario = readScenario();
      if (scenario === null || scenario.auth.reset === "unavailable") {
        return { kind: "unavailable" };
      }
      if (context === null || context === "" || scenario.auth.resetContext === "invalid") {
        return { kind: "invalid_context" };
      }
      return { kind: "updated" };
    },
  };
}
