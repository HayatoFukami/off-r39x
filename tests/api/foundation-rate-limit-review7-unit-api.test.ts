// SPEC-140 SEC-ABU-015 / 021 / 029 / 033, SPEC-150 REL-AUTH-002, SPEC-160 §42 / OBS-ALT-042,
// SPEC-180 INF-HLT-005 (seventh PR #41 review and the PR #46 review follow-ups): JWKS key lifetime and
// monotonic clocks, the token structure check, the guard read, UUID canonical form, the readiness
// gauge per instance.
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthFailure,
  createJwksKeyResolver,
  createTokenVerifier,
  inspectBearerToken,
  MAX_TOKEN_BYTES,
} from "../../packages/auth/src/index.ts";
import {
  canonicalReference,
  createRateLimiter,
  isPurchaseStartOperation,
  parseRateLimitConfig,
} from "../../packages/security/src/index.ts";
import { ceilingConfigText, TEST_HMAC_KEY } from "../harness/rate-limit/api.ts";
import { createMemoryStore } from "../harness/rate-limit/memory-store.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

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

/** A JWKS endpoint whose document and failure mode the test controls. */
function jwksEndpoint() {
  let served: Record<string, unknown>[] = [];
  let fetches = 0;
  let failing = false;
  let release: (() => void) | undefined;
  let hold = false;
  const fetcher = (async () => {
    fetches += 1;
    if (hold) await new Promise<void>((resolve) => (release = resolve));
    if (failing) throw new TypeError("network down");
    return new Response(JSON.stringify({ keys: served }), {
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return {
    fetcher,
    fetches: () => fetches,
    serve: (...keys: Record<string, unknown>[]) => {
      served = keys;
    },
    fail: (value: boolean) => {
      failing = value;
    },
    holdNext: () => {
      hold = true;
    },
    finish: () => {
      hold = false;
      release?.();
    },
  };
}

function verifierOver(endpoint: ReturnType<typeof jwksEndpoint>, clock: { now: number }) {
  return createTokenVerifier(
    { issuer: ISSUER, audience: "api", jwksUrl: JWKS_URL },
    createJwksKeyResolver({ jwksUrl: JWKS_URL, fetch: endpoint.fetcher, now: () => clock.now }),
  );
}

function limiterOver(store = createMemoryStore(), overrides: Record<string, unknown> = {}) {
  const limiter = createRateLimiter({
    store,
    config: parseRateLimitConfig(ceilingConfigText(overrides)),
    hmacKey: TEST_HMAC_KEY,
    hmacKeyVersion: 1,
  });
  return { limiter, store };
}

describe("JWKS key lifetime (SPEC-150 REL-AUTH-002)", () => {
  it("TC-RLM-005-210 a cached key is trusted for 600 s only: a key removed from the JWKS is rejected once it expires, not before", async () => {
    const a = await signingKeys("kid-a");
    const b = await signingKeys("kid-b");
    const endpoint = jwksEndpoint();
    const clock = { now: 1_000 };
    const verifier = verifierOver(endpoint, clock);
    endpoint.serve(a.jwk);
    expect((await verifier.verify(a.token)).subject).toBe(SUBJECT);
    expect(endpoint.fetches()).toBe(1);
    // The provider rotates: kid-a is gone, kid-b replaces it.
    endpoint.serve(b.jwk);
    clock.now += 599_999;
    expect((await verifier.verify(a.token)).subject).toBe(SUBJECT);
    expect(endpoint.fetches()).toBe(1);
    // At 600 s the key must be revalidated; it is no longer in the JWKS, so it is discarded.
    clock.now += 1;
    await expect(verifier.verify(a.token)).rejects.toMatchObject({ kind: "unauthenticated" });
    expect(endpoint.fetches()).toBe(2);
    expect((await verifier.verify(b.token)).subject).toBe(SUBJECT);
    // The discarded key stays discarded: within the 30 s interval it cannot even be looked up again
    // (unavailable, no fetch); after the interval its kid is unknown and the token is unauthenticated.
    await expect(verifier.verify(a.token)).rejects.toMatchObject({ kind: "unavailable" });
    expect(endpoint.fetches()).toBe(2);
    clock.now += 30_000;
    await expect(verifier.verify(a.token)).rejects.toMatchObject({ kind: "unauthenticated" });
    expect(endpoint.fetches()).toBe(3);
  });

  it("TC-RLM-005-211 an expired key that is still in the JWKS is revalidated and trusted for another 600 s", async () => {
    const a = await signingKeys("kid-a");
    const endpoint = jwksEndpoint();
    const clock = { now: 1_000 };
    const verifier = verifierOver(endpoint, clock);
    endpoint.serve(a.jwk);
    await verifier.verify(a.token);
    clock.now += 600_000;
    expect((await verifier.verify(a.token)).subject).toBe(SUBJECT);
    expect(endpoint.fetches()).toBe(2);
    clock.now += 599_000;
    expect((await verifier.verify(a.token)).subject).toBe(SUBJECT);
    expect(endpoint.fetches()).toBe(2);
  });

  it("TC-RLM-005-212 an expired key that cannot be revalidated is never used: unavailable (503), not unauthenticated, until a refresh may start", async () => {
    const a = await signingKeys("kid-a");
    const other = await signingKeys("kid-other");
    const endpoint = jwksEndpoint();
    const clock = { now: 1_000 };
    const verifier = verifierOver(endpoint, clock);
    endpoint.serve(a.jwk);
    await verifier.verify(a.token);
    // A refresh started 20 s before the expiry fails: the key's lifetime is not renewed.
    clock.now += 580_000;
    endpoint.fail(true);
    await expect(verifier.verify(other.token)).rejects.toMatchObject({ kind: "unavailable" });
    expect(endpoint.fetches()).toBe(2);
    // Expired, and the interval since the last refresh start (20 s) has not elapsed: no fetch.
    clock.now += 20_000;
    await expect(verifier.verify(a.token)).rejects.toMatchObject({ kind: "unavailable" });
    expect(endpoint.fetches()).toBe(2);
    // Allowed again, but the endpoint is still down: still unavailable.
    clock.now += 10_000;
    await expect(verifier.verify(a.token)).rejects.toMatchObject({ kind: "unavailable" });
    expect(endpoint.fetches()).toBe(3);
    // Recovery: the key is revalidated.
    endpoint.fail(false);
    clock.now += 30_000;
    expect((await verifier.verify(a.token)).subject).toBe(SUBJECT);
    expect(endpoint.fetches()).toBe(4);
  });

  it("TC-RLM-005-213 while a revalidation is in flight, another request for the expired key answers unavailable at once", async () => {
    const a = await signingKeys("kid-a");
    const endpoint = jwksEndpoint();
    const clock = { now: 1_000 };
    const verifier = verifierOver(endpoint, clock);
    endpoint.serve(a.jwk);
    await verifier.verify(a.token);
    clock.now += 600_000;
    endpoint.holdNext();
    const initiator = verifier.verify(a.token).catch((error: unknown) => error);
    for (let i = 0; i < 1000 && endpoint.fetches() < 2; i += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(endpoint.fetches()).toBe(2);
    const during = await verifier.verify(a.token).catch((error: unknown) => error);
    expect(during).toBeInstanceOf(AuthFailure);
    expect((during as AuthFailure).kind).toBe("unavailable");
    endpoint.finish();
    expect(await initiator).toMatchObject({ subject: SUBJECT });
    expect(endpoint.fetches()).toBe(2);
  });

  it("TC-RLM-005-214 the default clock is monotonic: a wall clock that jumps does not change the 30 s interval or the 600 s lifetime", async () => {
    const pair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const jwk = {
      ...(await exportJWK(pair.publicKey)),
      kid: "kid-first",
      alg: "EdDSA",
      use: "sig",
    };
    const endpoint = jwksEndpoint();
    endpoint.serve(jwk);
    let monotonic = 5_000;
    vi.spyOn(performance, "now").mockImplementation(() => monotonic);
    let wall = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => wall);
    // No `now` option: the resolver reads the default clock.
    const resolver = createJwksKeyResolver({ jwksUrl: JWKS_URL, fetch: endpoint.fetcher });
    const lookup = (kid: string) =>
      resolver({ alg: "EdDSA", kid }, {
        payload: new Uint8Array(),
        signature: new Uint8Array(),
      } as never);
    await expect(lookup("kid-first")).resolves.toBeDefined();
    expect(endpoint.fetches()).toBe(1);
    // The wall clock jumps back an hour: still within the 30 s interval and the 600 s lifetime.
    wall -= 3_600_000;
    monotonic += 10_000;
    await expect(lookup("kid-unknown")).rejects.toMatchObject({ kind: "unavailable" });
    expect(endpoint.fetches()).toBe(1);
    // The wall clock jumps forward a day: the key does not expire early.
    wall += 86_400_000;
    monotonic += 10_000;
    await expect(lookup("kid-first")).resolves.toBeDefined();
    expect(endpoint.fetches()).toBe(1);
    // Only monotonic time moves the lifetime: 600 s after the load the key must be revalidated.
    monotonic += 580_001;
    await expect(lookup("kid-first")).resolves.toBeDefined();
    expect(endpoint.fetches()).toBe(2);
  });
});

describe("token structure check before signature verification (SEC-ABU-033 (a))", () => {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const future = () => Math.floor(Date.now() / 1000) + 600;
  const build = (
    header: unknown = { alg: "EdDSA", kid: "k1" },
    payload: unknown = { iss: ISSUER, exp: future() },
    signature = "c2ln",
  ) => `${b64(header)}.${b64(payload)}.${signature}`;
  const inspect = (authorization: string | undefined) =>
    inspectBearerToken(authorization, { issuer: ISSUER, algorithms: ["EdDSA"] });

  it("TC-RLM-005-215 a well-formed token passes the structure check without any signature work", () => {
    const token = build();
    expect(inspect(`Bearer ${token}`)).toEqual({ ok: true, token });
  });

  const violations: [string, string | undefined][] = [
    ["no header", undefined],
    ["not Bearer", `Basic ${build()}`],
    ["lowercase scheme", `bearer ${build()}`],
    ["two segments", `Bearer ${b64({ alg: "EdDSA", kid: "k" })}.${b64({ iss: ISSUER })}`],
    ["four segments", `Bearer ${build()}.extra`],
    ["not base64url", "Bearer a+b.c/d.e=f"],
    ["empty segment", `Bearer ${b64({ alg: "EdDSA", kid: "k" })}..c2ln`],
    ["header not JSON", `Bearer ${Buffer.from("nope").toString("base64url")}.${b64({})}.c2ln`],
    ["header is an array", `Bearer ${build([1])}`],
    ["alg not allowed", `Bearer ${build({ alg: "HS256", kid: "k1" })}`],
    ["alg none", `Bearer ${build({ alg: "none", kid: "k1" })}`],
    ["alg missing", `Bearer ${build({ kid: "k1" })}`],
    ["kid missing", `Bearer ${build({ alg: "EdDSA" })}`],
    ["kid empty", `Bearer ${build({ alg: "EdDSA", kid: "" })}`],
    ["kid not a string", `Bearer ${build({ alg: "EdDSA", kid: 5 })}`],
    ["iss differs", `Bearer ${build(undefined, { iss: `${ISSUER}/`, exp: future() })}`],
    ["iss missing", `Bearer ${build(undefined, { exp: future() })}`],
    ["exp missing", `Bearer ${build(undefined, { iss: ISSUER })}`],
    ["exp in the past", `Bearer ${build(undefined, { iss: ISSUER, exp: 1 })}`],
    ["exp not a number", `Bearer ${build(undefined, { iss: ISSUER, exp: "9999999999" })}`],
    [
      "over 4096 bytes",
      `Bearer ${build(undefined, { iss: ISSUER, exp: future(), pad: "x".repeat(MAX_TOKEN_BYTES) })}`,
    ],
  ];
  for (const [name, header] of violations)
    it(`TC-RLM-005-216 ${name} is a structure violation (no signature verification)`, () => {
      expect(inspect(header)).toEqual({ ok: false });
    });

  it("TC-RLM-005-217 the verifier built from the configuration exposes the same check with its issuer, and a structure violation never reaches key resolution", async () => {
    let resolved = 0;
    const verifier = createTokenVerifier(
      { issuer: ISSUER, audience: "api", jwksUrl: JWKS_URL },
      (async () => {
        resolved += 1;
        throw new AuthFailure("unauthenticated");
      }) as never,
    );
    expect(verifier.inspect?.(`Bearer ${build()}`).ok).toBe(true);
    expect(
      verifier.inspect?.(`Bearer ${build(undefined, { iss: "https://other", exp: future() })}`).ok,
    ).toBe(false);
    expect(resolved).toBe(0);
  });
});

describe("guard counter read in stage 1 (SEC-ABU-021 (1))", () => {
  it("TC-RLM-005-218 guardState only reads: it reports whether the IP's failures reached the limit and never records or refuses", async () => {
    const { limiter, store } = limiterOver(createMemoryStore(), {
      auth_failure_guard_attendee: { burst_limit: 2, sustained_limit: 50 },
    });
    expect(await limiter.guardState("purchase_checkout", "198.51.100.1")).toEqual({
      result: "ok",
      saturated: false,
    });
    const recordedTotal = () => store.keys().reduce((total, key) => total + store.count(key), 0);
    expect(recordedTotal()).toBe(0);
    expect((await limiter.recordAuthFailure("purchase_checkout", "198.51.100.1")).result).toBe(
      "allowed",
    );
    expect(await limiter.guardState("purchase_checkout", "198.51.100.1")).toMatchObject({
      saturated: false,
    });
    expect((await limiter.recordAuthFailure("purchase_checkout", "198.51.100.1")).result).toBe(
      "allowed",
    );
    const recorded = recordedTotal();
    for (let i = 0; i < 5; i += 1)
      expect(await limiter.guardState("purchase_checkout", "198.51.100.1")).toEqual({
        result: "ok",
        saturated: true,
      });
    expect(recordedTotal()).toBe(recorded);
    expect(store.calls.filter((call) => call.mode === "check").length).toBe(7);
    // Another IP and the other guard are unaffected.
    expect(await limiter.guardState("purchase_checkout", "198.51.100.2")).toMatchObject({
      saturated: false,
    });
    expect(await limiter.guardState("goods_handoff", "198.51.100.1")).toMatchObject({
      saturated: false,
    });
  });

  it("TC-RLM-005-219 a class without a guard makes no store call, and a store failure is store_unavailable", async () => {
    const { limiter, store } = limiterOver();
    expect(await limiter.guardState("public_read", "198.51.100.1")).toEqual({
      result: "ok",
      saturated: false,
    });
    expect(store.calls.length).toBe(0);
    const failing = createRateLimiter({
      store: {
        evaluate: async () => {
          throw new Error("down");
        },
        assertReady: async () => {},
        close: async () => {},
      },
      config: parseRateLimitConfig(ceilingConfigText()),
      hmacKey: TEST_HMAC_KEY,
      hmacKeyVersion: 1,
    });
    expect(await failing.guardState("purchase_checkout", "198.51.100.1")).toEqual({
      result: "store_unavailable",
    });
  });
});

describe("UUID canonical form for resource counters (SEC-ABU-015, SEC-ABU-029)", () => {
  const UPPER = "0D6A2A35-1A52-4D3A-8F55-42B5D4AD06A1";
  const LOWER = UPPER.toLowerCase();
  const MIXED = "0d6A2a35-1A52-4d3a-8F55-42b5D4ad06A1";

  it("TC-RLM-004-271 canonicalReference lowercases a UUID and leaves other values untouched", () => {
    expect(canonicalReference(UPPER)).toBe(LOWER);
    expect(canonicalReference(MIXED)).toBe(LOWER);
    expect(canonicalReference(LOWER)).toBe(LOWER);
    expect(canonicalReference("AbC123")).toBe("AbC123");
  });

  it("TC-RLM-004-272 upper, lower and mixed case spellings of one UUID consume the same counter key", async () => {
    const { limiter, store } = limiterOver(createMemoryStore(), {
      qr_display: {
        burst_limit: 6,
        sustained_limit: 30,
        additional: { "qr_display.ticket": { limit: 3, window_seconds: 60 } },
      },
    });
    const use = (value: string) =>
      limiter.resource({ classId: "qr_display", references: { ticket_ref: value } });
    expect((await use(UPPER)).result).toBe("allowed");
    expect((await use(LOWER)).result).toBe("allowed");
    expect((await use(MIXED)).result).toBe("allowed");
    expect(store.keys().length).toBe(1);
    expect((await use(UPPER)).result).toBe("rejected");
  });

  it("TC-RLM-004-273 a cart that repeats one UUID in different case counts it once", async () => {
    const { limiter, store } = limiterOver();
    const decision = await limiter.resource({
      classId: "purchase_checkout",
      references: { offering_ref: [UPPER, LOWER, MIXED] },
    });
    expect(decision.result).toBe("allowed");
    expect(store.keys().filter((key) => key.includes("purchase_checkout.resource")).length).toBe(1);
  });
});

describe("purchase start operations (SEC-ABU-029 pre-check)", () => {
  it("TC-RLM-004-274 exactly the four purchase start operations need the eligibility pre-check", () => {
    for (const id of [
      "API-PUR-CART-001",
      "API-PUR-ENTRY-001",
      "API-PUR-GDS-001",
      "API-PUR-KRK-001",
    ])
      expect(isPurchaseStartOperation(id)).toBe(true);
    for (const id of ["API-PUR-ELG-001", "API-CHK-001", "API-ORD-002", "API-STF-GDS-001"])
      expect(isPurchaseStartOperation(id)).toBe(false);
  });
});
