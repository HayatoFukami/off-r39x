// SPEC-140 SEC-API-032 / SEC-ABU-020..021, SPEC-150 REL-AUTH-002, SPEC-180 INF-HLT-005 (sixth
// PR #41 review): operation class move, IP canonical form, JWKS refresh control and the readiness
// snapshot probe.
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  AuthFailure,
  createJwksKeyResolver,
  createTokenVerifier,
} from "../../packages/auth/src/index.ts";
import { rateLimitClassOf } from "../../packages/security/src/index.ts";

const JWKS_URL = "https://issuer.example.com/jwks";
const ISSUER = "https://issuer.example.com";
const SUBJECT = "aef69f82-c9b7-4fd1-9a6f-126f5748e9ae";

async function signingKeys(kid: string) {
  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const jwk = { ...(await exportJWK(pair.publicKey)), kid, alg: "EdDSA", use: "sig" };
  const token = await new SignJWT({ sub: SUBJECT, iss: ISSUER, aud: "api" })
    .setProtectedHeader({ alg: "EdDSA", kid })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(pair.privateKey);
  return { jwk, token };
}

function jwksServer(initial: Array<{ kid: string }> = []) {
  const served: Record<string, unknown>[] = [];
  let fetches = 0;
  let release: (() => void) | undefined;
  let hold = false;
  const fetcher = async (input: unknown) => {
    expect(String(input)).toBe(JWKS_URL);
    fetches += 1;
    if (hold) await new Promise<void>((resolve) => (release = resolve));
    return new Response(JSON.stringify({ keys: served }), {
      headers: { "content-type": "application/json" },
    });
  };
  return {
    fetcher: fetcher as unknown as typeof fetch,
    fetches: () => fetches,
    publish: (jwk: Record<string, unknown>) => served.push(jwk),
    holdNext: () => {
      hold = true;
    },
    finish: () => {
      hold = false;
      release?.();
    },
    initial,
  };
}

describe("operation class of read-only Goods preview (API-RLC-005)", () => {
  it("TC-RLM-007-202 API-STF-GDS-002 is a self_read operation and no longer shares the goods_handoff counter", () => {
    expect(rateLimitClassOf("API-STF-GDS-002")).toBe("self_read");
    expect(rateLimitClassOf("API-STF-GDS-001")).toBe("goods_handoff");
  });
});

describe("JWKS refresh control (SPEC-150 REL-AUTH-002, SEC-ABU-020 / 021)", () => {
  it("TC-RLM-005-207 a kid already in the cache verifies without any refresh; the first unknown kid starts one refresh", async () => {
    const known = await signingKeys("kid-known");
    const server = jwksServer();
    server.publish(known.jwk);
    let now = 1_000_000;
    const resolver = createJwksKeyResolver({
      jwksUrl: JWKS_URL,
      fetch: server.fetcher,
      now: () => now,
    });
    const verifier = createTokenVerifier(
      { issuer: ISSUER, audience: "api", jwksUrl: JWKS_URL },
      resolver,
    );
    expect((await verifier.verify(known.token)).subject).toBe(SUBJECT);
    expect(server.fetches()).toBe(1);
    expect((await verifier.verify(known.token)).subject).toBe(SUBJECT);
    expect(server.fetches()).toBe(1);
    // The previous refresh started 30 s ago at the earliest: a new refresh is allowed now.
    now += 30_000;
    const unknown = await signingKeys("kid-unknown");
    await expect(verifier.verify(unknown.token)).rejects.toMatchObject({ kind: "unauthenticated" });
    expect(server.fetches()).toBe(2);
  });

  it("TC-RLM-005-208 refresh is single-flight and at most once per 30 s: a request during the refresh or within 30 s answers unavailable at once, without fetching and without counting as an auth failure; after 30 s the next unknown kid refreshes again", async () => {
    const known = await signingKeys("kid-known");
    const unknown = await signingKeys("kid-unknown");
    const server = jwksServer();
    server.publish(known.jwk);
    let now = 1_000_000;
    const resolver = createJwksKeyResolver({
      jwksUrl: JWKS_URL,
      fetch: server.fetcher,
      now: () => now,
    });
    const verifier = createTokenVerifier(
      { issuer: ISSUER, audience: "api", jwksUrl: JWKS_URL },
      resolver,
    );
    // The initiating request waits for its own refresh; the refresh is held open here.
    server.holdNext();
    const initiator = verifier.verify(unknown.token).catch((error: unknown) => error);
    for (let i = 0; i < 1000 && server.fetches() < 1; i += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(server.fetches()).toBe(1);
    // While it is in flight, another unknown kid and a known kid's neighbour answer at once.
    const during = await verifier
      .verify(await signingKeys("kid-other").then((k) => k.token))
      .catch((error: unknown) => error);
    expect(during).toBeInstanceOf(AuthFailure);
    expect((during as AuthFailure).kind).toBe("unavailable");
    server.finish();
    expect(await initiator).toMatchObject({ kind: "unauthenticated" });
    expect(server.fetches()).toBe(1);
    // Within 30 s of the start: no refresh, unavailable, never a 401 count.
    now += 29_000;
    const within = await verifier.verify(unknown.token).catch((error: unknown) => error);
    expect(within).toMatchObject({ kind: "unavailable" });
    expect(server.fetches()).toBe(1);
    // A cached kid still verifies while the refresh interval is running.
    expect((await verifier.verify(known.token)).subject).toBe(SUBJECT);
    // After 30 s a new refresh is allowed.
    now += 1_000;
    await expect(verifier.verify(unknown.token)).rejects.toMatchObject({ kind: "unauthenticated" });
    expect(server.fetches()).toBe(2);
  });

  it("TC-RLM-005-209 a refresh that cannot be completed is unavailable, never unauthenticated (the token's validity is not decided)", async () => {
    const unknown = await signingKeys("kid-unknown");
    const failing = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    const resolver = createJwksKeyResolver({ jwksUrl: JWKS_URL, fetch: failing, now: () => 1 });
    const verifier = createTokenVerifier(
      { issuer: ISSUER, audience: "api", jwksUrl: JWKS_URL },
      resolver,
    );
    await expect(verifier.verify(unknown.token)).rejects.toMatchObject({ kind: "unavailable" });
  });
});
