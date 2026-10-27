import { randomUUID } from "node:crypto";
import { generateKeyPair, SignJWT } from "jose";
import { Pool } from "pg";
import { expect, it } from "vitest";
import {
  createApp,
  requireCapability,
  requirePrincipal,
  requireVerifiedEmail,
} from "../../apps/api/src/api/app.ts";
import {
  createTokenVerifier,
  hasCapability,
  resolvePrincipal,
} from "../../packages/auth/src/index.ts";
import { createPrincipalRepository } from "../../packages/db/src/index.ts";
import { installSyntheticDirectory, prepareFoundationDatabase } from "../harness/db/foundation.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("Real PostgreSQL integration requires TEST_DATABASE_URL");

it("TC-DB-ARC-008-050 real PG profile bigint/public UUID and current roles resolve from signed identity without provisioning", async () => {
  // backend-db serializes this file with the DB lane. Fixture rows roll back.
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const setup = await pool.connect();
    try {
      await prepareFoundationDatabase(setup);
      await installSyntheticDirectory(setup);
    } finally {
      setup.release();
    }
    expect(
      Math.floor(
        Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num) / 10000,
      ),
    ).toBe(17);
    await pool.query("BEGIN");
    const subject = randomUUID();
    const publicRef = randomUUID();
    await pool.query(
      "INSERT INTO synthetic_provider.identities(subject,current_email,verified) VALUES($1,$2,true)",
      [subject, "principal@example.test"],
    );
    const inserted = await pool.query(
      "INSERT INTO app.business_profiles(id,public_ref,auth_subject) OVERRIDING SYSTEM VALUE VALUES($1,$2,$3) RETURNING id::text",
      ["9007199254740995", publicRef, subject],
    );
    const internalId = inserted.rows[0].id as string;
    await pool.query(
      "INSERT INTO app.role_assignments(profile_id,role,state) VALUES($1,'STAFF','ACTIVE')",
      [internalId],
    );
    const keys = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      sub: subject,
      iss: "https://issuer.example.test",
      aud: "api",
      iat: now,
      exp: now + 900,
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
    const identity = await verifier.verify(token);
    const store = createPrincipalRepository(pool);
    await pool.query("SET LOCAL ROLE app_api_runtime");
    const record = await store.findByAuthSubject(subject);
    expect(record.profile?.id).toBe("9007199254740995");
    const principal = await resolvePrincipal(identity, store);
    expect(principal.profileRef).toBe(publicRef);
    expect(principal).not.toHaveProperty("profileId");
    expect(hasCapability(principal, "entry_checkin.execute")).toBe(true);
    expect(hasCapability(principal, "role_assignment.manage")).toBe(false);
    const app = createApp({ webOrigin: "https://web.example.test", ready: async () => false });
    app.get(
      "/api/v1/test",
      requirePrincipal(verifier, store),
      requireCapability("entry_checkin.execute"),
      requireVerifiedEmail(),
      (c) => c.json({ profileRef: c.get("principal").profileRef }),
    );
    const request = () =>
      app.request("/api/v1/test", { headers: { Authorization: `Bearer ${token}` } });
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profileRef: publicRef });
    await pool.query(
      "UPDATE app.role_assignments SET state='REVOKED',revoked_at=transaction_timestamp() WHERE profile_id=$1",
      [internalId],
    );
    expect(hasCapability(await resolvePrincipal(identity, store), "entry_checkin.execute")).toBe(
      false,
    );
    const denied = await request();
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe("AUTHORIZATION_DENIED");
    const missing = randomUUID();
    await expect(resolvePrincipal({ subject: missing }, store)).rejects.toMatchObject({
      kind: "unauthenticated",
    });
    expect(
      (
        await pool.query("SELECT count(*) FROM app.business_profiles WHERE auth_subject=$1", [
          missing,
        ])
      ).rows[0].count,
    ).toBe("0");
  } finally {
    try {
      await pool.query("ROLLBACK");
    } finally {
      await pool.end();
    }
  }
});
