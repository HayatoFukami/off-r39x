import { createRemoteJWKSet, customFetch, generateKeyPair, SignJWT } from "jose";
import { expect, it } from "vitest";
import {
  createApp,
  protectedMountGuard,
  requireCapability,
  requirePrincipal,
  requireVerifiedEmail,
} from "../../apps/api/src/api/app.ts";
import {
  AuthFailure,
  createTokenVerifier,
  type PrincipalRecord,
} from "../../packages/auth/src/index.ts";
import { createLogger } from "../../packages/observability/src/index.ts";

it("TC-SEC-AUTH-005-051 trusted remote JWKS HTTP/JSON/schema failures return 503 without DB lookup; valid unknown kid returns 401", async () => {
  const keys = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    sub: "aef69f82-c9b7-4fd1-9a6f-126f5748e9ae",
    iss: "https://issuer.example.test",
    aud: "api",
    iat: now,
    exp: now + 900,
  })
    .setProtectedHeader({ alg: "EdDSA", kid: "unknown" })
    .sign(keys.privateKey);
  for (const scenario of [
    { body: "provider unavailable", status: 503, expected: 503 },
    { body: "not JSON", status: 200, expected: 503 },
    { body: '{"keys":"invalid"}', status: 200, expected: 503 },
    { body: '{"keys":[]}', status: 200, expected: 401 },
  ]) {
    let fetches = 0;
    let lookups = 0;
    // Real jose remote resolver with a harness-only trusted transport; no auth bypass.
    const remote = createRemoteJWKSet(new URL("https://issuer.example.test/jwks"), {
      [customFetch]: async (url, options) => {
        expect(String(url)).toBe("https://issuer.example.test/jwks");
        expect(options.method).toBe("GET");
        fetches++;
        return new Response(scenario.body, {
          status: scenario.status,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    const verifier = createTokenVerifier(
      {
        issuer: "https://issuer.example.test",
        audience: "api",
        jwksUrl: "https://issuer.example.test/jwks",
      },
      remote,
    );
    const app = createApp({ webOrigin: "https://web.example.test", ready: async () => false });
    app.get(
      "/api/v1/test",
      requirePrincipal(verifier, {
        findByAuthSubject: async () => {
          lookups++;
          throw new Error("DB must not be reached");
        },
      }),
      (c) => c.json({ ok: true }),
    );
    const response = await app.request("/api/v1/test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(scenario.expected);
    expect((await response.json()).error.code).toBe(
      scenario.expected === 503 ? "AUTH_SERVICE_TEMPORARY_FAILURE" : "AUTHENTICATION_REQUIRED",
    );
    expect(fetches).toBe(1);
    expect(lookups).toBe(0);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  }
});

it("TC-SEC-AZ-013-050 HTTP authorization uses current DB roles/email, never JWT claims; dependency outages are 503", async () => {
  const keys = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const subject = "aef69f82-c9b7-4fd1-9a6f-126f5748e9ae";
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    sub: subject,
    iss: "https://issuer.example.com",
    aud: "api",
    iat: now,
    exp: now + 900,
    role: "STAFF",
    email_verified: true,
  })
    .setProtectedHeader({ alg: "EdDSA" })
    .sign(keys.privateKey);
  let record: PrincipalRecord = {
    directory: { authSubject: subject, emailVerified: true },
    profile: { id: "9007199254740993", publicRef: subject, authSubject: subject },
    roles: ["STAFF"],
  };
  let dbFailed = false;
  let authFailed = false;
  let reads = 0;
  const real = createTokenVerifier(
    {
      issuer: "https://issuer.example.com",
      audience: "api",
      jwksUrl: "https://issuer.example.com/jwks",
    },
    async () => keys.publicKey,
  );
  const logs: string[] = [];
  const app = createApp({
    webOrigin: "https://web.example.com",
    ready: async () => true,
    logger: createLogger({ service: "API", environment: "test", actor_type: "GUEST" }, (line) => {
      logs.push(line);
    }),
  });
  // Harness route is not part of production factory or its public RPC type.
  app.get(
    "/api/v1/test",
    requirePrincipal(
      {
        verify: async (token) => {
          if (authFailed) throw new AuthFailure("unavailable");
          return real.verify(token);
        },
      },
      {
        findByAuthSubject: async () => {
          reads++;
          if (dbFailed) throw new Error("secret SQL");
          return record;
        },
      },
    ),
    requireCapability("entry_checkin.execute"),
    requireVerifiedEmail(),
    (c) => c.json({ ok: true }),
  );
  const get = (value = token) =>
    app.request("/api/v1/test", { headers: { Authorization: `Bearer ${value}` } });
  expect((await get()).status).toBe(200);
  record = { ...record, roles: ["ADMINISTRATOR"] };
  expect((await get()).status).toBe(403);
  record = { ...record, roles: [] };
  expect((await get()).status).toBe(403);
  record = {
    ...record,
    roles: ["STAFF"],
    directory: { authSubject: subject, emailVerified: false },
  };
  let response = await get();
  expect(response.status).toBe(403);
  expect((await response.json()).error.code).toBe("EMAIL_VERIFICATION_REQUIRED");
  dbFailed = true;
  response = await get();
  expect(response.status).toBe(503);
  expect((await response.json()).error.code).toBe("DATABASE_TEMPORARY_FAILURE");
  dbFailed = false;
  authFailed = true;
  response = await get();
  expect(response.status).toBe(503);
  expect((await response.json()).error.code).toBe("AUTH_SERVICE_TEMPORARY_FAILURE");
  authFailed = false;
  expect((await get("malformed")).status).toBe(401);
  expect(reads).toBe(5);
  const saved = record;
  record = { ...saved, directory: null };
  expect((await get()).status).toBe(401);
  record = { ...saved, profile: null };
  expect((await get()).status).toBe(403);
  record = { ...saved, roles: ["CUSTOMER"] };
  expect((await get()).status).toBe(409);
  expect(logs.some((line) => JSON.parse(line).event_name === "http.request.completed")).toBe(true);
  expect(logs.join("")).not.toContain(token);
  expect(logs.join("")).not.toContain("secret SQL");
});

it("TC-SEC-ABU-001-050 draining rejects new requests and shared protected guard is mandatory", async () => {
  let draining = false;
  const app = createApp({
    webOrigin: "https://web.example.com",
    ready: async () => true,
    draining: () => draining,
  });
  expect((await app.request("/internal/health/ready")).status).toBe(200);
  draining = true;
  expect((await app.request("/internal/health/ready")).status).toBe(503);
  expect((await app.request("/internal/health/live")).status).toBe(503);
  await expect(protectedMountGuard(undefined)).rejects.toThrow();
});
