import { createHash } from "node:crypto";

// RFC 9562 §5.5 UUID version 5: SHA-1 over (namespace bytes || name UTF-8 bytes). It is a pure
// function: the same namespace and name always yield the same value (SPEC-120 §8.2).

const UUID_FORM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function uuidV5(namespace: string, name: string): string {
  // The message never echoes the offending value.
  if (!UUID_FORM.test(namespace)) {
    throw new Error("uuidV5 namespace must be a lowercase canonical UUID");
  }
  const digest = createHash("sha1")
    .update(Buffer.from(namespace.replaceAll("-", ""), "hex"))
    .update(Buffer.from(name, "utf8"))
    .digest();
  const bytes = digest.subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
