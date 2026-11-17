import type { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionDeadlineError, transaction } from "../../packages/db/src/index.ts";
import { createLogger } from "../../packages/observability/src/index.ts";
import {
  createFakePool,
  type FakePool,
  type FakeQueryBehavior,
  syntheticSqlstateError,
} from "../harness/db/fake-pool.ts";

// These tests drive transaction() with a fake pool. They prove the retry loop's control flow
// (attempt count, ROLLBACK before release, a new connection per attempt, the same callback
// re-run, events). They do NOT prove lock semantics or PostgreSQL behavior: that is
// tests/db/foundation-lock-timeout.test.ts against a real PG17 (TST-DB-001).

const PROBE = "SELECT synthetic_probe";
const QUERY_NAME = "retry.lock_timeout_probe";
const PRIVATE_MESSAGE = "synthetic-private-message";

type Event = Record<string, unknown> & { event_name: string };

function collector() {
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
    events: (): Event[] => lines.map((line) => JSON.parse(line) as Event),
  };
}
function named(events: Event[], name: string): Event[] {
  return events.filter((event) => event.event_name === name);
}
/** The callback issues one probe query; `failProbe` decides which clients fail it and with what. */
function probeFailures(
  failProbe: (client: number) => string | undefined,
  rollbackFails = false,
): { behavior: FakeQueryBehavior; thrown: Error[] } {
  const thrown: Error[] = [];
  return {
    thrown,
    behavior: ({ client, sql }) => {
      if (sql === "ROLLBACK" && rollbackFails) return syntheticSqlstateError("08006");
      if (sql !== PROBE) return undefined;
      const code = failProbe(client);
      if (!code) return undefined;
      const error = syntheticSqlstateError(code, PRIVATE_MESSAGE);
      thrown.push(error);
      return error;
    },
  };
}
function run(fake: FakePool, logger: ReturnType<typeof createLogger>) {
  let calls = 0;
  const result = transaction(
    fake.pool,
    async (client) => {
      calls++;
      await client.query(PROBE);
      return "business-effect";
    },
    { logger, queryName: QUERY_NAME },
  );
  return { result, calls: () => calls };
}
function historyOf(fake: FakePool, client: number): string[] {
  return fake.timeline.flatMap((entry) => {
    if (entry.client !== client) return [];
    if (entry.kind === "query") return [entry.sql.split(" ").slice(0, 2).join(" ")];
    return [entry.kind === "release" ? `release(${entry.destroy})` : "connect"];
  });
}

beforeEach(() => {
  // retryDelay reads Math.random at call time. 0 makes every full-jitter backoff 0 (DEV-TST-005).
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("transaction retry with a fake pool (control flow only)", () => {
  it("TC-DB-RETRY-001 REL-DB-011 55P03 is rolled back, released and re-run as a new transaction", async () => {
    const { behavior } = probeFailures((client) => (client < 3 ? "55P03" : undefined));
    const fake = createFakePool(behavior);
    const { logger, events } = collector();
    const { result, calls } = run(fake, logger);

    expect(await result).toEqual({ status: "committed", value: "business-effect" });
    // Same callback, same input, four times; one retry layer only (REL-DB-003, DEV-REL-008, TST-REL-002).
    expect(calls()).toBe(4);
    expect(fake.clients).toHaveLength(4);
    for (const index of [0, 1, 2]) {
      // BEGIN, SET LOCAL, the callback's query, then an explicit ROLLBACK; the client is then
      // returned to the pool without destroy and never used again.
      expect(historyOf(fake, index)).toEqual([
        "connect",
        "BEGIN ISOLATION",
        "SET LOCAL",
        "SELECT synthetic_probe",
        "ROLLBACK",
        "release(false)",
      ]);
      expect(fake.clients[index]?.queries.some((sql) => sql === "COMMIT")).toBe(false);
      expect(fake.clients[index]?.releases).toEqual([false]);
    }
    // The next attempt must not connect before the failed one went back to the pool.
    for (const index of [0, 1, 2]) {
      const released = fake.timeline.findIndex(
        (entry) => entry.client === index && entry.kind === "release",
      );
      const nextConnect = fake.timeline.findIndex(
        (entry) => entry.client === index + 1 && entry.kind === "connect",
      );
      expect(released).toBeGreaterThan(-1);
      expect(nextConnect).toBeGreaterThan(released);
    }
    // Only the successful attempt commits.
    expect(historyOf(fake, 3)).toEqual([
      "connect",
      "BEGIN ISOLATION",
      "SET LOCAL",
      "SELECT synthetic_probe",
      "COMMIT",
      "release(false)",
    ]);

    const all = events();
    const scheduled = named(all, "db.transaction.retry_scheduled");
    expect(scheduled).toHaveLength(3);
    expect(scheduled.map((event) => event.attempt_number)).toEqual([2, 3, 4]);
    for (const event of scheduled) {
      expect(event).toMatchObject({
        sqlstate: "55P03",
        failure_class: "TEMPORARY_FAILURE",
        is_retry: true,
        query_name: QUERY_NAME,
      });
    }
    const completed = named(all, "db.transaction.completed");
    const failed = completed.filter((event) => event.result === "FAILED");
    expect(failed).toHaveLength(3);
    for (const event of failed)
      expect(event).toMatchObject({ sqlstate: "55P03", failure_class: "TEMPORARY_FAILURE" });
    const succeeded = completed.filter((event) => event.result === "SUCCESS");
    expect(succeeded).toHaveLength(1);
    expect(succeeded[0]).toMatchObject({ attempt_number: 4, failure_class: "SUCCESS" });
    // A lock timeout is a transaction-level conflict, not a statement timeout or a constraint loser.
    expect(named(all, "reliability.timeout.occurred")).toHaveLength(0);
    expect(named(all, "db.constraint_loser.completed")).toHaveLength(0);
    expect(named(all, "db.availability.failed")).toHaveLength(0);
    expect(named(all, "reliability.retry.exhausted")).toHaveLength(0);
  });

  it("TC-DB-RETRY-002 REL-DB-011 OBS-DB-003 an exhausted retry budget returns the original error and records exhaustion", async () => {
    for (const code of ["40001", "40P01", "55P03"]) {
      const { behavior, thrown } = probeFailures(() => code);
      const fake = createFakePool(behavior);
      const { logger, lines, events } = collector();
      const { result, calls } = run(fake, logger);

      const caught = await result.then(
        () => undefined,
        (error: unknown) => error,
      );
      // The original error of the last attempt, SQLSTATE preserved; never wrapped or converted.
      expect(caught).toBe(thrown.at(-1));
      expect(caught).toMatchObject({ code });
      expect(thrown).toHaveLength(4);
      expect(calls()).toBe(4);
      expect(fake.clients).toHaveLength(4);
      for (const client of fake.clients) {
        expect(client.queries.at(-1)).toBe("ROLLBACK");
        expect(client.releases).toEqual([false]);
      }

      const all = events();
      expect(named(all, "db.transaction.retry_scheduled")).toHaveLength(3);
      const exhausted = named(all, "reliability.retry.exhausted");
      expect(exhausted).toHaveLength(1);
      expect(exhausted[0]).toMatchObject({
        level: "ERROR",
        result: "FAILED",
        failure_class: "TEMPORARY_FAILURE",
        attempt_number: 4,
        sqlstate: code,
        query_name: QUERY_NAME,
      });
      expect(typeof exhausted[0]?.duration_ms).toBe("number");
      // Exhaustion is neither a statement timeout, a conflict loser nor "DB unavailable" (OBS-DB-003).
      expect(named(all, "reliability.timeout.occurred")).toHaveLength(0);
      expect(named(all, "db.constraint_loser.completed")).toHaveLength(0);
      expect(named(all, "db.availability.failed")).toHaveLength(0);
      expect(all.some((event) => event.failure_class === "CONFLICT_LOSER")).toBe(false);
      expect(
        named(all, "db.transaction.completed").filter((event) => event.sqlstate === code),
      ).toHaveLength(4);
      // OBS-DB-001/002: the raw error message never reaches the log.
      expect(lines.join("\n")).not.toContain(PRIVATE_MESSAGE);
    }
  });

  it("TC-DB-RETRY-003 REL-DB-002 REL-DB-010 constraint, statement-timeout and failed-ROLLBACK cases are not retried", async () => {
    for (const code of ["23505", "23P01"]) {
      const { behavior } = probeFailures(() => code);
      const fake = createFakePool(behavior);
      const { logger, events } = collector();
      const { result, calls } = run(fake, logger);
      await expect(result).rejects.toMatchObject({ code });
      expect(calls()).toBe(1);
      expect(fake.clients).toHaveLength(1);
      const all = events();
      expect(named(all, "db.transaction.retry_scheduled")).toHaveLength(0);
      expect(named(all, "reliability.retry.exhausted")).toHaveLength(0);
      expect(named(all, "db.constraint_loser.completed")).toEqual([
        expect.objectContaining({
          result: "REJECTED",
          failure_class: "CONFLICT_LOSER",
          sqlstate: code,
        }),
      ]);
    }
    {
      // Statement timeout (57014) stays a timeout, one attempt.
      const { behavior } = probeFailures(() => "57014");
      const fake = createFakePool(behavior);
      const { logger, events } = collector();
      const { result, calls } = run(fake, logger);
      await expect(result).rejects.toMatchObject({ code: "57014" });
      expect(calls()).toBe(1);
      const all = events();
      expect(named(all, "reliability.timeout.occurred")).toHaveLength(1);
      expect(named(all, "db.transaction.retry_scheduled")).toHaveLength(0);
      expect(named(all, "reliability.retry.exhausted")).toHaveLength(0);
    }
    {
      // 55P03 followed by a failing ROLLBACK: the connection is destroyed and nothing is retried.
      const { behavior } = probeFailures((client) => (client === 0 ? "55P03" : undefined), true);
      const fake = createFakePool(behavior);
      const { logger, events } = collector();
      const { result, calls } = run(fake, logger);
      await expect(result).rejects.toMatchObject({ code: "55P03" });
      expect(calls()).toBe(1);
      expect(fake.clients).toHaveLength(1);
      expect(fake.clients[0]?.releases).toEqual([true]);
      const all = events();
      expect(named(all, "db.transaction.retry_scheduled")).toHaveLength(0);
      // Budget was not exhausted; the retry was abandoned for a different reason (O-7).
      expect(named(all, "reliability.retry.exhausted")).toHaveLength(0);
    }
  });

  it("TC-DB-RETRY-004 REL-DB-011 OBS-DB-003 REL-TMO-003 the elapsed retry budget records exhaustion, the first 8s deadline does not", async () => {
    const T0 = 1_000_000;
    let now = T0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const advanceTo = (elapsed: number) => {
      now = T0 + elapsed;
    };

    {
      // (i) The first attempt's own 8s wall deadline: a timeout, but not a retry exhaustion.
      now = T0;
      const fake = createFakePool();
      const { logger, events } = collector();
      let calls = 0;
      const result = transaction(
        fake.pool,
        async (client) => {
          calls++;
          advanceTo(8100);
          await client.query(PROBE);
        },
        { logger, queryName: QUERY_NAME },
      );
      await expect(result).rejects.toBeInstanceOf(TransactionDeadlineError);
      expect(calls).toBe(1);
      const all = events();
      expect(named(all, "reliability.timeout.occurred")).toHaveLength(1);
      expect(named(all, "reliability.retry.exhausted")).toHaveLength(0);
    }
    {
      // (ii) A retry attempt that runs past 5s from the first attempt's start (55P03 budget):
      // the deadline error is returned, and both events are recorded.
      now = T0;
      const { behavior } = probeFailures((client) => (client === 0 ? "55P03" : undefined));
      const fake = createFakePool(behavior);
      const { logger, events } = collector();
      let calls = 0;
      const result = transaction(
        fake.pool,
        async (client) => {
          calls++;
          if (calls === 2) advanceTo(5100);
          await client.query(PROBE);
        },
        { logger, queryName: QUERY_NAME },
      );
      await expect(result).rejects.toBeInstanceOf(TransactionDeadlineError);
      expect(calls).toBe(2);
      const all = events();
      expect(named(all, "db.transaction.retry_scheduled")).toHaveLength(1);
      expect(named(all, "reliability.timeout.occurred")).toHaveLength(1);
      const exhausted = named(all, "reliability.retry.exhausted");
      expect(exhausted).toHaveLength(1);
      expect(exhausted[0]).toMatchObject({
        level: "ERROR",
        result: "FAILED",
        failure_class: "TEMPORARY_FAILURE",
        attempt_number: 2,
      });
    }
    {
      // (iii) Not enough budget left for the next backoff: the original 55P03 is returned at once
      // (REL-DB-011 "would exceed the maximum elapsed time"), without scheduling a retry.
      now = T0;
      vi.mocked(Math.random).mockReturnValue(0.99); // delay = 0.99 * 50ms
      const { behavior, thrown } = probeFailures(() => "55P03");
      const fake = createFakePool(behavior);
      const { logger, events } = collector();
      let calls = 0;
      const result = transaction(
        fake.pool,
        async (client) => {
          calls++;
          advanceTo(4980);
          await client.query(PROBE);
        },
        { logger, queryName: QUERY_NAME },
      );
      const caught = await result.then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(caught).toBe(thrown[0]);
      expect(caught).toMatchObject({ code: "55P03" });
      expect(calls).toBe(1);
      expect(fake.clients).toHaveLength(1);
      const all = events();
      expect(named(all, "db.transaction.retry_scheduled")).toHaveLength(0);
      expect(named(all, "reliability.timeout.occurred")).toHaveLength(0);
      const exhausted = named(all, "reliability.retry.exhausted");
      expect(exhausted).toHaveLength(1);
      expect(exhausted[0]).toMatchObject({ attempt_number: 1, sqlstate: "55P03" });
    }
    {
      // (iv) A retry attempt that is abandoned because its connection ended, well inside the
      // budget, is not a budget exhaustion: the deadline was not reached.
      now = T0;
      const { behavior } = probeFailures((client) => (client === 0 ? "55P03" : undefined));
      const fake = createFakePool(behavior);
      const { logger, events } = collector();
      let calls = 0;
      const result = transaction(
        fake.pool,
        async (client) => {
          calls++;
          await client.query(PROBE);
          if (calls === 2) (client as unknown as EventEmitter).emit("end");
        },
        { logger, queryName: QUERY_NAME },
      );
      await expect(result).rejects.toBeInstanceOf(TransactionDeadlineError);
      expect(calls).toBe(2);
      const all = events();
      expect(named(all, "db.transaction.retry_scheduled")).toHaveLength(1);
      expect(named(all, "reliability.retry.exhausted")).toHaveLength(0);
    }
  });

  it("TC-DB-RETRY-005 REL-DB-011 OBS-DB-003 a deadline timer that fires just before the budget deadline still records the exhaustion", async () => {
    // Node truncates fractional timer delays, so the timer can fire a fraction of a millisecond
    // before the monotonic deadline. The deadline must be re-checked, not trusted (OBS-DB-003).
    const T0 = 2_000_000;
    let now = T0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { behavior } = probeFailures((client) => (client === 0 ? "55P03" : undefined));
      const fake = createFakePool(behavior);
      const { logger, events } = collector();
      let calls = 0;
      const result = transaction(
        fake.pool,
        async (client) => {
          calls++;
          if (calls === 1) {
            now = T0 + 4900; // attempt 2 starts with 100ms of the 5s budget left
            await client.query(PROBE);
            return;
          }
          now = T0 + 4999.5; // 0.5ms short of the deadline when the timer first fires
          await new Promise<never>(() => {});
        },
        { logger, queryName: QUERY_NAME },
      );
      const settled = result.then(
        () => undefined,
        (error: unknown) => error,
      );
      while (calls < 2) await new Promise((resolve) => setImmediate(resolve));
      await vi.advanceTimersByTimeAsync(100); // the timer fires before the deadline
      now = T0 + 5000.5;
      await vi.advanceTimersByTimeAsync(1); // the re-armed timer reaches the deadline
      expect(await settled).toBeInstanceOf(TransactionDeadlineError);
      const all = events();
      expect(named(all, "reliability.timeout.occurred")).toHaveLength(1);
      expect(named(all, "reliability.retry.exhausted")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("TC-DB-RETRY-006 REL-DB-011 OBS-DB-003 a retry budget reached while ROLLBACK is in flight is recorded once, an in-budget ROLLBACK is not", async () => {
    // The deadline timer can fire while the failed attempt's ROLLBACK is awaited. The caught error
    // is then still the original SQLSTATE error, not a TransactionDeadlineError, but the shortened
    // retry budget was reached, so the exhaustion must be recorded exactly once (OBS-DB-003).
    const T0 = 3_000_000;
    let now = T0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      for (const budgetReached of [true, false]) {
        now = T0;
        const { behavior } = probeFailures((client) => (client <= 1 ? "55P03" : undefined));
        const fake = createFakePool(behavior);
        // Hold the ROLLBACK of the second attempt (client 1) until the test releases it.
        let releaseRollback: () => void = () => {};
        let rollbackStarted: () => void = () => {};
        const started = new Promise<void>((resolve) => {
          rollbackStarted = resolve;
        });
        const connect = fake.pool.connect.bind(fake.pool);
        let connects = 0;
        // biome-ignore lint/suspicious/noExplicitAny: test-only wrapper around the fake client
        (fake.pool as any).connect = async () => {
          const client = await connect();
          const index = connects++;
          const query = client.query.bind(client);
          // biome-ignore lint/suspicious/noExplicitAny: test-only wrapper around the fake client
          (client as any).query = async (sql: string) => {
            if (index === 1 && sql === "ROLLBACK") {
              rollbackStarted();
              await new Promise<void>((resolve) => {
                releaseRollback = resolve;
              });
            }
            // biome-ignore lint/suspicious/noExplicitAny: forwards to the fake client
            return (query as any)(sql);
          };
          return client;
        };
        const { logger, events } = collector();
        let calls = 0;
        const result = transaction(
          fake.pool,
          async (client) => {
            calls++;
            if (calls === 1) now = T0 + 4900; // attempt 2 starts with 100ms of the 5s budget left
            await client.query(PROBE);
            return "business-effect";
          },
          { logger, queryName: QUERY_NAME },
        );
        const settled = result.then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
        await started; // attempt 2 failed with 55P03 and its ROLLBACK is pending
        if (budgetReached) {
          now = T0 + 5000.5; // past the shortened budget deadline
          await vi.advanceTimersByTimeAsync(100); // the deadline timer fires during ROLLBACK
        }
        releaseRollback();
        const outcome = await settled;
        const all = events();
        if (budgetReached) {
          expect(outcome).toMatchObject({ error: { code: "55P03" } });
          expect(named(all, "reliability.retry.exhausted")).toHaveLength(1);
          expect(named(all, "reliability.retry.exhausted")[0]).toMatchObject({
            sqlstate: "55P03",
            attempt_number: 2,
          });
        } else {
          // ROLLBACK finished inside the budget: attempt 3 runs and commits, nothing is exhausted.
          expect(outcome).toEqual({ value: { status: "committed", value: "business-effect" } });
          expect(named(all, "reliability.retry.exhausted")).toHaveLength(0);
        }
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
