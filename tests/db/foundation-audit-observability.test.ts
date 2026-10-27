import { Pool } from "pg";
import { expect, it } from "vitest";
import { transaction } from "../../packages/db/src/transaction.ts";
import { createLogger } from "../../packages/observability/src/index.ts";
import { startCommitAcknowledgementDropProxy } from "../harness/db/commit-proxy.ts";

it("TC-OBS-AUDIT-001 real DB retry, constraint, unavailability and unknown COMMIT emit distinct safe events", async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Real PG17 required");
  const lines: string[] = [];
  const logger = createLogger(
    { service: "API", environment: "test", actor_type: "SYSTEM_WORKER" },
    (line) => {
      lines.push(line);
    },
  );
  const pool = new Pool({ connectionString: url });
  try {
    for (const code of ["40001", "40P01", "23505", "08006"]) {
      await expect(
        transaction(
          pool,
          async (c) => {
            await c.query(
              `DO $$ BEGIN RAISE EXCEPTION 'synthetic-private-value' USING ERRCODE='${code}'; END $$`,
            );
          },
          { logger, queryName: "foundation.audit" },
        ),
      ).rejects.toMatchObject({ code });
      expect(lines.map((x) => JSON.parse(x))).toContainEqual(
        expect.objectContaining({ sqlstate: code }),
      );
    }
    for (const code of ["ECONNRESET", "EPIPE"]) {
      let attempts = 0;
      await expect(
        transaction(
          pool,
          async () => {
            attempts++;
            throw Object.assign(new Error("synthetic-private-value"), { code });
          },
          { logger, queryName: "foundation.native_transport" },
        ),
      ).rejects.toMatchObject({ code });
      expect(attempts).toBe(1);
    }
    const nativeEvents = lines
      .map((x) => JSON.parse(x))
      .filter((e) => e.query_name === "foundation.native_transport");
    expect(nativeEvents.filter((e) => e.event_name === "db.availability.failed")).toHaveLength(2);
    expect(nativeEvents.every((e) => e.sqlstate === undefined)).toBe(true);
    const proxy = await startCommitAcknowledgementDropProxy(new URL(url));
    const failing = new Pool({ connectionString: proxy.url, ssl: false, max: 1 });
    try {
      expect(
        await transaction(
          failing,
          async (c) => {
            await c.query("SELECT 1");
          },
          { logger, queryName: "foundation.audit" },
        ),
      ).toEqual({ status: "commit_unknown" });
      expect(lines.map((x) => JSON.parse(x))).toContainEqual(
        expect.objectContaining({
          event_name: "reliability.unknown_result.opened",
          failure_class: "UNKNOWN_RESULT",
        }),
      );
    } finally {
      await failing.end();
      await proxy.close();
    }
    expect(lines.join("")).not.toContain("synthetic-private-value");
    expect(lines.join("")).not.toContain(url);
    const events = lines.map((x) => JSON.parse(x));
    expect(events).toContainEqual(
      expect.objectContaining({
        event_name: "db.constraint_loser.completed",
        failure_class: "CONFLICT_LOSER",
        sqlstate: "23505",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event_name: "db.availability.failed",
        failure_class: "TEMPORARY_FAILURE",
        sqlstate: "08006",
      }),
    );
    for (const code of ["40001", "40P01"])
      expect(
        events.filter(
          (x) => x.event_name === "db.transaction.retry_scheduled" && x.sqlstate === code,
        ),
      ).toHaveLength(3);
  } finally {
    await pool.end();
  }
});
