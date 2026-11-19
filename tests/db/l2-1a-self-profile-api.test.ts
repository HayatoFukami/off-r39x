// PR-L2-1a C1 (TC-API-007-006, G3+G4): API-AUTH-002 / API-AUTH-004 from a signed JWT to a real
// PostgreSQL 17, as in tests/db/foundation-api-integration.test.ts: the synthetic Identity directory
// view, createPrincipalRepository and createCurrentProfileRepository on the app_api_runtime role (verified
// TLS), the in-memory rate limit (a fresh one per test; the PATCH class allows 3 per 10 s). Every refusal
// also asserts the database rows are unchanged (TST-GEN-002). Needs TEST_DATABASE_URL and
// TEST_DATABASE_CA; it fails (it does not skip) without them. Synthetic data only.
import { readFile } from "node:fs/promises";
import { generateKeyPair, SignJWT } from "jose";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/api/app.ts";
import { createTokenVerifier } from "../../packages/auth/src/index.ts";
import {
  createCurrentProfileRepository,
  createDatabase,
  createPrincipalRepository,
} from "../../packages/db/src/index.ts";
import { installSyntheticDirectory, prepareFoundationDatabase } from "../harness/db/foundation.ts";
import { createTestRateLimit, peer } from "../harness/rate-limit/api.ts";

const url = process.env.TEST_DATABASE_URL;
const caPath = process.env.TEST_DATABASE_CA;
if (!url || !caPath) throw new Error("Real PG17 requires TEST_DATABASE_URL and TEST_DATABASE_CA");

const WEB = "https://web.example.test";
const API = "https://api.example.test";
const PATH = "/api/v1/self/profile";
const ISSUER = "https://issuer.example.test";
const A = "00000000-0000-4000-8000-0000000000a1"; // verified, Profile, display_name NULL
const B = "00000000-0000-4000-8000-0000000000a2"; // verified, Profile, has a name
const C = "00000000-0000-4000-8000-0000000000a3"; // Email unverified, Profile
const D = "00000000-0000-4000-8000-0000000000a4"; // verified, no Profile
const REF = {
  A: "00000000-0000-4000-8000-0000000000b1",
  B: "00000000-0000-4000-8000-0000000000b2",
  C: "00000000-0000-4000-8000-0000000000b3",
};
const EMAIL_A = "a@example.test";

let admin: Client;
let runtime: ReturnType<typeof createDatabase>;
let privateKey: CryptoKey;
let verifier: ReturnType<typeof createTokenVerifier>;

beforeAll(async () => {
  admin = new Client({ connectionString: url });
  await admin.connect();
  await prepareFoundationDatabase(admin);
  await installSyntheticDirectory(admin);
  await admin.query(
    `INSERT INTO synthetic_provider.identities(subject, current_email, verified) VALUES
       ($1, 'a@example.test', true), ($2, 'b@example.test', true),
       ($3, 'c@example.test', false), ($4, 'd@example.test', true)`,
    [A, B, C, D],
  );
  const runtimeUrl = new URL(url as string);
  runtimeUrl.username = "app_api_runtime";
  runtimeUrl.password = "";
  runtimeUrl.search = "";
  runtime = createDatabase({
    connectionString: runtimeUrl.href,
    environment: "test",
    service: "api",
    ca: await readFile(caPath as string, "utf8"),
  });
  const keys = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  privateKey = keys.privateKey;
  verifier = createTokenVerifier(
    { issuer: ISSUER, audience: "api", jwksUrl: `${ISSUER}/jwks` },
    async () => keys.publicKey,
  );
});
afterAll(async () => {
  await runtime?.close();
  await admin?.end();
});

async function resetRows(): Promise<void> {
  await admin.query("DELETE FROM app.role_assignments");
  await admin.query("DELETE FROM app.business_profiles");
  await admin.query(
    `INSERT INTO app.business_profiles(public_ref, auth_subject, display_name, updated_at) VALUES
       ($1, $2, NULL, '2026-01-02 03:04:05.678912+00'),
       ($3, $4, 'other-synthetic', '2026-01-02 03:04:06.100000+00'),
       ($5, $6, NULL, '2026-01-02 03:04:07.000000+00')`,
    [REF.A, A, REF.B, B, REF.C, C],
  );
}
const snapshot = async () =>
  (await admin.query("SELECT to_jsonb(p) AS j FROM app.business_profiles p ORDER BY id")).rows.map(
    (row) => row.j as Record<string, unknown>,
  );
const rowOf = async (subject: string) =>
  (
    await admin.query(
      "SELECT to_jsonb(p) AS j FROM app.business_profiles p WHERE auth_subject = $1",
      [subject],
    )
  ).rows[0]?.j as Record<string, unknown> | undefined;

async function tokenFor(subject: string, claims: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: subject, iss: ISSUER, aud: "api", iat: now, exp: now + 900, ...claims })
    .setProtectedHeader({ alg: "EdDSA", kid: "synthetic-key" })
    .sign(privateKey);
}

function makeApp() {
  const app = createApp({
    webOrigin: WEB,
    ready: async () => true,
    auth: { verifier, store: createPrincipalRepository(runtime.pool) },
    rateLimit: createTestRateLimit().rateLimit,
    profiles: createCurrentProfileRepository(runtime.pool),
  });
  const get = async (subject: string) =>
    app.request(
      `${API}${PATH}`,
      { headers: { Authorization: `Bearer ${await tokenFor(subject)}` } },
      peer(),
    );
  const patch = async (subject: string, body: unknown, claims: Record<string, unknown> = {}) =>
    app.request(
      `${API}${PATH}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${await tokenFor(subject, claims)}`,
          Origin: WEB,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      peer(),
    );
  return { get, patch };
}
const errorCode = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe("TC-API-007-006 API-AUTH-002 / 004 against real PostgreSQL 17 (AR-ID-001/002, AR-OWN-006, DEV-API-005, SPEC-030 §9.2, SPEC-100 §14.1, ACC-BIZ-029)", () => {
  it("GET returns A's display_name as null (not the directory Email) and changes nothing", async () => {
    await resetRows();
    const before = await snapshot();
    const res = await makeApp().get(A);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.data).toEqual({
      profile_ref: REF.A,
      display_name: null,
      updated_at: "2026-01-02T03:04:05.678Z",
    });
    expect(text).not.toContain(EMAIL_A);
    expect(await snapshot()).toEqual(before);
  });

  it("PATCH '  name  ' is 200 'name'; the next GET shows the same value and updated_at; only A's row changed", async () => {
    await resetRows();
    const beforeB = await rowOf(B);
    const beforeC = await rowOf(C);
    const app = makeApp();
    const patched = await app.patch(A, { display_name: "  name  " });
    expect(patched.status).toBe(200);
    const patchedBody = await patched.json();
    expect(patchedBody.data).toMatchObject({ profile_ref: REF.A, display_name: "name" });
    expect(patchedBody.data.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(patchedBody.data.updated_at)).toBeGreaterThan(
      Date.parse("2026-01-02T03:04:05.678Z"),
    );
    const read = await app.get(A);
    expect((await read.json()).data).toEqual(patchedBody.data);
    expect((await rowOf(A))?.display_name).toBe("name");
    expect(await rowOf(B)).toEqual(beforeB);
    expect(await rowOf(C)).toEqual(beforeC);
    expect(await rowCountOf()).toBe(3);
  });

  it("PATCH null and all-space clear the name to NULL", async () => {
    await resetRows();
    await admin.query(
      "UPDATE app.business_profiles SET display_name = 'old' WHERE auth_subject = $1",
      [A],
    );
    const app = makeApp();
    const cleared = await app.patch(A, { display_name: "   " });
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).data.display_name).toBeNull();
    expect((await rowOf(A))?.display_name).toBeNull();
    await admin.query(
      "UPDATE app.business_profiles SET display_name = 'old' WHERE auth_subject = $1",
      [A],
    );
    expect((await app.patch(A, { display_name: null })).status).toBe(200);
    expect((await rowOf(A))?.display_name).toBeNull();
  });

  it("a role claim in the token and B's profile_ref in the body never reach B: 400, A and B unchanged", async () => {
    await resetRows();
    const before = await snapshot();
    const res = await makeApp().patch(
      A,
      { display_name: "name", profile_ref: REF.B },
      { role: "ADMINISTRATOR" },
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION_FAILED");
    expect(await snapshot()).toEqual(before);
  });

  it("C (Email unverified) is 403 EMAIL_VERIFICATION_REQUIRED for GET and PATCH and C's row is unchanged", async () => {
    await resetRows();
    const before = await snapshot();
    const app = makeApp();
    const patched = await app.patch(C, { display_name: "name" });
    expect(patched.status).toBe(403);
    expect(await errorCode(patched)).toBe("EMAIL_VERIFICATION_REQUIRED");
    const read = await app.get(C);
    expect(read.status).toBe(403);
    expect(await errorCode(read)).toBe("EMAIL_VERIFICATION_REQUIRED");
    expect(await snapshot()).toEqual(before);
  });

  it("D (no Business Profile) is 403 AUTHORIZATION_DENIED for GET and PATCH and no Profile is created", async () => {
    await resetRows();
    const before = await snapshot();
    const app = makeApp();
    const read = await app.get(D);
    expect(read.status).toBe(403);
    expect(await errorCode(read)).toBe("AUTHORIZATION_DENIED");
    const patched = await app.patch(D, { display_name: "name" });
    expect(patched.status).toBe(403);
    expect(await errorCode(patched)).toBe("AUTHORIZATION_DENIED");
    expect(await rowOf(D)).toBeUndefined();
    expect(await rowCountOf()).toBe(3);
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    ["81 characters", { display_name: "a".repeat(81) }],
    ["81 emoji", { display_name: "\u{1F600}".repeat(81) }],
    ["a control character", { display_name: "a\u0000b" }],
    // UCR-030-001. JSON.stringify writes a lone surrogate as the escape \ud800, so the wire stays ASCII.
    ["a lone high surrogate", { display_name: "\uD800" }],
    ["a lone low surrogate", { display_name: "\uDC00" }],
    ["a reversed pair", { display_name: "\uDC00\uD800" }],
    ["a lone surrogate mixed with text", { display_name: "name\uD800" }],
  ])("PATCH with %s is 400 VALIDATION_FAILED and A is unchanged", async (_label, body) => {
    await resetRows();
    const before = await snapshot();
    const res = await makeApp().patch(A, body);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION_FAILED");
    expect(await snapshot()).toEqual(before);
  });

  it("a lone surrogate keeps an existing name and nothing is stored as U+FFFD; a valid pair is stored as one code point (UCR-030-001)", async () => {
    await resetRows();
    await admin.query(
      "UPDATE app.business_profiles SET display_name = 'old' WHERE auth_subject = $1",
      [A],
    );
    const before = await snapshot();
    const refused = await makeApp().patch(A, { display_name: "new\uD800" });
    expect(refused.status).toBe(400);
    expect(await errorCode(refused)).toBe("VALIDATION_FAILED");
    expect(await snapshot()).toEqual(before);
    expect((await rowOf(A))?.display_name).toBe("old");
    const replaced = await admin.query(
      "SELECT count(*)::int AS n FROM app.business_profiles WHERE strpos(display_name, U&'\\FFFD') > 0",
    );
    expect(replaced.rows[0].n).toBe(0);

    const accepted = await makeApp().patch(A, { display_name: "😀" });
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).data.display_name).toBe("\u{1F600}");
    const stored = await admin.query(
      "SELECT display_name, char_length(display_name) AS n FROM app.business_profiles WHERE auth_subject = $1",
      [A],
    );
    expect(stored.rows[0]).toEqual({ display_name: "\u{1F600}", n: 1 });
  });
});

async function rowCountOf(): Promise<number> {
  return (await admin.query("SELECT count(*)::int AS n FROM app.business_profiles")).rows[0].n;
}
