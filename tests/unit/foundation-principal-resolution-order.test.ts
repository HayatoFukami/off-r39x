// PR-S0-1b addendum T2: resolvePrincipal decides in the order of SPEC-110 §24 / §24.1 (v2.4.0):
// directory read failure, missing Identity, inconsistent directory row, unverified Email (step 3),
// then the Business Profile and the Role Assignments (step 5), from one store call (DB-ARC-008,
// SEC-AUTH-003, AR-AUTH-003). Synthetic data only.
import { describe, expect, it } from "vitest";
import {
  AuthFailure,
  type PrincipalRecord,
  type PrincipalStore,
  resolvePrincipal,
} from "../../packages/auth/src/index.ts";

const SUBJECT = "00000000-0000-4000-8000-0000000000b1";
const OTHER_SUBJECT = "00000000-0000-4000-8000-0000000000b2";
const PROFILE_REF = "00000000-0000-4000-8000-0000000000b3";
const identity = { subject: SUBJECT };

const resolve = resolvePrincipal;

const directory = (emailVerified: boolean, authSubject = SUBJECT) => ({
  authSubject,
  emailVerified,
});
const profile = (authSubject = SUBJECT, publicRef = PROFILE_REF) => ({
  id: "1",
  publicRef,
  authSubject,
});

function store(row: PrincipalRecord | Error): { store: PrincipalStore; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    store: {
      findByAuthSubject: async () => {
        calls += 1;
        if (row instanceof Error) throw row;
        return row;
      },
    },
  };
}
const failureOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return "none";
  } catch (error) {
    return error instanceof AuthFailure ? error.kind : `other:${String(error)}`;
  }
};

interface Row {
  readonly name: string;
  readonly row: PrincipalRecord | Error;
  /** The AuthFailure kind with { requireVerifiedEmail: true }, or "ok". */
  readonly kind: string;
}
const ROWS: readonly Row[] = [
  {
    name: "1 unverified Email, no Business Profile",
    row: { directory: directory(false), profile: null, roles: [] },
    kind: "email",
  },
  {
    name: "2 unverified Email, the Business Profile belongs to another subject",
    row: { directory: directory(false), profile: profile(OTHER_SUBJECT), roles: [] },
    kind: "email",
  },
  {
    name: "3 unverified Email, an unknown role",
    row: { directory: directory(false), profile: profile(), roles: ["CUSTOMER"] },
    kind: "email",
  },
  {
    name: "3b unverified Email, an invalid public reference",
    row: { directory: directory(false), profile: profile(SUBJECT, "not-a-uuid"), roles: [] },
    kind: "email",
  },
  {
    name: "3c unverified Email, a consistent Business Profile",
    row: { directory: directory(false), profile: profile(), roles: ["STAFF"] },
    kind: "email",
  },
  {
    name: "4 verified Email, no Business Profile",
    row: { directory: directory(true), profile: null, roles: [] },
    kind: "denied",
  },
  {
    name: "5 no directory row (no Identity)",
    row: { directory: null, profile: null, roles: [] },
    kind: "unauthenticated",
  },
  {
    name: "5b no directory row and a stray Business Profile",
    row: { directory: null, profile: profile(), roles: [] },
    kind: "unauthenticated",
  },
  {
    name: "6 directory row of another subject, unverified, no Business Profile",
    row: { directory: directory(false, OTHER_SUBJECT), profile: null, roles: [] },
    kind: "consistency",
  },
  {
    name: "6b directory row of another subject, verified, no Business Profile",
    row: { directory: directory(true, OTHER_SUBJECT), profile: null, roles: [] },
    kind: "consistency",
  },
  {
    name: "6c directory row with a non-boolean verified state",
    row: {
      directory: { authSubject: SUBJECT, emailVerified: "yes" as unknown as boolean },
      profile: profile(),
      roles: [],
    },
    kind: "consistency",
  },
  {
    name: "7 verified Email, a consistent Business Profile",
    row: { directory: directory(true), profile: profile(), roles: ["ADMINISTRATOR", "STAFF"] },
    kind: "ok",
  },
  {
    name: "7b verified Email, the Business Profile belongs to another subject",
    row: { directory: directory(true), profile: profile(OTHER_SUBJECT), roles: [] },
    kind: "consistency",
  },
  {
    name: "7c verified Email, an invalid public reference",
    row: { directory: directory(true), profile: profile(SUBJECT, "not-a-uuid"), roles: [] },
    kind: "consistency",
  },
  {
    name: "7d verified Email, an unknown role",
    row: { directory: directory(true), profile: profile(), roles: ["CUSTOMER"] },
    kind: "consistency",
  },
  {
    name: "8 directory read failure",
    row: new Error("synthetic directory failure"),
    kind: "database",
  },
];

describe("TC-SEC-AUTH-003-002 resolvePrincipal evaluates the Email verified check before the Business Profile (SEC-AUTH-003, AR-AUTH-003, SPEC-110 §24.1)", () => {
  describe("with { requireVerifiedEmail: true }", () => {
    for (const c of ROWS) {
      it(`${c.name}: ${c.kind}, with one store call`, async () => {
        const s = store(c.row);
        const kind = await failureOf(resolve(identity, s.store, { requireVerifiedEmail: true }));
        expect(kind).toBe(c.kind === "ok" ? "none" : c.kind);
        expect(s.calls()).toBe(1);
      });
    }

    it("a verified Identity with a consistent Business Profile resolves to its Principal", async () => {
      const principal = await resolve(
        identity,
        store({ directory: directory(true), profile: profile(), roles: ["STAFF"] }).store,
        { requireVerifiedEmail: true },
      );
      expect(principal).toEqual({
        subject: SUBJECT,
        profileRef: PROFILE_REF,
        emailVerified: true,
        roles: ["STAFF"],
      });
    });
  });

  describe("without the option (existing callers)", () => {
    it("an unverified Email still yields a Principal with emailVerified false", async () => {
      const s = store({ directory: directory(false), profile: profile(), roles: [] });
      expect(await resolve(identity, s.store)).toEqual({
        subject: SUBJECT,
        profileRef: PROFILE_REF,
        emailVerified: false,
        roles: [],
      });
      expect(s.calls()).toBe(1);
    });

    it("an explicit false behaves like the omitted option", async () => {
      const principal = await resolve(
        identity,
        store({ directory: directory(false), profile: profile(), roles: [] }).store,
        { requireVerifiedEmail: false },
      );
      expect(principal.emailVerified).toBe(false);
    });

    it("the other failures keep the same order (database, no Identity, inconsistent directory row, no Business Profile, inconsistency)", async () => {
      for (const c of ROWS.filter((x) => x.kind !== "email")) {
        const kind = await failureOf(resolve(identity, store(c.row).store));
        // Without the Email check a directory-less or unverified row never raises "email".
        expect(kind, c.name).toBe(c.kind === "ok" ? "none" : c.kind);
      }
      // An unverified Email with a missing Business Profile is the Business Profile's failure.
      expect(
        await failureOf(
          resolve(identity, store({ directory: directory(false), profile: null, roles: [] }).store),
        ),
      ).toBe("denied");
    });
  });
});
