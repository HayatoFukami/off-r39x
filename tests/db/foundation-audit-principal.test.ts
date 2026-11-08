import { randomUUID } from "node:crypto";
import { generateKeyPair, SignJWT } from "jose";
import { Pool } from "pg";
import { expect, it } from "vitest";
import { createApp } from "../../apps/api/src/api/app.ts";
import { createTokenVerifier } from "../../packages/auth/src/index.ts";
import { createPrincipalRepository } from "../../packages/db/src/index.ts";
import { installSyntheticDirectory, prepareFoundationDatabase } from "../harness/db/foundation.ts";

it("TC-AUTH-AUDIT-004 canonical principal route resolves signed JWT against current real PG directory and roles", async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Real PG17 required");
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  const subject = randomUUID();
  const ref = randomUUID();
  const setup = await pool.connect();
  try {
    await prepareFoundationDatabase(setup);
    await installSyntheticDirectory(setup);
  } finally {
    setup.release();
  }
  const keys = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    sub: subject,
    iat: now,
    exp: now + 900,
    iss: "https://issuer.example.test",
    aud: "api",
    role: "ADMINISTRATOR",
  })
    .setProtectedHeader({ alg: "EdDSA" })
    .sign(keys.privateKey);
  const verifier = createTokenVerifier(
    {
      issuer: "https://issuer.example.test",
      audience: "api",
      jwksUrl: "https://issuer.example.test/jwks",
    },
    async () => keys.publicKey,
  );
  const app = createApp({
    webOrigin: "https://web.example.test",
    ready: async () => true,
    auth: { verifier, store: createPrincipalRepository(pool) },
    enforcement: {
      assertAvailable: async () => {},
      middleware: async (_c, next) => {
        await next();
      },
    },
  });
  const get = () =>
    app.request("/api/v1/self/principal", { headers: { Authorization: `Bearer ${token}` } });
  try {
    await pool.query("BEGIN");
    await pool.query(
      "INSERT INTO synthetic_provider.identities(subject,current_email,verified) VALUES($1,'synthetic@example.test',true)",
      [subject],
    );
    const id = (
      await pool.query(
        "INSERT INTO app.business_profiles(public_ref,auth_subject) VALUES($1,$2) RETURNING id",
        [ref, subject],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO app.role_assignments(profile_id,role,state) VALUES($1,'STAFF','ACTIVE')",
      [id],
    );
    let res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({
      profile_ref: ref,
      has_staff_role: true,
      has_administrator_role: false,
    });
    await pool.query(
      "UPDATE app.role_assignments SET state='REVOKED',revoked_at=transaction_timestamp() WHERE profile_id=$1",
      [id],
    );
    res = await get();
    expect((await res.json()).data.has_staff_role).toBe(false);
    await pool.query("UPDATE synthetic_provider.identities SET verified=false WHERE subject=$1", [
      subject,
    ]);
    expect((await get()).status).toBe(403);
    await pool.query("DELETE FROM synthetic_provider.identities WHERE subject=$1", [subject]);
    expect((await get()).status).toBe(401);
  } finally {
    await pool.query("ROLLBACK");
    await pool.end();
  }
  // Physical dependency unavailable; never fall back to old verified/profile data.
  expect((await get()).status).toBe(503);
});
