import { setTimeout as delay } from "node:timers/promises";
import { Client, Pool, type PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransactionDeadlineError, transaction } from "../../packages/db/src/index.ts";
import { createLogger } from "../../packages/observability/src/index.ts";

// Real PostgreSQL 17 lock waits (SPEC-170 section 24: a second session holds the lock; a fake pool
// cannot stand in for it, TST-DB-001). Each file runs against its own database
// (harness/db/isolated-database.ts), so the synthetic probe table below is private to this file.
// The transaction() lock_timeout is 1s per lock acquisition (SPEC-150 section 9); the retry budget
// for 55P03 is 4 attempts / 5s from the first attempt's start.

const url = process.env.TEST_DATABASE_URL;
if (!url || !process.env.TEST_DATABASE_CA)
  throw new Error("Real PG17 requires TEST_DATABASE_URL and TEST_DATABASE_CA");

const TABLE = "public.lock_timeout_probe";

type Event = Record<string, unknown> & { event_name: string };
function collector() {
  const lines: string[] = [];
  const logger = createLogger(
    { service: "API", environment: "test", actor_type: "SYSTEM_WORKER" },
    (line) => {
      lines.push(line);
    },
  );
  return { logger, events: (): Event[] => lines.map((line) => JSON.parse(line) as Event) };
}
function named(events: Event[], name: string): Event[] {
  return events.filter((event) => event.event_name === name);
}

/** A second session that keeps a lock until `release()`; `release()` is idempotent. */
async function holdLock(sql: string) {
  const client = new Client({ connectionString: url });
  await client.connect();
  let released = false;
  try {
    await client.query("BEGIN");
    await client.query(sql);
  } catch (error) {
    await client.end();
    throw error;
  }
  return {
    async release() {
      if (released) return;
      released = true;
      try {
        await client.query("ROLLBACK");
      } finally {
        await client.end();
      }
    },
  };
}
async function resetProbe(admin: Pool, rows: number): Promise<void> {
  await admin.query(
    `CREATE TABLE IF NOT EXISTS ${TABLE}(id int primary key, counter int not null)`,
  );
  await admin.query(`TRUNCATE ${TABLE}`);
  for (let id = 1; id <= rows; id++)
    await admin.query(`INSERT INTO ${TABLE}(id, counter) VALUES ($1, 0)`, [id]);
}
async function counters(admin: Pool): Promise<number[]> {
  return (await admin.query(`SELECT counter FROM ${TABLE} ORDER BY id`)).rows.map(
    (row) => row.counter as number,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PostgreSQL 17 lock timeout retry (real database)", () => {
  it("TC-DB-FOUNDATION-011 REL-DB-011 a real 55P03 is rolled back on the same connection and the callback re-runs once it succeeds", async () => {
    const admin = new Pool({ connectionString: url, max: 1 });
    // One physical connection only: if ROLLBACK were not sent after 55P03, the next BEGIN/SET
    // on that session would fail with 25P02 (current transaction is aborted).
    const pool = new Pool({ connectionString: url, max: 1 });
    const { logger, events } = collector();
    let holder: Awaited<ReturnType<typeof holdLock>> | undefined;
    try {
      await resetProbe(admin, 1);
      await pool.query("SELECT 1");
      holder = await holdLock(`SELECT id FROM ${TABLE} WHERE id = 1 FOR UPDATE`);
      const releasing = delay(1500).then(() => holder?.release());
      const attempts: { pid: number; xid: string; failedAfterMs?: number }[] = [];
      const result = await transaction(
        pool,
        async (client) => {
          const began = performance.now();
          const session = (
            await client.query("SELECT pg_backend_pid() AS pid, pg_current_xact_id()::text AS xid")
          ).rows[0];
          const attempt: { pid: number; xid: string; failedAfterMs?: number } = {
            pid: session.pid,
            xid: session.xid,
          };
          attempts.push(attempt);
          try {
            await client.query(`SELECT id FROM ${TABLE} WHERE id = 1 FOR UPDATE`);
          } catch (error) {
            attempt.failedAfterMs = performance.now() - began;
            throw error;
          }
          await client.query(`UPDATE ${TABLE} SET counter = counter + 1 WHERE id = 1`);
        },
        { logger, queryName: "foundation.lock_timeout.recovers" },
      );
      await releasing;

      expect(result).toEqual({ status: "committed", value: undefined });
      expect(attempts).toHaveLength(2);
      // Attempt 1 waited for the lock until lock_timeout (1s) and failed with 55P03.
      expect(attempts[0]?.failedAfterMs).toBeGreaterThanOrEqual(900);
      expect(attempts[0]?.failedAfterMs).toBeLessThan(1500);
      // Attempt 2 ran on the very same backend and succeeded without 25P02: the failed
      // transaction had been rolled back explicitly. It is a new transaction.
      expect(attempts[1]?.pid).toBe(attempts[0]?.pid);
      expect(attempts[1]?.xid).not.toBe(attempts[0]?.xid);
      // The Business effect happened exactly once.
      expect(await counters(admin)).toEqual([1]);
      const scheduled = named(events(), "db.transaction.retry_scheduled");
      expect(scheduled).toHaveLength(1);
      expect(scheduled[0]).toMatchObject({ sqlstate: "55P03", attempt_number: 2 });
    } finally {
      await holder?.release();
      await pool.end();
      await admin.end();
    }
  }, 15000);

  it("TC-DB-FOUNDATION-012 REL-DB-011 OBS-DB-003 a lock that is never released ends in the original 55P03 after four attempts", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const admin = new Pool({ connectionString: url, max: 1 });
    const pool = new Pool({ connectionString: url, max: 1 });
    const { logger, events } = collector();
    let holder: Awaited<ReturnType<typeof holdLock>> | undefined;
    try {
      await resetProbe(admin, 1);
      await pool.query("SELECT 1");
      holder = await holdLock(`SELECT id FROM ${TABLE} WHERE id = 1 FOR UPDATE`);
      let attempts = 0;
      const started = performance.now();
      await expect(
        transaction(
          pool,
          async (client) => {
            attempts++;
            await client.query(`SELECT id FROM ${TABLE} WHERE id = 1 FOR UPDATE`);
            await client.query(`UPDATE ${TABLE} SET counter = counter + 1 WHERE id = 1`);
          },
          { logger, queryName: "foundation.lock_timeout.exhausted" },
        ),
      ).rejects.toMatchObject({ code: "55P03" });
      const elapsed = performance.now() - started;

      expect(attempts).toBe(4);
      // Four lock_timeout waits of 1s, no backoff (random fixed at 0), within the 5s budget.
      expect(elapsed).toBeGreaterThanOrEqual(3900);
      expect(elapsed).toBeLessThan(5250);
      expect(await counters(admin)).toEqual([0]);

      const all = events();
      expect(named(all, "db.transaction.retry_scheduled")).toHaveLength(3);
      const failed = named(all, "db.transaction.completed").filter(
        (event) => event.result === "FAILED",
      );
      expect(failed).toHaveLength(4);
      for (const event of failed)
        expect(event).toMatchObject({ sqlstate: "55P03", failure_class: "TEMPORARY_FAILURE" });
      const exhausted = named(all, "reliability.retry.exhausted");
      expect(exhausted).toHaveLength(1);
      expect(exhausted[0]).toMatchObject({
        level: "ERROR",
        result: "FAILED",
        failure_class: "TEMPORARY_FAILURE",
        attempt_number: 4,
        sqlstate: "55P03",
      });
      // Not a statement timeout, not a conflict loser, not an unavailable database (OBS-DB-003).
      expect(named(all, "reliability.timeout.occurred")).toHaveLength(0);
      expect(named(all, "db.constraint_loser.completed")).toHaveLength(0);
      expect(named(all, "db.availability.failed")).toHaveLength(0);
    } finally {
      await holder?.release();
      await pool.end();
      await admin.end();
    }
  }, 15000);

  it("TC-DB-FOUNDATION-013 REL-DB-011 REL-TMO-003 lock_timeout is per lock while the 5s retry budget runs from the first attempt", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const admin = new Pool({ connectionString: url, max: 1 });
    const pool = new Pool({ connectionString: url, max: 1 });
    const { logger, events } = collector();
    let holderA: Awaited<ReturnType<typeof holdLock>> | undefined;
    let holderB: Awaited<ReturnType<typeof holdLock>> | undefined;
    try {
      await resetProbe(admin, 2);
      await pool.query("SELECT 1");
      holderA = await holdLock(`SELECT id FROM ${TABLE} WHERE id = 1 FOR UPDATE`);
      holderB = await holdLock(`SELECT id FROM ${TABLE} WHERE id = 2 FOR UPDATE`);
      // Row 1 is freed after ~0.45s, i.e. inside one lock_timeout; row 2 is never freed.
      const releasing = delay(450).then(() => holderA?.release());
      let attempts = 0;
      const attemptMs: number[] = [];
      const started = performance.now();
      await expect(
        transaction(
          pool,
          async (client) => {
            attempts++;
            const began = performance.now();
            try {
              await client.query(`SELECT id FROM ${TABLE} WHERE id = 1 FOR UPDATE`);
              await client.query("SELECT pg_sleep(1.2)");
              await client.query(`SELECT id FROM ${TABLE} WHERE id = 2 FOR UPDATE`);
            } finally {
              attemptMs.push(performance.now() - began);
            }
          },
          { logger, queryName: "foundation.lock_timeout.budget" },
        ),
      ).rejects.toBeInstanceOf(TransactionDeadlineError);
      const elapsed = performance.now() - started;
      await releasing;

      // Attempt 1 = ~0.45s on row 1 + 1.2s sleep + 1s lock_timeout on row 2: a single attempt
      // outlasts lock_timeout, so the 1s limit applies to each lock wait, not to the attempt.
      expect(attemptMs[0]).toBeGreaterThanOrEqual(2400);
      // The retry budget is cumulative from the first attempt's start: the next attempt is cut at 5s.
      expect(attempts).toBeGreaterThanOrEqual(2);
      expect(attempts).toBeLessThanOrEqual(4);
      expect(elapsed).toBeGreaterThanOrEqual(4950);
      expect(elapsed).toBeLessThan(5600);
      // The cut-off connection is destroyed, nothing was changed.
      expect(pool.totalCount).toBe(0);
      expect(await counters(admin)).toEqual([0, 0]);

      const all = events();
      expect(named(all, "reliability.timeout.occurred")).toHaveLength(1);
      expect(named(all, "reliability.retry.exhausted")).toHaveLength(1);
      expect(named(all, "db.transaction.retry_scheduled").length).toBeGreaterThanOrEqual(1);
    } finally {
      await holderA?.release();
      await holderB?.release();
      await pool.end();
      await admin.end();
    }
  }, 15000);

  it("TC-DB-FOUNDATION-014 REL-DB-011 DEV-DB-009 SKIP LOCKED skips a locked row, while a table lock wait is a retried 55P03", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const admin = new Pool({ connectionString: url, max: 1 });
    const pool = new Pool({ connectionString: url, max: 1 });
    let holder: Awaited<ReturnType<typeof holdLock>> | undefined;
    const claim = (client: PoolClient) =>
      client.query(`SELECT id FROM ${TABLE} ORDER BY id FOR UPDATE SKIP LOCKED`);
    try {
      await resetProbe(admin, 2);
      await pool.query("SELECT 1");

      // (a) A row lock is skipped: no wait, no 55P03, no retry.
      holder = await holdLock(`SELECT id FROM ${TABLE} WHERE id = 1 FOR UPDATE`);
      {
        const { logger, events } = collector();
        let attempts = 0;
        const started = performance.now();
        const result = await transaction(
          pool,
          async (client) => {
            attempts++;
            return (await claim(client)).rows.map((row) => row.id as number);
          },
          { logger, queryName: "foundation.skip_locked.row" },
        );
        expect(result).toEqual({ status: "committed", value: [2] });
        expect(attempts).toBe(1);
        expect(performance.now() - started).toBeLessThan(1000);
        expect(named(events(), "db.transaction.retry_scheduled")).toHaveLength(0);
      }
      await holder.release();
      holder = undefined;

      // (b) A table-level lock is not skipped: the wait ends in 55P03 and the transaction is retried.
      holder = await holdLock(`LOCK TABLE ${TABLE} IN ACCESS EXCLUSIVE MODE`);
      const releasing = delay(1500).then(() => holder?.release());
      {
        const { logger, events } = collector();
        let attempts = 0;
        const result = await transaction(
          pool,
          async (client) => {
            attempts++;
            return (await claim(client)).rows.map((row) => row.id as number);
          },
          { logger, queryName: "foundation.skip_locked.table" },
        );
        await releasing;
        expect(result).toEqual({ status: "committed", value: [1, 2] });
        expect(attempts).toBeGreaterThanOrEqual(2);
        const scheduled = named(events(), "db.transaction.retry_scheduled");
        expect(scheduled.length).toBeGreaterThanOrEqual(1);
        expect(scheduled[0]).toMatchObject({ sqlstate: "55P03" });
      }
    } finally {
      await holder?.release();
      await pool.end();
      await admin.end();
    }
  }, 15000);
});
