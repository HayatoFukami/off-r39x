// PR-L2-1a C1. TC-API-007-003 (G1): the Zod schemas of API-AUTH-002 (response) and API-AUTH-004
// (request) in @off-r39x/api-contract. TC-API-007-004 (G1): the route registry and Rate Limit class
// assignment of the two Operations (SPEC-110 §56.1, API-RLC-001/002/005). Static only: synthetic values,
// no network, database or environment variables.
import { currentProfileSchema, updateCurrentProfileRequestSchema } from "@off-r39x/api-contract";
import { assertRouteRegistry } from "@off-r39x/security";
import { describe, expect, it } from "vitest";
import { classifyRequest, LOGGED_ROUTE_TEMPLATES, ROUTES } from "../../apps/api/src/api/routes.ts";

const PROFILE_REF = "00000000-0000-4000-8000-0000000000a3";
const PATH = "/api/v1/self/profile";
const validProfile = {
  profile_ref: PROFILE_REF,
  display_name: "synthetic",
  updated_at: "2026-11-19T00:00:00.000Z",
};

describe("TC-API-007-003 request and response schemas (DEV-API-003, SPEC-110 §8/§10/§54, SEC-API-029)", () => {
  it("exports both schemas by name", () => {
    expect(typeof currentProfileSchema?.safeParse).toBe("function");
    expect(typeof updateCurrentProfileRequestSchema?.safeParse).toBe("function");
  });

  it.each([
    ["a name", { display_name: "x" }],
    ["null", { display_name: null }],
    ["an empty string (the length rule belongs to the domain)", { display_name: "" }],
    [
      "a 100 character string (the length rule belongs to the domain)",
      { display_name: "a".repeat(100) },
    ],
  ])("request accepts %s", (_label, body) => {
    const result = updateCurrentProfileRequestSchema.safeParse(body);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(body);
  });

  const rejectedBodies: [string, unknown][] = [
    ["an empty object (display_name is required)", {}],
    ["a number", { display_name: 1 }],
    ["a boolean body", true],
    ["an array body", []],
    ["null body", null],
    ["a string body", "x"],
    ["an array value", { display_name: ["a"] }],
    ["an object value", { display_name: {} }],
    ["undefined value", { display_name: undefined }],
    ...[
      "profile_ref",
      "auth_subject",
      "role",
      "roles",
      "owner",
      "profile_id",
      "user_id",
      "email",
      "name",
      "updated_at",
      "public_ref",
      "id",
      "capabilities",
    ].map((key): [string, unknown] => [
      `an unknown field ${key} next to display_name`,
      { display_name: "x", [key]: "00000000-0000-4000-8000-0000000000a9" },
    ]),
    [
      "a parsed __proto__ key",
      JSON.parse('{"display_name":"x","__proto__":{"role":"ADMINISTRATOR"}}'),
    ],
  ];
  it.each(rejectedBodies)("request rejects %s", (_label, body) => {
    expect(updateCurrentProfileRequestSchema.safeParse(body).success).toBe(false);
  });

  it("response accepts the documented shape, including display_name null", () => {
    expect(currentProfileSchema.safeParse(validProfile).success).toBe(true);
    const parsed = currentProfileSchema.safeParse({ ...validProfile, display_name: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({ ...validProfile, display_name: null });
  });

  it.each([
    ["auth_subject", { auth_subject: "00000000-0000-4000-8000-0000000000a1" }],
    ["id", { id: "1" }],
    ["email", { email: "directory-owner@example.test" }],
  ])("response is strict: an extra %s fails", (_key, extra) => {
    expect(currentProfileSchema.safeParse({ ...validProfile, ...extra }).success).toBe(false);
  });

  it.each([
    ["without milliseconds", "2026-11-19T00:00:00Z"],
    ["with an offset", "2026-11-19T09:00:00.000+09:00"],
    ["with microseconds", "2026-11-19T00:00:00.123456Z"],
    ["date only", "2026-11-19"],
    ["not a string", 1763510400000],
  ])("response rejects updated_at %s (SPEC-110 §10)", (_label, updatedAt) => {
    expect(currentProfileSchema.safeParse({ ...validProfile, updated_at: updatedAt }).success).toBe(
      false,
    );
  });

  // SPEC-110 §10: the value must be a real UTC instant, not only the right shape. Checked through
  // currentProfileSchema and through its updated_at field schema (isoUtcTimestampSchema is not part of
  // the package surface).
  const updatedAtSchema = currentProfileSchema.shape.updated_at;
  const impossibleTimestamps: [string, string][] = [
    ["a nonexistent day 2026-02-30", "2026-02-30T00:00:00.000Z"],
    ["2026-02-29 in a common year", "2026-02-29T00:00:00.000Z"],
    ["2026-04-31", "2026-04-31T00:00:00.000Z"],
    ["month 13", "2026-13-01T00:00:00.000Z"],
    ["month 00", "2026-00-10T00:00:00.000Z"],
    ["day 00", "2026-01-00T00:00:00.000Z"],
    ["day 32", "2026-01-32T00:00:00.000Z"],
    ["1900-02-29 (divisible by 100, not by 400)", "1900-02-29T00:00:00.000Z"],
    ["hour 24", "2026-01-01T24:00:00.000Z"],
    ["hour 25", "2026-01-01T25:00:00.000Z"],
    ["minute 60", "2026-01-01T23:60:00.000Z"],
    ["second 60", "2026-01-01T23:59:60.000Z"],
    ["a lowercase z", "2026-01-01T00:00:00.000z"],
    ["a space instead of T", "2026-01-01 00:00:00.000Z"],
  ];
  it.each(impossibleTimestamps)(
    "response rejects updated_at %s (SPEC-110 §10)",
    (_label, value) => {
      expect(currentProfileSchema.safeParse({ ...validProfile, updated_at: value }).success).toBe(
        false,
      );
      expect(updatedAtSchema.safeParse(value).success).toBe(false);
    },
  );

  const validTimestamps: [string, string][] = [
    ["a leap day", "2024-02-29T23:59:59.999Z"],
    ["2000-02-29 (divisible by 400)", "2000-02-29T00:00:00.000Z"],
    ["the last instant of a year", "2026-12-31T23:59:59.999Z"],
    ["the first instant of a year", "2026-01-01T00:00:00.000Z"],
    ["Date#toISOString output", new Date(Date.UTC(2026, 10, 19, 12, 34, 56, 789)).toISOString()],
    ["Date#toISOString of the epoch", new Date(0).toISOString()],
  ];
  it.each(validTimestamps)("response accepts updated_at %s (SPEC-110 §10)", (_label, value) => {
    const parsed = currentProfileSchema.safeParse({ ...validProfile, updated_at: value });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.updated_at).toBe(value);
    expect(updatedAtSchema.safeParse(value).success).toBe(true);
  });

  it("response keeps nullable and optional apart: display_name omitted fails (SPEC-110 §8)", () => {
    const { display_name: _omitted, ...withoutName } = validProfile;
    expect(currentProfileSchema.safeParse(withoutName).success).toBe(false);
  });

  // PR #66 round 6: SPEC-110 §9 returns a Public Reference as a lower-case canonical UUID; z.uuid()
  // alone accepts upper case, so the response schema pins the case.
  it.each([
    ["all upper case", "ABCDEF00-0000-4000-8000-0000000000B1"],
    ["mixed case", "abcdef00-0000-4000-8000-0000000000B1"],
    ["one upper-case hex digit", "abcdef00-0000-4000-8000-0000000000bF"],
  ])("response rejects a profile_ref in %s", (_label, ref) => {
    expect(currentProfileSchema.safeParse({ ...validProfile, profile_ref: ref }).success).toBe(
      false,
    );
    expect(
      currentProfileSchema.safeParse({ ...validProfile, profile_ref: ref.toLowerCase() }).success,
    ).toBe(true);
  });

  it("response rejects a profile_ref that is not a UUID and a missing updated_at", () => {
    expect(
      currentProfileSchema.safeParse({ ...validProfile, profile_ref: "not-a-uuid" }).success,
    ).toBe(false);
    const { updated_at: _omitted, ...withoutTime } = validProfile;
    expect(currentProfileSchema.safeParse(withoutTime).success).toBe(false);
  });
});

describe("TC-API-007-004 route registry and Rate Limit class (API-RLC-001/002/005, SEC-ABU-017, SPEC-110 §56.1)", () => {
  const registered = (method: string) =>
    ROUTES.filter((route) => route.method === method && route.path === PATH);

  it("registers GET as API-AUTH-002 / self_read and PATCH as API-AUTH-004 / profile_mutation, once each", () => {
    expect(registered("GET")).toEqual([
      { method: "GET", path: PATH, operationId: "API-AUTH-002", rateLimitClass: "self_read" },
    ]);
    expect(registered("PATCH")).toEqual([
      {
        method: "PATCH",
        path: PATH,
        operationId: "API-AUTH-004",
        rateLimitClass: "profile_mutation",
      },
    ]);
  });

  it("neither route has resource references (no Stage 3 rule: API-RLC-005)", () => {
    for (const route of [...registered("GET"), ...registered("PATCH")])
      expect(route).not.toHaveProperty("resourceReferences");
  });

  it("the whole registry still passes assertRouteRegistry", () => {
    expect(() => assertRouteRegistry(ROUTES)).not.toThrow();
  });

  it.each([
    ["GET", "self_read", "API-AUTH-002"],
    ["HEAD", "self_read", "API-AUTH-002"],
    ["PATCH", "profile_mutation", "API-AUTH-004"],
  ])("classifyRequest(%s) is %s / %s", (method, classId, operationId) => {
    expect(classifyRequest(method, PATH)).toEqual({ classId, operationId });
  });

  it("an unregistered method on the path is not classified", () => {
    for (const method of ["POST", "PUT", "DELETE"])
      expect(classifyRequest(method, PATH), method).toBeUndefined();
  });

  it("the completion log route template list carries the path once", () => {
    expect([...LOGGED_ROUTE_TEMPLATES].filter((template) => template === PATH)).toHaveLength(1);
  });
});
