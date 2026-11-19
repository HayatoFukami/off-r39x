import type { MiddlewareHandler } from "hono";
import type { z } from "zod";
import { type ApiEnvironment, ApiFailure } from "../failure.ts";

/**
 * Validates the query against a fixed strict schema (API-QRY-001). Unknown and repeated keys are
 * 400 VALIDATION_FAILED; the value is read from `validatedQuery`. Mount after authentication and
 * authorization, before the handler.
 */
export function validateQuery<T extends z.ZodType>(
  schema: T,
): MiddlewareHandler<ApiEnvironment, string, { in: { query: z.input<T> } }> {
  return async (c, next) => {
    const entries = new Map<string, string>();
    for (const [key, value] of new URL(c.req.url).searchParams) {
      // A parameter with an empty name is never in the schema, and Hono drops it from queries().
      if (key === "" || entries.has(key)) throw new ApiFailure("VALIDATION_FAILED");
      entries.set(key, value);
    }
    const result = schema.safeParse(Object.fromEntries(entries));
    if (!result.success) throw new ApiFailure("VALIDATION_FAILED");
    c.set("validatedQuery", result.data);
    await next();
  };
}
