// PR-L2-1b. TC-DB-AUTH-001-009 (G1, compile-time): the public RPC type of POST
// /api/v1/self/profile/provision (API-AUTH-003, DEV-API-002, SPEC-110 §15/§16). Compile-time only: the
// assertions are enforced by `pnpm typecheck` of the tests workspace (vitest treats them as no-ops) and
// the client is never called, so there is no network access.
import type { AppType, CurrentProfile } from "@off-r39x/api-contract";
import { hc, type InferRequestType, type InferResponseType } from "hono/client";
import { describe, expect, expectTypeOf, it } from "vitest";

// Never invoked.
function typeOnly(): void {
  const client = hc<AppType>("http://api.example.test");
  const post = client.api.v1.self.profile.provision.$post;

  expectTypeOf<InferRequestType<typeof post>["json"]>().toEqualTypeOf<Record<string, never>>();
  expectTypeOf<
    Extract<InferResponseType<typeof post>, { data: unknown }>["data"]
  >().toEqualTypeOf<CurrentProfile>();

  void client.api.v1.self.profile.provision.$post({ json: {} });

  // @ts-expect-error the body is required
  void client.api.v1.self.profile.provision.$post();
  // @ts-expect-error an unknown key is not part of the input
  void client.api.v1.self.profile.provision.$post({ json: { display_name: "x" } });
  // @ts-expect-error an unknown key is not part of the input
  void client.api.v1.self.profile.provision.$post({ json: { auth_subject: "x" } });
}

describe("TC-DB-AUTH-001-009 provision public RPC input type (API-AUTH-003, DEV-API-002, SPEC-110 §15/§16)", () => {
  it("declares the type-level assertions, enforced by pnpm typecheck", () => {
    expect(typeof typeOnly).toBe("function");
  });
});
