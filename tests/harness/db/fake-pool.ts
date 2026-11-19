import { EventEmitter } from "node:events";
import type { Pool } from "pg";

// Test-only stand-in for the `pg` Pool / PoolClient surface that `transaction()` uses.
// It is NOT evidence of PostgreSQL behavior (TST-DB-001): locks, SQLSTATE raised by the
// server and `25P02` after a failed statement need a real PG17. Production code must never
// import this file (production-no-tests).

/** One recorded step. `client` is the zero-based index of the fake client (= the connect order). */
export type FakePoolEvent =
  | { readonly client: number; readonly kind: "connect" }
  | { readonly client: number; readonly kind: "query"; readonly sql: string }
  | { readonly client: number; readonly kind: "release"; readonly destroy: boolean };

export interface FakeQueryContext {
  /** Zero-based index of the client; client 0 is the first attempt's connection. */
  readonly client: number;
  readonly sql: string;
}

/** Return an error to make this query reject with it; return `undefined` to let it succeed. */
export type FakeQueryBehavior = (context: FakeQueryContext) => Error | undefined;

/**
 * Return an error to make this `connect()` call reject with it (a pool acquisition failure, so no
 * client is created); return `undefined` to let it succeed. `attempt` is the zero-based number of
 * the `connect()` call, counting rejected calls too.
 */
export type FakeConnectBehavior = (attempt: number) => Error | undefined;

export interface FakePoolOptions {
  readonly connect?: FakeConnectBehavior;
}

export interface FakeClientRecord {
  readonly index: number;
  /** Every SQL string sent on this client, in order (including ones that were made to fail). */
  readonly queries: string[];
  /** One entry per `release()` call: `true` when the client was destroyed (`release(true)`). */
  readonly releases: boolean[];
}

export interface FakePool {
  /** Pass this to `transaction()`. */
  readonly pool: Pool;
  readonly clients: FakeClientRecord[];
  /** Chronological record across all clients (connect / query / release). */
  readonly timeline: FakePoolEvent[];
  /** How many times `connect()` was called, including calls made to reject. */
  connectAttempts(): number;
}

/** A synthetic server error carrying only a SQLSTATE; the message is a fixed marker, never real data. */
export function syntheticSqlstateError(code: string, message = "synthetic-private-message"): Error {
  return Object.assign(new Error(message), { code });
}

class FakeClient extends EventEmitter {
  constructor(
    private readonly record: FakeClientRecord,
    private readonly timeline: FakePoolEvent[],
    private readonly behavior: FakeQueryBehavior,
  ) {
    super();
  }
  async query(sql: string): Promise<{ rows: unknown[]; rowCount: number }> {
    this.record.queries.push(sql);
    this.timeline.push({ client: this.record.index, kind: "query", sql });
    const failure = this.behavior({ client: this.record.index, sql });
    if (failure) throw failure;
    return { rows: [], rowCount: 0 };
  }
  release(destroy?: boolean | Error): void {
    const destroyed = destroy === true || destroy instanceof Error;
    this.record.releases.push(destroyed);
    this.timeline.push({ client: this.record.index, kind: "release", destroy: destroyed });
  }
}

/**
 * `behavior` decides, per query, whether it fails. Typical use: fail the callback's probe query
 * (`SELECT probe`) on the first N clients, and optionally fail `ROLLBACK`.
 */
export function createFakePool(
  behavior: FakeQueryBehavior = () => undefined,
  options: FakePoolOptions = {},
): FakePool {
  const clients: FakeClientRecord[] = [];
  const timeline: FakePoolEvent[] = [];
  let attempts = 0;
  const pool = {
    async connect() {
      // Count every call, hook or not, and hand the hook the number before this increment.
      const attempt = attempts++;
      const failure = options.connect?.(attempt);
      if (failure) throw failure;
      const record: FakeClientRecord = { index: clients.length, queries: [], releases: [] };
      clients.push(record);
      timeline.push({ client: record.index, kind: "connect" });
      return new FakeClient(record, timeline, behavior);
    },
  };
  return { pool: pool as unknown as Pool, clients, timeline, connectAttempts: () => attempts };
}
