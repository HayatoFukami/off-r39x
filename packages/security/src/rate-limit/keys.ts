// SEC-ABU-015 / 016: counter keys are HMAC-SHA256 digests. The key never contains a raw IP,
// Email, Auth Subject, QR, token or resource reference; the HMAC key version is part of the key.
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { RuleSubject } from "./registry.ts";

export interface CounterKeyFactory {
  readonly version: number;
  key(ruleId: string, subject: RuleSubject, value: string): string;
}

export function createCounterKeyFactory(hmacKey: Uint8Array, version: number): CounterKeyFactory {
  if (hmacKey.byteLength < 32 || !Number.isSafeInteger(version) || version < 1)
    throw new Error("Invalid rate limit key configuration");
  const secret = Uint8Array.from(hmacKey);
  return Object.freeze({
    version,
    key(ruleId: string, subject: RuleSubject, value: string): string {
      // NUL-delimited domain separation: rule ID and subject kind are bound into the digest.
      const digest = createHmac("sha256", secret)
        .update(`r39x/rate-limit/v1\0${ruleId}\0${subject}\0`, "utf8")
        .update(value, "utf8")
        .digest("hex");
      return `rl:v${version}:${ruleId}:${digest}`;
    },
  });
}

/**
 * Eight 16-bit groups of a compressed IPv6 literal in the WHATWG canonical form, or undefined.
 */
function ipv6Groups(text: string): number[] | undefined {
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return undefined;
  const parts = [
    ...head,
    ...Array.from({ length: halves.length === 2 ? fill : 0 }, () => "0"),
    ...tail,
  ];
  if (!parts.every((part) => /^[0-9a-f]{1,4}$/.test(part))) return undefined;
  return parts.map((part) => Number.parseInt(part, 16));
}

/**
 * Canonical text form of an IP address for the counter keys, or undefined when `value` is not a
 * plain IP literal. IPv4-mapped IPv6 is its IPv4 address; any other IPv6 is its /64 prefix, so
 * addresses that one subscriber can rotate inside a /64 share one key (SEC-API-032).
 */
export function normalizeIp(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  const family = isIP(text);
  if (family === 4) return text;
  if (family !== 6) return undefined;
  try {
    // The WHATWG parser yields the compressed lower-case form and folds IPv4-mapped literals.
    const host = new URL(`http://[${text}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
    if (mapped) {
      const high = Number.parseInt(mapped[1] ?? "", 16);
      const low = Number.parseInt(mapped[2] ?? "", 16);
      return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    }
    const groups = ipv6Groups(host);
    if (!groups) return undefined;
    return `${groups
      .slice(0, 4)
      .map((group) => group.toString(16))
      .join(":")}::`;
  } catch {
    return undefined;
  }
}

/**
 * HMAC input of the (source IP, login identifier) pair (SEC-ABU-024). Each part is prefixed with its
 * UTF-8 byte length, so no two different pairs share an input.
 */
export function identifierPair(ip: string, identifier: string): string {
  return `${Buffer.byteLength(ip, "utf8")}:${ip}${Buffer.byteLength(identifier, "utf8")}:${identifier}`;
}

/** Login identifier normalisation for the per-identifier rule; undefined means "no usable identifier". */
export function normalizeLoginIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().normalize("NFKC").toLowerCase();
  return text.length >= 1 && text.length <= 320 ? text : undefined;
}
