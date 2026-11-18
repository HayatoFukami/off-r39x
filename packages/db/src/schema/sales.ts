import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  integer,
  primaryKey,
  smallint,
  text,
  unique,
} from "drizzle-orm/pg-core";
import { app } from "./app-schema.ts";
import { internalId, publicRef, timestamptz, timestamptzNow } from "./common.ts";
import { events } from "./public-content.ts";

// SPEC-100 §15.1-15.3 sales configuration tables. These declarations exist for types and queries; the
// DDL source of truth is migrations/0003_public_content_sales.sql (SPEC-100 §57, DB-MIG-002). Every
// constraint carries its explicit name (DB-ARC-007) and the SQL text equals the migration's. The
// Entry Ticket counters are protected by ck_entry_ticket_offerings_capacity (DI-030-004).

export const entryTicketOfferings = app.table(
  "entry_ticket_offerings",
  {
    id: internalId(),
    publicRef: publicRef(),
    eventId: bigint("event_id", { mode: "bigint" }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    unitAmount: bigint("unit_amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    salesStartsAt: timestamptz("sales_starts_at").notNull(),
    salesEndsAt: timestamptz("sales_ends_at").notNull(),
    saleControlState: text("sale_control_state").$type<"ENABLED" | "SUSPENDED">().notNull(),
    salesCapacity: integer("sales_capacity").notNull(),
    heldQuantity: integer("held_quantity").notNull().default(0),
    committedQuantity: integer("committed_quantity").notNull().default(0),
    purchaseLimit: integer("purchase_limit").notNull(),
    checkinOpensAt: timestamptz("checkin_opens_at"),
    checkinClosesAt: timestamptz("checkin_closes_at"),
    createdAt: timestamptzNow("created_at"),
    updatedAt: timestamptzNow("updated_at"),
  },
  (t) => [
    primaryKey({ name: "pk_entry_ticket_offerings", columns: [t.id] }),
    unique("uq_entry_ticket_offerings_public_ref").on(t.publicRef),
    foreignKey({
      name: "fk_entry_ticket_offerings_event",
      columns: [t.eventId],
      foreignColumns: [events.id],
    }).onDelete("restrict"),
    check("ck_entry_ticket_offerings_unit_amount", sql`${t.unitAmount} >= 0`),
    check(
      "ck_entry_ticket_offerings_currency",
      sql`${t.currency} = upper(${t.currency}) AND ${t.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "ck_entry_ticket_offerings_sale_control_state",
      sql`${t.saleControlState} IN ('ENABLED','SUSPENDED')`,
    ),
    check("ck_entry_ticket_offerings_purchase_limit", sql`${t.purchaseLimit} > 0`),
    check("ck_entry_ticket_offerings_sales_period", sql`${t.salesStartsAt} < ${t.salesEndsAt}`),
    check("ck_entry_ticket_offerings_sales_capacity", sql`${t.salesCapacity} >= 0`),
    check("ck_entry_ticket_offerings_held_quantity", sql`${t.heldQuantity} >= 0`),
    check("ck_entry_ticket_offerings_committed_quantity", sql`${t.committedQuantity} >= 0`),
    check(
      "ck_entry_ticket_offerings_capacity",
      sql`${t.heldQuantity}::bigint + ${t.committedQuantity} <= ${t.salesCapacity}`,
    ),
    check(
      "ck_entry_ticket_offerings_checkin_window",
      sql`${t.checkinOpensAt} < ${t.checkinClosesAt}`,
    ),
  ],
);

export const karaokeSalesConfigurations = app.table(
  "karaoke_sales_configurations",
  {
    id: internalId(),
    publicRef: publicRef(),
    eventId: bigint("event_id", { mode: "bigint" }).notNull(),
    name: text("name").notNull(),
    unitAmount: bigint("unit_amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    salesStartsAt: timestamptz("sales_starts_at").notNull(),
    salesEndsAt: timestamptz("sales_ends_at").notNull(),
    saleControlState: text("sale_control_state").$type<"ENABLED" | "SUSPENDED">().notNull(),
    purchaseLimit: integer("purchase_limit").notNull(),
    standardUsageMinutes: smallint("standard_usage_minutes").notNull().default(15),
    standardMaintenanceMinutes: smallint("standard_maintenance_minutes").notNull().default(5),
    createdAt: timestamptzNow("created_at"),
    updatedAt: timestamptzNow("updated_at"),
  },
  (t) => [
    primaryKey({ name: "pk_karaoke_sales_configurations", columns: [t.id] }),
    unique("uq_karaoke_sales_configurations_public_ref").on(t.publicRef),
    foreignKey({
      name: "fk_karaoke_sales_configurations_event",
      columns: [t.eventId],
      foreignColumns: [events.id],
    }).onDelete("restrict"),
    check("ck_karaoke_sales_configurations_unit_amount", sql`${t.unitAmount} >= 0`),
    check(
      "ck_karaoke_sales_configurations_currency",
      sql`${t.currency} = upper(${t.currency}) AND ${t.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "ck_karaoke_sales_configurations_sale_control_state",
      sql`${t.saleControlState} IN ('ENABLED','SUSPENDED')`,
    ),
    check("ck_karaoke_sales_configurations_purchase_limit", sql`${t.purchaseLimit} > 0`),
    check(
      "ck_karaoke_sales_configurations_sales_period",
      sql`${t.salesStartsAt} < ${t.salesEndsAt}`,
    ),
    check(
      "ck_karaoke_sales_configurations_standard_usage_minutes",
      sql`${t.standardUsageMinutes} = 15`,
    ),
    check(
      "ck_karaoke_sales_configurations_standard_maintenance_minutes",
      sql`${t.standardMaintenanceMinutes} = 5`,
    ),
  ],
);

export const goods = app.table(
  "goods",
  {
    id: internalId(),
    publicRef: publicRef(),
    eventId: bigint("event_id", { mode: "bigint" }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    unitAmount: bigint("unit_amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    salesStartsAt: timestamptz("sales_starts_at").notNull(),
    salesEndsAt: timestamptz("sales_ends_at").notNull(),
    saleControlState: text("sale_control_state").$type<"ENABLED" | "SUSPENDED">().notNull(),
    purchaseLimit: integer("purchase_limit").notNull(),
    createdAt: timestamptzNow("created_at"),
    updatedAt: timestamptzNow("updated_at"),
  },
  (t) => [
    primaryKey({ name: "pk_goods", columns: [t.id] }),
    unique("uq_goods_public_ref").on(t.publicRef),
    foreignKey({
      name: "fk_goods_event",
      columns: [t.eventId],
      foreignColumns: [events.id],
    }).onDelete("restrict"),
    check("ck_goods_unit_amount", sql`${t.unitAmount} >= 0`),
    check(
      "ck_goods_currency",
      sql`${t.currency} = upper(${t.currency}) AND ${t.currency} ~ '^[A-Z]{3}$'`,
    ),
    check("ck_goods_sale_control_state", sql`${t.saleControlState} IN ('ENABLED','SUSPENDED')`),
    check("ck_goods_purchase_limit", sql`${t.purchaseLimit} > 0`),
    check("ck_goods_sales_period", sql`${t.salesStartsAt} < ${t.salesEndsAt}`),
  ],
);
