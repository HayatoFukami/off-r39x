// SPEC-100 §55: read-only modules for the public content (API-PUB-001..005, API-PUB-012; SPEC-110 §26.1).
// One use case per function, database work only. Every function is exactly one plain statement on the
// pool (an autocommit statement is one snapshot; DEV-DB-008): no transaction, no write, no row lock.
// The rows, the Event count and, for the Entry read, the judgement time all come out of that one
// statement, so they are mutually consistent.
//
// The "current Event" is the only Event there is (SPEC-100 DB-SEED-001, DB-SEED-007): the statements read
// at most two Events to learn whether there are 0, 1 or 2 or more, and select content rows only when
// there is exactly one (API-PUB-READ-002). FAQ / Announcement / Sponsor Logo rows are selected by
// `state = 'PUBLISHED'` in the statement's WHERE (DB-SAL-001, DB-SAL-002), never filtered afterwards.
// No Internal ID, Publication State, administrative timestamp or counter is selected (SPEC-110 §9, §55).
//
// The statements are hand-written SQL because the Event count and the content rows must come from the
// same statement, which the query builder does not express. Identifiers are static text and the one
// value (the Announcement ref) is a bound parameter (DEV-DB-004). timestamptz and bigint columns are
// cast to text in the statement and decoded here with node-postgres's own parser / as a lossless string.
import { DrizzleQueryError, type SQL, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { type Pool, types } from "pg";
import { isDatabaseTemporaryFailure, typeDirectQueryFailure } from "../errors.ts";

/** `YYYY-MM-DDTHH:mm:ss.sssZ` (SPEC-110 §10). */
type IsoUtc = string;

export type PublicEventRow = {
  publicRef: string;
  name: string;
  summary: string | null;
  startsAt: IsoUtc | null;
  endsAt: IsoUtc | null;
  businessTimezone: string;
  venueName: string | null;
  venueDetails: string | null;
  accessInformation: string | null;
  participantNotices: string | null;
};
export type PublicFaqRow = {
  publicRef: string;
  question: string;
  answer: string;
  sortOrder: number;
};
export type PublicAnnouncementRow = {
  publicRef: string;
  title: string;
  body: string;
  /** NULL is returned as it is; the API's response schema refuses it (API-PUB-READ-006). */
  publishedAt: IsoUtc | null;
};
export type PublicEntryOfferingRow = {
  publicRef: string;
  name: string;
  description: string | null;
  /** bigint as a decimal string (lossless, DEV-DB-006). */
  unitAmount: string;
  currency: string;
  salesStartsAt: IsoUtc;
  salesEndsAt: IsoUtc;
  saleControlState: "ENABLED" | "SUSPENDED";
  purchaseLimit: number;
  /** `sales_capacity - held_quantity - committed_quantity > 0`. The counters themselves never leave here. */
  hasRemainingCapacity: boolean;
};
export type PublicSponsorLogoRow = {
  publicRef: string;
  displayName: string;
  imageUrl: string;
  linkUrl: string | null;
  sortOrder: number;
};

export type PublicEventRead =
  | { status: "found"; event: PublicEventRow }
  | { status: "none" }
  | { status: "multiple" }
  | { status: "unavailable" };
export type PublicListRead<Row> =
  | { status: "ok"; items: Row[] }
  | { status: "multiple_events" }
  | { status: "unavailable" };
export type PublicAnnouncementRead =
  | { status: "found"; announcement: PublicAnnouncementRow }
  | { status: "not_found" }
  | { status: "multiple_events" }
  | { status: "unavailable" };
export type PublicEntryOfferingsRead =
  | {
      status: "ok";
      /** The database clock of the same statement. */
      now: IsoUtc;
      items: PublicEntryOfferingRow[];
    }
  | { status: "multiple_events" }
  | { status: "unavailable" };

// node-postgres's own timestamptz parser (pg-types / postgres-date), as in transactions/profile.ts: it
// keeps the year, the offset and the BC era of the text PostgreSQL sends.
const parseTimestamptz = types.getTypeParser(types.builtins.TIMESTAMPTZ) as (text: string) => Date;
const iso = (text: string): IsoUtc => parseTimestamptz(text).toISOString();
const isoOrNull = (text: string | null): IsoUtc | null => (text === null ? null : iso(text));
/** A column the table declares NOT NULL. A NULL here is a defect, never a value to hide. */
function present<T>(value: T | null): T {
  if (value === null) throw new Error("Unexpected NULL in a NOT NULL public content column");
  return value;
}

/** drizzle-orm wraps driver errors in DrizzleQueryError (the SQLSTATE is on `cause`). */
const isFromDriver = (error: unknown): error is DrizzleQueryError =>
  error instanceof DrizzleQueryError && error.cause !== undefined;

// The Event scope shared by the content reads: `cnt` is always exactly one row, holding the number of
// Events seen (0, 1, or 2 meaning "2 or more") and the Event's id when there is exactly one.
const EVENT_SCOPE: SQL = sql`
  ev AS (SELECT id FROM app.events ORDER BY id LIMIT 2),
  cnt AS (SELECT count(*)::int AS event_count, min(id) AS event_id FROM ev)`;
// The row filter of a content read (alias `e` is the content table): the single Event's rows only. With
// 0 or 2 or more Events no row is selected.
const IN_EVENT: SQL = sql`(SELECT event_count FROM cnt) = 1 AND e.event_id = (SELECT event_id FROM cnt)`;

type EventCount = { event_count: number };

export function createPublicContentRepository(pool: Pool) {
  const db = drizzle(pool);

  // Runs the one statement. A driver rejection that is a database temporary failure is `undefined`
  // (the caller answers `unavailable`); anything else is rethrown (statement timeout, a defect, a
  // constraint: the HTTP boundary answers 500), as in transactions/profile.ts. Only the driver's
  // rejection (the cause drizzle wraps) came from the database: one without a SQLSTATE (a refused
  // connection, a pool acquisition timeout) is typed as unavailable first.
  async function run<Row extends Record<string, unknown>>(
    statement: SQL,
  ): Promise<Row[] | undefined> {
    try {
      // The statement names and casts every column (see the SELECT lists), so a row is the declared shape.
      return (await db.execute(statement)).rows as Row[];
    } catch (caught) {
      const fromDriver = isFromDriver(caught);
      const error = fromDriver ? caught.cause : caught;
      if (isDatabaseTemporaryFailure(fromDriver ? typeDirectQueryFailure(error) : error))
        return undefined;
      throw error;
    }
  }

  return {
    /** API-PUB-001. */
    async readPublicEvent(): Promise<PublicEventRead> {
      type Row = {
        public_ref: string;
        name: string;
        summary: string | null;
        starts_at: string | null;
        ends_at: string | null;
        business_timezone: string;
        venue_name: string | null;
        venue_details: string | null;
        access_information: string | null;
        participant_notices: string | null;
      };
      const rows = await run<Row>(sql`
        SELECT e.public_ref::text AS public_ref, e.name AS name, e.summary AS summary,
          e.starts_at::text AS starts_at, e.ends_at::text AS ends_at,
          e.business_timezone AS business_timezone, e.venue_name AS venue_name,
          e.venue_details AS venue_details, e.access_information AS access_information,
          e.participant_notices AS participant_notices
        FROM app.events e
        ORDER BY e.id
        LIMIT 2`);
      if (!rows) return { status: "unavailable" };
      const [row, second] = rows;
      if (!row) return { status: "none" };
      if (second) return { status: "multiple" };
      return {
        status: "found",
        event: {
          publicRef: row.public_ref,
          name: row.name,
          summary: row.summary,
          startsAt: isoOrNull(row.starts_at),
          endsAt: isoOrNull(row.ends_at),
          businessTimezone: row.business_timezone,
          venueName: row.venue_name,
          venueDetails: row.venue_details,
          accessInformation: row.access_information,
          participantNotices: row.participant_notices,
        },
      };
    },

    /** API-PUB-002. Order: `sort_order ASC, public_ref ASC` (API-PUB-READ-005). */
    async listPublishedFaqs(): Promise<PublicListRead<PublicFaqRow>> {
      type Row = EventCount & {
        public_ref: string | null;
        question: string | null;
        answer: string | null;
        sort_order: number | null;
      };
      const rows = await run<Row>(sql`
        WITH ${EVENT_SCOPE},
        pub AS (
          SELECT e.public_ref AS public_ref, e.question AS question, e.answer AS answer,
            e.sort_order AS sort_order
          FROM app.faq_items e
          WHERE e.state = 'PUBLISHED' AND ${IN_EVENT}
        )
        SELECT cnt.event_count AS event_count, pub.public_ref::text AS public_ref,
          pub.question AS question, pub.answer AS answer, pub.sort_order AS sort_order
        FROM cnt LEFT JOIN pub ON true
        ORDER BY pub.sort_order ASC, pub.public_ref ASC`);
      if (!rows) return { status: "unavailable" };
      if (rows.some((row) => row.event_count > 1)) return { status: "multiple_events" };
      const items: PublicFaqRow[] = [];
      for (const row of rows)
        if (row.public_ref !== null)
          items.push({
            publicRef: row.public_ref,
            question: present(row.question),
            answer: present(row.answer),
            sortOrder: present(row.sort_order),
          });
      return { status: "ok", items };
    },

    /** API-PUB-003. Order: `published_at DESC, public_ref DESC` (API-PUB-READ-005, SPEC-110 §12). */
    async listPublishedAnnouncements(): Promise<PublicListRead<PublicAnnouncementRow>> {
      type Row = EventCount & {
        public_ref: string | null;
        title: string | null;
        body: string | null;
        published_at: string | null;
      };
      const rows = await run<Row>(sql`
        WITH ${EVENT_SCOPE},
        pub AS (
          SELECT e.public_ref AS public_ref, e.title AS title, e.body AS body,
            e.published_at AS published_at
          FROM app.announcements e
          WHERE e.state = 'PUBLISHED' AND ${IN_EVENT}
        )
        SELECT cnt.event_count AS event_count, pub.public_ref::text AS public_ref,
          pub.title AS title, pub.body AS body, pub.published_at::text AS published_at
        FROM cnt LEFT JOIN pub ON true
        ORDER BY pub.published_at DESC, pub.public_ref DESC`);
      if (!rows) return { status: "unavailable" };
      if (rows.some((row) => row.event_count > 1)) return { status: "multiple_events" };
      const items: PublicAnnouncementRow[] = [];
      for (const row of rows)
        if (row.public_ref !== null)
          items.push({
            publicRef: row.public_ref,
            title: present(row.title),
            body: present(row.body),
            publishedAt: isoOrNull(row.published_at),
          });
      return { status: "ok", items };
    },

    /**
     * API-PUB-004. A DRAFT / ARCHIVED row and an absent row are the same `not_found`: the statement
     * selects only a PUBLISHED row, so the other kinds are not even read.
     */
    async readPublishedAnnouncement(announcementRef: string): Promise<PublicAnnouncementRead> {
      type Row = EventCount & {
        public_ref: string | null;
        title: string | null;
        body: string | null;
        published_at: string | null;
      };
      const rows = await run<Row>(sql`
        WITH ${EVENT_SCOPE},
        pub AS (
          SELECT e.public_ref AS public_ref, e.title AS title, e.body AS body,
            e.published_at AS published_at
          FROM app.announcements e
          WHERE e.public_ref = ${announcementRef}::uuid AND e.state = 'PUBLISHED' AND ${IN_EVENT}
        )
        SELECT cnt.event_count AS event_count, pub.public_ref::text AS public_ref,
          pub.title AS title, pub.body AS body, pub.published_at::text AS published_at
        FROM cnt LEFT JOIN pub ON true`);
      if (!rows) return { status: "unavailable" };
      if (rows.some((row) => row.event_count > 1)) return { status: "multiple_events" };
      for (const row of rows)
        if (row.public_ref !== null)
          return {
            status: "found",
            announcement: {
              publicRef: row.public_ref,
              title: present(row.title),
              body: present(row.body),
              publishedAt: isoOrNull(row.published_at),
            },
          };
      return { status: "not_found" };
    },

    /**
     * API-PUB-005. Order: `created_at ASC, public_ref ASC`. The judgement time is the statement's own
     * `statement_timestamp()`, so the capacity flag and the time are one snapshot (API-PUB-005 販売状態).
     */
    async listEntryOfferings(): Promise<PublicEntryOfferingsRead> {
      type Row = EventCount & {
        statement_time: string;
        public_ref: string | null;
        name: string | null;
        description: string | null;
        unit_amount: string | null;
        currency: string | null;
        sales_starts_at: string | null;
        sales_ends_at: string | null;
        sale_control_state: "ENABLED" | "SUSPENDED" | null;
        purchase_limit: number | null;
        has_remaining_capacity: boolean | null;
      };
      const rows = await run<Row>(sql`
        WITH ${EVENT_SCOPE},
        pub AS (
          SELECT e.public_ref AS public_ref, e.name AS name, e.description AS description,
            e.unit_amount AS unit_amount, e.currency AS currency,
            e.sales_starts_at AS sales_starts_at, e.sales_ends_at AS sales_ends_at,
            e.sale_control_state AS sale_control_state, e.purchase_limit AS purchase_limit,
            (e.sales_capacity::bigint - e.held_quantity - e.committed_quantity) > 0
              AS has_remaining_capacity,
            e.created_at AS created_at
          FROM app.entry_ticket_offerings e
          WHERE ${IN_EVENT}
        )
        SELECT cnt.event_count AS event_count, statement_timestamp()::text AS statement_time,
          pub.public_ref::text AS public_ref, pub.name AS name, pub.description AS description,
          pub.unit_amount::text AS unit_amount, pub.currency AS currency,
          pub.sales_starts_at::text AS sales_starts_at, pub.sales_ends_at::text AS sales_ends_at,
          pub.sale_control_state AS sale_control_state, pub.purchase_limit AS purchase_limit,
          pub.has_remaining_capacity AS has_remaining_capacity
        FROM cnt LEFT JOIN pub ON true
        ORDER BY pub.created_at ASC, pub.public_ref ASC`);
      if (!rows) return { status: "unavailable" };
      if (rows.some((row) => row.event_count > 1)) return { status: "multiple_events" };
      // `cnt` is always one row, so there is always a statement time (also with 0 Events or 0 Offerings).
      const first = rows[0];
      if (!first) throw new Error("The Entry Offering statement answered no row");
      const items: PublicEntryOfferingRow[] = [];
      for (const row of rows)
        if (row.public_ref !== null)
          items.push({
            publicRef: row.public_ref,
            name: present(row.name),
            description: row.description,
            unitAmount: present(row.unit_amount),
            currency: present(row.currency),
            salesStartsAt: iso(present(row.sales_starts_at)),
            salesEndsAt: iso(present(row.sales_ends_at)),
            saleControlState: present(row.sale_control_state),
            purchaseLimit: present(row.purchase_limit),
            hasRemainingCapacity: present(row.has_remaining_capacity),
          });
      return { status: "ok", now: iso(first.statement_time), items };
    },

    /** API-PUB-012. Order: `sort_order ASC, public_ref ASC`. */
    async listPublishedSponsorLogos(): Promise<PublicListRead<PublicSponsorLogoRow>> {
      type Row = EventCount & {
        public_ref: string | null;
        display_name: string | null;
        image_url: string | null;
        link_url: string | null;
        sort_order: number | null;
      };
      const rows = await run<Row>(sql`
        WITH ${EVENT_SCOPE},
        pub AS (
          SELECT e.public_ref AS public_ref, e.display_name AS display_name,
            e.image_url AS image_url, e.link_url AS link_url, e.sort_order AS sort_order
          FROM app.sponsor_logos e
          WHERE e.state = 'PUBLISHED' AND ${IN_EVENT}
        )
        SELECT cnt.event_count AS event_count, pub.public_ref::text AS public_ref,
          pub.display_name AS display_name, pub.image_url AS image_url,
          pub.link_url AS link_url, pub.sort_order AS sort_order
        FROM cnt LEFT JOIN pub ON true
        ORDER BY pub.sort_order ASC, pub.public_ref ASC`);
      if (!rows) return { status: "unavailable" };
      if (rows.some((row) => row.event_count > 1)) return { status: "multiple_events" };
      const items: PublicSponsorLogoRow[] = [];
      for (const row of rows)
        if (row.public_ref !== null)
          items.push({
            publicRef: row.public_ref,
            displayName: present(row.display_name),
            imageUrl: present(row.image_url),
            linkUrl: row.link_url,
            sortOrder: present(row.sort_order),
          });
      return { status: "ok", items };
    },
  };
}
