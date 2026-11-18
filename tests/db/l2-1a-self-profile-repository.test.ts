// PR-L2-1a C1 (TC-API-007-005, G3): readCurrentBusinessProfile / updateCurrentBusinessProfile of
// createCurrentProfileRepository (@off-r39x/db) on a real PostgreSQL 17 as the runtime role
// app_api_runtime (verified TLS, own database per file). Constraints, privileges and timestamps are never
// proven by a fake (TST-GEN-004, DEV-TST-003). Needs TEST_DATABASE_URL and TEST_DATABASE_CA; it fails (it
// does not skip) without them. Synthetic data only.
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCurrentProfileRepository, createDatabase } from "../../packages/db/src/index.ts";
import { installSyntheticDirectory, prepareFoundationDatabase } from "../harness/db/foundation.ts";

const url = process.env.TEST_DATABASE_URL;
const caPath = process.env.TEST_DATABASE_CA;
if (!url || !caPath) throw new Error("Real PG17 requires TEST_DATABASE_URL and TEST_DATABASE_CA");

const SUBJECT_A = "00000000-0000-4000-8000-0000000000a1";
const SUBJECT_B = "00000000-0000-4000-8000-0000000000a2";
const SUBJECT_UNKNOWN = "00000000-0000-4000-8000-0000000000a9";
const REF_A = "00000000-0000-4000-8000-0000000000b1";
const REF_B = "00000000-0000-4000-8000-0000000000b2";
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const KA = "が";

let admin: Client;
let runtime: ReturnType<typeof createDatabase>;
let repo: ReturnType<typeof createCurrentProfileRepository>;

beforeAll(async () => {
  admin = new Client({ connectionString: url });
  await admin.connect();
  await prepareFoundationDatabase(admin);
  await installSyntheticDirectory(admin);
  const runtimeUrl = new URL(url as string);
  runtimeUrl.username = "app_api_runtime";
  runtimeUrl.password = "";
  runtimeUrl.search = "";
  runtime = createDatabase({
    connectionString: runtimeUrl.href,
    environment: "test",
    service: "api",
    ca: await readFile(caPath as string, "utf8"),
  });
  repo = createCurrentProfileRepository(runtime.pool);
});
afterAll(async () => {
  await runtime?.close();
  await admin?.end();
});

/** Fixtures: A has a NULL display name and a microsecond updated_at; B has a name. Re-created per test. */
async function resetRows(): Promise<void> {
  await admin.query("DELETE FROM app.role_assignments");
  await admin.query("DELETE FROM app.business_profiles");
  await admin.query(
    `INSERT INTO app.business_profiles(public_ref, auth_subject, display_name, created_at, updated_at) VALUES
       ($1, $2, NULL, '2026-01-01 00:00:00+00', '2026-01-02 03:04:05.678912+00'),
       ($3, $4, 'other-synthetic', '2026-01-01 00:00:00+00', '2026-01-02 03:04:06.100000+00')`,
    [REF_A, SUBJECT_A, REF_B, SUBJECT_B],
  );
}
const rowJson = async (subject: string): Promise<Record<string, unknown> | undefined> =>
  (
    await admin.query(
      "SELECT to_jsonb(p) AS j FROM app.business_profiles p WHERE auth_subject = $1",
      [subject],
    )
  ).rows[0]?.j;
const rowCount = async (): Promise<number> =>
  (await admin.query("SELECT count(*)::int AS n FROM app.business_profiles")).rows[0].n;

describe("TC-API-007-005 readCurrentBusinessProfile (API-AUTH-002, DB-ID-002, SPEC-100 §14.1, SPEC-110 §10)", () => {
  it("reads the verified subject's row, keeps a NULL display name as null and truncates updated_at to milliseconds", async () => {
    await resetRows();
    const before = {
      a: await rowJson(SUBJECT_A),
      b: await rowJson(SUBJECT_B),
      n: await rowCount(),
    };
    const result = await repo.readCurrentBusinessProfile(SUBJECT_A);
    expect(result).toEqual({
      status: "found",
      profile: { publicRef: REF_A, displayName: null, updatedAt: "2026-01-02T03:04:05.678Z" },
    });
    if (result.status === "found") expect(result.profile.updatedAt).toMatch(ISO_MS);
    // A read writes nothing.
    expect({
      a: await rowJson(SUBJECT_A),
      b: await rowJson(SUBJECT_B),
      n: await rowCount(),
    }).toEqual(before);
  });

  it("returns the other row for the other subject and not_found for an unknown subject", async () => {
    await resetRows();
    expect(await repo.readCurrentBusinessProfile(SUBJECT_B)).toEqual({
      status: "found",
      profile: {
        publicRef: REF_B,
        displayName: "other-synthetic",
        updatedAt: "2026-01-02T03:04:06.100Z",
      },
    });
    expect(await repo.readCurrentBusinessProfile(SUBJECT_UNKNOWN)).toEqual({ status: "not_found" });
    expect(await rowCount()).toBe(2);
  });

  it("refuses a subject that is not a UUID (the verified-subject precondition)", async () => {
    await expect(repo.readCurrentBusinessProfile("not-a-uuid")).rejects.toThrow();
    await expect(repo.updateCurrentBusinessProfile("not-a-uuid", "x")).rejects.toThrow();
  });
});

describe("TC-API-007-005 updateCurrentBusinessProfile (API-AUTH-004, DB-TIM-003, DEV-DB-002/003, AR-OWN-006, DB-ID-002)", () => {
  it("writes display_name and updated_at of the verified subject's row only and returns the RETURNING row", async () => {
    await resetRows();
    const beforeA = await rowJson(SUBJECT_A);
    const beforeB = await rowJson(SUBJECT_B);
    const lower = (await admin.query("SELECT clock_timestamp()::text AS t")).rows[0].t as string;
    const result = await repo.updateCurrentBusinessProfile(SUBJECT_A, "name");
    const upper = (await admin.query("SELECT clock_timestamp()::text AS t")).rows[0].t as string;
    expect(result.status).toBe("updated");
    if (result.status !== "updated") return;
    expect(result.profile.publicRef).toBe(REF_A);
    expect(result.profile.displayName).toBe("name");
    expect(result.profile.updatedAt).toMatch(ISO_MS);
    const afterA = (await rowJson(SUBJECT_A)) as Record<string, unknown>;
    expect(afterA.display_name).toBe("name");
    // DB-TIM-003: the update's transaction_timestamp(), set in the same UPDATE (inside the call window,
    // after the previous value), not a client clock.
    const inWindow = (
      await admin.query(
        `SELECT updated_at >= $1::timestamptz AND updated_at <= $2::timestamptz AS ok,
                updated_at > $3::timestamptz AS newer,
                floor(extract(epoch FROM updated_at) * 1000)::bigint::text AS ms
           FROM app.business_profiles WHERE auth_subject = $4`,
        [lower, upper, "2026-01-02 03:04:05.678912+00", SUBJECT_A],
      )
    ).rows[0];
    expect(inWindow.ok).toBe(true);
    expect(inWindow.newer).toBe(true);
    expect(String(Date.parse(result.profile.updatedAt))).toBe(inWindow.ms);
    // Nothing else of A changes, and B is untouched in every column. No row is added.
    const {
      display_name: _n1,
      updated_at: _u1,
      ...restBefore
    } = beforeA as Record<string, unknown>;
    const { display_name: _n2, updated_at: _u2, ...restAfter } = afterA;
    expect(restAfter).toEqual(restBefore);
    expect(await rowJson(SUBJECT_B)).toEqual(beforeB);
    expect(await rowCount()).toBe(2);
  });

  it("an update with the same value still advances updated_at (OI-4: every UPDATE sets it)", async () => {
    await resetRows();
    const first = await repo.updateCurrentBusinessProfile(SUBJECT_A, "name");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await repo.updateCurrentBusinessProfile(SUBJECT_A, "name");
    expect([first.status, second.status]).toEqual(["updated", "updated"]);
    if (first.status === "updated" && second.status === "updated")
      expect(Date.parse(second.profile.updatedAt)).toBeGreaterThan(
        Date.parse(first.profile.updatedAt),
      );
  });

  it("clears the name with null", async () => {
    await resetRows();
    await repo.updateCurrentBusinessProfile(SUBJECT_B, null);
    const result = await repo.updateCurrentBusinessProfile(SUBJECT_B, null);
    expect(result.status).toBe("updated");
    if (result.status === "updated") expect(result.profile.displayName).toBeNull();
    expect((await rowJson(SUBJECT_B))?.display_name).toBeNull();
    expect((await rowJson(SUBJECT_A))?.display_name).toBeNull();
  });

  it.each([
    ["80 emoji", "\u{1F600}".repeat(80)],
    ["80 code points of combining sequences (not normalized)", KA.repeat(40)],
    ["80 ASCII", "a".repeat(80)],
  ])("stores %s as is, with char_length 80", async (_label, value) => {
    await resetRows();
    const result = await repo.updateCurrentBusinessProfile(SUBJECT_A, value);
    expect(result.status).toBe("updated");
    if (result.status === "updated") expect(result.profile.displayName).toBe(value);
    const stored = (
      await admin.query(
        "SELECT display_name, char_length(display_name) AS n FROM app.business_profiles WHERE auth_subject = $1",
        [SUBJECT_A],
      )
    ).rows[0];
    expect(stored.display_name).toBe(value);
    expect(stored.n).toBe(80);
  });

  it("an unknown subject is not_found and no Profile is provisioned", async () => {
    await resetRows();
    const before = await rowCount();
    expect(await repo.updateCurrentBusinessProfile(SUBJECT_UNKNOWN, "name")).toEqual({
      status: "not_found",
    });
    expect(await rowCount()).toBe(before);
    expect(await rowJson(SUBJECT_UNKNOWN)).toBeUndefined();
  });

  it("the DB CHECK stays the last defence: 81 characters throw SQLSTATE 23514 (never unavailable) and the row is unchanged", async () => {
    for (const value of ["a".repeat(81), "\u{1F600}".repeat(81)]) {
      await resetRows();
      const before = await rowJson(SUBJECT_A);
      await expect(repo.updateCurrentBusinessProfile(SUBJECT_A, value)).rejects.toMatchObject({
        code: "23514",
        constraint: "ck_business_profiles_display_name",
      });
      expect(await rowJson(SUBJECT_A)).toEqual(before);
    }
  });
});

describe("TC-API-007-005 unavailable classification (SPEC-110 §50/§51, FP.DB.BEFORE_TRANSACTION)", () => {
  async function closedPort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
  }

  it("an unreachable database is returned as { status: 'unavailable' } for read and update, not thrown", async () => {
    const pool = new Pool({
      host: "127.0.0.1",
      port: await closedPort(),
      user: "app_api_runtime",
      database: "synthetic",
      connectionTimeoutMillis: 500,
    });
    pool.on("error", () => undefined);
    try {
      const unreachable = createCurrentProfileRepository(pool);
      expect(await unreachable.readCurrentBusinessProfile(SUBJECT_A)).toEqual({
        status: "unavailable",
      });
      expect(await unreachable.updateCurrentBusinessProfile(SUBJECT_A, "name")).toEqual({
        status: "unavailable",
      });
    } finally {
      await pool.end();
    }
  });

  it("a saturated pool (max 1, the only client held) raises a code-less 'timeout exceeded when trying to connect' that is returned as unavailable for read and update", async () => {
    // FP.DB.BEFORE_TRANSACTION via pool exhaustion against the real PG17 (pg-pool raises this without a code).
    const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 200 });
    pool.on("error", () => undefined);
    const held = await pool.connect();
    try {
      const raw = await pool.query("SELECT 1").then(
        () => undefined,
        (error: { code?: unknown; message: string }) => error,
      );
      expect(raw, "the saturated pool must reject").toBeDefined();
      expect(raw?.code).toBeUndefined();
      expect(raw?.message).toMatch(/^timeout exceeded when trying to connect/);

      const saturated = createCurrentProfileRepository(pool);
      expect(await saturated.readCurrentBusinessProfile(SUBJECT_A)).toEqual({
        status: "unavailable",
      });
      expect(await saturated.updateCurrentBusinessProfile(SUBJECT_A, "name")).toEqual({
        status: "unavailable",
      });
    } finally {
      held.release();
      await pool.end();
    }
  });
});
