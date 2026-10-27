import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  checkReadiness,
  computeMigrationSetHash,
  createDatabase,
  createPrincipalRepository,
  runMigrations,
  transaction,
  withWorkerAdvisoryLock,
} from "../../packages/db/src/index.ts";
import { startCommitAcknowledgementDropProxy } from "../harness/db/commit-proxy.ts";
import { installSyntheticDirectory, prepareFoundationDatabase } from "../harness/db/foundation.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url || !process.env.TEST_DATABASE_CA)
  throw new Error("Real PG17 requires TEST_DATABASE_URL and TEST_DATABASE_CA");
const runtimeUrl = new URL(url);
runtimeUrl.username = "app_api_runtime";
runtimeUrl.password = "";
describe("PostgreSQL 17 foundation (real database)", () => {
  it("TC-DB-FOUNDATION-001 migration is hashed, repeatable, constrained and lossless", async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      expect(
        Math.floor(
          Number((await client.query("SHOW server_version_num")).rows[0].server_version_num) /
            10000,
        ),
      ).toBe(17);
      await prepareFoundationDatabase(client);
      await client.query("SET ROLE app_migrator");
      await runMigrations(client);
      await client.query("RESET ROLE");
      await client.query("BEGIN");
      const row = (
        await client.query(
          "INSERT INTO app.business_profiles(id,auth_subject) OVERRIDING SYSTEM VALUE VALUES (9007199254740993, '00000000-0000-4000-8000-000000000001') RETURNING id",
        )
      ).rows[0];
      expect(row.id).toBe("9007199254740993");
      await client.query("ROLLBACK");
      expect((await client.query("SELECT count(*) FROM app.schema_migrations")).rows[0].count).toBe(
        "1",
      );
      const sql = await readFile(
        new URL("../../packages/db/migrations/0001_foundation.sql", import.meta.url),
        "utf8",
      );
      expect(sql).not.toContain("CREATE TABLE app.orders");
    } finally {
      await client.end();
    }
  });

  it("TC-DB-FOUNDATION-002 runtime cannot delete or create and GET lookup never provisions", async () => {
    const pool = new Pool({ connectionString: url, max: 2 });
    const client = await pool.connect();
    try {
      await client.query("SET ROLE app_api_runtime");
      expect(
        (
          await client.query(
            "SELECT has_table_privilege(current_user,'app.business_profiles','DELETE') AS allowed",
          )
        ).rows[0].allowed,
      ).toBe(false);
      expect(
        (await client.query("SELECT has_schema_privilege(current_user,'app','CREATE') AS allowed"))
          .rows[0].allowed,
      ).toBe(false);
      await expect(
        client.query("DELETE FROM app.business_profiles WHERE false"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        client.query("CREATE TABLE app.forbidden_runtime_ddl(id int)"),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("RESET ROLE");
      const directoryExists = (
        await client.query("SELECT to_regclass('auth_read.identity_directory') AS relation")
      ).rows[0].relation;
      const lookup = createPrincipalRepository(pool).findByAuthSubject(
        "00000000-0000-4000-8000-000000000002",
      );
      // Missing deployment directory errors; an installed directory returns absence.
      if (directoryExists) expect((await lookup).profile).toBeNull();
      else await expect(lookup).rejects.toThrow();
      expect((await client.query("SELECT count(*) FROM app.business_profiles")).rows[0].count).toBe(
        "0",
      );
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("TC-DB-FOUNDATION-003 transaction rolls back and worker session lock excludes peers", async () => {
    const pool = new Pool({ connectionString: url, max: 3 });
    try {
      await expect(
        transaction(pool, async (client) => {
          await client.query(
            "INSERT INTO app.business_profiles(auth_subject) VALUES ('00000000-0000-4000-8000-000000000003')",
          );
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");
      expect((await pool.query("SELECT count(*) FROM app.business_profiles")).rows[0].count).toBe(
        "0",
      );
      const first = await withWorkerAdvisoryLock(pool, "foundation-test", async () => {
        const second = await withWorkerAdvisoryLock(pool, "foundation-test", async () => "wrong");
        expect(second.acquired).toBe(false);
        return "held";
      });
      expect(first).toEqual({ acquired: true, value: "held" });
    } finally {
      await pool.end();
    }
  });

  it("TC-DB-FOUNDATION-004 read-only directory projects only confirmed columns", async () => {
    const client = new Client({ connectionString: url });
    const pool = new Pool({ connectionString: url });
    await client.connect();
    try {
      await installSyntheticDirectory(client);
      await client.query(
        "INSERT INTO synthetic_provider.identities(subject,current_email,verified) VALUES ('00000000-0000-4000-8000-000000000004','synthetic@example.test',true) ON CONFLICT DO NOTHING",
      );
      const result = await createPrincipalRepository(pool).findByAuthSubject(
        "00000000-0000-4000-8000-000000000004",
      );
      expect(result).toEqual({
        profile: null,
        roles: [],
        directory: {
          authSubject: "00000000-0000-4000-8000-000000000004",
          email: "synthetic@example.test",
          emailVerified: true,
        },
      });
      expect(
        (
          await client.query(
            "SELECT has_column_privilege('app_api_runtime','synthetic_provider.identities','password_hash','SELECT') AS allowed",
          )
        ).rows[0].allowed,
      ).toBe(false);
      await client.query("SET ROLE app_api_runtime");
      expect(
        (await client.query("SELECT count(*) FROM auth_read.identity_directory")).rows[0].count,
      ).toBe("1");
      await expect(
        client.query("SELECT password_hash FROM synthetic_provider.identities"),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("RESET ROLE");
    } finally {
      await client.end();
      await pool.end();
    }
  });

  it("TC-DB-FOUNDATION-005 real SQLSTATE retries are bounded and lock timeout is not retried", async () => {
    const pool = new Pool({ connectionString: url });
    try {
      for (const code of ["40001", "40P01", "55P03", "23505"]) {
        let attempts = 0;
        await expect(
          transaction(pool, async (client) => {
            attempts++;
            await client.query(
              `DO $$ BEGIN RAISE EXCEPTION 'synthetic conflict' USING ERRCODE = '${code}'; END $$`,
            );
          }),
        ).rejects.toMatchObject({ code });
        expect(attempts).toBe(code === "40001" || code === "40P01" ? 4 : 1);
      }
    } finally {
      await pool.end();
    }
  });

  it("TC-DB-FOUNDATION-006 runtime verifies TLS hostname, UTC and fail-closed readiness", async () => {
    const ca = await readFile(process.env.TEST_DATABASE_CA as string, "utf8");
    const database = createDatabase({
      connectionString: runtimeUrl.toString(),
      environment: "test",
      service: "api",
      ca,
    });
    const pool = database.pool;
    try {
      expect(
        (await pool.query("SELECT current_user AS role, current_setting('TimeZone') AS timezone"))
          .rows[0],
      ).toEqual({ role: "app_api_runtime", timezone: "UTC" });
      await pool.query("SET r39x.environment = 'test-database'");
      expect(
        (await pool.query("SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()")).rows[0].ssl,
      ).toBe(true);
      const ready = await checkReadiness(pool, {
        migrationSetHash: await computeMigrationSetHash(),
        environment: "test",
        expectedEnvironmentMarker: "test-database",
        environmentMarkerSetting: "r39x.environment",
        directoryMapping: {
          deploymentConfirmed: true,
          providerSchemaVersion: "synthetic-test-v1",
          schema: "synthetic_provider",
          table: "identities",
          subjectColumn: "subject",
          emailColumn: "current_email",
          verifiedColumn: "verified",
        },
      });
      expect(ready).toEqual({ ready: true, failures: [] });
      const base = {
        environment: "test",
        expectedEnvironmentMarker: "test-database",
        environmentMarkerSetting: "r39x.environment",
      };
      expect((await checkReadiness(pool, base)).failures).toContain(
        "release_migration_hash_missing",
      );
      expect(
        (await checkReadiness(pool, { ...base, migrationSetHash: "0".repeat(64) })).failures,
      ).toContain("release_migration_hash");
      expect(
        (
          await checkReadiness(pool, {
            environment: "test",
            expectedEnvironmentMarker: "test-database",
            environmentMarkerSetting: "r39x.environment",
          })
        ).ready,
      ).toBe(false);
    } finally {
      await pool.end();
    }
    const mismatch = new URL(runtimeUrl);
    mismatch.hostname = "127.1"; // Resolves to loopback, absent from fixture certificate SAN.
    const invalid = createDatabase({
      connectionString: mismatch.toString(),
      environment: "test",
      service: "api",
      ca,
    });
    try {
      await expect(invalid.pool.query("SELECT 1")).rejects.toMatchObject({
        code: "ERR_TLS_CERT_ALTNAME_INVALID",
      });
    } finally {
      await invalid.close();
    }
  });

  it("TC-DB-FOUNDATION-007 lost COMMIT acknowledgement is unknown, committed once, discarded", async () => {
    const proxy = await startCommitAcknowledgementDropProxy(new URL(url as string));
    const pool = new Pool({ connectionString: proxy.url, ssl: false, max: 1 });
    const direct = new Pool({ connectionString: url });
    let attempts = 0;
    const subject = "00000000-0000-4000-8000-000000000007";
    try {
      await direct.query("DELETE FROM app.business_profiles WHERE auth_subject=$1", [subject]);
      const result = await transaction(pool, async (client) => {
        attempts++;
        await client.query("INSERT INTO app.business_profiles(auth_subject) VALUES ($1)", [
          subject,
        ]);
      });
      expect(result).toEqual({ status: "commit_unknown" });
      expect(proxy.didDrop()).toBe(true);
      expect(attempts).toBe(1);
      expect(pool.totalCount).toBe(0);
      expect(
        (
          await direct.query("SELECT count(*) FROM app.business_profiles WHERE auth_subject=$1", [
            subject,
          ])
        ).rows[0].count,
      ).toBe("1");
    } finally {
      await direct.query("DELETE FROM app.business_profiles WHERE auth_subject=$1", [subject]);
      await pool.end();
      await direct.end();
      await proxy.close();
    }
  });

  it("TC-DB-FOUNDATION-008 wall deadline discards connection and rolls back", async () => {
    const pool = new Pool({ connectionString: url, max: 1 });
    const names: string[] = [];
    let finish: (() => void) | undefined;
    try {
      await expect(
        transaction(
          pool,
          async (client) => {
            await client.query(
              "INSERT INTO app.business_profiles(auth_subject) VALUES ('00000000-0000-4000-8000-000000000008')",
            );
            await new Promise<void>((resolve) => {
              finish = resolve;
            });
          },
          {
            logger: {
              log: (event) => {
                names.push(event.event_name);
              },
            },
          },
        ),
      ).rejects.toThrow("deadline exceeded");
      expect(pool.totalCount).toBe(0);
      expect(names).toContain("reliability.timeout.occurred");
      expect(names).not.toContain("db.availability.failed");
      expect(
        (
          await pool.query(
            "SELECT count(*) FROM app.business_profiles WHERE auth_subject='00000000-0000-4000-8000-000000000008'",
          )
        ).rows[0].count,
      ).toBe("0");
    } finally {
      finish?.();
      await pool.end();
    }
  }, 12000);

  it("TC-DB-FOUNDATION-009 named unique FK check and active-role constraints reject writes", async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query("BEGIN");
      const profile = (
        await client.query(
          "INSERT INTO app.business_profiles(auth_subject) VALUES ('00000000-0000-4000-8000-000000000009') RETURNING id",
        )
      ).rows[0].id;
      const negative = async (sql: string, values: unknown[], code: string, constraint: string) => {
        await client.query("SAVEPOINT negative");
        await expect(client.query(sql, values)).rejects.toMatchObject({ code, constraint });
        await client.query("ROLLBACK TO SAVEPOINT negative");
      };
      await negative(
        "INSERT INTO app.business_profiles(auth_subject) VALUES ('00000000-0000-4000-8000-000000000009')",
        [],
        "23505",
        "uq_business_profiles_auth_subject",
      );
      await negative(
        "UPDATE app.business_profiles SET display_name='' WHERE id=$1",
        [profile],
        "23514",
        "ck_business_profiles_display_name",
      );
      await negative(
        "INSERT INTO app.role_assignments(profile_id,role,state) VALUES (-1,'STAFF','ACTIVE')",
        [],
        "23503",
        "fk_role_assignments_profile",
      );
      await negative(
        "INSERT INTO app.role_assignments(profile_id,role,state) VALUES ($1,'CUSTOMER','ACTIVE')",
        [profile],
        "23514",
        "ck_role_assignments_role",
      );
      await negative(
        "INSERT INTO app.role_assignments(profile_id,role,state) VALUES ($1,'STAFF','REVOKED')",
        [profile],
        "23514",
        "ck_role_assignments_revocation",
      );
      await client.query(
        "INSERT INTO app.role_assignments(profile_id,role,state) VALUES ($1,'STAFF','ACTIVE')",
        [profile],
      );
      await negative(
        "INSERT INTO app.role_assignments(profile_id,role,state) VALUES ($1,'STAFF','ACTIVE')",
        [profile],
        "23505",
        "ux_role_assignments_profile_role_active",
      );
      await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
  });

  it("TC-DB-FOUNDATION-010 retry elapsed budgets bound the next callback and prevent late commit", async () => {
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      for (const [code, budget, subject] of [
        ["40001", 2000, "00000000-0000-4000-8000-000000000010"],
        ["40P01", 3000, "00000000-0000-4000-8000-000000000011"],
      ] as const) {
        let attempts = 0;
        let callbackFinished: Promise<void> | undefined;
        const started = performance.now();
        try {
          await expect(
            transaction(pool, async (client) => {
              attempts++;
              if (attempts === 1)
                await client.query(
                  `DO $$ BEGIN RAISE EXCEPTION 'synthetic retry' USING ERRCODE='${code}'; END $$`,
                );
              await client.query("INSERT INTO app.business_profiles(auth_subject) VALUES ($1)", [
                subject,
              ]);
              callbackFinished = delay(budget + 250);
              await callbackFinished;
            }),
          ).rejects.toThrow("deadline exceeded");
          expect(performance.now() - started).toBeLessThan(budget + 1000);
          expect(attempts).toBe(2);
          expect(pool.totalCount).toBe(0);
          await callbackFinished;
          expect(
            (
              await pool.query("SELECT count(*) FROM app.business_profiles WHERE auth_subject=$1", [
                subject,
              ])
            ).rows[0].count,
          ).toBe("0");
        } finally {
          await pool.query("DELETE FROM app.business_profiles WHERE auth_subject=$1", [subject]);
        }
      }
    } finally {
      await pool.end();
    }
  }, 15000);
});
