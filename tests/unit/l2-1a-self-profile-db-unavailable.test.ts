// TC-API-007-008 (G1): node-postgres raises some connection failures without a SQLSTATE or Node `code`
// (connection dropped right after connect, connect timeout, use after pool.end). SPEC-110 §50/§51 make
// them temporary: both repository functions must return { status: "unavailable" } and never throw.
// Needs no PostgreSQL: the "database" is a local TCP server that misbehaves (Fault Point
// FP.DB.BEFORE_TRANSACTION). The pool-saturation case needs a real PG and lives in tests/db.
import { createServer, type Server, type Socket } from "node:net";
import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { createCurrentProfileRepository } from "../../packages/db/src/index.ts";
import { createFakePool } from "../harness/db/fake-pool.ts";

const SUBJECT = "00000000-0000-4000-8000-0000000000a1";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function listen(onConnection: (socket: Socket) => void): Promise<number> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
    onConnection(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  return typeof address === "object" && address ? address.port : 0;
}

function poolFor(port: number, connectionTimeoutMillis: number): Pool {
  const pool = new Pool({
    host: "127.0.0.1",
    port,
    user: "synthetic_user",
    database: "synthetic",
    connectionTimeoutMillis,
  });
  pool.on("error", () => undefined);
  return pool;
}

type RawError = { code?: unknown; message: string };
async function rawError(pool: Pool): Promise<RawError> {
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    return error as RawError;
  }
  throw new Error("the pool unexpectedly succeeded");
}

const CASES: [label: string, message: RegExp, setup: () => Promise<Pool>][] = [
  [
    "connection closed by the peer right after connect (FIN; an RST would carry ECONNRESET)",
    /^Connection terminated unexpectedly/,
    async () => poolFor(await listen((socket) => socket.end()), 2000),
  ],
  [
    "a peer that accepts and never answers (connect timeout)",
    /^Connection terminated due to connection timeout/,
    async () => poolFor(await listen(() => undefined), 200),
  ],
  [
    "a pool used after pool.end()",
    /^Cannot use a pool after calling end on the pool/,
    async () => {
      const pool = poolFor(await listen((socket) => socket.end()), 2000);
      await pool.end();
      return pool;
    },
  ],
];

describe("TC-API-007-008 code-less node-postgres connection errors are unavailable (SPEC-110 §50/§51, FP.DB.BEFORE_TRANSACTION)", () => {
  it.each(CASES)(
    "%s: raw error has no code; read and update return unavailable",
    async (_label, message, setup) => {
      const pool = await setup();
      cleanups.push(async () => {
        if (!(pool as unknown as { ended: boolean }).ended) await pool.end().catch(() => undefined);
      });
      // Precondition: this case really exercises the error shape without a SQLSTATE / Node code.
      const raw = await rawError(pool);
      expect(raw.code).toBeUndefined();
      expect(raw.message).toMatch(message);

      const repo = createCurrentProfileRepository(pool);
      expect(await repo.readCurrentBusinessProfile(SUBJECT)).toEqual({ status: "unavailable" });
      expect(await repo.updateCurrentBusinessProfile(SUBJECT, "name")).toEqual({
        status: "unavailable",
      });
    },
  );
});

// PR #66 round 6 (F1 / Issue #69): a failure that carries a code follows the common DB classification
// of the HTTP boundary (classifyDatabaseError / errorFromException) on both paths, so GET and PATCH
// answer the same failure the same way. No DNS, no PostgreSQL: the pool rejects with a synthetic
// error. Read path: pool.query(); update path: the UPDATE inside transaction() (connect, BEGIN and
// SET LOCAL succeed), or pool.connect() itself.
type Coded = Error & { code?: string };
const coded = (code: string | undefined): Coded =>
  Object.assign(new Error("synthetic-db-failure"), code === undefined ? {} : { code });
const CONTROL = /^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)\b/;

/** A pool whose direct query and whose UPDATE (inside transaction()) reject with `failure`. */
function failingPool(failure: () => Error) {
  const fake = createFakePool(({ sql }) =>
    typeof sql === "string" && CONTROL.test(sql) ? undefined : failure(),
  );
  return Object.assign(fake.pool, {
    query: async () => {
      throw failure();
    },
  }) as unknown as Pool;
}
/** A pool whose connect() and direct query reject with `failure` (no connection is obtained). */
function unreachablePool(failure: () => Error) {
  const fake = createFakePool(undefined, { connect: () => failure() });
  return Object.assign(fake.pool, {
    query: async () => {
      throw failure();
    },
  }) as unknown as Pool;
}
async function thrown(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the repository to throw");
}

describe("TC-API-007-008 coded DB failures follow the common classification on read and update (SPEC-110 §50/§51, REL-DB-009, Issue #69)", () => {
  const unavailable: [label: string, code: string | undefined][] = [
    ["EAI_AGAIN (temporary DNS failure)", "EAI_AGAIN"],
    ["ENOTFOUND", "ENOTFOUND"],
    ["ECONNRESET", "ECONNRESET"],
    ["ECONNREFUSED", "ECONNREFUSED"],
    ["a five-letter errno (EBADF)", "EBADF"],
    ["no code at all", undefined],
    ["SQLSTATE 08006 (connection failure)", "08006"],
    ["SQLSTATE 57P01 (admin shutdown)", "57P01"],
    // PR #71 review: connection slots used up; PostgreSQL refuses the new connection.
    ["SQLSTATE 53300 (too many connections)", "53300"],
  ];
  it.each(unavailable)(
    "%s: read and update (query failure) return unavailable",
    async (_label, code) => {
      const repo = createCurrentProfileRepository(failingPool(() => coded(code)));
      expect(await repo.readCurrentBusinessProfile(SUBJECT)).toEqual({ status: "unavailable" });
      expect(await repo.updateCurrentBusinessProfile(SUBJECT, "name")).toEqual({
        status: "unavailable",
      });
    },
  );

  it.each(["EAI_AGAIN", "ECONNREFUSED", "53300", undefined])(
    "a pool that cannot connect (%s) is unavailable for read and update",
    async (code) => {
      const repo = createCurrentProfileRepository(unreachablePool(() => coded(code)));
      expect(await repo.readCurrentBusinessProfile(SUBJECT)).toEqual({ status: "unavailable" });
      expect(await repo.updateCurrentBusinessProfile(SUBJECT, "name")).toEqual({
        status: "unavailable",
      });
    },
  );

  it("SQLSTATE 40001 on the read is unavailable (a retryable failure is never a 500)", async () => {
    const repo = createCurrentProfileRepository(failingPool(() => coded("40001")));
    expect(await repo.readCurrentBusinessProfile(SUBJECT)).toEqual({ status: "unavailable" });
  });

  // The common boundary answers these with 500 INTERNAL_ERROR (statement timeout has no SPEC-110
  // §50/§51 mapping; 53xxx other than 53300 / 58xxx and data or constraint errors are not connection
  // failures), so
  // the repository throws the original error on both paths instead of returning unavailable.
  const thrownCodes: [label: string, code: string][] = [
    ["SQLSTATE 57014 (statement timeout)", "57014"],
    ["SQLSTATE 53200 (out of memory)", "53200"],
    ["SQLSTATE 58030 (I/O error)", "58030"],
    ["SQLSTATE 23514 (check violation)", "23514"],
    ["SQLSTATE 22001 (string data right truncation)", "22001"],
  ];
  it.each(thrownCodes)("%s: read and update throw the original error", async (_label, code) => {
    const repo = createCurrentProfileRepository(failingPool(() => coded(code)));
    const read = await thrown(repo.readCurrentBusinessProfile(SUBJECT));
    expect(read).toMatchObject({ code });
    const update = await thrown(repo.updateCurrentBusinessProfile(SUBJECT, "name"));
    expect(update).toMatchObject({ code });
  });
});
