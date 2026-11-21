import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { Client, Pool, PoolClient } from "pg";
import {
  claimTransportIdempotency,
  setTransportIdempotencyResult,
} from "../../../packages/db/src/idempotency-records.ts";
import { createDatabase, transaction } from "../../../packages/db/src/index.ts";
import { createLogger } from "../../../packages/observability/src/index.ts";

// PR-S0-3d test harness (SPEC-170 TST-GEN-006, DEV-DB-016): synthetic Profiles, a synthetic business
// table that stands in for a Domain table with a Business Cause UNIQUE, two test-only business
// transactions that call the production claim primitive in the two lock positions of SPEC-100 section 47
// (DB-IDM-002), hook points for barriers and faults, and small observers of the real PostgreSQL 17.
// Nothing here is reachable from production code. Synthetic values only: UUIDs of the form
// 00000000-0000-4000-8000-0000000000xx, keys `synthetic-idem-key-...`, no Email, no clock, no randomness.

export const OPERATION_ID = "API-ORD-002";
export const OTHER_OPERATION_ID = "API-CHK-001";
export const RESULT_TYPE = "SYNTHETIC_EFFECT";

/** A synthetic UUID `00000000-0000-4000-8000-<n in hex, 12 digits>`. */
export const ref = (n: number): string =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** The unkeyed SHA-256 of a synthetic label, as the Transport layer computes key and request digests. */
export const digest = (label: string): Uint8Array =>
  new Uint8Array(createHash("sha256").update(label, "utf8").digest());

export const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

export interface ClaimInput {
  readonly principalProfileRef: string;
  readonly operationId: string;
  readonly keyDigest: Uint8Array;
  readonly requestDigest: Uint8Array;
}
/** Claim input built from a synthetic raw key and a synthetic request label (only digests go on). */
export function claimInput(
  principalProfileRef: string,
  key: string,
  request: string,
  operationId: string = OPERATION_ID,
): ClaimInput {
  return {
    principalProfileRef,
    operationId,
    keyDigest: digest(key),
    requestDigest: digest(request),
  };
}

export type ClaimOutcome = Awaited<ReturnType<typeof claimTransportIdempotency>>;
export type ReplayResult = { readonly type: string; readonly refs: readonly string[] } | null;
export type EffectOutcome =
  | { kind: "first"; effectRef: string; created: boolean }
  | { kind: "replay"; result: ReplayResult }
  | { kind: "reused" };

// ---- profiles, synthetic business table -------------------------------------------------------

/** Creates a synthetic Business Profile with a given public reference; returns its internal id (text). */
export async function insertProfile(admin: Client, publicRef: string): Promise<string> {
  // A distinct synthetic Auth Subject derived from the reference (variant nibble 9 instead of 8).
  const authSubject = publicRef.replace("-8000-", "-9000-");
  return (
    await admin.query(
      "INSERT INTO app.business_profiles(public_ref, auth_subject) VALUES ($1, $2) RETURNING id::text AS id",
      [publicRef, authSubject],
    )
  ).rows[0].id as string;
}

/**
 * `synthetic_business.effects` is the stand-in for a Domain table whose UNIQUE Business Cause is the
 * authority that prevents a duplicate (API-IDM-001). It lives outside the `app` schema, so it never
 * enters the catalog comparison. app_api_runtime gets the privileges a business table would have.
 */
export async function installSyntheticBusiness(admin: Client): Promise<void> {
  await admin.query(`CREATE SCHEMA IF NOT EXISTS synthetic_business;
    CREATE TABLE IF NOT EXISTS synthetic_business.effects (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      public_ref uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
      cause_key uuid NOT NULL UNIQUE,
      label text NOT NULL,
      CONSTRAINT ck_effects_label CHECK (char_length(label) BETWEEN 1 AND 40));
    GRANT USAGE ON SCHEMA synthetic_business TO app_api_runtime;
    GRANT SELECT, INSERT, UPDATE ON synthetic_business.effects TO app_api_runtime`);
}

/** Administrator fixture reset: records first (child), then effects. */
export async function resetRecords(admin: Client): Promise<void> {
  await admin.query("TRUNCATE app.idempotency_records");
  await admin.query("TRUNCATE synthetic_business.effects");
}

export interface RecordRow {
  id: string;
  principal_profile_id: string;
  operation_id: string;
  key_digest: string;
  request_digest: string;
  result_ref_type: string | null;
  result_refs: string[];
  created_at: string;
  expires_at: string;
}
/** Every record row, digests as hex, timestamps as UTC text with microseconds. */
export async function recordRows(admin: Client): Promise<RecordRow[]> {
  return (
    await admin.query(
      `SELECT id::text, principal_profile_id::text, operation_id,
              encode(key_digest, 'hex') AS key_digest, encode(request_digest, 'hex') AS request_digest,
              result_ref_type, result_refs::text[] AS result_refs,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS created_at,
              to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS expires_at
         FROM app.idempotency_records ORDER BY id`,
    )
  ).rows as RecordRow[];
}
export async function recordCount(admin: Client): Promise<number> {
  return (await admin.query("SELECT count(*)::int AS n FROM app.idempotency_records")).rows[0].n;
}
export interface EffectRow {
  public_ref: string;
  cause_key: string;
  label: string;
}
export async function effectRows(admin: Client): Promise<EffectRow[]> {
  return (
    await admin.query(
      "SELECT public_ref, cause_key, label FROM synthetic_business.effects ORDER BY id",
    )
  ).rows as EffectRow[];
}

/**
 * DB fixture for time control (TST-IDM-006): sets `expires_at = base + offset` and `created_at` 24 hours
 * before it, so that ck_idempotency_records_expiry holds. `base` is PostgreSQL's own timestamp text (for
 * example a `transaction_timestamp()::text` read inside the transaction under test), not a JavaScript
 * Date, so that microseconds are exact. The test clock is the database's transaction_timestamp().
 */
export async function setRecordTimes(
  admin: Client,
  id: string,
  base: string,
  offsetMicroseconds: number,
): Promise<void> {
  const updated = await admin.query(
    `UPDATE app.idempotency_records
        SET expires_at = $2::timestamptz + ($3::bigint * interval '1 microsecond'),
            created_at = $2::timestamptz + ($3::bigint * interval '1 microsecond') - interval '24 hours'
      WHERE id = $1::bigint`,
    [id, base, offsetMicroseconds],
  );
  if (updated.rowCount !== 1) throw new Error("record to age was not found");
}

/** An administrator-created record that expired 24 hours ago (created 48 hours ago). */
export async function seedExpiredRecord(
  admin: Client,
  profileId: string,
  input: Pick<ClaimInput, "operationId" | "keyDigest" | "requestDigest">,
  result?: { type: string; refs: readonly string[] },
): Promise<string> {
  return (
    await admin.query(
      `INSERT INTO app.idempotency_records
         (principal_profile_id, operation_id, key_digest, request_digest,
          result_ref_type, result_refs, created_at, expires_at)
       VALUES ($1::bigint, $2, $3, $4, $5, $6::uuid[],
               transaction_timestamp() - interval '48 hours', transaction_timestamp() - interval '24 hours')
       RETURNING id::text AS id`,
      [
        profileId,
        input.operationId,
        Buffer.from(input.keyDigest),
        Buffer.from(input.requestDigest),
        result?.type ?? null,
        result ? [...result.refs] : [],
      ],
    )
  ).rows[0].id as string;
}

// ---- observers and synchronisation ------------------------------------------------------------

/** Resolves once at least `count` other sessions of this database wait for a lock; fails after the timeout. */
export async function waitForLockWaiters(
  admin: Client,
  count: number,
  timeoutMs = 15000,
): Promise<void> {
  const giveUp = performance.now() + timeoutMs;
  while (performance.now() < giveUp) {
    const waiting = (
      await admin.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()",
      )
    ).rows[0].n as number;
    if (waiting >= count) return;
    await delay(10);
  }
  throw new Error(`fewer than ${count} sessions waited for a lock within ${timeoutMs} ms`);
}

/** Terminates a backend and waits until PostgreSQL no longer lists it (the fault is then in effect). */
export async function terminateBackend(admin: Client, pid: number): Promise<void> {
  await admin.query("SELECT pg_terminate_backend($1)", [pid]);
  const giveUp = performance.now() + 10000;
  while (performance.now() < giveUp) {
    const alive = (await admin.query("SELECT 1 FROM pg_stat_activity WHERE pid = $1", [pid]))
      .rowCount;
    if (!alive) return;
    await delay(10);
  }
  throw new Error("backend did not terminate");
}

/** Lets `parties` callers meet; each waits at most `timeoutMs` so that a broken run fails, not hangs. */
export function barrier(parties: number, timeoutMs = 20000) {
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    async wait(): Promise<void> {
      arrived += 1;
      if (arrived >= parties) open();
      await Promise.race([
        gate,
        delay(timeoutMs).then(() => {
          throw new Error("barrier timed out");
        }),
      ]);
    },
  };
}

export function logCollector() {
  const lines: string[] = [];
  const logger = createLogger(
    { service: "API", environment: "test", actor_type: "SYSTEM_WORKER" },
    (line) => {
      lines.push(line);
    },
  );
  return {
    logger,
    lines,
    events: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

// ---- runtime pools ----------------------------------------------------------------------------

/**
 * `count` independent app_api_runtime pools (verified TLS, the production factory). The test
 * environment caps one pool at 2 connections, so N concurrent transactions use N pools.
 */
export async function openRuntimePools(url: string, caPath: string, count: number) {
  const ca = await readFile(caPath, "utf8");
  const opened = Array.from({ length: count }, () => {
    const runtimeUrl = new URL(url);
    runtimeUrl.username = "app_api_runtime";
    runtimeUrl.password = "";
    runtimeUrl.search = "";
    return createDatabase({
      connectionString: runtimeUrl.href,
      environment: "test",
      service: "api",
      ca,
    });
  });
  return {
    pools: opened.map((entry) => entry.pool) as Pool[],
    close: async () => {
      await Promise.all(opened.map((entry) => entry.close()));
    },
  };
}

// ---- test-only business transactions ----------------------------------------------------------

type Hook = (client: PoolClient, attempt: number) => Promise<void>;
/**
 * Await points inside the business transaction. `attempt` is 1 for the first run of the callback;
 * transaction() re-runs it after a 55P03 / 40P01 / 40001 rollback. A hook may throw to roll back.
 */
export interface EffectHooks {
  /** First statement of the transaction body (before any lock). */
  start?: Hook;
  /** Immediately before the claim. */
  beforeClaim?: Hook;
  /** Immediately after the claim returned, before any business change. */
  afterClaim?: Hook;
  /** After the business change and setTransportIdempotencyResult, before COMMIT. */
  afterResult?: Hook;
}
export interface EffectInput extends ClaimInput {
  /** The synthetic Domain Business Cause (UNIQUE in synthetic_business.effects). */
  readonly causeKey: string;
  readonly label: string;
}
export interface EffectOptions {
  readonly hooks?: EffectHooks;
  readonly logger?: ReturnType<typeof createLogger>;
}

async function runEffect(
  pool: Pool,
  input: EffectInput,
  position: "profile-lock" | "no-profile-lock",
  options: EffectOptions,
) {
  const hooks = options.hooks ?? {};
  let attempt = 0;
  return transaction(
    pool,
    async (client): Promise<EffectOutcome> => {
      attempt += 1;
      await hooks.start?.(client, attempt);
      if (position === "profile-lock") {
        // SPEC-100 section 47: the Profile is locked first, the claim comes after it (DB-IDM-002).
        await client.query(
          "SELECT id FROM app.business_profiles WHERE public_ref = $1 FOR UPDATE",
          [input.principalProfileRef],
        );
      }
      await hooks.beforeClaim?.(client, attempt);
      const claim = await claimTransportIdempotency(client, {
        principalProfileRef: input.principalProfileRef,
        operationId: input.operationId,
        keyDigest: input.keyDigest,
        requestDigest: input.requestDigest,
      });
      await hooks.afterClaim?.(client, attempt);
      if (claim.status === "replay") return { kind: "replay", result: claim.result };
      if (claim.status === "reused") return { kind: "reused" };
      // first: the business change. The Domain UNIQUE (cause_key) decides a duplicate (API-IDM-001).
      const inserted = await client.query(
        "INSERT INTO synthetic_business.effects(cause_key, label) VALUES ($1, $2) ON CONFLICT (cause_key) DO NOTHING RETURNING public_ref",
        [input.causeKey, input.label],
      );
      const lockClause = position === "no-profile-lock" ? " FOR UPDATE" : "";
      const effect = (
        await client.query(
          `SELECT public_ref FROM synthetic_business.effects WHERE cause_key = $1${lockClause}`,
          [input.causeKey],
        )
      ).rows[0] as { public_ref: string };
      await setTransportIdempotencyResult(client, claim.handle, {
        type: RESULT_TYPE,
        refs: [effect.public_ref],
      });
      await hooks.afterResult?.(client, attempt);
      return { kind: "first", effectRef: effect.public_ref, created: inserted.rowCount === 1 };
    },
    {
      queryName: "synthetic.idempotency_effect",
      ...(options.logger ? { logger: options.logger } : {}),
    },
  );
}

/** An Operation that locks the Principal's Business Profile `FOR UPDATE` first, then claims. */
export const profileLockingEffect = (pool: Pool, input: EffectInput, options: EffectOptions = {}) =>
  runEffect(pool, input, "profile-lock", options);

/** An administrative-style Operation: the claim comes first, the business row is locked afterwards. */
export const nonLockingEffect = (pool: Pool, input: EffectInput, options: EffectOptions = {}) =>
  runEffect(pool, input, "no-profile-lock", options);

export type Settled =
  | { kind: "committed"; outcome: EffectOutcome }
  | { kind: "commit_unknown" }
  | { kind: "threw"; error: unknown };

/** Folds a transaction() promise into a value, so Promise.all never hides a sibling's outcome. */
export async function settle(promise: ReturnType<typeof runEffect>): Promise<Settled> {
  try {
    const result = await promise;
    return result.status === "committed"
      ? { kind: "committed", outcome: result.value }
      : { kind: "commit_unknown" };
  } catch (error) {
    return { kind: "threw", error };
  }
}

/** The outcome of a settled business transaction that must have committed; anything else fails the test. */
export function committed(settled: Settled): EffectOutcome {
  if (settled.kind !== "committed") {
    const detail = settled.kind === "threw" ? `: ${String((settled.error as Error)?.message)}` : "";
    throw new Error(`expected a committed transaction, got ${settled.kind}${detail}`);
  }
  return settled.outcome;
}

/** The claim alone in its own transaction (no business change); returns the decision without the handle. */
export async function claimInTransaction(
  pool: Pool,
  input: ClaimInput,
  result?: { type: string; refs: readonly string[] },
): Promise<
  | { status: "first" }
  | { status: "replay"; result: ReplayResult }
  | { status: "reused" }
  | { status: "commit_unknown" }
> {
  const done = await transaction(
    pool,
    async (client) => {
      const claim = await claimTransportIdempotency(client, input);
      if (claim.status === "first") {
        if (result) await setTransportIdempotencyResult(client, claim.handle, result);
        return { status: "first" as const };
      }
      return claim.status === "replay"
        ? { status: "replay" as const, result: claim.result }
        : { status: "reused" as const };
    },
    { queryName: "synthetic.idempotency_claim" },
  );
  return done.status === "committed" ? done.value : { status: "commit_unknown" };
}
