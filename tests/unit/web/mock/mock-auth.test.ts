import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY as REEXPORTED_KEY } from "../../../../apps/web/src/mock/backend/mock-auth.ts";
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
} from "../../../harness/mock-backend.ts";
import { EMAIL, ORDER, TEST_PASSWORD } from "../../../harness/mock-seed.ts";

const NEW_EMAIL = "newcomer@example.com";
const SENTINEL = "Sentinel-Pass-Phrase-9876";
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
