// Synthetic rows of the public content and sales tables for the PR-L2-3 real-PostgreSQL tests
// (TC-API-009-005, TC-API-009-006, TC-API-006-101). Test only: the rows are inserted by the setup identity
// (a plain `pg` Client) and read back by the runtime role. Every non-public row (DRAFT / ARCHIVED) carries
// NONPUBLIC_MARKER in each string so a leak is visible in a response. No real names, URLs or amounts.
import type { Client } from "pg";

export const MARKER = "nonpublic-marker";

export async function resetPublicContent(admin: Client): Promise<void> {
  // ON DELETE RESTRICT: children first.
  for (const table of [
    "sponsor_logos",
    "announcements",
    "faq_items",
    "entry_ticket_offerings",
    "karaoke_sales_configurations",
    "goods_inventory",
    "goods",
    "events",
  ])
    await admin.query(`DELETE FROM app.${table}`);
}

export interface EventSeed {
  ref: string;
  name?: string;
  summary?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  venueName?: string | null;
  venueDetails?: string | null;
  accessInformation?: string | null;
  participantNotices?: string | null;
}
/** Inserts an Event and returns its Internal ID (as a decimal string; never sent to a client). */
export async function insertEvent(admin: Client, seed: EventSeed): Promise<string> {
  const result = await admin.query(
    `INSERT INTO app.events(public_ref, name, summary, starts_at, ends_at, venue_name, venue_details,
                            access_information, participant_notices)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id::text AS id`,
    [
      seed.ref,
      seed.name ?? "Synthetic Event 2030",
      seed.summary === undefined ? "Synthetic summary" : seed.summary,
      seed.startsAt === undefined ? "2030-06-15T03:00:00.000Z" : seed.startsAt,
      seed.endsAt === undefined ? "2030-06-15T09:30:00.000Z" : seed.endsAt,
      seed.venueName === undefined ? "Synthetic Hall" : seed.venueName,
      seed.venueDetails === undefined ? "Synthetic floor 3" : seed.venueDetails,
      seed.accessInformation === undefined ? "Synthetic access guide" : seed.accessInformation,
      seed.participantNotices === undefined
        ? "Synthetic notice one\nSynthetic notice two"
        : seed.participantNotices,
    ],
  );
  return result.rows[0].id as string;
}

export type State = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export async function insertFaq(
  admin: Client,
  eventId: string,
  seed: { ref: string; state: State; sortOrder: number; question?: string; answer?: string },
): Promise<void> {
  await admin.query(
    `INSERT INTO app.faq_items(public_ref, event_id, question, answer, state, sort_order, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      seed.ref,
      eventId,
      seed.question ?? `Synthetic question ${seed.ref.slice(-2)}`,
      seed.answer ?? `Synthetic answer ${seed.ref.slice(-2)}`,
      seed.state,
      seed.sortOrder,
      seed.state === "DRAFT" ? null : "2030-05-01T00:00:00.000Z",
    ],
  );
}

export async function insertAnnouncement(
  admin: Client,
  eventId: string,
  seed: {
    ref: string;
    state: State;
    publishedAt: string | null;
    title?: string;
    body?: string;
  },
): Promise<void> {
  await admin.query(
    `INSERT INTO app.announcements(public_ref, event_id, title, body, state, published_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      seed.ref,
      eventId,
      seed.title ?? `Synthetic title ${seed.ref.slice(-2)}`,
      seed.body ?? `Synthetic body ${seed.ref.slice(-2)}\nsecond line`,
      seed.state,
      seed.publishedAt,
    ],
  );
}

export async function insertLogo(
  admin: Client,
  eventId: string,
  seed: {
    ref: string;
    state: State;
    sortOrder: number;
    linkUrl?: string | null;
    displayName?: string;
    imageUrl?: string;
  },
): Promise<void> {
  await admin.query(
    `INSERT INTO app.sponsor_logos(public_ref, event_id, display_name, image_url, link_url, sort_order,
                                   state, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      seed.ref,
      eventId,
      seed.displayName ?? `Synthetic sponsor ${seed.ref.slice(-2)}`,
      seed.imageUrl ?? `https://logos.example.test/${seed.ref.slice(-2)}.png`,
      seed.linkUrl === undefined
        ? `https://sponsor.example.test/${seed.ref.slice(-2)}`
        : seed.linkUrl,
      seed.sortOrder,
      seed.state,
      seed.state === "DRAFT" ? null : "2030-05-01T00:00:00.000Z",
    ],
  );
}

export interface OfferingSeed {
  ref: string;
  name: string;
  description?: string | null;
  unitAmount?: string;
  startsAt: string;
  endsAt: string;
  control?: "ENABLED" | "SUSPENDED";
  capacity: number;
  held?: number;
  committed?: number;
  purchaseLimit?: number;
  createdAt?: string;
}
export async function insertOffering(
  admin: Client,
  eventId: string,
  seed: OfferingSeed,
): Promise<void> {
  await admin.query(
    `INSERT INTO app.entry_ticket_offerings(public_ref, event_id, name, description, unit_amount, currency,
        sales_starts_at, sales_ends_at, sale_control_state, sales_capacity, held_quantity,
        committed_quantity, purchase_limit, created_at)
     VALUES ($1, $2, $3, $4, $5, 'JPY', $6, $7, $8, $9, $10, $11, $12, COALESCE($13::timestamptz, transaction_timestamp()))`,
    [
      seed.ref,
      eventId,
      seed.name,
      seed.description === undefined ? null : seed.description,
      seed.unitAmount ?? "1000",
      seed.startsAt,
      seed.endsAt,
      seed.control ?? "ENABLED",
      seed.capacity,
      seed.held ?? 0,
      seed.committed ?? 0,
      seed.purchaseLimit ?? 4,
      seed.createdAt ?? null,
    ],
  );
}

/** Every row of the five tables as JSON (updated_at included): proves a call wrote nothing. */
export async function snapshot(admin: Client): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const table of [
    "events",
    "faq_items",
    "announcements",
    "sponsor_logos",
    "entry_ticket_offerings",
  ])
    out[table] = (
      await admin.query(`SELECT to_jsonb(t) AS j FROM app.${table} t ORDER BY id`)
    ).rows.map((row) => row.j);
  return out;
}

/** The database clock, as a Date with millisecond precision. */
export async function dbNow(admin: Client): Promise<Date> {
  const result = await admin.query("SELECT clock_timestamp() AS t");
  return result.rows[0].t as Date;
}
