// PR-L2-1a review F1. TC-API-007-009 (G1): the public RPC type of PATCH /api/v1/self/profile
// (API-AUTH-004, DEV-API-002, SPEC-110 §15/§16) carries the JSON input of
// updateCurrentProfileRequestSchema. Compile-time only: the assertions are enforced by `pnpm typecheck`
// of the tests workspace (vitest treats them as no-ops) and the client is never called, so there is
// no network access.
import type { AppType } from "@off-r39x/api-contract";
import { hc, type InferRequestType } from "hono/client";
import { describe, expect, expectTypeOf, it } from "vitest";

// Never invoked.
function typeOnly(): void {
  const client = hc<AppType>("http://api.example.test");

  expectTypeOf<InferRequestType<typeof client.api.v1.self.profile.$patch>["json"]>().toEqualTypeOf<{
    display_name: string | null;
  }>();

  void client.api.v1.self.profile.$patch({ json: { display_name: "x" } });
  void client.api.v1.self.profile.$patch({ json: { display_name: null } });

  // @ts-expect-error the body is required
  void client.api.v1.self.profile.$patch();
  // @ts-expect-error the body is required
  void client.api.v1.self.profile.$patch({});
  // @ts-expect-error display_name must be a string or null
  void client.api.v1.self.profile.$patch({ json: { display_name: 1 } });
  // @ts-expect-error display_name is required (null clears it)
  void client.api.v1.self.profile.$patch({ json: {} });
}

describe("TC-API-007-009 PATCH public RPC input type (API-AUTH-004, DEV-API-002, SPEC-110 §15/§16)", () => {
  it("declares the type-level assertions, enforced by pnpm typecheck", () => {
    expect(typeof typeOnly).toBe("function");
  });
});
