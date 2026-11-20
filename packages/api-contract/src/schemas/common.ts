import { z } from "zod";

/**
 * A canonical UUID as SPEC-110 section 17 defines it (section 9 Public References use the same
 * form): 36 lower-case hex digits and hyphens (8-4-4-4-12), version digit 1-8 and variant digit 8,
 * 9, a or b. The nil and max UUIDs are not canonical, and upper case is refused, not normalised.
 * z.uuid() is not used: it accepts upper case and both the nil and max UUIDs.
 */
export const lowerCaseUuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const successSchema = <T extends z.ZodType>(data: T) =>
  z.strictObject({ data, meta: z.strictObject({ request_id: lowerCaseUuidSchema }) });

/**
 * SPEC-110 §10: UTC timestamps are `YYYY-MM-DDTHH:mm:ss.sssZ`.
 * The regex pins the exact shape; the round-trip through Date rejects impossible dates and times
 * (e.g. 02-30, non-leap 02-29, hour 24), which Date would otherwise normalise rather than reject.
 */
export const isoUtcTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((v) => {
    const time = Date.parse(v);
    return !Number.isNaN(time) && new Date(time).toISOString() === v;
  });
