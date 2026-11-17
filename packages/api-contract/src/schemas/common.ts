import { z } from "zod";

export const successSchema = <T extends z.ZodType>(data: T) =>
  z.strictObject({ data, meta: z.strictObject({ request_id: z.uuid() }) });
