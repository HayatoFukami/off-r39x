// PR-L2-1a C1 (TC-API-007-001, G4): HTTP contract of API-AUTH-002 (GET) and API-AUTH-004 (PATCH)
// /api/v1/self/profile on createApp with a stub Principal store, a recording CurrentProfileStore
// (AppDependencies.profiles) and the in-memory rate limit. Decisions of the user (plan, G-a): a store
// not_found after the guard is 500 INTERNAL_ERROR (OI-2). A display name that is not well-formed (a lone
// surrogate sent as a JSON escape such as \uD800) is 400 VALIDATION_FAILED and is never stored as U+FFFD
// (UCR-030-001, SPEC-110 v2.7.0 API-AUTH-004). Every refusal also asserts the store was not written
// (TST-GEN-002).
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createCurrentProfileRepository } from "../../packages/db/src/index.ts";
import {
  BAD,
  bearer,
  createRecordingProfileStore,
  DIRECTORY_EMAIL,
  errorOf,
  GOOD,
  OTHER_SUBJECT,
  PROFILE_PATH,
  PROFILE_REF,
  principalRow,
  SUBJECT,
  selfProfileRig,
  UPDATED_AT,
  WEB,
} from "../harness/api/self-profile.ts";
import { createFakePool } from "../harness/db/fake-pool.ts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const completion = (records: Record<string, unknown>[]) =>
  records.filter((r) => r.event_name === "http.request.completed");

describe("TC-API-007-001 GET /api/v1/self/profile (API-AUTH-002, SPEC-110 §17/§24/§55, AR-OWN-006)", () => {
  it("returns exactly { data: { profile_ref, display_name, updated_at }, meta: { request_id } } for the verified subject only", async () => {
    const r = selfProfileRig();
    const res = await r.get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown;
    expect(body).toEqual({
      data: {
        profile_ref: PROFILE_REF,
        display_name: null,
        updated_at: "2026-11-01T00:00:00.000Z",
      },
      meta: { request_id: res.headers.get("X-Request-Id") },
    });
    expect(res.headers.get("X-Request-Id")).toMatch(UUID_V4);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(r.store.reads).toEqual([SUBJECT]);
    expect(r.store.updates).toEqual([]);
  });

  it("keeps a NULL display name as null and never fills it from the directory (the Email) or the Auth name", async () => {
    const r = selfProfileRig();
    const text = await (await r.get()).text();
    expect(JSON.parse(text).data.display_name).toBeNull();
    expect(text).not.toContain(DIRECTORY_EMAIL);
    expect(text).not.toContain("example.test");
  });

  it("returns a stored display name unchanged", async () => {
    const store = createRecordingProfileStore({
      [SUBJECT]: { publicRef: PROFILE_REF, displayName: "synthetic name", updatedAt: UPDATED_AT },
    });
    const res = await selfProfileRig({ store }).get();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      profile_ref: PROFILE_REF,
      display_name: "synthetic name",
      updated_at: UPDATED_AT,
    });
  });

  it("HEAD is served by the GET handler with no body", async () => {
    const r = selfProfileRig();
    const res = await r.send(PROFILE_PATH, { method: "HEAD", headers: bearer });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(r.store.updates).toEqual([]);
  });

  it("PUT, POST and DELETE are 405 with Allow: GET, HEAD, PATCH (Origin sent, so the refusal is the method)", async () => {
    for (const method of ["PUT", "POST", "DELETE"]) {
      const r = selfProfileRig();
      const res = await r.send(PROFILE_PATH, {
        method,
        headers: { ...bearer, Origin: WEB, "Content-Type": "application/json" },
        body: "{}",
      });
      expect(res.status, method).toBe(405);
      expect(res.headers.get("Allow"), method).toBe("GET, HEAD, PATCH");
      expect((await errorOf(res)).code, method).toBe("METHOD_NOT_ALLOWED");
      expect(r.store.updates, method).toEqual([]);
    }
  });
});

describe("TC-API-007-001 PATCH /api/v1/self/profile success (API-AUTH-004, SPEC-030 §9.2, DB-TIM-003 via the store contract)", () => {
  const cases: [label: string, sent: string | null, stored: string | null][] = [
    ["a plain name", "synthetic name", "synthetic name"],
    ["a name with surrounding spaces is trimmed", "  synthetic name  ", "synthetic name"],
    ["a name with surrounding U+3000 is trimmed", "　synthetic name　", "synthetic name"],
    ["an all-space name becomes null", "   ", null],
    ["null clears the name", null, null],
    ["80 characters", "a".repeat(80), "a".repeat(80)],
    ["80 emoji (160 UTF-16 units)", "\u{1F600}".repeat(80), "\u{1F600}".repeat(80)],
  ];
  it.each(cases)("%s", async (_label, sent, stored) => {
    const r = selfProfileRig();
    const res = await r.patch({ display_name: sent });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      data: { profile_ref: PROFILE_REF, display_name: stored, updated_at: UPDATED_AT },
      meta: { request_id: res.headers.get("X-Request-Id") },
    });
    // One write, for the verified subject only, with the normalized value; nothing else is touched.
    expect(r.store.updates).toEqual([[SUBJECT, stored]]);
    expect(r.store.row(SUBJECT)?.displayName).toBe(stored);
    expect(r.store.row(OTHER_SUBJECT)?.displayName).toBe("other-synthetic");
  });

  it("a PATCH is not a GET: the read path is not used and the response is the row the update returned", async () => {
    const r = selfProfileRig();
    expect((await r.patch({ display_name: "synthetic name" })).status).toBe(200);
    expect(r.store.reads).toEqual([]);
  });

  it("Idempotency-Key is ignored (SPEC-110 §18, API-IDM-003): the same key twice writes twice, with the same result", async () => {
    const r = selfProfileRig();
    const headers = { "Idempotency-Key": "00000000-0000-4000-8000-0000000000b1" };
    const first = await r.patch({ display_name: "synthetic name" }, headers);
    const second = await r.patch({ display_name: "synthetic name" }, headers);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect((await first.json()).data).toEqual((await second.json()).data);
    expect(r.store.updates).toEqual([
      [SUBJECT, "synthetic name"],
      [SUBJECT, "synthetic name"],
    ]);
  });

  it("completion log carries the Operation ID and route template, and one authorization decision", async () => {
    for (const [method, operationId] of [
      ["GET", "API-AUTH-002"],
      ["PATCH", "API-AUTH-004"],
    ] as const) {
      const r = selfProfileRig();
      const res =
        method === "GET" ? await r.get() : await r.patch({ display_name: "synthetic name" });
      expect(res.status, method).toBe(200);
      expect(completion(r.records), method).toHaveLength(1);
      expect(completion(r.records)[0], method).toMatchObject({
        operation_id: operationId,
        http_route: PROFILE_PATH,
        http_method: method,
        http_status: 200,
      });
      expect(
        r.records.filter((x) => x.event_name === "authorization.decision.completed"),
        method,
      ).toHaveLength(1);
    }
  });
});

describe("TC-API-007-001 PATCH refusals before the store (SPEC-110 §13/§16/§20/§21, SEC-API-022, SEC-API-029)", () => {
  const invalid: [label: string, body: string][] = [
    ["an empty object", "{}"],
    ["an unknown field", '{"display_name":"a","extra":1}'],
    ["a number", '{"display_name":1}'],
    ["an array value", '{"display_name":["a"]}'],
    ["a boolean body", "true"],
    ["an array body", "[]"],
    ["81 characters", JSON.stringify({ display_name: "a".repeat(81) })],
    ["81 emoji", JSON.stringify({ display_name: "\u{1F600}".repeat(81) })],
    ["a NUL character (JSON escape)", '{"display_name":"a\\u0000b"}'],
    ["a tab inside (JSON escape)", '{"display_name":"a\\tb"}'],
    ["U+0085 at the start (JSON escape)", '{"display_name":"\\u0085name"}'],
    ["Cc and too long", JSON.stringify({ display_name: "a\u0000".repeat(50) })],
    // UCR-030-001: JSON.parse keeps a lone surrogate written as an escape; the bytes on the wire are ASCII.
    ["a lone high surrogate (JSON escape \\uD800)", '{"display_name":"\\uD800"}'],
    ["a lone low surrogate (JSON escape \\uDC00)", '{"display_name":"\\uDC00"}'],
    ["a reversed pair (\\uDC00\\uD800)", '{"display_name":"\\uDC00\\uD800"}'],
    ["a lone surrogate mixed with text", '{"display_name":"synthetic \\uD800 name"}'],
    ["a lone surrogate after a valid pair", '{"display_name":"\\uD83D\\uDE00\\uDBFF"}'],
  ];
  it.each(invalid)("400 VALIDATION_FAILED for %s, no write, details null", async (_label, body) => {
    const r = selfProfileRig();
    const res = await r.patchRaw(body);
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.details).toBeNull();
    expect(r.store.updates).toEqual([]);
    expect(r.store.reads).toEqual([]);
    expect(r.store.row(SUBJECT)?.displayName).toBeNull();
    // Body validation comes after authentication (the Principal was resolved once).
    expect(r.principalReads()).toBe(1);
  });

  it("a lone surrogate leaves an existing name unchanged and is not replaced by U+FFFD (UCR-030-001)", async () => {
    const r = selfProfileRig();
    expect((await r.patch({ display_name: "synthetic name" })).status).toBe(200);
    const res = await r.patchRaw('{"display_name":"synthetic \\uD800"}');
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("VALIDATION_FAILED");
    expect(r.store.updates).toEqual([[SUBJECT, "synthetic name"]]);
    expect(r.store.row(SUBJECT)?.displayName).toBe("synthetic name");
  });

  it("a correctly paired surrogate sent as JSON escapes is accepted as one code point (UCR-030-001)", async () => {
    const r = selfProfileRig();
    const res = await r.patchRaw('{"display_name":" a\\uD83D\\uDE00b "}');
    expect(res.status).toBe(200);
    expect((await res.json()).data.display_name).toBe("a\u{1F600}b");
    expect(r.store.updates).toEqual([[SUBJECT, "a\u{1F600}b"]]);
  });

  const malformed: [label: string, body: string][] = [
    ["broken JSON", '{"display_name":'],
    ["an empty body", ""],
    ["a duplicate key", '{"display_name":"a","display_name":"b"}'],
  ];
  it.each(malformed)("400 MALFORMED_REQUEST for %s, no write", async (_label, body) => {
    const r = selfProfileRig();
    const res = await r.patchRaw(body);
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe("MALFORMED_REQUEST");
    expect(error.details).toBeNull();
    expect(r.store.updates).toEqual([]);
  });

  it("415 UNSUPPORTED_MEDIA_TYPE for text/plain, a missing Content-Type and a non-UTF-8 charset, no write", async () => {
    const text = '{"display_name":"synthetic name"}';
    const withType = (type: string) => ({ ...bearer, Origin: WEB, "Content-Type": type });
    const attempts: [string, Record<string, string>][] = [
      ["text/plain", withType("text/plain")],
      ["no content type", { ...bearer, Origin: WEB }],
      ["iso-8859-1", withType("application/json; charset=iso-8859-1")],
    ];
    for (const [label, headers] of attempts) {
      // A string body makes the runtime add text/plain; send bytes so a missing Content-Type stays missing.
      const body = new TextEncoder().encode(text);
      if (label === "no content type") {
        const probe = new Request(`http://localhost${PROFILE_PATH}`, {
          method: "PATCH",
          headers,
          body,
        });
        expect(probe.headers.get("content-type"), label).toBeNull();
      }
      const r = selfProfileRig();
      const res = await r.send(PROFILE_PATH, { method: "PATCH", headers, body });
      expect(res.status, label).toBe(415);
      expect((await errorOf(res)).code, label).toBe("UNSUPPORTED_MEDIA_TYPE");
      expect(r.store.updates, label).toEqual([]);
    }
  });

  it("413 PAYLOAD_TOO_LARGE above 64 KiB, no write", async () => {
    const r = selfProfileRig();
    const res = await r.patchRaw(JSON.stringify({ display_name: "a".repeat(65537) }));
    expect(res.status).toBe(413);
    expect((await errorOf(res)).code).toBe("PAYLOAD_TOO_LARGE");
    expect(r.store.updates).toEqual([]);
  });

  it("a token-less request with an invalid body is 401, not 400 (body validation follows authentication)", async () => {
    const r = selfProfileRig();
    const res = await r.send(PROFILE_PATH, {
      method: "PATCH",
      headers: { Origin: WEB, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe("AUTHENTICATION_REQUIRED");
    expect(r.store.updates).toEqual([]);
    expect(r.principalReads()).toBe(0);
  });
});

describe("TC-API-007-001 authentication and authorization refusals never reach the profile store (SPEC-110 §24, AR-AZ-003)", () => {
  const refusals: [
    label: string,
    rig: () => ReturnType<typeof selfProfileRig>,
    status: number,
    code: string,
  ][] = [
    [
      "an unverified Email",
      () => selfProfileRig({ principal: () => principalRow("unverified") }),
      403,
      "EMAIL_VERIFICATION_REQUIRED",
    ],
    [
      "a missing Business Profile",
      () => selfProfileRig({ principal: () => principalRow("no_profile") }),
      403,
      "AUTHORIZATION_DENIED",
    ],
    [
      "an inconsistent directory row",
      () => selfProfileRig({ principal: () => principalRow("inconsistent") }),
      409,
      "CONSISTENCY_REVIEW_REQUIRED",
    ],
    [
      "a Principal store failure",
      () =>
        selfProfileRig({
          principal: () => {
            throw new Error("synthetic directory failure");
          },
        }),
      503,
      "DATABASE_TEMPORARY_FAILURE",
    ],
  ];
  for (const method of ["GET", "PATCH"] as const) {
    it.each(refusals)(`${method}: %s`, async (_label, make, status, code) => {
      const r = make();
      const res =
        method === "GET"
          ? await r.get("", { Authorization: `Bearer ${GOOD}` })
          : await r.patch({ display_name: "synthetic name" });
      expect(res.status).toBe(status);
      expect((await errorOf(res)).code).toBe(code);
      expect(r.store.reads).toEqual([]);
      expect(r.store.updates).toEqual([]);
      expect(r.store.row(SUBJECT)?.displayName).toBeNull();
    });
  }

  it("a request without a token is 401 for GET and PATCH", async () => {
    const r = selfProfileRig();
    expect((await r.get("", {})).status).toBe(401);
    const res = await r.send(PROFILE_PATH, {
      method: "PATCH",
      headers: { Origin: WEB, "Content-Type": "application/json" },
      body: '{"display_name":"synthetic name"}',
    });
    expect(res.status).toBe(401);
    expect(r.store.reads).toEqual([]);
    expect(r.store.updates).toEqual([]);
  });

  it("an invalid token (BAD) is 401 for GET and PATCH and touches nothing", async () => {
    const r = selfProfileRig();
    const patched = await r.patch(
      { display_name: "synthetic name" },
      { Authorization: `Bearer ${BAD}` },
    );
    expect(patched.status).toBe(401);
    expect((await r.get("", { Authorization: `Bearer ${BAD}` })).status).toBe(401);
    expect(r.store.reads).toEqual([]);
    expect(r.store.updates).toEqual([]);
    expect(r.principalReads()).toBe(0);
  });
});

describe("TC-API-007-001 store results map to the SPEC-110 §21/§51 errors (OI-2 decided: not_found -> 500)", () => {
  const faults = [
    ["FP.DB.INSIDE_STATEMENT", "unavailable", 503, "DATABASE_TEMPORARY_FAILURE", true],
    ["PROFILE.ROW_MISSING", "not_found after the guard (OI-2)", 500, "INTERNAL_ERROR", false],
    ["PROFILE.STORE_THROWS", "an unclassified store error", 500, "INTERNAL_ERROR", false],
  ] as const;
  for (const method of ["GET", "PATCH"] as const) {
    it.each(faults)(`${method}: %s: %s`, async (point, _label, status, code, retryable) => {
      const r = selfProfileRig();
      r.store.inject(point);
      const res =
        method === "GET" ? await r.get() : await r.patch({ display_name: "synthetic name" });
      expect(res.status).toBe(status);
      const error = await errorOf(res);
      expect(error.code).toBe(code);
      expect(error.retryable).toBe(retryable);
      expect(error.details).toBeNull();
      // Never a partial success and never a new Profile.
      expect(r.store.row(SUBJECT)?.displayName).toBeNull();
    });
  }

  it("PATCH: an unknown commit outcome is 503 DATABASE_TEMPORARY_FAILURE (retryable), not a success", async () => {
    const r = selfProfileRig();
    r.store.inject("FP.DB.AFTER_COMMIT_SENT_BEFORE_ACK");
    const res = await r.patch({ display_name: "synthetic name" });
    expect(res.status).toBe(503);
    const error = await errorOf(res);
    expect(error.code).toBe("DATABASE_TEMPORARY_FAILURE");
    expect(error.retryable).toBe(true);
    expect(r.store.updates).toEqual([[SUBJECT, "synthetic name"]]);
  });

  it("without the profiles dependency GET and PATCH fail closed with 503 TEMPORARY_UNAVAILABLE, before the Principal store", async () => {
    for (const method of ["GET", "PATCH"] as const) {
      const r = selfProfileRig({ omitProfiles: true });
      const res =
        method === "GET" ? await r.get() : await r.patch({ display_name: "synthetic name" });
      expect(res.status, method).toBe(503);
      expect((await errorOf(res)).code, method).toBe("TEMPORARY_UNAVAILABLE");
      expect(r.principalReads(), method).toBe(0);
      expect(r.store.updates, method).toEqual([]);
    }
  });
});

// PR #66 round 6 (F1 / Issue #69): with the real repository behind the route, the same DB failure gets
// the same answer on GET and PATCH, and the answer is the common boundary's: a temporary DNS failure
// (EAI_AGAIN) is 503 DATABASE_TEMPORARY_FAILURE (retryable) and a statement timeout (57014) is
// 500 INTERNAL_ERROR. No DNS and no PostgreSQL: the pool rejects with a synthetic error.
describe("TC-API-007-001 the real repository's DB failures answer like the common boundary (SPEC-110 §21/§50/§51, Issue #69)", () => {
  const CONTROL = /^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)\b/;
  const repositoryFailingWith = (code: string) => {
    const failure = () => Object.assign(new Error("synthetic-db-failure"), { code });
    const fake = createFakePool(({ sql }) =>
      typeof sql === "string" && CONTROL.test(sql) ? undefined : failure(),
    );
    const pool = Object.assign(fake.pool, {
      query: async () => {
        throw failure();
      },
    }) as unknown as Pool;
    return createCurrentProfileRepository(pool);
  };
  const cases = [
    ["EAI_AGAIN", 503, "DATABASE_TEMPORARY_FAILURE", true],
    ["08006", 503, "DATABASE_TEMPORARY_FAILURE", true],
    ["57014", 500, "INTERNAL_ERROR", false],
    // PR #71 review: too many connections is PostgreSQL refusing the connection (SPEC-110 §51).
    ["53300", 503, "DATABASE_TEMPORARY_FAILURE", true],
    ["53200", 500, "INTERNAL_ERROR", false],
  ] as const;
  for (const method of ["GET", "PATCH"] as const) {
    it.each(cases)(`${method}: %s is %i %s`, async (code, status, errorCode, retryable) => {
      const r = selfProfileRig({ profiles: repositoryFailingWith(code) });
      const res =
        method === "GET" ? await r.get() : await r.patch({ display_name: "synthetic name" });
      expect(res.status).toBe(status);
      const error = await errorOf(res);
      expect(error.code).toBe(errorCode);
      expect(error.retryable).toBe(retryable);
      expect(error.details).toBeNull();
      expect(r.lines.join("\n")).not.toContain("synthetic-db-failure");
    });
  }
});

// PR #66 round 6: SPEC-110 §9 returns profile_ref as a lower-case canonical UUID. A store that hands
// back an upper- or mixed-case reference is a producer defect: GET and PATCH answer 500 INTERNAL_ERROR
// through the common error envelope and never send the reference.
describe("TC-API-007-001 a profile_ref that is not lower case is never sent (SPEC-110 §9/§19)", () => {
  const refs = [
    ["upper case", PROFILE_REF.toUpperCase().replace(/^[0-9]{8}/, "ABCDEF00")],
    ["mixed case", `abcdef00${PROFILE_REF.slice(8, -1)}F`],
  ] as const;
  for (const method of ["GET", "PATCH"] as const) {
    it.each(refs)(`${method}: %s is 500 INTERNAL_ERROR`, async (_label, ref) => {
      expect(ref).not.toBe(ref.toLowerCase());
      const store = createRecordingProfileStore({
        [SUBJECT]: { publicRef: ref, displayName: null, updatedAt: UPDATED_AT },
      });
      const r = selfProfileRig({ store });
      const res =
        method === "GET" ? await r.get() : await r.patch({ display_name: "synthetic name" });
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).not.toContain(ref);
      const error = (JSON.parse(text) as { error: { code: string; details: unknown } }).error;
      expect(error.code).toBe("INTERNAL_ERROR");
      expect(error.details).toBeNull();
    });
  }
});
