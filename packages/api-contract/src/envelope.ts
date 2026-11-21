import type { z } from "zod";
import { successSchema } from "./schemas/common.ts";

/**
 * SPEC-110 section 19 / DEV-API-003: the whole success envelope, meta.request_id included, is checked
 * by the shared successSchema before it is sent; a mismatch throws, so the route answers 500 and never
 * sends the data. The data schema is the route's strict response schema.
 */
export function envelope<S extends z.ZodType>(schema: S, data: unknown, requestId: string) {
  return successSchema(schema).parse({ data, meta: { request_id: requestId } });
}
