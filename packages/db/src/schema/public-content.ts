import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  text,
  unique,
} from "drizzle-orm/pg-core";
import { app } from "./app-schema.ts";
import { internalId, publicRef, timestamptz, timestamptzNow } from "./common.ts";

// SPEC-100 §13.1-13.4 public content tables. These declarations exist for types and queries; the DDL
// source of truth is migrations/0003_public_content_sales.sql (SPEC-100 §57, DB-MIG-002). Every
// constraint carries its explicit name (DB-ARC-007) and the SQL text equals the migration's.

export const events = app.table(
  "events",
  {
    id: internalId(),
    publicRef: publicRef(),
    name: text("name").notNull(),
    summary: text("summary"),
    startsAt: timestamptz("starts_at"),
    endsAt: timestamptz("ends_at"),
    businessTimezone: text("business_timezone").notNull().default("Asia/Tokyo"),
    venueName: text("venue_name"),
    venueDetails: text("venue_details"),
    accessInformation: text("access_information"),
    participantNotices: text("participant_notices"),
    createdAt: timestamptzNow("created_at"),
    updatedAt: timestamptzNow("updated_at"),
  },
  (t) => [
    primaryKey({ name: "pk_events", columns: [t.id] }),
    unique("uq_events_public_ref").on(t.publicRef),
    check("ck_events_name", sql`char_length(${t.name}) > 0`),
    check("ck_events_period", sql`${t.startsAt} < ${t.endsAt}`),
    check("ck_events_business_timezone", sql`${t.businessTimezone} = 'Asia/Tokyo'`),
  ],
);

export const faqItems = app.table(
  "faq_items",
  {
    id: internalId(),
    publicRef: publicRef(),
    eventId: bigint("event_id", { mode: "bigint" }).notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    state: text("state").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    publishedAt: timestamptz("published_at"),
    createdAt: timestamptzNow("created_at"),
    updatedAt: timestamptzNow("updated_at"),
  },
  (t) => [
    primaryKey({ name: "pk_faq_items", columns: [t.id] }),
    unique("uq_faq_items_public_ref").on(t.publicRef),
    foreignKey({
      name: "fk_faq_items_event",
      columns: [t.eventId],
      foreignColumns: [events.id],
    }).onDelete("restrict"),
    check("ck_faq_items_state", sql`${t.state} IN ('DRAFT','PUBLISHED','ARCHIVED')`),
    index("ix_faq_items_event_state_sort").on(t.eventId, t.state, t.sortOrder),
  ],
);

export const announcements = app.table(
  "announcements",
  {
    id: internalId(),
    publicRef: publicRef(),
    eventId: bigint("event_id", { mode: "bigint" }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    state: text("state").notNull(),
    publishedAt: timestamptz("published_at"),
    createdAt: timestamptzNow("created_at"),
    updatedAt: timestamptzNow("updated_at"),
  },
  (t) => [
    primaryKey({ name: "pk_announcements", columns: [t.id] }),
    unique("uq_announcements_public_ref").on(t.publicRef),
    foreignKey({
      name: "fk_announcements_event",
      columns: [t.eventId],
      foreignColumns: [events.id],
    }).onDelete("restrict"),
    check("ck_announcements_state", sql`${t.state} IN ('DRAFT','PUBLISHED','ARCHIVED')`),
    index("ix_announcements_event_state_published").on(t.eventId, t.state, t.publishedAt.desc()),
  ],
);

export const sponsorLogos = app.table(
  "sponsor_logos",
  {
    id: internalId(),
    publicRef: publicRef(),
    eventId: bigint("event_id", { mode: "bigint" }).notNull(),
    displayName: text("display_name").notNull(),
    imageUrl: text("image_url").notNull(),
    linkUrl: text("link_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    state: text("state").notNull().default("DRAFT"),
    publishedAt: timestamptz("published_at"),
    createdAt: timestamptzNow("created_at"),
    updatedAt: timestamptzNow("updated_at"),
  },
  (t) => [
    primaryKey({ name: "pk_sponsor_logos", columns: [t.id] }),
    unique("uq_sponsor_logos_public_ref").on(t.publicRef),
    foreignKey({
      name: "fk_sponsor_logos_event",
      columns: [t.eventId],
      foreignColumns: [events.id],
    }).onDelete("restrict"),
    check("ck_sponsor_logos_state", sql`${t.state} IN ('DRAFT','PUBLISHED','ARCHIVED')`),
    check("ck_sponsor_logos_display_name", sql`char_length(${t.displayName}) BETWEEN 1 AND 200`),
    check("ck_sponsor_logos_image_url", sql`char_length(${t.imageUrl}) BETWEEN 1 AND 2048`),
    check(
      "ck_sponsor_logos_link_url",
      sql`${t.linkUrl} IS NULL OR char_length(${t.linkUrl}) BETWEEN 1 AND 2048`,
    ),
    check("ck_sponsor_logos_sort_order", sql`${t.sortOrder} >= 0`),
    check(
      "ck_sponsor_logos_published_at",
      sql`${t.state} <> 'PUBLISHED' OR ${t.publishedAt} IS NOT NULL`,
    ),
    index("ix_sponsor_logos_event_state_sort").on(t.eventId, t.state, t.sortOrder, t.publicRef),
  ],
);
