import { isSafeRelativePath } from "../../auth/continuation";
import { validatePassword } from "../../auth/password-policy";
import type { AuthPort, Session } from "../../auth/port";
import type { Clock } from "./clock";
import { createMockDb, DB_STORAGE_KEY, type MockStorage } from "./db";
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

// The only pages an external-completion sign-in (Google, Magic Link) may return to
// (PG-AUTH-003 / PG-AUTH-001, SEC-WEB-013).
const EXTERNAL_RETURN_PAGES: readonly string[] = ["/account/login", "/account/register"];

const isExternalReturnPath = (path: string): boolean => {
  if (!isSafeRelativePath(path)) return false;
  const end = path.search(/[?#]/);
  return EXTERNAL_RETURN_PAGES.includes(end === -1 ? path : path.slice(0, end));
};

/**
 * What the dev-only stand-in screen runs when a Google sign-in is allowed. It is not an `AuthPort`
 * method and only that screen calls it. An existing user keeps their data; an unknown email is a first
 * registration without a display name (never inferred from the email, SPEC-030 9.2). Nothing but an
 * email's shape is read from the caller; no password, code or token is handled.
 */
export async function allowMockGoogleSignIn(
  deps: MockAuthDeps,
  email: string,
): Promise<{ kind: "signed_in" } | { kind: "unavailable" }> {
  if (!EMAIL_FORMAT.test(email)) {
    throw new RangeError("The email of a Google sign-in is malformed");
  }
  const { storage, clock } = deps;
  const db = createMockDb({ storage, clock });
  // Reads first: a broken stored state is reported before anything (even the seed) is written.
  const sessionLoad = loadSessionState(storage);
  if (sessionLoad.kind === "corrupted") return { kind: "unavailable" };
  const loaded = db.load();
  if (loaded.kind === "corrupted") return { kind: "unavailable" };
  const { state } = loaded;
  let user = state.users.find((u) => u.email === email);
  if (user === undefined) {
    user = { email, displayName: null, emailVerified: true };
    state.users.push(user);
    db.save(state);
  }
  saveSessionState(storage, {
    ...sessionLoad.state,
    session: { kind: "authenticated", email: user.email, emailVerified: user.emailVerified },
  });
  return { kind: "signed_in" };
}

/**
 * What the dev-only stand-in screen runs when the owner of a mailbox opens a valid login link. It is not
 * an `AuthPort` method and only that screen calls it. Opening the link proves the mailbox, so an
 * unverified user becomes verified (as with a one-time code); an unknown email is a first registration
 * without a display name (never inferred from the email, SPEC-030 9.2). Only the DB and the session are
 * written; no link, token or password is handled or kept (SEC-AUTH-018).
 */
export async function openMockMagicLink(
  deps: MockAuthDeps,
  email: string,
): Promise<{ kind: "signed_in" } | { kind: "unavailable" }> {
  if (!EMAIL_FORMAT.test(email)) {
    throw new RangeError("The email of a login link is malformed");
  }
  const { storage, clock } = deps;
  const db = createMockDb({ storage, clock });
  // Reads first: a broken stored state is reported before anything (even the seed) is written.
  const sessionLoad = loadSessionState(storage);
  if (sessionLoad.kind === "corrupted") return { kind: "unavailable" };
  const loaded = db.load();
  if (loaded.kind === "corrupted") return { kind: "unavailable" };
  const { state } = loaded;
  let user = state.users.find((u) => u.email === email);
  if (user === undefined) {
    user = { email, displayName: null, emailVerified: true };
    state.users.push(user);
    db.save(state);
  } else if (!user.emailVerified) {
    user.emailVerified = true;
    db.save(state);
  }
  saveSessionState(storage, {
    ...sessionLoad.state,
    session: { kind: "authenticated", email: user.email, emailVerified: true },
  });
  return { kind: "signed_in" };
}

/**
 * Mock of the Neon Auth boundary. Users live in the mock DB, the session in its own storage
 * entry. A password is only ever checked for shape: it is never stored, logged or returned
 * (SEC-AUTH-018), and the outcome of every call is decided by the scenario. A one-time code is
 * never compared, stored, logged or returned either; the mock sends no email.
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

  // Reads only: an unseeded DB is not a corruption and is not seeded by a call that must not write.
  const storedStateCorrupted = (): boolean =>
    (storage.getItem(DB_STORAGE_KEY) !== null && db.load().kind === "corrupted") ||
    loadSessionState(storage).kind === "corrupted";

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
      // The display name is never inferred from the email (SPEC-030 9.2): a new user has none.
      if (mode === "confirmation_required") {
        state.users.push({ email, displayName: null, emailVerified: false });
        db.save(state);
        saveSessionState(storage, { ...sessionLoad.state, pendingVerificationEmail: email });
        return { kind: "confirmation_required" };
      }
      state.users.push({ email, displayName: null, emailVerified: true });
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

    async requestEmailOtp({ email }) {
      if (!EMAIL_FORMAT.test(email)) {
        throw new RangeError("The email for a one-time code is malformed");
      }
      const scenario = readScenario();
      if (scenario === null || scenario.auth.login === "unavailable") {
        return { kind: "unavailable" };
      }
      if (storedStateCorrupted()) return { kind: "unavailable" };
      // Registered, unverified and unknown emails get the identical answer and no state change
      // (SEC-API-027). Only signInWithEmailOtp creates a user.
      return { kind: "sent" };
    },

    async signInWithEmailOtp({ email, code }) {
      const scenario = readScenario();
      if (scenario === null) return { kind: "unavailable" };
      const { login, verify } = scenario.auth;
      if (login === "unavailable" || storedStateCorrupted()) return { kind: "unavailable" };
      // The code is not compared: the mock only rejects an empty one. A wrong code wins over an
      // expired one when the scenario selects both. A failure writes nothing, not even the seed.
      if (code === "" || login === "credential_failure") return { kind: "code_invalid" };
      if (verify === "invalid_or_expired") return { kind: "code_expired" };
      const loaded = db.load();
      const sessionLoad = loadSessionState(storage);
      if (loaded.kind === "corrupted" || sessionLoad.kind === "corrupted") {
        return { kind: "unavailable" };
      }
      const { state } = loaded;
      // A valid code proves the mailbox, so it also confirms an unverified email.
      let user = state.users.find((u) => u.email === email);
      if (user === undefined) {
        // First registration by code; the display name is never inferred from the email (SPEC-030 9.2).
        user = { email, displayName: null, emailVerified: true };
        state.users.push(user);
        db.save(state);
      } else if (!user.emailVerified) {
        user.emailVerified = true;
        db.save(state);
      }
      const session: Session = { kind: "authenticated", email: user.email, emailVerified: true };
      const changed = !sameSession(sessionLoad.state.session, session);
      saveSessionState(storage, { ...sessionLoad.state, session });
      if (changed) notify();
      return { kind: "signed_in", emailVerified: true };
    },

    async startGoogleSignIn({ successPath, failurePath }) {
      if (!isExternalReturnPath(successPath) || !isExternalReturnPath(failurePath)) {
        throw new RangeError("A Google sign-in may only return to the Login or Registration page");
      }
      const scenario = readScenario();
      if (scenario === null || scenario.auth.login === "unavailable") {
        return { kind: "unavailable" };
      }
      // Starting establishes nothing: no session, no user, no write. The stand-in screen decides.
      return {
        kind: "redirect",
        url: `/dev/mock-google?success=${encodeURIComponent(successPath)}&failure=${encodeURIComponent(failurePath)}`,
      };
    },

    async requestMagicLink({ email, successPath, failurePath }) {
      if (!EMAIL_FORMAT.test(email)) {
        throw new RangeError("The email for a login link is malformed");
      }
      if (!isExternalReturnPath(successPath) || !isExternalReturnPath(failurePath)) {
        throw new RangeError("A login link may only return to the Login or Registration page");
      }
      const scenario = readScenario();
      if (scenario === null || scenario.auth.login === "unavailable") {
        return { kind: "unavailable" };
      }
      // Registered, unverified and unknown emails get the identical answer (SEC-API-027). Nothing is
      // sent, kept or established: the link is opened through the dev stand-in screen.
      return { kind: "sent" };
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
