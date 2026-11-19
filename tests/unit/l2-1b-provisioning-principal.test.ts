// PR-L2-1b C1. TC-DB-AUTH-001-003 (G1): resolveProvisioningPrincipal of @off-r39x/auth decides like
// resolvePrincipal in everything except "Email verified and no Business Profile", which is a result
// ({ profile: "missing" }) and not a refusal. Email verification cannot be switched off (SEC-AUTH-003,
// SPEC-060 §8.3), the Email decision is made before the Profile one (SPEC-110 §24.1), and an inconsistent
// row stays a refusal (AR-ID-006, fail closed). Synthetic data only.
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AuthFailure,
  type PrincipalRecord,
  type PrincipalStore,
  resolvePrincipal,
  resolveProvisioningPrincipal,
} from "../../packages/auth/src/index.ts";

const SUBJECT = "00000000-0000-4000-8000-0000000000b1";
const OTHER_SUBJECT = "00000000-0000-4000-8000-0000000000b2";
const PROFILE_REF = "00000000-0000-4000-8000-0000000000b3";
const identity = { subject: SUBJECT };

const directory = (emailVerified: boolean, authSubject = SUBJECT) => ({
  authSubject,
  emailVerified,
});
const profile = (authSubject = SUBJECT, publicRef = PROFILE_REF) => ({
  id: "1",
  publicRef,
  authSubject,
});
const store = (row: PrincipalRecord | Error): { store: PrincipalStore; calls: () => number } => {
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
};
const kindOf = async (promise: Promise<unknown>): Promise<string> => {
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
  /** The AuthFailure kind both functions raise (the same for both), or "ok". */
  readonly kind: string;
}
const SAME: readonly Row[] = [
  {
    name: "no directory row",
    row: { directory: null, profile: null, roles: [] },
    kind: "unauthenticated",
  },
  {
    name: "directory row of another subject",
    row: { directory: directory(true, OTHER_SUBJECT), profile: null, roles: [] },
    kind: "consistency",
  },
  {
    name: "a non-boolean verified state",
    row: {
      directory: { authSubject: SUBJECT, emailVerified: "yes" as unknown as boolean },
      profile: profile(),
      roles: [],
    },
    kind: "consistency",
  },
  {
    name: "unverified Email, no Profile",
    row: { directory: directory(false), profile: null, roles: [] },
    kind: "email",
  },
  {
    name: "unverified Email, a consistent Profile",
    row: { directory: directory(false), profile: profile(), roles: [] },
    kind: "email",
  },
  {
    name: "unverified Email, an inconsistent Profile",
    row: { directory: directory(false), profile: profile(OTHER_SUBJECT), roles: [] },
    kind: "email",
  },
  {
    name: "Profile of another subject",
    row: { directory: directory(true), profile: profile(OTHER_SUBJECT), roles: [] },
    kind: "consistency",
  },
  {
    name: "an invalid public reference",
    row: { directory: directory(true), profile: profile(SUBJECT, "not-a-uuid"), roles: [] },
    kind: "consistency",
  },
  {
    name: "an unknown role",
    row: { directory: directory(true), profile: profile(), roles: ["CUSTOMER"] },
    kind: "consistency",
  },
  { name: "a store failure", row: new Error("synthetic directory failure"), kind: "database" },
  {
    name: "Profile, no role",
    row: { directory: directory(true), profile: profile(), roles: [] },
    kind: "ok",
  },
  {
    name: "Profile, STAFF",
    row: { directory: directory(true), profile: profile(), roles: ["STAFF"] },
    kind: "ok",
  },
  {
    name: "Profile, ADMINISTRATOR",
    row: { directory: directory(true), profile: profile(), roles: ["ADMINISTRATOR"] },
    kind: "ok",
  },
];

describe("TC-DB-AUTH-001-003 resolveProvisioningPrincipal against resolvePrincipal (SPEC-110 §24/§24.1, AR-ID-001, SEC-AUTH-003)", () => {
  for (const c of SAME) {
    it(`${c.name}: both give ${c.kind === "ok" ? "the same Principal" : c.kind}, with one store call each`, async () => {
      const a = store(c.row);
      const b = store(c.row);
      const classic = resolvePrincipal(identity, a.store, { requireVerifiedEmail: true });
      // Observed below; this keeps an early failure of the provisioning call from leaving it unhandled.
      classic.catch(() => undefined);
      const provisioning = resolveProvisioningPrincipal(identity, b.store, {});
      if (c.kind === "ok") {
        const principal = await classic;
        expect(await provisioning).toEqual({ profile: "present", principal });
      } else {
        expect(await kindOf(classic)).toBe(c.kind);
        expect(await kindOf(provisioning)).toBe(c.kind);
      }
      expect(a.calls()).toBe(1);
      expect(b.calls()).toBe(1);
    });
  }

  it("a verified Email without a Profile is the single difference: denied for resolvePrincipal, missing for provisioning", async () => {
    const row: PrincipalRecord = { directory: directory(true), profile: null, roles: [] };
    expect(
      await kindOf(resolvePrincipal(identity, store(row).store, { requireVerifiedEmail: true })),
    ).toBe("denied");
    expect(await resolveProvisioningPrincipal(identity, store(row).store, {})).toEqual({
      profile: "missing",
      subject: SUBJECT,
    });
  });

  it("no Profile but a Role row (impossible by the LEFT JOIN) is consistency (fail closed)", async () => {
    const row: PrincipalRecord = { directory: directory(true), profile: null, roles: ["STAFF"] };
    expect(await kindOf(resolveProvisioningPrincipal(identity, store(row).store, {}))).toBe(
      "consistency",
    );
  });
});

describe("TC-DB-AUTH-001-003 onEmailVerified is reported once, when the Email check passes, before the Profile decision", () => {
  const rows: [string, PrincipalRecord][] = [
    ["a Profile", { directory: directory(true), profile: profile(), roles: [] }],
    ["no Profile", { directory: directory(true), profile: null, roles: [] }],
    [
      "an inconsistent Profile",
      { directory: directory(true), profile: profile(OTHER_SUBJECT), roles: [] },
    ],
  ];
  it.each(rows)("verified Email, %s: called once by both functions", async (_label, row) => {
    for (const run of ["classic", "provisioning"] as const) {
      let called = 0;
      const onEmailVerified = () => {
        called += 1;
      };
      const promise =
        run === "classic"
          ? resolvePrincipal(identity, store(row).store, {
              requireVerifiedEmail: true,
              onEmailVerified,
            })
          : resolveProvisioningPrincipal(identity, store(row).store, { onEmailVerified });
      await kindOf(promise);
      expect(called, run).toBe(1);
    }
  });

  it("is not called for an unverified Email, a missing directory row or a store failure", async () => {
    const refusing: (PrincipalRecord | Error)[] = [
      { directory: directory(false), profile: null, roles: [] },
      { directory: null, profile: null, roles: [] },
      new Error("synthetic directory failure"),
    ];
    for (const row of refusing) {
      let called = 0;
      await kindOf(
        resolveProvisioningPrincipal(identity, store(row).store, {
          onEmailVerified: () => {
            called += 1;
          },
        }),
      );
      expect(called).toBe(0);
    }
  });
});

describe("TC-DB-AUTH-001-003 the Email check cannot be switched off", () => {
  it("the options of resolveProvisioningPrincipal have no requireVerifiedEmail (compile-time, pnpm typecheck)", () => {
    type Options = NonNullable<Parameters<typeof resolveProvisioningPrincipal>[2]>;
    expectTypeOf<Options>().not.toHaveProperty("requireVerifiedEmail");
    expect(true).toBe(true);
  });

  it("a runtime requireVerifiedEmail: false is ignored: an unverified Email still fails with email", async () => {
    const row: PrincipalRecord = { directory: directory(false), profile: null, roles: [] };
    const options = { requireVerifiedEmail: false } as unknown as Parameters<
      typeof resolveProvisioningPrincipal
    >[2];
    expect(await kindOf(resolveProvisioningPrincipal(identity, store(row).store, options))).toBe(
      "email",
    );
  });
});
