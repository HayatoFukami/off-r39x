// SPEC-140 SEC-API-032 / SEC-ABU-020..021, SPEC-150 REL-AUTH-002, SPEC-180 INF-HLT-005 (sixth
// PR #41 review): operation class move, IP canonical form, JWKS refresh control and the readiness
// snapshot probe.
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { startReadinessProbe } from "../../apps/api/src/api/readiness-probe.ts";
import {
  AuthFailure,
  createJwksKeyResolver,
  createTokenVerifier,
} from "../../packages/auth/src/index.ts";
import {
  deriveClientIp,
  normalizeIp,
  rateLimitClassOf,
} from "../../packages/security/src/index.ts";

describe("operation class of read-only Goods preview (API-RLC-005)", () => {
  it("TC-RLM-007-202 API-STF-GDS-002 is a self_read operation and no longer shares the goods_handoff counter", () => {
    expect(rateLimitClassOf("API-STF-GDS-002")).toBe("self_read");
    expect(rateLimitClassOf("API-STF-GDS-001")).toBe("goods_handoff");
  });
});

describe("Client IP canonical form for counter keys (SEC-API-032)", () => {
  it("TC-RLM-008-003 IPv6 addresses in one /64 are one IP; another /64 is another IP; IPv4-mapped IPv6 is its IPv4", () => {
    expect(normalizeIp("2001:db8:1:2::1")).toBe(normalizeIp("2001:db8:1:2:ffff:0:0:5"));
    expect(normalizeIp("2001:db8:1:2::1")).not.toBe(normalizeIp("2001:db8:1:3::1"));
    expect(normalizeIp("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(normalizeIp("198.51.100.7")).toBe("198.51.100.7");
  });

  it("TC-RLM-008-004 the derived Client IP from a forwarded header is the /64 form, so rotating addresses inside one /64 cannot evade a per-IP rule", () => {
    // One trusted proxy appended the client's address: that entry is the Client IP.
    const first = deriveClientIp({
      peer: "10.0.0.1",
      forwarded: "2001:db8:aaaa:bbbb::1",
      trustedProxyHops: 1,
    });
    const second = deriveClientIp({
      peer: "10.0.0.1",
      forwarded: "2001:db8:aaaa:bbbb:1234::99",
      trustedProxyHops: 1,
    });
    expect(first).toBe(second);
    expect(first).toBe("2001:db8:aaaa:bbbb::");
  });
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

describe("readiness snapshot probe (SPEC-180 INF-HLT-005, SPEC-140 SEC-ABU-018)", () => {
  function manualTimer() {
    const callbacks: Array<() => void> = [];
    return {
      setTimer: (run: () => void) => {
        callbacks.push(run);
        return callbacks.length;
      },
      clearTimer: () => {},
      tick: () => {
        for (const run of callbacks) run();
      },
    };
  }

  it("TC-RLM-009-203 not ready before the first probe completes, ready after a success, not ready after a failure", async () => {
    let result = { ready: false, storeReady: false };
    const timer = manualTimer();
    const probe = startReadinessProbe({
      check: async () => result,
      metrics: { storeReady: () => {} },
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      now: () => 1,
    });
    expect(probe.isReady()).toBe(false);
    await probe.probeNow();
    expect(probe.isReady()).toBe(false);
    result = { ready: true, storeReady: true };
    await probe.probeNow();
    expect(probe.isReady()).toBe(true);
    result = { ready: false, storeReady: true };
    await probe.probeNow();
    expect(probe.isReady()).toBe(false);
    probe.stop();
  });

  it("TC-RLM-009-204 reading the state never runs a check, and probes do not overlap: a slow check is not stacked by the interval", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const timer = manualTimer();
    const probe = startReadinessProbe({
      check: () =>
        new Promise((resolve) => {
          calls += 1;
          release = () => resolve({ ready: true, storeReady: true });
        }),
      metrics: { storeReady: () => {} },
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      now: () => 1,
    });
    expect(calls).toBe(1);
    for (let i = 0; i < 50; i += 1) {
      expect(probe.isReady()).toBe(false);
      timer.tick();
    }
    expect(calls).toBe(1);
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 50; i += 1) probe.isReady();
    expect(calls).toBe(1);
    probe.stop();
  });

  it("TC-RLM-009-205 a probe that stopped completing is not ready after 90 s; the store gauge comes from the same run as the readiness state", async () => {
    let now = 1_000;
    const gauge: boolean[] = [];
    const timer = manualTimer();
    const probe = startReadinessProbe({
      check: async () => ({ ready: true, storeReady: false }),
      metrics: { storeReady: (value: boolean) => gauge.push(value) },
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      now: () => now,
    });
    await probe.probeNow();
    expect(probe.isReady()).toBe(true);
    expect(gauge).toEqual([false]);
    now += 90_000;
    expect(probe.isReady()).toBe(true);
    now += 1;
    expect(probe.isReady()).toBe(false);
    await probe.probeNow();
    expect(probe.isReady()).toBe(true);
    probe.stop();
  });
});
