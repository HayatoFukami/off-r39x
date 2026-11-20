import { types } from "node:util";
import { AuthFailure } from "@off-r39x/auth";
import { isDatabaseTemporaryFailure } from "@off-r39x/db";
import type { Context } from "hono";
import type { z } from "zod";
import { type ApiEnvironment, ApiFailure } from "./failure.ts";
import {
  type ErrorCode,
  type ErrorDetails,
  errorRetryable,
  errorSchema,
  errorStatuses,
  successSchema,
} from "./schemas/common.ts";
import type { ServiceResult } from "./services/result.ts";

// The only place an error or success envelope is built (SPEC-110 sections 19-21, DEV-API-003,
// SEC-ERR-001..003). Every envelope passes its schema before it is sent.

type AppContext = Context<ApiEnvironment>;

const FIXED_MESSAGE = "Request could not be completed.";
// Messages come from the code only; callers cannot pass one (SEC-ERR-003).
function messageFor(code: ErrorCode): string {
  return code === "RESOURCE_NOT_FOUND" ? "Requested resource was not found." : FIXED_MESSAGE;
}

/**
 * Operations whose SPEC-110 section 28 contract defines `STATE_CONFLICT` details (`item_failures`):
 * only `API-PUR-CART-001`. Details on any other operation (or none known) are a producer defect.
 */
const ITEM_FAILURE_OPERATIONS: ReadonlySet<string> = new Set(["API-PUR-CART-001"]);

export function errorResponse<C extends ErrorCode>(
  c: AppContext,
  code: C,
  options: { readonly details?: ErrorDetails<C>; readonly retryAfterSeconds?: number } = {},
) {
  c.header("Cache-Control", "no-store");
  const requestId = c.get("requestId");
  const operationId = c.get("operationId");
  const scopedOut =
    code === "STATE_CONFLICT" &&
    options.details != null &&
    (operationId === undefined || !ITEM_FAILURE_OPERATIONS.has(operationId));
  const parsed = scopedOut
    ? { success: false as const }
    : errorSchema.safeParse({
        error: {
          code,
          message: messageFor(code),
          request_id: requestId,
          // A conditional Retryable (section 21) has no defined condition yet, so it resolves to false.
          retryable: errorRetryable[code] === true,
          details: options.details ?? null,
        },
      });
  if (!parsed.success) {
    // Fail closed without echoing the original code, details or schema issues.
    return c.json(
      {
        error: {
          code: "INTERNAL_ERROR" as const,
          message: FIXED_MESSAGE,
          request_id: requestId,
          retryable: false,
          details: null,
        },
      },
      500,
    );
  }
  // SEC-ABU-007: a 429 always carries an integer-second Retry-After (min 1).
  if (code === "RATE_LIMIT_EXCEEDED") {
    const seconds = options.retryAfterSeconds;
    c.header(
      "Retry-After",
      String(
        Math.max(1, seconds !== undefined && Number.isFinite(seconds) ? Math.ceil(seconds) : 1),
      ),
    );
  }
  return c.json(parsed.data, errorStatuses[code]);
}

type JsonCopy = { readonly ok: true; readonly value: unknown } | { readonly ok: false };
const REJECTED: JsonCopy = { ok: false };

// The longest chain of an accepted value is an array's (the array, Array.prototype, Object.prototype).
const MAX_PROTOTYPE_CHAIN = 8;

// True when a callable `toJSON` is reachable (own or inherited, enumerable or not). Descriptors are
// inspected so that no getter runs. An accessor `toJSON` is rejected too, since its value is unknown.
// The walk is finite: a Proxy can report any prototype, so a chain that revisits an object or does
// not reach null within MAX_PROTOTYPE_CHAIN links is rejected instead of being followed.
function hasToJson(value: object): boolean {
  const seen = new Set<object>();
  let node: object | null = value;
  while (node !== null) {
    if (seen.has(node) || seen.size >= MAX_PROTOTYPE_CHAIN) return true;
    seen.add(node);
    const descriptor = Object.getOwnPropertyDescriptor(node, "toJSON");
    if (descriptor !== undefined)
      return !("value" in descriptor) || typeof descriptor.value === "function";
    node = Reflect.getPrototypeOf(node);
  }
  return false;
}

function isIndexKey(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

function copyJsonNode(value: unknown, active: WeakSet<object>, strict: boolean): JsonCopy {
  if (value === null) return { ok: true, value };
  switch (typeof value) {
    case "boolean":
    case "string":
      return { ok: true, value };
    case "number":
      return Number.isFinite(value) ? { ok: true, value } : REJECTED;
    case "object":
      break;
    default:
      return REJECTED;
  }
  // A proxy's traps can answer each read differently or hide what a descriptor-based read would
  // see, so strict mode refuses one before any trap runs (hasToJson already reads through it).
  if (strict && types.isProxy(value)) return REJECTED;
  if (active.has(value) || hasToJson(value)) return REJECTED;
  active.add(value);
  try {
    if (Array.isArray(value)) {
      let length: number;
      if (strict) {
        // Only a plain array: a subclass can carry state the copied elements lose. The length is
        // read from its own data descriptor, never through a get trap that could hide elements.
        if (Reflect.getPrototypeOf(value) !== Array.prototype) return REJECTED;
        const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
        if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) return REJECTED;
        if (!Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
          return REJECTED;
        }
        length = lengthDescriptor.value;
      } else {
        length = value.length;
      }
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string") {
          if (strict) return REJECTED; // a symbol key JSON would drop
          continue;
        }
        if (key !== "length" && !isIndexKey(key, length)) return REJECTED;
      }
      const items: unknown[] = [];
      for (let i = 0; i < length; i += 1) {
        // JSON reads every index whether or not it is enumerable; a hole or accessor is rejected.
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (descriptor === undefined || !("value" in descriptor)) return REJECTED;
        // The copy's elements are all enumerable, so strict mode refuses a non-enumerable one.
        if (strict && !descriptor.enumerable) return REJECTED;
        const item = copyJsonNode(descriptor.value, active, strict);
        if (!item.ok) return REJECTED;
        items.push(item.value);
      }
      return { ok: true, value: items };
    }
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return REJECTED;
    const entries: [string, unknown][] = [];
    for (const key of Reflect.ownKeys(value)) {
      // In strict mode nothing JSON would drop silently is allowed: a symbol key, a vanished or
      // non-enumerable property, and an undefined value are refused instead of omitted.
      if (typeof key !== "string") {
        if (strict) return REJECTED;
        continue; // JSON drops symbol keys
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) {
        if (strict) return REJECTED;
        continue;
      }
      if (!("value" in descriptor)) return REJECTED;
      if (!descriptor.enumerable || descriptor.value === undefined) {
        if (strict) return REJECTED;
        continue; // omitted, as in JSON (an undefined value is an omitted optional field)
      }
      const entry = copyJsonNode(descriptor.value, active, strict);
      if (!entry.ok) return REJECTED;
      entries.push([key, entry.value]);
    }
    // fromEntries defines own data properties, so a "__proto__" key stays data, not a prototype.
    return { ok: true, value: Object.fromEntries(entries) };
  } finally {
    active.delete(value);
  }
}

/**
 * Copies `value` into a fresh tree of JSON values, or fails (SPEC-110 section 19: a success envelope
 * carries a required `data` that must reach the client unchanged). Fail closed: `JSON.stringify`
 * silently drops `undefined`, functions and symbols, turns NaN / Infinity into null, throws on bigint
 * and cycles, flattens Date / Map, and lets `toJSON` or accessors replace the contents, so any such
 * value means the producer is defective and nothing is sent. Only the returned copy is sent, so what
 * was checked is exactly what is serialized; each property is read once, from its descriptor, so a
 * getter cannot answer differently between checking and sending. An `undefined` object property is an
 * omitted optional field and is skipped; an `undefined` array element or a hole is rejected. Arrays
 * may have only index keys. Symbol keys and non-enumerable object properties are dropped, as JSON
 * does. Values are never logged or thrown.
 *
 * With `strict`, everything that JSON would drop silently is rejected instead of skipped: an
 * `undefined` object property, a non-enumerable property or array element and a symbol key (on an
 * object or an array). It also refuses any Proxy, accepts only plain arrays (Array.prototype, no
 * subclass) and reads an array's length from its own data descriptor. A value with such a property then never has the same copy as one without it (a request
 * digest input, API-IDM-005).
 */
export function copyJsonValue(
  value: unknown,
  options: { readonly strict?: boolean } = {},
): JsonCopy {
  return copyJsonNode(value, new WeakSet(), options.strict === true);
}

export function successResponse<S extends z.ZodType>(
  c: AppContext,
  dataSchema: S,
  data: z.input<S>,
  status: 200 | 201 = 200,
) {
  const parsed = successSchema(dataSchema).safeParse({
    data,
    meta: { request_id: c.get("requestId") },
  });
  // A schema mismatch is a defect in the producer: never send the data (DEV-API-003).
  if (!parsed.success) return errorResponse(c, "INTERNAL_ERROR");
  // SPEC-110 section 19: `data` is required and must survive JSON serialization unchanged.
  if (!("data" in parsed.data)) return errorResponse(c, "INTERNAL_ERROR");
  const copy = copyJsonValue(parsed.data.data);
  if (!copy.ok) return errorResponse(c, "INTERNAL_ERROR");
  // The copy is structurally identical to the validated value (it only drops what JSON drops), so
  // it has the schema's output type (DEV-TS-003); the assertion keeps the Hono RPC inference.
  const sent = copy.value as typeof parsed.data.data;
  c.header("Cache-Control", "no-store");
  return c.json({ data: sent, meta: parsed.data.meta }, status);
}

/** SPEC-110 section 58 step 5: a service result becomes exactly one response. */
export function respond<S extends z.ZodType>(
  c: AppContext,
  result: ServiceResult<z.input<S>>,
  dataSchema: S,
) {
  switch (result.kind) {
    case "success":
      return successResponse(c, dataSchema, result.data, result.status);
    case "rejected":
      return errorResponse(
        c,
        result.code,
        result.details === undefined ? {} : { details: result.details },
      );
    case "temporary":
      return errorResponse(c, result.code);
    case "commit_unknown":
      // SPEC-110 section 51: the COMMIT outcome is unknown, so the answer is a retryable 503.
      return errorResponse(c, "DATABASE_TEMPORARY_FAILURE");
  }
}

/**
 * onError mapping (DEV-TS-013: an exception is classified once, at the boundary). Raw constraint
 * violations, statement timeouts (SPEC-110 sections 50/51 define no mapping for SQLSTATE 57014) and
 * anything unclassified are INTERNAL_ERROR; nothing of the exception reaches the response.
 */
export function errorFromException(
  c: AppContext,
  error: unknown,
  authCodes: Readonly<Record<AuthFailure["kind"], ErrorCode>>,
) {
  if (error instanceof ApiFailure)
    return errorResponse(
      c,
      error.code,
      error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds },
    );
  if (error instanceof AuthFailure) return errorResponse(c, authCodes[error.kind]);
  // SPEC-110 sections 50-51 / REL-DB-009 / REL-DB-011: never 404 / 409 / 500. The same predicate
  // decides a repository's "unavailable" result, so both answer a failure the same way.
  return errorResponse(
    c,
    isDatabaseTemporaryFailure(error) ? "DATABASE_TEMPORARY_FAILURE" : "INTERNAL_ERROR",
  );
}
