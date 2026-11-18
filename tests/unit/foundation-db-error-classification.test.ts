import type { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { resolveConstraintViolation } from "../../apps/api/src/api/services/constraint-violation.ts";
import type { ServiceResult } from "../../apps/api/src/api/services/result.ts";
import {
  classifyDatabaseError,
  DatabaseUnavailableError,
  TransactionDeadlineError,
  transaction,
} from "../../packages/db/src/index.ts";
import { createLogger } from "../../packages/observability/src/index.ts";
import { createFakePool, syntheticSqlstateError } from "../harness/db/fake-pool.ts";

// PR-S0-3a C1. These tests drive the classification LOGIC with synthetic error objects and a fake
// pool. They are not evidence of what PostgreSQL returns for a UNIQUE / EXCLUDE / FK / CHECK
// violation or of a real pool-acquisition timeout (TST-UNT-001, TST-GEN-004): that is
// tests/db/foundation-db-error-classification.test.ts against a real PG17.

const MARKER = "synthetic-private-marker";
type Rows = { readonly name: string };

function pgError(code: string, constraint?: unknown): Error {
  return Object.assign(new Error(MARKER), {
    code,
    ...(constraint === undefined ? {} : { constraint }),
    detail: "Key (id)=(9007199254740993) already exists.",
    table: "synthetic_table",
    schema: "app",
  });
}
const SUCCESS: ServiceResult<Rows> = { kind: "success", status: 200, data: { name: "existing" } };
const REJECTED: ServiceResult<Rows> = { kind: "rejected", code: "SLOT_UNAVAILABLE" };

describe("TC-DEV-API-010-001 classifyDatabaseError", () => {
  it.each(["40001", "40P01", "55P03"])("%s is retryable and keeps its SQLSTATE", (code) => {
    expect(classifyDatabaseError(syntheticSqlstateError(code))).toEqual({
      kind: "retryable",
      sqlstate: code,
    });
  });

  it("a transaction deadline is deadline", () => {
    expect(classifyDatabaseError(new TransactionDeadlineError())).toEqual({ kind: "deadline" });
  });

  it.each([
    "08000",
    "08001",
    "08006",
    "57P01",
    "57P02",
    "57P03",
    "ECONNRESET",
    "ECONNREFUSED",
    "EPIPE",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EHOSTUNREACH",
    "ENETUNREACH",
  ])("%s is unavailable", (code) => {
    expect(classifyDatabaseError(syntheticSqlstateError(code))).toEqual({ kind: "unavailable" });
  });

  it("DatabaseUnavailableError is unavailable", () => {
    expect(
      classifyDatabaseError(new DatabaseUnavailableError({ cause: new Error(MARKER) })),
    ).toEqual({
      kind: "unavailable",
    });
  });

  it("57014 is statement_timeout", () => {
    expect(classifyDatabaseError(syntheticSqlstateError("57014"))).toEqual({
      kind: "statement_timeout",
    });
  });

  it.each(["23505", "23P01", "23503", "23514"])(
    "%s is a constraint carrying the constraint name only when it is a string",
    (code) => {
      expect(classifyDatabaseError(pgError(code, "uq_known"))).toEqual({
        kind: "constraint",
        sqlstate: code,
        constraint: "uq_known",
      });
      for (const unnamed of [undefined, 42, null, { name: "uq_known" }]) {
        const result = classifyDatabaseError(pgError(code, unnamed));
        expect(result).toMatchObject({ kind: "constraint", sqlstate: code });
        expect((result as { constraint?: unknown }).constraint).toBeUndefined();
      }
    },
  );

  it.each([
    ["a plain Error", new Error(MARKER)],
    ["another SQLSTATE", syntheticSqlstateError("42P01")],
    ["not_null_violation (not one of the four known classes)", syntheticSqlstateError("23502")],
    ["a string", MARKER],
    ["null", null],
    ["undefined", undefined],
    ["a number", 5],
  ])("%s is other", (_label, error) => {
    expect(classifyDatabaseError(error)).toEqual({ kind: "other" });
  });
});

describe("TC-DEV-API-010-001 resolveConstraintViolation", () => {
  function table(sqlstate: "23505" | "23P01" | "23503" | "23514", result = SUCCESS) {
    const resolve = vi.fn(async () => result);
    return { resolve, table: { uq_known: { sqlstate, resolve } } };
  }

  it("a known constraint calls resolve once and returns its result unchanged (success)", async () => {
    const { resolve, table: known } = table("23505", SUCCESS);
    await expect(resolveConstraintViolation(pgError("23505", "uq_known"), known)).resolves.toBe(
      SUCCESS,
    );
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("a known constraint returns a known conflict result unchanged (rejected)", async () => {
    const { resolve, table: known } = table("23P01", REJECTED);
    await expect(resolveConstraintViolation(pgError("23P01", "uq_known"), known)).resolves.toBe(
      REJECTED,
    );
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it.each(["23505", "23P01", "23503", "23514"] as const)(
    "%s with a registered name and matching SQLSTATE calls resolve once",
    async (code) => {
      const { resolve, table: known } = table(code);
      await expect(resolveConstraintViolation(pgError(code, "uq_known"), known)).resolves.toBe(
        SUCCESS,
      );
      expect(resolve).toHaveBeenCalledTimes(1);
    },
  );

  it("rethrows the same error when the name is registered under a different SQLSTATE", async () => {
    const { resolve, table: known } = table("23514");
    const error = pgError("23505", "uq_known");
    await expect(resolveConstraintViolation(error, known)).rejects.toBe(error);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rethrows the same error when the name is not in the table or is missing", async () => {
    const { resolve, table: known } = table("23505");
    const unknown = pgError("23505", "uq_unknown");
    const unnamed = pgError("23505");
    await expect(resolveConstraintViolation(unknown, known)).rejects.toBe(unknown);
    await expect(resolveConstraintViolation(unnamed, known)).rejects.toBe(unnamed);
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([
    ["40001", pgError("40001", "uq_known")],
    ["55P03", pgError("55P03", "uq_known")],
    ["08006", pgError("08006", "uq_known")],
    ["ECONNRESET", pgError("ECONNRESET", "uq_known")],
    ["57014", pgError("57014", "uq_known")],
    ["a plain Error", new Error(MARKER)],
    ["a deadline", new TransactionDeadlineError()],
    ["DatabaseUnavailableError", new DatabaseUnavailableError({ cause: new Error(MARKER) })],
  ])("does not classify %s: it is rethrown and resolve is not called", async (_label, error) => {
    const { resolve, table: known } = table("23505");
    await expect(resolveConstraintViolation(error, known)).rejects.toBe(error);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("propagates an exception thrown by resolve", async () => {
    const failure = new Error("synthetic-resolve-failure");
    const resolve = vi.fn(async (): Promise<ServiceResult<Rows>> => {
      throw failure;
    });
    await expect(
      resolveConstraintViolation(pgError("23505", "uq_known"), {
        uq_known: { sqlstate: "23505", resolve },
      }),
    ).rejects.toBe(failure);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("never re-runs the original operation: the table's resolve is the only callback", async () => {
    // The helper takes the error and the table only. Calling it twice with the same known violation
    // calls resolve once per call and nothing else; there is no operation to retry.
    const { resolve, table: known } = table("23505");
    await resolveConstraintViolation(pgError("23505", "uq_known"), known);
    await resolveConstraintViolation(pgError("23505", "uq_known"), known);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});

describe("TC-REL-DB-009-001 transaction() types a codeless connection failure", () => {
  const PROBE = "SELECT synthetic_probe";
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
      count: (name: string) =>
        lines.filter((line) => (JSON.parse(line) as Event).event_name === name).length,
    };
  }
  async function settle<T>(promise: Promise<T>): Promise<unknown> {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error("expected the transaction to reject");
  }

  it("(a) a rejected pool connect() is a DatabaseUnavailableError with the original cause, callback not run", async () => {
    const cause = new Error(MARKER);
    const fake = createFakePool(undefined, {
      connect: (attempt) => (attempt === 0 ? cause : undefined),
    });
    const { logger, count } = collector();
    let calls = 0;
    const error = await settle(
      transaction(
        fake.pool,
        async () => {
          calls++;
        },
        { logger, queryName: "unavailable.connect" },
      ),
    );
    expect(error).toBeInstanceOf(DatabaseUnavailableError);
    expect((error as DatabaseUnavailableError).cause).toBe(cause);
    expect((error as Error).message).not.toContain(MARKER);
    expect(calls).toBe(0);
    expect(fake.connectAttempts()).toBe(1);
    expect(count("db.availability.failed")).toBe(1);
    expect(count("db.transaction.retry_scheduled")).toBe(0);
  });

  it("(b) a codeless query failure on a discarded connection is a DatabaseUnavailableError", async () => {
    const cause = new Error(MARKER);
    const fake = createFakePool();
    const { logger, count } = collector();
    let calls = 0;
    const error = await settle(
      transaction(
        fake.pool,
        async (client) => {
          calls++;
          // The connection reports a transport failure (the client's error event), then the
          // in-flight query fails without any SQLSTATE or errno.
          (client as unknown as EventEmitter).emit(
            "error",
            new Error("synthetic-connection-error"),
          );
          await client.query(PROBE);
          throw cause;
        },
        { logger, queryName: "unavailable.discarded" },
      ),
    );
    expect(error).toBeInstanceOf(DatabaseUnavailableError);
    expect((error as DatabaseUnavailableError).cause).toBe(cause);
    expect(calls).toBe(1);
    expect(fake.clients[0]?.releases).toEqual([true]);
    expect(count("db.availability.failed")).toBe(1);
    expect(count("db.transaction.retry_scheduled")).toBe(0);
  });

  it("(c) an error that carries a connection SQLSTATE is rethrown as it is, not typed", async () => {
    const fake = createFakePool(({ sql }) =>
      sql === PROBE ? syntheticSqlstateError("08006", MARKER) : undefined,
    );
    const { logger, count } = collector();
    const error = await settle(
      transaction(
        fake.pool,
        async (client) => {
          await client.query(PROBE);
        },
        { logger, queryName: "unavailable.coded" },
      ),
    );
    expect(error).not.toBeInstanceOf(DatabaseUnavailableError);
    expect(error).toMatchObject({ code: "08006" });
    expect(count("db.availability.failed")).toBe(1);
    expect(count("db.transaction.retry_scheduled")).toBe(0);
  });

  it("(d) a codeless error from a healthy connection is the callback's own error, not typed", async () => {
    const fake = createFakePool();
    const { logger, count } = collector();
    const original = new Error("synthetic-abort");
    const error = await settle(
      transaction(
        fake.pool,
        async () => {
          throw original;
        },
        { logger, queryName: "unavailable.application" },
      ),
    );
    expect(error).toBe(original);
    expect(count("db.availability.failed")).toBe(0);
    expect(fake.clients[0]?.queries).toContain("ROLLBACK");
  });

  it("DatabaseUnavailableError has a fixed message, a name, and the original as cause", () => {
    const cause = new Error(MARKER);
    const error = new DatabaseUnavailableError({ cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).not.toBe("Error");
    expect(error.name).not.toBe("");
    expect(error.cause).toBe(cause);
    expect(error.message).not.toContain(MARKER);
  });
});
