// PR-L2-3 C1. TC-API-009-001 (G4): HTTP contract of API-PUB-001..005 and TC-API-006-001 (G4): of API-PUB-012
// (SPEC-110 §26 / §26.1, API-PUB-READ-001..006) on createApp with a recording PublicContentStore
// (AppDependencies.publicContent) and the in-memory rate limit. No database: what the repository selects
// (PUBLISHED only, order, nullable columns) is TC-API-009-005 / TC-API-006-101 on a real PG17. Every refusal
// also asserts the store was not called (TST-GEN-002). Synthetic data only.
import { describe, expect, it, vi } from "vitest";
import {
  ANNOUNCEMENT_REFS,
  announcementDetailDto,
  announcementListDtos,
  announcementRows,
  BAD,
  BASE,
  createRecordingPublicContentStore,
  type EntryOfferingRowFixture,
  EVENT_REF,
  errorOf,
  eventDto,
  FAQ_REFS,
  faqDtos,
  faqRows,
  GOOD,
  LOGO_REFS,
  logoDtos,
  logoRows,
  NONPUBLIC_MARKER,
  OFFERING_REFS,
  offeringDtos,
  offeringRows,
  PUBLIC_OPERATIONS,
  type PublicAnnouncementRowFixture,
  type PublicFaqRowFixture,
  type PublicLogoRowFixture,
  type PublicOperationKey,
  publicReadRig,
  type StoreMethod,
  UNKNOWN_ANNOUNCEMENT_REF,
  unsetEventRow,
  WEB,
} from "../harness/api/public-read.ts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const completion = (records: Record<string, unknown>[]) =>
  records.filter((r) => r.event_name === "http.request.completed");

type Op = (typeof PUBLIC_OPERATIONS)[number];
const OPS_001_005 = PUBLIC_OPERATIONS.filter((o) => o.key !== "sponsorLogos");
const OPS_012 = PUBLIC_OPERATIONS.filter((o) => o.key === "sponsorLogos");

const METHOD_OF: Record<PublicOperationKey, StoreMethod> = {
  event: "readPublicEvent",
  faqs: "listPublishedFaqs",
  announcements: "listPublishedAnnouncements",
  announcement: "readPublishedAnnouncement",
  entryOfferings: "listEntryOfferings",
  sponsorLogos: "listPublishedSponsorLogos",
};
const EXPECTED_DATA: Record<PublicOperationKey, () => unknown> = {
  event: eventDto,
  faqs: () => ({ items: faqDtos() }),
  announcements: () => ({ items: announcementListDtos() }),
  announcement: announcementDetailDto,
  entryOfferings: () => ({ items: offeringDtos() }),
  sponsorLogos: () => ({ items: logoDtos() }),
};
const LIST_OPS = ["faqs", "announcements", "entryOfferings", "sponsorLogos"] as const;
const pathOf = (key: PublicOperationKey) =>
  (PUBLIC_OPERATIONS.find((o) => o.key === key) as Op).path;

/** The cases that hold for every Operation of the group (SPEC-110 §26.1 API-PUB-READ-001 / 006, §6, §24.1). */
function commonCases(ops: readonly Op[]): void {
  describe.each(ops)("$operationId $path", ({ key, operationId, path }) => {
    const method = METHOD_OF[key];

    it("200 with exactly { data, meta: { request_id } }, Cache-Control no-store and one call of its own store method", async () => {
      const r = publicReadRig();
      const res = await r.get(path);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        data: EXPECTED_DATA[key](),
        meta: { request_id: res.headers.get("X-Request-Id") },
      });
      expect(res.headers.get("X-Request-Id")).toMatch(UUID_V4);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(r.store.calls).toEqual([method]);
    });

    it("HEAD is served by the GET handler with no body", async () => {
      const r = publicReadRig();
      const res = await r.send(path, { method: "HEAD" });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("");
    });

    it("POST, PUT, PATCH and DELETE are 405 METHOD_NOT_ALLOWED with Allow: GET, HEAD and never reach the store", async () => {
      for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
        const r = publicReadRig();
        const res = await r.send(path, {
          method: verb,
          headers: { Origin: WEB, "Content-Type": "application/json" },
          ...(verb === "DELETE" ? {} : { body: "{}" }),
        });
        expect(res.status, verb).toBe(405);
        expect(res.headers.get("Allow"), verb).toBe("GET, HEAD");
        expect((await errorOf(res)).code, verb).toBe("METHOD_NOT_ALLOWED");
        expect(r.store.calls, verb).toEqual([]);
      }
    });

    const badQueries = [
      "?limit=10",
      "?cursor=x",
      "?state=DRAFT",
      "?sort=published_at",
      "?x=1&x=2",
      "?=1",
      "?profile_ref=00000000-0000-4000-8000-0000000000b1",
    ];
    it.each(badQueries)(
      "query %s is 400 VALIDATION_FAILED with details null and no store call",
      async (query) => {
        const r = publicReadRig();
        const res = await r.get(`${path}${query}`);
        expect(res.status).toBe(400);
        const error = await errorOf(res);
        expect(error.code).toBe("VALIDATION_FAILED");
        expect(error.details).toBeNull();
        expect(r.store.calls).toEqual([]);
      },
    );

    it("no query and an empty query ('?') are both 200", async () => {
      for (const query of ["", "?"]) {
        const r = publicReadRig();
        const res = await r.get(`${path}${query}`);
        expect(res.status, query).toBe(200);
        expect(r.store.count(method), query).toBe(1);
      }
    });

    it("without the publicContent dependency the route fails closed: 503 TEMPORARY_UNAVAILABLE, also for an invalid query (the guard comes first)", async () => {
      for (const query of ["", "?limit=10"]) {
        const r = publicReadRig({ omitPublicContent: true });
        const res = await r.get(`${path}${query}`);
        expect(res.status, query).toBe(503);
        const error = await errorOf(res);
        expect(error.code, query).toBe("TEMPORARY_UNAVAILABLE");
        expect(error.retryable, query).toBe(true);
      }
    });

    it("FP.DB.INSIDE_STATEMENT is 503 DATABASE_TEMPORARY_FAILURE (retryable), not an empty success or a 404", async () => {
      const r = publicReadRig();
      r.store.inject("FP.DB.INSIDE_STATEMENT");
      const res = await r.get(path);
      expect(res.status).toBe(503);
      const text = await res.text();
      const body = JSON.parse(text) as { error: { code: string; retryable: boolean } };
      expect(body.error.code).toBe("DATABASE_TEMPORARY_FAILURE");
      expect(body.error.retryable).toBe(true);
      expect(Object.keys(body)).toEqual(["error"]);
      expect(text).not.toContain("items");
    });

    it("PUBLIC.STORE_THROWS (an unclassified failure) is 500 INTERNAL_ERROR without the failure text", async () => {
      const r = publicReadRig();
      r.store.inject("PUBLIC.STORE_THROWS");
      const res = await r.get(path);
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text).error.code).toBe("INTERNAL_ERROR");
      expect(text).not.toContain("synthetic public store failure");
    });

    it("PUBLIC.MULTIPLE_EVENTS (two or more Events) is 500 INTERNAL_ERROR and no row is returned (API-PUB-READ-002)", async () => {
      const r = publicReadRig();
      r.store.inject("PUBLIC.MULTIPLE_EVENTS");
      const res = await r.get(path);
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text).error.code).toBe("INTERNAL_ERROR");
      expect(text).not.toContain("Synthetic");
    });

    it("never verifies a token or reads a Principal, with or without Authorization (a valid, an invalid and a malformed value give the same response)", async () => {
      const baseline = publicReadRig();
      const reference = await (await baseline.get(path)).json();
      for (const authorization of [`Bearer ${GOOD}`, `Bearer ${BAD}`, "Bearer", "Basic !!!", ""]) {
        const r = publicReadRig();
        const res = await r.get(path, {
          Authorization: authorization,
          Cookie: "session=synthetic",
        });
        expect(res.status, authorization).toBe(200);
        const body = (await res.json()) as { data: unknown; meta: { request_id: string } };
        expect(body.data, authorization).toEqual((reference as { data: unknown }).data);
        expect(r.verifications(), authorization).toBe(0);
        expect(r.principalReads(), authorization).toBe(0);
        expect(r.order.filter((entry) => entry === "store:admit")).toHaveLength(1);
      }
    });

    it("answers a rate limit evaluation once (Stage 1 only: the per-IP burst and sustained rules and the public_read global rule)", async () => {
      const r = publicReadRig();
      expect((await r.get(path)).status).toBe(200);
      expect(r.trs.store.calls).toHaveLength(1);
      const [call] = r.trs.store.calls;
      expect(call?.mode).toBe("admit");
      expect(
        call?.rules
          .map((rule) => [rule.limit, rule.windowMs])
          .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0)),
      ).toEqual([
        [20, 10_000],
        [120, 60_000],
        [10_000, 60_000],
      ]);
    });

    it("the 21st request from one IP within 10 s is 429 RATE_LIMIT_EXCEEDED with an integer Retry-After and the store was called 20 times (SEC-ABU-017)", async () => {
      const r = publicReadRig();
      for (let i = 0; i < 20; i += 1) expect((await r.get(path)).status, `#${i + 1}`).toBe(200);
      const refused = await r.get(path);
      expect(refused.status).toBe(429);
      expect(refused.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
      expect((await errorOf(refused)).code).toBe("RATE_LIMIT_EXCEEDED");
      expect(r.store.count(method)).toBe(20);
    });

    it("a rate limit store failure is 503 TEMPORARY_UNAVAILABLE (not 429) and the public store is not called (SEC-ABU-019)", async () => {
      const r = publicReadRig();
      r.trs.faults.inject("FP.RATELIMIT.STORE_UNAVAILABLE");
      const res = await r.get(path);
      expect(res.status).toBe(503);
      expect((await errorOf(res)).code).toBe("TEMPORARY_UNAVAILABLE");
      expect(r.store.calls).toEqual([]);
      // The refusal came from the registered route's Stage 1 (not from an unregistered path).
      expect(completion(r.records)[0]).toMatchObject({
        operation_id: operationId,
        http_status: 503,
      });
    });

    it("the completion log carries the Operation ID and the route template, once", async () => {
      const r = publicReadRig();
      expect((await r.get(path)).status).toBe(200);
      expect(completion(r.records)).toHaveLength(1);
      expect(completion(r.records)[0]).toMatchObject({
        operation_id: operationId,
        http_route: key === "announcement" ? `${BASE}/announcements/:announcement_ref` : path,
        http_method: "GET",
        http_status: 200,
      });
      // The raw reference is not part of any log line.
      expect(r.lines.join("\n")).not.toContain(ANNOUNCEMENT_REFS[0]);
    });

    it("a store row that carries Internal IDs, a state, counters or admin times never reaches the response (the DTO is built field by field)", async () => {
      const extra = {
        id: `${NONPUBLIC_MARKER}-id`,
        eventId: `${NONPUBLIC_MARKER}-event-id`,
        state: `${NONPUBLIC_MARKER}-state`,
        heldQuantity: 4242,
        committedQuantity: 4343,
        salesCapacity: 4444,
        createdAt: `${NONPUBLIC_MARKER}-created`,
        updatedAt: `${NONPUBLIC_MARKER}-updated`,
        checkinOpensAt: `${NONPUBLIC_MARKER}-checkin`,
      };
      const store = createRecordingPublicContentStore({
        event: { status: "found", event: { ...unsetEventRow(), ...extra } },
        faqs: { status: "ok", items: faqRows().map((row) => ({ ...row, ...extra })) },
        announcements: {
          status: "ok",
          items: announcementRows().map((row) => ({ ...row, ...extra })),
        },
        announcement: {
          status: "found",
          announcement: { ...(announcementRows()[0] as PublicAnnouncementRowFixture), ...extra },
        },
        offerings: {
          status: "ok",
          now: "2030-06-15T00:00:00.000Z",
          items: offeringRows().map((row) => ({ ...row, ...extra })),
        },
        logos: { status: "ok", items: logoRows().map((row) => ({ ...row, ...extra })) },
      });
      const r = publicReadRig({ store });
      const res = await r.get(path);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(NONPUBLIC_MARKER);
      expect(text).not.toMatch(/4242|4343|4444/);
      expect(text).not.toMatch(
        /"(id|event_id|state|created_at|updated_at|checkin_opens_at|held_quantity)"/,
      );
    });
  });
}

/** A row the response schema refuses (API-PUB-READ-006): the whole Operation is 503 TEMPORARY_UNAVAILABLE. */
/** SEC-WEB-026: Logo URLs the response must refuse (each a stored PUBLISHED value). */
const LOGO_URLS_REFUSED: readonly string[] = [
  "https://localhost/a.png",
  "https://cdn.localhost/a.png",
  "https://logos.local/a.png",
  "https://127.0.0.1/a.png",
  "https://0x7f.1/a.png",
  "https://2130706433/a.png",
  "https://[::1]/a.png",
  "https://logos.example.test:8443/a.png",
  "https://logos.example.test/a.png?sig=abc",
  "https://logos.example.test/a.png#frag",
  "https://user:pass@logos.example.test/a.png",
  "https://user@logos.example.test/a.png",
  "https:logos.example.test/a.png",
  "https://logos.example.test\\a.png",
  "https://logos.example.test/a\tb.png",
  "https://logos.example.test/a b.png",
  "ftp://logos.example.test/a.png",
];

function invalidRowCases(include: (key: PublicOperationKey) => boolean): void {
  const REF_UPPER = "00000000-0000-4000-8000-0000000000A1";
  const offering = (patch: Partial<EntryOfferingRowFixture>) => ({
    status: "ok" as const,
    now: "2030-06-15T00:00:00.000Z",
    items: [{ ...(offeringRows()[2] as EntryOfferingRowFixture), ...patch }],
  });
  const cases: [
    PublicOperationKey,
    string,
    Parameters<typeof createRecordingPublicContentStore>[0],
  ][] = [
    [
      "announcements",
      "a PUBLISHED Announcement whose published_at is NULL",
      {
        announcements: {
          status: "ok",
          items: [
            ...announcementRows(),
            { ...(announcementRows()[0] as PublicAnnouncementRowFixture), publishedAt: null },
          ],
        },
      },
    ],
    [
      "announcement",
      "a PUBLISHED Announcement whose published_at is NULL",
      {
        announcement: {
          status: "found",
          announcement: {
            ...(announcementRows()[0] as PublicAnnouncementRowFixture),
            publishedAt: null,
          },
        },
      },
    ],
    [
      "announcement",
      "a published_at without milliseconds",
      {
        announcement: {
          status: "found",
          announcement: {
            ...(announcementRows()[0] as PublicAnnouncementRowFixture),
            publishedAt: "2030-05-02T01:02:03Z",
          },
        },
      },
    ],
    [
      "announcements",
      "an upper-case announcement_ref",
      {
        announcements: {
          status: "ok",
          items: [
            { ...(announcementRows()[0] as PublicAnnouncementRowFixture), publicRef: REF_UPPER },
          ],
        },
      },
    ],
    [
      "faqs",
      "a sort_order that is not an integer",
      {
        faqs: {
          status: "ok",
          items: [{ ...(faqRows()[0] as PublicFaqRowFixture), sortOrder: 1.5 }],
        },
      },
    ],
    [
      "faqs",
      "a sort_order beyond int32",
      {
        faqs: {
          status: "ok",
          items: [{ ...(faqRows()[0] as PublicFaqRowFixture), sortOrder: 2147483648 }],
        },
      },
    ],
    [
      "event",
      "a business_timezone other than Asia/Tokyo",
      {
        event: { status: "found", event: { ...unsetEventRow(), businessTimezone: "UTC" } },
      },
    ],
    [
      "event",
      "a starts_at with an offset",
      {
        event: {
          status: "found",
          event: { ...unsetEventRow(), startsAt: "2030-06-15T12:00:00.000+09:00" },
        },
      },
    ],
    [
      "sponsorLogos",
      "an http image_url",
      {
        logos: {
          status: "ok",
          items: [
            {
              ...(logoRows()[0] as PublicLogoRowFixture),
              imageUrl: "http://logos.example.test/one.png",
            },
          ],
        },
      },
    ],
    [
      "sponsorLogos",
      "an empty display_name",
      {
        logos: {
          status: "ok",
          items: [{ ...(logoRows()[0] as PublicLogoRowFixture), displayName: "" }],
        },
      },
    ],
    [
      "sponsorLogos",
      "a negative sort_order",
      {
        logos: {
          status: "ok",
          items: [{ ...(logoRows()[0] as PublicLogoRowFixture), sortOrder: -1 }],
        },
      },
    ],
    [
      "entryOfferings",
      "a unit amount with a leading zero",
      { offerings: offering({ unitAmount: "01" }) },
    ],
    ["entryOfferings", "a negative unit amount", { offerings: offering({ unitAmount: "-1" }) }],
    ["entryOfferings", "a lower-case currency", { offerings: offering({ currency: "jpy" }) }],
    // PR #85 review: a timestamptz the parser cannot turn into an instant ('infinity' / '-infinity') is
    // an invalid row (API-PUB-READ-006), not a 500. The repository passes the raw text on unchanged.
    [
      "announcements",
      "a PUBLISHED Announcement whose published_at is infinity",
      {
        announcements: {
          status: "ok",
          items: [
            { ...(announcementRows()[0] as PublicAnnouncementRowFixture), publishedAt: "infinity" },
          ],
        },
      },
    ],
    [
      "announcement",
      "a PUBLISHED Announcement whose published_at is -infinity",
      {
        announcement: {
          status: "found",
          announcement: {
            ...(announcementRows()[0] as PublicAnnouncementRowFixture),
            publishedAt: "-infinity",
          },
        },
      },
    ],
    [
      "entryOfferings",
      "a sales_starts_at of -infinity (the sales state cannot be judged)",
      { offerings: offering({ salesStartsAt: "-infinity" }) },
    ],
    [
      "entryOfferings",
      "a sales_ends_at of infinity (the sales state cannot be judged)",
      { offerings: offering({ salesEndsAt: "infinity" }) },
    ],
    // PR #85 review / SEC-WEB-026: a stored Logo URL outside the allowed shape is never sent.
    ...LOGO_URLS_REFUSED.flatMap(
      (
        url,
      ): [
        PublicOperationKey,
        string,
        Parameters<typeof createRecordingPublicContentStore>[0],
      ][] => [
        [
          "sponsorLogos",
          `an image_url ${JSON.stringify(url)}`,
          {
            logos: {
              status: "ok",
              items: [{ ...(logoRows()[0] as PublicLogoRowFixture), imageUrl: url }],
            },
          },
        ],
        [
          "sponsorLogos",
          `a link_url ${JSON.stringify(url)}`,
          {
            logos: {
              status: "ok",
              items: [{ ...(logoRows()[0] as PublicLogoRowFixture), linkUrl: url }],
            },
          },
        ],
      ],
    ),
  ];
  describe.each(cases.filter(([key]) => include(key)))("%s: %s", (key, _label, data) => {
    it("is 503 TEMPORARY_UNAVAILABLE (retryable), the row is neither guessed, skipped nor sent", async () => {
      const r = publicReadRig({ store: createRecordingPublicContentStore(data) });
      const res = await r.get(pathOf(key));
      expect(res.status).toBe(503);
      const text = await res.text();
      const error = (
        JSON.parse(text) as { error: { code: string; retryable: boolean; details: unknown } }
      ).error;
      expect(error.code).toBe("TEMPORARY_UNAVAILABLE");
      expect(error.retryable).toBe(true);
      expect(error.details).toBeNull();
      expect(text).not.toContain("Synthetic");
      expect(text).not.toContain("items");
    });
  });
}

describe("TC-API-009-001 API-PUB-001..005 contract (SPEC-110 §26.1, API-PUB-READ-001..006, §6, §19, §21, §24.1, §51)", () => {
  commonCases(OPS_001_005);

  describe("API-PUB-001 Event (API-PUB-READ-002, API-PUB-READ-004, BR-EVT-001, FR-PUB-002)", () => {
    it("an Event whose nullable columns are NULL is answered with null for each, key present, never an empty string or a guess", async () => {
      const r = publicReadRig({
        store: createRecordingPublicContentStore({
          event: { status: "found", event: unsetEventRow() },
        }),
      });
      const res = await r.get(pathOf("event"));
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({
        event_ref: EVENT_REF,
        name: "Synthetic Event 2030",
        summary: null,
        starts_at: null,
        ends_at: null,
        business_timezone: "Asia/Tokyo",
        venue_name: null,
        venue_details: null,
        access_information: null,
        participant_notices: null,
      });
    });

    it("participant_notices is the stored text as it is (not split into an array)", async () => {
      const r = publicReadRig();
      const data = (await (await r.get(pathOf("event"))).json()).data;
      expect(data.participant_notices).toBe("Synthetic notice one\nSynthetic notice two");
    });

    it("no Event (none) is 404 RESOURCE_NOT_FOUND with details null, not a 200 with null data", async () => {
      const r = publicReadRig({
        store: createRecordingPublicContentStore({ event: { status: "none" } }),
      });
      const res = await r.get(pathOf("event"));
      expect(res.status).toBe(404);
      const error = await errorOf(res);
      expect(error.code).toBe("RESOURCE_NOT_FOUND");
      expect(error.details).toBeNull();
      expect(error.retryable).toBe(false);
      // The 404 is the store's answer (none), not an unregistered path.
      expect(r.store.calls).toEqual(["readPublicEvent"]);
    });

    it("two or more Events (multiple) are 500 INTERNAL_ERROR, no row is sent", async () => {
      const r = publicReadRig({
        store: createRecordingPublicContentStore({ event: { status: "multiple" } }),
      });
      const res = await r.get(pathOf("event"));
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("Synthetic");
    });
  });

  describe("list Operations with nothing to show (API-PUB-READ-002, API-PUB-READ-003)", () => {
    it.each(LIST_OPS.filter((key) => key !== "sponsorLogos"))(
      "%s with no row is 200 with items: [] (not a 404, not an error)",
      async (key) => {
        const data = {
          faqs: { faqs: { status: "ok" as const, items: [] } },
          announcements: { announcements: { status: "ok" as const, items: [] } },
          entryOfferings: {
            offerings: { status: "ok" as const, now: "2030-06-15T00:00:00.000Z", items: [] },
          },
        }[key as "faqs" | "announcements" | "entryOfferings"];
        const r = publicReadRig({ store: createRecordingPublicContentStore(data) });
        const res = await r.get(pathOf(key));
        expect(res.status).toBe(200);
        expect((await res.json()).data).toEqual({ items: [] });
      },
    );

    it("a list is answered in the order the store returned (the order itself is the repository's, API-PUB-READ-005)", async () => {
      const reversed = [...faqRows()].reverse();
      const r = publicReadRig({
        store: createRecordingPublicContentStore({ faqs: { status: "ok", items: reversed } }),
      });
      const items = (await (await r.get(pathOf("faqs"))).json()).data.items as {
        faq_ref: string;
      }[];
      expect(items.map((item) => item.faq_ref)).toEqual([FAQ_REFS[0], FAQ_REFS[1]]);
    });
  });

  describe("API-PUB-002 FAQ", () => {
    it("returns faq_ref, question, answer and sort_order only (a negative sort_order is allowed)", async () => {
      const r = publicReadRig();
      const items = (await (await r.get(pathOf("faqs"))).json()).data.items as Record<
        string,
        unknown
      >[];
      for (const item of items)
        expect(Object.keys(item).sort()).toEqual(["answer", "faq_ref", "question", "sort_order"]);
      expect(items.map((item) => item.sort_order)).toEqual([-1, 5]);
    });
  });

  describe("API-PUB-003 Announcement list: excerpt (SPEC-110 §26.1, UCR-110-013 D-3)", () => {
    const listWith = (body: string) =>
      publicReadRig({
        store: createRecordingPublicContentStore({
          announcements: {
            status: "ok",
            items: [{ ...(announcementRows()[0] as PublicAnnouncementRowFixture), body }],
          },
        }),
      });
    const excerptOf = async (body: string) => {
      const res = await listWith(body).get(pathOf("announcements"));
      expect(res.status).toBe(200);
      const [item] = (await res.json()).data.items as Record<string, unknown>[];
      const { excerpt, excerpt_truncated } = item as {
        excerpt: string;
        excerpt_truncated: boolean;
      };
      return { excerpt, excerpt_truncated };
    };
    const cp = (text: string) => [...text].length;

    it("an item has announcement_ref, title, published_at, excerpt and excerpt_truncated and no body", async () => {
      const r = publicReadRig();
      const items = (await (await r.get(pathOf("announcements"))).json()).data.items as Record<
        string,
        unknown
      >[];
      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual([
          "announcement_ref",
          "excerpt",
          "excerpt_truncated",
          "published_at",
          "title",
        ]);
      }
      expect(items.map((item) => item.published_at)).toEqual([
        "2030-05-02T01:02:03.456Z",
        "2030-05-01T00:00:00.000Z",
      ]);
    });

    const normalization: [string, string, string][] = [
      ["a run of newlines, spaces and a tab becomes one space", "a\n\n  b\t\tc", "a b c"],
      [
        "CR LF and other line breaks (VT, FF, U+2028, U+2029) count",
        "a\r\nb\u000Bc\u000Cd e f",
        "a b c d e f",
      ],
      ["U+3000 inside is one space and U+3000 at the ends is trimmed", "　前　　後　", "前 後"],
      ["U+0085 (NEL) and U+00A0 are White_Space", "a\u0085\u0085b c", "a b c"],
      ["U+FEFF is not White_Space and stays", "a﻿b", "a﻿b"],
      ["leading and trailing White_Space is removed", " \n\t a b \n ", "a b"],
      ["a whitespace-only body is empty", " \n　\t ", ""],
      ["an empty body is empty", "", ""],
    ];
    it.each(normalization)("%s", async (_label, body, expected) => {
      expect(await excerptOf(body)).toEqual({ excerpt: expected, excerpt_truncated: false });
    });

    it("99, 100 and 101 code points: only 101 is cut (to 100) and flagged", async () => {
      expect(await excerptOf("a".repeat(99))).toEqual({
        excerpt: "a".repeat(99),
        excerpt_truncated: false,
      });
      expect(await excerptOf("a".repeat(100))).toEqual({
        excerpt: "a".repeat(100),
        excerpt_truncated: false,
      });
      expect(await excerptOf("a".repeat(101))).toEqual({
        excerpt: "a".repeat(100),
        excerpt_truncated: true,
      });
    });

    it("counts code points, not UTF-16 units: 100 astral characters are kept whole, 101 are cut to 100 without a lone surrogate", async () => {
      const kept = await excerptOf("\u{1F600}".repeat(100));
      expect(kept).toEqual({ excerpt: "\u{1F600}".repeat(100), excerpt_truncated: false });
      const cut = await excerptOf("\u{1F600}".repeat(101));
      expect(cp(cut.excerpt)).toBe(100);
      expect(cut.excerpt).toBe("\u{1F600}".repeat(100));
      expect(cut.excerpt_truncated).toBe(true);
      // encodeURIComponent throws URIError on a lone surrogate.
      expect(() => encodeURIComponent(cut.excerpt)).not.toThrow();
    });

    it("the length is that of the normalized text: trailing white space after exactly 100 code points is not a cut", async () => {
      expect(await excerptOf(`${"a".repeat(100)}  \n  `)).toEqual({
        excerpt: "a".repeat(100),
        excerpt_truncated: false,
      });
      // 100 characters separated by long runs of white space: the runs count once each.
      const spaced = Array.from({ length: 50 }, () => "a").join("   \n   ");
      const result = await excerptOf(spaced);
      expect(result.excerpt).toBe(Array.from({ length: 50 }, () => "a").join(" "));
      expect(result.excerpt_truncated).toBe(false);
    });

    it("the cut is made on the trimmed, normalized text and the result is not trimmed again (it may end with a space); no ellipsis is added", async () => {
      const result = await excerptOf(`  ${"a".repeat(99)} b  `);
      expect(result).toEqual({ excerpt: `${"a".repeat(99)} `, excerpt_truncated: true });
      expect(result.excerpt).not.toContain("…");
      expect(result.excerpt).not.toContain("...");
    });

    it("a cut can split a grapheme cluster (code point unit): a base letter with 100 combining marks is cut after 100 code points", async () => {
      const result = await excerptOf(`e${"́".repeat(100)}`);
      expect(cp(result.excerpt)).toBe(100);
      expect(result.excerpt_truncated).toBe(true);
    });
  });

  describe("API-PUB-004 Announcement detail (PG-PUB-003, API-PUB-READ-003)", () => {
    const detail = (ref: string) => `${BASE}/announcements/${ref}`;

    it("returns the stored body as it is (no normalization) with the lower-case canonical ref", async () => {
      const r = publicReadRig();
      const res = await r.get(detail(ANNOUNCEMENT_REFS[0]));
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual(announcementDetailDto());
      expect(r.store.refs).toEqual([ANNOUNCEMENT_REFS[0]]);
    });

    it("an upper-case UUID is normalized to lower case before the store is asked, and the response ref is lower case", async () => {
      const r = publicReadRig();
      const res = await r.get(detail(ANNOUNCEMENT_REFS[0].toUpperCase()));
      expect(res.status).toBe(200);
      expect(r.store.refs).toEqual([ANNOUNCEMENT_REFS[0]]);
      expect((await res.json()).data.announcement_ref).toBe(ANNOUNCEMENT_REFS[0]);
    });

    const notUuid = [
      "not-a-uuid",
      "00000000-0000-4000-8000-0000000000a",
      "00000000-0000-4000-8000-0000000000a1x",
      "00000000000040008000000000000a1",
      "%20",
      "00000000-0000-4000-8000-0000000000g1",
    ];
    it.each(notUuid)(
      "%j is 400 VALIDATION_FAILED (details null) and no store call",
      async (value) => {
        const r = publicReadRig();
        const res = await r.get(detail(value));
        expect(res.status).toBe(400);
        const error = await errorOf(res);
        expect(error.code).toBe("VALIDATION_FAILED");
        expect(error.details).toBeNull();
        expect(r.store.calls).toEqual([]);
      },
    );

    it("an invalid ref with the dependency absent is still 503 (fail closed first)", async () => {
      const r = publicReadRig({ omitPublicContent: true });
      const res = await r.get(detail("not-a-uuid"));
      expect(res.status).toBe(503);
      expect((await errorOf(res)).code).toBe("TEMPORARY_UNAVAILABLE");
    });

    it("an unknown or non-published ref (the store's not_found) is 404 RESOURCE_NOT_FOUND, details null, and the two responses are identical apart from request_id", async () => {
      const bodies: string[] = [];
      for (const ref of [UNKNOWN_ANNOUNCEMENT_REF, ANNOUNCEMENT_REFS[1]]) {
        const r = publicReadRig({
          store: createRecordingPublicContentStore({ announcement: { status: "not_found" } }),
        });
        const res = await r.get(detail(ref));
        expect(res.status).toBe(404);
        const copy = res.clone();
        const error = await errorOf(res);
        expect(error.code).toBe("RESOURCE_NOT_FOUND");
        expect(error.details).toBeNull();
        const text = await copy.text();
        expect(text).not.toContain(ref);
        bodies.push(text.replace(/"request_id":"[^"]+"/, '"request_id":"-"'));
      }
      expect(bodies[0]).toBe(bodies[1]);
    });

    it("Event 0 (the store's not_found) is 404, and two Events are 500", async () => {
      const none = publicReadRig({
        store: createRecordingPublicContentStore({ announcement: { status: "not_found" } }),
      });
      expect((await none.get(detail(ANNOUNCEMENT_REFS[0]))).status).toBe(404);
      const many = publicReadRig({
        store: createRecordingPublicContentStore({ announcement: { status: "multiple_events" } }),
      });
      expect((await many.get(detail(ANNOUNCEMENT_REFS[0]))).status).toBe(500);
    });

    it("a database failure is 503 DATABASE_TEMPORARY_FAILURE, not the 404 of a missing Announcement", async () => {
      const r = publicReadRig();
      r.store.inject("FP.DB.INSIDE_STATEMENT");
      const res = await r.get(detail(ANNOUNCEMENT_REFS[0]));
      expect(res.status).toBe(503);
      expect((await errorOf(res)).code).toBe("DATABASE_TEMPORARY_FAILURE");
    });
  });

  describe("API-PUB-005 Entry offerings (SPEC-110 §26.1 sales state, BR-SAL-003, BR-SAL-004, FR-PUB-010)", () => {
    it("derives the sales state from the store's now: the start is included, the end is not, and no counter, remaining count or control state is returned", async () => {
      const r = publicReadRig();
      const res = await r.get(pathOf("entryOfferings"));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(JSON.parse(text).data).toEqual({ items: offeringDtos() });
      // Key names (quoted), not values: a fixture name may contain an ordinary word such as "remaining".
      expect(text).not.toMatch(
        /"[a-z_]*(capacity|held|committed|remaining|quantity|sale_control_state|checkin)[a-z_]*":/i,
      );
    });

    it("on the current dev no Entry purchase route is registered, so an Offering inside its period is SALES_STOPPED, a suspended one too, and the period reasons come first", async () => {
      const r = publicReadRig();
      const items = (await (await r.get(pathOf("entryOfferings"))).json()).data.items as {
        offering_ref: string;
        availability: string;
        unavailable_reason: string | null;
      }[];
      expect(items.map((item) => [item.offering_ref, item.unavailable_reason])).toEqual([
        [OFFERING_REFS[0], "SALES_NOT_STARTED"],
        [OFFERING_REFS[1], "SALES_CLOSED"],
        [OFFERING_REFS[2], "SALES_STOPPED"],
        [OFFERING_REFS[3], "SALES_STOPPED"],
        [OFFERING_REFS[4], "SALES_STOPPED"],
      ]);
      expect(items.every((item) => item.availability === "UNAVAILABLE")).toBe(true);
    });

    it("keeps the unit amount as a decimal string beyond Number.MAX_SAFE_INTEGER", async () => {
      const r = publicReadRig();
      const text = await (await r.get(pathOf("entryOfferings"))).text();
      expect(text).toContain('"amount":"9007199254740993"');
    });

    it("the judgement time is the store's now, not the API clock", async () => {
      const farFuture = createRecordingPublicContentStore({
        offerings: { status: "ok", now: "2999-01-01T00:00:00.000Z", items: offeringRows() },
      });
      const items = (
        await (await publicReadRig({ store: farFuture }).get(pathOf("entryOfferings"))).json()
      ).data.items as { unavailable_reason: string | null }[];
      // At 2999 every period is over.
      expect(items.map((item) => item.unavailable_reason)).toEqual(Array(5).fill("SALES_CLOSED"));
    });
  });
});

describe("TC-API-009-001 invalid rows from the store (API-PUB-READ-006, SPEC-110 §26 end, FR-PUB-013)", () => {
  invalidRowCases((key) => key !== "sponsorLogos");
});

describe("TC-API-009-001 API-PUB-005 follows the Entry purchase route registry (SPEC-110 section 26.1 API-PUB-005, UCR-110-004)", () => {
  it("with API-PUR-ENTRY-001 in ROUTES an Offering in its period is AVAILABLE, SUSPENDED is SALES_STOPPED, no remaining capacity is SOLD_OUT, and the period reasons are unchanged", async () => {
    // Only the ROUTES that routes/public.ts reads is replaced: the registry plus the purchase route of
    // SPEC-110 section 56.1 / API-RLC-006 (class purchase_checkout, Stage 3 reference offering_ref).
    vi.resetModules();
    vi.doMock("../../apps/api/src/api/routes.ts", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../apps/api/src/api/routes.ts")>();
      return {
        ...actual,
        ROUTES: Object.freeze([
          ...actual.ROUTES,
          {
            method: "POST",
            path: "/api/v1/self/purchases/entry",
            operationId: "API-PUR-ENTRY-001",
            rateLimitClass: "purchase_checkout",
            resourceReferences: ["offering_ref"],
          },
        ]),
      };
    });
    try {
      const harness = await import("../harness/api/public-read.ts");
      const r = harness.publicReadRig();
      const res = await r.get(harness.PUBLIC_OPERATIONS[4].path);
      expect(res.status).toBe(200);
      const items = (await res.json()).data.items as {
        offering_ref: string;
        availability: string;
        unavailable_reason: string | null;
      }[];
      expect(
        items.map((item) => [item.offering_ref, item.availability, item.unavailable_reason]),
      ).toEqual([
        [OFFERING_REFS[0], "UNAVAILABLE", "SALES_NOT_STARTED"],
        [OFFERING_REFS[1], "UNAVAILABLE", "SALES_CLOSED"],
        [OFFERING_REFS[2], "AVAILABLE", null],
        [OFFERING_REFS[3], "UNAVAILABLE", "SALES_STOPPED"],
        [OFFERING_REFS[4], "UNAVAILABLE", "SOLD_OUT"],
      ]);
    } finally {
      vi.doUnmock("../../apps/api/src/api/routes.ts");
      vi.resetModules();
    }
  });
});

describe("TC-API-006-001 API-PUB-012 Sponsor Logo contract (SPEC-110 §26 API-PUB-012, API-PUB-READ-001..006, FR-PUB-015, BR-EVT-005)", () => {
  commonCases(OPS_012);

  it("returns logo_ref, display_name, image_url, link_url and sort_order, link_url null kept as null", async () => {
    const r = publicReadRig();
    const res = await r.get(pathOf("sponsorLogos"));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ items: logoDtos() });
    expect(r.store.calls).toEqual(["listPublishedSponsorLogos"]);
  });

  it("answers the store's order as it is, with equal sort_order kept in the given (ref) order", async () => {
    const r = publicReadRig();
    const items = (await (await r.get(pathOf("sponsorLogos"))).json()).data.items as {
      logo_ref: string;
    }[];
    expect(items.map((item) => item.logo_ref)).toEqual([LOGO_REFS[0], LOGO_REFS[1]]);
  });

  it("no PUBLISHED Logo is 200 with items: [], also when the Event has none (the footer shows nothing)", async () => {
    const r = publicReadRig({
      store: createRecordingPublicContentStore({ logos: { status: "ok", items: [] } }),
    });
    const res = await r.get(pathOf("sponsorLogos"));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ items: [] });
  });

  it("Logo store failure does not undo the other public Operations (API-PUB-012: no effect on other public APIs)", async () => {
    const r = publicReadRig();
    r.store.inject("FP.DB.INSIDE_STATEMENT", "listPublishedSponsorLogos");
    const logo = await r.get(pathOf("sponsorLogos"));
    expect(logo.status).toBe(503);
    expect((await errorOf(logo)).code).toBe("DATABASE_TEMPORARY_FAILURE");
    for (const key of [
      "event",
      "faqs",
      "announcements",
      "announcement",
      "entryOfferings",
    ] as const) {
      const res = await r.get(pathOf(key));
      expect(res.status, key).toBe(200);
      expect((await res.json()).data, key).toEqual(EXPECTED_DATA[key]());
    }
  });
});

describe("TC-API-006-001 API-PUB-012 invalid rows (API-PUB-READ-006: the validation failure is 503 TEMPORARY_UNAVAILABLE)", () => {
  invalidRowCases((key) => key === "sponsorLogos");
});
