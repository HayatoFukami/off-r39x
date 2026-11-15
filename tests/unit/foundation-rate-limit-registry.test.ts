import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeSecretKey,
  deriveClientIp,
  GUARD_CLASS_IDS,
  normalizeIp,
  parseRateLimitConfig,
  parseRateLimitHmac,
  parseTrustedProxyHops,
  RATE_LIMIT_CLASS_IDS,
  RATE_LIMIT_REGISTRY,
} from "../../packages/security/src/index.ts";

// biome-ignore lint/suspicious/noExplicitAny: deliberately malformed JSON fixtures that corrupt RATE_LIMIT_CONFIG
type Mutable = any;
const specs = resolve(import.meta.dirname, "../../docs/specs");
const spec = (name: string) => readFileSync(resolve(specs, name), "utf8");
const cells = (line: string) =>
  line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());

/** Canonical ceilings written as a full RATE_LIMIT_CONFIG. */
function ceilingConfig(): Record<string, unknown> {
  return Object.fromEntries(
    RATE_LIMIT_CLASS_IDS.map((id) => {
      const definition = RATE_LIMIT_REGISTRY[id];
      const extra = Object.entries(definition.additional as Record<string, never>);
      return [
        id,
        {
          burst_limit: definition.burst,
          sustained_limit: definition.sustained,
          ...(extra.length
            ? {
                additional: Object.fromEntries(
                  extra.map(([ruleId, rule]) => [
                    ruleId,
                    {
                      limit: (rule as { ceiling: number }).ceiling,
                      window_seconds: (rule as { windowSeconds: number }).windowSeconds,
                    },
                  ]),
                ),
              }
            : {}),
        },
      ];
    }),
  );
}

describe("registry vs SPEC-140 §68", () => {
  it("TC-RLM-006-001 the registry equals the SPEC-140 §68 matrix (Class IDs, ceilings, additional rules)", () => {
    const text = spec("140-security-specification.md");
    const rows = text
      .slice(text.indexOf("## 68. Canonical Rate Limit Matrix"), text.indexOf("### 68.1"))
      .split("\n")
      .filter((line) => /^\| .*\| `[a-z_]+` \|/.test(line))
      .map(cells);
    const matrix = new Map(rows.map((row) => [row[1]?.replaceAll("`", ""), row]));
    expect([...matrix.keys()].sort()).toEqual([...RATE_LIMIT_CLASS_IDS].sort());
    // 15 Operation classes (incl. auth_session, auth_callback) + the 2 guards (SPEC-140 §68).
    expect(RATE_LIMIT_CLASS_IDS).toHaveLength(17);
    // SEC-ABU-027: auth_session is per-IP 100 / 600, with no additional rule and no guard.
    expect(RATE_LIMIT_REGISTRY.auth_session).toMatchObject({
      kind: "route",
      primary: "ip",
      burst: 100,
      sustained: 600,
      additional: {},
    });
    expect(RATE_LIMIT_REGISTRY.auth_session).not.toHaveProperty("guard");
    // SEC-ABU-028: auth_callback is per-IP 30 / 120, with no additional rule and no guard.
    expect(RATE_LIMIT_REGISTRY.auth_callback).toMatchObject({
      kind: "route",
      primary: "ip",
      burst: 30,
      sustained: 120,
      additional: {},
    });
    expect(RATE_LIMIT_REGISTRY.auth_callback).not.toHaveProperty("guard");
    expect(RATE_LIMIT_REGISTRY.auth_form_proxy).not.toHaveProperty("guard");
    for (const id of RATE_LIMIT_CLASS_IDS) {
      const row = matrix.get(id);
      expect(row, id).toBeDefined();
      expect(Number(row?.[3]), `${id} burst`).toBe(RATE_LIMIT_REGISTRY[id].burst);
      expect(Number(row?.[4]), `${id} sustained`).toBe(RATE_LIMIT_REGISTRY[id].sustained);
    }
    // Additional rules: [rule ID, ceiling, window, fragment of the §68 "Additional" cell].
    const expected: [string, string, number, number, string][] = [
      ["public_read", "public_read.global", 10000, 60, "global 10,000/min"],
      ["auth_form_proxy", "auth_form_proxy.identifier", 5, 600, "5/10min"],
      ["self_read", "self_read.ip", 240, 60, "IP 240/min"],
      ["purchase_checkout", "purchase_checkout.resource", 60, 60, "60/min"],
      ["qr_display", "qr_display.ticket", 12, 60, "12/min"],
      ["staff_checkin", "staff_checkin.qr_digest", 30, 60, "per QR digest 30/min"],
      ["staff_checkin", "staff_checkin.ip", 300, 60, "IP 300/min"],
      ["goods_handoff", "goods_handoff.item", 10, 60, "10/min"],
      ["admin_mutation", "admin_mutation.resource", 15, 60, "15/min"],
      ["role_assignment", "role_assignment.profile", 5, 600, "5/10min"],
      ["high_risk_recovery", "high_risk_recovery.resource_minute", 2, 60, "2/min"],
      ["high_risk_recovery", "high_risk_recovery.resource_hour", 10, 3600, "10/hour"],
      ["stripe_webhook", "stripe_webhook.global", 3000, 60, "global 3,000/min"],
      ["resend_webhook", "resend_webhook.global", 3000, 60, "global 3,000/min"],
    ];
    const all = Object.fromEntries(
      RATE_LIMIT_CLASS_IDS.flatMap((id) =>
        Object.entries(RATE_LIMIT_REGISTRY[id].additional as Record<string, never>).map(
          ([ruleId, rule]) => [ruleId, rule],
        ),
      ),
    ) as Record<string, { ceiling: number; windowSeconds: number }>;
    expect(Object.keys(all).sort()).toEqual(expected.map((e) => e[1]).sort());
    for (const [classId, ruleId, ceiling, window, fragment] of expected) {
      expect(all[ruleId]?.ceiling, ruleId).toBe(ceiling);
      expect(all[ruleId]?.windowSeconds, ruleId).toBe(window);
      expect(matrix.get(classId)?.[5], ruleId).toContain(fragment);
    }
    // §68.1: the guard classes and the route classes they cover.
    expect([...GUARD_CLASS_IDS].sort()).toEqual([
      "auth_failure_guard_attendee",
      "auth_failure_guard_operator",
    ]);
    const guarded = (guard: string) =>
      RATE_LIMIT_CLASS_IDS.filter(
        (id) => (RATE_LIMIT_REGISTRY[id] as { guard?: string }).guard === guard,
      ).sort();
    expect(guarded("auth_failure_guard_attendee")).toEqual([
      "profile_mutation",
      "purchase_checkout",
      "qr_display",
    ]);
    expect(guarded("auth_failure_guard_operator")).toEqual([
      "admin_mutation",
      "goods_handoff",
      "high_risk_recovery",
      "role_assignment",
    ]);
  });
});

describe("RATE_LIMIT_CONFIG", () => {
  it("TC-RLM-006-002 accepts the canonical ceilings and any smaller positive integers", () => {
    const config = parseRateLimitConfig(JSON.stringify(ceilingConfig()));
    expect(config.public_read.burstLimit).toBe(20);
    expect(config.public_read.additional["public_read.global"]).toBe(10000);
    expect(config.high_risk_recovery.additional["high_risk_recovery.resource_hour"]).toBe(10);
    expect(config.profile_mutation.additional).toEqual({});
    const tight = ceilingConfig() as Record<string, Record<string, unknown>>;
    (tight.public_read as { burst_limit: number }).burst_limit = 1;
    (
      (tight.public_read as { additional: Record<string, { limit: number }> }).additional[
        "public_read.global"
      ] as { limit: number }
    ).limit = 1;
    expect(parseRateLimitConfig(JSON.stringify(tight)).public_read.burstLimit).toBe(1);
  });

  it("TC-RLM-006-003 every invalid configuration is rejected without implicit fallback", () => {
    const mutate = (change: (config: Record<string, Mutable>) => void) => {
      const config = ceilingConfig() as Record<string, Mutable>;
      change(config);
      return JSON.stringify(config);
    };
    const invalid: [string, string | undefined][] = [
      ["undefined", undefined],
      ["empty", ""],
      ["blank", "   "],
      ["parse failure", "{not json"],
      ["array", "[]"],
      ["null", "null"],
      ["zero burst", mutate((c) => (c.public_read.burst_limit = 0))],
      ["negative sustained", mutate((c) => (c.self_read.sustained_limit = -1))],
      ["fractional", mutate((c) => (c.qr_display.burst_limit = 1.5))],
      ["string number", mutate((c) => (c.qr_display.burst_limit = "3"))],
      ["null limit", mutate((c) => (c.qr_display.burst_limit = null))],
      ["burst over ceiling", mutate((c) => (c.public_read.burst_limit = 21))],
      ["sustained over ceiling", mutate((c) => (c.public_read.sustained_limit = 121))],
      [
        "additional over ceiling",
        mutate((c) => (c.public_read.additional["public_read.global"].limit = 10001)),
      ],
      [
        "additional zero",
        mutate((c) => (c.public_read.additional["public_read.global"].limit = 0)),
      ],
      [
        "additional window changed",
        mutate((c) => (c.public_read.additional["public_read.global"].window_seconds = 120)),
      ],
      ["additional rule missing", mutate((c) => delete c.public_read.additional)],
      [
        "additional rule renamed",
        mutate((c) => {
          c.public_read.additional = { other: { limit: 1, window_seconds: 60 } };
        }),
      ],
      ["extra field", mutate((c) => (c.public_read.extra = 1))],
      ["extra class", mutate((c) => (c.unknown_class = { burst_limit: 1, sustained_limit: 1 }))],
      ["burst missing", mutate((c) => delete c.public_read.burst_limit)],
      ["guard class missing", mutate((c) => delete c.auth_failure_guard_operator)],
      ["guard over ceiling", mutate((c) => (c.auth_failure_guard_attendee.burst_limit = 21))],
      [
        "additional on a class without rules",
        mutate((c) => {
          c.profile_mutation.additional = { x: { limit: 1, window_seconds: 60 } };
        }),
      ],
    ];
    // Every class is individually required.
    for (const id of RATE_LIMIT_CLASS_IDS)
      invalid.push([`class ${id} missing`, mutate((c) => delete c[id])]);
    for (const [name, raw] of invalid)
      expect(() => parseRateLimitConfig(raw), name).toThrow("Invalid rate limit configuration");
  });

  it("TC-RLM-006-004 TRUSTED_PROXY_HOPS: 0 is the explicit direct-peer value; absent, negative and non-integer fail", () => {
    expect(parseTrustedProxyHops("0")).toBe(0);
    expect(parseTrustedProxyHops("2")).toBe(2);
    for (const bad of [undefined, "", "-1", "1.5", "01", "abc", " 1", "1 ", "1e1", "1000"])
      expect(() => parseTrustedProxyHops(bad), String(bad)).toThrow(
        "Invalid trusted proxy configuration",
      );
  });

  it("TC-RLM-006-005 RATE_LIMIT_HMAC_KEY and its version are mandatory", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    expect(parseRateLimitHmac(key, "3", decodeSecretKey).hmacKeyVersion).toBe(3);
    for (const [k, v] of [
      [undefined, "1"],
      [key, undefined],
      [key, "0"],
      [key, "-1"],
      [key, "1.5"],
      [key, ""],
      ["short", "1"],
      [Buffer.alloc(16).toString("base64"), "1"],
    ] as const)
      expect(() => parseRateLimitHmac(k, v, decodeSecretKey), `${k}/${v}`).toThrow(
        "Invalid rate limit key configuration",
      );
  });
});

describe("Client IP derivation (TST-RLM-008)", () => {
  it("TC-RLM-008-001 only the trusted proxy part of the forwarded header is used", () => {
    const peer = "10.0.0.9";
    const cases: [string, Parameters<typeof deriveClientIp>[0], string | undefined][] = [
      [
        "0 hops ignores the header",
        { peer, forwarded: "203.0.113.5", trustedProxyHops: 0 },
        "10.0.0.9",
      ],
      ["0 hops with no header", { peer, forwarded: null, trustedProxyHops: 0 }, "10.0.0.9"],
      [
        "1 hop uses the last entry",
        { peer, forwarded: "203.0.113.5", trustedProxyHops: 1 },
        "203.0.113.5",
      ],
      [
        "1 hop ignores spoofed prefix",
        { peer, forwarded: "198.51.100.1, 203.0.113.5", trustedProxyHops: 1 },
        "203.0.113.5",
      ],
      [
        "2 hops uses the second from the right",
        { peer, forwarded: "198.51.100.1, 203.0.113.5, 10.0.0.1", trustedProxyHops: 2 },
        "203.0.113.5",
      ],
      [
        "chain shorter than the configured hops falls back to the peer",
        { peer, forwarded: "203.0.113.5", trustedProxyHops: 2 },
        "10.0.0.9",
      ],
      [
        "header missing falls back to the peer",
        { peer, forwarded: undefined, trustedProxyHops: 1 },
        "10.0.0.9",
      ],
      [
        "garbage entry falls back to the peer",
        { peer, forwarded: "not-an-ip", trustedProxyHops: 1 },
        "10.0.0.9",
      ],
      [
        "IPv6 is reduced to its /64 prefix (SEC-API-032)",
        { peer, forwarded: "2001:DB8:0:0:0:0:0:1", trustedProxyHops: 1 },
        "2001:db8:0:0::",
      ],
      [
        "IPv4-mapped IPv6 peer folds to IPv4",
        { peer: "::ffff:192.0.2.7", forwarded: null, trustedProxyHops: 0 },
        "192.0.2.7",
      ],
      ["unknown peer", { peer: undefined, forwarded: null, trustedProxyHops: 0 }, undefined],
    ];
    for (const [name, input, expected] of cases) expect(deriveClientIp(input), name).toBe(expected);
    expect(() => deriveClientIp({ peer, forwarded: null, trustedProxyHops: -1 })).toThrow();
    expect(normalizeIp("1.2.3.4%eth0")).toBeUndefined();
  });
});
