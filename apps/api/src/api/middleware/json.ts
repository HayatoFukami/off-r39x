import type { MiddlewareHandler } from "hono";
import type { z } from "zod";
import { type ApiEnvironment, ApiFailure } from "../app.ts";

// Detect repeated decoded object keys before JSON.parse discards them.
function rejectDuplicateKeys(raw: string): void {
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
/** Mount only on a canonical JSON operation, after streaming bodyLimit. */
export function validateJson<T extends z.ZodType>(schema: T): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(c.req.header("Content-Type") ?? ""))
      throw new ApiFailure("MALFORMED_REQUEST", 415);
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
