// PR-L2-1b C1 (TC-DB-AUTH-001-001, G4): HTTP contract of API-AUTH-003 POST /api/v1/self/profile/provision
// on createApp with a stub Principal store, a recording CurrentProfileStore (AppDependencies.profiles) and
// the in-memory rate limit. The success data has the shape of API-AUTH-002 ({ profile_ref, display_name,
// updated_at }; a new Profile has display_name null), as SPEC-110 v2.10.0 §25 API-AUTH-003 states
// (UCR-110-010, INCORPORATED). Every refusal also asserts that the store was
// not asked to provision (TST-GEN-002). Synthetic data only.
import { describe, expect, it } from "vitest";
import {
  BAD,
  bearer,
  createdRef,
  createRecordingProfileStore,
  DIRECTORY_EMAIL,
  errorOf,
  OTHER_SUBJECT,
  PROFILE_REF,
  PROVISION_PATH,
  principalFollowing,
  principalRow,
  SUBJECT,
  selfProfileRig,
  UPDATED_AT,
  WEB,
} from "../harness/api/self-profile.ts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const completion = (records: Record<string, unknown>[]) =>
  records.filter((r) => r.event_name === "http.request.completed");

/** A rig whose subject has no Business Profile yet and whose Principal source follows the store. */
function emptyRig(options: Parameters<typeof selfProfileRig>[0] = {}) {
  const store = createRecordingProfileStore({});
  return selfProfileRig({ store, principal: principalFollowing(store), ...options });
}

describe("TC-DB-AUTH-001-001 POST /api/v1/self/profile/provision success (API-AUTH-003, SPEC-110 §19/§25, AR-ID-004)", () => {
  it("201 for a verified subject without a Profile: { data: { profile_ref, display_name: null, updated_at }, meta }", async () => {
    const r = emptyRig();
    const res = await r.provision();
    expect(res.status).toBe(201);
    expect(res.headers.get("X-Request-Id")).toMatch(UUID_V4);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      data: { profile_ref: createdRef(1), display_name: null, updated_at: UPDATED_AT },
      meta: { request_id: res.headers.get("X-Request-Id") },
    });
    expect(r.store.provisions).toEqual([SUBJECT]);
    expect(r.store.row(SUBJECT)?.displayName).toBeNull();
  });

  it("200 with the existing values for a subject that has a Profile; a stored name is returned unchanged", async () => {
    const r = selfProfileRig();
    const res = await r.provision();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        profile_ref: PROFILE_REF,
        display_name: null,
        updated_at: "2026-11-01T00:00:00.000Z",
      },
      meta: { request_id: res.headers.get("X-Request-Id") },
    });
    expect(r.store.provisions).toEqual([SUBJECT]);
    const named = selfProfileRig({
      store: createRecordingProfileStore({
        [SUBJECT]: { publicRef: PROFILE_REF, displayName: "synthetic name", updatedAt: UPDATED_AT },
      }),
    });
    expect((await (await named.provision()).json()).data.display_name).toBe("synthetic name");
  });

  it("a Profile with an Administrator Role is 200 too, and the store is still asked once (OI-8)", async () => {
    const r = selfProfileRig({ principal: () => principalRow("admin") });
    const res = await r.provision();
    expect(res.status).toBe(200);
    expect((await res.json()).data.profile_ref).toBe(PROFILE_REF);
    expect(r.store.provisions).toEqual([SUBJECT]);
  });

  it("the second request is 200 with the same profile_ref as the first 201", async () => {
    const r = emptyRig();
    const first = await r.provision();
    const second = await r.provision();
    expect([first.status, second.status]).toEqual([201, 200]);
    expect((await first.json()).data).toEqual((await second.json()).data);
    expect(r.store.provisions).toEqual([SUBJECT, SUBJECT]);
  });

  it("the data never carries the directory Email, the Auth Subject or an internal id", async () => {
    const r = emptyRig();
    const text = await (await r.provision()).text();
    expect(Object.keys(JSON.parse(text).data).sort()).toEqual([
      "display_name",
      "profile_ref",
      "updated_at",
    ]);
    expect(text).not.toContain(DIRECTORY_EMAIL);
    expect(text).not.toContain(SUBJECT);
  });

  it("Idempotency-Key is ignored (SPEC-110 §18, API-IDM-003): the same key twice reaches the store twice, 201 then 200", async () => {
    const r = emptyRig();
    const headers = { "Idempotency-Key": "00000000-0000-4000-8000-0000000000b1" };
    const first = await r.provision("{}", headers);
    const second = await r.provision("{}", headers);
    expect([first.status, second.status]).toEqual([201, 200]);
    expect(r.store.provisions).toEqual([SUBJECT, SUBJECT]);
  });

  it("an unknown query is ignored: the store gets the token's subject only (AR-ID-002)", async () => {
    const r = emptyRig();
    const res = await r.provision("{}", {}, `?auth_subject=${OTHER_SUBJECT}`);
    expect(res.status).toBe(201);
    expect(r.store.provisions).toEqual([SUBJECT]);
    expect(r.store.row(OTHER_SUBJECT)).toBeUndefined();
  });

  it("the completion log carries API-AUTH-003, the route template, POST and the status; no authorization decision (no Capability)", async () => {
    const created = emptyRig();
    expect((await created.provision()).status).toBe(201);
    expect((await created.provision()).status).toBe(200);
    const logs = completion(created.records);
    expect(logs).toHaveLength(2);
    expect(logs.map((x) => x.http_status)).toEqual([201, 200]);
    for (const log of logs)
      expect(log).toMatchObject({
        operation_id: "API-AUTH-003",
        http_route: PROVISION_PATH,
        http_method: "POST",
      });
    expect(
      created.records.filter((x) => x.event_name === "authorization.decision.completed"),
    ).toEqual([]);
  });

  it("the actor of the completion log: a 201 (no Profile resolved) is AUTHENTICATED_USER with a fingerprint, not the raw subject; a 200 carries the Profile's public reference (SPEC-160 §19.1, OI-6)", async () => {
    const creating = emptyRig();
    expect((await creating.provision()).status).toBe(201);
    const [createdLog] = completion(creating.records);
    expect(createdLog?.http_status).toBe(201);
    expect(createdLog?.actor_type).toBe("AUTHENTICATED_USER");
    expect(typeof createdLog?.actor_ref).toBe("string");
    expect(createdLog?.actor_ref).not.toBe(SUBJECT);
    expect(creating.lines.join(String.fromCharCode(10))).not.toContain(SUBJECT);

    const existing = selfProfileRig();
    expect((await existing.provision()).status).toBe(200);
    const [existingLog] = completion(existing.records);
    expect(existingLog?.http_status).toBe(200);
    expect(existingLog?.actor_type).toBe("AUTHENTICATED_USER");
    expect(existingLog?.actor_ref).toBe(PROFILE_REF);
  });

  it("a request that proceeds without a Profile is not logged as a rejected Business Profile resolution (OI-6)", async () => {
    const r = emptyRig();
    expect((await r.provision()).status).toBe(201);
    expect(r.records.filter((x) => x.error_code === "BUSINESS_PROFILE_UNRESOLVED")).toEqual([]);
    expect(
      r.records.filter((x) => x.event_name === "auth.email_verified_resolution.completed"),
    ).toHaveLength(1);
  });
});

describe("TC-DB-AUTH-001-001 body validation (SPEC-110 §13/§16/§54, SEC-API-022, SEC-API-029)", () => {
  const invalid: [label: string, body: string][] = [
    ["an unknown field", '{"x":1}'],
    ["display_name null", '{"display_name":null}'],
    ["another person's auth_subject", `{"auth_subject":"${OTHER_SUBJECT}"}`],
    ["null", "null"],
    ["an array", "[]"],
    ["a string", '"s"'],
    ["true", "true"],
  ];
  it.each(invalid)(
    "400 VALIDATION_FAILED for %s, nothing provisioned, details null",
    async (_l, body) => {
      const r = emptyRig();
      const res = await r.provision(body);
      expect(res.status).toBe(400);
      const error = await errorOf(res);
      expect(error.code).toBe("VALIDATION_FAILED");
      expect(error.details).toBeNull();
      expect(r.store.provisions).toEqual([]);
      expect(r.store.row(SUBJECT)).toBeUndefined();
      // Body validation comes after authentication.
      expect(r.principalReads()).toBe(1);
    },
  );

  const malformed: [label: string, body: string][] = [
    ["an empty body", ""],
    ["broken JSON", "{"],
    ["a duplicate key", '{"a":1,"a":2}'],
  ];
  it.each(malformed)("400 MALFORMED_REQUEST for %s, nothing provisioned", async (_l, body) => {
    const r = emptyRig();
    const res = await r.provision(body);
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("MALFORMED_REQUEST");
    expect(r.store.provisions).toEqual([]);
  });

  it("415 for text/plain, a missing Content-Type and a non-UTF-8 charset", async () => {
    const attempts: [string, Record<string, string>][] = [
      ["text/plain", { ...bearer, Origin: WEB, "Content-Type": "text/plain" }],
      ["no content type", { ...bearer, Origin: WEB }],
      [
        "iso-8859-1",
        { ...bearer, Origin: WEB, "Content-Type": "application/json; charset=iso-8859-1" },
      ],
    ];
    for (const [label, headers] of attempts) {
      const r = emptyRig();
      // Bytes, so a missing Content-Type stays missing.
      const res = await r.send(PROVISION_PATH, {
        method: "POST",
        headers,
        body: new TextEncoder().encode("{}"),
      });
      expect(res.status, label).toBe(415);
      expect((await errorOf(res)).code, label).toBe("UNSUPPORTED_MEDIA_TYPE");
      expect(r.store.provisions, label).toEqual([]);
    }
  });

  it("413 above 64 KiB, nothing provisioned", async () => {
    const r = emptyRig();
    const res = await r.provision(JSON.stringify({ x: "a".repeat(65537) }));
    expect(res.status).toBe(413);
    expect((await errorOf(res)).code).toBe("PAYLOAD_TOO_LARGE");
    expect(r.store.provisions).toEqual([]);
  });

  it("no token with an invalid body is 401, and the Principal store is not read", async () => {
    const r = emptyRig();
    const res = await r.send(PROVISION_PATH, {
      method: "POST",
      headers: { Origin: WEB, "Content-Type": "application/json" },
      body: '{"x":1}',
    });
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe("AUTHENTICATION_REQUIRED");
    expect(r.principalReads()).toBe(0);
    expect(r.store.provisions).toEqual([]);
  });

  it("an invalid token is 401 and creates nothing", async () => {
    const r = emptyRig();
    const res = await r.provision("{}", { Authorization: `Bearer ${BAD}` });
    expect(res.status).toBe(401);
    expect(r.principalReads()).toBe(0);
    expect(r.store.provisions).toEqual([]);
  });
});

describe("TC-DB-AUTH-001-001 methods and paths (SPEC-110 §14/§15)", () => {
  it("GET, PUT, PATCH and DELETE on the provision path are 405 with Allow: POST", async () => {
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      const r = emptyRig();
      const res = await r.send(PROVISION_PATH, {
        method,
        headers: { ...bearer, Origin: WEB, "Content-Type": "application/json" },
        ...(method === "GET" ? {} : { body: "{}" }),
      });
      expect(res.status, method).toBe(405);
      expect(res.headers.get("Allow"), method).toBe("POST");
      expect((await errorOf(res)).code, method).toBe("METHOD_NOT_ALLOWED");
      expect(r.store.provisions, method).toEqual([]);
    }
  });

  it("POST /api/v1/self/profile is still 405 with Allow: GET, HEAD, PATCH", async () => {
    const r = emptyRig();
    const res = await r.send("/api/v1/self/profile", {
      method: "POST",
      headers: { ...bearer, Origin: WEB, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD, PATCH");
    expect(r.store.provisions).toEqual([]);
  });
});

describe("TC-DB-AUTH-001-001 store results map to the SPEC-110 §21/§51 errors", () => {
  it("FP.DB.INSIDE_STATEMENT is 503 DATABASE_TEMPORARY_FAILURE (retryable) and creates nothing", async () => {
    const r = emptyRig();
    r.store.inject("FP.DB.INSIDE_STATEMENT");
    const res = await r.provision();
    expect(res.status).toBe(503);
    const error = await errorOf(res);
    expect(error.code).toBe("DATABASE_TEMPORARY_FAILURE");
    expect(error.retryable).toBe(true);
    expect(r.store.row(SUBJECT)).toBeUndefined();
  });

  it("FP.DB.AFTER_COMMIT_SENT_BEFORE_ACK is 503, never a success; the resend converges to 200 with one row", async () => {
    const r = emptyRig();
    r.store.inject("FP.DB.AFTER_COMMIT_SENT_BEFORE_ACK");
    const lost = await r.provision();
    expect(lost.status).toBe(503);
    const error = await errorOf(lost);
    expect(error.code).toBe("DATABASE_TEMPORARY_FAILURE");
    expect(error.retryable).toBe(true);
    r.store.inject(undefined);
    const resent = await r.provision();
    expect(resent.status).toBe(200);
    expect((await resent.json()).data.profile_ref).toBe(createdRef(1));
    expect(r.store.row(SUBJECT)?.publicRef).toBe(createdRef(1));
  });

  it.each([["PROFILE.STORE_THROWS"], ["PROFILE.RESELECT_EMPTY"]] as const)(
    "%s is 500 INTERNAL_ERROR (not retryable), no partial success",
    async (point) => {
      const r = emptyRig();
      r.store.inject(point);
      const res = await r.provision();
      expect(res.status).toBe(500);
      const error = await errorOf(res);
      expect(error.code).toBe("INTERNAL_ERROR");
      expect(error.retryable).toBe(false);
      expect(error.details).toBeNull();
      expect(r.store.row(SUBJECT)).toBeUndefined();
    },
  );

  it("without the profiles dependency it fails closed with 503 TEMPORARY_UNAVAILABLE, before the Principal store", async () => {
    const r = selfProfileRig({ omitProfiles: true });
    const res = await r.provision();
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe("TEMPORARY_UNAVAILABLE");
    expect(r.principalReads()).toBe(0);
    expect(r.store.provisions).toEqual([]);
  });
});
