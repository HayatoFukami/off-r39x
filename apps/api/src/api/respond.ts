import { AuthFailure } from "@off-r39x/auth";
import { classifyDatabaseError } from "@off-r39x/db";
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
  // SPEC-110 section 19: `data` is required; undefined would be dropped by JSON serialization.
  if (!("data" in parsed.data) || parsed.data.data === undefined)
    return errorResponse(c, "INTERNAL_ERROR");
  c.header("Cache-Control", "no-store");
  return c.json(parsed.data, status);
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
  switch (classifyDatabaseError(error).kind) {
    case "retryable":
    case "deadline":
    case "unavailable":
      // SPEC-110 sections 50-51 / REL-DB-009 / REL-DB-011: never 404 / 409 / 500.
      return errorResponse(c, "DATABASE_TEMPORARY_FAILURE");
    default:
      return errorResponse(c, "INTERNAL_ERROR");
  }
}
