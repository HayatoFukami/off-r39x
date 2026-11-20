import { z } from "zod";
import { isoUtcTimestampSchema, lowerCaseUuidSchema, moneySchema } from "./common.ts";

// SPEC-110 §26 / §26.1 (UCR-110-013) public read contract: API-PUB-001..005 and API-PUB-012. Every
// object is strict and every field a required key; nullable columns are `.nullable()`, never optional
// (API-PUB-READ-004). No Internal ID, Publication State, administrative timestamp, counter or check-in
// window is declared, so none can be added without changing the schema (SPEC-110 §9, §55).

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
const int32 = z.number().int().min(INT32_MIN).max(INT32_MAX);

/** API-PUB-READ-001: the Query of all six Operations is an empty strict object. */
export const emptyPublicQuerySchema = z.strictObject({});

/**
 * API-PUB-004 Path: a UUID of any letter case, normalised to the lower-case canonical form (§9).
 * Anything else, including surrounding spaces, the nil UUID and the max UUID, is refused.
 */
export const announcementRefParamSchema = z
  .string()
  .regex(/^[0-9A-Fa-f-]{36}$/)
  .transform((value) => value.toLowerCase())
  .pipe(lowerCaseUuidSchema);

// SEC-WEB-026 boundary: only "an https URL" (a host, an optional port, an optional path / query /
// fragment, no whitespace or user information). The allowed origins are the management side's concern.
// The package has no URL global (no DOM / Node lib), so the shape is a pattern.
const httpsUrlSchema = z
  .string()
  .regex(/^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?([/?#]\S*)?$/);

/** API-PUB-001. */
export const publicEventSchema = z.strictObject({
  event_ref: lowerCaseUuidSchema,
  name: z.string(),
  summary: z.string().nullable(),
  starts_at: isoUtcTimestampSchema.nullable(),
  ends_at: isoUtcTimestampSchema.nullable(),
  business_timezone: z.literal("Asia/Tokyo"),
  venue_name: z.string().nullable(),
  venue_details: z.string().nullable(),
  access_information: z.string().nullable(),
  participant_notices: z.string().nullable(),
});
export type PublicEvent = z.infer<typeof publicEventSchema>;

/** API-PUB-002. `sort_order` has no database CHECK, so a negative value is valid. */
export const publicFaqListSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      faq_ref: lowerCaseUuidSchema,
      question: z.string(),
      answer: z.string(),
      sort_order: int32,
    }),
  ),
});
export type PublicFaqList = z.infer<typeof publicFaqListSchema>;

/** API-PUB-003. No `body`: the list carries the server-made `excerpt` (API-PUB-003 Excerpt). */
export const publicAnnouncementListSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      announcement_ref: lowerCaseUuidSchema,
      title: z.string(),
      published_at: isoUtcTimestampSchema,
      excerpt: z.string(),
      excerpt_truncated: z.boolean(),
    }),
  ),
});
export type PublicAnnouncementList = z.infer<typeof publicAnnouncementListSchema>;

/** API-PUB-004. */
export const publicAnnouncementSchema = z.strictObject({
  announcement_ref: lowerCaseUuidSchema,
  title: z.string(),
  body: z.string(),
  published_at: isoUtcTimestampSchema,
});
export type PublicAnnouncement = z.infer<typeof publicAnnouncementSchema>;

/** API-PUB-005. `availability` and `unavailable_reason` go together (AVAILABLE <=> null). */
export const publicEntryOfferingListSchema = z.strictObject({
  items: z.array(
    z
      .strictObject({
        offering_ref: lowerCaseUuidSchema,
        name: z.string(),
        description: z.string().nullable(),
        unit_price: moneySchema,
        sales_starts_at: isoUtcTimestampSchema,
        sales_ends_at: isoUtcTimestampSchema,
        purchase_limit: int32,
        availability: z.enum(["AVAILABLE", "UNAVAILABLE"]),
        unavailable_reason: z
          .enum(["SALES_NOT_STARTED", "SALES_CLOSED", "SALES_STOPPED", "SOLD_OUT"])
          .nullable(),
      })
      .refine((item) => (item.availability === "AVAILABLE") === (item.unavailable_reason === null)),
  ),
});
export type PublicEntryOfferingList = z.infer<typeof publicEntryOfferingListSchema>;

/** API-PUB-012. */
export const publicSponsorLogoListSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      logo_ref: lowerCaseUuidSchema,
      display_name: z.string().min(1),
      image_url: httpsUrlSchema,
      link_url: httpsUrlSchema.nullable(),
      sort_order: z.number().int().min(0).max(INT32_MAX),
    }),
  ),
});
export type PublicSponsorLogoList = z.infer<typeof publicSponsorLogoListSchema>;
