import { createHmac } from "node:crypto";
import { z } from "zod";

export type FingerprintDomain =
  | "transport-idempotency"
  | "stripe-idempotency"
  | "resend-idempotency"
  | "network-source"
  | "auth-subject";
export function fingerprint(domain: FingerprintDomain, raw: string, key: Uint8Array): string {
  if (
    ![
      "transport-idempotency",
      "stripe-idempotency",
      "resend-idempotency",
      "network-source",
      "auth-subject",
    ].includes(domain) ||
    key.byteLength < 32
  )
    throw new Error("Invalid correlation configuration");
  return createHmac("sha256", key)
    .update(`r39x/obs/v1/${domain}\0`, "utf8")
    .update(raw, "utf8")
    .digest()
    .subarray(0, 16)
    .toString("hex");
}
const version = z.number().int().positive().max(2147483647);
const entry = z.object({ version, hmacKey: z.string(), aeadKey: z.string() }).strict();
export interface QrKeyring {
  readonly currentVersion: number;
  readonly allowedReadVersions: readonly number[];
  /** Returns copies; callers cannot mutate the validated keyring. */
  keyFor(version: number): Readonly<{ hmacKey: Uint8Array; aeadKey: Uint8Array }>;
}
export function decodeSecretKey(encoded: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error("Invalid secret key");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded)
    throw new Error("Invalid secret key");
  return new Uint8Array(key);
}
export function parseQrKeyring(raw: string, current: string, allowed: string): QrKeyring {
  try {
    if (!/^[1-9]\d*$/.test(current) || !/^[1-9]\d*(,[1-9]\d*)?$/.test(allowed)) throw new Error();
    const currentVersion = version.parse(Number(current));
    const allowedReadVersions = allowed.split(",").map((v) => version.parse(Number(v)));
    if (
      new Set(allowedReadVersions).size !== allowedReadVersions.length ||
      !allowedReadVersions.includes(currentVersion)
    )
      throw new Error();
    const entries = z.array(entry).min(1).max(2).parse(JSON.parse(raw));
    const keys = new Map<number, { hmacKey: Uint8Array; aeadKey: Uint8Array }>();
    for (const e of entries) {
      if (keys.has(e.version) || !allowedReadVersions.includes(e.version)) throw new Error();
      const hmacKey = decodeSecretKey(e.hmacKey),
        aeadKey = decodeSecretKey(e.aeadKey);
      if (Buffer.from(hmacKey).equals(Buffer.from(aeadKey))) throw new Error();
      keys.set(e.version, { hmacKey, aeadKey });
    }
    if (keys.size !== allowedReadVersions.length) throw new Error();
    return Object.freeze({
      currentVersion,
      allowedReadVersions: Object.freeze(allowedReadVersions),
      keyFor(v: number) {
        const key = keys.get(v);
        if (!key) throw new Error("Unknown QR key version");
        return Object.freeze({ hmacKey: key.hmacKey.slice(), aeadKey: key.aeadKey.slice() });
      },
    });
  } catch {
    throw new Error("Invalid QR keyring");
  }
}
