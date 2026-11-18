import { z } from "zod";

export const successSchema = <T extends z.ZodType>(data: T) =>
  z.strictObject({ data, meta: z.strictObject({ request_id: z.uuid() }) });

/** SPEC-110 §10: UTC timestamps are `YYYY-MM-DDTHH:mm:ss.sssZ`. */
export const isoUtcTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
