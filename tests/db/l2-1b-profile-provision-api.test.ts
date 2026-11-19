// PR-L2-1b C1 (TC-DB-AUTH-001-006, G3+G4): API-AUTH-003 from a signed JWT to a real PostgreSQL 17, built
// like tests/db/l2-1a-self-profile-api.test.ts: the synthetic Identity directory view,
// createPrincipalRepository and createCurrentProfileRepository on app_api_runtime (verified TLS), a fresh
// in-memory rate limit per app (profile_mutation allows 3 per 10 s per subject). Every refusal also asserts
// the rows are unchanged (TST-GEN-002). Needs TEST_DATABASE_URL and TEST_DATABASE_CA; it fails (it does not
// skip) without them. Synthetic data only (Emails under example.test).
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
const PROVISION = "/api/v1/self/profile/provision";
const PROFILE = "/api/v1/self/profile";
const PRINCIPAL = "/api/v1/self/principal";
const ISSUER = "https://issuer.example.test";
const A = "00000000-0000-4000-8000-0000000000a1"; // verified, Profile
const C = "00000000-0000-4000-8000-0000000000a3"; // Email unverified, no Profile
const D = "00000000-0000-4000-8000-0000000000a4"; // verified, no Profile
const E = "00000000-0000-4000-8000-0000000000a5"; // not in the directory
const F = "00000000-0000-4000-8000-0000000000a6"; // verified, Profile, ACTIVE ADMINISTRATOR
const G = "00000000-0000-4000-8000-0000000000a7"; // verified, no Profile, the same Email as A
const H = "00000000-0000-4000-8000-0000000000a8"; // verified, no Profile (HTTP race)
const REF_A = "00000000-0000-4000-8000-0000000000b1";
const REF_F = "00000000-0000-4000-8000-0000000000b6";
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
       ($1, $7, true), ($2, 'c@example.test', false), ($3, 'd@example.test', true),
       ($4, 'f@example.test', true), ($5, $7, true), ($6, 'h@example.test', true)`,
    [A, C, D, F, G, H, EMAIL_A],
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
       ($1, $2, 'name-of-a', '2026-01-02 03:04:05.678912+00'),
       ($3, $4, NULL, '2026-01-02 03:04:06.100000+00')`,
    [REF_A, A, REF_F, F],
  );
  await admin.query(
    `INSERT INTO app.role_assignments(profile_id, role, state)
       SELECT id, 'ADMINISTRATOR', 'ACTIVE' FROM app.business_profiles WHERE auth_subject = $1`,
    [F],
  );
}
const snapshot = async () =>
  (await admin.query("SELECT to_jsonb(p) AS j FROM app.business_profiles p ORDER BY id")).rows.map(
    (row) => row.j as Record<string, unknown>,
  );
const roles = async () =>
  (await admin.query("SELECT to_jsonb(r) AS j FROM app.role_assignments r ORDER BY id")).rows.map(
    (row) => row.j as Record<string, unknown>,
  );
const rowsOf = async (subject: string) =>
  (
    await admin.query(
      "SELECT to_jsonb(p) AS j FROM app.business_profiles p WHERE auth_subject = $1",
      [subject],
    )
  ).rows.map((row) => row.j as Record<string, unknown>);
const rowCount = async (): Promise<number> =>
  (await admin.query("SELECT count(*)::int AS n FROM app.business_profiles")).rows[0].n;

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
  const get = async (subject: string, path: string) =>
    app.request(
      `${API}${path}`,
      { headers: { Authorization: `Bearer ${await tokenFor(subject)}` } },
      peer(),
    );
  const provision = async (
    subject: string,
    body: string = "{}",
    claims: Record<string, unknown> = {},
  ) =>
    app.request(
      `${API}${PROVISION}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await tokenFor(subject, claims)}`,
          Origin: WEB,
          "Content-Type": "application/json",
        },
        body,
      },
      peer(),
    );
  return { get, provision };
}
const errorCode = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe("TC-DB-AUTH-001-006 API-AUTH-003 against real PostgreSQL 17 (AR-ID-001/002/004/005, DB-AUTH-001, SPEC-030 §9.2, SPEC-100 §14.1)", () => {
  it("D (verified, no Profile): 201 with display_name null and a new row; then GET profile and principal see it; a second POST is 200 and changes nothing", async () => {
    await resetRows();
    const app = makeApp();
    const before = await snapshot();
    const created = await app.provision(D);
    expect(created.status).toBe(201);
    const text = await created.text();
    const body = JSON.parse(text);
    expect(Object.keys(body.data).sort()).toEqual(["display_name", "profile_ref", "updated_at"]);
    expect(body.data.display_name).toBeNull();
    expect(body.data.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(text).not.toContain("d@example.test");
    const rows = await rowsOf(D);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.public_ref).toBe(body.data.profile_ref);
    expect(rows[0]?.display_name).toBeNull();
    expect(await rowCount()).toBe(before.length + 1);

    const read = await app.get(D, PROFILE);
    expect(read.status).toBe(200);
    expect((await read.json()).data).toEqual(body.data);
    const principal = await app.get(D, PRINCIPAL);
    expect(principal.status).toBe(200);
    expect((await principal.json()).data.profile_ref).toBe(body.data.profile_ref);

    const afterFirst = await snapshot();
    const again = await app.provision(D);
    expect(again.status).toBe(200);
    expect((await again.json()).data).toEqual(body.data);
    expect(await snapshot()).toEqual(afterFirst);
  });

  it("C (Email unverified, no Profile): 403 EMAIL_VERIFICATION_REQUIRED and no row", async () => {
    await resetRows();
    const before = await snapshot();
    const res = await makeApp().provision(C);
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("EMAIL_VERIFICATION_REQUIRED");
    expect(await rowsOf(C)).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it("E (not in the directory): 401 AUTHENTICATION_REQUIRED and no row", async () => {
    await resetRows();
    const before = await snapshot();
    const res = await makeApp().provision(E);
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("AUTHENTICATION_REQUIRED");
    expect(await rowsOf(E)).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it("A (has a Profile): 200 with A's values and every column unchanged", async () => {
    await resetRows();
    const before = await snapshot();
    const res = await makeApp().provision(A);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      profile_ref: REF_A,
      display_name: "name-of-a",
      updated_at: "2026-01-02T03:04:05.678Z",
    });
    expect(await snapshot()).toEqual(before);
  });

  it("F (ACTIVE ADMINISTRATOR): 200 and the profile and role_assignments are unchanged", async () => {
    await resetRows();
    const before = await snapshot();
    const rolesBefore = await roles();
    const res = await makeApp().provision(F);
    expect(res.status).toBe(200);
    expect((await res.json()).data.profile_ref).toBe(REF_F);
    expect(await snapshot()).toEqual(before);
    expect(await roles()).toEqual(rolesBefore);
    expect(rolesBefore).toHaveLength(1);
  });

  it("G (a new subject with A's Email) gets its own profile; A's row is not re-pointed (AR-ID-005)", async () => {
    await resetRows();
    const beforeA = await rowsOf(A);
    const res = await makeApp().provision(G);
    expect(res.status).toBe(201);
    const ref = (await res.json()).data.profile_ref as string;
    expect(ref).not.toBe(REF_A);
    expect(await rowsOf(A)).toEqual(beforeA);
    const mine = await rowsOf(G);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.public_ref).toBe(ref);
    expect(await rowsOf(A)).toHaveLength(1);
  });

  it("D sending A's auth_subject and profile_ref in the body, with a role claim in the token, is 400 and no row changes", async () => {
    await resetRows();
    const before = await snapshot();
    const res = await makeApp().provision(
      D,
      JSON.stringify({ auth_subject: A, profile_ref: REF_A }),
      { role: "ADMINISTRATOR" },
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION_FAILED");
    expect(await snapshot()).toEqual(before);
    expect(await rowsOf(D)).toEqual([]);
  });

  it("a role claim in the token changes nothing: D is created without a Role", async () => {
    await resetRows();
    const res = await makeApp().provision(D, "{}", { role: "ADMINISTRATOR" });
    expect(res.status).toBe(201);
    expect(await roles()).toHaveLength(1);
    expect((await app_principal(D)).has_administrator_role).toBe(false);
  });

  it("H: two simultaneous POSTs (inside the burst of 3) are one 201 and one 200 with the same profile_ref and one row", async () => {
    await resetRows();
    const app = makeApp();
    const [x, y] = await Promise.all([app.provision(H), app.provision(H)]);
    expect([x.status, y.status].sort()).toEqual([200, 201]);
    const a = (await x.json()).data;
    const b = (await y.json()).data;
    expect(a).toEqual(b);
    const rows = await rowsOf(H);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.public_ref).toBe(a.profile_ref);
  });
});

async function app_principal(subject: string): Promise<{ has_administrator_role: boolean }> {
  const res = await makeApp().get(subject, PRINCIPAL);
  expect(res.status).toBe(200);
  return (await res.json()).data;
}
