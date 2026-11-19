// PR-L2-1b C1. TC-DB-AUTH-001-008 (G1): node-postgres raises some connection failures without a SQLSTATE or
// Node `code` (connection dropped right after connect, connect timeout, use after pool.end). SPEC-110
// §50/§51 make them temporary: provisionCurrentBusinessProfile must return { status: "unavailable" } and
// never throw (API-AUTH-003, REL-AUTH-005). Needs no PostgreSQL: the "database" is a local TCP server
// that misbehaves (Fault Point FP.DB.BEFORE_TRANSACTION), as in TC-API-007-008. An errno such as
// EAI_AGAIN is not raised here; transaction() types it as DatabaseUnavailableError, which this path
// treats as unavailable. Issue #69 (EAI_AGAIN answered 500) remains on the read path outside transaction().
import { createServer, type Server, type Socket } from "node:net";
import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { createCurrentProfileRepository } from "../../packages/db/src/index.ts";
import { observeDatabase } from "../../packages/db/src/observability.ts";
import { createLogger } from "../../packages/observability/src/index.ts";
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
    "connection closed by the peer right after connect",
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

describe("TC-DB-AUTH-001-008 code-less node-postgres connection errors are unavailable for provision (SPEC-110 §50/§51, REL-AUTH-005, FP.DB.BEFORE_TRANSACTION)", () => {
  it.each(CASES)(
    "%s: raw error has no code; provision returns unavailable",
    async (_label, message, setup) => {
      const pool = await setup();
      cleanups.push(async () => {
        if (!(pool as unknown as { ended: boolean }).ended) await pool.end().catch(() => undefined);
      });
      const raw = await rawError(pool);
      expect(raw.code).toBeUndefined();
      expect(raw.message).toMatch(message);

      const repo = createCurrentProfileRepository(pool);
      expect(await repo.provisionCurrentBusinessProfile(SUBJECT)).toEqual({
        status: "unavailable",
      });
    },
  );
});

describe("TC-DB-AUTH-001-008 the transaction is named profile.provision_current in the database log (SPEC-160 §24, FP.DB.BEFORE_TRANSACTION not involved)", () => {
  it("the pool acquire event of provisionCurrentBusinessProfile carries query_name profile.provision_current", async () => {
    // A fake pool answers every statement with no rows: the control flow ends in the (expected) reselect
    // cardinality error, which is not the subject here. Only the observed query_name is asserted.
    const lines: string[] = [];
    const logger = createLogger(
      { service: "API", environment: "test", actor_type: "SYSTEM_WORKER" },
      (line) => {
        lines.push(line);
      },
    );
    const fake = createFakePool();
    observeDatabase(fake.pool, logger);
    await createCurrentProfileRepository(fake.pool)
      .provisionCurrentBusinessProfile(SUBJECT)
      .catch(() => undefined);
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events.length).toBeGreaterThan(0);
    expect(events.map((event) => event.query_name)).toContain("profile.provision_current");
    expect(events.filter((event) => event.query_name !== "profile.provision_current")).toEqual([]);
  });
});
