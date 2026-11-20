import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { type AddressInfo, connect } from "node:net";
import { describe, expect, it } from "vitest";
import { errorSchema } from "../../packages/api-contract/src/index.ts";
import {
  GOOD_KEY,
  goodBody,
  idempotencyRig,
  MARKER,
  ORDER_REF,
  PROFILE_REF,
  ROUTE,
  readError,
  WEB,
} from "../harness/api/transport-idempotency-rig.ts";

// PR-S0-3c C1 (G4 API, no DB / Redis): the Idempotency-Key header through HTTP on harness-only routes
// that mount requireTransportIdempotency (SPEC-110 section 18, API-IDM-011, API-IDM-005, section 21,
// section 24, DEV-API-007). Expected values come from SPEC-110 v2.9.0, not from the code. A passing
// 2xx is not the oracle: each case also checks that the handler did or did not run and what context
// value it received.

const FIXED_MESSAGE = "Request could not be completed.";
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest();

interface Ctx {
  operationId: string;
  principalProfileRef: string;
  keyDigest: Uint8Array;
  requestDigest: Uint8Array;
}
const ctxOf = (value: unknown) => value as Ctx;

async function expectFailure(
  response: Response,
  status: number,
  code: string,
  label: string,
): Promise<void> {
  const { text, error } = await readError(response);
  expect(response.status, label).toBe(status);
  expect(errorSchema.safeParse(JSON.parse(text)).success, label).toBe(true);
  expect(error.code, label).toBe(code);
  expect(error.retryable, label).toBe(false);
  expect(error.details, label).toBeNull();
  expect(error.message, label).toBe(FIXED_MESSAGE);
  expect(error.request_id, label).toBe(response.headers.get("X-Request-Id"));
  expect(response.headers.get("Cache-Control"), label).toBe("no-store");
}

/**
 * The manifest's expected_observability, asserted per case (SPEC-170 section 9): one completion log
 * per request whose http_status matches the response, and no log line holds a sent raw key (as is or
 * JSON-escaped) or the
 * key / request digest of any context the handler saw (hex in both cases, base64).
 */
function expectCompletionAndRedaction(
  rig: ReturnType<typeof idempotencyRig>,
  responses: readonly Response[],
  sentKeys: readonly string[],
  label: string,
): void {
  const completions = rig.completions();
  expect(completions, `${label} completions`).toHaveLength(responses.length);
  expect(
    completions.map((record) => record.http_status),
    `${label} http_status`,
  ).toEqual(responses.map((response) => response.status));
  const logged = rig.lines.join("\n");
  const keys = sentKeys.filter((key) => key.length > 0);
  const forms = (digest: Uint8Array) => {
    const buffer = Buffer.from(digest);
    const hex = buffer.toString("hex");
    return [hex, hex.toUpperCase(), buffer.toString("base64")];
  };
  const forbidden: string[] = [...keys];
  // A log line is JSON, so a key with a character JSON escapes (HTAB, for example) shows up escaped.
  for (const key of keys) forbidden.push(JSON.stringify(key).slice(1, -1), ...forms(sha256(key)));
  for (const seen of rig.seen) {
    if (seen.context === undefined) continue;
    const context = ctxOf(seen.context);
    forbidden.push(...forms(context.keyDigest), ...forms(context.requestDigest));
  }
  for (const text of forbidden) {
    expect(logged, `${label} log must not contain ${text.slice(0, 8)}...`).not.toContain(text);
  }
}

describe("TC-API-IDM-011-002 Idempotency-Key through HTTP (API-IDM-011, Acceptance 47)", () => {
  const rejected: [label: string, headers: Record<string, string> | undefined][] = [
    ["(a) no header", undefined],
    ["(b) an empty header", { "Idempotency-Key": "" }],
    ["(c) 15 characters", { "Idempotency-Key": "a".repeat(15) }],
    ["(d) 129 characters", { "Idempotency-Key": "a".repeat(129) }],
    ["(e) Latin-1 non-ASCII bytes", { "Idempotency-Key": "é".repeat(16) }],
    ["(f) an inner HTAB", { "Idempotency-Key": `abcdefgh\tijklmnop${"x".repeat(8)}` }],
  ];
  it.each(rejected)(
    "%s is 400 VALIDATION_FAILED and the handler does not run",
    async (label, headers) => {
      const rig = idempotencyRig();
      const response = await rig.post(ROUTE, { headers });
      await expectFailure(response, 400, "VALIDATION_FAILED", label);
      expect(rig.seen, label).toHaveLength(0);
      expectCompletionAndRedaction(rig, [response], [headers?.["Idempotency-Key"] ?? ""], label);
    },
  );

  const accepted: [label: string, key: string][] = [
    ["(g) 16 characters", "g".repeat(16)],
    ["(h) 128 characters", "h".repeat(128)],
    ["(i) a lowercase UUID", "00000000-0000-4000-8000-0000000000b1"],
  ];
  it.each(accepted)("%s is accepted with the digest of the sent value", async (label, key) => {
    const rig = idempotencyRig();
    const response = await rig.post(ROUTE, { headers: rig.withKey(key) });
    expect(response.status, label).toBe(200);
    expect(rig.seen, label).toHaveLength(1);
    const context = ctxOf(rig.seen[0]?.context);
    expect(context.operationId, label).toBe("API-ORD-002");
    expect(context.principalProfileRef, label).toBe(PROFILE_REF);
    expect(Buffer.from(context.keyDigest).equals(sha256(key)), label).toBe(true);
    expect(context.requestDigest, label).toHaveLength(32);
    expectCompletionAndRedaction(rig, [response], [key], label);
  });

  it("(j) surrounding spaces are removed by HTTP parsing; the parsed value is validated and hashed", async () => {
    const rig = idempotencyRig();
    const key = "j".repeat(16);
    const response = await rig.post(ROUTE, { headers: rig.withKey(`  ${key}  `) });
    expect(response.status).toBe(200);
    expect(rig.seen[0]?.header).toBe(key);
    expect(Buffer.from(ctxOf(rig.seen[0]?.context).keyDigest).equals(sha256(key))).toBe(true);
    expectCompletionAndRedaction(rig, [response], [key], "(j)");
  });

  it("(k) two header fields of the same name are one concatenated value, not one of them", async () => {
    const rig = idempotencyRig();
    const a = "a".repeat(16);
    const b = "b".repeat(16);
    const headers = new Headers();
    headers.append("Idempotency-Key", a);
    headers.append("Idempotency-Key", b);
    const response = await rig.post(ROUTE, { headers });
    expect(response.status).toBe(200);
    const received = rig.seen[0]?.header ?? "";
    // The separator is left to the HTTP implementation (API-IDM-011 2.), so it is not asserted.
    expect(received).toContain(a);
    expect(received).toContain(b);
    expect(received).not.toBe(a);
    expect(received).not.toBe(b);
    expect(Buffer.from(ctxOf(rig.seen[0]?.context).keyDigest).equals(sha256(received))).toBe(true);
    expectCompletionAndRedaction(rig, [response], [a, b, received], "(k)");
  });

  it("(l) two valid 64-character fields whose concatenation exceeds 128 are rejected", async () => {
    const rig = idempotencyRig();
    const headers = new Headers();
    headers.append("Idempotency-Key", "a".repeat(64));
    headers.append("Idempotency-Key", "b".repeat(64));
    const response = await rig.post(ROUTE, { headers });
    await expectFailure(response, 400, "VALIDATION_FAILED", "(l)");
    expect(rig.seen).toHaveLength(0);
    expectCompletionAndRedaction(rig, [response], ["a".repeat(64), "b".repeat(64)], "(l)");
  });

  describe("order against other checks is not fixed (API-IDM-011 4.): either failure, no handler", () => {
    it("(m) an invalid body and no header", async () => {
      const rig = idempotencyRig();
      const response = await rig.post(ROUTE, { rawBody: JSON.stringify({ items: [] }) });
      await expectFailure(response, 400, "VALIDATION_FAILED", "(m)");
      expect(rig.seen).toHaveLength(0);
      expectCompletionAndRedaction(rig, [response], [], "(m)");
    });
    it("(n) a malformed JSON body and no header", async () => {
      const rig = idempotencyRig();
      const response = await rig.post(ROUTE, { rawBody: "{" });
      const { error } = await readError(response.clone());
      expect(
        [
          [400, "MALFORMED_REQUEST"],
          [400, "VALIDATION_FAILED"],
        ],
        "(n) (status, code)",
      ).toContainEqual([response.status, error.code]);
      expect(error.details).toBeNull();
      expect(rig.seen).toHaveLength(0);
      expectCompletionAndRedaction(rig, [response], [], "(n)");
    });
    it("(o) text/plain and no header", async () => {
      const rig = idempotencyRig();
      const response = await rig.post(ROUTE, { contentType: "text/plain" });
      const { error } = await readError(response.clone());
      expect(
        [
          [415, "UNSUPPORTED_MEDIA_TYPE"],
          [400, "VALIDATION_FAILED"],
        ],
        "(o) (status, code)",
      ).toContainEqual([response.status, error.code]);
      expect(error.details).toBeNull();
      expect(rig.seen).toHaveLength(0);
      expectCompletionAndRedaction(rig, [response], [], "(o)");
    });
  });

  describe("authentication and authorization failures come first (API-IDM-011 4.)", () => {
    it("(p) no Principal: 401 AUTHENTICATION_REQUIRED, not 400", async () => {
      const rig = idempotencyRig();
      const response = await rig.post(`/api/v1/test/idempotent-a/${ORDER_REF}`);
      const { error } = await readError(response);
      expect(response.status).toBe(401);
      expect(error.code).toBe("AUTHENTICATION_REQUIRED");
      expect(rig.seen).toHaveLength(0);
      expectCompletionAndRedaction(rig, [response], [], "(p)");
    });
    it("(q) no Capability: 403 AUTHORIZATION_DENIED, not 400", async () => {
      const rig = idempotencyRig();
      const response = await rig.post(`/api/v1/test/idempotent-b/${ORDER_REF}`);
      const { error } = await readError(response);
      expect(response.status).toBe(403);
      expect(error.code).toBe("AUTHORIZATION_DENIED");
      expect(rig.seen).toHaveLength(0);
      expectCompletionAndRedaction(rig, [response], [], "(q)");
    });
  });

  describe("through the production Node HTTP adapter (@hono/node-server), separate header lines on the wire", () => {
    const CRLF = "\r\n";
    /**
     * Starts the rig's app on the same adapter as `apps/api/src/bootstrap`, writes one raw HTTP/1.1
     * request whose `Idempotency-Key` lines are given verbatim, and returns the status code and the
     * raw response text.
     */
    async function sendRaw(
      rig: ReturnType<typeof idempotencyRig>,
      keyLines: readonly string[],
    ): Promise<{ status: number; raw: string }> {
      const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
      const { serve } =
        require("@hono/node-server") as typeof import("../../apps/api/node_modules/@hono/node-server");
      const server = serve({ fetch: rig.app.fetch, port: 0, hostname: "127.0.0.1" });
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const port = (server.address() as AddressInfo).port;
      const body = JSON.stringify(goodBody);
      const head = [
        `POST ${ROUTE} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        `Origin: ${WEB}`,
        "Content-Type: application/json",
        `Content-Length: ${Buffer.byteLength(body)}`,
        "Connection: close",
        ...keyLines.map((value) => `Idempotency-Key:${value}`),
      ].join(CRLF);
      try {
        const raw = await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          const socket = connect(port, "127.0.0.1", () => {
            socket.write(`${head}${CRLF}${CRLF}${body}`);
          });
          socket.on("data", (chunk: Buffer) => chunks.push(chunk));
          socket.on("end", () => resolve(Buffer.concat(chunks).toString("latin1")));
          socket.on("error", reject);
        });
        const status = /^HTTP\/1\.1 (\d{3}) /.exec(raw)?.[1];
        expect(status).toBeDefined();
        return { status: Number(status), raw };
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }

    it("(r) two separate lines reach the middleware as one concatenated value, and that value is hashed", async () => {
      const rig = idempotencyRig();
      const a = "a".repeat(16);
      const b = "b".repeat(16);
      const { status } = await sendRaw(rig, [` ${a}`, ` ${b}`]);
      expect(status).toBe(200);
      const received = rig.seen[0]?.header ?? "";
      // The separator is left to the HTTP implementation (API-IDM-011 2.), so it is not asserted.
      expect(received).toContain(a);
      expect(received).toContain(b);
      expect(received).not.toBe(a);
      expect(received).not.toBe(b);
      expect(Buffer.from(ctxOf(rig.seen[0]?.context).keyDigest).equals(sha256(received))).toBe(
        true,
      );
      expectCompletionAndRedaction(rig, [new Response(null, { status })], [a, b, received], "(r)");
    });
    it("(s) spaces and tabs around the value are removed by HTTP parsing; the parsed value is hashed", async () => {
      const rig = idempotencyRig();
      const key = "s".repeat(16);
      const { status } = await sendRaw(rig, [` \t  ${key} \t `]);
      expect(status).toBe(200);
      expect(rig.seen[0]?.header).toBe(key);
      expect(Buffer.from(ctxOf(rig.seen[0]?.context).keyDigest).equals(sha256(key))).toBe(true);
      expectCompletionAndRedaction(rig, [new Response(null, { status })], [key], "(s)");
    });
    it("(t) two valid 64-character lines whose concatenation exceeds 128 are a 400, with no handler", async () => {
      const rig = idempotencyRig();
      const a = "a".repeat(64);
      const b = "b".repeat(64);
      const { status, raw } = await sendRaw(rig, [` ${a}`, ` ${b}`]);
      expect(status).toBe(400);
      expect(raw).toContain('"code":"VALIDATION_FAILED"');
      expect(raw).toContain('"details":null');
      expect(rig.seen).toHaveLength(0);
      expectCompletionAndRedaction(rig, [new Response(null, { status })], [a, b], "(t)");
    });
  });
});

describe("TC-API-IDM-005-003 digests over HTTP (API-IDM-005, TST-IDM-002, SEC-API-023, DEV-API-006)", () => {
  const reordered = `{"flag":true,"note":"synthetic note","items":[ { "quantity" : 2, "ref":"${ORDER_REF}" } ]}`;

  const responsesByRig = new WeakMap<object, Response[]>();
  const keysByRig = new WeakMap<object, string[]>();
  /** Completion-log and redaction check over every request this rig received. */
  const checkLogs = (rig: ReturnType<typeof idempotencyRig>, label: string) =>
    expectCompletionAndRedaction(
      rig,
      responsesByRig.get(rig) ?? [],
      keysByRig.get(rig) ?? [],
      label,
    );
  async function send(
    rig: ReturnType<typeof idempotencyRig>,
    key: string,
    options: { rawBody?: string; extra?: Record<string, string>; path?: string } = {},
  ) {
    const response = await rig.post(options.path ?? ROUTE, {
      headers: rig.withKey(key, options.extra),
      ...(options.rawBody === undefined ? {} : { rawBody: options.rawBody }),
    });
    expect(response.status).toBe(200);
    responsesByRig.set(rig, [...(responsesByRig.get(rig) ?? []), response]);
    keysByRig.set(rig, [...(keysByRig.get(rig) ?? []), key]);
    return ctxOf(rig.seen[rig.seen.length - 1]?.context);
  }
  const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

  it("(a)-(d) body order and spaces, X-Request-Id, Authorization and an uppercase path ref do not change either digest", async () => {
    const rig = idempotencyRig();
    const reference = await send(rig, GOOD_KEY);
    const variants = [
      await send(rig, GOOD_KEY, { rawBody: reordered }),
      await send(rig, GOOD_KEY, {
        extra: { "X-Request-Id": "00000000-0000-4000-8000-0000000000e1" },
      }),
      await send(rig, GOOD_KEY, { extra: { Authorization: "synthetic-credential-a" } }),
      await send(rig, GOOD_KEY, { extra: { Authorization: "synthetic-credential-b" } }),
      await send(rig, GOOD_KEY, { path: `/api/v1/test/idempotent/${ORDER_REF.toUpperCase()}` }),
      await send(rig, GOOD_KEY, { extra: { Cookie: "synthetic=a" } }),
      await send(rig, GOOD_KEY, { extra: { Cookie: "synthetic=b" } }),
    ];
    for (const [i, variant] of variants.entries()) {
      expect(same(variant.keyDigest, reference.keyDigest), `key ${i}`).toBe(true);
      expect(same(variant.requestDigest, reference.requestDigest), `request ${i}`).toBe(true);
    }
    expect(goodBody.items[0]?.ref).toBe(ORDER_REF);
    checkLogs(rig, "(a)-(d)");
  });
  it("(e) another key with the same body: the request digest is the same, the key digest differs", async () => {
    const rig = idempotencyRig();
    const first = await send(rig, GOOD_KEY);
    const second = await send(rig, "synthetic-idem-key-0002");
    expect(same(second.requestDigest, first.requestDigest)).toBe(true);
    expect(same(second.keyDigest, first.keyDigest)).toBe(false);
    checkLogs(rig, "(e)");
  });
  it("(f) the same key with another quantity: the key digest is the same, the request digest differs", async () => {
    const rig = idempotencyRig();
    const first = await send(rig, GOOD_KEY);
    const second = await send(rig, GOOD_KEY, {
      rawBody: JSON.stringify({ ...goodBody, items: [{ ref: ORDER_REF, quantity: 3 }] }),
    });
    expect(same(second.keyDigest, first.keyDigest)).toBe(true);
    expect(same(second.requestDigest, first.requestDigest)).toBe(false);
    checkLogs(rig, "(f)");
  });
  it("the context carries exactly four members and none holds the request id or the raw key", async () => {
    const rig = idempotencyRig();
    const requestId = "00000000-0000-4000-8000-0000000000e2";
    const context = await send(rig, GOOD_KEY, { extra: { "X-Request-Id": requestId } });
    expect(Object.keys(context).sort()).toEqual([
      "keyDigest",
      "operationId",
      "principalProfileRef",
      "requestDigest",
    ]);
    for (const value of Object.values(context)) {
      expect(value).not.toBe(GOOD_KEY);
      expect(String(value)).not.toContain(requestId);
    }
    checkLogs(rig, "context");
  });
});

describe("TC-DEV-API-007-002 a wiring defect fails closed with 500 (DEV-API-007, SPEC-110 section 24)", () => {
  const cases: [label: string, path: string][] = [
    ["(a) no Principal", "no-principal"],
    ["(b) no Operation ID", "no-operation"],
    ["(c) Operation ID differs from the middleware's", "mismatch"],
  ];
  it.each(cases)("%s: 500 even without a header (not 400)", async (label, name) => {
    const rig = idempotencyRig();
    const response = await rig.post(`/api/v1/test/fc/${name}/${ORDER_REF}`);
    await expectFailure(response, 500, "INTERNAL_ERROR", label);
    expect(rig.seen, label).toHaveLength(0);
    expectCompletionAndRedaction(rig, [response], [], label);
  });

  const normalizeFaults: [label: string, name: string][] = [
    ["(d) normalize throws a ZodError carrying a marker", "normalize-zod"],
    ["(e) normalize throws a database-like error", "normalize-pg"],
    ["(f) normalize returns an undefined body", "normalize-undefined"],
    ["(g) normalize returns a Date", "normalize-date"],
  ];
  it.each(normalizeFaults)("%s: 500 INTERNAL_ERROR, nothing leaks", async (label, name) => {
    const rig = idempotencyRig();
    const response = await rig.post(`/api/v1/test/fc/${name}/${ORDER_REF}`, {
      headers: rig.withKey(GOOD_KEY),
    });
    const text = await response.clone().text();
    await expectFailure(response, 500, "INTERNAL_ERROR", label);
    expect(rig.seen, label).toHaveLength(0);
    const headerText: string[] = [];
    response.headers.forEach((value, key) => {
      headerText.push(`${key}: ${value}`);
    });
    const logged = rig.lines.join("\n");
    for (const forbidden of [MARKER, "08006", "ZodError"]) {
      expect(text, `body ${forbidden}`).not.toContain(forbidden);
      expect(headerText.join("\n"), `headers ${forbidden}`).not.toContain(forbidden);
      expect(logged, `log ${forbidden}`).not.toContain(forbidden);
    }
    expect(rig.completions(), label).toHaveLength(1);
    expect(rig.completions()[0]?.http_status, label).toBe(500);
  });
});
