// PR-L2-1b C1. TC-DB-AUTH-001-002 (G1): the request schema of API-AUTH-003 in @off-r39x/api-contract and
// the route registry / Rate Limit class of the Operation (SPEC-110 §25/§56.1, API-RLC-001/002/005). The
// response reuses currentProfileSchema (UCR-110-010). Static only: synthetic values, no network, database
// or environment variables.
import { provisionCurrentProfileRequestSchema } from "@off-r39x/api-contract";
import { assertRouteRegistry } from "@off-r39x/security";
import { describe, expect, it } from "vitest";
import { classifyRequest, LOGGED_ROUTE_TEMPLATES, ROUTES } from "../../apps/api/src/api/routes.ts";

const PATH = "/api/v1/self/profile/provision";

describe("TC-DB-AUTH-001-002 provisionCurrentProfileRequestSchema (API-AUTH-003 Body {}, SEC-API-029, SPEC-110 §54)", () => {
  it("is exported and accepts {} only", () => {
    expect(typeof provisionCurrentProfileRequestSchema?.safeParse).toBe("function");
    const parsed = provisionCurrentProfileRequestSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({});
  });

  const rejected: [string, unknown][] = [
    ...["display_name", "profile_ref", "auth_subject", "role", "roles", "email"].map(
      (key): [string, unknown] => [`an unknown field ${key}`, { [key]: "x" }],
    ),
    ["a parsed __proto__ key", JSON.parse('{"__proto__":{"role":"ADMINISTRATOR"}}')],
    ["null", null],
    ["an array", []],
    ["a string", "x"],
    ["a number", 1],
    ["undefined", undefined],
  ];
  it.each(rejected)("rejects %s", (_label, body) => {
    expect(provisionCurrentProfileRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe("TC-DB-AUTH-001-002 route registry and Rate Limit class (API-RLC-001/002/005, SPEC-110 §56.1)", () => {
  const registered = () => ROUTES.filter((route) => route.path === PATH);

  it("registers POST as API-AUTH-003 / profile_mutation, once, without resource references", () => {
    expect(registered()).toEqual([
      {
        method: "POST",
        path: PATH,
        operationId: "API-AUTH-003",
        rateLimitClass: "profile_mutation",
      },
    ]);
    expect(registered()[0]).not.toHaveProperty("resourceReferences");
  });

  it("the whole registry passes assertRouteRegistry", () => {
    expect(() => assertRouteRegistry(ROUTES)).not.toThrow();
  });

  it("classifyRequest(POST) is profile_mutation / API-AUTH-003 and no other method is classified", () => {
    expect(classifyRequest("POST", PATH)).toEqual({
      classId: "profile_mutation",
      operationId: "API-AUTH-003",
    });
    for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE"])
      expect(classifyRequest(method, PATH), method).toBeUndefined();
  });

  it("the completion log route template list carries the path once", () => {
    expect([...LOGGED_ROUTE_TEMPLATES].filter((template) => template === PATH)).toHaveLength(1);
  });
});
