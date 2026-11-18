// PR-S0-1b addendum T2: the Email verified check (SPEC-110 §24 step 3) is decided from the directory
// view (SPEC-100 §5.1, DB-ARC-008) before the Business Profile is resolved (step 5), with one
// directory read (SPEC-110 §24.1, v2.4.0; UCR-110-006; SEC-AUTH-003, AR-AUTH-003, AR-AUTH-005). The
// stub store returns one row per case; store calls, verification, directory reads and log events are
// recorded in one ordered list. Synthetic data only.
import { generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/api/app.ts";
import {
  createTokenVerifier,
  type PrincipalRecord,
  type TokenVerifier,
} from "../../packages/auth/src/index.ts";
import { createLogger } from "../../packages/observability/src/index.ts";
import { createTestRateLimit, peer } from "../harness/rate-limit/api.ts";

const WEB = "https://web.example.test";
const API = "https://api.example.test";
const GOOD = "e30.e30.c2ln";
const SUBJECT = "00000000-0000-4000-8000-0000000000a1";
const OTHER_SUBJECT = "00000000-0000-4000-8000-0000000000a2";
const PROFILE_REF = "00000000-0000-4000-8000-0000000000a3";
const bearer = { Authorization: `Bearer ${GOOD}` };

const PREFIX = ["store:admit", "verify", "log:auth.verification.completed", "store:admit", "db"];
const EMAIL_REFUSED = [
  ...PREFIX,
  "log:auth.email_verified_resolution.completed:EMAIL_VERIFICATION_REQUIRED",
  "log:security.fail_closed.triggered:EMAIL_VERIFICATION_REQUIRED",
  "log:http.request.completed",
];

const directory = (emailVerified: boolean, authSubject = SUBJECT) => ({
  authSubject,
  emailVerified,
});
const profile = (authSubject = SUBJECT, publicRef = PROFILE_REF) => ({
  id: "1",
  publicRef,
  authSubject,
});

interface Rig {
  readonly app: ReturnType<typeof createApp>;
  readonly order: string[];
  readonly records: Record<string, unknown>[];
  /** The number of directory reads (findByAuthSubject calls). */
  reads(): number;
  get(headers?: Record<string, string>): Promise<Response>;
}

function rig(
  row: () => PrincipalRecord,
  verifier: TokenVerifier = {
    verify: async () => ({ subject: SUBJECT }),
  },
): Rig {
  const order: string[] = [];
  const records: Record<string, unknown>[] = [];
  let reads = 0;
  const trs = createTestRateLimit();
  const evaluate = trs.store.evaluate.bind(trs.store);
  trs.store.evaluate = async (mode, rules, id) => {
    order.push(`store:${mode}`);
    return evaluate(mode, rules, id);
  };
  const logger = createLogger(
    { service: "API", environment: "test", actor_type: "GUEST" },
    (line) => {
      const record = JSON.parse(line) as Record<string, unknown>;
      records.push(record);
      order.push(
        `log:${String(record.event_name)}${record.error_code ? `:${String(record.error_code)}` : ""}`,
      );
    },
  );
  // Like the other API tests: only verify() is exposed (the structural pre-check is a separate concern).
  const traced: TokenVerifier = {
    verify: async (token) => {
      order.push("verify");
      return verifier.verify(token);
    },
  };
  const app = createApp({
    webOrigin: WEB,
    ready: async () => true,
    logger,
    auth: {
      verifier: traced,
      store: {
        findByAuthSubject: async () => {
          reads += 1;
          order.push("db");
          return row();
        },
      },
    },
    rateLimit: trs.rateLimit,
  });
  return {
    app,
    order,
    records,
    reads: () => reads,
    get: async (headers = bearer) =>
      app.request(`${API}/api/v1/self/principal`, { headers }, peer()),
  };
}

const codeOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

interface Case {
  readonly name: string;
  readonly row: () => PrincipalRecord;
  readonly status: number;
  readonly code: string | null;
  readonly order: readonly string[];
}
const CASES: readonly Case[] = [
  {
    name: "1 unverified Email, no Business Profile: the Email refusal, not AUTHORIZATION_DENIED",
    row: () => ({ directory: directory(false), profile: null, roles: [] }),
    status: 403,
    code: "EMAIL_VERIFICATION_REQUIRED",
    order: EMAIL_REFUSED,
  },
  {
    name: "2 unverified Email, the Business Profile belongs to another subject: the Email refusal, not 409",
    row: () => ({ directory: directory(false), profile: profile(OTHER_SUBJECT), roles: [] }),
    status: 403,
    code: "EMAIL_VERIFICATION_REQUIRED",
    order: EMAIL_REFUSED,
  },
  {
    name: "3 unverified Email, an unknown role: the Email refusal, not 409",
    row: () => ({ directory: directory(false), profile: profile(), roles: ["CUSTOMER"] }),
    status: 403,
    code: "EMAIL_VERIFICATION_REQUIRED",
    order: EMAIL_REFUSED,
  },
  {
    name: "3b unverified Email, a Business Profile with an invalid public reference: the Email refusal",
    row: () => ({
      directory: directory(false),
      profile: profile(SUBJECT, "not-a-uuid"),
      roles: [],
    }),
    status: 403,
    code: "EMAIL_VERIFICATION_REQUIRED",
    order: EMAIL_REFUSED,
  },
  {
    name: "3c unverified Email with a consistent Business Profile: the same Email refusal, no Profile or Role event",
    row: () => ({ directory: directory(false), profile: profile(), roles: ["STAFF"] }),
    status: 403,
    code: "EMAIL_VERIFICATION_REQUIRED",
    order: EMAIL_REFUSED,
  },
  {
    name: "4 verified Email, no Business Profile: still AUTHORIZATION_DENIED (no Email event: it is emitted on the success path only)",
    row: () => ({ directory: directory(true), profile: null, roles: [] }),
    status: 403,
    code: "AUTHORIZATION_DENIED",
    order: [
      ...PREFIX,
      "log:auth.business_profile_resolution.completed:BUSINESS_PROFILE_UNRESOLVED",
      "log:security.fail_closed.triggered:AUTHORIZATION_DENIED",
      "log:http.request.completed",
    ],
  },
  {
    name: "5 no directory row (no Identity): 401, no Email event",
    row: () => ({ directory: null, profile: null, roles: [] }),
    status: 401,
    code: "AUTHENTICATION_REQUIRED",
    order: [
      ...PREFIX,
      "log:auth.business_profile_resolution.completed:BUSINESS_PROFILE_UNRESOLVED",
      "log:security.fail_closed.triggered:AUTHENTICATION_REQUIRED",
      "log:http.request.completed",
    ],
  },
  {
    name: "6 inconsistent directory row (another subject) without a Business Profile: 409, checked before the Email",
    row: () => ({ directory: directory(false, OTHER_SUBJECT), profile: null, roles: [] }),
    status: 409,
    code: "CONSISTENCY_REVIEW_REQUIRED",
    order: [
      ...PREFIX,
      "log:auth.business_profile_resolution.completed:BUSINESS_PROFILE_INCONSISTENT",
      "log:security.fail_closed.triggered:CONSISTENCY_REVIEW_REQUIRED",
      "log:http.request.completed",
    ],
  },
  {
    name: "6b inconsistent directory row (a non-boolean verified state): 409, never read as verified or unverified",
    row: () => ({
      directory: { authSubject: SUBJECT, emailVerified: "yes" as unknown as boolean },
      profile: profile(),
      roles: [],
    }),
    status: 409,
    code: "CONSISTENCY_REVIEW_REQUIRED",
    order: [
      ...PREFIX,
      "log:auth.business_profile_resolution.completed:BUSINESS_PROFILE_INCONSISTENT",
      "log:security.fail_closed.triggered:CONSISTENCY_REVIEW_REQUIRED",
      "log:http.request.completed",
    ],
  },
  {
    name: "7 verified Email and a consistent Business Profile: 200, events Email, Business Profile, Role",
    row: () => ({ directory: directory(true), profile: profile(), roles: [] }),
    status: 200,
    code: null,
    order: [
      ...PREFIX,
      "log:auth.email_verified_resolution.completed",
      "log:auth.business_profile_resolution.completed",
      "log:authorization.role_resolution.completed",
      "log:http.request.completed",
    ],
  },
  {
    name: "7b verified Email, the Business Profile belongs to another subject: still 409",
    row: () => ({ directory: directory(true), profile: profile(OTHER_SUBJECT), roles: [] }),
    status: 409,
    code: "CONSISTENCY_REVIEW_REQUIRED",
    order: [
      ...PREFIX,
      "log:auth.business_profile_resolution.completed:BUSINESS_PROFILE_INCONSISTENT",
      "log:security.fail_closed.triggered:CONSISTENCY_REVIEW_REQUIRED",
      "log:http.request.completed",
    ],
  },
  {
    name: "7c verified Email, an unknown role: still 409",
    row: () => ({ directory: directory(true), profile: profile(), roles: ["CUSTOMER"] }),
    status: 409,
    code: "CONSISTENCY_REVIEW_REQUIRED",
    order: [
      ...PREFIX,
      "log:auth.business_profile_resolution.completed:BUSINESS_PROFILE_INCONSISTENT",
      "log:security.fail_closed.triggered:CONSISTENCY_REVIEW_REQUIRED",
      "log:http.request.completed",
    ],
  },
  {
    name: "8 directory read failure: 503, no Email or Business Profile decision",
    row: () => {
      throw new Error("synthetic directory failure");
    },
    status: 503,
    code: "DATABASE_TEMPORARY_FAILURE",
    order: [
      ...PREFIX,
      "log:auth.business_profile_resolution.completed:ROLE_RESOLUTION_UNAVAILABLE",
      "log:security.fail_closed.triggered:DATABASE_TEMPORARY_FAILURE",
      "log:http.request.completed",
    ],
  },
];

describe("TC-SEC-AUTH-003-001 the Email verified check comes from the directory view, before the Business Profile (SEC-AUTH-003, AR-AUTH-003, AR-AUTH-005, DB-ARC-008, SPEC-110 §24/§24.1, SPEC-060 §8.3)", () => {
  for (const c of CASES) {
    it(`${c.name}`, async () => {
      const r = rig(c.row);
      const res = await r.get();
      // One read of the directory view whatever the answer (DB-ARC-008; Stage 2 precedes it).
      expect(r.reads()).toBe(1);
      expect(res.status).toBe(c.status);
      if (c.code) expect(await codeOf(res)).toBe(c.code);
      expect(r.order).toEqual(c.order);
    });
  }

  it("an unverified Email stops before any Business Profile or Role event, whatever the Business Profile", async () => {
    for (const c of CASES.filter((x) => x.code === "EMAIL_VERIFICATION_REQUIRED")) {
      const r = rig(c.row);
      await r.get();
      const events = r.records.map((x) => String(x.event_name));
      expect(events, c.name).not.toContain("auth.business_profile_resolution.completed");
      expect(events, c.name).not.toContain("authorization.role_resolution.completed");
      expect(
        r.records.filter((x) => x.event_name === "auth.email_verified_resolution.completed"),
        c.name,
      ).toHaveLength(1);
    }
  });

  it("an Email verified claim in the access token does not replace the directory view", async () => {
    const keys = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      sub: SUBJECT,
      iss: "https://issuer.example.com",
      aud: "api",
      iat: now,
      exp: now + 900,
      email_verified: true,
      email: "claimant@example.com",
    })
      .setProtectedHeader({ alg: "EdDSA" })
      .sign(keys.privateKey);
    const verifier = createTokenVerifier(
      {
        issuer: "https://issuer.example.com",
        audience: "api",
        jwksUrl: "https://issuer.example.com/jwks",
      },
      async () => keys.publicKey,
    );
    // The directory says unverified and there is no Business Profile yet.
    const r = rig(() => ({ directory: directory(false), profile: null, roles: [] }), verifier);
    const res = await r.get({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("EMAIL_VERIFICATION_REQUIRED");
    expect(r.reads()).toBe(1);
    expect(r.order).toEqual(EMAIL_REFUSED);
    // A claim-based decision would have let the request through to the Business Profile step.
    expect(r.records.map((x) => x.event_name)).not.toContain(
      "auth.business_profile_resolution.completed",
    );
  });

  it("every case keeps Stage 2 after verification and before the one directory read", async () => {
    for (const c of CASES) {
      const r = rig(c.row);
      await r.get();
      const stage2 = r.order.indexOf("store:admit", r.order.indexOf("verify"));
      expect(r.order.indexOf("verify"), c.name).toBeGreaterThan(r.order.indexOf("store:admit"));
      expect(stage2, c.name).toBeGreaterThan(r.order.indexOf("verify"));
      expect(r.order.indexOf("db"), c.name).toBeGreaterThan(stage2);
    }
  });
});
