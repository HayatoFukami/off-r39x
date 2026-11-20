// SPEC-110 §18.1 / API-IDM-004: the minimal transaction of an Operation that succeeds without a
// business update (a NOOP success). It writes the replay record only, in its own transaction, and
// makes no external call (DEV-DB-010). An Operation that does change business rows claims inside its
// own business transaction instead (see `claimTransportIdempotency`).
import type { Pool } from "pg";
import { isDatabaseTemporaryFailure } from "../errors.ts";
import {
  claimTransportIdempotency,
  setTransportIdempotencyResult,
  type TransportIdempotencyClaimInput,
  type TransportIdempotencyResult,
} from "../idempotency-records.ts";
import { transaction } from "../transaction.ts";

export type TransportIdempotencyRecordWithoutUpdate =
  | { status: "recorded" }
  | { status: "replay"; result: TransportIdempotencyResult | null }
  | { status: "reused" }
  | { status: "commit_unknown" }
  | { status: "unavailable" };

/**
 * Records `result` for the claim on its own transaction. `replay` and `reused` are the decisions of
 * `claimTransportIdempotency` (nothing is written). `commit_unknown` is a lost COMMIT answer: the
 * record may exist, and the caller's retry with the same key resolves it as a replay. A database
 * failure that `transaction()` classifies as temporary is `unavailable` (503).
 */
export async function recordTransportIdempotencyWithoutBusinessUpdate(
  pool: Pool,
  input: TransportIdempotencyClaimInput,
  result: TransportIdempotencyResult,
): Promise<TransportIdempotencyRecordWithoutUpdate> {
  try {
    const done = await transaction(
      pool,
      async (client): Promise<TransportIdempotencyRecordWithoutUpdate> => {
        const claim = await claimTransportIdempotency(client, input);
        if (claim.status === "first") {
          await setTransportIdempotencyResult(client, claim.handle, result);
          return { status: "recorded" };
        }
        return claim.status === "replay"
          ? { status: "replay", result: claim.result }
          : { status: "reused" };
      },
      { queryName: "idempotency.record_without_business_update" },
    );
    return done.status === "committed" ? done.value : { status: "commit_unknown" };
  } catch (error) {
    if (isDatabaseTemporaryFailure(error)) return { status: "unavailable" };
    throw error;
  }
}
