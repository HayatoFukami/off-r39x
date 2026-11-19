import { performance } from "node:perf_hooks";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";
import { resolveConstraintViolation } from "../../apps/api/src/api/services/constraint-violation.ts";
import type { ServiceResult } from "../../apps/api/src/api/services/result.ts";
import {
  classifyDatabaseError,
  DatabaseUnavailableError,
  transaction,
} from "../../packages/db/src/index.ts";
import { createLogger } from "../../packages/observability/src/index.ts";

// PR-S0-3a C1 (G3, real PostgreSQL 17). Constraint violations, SQLSTATE values, constraint names
// and pool acquisition timeouts are produced by a real server / real pg-pool here (TST-GEN-004,
// TST-DB-004, TST-DB-005); the unit file with synthetic errors proves only the classification
// logic. Each file runs against its own database (harness/db/isolated-database.ts), so the
// synthetic probe tables below are private to this file. The constraint names are SYNTHETIC
// (uq_ / ux_ / ex_ / fk_ / ck_ per SPEC-100 DB-ARC-007); they are not the production registry.
//
// Not executed on the local Windows machine (no disposable PG17); CI (Linux, postgres:17) is the
// evidence.

const url = process.env.TEST_DATABASE_URL;
if (!url || !process.env.TEST_DATABASE_CA)
  throw new Error("Real PG17 requires TEST_DATABASE_URL and TEST_DATABASE_CA");

type Event = Record<string, unknown> & { event_name: string };
function collector() {
  const lines: string[] = [];
  const logger = createLogger(
    { service: "API", environment: "test", actor_type: "SYSTEM_WORKER" },
    (line) => {
      lines.push(line);
    },
  );
  const events = (): Event[] => lines.map((line) => JSON.parse(line) as Event);
  return { logger, count: (name: string) => events().filter((e) => e.event_name === name).length };
}
async function settle(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the transaction to reject");
}

type Existing = { readonly key: string };

describe("TC-DEV-API-010-002 real PostgreSQL constraint violations are classified by SQLSTATE and constraint name", () => {
  const SETUP = `
    CREATE TABLE public.constraint_parent (id int PRIMARY KEY);
    INSERT INTO public.constraint_parent VALUES (1);
    CREATE TABLE public.constraint_probe (
      id int PRIMARY KEY,
      key text NOT NULL,
      slot text NOT NULL,
      active boolean NOT NULL,
      during tstzrange NOT NULL,
      qty int NOT NULL,
      parent int,
      CONSTRAINT uq_constraint_probe_key UNIQUE (key),
      CONSTRAINT ex_constraint_probe_during EXCLUDE USING gist (during WITH &&),
      CONSTRAINT ck_constraint_probe_qty CHECK (qty > 0),
      CONSTRAINT fk_constraint_probe_parent FOREIGN KEY (parent) REFERENCES public.constraint_parent (id)
    );
    CREATE UNIQUE INDEX ux_constraint_probe_active_slot ON public.constraint_probe (slot) WHERE active;
    INSERT INTO public.constraint_probe
      VALUES (1, 'k1', 's1', true, tstzrange('2030-01-01Z', '2030-01-02Z'), 1, 1)`;
  // Each statement violates exactly one constraint of the base row (id 1).
  const VIOLATIONS = {
    unique: `INSERT INTO public.constraint_probe
      VALUES (2, 'k1', 's2', false, tstzrange('2031-01-01Z', '2031-01-02Z'), 1, 1)`,
    partial: `INSERT INTO public.constraint_probe
      VALUES (3, 'k3', 's1', true, tstzrange('2032-01-01Z', '2032-01-02Z'), 1, 1)`,
    exclusion: `INSERT INTO public.constraint_probe
      VALUES (4, 'k4', 's4', false, tstzrange('2030-01-01Z', '2030-01-02Z'), 1, 1)`,
    foreign: `INSERT INTO public.constraint_probe
      VALUES (5, 'k5', 's5', false, tstzrange('2033-01-01Z', '2033-01-02Z'), 1, 999)`,
    check: `INSERT INTO public.constraint_probe
      VALUES (6, 'k6', 's6', false, tstzrange('2034-01-01Z', '2034-01-02Z'), 0, 1)`,
  } as const;
  type Kind = keyof typeof VIOLATIONS;

  it("(a)-(d) known constraints resolve once without retrying; (e) an unregistered CHECK is rethrown; rows are unchanged", async () => {
    const setup = new Client({ connectionString: url });
    await setup.connect();
    try {
      await setup.query(SETUP);
    } finally {
      await setup.end();
    }
    const pool = new Pool({ connectionString: url, max: 3 });
    try {
      const rowCount = async () =>
        Number((await pool.query("SELECT count(*) FROM public.constraint_probe")).rows[0].count);
      const readExisting = async (): Promise<ServiceResult<Existing>> => {
        const result = await transaction(pool, async (client) => {
          const row = (await client.query("SELECT key FROM public.constraint_probe WHERE id = 1"))
            .rows[0] as Existing;
          return { key: row.key };
        });
        if (result.status !== "committed") throw new Error("unexpected commit_unknown");
        return { kind: "success", status: 200, data: result.value };
      };
      const resolved = { unique: 0, partial: 0, exclusion: 0, foreign: 0 };
      const table = {
        uq_constraint_probe_key: {
          sqlstate: "23505",
          resolve: () => {
            resolved.unique++;
            return readExisting();
          },
        },
        ux_constraint_probe_active_slot: {
          sqlstate: "23505",
          resolve: () => {
            resolved.partial++;
            return readExisting();
          },
        },
        ex_constraint_probe_during: {
          sqlstate: "23P01",
          resolve: async (): Promise<ServiceResult<Existing>> => {
            resolved.exclusion++;
            return { kind: "rejected", code: "SLOT_UNAVAILABLE" };
          },
        },
        fk_constraint_probe_parent: {
          sqlstate: "23503",
          resolve: () => {
            resolved.foreign++;
            return readExisting();
          },
        },
        // The CHECK constraint is deliberately not registered.
      } as const;

      expect(await rowCount()).toBe(1);
      const expected: Record<
        Kind,
        { sqlstate: string; constraint: string; loser: number; result?: ServiceResult<Existing> }
      > = {
        unique: {
          sqlstate: "23505",
          constraint: "uq_constraint_probe_key",
          loser: 1,
          result: { kind: "success", status: 200, data: { key: "k1" } },
        },
        partial: {
          sqlstate: "23505",
          constraint: "ux_constraint_probe_active_slot",
          loser: 1,
          result: { kind: "success", status: 200, data: { key: "k1" } },
        },
        exclusion: {
          sqlstate: "23P01",
          constraint: "ex_constraint_probe_during",
          loser: 1,
          result: { kind: "rejected", code: "SLOT_UNAVAILABLE" },
        },
        foreign: {
          sqlstate: "23503",
          constraint: "fk_constraint_probe_parent",
          loser: 0,
          result: { kind: "success", status: 200, data: { key: "k1" } },
        },
        check: { sqlstate: "23514", constraint: "ck_constraint_probe_qty", loser: 0 },
      };

      for (const kind of Object.keys(VIOLATIONS) as Kind[]) {
        const { logger, count } = collector();
        let callbackRuns = 0;
        const error = await settle(
          transaction(
            pool,
            async (client) => {
              callbackRuns++;
              await client.query(VIOLATIONS[kind]);
            },
            { logger, queryName: `constraint.${kind}` },
          ),
        );
        const want = expected[kind];
        // The transaction ran once: a constraint violation is not retried (REL-DB-002).
        expect(callbackRuns, kind).toBe(1);
        expect(classifyDatabaseError(error), kind).toEqual({
          kind: "constraint",
          sqlstate: want.sqlstate,
          constraint: want.constraint,
        });
        // Existing behavior, recorded before classification (S0-3a plan I-1 / UCR-160-001 draft):
        // 23505 / 23P01 are logged as a constraint loser, 23503 / 23514 are not.
        expect(count("db.constraint_loser.completed"), kind).toBe(want.loser);
        expect(count("db.transaction.retry_scheduled"), kind).toBe(0);
        const before = { ...resolved };
        if (want.result) {
          await expect(resolveConstraintViolation(error, table), kind).resolves.toEqual(
            want.result,
          );
          const total = (o: typeof resolved) => o.unique + o.partial + o.exclusion + o.foreign;
          expect(total(resolved) - total(before), kind).toBe(1);
        } else {
          // (e) CHECK is not in the table: the original error comes back unchanged.
          await expect(resolveConstraintViolation(error, table), kind).rejects.toBe(error);
          expect(resolved, kind).toEqual(before);
        }
        // The transaction was rolled back: nothing was inserted.
        expect(await rowCount(), kind).toBe(1);
      }
      expect(resolved).toEqual({ unique: 1, partial: 1, exclusion: 1, foreign: 1 });
    } finally {
      await pool.end();
    }
  });
});

describe("TC-REL-DB-009-003 a real pool acquisition timeout is a DatabaseUnavailableError", () => {
  it("rejects with the typed error, never runs the callback, and recovers once the client is released", async () => {
    const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 200 });
    try {
      const held = await pool.connect();
      const { logger, count } = collector();
      let callbackRuns = 0;
      const started = performance.now();
      let error: unknown;
      try {
        error = await settle(
          transaction(
            pool,
            async () => {
              callbackRuns++;
            },
            { logger, queryName: "unavailable.pool_timeout" },
          ),
        );
      } finally {
        held.release();
      }
      const elapsed = performance.now() - started;
      expect(error).toBeInstanceOf(DatabaseUnavailableError);
      // The cause is pg-pool's own acquisition error, which carries no SQLSTATE or errno.
      const cause = (error as DatabaseUnavailableError).cause;
      expect(cause).toBeInstanceOf(Error);
      expect((cause as { code?: unknown }).code).toBeUndefined();
      expect(callbackRuns).toBe(0);
      expect(count("db.availability.failed")).toBe(1);
      expect(count("db.transaction.retry_scheduled")).toBe(0);
      // The pool waited for its acquisition timeout instead of failing at once. Node's timers run on
      // a millisecond-truncated loop clock, so the 200 ms timer can fire up to 1 ms early as measured
      // by performance.now() (CI observed 199.9 ms); the bound allows exactly that.
      expect(elapsed).toBeGreaterThanOrEqual(199);
      expect(elapsed).toBeLessThan(2000);

      const after = await transaction(pool, async (client) => {
        await client.query("SELECT 1");
        return "recovered";
      });
      expect(after).toEqual({ status: "committed", value: "recovered" });
    } finally {
      await pool.end();
    }
  });
});
