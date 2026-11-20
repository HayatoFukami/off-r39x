import { createHash } from "node:crypto";
import { fingerprint } from "@off-r39x/security";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  canonicalRequestJson,
  keyDigest,
  parseIdempotencyKey,
  requestDigest,
  requireTransportIdempotency,
  TRANSPORT_IDEMPOTENCY_OPERATIONS,
} from "../../apps/api/src/api/middleware/idempotency.ts";

// PR-S0-3c C1 (G1 unit): the Idempotency-Key header check (SPEC-110 section 18, API-IDM-011), the
// key digest and the request digest (API-IDM-005, SPEC-170 TST-IDM-004 (4)), and the set of
// Operations that may mount the middleware (DEV-API-007, API-IDM-003). Expected values come from
// SPEC-110 v2.9.0 sections 18 / 18.1 and SPEC-120 section 36.1, and from independent oracles
// (node:crypto SHA-256, hand-written canonical strings), not from the implementation. Synthetic
// values only; no clock, no randomness, no DB.

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest();
type NormalizedRequest = Parameters<typeof requestDigest>[0];
/** Feeds a deliberately malformed request past the type (the runtime check is what is tested). */
const digestOf = (request: unknown) => requestDigest(request as NormalizedRequest);
const canonicalOf = (request: unknown) => canonicalRequestJson(request as NormalizedRequest);
const hexOf = (request: unknown) => Buffer.from(digestOf(request)).toString("hex");

const REF_A1 = "00000000-0000-4000-8000-0000000000a1";
const REF_A2 = "00000000-0000-4000-8000-0000000000a2";
const MARKER = "synthetic-idem-marker";

describe("TC-API-IDM-011-001 Idempotency-Key format and key digest (API-IDM-011 1. 2., API-IDM-005)", () => {
  const printable = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) =>
    String.fromCharCode(0x20 + i),
  ).join("");

  describe("accepted: 16..128 characters, all in 0x20..0x7E, returned unchanged", () => {
    const accepted: [label: string, value: string][] = [
      ["16 characters", "a".repeat(16)],
      ["128 characters", "k".repeat(128)],
      ["lowercase UUID (36)", "00000000-0000-4000-8000-0000000000b1"],
      ["mixed case", "AbCdEfGhIjKlMnOpQrSt"],
      ["inner spaces", "synthetic idem key 0001"],
      ["leading and trailing spaces (the function does not trim)", `  ${"s".repeat(16)}  `],
      ["printable ASCII 0x20..0x3F (part 1)", printable.slice(0, 32)],
      ["printable ASCII 0x40..0x5F (part 2)", printable.slice(32, 64)],
      ["printable ASCII 0x60..0x7E (part 3)", printable.slice(64)],
      ["all 95 printable characters at once", printable],
    ];
    it.each(accepted)("%s", (_label, value) => {
      expect(parseIdempotencyKey(value)).toEqual({ ok: true, key: value });
    });
    it("the printable-ASCII fixture covers 0x20..0x7E without a gap", () => {
      expect(printable).toHaveLength(95);
      expect(printable.charCodeAt(0)).toBe(0x20);
      expect(printable.charCodeAt(94)).toBe(0x7e);
    });
  });

  describe("rejected: missing, too short, too long, outside 0x20..0x7E", () => {
    const rejected: [label: string, value: string | undefined][] = [
      ["undefined (missing)", undefined],
      ["empty", ""],
      ["15 characters", "a".repeat(15)],
      ["129 characters", "a".repeat(129)],
      ["Latin-1 characters (0xE9)", "é".repeat(16)],
      ["full-width characters", "ａ".repeat(16)],
      ["an emoji inside a long value", `${"a".repeat(16)}\u{1F600}`],
      ["only spaces below the minimum", " ".repeat(15)],
    ];
    it.each(rejected)("%s", (_label, value) => {
      expect(parseIdempotencyKey(value)).toEqual({ ok: false });
    });
  });

  describe("rejected (API-IDM-011 1.): any control character, DEL or non-ASCII in an otherwise long value", () => {
    const base = "s".repeat(20);
    const bad: [label: string, char: string][] = [
      ["HTAB 0x09", "\t"],
      ["NUL 0x00", "\u0000"],
      ["SOH 0x01", "\u0001"],
      ["US 0x1F", "\u001f"],
      ["DEL 0x7F", "\u007f"],
      ["0x80", "\u0080"],
    ];
    it.each(bad)("%s in the middle", (_label, char) => {
      expect(parseIdempotencyKey(`${base.slice(0, 10)}${char}${base.slice(10)}`)).toEqual({
        ok: false,
      });
    });
    it.each(bad)("%s at the end", (_label, char) => {
      expect(parseIdempotencyKey(`${base}${char}`)).toEqual({ ok: false });
    });
    it("a rejection does not say why (the result has no reason field)", () => {
      expect(Object.keys(parseIdempotencyKey("short"))).toEqual(["ok"]);
    });
  });

  describe("key digest: SHA-256 of the validated value itself (API-IDM-005, OBS-COR-005)", () => {
    it("is 32 bytes and equals an independently computed SHA-256 of the UTF-8 value", () => {
      for (const key of ["a".repeat(16), "00000000-0000-4000-8000-0000000000b1", printable]) {
        const digest = keyDigest(key);
        expect(digest).toHaveLength(32);
        expect(Buffer.from(digest).equals(sha256(key)), key).toBe(true);
      }
    });
    it("is case sensitive and does not trim", () => {
      const upper = Buffer.from(keyDigest("A".repeat(16)));
      const lower = Buffer.from(keyDigest("a".repeat(16)));
      expect(upper.equals(lower)).toBe(false);
      const plain = Buffer.from(keyDigest("s".repeat(16)));
      expect(Buffer.from(keyDigest(` ${"s".repeat(16)}`)).equals(plain)).toBe(false);
      expect(Buffer.from(keyDigest(`${"s".repeat(16)} `)).equals(plain)).toBe(false);
    });
    it("is not the HMAC correlation fingerprint and takes no secret (OBS-COR-005)", () => {
      const key = "synthetic-idem-key-0001";
      const hmacKey = new Uint8Array(32).fill(7);
      const correlation = fingerprint("transport-idempotency", key, hmacKey);
      expect(Buffer.from(keyDigest(key)).toString("hex")).not.toBe(correlation);
      expect(Buffer.from(keyDigest(key)).toString("base64url")).not.toBe(correlation);
      expect(keyDigest.length).toBe(1);
    });
  });
});

describe("TC-API-IDM-005-001 request digest is deterministic over the validated request (API-IDM-005, TST-IDM-004 (4))", () => {
  const lower = (value: string) => value.toLowerCase();
  const itemsSchema = z
    .array(z.strictObject({ ref: z.uuid().transform(lower), quantity: z.number().int() }))
    .min(1);
  const bodySchema = z.strictObject({
    items: itemsSchema,
    note: z.string().optional(),
    flag: z.boolean().default(false),
  });
  const nullableNoteSchema = z.strictObject({
    items: itemsSchema,
    note: z.string().nullable().optional(),
    flag: z.boolean().default(false),
  });
  const params = { order_ref: REF_A1 };
  /** Raw JSON text, parsed, then Zod (transform, default), then the request digest, as a route will do. */
  const viaZod = (raw: string, schema: z.ZodType = bodySchema) =>
    hexOf({ params, query: {}, body: schema.parse(JSON.parse(raw)) });
  const BASE = `{"items":[{"ref":"${REF_A1}","quantity":2}],"note":"Hello","flag":true}`;

  it("(a) a different key order gives the same digest, also inside nested objects", () => {
    const reordered = `{"flag":true,"note":"Hello","items":[{"quantity":2,"ref":"${REF_A1}"}]}`;
    expect(viaZod(reordered)).toBe(viaZod(BASE));
    const nestedA = hexOf({ params, query: {}, body: { c: { y: 1, z: 2 }, a: [{ q: 1, p: 2 }] } });
    const nestedB = hexOf({ params, query: {}, body: { a: [{ p: 2, q: 1 }], c: { z: 2, y: 1 } } });
    expect(nestedA).toBe(nestedB);
  });
  it("(b) newlines, tabs and spaces in the raw JSON do not matter", () => {
    const spaced = `{\n\t"items" : [ {\t"ref" : "${REF_A1}" ,\n "quantity" : 2 } ],\n "note" : "Hello" , "flag" : true }`;
    expect(viaZod(spaced)).toBe(viaZod(BASE));
  });
  it("(c) an omitted field and its default value give the same digest", () => {
    const omitted = `{"items":[{"ref":"${REF_A1}","quantity":2}]}`;
    const explicit = `{"items":[{"ref":"${REF_A1}","quantity":2}],"flag":false}`;
    expect(viaZod(omitted)).toBe(viaZod(explicit));
  });
  it("(d) an uppercase and a lowercase Public Reference give the same digest after the schema transform", () => {
    const upper = BASE.replace(REF_A1, REF_A1.toUpperCase());
    expect(upper).not.toBe(BASE);
    expect(viaZod(upper)).toBe(viaZod(BASE));
  });
  it("(e) 1 and 1.0, and -0 and 0, are the same number", () => {
    const one = `{"items":[{"ref":"${REF_A1}","quantity":1}]}`;
    const onePointZero = `{"items":[{"ref":"${REF_A1}","quantity":1.0}]}`;
    expect(viaZod(onePointZero)).toBe(viaZod(one));
    const zero = `{"items":[{"ref":"${REF_A1}","quantity":0}]}`;
    const negativeZero = `{"items":[{"ref":"${REF_A1}","quantity":-0}]}`;
    expect(viaZod(negativeZero)).toBe(viaZod(zero));
  });

  describe("(f) a different meaning gives a different digest", () => {
    const base = viaZod(BASE);
    const twoItems = (first: string, second: string) =>
      `{"items":[{"ref":"${first}","quantity":2},{"ref":"${second}","quantity":1}],"note":"Hello","flag":true}`;
    const cases: [label: string, digest: string][] = [
      ["a different quantity", viaZod(BASE.replace('"quantity":2', '"quantity":3'))],
      ["a note that differs only in case", viaZod(BASE.replace('"Hello"', '"hello"'))],
      ["an omitted note", viaZod(BASE.replace(',"note":"Hello"', ""))],
      ["an added item", viaZod(twoItems(REF_A1, REF_A2))],
    ];
    it.each(cases)("%s", (_label, digest) => {
      expect(digest).not.toBe(base);
    });
    it("items in a different order", () => {
      expect(viaZod(twoItems(REF_A1, REF_A2))).not.toBe(viaZod(twoItems(REF_A2, REF_A1)));
    });
    it("an omitted note and an explicit null note are different values", () => {
      const omitted = viaZod(`{"items":[{"ref":"${REF_A1}","quantity":2}]}`, nullableNoteSchema);
      const explicitNull = viaZod(
        `{"items":[{"ref":"${REF_A1}","quantity":2}],"note":null}`,
        nullableNoteSchema,
      );
      expect(explicitNull).not.toBe(omitted);
    });
    it("different params, different query, body null versus {}, and the same value in params versus body", () => {
      const body = { b: 1 };
      const reference = hexOf({ params, query: {}, body });
      expect(hexOf({ params: { order_ref: REF_A2 }, query: {}, body })).not.toBe(reference);
      expect(hexOf({ params, query: { page: "1" }, body })).not.toBe(reference);
      expect(hexOf({ params, query: { page: "1" }, body })).not.toBe(
        hexOf({ params, query: { page: "2" }, body }),
      );
      expect(hexOf({ params, query: {}, body: null })).not.toBe(
        hexOf({ params, query: {}, body: {} }),
      );
      expect(hexOf({ params: { x: "v" }, query: {}, body: {} })).not.toBe(
        hexOf({ params: {}, query: {}, body: { x: "v" } }),
      );
    });
    it("every digest is 32 bytes", () => {
      expect(digestOf({ params, query: {}, body: null })).toHaveLength(32);
    });
  });

  describe("canonical representation (D-1: keys by UTF-16 code unit, no whitespace, JSON scalars)", () => {
    it("(g) matches the hand-written oracle and its SHA-256", () => {
      const request = {
        params: { order_ref: REF_A1 },
        query: {},
        body: { b: [2, 1], a: "x", c: { z: null, y: true } },
      };
      const expected =
        '{"body":{"a":"x","b":[2,1],"c":{"y":true,"z":null}},"params":{"order_ref":"00000000-0000-4000-8000-0000000000a1"},"query":{}}';
      expect(canonicalOf(request)).toBe(expected);
      expect(Buffer.from(digestOf(request)).equals(sha256(expected))).toBe(true);
    });
    it("(h) object keys are ordered by UTF-16 code unit", () => {
      const body: Record<string, number> = {};
      for (const [i, key] of ["b", "a", "B", "é", "\u{1F600}", "ｱ"].entries()) body[key] = i;
      // U+0042, U+0061, U+0062, U+00E9, U+D83D (lead surrogate of U+1F600), U+FF71.
      const ordered = ["B", "a", "b", "é", "\u{1F600}", "ｱ"];
      const expected = `{"body":{${ordered
        .map((key) => `${JSON.stringify(key)}:${body[key]}`)
        .join(",")}},"params":{},"query":{}}`;
      expect(canonicalOf({ params: {}, query: {}, body })).toBe(expected);
    });
    it("(i) strings and numbers use the JSON.stringify representation", () => {
      const strings = ["表示名", "\u{1F600}", "\ud800", 'quote"back\\slash\n'];
      const canonical = canonicalOf({
        params: {},
        query: {},
        body: { n: [2147483647, 1e21, 0.5], s: strings },
      });
      expect(canonical).toBe(
        `{"body":{"n":[2147483647,1e+21,0.5],"s":[${strings.map((s) => JSON.stringify(s)).join(",")}]},"params":{},"query":{}}`,
      );
    });
    it("the top level always has the three keys body, params, query", () => {
      expect(canonicalOf({ params: {}, query: {}, body: null })).toBe(
        '{"body":null,"params":{},"query":{}}',
      );
    });
  });

  it("(j) the request digest takes no headers (no headers member, one parameter)", () => {
    expectTypeOf<NormalizedRequest>().not.toHaveProperty("headers");
    expectTypeOf<NormalizedRequest>().toHaveProperty("params");
    expectTypeOf<NormalizedRequest>().toHaveProperty("query");
    expectTypeOf<NormalizedRequest>().toHaveProperty("body");
    expect(requestDigest.length).toBe(1);
  });
});

describe("TC-API-IDM-005-002 a request that is not JSON-representable is refused (API-IDM-005, SEC-ERR-003, DEV-TS-004)", () => {
  const holey = new Array<unknown>(3);
  holey[0] = MARKER;
  holey[2] = MARKER;
  const cyclic: Record<string, unknown> = { label: MARKER };
  cyclic.self = cyclic;
  class Probe {
    label = MARKER;
  }
  const withGetter = Object.defineProperty({}, "label", {
    enumerable: true,
    get: () => MARKER,
  });
  const withToJson = { label: MARKER, toJSON: () => "replaced" };
  const bad: [label: string, body: unknown][] = [
    ["undefined body", undefined],
    ["NaN", { n: Number.NaN, label: MARKER }],
    ["Infinity", { n: Number.POSITIVE_INFINITY, label: MARKER }],
    ["bigint", { n: 10n, label: MARKER }],
    ["Date", { at: new Date(0), label: MARKER }],
    ["Map", new Map([[MARKER, 1]])],
    ["class instance", new Probe()],
    ["function", { f: () => MARKER }],
    ["symbol", { s: Symbol(MARKER) }],
    ["cyclic reference", cyclic],
    ["array with holes", holey],
    ["accessor property", withGetter],
    ["object with toJSON", withToJson],
  ];
  it.each(bad)("body: %s", (_label, body) => {
    let thrown: unknown;
    try {
      digestOf({ params: {}, query: {}, body });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).not.toContain(MARKER);
    expect(message).toBe("Request is not canonicalizable");
    expect((thrown as Error).cause).toBeUndefined();
  });
  it("a params value that is not a string", () => {
    for (const value of [1, null, undefined, { [MARKER]: 1 }, [MARKER]]) {
      let message: string | undefined;
      try {
        digestOf({ params: { order_ref: value }, query: {}, body: null });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, String(value)).toBeDefined();
      expect(message).not.toContain(MARKER);
    }
  });
  it("an accessor or a throwing trap anywhere in the request is refused without being invoked, with the fixed message", () => {
    // A getter that answers differently on each read must not let one value pass the check and
    // another reach the digest (the canonical form covers exactly what was checked).
    let reads = 0;
    const changingBody = Object.defineProperty({ params: {}, query: {} }, "body", {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? { label: "checked" } : { label: MARKER };
      },
    });
    const throwing = () => {
      throw new Error(MARKER);
    };
    const cases: [label: string, request: unknown][] = [
      ["body accessor", changingBody],
      [
        "params accessor",
        Object.defineProperty({ query: {}, body: null }, "params", {
          enumerable: true,
          get: () => ({}),
        }),
      ],
      [
        "query accessor",
        Object.defineProperty({ params: {}, body: null }, "query", {
          enumerable: true,
          get: () => ({}),
        }),
      ],
      [
        "params value accessor that throws",
        {
          params: Object.defineProperty({}, "order_ref", { enumerable: true, get: throwing }),
          query: {},
          body: null,
        },
      ],
      [
        "body proxy whose trap throws",
        { params: {}, query: {}, body: new Proxy({}, { ownKeys: throwing }) },
      ],
      [
        "request proxy whose trap throws",
        new Proxy({}, { getOwnPropertyDescriptor: throwing, get: throwing }),
      ],
    ];
    for (const [label, request] of cases) {
      for (const run of [digestOf, canonicalOf]) {
        let thrown: unknown;
        try {
          run(request);
        } catch (error) {
          thrown = error;
        }
        expect(thrown, label).toBeInstanceOf(Error);
        expect((thrown as Error).message, label).toBe("Request is not canonicalizable");
        expect((thrown as Error).cause, label).toBeUndefined();
      }
    }
    expect(reads).toBe(0);
  });
  it("a params value is read once: the value that passed the string check is the one hashed", () => {
    // A proxy whose descriptor answers a string for the first `n` reads and a number afterwards: for
    // every `n`, the digest covers the checked string or the request is refused, never the number.
    for (let n = 1; n <= 6; n += 1) {
      let calls = 0;
      const params = new Proxy(
        {},
        {
          ownKeys: () => ["order_ref"],
          getOwnPropertyDescriptor: () => {
            calls += 1;
            return {
              value: calls <= n ? REF_A1 : 1,
              writable: true,
              enumerable: true,
              configurable: true,
            };
          },
        },
      );
      let canonical: string | undefined;
      try {
        canonical = canonicalOf({ params, query: {}, body: null });
      } catch (error) {
        expect((error as Error).message, `n=${n}`).toBe("Request is not canonicalizable");
      }
      if (canonical !== undefined) {
        expect(canonical, `n=${n}`).toBe(
          `{"body":null,"params":{"order_ref":"${REF_A1}"},"query":{}}`,
        );
      }
    }
  });
  it("canonicalRequestJson refuses the same requests", () => {
    expect(() => canonicalOf({ params: {}, query: {}, body: undefined })).toThrow();
    expect(() => canonicalOf({ params: {}, query: {}, body: { n: Number.NaN } })).toThrow();
  });
});

describe("TC-DEV-API-007-001 only the API-IDM-011 / API-IDM-003 Operations may mount the middleware (DEV-API-007)", () => {
  // Written from SPEC-110 section 18 (v2.9.0) and SPEC-120 section 36.1, independently of the code.
  const SPEC_SET = [
    // purchase start
    "API-PUR-CART-001",
    "API-PUR-ENTRY-001",
    "API-PUR-KRK-001",
    "API-PUR-GDS-001",
    // checkout start / resume, pre-payment cancel
    "API-CHK-001",
    "API-ORD-002",
    // refund request, refund result reconcile
    "API-ADM-PAY-001",
    "API-ADM-REC-005",
    // QR token rotation
    "API-ADM-TQR-001",
    // slot generation, slot state / edit mutation
    "API-ADM-KRK-003",
    "API-ADM-KRK-004",
    "API-ADM-KRK-005",
    "API-ADM-KRK-006",
    // goods handoff completion (Staff / Administrator)
    "API-STF-GDS-001",
    "API-ADM-HOF-003",
    // reservation cancellation (UCR-110-012)
    "API-ADM-KRK-007",
    // entry ticket offering / karaoke sales / goods sales configuration mutation
    "API-ADM-ENT-SALES-003",
    "API-ADM-KRK-SALES-003",
    "API-ADM-GDS-004",
    // goods inventory adjustment
    "API-ADM-GDS-005",
    // public content create / update / publish / archive / restore-draft
    "API-ADM-CNT-002",
    "API-ADM-CNT-005",
    "API-ADM-CNT-006",
    "API-ADM-CNT-007",
    "API-ADM-CNT-008",
    "API-ADM-CNT-011",
    "API-ADM-CNT-012",
    "API-ADM-CNT-013",
    "API-ADM-CNT-014",
    "API-ADM-CNT-015",
    "API-ADM-CNT-016",
    "API-ADM-CNT-019",
    "API-ADM-CNT-020",
    "API-ADM-CNT-021",
    // role assignment mutation
    "API-ADM-ROL-002",
    "API-ADM-ROL-003",
    // reconcile / resolve
    "API-ADM-REC-003",
    "API-ADM-REC-004",
    "API-ADM-REC-006",
    "API-ADM-REC-007",
    // SPEC-120 section 36.1
    "API-ADM-EML-004",
    "API-ADM-EML-005",
  ];
  const NOT_TARGETS = [
    "API-AUTH-001",
    "API-AUTH-003",
    "API-AUTH-004",
    "API-PUR-ELG-001",
    "API-STF-CHK-001",
    "API-STF-CHK-002",
    "API-ORD-003",
    "API-ADM-CNT-001",
    "API-WHK-001",
  ];
  const normalize = () => ({ params: {}, query: {}, body: null });

  it("(a) the exported set is exactly the 42 Operations, with no duplicate, including API-ADM-KRK-007", () => {
    expect(SPEC_SET).toHaveLength(42);
    expect(new Set(SPEC_SET).size).toBe(42);
    const actual = [...TRANSPORT_IDEMPOTENCY_OPERATIONS];
    expect(new Set(actual).size).toBe(actual.length);
    expect([...actual].sort()).toEqual([...SPEC_SET].sort());
    expect(actual).toContain("API-ADM-KRK-007");
  });
  it("(b) check-in, the eligibility reference, API-AUTH-003/004, GET Operations and the webhook are not targets", () => {
    for (const id of NOT_TARGETS) {
      expect((TRANSPORT_IDEMPOTENCY_OPERATIONS as readonly string[]).includes(id), id).toBe(false);
    }
  });
  it("(c) the factory throws at creation for a non-target Operation, with a fixed message", () => {
    for (const id of NOT_TARGETS) {
      expect(() => requireTransportIdempotency(id as never, normalize), id).toThrow(
        "Operation does not accept a transport Idempotency-Key",
      );
    }
  });
  it("the factory accepts every target Operation", () => {
    for (const id of SPEC_SET) {
      expect(() => requireTransportIdempotency(id as never, normalize), id).not.toThrow();
    }
  });
  it("(d) a non-target Operation ID is a type error", () => {
    // @ts-expect-error API-AUTH-004 does not take a transport Idempotency-Key (API-IDM-003).
    expect(() => requireTransportIdempotency("API-AUTH-004", normalize)).toThrow();
    // @ts-expect-error check-in is not a target (SPEC-110 section 18).
    expect(() => requireTransportIdempotency("API-STF-CHK-001", normalize)).toThrow();
  });
});
