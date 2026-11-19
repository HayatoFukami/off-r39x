// PR-L2-1b C1 (TC-DB-AUTH-001-004, G3): provisionCurrentBusinessProfile of createCurrentProfileRepository
// (@off-r39x/db) on a real PostgreSQL 17 as the runtime role app_api_runtime (verified TLS, own database
// per file): INSERT ... ON CONFLICT (auth_subject) DO NOTHING, then a select of the same Auth Subject
// (API-AUTH-003, DB-AUTH-001, AR-ID-004, AR-ID-005, REL-AUTH-005). Constraints, privileges and timestamps
// are never proven by a fake (TST-GEN-004, DEV-TST-003). Needs TEST_DATABASE_URL and TEST_DATABASE_CA; it
// fails (it does not skip) without them. Synthetic data only.
import { readFile } from "node:fs/promises";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCurrentProfileRepository, createDatabase } from "../../packages/db/src/index.ts";
import { installSyntheticDirectory, prepareFoundationDatabase } from "../harness/db/foundation.ts";

const url = process.env.TEST_DATABASE_URL;
const caPath = process.env.TEST_DATABASE_CA;
if (!url || !caPath) throw new Error("Real PG17 requires TEST_DATABASE_URL and TEST_DATABASE_CA");

const SUBJECT_NEW = "00000000-0000-4000-8000-0000000000d1";
const SUBJECT_A = "00000000-0000-4000-8000-0000000000a1";
const SUBJECT_B = "00000000-0000-4000-8000-0000000000a2";
const SUBJECT_ROLE = "00000000-0000-4000-8000-0000000000a5";
const REF_A = "00000000-0000-4000-8000-0000000000b1";
const REF_B = "00000000-0000-4000-8000-0000000000b2";
const REF_ROLE = "00000000-0000-4000-8000-0000000000b5";
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let admin: Client;
let runtime: ReturnType<typeof createDatabase>;
let repo: ReturnType<typeof createCurrentProfileRepository>;
let runtimeUrl: URL;
let ca: string;

beforeAll(async () => {
  admin = new Client({ connectionString: url });
  await admin.connect();
  await prepareFoundationDatabase(admin);
  await installSyntheticDirectory(admin);
  runtimeUrl = new URL(url as string);
  runtimeUrl.username = "app_api_runtime";
  runtimeUrl.password = "";
  runtimeUrl.search = "";
  ca = await readFile(caPath as string, "utf8");
  runtime = createDatabase({
    connectionString: runtimeUrl.href,
    environment: "test",
    service: "api",
    ca,
  });
  repo = createCurrentProfileRepository(runtime.pool);
});
afterAll(async () => {
  await runtime?.close();
  await admin?.end();
});

/** A has a NULL name and a microsecond updated_at, B has a name, ROLE has an ACTIVE Staff role. */
async function resetRows(): Promise<void> {
  await admin.query("DELETE FROM app.role_assignments");
  await admin.query("DELETE FROM app.business_profiles");
  await admin.query(
    `INSERT INTO app.business_profiles(public_ref, auth_subject, display_name, created_at, updated_at) VALUES
       ($1, $2, NULL, '2026-01-01 00:00:00+00', '2026-01-02 03:04:05.678912+00'),
       ($3, $4, 'other-synthetic', '2026-01-01 00:00:00+00', '2026-01-02 03:04:06.100000+00'),
       ($5, $6, NULL, '2026-01-01 00:00:00+00', '2026-01-02 03:04:07.000000+00')`,
    [REF_A, SUBJECT_A, REF_B, SUBJECT_B, REF_ROLE, SUBJECT_ROLE],
  );
}
const snapshot = async () =>
  (await admin.query("SELECT to_jsonb(p) AS j FROM app.business_profiles p ORDER BY id")).rows.map(
    (row) => row.j as Record<string, unknown>,
  );
const rowOf = async (subject: string) =>
  (
    await admin.query(
      "SELECT to_jsonb(p) AS j FROM app.business_profiles p WHERE auth_subject = $1",
      [subject],
    )
  ).rows[0]?.j as Record<string, unknown> | undefined;
const rowCount = async (): Promise<number> =>
  (await admin.query("SELECT count(*)::int AS n FROM app.business_profiles")).rows[0].n;
const roleCount = async (): Promise<number> =>
  (await admin.query("SELECT count(*)::int AS n FROM app.role_assignments")).rows[0].n;

describe("TC-DB-AUTH-001-004 provisionCurrentBusinessProfile (API-AUTH-003, DB-AUTH-001, AR-ID-004, SPEC-030 §9.2, SPEC-100 §14.1)", () => {
  it("creates the row of a subject that has none: created, display_name NULL, DB defaults, nothing else changes", async () => {
    await resetRows();
    const before = await snapshot();
    const lower = (await admin.query("SELECT clock_timestamp()::text AS t")).rows[0].t as string;
    const result = await repo.provisionCurrentBusinessProfile(SUBJECT_NEW);
    const upper = (await admin.query("SELECT clock_timestamp()::text AS t")).rows[0].t as string;
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.profile.displayName).toBeNull();
    expect(result.profile.publicRef).toMatch(LOWER_UUID);
    expect(result.profile.updatedAt).toMatch(ISO_MS);

    const row = (await rowOf(SUBJECT_NEW)) as Record<string, unknown>;
    expect(row.auth_subject).toBe(SUBJECT_NEW);
    expect(row.display_name).toBeNull();
    expect(row.public_ref).toBe(result.profile.publicRef);
    const times = (
      await admin.query(
        `SELECT created_at = updated_at AS same,
                created_at >= $1::timestamptz AND created_at <= $2::timestamptz AS in_window,
                floor(extract(epoch FROM updated_at) * 1000)::bigint::text AS ms
           FROM app.business_profiles WHERE auth_subject = $3`,
        [lower, upper, SUBJECT_NEW],
      )
    ).rows[0];
    expect(times.same).toBe(true);
    expect(times.in_window).toBe(true);
    expect(String(Date.parse(result.profile.updatedAt))).toBe(times.ms);
    expect(await rowCount()).toBe(before.length + 1);
    const others = (await snapshot()).filter((r) => r.auth_subject !== SUBJECT_NEW);
    expect(others).toEqual(before);
    expect(await roleCount()).toBe(0);
  });

  it("the second call is existing with the same public_ref; every column, updated_at included, and the row count are unchanged", async () => {
    await resetRows();
    const first = await repo.provisionCurrentBusinessProfile(SUBJECT_NEW);
    const afterFirst = await snapshot();
    const second = await repo.provisionCurrentBusinessProfile(SUBJECT_NEW);
    expect(first.status).toBe("created");
    expect(second.status).toBe("existing");
    if (first.status === "created" && second.status === "existing")
      expect(second.profile).toEqual(first.profile);
    expect(await snapshot()).toEqual(afterFirst);
  });

  it("an existing row (a name, an old updated_at) is returned as is and left unchanged", async () => {
    await resetRows();
    const before = await snapshot();
    expect(await repo.provisionCurrentBusinessProfile(SUBJECT_B)).toEqual({
      status: "existing",
      profile: {
        publicRef: REF_B,
        displayName: "other-synthetic",
        updatedAt: "2026-01-02T03:04:06.100Z",
      },
    });
    expect(await repo.provisionCurrentBusinessProfile(SUBJECT_A)).toEqual({
      status: "existing",
      profile: { publicRef: REF_A, displayName: null, updatedAt: "2026-01-02T03:04:05.678Z" },
    });
    expect(await snapshot()).toEqual(before);
  });

  it("a Profile that holds a Role is existing and its role_assignments are unchanged", async () => {
    await resetRows();
    await admin.query(
      `INSERT INTO app.role_assignments(profile_id, role, state)
         SELECT id, 'STAFF', 'ACTIVE' FROM app.business_profiles WHERE auth_subject = $1`,
      [SUBJECT_ROLE],
    );
    const roles = (await admin.query("SELECT to_jsonb(r) AS j FROM app.role_assignments r")).rows;
    const before = await snapshot();
    const result = await repo.provisionCurrentBusinessProfile(SUBJECT_ROLE);
    expect(result.status).toBe("existing");
    expect(await snapshot()).toEqual(before);
    expect((await admin.query("SELECT to_jsonb(r) AS j FROM app.role_assignments r")).rows).toEqual(
      roles,
    );
  });

  it("never looks a Profile up by anything but the Auth Subject: a new subject gets a new row (AR-ID-005)", async () => {
    await resetRows();
    const result = await repo.provisionCurrentBusinessProfile(SUBJECT_NEW);
    expect(result.status).toBe("created");
    if (result.status === "created")
      expect([REF_A, REF_B, REF_ROLE]).not.toContain(result.profile.publicRef);
  });

  it("refuses a subject that is not a UUID (the verified-subject precondition) without touching the database", async () => {
    await resetRows();
    const before = await snapshot();
    await expect(repo.provisionCurrentBusinessProfile("not-a-uuid")).rejects.toThrow();
    await expect(repo.provisionCurrentBusinessProfile("")).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });
});

describe("TC-DB-AUTH-001-004 unavailable classification (SPEC-110 §50/§51, REL-AUTH-005, FP.DB.BEFORE_TRANSACTION)", () => {
  it("a saturated pool (max 1, the only client held) is returned as unavailable and creates nothing", async () => {
    await resetRows();
    const before = await snapshot();
    const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 200 });
    pool.on("error", () => undefined);
    const held = await pool.connect();
    try {
      const saturated = createCurrentProfileRepository(pool);
      expect(await saturated.provisionCurrentBusinessProfile(SUBJECT_NEW)).toEqual({
        status: "unavailable",
      });
    } finally {
      held.release();
      await pool.end();
    }
    expect(await snapshot()).toEqual(before);
  });

  it("a closed pool is returned as unavailable, not thrown", async () => {
    const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 200 });
    pool.on("error", () => undefined);
    await pool.end();
    expect(
      await createCurrentProfileRepository(pool).provisionCurrentBusinessProfile(SUBJECT_NEW),
    ).toEqual({
      status: "unavailable",
    });
  });

  it("a lock wait that outlasts the 55P03 retry budget is unavailable, and after the holder rolls back there is no partial row", async () => {
    await resetRows();
    const before = await snapshot();
    const holder = new Client({ connectionString: url });
    await holder.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("INSERT INTO app.business_profiles(auth_subject) VALUES ($1)", [
        SUBJECT_NEW,
      ]);
      expect(await repo.provisionCurrentBusinessProfile(SUBJECT_NEW)).toEqual({
        status: "unavailable",
      });
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      await holder.end();
    }
    expect(await rowOf(SUBJECT_NEW)).toBeUndefined();
    expect(await snapshot()).toEqual(before);
  }, 30000);
});
