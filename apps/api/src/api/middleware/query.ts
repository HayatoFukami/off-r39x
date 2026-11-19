import type { Context, MiddlewareHandler } from "hono";
import type { z } from "zod";
import { type ApiEnvironment, ApiFailure } from "../failure.ts";

export type ValidatedQuery<T extends z.ZodType> = MiddlewareHandler<
  ApiEnvironment,
  string,
  { in: { query: z.input<T> } }
> & {
  /**
   * The query this middleware instance validated for the request, typed `z.output<T>` (no cast in
   * the handler). Throws if this instance did not run for the request (a wiring error), so a handler
   * cannot read a query validated by a different schema.
   */
  readonly read: (c: Context<ApiEnvironment>) => z.output<T>;
};

/**
 * Validates the query against a fixed strict schema (API-QRY-001). Unknown, repeated and nameless
 * keys are 400 VALIDATION_FAILED. Handlers read the value with the returned middleware's `read(c)`,
 * never with `c.req.query()` (the decoding rules differ). Mount after authentication and
 * authorization, before the handler.
 */
export function validateQuery<T extends z.ZodType>(schema: T): ValidatedQuery<T> {
  const validated = new WeakMap<Context<ApiEnvironment>, z.output<T>>();
  const middleware: MiddlewareHandler<
    ApiEnvironment,
    string,
    { in: { query: z.input<T> } }
  > = async (c, next) => {
    const entries = new Map<string, string>();
    for (const [key, value] of new URL(c.req.url).searchParams) {
      // A parameter with an empty name is never in the schema, and Hono drops it from queries().
      if (key === "" || entries.has(key)) throw new ApiFailure("VALIDATION_FAILED");
      entries.set(key, value);
    }
    const result = schema.safeParse(Object.fromEntries(entries));
    if (!result.success) throw new ApiFailure("VALIDATION_FAILED");
    validated.set(c, result.data);
    c.set("validatedQuery", result.data);
    await next();
  };
  const read = (c: Context<ApiEnvironment>): z.output<T> => {
    if (!validated.has(c)) throw new Error("validateQuery did not run for this request");
    return validated.get(c) as z.output<T>;
  };
  return Object.assign(middleware, { read });
}
