// PR-L2-1b C1 (TC-DB-AUTH-001-005, G3 and G10 concurrency): parallel provisionCurrentBusinessProfile for one
// Auth Subject converges to one row on a real PostgreSQL 17 (API-AUTH-003, DB-AUTH-001, AR-ID-004,
// REL-AUTH-004; TST-CON-001..003). The race window is made by a barrier, not by a sleep: a setup session
// holds an uncommitted INSERT of the subject's row, N provisions start together, and the test waits until
// PostgreSQL itself reports that N app_api_runtime backends are blocked on that lock (pg_stat_activity
// wait_event_type = 'Lock') before it releases the holder (ROLLBACK or COMMIT). No loser may be an error:
// 23505, unavailable and thrown errors must not appear. N = 2 is the binary race, N = 20 the hot
// contention (SPEC-170 §61). This file runs alone against its own database (one DB per file); its pool is
// sized N + 1 here only (the production pool is not changed). Needs TEST_DATABASE_URL and
// TEST_DATABASE_CA; it fails (it does not skip) without them. Synthetic data only.
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { checkServerIdentity } from "node:tls";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCurrentProfileRepository } from "../../packages/db/src/index.ts";
import { installSyntheticDirectory, prepareFoundationDatabase } from "../harness/db/foundation.ts";

const url = process.env.TEST_DATABASE_URL;
const caPath = process.env.TEST_DATABASE_CA;
if (!url || !caPath) throw new Error("Real PG17 requires TEST_DATABASE_URL and TEST_DATABASE_CA");

const REF_A = "00000000-0000-4000-8000-0000000000b1";
const SUBJECT_A = "00000000-0000-4000-8000-0000000000a1";
/** Poll limit for the barrier: well below lock_timeout (1000 ms), so a blocked backend is not yet retried. */
const BARRIER_MS = 700;

let admin: Client;
let ca: string;
let subjectCounter = 0;
const nextSubject = (): string => {
  subjectCounter += 1;
  return `00000000-0000-4000-8000-${(0xe00 + subjectCounter).toString(16).padStart(12, "0")}`;
};

beforeAll(async () => {
  admin = new Client({ connectionString: url });
  await admin.connect();
  await prepareFoundationDatabase(admin);
  await installSyntheticDirectory(admin);
  ca = await readFile(caPath as string, "utf8");
  await admin.query("DELETE FROM app.role_assignments");
  await admin.query("DELETE FROM app.business_profiles");
  await admin.query(
    "INSERT INTO app.business_profiles(public_ref, auth_subject, display_name) VALUES ($1, $2, 'other-synthetic')",
    [REF_A, SUBJECT_A],
  );
});
afterAll(async () => {
  await admin?.end();
});

/** The runtime role over verified TLS with the options of createDatabase, and `max` connections. */
function runtimePool(max: number): Pool {
  const runtimeUrl = new URL(url as string);
  runtimeUrl.username = "app_api_runtime";
  runtimeUrl.password = "";
  runtimeUrl.search = "";
  const pool = new Pool({
    connectionString: runtimeUrl.href,
    max,
    min: 0,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 30000,
    ssl: {
      rejectUnauthorized: true,
      servername: runtimeUrl.hostname,
      checkServerIdentity,
      ca,
    },
    application_name: "r39x/test/api",
    options:
      "-c timezone=UTC -c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=8000",
  });
  pool.on("error", () => undefined);
  return pool;
}

async function blockedRuntimeBackends(): Promise<number> {
  return (
    await admin.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND usename = 'app_api_runtime'
          AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
    )
  ).rows[0].n;
}
async function untilBlocked(expected: number): Promise<void> {
  const giveUp = performance.now() + BARRIER_MS;
  while (performance.now() < giveUp) {
    if ((await blockedRuntimeBackends()) >= expected) return;
    await delay(5);
  }
  throw new Error(
    `barrier not reached: ${await blockedRuntimeBackends()} of ${expected} backends blocked on the row lock`,
  );
}
const rowsOf = async (subject: string) =>
  (
    await admin.query(
      "SELECT public_ref::text AS public_ref FROM app.business_profiles WHERE auth_subject = $1",
      [subject],
    )
  ).rows as { public_ref: string }[];
const snapshotOthers = async (subject: string) =>
  (
    await admin.query(
      "SELECT to_jsonb(p) AS j FROM app.business_profiles p WHERE auth_subject <> $1 ORDER BY id",
      [subject],
    )
  ).rows.map((r) => r.j as Record<string, unknown>);
const total = async (): Promise<number> =>
  (await admin.query("SELECT count(*)::int AS n FROM app.business_profiles")).rows[0].n;

type Outcome =
  | {
      settled: "value";
      value: Awaited<
        ReturnType<
          ReturnType<typeof createCurrentProfileRepository>["provisionCurrentBusinessProfile"]
        >
      >;
    }
  | { settled: "error"; message: string; code?: unknown };

async function race(n: number, release: "ROLLBACK" | "COMMIT") {
  const subject = nextSubject();
  const pool = runtimePool(n + 1);
  const holder = new Client({ connectionString: url });
  try {
    // Warm every connection first so no provision waits for a TLS handshake inside the race window.
    const warm = await Promise.all(Array.from({ length: n }, () => pool.connect()));
    for (const client of warm) client.release();
    const repo = createCurrentProfileRepository(pool);
    const totalBefore = await total();
    const othersBefore = await snapshotOthers(subject);

    await holder.connect();
    await holder.query("BEGIN");
    const holderRow = (
      await holder.query(
        "INSERT INTO app.business_profiles(auth_subject) VALUES ($1) RETURNING public_ref::text AS public_ref",
        [subject],
      )
    ).rows[0].public_ref as string;

    const calls: Promise<Outcome>[] = Array.from({ length: n }, () =>
      repo.provisionCurrentBusinessProfile(subject).then(
        (value): Outcome => ({ settled: "value", value }),
        (error: { message?: string; code?: unknown }): Outcome => ({
          settled: "error",
          message: String(error?.message),
          code: error?.code,
        }),
      ),
    );
    await untilBlocked(n);
    await holder.query(release);
    const outcomes = await Promise.all(calls);
    return { subject, holderRow, outcomes, totalBefore, othersBefore };
  } finally {
    await holder.end().catch(() => undefined);
    await pool.end();
  }
}

describe("TC-DB-AUTH-001-005 parallel provisions of one Auth Subject converge to one row (DB-AUTH-001, REL-AUTH-004, TST-CON-001..003)", () => {
  for (const n of [2, 20])
    describe(`${n} parallel provisions`, () => {
      it("the holder rolls back: exactly one created, the rest existing, all with the same public_ref, no error", async () => {
        const r = await race(n, "ROLLBACK");
        expect(r.outcomes.filter((o) => o.settled === "error")).toEqual([]);
        const values = r.outcomes.flatMap((o) => (o.settled === "value" ? [o.value] : []));
        expect(values.filter((v) => v.status === "created")).toHaveLength(1);
        expect(values.filter((v) => v.status === "existing")).toHaveLength(n - 1);
        expect(
          values.filter((v) => v.status === "unavailable" || v.status === "commit_unknown"),
        ).toEqual([]);
        const refs = new Set(values.map((v) => ("profile" in v ? v.profile.publicRef : "")));
        expect(refs.size).toBe(1);
        const rows = await rowsOf(r.subject);
        expect(rows).toHaveLength(1);
        expect(refs.has(rows[0]?.public_ref ?? "")).toBe(true);
        // The rolled-back holder's row was never visible: its public_ref is not the winner's.
        expect(rows[0]?.public_ref).not.toBe(r.holderRow);
        expect(await total()).toBe(r.totalBefore + 1);
        expect(await snapshotOthers(r.subject)).toEqual(r.othersBefore);
      }, 30000);

      it("the holder commits: no created, all existing with the holder's public_ref, no error", async () => {
        const r = await race(n, "COMMIT");
        expect(r.outcomes.filter((o) => o.settled === "error")).toEqual([]);
        const values = r.outcomes.flatMap((o) => (o.settled === "value" ? [o.value] : []));
        expect(values).toHaveLength(n);
        for (const v of values) {
          expect(v.status).toBe("existing");
          if (v.status === "existing") expect(v.profile.publicRef).toBe(r.holderRow);
        }
        const rows = await rowsOf(r.subject);
        expect(rows).toEqual([{ public_ref: r.holderRow }]);
        expect(await total()).toBe(r.totalBefore + 1);
        expect(await snapshotOthers(r.subject)).toEqual(r.othersBefore);
      }, 30000);
    });
});
