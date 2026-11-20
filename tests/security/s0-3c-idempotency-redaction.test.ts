import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  goodBody,
  idempotencyRig,
  MARKER,
  ORDER_REF,
  ROUTE,
} from "../harness/api/transport-idempotency-rig.ts";

// PR-S0-3c C1 (G5 security): the raw Idempotency-Key, its digest and the request digest never reach
// an error body, a response header or a log line (SPEC-140 SEC-ERR-001..003, SPEC-160 section 11
// OBS-COR-005/006, SPEC-110 API-IDM-005, DEV-API-006). Synthetic markers only. Harness-only routes.

const KEY_A = `${MARKER}-0001`;
const KEY_129 = `${MARKER}${"x".repeat(129 - MARKER.length)}`;
const KEY_DEL = `${MARKER}-\u007f-0001`;
const NL = String.fromCharCode(10);
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest();

const digestForms = (digest: Uint8Array) => {
  const buffer = Buffer.from(digest);
  const hex = buffer.toString("hex");
  return [hex, hex.toUpperCase(), buffer.toString("base64"), buffer.toString("base64url")];
};

function headerText(response: Response): string {
  const out: string[] = [];
  response.headers.forEach((value, name) => {
    out.push(`${name}: ${value}`);
  });
  return out.join(NL);
}

describe("TC-SEC-ERR-001-002 the key and the digests do not leak (SEC-ERR-001/002/003, OBS-COR-005/006, DEV-API-006)", () => {
  // The request digest of `rawBody` as the route normalizes it, computed by an accepted call (with a
  // valid key) on a separate rig; the key digest oracle is checked against node:crypto.
  async function requestDigestOf(rawBody: string) {
    const rig = idempotencyRig();
    const response = await rig.post(ROUTE, { headers: rig.withKey(KEY_A), rawBody });
    expect(response.status).toBe(200);
    const context = rig.seen[0]?.context as { keyDigest: Uint8Array; requestDigest: Uint8Array };
    expect(Buffer.from(context.keyDigest).equals(sha256(KEY_A))).toBe(true);
    return context.requestDigest;
  }

  /**
   * Each case forbids what it actually sends: the key (raw and JSON-escaped), the SHA-256 of that
   * key, and the request digest of that body, in hex, upper hex, base64 and base64url.
   */
  async function run(
    label: string,
    sent: { readonly key: string; readonly rawBody: string },
    send: (rig: ReturnType<typeof idempotencyRig>) => Promise<Response>,
  ) {
    const forbidden = [
      sent.key,
      JSON.stringify(sent.key).slice(1, -1),
      MARKER,
      ...digestForms(sha256(sent.key)),
      ...digestForms(await requestDigestOf(sent.rawBody)),
    ];
    const rig = idempotencyRig();
    const response = await send(rig);
    const body = await response.text();
    const headers = headerText(response);
    const logged = rig.lines.join(NL);
    for (const text of forbidden) {
      expect(body, `${label} body ${text.slice(0, 12)}`).not.toContain(text);
      expect(headers, `${label} headers ${text.slice(0, 12)}`).not.toContain(text);
      expect(logged, `${label} log ${text.slice(0, 12)}`).not.toContain(text);
    }
    return { rig, response };
  }

  // The harness body carries a note equal to the marker where the request digest is concerned.
  const markerBody = JSON.stringify({ ...goodBody, note: MARKER });
  const noteBody = JSON.stringify({ ...goodBody, note: "synthetic note" });
  const defaultBody = JSON.stringify(goodBody);

  it("(a) an accepted key: the response and every log line stay clean; the context holds no raw key", async () => {
    const { rig, response } = await run("(a)", { key: KEY_A, rawBody: noteBody }, (r) =>
      r.post(ROUTE, { headers: r.withKey(KEY_A), rawBody: noteBody }),
    );
    expect(response.status).toBe(200);
    const context = rig.seen[0]?.context as Record<string, unknown>;
    expect(context).toBeDefined();
    for (const value of Object.values(context)) expect(value).not.toBe(KEY_A);
    expect(
      Object.values(context).some((value) => typeof value === "string" && value.includes(MARKER)),
    ).toBe(false);
    expect(rig.seen[0]?.header).toBe(KEY_A);
  });
  it("(b) a 129-character key containing the marker: a clean 400", async () => {
    const { rig, response } = await run("(b)", { key: KEY_129, rawBody: defaultBody }, (r) =>
      r.post(ROUTE, { headers: r.withKey(KEY_129), rawBody: defaultBody }),
    );
    expect(response.status).toBe(400);
    expect(rig.seen).toHaveLength(0);
  });
  it("(c) a key with DEL and the marker: a clean 400", async () => {
    const { rig, response } = await run("(c)", { key: KEY_DEL, rawBody: defaultBody }, (r) =>
      r.post(ROUTE, { headers: r.withKey(KEY_DEL), rawBody: defaultBody }),
    );
    expect(response.status).toBe(400);
    expect(rig.seen).toHaveLength(0);
  });
  it("(d) a body with the marker and a normalize that throws it: a clean 500", async () => {
    const { rig, response } = await run("(d)", { key: KEY_A, rawBody: markerBody }, (r) =>
      r.post(`/api/v1/test/fc/normalize-body-marker/${ORDER_REF}`, {
        headers: r.withKey(KEY_A),
        rawBody: markerBody,
      }),
    );
    expect(response.status).toBe(500);
    expect(rig.seen).toHaveLength(0);
  });

  it("the completion log keeps the fixed key set of an ordinary route (no new field)", async () => {
    const plain = idempotencyRig();
    await plain.post(`/api/v1/test/plain/${ORDER_REF}`);
    const baseline = Object.keys(plain.completions()[0] ?? {}).sort();
    expect(baseline.length).toBeGreaterThan(0);
    const cases: [string, (r: ReturnType<typeof idempotencyRig>) => Promise<Response>][] = [
      ["accepted", (r) => r.post(ROUTE, { headers: r.withKey(KEY_A) })],
      ["rejected", (r) => r.post(ROUTE, { headers: r.withKey(KEY_129) })],
      [
        "500",
        (r) =>
          r.post(`/api/v1/test/fc/normalize-body-marker/${ORDER_REF}`, {
            headers: r.withKey(KEY_A),
          }),
      ],
    ];
    for (const [label, send] of cases) {
      const rig = idempotencyRig();
      await send(rig);
      expect(rig.completions(), label).toHaveLength(1);
      expect(Object.keys(rig.completions()[0] ?? {}).sort(), label).toEqual(baseline);
    }
  });
});
