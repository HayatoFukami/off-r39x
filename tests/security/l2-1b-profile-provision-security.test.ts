// PR-L2-1b C1 (TC-DB-AUTH-001-007, G5): security of API-AUTH-003 without a database. The dedicated
// provisioning guard may let exactly one more input through than the existing guard: a verified Email
// without a Business Profile. Everything else must be refused exactly as PATCH /api/v1/self/profile
// (API-AUTH-004: same mutation, same Rate Limit class profile_mutation, same guard front half) refuses it:
// status, error code, security events and guard counter (SPEC-110 §24/§24.1, SEC-AUTH-003, AR-ID-001/002,
// SEC-ABU-017/019/020, OBS-AUTH-001). Synthetic data only.
import { describe, expect, it } from "vitest";
import {
  BAD,
  createRecordingProfileStore,
  DIRECTORY_EMAIL,
  errorOf,
  GOOD,
  OTHER_PROFILE_REF,
  OTHER_SUBJECT,
  PROFILE_PATH,
  PROVISION_PATH,
  type PrincipalKind,
  principalRow,
  type SelfProfileRig,
  SUBJECT,
  selfProfileRig,
  WEB,
} from "../harness/api/self-profile.ts";

const guardRecords = (r: SelfProfileRig) =>
  r.trs.store
    .keys()
    .filter((key) => key.includes("auth_failure_guard") && key.includes(".burst:"))
    .reduce((total, key) => total + r.trs.store.count(key), 0);
/** [event_name, error_code, result] of every security event, in order (the completion log is route specific). */
const securityEvents = (r: SelfProfileRig) =>
  r.records
    .filter(
      (x) =>
        typeof x.event_name === "string" &&
        (x.event_name.startsWith("auth.") || x.event_name.startsWith("authorization.")),
    )
    .map((x) => [x.event_name, x.error_code ?? null, x.result]);

/** A rig whose subject is verified and has no Profile (only another person's row exists). */
const noProfileRig = () =>
  selfProfileRig({
    store: createRecordingProfileStore({
      [OTHER_SUBJECT]: {
        publicRef: OTHER_PROFILE_REF,
        displayName: "other-synthetic",
        updatedAt: "2026-11-01T00:00:00.000Z",
      },
    }),
    principal: () => principalRow("no_profile"),
  });

const json = { "Content-Type": "application/json" };
const withAuth = { Authorization: `Bearer ${GOOD}` };

interface Case {
  readonly label: string;
  readonly principal?: PrincipalKind | "throws";
  readonly headers?: Record<string, string>;
  readonly setup?: (r: SelfProfileRig) => void;
  readonly status: number;
  readonly code: string;
}
const CASES: readonly Case[] = [
  {
    label: "no token",
    headers: { Origin: WEB, ...json },
    status: 401,
    code: "AUTHENTICATION_REQUIRED",
  },
  {
    label: "an invalid token",
    headers: { Authorization: `Bearer ${BAD}`, Origin: WEB, ...json },
    status: 401,
    code: "AUTHENTICATION_REQUIRED",
  },
  {
    label: "no directory row",
    principal: "no_directory",
    status: 401,
    code: "AUTHENTICATION_REQUIRED",
  },
  {
    label: "a directory row of another subject",
    principal: "directory_mismatch",
    status: 409,
    code: "CONSISTENCY_REVIEW_REQUIRED",
  },
  {
    label: "a non-boolean emailVerified",
    principal: "email_flag_not_boolean",
    status: 409,
    code: "CONSISTENCY_REVIEW_REQUIRED",
  },
  {
    label: "an unverified Email without a Profile",
    principal: "unverified_no_profile",
    status: 403,
    code: "EMAIL_VERIFICATION_REQUIRED",
  },
  {
    label: "an unverified Email with a Profile",
    principal: "unverified",
    status: 403,
    code: "EMAIL_VERIFICATION_REQUIRED",
  },
  {
    label: "a Principal store failure",
    principal: "throws",
    status: 503,
    code: "DATABASE_TEMPORARY_FAILURE",
  },
  {
    label: "a Profile of another subject",
    principal: "inconsistent",
    status: 409,
    code: "CONSISTENCY_REVIEW_REQUIRED",
  },
  {
    label: "an invalid public reference",
    principal: "profile_bad_ref",
    status: 409,
    code: "CONSISTENCY_REVIEW_REQUIRED",
  },
  {
    label: "an unknown role",
    principal: "unknown_role",
    status: 409,
    code: "CONSISTENCY_REVIEW_REQUIRED",
  },
  {
    label: "a rate limit store failure",
    setup: (r) => r.trs.faults.inject("FP.RATELIMIT.STORE_UNAVAILABLE"),
    status: 503,
    code: "TEMPORARY_UNAVAILABLE",
  },
  {
    label: "no Origin",
    headers: { ...withAuth, ...json },
    status: 403,
    code: "AUTHORIZATION_DENIED",
  },
  {
    label: "a mismatched Origin",
    headers: { ...withAuth, ...json, Origin: "https://evil.example.test" },
    status: 403,
    code: "AUTHORIZATION_DENIED",
  },
  {
    label: "Sec-Fetch-Site cross-site",
    headers: { ...withAuth, ...json, Origin: WEB, "Sec-Fetch-Site": "cross-site" },
    status: 403,
    code: "AUTHORIZATION_DENIED",
  },
];

function rigFor(c: Case): SelfProfileRig {
  const kind = c.principal ?? "verified";
  const r = selfProfileRig({
    principal:
      kind === "throws"
        ? () => {
            throw new Error("synthetic directory failure");
          }
        : () => principalRow(kind),
  });
  c.setup?.(r);
  return r;
}
const send = (r: SelfProfileRig, path: string, method: string, body: string, c: Case) =>
  r.send(path, {
    method,
    headers: c.headers ?? { ...withAuth, Origin: WEB, ...json },
    body,
  });

describe("TC-DB-AUTH-001-007 the provisioning guard refuses exactly like PATCH /api/v1/self/profile (parity; AR-ID-001, SEC-AUTH-003, SPEC-110 §24.1)", () => {
  it.each(CASES)("$label", async (c) => {
    const patch = rigFor(c);
    const provision = rigFor(c);
    const a = await send(patch, PROFILE_PATH, "PATCH", '{"display_name":"x"}', c);
    const b = await send(provision, PROVISION_PATH, "POST", "{}", c);
    expect(a.status).toBe(c.status);
    expect(b.status).toBe(c.status);
    expect((await errorOf(a)).code).toBe(c.code);
    expect((await errorOf(b)).code).toBe(c.code);
    expect(securityEvents(provision)).toEqual(securityEvents(patch));
    expect(guardRecords(provision)).toBe(guardRecords(patch));
    expect(provision.principalReads()).toBe(patch.principalReads());
    expect(patch.store.updates).toEqual([]);
    expect(provision.store.provisions).toEqual([]);
    expect(provision.store.row(SUBJECT)?.displayName).toBeNull();
  });

  it("an invalid token is recorded by the attendee guard once on both routes", async () => {
    const c = CASES.find((x) => x.label === "an invalid token") as Case;
    const r = rigFor(c);
    await send(r, PROVISION_PATH, "POST", "{}", c);
    expect(guardRecords(r)).toBe(1);
  });

  it("the single difference: a verified Email without a Profile is 403 AUTHORIZATION_DENIED for PATCH and GET but 201 for provision", async () => {
    const make = noProfileRig;
    const patch = make();
    const denied = await patch.patch({ display_name: "x" });
    expect(denied.status).toBe(403);
    expect((await errorOf(denied)).code).toBe("AUTHORIZATION_DENIED");
    const read = await make().get();
    expect(read.status).toBe(403);
    expect((await errorOf(read)).code).toBe("AUTHORIZATION_DENIED");
    const r = make();
    const created = await r.provision();
    expect(created.status).toBe(201);
    expect(r.store.provisions).toEqual([SUBJECT]);
  });

  it("GET /api/v1/self/profile agrees on status and code for the directory, Email, inconsistency and database rows", async () => {
    for (const c of CASES.filter((x) => x.principal !== undefined)) {
      const r = rigFor(c);
      const res = await r.get("", withAuth);
      expect([c.label, res.status, (await errorOf(res)).code]).toEqual([c.label, c.status, c.code]);
    }
  });
});

describe("TC-DB-AUTH-001-007 mass assignment and no way to name another person (SEC-API-029, DEV-API-004, AR-AZ-002, AR-ID-002)", () => {
  const bodies: [string, string][] = [
    ["profile_ref", `{"profile_ref":"${OTHER_PROFILE_REF}"}`],
    ["auth_subject", `{"auth_subject":"${OTHER_SUBJECT}"}`],
    ["role", '{"role":"ADMINISTRATOR"}'],
    ["roles", '{"roles":["ADMINISTRATOR"]}'],
    ["owner", `{"owner":"${OTHER_SUBJECT}"}`],
    ["capabilities", '{"capabilities":["role_assignment.manage"]}'],
    ["display_name", '{"display_name":"x"}'],
    ["__proto__", '{"__proto__":{"role":"ADMINISTRATOR"}}'],
  ];
  it.each(bodies)(
    "a body with %s is 400 VALIDATION_FAILED and provisions nothing",
    async (_l, body) => {
      const r = noProfileRig();
      const res = await r.provision(body);
      expect(res.status).toBe(400);
      expect((await errorOf(res)).code).toBe("VALIDATION_FAILED");
      expect(r.store.provisions).toEqual([]);
    },
  );

  const inputs: [string, string, Record<string, string>][] = [
    ["query profile_ref", `?profile_ref=${OTHER_PROFILE_REF}`, {}],
    ["query auth_subject", `?auth_subject=${OTHER_SUBJECT}`, {}],
    ["header X-Profile-Ref", "", { "X-Profile-Ref": OTHER_PROFILE_REF }],
    ["header X-Auth-Subject", "", { "X-Auth-Subject": OTHER_SUBJECT }],
    ["header X-Forwarded-User", "", { "X-Forwarded-User": OTHER_SUBJECT }],
  ];
  it.each(inputs)(
    "%s does not change the subject handed to the store",
    async (_l, query, headers) => {
      const r = noProfileRig();
      const res = await r.provision("{}", headers, query);
      expect(res.status).toBe(201);
      expect(r.store.provisions).toEqual([SUBJECT]);
      expect(r.store.row(OTHER_SUBJECT)?.displayName).toBe("other-synthetic");
    },
  );

  it("a path segment naming another profile is 404 and reaches nothing", async () => {
    const r = noProfileRig();
    const res = await r.provision("{}", {}, `/${OTHER_PROFILE_REF}`);
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("RESOURCE_NOT_FOUND");
    expect(r.store.provisions).toEqual([]);
    expect(r.principalReads()).toBe(0);
  });
});

describe("TC-DB-AUTH-001-007 Rate Limit (API-RLC-001, SEC-ABU-017/019/020, SPEC-110 §56.1)", () => {
  it("provision is profile_mutation (3 per 10 s per subject): the 4th is 429 RATE_LIMIT_EXCEEDED with an integer Retry-After and does not reach the store", async () => {
    const r = selfProfileRig();
    for (let i = 1; i <= 3; i++) expect((await r.provision()).status, `POST ${i}`).toBe(200);
    const refused = await r.provision();
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
    const error = await errorOf(refused);
    expect(error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(error.retryable).toBe(true);
    expect(r.store.provisions).toEqual([SUBJECT, SUBJECT, SUBJECT]);
  });

  it("a Stage 2 rejection (429) stops before the Principal directory read (SPEC-110 §24.1)", async () => {
    const r = selfProfileRig();
    for (let i = 0; i < 3; i++) await r.provision();
    const reads = r.principalReads();
    expect((await r.provision()).status).toBe(429);
    expect(r.principalReads()).toBe(reads);
  });
});

describe("TC-DB-AUTH-001-007 redaction (OBS-AUTH-001, SPEC-160 §49.1, SEC-API-020)", () => {
  const forbidden = [DIRECTORY_EMAIL, SUBJECT, OTHER_SUBJECT, GOOD, BAD];
  const scenarios: [
    label: string,
    status: number,
    run: (r: SelfProfileRig) => Promise<Response>,
  ][] = [
    ["a created Profile", 201, (r) => r.provision()],
    [
      "an unknown field carrying an Email",
      400,
      (r) => r.provision(`{"email":"${DIRECTORY_EMAIL}"}`),
    ],
    ["a bad token", 401, (r) => r.provision("{}", { Authorization: `Bearer ${BAD}` })],
    [
      "a store that is unavailable",
      503,
      (r) => {
        r.store.inject("FP.DB.INSIDE_STATEMENT");
        return r.provision();
      },
    ],
    [
      "an unknown commit outcome",
      503,
      (r) => {
        r.store.inject("FP.DB.AFTER_COMMIT_SENT_BEFORE_ACK");
        return r.provision();
      },
    ],
    [
      "an unclassified store error",
      500,
      (r) => {
        r.store.inject("PROFILE.STORE_THROWS");
        return r.provision();
      },
    ],
  ];
  const fresh = noProfileRig;

  it("no log line carries an Email, a raw Auth Subject or a token, for success and failure alike", async () => {
    const lines: string[] = [];
    for (const [label, status, run] of scenarios) {
      const r = fresh();
      expect((await run(r)).status, label).toBe(status);
      lines.push(...r.lines);
    }
    expect(lines.length).toBeGreaterThan(0);
    const logs = lines.join("\n");
    for (const value of forbidden) expect(logs, value).not.toContain(value);
  });

  it("no response carries an Email, a raw Auth Subject or a token", async () => {
    for (const [label, status, run] of scenarios) {
      const r = fresh();
      const res = await run(r);
      expect(res.status, label).toBe(status);
      const text = await res.text();
      for (const value of forbidden) expect(text, `${label}: ${value}`).not.toContain(value);
    }
  });
});
