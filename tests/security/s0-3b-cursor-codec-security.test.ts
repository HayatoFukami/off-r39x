import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineListCursor, listCursorBinding } from "../../apps/api/src/api/pagination.ts";
import { type SyntheticCursorKey, syntheticCursorKey } from "../harness/pagination.ts";

// PR-S0-3b C1: signed opaque list cursor (SPEC-110 section 12 / 9, API-QRY-004, SEC-DEP-007). The
// byte layout (MAC(32) || payload UTF-8), the payload keys v/kv/k/r and the MAC framing used by
// forge() below are the repository decisions of the plan (A-2, A-3); the sanity check in
// TC-API-QRY-004-002 pins that framing. Synthetic keys only (SEC-KEY-005); no environment variables.

const OPERATION_ID = "API-ADM-ORD-001";
const REF = "00000000-0000-4000-8000-0000000000a1";
const TIMESTAMP = "2026-11-20T00:00:00.000000Z";
const K1 = syntheticCursorKey(0x11, 1);
const B = { state: "CONFIRMED" };
const P = { keys: [TIMESTAMP], publicRef: REF } as const;

const cursor = defineListCursor({ operationId: OPERATION_ID, keys: z.tuple([z.string()]) });
const numeric = defineListCursor({ operationId: OPERATION_ID, keys: z.tuple([z.number()]) });

function forge(payload: Uint8Array): string {
  const payloadPart = Buffer.from(payload).toString("base64url");
  const binding = JSON.stringify(Object.fromEntries(Object.entries(B).sort()));
  const framing = JSON.stringify(["r39x/list-cursor/v1", OPERATION_ID, binding, payloadPart]);
  const mac = createHmac("sha256", K1.key).update(framing, "utf8").digest();
  return Buffer.concat([mac, payload]).toString("base64url");
}
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const goodPayload = { v: 1, kv: 1, k: [TIMESTAMP], r: REF };

describe("TC-API-QRY-004-001 cursor round trip and opacity", () => {
  it("decodes to the encoded position, deterministically, in base64url within 512 characters", () => {
    const token = cursor.encode(K1, P, B);
    expect(cursor.decode(K1, token, B)).toEqual({ ok: true, position: P });
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeLessThanOrEqual(512);
    expect(cursor.encode(K1, P, B)).toBe(token);
  });

  it("carries only v, kv, k and r and none of the filter, Operation ID or key", () => {
    const bytes = Buffer.from(cursor.encode(K1, P, B), "base64url");
    const payload = bytes.subarray(32);
    const text = payload.toString("utf8");
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["k", "kv", "r", "v"]);
    expect(text).not.toContain("CONFIRMED");
    expect(text).not.toContain(OPERATION_ID);
    expect(payload.includes(Buffer.from(K1.key))).toBe(false);
  });

  it("refuses a position with an internal ID or a non-canonical public reference", () => {
    expect(() => cursor.encode(K1, { ...P, id: 123 } as never, B)).toThrow();
    expect(() => cursor.encode(K1, { ...P, publicRef: REF.toUpperCase() }, B)).toThrow();
  });

  it("stays within 512 characters with a timestamp and a UUID as sort keys", () => {
    const two = defineListCursor({
      operationId: OPERATION_ID,
      keys: z.tuple([z.string(), z.string()]),
    });
    const position = { keys: [TIMESTAMP, REF] as [string, string], publicRef: REF };
    const token = two.encode(K1, position, B);
    expect(token.length).toBeLessThanOrEqual(512);
    expect(two.decode(K1, token, B)).toEqual({ ok: true, position });
  });
});

describe("TC-API-QRY-004-001 numeric sort keys (F-5, repository decision: safe integers only)", () => {
  const at = (n: number) => ({ keys: [n] as [number], publicRef: REF });

  it("round-trips safe integers", () => {
    for (const n of [42, 0, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
      expect(numeric.decode(K1, numeric.encode(K1, at(n), B), B)).toEqual({
        ok: true,
        position: at(n),
      });
    }
  });

  it("refuses to encode fractions, unsafe integers, NaN and infinities", () => {
    for (const n of [
      1.5,
      2 ** 53,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(() => numeric.encode(K1, at(n), B), String(n)).toThrow();
    }
  });
});

describe("TC-API-QRY-004-002 malformed or tampered tokens never decode and never throw", () => {
  const token = cursor.encode(K1, P, B);
  const rejected = (candidate: string) => cursor.decode(K1, candidate, B);

  it("accepts the forged-token helper's framing for a valid payload (sanity)", () => {
    expect(rejected(forge(json(goodPayload)))).toEqual({ ok: true, position: P });
  });

  it("rejects every single-character substitution (MAC part and payload part)", () => {
    for (let i = 0; i < token.length; i++) {
      const replacement = token[i] === "A" ? "B" : "A";
      const changed = token.slice(0, i) + replacement + token.slice(i + 1);
      expect(rejected(changed), `position ${i}`).toEqual({ ok: false });
    }
  });

  it("rejects truncation, extension and structural garbage", () => {
    expect(rejected(token.slice(0, -1))).toEqual({ ok: false });
    expect(rejected(`${token}A`)).toEqual({ ok: false });
    expect(rejected("")).toEqual({ ok: false });
    expect(rejected("A".repeat(513))).toEqual({ ok: false });
    expect(rejected(Buffer.alloc(32, 1).toString("base64url"))).toEqual({ ok: false });
    expect(rejected(Buffer.alloc(10, 1).toString("base64url"))).toEqual({ ok: false });
    for (const bad of ["+", "/", "=", " ", "."]) {
      expect(rejected(token.slice(0, 10) + bad + token.slice(11)), JSON.stringify(bad)).toEqual({
        ok: false,
      });
      expect(rejected(`${token}${bad}`), JSON.stringify(bad)).toEqual({ ok: false });
    }
  });

  it("rejects a non-canonical base64url spelling of a validly signed token", () => {
    let checked = 0;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (let n = 0; n < 6; n++) {
      const valid = cursor.encode(K1, { keys: ["x".repeat(n)], publicRef: REF }, B);
      if (valid.length % 4 === 0) continue;
      const bytes = Buffer.from(valid, "base64url");
      const variant = [...alphabet]
        .map((char) => valid.slice(0, -1) + char)
        .find((c) => c !== valid && Buffer.from(c, "base64url").equals(bytes));
      expect(variant, `padding bits at length ${valid.length}`).toBeDefined();
      expect(rejected(valid)).toMatchObject({ ok: true });
      expect(rejected(variant as string)).toEqual({ ok: false });
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("rejects a correctly signed token whose payload breaks the strict schema", () => {
    const payloads: Uint8Array[] = [
      json({ ...goodPayload, extra: 1 }),
      json({ ...goodPayload, v: 2 }),
      json({ ...goodPayload, r: REF.toUpperCase() }),
      json({ ...goodPayload, k: [1] }),
      json({ ...goodPayload, kv: 0 }),
      new Uint8Array([0xff, 0xfe, 0xfd]),
      new TextEncoder().encode("not json"),
    ];
    for (const [index, payload] of payloads.entries()) {
      expect(rejected(forge(payload)), `payload ${index}`).toEqual({ ok: false });
    }
  });

  it("rejects a correctly signed numeric payload with a fraction or an unsafe integer (F-5)", () => {
    // 1e400 parses to Infinity in JSON.parse.
    const raw = (k: string) => new TextEncoder().encode(`{"v":1,"kv":1,"k":[${k}],"r":"${REF}"}`);
    expect(numeric.decode(K1, forge(raw("42")), B)).toMatchObject({ ok: true });
    for (const k of ["1.5", "9007199254740992", "1e400"]) {
      expect(numeric.decode(K1, forge(raw(k)), B), k).toEqual({ ok: false });
    }
  });

  it("never throws for 1,000 arbitrary strings from a fixed seed", () => {
    let state = 0x2545f491;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_+/= .%\u0000あ";
    for (let i = 0; i < 1000; i++) {
      const length = next() % 700;
      let candidate = "";
      for (let j = 0; j < length; j++) candidate += alphabet[next() % alphabet.length];
      expect(rejected(candidate)).toEqual({ ok: false });
    }
  });
});

describe("TC-API-QRY-004-003 a cursor is bound to key, version, Operation, mode, filter and scope", () => {
  const bound = { state: "CONFIRMED", order: "CREATED_DESC" };
  const scopeA = { ...bound, scope: "00000000-0000-4000-8000-0000000000b1" };
  const token = cursor.encode(K1, P, bound);
  const other = defineListCursor({ operationId: "API-ADM-TKT-001", keys: z.tuple([z.string()]) });

  it("fails under a different key, key version or Operation", () => {
    expect(cursor.decode(syntheticCursorKey(0x12, 1), token, bound)).toEqual({ ok: false });
    expect(cursor.decode(syntheticCursorKey(0x11, 2), token, bound)).toEqual({ ok: false });
    expect(other.decode(K1, token, bound)).toEqual({ ok: false });
  });

  it("fails when the filter, mode or scope differs", () => {
    expect(cursor.decode(K1, token, { ...bound, state: "CANCELED" })).toEqual({ ok: false });
    expect(cursor.decode(K1, token, { ...bound, order_ref: REF })).toEqual({ ok: false });
    expect(cursor.decode(K1, token, { state: "CONFIRMED" })).toEqual({ ok: false });
    // F-4: filter dropped, mode kept.
    expect(cursor.decode(K1, token, { order: "CREATED_DESC" })).toEqual({ ok: false });
    expect(cursor.decode(K1, token, { state: undefined, order: "CREATED_DESC" })).toEqual({
      ok: false,
    });
    expect(cursor.decode(K1, token, { ...bound, order: "USAGE_START_ASC" })).toEqual({ ok: false });
    const scoped = cursor.encode(K1, P, scopeA);
    expect(
      cursor.decode(K1, scoped, { ...scopeA, scope: "00000000-0000-4000-8000-0000000000b2" }),
    ).toEqual({ ok: false });
    expect(cursor.decode(K1, scoped, scopeA)).toEqual({ ok: true, position: P });
  });

  it("ignores binding key order and undefined values", () => {
    expect(cursor.decode(K1, token, { order: "CREATED_DESC", state: "CONFIRMED" })).toEqual({
      ok: true,
      position: P,
    });
    expect(cursor.decode(K1, token, { ...bound, order_ref: undefined })).toEqual({
      ok: true,
      position: P,
    });
  });

  // limit is not part of the binding (plan A-3): listCursorBinding drops limit and cursor from the
  // Zod-validated query, so changing limit between pages keeps the same cursor usable.
  it("listCursorBinding drops limit and cursor, adds the scope and rejects a colliding scope", () => {
    const page1 = { limit: 10, state: "CONFIRMED", order: "CREATED_DESC" };
    const scope = { profile_ref: "00000000-0000-4000-8000-0000000000b1" };
    const issued = cursor.encode(K1, P, listCursorBinding(page1, scope));
    const page2 = { ...page1, limit: 50, cursor: issued };
    expect(listCursorBinding(page2, scope)).toEqual({ ...bound, ...scope });
    expect(cursor.decode(K1, issued, listCursorBinding(page2, scope))).toEqual({
      ok: true,
      position: P,
    });
    expect(
      cursor.decode(
        K1,
        issued,
        listCursorBinding(page2, { profile_ref: "00000000-0000-4000-8000-0000000000b2" }),
      ),
    ).toEqual({ ok: false });
    expect(cursor.decode(K1, issued, listCursorBinding(page2))).toEqual({ ok: false });
    expect(() => listCursorBinding(page1, { state: "CANCELED" })).toThrow();
    expect(() => listCursorBinding({ limit: 10, state: ["CONFIRMED"] })).toThrow();
  });
});

describe("TC-API-QRY-004-004 an invalid signing key fails closed", () => {
  const valid = cursor.encode(K1, P, B);
  const bytes = () => new Uint8Array(32).fill(0x7a);
  const badKeys: [string, SyntheticCursorKey][] = [
    ["31-byte key", { version: 1, key: new Uint8Array(31).fill(0x7a) }],
    ["33-byte key", { version: 1, key: new Uint8Array(33).fill(0x7a) }],
    ["version 0", { version: 0, key: bytes() }],
    ["negative version", { version: -1, key: bytes() }],
    ["fractional version", { version: 1.5, key: bytes() }],
    ["version 2147483648", { version: 2147483648, key: bytes() }],
  ];

  it.each(badKeys)("%s throws from encode and decode without leaking key bytes", (_l, key) => {
    for (const run of [() => cursor.encode(key, P, B), () => cursor.decode(key, valid, B)]) {
      let thrown: unknown;
      try {
        run();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      const text = `${(thrown as Error).message}\n${(thrown as Error).stack ?? ""}`;
      const raw = Buffer.from(key.key);
      for (const encoding of ["hex", "base64", "base64url"] as const) {
        expect(text).not.toContain(raw.toString(encoding));
      }
    }
  });
});
