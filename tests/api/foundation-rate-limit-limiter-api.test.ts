import { describe, expect, it } from "vitest";
import {
  createCounterKeyFactory,
  createRateLimiter,
  parseRateLimitConfig,
  RATE_LIMIT_REGISTRY,
  type RateLimiterOptions,
  type RouteClassId,
} from "../../packages/security/src/index.ts";
import { ceilingConfigText } from "../harness/rate-limit/api.ts";
import { withFault } from "../harness/rate-limit/faults.ts";
import { createMemoryStore } from "../harness/rate-limit/memory-store.ts";

const hmacKey = new Uint8Array(32).fill(5);
const IP = "203.0.113.5";
const SUBJECT = "aef69f82-c9b7-4fd1-9a6f-126f5748e9ae";
const keyFactory = createCounterKeyFactory(hmacKey, 1);
const ipKey = (ruleId: string, ip: string) => keyFactory.key(ruleId, "ip", ip);
// API-RLC-007: the key input is (reference kind NUL canonical reference) under the class rule; no Operation ID.
const resourceKey = (ruleId: string, kind: string, value: string) =>
  keyFactory.key(ruleId, "resource", `${kind}\0${value}`);

function build(extra: Partial<RateLimiterOptions> = {}, overrides: Record<string, unknown> = {}) {
  const store = createMemoryStore();
  const limiter = createRateLimiter({
    store,
    config: parseRateLimitConfig(ceilingConfigText(overrides)),
    hmacKey,
    hmacKeyVersion: 1,
    ...extra,
  });
  return { store, limiter };
}
const rulesOf = (calls: ReturnType<typeof createMemoryStore>["calls"]) =>
  calls.map((call) => ({
    mode: call.mode,
    rules: call.rules.map((rule) => [rule.limit, rule.windowMs / 1000]),
  }));

describe("rule planning per stage (SEC-ABU-017, §68)", () => {
  it("TC-RLM-004-102 each class evaluates exactly its SPEC-140 §68 rules in the specified stage (Webhook global after the signature, resource rules in Stage 3)", async () => {
    type Plan = {
      pre?: number[][];
      /** Stage 2 after a successful Webhook signature verification (SEC-ABU-030). */
      webhook?: number[][];
      guard?: boolean;
      subject?: number[][];
      resource?: { references: Record<string, string>; rules: number[][] };
    };
    const burstSustained = (id: RouteClassId) => [
      [RATE_LIMIT_REGISTRY[id].burst, 10],
      [RATE_LIMIT_REGISTRY[id].sustained, 60],
    ];
    const plans: Record<RouteClassId, Plan> = {
      public_read: { pre: [...burstSustained("public_read"), [10000, 60]] },
      // The identifier rule is stage 1b (SEC-ABU-024), tested separately below.
      auth_form_proxy: { pre: burstSustained("auth_form_proxy") },
      auth_session: { pre: burstSustained("auth_session") },
      auth_callback: { pre: burstSustained("auth_callback") },
      self_read: { pre: [[240, 60]], subject: burstSustained("self_read") },
      purchase_checkout: {
        guard: true,
        subject: burstSustained("purchase_checkout"),
        resource: { references: { offering_ref: "offering" }, rules: [[60, 60]] },
      },
      qr_display: {
        guard: true,
        subject: burstSustained("qr_display"),
        resource: { references: { ticket_ref: "ticket" }, rules: [[12, 60]] },
      },
      profile_mutation: { guard: true, subject: burstSustained("profile_mutation") },
      staff_checkin: {
        pre: [[300, 60]],
        subject: burstSustained("staff_checkin"),
        resource: { references: { qr_digest: "digest" }, rules: [[30, 60]] },
      },
      goods_handoff: {
        guard: true,
        subject: burstSustained("goods_handoff"),
        resource: { references: { goods_item_ref: "item" }, rules: [[10, 60]] },
      },
      admin_mutation: {
        guard: true,
        subject: burstSustained("admin_mutation"),
        resource: { references: { faq_ref: "target" }, rules: [[15, 60]] },
      },
      role_assignment: {
        guard: true,
        subject: burstSustained("role_assignment"),
        resource: { references: { target_profile_ref: "profile" }, rules: [[5, 600]] },
      },
      high_risk_recovery: {
        guard: true,
        subject: burstSustained("high_risk_recovery"),
        resource: {
          references: { order_ref: "target" },
          rules: [
            [2, 60],
            [10, 3600],
          ],
        },
      },
      stripe_webhook: { pre: burstSustained("stripe_webhook"), webhook: [[3000, 60]] },
      resend_webhook: { pre: burstSustained("resend_webhook"), webhook: [[3000, 60]] },
    };
    for (const [classId, plan] of Object.entries(plans) as [RouteClassId, Plan][]) {
      const { store, limiter } = build();
      await limiter.preAuth({ classId, ip: IP });
      // Stage 1 never consults the guard (SEC-ABU-021 (1)); the identifier rule is stage 1b.
      const expectedPre = [...(plan.pre ? [{ mode: "admit", rules: plan.pre }] : [])];
      expect(rulesOf(store.calls), `${classId} stage 1`).toEqual(expectedPre);
      store.calls.length = 0;
      await limiter.subject({ classId, subject: SUBJECT });
      expect(rulesOf(store.calls), `${classId} subject`).toEqual(
        plan.subject ? [{ mode: "admit", rules: plan.subject }] : [],
      );
      store.calls.length = 0;
      await limiter.webhookVerified({ classId });
      expect(rulesOf(store.calls), `${classId} verified Webhook`).toEqual(
        plan.webhook ? [{ mode: "admit", rules: plan.webhook }] : [],
      );
      store.calls.length = 0;
      if (plan.resource) {
        await limiter.resource({ classId, references: plan.resource.references });
        expect(rulesOf(store.calls), `${classId} stage 3`).toEqual([
          { mode: "admit", rules: plan.resource.rules },
        ]);
      }
    }
  });

  it("TC-RLM-004-103 an unmatched path or unsupported method evaluates only the public_read per-IP burst/sustained (no global)", async () => {
    const { store, limiter } = build();
    expect((await limiter.unmatched(IP)).result).toBe("allowed");
    expect(rulesOf(store.calls)).toEqual([
      {
        mode: "admit",
        rules: [
          [20, 10],
          [120, 60],
        ],
      },
    ]);
  });

  it("TC-RLM-004-104 a missing resource key is a programming error and never skips the rule", async () => {
    const { store, limiter } = build();
    await expect(limiter.resource({ classId: "qr_display", references: {} })).rejects.toThrow();
    expect(store.calls).toHaveLength(0);
  });

  it("TC-RLM-004-105 the effective limits come from RATE_LIMIT_CONFIG, not from the ceilings", async () => {
    const { store, limiter } = build(
      {},
      {
        public_read: {
          burst_limit: 2,
          sustained_limit: 3,
          additional: { "public_read.global": { limit: 4, window_seconds: 60 } },
        },
      },
    );
    await limiter.preAuth({ classId: "public_read", ip: IP });
    expect(rulesOf(store.calls)[0]?.rules).toEqual([
      [2, 10],
      [3, 60],
      [4, 60],
    ]);
  });
});

describe("Authentication-failure guard (SEC-ABU-020 / 021 / 022)", () => {
  const guards = {
    auth_failure_guard_attendee: { burst_limit: 2, sustained_limit: 5 },
    auth_failure_guard_operator: { burst_limit: 3, sustained_limit: 5 },
  };
  it("TC-RLM-005-102 the guard is never consulted before verification; a failure is one atomic evaluation: within the limit it is recorded, the limit+1 failure is a 429 and is not recorded; per IP, independent classes", async () => {
    const { store, limiter } = build({}, guards);
    const attendee = () => limiter.preAuth({ classId: "purchase_checkout", ip: IP });
    // Stage 1 neither confirms nor records the guard (SEC-ABU-021 (1)): valid-token requests pass.
    for (let i = 0; i < 10; i += 1) expect((await attendee()).result).toBe("allowed");
    expect(store.calls.some((call) => call.rules.some((rule) => rule.key.includes("guard")))).toBe(
      false,
    );
    // Two attendee failures are recorded (burst limit 2); the third is refused and not recorded.
    expect((await limiter.recordAuthFailure("purchase_checkout", IP)).result).toBe("allowed");
    expect((await limiter.recordAuthFailure("qr_display", IP)).result).toBe("allowed");
    expect(await limiter.recordAuthFailure("purchase_checkout", IP)).toMatchObject({
      result: "rejected",
      ruleCategory: "guard",
    });
    expect(store.count(ipKey("auth_failure_guard_attendee.burst", IP))).toBe(2);
    // A valid-token request is not refused by the guard state (SEC-ABU-021 (3)).
    expect((await attendee()).result).toBe("allowed");
    // The operator guard is a separate counter with its own limit.
    expect((await limiter.recordAuthFailure("admin_mutation", IP)).result).toBe("allowed");
    // Another IP is not affected.
    expect((await limiter.recordAuthFailure("purchase_checkout", "203.0.113.6")).result).toBe(
      "allowed",
    );
    // Classes without a guard (SEC-ABU-023) are not recorded at all.
    expect((await limiter.recordAuthFailure("self_read", IP)).result).toBe("allowed");
    expect((await limiter.recordAuthFailure("public_read", IP)).result).toBe("allowed");
  });

  it("TC-RLM-005-104 concurrent failures never overrun the guard: a parallel burst records exactly the limit and every other failure is a 429", async () => {
    const { store, limiter } = build({}, guards);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => limiter.recordAuthFailure("profile_mutation", IP)),
    );
    expect(results.filter((r) => r.result === "allowed")).toHaveLength(2);
    expect(results.filter((r) => r.result === "rejected")).toHaveLength(18);
    expect(store.count(ipKey("auth_failure_guard_attendee.burst", IP))).toBe(2);
  });

  it("TC-RLM-005-103 a guard record that cannot be stored is reported as store_unavailable, never skipped", async () => {
    const store = withFault(createMemoryStore());
    const limiter = createRateLimiter({
      store,
      config: parseRateLimitConfig(ceilingConfigText()),
      hmacKey,
      hmacKeyVersion: 1,
    });
    store.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
    expect((await limiter.recordAuthFailure("purchase_checkout", IP)).result).toBe(
      "store_unavailable",
    );
  });
});

describe("login identifier rule, stage 1b (SEC-ABU-024)", () => {
  const identifierConfig = {
    auth_form_proxy: {
      burst_limit: 10,
      sustained_limit: 40,
      additional: { "auth_form_proxy.identifier": { limit: 5, window_seconds: 600 } },
    },
  };
  it("TC-RLM-004-257 the identifier counter is keyed by the (source IP, identifier) pair: one IP is limited for its own pairs only, and pairs that differ only in where the IP ends are different keys", async () => {
    const { store, limiter } = build({}, identifierConfig);
    const pair = (ip: string, email: string) =>
      limiter.loginIdentifier({ classId: "auth_form_proxy", ip, loginIdentifier: email });
    for (let i = 0; i < 5; i += 1)
      expect((await pair(IP, "a@example.test")).result).toBe("allowed");
    expect(await pair(IP, "a@example.test")).toMatchObject({
      result: "rejected",
      ruleCategory: "resource",
    });
    // Another IP with the same identifier (the victim's own IP) and another identifier from the
    // attacker's IP are not affected.
    expect((await pair("203.0.113.6", "a@example.test")).result).toBe("allowed");
    expect((await pair(IP, "b@example.test")).result).toBe("allowed");
    // Without a length prefix "10.0.0.1" + "0x" and "10.0.0.10" + "x" would share one digest input.
    expect((await pair("10.0.0.1", "0x")).result).toBe("allowed");
    expect((await pair("10.0.0.10", "x")).result).toBe("allowed");
    const identifierKeys = store
      .keys()
      .filter((key) => key.startsWith("rl:v1:auth_form_proxy.identifier:"));
    expect(identifierKeys).toHaveLength(5);
  });

  it("TC-RLM-004-258 the identifier rule is not part of Stage 1 and an absent identifier omits only that rule", async () => {
    const { store, limiter } = build({}, identifierConfig);
    await limiter.preAuth({ classId: "auth_form_proxy", ip: IP });
    const stage1 = store.calls.at(-1);
    expect(stage1?.rules.map((rule) => rule.key.split(":")[2])).toEqual([
      "auth_form_proxy.burst",
      "auth_form_proxy.sustained",
    ]);
    const before = store.calls.length;
    expect(
      await limiter.loginIdentifier({
        classId: "auth_form_proxy",
        ip: IP,
        loginIdentifier: undefined,
      }),
    ).toEqual({ result: "allowed" });
    expect(store.calls.length).toBe(before);
  });
});

describe("multi-resource evaluation in one atomic call (SEC-ABU-029, API-RLC-006)", () => {
  const cartConfig = {
    purchase_checkout: {
      burst_limit: 3,
      sustained_limit: 12,
      additional: { "purchase_checkout.resource": { limit: 2, window_seconds: 60 } },
    },
  };
  it("TC-RLM-004-259 distinct resources of one cart are one evaluation: the whole set is refused and no counter moves when one resource is full, duplicates count once", async () => {
    const { store, limiter } = build({}, cartConfig);
    const cart = (values: string[]) =>
      limiter.resource({
        classId: "purchase_checkout",
        references: { offering_ref: values },
      });
    expect((await cart(["a", "b"])).result).toBe("allowed");
    expect((await cart(["b", "c"])).result).toBe("allowed");
    // "b" is at its limit of 2: the evaluation is refused and "a" (which had room) is not recorded.
    expect(await cart(["a", "b"])).toMatchObject({ result: "rejected", ruleCategory: "resource" });
    const count = (value: string) =>
      store.count(resourceKey("purchase_checkout.resource", "offering_ref", value));
    expect([count("a"), count("b"), count("c")]).toEqual([1, 2, 1]);
    // Duplicates in the cart are one resource each.
    expect((await cart(["c", "c", "d"])).result).toBe("allowed");
    expect([count("c"), count("d")]).toEqual([2, 1]);
    // Every resource of the evaluation is one rule of the same single store call.
    expect(store.calls.at(-1)?.rules).toHaveLength(2);
  });

  it("TC-RLM-004-260 a cart of 50 distinct resources is one atomic evaluation; more than 50 is refused before any store call", async () => {
    const { store, limiter } = build({}, cartConfig);
    const fifty = Array.from({ length: 50 }, (_, i) => `item-${i}`);
    const before = store.calls.length;
    expect(
      (
        await limiter.resource({
          classId: "purchase_checkout",
          references: { offering_ref: fifty },
        })
      ).result,
    ).toBe("allowed");
    expect(store.calls.length - before).toBe(1);
    expect(store.calls.at(-1)?.rules).toHaveLength(50);
    const tooMany = Array.from({ length: 51 }, (_, i) => `over-${i}`);
    await expect(
      limiter.resource({
        classId: "purchase_checkout",
        references: { offering_ref: tooMany },
      }),
    ).rejects.toThrow();
    expect(store.calls.length - before).toBe(1);
  });
});
