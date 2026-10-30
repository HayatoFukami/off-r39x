import { afterEach, describe, expect, it, vi } from "vitest";
import { isSafeRelativePath } from "../../../../apps/web/src/auth/continuation.ts";
import { DB_STORAGE_KEY } from "../../../../apps/web/src/mock/backend/db.ts";
import {
  allowMockGoogleSignIn as allowMockGoogle,
  SESSION_STORAGE_KEY as REEXPORTED_KEY,
} from "../../../../apps/web/src/mock/backend/mock-auth.ts";
import { SCENARIO_STORAGE_KEY } from "../../../../apps/web/src/mock/backend/scenario.ts";
import {
  loadSessionState,
  SESSION_STORAGE_KEY,
  saveSessionState,
  sessionStateSchema,
} from "../../../../apps/web/src/mock/backend/session-store.ts";
import {
  createBackend,
  createMemoryStorage,
  dbFingerprint,
  okData,
} from "../../../harness/mock-backend.ts";
import { EMAIL, ORDER, TEST_PASSWORD } from "../../../harness/mock-seed.ts";

const NEW_EMAIL = "newcomer@example.com";
const SENTINEL = "Sentinel-Pass-Phrase-9876";
// Email OTP (B5 C1). A code that is no seed value, so any leak of it is unambiguous (SEC-AUTH-018).
const OTP_SENTINEL = "Sentinel-Otp-Code-7531";
const GUEST = { kind: "ok", session: { kind: "guest" } };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TC-PG-AUTH-003-101 signIn (15.3, AR-AUTH, SEC-API-027)", () => {
  it("signs in a verified seed user and exposes the authenticated session", async () => {
    const { auth } = createBackend();
    expect(await auth.getSession()).toEqual(GUEST);
    expect(await auth.signIn({ email: EMAIL.demo, password: TEST_PASSWORD })).toEqual({
      kind: "signed_in",
      emailVerified: true,
    });
    expect(await auth.getSession()).toEqual({
      kind: "ok",
      session: { kind: "authenticated", email: EMAIL.demo, emailVerified: true },
    });
  });

  it("reports emailVerified false for an unverified user and keeps that in the session", async () => {
    const { auth } = createBackend();
    expect(await auth.signIn({ email: EMAIL.unverified, password: TEST_PASSWORD })).toEqual({
      kind: "signed_in",
      emailVerified: false,
    });
    expect(await auth.getSession()).toEqual({
      kind: "ok",
      session: { kind: "authenticated", email: EMAIL.unverified, emailVerified: false },
    });
  });

  it.each([
    ["an unknown email", { email: "nobody@example.com", password: TEST_PASSWORD }],
    ["an empty password", { email: EMAIL.demo, password: "" }],
    ["an empty email", { email: "", password: TEST_PASSWORD }],
  ])("returns the same credential_failure for %s and does not sign in", async (_name, input) => {
    const { auth } = createBackend();
    expect(await auth.signIn(input)).toEqual({ kind: "credential_failure" });
    expect(await auth.getSession()).toEqual(GUEST);
  });

  it("follows the login scenario (credential_failure / unavailable) without changing the session", async () => {
    const backend = createBackend();
    backend.setScenario({ auth: { login: "credential_failure" } });
    expect(await backend.auth.signIn({ email: EMAIL.demo, password: TEST_PASSWORD })).toEqual({
      kind: "credential_failure",
    });
    backend.setScenario({ auth: { login: "unavailable" } });
    expect(await backend.auth.signIn({ email: EMAIL.demo, password: TEST_PASSWORD })).toEqual({
      kind: "unavailable",
    });
    expect(await backend.auth.getSession()).toEqual(GUEST);
  });

  it("keeps the current session when a later sign-in fails", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.demo);
    backend.setScenario({ auth: { login: "credential_failure" } });
    await backend.auth.signIn({ email: EMAIL.fresh, password: TEST_PASSWORD });
    expect(await backend.auth.getSession()).toEqual({
      kind: "ok",
      session: { kind: "authenticated", email: EMAIL.demo, emailVerified: true },
    });
  });
});

describe("TC-PG-AUTH-001-101 signUp (15.1, SEC-API-027, SEC-AUTH-016)", () => {
  it("confirmation_required: creates an unverified user without signing in", async () => {
    const backend = createBackend();
    const result = await backend.auth.signUp({ email: NEW_EMAIL, password: TEST_PASSWORD });
    expect(result).toEqual({ kind: "confirmation_required" });
    expect(await backend.auth.getSession()).toEqual(GUEST);
    expect(await backend.auth.signIn({ email: NEW_EMAIL, password: TEST_PASSWORD })).toEqual({
      kind: "signed_in",
      emailVerified: false,
    });
  });

  it("signed_in: creates a verified user and signs in", async () => {
    const backend = createBackend();
    backend.setScenario({ auth: { signup: "signed_in" } });
    expect(await backend.auth.signUp({ email: NEW_EMAIL, password: TEST_PASSWORD })).toEqual({
      kind: "signed_in",
    });
    expect(await backend.auth.getSession()).toEqual({
      kind: "ok",
      session: { kind: "authenticated", email: NEW_EMAIL, emailVerified: true },
    });
  });

  it.each(["rejected", "unavailable"] as const)(
    "%s: creates no user and does not change the session",
    async (signup) => {
      const backend = createBackend();
      backend.setScenario({ auth: { signup } });
      expect(await backend.auth.signUp({ email: NEW_EMAIL, password: TEST_PASSWORD })).toEqual({
        kind: signup,
      });
      expect(await backend.auth.getSession()).toEqual(GUEST);
      backend.setScenario({ auth: { signup: "confirmation_required" } });
      expect(await backend.auth.signIn({ email: NEW_EMAIL, password: TEST_PASSWORD })).toEqual({
        kind: "credential_failure",
      });
    },
  );

  it("does not disclose an existing account: the same confirmation_required and no change", async () => {
    const backend = createBackend();
    const before = dbFingerprint(backend);
    const sessionBefore = backend.storage.getItem(SESSION_STORAGE_KEY);
    expect(await backend.auth.signUp({ email: EMAIL.demo, password: TEST_PASSWORD })).toEqual({
      kind: "confirmation_required",
    });
    expect(dbFingerprint(backend)).toBe(before);
    expect(backend.storage.getItem(SESSION_STORAGE_KEY)).toBe(sessionBefore);
    backend.setScenario({ auth: { signup: "signed_in" } });
    expect(await backend.auth.signUp({ email: EMAIL.demo, password: TEST_PASSWORD })).toEqual({
      kind: "confirmation_required",
    });
    expect(await backend.auth.getSession()).toEqual(GUEST);
  });

  it.each([
    ["an email without @", "not-an-email", TEST_PASSWORD],
    ["an email with spaces", "a b@example.com", TEST_PASSWORD],
    ["an empty email", "", TEST_PASSWORD],
    ["an 11 character password", NEW_EMAIL, "a".repeat(11)],
    ["a 129 character password", NEW_EMAIL, "a".repeat(129)],
  ])("rejects %s without creating a user", async (_name, email, password) => {
    const backend = createBackend();
    expect(await backend.auth.signUp({ email, password })).toEqual({ kind: "rejected" });
    expect(await backend.auth.signIn({ email, password: TEST_PASSWORD })).toEqual({
      kind: "credential_failure",
    });
  });

  it("accepts the boundary lengths 12 and 128 and does not trim", async () => {
    const backend = createBackend();
    for (const [index, password] of [
      "a".repeat(12),
      "b".repeat(128),
      `${"c".repeat(10)}  `,
    ].entries()) {
      const result = await backend.auth.signUp({ email: `user${index}@example.com`, password });
      expect(result, `length ${password.length}`).toEqual({ kind: "confirmation_required" });
    }
    expect(
      await backend.auth.signUp({ email: "trimmed@example.com", password: `${"d".repeat(9)}   ` }),
    ).toEqual({ kind: "confirmation_required" });
  });
});

describe("TC-PG-MYP-002-103 a newly registered user has no display name; none is guessed from the email (SPEC-030 9.2, SPEC-050 18.2)", () => {
  const LOCAL = "uniquelocalpart";
  const EMAIL_WITH_LOCAL = `${LOCAL}@example.com`;
  const storedNameOf = (backend: ReturnType<typeof createBackend>): string | null | undefined => {
    const loaded = backend.db.load();
    if (loaded.kind !== "ready") throw new Error("expected a ready DB");
    return loaded.state.users.find((u) => u.email === EMAIL_WITH_LOCAL)?.displayName;
  };

  it("confirmation_required: the unverified user is stored with displayName null", async () => {
    const backend = createBackend();
    expect(await backend.auth.signUp({ email: EMAIL_WITH_LOCAL, password: TEST_PASSWORD })).toEqual(
      { kind: "confirmation_required" },
    );
    expect(storedNameOf(backend)).toBeNull();
    expect(JSON.stringify(backend.db.load())).not.toContain(`"displayName":"${LOCAL}"`);
  });

  it("signed_in: the verified user is stored with displayName null and getProfile returns null, not the local part", async () => {
    const backend = createBackend();
    backend.setScenario({ auth: { signup: "signed_in" } });
    expect(await backend.auth.signUp({ email: EMAIL_WITH_LOCAL, password: TEST_PASSWORD })).toEqual(
      { kind: "signed_in" },
    );
    expect(storedNameOf(backend)).toBeNull();
    const profile = okData(await backend.api.self.getProfile());
    expect(profile).toEqual({ email: EMAIL_WITH_LOCAL, displayName: null });
    expect(JSON.stringify(profile)).not.toContain(`"displayName":"${LOCAL}"`);
  });

  it("leaves the seed users' display names as they are", async () => {
    const backend = createBackend();
    backend.setScenario({ auth: { signup: "signed_in" } });
    await backend.auth.signUp({ email: EMAIL_WITH_LOCAL, password: TEST_PASSWORD });
    const loaded = backend.db.load();
    if (loaded.kind !== "ready") throw new Error("expected a ready DB");
    expect(loaded.state.users.find((u) => u.email === EMAIL.demo)?.displayName).toBe("デモ太郎");
  });

  it("Email OTP: the first registration stores displayName null and getProfile returns null, not the local part (B5 C1)", async () => {
    const backend = createBackend();
    expect(
      await backend.auth.signInWithEmailOtp({
        email: EMAIL_WITH_LOCAL,
        code: OTP_SENTINEL,
      }),
    ).toEqual({ kind: "signed_in", emailVerified: true });
    expect(storedNameOf(backend)).toBeNull();
    expect(JSON.stringify(backend.db.load())).not.toContain(`"displayName":"${LOCAL}"`);
    const profile = okData(await backend.api.self.getProfile());
    expect(profile).toEqual({ email: EMAIL_WITH_LOCAL, displayName: null });
  });
});

describe("TC-PG-AUTH-002-101 verifyEmail (15.2)", () => {
  it("verifies the pending sign-up for a guest and the user then signs in verified", async () => {
    const backend = createBackend();
    await backend.auth.signUp({ email: NEW_EMAIL, password: TEST_PASSWORD });
    expect(await backend.auth.verifyEmail({ context: "any-opaque-context" })).toEqual({
      kind: "verified",
    });
    expect(await backend.auth.getSession()).toEqual(GUEST);
    expect(await backend.auth.signIn({ email: NEW_EMAIL, password: TEST_PASSWORD })).toEqual({
      kind: "signed_in",
      emailVerified: true,
    });
  });

  it("updates an authenticated unverified session and notifies the listeners", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.unverified);
    const listener = vi.fn();
    backend.auth.onSessionChange(listener);
    expect(await backend.auth.verifyEmail({ context: "ctx" })).toEqual({ kind: "verified" });
    expect(await backend.auth.getSession()).toEqual({
      kind: "ok",
      session: { kind: "authenticated", email: EMAIL.unverified, emailVerified: true },
    });
    expect(listener).toHaveBeenCalledTimes(1);
    // The DB truth is verified as well: a later sign-in reports it.
    await backend.signOut();
    expect(await backend.auth.signIn({ email: EMAIL.unverified, password: TEST_PASSWORD })).toEqual(
      {
        kind: "signed_in",
        emailVerified: true,
      },
    );
  });

  it.each([null, ""])(
    "returns invalid_or_expired for the context %j without verifying",
    async (context) => {
      const backend = createBackend();
      await backend.signInAs(EMAIL.unverified);
      expect(await backend.auth.verifyEmail({ context })).toEqual({ kind: "invalid_or_expired" });
      expect(await backend.auth.getSession()).toEqual({
        kind: "ok",
        session: { kind: "authenticated", email: EMAIL.unverified, emailVerified: false },
      });
    },
  );

  it("returns invalid_or_expired when there is nobody to verify", async () => {
    const { auth } = createBackend();
    expect(await auth.verifyEmail({ context: "ctx" })).toEqual({ kind: "invalid_or_expired" });
  });

  it("follows the verify scenario and never verifies on failure", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.unverified);
    backend.setScenario({ auth: { verify: "invalid_or_expired" } });
    expect(await backend.auth.verifyEmail({ context: "ctx" })).toEqual({
      kind: "invalid_or_expired",
    });
    backend.setScenario({ auth: { verify: "unavailable" } });
    expect(await backend.auth.verifyEmail({ context: "ctx" })).toEqual({ kind: "unavailable" });
    expect(await backend.auth.getSession()).toEqual({
      kind: "ok",
      session: { kind: "authenticated", email: EMAIL.unverified, emailVerified: false },
    });
  });
});

describe("TC-SEC-API-027-101 password reset request responds identically for known and unknown emails", () => {
  it("returns the same accepted result", async () => {
    const backend = createBackend();
    const known = await backend.auth.requestPasswordReset({ email: EMAIL.demo });
    const unknown = await backend.auth.requestPasswordReset({ email: "nobody@example.com" });
    expect(known).toEqual({ kind: "accepted" });
    expect(unknown).toEqual(known);
  });

  it("does not create users or change the DB and session", async () => {
    const backend = createBackend();
    await backend.api.public.getEvent();
    const before = dbFingerprint(backend);
    const sessionBefore = backend.storage.getItem(SESSION_STORAGE_KEY);
    await backend.auth.requestPasswordReset({ email: "nobody@example.com" });
    await backend.auth.requestPasswordReset({ email: EMAIL.demo });
    expect(dbFingerprint(backend)).toBe(before);
    expect(backend.storage.getItem(SESSION_STORAGE_KEY)).toBe(sessionBefore);
    expect(
      await backend.auth.signIn({ email: "nobody@example.com", password: TEST_PASSWORD }),
    ).toEqual({
      kind: "credential_failure",
    });
  });

  it("returns unavailable for both when the provider is down", async () => {
    const backend = createBackend();
    backend.setScenario({ auth: { reset: "unavailable" } });
    expect(await backend.auth.requestPasswordReset({ email: EMAIL.demo })).toEqual({
      kind: "unavailable",
    });
    expect(await backend.auth.requestPasswordReset({ email: "nobody@example.com" })).toEqual({
      kind: "unavailable",
    });
  });
});

describe("TC-PG-AUTH-005-101 completePasswordReset (15.5, SEC-AUTH-016)", () => {
  it("returns updated for a valid context and password without changing the session", async () => {
    const backend = createBackend();
    expect(
      await backend.auth.completePasswordReset({ context: "ctx", newPassword: TEST_PASSWORD }),
    ).toEqual({ kind: "updated" });
    expect(await backend.auth.getSession()).toEqual(GUEST);
  });

  it.each([null, ""])("returns invalid_context for the context %j", async (context) => {
    const { auth } = createBackend();
    expect(await auth.completePasswordReset({ context, newPassword: TEST_PASSWORD })).toEqual({
      kind: "invalid_context",
    });
  });

  it("follows the resetContext and reset scenarios", async () => {
    const backend = createBackend();
    backend.setScenario({ auth: { resetContext: "invalid" } });
    expect(
      await backend.auth.completePasswordReset({ context: "ctx", newPassword: TEST_PASSWORD }),
    ).toEqual({ kind: "invalid_context" });
    backend.setScenario({ auth: { resetContext: "valid", reset: "unavailable" } });
    expect(
      await backend.auth.completePasswordReset({ context: "ctx", newPassword: TEST_PASSWORD }),
    ).toEqual({ kind: "unavailable" });
  });

  it("rejects the promise for a password that violates the policy (the UI must validate first)", async () => {
    const { auth } = createBackend();
    for (const newPassword of ["a".repeat(11), "a".repeat(129), ""]) {
      await expect(auth.completePasswordReset({ context: "ctx", newPassword })).rejects.toThrow(
        /password policy/i,
      );
    }
    await expect(
      auth.completePasswordReset({ context: "ctx", newPassword: "e".repeat(12) }),
    ).resolves.toEqual({ kind: "updated" });
    await expect(
      auth.completePasswordReset({ context: "ctx", newPassword: "f".repeat(128) }),
    ).resolves.toEqual({ kind: "updated" });
  });
});

describe("TC-AR-SES-009-101 signOut always discards the local session (AR-SES-009, 15.6)", () => {
  it("signs out and notifies the listeners once", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.demo);
    const listener = vi.fn();
    backend.auth.onSessionChange(listener);
    expect(await backend.auth.signOut()).toEqual({ kind: "signed_out" });
    expect(await backend.auth.getSession()).toEqual(GUEST);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("clears the local session even when the provider fails to sign out", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.demo);
    backend.setScenario({ auth: { logout: "provider_failure" } });
    expect(await backend.auth.signOut()).toEqual({ kind: "signed_out" });
    expect(await backend.auth.getSession()).toEqual(GUEST);
    expect(await backend.api.self.listOrders()).toEqual({ kind: "auth_required" });
  });

  it("clears the local session even when the session read scenario is unavailable", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.demo);
    backend.setScenario({ auth: { session: "unavailable", logout: "provider_failure" } });
    expect(await backend.auth.signOut()).toEqual({ kind: "signed_out" });
    backend.setScenario({ auth: { session: "ok" } });
    expect(await backend.auth.getSession()).toEqual(GUEST);
  });

  it("is idempotent for a guest and does not notify when nothing changed", async () => {
    const backend = createBackend();
    const listener = vi.fn();
    backend.auth.onSessionChange(listener);
    expect(await backend.auth.signOut()).toEqual({ kind: "signed_out" });
    expect(await backend.auth.getSession()).toEqual(GUEST);
    expect(listener).not.toHaveBeenCalled();
  });

  it("removes the data access immediately (no protected data after sign out)", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.demo);
    expect((await backend.api.self.getOrder(ORDER.prepared)).kind).toBe("ok");
    await backend.auth.signOut();
    expect(await backend.api.self.getOrder(ORDER.prepared)).toEqual({
      kind: "auth_required",
    });
  });
});

describe("TC-AR-SES-007-101 session persistence and change notification (design section 4, DEV-WEB-013)", () => {
  it("persists the session in the injected storage so another instance sees it", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.demo);
    const other = createBackend({ storage: backend.storage });
    expect(await other.auth.getSession()).toEqual({
      kind: "ok",
      session: { kind: "authenticated", email: EMAIL.demo, emailVerified: true },
    });
    expect(REEXPORTED_KEY).toBe("r39x.mock.session.v1");
    expect(SESSION_STORAGE_KEY).toBe("r39x.mock.session.v1");
    expect(backend.storage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
  });

  it("notifies on sign-in and sign-out and stops after unsubscribe", async () => {
    const backend = createBackend();
    const listener = vi.fn();
    const unsubscribe = backend.auth.onSessionChange(listener);
    await backend.auth.signIn({ email: EMAIL.demo, password: TEST_PASSWORD });
    expect(listener).toHaveBeenCalledTimes(1);
    await backend.auth.signOut();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    await backend.auth.signIn({ email: EMAIL.demo, password: TEST_PASSWORD });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("calls every listener with no arguments after the change is visible", async () => {
    const backend = createBackend();
    const seen: unknown[] = [];
    backend.auth.onSessionChange((...args: unknown[]) => {
      seen.push(args);
    });
    let observed: unknown = null;
    backend.auth.onSessionChange(() => {
      observed = backend.storage.getItem(SESSION_STORAGE_KEY);
    });
    await backend.auth.signIn({ email: EMAIL.demo, password: TEST_PASSWORD });
    expect(seen).toEqual([[]]);
    expect(String(observed)).toContain(EMAIL.demo);
  });

  it("does not notify on failed sign-in or on rejected sign-up", async () => {
    const backend = createBackend();
    const listener = vi.fn();
    backend.auth.onSessionChange(listener);
    await backend.auth.signIn({ email: "nobody@example.com", password: TEST_PASSWORD });
    await backend.auth.signUp({ email: "bad", password: TEST_PASSWORD });
    expect(listener).not.toHaveBeenCalled();
  });

  it("returns unavailable when the session scenario says so, without changing the stored session", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.demo);
    const before = backend.storage.getItem(SESSION_STORAGE_KEY);
    backend.setScenario({ auth: { session: "unavailable" } });
    expect(await backend.auth.getSession()).toEqual({ kind: "unavailable" });
    expect(backend.storage.getItem(SESSION_STORAGE_KEY)).toBe(before);
  });
});

describe("TC-DEV-WEB-013-105 session storage is strictly validated and corruption is explicit", () => {
  it("round-trips through the strict schema and defaults to a guest without writing", () => {
    const storage = createMemoryStorage();
    expect(loadSessionState(storage)).toEqual({
      kind: "ok",
      state: { version: 1, session: { kind: "guest" }, pendingVerificationEmail: null },
    });
    expect(storage.writes).toEqual([]);
    const state = {
      version: 1 as const,
      session: { kind: "authenticated" as const, email: EMAIL.demo, emailVerified: true },
      pendingVerificationEmail: null,
    };
    saveSessionState(storage, state);
    expect(loadSessionState(storage)).toEqual({ kind: "ok", state });
    expect(sessionStateSchema.safeParse(state).success).toBe(true);
  });

  it.each([
    ["not json", "{oops"],
    [
      "an unknown key",
      JSON.stringify({
        version: 1,
        session: { kind: "guest" },
        pendingVerificationEmail: null,
        password: "x",
      }),
    ],
    [
      "an unknown nested key",
      JSON.stringify({
        version: 1,
        session: { kind: "guest", role: "admin" },
        pendingVerificationEmail: null,
      }),
    ],
    [
      "a role claim",
      JSON.stringify({
        version: 1,
        session: { kind: "authenticated", email: EMAIL.demo, emailVerified: true, role: "ADMIN" },
        pendingVerificationEmail: null,
      }),
    ],
    [
      "a wrong version",
      JSON.stringify({ version: 3, session: { kind: "guest" }, pendingVerificationEmail: null }),
    ],
    [
      "a wrong type",
      JSON.stringify({
        version: 1,
        session: { kind: "authenticated", email: EMAIL.demo, emailVerified: "yes" },
        pendingVerificationEmail: null,
      }),
    ],
  ])("reports corrupted for %s without writing", (_name, raw) => {
    const storage = createMemoryStorage();
    storage.seedRaw(SESSION_STORAGE_KEY, raw);
    expect(loadSessionState(storage).kind).toBe("corrupted");
    expect(storage.writes).toEqual([]);
  });

  it("makes getSession unavailable instead of silently becoming a guest, and only signOut clears it", async () => {
    const backend = createBackend();
    backend.storage.seedRaw(SESSION_STORAGE_KEY, "{oops");
    expect(await backend.auth.getSession()).toEqual({ kind: "unavailable" });
    expect(backend.storage.getItem(SESSION_STORAGE_KEY)).toBe("{oops");
    expect(await backend.auth.signOut()).toEqual({ kind: "signed_out" });
    expect(await backend.auth.getSession()).toEqual(GUEST);
  });
});

describe("TC-SEC-AUTH-018-101 passwords are never stored, logged or returned (SEC-AUTH-018, DEV-WEB-013)", () => {
  it("keeps the password out of every storage entry across the whole auth lifecycle", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    const backend = createBackend();
    const results: unknown[] = [];
    results.push(await backend.auth.signUp({ email: NEW_EMAIL, password: SENTINEL }));
    results.push(await backend.auth.verifyEmail({ context: "ctx" }));
    results.push(await backend.auth.signIn({ email: NEW_EMAIL, password: SENTINEL }));
    results.push(await backend.auth.requestPasswordReset({ email: NEW_EMAIL }));
    results.push(
      await backend.auth.completePasswordReset({ context: "ctx", newPassword: SENTINEL }),
    );
    results.push(await backend.auth.signOut());
    backend.setScenario({ auth: { signup: "signed_in" } });
    results.push(await backend.auth.signUp({ email: "second@example.com", password: SENTINEL }));
    results.push(await backend.auth.signIn({ email: "second@example.com", password: SENTINEL }));
    results.push(await backend.api.self.getProfile());

    const stored = JSON.stringify(backend.storage.dump());
    expect(stored).not.toContain(SENTINEL);
    expect(stored).not.toMatch(/"password"\s*:/i);
    expect(JSON.stringify(results)).not.toContain(SENTINEL);
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(SENTINEL);
      }
    }
  });

  it("Email OTP: the one-time code is never stored, logged or returned, on success or on any failure (B5 C1, SEC-AUTH-018)", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    const backend = createBackend();
    const otp = backend.auth;
    const results: unknown[] = [];
    results.push(await otp.requestEmailOtp({ email: "otp-leak@example.com" }));
    results.push(
      await otp.signInWithEmailOtp({ email: "otp-leak@example.com", code: OTP_SENTINEL }),
    );
    results.push(await backend.auth.getSession());
    results.push(await backend.auth.signOut());
    for (const scenario of [
      { login: "credential_failure" },
      { login: "unavailable" },
      { verify: "invalid_or_expired" },
    ] as const) {
      backend.setScenario({ auth: scenario });
      results.push(await otp.requestEmailOtp({ email: EMAIL.demo }));
      results.push(await otp.signInWithEmailOtp({ email: EMAIL.demo, code: OTP_SENTINEL }));
      backend.setScenario({ auth: { login: "ok", verify: "ok" } });
    }
    results.push(await otp.signInWithEmailOtp({ email: EMAIL.demo, code: "" }));
    results.push(await backend.api.self.getProfile());

    const stored = JSON.stringify(backend.storage.dump());
    expect(stored).not.toContain(OTP_SENTINEL);
    expect(stored).not.toMatch(/"(code|otp|token)"\s*:/i);
    expect(JSON.stringify(results)).not.toContain(OTP_SENTINEL);
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(OTP_SENTINEL);
      }
    }
  });

  it("does not echo the password in the policy-violation error", async () => {
    const { auth } = createBackend();
    const short = "Short-Secret-1";
    const failing = auth.completePasswordReset({ context: "ctx", newPassword: short.slice(0, 5) });
    await expect(failing).rejects.toThrow();
    await failing.catch((error: unknown) => {
      expect(String(error instanceof Error ? error.message : error)).not.toContain("Short");
    });
  });
});

// ---- B5 C1: Email OTP (SPEC-050 15.0 / 15.3, SPEC-140 SEC-API-027 / SEC-AUTH-018) -----------------------------
// tests/contracts/s2-mock-backend.md section 14. Scenario values are reused (plan Q2): auth.login decides
// unavailable / credential_failure, auth.verify decides invalid_or_expired. The mock never compares a code.

const OTP_REQUEST_EMAILS = [
  ["a registered email", EMAIL.demo],
  ["an unregistered email", "nobody@example.com"],
] as const;

describe("TC-PG-AUTH-003-102 requestEmailOtp answers alike for known and unknown emails and changes nothing (SEC-API-027, SPEC-050 15.0)", () => {
  it("returns the same { kind: sent } for a registered and an unregistered email", async () => {
    const otp = createBackend().auth;
    const known = await otp.requestEmailOtp({ email: EMAIL.demo });
    const unknown = await otp.requestEmailOtp({ email: "nobody@example.com" });
    const unverified = await otp.requestEmailOtp({ email: EMAIL.unverified });
    expect(known).toEqual({ kind: "sent" });
    expect(unknown).toEqual(known);
    expect(unverified).toEqual(known);
  });

  it.each(OTP_REQUEST_EMAILS)(
    "%s: the DB, the session value, pendingVerificationEmail and every storage write stay as they were, and no listener is called",
    async (_name, email) => {
      const backend = createBackend();
      backend.storage.seedRaw(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          session: { kind: "guest" },
          pendingVerificationEmail: "pending@example.com",
        }),
      );
      await backend.api.public.getEvent();
      const listener = vi.fn();
      backend.auth.onSessionChange(listener);
      const dbBefore = dbFingerprint(backend);
      const sessionBefore = backend.storage.getItem(SESSION_STORAGE_KEY);
      const writesBefore = [...backend.storage.writes];

      await backend.auth.requestEmailOtp({ email });

      expect(dbFingerprint(backend)).toBe(dbBefore);
      expect(backend.storage.getItem(SESSION_STORAGE_KEY)).toBe(sessionBefore);
      expect(backend.storage.writes).toEqual(writesBefore);
      expect(listener).not.toHaveBeenCalled();
      expect(await backend.auth.getSession()).toEqual(GUEST);
      // No user was created for an unknown email: a password sign-in still fails alike.
      expect(await backend.auth.signIn({ email: "nobody@example.com", password: "x" })).toEqual({
        kind: "credential_failure",
      });
    },
  );

  it("follows the login scenario for unavailable and ignores credential_failure and the verify scenario (they decide the code check)", async () => {
    const backend = createBackend();
    const otp = backend.auth;
    backend.setScenario({ auth: { login: "unavailable" } });
    for (const [, email] of OTP_REQUEST_EMAILS) {
      expect(await otp.requestEmailOtp({ email })).toEqual({ kind: "unavailable" });
    }
    backend.setScenario({ auth: { login: "credential_failure" } });
    for (const [, email] of OTP_REQUEST_EMAILS) {
      expect(await otp.requestEmailOtp({ email })).toEqual({ kind: "sent" });
    }
    backend.setScenario({ auth: { login: "ok", verify: "invalid_or_expired" } });
    for (const [, email] of OTP_REQUEST_EMAILS) {
      expect(await otp.requestEmailOtp({ email })).toEqual({ kind: "sent" });
    }
    expect(await backend.auth.getSession()).toEqual(GUEST);
  });

  it("returns unavailable when the scenario storage is corrupted", async () => {
    const backend = createBackend();
    backend.storage.seedRaw(SCENARIO_STORAGE_KEY, "{oops");
    expect(await backend.auth.requestEmailOtp({ email: EMAIL.demo })).toEqual({
      kind: "unavailable",
    });
  });

  it.each(["", "   ", "not-an-email", "a b@example.com", "@example.com"])(
    "rejects the promise with a RangeError for the malformed email %j (the UI validates first) without echoing it",
    async (email) => {
      const backend = createBackend();
      const failing = backend.auth.requestEmailOtp({ email });
      await expect(failing).rejects.toBeInstanceOf(RangeError);
      await failing.catch((error: unknown) => {
        const message = String(error instanceof Error ? error.message : error);
        if (email.trim() !== "") expect(message).not.toContain(email);
      });
      expect(await backend.auth.getSession()).toEqual(GUEST);
    },
  );
});

describe("TC-PG-AUTH-003-103 signInWithEmailOtp signs in, verifies the email, registers a new user, and fails without changing anything (AR-AUTH-008, FR-AUTH-001, FR-AUTH-005, plan Q2 / Q5 / Q7)", () => {
  const CODE = "246810";

  it("a verified seed user signs in: signed_in with emailVerified true, an authenticated verified session, one notification, the DB unchanged", async () => {
    const backend = createBackend();
    await backend.api.public.getEvent();
    const listener = vi.fn();
    backend.auth.onSessionChange(listener);
    const dbBefore = dbFingerprint(backend);
    expect(await backend.auth.signInWithEmailOtp({ email: EMAIL.demo, code: CODE })).toEqual({
      kind: "signed_in",
      emailVerified: true,
    });
    expect(await backend.auth.getSession()).toEqual({
      kind: "ok",
      session: { kind: "authenticated", email: EMAIL.demo, emailVerified: true },
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(dbFingerprint(backend)).toBe(dbBefore);
  });

  it("an unverified seed user is verified by the code (the code proves the mailbox): the user and the session are verified (Q7)", async () => {
    const backend = createBackend();
    const listener = vi.fn();
    backend.auth.onSessionChange(listener);
    expect(await backend.auth.signInWithEmailOtp({ email: EMAIL.unverified, code: CODE })).toEqual({
      kind: "signed_in",
      emailVerified: true,
    });
    expect(await backend.auth.getSession()).toEqual({
      kind: "ok",
      session: { kind: "authenticated", email: EMAIL.unverified, emailVerified: true },
    });
    const loaded = backend.db.load();
    if (loaded.kind !== "ready") throw new Error("expected a ready DB");
    expect(loaded.state.users.find((u) => u.email === EMAIL.unverified)?.emailVerified).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    // A later password sign-in reports the verified state as well.
    await backend.signOut();
    expect(await backend.auth.signIn({ email: EMAIL.unverified, password: TEST_PASSWORD })).toEqual(
      { kind: "signed_in", emailVerified: true },
    );
  });

  it("an unknown email is the first registration: one new verified user with displayName null, signed in", async () => {
    const backend = createBackend();
    const before = backend.db.load();
    if (before.kind !== "ready") throw new Error("expected a ready DB");
    const countBefore = before.state.users.length;
    const listener = vi.fn();
    backend.auth.onSessionChange(listener);
    expect(await backend.auth.signInWithEmailOtp({ email: NEW_EMAIL, code: CODE })).toEqual({
      kind: "signed_in",
      emailVerified: true,
    });
    const loaded = backend.db.load();
    if (loaded.kind !== "ready") throw new Error("expected a ready DB");
    expect(loaded.state.users).toHaveLength(countBefore + 1);
    expect(loaded.state.users.filter((u) => u.email === NEW_EMAIL)).toEqual([
      { email: NEW_EMAIL, displayName: null, emailVerified: true },
    ]);
    expect(await backend.auth.getSession()).toEqual({
      kind: "ok",
      session: { kind: "authenticated", email: NEW_EMAIL, emailVerified: true },
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("a registered user's OTP sign-in and a password sign-in end in the same session", async () => {
    const viaOtp = createBackend();
    await viaOtp.auth.signInWithEmailOtp({ email: EMAIL.fresh, code: CODE });
    const viaPassword = createBackend();
    await viaPassword.auth.signIn({ email: EMAIL.fresh, password: TEST_PASSWORD });
    expect(await viaOtp.auth.getSession()).toEqual(await viaPassword.auth.getSession());
  });

  it("auth.login credential_failure is a wrong code (code_invalid); auth.verify invalid_or_expired is an expired or exhausted code (code_expired); auth.login wins", async () => {
    const backend = createBackend();
    const otp = backend.auth;
    backend.setScenario({ auth: { login: "credential_failure" } });
    expect(await otp.signInWithEmailOtp({ email: EMAIL.demo, code: CODE })).toEqual({
      kind: "code_invalid",
    });
    backend.setScenario({ auth: { login: "ok", verify: "invalid_or_expired" } });
    expect(await otp.signInWithEmailOtp({ email: EMAIL.demo, code: CODE })).toEqual({
      kind: "code_expired",
    });
    backend.setScenario({ auth: { login: "credential_failure", verify: "invalid_or_expired" } });
    expect(await otp.signInWithEmailOtp({ email: EMAIL.demo, code: CODE })).toEqual({
      kind: "code_invalid",
    });
  });

  it("auth.login unavailable is unavailable, and it is decided before the verify scenario", async () => {
    const backend = createBackend();
    const otp = backend.auth;
    backend.setScenario({ auth: { login: "unavailable" } });
    expect(await otp.signInWithEmailOtp({ email: EMAIL.demo, code: CODE })).toEqual({
      kind: "unavailable",
    });
    backend.setScenario({ auth: { login: "unavailable", verify: "invalid_or_expired" } });
    expect(await otp.signInWithEmailOtp({ email: EMAIL.demo, code: CODE })).toEqual({
      kind: "unavailable",
    });
  });

  it("an empty code is code_invalid whatever the email", async () => {
    const backend = createBackend();
    const otp = backend.auth;
    expect(await otp.signInWithEmailOtp({ email: EMAIL.demo, code: "" })).toEqual({
      kind: "code_invalid",
    });
    expect(await otp.signInWithEmailOtp({ email: NEW_EMAIL, code: "" })).toEqual({
      kind: "code_invalid",
    });
    expect(await backend.auth.getSession()).toEqual(GUEST);
    expect(await backend.auth.signIn({ email: NEW_EMAIL, password: TEST_PASSWORD })).toEqual({
      kind: "credential_failure",
    });
  });

  it.each([
    ["code_invalid", { login: "credential_failure" }, EMAIL.demo, CODE],
    ["code_expired", { verify: "invalid_or_expired" }, EMAIL.unverified, CODE],
    ["unavailable", { login: "unavailable" }, NEW_EMAIL, CODE],
    ["code_invalid (empty code)", {}, NEW_EMAIL, ""],
  ] as const)(
    "%s changes neither the DB, the session, any storage entry nor a listener",
    async (_name, auth, email, code) => {
      const backend = createBackend();
      await backend.api.public.getEvent();
      backend.setScenario({ auth });
      const listener = vi.fn();
      backend.auth.onSessionChange(listener);
      const dbBefore = dbFingerprint(backend);
      const sessionBefore = backend.storage.getItem(SESSION_STORAGE_KEY);
      const writesBefore = [...backend.storage.writes];
      await backend.auth.signInWithEmailOtp({ email, code });
      expect(dbFingerprint(backend)).toBe(dbBefore);
      expect(backend.storage.getItem(SESSION_STORAGE_KEY)).toBe(sessionBefore);
      expect(backend.storage.writes).toEqual(writesBefore);
      expect(listener).not.toHaveBeenCalled();
      expect(await backend.auth.getSession()).toEqual(GUEST);
    },
  );

  it("a failed OTP sign-in keeps the current session", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.demo);
    backend.setScenario({ auth: { login: "credential_failure" } });
    expect(await backend.auth.signInWithEmailOtp({ email: EMAIL.other, code: CODE })).toEqual({
      kind: "code_invalid",
    });
    expect(await backend.auth.getSession()).toEqual({
      kind: "ok",
      session: { kind: "authenticated", email: EMAIL.demo, emailVerified: true },
    });
  });

  it.each([
    ["the scenario", SCENARIO_STORAGE_KEY],
    ["the DB", DB_STORAGE_KEY],
    ["the session", SESSION_STORAGE_KEY],
  ])(
    "returns unavailable, and writes nothing, when %s storage is corrupted",
    async (_name, key) => {
      const backend = createBackend();
      await backend.api.public.getEvent();
      backend.storage.seedRaw(key, "{oops");
      const writesBefore = [...backend.storage.writes];
      expect(await backend.auth.signInWithEmailOtp({ email: EMAIL.demo, code: CODE })).toEqual({
        kind: "unavailable",
      });
      expect(backend.storage.writes).toEqual(writesBefore);
      expect(backend.storage.getItem(key)).toBe("{oops");
    },
  );

  it("the answer to the code request does not tell a registered email from an unregistered one, and both reach a session with a code", async () => {
    const backend = createBackend();
    const otp = backend.auth;
    const known = await otp.requestEmailOtp({ email: EMAIL.demo });
    const unknown = await otp.requestEmailOtp({ email: NEW_EMAIL });
    expect(unknown).toEqual(known);
    expect((await otp.signInWithEmailOtp({ email: NEW_EMAIL, code: CODE })).kind).toBe("signed_in");
  });
});

// ---- B5 C2: Google (tests/contracts/s2-mock-backend.md section 14.2) -----------------------------------------------------

const GOOGLE_PATHS = {
  successPath: "/account/login?continue=cart&returned=google",
  failurePath: "/account/login?continue=cart&notice=google-failed",
};
const GOOGLE_UNSAFE_PATHS: readonly (readonly [string, string])[] = [
  ["an absolute URL", "https://evil.example.com/account/login"],
  ["a protocol-relative URL", "//evil.example.com/account/login"],
  ["a backslash form", "/\\evil.example.com/account/login"],
  ["a javascript: URL", "javascript:alert(1)"],
  ["an empty path", ""],
  ["a dot segment", "/account/../admin"],
  ["a control character", "/account/login\n?returned=google"],
  ["an encoded dot segment", "/account/%2e%2e/admin"],
  ["a PG-AUTH page that is not Login or Registration", "/account/email-verification"],
  ["the password reset page", "/account/password-reset"],
  ["a protected page", "/mypage"],
  ["a dev page", "/dev/scenarios"],
  ["the admin area", "/admin"],
  ["Home", "/"],
];

describe("TC-PG-AUTH-003-104 startGoogleSignIn returns the stand-in screen's URL without changing anything, refuses unsafe return paths, and follows the login scenario (SPEC-050 15.0, SEC-WEB-013, DEV-WEB-013)", () => {
  const googleOf = (backend: ReturnType<typeof createBackend>) => backend.auth;

  it("redirects to /dev/mock-google carrying both paths, and the URL is a safe same-origin path", async () => {
    const backend = createBackend();
    const result = await googleOf(backend).startGoogleSignIn(GOOGLE_PATHS);
    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;
    expect(result.url.startsWith("/dev/mock-google?")).toBe(true);
    expect(isSafeRelativePath(result.url)).toBe(true);
    const url = new URL(result.url, "http://127.0.0.1");
    expect(url.pathname).toBe("/dev/mock-google");
    expect([...url.searchParams.keys()].sort()).toEqual(["failure", "success"]);
    expect(url.searchParams.get("success")).toBe(GOOGLE_PATHS.successPath);
    expect(url.searchParams.get("failure")).toBe(GOOGLE_PATHS.failurePath);
    // The query values are percent-encoded: no raw "&" or "?" of the inner paths leaks into the outer query.
    expect(result.url).toBe(
      `/dev/mock-google?success=${encodeURIComponent(GOOGLE_PATHS.successPath)}&failure=${encodeURIComponent(GOOGLE_PATHS.failurePath)}`,
    );
  });

  it("also accepts the registration page", async () => {
    const result = await googleOf(createBackend()).startGoogleSignIn({
      successPath: "/account/register?returned=google",
      failurePath: "/account/register?notice=google-failed",
    });
    expect(result.kind).toBe("redirect");
  });

  it.each([
    ["Guest", false],
    ["an authenticated session", true],
  ])(
    "%s: the DB, the session value, pendingVerificationEmail and every storage write stay as they were, and no listener is called",
    async (_name, signedIn) => {
      const backend = createBackend();
      if (signedIn) await backend.signInAs(EMAIL.demo);
      await backend.api.public.getEvent();
      const listener = vi.fn();
      backend.auth.onSessionChange(listener);
      const dbBefore = dbFingerprint(backend);
      const sessionBefore = backend.storage.getItem(SESSION_STORAGE_KEY);
      const writesBefore = [...backend.storage.writes];

      await googleOf(backend).startGoogleSignIn(GOOGLE_PATHS);

      expect(dbFingerprint(backend)).toBe(dbBefore);
      expect(backend.storage.getItem(SESSION_STORAGE_KEY)).toBe(sessionBefore);
      expect(backend.storage.writes).toEqual(writesBefore);
      expect(listener).not.toHaveBeenCalled();
      expect(await backend.auth.getSession()).toEqual(
        signedIn
          ? {
              kind: "ok",
              session: { kind: "authenticated", email: EMAIL.demo, emailVerified: true },
            }
          : GUEST,
      );
    },
  );

  it.each(GOOGLE_UNSAFE_PATHS)(
    "rejects the promise with a RangeError for %s as the success path and as the failure path, without changing anything",
    async (_name, path) => {
      for (const paths of [
        { successPath: path, failurePath: GOOGLE_PATHS.failurePath },
        { successPath: GOOGLE_PATHS.successPath, failurePath: path },
      ]) {
        const backend = createBackend();
        await backend.api.public.getEvent();
        const dbBefore = dbFingerprint(backend);
        const writesBefore = [...backend.storage.writes];
        const failing = googleOf(backend).startGoogleSignIn(paths);
        await expect(failing).rejects.toBeInstanceOf(RangeError);
        expect(dbFingerprint(backend)).toBe(dbBefore);
        expect(backend.storage.writes).toEqual(writesBefore);
        expect(await backend.auth.getSession()).toEqual(GUEST);
      }
    },
  );

  it("follows the login scenario for unavailable and ignores credential_failure and the verify scenario (they decide other methods)", async () => {
    const backend = createBackend();
    const google = googleOf(backend);
    backend.setScenario({ auth: { login: "unavailable" } });
    expect(await google.startGoogleSignIn(GOOGLE_PATHS)).toEqual({ kind: "unavailable" });
    backend.setScenario({ auth: { login: "credential_failure" } });
    expect((await google.startGoogleSignIn(GOOGLE_PATHS)).kind).toBe("redirect");
    backend.setScenario({ auth: { login: "ok", verify: "invalid_or_expired" } });
    expect((await google.startGoogleSignIn(GOOGLE_PATHS)).kind).toBe("redirect");
    expect(await backend.auth.getSession()).toEqual(GUEST);
  });

  it("returns unavailable when the scenario storage is corrupted", async () => {
    const backend = createBackend();
    backend.storage.seedRaw(SCENARIO_STORAGE_KEY, "{oops");
    expect(await googleOf(backend).startGoogleSignIn(GOOGLE_PATHS)).toEqual({
      kind: "unavailable",
    });
  });

  it("never puts an email, a token or a credential into the URL", async () => {
    const result = await googleOf(createBackend()).startGoogleSignIn(GOOGLE_PATHS);
    expect(JSON.stringify(result)).not.toMatch(/@|token|secret|password|code=/i);
  });
});

describe("TC-PG-AUTH-003-104 the stand-in screen's allow function signs an existing user in or registers a new one, and refuses to run on broken state (DEV-WEB-013, SPEC-030 9.2)", () => {
  const depsOf = (backend: ReturnType<typeof createBackend>) => ({
    storage: backend.storage,
    clock: backend.clock,
    idGenerator: backend.ids,
  });

  it("an existing verified user: the session becomes that user's, the DB is unchanged", async () => {
    const backend = createBackend();
    await backend.api.public.getEvent();
    const dbBefore = dbFingerprint(backend);
    const result = await allowMockGoogle(depsOf(backend), EMAIL.demo);
    expect(result).toEqual({ kind: "signed_in" });
    expect(await backend.auth.getSession()).toEqual({
      kind: "ok",
      session: { kind: "authenticated", email: EMAIL.demo, emailVerified: true },
    });
    expect(dbFingerprint(backend)).toBe(dbBefore);
  });

  it("a new email: one verified user with no display name is created (never inferred from the email) and the session is theirs", async () => {
    const backend = createBackend();
    await backend.api.public.getEvent();
    const before = okUsers(backend);
    const result = await allowMockGoogle(depsOf(backend), "google.new@example.com");
    expect(result).toEqual({ kind: "signed_in" });
    const users = okUsers(backend);
    expect(users).toHaveLength(before.length + 1);
    expect(users.filter((u) => u.email === "google.new@example.com")).toEqual([
      { email: "google.new@example.com", displayName: null, emailVerified: true },
    ]);
    expect(await backend.auth.getSession()).toEqual({
      kind: "ok",
      session: { kind: "authenticated", email: "google.new@example.com", emailVerified: true },
    });
  });

  it("calling it again for the same new email does not create a second user", async () => {
    const backend = createBackend();
    await allowMockGoogle(depsOf(backend), "google.new@example.com");
    const count = okUsers(backend).length;
    await allowMockGoogle(depsOf(backend), "google.new@example.com");
    expect(okUsers(backend)).toHaveLength(count);
  });

  it("replaces the session of another user (the result of a result opened after another login)", async () => {
    const backend = createBackend();
    await backend.signInAs(EMAIL.demo);
    await allowMockGoogle(depsOf(backend), "google.new@example.com");
    expect(await backend.auth.getSession()).toEqual({
      kind: "ok",
      session: { kind: "authenticated", email: "google.new@example.com", emailVerified: true },
    });
  });

  it.each(["", "   ", "not-an-email", "a b@example.com", "@example.com"])(
    "rejects a malformed email %j with a RangeError and changes nothing",
    async (email) => {
      const backend = createBackend();
      await backend.api.public.getEvent();
      const dbBefore = dbFingerprint(backend);
      const writesBefore = [...backend.storage.writes];
      await expect(allowMockGoogle(depsOf(backend), email)).rejects.toBeInstanceOf(RangeError);
      expect(dbFingerprint(backend)).toBe(dbBefore);
      expect(backend.storage.writes).toEqual(writesBefore);
    },
  );

  it("is unavailable and writes nothing when the stored DB or session is corrupted", async () => {
    const dbBroken = createBackend();
    dbBroken.storage.seedRaw(DB_STORAGE_KEY, "{oops");
    expect(await allowMockGoogle(depsOf(dbBroken), EMAIL.demo)).toEqual({ kind: "unavailable" });
    expect(dbBroken.storage.getItem(SESSION_STORAGE_KEY)).toBeNull();

    const sessionBroken = createBackend();
    sessionBroken.storage.seedRaw(SESSION_STORAGE_KEY, "{oops");
    const writesBefore = [...sessionBroken.storage.writes];
    expect(await allowMockGoogle(depsOf(sessionBroken), EMAIL.demo)).toEqual({
      kind: "unavailable",
    });
    expect(sessionBroken.storage.writes).toEqual(writesBefore);
  });
});

function okUsers(backend: ReturnType<typeof createBackend>) {
  const loaded = backend.db.load();
  if (loaded.kind !== "ready") throw new Error("expected a ready DB");
  return loaded.state.users;
}
