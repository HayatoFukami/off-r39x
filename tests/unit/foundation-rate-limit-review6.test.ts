import { describe, expect, it } from "vitest";
import { deriveClientIp, normalizeIp } from "../../packages/security/src/index.ts";

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
