// PR-L2-3 C1 (TC-API-009-005, G3): the six reads of createPublicContentRepository (@off-r39x/db) on a real
// PostgreSQL 17 as the runtime role app_api_runtime (verified TLS, own database per file). SPEC-110 §26.1
// API-PUB-READ-002..006, SPEC-100 §13.1-13.4 / §15.1, DB-SAL-001, DB-SAL-002, DB-SEED-001: only PUBLISHED rows
// are selected by the WHERE clause, order and stable tie-breaks, NULL columns stay null, the Event count
// (0 / 1 / 2 or more) comes from the same statement as the rows, the Entry sales inputs are judged on the
// database clock and no counter leaves the repository. Constraints, ordering and clocks are never proven by
// a fake (TST-GEN-004, DEV-TST-003). Needs TEST_DATABASE_URL and TEST_DATABASE_CA; it fails (it does not
// skip) without them. Synthetic data only.
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, createPublicContentRepository } from "../../packages/db/src/index.ts";
import { prepareFoundationDatabase } from "../harness/db/foundation.ts";
import {
  dbNow,
  insertAnnouncement,
  insertEvent,
  insertFaq,
  insertLogo,
  insertOffering,
  MARKER,
  resetPublicContent,
  snapshot,
} from "../harness/db/public-content-rows.ts";

const url = process.env.TEST_DATABASE_URL;
const caPath = process.env.TEST_DATABASE_CA;
if (!url || !caPath) throw new Error("Real PG17 requires TEST_DATABASE_URL and TEST_DATABASE_CA");

const EVENT_REF = "00000000-0000-4000-8000-0000000000e1";
const EVENT_REF_2 = "00000000-0000-4000-8000-0000000000e2";
const ref = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let admin: Client;
let runtime: ReturnType<typeof createDatabase>;
let repo: ReturnType<typeof createPublicContentRepository>;

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
  repo = createPublicContentRepository(runtime.pool);
});
afterAll(async () => {
  await runtime?.close();
  await admin?.end();
});

const oneEvent = async () => {
  await resetPublicContent(admin);
  return insertEvent(admin, { ref: EVENT_REF });
};

describe("TC-API-009-005 readPublicEvent (API-PUB-001, API-PUB-READ-002, API-PUB-READ-004, BR-EVT-001, DB-SEED-001)", () => {
  it("no Event is none", async () => {
    await resetPublicContent(admin);
    expect(await repo.readPublicEvent()).toEqual({ status: "none" });
  });

  it("one Event is found with every public column equal to the row, timestamps as UTC ISO with milliseconds, and nothing else", async () => {
    await oneEvent();
    const result = await repo.readPublicEvent();
    expect(result).toEqual({
      status: "found",
      event: {
        publicRef: EVENT_REF,
        name: "Synthetic Event 2030",
        summary: "Synthetic summary",
        startsAt: "2030-06-15T03:00:00.000Z",
        endsAt: "2030-06-15T09:30:00.000Z",
        businessTimezone: "Asia/Tokyo",
        venueName: "Synthetic Hall",
        venueDetails: "Synthetic floor 3",
        accessInformation: "Synthetic access guide",
        participantNotices: "Synthetic notice one\nSynthetic notice two",
      },
    });
    if (result.status === "found") {
      expect(result.event.startsAt).toMatch(ISO_MS);
      expect(JSON.stringify(result)).not.toMatch(
        /"(id|created_at|updated_at|createdAt|updatedAt)"/,
      );
    }
  });

  it("an Event whose nullable columns are NULL keeps them null (no empty string, no default)", async () => {
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
    expect(await repo.readPublicEvent()).toEqual({
      status: "found",
      event: {
        publicRef: EVENT_REF,
        name: "Synthetic Event 2030",
        summary: null,
        startsAt: null,
        endsAt: null,
        businessTimezone: "Asia/Tokyo",
        venueName: null,
        venueDetails: null,
        accessInformation: null,
        participantNotices: null,
      },
    });
  });

  it("two Events are multiple and neither row is returned", async () => {
    await resetPublicContent(admin);
    await insertEvent(admin, { ref: EVENT_REF, name: "Synthetic Event A" });
    await insertEvent(admin, { ref: EVENT_REF_2, name: "Synthetic Event B" });
    const result = await repo.readPublicEvent();
    expect(result).toEqual({ status: "multiple" });
    expect(JSON.stringify(result)).not.toContain("Synthetic Event");
  });
});

describe("TC-API-009-005 listPublishedFaqs (API-PUB-002, DB-SAL-001, API-PUB-READ-003, API-PUB-READ-005)", () => {
  it("returns PUBLISHED rows only, ordered by sort_order ASC then public_ref ASC (a negative value first, equal values by ref and not by insertion order), without DRAFT / ARCHIVED", async () => {
    const eventId = await oneEvent();
    // Inserted so that insertion order, ref order and sort order all differ.
    await insertFaq(admin, eventId, { ref: ref(0xf5), state: "PUBLISHED", sortOrder: 5 });
    await insertFaq(admin, eventId, { ref: ref(0xf3), state: "PUBLISHED", sortOrder: 0 });
    await insertFaq(admin, eventId, { ref: ref(0xf1), state: "PUBLISHED", sortOrder: 0 });
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
    const result = await repo.listPublishedFaqs();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.items.map((row) => [row.publicRef, row.sortOrder])).toEqual([
      [ref(0xf4), -1],
      [ref(0xf1), 0],
      [ref(0xf3), 0],
      [ref(0xf5), 5],
    ]);
    expect(result.items[0]).toEqual({
      publicRef: ref(0xf4),
      question: "Synthetic question f4",
      answer: "Synthetic answer f4",
      sortOrder: -1,
    });
    expect(JSON.stringify(result)).not.toContain(MARKER);
  });

  it("no PUBLISHED row is ok with no items, also when only DRAFT / ARCHIVED rows exist, and when there is no Event", async () => {
    const eventId = await oneEvent();
    await insertFaq(admin, eventId, { ref: ref(0xf9), state: "DRAFT", sortOrder: 0 });
    await insertFaq(admin, eventId, { ref: ref(0xf8), state: "ARCHIVED", sortOrder: 0 });
    expect(await repo.listPublishedFaqs()).toEqual({ status: "ok", items: [] });
    await resetPublicContent(admin);
    expect(await repo.listPublishedFaqs()).toEqual({ status: "ok", items: [] });
  });

  it("two Events are multiple_events and no row is returned", async () => {
    const eventId = await oneEvent();
    await insertFaq(admin, eventId, { ref: ref(0xf1), state: "PUBLISHED", sortOrder: 0 });
    await insertEvent(admin, { ref: EVENT_REF_2 });
    expect(await repo.listPublishedFaqs()).toEqual({ status: "multiple_events" });
  });
});

describe("TC-API-009-005 listPublishedAnnouncements and readPublishedAnnouncement (API-PUB-003, API-PUB-004, DB-SAL-001, API-PUB-READ-003)", () => {
  async function seed(): Promise<void> {
    const eventId = await oneEvent();
    await insertAnnouncement(admin, eventId, {
      ref: ref(0xa1),
      state: "PUBLISHED",
      publishedAt: "2030-05-01T00:00:00.000Z",
    });
    await insertAnnouncement(admin, eventId, {
      ref: ref(0xa3),
      state: "PUBLISHED",
      publishedAt: "2030-05-03T10:20:30.456Z",
    });
    // Same published_at: public_ref DESC decides.
    await insertAnnouncement(admin, eventId, {
      ref: ref(0xa2),
      state: "PUBLISHED",
      publishedAt: "2030-05-02T00:00:00.000Z",
    });
    await insertAnnouncement(admin, eventId, {
      ref: ref(0xa4),
      state: "PUBLISHED",
      publishedAt: "2030-05-02T00:00:00.000Z",
    });
    // Non-public rows that would sort first if they leaked (a later published_at).
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
  }

  it("the list has PUBLISHED rows only, by published_at DESC then public_ref DESC, with the full body, and no DRAFT / ARCHIVED content", async () => {
    await seed();
    const result = await repo.listPublishedAnnouncements();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.items.map((row) => row.publicRef)).toEqual([
      ref(0xa3),
      ref(0xa4),
      ref(0xa2),
      ref(0xa1),
    ]);
    expect(result.items[0]).toEqual({
      publicRef: ref(0xa3),
      title: "Synthetic title a3",
      body: "Synthetic body a3\nsecond line",
      publishedAt: "2030-05-03T10:20:30.456Z",
    });
    expect(JSON.stringify(result)).not.toContain(MARKER);
  });

  it("the detail of a PUBLISHED ref is found; the detail of a DRAFT, an ARCHIVED and an unknown ref is the same not_found", async () => {
    await seed();
    expect(await repo.readPublishedAnnouncement(ref(0xa3))).toEqual({
      status: "found",
      announcement: {
        publicRef: ref(0xa3),
        title: "Synthetic title a3",
        body: "Synthetic body a3\nsecond line",
        publishedAt: "2030-05-03T10:20:30.456Z",
      },
    });
    const draft = await repo.readPublishedAnnouncement(ref(0xa9));
    const archived = await repo.readPublishedAnnouncement(ref(0xa8));
    const unknown = await repo.readPublishedAnnouncement(ref(0xaf));
    expect(draft).toEqual({ status: "not_found" });
    expect(archived).toEqual({ status: "not_found" });
    expect(unknown).toEqual({ status: "not_found" });
    expect(JSON.stringify([draft, archived, unknown])).not.toContain(MARKER);
  });

  it("a ref is a value: a hostile string does not change the statement (the verified lower-case UUID is the only accepted form)", async () => {
    await seed();
    const outcome = await repo
      .readPublishedAnnouncement("x'; DELETE FROM app.announcements; --")
      .then(
        (result) => result,
        (error: { code?: string }) => error,
      );
    // Either a rejected non-UUID parameter (22P02) or a not_found: never a deletion, never a found row.
    expect(
      (outcome as { status?: string }).status === "not_found" ||
        (outcome as { code?: string }).code === "22P02" ||
        outcome instanceof Error,
    ).toBe(true);
    expect((await admin.query("SELECT count(*)::int AS n FROM app.announcements")).rows[0].n).toBe(
      6,
    );
  });

  it("a PUBLISHED Announcement whose published_at is NULL is returned as it is, with publishedAt null: the repository neither hides nor invents it (the API refuses it, API-PUB-READ-006)", async () => {
    const eventId = await oneEvent();
    await insertAnnouncement(admin, eventId, {
      ref: ref(0xa5),
      state: "PUBLISHED",
      publishedAt: null,
    });
    const list = await repo.listPublishedAnnouncements();
    expect(list.status).toBe("ok");
    if (list.status === "ok") {
      expect(list.items).toHaveLength(1);
      expect(list.items[0]?.publishedAt).toBeNull();
    }
    const detail = await repo.readPublishedAnnouncement(ref(0xa5));
    expect(detail.status).toBe("found");
    if (detail.status === "found") expect(detail.announcement.publishedAt).toBeNull();
  });

  it("no PUBLISHED row is ok with no items; no Event is ok with no items for the list and not_found for the detail", async () => {
    const eventId = await oneEvent();
    await insertAnnouncement(admin, eventId, { ref: ref(0xa9), state: "DRAFT", publishedAt: null });
    expect(await repo.listPublishedAnnouncements()).toEqual({ status: "ok", items: [] });
    await resetPublicContent(admin);
    expect(await repo.listPublishedAnnouncements()).toEqual({ status: "ok", items: [] });
    expect(await repo.readPublishedAnnouncement(ref(0xa1))).toEqual({ status: "not_found" });
  });

  it("two Events: the list and the detail are multiple_events (even for a PUBLISHED ref), with no row", async () => {
    await seed();
    await insertEvent(admin, { ref: EVENT_REF_2 });
    expect(await repo.listPublishedAnnouncements()).toEqual({ status: "multiple_events" });
    expect(await repo.readPublishedAnnouncement(ref(0xa3))).toEqual({ status: "multiple_events" });
  });
});

describe("TC-API-009-005 listEntryOfferings (API-PUB-005, SPEC-100 §15.1, SPEC-110 §26.1 API-PUB-005, API-PUB-READ-005)", () => {
  const DAY = 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString();

  async function seed(anchorMs: number): Promise<void> {
    const eventId = await oneEvent();
    const common = { createdAt: "2030-01-01T00:00:00.000Z" };
    // created_at ASC then public_ref ASC: two rows share created_at, inserted in the reverse ref order.
    await insertOffering(admin, eventId, {
      ...common,
      ref: ref(0xc3),
      name: "Synthetic ticket before the period",
      startsAt: iso(anchorMs + DAY),
      endsAt: iso(anchorMs + 2 * DAY),
      capacity: 8881,
      held: 12,
      committed: 3,
      unitAmount: "9007199254740993",
      description: "Synthetic description",
    });
    await insertOffering(admin, eventId, {
      ...common,
      ref: ref(0xc2),
      name: "Synthetic ticket in the period with room",
      startsAt: iso(anchorMs - DAY),
      endsAt: iso(anchorMs + DAY),
      capacity: 8881,
      held: 12,
      committed: 3,
      unitAmount: "0",
    });
    await insertOffering(admin, eventId, {
      createdAt: "2030-01-02T00:00:00.000Z",
      ref: ref(0xc4),
      name: "Synthetic ticket fully taken",
      startsAt: iso(anchorMs - DAY),
      endsAt: iso(anchorMs + DAY),
      capacity: 7771,
      held: 1,
      committed: 7770,
    });
    await insertOffering(admin, eventId, {
      createdAt: "2030-01-03T00:00:00.000Z",
      ref: ref(0xc5),
      name: "Synthetic ticket no stock",
      startsAt: iso(anchorMs - DAY),
      endsAt: iso(anchorMs + DAY),
      capacity: 0,
    });
    await insertOffering(admin, eventId, {
      createdAt: "2030-01-04T00:00:00.000Z",
      ref: ref(0xc6),
      name: "Synthetic ticket suspended",
      startsAt: iso(anchorMs - DAY),
      endsAt: iso(anchorMs + DAY),
      control: "SUSPENDED",
      capacity: 100,
    });
    await insertOffering(admin, eventId, {
      createdAt: "2030-01-05T00:00:00.000Z",
      ref: ref(0xc1),
      name: "Synthetic ticket after the period",
      startsAt: iso(anchorMs - 2 * DAY),
      endsAt: iso(anchorMs - DAY),
      capacity: 50,
    });
  }

  it("returns every Offering (SUSPENDED and out-of-period ones too) in created_at ASC, public_ref ASC order with hasRemainingCapacity from capacity - held - committed > 0", async () => {
    const anchor = (await dbNow(admin)).getTime();
    await seed(anchor);
    const result = await repo.listEntryOfferings();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(
      result.items.map((row) => [row.publicRef, row.hasRemainingCapacity, row.saleControlState]),
    ).toEqual([
      [ref(0xc2), true, "ENABLED"],
      [ref(0xc3), true, "ENABLED"],
      [ref(0xc4), false, "ENABLED"],
      [ref(0xc5), false, "ENABLED"],
      [ref(0xc6), true, "SUSPENDED"],
      [ref(0xc1), true, "ENABLED"],
    ]);
  });

  it("maps the other columns: unit_amount as a lossless decimal string, description null kept, times as UTC ISO with milliseconds, purchase limit", async () => {
    const anchor = (await dbNow(admin)).getTime();
    await seed(anchor);
    const result = await repo.listEntryOfferings();
    if (result.status !== "ok") throw new Error(`unexpected ${result.status}`);
    const before = result.items.find((row) => row.publicRef === ref(0xc3));
    expect(before).toEqual({
      publicRef: ref(0xc3),
      name: "Synthetic ticket before the period",
      description: "Synthetic description",
      unitAmount: "9007199254740993",
      currency: "JPY",
      salesStartsAt: iso(anchor + DAY),
      salesEndsAt: iso(anchor + 2 * DAY),
      saleControlState: "ENABLED",
      purchaseLimit: 4,
      hasRemainingCapacity: true,
    });
    expect(result.items.find((row) => row.publicRef === ref(0xc2))?.description).toBeNull();
    expect(result.items.find((row) => row.publicRef === ref(0xc2))?.unitAmount).toBe("0");
    expect(before?.salesStartsAt).toMatch(ISO_MS);
  });

  it("returns no counter or capacity value: the result has no held / committed / capacity key and none of their numbers", async () => {
    await seed((await dbNow(admin)).getTime());
    const text = JSON.stringify(await repo.listEntryOfferings());
    expect(text).not.toMatch(/held|committed|capacity(?!")|salesCapacity|quantity|checkin/i);
    for (const value of ["7771", "7770", "8881"]) expect(text).not.toContain(value);
  });

  it("now is the database clock: it lies between two database clock readings taken around the call, not the API process clock", async () => {
    await seed((await dbNow(admin)).getTime());
    const before = await dbNow(admin);
    const result = await repo.listEntryOfferings();
    const after = await dbNow(admin);
    if (result.status !== "ok") throw new Error(`unexpected ${result.status}`);
    expect(result.now).toMatch(ISO_MS);
    expect(Date.parse(result.now)).toBeGreaterThanOrEqual(before.getTime() - 1);
    expect(Date.parse(result.now)).toBeLessThanOrEqual(after.getTime() + 1);
  });

  it("no Offering is ok with no items and a database now; two Events are multiple_events", async () => {
    await oneEvent();
    const empty = await repo.listEntryOfferings();
    expect(empty.status).toBe("ok");
    if (empty.status === "ok") {
      expect(empty.items).toEqual([]);
      expect(empty.now).toMatch(ISO_MS);
    }
    await insertEvent(admin, { ref: EVENT_REF_2 });
    expect(await repo.listEntryOfferings()).toEqual({ status: "multiple_events" });
  });
});

describe("TC-API-009-005 listPublishedSponsorLogos (API-PUB-012, DB-SAL-001, DB-SAL-002, FR-PUB-015, BR-EVT-005)", () => {
  it("returns PUBLISHED rows only, by sort_order ASC then public_ref ASC, link_url NULL kept, without DRAFT / ARCHIVED", async () => {
    const eventId = await oneEvent();
    await insertLogo(admin, eventId, { ref: ref(0xd3), state: "PUBLISHED", sortOrder: 3 });
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
      linkUrl: `https://${MARKER}.example.test/draft`,
    });
    await insertLogo(admin, eventId, {
      ref: ref(0xd8),
      state: "ARCHIVED",
      sortOrder: 0,
      displayName: `${MARKER}-name-archived`,
      imageUrl: `https://${MARKER}.example.test/archived.png`,
    });
    const result = await repo.listPublishedSponsorLogos();
    expect(result).toEqual({
      status: "ok",
      items: [
        {
          publicRef: ref(0xd1),
          displayName: "Synthetic sponsor d1",
          imageUrl: "https://logos.example.test/d1.png",
          linkUrl: "https://sponsor.example.test/d1",
          sortOrder: 0,
        },
        {
          publicRef: ref(0xd2),
          displayName: "Synthetic sponsor d2",
          imageUrl: "https://logos.example.test/d2.png",
          linkUrl: null,
          sortOrder: 0,
        },
        {
          publicRef: ref(0xd3),
          displayName: "Synthetic sponsor d3",
          imageUrl: "https://logos.example.test/d3.png",
          linkUrl: "https://sponsor.example.test/d3",
          sortOrder: 3,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(MARKER);
  });

  it("no PUBLISHED row (only DRAFT / ARCHIVED, or no Event) is ok with no items; two Events are multiple_events", async () => {
    const eventId = await oneEvent();
    await insertLogo(admin, eventId, { ref: ref(0xd9), state: "DRAFT", sortOrder: 0 });
    await insertLogo(admin, eventId, { ref: ref(0xd8), state: "ARCHIVED", sortOrder: 0 });
    expect(await repo.listPublishedSponsorLogos()).toEqual({ status: "ok", items: [] });
    await resetPublicContent(admin);
    expect(await repo.listPublishedSponsorLogos()).toEqual({ status: "ok", items: [] });
    await insertEvent(admin, { ref: EVENT_REF });
    await insertEvent(admin, { ref: EVENT_REF_2 });
    expect(await repo.listPublishedSponsorLogos()).toEqual({ status: "multiple_events" });
  });
});

describe("TC-API-009-005 reads write nothing (SPEC-110 §26 / §26.1: read only)", () => {
  it("after every call the five tables hold the same rows with the same updated_at", async () => {
    const eventId = await oneEvent();
    await insertFaq(admin, eventId, { ref: ref(0xf1), state: "PUBLISHED", sortOrder: 0 });
    await insertFaq(admin, eventId, { ref: ref(0xf9), state: "DRAFT", sortOrder: 0 });
    await insertAnnouncement(admin, eventId, {
      ref: ref(0xa1),
      state: "PUBLISHED",
      publishedAt: "2030-05-01T00:00:00.000Z",
    });
    await insertAnnouncement(admin, eventId, { ref: ref(0xa9), state: "DRAFT", publishedAt: null });
    await insertLogo(admin, eventId, { ref: ref(0xd1), state: "PUBLISHED", sortOrder: 0 });
    await insertOffering(admin, eventId, {
      ref: ref(0xc1),
      name: "Synthetic ticket",
      startsAt: "2030-06-01T00:00:00.000Z",
      endsAt: "2030-06-30T00:00:00.000Z",
      capacity: 10,
      held: 2,
    });
    const before = await snapshot(admin);
    await repo.readPublicEvent();
    await repo.listPublishedFaqs();
    await repo.listPublishedAnnouncements();
    await repo.readPublishedAnnouncement(ref(0xa1));
    await repo.readPublishedAnnouncement(ref(0xa9));
    await repo.listEntryOfferings();
    await repo.listPublishedSponsorLogos();
    expect(await snapshot(admin)).toEqual(before);
  });
});

describe("TC-API-009-005 unavailable classification (SPEC-110 §50/§51, FP.DB.BEFORE_TRANSACTION)", () => {
  async function closedPort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
  }

  it("an unreachable database is returned as { status: 'unavailable' } by every read, not thrown and not an empty result", async () => {
    const pool = new Pool({
      host: "127.0.0.1",
      port: await closedPort(),
      user: "app_api_runtime",
      database: "synthetic",
      connectionTimeoutMillis: 500,
    });
    pool.on("error", () => undefined);
    try {
      const unreachable = createPublicContentRepository(pool);
      for (const result of [
        await unreachable.readPublicEvent(),
        await unreachable.listPublishedFaqs(),
        await unreachable.listPublishedAnnouncements(),
        await unreachable.readPublishedAnnouncement(ref(0xa1)),
        await unreachable.listEntryOfferings(),
        await unreachable.listPublishedSponsorLogos(),
      ])
        expect(result).toEqual({ status: "unavailable" });
    } finally {
      await pool.end();
    }
  });
});
