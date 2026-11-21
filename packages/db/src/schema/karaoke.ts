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
  uuid,
} from "drizzle-orm/pg-core";
import { app } from "./app-schema.ts";
import { internalId, publicRef, timestamptz, timestamptzNow } from "./common.ts";
import { events } from "./public-content.ts";
import { karaokeSalesConfigurations } from "./sales.ts";

// SPEC-100 §27 `app.karaoke_exclusive_scopes` and §28 `app.karaoke_slots`. These declarations exist for
// types and queries; the DDL source of truth is migrations/0004_karaoke_scopes_slots.sql (SPEC-100 §57,
// DB-MIG-002). Every constraint carries its explicit name (DB-ARC-007) and the SQL text equals the
// migration's. The Scope overlap exclusion `ex_karaoke_slots_scope_occupancy` (SPEC-100 §28.1) exists only
// in that migration (SQL-only DDL): it is deliberately not declared here, so it is never generated twice.

export const karaokeExclusiveScopes = app.table(
  "karaoke_exclusive_scopes",
  {
    id: internalId(),
    publicRef: publicRef(),
    eventId: bigint("event_id", { mode: "bigint" }).notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamptzNow("created_at"),
    updatedAt: timestamptzNow("updated_at"),
  },
  (t) => [
    primaryKey({ name: "pk_karaoke_exclusive_scopes", columns: [t.id] }),
    unique("uq_karaoke_exclusive_scopes_public_ref").on(t.publicRef),
    foreignKey({
      name: "fk_karaoke_exclusive_scopes_event",
      columns: [t.eventId],
      foreignColumns: [events.id],
    }).onDelete("restrict"),
  ],
);

export const karaokeSlots = app.table(
  "karaoke_slots",
  {
    id: internalId(),
    publicRef: publicRef(),
    exclusiveScopeId: bigint("exclusive_scope_id", { mode: "bigint" }).notNull(),
    salesConfigurationId: bigint("sales_configuration_id", { mode: "bigint" }).notNull(),
    state: text("state").$type<"AVAILABLE" | "HELD" | "SOLD" | "SALES_STOPPED">().notNull(),
    usageStart: timestamptz("usage_start").notNull(),
    usageEnd: timestamptz("usage_end").notNull(),
    cycleEnd: timestamptz("cycle_end").notNull(),
    generationCauseKey: uuid("generation_cause_key").notNull(),
    generationCandidateNo: integer("generation_candidate_no").notNull(),
    createdAt: timestamptzNow("created_at"),
    updatedAt: timestamptzNow("updated_at"),
  },
  (t) => [
    primaryKey({ name: "pk_karaoke_slots", columns: [t.id] }),
    unique("uq_karaoke_slots_public_ref").on(t.publicRef),
    unique("uq_karaoke_slots_scope_times").on(
      t.exclusiveScopeId,
      t.usageStart,
      t.usageEnd,
      t.cycleEnd,
    ),
    unique("uq_karaoke_slots_generation_candidate").on(
      t.generationCauseKey,
      t.exclusiveScopeId,
      t.generationCandidateNo,
    ),
    foreignKey({
      name: "fk_karaoke_slots_exclusive_scope",
      columns: [t.exclusiveScopeId],
      foreignColumns: [karaokeExclusiveScopes.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_karaoke_slots_sales_configuration",
      columns: [t.salesConfigurationId],
      foreignColumns: [karaokeSalesConfigurations.id],
    }).onDelete("restrict"),
    check("ck_karaoke_slots_state", sql`${t.state} IN ('AVAILABLE','HELD','SOLD','SALES_STOPPED')`),
    check("ck_karaoke_slots_usage_period", sql`${t.usageStart} < ${t.usageEnd}`),
    check("ck_karaoke_slots_cycle_end", sql`${t.usageEnd} <= ${t.cycleEnd}`),
    check("ck_karaoke_slots_generation_candidate_no", sql`${t.generationCandidateNo} >= 0`),
    index("ix_karaoke_slots_usage_start").on(t.usageStart),
    index("ix_karaoke_slots_scope_usage").on(t.exclusiveScopeId, t.usageStart),
  ],
);
