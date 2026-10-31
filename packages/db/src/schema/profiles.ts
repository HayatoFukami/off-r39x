import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const app = pgSchema("app");
const id = () => bigint("id", { mode: "bigint" }).generatedAlwaysAsIdentity();
const time = (name: string) =>
  timestamp(name, { withTimezone: true }).notNull().default(sql`transaction_timestamp()`);
export const businessProfiles = app.table(
  "business_profiles",
  {
    id: id(),
    publicRef: uuid("public_ref").notNull().defaultRandom(),
    authSubject: uuid("auth_subject").notNull(),
    displayName: text("display_name"),
    createdAt: time("created_at"),
    updatedAt: time("updated_at"),
  },
  (t) => [
    primaryKey({ name: "pk_business_profiles", columns: [t.id] }),
    unique("uq_business_profiles_public_ref").on(t.publicRef),
    unique("uq_business_profiles_auth_subject").on(t.authSubject),
    check(
      "ck_business_profiles_display_name",
      sql`${t.displayName} IS NULL OR char_length(${t.displayName}) BETWEEN 1 AND 80`,
    ),
  ],
);
export const roleAssignments = app.table(
  "role_assignments",
  {
    id: id(),
    publicRef: uuid("public_ref").notNull().defaultRandom(),
    profileId: bigint("profile_id", { mode: "bigint" }).notNull(),
    role: text("role").notNull(),
    state: text("state").notNull(),
    grantedByProfileId: bigint("granted_by_profile_id", { mode: "bigint" }),
    revokedByProfileId: bigint("revoked_by_profile_id", { mode: "bigint" }),
    grantedAt: time("granted_at"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: time("created_at"),
  },
  (t) => [
    primaryKey({ name: "pk_role_assignments", columns: [t.id] }),
    unique("uq_role_assignments_public_ref").on(t.publicRef),
    foreignKey({
      name: "fk_role_assignments_profile",
      columns: [t.profileId],
      foreignColumns: [businessProfiles.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_role_assignments_granted_by_profile",
      columns: [t.grantedByProfileId],
      foreignColumns: [businessProfiles.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_role_assignments_revoked_by_profile",
      columns: [t.revokedByProfileId],
      foreignColumns: [businessProfiles.id],
    }).onDelete("restrict"),
    check("ck_role_assignments_role", sql`${t.role} IN ('STAFF','ADMINISTRATOR')`),
    check("ck_role_assignments_state", sql`${t.state} IN ('ACTIVE','REVOKED')`),
    check(
      "ck_role_assignments_revocation",
      sql`(${t.state} = 'ACTIVE' AND ${t.revokedAt} IS NULL AND ${t.revokedByProfileId} IS NULL) OR (${t.state} = 'REVOKED' AND ${t.revokedAt} IS NOT NULL)`,
    ),
    uniqueIndex("ux_role_assignments_profile_role_active")
      .on(t.profileId, t.role)
      .where(sql`${t.state} = 'ACTIVE'`),
  ],
);
