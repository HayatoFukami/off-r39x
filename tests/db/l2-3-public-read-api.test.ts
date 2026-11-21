// PR-L2-3 C1 (TC-API-006-101 for API-PUB-012 and TC-API-009-006 for API-PUB-001..005, G3+G4): the six public
// read Operations from an HTTP request to a real PostgreSQL 17, as in tests/db/foundation-api-integration.test.ts:
// createApp with createPublicContentRepository on the app_api_runtime role (verified TLS) and the in-memory
// rate limit (a fresh one per request set). Every response body is compared whole, and every response is
// searched for Internal IDs, non-public markers and counters (TST-GEN-002, INV-010-08). Needs
// TEST_DATABASE_URL and TEST_DATABASE_CA; it fails (it does not skip) without them. Synthetic data only.
//
// On the current dev no Entry purchase Operation is registered, so an Offering inside its sales period is
// SALES_STOPPED (SPEC-110 §26.1 API-PUB-005, UCR-110-004); the expectations below change by the
// specification when API-PUR-ENTRY-001 / API-PUR-CART-001 is registered.
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/api/app.ts";
import { createDatabase, createPublicContentRepository } from "../../packages/db/src/index.ts";
import { prepareFoundationDatabase } from "../harness/db/foundation.ts";
import {
  insertAnnouncement,
  insertEvent,
  insertFaq,
  insertLogo,
  insertOffering,
  MARKER,
  resetPublicContent,
  snapshot,
} from "../harness/db/public-content-rows.ts";
import { createTestRateLimit, peer } from "../harness/rate-limit/api.ts";

const url = process.env.TEST_DATABASE_URL;
const caPath = process.env.TEST_DATABASE_CA;
if (!url || !caPath) throw new Error("Real PG17 requires TEST_DATABASE_URL and TEST_DATABASE_CA");

const WEB = "https://web.example.test";
const API = "https://api.example.test";
const BASE = "/api/v1/public";
const EVENT_REF = "00000000-0000-4000-8000-0000000000e1";
const EVENT_REF_2 = "00000000-0000-4000-8000-0000000000e2";
const ref = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const PATHS = {
  event: `${BASE}/event`,
  faqs: `${BASE}/faqs`,
  announcements: `${BASE}/announcements`,
  announcement: (r: string) => `${BASE}/announcements/${r}`,
  entryOfferings: `${BASE}/entry-offerings`,
  sponsorLogos: `${BASE}/sponsor-logos`,
};
const ALL_PATHS = [
  PATHS.event,
  PATHS.faqs,
  PATHS.announcements,
  PATHS.announcement(ref(0xa3)),
  PATHS.entryOfferings,
  PATHS.sponsorLogos,
];

let admin: Client;
let runtime: ReturnType<typeof createDatabase>;

beforeAll(async () => {
  admin = new Client({ connectionString: url });
  await admin.connect();
  await prepareFoundationDatabase(admin);
  const runtimeUrl = new URL(url as string);
  runtimeUrl.username = "app_api_runtime";
  runtimeUrl.password = "";
  runtimeUrl.search = "";
  runtime = createDatabase({
    connectionString: runtimeUrl.href,
    environment: "test",
    service: "api",
    ca: await readFile(caPath as string, "utf8"),
  });
});
afterAll(async () => {
  await runtime?.close();
  await admin?.end();
});

function makeApp(pool: Pool = runtime.pool) {
  const trs = createTestRateLimit();
  const app = createApp({
    webOrigin: WEB,
    ready: async () => true,
    rateLimit: trs.rateLimit,
    publicContent: createPublicContentRepository(pool),
  });
  return {
    get: (path: string, headers: Record<string, string> = {}) =>
      app.request(`${API}${path}`, { headers }, peer()),
  };
}
const dataOf = async (res: Response) => (await res.json()).data as unknown;
const codeOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; retryable: boolean; details: unknown } }).error;

/** Every table's Internal IDs and the counter values the seed uses: none may appear in a response. */
async function internalValues(): Promise<string[]> {
  const ids: string[] = [];
  for (const table of [
    "events",
    "faq_items",
    "announcements",
    "sponsor_logos",
    "entry_ticket_offerings",
  ])
    for (const row of (await admin.query(`SELECT id::text AS id FROM app.${table}`)).rows)
      ids.push(String(row.id));
  return ids;
}

/** The synthetic rows of the Event with PUBLISHED, DRAFT and ARCHIVED content and five Offerings. */
async function seedAll(anchorMs: number): Promise<void> {
  await resetPublicContent(admin);
  const eventId = await insertEvent(admin, { ref: EVENT_REF });
  await insertFaq(admin, eventId, { ref: ref(0xf5), state: "PUBLISHED", sortOrder: 5 });
  await insertFaq(admin, eventId, { ref: ref(0xf4), state: "PUBLISHED", sortOrder: -1 });
  await insertFaq(admin, eventId, {
    ref: ref(0xf9),
    state: "DRAFT",
    sortOrder: -100,
    question: `${MARKER}-q-draft`,
    answer: `${MARKER}-a-draft`,
  });
  await insertFaq(admin, eventId, {
    ref: ref(0xf8),
    state: "ARCHIVED",
    sortOrder: -100,
    question: `${MARKER}-q-archived`,
    answer: `${MARKER}-a-archived`,
  });
  await insertAnnouncement(admin, eventId, {
    ref: ref(0xa3),
    state: "PUBLISHED",
    publishedAt: "2030-05-03T10:20:30.456Z",
    body: "Synthetic   body a3\n\nsecond line",
  });
  await insertAnnouncement(admin, eventId, {
    ref: ref(0xa1),
    state: "PUBLISHED",
    publishedAt: "2030-05-01T00:00:00.000Z",
  });
  await insertAnnouncement(admin, eventId, {
    ref: ref(0xa9),
    state: "DRAFT",
    publishedAt: "2030-09-01T00:00:00.000Z",
    title: `${MARKER}-title-draft`,
    body: `${MARKER}-body-draft`,
  });
  await insertAnnouncement(admin, eventId, {
    ref: ref(0xa8),
    state: "ARCHIVED",
    publishedAt: "2030-09-02T00:00:00.000Z",
    title: `${MARKER}-title-archived`,
    body: `${MARKER}-body-archived`,
  });
  const common = { createdAt: "2030-01-01T00:00:00.000Z" };
  await insertOffering(admin, eventId, {
    ...common,
    ref: ref(0xc2),
    name: "Synthetic ticket in the period",
    startsAt: iso(anchorMs - DAY),
    endsAt: iso(anchorMs + DAY),
    capacity: 8881,
    held: 12,
    committed: 3,
    unitAmount: "9007199254740993",
  });
  await insertOffering(admin, eventId, {
    createdAt: "2030-01-02T00:00:00.000Z",
    ref: ref(0xc3),
    name: "Synthetic ticket not yet on sale",
    startsAt: iso(anchorMs + DAY),
    endsAt: iso(anchorMs + 2 * DAY),
    capacity: 7771,
    description: "Synthetic description",
  });
  await insertOffering(admin, eventId, {
    createdAt: "2030-01-03T00:00:00.000Z",
    ref: ref(0xc1),
    name: "Synthetic ticket closed",
    startsAt: iso(anchorMs - 2 * DAY),
    endsAt: iso(anchorMs - DAY),
    capacity: 50,
  });
  await insertOffering(admin, eventId, {
    createdAt: "2030-01-04T00:00:00.000Z",
    ref: ref(0xc4),
    name: "Synthetic ticket suspended",
    startsAt: iso(anchorMs - DAY),
    endsAt: iso(anchorMs + DAY),
    control: "SUSPENDED",
    capacity: 100,
  });
  await insertOffering(admin, eventId, {
    createdAt: "2030-01-05T00:00:00.000Z",
    ref: ref(0xc5),
    name: "Synthetic ticket fully taken",
    startsAt: iso(anchorMs - DAY),
    endsAt: iso(anchorMs + DAY),
    capacity: 6661,
    held: 1,
    committed: 6660,
  });
  await insertLogo(admin, eventId, {
    ref: ref(0xd2),
    state: "PUBLISHED",
    sortOrder: 0,
    linkUrl: null,
  });
  await insertLogo(admin, eventId, { ref: ref(0xd1), state: "PUBLISHED", sortOrder: 0 });
  await insertLogo(admin, eventId, {
    ref: ref(0xd9),
    state: "DRAFT",
    sortOrder: 0,
    displayName: `${MARKER}-name-draft`,
    imageUrl: `https://${MARKER}.example.test/draft.png`,
  });
  await insertLogo(admin, eventId, {
    ref: ref(0xd8),
    state: "ARCHIVED",
    sortOrder: 0,
    displayName: `${MARKER}-name-archived`,
    imageUrl: `https://${MARKER}.example.test/archived.png`,
  });
}

const offering = (
  n: number,
  name: string,
  amount: string,
  starts: number,
  ends: number,
  reason: string,
  description: string | null = null,
) => ({
  offering_ref: ref(n),
  name,
  description,
  unit_price: { amount, currency: "JPY" },
  sales_starts_at: iso(starts),
  sales_ends_at: iso(ends),
  purchase_limit: 4,
  availability: "UNAVAILABLE",
  unavailable_reason: reason,
});

describe("TC-API-009-006 API-PUB-001..005 from HTTP to PostgreSQL (SPEC-110 §26.1, DB-SAL-001, BR-EVT-001, BR-EVT-002, FR-PUB-002, ACC-BIZ-010)", () => {
  it("answers the six reads with PUBLISHED rows only, in the specified order, with Money as strings and the sales state judged on the database clock", async () => {
    const anchor = Date.now();
    await seedAll(anchor);
    const app = makeApp();

    const event = await app.get(PATHS.event);
    expect(event.status).toBe(200);
    expect(await dataOf(event)).toEqual({
      event_ref: EVENT_REF,
      name: "Synthetic Event 2030",
      summary: "Synthetic summary",
      starts_at: "2030-06-15T03:00:00.000Z",
      ends_at: "2030-06-15T09:30:00.000Z",
      business_timezone: "Asia/Tokyo",
      venue_name: "Synthetic Hall",
      venue_details: "Synthetic floor 3",
      access_information: "Synthetic access guide",
      participant_notices: "Synthetic notice one\nSynthetic notice two",
    });

    expect(await dataOf(await app.get(PATHS.faqs))).toEqual({
      items: [
        {
          faq_ref: ref(0xf4),
          question: "Synthetic question f4",
          answer: "Synthetic answer f4",
          sort_order: -1,
        },
        {
          faq_ref: ref(0xf5),
          question: "Synthetic question f5",
          answer: "Synthetic answer f5",
          sort_order: 5,
        },
      ],
    });

    expect(await dataOf(await app.get(PATHS.announcements))).toEqual({
      items: [
        {
          announcement_ref: ref(0xa3),
          title: "Synthetic title a3",
          published_at: "2030-05-03T10:20:30.456Z",
          excerpt: "Synthetic body a3 second line",
          excerpt_truncated: false,
        },
        {
          announcement_ref: ref(0xa1),
          title: "Synthetic title a1",
          published_at: "2030-05-01T00:00:00.000Z",
          excerpt: "Synthetic body a1 second line",
          excerpt_truncated: false,
        },
      ],
    });

    const detail = await app.get(PATHS.announcement(ref(0xa3)));
    expect(detail.status).toBe(200);
    // The body is read once and kept: a Response body cannot be read twice (PR #85 review).
    const detailData = await dataOf(detail);
    expect(detailData).toEqual({
      announcement_ref: ref(0xa3),
      title: "Synthetic title a3",
      body: "Synthetic   body a3\n\nsecond line",
      published_at: "2030-05-03T10:20:30.456Z",
    });
    // An upper-case ref is normalized and finds the same row.
    expect(await dataOf(await app.get(PATHS.announcement(ref(0xa3).toUpperCase())))).toEqual(
      detailData,
    );

    expect(await dataOf(await app.get(PATHS.entryOfferings))).toEqual({
      items: [
        // created_at 2030-01-01..05 order. No Entry purchase route is registered: in-period = SALES_STOPPED.
        offering(
          0xc2,
          "Synthetic ticket in the period",
          "9007199254740993",
          anchor - DAY,
          anchor + DAY,
          "SALES_STOPPED",
        ),
        offering(
          0xc3,
          "Synthetic ticket not yet on sale",
          "1000",
          anchor + DAY,
          anchor + 2 * DAY,
          "SALES_NOT_STARTED",
          "Synthetic description",
        ),
        offering(
          0xc1,
          "Synthetic ticket closed",
          "1000",
          anchor - 2 * DAY,
          anchor - DAY,
          "SALES_CLOSED",
        ),
        offering(
          0xc4,
          "Synthetic ticket suspended",
          "1000",
          anchor - DAY,
          anchor + DAY,
          "SALES_STOPPED",
        ),
        offering(
          0xc5,
          "Synthetic ticket fully taken",
          "1000",
          anchor - DAY,
          anchor + DAY,
          "SALES_STOPPED",
        ),
      ],
    });

    expect(await dataOf(await app.get(PATHS.sponsorLogos))).toEqual({
      items: [
        {
          logo_ref: ref(0xd1),
          display_name: "Synthetic sponsor d1",
          image_url: "https://logos.example.test/d1.png",
          link_url: "https://sponsor.example.test/d1",
          sort_order: 0,
        },
        {
          logo_ref: ref(0xd2),
          display_name: "Synthetic sponsor d2",
          image_url: "https://logos.example.test/d2.png",
          link_url: null,
          sort_order: 0,
        },
      ],
    });
  });

  it("no response contains an Internal ID key or value, a DRAFT / ARCHIVED marker, a counter or a Publication State", async () => {
    await seedAll(Date.now());
    const app = makeApp();
    const ids = await internalValues();
    for (const path of ALL_PATHS) {
      const res = await app.get(path);
      expect(res.status, path).toBe(200);
      const text = await res.text();
      expect(text, path).not.toContain(MARKER);
      expect(text, path).not.toMatch(/"(id|event_id|state|created_at|updated_at|checkin_[a-z_]+)"/);
      expect(text, path).not.toMatch(
        /held_quantity|committed_quantity|sales_capacity|sale_control_state/,
      );
      for (const counter of ["8881", "7771", "6661", "6660"])
        expect(text, `${path} ${counter}`).not.toContain(counter);
      // An Internal ID (a decimal integer) is never a JSON string value either.
      for (const id of ids) expect(text, `${path} id ${id}`).not.toContain(`":"${id}"`);
    }
  });

  it("a DRAFT, an ARCHIVED and an unknown Announcement ref are the same 404 RESOURCE_NOT_FOUND (details null, no ref echoed)", async () => {
    await seedAll(Date.now());
    const app = makeApp();
    const bodies: string[] = [];
    for (const r of [ref(0xa9), ref(0xa8), ref(0xaf)]) {
      const res = await app.get(PATHS.announcement(r));
      expect(res.status, r).toBe(404);
      const text = await res.clone().text();
      const error = await codeOf(res);
      expect(error.code).toBe("RESOURCE_NOT_FOUND");
      expect(error.details).toBeNull();
      expect(text).not.toContain(MARKER);
      expect(text).not.toContain(r);
      bodies.push(text.replace(/"request_id":"[^"]+"/, '"request_id":"-"'));
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("an Event whose nullable columns are NULL is answered with null for each (nothing guessed)", async () => {
    await resetPublicContent(admin);
    await insertEvent(admin, {
      ref: EVENT_REF,
      summary: null,
      startsAt: null,
      endsAt: null,
      venueName: null,
      venueDetails: null,
      accessInformation: null,
      participantNotices: null,
    });
    expect(await dataOf(await makeApp().get(PATHS.event))).toEqual({
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

  it("with an Event and nothing PUBLISHED, each list is 200 with items: [] and the detail is 404", async () => {
    await resetPublicContent(admin);
    const eventId = await insertEvent(admin, { ref: EVENT_REF });
    await insertFaq(admin, eventId, { ref: ref(0xf9), state: "DRAFT", sortOrder: 0 });
    await insertAnnouncement(admin, eventId, { ref: ref(0xa3), state: "DRAFT", publishedAt: null });
    const app = makeApp();
    for (const path of [
      PATHS.faqs,
      PATHS.announcements,
      PATHS.entryOfferings,
      PATHS.sponsorLogos,
    ]) {
      const res = await app.get(path);
      expect(res.status, path).toBe(200);
      expect(await dataOf(res), path).toEqual({ items: [] });
    }
    expect((await app.get(PATHS.announcement(ref(0xa3)))).status).toBe(404);
  });

  it("with no Event: API-PUB-001 and API-PUB-004 are 404, the lists are 200 with items: []", async () => {
    await resetPublicContent(admin);
    const app = makeApp();
    expect((await app.get(PATHS.event)).status).toBe(404);
    expect((await app.get(PATHS.announcement(ref(0xa3)))).status).toBe(404);
    for (const path of [PATHS.faqs, PATHS.announcements, PATHS.entryOfferings, PATHS.sponsorLogos])
      expect(await dataOf(await app.get(path)), path).toEqual({ items: [] });
  });

  it("with two Events every Operation is 500 INTERNAL_ERROR and no row of either Event is sent", async () => {
    await seedAll(Date.now());
    await insertEvent(admin, { ref: EVENT_REF_2, name: "Synthetic Event B" });
    const app = makeApp();
    for (const path of [...ALL_PATHS, PATHS.sponsorLogos]) {
      const res = await app.get(path);
      expect(res.status, path).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text).error.code, path).toBe("INTERNAL_ERROR");
      expect(text, path).not.toContain("Synthetic");
    }
  });

  it("a PUBLISHED Announcement whose published_at is NULL makes the list and its detail 503 TEMPORARY_UNAVAILABLE (retryable), not a hidden or guessed row", async () => {
    await resetPublicContent(admin);
    const eventId = await insertEvent(admin, { ref: EVENT_REF });
    await insertAnnouncement(admin, eventId, {
      ref: ref(0xa1),
      state: "PUBLISHED",
      publishedAt: "2030-05-01T00:00:00.000Z",
    });
    await insertAnnouncement(admin, eventId, {
      ref: ref(0xa5),
      state: "PUBLISHED",
      publishedAt: null,
    });
    const app = makeApp();
    for (const path of [PATHS.announcements, PATHS.announcement(ref(0xa5))]) {
      const res = await app.get(path);
      expect(res.status, path).toBe(503);
      const error = await codeOf(res);
      expect(error.code, path).toBe("TEMPORARY_UNAVAILABLE");
      expect(error.retryable, path).toBe(true);
    }
    // The well-formed row is still served on its own.
    expect((await app.get(PATHS.announcement(ref(0xa1)))).status).toBe(200);
  });

  it("a PUBLISHED Announcement whose published_at is 'infinity' makes the list and its detail 503 TEMPORARY_UNAVAILABLE, not a 500 (PR #85 review)", async () => {
    await resetPublicContent(admin);
    const eventId = await insertEvent(admin, { ref: EVENT_REF });
    await insertAnnouncement(admin, eventId, {
      ref: ref(0xa6),
      state: "PUBLISHED",
      publishedAt: "infinity",
    });
    const app = makeApp();
    for (const path of [PATHS.announcements, PATHS.announcement(ref(0xa6))]) {
      const res = await app.get(path);
      expect(res.status, path).toBe(503);
      const error = await codeOf(res);
      expect(error.code, path).toBe("TEMPORARY_UNAVAILABLE");
      expect(error.retryable, path).toBe(true);
    }
  });

  it("an unreachable database is 503 DATABASE_TEMPORARY_FAILURE (retryable) for all six, never an empty list or a 404", async () => {
    await seedAll(Date.now());
    const net = await new Promise<number>((resolve) => {
      const server = createServer();
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        server.close(() => resolve(port));
      });
    });
    const pool = new Pool({
      host: "127.0.0.1",
      port: net,
      user: "app_api_runtime",
      database: "synthetic",
      connectionTimeoutMillis: 500,
    });
    pool.on("error", () => undefined);
    try {
      const app = makeApp(pool);
      for (const path of ALL_PATHS) {
        const res = await app.get(path);
        expect(res.status, path).toBe(503);
        const error = await codeOf(res);
        expect(error.code, path).toBe("DATABASE_TEMPORARY_FAILURE");
        expect(error.retryable, path).toBe(true);
      }
    } finally {
      await pool.end();
    }
  });

  it("the calls leave the five tables unchanged (a read-only Operation)", async () => {
    await seedAll(Date.now());
    const before = await snapshot(admin);
    const app = makeApp();
    for (const path of [...ALL_PATHS, PATHS.sponsorLogos, PATHS.announcement(ref(0xa9))])
      await app.get(path);
    expect(await snapshot(admin)).toEqual(before);
  });
});

describe("TC-API-006-101 API-PUB-012 from HTTP to PostgreSQL (SPEC-110 §26 API-PUB-012, FR-PUB-015, BR-EVT-005, DB-SAL-002, ACC-BIZ-028)", () => {
  it("returns the PUBLISHED Logos by sort_order then public_ref (equal sort_order in ref order, whatever the insertion order), link_url null kept, without DRAFT / ARCHIVED content", async () => {
    await seedAll(Date.now());
    const res = await makeApp().get(PATHS.sponsorLogos);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.text();
    const items = JSON.parse(text).data.items as { logo_ref: string; link_url: string | null }[];
    expect(items.map((item) => [item.logo_ref, item.link_url])).toEqual([
      [ref(0xd1), "https://sponsor.example.test/d1"],
      [ref(0xd2), null],
    ]);
    expect(text).not.toContain(MARKER);
    expect(text).not.toMatch(/"(id|event_id|state|published_at|created_at|updated_at)"/);
  });

  it("no PUBLISHED Logo is 200 with items: []; the Logo read still answers while the Event has nothing else", async () => {
    await resetPublicContent(admin);
    const eventId = await insertEvent(admin, { ref: EVENT_REF });
    await insertLogo(admin, eventId, { ref: ref(0xd9), state: "DRAFT", sortOrder: 0 });
    const res = await makeApp().get(PATHS.sponsorLogos);
    expect(res.status).toBe(200);
    expect(await dataOf(res)).toEqual({ items: [] });
  });

  it("a stored PUBLISHED Logo whose image_url breaks SEC-WEB-026 (a localhost host) is 503 TEMPORARY_UNAVAILABLE and the URL is not sent (PR #85 review)", async () => {
    await resetPublicContent(admin);
    const eventId = await insertEvent(admin, { ref: EVENT_REF });
    await insertLogo(admin, eventId, {
      ref: ref(0xd7),
      state: "PUBLISHED",
      sortOrder: 0,
      imageUrl: "https://localhost/d7.png",
    });
    const res = await makeApp().get(PATHS.sponsorLogos);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe("TEMPORARY_UNAVAILABLE");
    expect(text).not.toContain("localhost");
  });

  it("two Events are 500 INTERNAL_ERROR (API-PUB-READ-002) and no Logo of either is sent", async () => {
    await seedAll(Date.now());
    await insertEvent(admin, { ref: EVENT_REF_2, name: "Synthetic Event B" });
    const res = await makeApp().get(PATHS.sponsorLogos);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("Synthetic");
  });

  it("an unreachable database is 503 DATABASE_TEMPORARY_FAILURE (retryable), not an empty success", async () => {
    const port = await new Promise<number>((resolve) => {
      const server = createServer();
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const p = typeof address === "object" && address ? address.port : 0;
        server.close(() => resolve(p));
      });
    });
    const pool = new Pool({
      host: "127.0.0.1",
      port,
      user: "app_api_runtime",
      database: "synthetic",
      connectionTimeoutMillis: 500,
    });
    pool.on("error", () => undefined);
    try {
      const res = await makeApp(pool).get(PATHS.sponsorLogos);
      expect(res.status).toBe(503);
      const error = await codeOf(res);
      expect(error.code).toBe("DATABASE_TEMPORARY_FAILURE");
      expect(error.retryable).toBe(true);
    } finally {
      await pool.end();
    }
  });
});
