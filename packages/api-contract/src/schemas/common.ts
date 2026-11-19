import { z } from "zod";

export const successSchema = <T extends z.ZodType>(data: T) =>
  z.strictObject({ data, meta: z.strictObject({ request_id: z.uuid() }) });

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
