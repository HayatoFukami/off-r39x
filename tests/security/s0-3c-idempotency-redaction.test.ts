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
  // Digests of the accepted request, computed by an accepted call on a separate rig.
  async function reference() {
    const rig = idempotencyRig();
    const response = await rig.post(ROUTE, { headers: rig.withKey(KEY_A) });
    expect(response.status).toBe(200);
    const context = rig.seen[0]?.context as { keyDigest: Uint8Array; requestDigest: Uint8Array };
    return context;
  }

  async function run(
    label: string,
    send: (rig: ReturnType<typeof idempotencyRig>) => Promise<Response>,
  ) {
    const known = await reference();
    const keySha = createHash("sha256").update(KEY_A, "utf8").digest();
    expect(Buffer.from(known.keyDigest).equals(keySha), `${label} oracle`).toBe(true);
    const forbidden = [KEY_A, MARKER, ...digestForms(keySha), ...digestForms(known.requestDigest)];
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

  it("(a) an accepted key: the response and every log line stay clean; the context holds no raw key", async () => {
    const { rig, response } = await run("(a)", (r) =>
      r.post(ROUTE, {
        headers: r.withKey(KEY_A),
        rawBody: JSON.stringify({ ...goodBody, note: "synthetic note" }),
      }),
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
    const { rig, response } = await run("(b)", (r) =>
      r.post(ROUTE, { headers: r.withKey(KEY_129) }),
    );
    expect(response.status).toBe(400);
    expect(rig.seen).toHaveLength(0);
  });
  it("(c) a key with DEL and the marker: a clean 400", async () => {
    const { rig, response } = await run("(c)", (r) =>
      r.post(ROUTE, { headers: r.withKey(KEY_DEL) }),
    );
    expect(response.status).toBe(400);
    expect(rig.seen).toHaveLength(0);
  });
  it("(d) a body with the marker and a normalize that throws it: a clean 500", async () => {
    const { rig, response } = await run("(d)", (r) =>
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
