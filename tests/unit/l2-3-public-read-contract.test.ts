// PR-L2-3 C1. TC-API-006-103 (G1): the Sponsor Logo list schema and the query / path schemas of the public
// read Operations; TC-API-009-002 (G1): the response schemas of API-PUB-001..005 (SPEC-110 §8-§11, §26.1,
// DEV-API-003); TC-API-009-004 (G1): the route registry and Rate Limit class of the six Operations
// (API-RLC-001/002/005, SEC-ABU-017, SPEC-110 §56.1). Static only: synthetic values, no network, database
// or environment variables.
import {
  announcementRefParamSchema,
  emptyPublicQuerySchema,
  publicAnnouncementListSchema,
  publicAnnouncementSchema,
  publicEntryOfferingListSchema,
  publicEventSchema,
  publicFaqListSchema,
  publicSponsorLogoListSchema,
} from "@off-r39x/api-contract";
import { assertRouteRegistry } from "@off-r39x/security";
import { describe, expect, it } from "vitest";
import { classifyRequest, LOGGED_ROUTE_TEMPLATES, ROUTES } from "../../apps/api/src/api/routes.ts";
import {
  ANNOUNCEMENT_REFS,
  announcementDetailDto,
  announcementListDtos,
  eventDto,
  faqDtos,
  offeringDtos,
  PUBLIC_OPERATIONS,
} from "../harness/api/public-read.ts";

const REF = "00000000-0000-4000-8000-0000000000d1";
const MARK = "nonpublic-marker";
const LOGO = {
  logo_ref: REF,
  display_name: "Synthetic sponsor",
  image_url: "https://logos.example.test/one.png",
  link_url: "https://sponsor.example.test/one",
  sort_order: 0,
};
const withKey = (base: Record<string, unknown>, key: string, value: unknown) => ({
  ...base,
  [key]: value,
});
const without = (base: Record<string, unknown>, key: string) => {
  const { [key]: _omitted, ...rest } = base;
  return rest;
};
const ok = (schema: { safeParse(value: unknown): { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe("TC-API-006-103 query and path schemas of the public read Operations (SPEC-110 §16, API-PUB-READ-001, §26.1 API-PUB-004 Path)", () => {
  it("emptyPublicQuerySchema accepts {} only", () => {
    expect(ok(emptyPublicQuerySchema, {})).toBe(true);
    for (const query of [
      { limit: "1" },
      { cursor: "x" },
      { state: "DRAFT" },
      { sort: "published_at" },
      { profile_ref: REF },
    ])
      expect(ok(emptyPublicQuerySchema, query), JSON.stringify(query)).toBe(false);
  });

  it("announcementRefParamSchema keeps a lower-case UUID and lower-cases an upper- or mixed-case one", () => {
    const lower = ANNOUNCEMENT_REFS[0];
    expect(announcementRefParamSchema.parse(lower)).toBe(lower);
    expect(announcementRefParamSchema.parse(lower.toUpperCase())).toBe(lower);
    expect(announcementRefParamSchema.parse("00000000-0000-4000-8000-0000000000aB")).toBe(
      "00000000-0000-4000-8000-0000000000ab",
    );
  });

  it.each([
    ["not a UUID", "not-a-uuid"],
    ["35 characters", "00000000-0000-4000-8000-0000000000a"],
    ["37 characters", "00000000-0000-4000-8000-0000000000a1x"],
    ["no hyphens", "00000000000040008000000000000a1"],
    ["a non-hex digit", "00000000-0000-4000-8000-0000000000g1"],
    ["empty", ""],
    ["a space", " "],
    ["with surrounding spaces", ` ${ANNOUNCEMENT_REFS[0]} `],
    ["a number", 1],
    ["null", null],
    ["undefined", undefined],
  ])("announcementRefParamSchema rejects %s", (_label, value) => {
    expect(ok(announcementRefParamSchema, value)).toBe(false);
  });
});

describe("TC-API-006-103 publicSponsorLogoListSchema (API-PUB-012, SPEC-110 §26, SEC-WEB-026 boundary)", () => {
  const list = (item: Record<string, unknown>) => ({ items: [item] });

  it("accepts the documented shape, an empty list and link_url null", () => {
    expect(ok(publicSponsorLogoListSchema, list(LOGO))).toBe(true);
    expect(ok(publicSponsorLogoListSchema, { items: [] })).toBe(true);
    const parsed = publicSponsorLogoListSchema.safeParse(list({ ...LOGO, link_url: null }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(list({ ...LOGO, link_url: null }));
  });

  it.each(["id", "event_id", "state", "published_at", "created_at", "updated_at", "public_ref"])(
    "is strict: an extra %s key is refused",
    (key) => {
      expect(ok(publicSponsorLogoListSchema, list(withKey(LOGO, key, MARK)))).toBe(false);
    },
  );

  it("is strict at the top level", () => {
    expect(ok(publicSponsorLogoListSchema, { items: [], next_cursor: null })).toBe(false);
  });

  it("separates nullable from optional: link_url must be present, every other key too", () => {
    for (const key of Object.keys(LOGO))
      expect(ok(publicSponsorLogoListSchema, list(without(LOGO, key))), key).toBe(false);
  });

  it.each([
    ["http", "http://logos.example.test/one.png"],
    ["a relative URL", "/one.png"],
    ["a protocol-relative URL", "//logos.example.test/one.png"],
    ["an empty string", ""],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:image/png;base64,AAAA"],
    ["not a URL", "not a url"],
  ])("image_url rejects %s, and so does link_url", (_label, url) => {
    expect(ok(publicSponsorLogoListSchema, list({ ...LOGO, image_url: url }))).toBe(false);
    expect(ok(publicSponsorLogoListSchema, list({ ...LOGO, link_url: url }))).toBe(false);
  });

  it("display_name must be a non-empty string; sort_order a non-negative integer", () => {
    expect(ok(publicSponsorLogoListSchema, list({ ...LOGO, display_name: "" }))).toBe(false);
    expect(ok(publicSponsorLogoListSchema, list({ ...LOGO, display_name: 1 }))).toBe(false);
    for (const sort of [-1, 0.5, "1", null])
      expect(
        ok(publicSponsorLogoListSchema, list({ ...LOGO, sort_order: sort })),
        String(sort),
      ).toBe(false);
    for (const sort of [0, 1, 2147483647])
      expect(
        ok(publicSponsorLogoListSchema, list({ ...LOGO, sort_order: sort })),
        String(sort),
      ).toBe(true);
  });

  it("logo_ref must be a lower-case canonical UUID", () => {
    for (const ref of [
      REF.replace("d1", "D1"),
      "not-a-uuid",
      "00000000-0000-0000-0000-000000000000",
    ])
      expect(ok(publicSponsorLogoListSchema, list({ ...LOGO, logo_ref: ref })), ref).toBe(false);
  });
});

describe("TC-API-009-002 response schemas of API-PUB-001..005 (SPEC-110 §26.1, §8-§11, API-PUB-READ-004)", () => {
  it("accept the documented shapes (the harness DTOs, written from the specification)", () => {
    expect(ok(publicEventSchema, eventDto())).toBe(true);
    expect(ok(publicFaqListSchema, { items: faqDtos() })).toBe(true);
    expect(ok(publicAnnouncementListSchema, { items: announcementListDtos() })).toBe(true);
    expect(ok(publicAnnouncementSchema, announcementDetailDto())).toBe(true);
    expect(ok(publicEntryOfferingListSchema, { items: offeringDtos() })).toBe(true);
  });

  describe("publicEventSchema", () => {
    const event = eventDto() as Record<string, unknown>;
    const nullable = [
      "summary",
      "starts_at",
      "ends_at",
      "venue_name",
      "venue_details",
      "access_information",
      "participant_notices",
    ];
    it("accepts null in every nullable field (BR-EVT-001) and keeps it null", () => {
      const allNull = Object.fromEntries(nullable.map((key) => [key, null]));
      const parsed = publicEventSchema.safeParse({ ...event, ...allNull });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data).toEqual({ ...event, ...allNull });
    });
    it.each(nullable)("a missing %s is refused (nullable is not optional)", (key) => {
      expect(ok(publicEventSchema, without(event, key))).toBe(false);
    });
    it.each(["event_ref", "name", "business_timezone"])(
      "a missing or null %s is refused",
      (key) => {
        expect(ok(publicEventSchema, without(event, key)), `missing ${key}`).toBe(false);
        expect(ok(publicEventSchema, withKey(event, key, null)), `null ${key}`).toBe(false);
      },
    );
    it.each([
      "id",
      "event_ref_id",
      "state",
      "created_at",
      "updated_at",
      "checkin_opens_at",
      "sales_capacity",
    ])("an extra %s key is refused (strict)", (key) => {
      expect(ok(publicEventSchema, withKey(event, key, MARK))).toBe(false);
    });
    it.each([
      ["without milliseconds", "2030-06-15T03:00:00Z"],
      ["with an offset", "2030-06-15T12:00:00.000+09:00"],
      ["a date only", "2030-06-15"],
      ["a local time", "2030-06-15T03:00:00.000"],
      ["a number", 1900000000000],
    ])("starts_at %s is refused", (_label, value) => {
      expect(ok(publicEventSchema, withKey(event, "starts_at", value))).toBe(false);
      expect(ok(publicEventSchema, withKey(event, "ends_at", value))).toBe(false);
    });
    it("business_timezone is the literal Asia/Tokyo; event_ref a lower-case UUID", () => {
      expect(ok(publicEventSchema, withKey(event, "business_timezone", "UTC"))).toBe(false);
      expect(ok(publicEventSchema, withKey(event, "business_timezone", "asia/tokyo"))).toBe(false);
      expect(
        ok(publicEventSchema, withKey(event, "event_ref", String(event.event_ref).toUpperCase())),
      ).toBe(false);
    });
    it("participant_notices is a string (not an array)", () => {
      expect(ok(publicEventSchema, withKey(event, "participant_notices", ["a", "b"]))).toBe(false);
    });
  });

  describe("publicFaqListSchema", () => {
    const item = faqDtos()[0] as Record<string, unknown>;
    const list = (value: Record<string, unknown>) => ({ items: [value] });
    it.each(["id", "event_id", "state", "published_at", "created_at", "updated_at"])(
      "an extra %s key is refused",
      (key) => {
        expect(ok(publicFaqListSchema, list(withKey(item, key, MARK)))).toBe(false);
      },
    );
    it.each(Object.keys(item))("a missing %s is refused", (key) => {
      expect(ok(publicFaqListSchema, list(without(item, key)))).toBe(false);
    });
    it("sort_order is an int32 integer and may be negative (the database has no CHECK)", () => {
      for (const sort of [-2147483648, -1, 0, 2147483647])
        expect(ok(publicFaqListSchema, list({ ...item, sort_order: sort })), String(sort)).toBe(
          true,
        );
      for (const sort of [2147483648, -2147483649, 0.5, "1", null])
        expect(ok(publicFaqListSchema, list({ ...item, sort_order: sort })), String(sort)).toBe(
          false,
        );
    });
  });

  describe("publicAnnouncementListSchema and publicAnnouncementSchema", () => {
    const item = announcementListDtos()[0] as Record<string, unknown>;
    const detail = announcementDetailDto() as Record<string, unknown>;
    const list = (value: Record<string, unknown>) => ({ items: [value] });
    it("a list item has no body: an extra body key is refused, and excerpt / excerpt_truncated are required", () => {
      expect(ok(publicAnnouncementListSchema, list(withKey(item, "body", "full text")))).toBe(
        false,
      );
      expect(ok(publicAnnouncementListSchema, list(without(item, "excerpt")))).toBe(false);
      expect(ok(publicAnnouncementListSchema, list(without(item, "excerpt_truncated")))).toBe(
        false,
      );
      expect(
        ok(publicAnnouncementListSchema, list(withKey(item, "excerpt_truncated", "false"))),
      ).toBe(false);
      expect(ok(publicAnnouncementListSchema, list(withKey(item, "excerpt", null)))).toBe(false);
    });
    it("excerpt may be the empty string; published_at is required and not null (API-PUB-READ-006)", () => {
      expect(ok(publicAnnouncementListSchema, list(withKey(item, "excerpt", "")))).toBe(true);
      expect(ok(publicAnnouncementListSchema, list(withKey(item, "published_at", null)))).toBe(
        false,
      );
      expect(ok(publicAnnouncementSchema, withKey(detail, "published_at", null))).toBe(false);
      expect(ok(publicAnnouncementSchema, without(detail, "published_at"))).toBe(false);
    });
    it.each(["id", "event_id", "state", "created_at", "updated_at"])(
      "an extra %s key is refused in both",
      (key) => {
        expect(ok(publicAnnouncementListSchema, list(withKey(item, key, MARK)))).toBe(false);
        expect(ok(publicAnnouncementSchema, withKey(detail, key, MARK))).toBe(false);
      },
    );
    it("the detail has announcement_ref, title, body and published_at only; a missing key is refused", () => {
      for (const key of Object.keys(detail))
        expect(ok(publicAnnouncementSchema, without(detail, key)), key).toBe(false);
      expect(ok(publicAnnouncementSchema, withKey(detail, "excerpt", "x"))).toBe(false);
    });
  });

  describe("publicEntryOfferingListSchema", () => {
    const item = offeringDtos()[2] as Record<string, unknown>;
    const list = (value: Record<string, unknown>) => ({ items: [value] });
    const withPrice = (amount: unknown, currency: unknown = "JPY") =>
      list({ ...item, unit_price: { amount, currency } });
    it.each([
      "id",
      "event_id",
      "state",
      "sale_control_state",
      "sales_capacity",
      "held_quantity",
      "committed_quantity",
      "remaining",
      "remaining_quantity",
      "checkin_opens_at",
      "checkin_closes_at",
      "created_at",
      "updated_at",
    ])("an extra %s key is refused (no counter, control state or check-in window)", (key) => {
      expect(ok(publicEntryOfferingListSchema, list(withKey(item, key, 1)))).toBe(false);
    });
    it.each(Object.keys(item))(
      "a missing %s is refused (description and unavailable_reason are nullable, not optional)",
      (key) => {
        expect(ok(publicEntryOfferingListSchema, list(without(item, key)))).toBe(false);
      },
    );
    it.each(["0", "1", "1000", "9007199254740993", "123456789012345678901234567890"])(
      "unit_price.amount %s is a valid decimal string",
      (amount) => {
        expect(ok(publicEntryOfferingListSchema, withPrice(amount))).toBe(true);
      },
    );
    it.each(["01", "-1", "1.0", "1e3", " 1", "1 ", "", "+1", "1,000", 1000, 1.5, null])(
      "unit_price.amount %j is refused",
      (amount) => {
        expect(ok(publicEntryOfferingListSchema, withPrice(amount))).toBe(false);
      },
    );
    it.each(["jpy", "JP", "JPYY", "", "J1Y", 1, null])(
      "unit_price.currency %j is refused",
      (currency) => {
        expect(ok(publicEntryOfferingListSchema, withPrice("1000", currency))).toBe(false);
      },
    );
    it("unit_price is strict", () => {
      expect(
        ok(
          publicEntryOfferingListSchema,
          list({ ...item, unit_price: { amount: "1", currency: "JPY", extra: 1 } }),
        ),
      ).toBe(false);
    });
    it("availability and unavailable_reason go together: AVAILABLE <=> null", () => {
      const combo = (availability: unknown, reason: unknown) =>
        list({ ...item, availability, unavailable_reason: reason });
      expect(ok(publicEntryOfferingListSchema, combo("AVAILABLE", null))).toBe(true);
      for (const reason of ["SALES_NOT_STARTED", "SALES_CLOSED", "SALES_STOPPED", "SOLD_OUT"]) {
        expect(ok(publicEntryOfferingListSchema, combo("UNAVAILABLE", reason)), reason).toBe(true);
        expect(ok(publicEntryOfferingListSchema, combo("AVAILABLE", reason)), reason).toBe(false);
      }
      expect(ok(publicEntryOfferingListSchema, combo("UNAVAILABLE", null))).toBe(false);
    });
    it("refuses a reason outside the four, and an availability outside the two", () => {
      for (const reason of [
        "HELD",
        "SOLD",
        "NOT_PUBLIC_OR_NOT_FOUND",
        "INSUFFICIENT_QUANTITY",
        "ON_SALE",
        "sold_out",
      ])
        expect(
          ok(
            publicEntryOfferingListSchema,
            list({ ...item, availability: "UNAVAILABLE", unavailable_reason: reason }),
          ),
          reason,
        ).toBe(false);
      for (const availability of ["ON_SALE", "SUSPENDED", "available", null])
        expect(
          ok(publicEntryOfferingListSchema, list({ ...item, availability })),
          String(availability),
        ).toBe(false);
    });
    it("purchase_limit is an integer; sales times are UTC with milliseconds", () => {
      expect(ok(publicEntryOfferingListSchema, list({ ...item, purchase_limit: 1.5 }))).toBe(false);
      expect(ok(publicEntryOfferingListSchema, list({ ...item, purchase_limit: "1" }))).toBe(false);
      expect(
        ok(
          publicEntryOfferingListSchema,
          list({ ...item, sales_starts_at: "2030-06-15T00:00:00Z" }),
        ),
      ).toBe(false);
      expect(
        ok(
          publicEntryOfferingListSchema,
          list({ ...item, sales_ends_at: "2030-06-15T09:00:00.000+09:00" }),
        ),
      ).toBe(false);
    });
  });

  it("every list schema is strict at the top level and requires items", () => {
    for (const schema of [
      publicFaqListSchema,
      publicAnnouncementListSchema,
      publicEntryOfferingListSchema,
      publicSponsorLogoListSchema,
    ]) {
      expect(ok(schema, {})).toBe(false);
      expect(ok(schema, { items: [], total: 0 })).toBe(false);
      expect(ok(schema, { items: [] })).toBe(true);
    }
  });
});

describe("TC-API-009-004 route registry and Rate Limit class of the six public read Operations (API-RLC-001/002/005, SEC-ABU-017, SPEC-110 §56.1)", () => {
  const TEMPLATES: Record<string, string> = {
    "API-PUB-001": "/api/v1/public/event",
    "API-PUB-002": "/api/v1/public/faqs",
    "API-PUB-003": "/api/v1/public/announcements",
    "API-PUB-004": "/api/v1/public/announcements/:announcement_ref",
    "API-PUB-005": "/api/v1/public/entry-offerings",
    "API-PUB-012": "/api/v1/public/sponsor-logos",
  };

  it("registers the six routes as GET with their Operation ID and class public_read, once each, in ROUTES", () => {
    const registered = ROUTES.filter((route) => route.path.startsWith("/api/v1/public/"));
    expect(registered).toEqual(
      Object.entries(TEMPLATES).map(([operationId, path]) => ({
        method: "GET",
        path,
        operationId,
        rateLimitClass: "public_read",
      })),
    );
  });

  it("none has resource references (no Stage 3 rule: API-RLC-005) and no other public path or method is registered", () => {
    const publicRoutes = ROUTES.filter((r) => r.path.startsWith("/api/v1/public"));
    expect(publicRoutes).toHaveLength(6);
    for (const route of publicRoutes) expect(route).not.toHaveProperty("resourceReferences");
    expect(ROUTES.filter((r) => r.path.startsWith("/api/v1/public") && r.method !== "GET")).toEqual(
      [],
    );
  });

  it("the whole registry passes assertRouteRegistry", () => {
    expect(() => assertRouteRegistry(ROUTES)).not.toThrow();
  });

  it("classifyRequest answers public_read and the Operation ID for GET and HEAD, concrete refs included", () => {
    for (const { operationId, path } of PUBLIC_OPERATIONS)
      for (const method of ["GET", "HEAD"])
        expect(classifyRequest(method, path), `${method} ${path}`).toEqual({
          classId: "public_read",
          operationId,
        });
    expect(
      classifyRequest("GET", `/api/v1/public/announcements/${ANNOUNCEMENT_REFS[1].toUpperCase()}`),
    ).toEqual({ classId: "public_read", operationId: "API-PUB-004" });
  });

  it("POST, PUT, PATCH and DELETE are not classified on any of the six paths", () => {
    for (const { path } of PUBLIC_OPERATIONS)
      for (const method of ["POST", "PUT", "PATCH", "DELETE"])
        expect(classifyRequest(method, path), `${method} ${path}`).toBeUndefined();
  });

  it("paths that are not one of the six are not classified (no wildcard under /api/v1/public)", () => {
    for (const path of [
      "/api/v1/public",
      "/api/v1/public/",
      "/api/v1/public/events",
      "/api/v1/public/announcements/a/b",
      "/api/v1/public/goods",
      "/api/v1/public/karaoke/sales",
    ])
      expect(classifyRequest("GET", path), path).toBeUndefined();
  });

  it("the completion log route templates carry each of the six once and none with a concrete ref", () => {
    for (const template of Object.values(TEMPLATES))
      expect([...LOGGED_ROUTE_TEMPLATES].filter((t) => t === template)).toHaveLength(1);
    expect([...LOGGED_ROUTE_TEMPLATES].filter((t) => t.includes(ANNOUNCEMENT_REFS[0]))).toEqual([]);
  });
});
