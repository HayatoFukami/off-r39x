import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { expect, it } from "vitest";
import {
  createTokenVerifier,
  hasCapability,
  resolvePrincipal,
} from "../../packages/auth/src/index.ts";

it("TC-SEC-AUTH-001-050 signed Ed25519 JWT rejects lifetime, issuer, audience, signature and future nbf", async () => {
  const keys = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const other = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const verifier = createTokenVerifier(
    {
      issuer: "https://issuer.example.com",
      audience: "api",
      jwksUrl: "https://issuer.example.com/jwks",
    },
    async () => keys.publicKey,
  );
  const now = Math.floor(Date.now() / 1000);
  const sign = (overrides: Record<string, unknown> = {}, key = keys.privateKey) =>
    new SignJWT({
      sub: "aef69f82-c9b7-4fd1-9a6f-126f5748e9ae",
      iss: "https://issuer.example.com",
      aud: "api",
      iat: now,
      exp: now + 900,
      ...overrides,
    })
      .setProtectedHeader({ alg: "EdDSA" })
      .sign(key);
  expect((await verifier.verify(await sign())).subject).toBe(
    "aef69f82-c9b7-4fd1-9a6f-126f5748e9ae",
  );
  for (const claims of [
    { exp: now + 901 },
    { iss: "https://evil.example.com" },
    { aud: "other" },
    { nbf: now + 60 },
    { exp: now - 1 },
    { sub: "not-uuid" },
    { iat: undefined },
  ])
    await expect(verifier.verify(await sign(claims))).rejects.toThrow();
  await expect(verifier.verify(await sign({}, other.privateKey))).rejects.toThrow();
  await expect(verifier.verify("not-a-jwt")).rejects.toThrow();
  const symmetric = await new SignJWT({
    sub: "aef69f82-c9b7-4fd1-9a6f-126f5748e9ae",
    iss: "https://issuer.example.com",
    aud: "api",
    iat: now,
    exp: now + 900,
  })
    .setProtectedHeader({ alg: "HS256" })
    .sign(new Uint8Array(32));
  await expect(verifier.verify(symmetric)).rejects.toThrow();
  const jwk = await exportJWK(keys.publicKey);
  const unknownVerifier = createTokenVerifier(
    {
      issuer: "https://issuer.example.com",
      audience: "api",
      jwksUrl: "https://issuer.example.com/jwks",
    },
    createLocalJWKSet({ keys: [{ ...jwk, kid: "known" }] }),
  );
  const unknown = await new SignJWT({
    sub: "aef69f82-c9b7-4fd1-9a6f-126f5748e9ae",
    iss: "https://issuer.example.com",
    aud: "api",
    iat: now,
    exp: now + 900,
  })
    .setProtectedHeader({ alg: "EdDSA", kid: "unknown" })
    .sign(keys.privateKey);
  await expect(unknownVerifier.verify(unknown)).rejects.toThrow();
  // Ed448 is a valid EdDSA curve but explicitly forbidden by this deployment contract.
  const { generateKeyPairSync } = await import("node:crypto");
  const wrongCurve = generateKeyPairSync("ed448");
  const wrongVerifier = createTokenVerifier(
    {
      issuer: "https://issuer.example.com",
      audience: "api",
      jwksUrl: "https://issuer.example.com/jwks",
    },
    async () => wrongCurve.publicKey,
  );
  const { sign: nodeSign } = await import("node:crypto");
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: "aef69f82-c9b7-4fd1-9a6f-126f5748e9ae",
      iss: "https://issuer.example.com",
      aud: "api",
      iat: now,
      exp: now + 900,
    }),
  ).toString("base64url");
  const input = `${header}.${payload}`;
  const wrongToken = `${input}.${nodeSign(null, Buffer.from(input), wrongCurve.privateKey).toString("base64url")}`;
  await expect(wrongVerifier.verify(wrongToken)).rejects.toThrow();
});
it("TC-DEV-AUTH-008-050 DB dependency failure never becomes credential denial", async () => {
  await expect(
    resolvePrincipal(
      { subject: "aef69f82-c9b7-4fd1-9a6f-126f5748e9ae" },
      {
        findByAuthSubject: async () => {
          throw new Error("secret SQL");
        },
      },
    ),
  ).rejects.toMatchObject({ kind: "database" });
});
it("TC-AR-ROLE-012-050 administrator does not inherit staff", () => {
  expect(
    hasCapability(
      { subject: "x", profileRef: "y", emailVerified: true, roles: ["ADMINISTRATOR"] },
      "entry_checkin.execute",
    ),
  ).toBe(false);
});
