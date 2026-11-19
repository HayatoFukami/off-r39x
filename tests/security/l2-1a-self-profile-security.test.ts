// PR-L2-1a C1 (TC-API-007-007, G5): security of API-AUTH-002 / API-AUTH-004 without a database:
// mass assignment (SEC-API-029, DEV-API-004, AR-AZ-002, AR-ID-002), no way to name another person
// (AR-OWN-006; OI-3 decided: an unknown query parameter is ignored and the verified subject's row is
// used), Origin / Fetch Metadata (SEC-API-*), Rate Limit class behaviour (SEC-ABU-017/019/020) and
// redaction (OBS-AUTH-001, SPEC-160 §49.1). The DB-level owner relation is TC-API-007-005/006.
import { generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { createTokenVerifier } from "../../packages/auth/src/index.ts";
import {
  BAD,
  DIRECTORY_EMAIL,
  errorOf,
  GOOD,
  NAME_MARKER,
  OTHER_PROFILE_REF,
  OTHER_SUBJECT,
  PROFILE_PATH,
  PROFILE_REF,
  SUBJECT,
  selfProfileRig,
  WEB,
} from "../harness/api/self-profile.ts";

const guardRecords = (r: ReturnType<typeof selfProfileRig>) =>
  r.trs.store
    .keys()
    .filter((key) => key.includes("auth_failure_guard") && key.includes(".burst:"))
    .reduce((total, key) => total + r.trs.store.count(key), 0);

describe("TC-API-007-007 mass assignment is refused before any write (SEC-API-029, DEV-API-004, AR-AZ-002, AR-ID-002, SPEC-110 §54)", () => {
  const bodies: [string, string][] = [
    ["profile_ref of another person", `{"display_name":"x","profile_ref":"${OTHER_PROFILE_REF}"}`],
    ["auth_subject of another person", `{"display_name":"x","auth_subject":"${OTHER_SUBJECT}"}`],
    ["role", '{"display_name":"x","role":"ADMINISTRATOR"}'],
    ["roles", '{"display_name":"x","roles":["ADMINISTRATOR"]}'],
    ["owner", `{"display_name":"x","owner":"${OTHER_SUBJECT}"}`],
    ["capabilities", '{"display_name":"x","capabilities":["role_assignment.manage"]}'],
    ["__proto__", '{"display_name":"x","__proto__":{"role":"ADMINISTRATOR"}}'],
    ["a body without display_name but with identity fields", `{"auth_subject":"${OTHER_SUBJECT}"}`],
  ];
  it.each(bodies)(
    "400 VALIDATION_FAILED for %s, no write, no row changes",
    async (_label, body) => {
      const r = selfProfileRig();
      const res = await r.patchRaw(body);
      expect(res.status).toBe(400);
      expect((await errorOf(res)).code).toBe("VALIDATION_FAILED");
      expect(r.store.updates).toEqual([]);
      expect(r.store.row(SUBJECT)?.displayName).toBeNull();
      expect(r.store.row(OTHER_SUBJECT)?.displayName).toBe("other-synthetic");
    },
  );
});

describe("TC-API-007-007 no request input can name another person (AR-OWN-006, DEV-API-005, AR-ID-001)", () => {
  const otherInputs: [string, string, Record<string, string>][] = [
    ["query profile_ref", `?profile_ref=${OTHER_PROFILE_REF}`, {}],
    ["query auth_subject", `?auth_subject=${OTHER_SUBJECT}`, {}],
    ["query subject and id", `?subject=${OTHER_SUBJECT}&id=1`, {}],
    ["header X-Profile-Ref", "", { "X-Profile-Ref": OTHER_PROFILE_REF }],
    ["header X-Auth-Subject", "", { "X-Auth-Subject": OTHER_SUBJECT }],
    ["header X-Forwarded-User", "", { "X-Forwarded-User": OTHER_SUBJECT }],
  ];
  const AUTH = { Authorization: `Bearer ${GOOD}` };

  it.each(otherInputs)(
    "GET with %s uses the token's subject and returns the verified person's row",
    async (_label, query, headers) => {
      const r = selfProfileRig();
      const res = await r.get(query, { ...AUTH, ...headers });
      // OI-3 (decided): an unknown query parameter is ignored, as for API-AUTH-001.
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(JSON.parse(text).data.profile_ref).toBe(PROFILE_REF);
      expect(text).not.toContain(OTHER_PROFILE_REF);
      expect(text).not.toContain("other-synthetic");
      expect(r.store.reads).toEqual([SUBJECT]);
      expect(r.store.updates).toEqual([]);
    },
  );

  it.each(otherInputs)(
    "PATCH with %s writes only the token's subject and leaves the other row untouched",
    async (_label, query, headers) => {
      const r = selfProfileRig();
      const res = await r.patchRaw('{"display_name":"synthetic name"}', headers, query);
      expect(res.status).toBe(200);
      expect(r.store.updates).toEqual([[SUBJECT, "synthetic name"]]);
      expect(r.store.row(OTHER_SUBJECT)).toEqual({
        publicRef: OTHER_PROFILE_REF,
        displayName: "other-synthetic",
        updatedAt: "2026-11-01T00:00:00.000Z",
      });
      expect((await res.json()).data.profile_ref).toBe(PROFILE_REF);
    },
  );

  it("a path segment naming another profile is not a route (404), for GET and PATCH, and nothing is read or written", async () => {
    for (const method of ["GET", "PATCH"] as const) {
      const r = selfProfileRig();
      const res =
        method === "GET"
          ? await r.get(`/${OTHER_PROFILE_REF}`)
          : await r.patchRaw('{"display_name":"x"}', {}, `/${OTHER_PROFILE_REF}`);
      expect(res.status, method).toBe(404);
      expect((await errorOf(res)).code, method).toBe("RESOURCE_NOT_FOUND");
      expect(r.store.reads, method).toEqual([]);
      expect(r.store.updates, method).toEqual([]);
    }
  });

  it("a role or other claim in the signed token changes neither the subject used nor the response (SPEC-110 §54)", async () => {
    const keys = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const now = Math.floor(Date.now() / 1000);
    const verifier = createTokenVerifier(
      {
        issuer: "https://issuer.example.test",
        audience: "api",
        jwksUrl: "https://issuer.example.test/jwks",
      },
      async () => keys.publicKey,
    );
    const token = (claims: Record<string, unknown>) =>
      new SignJWT({
        sub: SUBJECT,
        iss: "https://issuer.example.test",
        aud: "api",
        iat: now,
        exp: now + 900,
        ...claims,
      })
        .setProtectedHeader({ alg: "EdDSA", kid: "synthetic-key" })
        .sign(keys.privateKey);
    const plain = selfProfileRig({ verifier });
    const claimed = selfProfileRig({ verifier });
    const a = await plain.get("", { Authorization: `Bearer ${await token({})}` });
    const b = await claimed.get("", {
      Authorization: `Bearer ${await token({ role: "ADMINISTRATOR", profile_ref: OTHER_PROFILE_REF })}`,
    });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await a.json()).data).toEqual((await b.json()).data);
    expect(claimed.store.reads).toEqual([SUBJECT]);
    const patched = await claimed.patchRaw('{"display_name":"synthetic name"}', {
      Authorization: `Bearer ${await token({ role: "ADMINISTRATOR", sub_override: OTHER_SUBJECT })}`,
    });
    expect(patched.status).toBe(200);
    expect(claimed.store.updates).toEqual([[SUBJECT, "synthetic name"]]);
  });
});

describe("TC-API-007-007 Origin and Fetch Metadata on PATCH (SPEC-110 §13, SEC-API-006..)", () => {
  const body = '{"display_name":"synthetic name"}';
  const base = { Authorization: `Bearer ${GOOD}`, "Content-Type": "application/json" };
  const attempts: [string, Record<string, string>][] = [
    ["a mismatched Origin", { ...base, Origin: "https://evil.example.test" }],
    ["no Origin", { ...base }],
    [
      "Sec-Fetch-Site cross-site with the Web Origin",
      { ...base, Origin: WEB, "Sec-Fetch-Site": "cross-site" },
    ],
    ["Sec-Fetch-Site none with the Web Origin", { ...base, Origin: WEB, "Sec-Fetch-Site": "none" }],
  ];
  it.each(attempts)(
    "%s is 403 AUTHORIZATION_DENIED and writes nothing",
    async (_label, headers) => {
      const r = selfProfileRig();
      const res = await r.send(PROFILE_PATH, { method: "PATCH", headers, body });
      expect(res.status).toBe(403);
      expect((await errorOf(res)).code).toBe("AUTHORIZATION_DENIED");
      expect(r.store.updates).toEqual([]);
      expect(r.store.row(SUBJECT)?.displayName).toBeNull();
    },
  );

  it("the exact Web Origin with Sec-Fetch-Site same-origin / same-site is accepted", async () => {
    for (const site of ["same-origin", "same-site"]) {
      const r = selfProfileRig();
      const res = await r.patchRaw(body, { "Sec-Fetch-Site": site });
      expect(res.status, site).toBe(200);
      expect(r.store.updates, site).toEqual([[SUBJECT, "synthetic name"]]);
    }
  });
});

describe("TC-API-007-007 Rate Limit (API-RLC-001, SEC-ABU-017/019/020, SPEC-110 §56.1)", () => {
  it("PATCH is profile_mutation (3 per 10 s per subject): the 4th is 429 RATE_LIMIT_EXCEEDED with an integer Retry-After and is not written", async () => {
    const r = selfProfileRig();
    for (let i = 1; i <= 3; i++) {
      expect((await r.patch({ display_name: `synthetic name ${i}` })).status, `PATCH ${i}`).toBe(
        200,
      );
    }
    const refused = await r.patch({ display_name: "synthetic name 4" });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
    const error = await errorOf(refused);
    expect(error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(error.retryable).toBe(true);
    expect(r.store.updates.map(([, name]) => name)).toEqual([
      "synthetic name 1",
      "synthetic name 2",
      "synthetic name 3",
    ]);
    expect(r.store.row(SUBJECT)?.displayName).toBe("synthetic name 3");
  });

  it("the profile_mutation limit is per subject: it is not shared with the self_read class", async () => {
    const r = selfProfileRig();
    for (let i = 0; i < 3; i++) await r.patch({ display_name: "synthetic name" });
    expect((await r.get()).status).toBe(200);
  });

  it("a rate limit store failure is 503 TEMPORARY_UNAVAILABLE for GET and PATCH, distinct from 429, and reaches neither the Principal store nor the profile store", async () => {
    for (const method of ["GET", "PATCH"] as const) {
      const r = selfProfileRig();
      r.trs.faults.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
      const res =
        method === "GET" ? await r.get() : await r.patch({ display_name: "synthetic name" });
      expect(res.status, method).toBe(503);
      expect((await errorOf(res)).code, method).toBe("TEMPORARY_UNAVAILABLE");
      expect(r.principalReads(), method).toBe(0);
      expect(r.store.reads, method).toEqual([]);
      expect(r.store.updates, method).toEqual([]);
    }
  });

  it("a Stage 2 rejection (429) stops before the Principal directory read (SPEC-110 §24.1)", async () => {
    const r = selfProfileRig();
    for (let i = 0; i < 3; i++) await r.patch({ display_name: "synthetic name" });
    const reads = r.principalReads();
    expect((await r.patch({ display_name: "synthetic name" })).status).toBe(429);
    expect(r.principalReads()).toBe(reads);
  });

  it("a failed token verification on PATCH is recorded by the attendee guard and answers 401", async () => {
    const r = selfProfileRig();
    expect(guardRecords(r)).toBe(0);
    const res = await r.patch(
      { display_name: "synthetic name" },
      { Authorization: `Bearer ${BAD}` },
    );
    expect(res.status).toBe(401);
    expect(guardRecords(r)).toBe(1);
    expect(r.store.updates).toEqual([]);
  });
});

describe("TC-API-007-007 redaction (OBS-AUTH-001, SPEC-160 §49.1, SEC-API-020)", () => {
  const forbidden = [NAME_MARKER, DIRECTORY_EMAIL, SUBJECT, OTHER_SUBJECT, GOOD, BAD];
  type Rig = ReturnType<typeof selfProfileRig>;
  // Each scenario runs on a fresh rig (the PATCH class allows 3 per 10 s) and states its status, so a
  // missing route cannot pass these assertions vacuously.
  const scenarios: [label: string, status: number, run: (r: Rig) => Promise<Response>][] = [
    ["a successful PATCH", 200, (r) => r.patch({ display_name: `${NAME_MARKER} ok` })],
    ["a successful GET", 200, (r) => r.get()],
    [
      "an over-long name",
      400,
      (r) => r.patchRaw(JSON.stringify({ display_name: `${NAME_MARKER}${"a".repeat(80)}` })),
    ],
    [
      "an unknown field carrying an Email",
      400,
      (r) => r.patchRaw(JSON.stringify({ display_name: NAME_MARKER, email: DIRECTORY_EMAIL })),
    ],
    [
      "a duplicate key",
      400,
      (r) => r.patchRaw(`{"display_name":"${NAME_MARKER}","display_name":"b"}`),
    ],
    [
      "a bad token",
      401,
      (r) => r.patch({ display_name: NAME_MARKER }, { Authorization: `Bearer ${BAD}` }),
    ],
    [
      "a store that is unavailable",
      503,
      (r) => {
        r.store.inject("FP.DB.INSIDE_STATEMENT");
        return r.patch({ display_name: NAME_MARKER });
      },
    ],
    [
      "an unknown commit outcome",
      503,
      (r) => {
        r.store.inject("FP.DB.AFTER_COMMIT_SENT_BEFORE_ACK");
        return r.patch({ display_name: NAME_MARKER });
      },
    ],
    [
      "an unclassified store error",
      500,
      (r) => {
        r.store.inject("PROFILE.STORE_THROWS");
        return r.patch({ display_name: NAME_MARKER });
      },
    ],
  ];

  it("no log line carries the display name, an Email, a raw Auth Subject or a token, for success and failure alike", async () => {
    const lines: string[] = [];
    for (const [label, status, run] of scenarios) {
      const r = selfProfileRig();
      expect((await run(r)).status, label).toBe(status);
      lines.push(...r.lines);
    }
    expect(lines.length).toBeGreaterThan(0);
    const logs = lines.join("\n");
    for (const value of forbidden) expect(logs, value).not.toContain(value);
  });

  it("no error response carries the sent display name, an Email, a raw subject or a token", async () => {
    for (const [label, status, run] of scenarios.filter(([, status]) => status >= 400)) {
      const r = selfProfileRig();
      const res = await run(r);
      expect(res.status, label).toBe(status);
      const text = await res.text();
      for (const value of forbidden) expect(text, `${label}: ${value}`).not.toContain(value);
    }
  });
});
