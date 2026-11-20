import { createHash } from "node:crypto";
import type { OperationId } from "@off-r39x/security";
import type { Context, MiddlewareHandler } from "hono";
import { type ApiEnvironment, ApiFailure } from "../failure.ts";
import { copyJsonValue } from "../respond.ts";

/**
 * API-IDM-011 target Operations (the same set as API-IDM-003): SPEC-110 section 18 and SPEC-120
 * section 36.1. Only these may mount `requireTransportIdempotency` (DEV-API-007).
 */
export const TRANSPORT_IDEMPOTENCY_OPERATIONS = [
  // purchase start
  "API-PUR-CART-001",
  "API-PUR-ENTRY-001",
  "API-PUR-KRK-001",
  "API-PUR-GDS-001",
  // checkout start / resume, pre-payment cancel
  "API-CHK-001",
  "API-ORD-002",
  // refund request, refund result reconcile
  "API-ADM-PAY-001",
  "API-ADM-REC-005",
  // QR token rotation
  "API-ADM-TQR-001",
  // slot generation, slot state / edit mutation
  "API-ADM-KRK-003",
  "API-ADM-KRK-004",
  "API-ADM-KRK-005",
  "API-ADM-KRK-006",
  // goods handoff completion (Staff / Administrator)
  "API-STF-GDS-001",
  "API-ADM-HOF-003",
  // reservation cancellation (UCR-110-012)
  "API-ADM-KRK-007",
  // entry ticket offering / karaoke sales / goods sales configuration mutation
  "API-ADM-ENT-SALES-003",
  "API-ADM-KRK-SALES-003",
  "API-ADM-GDS-004",
  // goods inventory adjustment
  "API-ADM-GDS-005",
  // public content create / update / publish / archive / restore-draft
  "API-ADM-CNT-002",
  "API-ADM-CNT-005",
  "API-ADM-CNT-006",
  "API-ADM-CNT-007",
  "API-ADM-CNT-008",
  "API-ADM-CNT-011",
  "API-ADM-CNT-012",
  "API-ADM-CNT-013",
  "API-ADM-CNT-014",
  "API-ADM-CNT-015",
  "API-ADM-CNT-016",
  "API-ADM-CNT-019",
  "API-ADM-CNT-020",
  "API-ADM-CNT-021",
  // role assignment mutation
  "API-ADM-ROL-002",
  "API-ADM-ROL-003",
  // reconcile / resolve
  "API-ADM-REC-003",
  "API-ADM-REC-004",
  "API-ADM-REC-006",
  "API-ADM-REC-007",
  // SPEC-120 section 36.1
  "API-ADM-EML-004",
  "API-ADM-EML-005",
] as const satisfies readonly OperationId[];

export type TransportIdempotencyOperationId = (typeof TRANSPORT_IDEMPOTENCY_OPERATIONS)[number];

/** What a handler / service reads from the context (SPEC-110 section 58 step 3). No raw key. */
export interface TransportIdempotencyInput {
  readonly operationId: TransportIdempotencyOperationId;
  readonly principalProfileRef: string;
  readonly keyDigest: Uint8Array;
  readonly requestDigest: Uint8Array;
}

/** The validated request (after Zod transforms and defaults) that the request digest covers. */
export interface NormalizedRequest {
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly body: unknown;
}

const KEY_PATTERN = /^[\x20-\x7E]{16,128}$/;

/**
 * API-IDM-011 1.-3.: the value is the HTTP-parsed header value (concatenated when repeated), checked
 * as is. It is never trimmed or case-folded. A rejection carries no reason.
 */
export function parseIdempotencyKey(
  value: string | undefined,
): { ok: true; key: string } | { ok: false } {
  if (value === undefined || !KEY_PATTERN.test(value)) return { ok: false };
  return { ok: true, key: value };
}

/** API-IDM-005: unkeyed SHA-256 of the validated key (not the HMAC correlation fingerprint, OBS-COR-005). */
export function keyDigest(key: string): Uint8Array {
  return createHash("sha256").update(key, "utf8").digest();
}

const NOT_CANONICALIZABLE = "Request is not canonicalizable";

function serialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  if (isRecord(value)) {
    // Default sort compares UTF-16 code units.
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * API-IDM-005 / TST-IDM-004 (4): deterministic canonical form `{"body":..,"params":..,"query":..}`
 * with keys sorted by UTF-16 code unit and no whitespace. Throws a fixed message for anything JSON
 * cannot represent. Every property is read once, from its descriptor (an accessor is refused, never
 * invoked), and the checks run on that copy, so the digest covers exactly what was checked.
 */
export function canonicalRequestJson(request: NormalizedRequest): string {
  let copy: ReturnType<typeof copyJsonValue>;
  try {
    if (!isRecord(request)) throw new Error(NOT_CANONICALIZABLE);
    const body = ownDataValue(request, "body");
    const params = ownDataValue(request, "params");
    const query = ownDataValue(request, "query");
    // params and query must be plain objects: a Map or a class instance keeps its entries outside
    // its own properties, so they would vanish and different requests would share one digest.
    if (body === undefined || !isPlainRecord(params) || !isPlainRecord(query)) {
      throw new Error(NOT_CANONICALIZABLE);
    }
    // Each params value is read once and the checked string itself goes into the copy, so a value
    // cannot be a string for the check and something else for the digest.
    const checkedParams: Record<string, string> = {};
    for (const key of Object.keys(params)) {
      const value = ownDataValue(params, key);
      if (typeof value !== "string") throw new Error(NOT_CANONICALIZABLE);
      Object.defineProperty(checkedParams, key, { value, enumerable: true });
    }
    // strict: an explicit undefined in body or query is refused, not dropped, so it never shares
    // the digest of a request that omits the field.
    copy = copyJsonValue({ body, params: checkedParams, query }, { strict: true });
  } catch {
    // A proxy trap or anything else that throws must not leak its message (SEC-ERR-003).
    throw new Error(NOT_CANONICALIZABLE);
  }
  if (!copy.ok) throw new Error(NOT_CANONICALIZABLE);
  return serialize(copy.value);
}

/** An object whose prototype is Object.prototype or null (what a literal or Zod output is). */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** The own data property `key` of `record`, read without invoking an accessor. */
function ownDataValue(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor !== undefined && !("value" in descriptor)) throw new Error(NOT_CANONICALIZABLE);
  return descriptor?.value;
}

/** SHA-256 of the canonical request. Headers are not an input (TST-IDM-002, SEC-API-023). */
export function requestDigest(request: NormalizedRequest): Uint8Array {
  return createHash("sha256").update(canonicalRequestJson(request), "utf8").digest();
}

const TARGETS: readonly string[] = TRANSPORT_IDEMPOTENCY_OPERATIONS;

/**
 * Validates `Idempotency-Key` and puts the key digest and request digest in the context. Mount it
 * after authentication and authorization (API-IDM-011 4.) on a target Operation's route: the owner
 * relation check or `requireCapability` must have called `markAuthorizationConfirmed` first, or the
 * request ends in 500 INTERNAL_ERROR (a wiring defect).
 */
export function requireTransportIdempotency(
  operationId: TransportIdempotencyOperationId,
  normalize: (c: Context<ApiEnvironment>) => NormalizedRequest,
): MiddlewareHandler<ApiEnvironment> {
  if (!TARGETS.includes(operationId)) {
    throw new Error("Operation does not accept a transport Idempotency-Key");
  }
  return async (c, next) => {
    if (c.get("operationId") !== operationId) throw new ApiFailure("INTERNAL_ERROR");
    const principal = c.get("principal");
    if (principal === undefined) throw new ApiFailure("INTERNAL_ERROR");
    // API-IDM-011 4.: authentication and authorization (section 24 steps 2-7) come first. A Principal
    // alone does not show the owner relation or Capability passed; without that record
    // (SEC-ABU-029) the route is miswired, so neither a 400 nor the handler may follow.
    if (c.get("authorizationConfirmed") !== true) throw new ApiFailure("INTERNAL_ERROR");
    const parsed = parseIdempotencyKey(c.req.header("Idempotency-Key"));
    if (!parsed.ok) throw new ApiFailure("VALIDATION_FAILED");
    let digest: Uint8Array;
    try {
      digest = requestDigest(normalize(c));
    } catch {
      throw new ApiFailure("INTERNAL_ERROR");
    }
    c.set("transportIdempotency", {
      operationId,
      principalProfileRef: principal.profileRef,
      keyDigest: keyDigest(parsed.key),
      requestDigest: digest,
    });
    await next();
  };
}
