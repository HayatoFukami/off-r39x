// PR-L2-3 C1. TC-API-009-008 (G1, compile-time part): the public RPC types of the six public read
// Operations (API-PUB-001..005, API-PUB-012; DEV-API-002, SPEC-110 §15/§16) carry the response schemas, the
// announcement_ref path parameter is required, and the existing self routes keep their types (see also
// TC-API-007-009). Compile-time only: the assertions are enforced by `pnpm typecheck` of the tests workspace
// (vitest treats them as no-ops) and the client is never called, so there is no network access.
import type {
  AppType,
  publicAnnouncementListSchema,
  publicAnnouncementSchema,
  publicEntryOfferingListSchema,
  publicEventSchema,
  publicFaqListSchema,
  publicSponsorLogoListSchema,
} from "@off-r39x/api-contract";
import { hc, type InferRequestType, type InferResponseType } from "hono/client";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// Never invoked.
function typeOnly(): void {
  const client = hc<AppType>("http://api.example.test");
  const pub = client.api.v1.public;

  // The six routes exist as GET functions.
  expectTypeOf(pub.event.$get).toBeFunction();
  expectTypeOf(pub.faqs.$get).toBeFunction();
  expectTypeOf(pub.announcements.$get).toBeFunction();
  expectTypeOf(pub.announcements[":announcement_ref"].$get).toBeFunction();
  expectTypeOf(pub["entry-offerings"].$get).toBeFunction();
  expectTypeOf(pub["sponsor-logos"].$get).toBeFunction();

  // The response is the success envelope around the route's strict schema (data: schema output).
  const event: Same<
    InferResponseType<typeof pub.event.$get, 200>,
    { data: z.infer<typeof publicEventSchema>; meta: { request_id: string } }
  > = true;
  const faqs: Same<
    InferResponseType<typeof pub.faqs.$get, 200>,
    { data: z.infer<typeof publicFaqListSchema>; meta: { request_id: string } }
  > = true;
  const announcements: Same<
    InferResponseType<typeof pub.announcements.$get, 200>,
    { data: z.infer<typeof publicAnnouncementListSchema>; meta: { request_id: string } }
  > = true;
  const announcement: Same<
    InferResponseType<(typeof pub.announcements)[":announcement_ref"]["$get"], 200>,
    { data: z.infer<typeof publicAnnouncementSchema>; meta: { request_id: string } }
  > = true;
  const offerings: Same<
    InferResponseType<(typeof pub)["entry-offerings"]["$get"], 200>,
    { data: z.infer<typeof publicEntryOfferingListSchema>; meta: { request_id: string } }
  > = true;
  const logos: Same<
    InferResponseType<(typeof pub)["sponsor-logos"]["$get"], 200>,
    { data: z.infer<typeof publicSponsorLogoListSchema>; meta: { request_id: string } }
  > = true;
  void [event, faqs, announcements, announcement, offerings, logos];

  // announcement_ref is a required path parameter.
  expectTypeOf<
    InferRequestType<(typeof pub.announcements)[":announcement_ref"]["$get"]>["param"]
  >().toEqualTypeOf<{ announcement_ref: string }>();
  void pub.announcements[":announcement_ref"].$get({
    param: { announcement_ref: "00000000-0000-4000-8000-0000000000a1" },
  });
  // @ts-expect-error the path parameter is required
  void pub.announcements[":announcement_ref"].$get();
  // @ts-expect-error the path parameter is required
  void pub.announcements[":announcement_ref"].$get({});
  // @ts-expect-error the path parameter is a string
  void pub.announcements[":announcement_ref"].$get({ param: { announcement_ref: 1 } });

  // Only GET exists on the public routes (no body, no mutation).
  // @ts-expect-error API-PUB-001 has no POST
  void pub.event.$post;
  // @ts-expect-error API-PUB-012 has no PATCH
  void pub["sponsor-logos"].$patch;

  // The self routes of PR-L2-1a are still there with their input types.
  expectTypeOf(client.api.v1.self.principal.$get).toBeFunction();
  expectTypeOf(client.api.v1.self.profile.$get).toBeFunction();
  expectTypeOf<InferRequestType<typeof client.api.v1.self.profile.$patch>["json"]>().toEqualTypeOf<{
    display_name: string | null;
  }>();
}

describe("TC-API-009-008 public read RPC types (API-PUB-001..005, API-PUB-012, DEV-API-002, SPEC-110 §15/§16)", () => {
  it("declares the type-level assertions, enforced by pnpm typecheck", () => {
    expect(typeof typeOnly).toBe("function");
  });
});
