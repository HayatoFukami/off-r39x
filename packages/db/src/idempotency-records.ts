import type { PoolClient } from "pg";

// Transport Idempotency replay record (SPEC-100 §43.1, SPEC-110 §18.1; DB-IDM-001 to DB-IDM-003,
// API-IDM-004 to API-IDM-009). The record is an aid: a Domain UNIQUE constraint still prevents a
// duplicate effect when the record is missing (API-IDM-001, API-IDM-010).
//
// These functions work on the caller's transaction, as `insertAuditEvent` does: they never open a
// connection or a transaction, never retry and never log. A failure from PostgreSQL is rethrown
// unchanged so that `transaction()` can classify it by SQLSTATE and retry the whole callback.
// Every input is checked before anything reaches the database, and a rejection names only a fixed
// field, never the offending value. Only digests and references are accepted: there is no parameter
// for a raw Idempotency-Key, a body or a response (DB-IDM-001).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OPERATION_ID = /^API-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const OPERATION_ID_MAX_LENGTH = 64;
// A token, never free text, so a result type cannot carry an Email address, a URL or other PII.
// The set of values and the lookup of each type belong to each Operation (SPEC-100 §43.1).
const RESULT_REF_TYPE = /^[A-Z][A-Z0-9_]{0,63}$/;
const DIGEST_LENGTH = 32;

export type TransportIdempotencyClaimInput = {
  /** The Principal's Business Profile public reference (lowercase UUID). */
  readonly principalProfileRef: string;
  /** A SPEC-110 `API-*` Operation ID. Whether it is a Transport Idempotency target is the middleware's duty. */
  readonly operationId: string;
  /** SHA-256 of the Idempotency-Key (32 bytes). */
  readonly keyDigest: Uint8Array;
  /** SHA-256 of the normalized request (32 bytes). */
  readonly requestDigest: Uint8Array;
};

/** The result of the first execution: a type token and references, never a response body (API-IDM-007). */
export type TransportIdempotencyResult = {
  readonly type: string;
  readonly refs: readonly string[];
};

declare const handleBrand: unique symbol;
/** Opaque. The internal record id stays inside this module (DEV-TS-005). */
export type TransportIdempotencyHandle = { readonly [handleBrand]: true };

export type TransportIdempotencyClaim =
  | { readonly status: "first"; readonly handle: TransportIdempotencyHandle }
  | { readonly status: "replay"; readonly result: TransportIdempotencyResult | null }
  | { readonly status: "reused" };

const handleIds = new WeakMap<object, string>();

const reject = (field: string): never => {
  throw new Error(`Invalid transport idempotency field: ${field}`);
};

const isDigest = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array && value.length === DIGEST_LENGTH;

const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/**
 * Claims the `(Principal, Operation ID, key digest)` record on the caller's transaction and decides
 * (API-IDM-006): `first` for a new record or an expired one reused in place, `replay` for the same
 * request digest, `reused` for another request digest (the caller answers `409
 * IDEMPOTENCY_KEY_REUSED` and writes nothing).
 *
 * Call position (DB-IDM-002, SPEC-100 §47 and the paragraph after §48): only in the first business
 * commit transaction of the Operation. An Operation that locks the Principal's Business Profile
 * `FOR UPDATE` claims after that lock. An Operation that does not lock it claims before it locks any
 * other business row. Calling it after other business locks reintroduces the lock-order deadlock the
 * rule exists to prevent.
 *
 * The row is created or reused with one `INSERT ... ON CONFLICT DO UPDATE ... WHERE expired`, so the
 * unique index serializes concurrent claims and no 23505 reaches the caller (API-IDM-009): a
 * concurrent uncommitted claim is waited for within `lock_timeout` (`55P03` is retried by
 * `transaction()`). `created_at` and `expires_at` come from the database's `transaction_timestamp()`;
 * an expired record is treated as absent and reused by UPDATE, never removed (API-IDM-008, DB-IDM-003).
 * When the statement affects no row the conflicting row is locked and unchanged, and it is read back
 * on the same transaction.
 *
 * A Principal without a Business Profile is a wiring defect (the Principal guard has run before), so
 * it throws and the caller fails closed.
 */
export async function claimTransportIdempotency(
  client: PoolClient,
  input: TransportIdempotencyClaimInput,
): Promise<TransportIdempotencyClaim> {
  if (typeof input !== "object" || input === null) return reject("input");
  const { principalProfileRef, operationId, keyDigest, requestDigest } = input;
  if (!isUuid(principalProfileRef)) return reject("principalProfileRef");
  if (
    typeof operationId !== "string" ||
    operationId.length > OPERATION_ID_MAX_LENGTH ||
    !OPERATION_ID.test(operationId)
  )
    return reject("operationId");
  if (!isDigest(keyDigest)) return reject("keyDigest");
  if (!isDigest(requestDigest)) return reject("requestDigest");
  const key = Buffer.from(keyDigest);
  const request = Buffer.from(requestDigest);

  const written = await client.query<{ id: string }>(
    `INSERT INTO app.idempotency_records (principal_profile_id, operation_id, key_digest, request_digest)
     SELECT p.id, $2, $3, $4 FROM app.business_profiles p WHERE p.public_ref = $1
     ON CONFLICT (principal_profile_id, operation_id, key_digest) DO UPDATE
       SET request_digest = EXCLUDED.request_digest,
           result_ref_type = NULL,
           result_refs = '{}',
           created_at = transaction_timestamp(),
           expires_at = transaction_timestamp() + interval '24 hours'
       WHERE app.idempotency_records.expires_at <= transaction_timestamp()
     RETURNING id::text AS id`,
    [principalProfileRef, operationId, key, request],
  );
  const first = written.rows[0];
  if (first !== undefined) {
    const handle = Object.freeze({}) as TransportIdempotencyHandle;
    handleIds.set(handle, first.id);
    return { status: "first", handle };
  }

  const existing = await client.query<{
    request_digest: Buffer;
    result_ref_type: string | null;
    result_refs: string[];
  }>(
    `SELECT r.request_digest, r.result_ref_type, r.result_refs::text[] AS result_refs
       FROM app.idempotency_records r
       JOIN app.business_profiles p ON p.id = r.principal_profile_id
      WHERE p.public_ref = $1 AND r.operation_id = $2 AND r.key_digest = $3`,
    [principalProfileRef, operationId, key],
  );
  const row = existing.rows[0];
  if (row === undefined) throw new Error("Transport idempotency principal profile not found");
  if (!request.equals(row.request_digest)) return { status: "reused" };
  return {
    status: "replay",
    result:
      row.result_ref_type === null
        ? null
        : { type: row.result_ref_type, refs: [...row.result_refs] },
  };
}

/**
 * Sets the result of a `first` claim, once, on the same transaction (SPEC-100 §43.1): only the type
 * token and the references of the result, never a body, Checkout URL, Session ID or Email address.
 * A second call for the same record throws.
 */
export async function setTransportIdempotencyResult(
  client: PoolClient,
  handle: TransportIdempotencyHandle,
  result: TransportIdempotencyResult,
): Promise<void> {
  const id = typeof handle === "object" && handle !== null ? handleIds.get(handle) : undefined;
  if (id === undefined) return reject("handle");
  if (typeof result !== "object" || result === null) return reject("result");
  const { type, refs } = result;
  if (typeof type !== "string" || !RESULT_REF_TYPE.test(type)) return reject("result.type");
  if (!Array.isArray(refs) || refs.length === 0 || !refs.every(isUuid))
    return reject("result.refs");

  const updated = await client.query(
    `UPDATE app.idempotency_records
        SET result_ref_type = $2, result_refs = $3::uuid[]
      WHERE id = $1::bigint AND result_ref_type IS NULL`,
    [id, type, [...refs]],
  );
  if (updated.rowCount !== 1) throw new Error("Transport idempotency result was not set");
}
