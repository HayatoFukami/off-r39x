import { type AddressInfo, createServer } from "node:net";
import { Client, Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimTransportIdempotency,
  setTransportIdempotencyResult,
} from "../../packages/db/src/idempotency-records.ts";
import {
  isDatabaseTemporaryFailure,
  sqlState,
  TransactionDeadlineError,
} from "../../packages/db/src/index.ts";
import { recordTransportIdempotencyWithoutBusinessUpdate } from "../../packages/db/src/transactions/idempotency.ts";
import { idempotencyStoreRig, readJson } from "../harness/api/transport-idempotency-store-rig.ts";
import { startCommitAcknowledgementDropProxy } from "../harness/db/commit-proxy.ts";
import { prepareFoundationDatabase } from "../harness/db/foundation.ts";
import {
  barrier,
  claimInput,
  claimInTransaction,
  committed,
  digest,
  type EffectInput,
  effectRows,
  hex,
  insertProfile,
  installSyntheticBusiness,
  logCollector,
  nonLockingEffect,
  OPERATION_ID,
  openRuntimePools,
  profileLockingEffect,
  RESULT_TYPE,
  recordCount,
  recordRows,
  ref,
  resetRecords,
  seedExpiredRecord,
  setRecordTimes,
  settle,
  terminateBackend,
  waitForLockWaiters,
} from "../harness/db/idempotency.ts";

// PR-S0-3d C1 (SPEC-110 section 18.1 API-IDM-004 / 006 / 008 / 009, SPEC-100 section 43.1 DB-IDM-002 /
// DB-IDM-003 and section 47, SPEC-170 section 28.1 TST-IDM-005 to TST-IDM-008): the claim primitive in the
// caller's business transaction on a real PostgreSQL 17: the decisions first / replay / reused, expiry
// and reuse of an expired row, N concurrent requests behind a barrier, the lock order, faults and a lost
// COMMIT acknowledgement, the minimal no-business-update transaction, and the fact that a lost record
// never lets a second Domain effect through. Locks, transaction races and SQLSTATE are never replaced by
// a fake (TST-GEN-004, DEV-TST-003). Business transactions are the test-only ones in
// tests/harness/db/idempotency.ts; the Domain stand-in is synthetic_business.effects with a UNIQUE
// Business Cause. The test clock is the database's transaction_timestamp(); randomness is fixed
// (Math.random = 0 in retry tests). G10's formal barrier run is a staging gate, not this suite.
// Synthetic data only.

const url = process.env.TEST_DATABASE_URL;
const caPath = process.env.TEST_DATABASE_CA;
if (!url || !caPath) throw new Error("Real PG17 requires TEST_DATABASE_URL and TEST_DATABASE_CA");

const N = 8;
const P1 = ref(0xb1);
const P2 = ref(0xb2);

let admin: Client;
let profile1: string;
let profile2: string;
let runtime: Awaited<ReturnType<typeof openRuntimePools>>;
const pool = (i = 0): Pool => {
  const found = runtime.pools[i];
  if (!found) throw new Error(`runtime pool ${i} is not open`);
  return found;
};

beforeAll(async () => {
  admin = new Client({ connectionString: url });
  await admin.connect();
  await prepareFoundationDatabase(admin);
  await installSyntheticBusiness(admin);
  profile1 = await insertProfile(admin, P1);
  profile2 = await insertProfile(admin, P2);
  runtime = await openRuntimePools(url as string, caPath as string, N);
});
afterAll(async () => {
  await runtime?.close();
  await admin?.end();
});
beforeEach(async () => {
  await resetRecords(admin);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const effectInput = (
  principal: string,
  key: string,
  request: string,
  cause: string,
  label = "synthetic-label",
): EffectInput => ({ ...claimInput(principal, key, request), causeKey: cause, label });

const counts = (outcomes: { kind: string }[]) => ({
  first: outcomes.filter((o) => o.kind === "first").length,
  replay: outcomes.filter((o) => o.kind === "replay").length,
  reused: outcomes.filter((o) => o.kind === "reused").length,
});
const sqlstatesOf = (events: Record<string, unknown>[]) =>
  events.map((event) => event.sqlstate).filter((code) => code !== undefined);
const hasNo23505 = (collector: ReturnType<typeof logCollector>) => {
  const events = collector.events();
  expect(sqlstatesOf(events), "23505 in the database log").not.toContain("23505");
  expect(
    events.filter((event) => event.event_name === "db.constraint_loser.completed"),
    "constraint loser events",
  ).toEqual([]);
};
const pidOf = async (client: PoolClient) =>
  (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;

// ---- TC-API-IDM-006-001 --------------------------------------------------------------------------

describe("TC-API-IDM-006-001 the three decisions of the claim primitive (real PostgreSQL 17)", () => {
  it("TC-API-IDM-006-001 first writes one row, the same request digest replays the stored refs, another request digest is reused and changes nothing", async () => {
    const key = "synthetic-idem-key-decide-0001";
    const cause = ref(0x801);
    const x = effectInput(P1, key, "synthetic-request-x", cause, "synthetic-label-x");
    const y = effectInput(P1, key, "synthetic-request-y", cause, "synthetic-label-y");

    const first = committed(await settle(profileLockingEffect(pool(), x)));
    expect(first).toMatchObject({ kind: "first", created: true });
    const effectRef = first.kind === "first" ? first.effectRef : "";
    const afterFirst = await recordRows(admin);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]).toMatchObject({
      principal_profile_id: profile1,
      operation_id: OPERATION_ID,
      key_digest: hex(digest(key)),
      request_digest: hex(digest("synthetic-request-x")),
      result_ref_type: RESULT_TYPE,
      result_refs: [effectRef],
    });
    const effectsAfterFirst = await effectRows(admin);
    expect(effectsAfterFirst).toHaveLength(1);

    // Same request digest: replay, with the type and refs that were set.
    expect(committed(await settle(profileLockingEffect(pool(), x)))).toEqual({
      kind: "replay",
      result: { type: RESULT_TYPE, refs: [effectRef] },
    });
    expect(await recordRows(admin)).toEqual(afterFirst);

    // Another request digest under the same key: reused. Nothing is written or changed.
    expect(committed(await settle(profileLockingEffect(pool(), y)))).toEqual({ kind: "reused" });
    expect(await recordRows(admin)).toEqual(afterFirst);
    expect(await effectRows(admin)).toEqual(effectsAfterFirst);
  });

  it("TC-API-IDM-006-001 a record whose result was not set replays with result null, and a Profile that does not exist is refused without a row", async () => {
    const input = claimInput(P1, "synthetic-idem-key-decide-0002", "synthetic-request-x");
    expect(await claimInTransaction(pool(), input)).toEqual({ status: "first" });
    expect(await claimInTransaction(pool(), input)).toEqual({ status: "replay", result: null });
    expect(await recordCount(admin)).toBe(1);

    // The Principal guard has run before the claim, so an unknown Profile is a wiring defect: it fails closed.
    await expect(
      claimInTransaction(
        pool(),
        claimInput(ref(0xdead), "synthetic-idem-key-decide-0003", "synthetic-request-x"),
      ),
    ).rejects.toBeDefined();
    expect(await recordCount(admin)).toBe(1);
  });

  it("TC-API-IDM-006-001 the handle of a first claim does not expose the internal record id (DEV-TS-005), and setting the result twice is refused", async () => {
    const outcome = await (async () => {
      const client = await pool().connect();
      try {
        await client.query("BEGIN");
        const claim = await claimTransportIdempotency(
          client,
          claimInput(P1, "synthetic-idem-key-decide-0004", "synthetic-request-x"),
        );
        if (claim.status !== "first") throw new Error("expected first");
        expect(typeof claim.handle).toBe("object");
        expect(JSON.stringify(claim.handle)).not.toMatch(/"(id|recordId|record_id)"/);
        await setTransportIdempotencyResult(client, claim.handle, {
          type: RESULT_TYPE,
          refs: [ref(0x802)],
        });
        // section 43.1: the result is set once, in the same transaction.
        await client.query("SAVEPOINT twice");
        await expect(
          setTransportIdempotencyResult(client, claim.handle, {
            type: RESULT_TYPE,
            refs: [ref(0x803)],
          }),
        ).rejects.toBeDefined();
        await client.query("ROLLBACK TO SAVEPOINT twice");
        await client.query("COMMIT");
        return "done";
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    })();
    expect(outcome).toBe("done");
    expect((await recordRows(admin))[0]).toMatchObject({
      result_ref_type: RESULT_TYPE,
      result_refs: [ref(0x802)],
    });
  });
});

// ---- TC-API-IDM-008-001 --------------------------------------------------------------------------

describe("TC-API-IDM-008-001 a record lives 24 hours and an expired row is reused in place (real PostgreSQL 17)", () => {
  /** Runs `work` in a runtime transaction whose own transaction_timestamp() is `t` (PostgreSQL text). */
  async function inTransaction<T>(work: (client: PoolClient, t: string) => Promise<T>): Promise<T> {
    const client = await pool().connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      const t = (await client.query("SELECT transaction_timestamp()::text AS t")).rows[0]
        .t as string;
      const value = await work(client, t);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  it("TC-API-IDM-008-001 one microsecond before expires_at the record is still valid (replay or reused); at expires_at it is expired and the same row is reused with its result cleared", async () => {
    const key = "synthetic-idem-key-expiry-0001";
    const oldInput = claimInput(P1, key, "synthetic-request-old");
    const newInput = claimInput(P1, key, "synthetic-request-new");
    await claimInTransaction(pool(), oldInput, { type: RESULT_TYPE, refs: [ref(0x901)] });
    const [seed] = await recordRows(admin);
    expect(seed).toBeDefined();
    const seedId = seed?.id as string;

    // expires_at = T + 1 microsecond: the record is valid at T.
    await inTransaction(async (client, t) => {
      await setRecordTimes(admin, seedId, t, 1);
      expect(await claimTransportIdempotency(client, oldInput)).toEqual({
        status: "replay",
        result: { type: RESULT_TYPE, refs: [ref(0x901)] },
      });
      expect(await claimTransportIdempotency(client, newInput)).toEqual({ status: "reused" });
    });
    expect(
      await recordRows(admin),
      "a valid record is untouched by replay and reused",
    ).toHaveLength(1);
    expect((await recordRows(admin))[0]).toMatchObject({
      id: seedId,
      request_digest: hex(digest("synthetic-request-old")),
      result_ref_type: RESULT_TYPE,
      result_refs: [ref(0x901)],
    });

    // expires_at = T: expired from that instant. A different request is `first`, not 409.
    const reusedAt = await inTransaction(async (client, t) => {
      await setRecordTimes(admin, seedId, t, 0);
      const claim = await claimTransportIdempotency(client, newInput);
      expect(claim.status).toBe("first");
      if (claim.status !== "first") throw new Error("expected first");
      // The reuse cleared the previous result before the new one is set.
      expect(
        (
          await client.query(
            "SELECT result_ref_type IS NULL AS no_type, cardinality(result_refs) AS refs FROM app.idempotency_records WHERE id = $1::bigint",
            [seedId],
          )
        ).rows[0],
      ).toEqual({ no_type: true, refs: 0 });
      await setTransportIdempotencyResult(client, claim.handle, {
        type: RESULT_TYPE,
        refs: [ref(0x902)],
      });
      return t;
    });
    const rows = await recordRows(admin);
    expect(rows, "no row is added and none is deleted").toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: seedId,
      principal_profile_id: profile1,
      operation_id: OPERATION_ID,
      key_digest: hex(digest(key)),
      request_digest: hex(digest("synthetic-request-new")),
      result_ref_type: RESULT_TYPE,
      result_refs: [ref(0x902)],
    });
    const times = (
      await admin.query(
        `SELECT created_at = $1::timestamptz AS created_is_t,
                expires_at = $1::timestamptz + interval '24 hours' AS expires_is_t_24h
           FROM app.idempotency_records WHERE id = $2::bigint`,
        [reusedAt, seedId],
      )
    ).rows[0];
    expect(times).toEqual({ created_is_t: true, expires_is_t_24h: true });
    // The new record is valid again for its own 24 hours.
    expect(await claimInTransaction(pool(), newInput)).toEqual({
      status: "replay",
      result: { type: RESULT_TYPE, refs: [ref(0x902)] },
    });
    expect(await claimInTransaction(pool(), oldInput)).toEqual({ status: "reused" });
  });

  it("TC-API-IDM-008-001 an expired row is treated as absent even for the same request digest: the claim is first and the old result is gone", async () => {
    const key = "synthetic-idem-key-expiry-0002";
    const input = claimInput(P1, key, "synthetic-request-same");
    await claimInTransaction(pool(), input, { type: RESULT_TYPE, refs: [ref(0x911)] });
    const [seed] = await recordRows(admin);
    await inTransaction(async (client, t) => {
      await setRecordTimes(admin, seed?.id as string, t, 0);
      expect((await claimTransportIdempotency(client, input)).status).toBe("first");
    });
    expect(await recordRows(admin)).toHaveLength(1);
    expect((await recordRows(admin))[0]).toMatchObject({
      id: seed?.id,
      result_ref_type: null,
      result_refs: [],
    });
  });

  it("TC-API-IDM-008-001 reuse is a conditional UPDATE in the same transaction as the business change, and a rollback leaves the expired row as it was", async () => {
    const key = "synthetic-idem-key-expiry-0003";
    const oldInput = claimInput(P1, key, "synthetic-request-old");
    await claimInTransaction(pool(), oldInput, { type: RESULT_TYPE, refs: [ref(0x921)] });
    const [seed] = await recordRows(admin);
    await admin.query(
      "UPDATE app.idempotency_records SET created_at = created_at - interval '48 hours', expires_at = expires_at - interval '48 hours' WHERE id = $1::bigint",
      [seed?.id],
    );
    const expired = await recordRows(admin);
    const settled = await settle(
      nonLockingEffect(pool(), effectInput(P1, key, "synthetic-request-new", ref(0x922)), {
        hooks: {
          afterResult: async () => {
            throw new Error("synthetic rollback after the reuse");
          },
        },
      }),
    );
    expect(settled.kind).toBe("threw");
    expect(await recordRows(admin), "rolled back: the expired row is exactly as before").toEqual(
      expired,
    );
    expect(await effectRows(admin)).toEqual([]);
  });
});

// ---- TC-API-IDM-009-001 --------------------------------------------------------------------------

describe("TC-API-IDM-009-001 N concurrent requests are serialised by the unique key (real PostgreSQL 17)", () => {
  const gateAtStart = (gate: ReturnType<typeof barrier>) => ({
    start: async (_client: PoolClient, attempt: number) => {
      if (attempt === 1) await gate.wait();
    },
  });

  it("TC-API-IDM-009-001 (a) the same key and request from N sessions: exactly one first, the others replay the one result, one effect, no 23505", async () => {
    const key = "synthetic-idem-key-race-a-0001";
    const cause = ref(0xa01);
    const collector = logCollector();
    const gate = barrier(N);
    const outcomes = (
      await Promise.all(
        Array.from({ length: N }, (_, i) =>
          settle(
            nonLockingEffect(pool(i), effectInput(P1, key, "synthetic-request-a", cause), {
              hooks: gateAtStart(gate),
              logger: collector.logger,
            }),
          ),
        ),
      )
    ).map(committed);
    expect(counts(outcomes)).toEqual({ first: 1, replay: N - 1, reused: 0 });
    const effects = await effectRows(admin);
    expect(effects).toHaveLength(1);
    for (const outcome of outcomes) {
      if (outcome.kind === "replay")
        expect(outcome.result).toEqual({
          type: RESULT_TYPE,
          refs: [effects[0]?.public_ref],
        });
    }
    expect(await recordRows(admin)).toHaveLength(1);
    hasNo23505(collector);
  }, 60000);

  it("TC-API-IDM-009-001 (b) the same key with two different requests: exactly one first, and every other request is replay or reused according to its digest", async () => {
    const key = "synthetic-idem-key-race-b-0001";
    const collector = logCollector();
    const gate = barrier(N);
    const labels = Array.from({ length: N }, (_, i) =>
      i % 2 === 0 ? "synthetic-request-x" : "synthetic-request-y",
    );
    const causes: Record<string, string> = {
      "synthetic-request-x": ref(0xa11),
      "synthetic-request-y": ref(0xa12),
    };
    const outcomes = (
      await Promise.all(
        labels.map((label, i) =>
          settle(
            nonLockingEffect(pool(i), effectInput(P1, key, label, causes[label] as string), {
              hooks: gateAtStart(gate),
              logger: collector.logger,
            }),
          ),
        ),
      )
    ).map(committed);
    expect(outcomes.filter((o) => o.kind === "first")).toHaveLength(1);
    const winner = outcomes.findIndex((o) => o.kind === "first");
    const winnerLabel = labels[winner] as string;
    const winnerOutcome = outcomes[winner];
    const winnerRef = winnerOutcome?.kind === "first" ? winnerOutcome.effectRef : "";
    outcomes.forEach((outcome, i) => {
      if (i === winner) return;
      if (labels[i] === winnerLabel)
        expect(outcome, `request ${i} has the winner's digest`).toEqual({
          kind: "replay",
          result: { type: RESULT_TYPE, refs: [winnerRef] },
        });
      else expect(outcome, `request ${i} has another digest`).toEqual({ kind: "reused" });
    });
    const rows = await recordRows(admin);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      request_digest: hex(digest(winnerLabel)),
      result_ref_type: RESULT_TYPE,
      result_refs: [winnerRef],
    });
    expect(await effectRows(admin)).toHaveLength(1);
    hasNo23505(collector);
  }, 60000);

  it("TC-API-IDM-009-001 (c) when the first transaction rolls back, exactly one waiting request becomes first and the rest replay", async () => {
    const key = "synthetic-idem-key-race-c-0001";
    const cause = ref(0xa21);
    const collector = logCollector();
    let signalClaimed!: () => void;
    const claimed = new Promise<void>((resolve) => {
      signalClaimed = resolve;
    });
    let allowRollback!: () => void;
    const mayRollBack = new Promise<void>((resolve) => {
      allowRollback = resolve;
    });
    const loser = settle(
      nonLockingEffect(pool(0), effectInput(P1, key, "synthetic-request-c", cause), {
        hooks: {
          afterClaim: async () => {
            signalClaimed();
            await mayRollBack;
            throw new Error("synthetic rollback of the first transaction");
          },
        },
        logger: collector.logger,
      }),
    );
    await claimed;
    const others = Array.from({ length: N - 1 }, (_, i) =>
      settle(
        nonLockingEffect(pool(i + 1), effectInput(P1, key, "synthetic-request-c", cause), {
          logger: collector.logger,
        }),
      ),
    );
    // Every other request is now waiting for the first transaction's uncommitted record.
    await waitForLockWaiters(admin, N - 1);
    allowRollback();
    const [first, ...rest] = await Promise.all([loser, ...others]);
    expect(first.kind).toBe("threw");
    expect(String((first.kind === "threw" ? first.error : "") as Error)).toContain(
      "synthetic rollback of the first transaction",
    );
    const outcomes = rest.map(committed);
    expect(counts(outcomes)).toEqual({ first: 1, replay: N - 2, reused: 0 });
    expect(await recordRows(admin)).toHaveLength(1);
    expect(await effectRows(admin)).toHaveLength(1);
    hasNo23505(collector);
  }, 60000);

  it("TC-API-IDM-009-001 (d) an expired row reused by N concurrent requests: exactly one first, the losers read the row again and replay or are reused, one row, no 23505", async () => {
    const key = "synthetic-idem-key-race-d-0001";
    const seedId = await seedExpiredRecord(
      admin,
      profile1,
      claimInput(P1, key, "synthetic-request-old"),
      { type: RESULT_TYPE, refs: [ref(0xa31)] },
    );
    const collector = logCollector();
    const gate = barrier(N);
    const labels = Array.from({ length: N }, (_, i) =>
      i % 2 === 0 ? "synthetic-request-x" : "synthetic-request-y",
    );
    const causes: Record<string, string> = {
      "synthetic-request-x": ref(0xa32),
      "synthetic-request-y": ref(0xa33),
    };
    const outcomes = (
      await Promise.all(
        labels.map((label, i) =>
          settle(
            nonLockingEffect(pool(i), effectInput(P1, key, label, causes[label] as string), {
              hooks: gateAtStart(gate),
              logger: collector.logger,
            }),
          ),
        ),
      )
    ).map(committed);
    expect(outcomes.filter((o) => o.kind === "first")).toHaveLength(1);
    const winner = outcomes.findIndex((o) => o.kind === "first");
    const winnerLabel = labels[winner] as string;
    const winnerOutcome = outcomes[winner];
    const winnerRef = winnerOutcome?.kind === "first" ? winnerOutcome.effectRef : "";
    outcomes.forEach((outcome, i) => {
      if (i === winner) return;
      expect(outcome, `request ${i}`).toEqual(
        labels[i] === winnerLabel
          ? { kind: "replay", result: { type: RESULT_TYPE, refs: [winnerRef] } }
          : { kind: "reused" },
      );
    });
    const rows = await recordRows(admin);
    expect(rows, "the expired row is reused in place").toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: seedId,
      request_digest: hex(digest(winnerLabel)),
      result_ref_type: RESULT_TYPE,
      result_refs: [winnerRef],
    });
    expect(await effectRows(admin)).toHaveLength(1);
    hasNo23505(collector);
  }, 60000);

  it("TC-API-IDM-009-001 (e) a lock held beyond lock_timeout and the 55P03 retry budget ends as a temporary failure; no record and no effect remain, and the key is claimable afterwards", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const key = "synthetic-idem-key-race-e-0001";
    const input = effectInput(P1, key, "synthetic-request-e", ref(0xa41));
    const collector = logCollector();
    const holder = new Client({ connectionString: url });
    await holder.connect();
    let attempts = 0;
    try {
      await holder.query("BEGIN");
      await holder.query(
        `INSERT INTO app.idempotency_records(principal_profile_id, operation_id, key_digest, request_digest)
         VALUES ($1::bigint, $2, $3, $4)`,
        [
          profile1,
          OPERATION_ID,
          Buffer.from(input.keyDigest),
          Buffer.from(digest("synthetic-holder")),
        ],
      );
      const settled = await settle(
        nonLockingEffect(pool(), input, {
          hooks: {
            start: async () => {
              attempts += 1;
            },
          },
          logger: collector.logger,
        }),
      );
      expect(settled.kind).toBe("threw");
      const error = settled.kind === "threw" ? settled.error : undefined;
      // The SPEC-150 classification: a retried 55P03 that ran out of attempts or of its 5 s budget.
      expect(isDatabaseTemporaryFailure(error)).toBe(true);
      expect(sqlState(error) === "55P03" || error instanceof TransactionDeadlineError).toBe(true);
      expect(attempts).toBeGreaterThanOrEqual(2);
      expect(attempts).toBeLessThanOrEqual(4);
      expect(sqlstatesOf(collector.events())).toContain("55P03");
      hasNo23505(collector);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      await holder.end();
    }
    expect(await recordCount(admin)).toBe(0);
    expect(await effectRows(admin)).toEqual([]);
    expect(await claimInTransaction(pool(), input)).toEqual({ status: "first" });
  }, 60000);
});

// ---- TC-DB-IDM-002-001 ---------------------------------------------------------------------------

describe("TC-DB-IDM-002-001 the claim is placed after the Profile lock, so no deadlock arises (SPEC-100 section 47, real PostgreSQL 17)", () => {
  it("TC-DB-IDM-002-001 N concurrent requests of one Profile with different keys all succeed: N records, N effects, no 40P01 in the log", async () => {
    const collector = logCollector();
    const gate = barrier(N);
    const outcomes = (
      await Promise.all(
        Array.from({ length: N }, (_, i) =>
          settle(
            profileLockingEffect(
              pool(i),
              effectInput(
                P1,
                `synthetic-idem-key-lock-0${i}`,
                `synthetic-request-lock-${i}`,
                ref(0xb00 + i),
              ),
              {
                hooks: {
                  start: async (_client, attempt) => {
                    if (attempt === 1) await gate.wait();
                  },
                },
                logger: collector.logger,
              },
            ),
          ),
        ),
      )
    ).map(committed);
    expect(counts(outcomes)).toEqual({ first: N, replay: 0, reused: 0 });
    expect(await recordCount(admin)).toBe(N);
    expect(await effectRows(admin)).toHaveLength(N);
    const codes = sqlstatesOf(collector.events());
    expect(codes, "no deadlock").not.toContain("40P01");
    expect(codes, "no lock timeout").not.toContain("55P03");
    hasNo23505(collector);
  }, 60000);

  it("TC-DB-IDM-002-001 control: two raw sessions that INSERT the record first and lock the Profile afterwards do deadlock (40P01), which is why the claim follows the Profile lock", async () => {
    const sessions = [new Client({ connectionString: url }), new Client({ connectionString: url })];
    await Promise.all(sessions.map((session) => session.connect()));
    const [a, b] = sessions as [Client, Client];
    const lockProfile = "SELECT id FROM app.business_profiles WHERE id = $1::bigint FOR UPDATE";
    const finish = async (session: Client, pending: Promise<unknown>) => {
      try {
        await pending;
        await session.query("COMMIT");
        return "ok";
      } catch (error) {
        await session.query("ROLLBACK");
        return (error as { code?: string }).code ?? "error";
      }
    };
    try {
      for (const session of sessions) {
        // Raw sessions without transaction(): no lock_timeout, a short deadlock_timeout.
        await session.query("SET lock_timeout = 0");
        await session.query("SET deadlock_timeout = '100ms'");
        await session.query("BEGIN");
      }
      const insert = `INSERT INTO app.idempotency_records(principal_profile_id, operation_id, key_digest, request_digest)
                      VALUES ($1::bigint, $2, $3, $4)`;
      // Each INSERT's foreign key takes FOR KEY SHARE on the same Profile row.
      await a.query(insert, [
        profile1,
        OPERATION_ID,
        Buffer.from(digest("synthetic-idem-key-ctl-a")),
        Buffer.from(digest("r")),
      ]);
      await b.query(insert, [
        profile1,
        OPERATION_ID,
        Buffer.from(digest("synthetic-idem-key-ctl-b")),
        Buffer.from(digest("r")),
      ]);
      const resultA = finish(a, a.query(lockProfile, [profile1]));
      await waitForLockWaiters(admin, 1);
      const resultB = finish(b, b.query(lockProfile, [profile1]));
      const results = await Promise.all([resultA, resultB]);
      expect(results.sort()).toEqual(["40P01", "ok"]);
    } finally {
      await Promise.all(sessions.map((session) => session.end()));
    }
  }, 30000);
});

// ---- TC-API-IDM-004-001 --------------------------------------------------------------------------

describe("TC-API-IDM-004-001 the record is written in the business transaction and rolls back with it (real PostgreSQL 17)", () => {
  const body = { label: "synthetic-label" };
  const errorCodeOf = async (response: Response) => {
    const { json } = await readJson(response);
    return (json as { error: { code: string; retryable: boolean } }).error;
  };

  it("TC-API-IDM-004-001 (a) a failing business change after the claim rolls back both the record and the effect, in either lock position, and the key is claimable again", async () => {
    for (const [label, effect] of [
      ["Profile lock first", profileLockingEffect],
      ["claim first", nonLockingEffect],
    ] as const) {
      const key = `synthetic-idem-key-atomic-a-${label === "claim first" ? 2 : 1}`;
      const input = effectInput(P1, key, "synthetic-request-a", ref(0xc01));
      const settled = await settle(
        effect(pool(), input, {
          hooks: {
            afterClaim: async (client) => {
              // The synthetic Domain table refuses an empty label (ck_effects_label).
              await client.query(
                "INSERT INTO synthetic_business.effects(cause_key, label) VALUES ($1, '')",
                [ref(0xc02)],
              );
            },
          },
        }),
      );
      expect(settled.kind, label).toBe("threw");
      expect(sqlState(settled.kind === "threw" ? settled.error : undefined), label).toBe("23514");
      expect(await recordCount(admin), `${label}: records`).toBe(0);
      expect(await effectRows(admin), `${label}: effects`).toEqual([]);
      expect(committed(await settle(effect(pool(), input))), label).toMatchObject({
        kind: "first",
        created: true,
      });
      await resetRecords(admin);
    }
  });

  it("TC-API-IDM-004-001 (b) a backend terminated just before the claim answers 503 DATABASE_TEMPORARY_FAILURE and leaves nothing", async () => {
    const rig = idempotencyStoreRig({ pool: pool(), principalProfileRef: P1 });
    rig.use({
      hooks: {
        beforeClaim: async (client) => {
          await terminateBackend(admin, await pidOf(client));
        },
      },
    });
    const response = await rig.post(ref(0xc11), { key: "synthetic-idem-key-atomic-b-0001", body });
    expect(response.status).toBe(503);
    expect(await errorCodeOf(response)).toMatchObject({
      code: "DATABASE_TEMPORARY_FAILURE",
      retryable: true,
    });
    expect(await recordCount(admin)).toBe(0);
    expect(await effectRows(admin)).toEqual([]);
  });

  it("TC-API-IDM-004-001 (c) a backend terminated after the claim and the result, before COMMIT, answers 503 and leaves nothing (the record is never committed alone)", async () => {
    const rig = idempotencyStoreRig({ pool: pool(), principalProfileRef: P1 });
    rig.use({
      hooks: {
        afterResult: async (client) => {
          await terminateBackend(admin, await pidOf(client));
        },
      },
    });
    const response = await rig.post(ref(0xc21), { key: "synthetic-idem-key-atomic-c-0001", body });
    expect(response.status).toBe(503);
    expect((await errorCodeOf(response)).code).toBe("DATABASE_TEMPORARY_FAILURE");
    expect(await recordCount(admin)).toBe(0);
    expect(await effectRows(admin)).toEqual([]);
  });

  it("TC-API-IDM-004-001 (d) a claim that keeps waiting for an uncommitted record exhausts the 55P03 retries and answers 503; nothing remains", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const key = "synthetic-idem-key-atomic-d-0001";
    const rig = idempotencyStoreRig({ pool: pool(), principalProfileRef: P1 });
    // An administrative-style Operation: the claim comes before any other lock, so the wait is at the claim.
    rig.use({ position: "no-profile-lock" });
    const holder = new Client({ connectionString: url });
    await holder.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(
        `INSERT INTO app.idempotency_records(principal_profile_id, operation_id, key_digest, request_digest)
         VALUES ($1::bigint, $2, $3, $4)`,
        [profile1, OPERATION_ID, Buffer.from(digest(key)), Buffer.from(digest("synthetic-holder"))],
      );
      const response = await rig.post(ref(0xc31), { key, body });
      expect(response.status).toBe(503);
      expect((await errorCodeOf(response)).code).toBe("DATABASE_TEMPORARY_FAILURE");
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      await holder.end();
    }
    expect(await recordCount(admin)).toBe(0);
    expect(await effectRows(admin)).toEqual([]);
  }, 60000);

  it("TC-API-IDM-004-001 (e) a lost COMMIT acknowledgement is commit_unknown and answers 503, but the record and the effect are both committed; the same request then replays", async () => {
    const target = new URL(url as string);
    target.username = "app_api_runtime";
    target.password = "";
    const proxy = await startCommitAcknowledgementDropProxy(target);
    const lossy = new Pool({ connectionString: proxy.url, ssl: false, max: 1 });
    const key = "synthetic-idem-key-atomic-e-0001";
    const cause = ref(0xc41);
    const rig = idempotencyStoreRig({ pool: lossy, principalProfileRef: P1 });
    try {
      const lost = await rig.post(cause, { key, body });
      expect(proxy.didDrop()).toBe(true);
      expect(lost.status).toBe(503);
      expect((await errorCodeOf(lost)).code).toBe("DATABASE_TEMPORARY_FAILURE");
    } finally {
      await lossy.end();
      await proxy.close();
    }
    // Seen from a new connection: both are there, never the record alone.
    const effects = await effectRows(admin);
    expect(effects).toHaveLength(1);
    const rows = await recordRows(admin);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key_digest: hex(digest(key)),
      result_ref_type: RESULT_TYPE,
      result_refs: [effects[0]?.public_ref],
    });
    // The client's retry with the same key and body converges on the committed result.
    rig.use({ pool: pool() });
    const retry = await rig.post(cause, { key, body });
    expect(retry.status).toBe(200);
    expect(((await readJson(retry)).json as { data: { ref: string } }).data.ref).toBe(
      effects[0]?.public_ref,
    );
    expect(await effectRows(admin)).toHaveLength(1);
    expect(await recordCount(admin)).toBe(1);
  }, 60000);
});

// ---- TC-API-IDM-004-002 --------------------------------------------------------------------------

describe("TC-API-IDM-004-002 the minimal transaction records an Operation that succeeds without a business update (real PostgreSQL 17)", () => {
  const result = { type: RESULT_TYPE, refs: [ref(0xd01)] };

  it("TC-API-IDM-004-002 recorded writes the record with its refs and no effect; the same request replays; another request for the same key is reused", async () => {
    const key = "synthetic-idem-key-noop-0001";
    const input = claimInput(P1, key, "synthetic-request-noop");
    expect(await recordTransportIdempotencyWithoutBusinessUpdate(pool(), input, result)).toEqual({
      status: "recorded",
    });
    const rows = await recordRows(admin);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      principal_profile_id: profile1,
      operation_id: OPERATION_ID,
      key_digest: hex(digest(key)),
      request_digest: hex(digest("synthetic-request-noop")),
      result_ref_type: RESULT_TYPE,
      result_refs: result.refs,
    });
    expect(await effectRows(admin), "no business change").toEqual([]);

    expect(await recordTransportIdempotencyWithoutBusinessUpdate(pool(), input, result)).toEqual({
      status: "replay",
      result,
    });
    expect(
      await recordTransportIdempotencyWithoutBusinessUpdate(
        pool(),
        claimInput(P1, key, "synthetic-request-other-target"),
        { type: RESULT_TYPE, refs: [ref(0xd02)] },
      ),
    ).toEqual({ status: "reused" });
    expect(await recordRows(admin)).toEqual(rows);
    expect(await effectRows(admin)).toEqual([]);
  });

  it("TC-API-IDM-004-002 an unreachable database is unavailable and writes nothing", async () => {
    const free = createServer();
    await new Promise<void>((resolve) => free.listen(0, "127.0.0.1", resolve));
    const { port } = free.address() as AddressInfo;
    await new Promise<void>((resolve) => free.close(() => resolve()));
    const dead = new Pool({
      host: "127.0.0.1",
      port,
      user: "app_api_runtime",
      database: "unreachable",
      max: 1,
      connectionTimeoutMillis: 2000,
    });
    try {
      expect(
        await recordTransportIdempotencyWithoutBusinessUpdate(
          dead,
          claimInput(P1, "synthetic-idem-key-noop-0002", "synthetic-request-noop"),
          result,
        ),
      ).toEqual({ status: "unavailable" });
    } finally {
      await dead.end();
    }
    expect(await recordCount(admin)).toBe(0);
  });

  it("TC-API-IDM-004-002 a lost COMMIT acknowledgement is commit_unknown; the record is committed once and the same request then replays", async () => {
    const target = new URL(url as string);
    target.username = "app_api_runtime";
    target.password = "";
    const proxy = await startCommitAcknowledgementDropProxy(target);
    const lossy = new Pool({ connectionString: proxy.url, ssl: false, max: 1 });
    const input = claimInput(P1, "synthetic-idem-key-noop-0003", "synthetic-request-noop");
    try {
      expect(await recordTransportIdempotencyWithoutBusinessUpdate(lossy, input, result)).toEqual({
        status: "commit_unknown",
      });
      expect(proxy.didDrop()).toBe(true);
    } finally {
      await lossy.end();
      await proxy.close();
    }
    expect(await recordRows(admin)).toHaveLength(1);
    expect(await recordTransportIdempotencyWithoutBusinessUpdate(pool(), input, result)).toEqual({
      status: "replay",
      result,
    });
    expect(await recordCount(admin)).toBe(1);
  }, 60000);
});

// ---- TC-API-IDM-010-001 --------------------------------------------------------------------------

describe("TC-API-IDM-010-001 the record is auxiliary: the Domain UNIQUE alone prevents a second effect (real PostgreSQL 17)", () => {
  it("TC-API-IDM-010-001 with the record deleted, expired or never created, the same Business Cause still yields one effect, and a lost record is never read as a 409", async () => {
    const cause = ref(0xe01);
    const key = "synthetic-idem-key-aux-0001";
    const original = effectInput(P1, key, "synthetic-request-aux", cause);
    const first = committed(await settle(profileLockingEffect(pool(), original)));
    expect(first).toMatchObject({ kind: "first", created: true });
    const effectRef = first.kind === "first" ? first.effectRef : "";
    expect(await effectRows(admin)).toHaveLength(1);

    // (1) The record is lost: the same key and request is a first claim again, the Domain row is reused.
    await admin.query("DELETE FROM app.idempotency_records");
    expect(committed(await settle(profileLockingEffect(pool(), original)))).toEqual({
      kind: "first",
      effectRef,
      created: false,
    });
    expect(await effectRows(admin)).toHaveLength(1);

    // (2) The record is expired: the same again.
    const [row] = await recordRows(admin);
    const now = (await admin.query("SELECT transaction_timestamp()::text AS t")).rows[0]
      .t as string;
    await setRecordTimes(admin, row?.id as string, now, -1);
    expect(committed(await settle(profileLockingEffect(pool(), original)))).toEqual({
      kind: "first",
      effectRef,
      created: false,
    });
    expect(await effectRows(admin)).toHaveLength(1);

    // (3) The record is lost and the same key now carries another request (a different content): there
    // is no record to compare with, so this is not a 409; the Domain UNIQUE still allows one effect.
    await admin.query("DELETE FROM app.idempotency_records");
    expect(
      committed(
        await settle(
          profileLockingEffect(pool(), effectInput(P1, key, "synthetic-request-other", cause)),
        ),
      ),
    ).toEqual({ kind: "first", effectRef, created: false });
    expect(await effectRows(admin)).toHaveLength(1);

    // (4) Another key for the same cause: still one effect.
    expect(
      committed(
        await settle(
          profileLockingEffect(
            pool(),
            effectInput(P1, "synthetic-idem-key-aux-0002", "synthetic-request-aux", cause),
          ),
        ),
      ),
    ).toMatchObject({ kind: "first", effectRef, created: false });
    expect(await effectRows(admin)).toHaveLength(1);
  });

  it("TC-API-IDM-010-001 a path that never claims a record still cannot create a second effect: the Domain UNIQUE refuses it (23505) or the conflict is a no-op", async () => {
    const cause = ref(0xe11);
    await pool().query("INSERT INTO synthetic_business.effects(cause_key, label) VALUES ($1, $2)", [
      cause,
      "synthetic-label",
    ]);
    await expect(
      pool().query("INSERT INTO synthetic_business.effects(cause_key, label) VALUES ($1, $2)", [
        cause,
        "synthetic-label-again",
      ]),
    ).rejects.toMatchObject({ code: "23505" });
    expect(
      (
        await pool().query(
          "INSERT INTO synthetic_business.effects(cause_key, label) VALUES ($1, $2) ON CONFLICT (cause_key) DO NOTHING",
          [cause, "synthetic-label-again"],
        )
      ).rowCount,
    ).toBe(0);
    expect(await effectRows(admin)).toHaveLength(1);
    expect(await recordCount(admin)).toBe(0);
    // A second Principal with the same cause does not get a second effect either (the cause is the authority).
    expect(
      committed(
        await settle(
          profileLockingEffect(
            pool(),
            effectInput(P2, "synthetic-idem-key-aux-0003", "synthetic-request-aux", cause),
          ),
        ),
      ),
    ).toMatchObject({ kind: "first", created: false });
    expect(profile2).not.toBe(profile1);
    expect(await effectRows(admin)).toHaveLength(1);
  });
});
