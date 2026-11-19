import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ApiFailure } from "./failure.ts";

/**
 * Opaque signed list cursor (SPEC-110 section 12, API-QRY-004, SEC-DEP-007). Pure functions: the key
 * and its version are arguments (the Secret placement is not specified yet), nothing reads the
 * environment, a clock or a random source.
 *
 * Token = base64url(MAC(32) || payload UTF-8), payload = {"v":1,"kv":keyVersion,"k":[sort keys],"r":publicRef}.
 * MAC = HMAC-SHA-256(key, JSON.stringify([DOMAIN, operationId, canonicalBinding, payloadBase64url])).
 * The Operation ID and the filter/mode binding are authenticated but not carried in the token.
 */
export type CursorKey = { readonly version: number; readonly key: Uint8Array };
export type CursorScalar = string | number | null;
export type CursorBinding = Readonly<Record<string, string | number | boolean | undefined>>;

const DOMAIN = "r39x/list-cursor/v1";
const MAX_TOKEN_LENGTH = 512;
const MAC_LENGTH = 32;
const OPERATION_ID = /^API-[A-Z0-9]+(-[A-Z0-9]+)*$/;
const PUBLIC_REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

const safeScalar = (value: unknown): boolean =>
  typeof value !== "number" || Number.isSafeInteger(value);

const publicRefSchema = z.string().regex(PUBLIC_REF);

function assertKey(cursorKey: CursorKey): void {
  const { version, key } = cursorKey;
  if (!Number.isInteger(version) || version < 1 || version > 2147483647)
    throw new Error("Invalid cursor key version");
  if (!(key instanceof Uint8Array) || key.length !== 32) throw new Error("Invalid cursor key");
}

function canonicalBinding(binding: CursorBinding): string {
  const entries = Object.entries(binding)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(Object.fromEntries(entries));
}

function mac(
  cursorKey: CursorKey,
  operationId: string,
  binding: CursorBinding,
  payloadPart: string,
) {
  const framing = JSON.stringify([DOMAIN, operationId, canonicalBinding(binding), payloadPart]);
  return createHmac("sha256", cursorKey.key).update(framing, "utf8").digest();
}

export function defineListCursor<K extends z.ZodType<readonly CursorScalar[]>>(definition: {
  readonly operationId: string;
  readonly keys: K;
}) {
  if (!OPERATION_ID.test(definition.operationId)) throw new Error("Invalid Operation ID");
  const { operationId, keys } = definition;
  type Position = { readonly keys: Readonly<z.output<K>>; readonly publicRef: string };
  const positionSchema = z.strictObject({ keys, publicRef: publicRefSchema });
  const payloadSchema = z.strictObject({
    v: z.literal(1),
    kv: z.number().int().min(1).max(2147483647),
    k: keys,
    r: publicRefSchema,
  });

  return {
    encode(cursorKey: CursorKey, position: Position, binding: CursorBinding): string {
      assertKey(cursorKey);
      const parsed = positionSchema.parse(position) as { keys: z.output<K>; publicRef: string };
      if (!parsed.keys.every(safeScalar)) throw new Error("Unsafe cursor key");
      const payload = Buffer.from(
        JSON.stringify({ v: 1, kv: cursorKey.version, k: parsed.keys, r: parsed.publicRef }),
        "utf8",
      );
      const payloadPart = payload.toString("base64url");
      const token = Buffer.concat([
        mac(cursorKey, operationId, binding, payloadPart),
        payload,
      ]).toString("base64url");
      if (token.length > MAX_TOKEN_LENGTH) throw new Error("Cursor too long");
      return token;
    },

    decode(
      cursorKey: CursorKey,
      token: string,
      binding: CursorBinding,
    ): { readonly ok: true; readonly position: Position } | { readonly ok: false } {
      assertKey(cursorKey);
      const fail = { ok: false } as const;
      try {
        if (typeof token !== "string" || token.length < 1 || token.length > MAX_TOKEN_LENGTH)
          return fail;
        if (!BASE64URL.test(token)) return fail;
        const bytes = Buffer.from(token, "base64url");
        if (bytes.toString("base64url") !== token) return fail;
        if (bytes.length <= MAC_LENGTH) return fail;
        const payload = bytes.subarray(MAC_LENGTH);
        const expected = mac(cursorKey, operationId, binding, payload.toString("base64url"));
        if (!timingSafeEqual(bytes.subarray(0, MAC_LENGTH), expected)) return fail;
        const text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
        const parsed = payloadSchema.safeParse(JSON.parse(text));
        if (!parsed.success) return fail;
        const data = parsed.data as { kv: number; k: z.output<K>; r: string };
        if (!(data.k as readonly unknown[]).every(safeScalar)) return fail;
        if (data.kv !== cursorKey.version) return fail;
        return { ok: true, position: { keys: data.k, publicRef: data.r } };
      } catch {
        return fail;
      }
    },
  };
}

/** Undefined for the first page; a rejected cursor is a 400 VALIDATION_FAILED (no reason is given). */
export function readCursor<K extends z.ZodType<readonly CursorScalar[]>>(
  definition: ReturnType<typeof defineListCursor<K>>,
  cursorKey: CursorKey,
  token: string | undefined,
  binding: CursorBinding,
) {
  if (token === undefined) return undefined;
  const result = definition.decode(cursorKey, token, binding);
  if (!result.ok) throw new ApiFailure("VALIDATION_FAILED");
  return result.position;
}
