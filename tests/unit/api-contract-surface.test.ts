import {
  type AppType,
  type CurrentProfile,
  createPublicRpc,
  currentProfileSchema,
  type ErrorCode,
  errorSchema,
  errorStatuses,
  type PrincipalNavigation,
  principalNavigationSchema,
  provisionCurrentProfileRequestSchema,
  successSchema,
  type UpdateCurrentProfileRequest,
  updateCurrentProfileRequestSchema,
} from "@off-r39x/api-contract";
import type { Context, Env } from "hono";
import { hc } from "hono/client";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";

// PR-S0-1a C1: pins the public surface and the envelope/Principal schemas of
// @off-r39x/api-contract. The expected values were recorded by running the pre-split
// packages/api-contract/src/index.ts, not derived from the implementation. Everything is addressed
// through the package name, so the file split in PR-S0-1a (schemas/*.ts, rpc.ts) must not require
// changing this file. Static only: synthetic UUIDs, no network, database or environment variables.
// The compile-time assertions (expectTypeOf) are no-ops under vitest; `pnpm typecheck` for the
// tests workspace enforces them.

const PROFILE_REF = "00000000-0000-4000-8000-000000000001";
const REQUEST_ID = "00000000-0000-4000-8000-000000000002";
// PR-L2-1a C1: the profile Operations (API-AUTH-002/004, SPEC-110 §25) widen the surface. These
// expectations changed by the specification (two new routes and their schemas), not by the
// implementation: the exports, route list and builder dependencies below follow the plan.
// PR-L2-1b C1: API-AUTH-003 (SPEC-110 §25) adds one more route and its request schema. Again a change by
// the specification, not by the implementation (the export count becomes eight and the builder gains
// profileProvision).
const PROFILE: CurrentProfile = {
  profile_ref: PROFILE_REF,
  display_name: "synthetic name",
  updated_at: "2026-11-19T00:00:00.000Z",
};

const EXPECTED_ERROR_STATUSES = [
  ["MALFORMED_REQUEST", 400],
  ["VALIDATION_FAILED", 400],
  ["AUTHENTICATION_REQUIRED", 401],
  ["EMAIL_VERIFICATION_REQUIRED", 403],
  ["AUTHORIZATION_DENIED", 403],
  ["RESOURCE_NOT_FOUND", 404],
  ["METHOD_NOT_ALLOWED", 405],
  ["STATE_CONFLICT", 409],
  ["SOLD_OUT", 409],
  ["SLOT_UNAVAILABLE", 409],
  ["SLOT_GENERATION_OVERLAP", 409],
  ["INVENTORY_UNAVAILABLE", 409],
  ["PURCHASE_LIMIT_EXCEEDED", 409],
  ["IDEMPOTENCY_KEY_REUSED", 409],
  ["BUSINESS_OPPORTUNITY_EXPIRED", 410],
  ["PAYLOAD_TOO_LARGE", 413],
  ["UNSUPPORTED_MEDIA_TYPE", 415],
  ["RATE_LIMIT_EXCEEDED", 429],
  ["DOMAIN_RULE_VIOLATION", 422],
  ["OUTSIDE_CHECKIN_WINDOW", 422],
  ["STRIPE_TEMPORARY_FAILURE", 424],
  ["DATABASE_TEMPORARY_FAILURE", 503],
  ["AUTH_SERVICE_TEMPORARY_FAILURE", 503],
  ["TEMPORARY_UNAVAILABLE", 503],
  ["CONSISTENCY_REVIEW_REQUIRED", 409],
  ["INTERNAL_ERROR", 500],
];

const principal: PrincipalNavigation = {
  profile_ref: PROFILE_REF,
  capabilities: ["capability.synthetic"],
  has_staff_role: false,
  has_administrator_role: true,
};

type ParseSummary =
  | { success: true; data: unknown }
  | { success: false; issues: [string, PropertyKey[]][] };

function summarize(result: z.ZodSafeParseResult<unknown>): ParseSummary {
  return result.success
    ? { success: true, data: result.data }
    : {
        success: false,
        issues: result.error.issues.map(({ code, path }) => [code, path]),
      };
}

function errorEnvelope(
  error: Record<string, unknown> = {},
  top: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "synthetic message",
      request_id: REQUEST_ID,
      retryable: false,
      details: null,
      ...error,
    },
    ...top,
  };
}

function successEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { data: { name: "synthetic" }, meta: { request_id: REQUEST_ID }, ...overrides };
}

function buildApp(
  principalValue: () => PrincipalNavigation = () => principal,
  profileValue: () => CurrentProfile = () => PROFILE,
) {
  const pass = async (_c: Context<Env>, next: () => Promise<void>) => {
    await next();
  };
  return createPublicRpc<Env>({
    guard: pass,
    principal: (_c: Context<Env>) => principalValue(),
    requestId: (_c: Context<Env>) => REQUEST_ID,
    profileRead: { guard: pass, load: async (_c: Context<Env>) => profileValue() },
    profileUpdate: { guard: pass, body: pass, save: async (_c: Context<Env>) => profileValue() },
    profileProvision: {
      guard: pass,
      body: pass,
      provision: async (_c: Context<Env>) => ({ created: true, profile: profileValue() }),
    },
  });
}

describe("TC-DEV-API-002-001 public surface of @off-r39x/api-contract", () => {
  // S0-3a adds errorRetryable (SPEC-110 section 21 Retryable column); L2-1a adds the two profile
  // schemas. The five earlier values are unchanged. S0-3b: SPEC-110 section 12 / 48.3 list schemas
  // (listDataSchema, listQuerySchema, pageQuery) are added (a change by the specification).
  // L2-1b adds provisionCurrentProfileRequestSchema (API-AUTH-003, SPEC-110 §25).
  it("exports exactly the twelve runtime values", async () => {
    const surface = await import("@off-r39x/api-contract");
    expect(Object.keys(surface).sort()).toEqual([
      "createPublicRpc",
      "currentProfileSchema",
      "errorRetryable",
      "errorSchema",
      "errorStatuses",
      "listDataSchema",
      "listQuerySchema",
      "pageQuery",
      "principalNavigationSchema",
      "provisionCurrentProfileRequestSchema",
      "successSchema",
      "updateCurrentProfileRequestSchema",
    ]);
    expect(currentProfileSchema.safeParse(PROFILE).success).toBe(true);
    expect(updateCurrentProfileRequestSchema.safeParse({ display_name: null }).success).toBe(true);
    expect(provisionCurrentProfileRequestSchema.safeParse({}).success).toBe(true);
    expect(provisionCurrentProfileRequestSchema.safeParse({ display_name: null }).success).toBe(
      false,
    );
  });

  it("keeps the public type exports (compile-time only)", () => {
    expectTypeOf<ErrorCode>().toEqualTypeOf<
      | "MALFORMED_REQUEST"
      | "VALIDATION_FAILED"
      | "AUTHENTICATION_REQUIRED"
      | "EMAIL_VERIFICATION_REQUIRED"
      | "AUTHORIZATION_DENIED"
      | "RESOURCE_NOT_FOUND"
      | "METHOD_NOT_ALLOWED"
      | "STATE_CONFLICT"
      | "SOLD_OUT"
      | "SLOT_UNAVAILABLE"
      | "SLOT_GENERATION_OVERLAP"
      | "INVENTORY_UNAVAILABLE"
      | "PURCHASE_LIMIT_EXCEEDED"
      | "IDEMPOTENCY_KEY_REUSED"
      | "BUSINESS_OPPORTUNITY_EXPIRED"
      | "PAYLOAD_TOO_LARGE"
      | "UNSUPPORTED_MEDIA_TYPE"
      | "RATE_LIMIT_EXCEEDED"
      | "DOMAIN_RULE_VIOLATION"
      | "OUTSIDE_CHECKIN_WINDOW"
      | "STRIPE_TEMPORARY_FAILURE"
      | "DATABASE_TEMPORARY_FAILURE"
      | "AUTH_SERVICE_TEMPORARY_FAILURE"
      | "TEMPORARY_UNAVAILABLE"
      | "CONSISTENCY_REVIEW_REQUIRED"
      | "INTERNAL_ERROR"
    >();
    expectTypeOf<PrincipalNavigation>().toEqualTypeOf<{
      profile_ref: string;
      capabilities: string[];
      has_staff_role: boolean;
      has_administrator_role: boolean;
    }>();
    expectTypeOf<CurrentProfile>().toEqualTypeOf<{
      profile_ref: string;
      display_name: string | null;
      updated_at: string;
    }>();
    expectTypeOf<UpdateCurrentProfileRequest>().toEqualTypeOf<{ display_name: string | null }>();
    expectTypeOf<AppType>().toEqualTypeOf<ReturnType<typeof createPublicRpc>>();
    const client = hc<AppType>("http://api.example.test");
    expectTypeOf(client.api.v1.self.principal.$get).toBeFunction();
    expectTypeOf(client.api.v1.self.profile.$get).toBeFunction();
    expectTypeOf(client.api.v1.self.profile.$patch).toBeFunction();
    expectTypeOf(client.api.v1.self.profile.provision.$post).toBeFunction();
  });

  it("registers only GET /api/v1/self/principal, GET and PATCH /api/v1/self/profile and POST /api/v1/self/profile/provision (guard, body validator and handler entries)", () => {
    expect(buildApp().routes.map(({ method, path }) => [method, path])).toEqual([
      ["GET", "/api/v1/self/principal"],
      ["GET", "/api/v1/self/principal"],
      ["GET", "/api/v1/self/profile"],
      ["GET", "/api/v1/self/profile"],
      ["PATCH", "/api/v1/self/profile"],
      ["PATCH", "/api/v1/self/profile"],
      ["PATCH", "/api/v1/self/profile"],
      ["POST", "/api/v1/self/profile/provision"],
      ["POST", "/api/v1/self/profile/provision"],
      ["POST", "/api/v1/self/profile/provision"],
    ]);
  });

  it("answers GET and PATCH /api/v1/self/profile with the data/meta envelope built from the injected profile", async () => {
    const app = buildApp();
    for (const method of ["GET", "PATCH"]) {
      const response = await app.request("/api/v1/self/profile", { method });
      expect(response.status, method).toBe(200);
      expect(await response.json(), method).toEqual({
        data: PROFILE,
        meta: { request_id: REQUEST_ID },
      });
    }
  });

  it("rejects a profile with an extra key or a non-millisecond updated_at through the strict schema (500, no body detail)", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      for (const bad of [
        { ...PROFILE, auth_subject: "synthetic-subject" },
        { ...PROFILE, updated_at: "2026-11-19T00:00:00Z" },
      ]) {
        const app = buildApp(undefined, () => bad as CurrentProfile);
        for (const method of ["GET", "PATCH"]) {
          const response = await app.request("/api/v1/self/profile", { method });
          expect(response.status, method).toBe(500);
          expect(await response.text(), method).toBe("Internal Server Error");
        }
      }
    } finally {
      logged.mockRestore();
    }
  });

  it("answers POST /api/v1/self/profile/provision with 201 for a created and 200 for an existing profile, in the data/meta envelope", async () => {
    for (const [created, status] of [
      [true, 201],
      [false, 200],
    ] as const) {
      const pass = async (_c: Context<Env>, next: () => Promise<void>) => {
        await next();
      };
      const app = createPublicRpc<Env>({
        guard: pass,
        principal: (_c: Context<Env>) => principal,
        requestId: (_c: Context<Env>) => REQUEST_ID,
        profileRead: { guard: pass, load: async (_c: Context<Env>) => PROFILE },
        profileUpdate: { guard: pass, body: pass, save: async (_c: Context<Env>) => PROFILE },
        profileProvision: {
          guard: pass,
          body: pass,
          provision: async (_c: Context<Env>) => ({ created, profile: PROFILE }),
        },
      });
      const response = await app.request("/api/v1/self/profile/provision", { method: "POST" });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ data: PROFILE, meta: { request_id: REQUEST_ID } });
    }
  });

  it("answers GET /api/v1/self/principal with the data/meta envelope", async () => {
    const response = await buildApp().request("/api/v1/self/principal");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        profile_ref: PROFILE_REF,
        capabilities: ["capability.synthetic"],
        has_staff_role: false,
        has_administrator_role: true,
      },
      meta: { request_id: REQUEST_ID },
    });
  });

  it("does not register other methods or paths", async () => {
    const app = buildApp();
    expect((await app.request("/api/v1/self/principal", { method: "POST" })).status).toBe(404);
    expect((await app.request("/api/v1/self/profile", { method: "POST" })).status).toBe(404);
    expect((await app.request("/api/v1/self/profile", { method: "PUT" })).status).toBe(404);
    expect((await app.request("/api/v1/self/profile/provision")).status).toBe(404);
    expect((await app.request("/api/v1/self/profile/provision", { method: "PATCH" })).status).toBe(
      404,
    );
    expect((await app.request("/api/v1/other")).status).toBe(404);
  });

  it("rejects a principal with an extra key through the strict schema (500, no body detail)", async () => {
    // Hono's default onError logs the ZodError; silence it, the status/body are what is pinned.
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const app = buildApp(
        () => ({ ...principal, auth_subject: "synthetic-subject" }) as PrincipalNavigation,
      );
      const response = await app.request("/api/v1/self/principal");
      expect(response.status).toBe(500);
      expect(await response.text()).toBe("Internal Server Error");
    } finally {
      logged.mockRestore();
    }
  });
});

describe("TC-DEV-API-003-001 error table and envelope schemas", () => {
  it("keeps the 26 error codes with their HTTP statuses in order", () => {
    expect(Object.entries(errorStatuses)).toEqual(EXPECTED_ERROR_STATUSES);
    expect(errorStatuses.METHOD_NOT_ALLOWED).toBe(405);
    expect(errorStatuses.UNSUPPORTED_MEDIA_TYPE).toBe(415);
    expect(errorStatuses.RATE_LIMIT_EXCEEDED).toBe(429);
    expect(errorStatuses.STRIPE_TEMPORARY_FAILURE).toBe(424);
  });

  // S0-3a: errorSchema.error is a discriminated union on `code` (SPEC-110 section 16), one variant per
  // code. The code list is read from each variant's literal discriminator, in variant order.
  function variantCodes(): string[] {
    return errorSchema.shape.error.options.map((variant) => variant.shape.code.value);
  }

  it("derives the errorSchema variants from the same ordered list", () => {
    expect(variantCodes()).toEqual(EXPECTED_ERROR_STATUSES.map(([code]) => code));
    expect(variantCodes()).toEqual(Object.keys(errorStatuses));
  });

  const errorCases: [string, Record<string, unknown>, ParseSummary][] = [
    ["METHOD_NOT_ALLOWED envelope", errorEnvelope(), { success: true, data: errorEnvelope() }],
    [
      "UNSUPPORTED_MEDIA_TYPE envelope",
      errorEnvelope({ code: "UNSUPPORTED_MEDIA_TYPE" }),
      { success: true, data: errorEnvelope({ code: "UNSUPPORTED_MEDIA_TYPE" }) },
    ],
    [
      "unknown code",
      errorEnvelope({ code: "NOT_A_CODE" }),
      // S0-3a: discriminated union change. Zod 4 reports "no matching discriminator" as an
      // invalid_union issue at the discriminator path instead of the enum's invalid_value.
      { success: false, issues: [["invalid_union", ["error", "code"]]] },
    ],
    [
      "extra key in error",
      errorEnvelope({ extra: 1 }),
      { success: false, issues: [["unrecognized_keys", ["error"]]] },
    ],
    [
      "extra key at top level",
      errorEnvelope({}, { extra: 1 }),
      { success: false, issues: [["unrecognized_keys", []]] },
    ],
    [
      "non-null details",
      errorEnvelope({ details: {} }),
      { success: false, issues: [["invalid_type", ["error", "details"]]] },
    ],
    [
      "request_id that is not a UUID",
      errorEnvelope({ request_id: "not-a-uuid" }),
      { success: false, issues: [["invalid_format", ["error", "request_id"]]] },
    ],
    [
      "missing retryable",
      {
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "synthetic message",
          request_id: REQUEST_ID,
          details: null,
        },
      },
      // S0-3a: discriminated union change. METHOD_NOT_ALLOWED fixes retryable to the literal false
      // (SPEC-110 section 21), so a missing value is an invalid_value, not the boolean's invalid_type.
      { success: false, issues: [["invalid_value", ["error", "retryable"]]] },
    ],
  ];

  it.each(errorCases)("errorSchema: %s", (_label, input, expected) => {
    expect(summarize(errorSchema.safeParse(input))).toEqual(expected);
  });

  const successCases: [string, Record<string, unknown>, ParseSummary][] = [
    ["valid envelope", successEnvelope(), { success: true, data: successEnvelope() }],
    [
      "extra key in meta",
      successEnvelope({ meta: { request_id: REQUEST_ID, extra: 1 } }),
      { success: false, issues: [["unrecognized_keys", ["meta"]]] },
    ],
    [
      "missing meta",
      { data: { name: "synthetic" } },
      { success: false, issues: [["invalid_type", ["meta"]]] },
    ],
    [
      "meta.request_id that is not a UUID",
      successEnvelope({ meta: { request_id: "not-a-uuid" } }),
      { success: false, issues: [["invalid_format", ["meta", "request_id"]]] },
    ],
    [
      "data that does not match the inner schema",
      successEnvelope({ data: { name: 1 } }),
      { success: false, issues: [["invalid_type", ["data", "name"]]] },
    ],
    [
      "extra key at top level",
      successEnvelope({ extra: 1 }),
      { success: false, issues: [["unrecognized_keys", []]] },
    ],
  ];

  it.each(successCases)("successSchema: %s", (_label, input, expected) => {
    const schema = successSchema(z.strictObject({ name: z.string() }));
    expect(summarize(schema.safeParse(input))).toEqual(expected);
  });

  it("successSchema is a factory: independently built schemas agree", () => {
    const first = successSchema(z.strictObject({ name: z.string() }));
    const second = successSchema(z.strictObject({ name: z.string() }));
    expect(first).not.toBe(second);
    for (const [, input, expected] of successCases) {
      expect(summarize(first.safeParse(input))).toEqual(expected);
      expect(summarize(second.safeParse(input))).toEqual(expected);
    }
  });

  const principalCases: [string, Record<string, unknown>, ParseSummary][] = [
    ["valid principal", { ...principal }, { success: true, data: { ...principal } }],
    [
      "extra key auth_subject",
      { ...principal, auth_subject: "synthetic-subject" },
      { success: false, issues: [["unrecognized_keys", []]] },
    ],
    [
      "profile_ref that is not a UUID",
      { ...principal, profile_ref: "not-a-uuid" },
      { success: false, issues: [["invalid_format", ["profile_ref"]]] },
    ],
    [
      "capabilities that is not an array",
      { ...principal, capabilities: "capability.synthetic" },
      { success: false, issues: [["invalid_type", ["capabilities"]]] },
    ],
  ];

  it.each(principalCases)("principalNavigationSchema: %s", (_label, input, expected) => {
    expect(summarize(principalNavigationSchema.safeParse(input))).toEqual(expected);
  });
});
