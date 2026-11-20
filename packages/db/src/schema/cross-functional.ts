import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  foreignKey,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { app } from "./app-schema.ts";
import { internalId, timestamptzNow } from "./common.ts";
import { businessProfiles } from "./identity.ts";

// SPEC-100 §43.1 `app.idempotency_records` (Part X Cross-functional). These declarations exist for types and
// queries; the DDL source of truth is migrations/0005_idempotency_records.sql (SPEC-100 §57, DB-MIG-002).
// Only digests and references are stored (DB-IDM-001): there is no column for a raw key, body, URL or Email.

/** `bytea`, read and written as a `Uint8Array` (SPEC-100 §56). */
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

export const idempotencyRecords = app.table(
  "idempotency_records",
  {
    id: internalId(),
    principalProfileId: bigint("principal_profile_id", { mode: "bigint" }).notNull(),
    operationId: text("operation_id").notNull(),
    keyDigest: bytea("key_digest").notNull(),
    requestDigest: bytea("request_digest").notNull(),
    resultRefType: text("result_ref_type"),
    resultRefs: uuid("result_refs").array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: timestamptzNow("created_at"),
    expiresAt: timestamptzNow("expires_at").default(
      sql`transaction_timestamp() + interval '24 hours'`,
    ),
  },
  (t) => [
    primaryKey({ name: "pk_idempotency_records", columns: [t.id] }),
    foreignKey({
      name: "fk_idempotency_records_principal_profile",
      columns: [t.principalProfileId],
      foreignColumns: [businessProfiles.id],
    }).onDelete("restrict"),
    check("ck_idempotency_records_key_digest", sql`octet_length(${t.keyDigest}) = 32`),
    check("ck_idempotency_records_request_digest", sql`octet_length(${t.requestDigest}) = 32`),
    check(
      "ck_idempotency_records_expiry",
      sql`${t.expiresAt} = ${t.createdAt} + interval '24 hours'`,
    ),
    check(
      "ck_idempotency_records_result_ref",
      sql`(${t.resultRefType} IS NULL) = (cardinality(${t.resultRefs}) = 0)`,
    ),
    uniqueIndex("ux_idempotency_records_principal_operation_key").on(
      t.principalProfileId,
      t.operationId,
      t.keyDigest,
    ),
  ],
);
