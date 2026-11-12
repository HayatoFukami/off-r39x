// Real Redis (TST-RLM-001 / 002 / 003). TEST_REDIS_URL is mandatory: a missing or unreachable Redis
// fails the file; there is no skip and no fake store here.
import { createHash, createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startReadinessProbe } from "../../apps/api/src/api/readiness-probe.ts";
import { createRedisRateLimitStore } from "../../packages/rate-limit-redis/src/index.ts";
import {
  createCounterKeyFactory,
  createRateLimiter,
  parseRateLimitConfig,
  RATE_LIMIT_CLASS_IDS,
  RATE_LIMIT_REGISTRY,
  type RateLimitObserver,
  type RateLimitStore,
  type StoreRule,
} from "../../packages/security/src/index.ts";
import {
  openRedisTestSession,
  type RedisTestSession,
  requireRedisTestUrl,
} from "../harness/rate-limit/redis.ts";

const hmacKey = new Uint8Array(32).fill(11);
let session: RedisTestSession;
const stores: RateLimitStore[] = [];
const store = (deadlineMs?: number, url = session.url): RateLimitStore => {
  const created = createRedisRateLimitStore({ url, ...(deadlineMs ? { deadlineMs } : {}) });
  stores.push(created);
  return created;
};
let sequence = 0;
const member = () => {
  sequence += 1;
  return `req-${Date.now()}-${sequence}`;
};
const rule = (name: string, limit: number, windowMs: number): StoreRule => ({
  key: `rl:v${session.keyVersion}:test:${name}`,
  limit,
  windowMs,
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function configText(overrides: Record<string, unknown> = {}): string {
  const config = Object.fromEntries(
    RATE_LIMIT_CLASS_IDS.map((id) => {
      const definition = RATE_LIMIT_REGISTRY[id];
      const extra = Object.entries(
        definition.additional as Record<string, { ceiling: number; windowSeconds: number }>,
      );
      return [
        id,
        {
          burst_limit: definition.burst,
          sustained_limit: definition.sustained,
          ...(extra.length
            ? {
                additional: Object.fromEntries(
                  extra.map(([ruleId, entry]) => [
                    ruleId,
                    { limit: entry.ceiling, window_seconds: entry.windowSeconds },
                  ]),
                ),
              }
            : {}),
        },
      ];
    }),
  );
  return JSON.stringify({ ...config, ...overrides });
}
const limiterFor = (
  overrides: Record<string, unknown>,
  target: RateLimitStore = store(),
  extra: { observer?: RateLimitObserver } = {},
) =>
  createRateLimiter({
    store: target,
    config: parseRateLimitConfig(configText(overrides)),
    hmacKey,
    hmacKeyVersion: session.keyVersion,
    ...extra,
  });

beforeAll(async () => {
  session = await openRedisTestSession();
});
afterAll(async () => {
  await Promise.all(stores.map((created) => created.close()));
  await session?.close();
});

describe("real Redis is mandatory (DEV-RLM-008)", () => {
  it("TC-RLM-001-001 an unset TEST_REDIS_URL fails instead of skipping, and the live Redis answers PONG", async () => {
    expect(() => requireRedisTestUrl({})).toThrow("TEST_REDIS_URL is required");
    expect(() => requireRedisTestUrl({ TEST_REDIS_URL: "" })).toThrow("TEST_REDIS_URL is required");
    expect(await session.redis.ping()).toBe("PONG");
    const [, major] = /redis_version:(\d+)/.exec(await session.redis.info("server")) ?? [];
    expect(Number(major)).toBeGreaterThanOrEqual(7);
  });

  it("TC-RLM-001-002 readiness executes the script on a live store and fails on an unreachable one", async () => {
    await expect(store().assertReady()).resolves.toBeUndefined();
    await expect(store(250, "redis://127.0.0.1:1").assertReady()).rejects.toThrow();
    // SPEC-180 INF-HLT-004: a flushed script cache is reloaded, still ready.
    await session.redis.script("FLUSH");
    await expect(store().assertReady()).resolves.toBeUndefined();
  });

  it("TC-RLM-001-003 readiness is a write: out of memory with noeviction it fails although reads still answer, and it recovers once the limit is lifted", async () => {
    const s = store();
    await expect(s.assertReady()).resolves.toBeUndefined();
    const policy = (await session.redis.config("GET", "maxmemory-policy")) as string[];
    await session.redis.config("SET", "maxmemory-policy", "noeviction");
    await session.redis.config("SET", "maxmemory", "1");
    try {
      // The read-only check of the previous design still passed here; the write refuses (OOM).
      await expect(s.assertReady()).rejects.toThrow();
      expect(await session.redis.ping()).toBe("PONG");
    } finally {
      await session.redis.config("SET", "maxmemory", "0");
      await session.redis.config("SET", "maxmemory-policy", policy[1] ?? "noeviction");
    }
    await expect(s.assertReady()).resolves.toBeUndefined();
  });

  it("TC-RLM-009-120 the store probe and the limiter readiness record and report 0 while the store is out of memory with noeviction, and 1 again after the limit is lifted", async () => {
    const limiter = limiterFor({});
    const samples: boolean[] = [];
    const policy = (await session.redis.config("GET", "maxmemory-policy")) as string[];
    await session.redis.config("SET", "maxmemory-policy", "noeviction");
    await session.redis.config("SET", "maxmemory", "1");
    // The timer is driven by the test; the first sample starts immediately, as in bootstrap.
    const probe = startReadinessProbe({
      check: async () => {
        const storeReady = await limiter.assertReady().then(
          () => true,
          () => false,
        );
        return { ready: storeReady, storeReady };
      },
      metrics: { storeReady: (ready: boolean) => samples.push(ready) },
      setTimer: () => undefined,
      clearTimer: () => undefined,
    });
    try {
      await probe.probeNow();
      expect(samples).toEqual([false]);
      await expect(limiter.assertReady()).rejects.toThrow();
    } finally {
      await session.redis.config("SET", "maxmemory", "0");
      await session.redis.config("SET", "maxmemory-policy", policy[1] ?? "noeviction");
    }
    await probe.probeNow();
    expect(samples).toEqual([false, true]);
    await expect(limiter.assertReady()).resolves.toBeUndefined();
    probe.stop();
  });
});

describe("sliding window log on Redis (TST-RLM-002)", () => {
  it("TC-RLM-002-001 the limit is admitted exactly, +1 is rejected, and an old entry frees exactly one slot", async () => {
    const s = store();
    const window = [rule("exact", 3, 1500)];
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await s.evaluate("admit", window, member()));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]?.rules[0]?.exceeded).toBe(true);
    await sleep(1700);
    expect((await s.evaluate("admit", window, member())).allowed).toBe(true);
  });

  it("TC-RLM-002-002 a placement a fixed window would double-admit never exceeds the limit in any window", async () => {
    const s = store();
    const window = [rule("boundary", 4, 1000)];
    const admitted: number[] = [];
    const attempt = async () => {
      const outcome = await s.evaluate("admit", window, member());
      if (outcome.allowed) admitted.push(Date.now());
      return outcome.allowed;
    };
    expect([await attempt(), await attempt()]).toEqual([true, true]);
    await sleep(600);
    expect([await attempt(), await attempt()]).toEqual([true, true]);
    // Four admitted within 1 s: the fifth is refused although a fixed window boundary may have passed.
    expect(await attempt()).toBe(false);
    await sleep(500); // t = 1.1 s: the first two left the window, the last two are inside it.
    expect([await attempt(), await attempt()]).toEqual([true, true]);
    expect(await attempt()).toBe(false);
    // Any 1000 ms span of the admission log holds at most 4 entries (client-side check).
    for (const start of admitted)
      expect(admitted.filter((t) => t >= start && t < start + 1000).length).toBeLessThanOrEqual(4);
  });

  it("TC-RLM-002-003 burst and sustained are both evaluated: either one alone rejects", async () => {
    const s = store();
    const burst = rule("two-windows-burst", 2, 1000);
    const sustained = rule("two-windows-sustained", 3, 3000);
    const outcomes = [];
    for (let i = 0; i < 3; i += 1)
      outcomes.push(await s.evaluate("admit", [burst, sustained], member()));
    expect(outcomes.map((o) => o.allowed)).toEqual([true, true, false]);
    expect(outcomes[2]?.rules.map((r) => r.exceeded)).toEqual([true, false]); // burst only
    await sleep(1100); // burst window empty again, sustained holds 2
    expect((await s.evaluate("admit", [burst, sustained], member())).allowed).toBe(true);
    const sustainedOnly = await s.evaluate("admit", [burst, sustained], member());
    expect(sustainedOnly.allowed).toBe(false);
    expect(sustainedOnly.rules.map((r) => r.exceeded)).toEqual([false, true]);
    expect(sustainedOnly.rules[1]?.retryAfterMs).toBeGreaterThan(0);
  });

  it("TC-RLM-002-004 one exceeded rule leaves every counter unchanged (a rejection consumes nothing)", async () => {
    const s = store();
    const tight = rule("atomic-tight", 1, 5000);
    const roomy = rule("atomic-roomy", 100, 5000);
    expect((await s.evaluate("admit", [tight, roomy], member())).allowed).toBe(true);
    for (let i = 0; i < 5; i += 1)
      expect((await s.evaluate("admit", [roomy, tight], member())).allowed).toBe(false);
    expect(await session.redis.zcard(tight.key)).toBe(1);
    expect(await session.redis.zcard(roomy.key)).toBe(1);
    // check never records; record always does (guard).
    await s.evaluate("check", [roomy], member());
    expect(await session.redis.zcard(roomy.key)).toBe(1);
    expect((await s.evaluate("record", [tight], member())).allowed).toBe(true);
    expect(await session.redis.zcard(tight.key)).toBe(2);
    expect((await s.evaluate("check", [tight], member())).allowed).toBe(false);
  });

  it("TC-RLM-002-005 concurrent evaluations from several API processes never admit more than the limit", async () => {
    const processes = [store(), store(), store(), store()];
    const window = [rule("concurrent", 10, 5000), rule("concurrent-second", 10, 5000)];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const attempts = Array.from({ length: 80 }, async (_, i) => {
      await gate;
      return (processes[i % processes.length] as RateLimitStore).evaluate(
        "admit",
        window,
        member(),
      );
    });
    release();
    const outcomes = await Promise.all(attempts);
    expect(outcomes.filter((o) => o.allowed)).toHaveLength(10);
    expect(await session.redis.zcard(window[0]?.key as string)).toBe(10);
    expect(await session.redis.zcard(window[1]?.key as string)).toBe(10);
  });

  it("TC-RLM-002-006 the window is decided by the store clock, whatever the API process clock says", async () => {
    const s = store();
    const window = [rule("store-clock", 2, 60_000)];
    const realNow = Date.now.bind(Date);
    try {
      expect((await s.evaluate("admit", window, member())).allowed).toBe(true);
      Date.now = () => realNow() + 86_400_000; // API process clock a day ahead
      expect((await s.evaluate("admit", window, member())).allowed).toBe(true);
      Date.now = () => realNow() - 86_400_000; // and a day behind
      expect((await s.evaluate("admit", window, member())).allowed).toBe(false);
    } finally {
      Date.now = realNow;
    }
    const [seconds = 0, micros = 0] = (await session.redis.time()).map(Number);
    const storeNow = seconds * 1000 + Math.floor(micros / 1000);
    const scores = (
      await session.redis.zrange(window[0]?.key as string, 0, -1, "WITHSCORES")
    ).filter((_, i) => i % 2 === 1);
    expect(scores).toHaveLength(2);
    for (const score of scores) expect(Math.abs(storeNow - Number(score))).toBeLessThan(5000);
  });

  it("TC-RLM-002-007 Retry-After is an integer second count, rounded up, minimum 1, the longest of all exceeded rules", async () => {
    const limiter = limiterFor({
      public_read: {
        burst_limit: 1,
        sustained_limit: 1,
        additional: { "public_read.global": { limit: 5, window_seconds: 60 } },
      },
    });
    const send = (ip: string) => limiter.preAuth({ classId: "public_read", ip });
    expect((await send("198.51.100.1")).result).toBe("allowed");
    const second = await send("198.51.100.1");
    expect(second.result).toBe("rejected");
    if (second.result === "rejected") {
      // burst (10 s) and sustained (60 s) are exceeded; the longest wins: 59.9x s -> 60.
      expect(Number.isInteger(second.retryAfterSeconds)).toBe(true);
      expect(second.retryAfterSeconds).toBeGreaterThanOrEqual(59);
      expect(second.retryAfterSeconds).toBeLessThanOrEqual(60);
      expect(second.ruleCategory).toBe("burst");
    }
    const s = store();
    const short = [rule("retry-short", 1, 1200)];
    await s.evaluate("admit", short, member());
    const refused = await s.evaluate("admit", short, member());
    expect(refused.rules[0]?.retryAfterMs).toBeGreaterThan(0);
    expect(refused.rules[0]?.retryAfterMs).toBeLessThanOrEqual(1200);
  });

  it("TC-RLM-002-008 every counter key has a TTL covering its window, and no key lacks one", async () => {
    const limiter = limiterFor({});
    for (const classId of ["public_read", "stripe_webhook"] as const)
      await limiter.preAuth({ classId, ip: "198.51.100.2" });
    await limiter.subject({ classId: "high_risk_recovery", subject: "subject-ttl" });
    await limiter.resource({
      classId: "high_risk_recovery",
      values: {
        "high_risk_recovery.resource_minute": "target-ttl",
        "high_risk_recovery.resource_hour": "target-ttl",
      },
    });
    await limiter.recordAuthFailure("admin_mutation", "198.51.100.2");
    const keys = await session.keys();
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const key of keys) {
      const ttl = await session.redis.pttl(key);
      expect(ttl, key).toBeGreaterThan(0);
      expect(await session.redis.type(key)).toBe("zset");
    }
    const hour = keys.find((key) => key.includes("high_risk_recovery.resource_hour"));
    expect(hour).toBeDefined();
    expect(await session.redis.pttl(hour as string)).toBeGreaterThan(3_000_000);
    const burst = keys.find((key) => key.includes("public_read.burst"));
    expect(await session.redis.pttl(burst as string)).toBeLessThanOrEqual(11_000);
    expect(await session.redis.pttl(burst as string)).toBeGreaterThan(9_000);
  });

  it("TC-RLM-002-009 keys carry only HMAC-SHA256 digests: no raw IP, Email, Subject, QR or token; version and value change the key", async () => {
    const raw = {
      ip: "203.0.113.77",
      email: "someone@example.com",
      subject: "11111111-2222-4333-8444-555555555555",
      qr: "qr-raw-token-value",
      resource: "ticket-public-ref-001",
    };
    const limiter = limiterFor({});
    await limiter.preAuth({ classId: "public_read", ip: raw.ip });
    await limiter.preAuth({ classId: "auth_form_proxy", ip: raw.ip });
    await limiter.loginIdentifier({
      classId: "auth_form_proxy",
      ip: raw.ip,
      loginIdentifier: raw.email,
    });
    await limiter.subject({ classId: "qr_display", subject: raw.subject });
    await limiter.resource({
      classId: "qr_display",
      values: { "qr_display.ticket": raw.resource },
    });
    await limiter.resource({
      classId: "staff_checkin",
      values: { "staff_checkin.qr_digest": raw.qr },
    });
    const keys = await session.keys();
    expect(keys.length).toBeGreaterThanOrEqual(8);
    const dump = JSON.stringify([
      keys,
      ...(await Promise.all(keys.map((key) => session.redis.zrange(key, 0, -1, "WITHSCORES")))),
    ]);
    for (const value of Object.values(raw)) expect(dump).not.toContain(value);
    // Independently recomputed HMAC-SHA256 equals the stored key; the plain hash does not.
    const expected = `rl:v${session.keyVersion}:public_read.burst:${createHmac("sha256", hmacKey)
      .update("r39x/rate-limit/v1\0public_read.burst\0ip\0", "utf8")
      .update(raw.ip, "utf8")
      .digest("hex")}`;
    expect(keys).toContain(expected);
    const plain = createHash("sha256").update(raw.ip).digest("hex");
    expect(keys.some((key) => key.endsWith(plain))).toBe(false);
    // Same identifier => same key; different identifier => different key; version changes the key.
    const factory = createCounterKeyFactory(hmacKey, session.keyVersion);
    expect(factory.key("public_read.burst", "ip", raw.ip)).toBe(expected);
    expect(factory.key("public_read.burst", "ip", "203.0.113.78")).not.toBe(expected);
    expect(
      createCounterKeyFactory(hmacKey, session.keyVersion + 1).key(
        "public_read.burst",
        "ip",
        raw.ip,
      ),
    ).not.toBe(expected);
  });
});

describe("store failure on real Redis (TST-RLM-003)", () => {
  const unavailableLimiter = (observer?: RateLimitObserver) =>
    limiterFor({}, store(250, "redis://127.0.0.1:1"), observer ? { observer } : {});

  it("TC-RLM-003-001 an unreachable Redis is store_unavailable and the circuit stops further store attempts", async () => {
    const operations: string[] = [];
    const limiter = unavailableLimiter({
      decision: () => {},
      storeOperation: (event) => operations.push(event.result),
    });
    const started = Date.now();
    for (let i = 0; i < 6; i += 1)
      expect(await limiter.preAuth({ classId: "public_read", ip: "198.51.100.3" })).toEqual({
        result: "store_unavailable",
      });
    expect(Date.now() - started).toBeLessThan(5000);
    // Three attempts reached the store; the remaining ones were short-circuited (REL-SEC-005).
    expect(operations).toHaveLength(3);
    expect(operations.every((result) => result === "error" || result === "timeout")).toBe(true);
  });

  it("TC-RLM-003-002 a store that answers after the 250 ms deadline is unavailable and is never re-evaluated", async () => {
    const s = store();
    const limiter = limiterFor({}, s);
    const target = rule("timeout", 10, 5000);
    await session.redis.call("CLIENT", "PAUSE", "700", "ALL");
    const started = Date.now();
    const decision = await limiter.preAuth({ classId: "public_read", ip: "198.51.100.4" });
    const elapsed = Date.now() - started;
    expect(decision).toEqual({ result: "store_unavailable" });
    expect(elapsed).toBeGreaterThanOrEqual(200);
    expect(elapsed).toBeLessThan(650);
    await sleep(900);
    // The late execution may have recorded the request once; it was never recorded twice.
    const burstKey = createCounterKeyFactory(hmacKey, session.keyVersion).key(
      "public_read.burst",
      "ip",
      "198.51.100.4",
    );
    expect(await session.redis.zcard(burstKey)).toBeLessThanOrEqual(1);
    await expect(s.evaluate("admit", [target], member())).resolves.toMatchObject({ allowed: true });
  });

  it("TC-RLM-003-003 maxmemory with noeviction refuses the write: store_unavailable, nothing partially recorded, reads still work", async () => {
    const limiter = limiterFor({});
    const policy = (await session.redis.config("GET", "maxmemory-policy")) as string[];
    const globalBefore = await session.redis.zcard(
      createCounterKeyFactory(hmacKey, session.keyVersion).key("public_read.global", "global", ""),
    );
    await session.redis.config("SET", "maxmemory-policy", "noeviction");
    await session.redis.config("SET", "maxmemory", "1");
    try {
      const decision = await limiter.preAuth({ classId: "public_read", ip: "198.51.100.5" });
      expect(decision).toEqual({ result: "store_unavailable" });
      // A request that only reads (guard confirmation) is still answered correctly.
      const guard = await limiter.preAuth({ classId: "purchase_checkout", ip: "198.51.100.5" });
      expect(guard.result).toBe("allowed");
    } finally {
      await session.redis.config("SET", "maxmemory", "0");
      await session.redis.config("SET", "maxmemory-policy", policy[1] ?? "noeviction");
    }
    const factory = createCounterKeyFactory(hmacKey, session.keyVersion);
    for (const name of ["public_read.burst", "public_read.sustained"])
      expect(await session.redis.exists(factory.key(name, "ip", "198.51.100.5")), name).toBe(0);
    // The shared global counter did not move either.
    expect(await session.redis.zcard(factory.key("public_read.global", "global", ""))).toBe(
      globalBefore,
    );
    expect((await limiter.preAuth({ classId: "public_read", ip: "198.51.100.5" })).result).toBe(
      "allowed",
    );
  });

  it("TC-RLM-003-008 at the maxmemory boundary an evaluation is applied to every rule or to none, wherever the boundary falls", async () => {
    const s = store();
    const rules = ["a", "b", "c"].map((name) => rule(`boundary-${name}`, 1_000_000, 600_000));
    const policy = (await session.redis.config("GET", "maxmemory-policy")) as string[];
    // Warm up: connect and load the script first, so only counter growth moves the memory figure.
    expect((await s.evaluate("admit", rules, member())).allowed).toBe(true);
    let admitted = 1;
    const used = Number(
      /^used_memory:([0-9]+)/m.exec(await session.redis.info("memory"))?.[1] ?? Number.NaN,
    );
    expect(Number.isFinite(used)).toBe(true);
    let refused = 0;
    await session.redis.config("SET", "maxmemory-policy", "noeviction");
    // Close enough that a few evaluations cross it, far enough that the first ones are admitted.
    await session.redis.config("SET", "maxmemory", String(used + 65_536));
    try {
      for (let i = 0; i < 20_000 && refused < 5; i += 1) {
        try {
          expect((await s.evaluate("admit", rules, member())).allowed).toBe(true);
          admitted += 1;
        } catch {
          refused += 1;
        }
      }
    } finally {
      await session.redis.config("SET", "maxmemory", "0");
      await session.redis.config("SET", "maxmemory-policy", policy[1] ?? "noeviction");
    }
    // The boundary was really reached, and some evaluations passed before it.
    expect(refused).toBeGreaterThan(0);
    expect(admitted).toBeGreaterThan(0);
    // Every admitted evaluation wrote to all three counters and no refused one wrote to any.
    for (const r of rules) expect(await session.redis.zcard(r.key), r.key).toBe(admitted);
    // With the limit lifted the store works again.
    expect((await s.evaluate("admit", rules, member())).allowed).toBe(true);
  });

  it("TC-RLM-003-004 a script execution error is store_unavailable (not allowed, not rejected)", async () => {
    const s = store();
    await expect(s.evaluate("admit", [rule("invalid", 0, 1000)], member())).rejects.toMatchObject({
      name: "RateLimitStoreError",
    });
    await expect(s.evaluate("admit", [rule("invalid", 1, 0)], member())).rejects.toMatchObject({
      name: "RateLimitStoreError",
    });
    await expect(
      s.evaluate("nonsense" as never, [rule("invalid", 1, 1000)], member()),
    ).rejects.toMatchObject({ name: "RateLimitStoreError" });
    // Errors carry no connection string, key or script text.
    const error = await s
      .evaluate("admit", [rule("invalid", 0, 1000)], member())
      .catch((caught: unknown) => caught);
    expect(String(error)).not.toContain(session.url);
    expect(String(error)).not.toContain("rl:v");
  });

  it("TC-RLM-003-005 a lost script cache (store restart) is reloaded transparently and the request is counted exactly once", async () => {
    const s = store();
    const target = rule("noscript", 5, 5000);
    await s.evaluate("admit", [target], member());
    await session.redis.script("FLUSH");
    const outcome = await s.evaluate("admit", [target], member());
    expect(outcome.allowed).toBe(true);
    expect(await session.redis.zcard(target.key)).toBe(2);
  });

  it("TC-RLM-003-006 the connection is not replayed after a drop: a request is never counted twice", async () => {
    const s = store();
    const target = rule("no-replay", 1000, 5000);
    await s.evaluate("admit", [target], member());
    // Kill every other client connection (SKIPME keeps the inspection connection).
    await session.redis.call("CLIENT", "KILL", "TYPE", "normal", "SKIPME", "yes");
    await sleep(50);
    // The store reconnects on its own and keeps counting one per request.
    let admitted = 0;
    for (let i = 0; i < 20 && admitted < 5; i += 1) {
      try {
        if ((await s.evaluate("admit", [target], member())).allowed) admitted += 1;
      } catch {
        await sleep(100);
      }
    }
    expect(admitted).toBe(5);
    expect(await session.redis.zcard(target.key)).toBe(6);
  });
});
