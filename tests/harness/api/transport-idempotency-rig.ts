import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  type ApiEnvironment,
  createApp,
  requireCapability,
  requireVerifiedEmail,
} from "../../../apps/api/src/api/app.ts";
import { requireTransportIdempotency } from "../../../apps/api/src/api/middleware/idempotency.ts";
import { validateJson } from "../../../apps/api/src/api/middleware/json.ts";
import { createLogger } from "../../../packages/observability/src/index.ts";

// PR-S0-3c test harness (TST-GEN-006): a test app with harness-only routes that mount
// requireTransportIdempotency the way a business route will. Nothing here is added to the
// production route table. Synthetic values only; no clock, randomness, DB or Redis.

export const WEB = "https://web.example.test";
export const PROFILE_REF = "00000000-0000-4000-8000-0000000000c1";
export const ORDER_REF = "00000000-0000-4000-8000-0000000000a1";
export const MARKER = "synthetic-idem-marker";
export const GOOD_KEY = "synthetic-idem-key-0001";

export type Json = Record<string, unknown>;
type NormalizedRequest = ReturnType<Parameters<typeof requireTransportIdempotency>[1]>;

const lower = (value: string) => value.toLowerCase();
export const bodySchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        ref: z.uuid().transform(lower),
        quantity: z.number().int(),
      }),
    )
    .min(1),
  note: z.string().optional(),
  flag: z.boolean().default(false),
});

export const goodBody = {
  items: [{ ref: ORDER_REF, quantity: 2 }],
  note: "synthetic note",
  flag: true,
};

/** What the handler saw: the context value and the Idempotency-Key header the application received. */
export interface Seen {
  readonly context: unknown;
  readonly header: string | undefined;
}

/** Stand-in for Stage 1 (Operation ID) and the guard (Principal) that the route PRs mount first. */
function harnessContext(operationId: string): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    c.set("operationId", operationId);
    c.set("principal", {
      subject: "synthetic-subject",
      profileRef: PROFILE_REF,
      emailVerified: true,
      roles: [],
    });
    await next();
  };
}
function operationOnly(operationId: string): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    c.set("operationId", operationId);
    await next();
  };
}
function principalOnly(): MiddlewareHandler<ApiEnvironment> {
  return async (c, next) => {
    c.set("principal", {
      subject: "synthetic-subject",
      profileRef: PROFILE_REF,
      emailVerified: true,
      roles: [],
    });
    await next();
  };
}

const normalizeStandard = (c: Context<ApiEnvironment>): NormalizedRequest => ({
  params: { order_ref: z.uuid().transform(lower).parse(c.req.param("ref")) },
  query: {},
  body: c.get("validatedJson"),
});

export function idempotencyRig() {
  const lines: string[] = [];
  const seen: Seen[] = [];
  const logger = createLogger(
    { service: "API", environment: "test", actor_type: "GUEST" },
    (line) => {
      lines.push(line);
    },
  );
  const app = createApp({ webOrigin: WEB, ready: async () => true, logger });
  const handler = (c: Context<ApiEnvironment>) => {
    seen.push({ context: c.get("transportIdempotency"), header: c.req.header("Idempotency-Key") });
    return c.json({ ok: true });
  };

  // Recommended mounting: guard, then validateJson, then the idempotency middleware.
  app.post(
    "/api/v1/test/idempotent/:ref",
    harnessContext("API-ORD-002"),
    validateJson(bodySchema),
    requireTransportIdempotency("API-ORD-002", normalizeStandard),
    handler,
  );
  // (A) no Principal: the real requireVerifiedEmail refuses first (401).
  app.post(
    "/api/v1/test/idempotent-a/:ref",
    operationOnly("API-ORD-002"),
    requireVerifiedEmail(),
    validateJson(bodySchema),
    requireTransportIdempotency("API-ORD-002", normalizeStandard),
    handler,
  );
  // (B) a Principal without the Capability: the real requireCapability refuses first (403).
  app.post(
    "/api/v1/test/idempotent-b/:ref",
    harnessContext("API-ADM-CNT-005"),
    requireCapability("public_content.manage"),
    validateJson(bodySchema),
    requireTransportIdempotency("API-ADM-CNT-005", normalizeStandard),
    handler,
  );
  // Baseline: the same context and body validation, no idempotency middleware.
  app.post(
    "/api/v1/test/plain/:ref",
    harnessContext("API-ORD-002"),
    validateJson(bodySchema),
    handler,
  );

  // Fail-closed wiring defects (A7). No validateJson on these routes unless stated.
  app.post(
    "/api/v1/test/fc/no-principal/:ref",
    operationOnly("API-ORD-002"),
    requireTransportIdempotency("API-ORD-002", () => ({ params: {}, query: {}, body: null })),
    handler,
  );
  app.post(
    "/api/v1/test/fc/no-operation/:ref",
    principalOnly(),
    requireTransportIdempotency("API-ORD-002", () => ({ params: {}, query: {}, body: null })),
    handler,
  );
  app.post(
    "/api/v1/test/fc/mismatch/:ref",
    harnessContext("API-CHK-001"),
    requireTransportIdempotency("API-ORD-002", () => ({ params: {}, query: {}, body: null })),
    handler,
  );
  app.post(
    "/api/v1/test/fc/normalize-zod/:ref",
    harnessContext("API-ORD-002"),
    requireTransportIdempotency("API-ORD-002", () => {
      z.strictObject({ name: z.number() }).parse({ name: MARKER });
      return { params: {}, query: {}, body: null };
    }),
    handler,
  );
  app.post(
    "/api/v1/test/fc/normalize-pg/:ref",
    harnessContext("API-ORD-002"),
    requireTransportIdempotency("API-ORD-002", () => {
      throw Object.assign(new Error(MARKER), { code: "08006", message: MARKER });
    }),
    handler,
  );
  app.post(
    "/api/v1/test/fc/normalize-undefined/:ref",
    harnessContext("API-ORD-002"),
    requireTransportIdempotency("API-ORD-002", () => ({
      params: {},
      query: {},
      body: undefined,
    })),
    handler,
  );
  app.post(
    "/api/v1/test/fc/normalize-date/:ref",
    harnessContext("API-ORD-002"),
    requireTransportIdempotency("API-ORD-002", () => ({
      params: {},
      query: {},
      body: { at: new Date(0), label: MARKER },
    })),
    handler,
  );
  // The body (with the marker) is validated, then normalize throws an error that quotes it.
  app.post(
    "/api/v1/test/fc/normalize-body-marker/:ref",
    harnessContext("API-ORD-002"),
    validateJson(bodySchema),
    requireTransportIdempotency("API-ORD-002", (c) => {
      throw new Error(JSON.stringify(c.get("validatedJson")));
    }),
    handler,
  );

  const records = () => lines.map((line) => JSON.parse(line) as Json);
  const completions = () => records().filter((r) => r.event_name === "http.request.completed");

  interface PostOptions {
    /** Extra request headers (a Headers object keeps a repeated name as separate appends). */
    readonly headers?: Headers | Record<string, string> | undefined;
    /** Raw request body text; default is the JSON of `goodBody`. */
    readonly rawBody?: string;
    readonly contentType?: string;
  }
  async function post(path: string, options: PostOptions = {}): Promise<Response> {
    const headers = new Headers(options.headers);
    headers.set("Origin", WEB);
    headers.set("Content-Type", options.contentType ?? "application/json");
    return app.request(path, {
      method: "POST",
      headers,
      body: options.rawBody ?? JSON.stringify(goodBody),
    });
  }
  /** Header names are exposed as `Idempotency-Key`. */
  const withKey = (key: string, extra: Record<string, string> = {}) => ({
    "Idempotency-Key": key,
    ...extra,
  });

  return { app, lines, seen, records, completions, post, withKey };
}

export type IdempotencyRig = ReturnType<typeof idempotencyRig>;

export const ROUTE = `/api/v1/test/idempotent/${ORDER_REF}`;

export async function readError(response: Response): Promise<{ text: string; error: Json }> {
  const text = await response.text();
  return { text, error: (JSON.parse(text) as { error: Json }).error };
}
