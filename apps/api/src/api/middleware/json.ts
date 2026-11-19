import type { MiddlewareHandler } from "hono";
import type { z } from "zod";
import { type ApiEnvironment, ApiFailure } from "../failure.ts";

// Detect repeated decoded object keys before JSON.parse discards them.
export function rejectDuplicateKeys(raw: string): void {
  const stack: Array<Set<string> | null> = [];
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === "{") stack.push(new Set());
    else if (char === "[") stack.push(null);
    else if (char === "}" || char === "]") stack.pop();
    else if (char === '"') {
      const start = i++;
      while (i < raw.length) {
        if (raw[i] === "\\") i += 2;
        else if (raw[i] === '"') break;
        else i++;
      }
      let next = i + 1;
      while (/\s/.test(raw[next] ?? "") && next < raw.length) next++;
      if (raw[next] === ":") {
        const key = JSON.parse(raw.slice(start, i + 1)) as string;
        const keys = stack.at(-1);
        if (!keys || keys.has(key)) throw new ApiFailure("MALFORMED_REQUEST");
        keys.add(key);
      }
    }
  }
}
/**
 * Mount only on a canonical JSON operation, after streaming bodyLimit. The parsed value is read from
 * `validatedJson`, so only Hono's `in` input is declared (no `out`: `c.req.valid` is never filled).
 * AppType takes its input type from the builder in @off-r39x/api-contract, not from this type.
 */
export function validateJson<T extends z.ZodType>(
  schema: T,
): MiddlewareHandler<ApiEnvironment, string, { in: { json: z.input<T> } }> {
  return async (c, next) => {
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(c.req.header("Content-Type") ?? ""))
      throw new ApiFailure("UNSUPPORTED_MEDIA_TYPE");
    let value: unknown;
    const raw = await c.req.text();
    try {
      rejectDuplicateKeys(raw);
      value = JSON.parse(raw);
    } catch {
      throw new ApiFailure("MALFORMED_REQUEST");
    }
    const result = schema.safeParse(value);
    if (!result.success) throw new ApiFailure("VALIDATION_FAILED");
    c.set("validatedJson", result.data);
    await next();
  };
}
