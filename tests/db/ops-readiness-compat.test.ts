import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { LogEvent } from "@off-r39x/observability";
import { Client, Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkReadiness,
  computeMigrationSetHash,
  createDatabase,
  runMigrations,
} from "../../packages/db/src/index.ts";
import { observeDatabase } from "../../packages/db/src/observability.ts";
import { catalogSatisfies, type ReadinessExpectations } from "../../packages/db/src/readiness.ts";
import { catalogQuery, requiredCatalog } from "../../packages/db/src/schema-contract.ts";
import { installSyntheticDirectory, prepareFoundationDatabase } from "../harness/db/foundation.ts";

// SPEC-180 INF-HLT-006 (UCR-180-003): an old build (bundled migration set = the repository set) stays
// Ready after a later backward-compatible expand migration; every other difference stays Not Ready.
// Real PostgreSQL 17 (TST-GEN-004, TST-DB-001): the old build is reproduced by running readiness with
// the current directory on a temporary copy of the repository migration set, so production code has
// no test hook. Each scenario below gets its own database (DDL/COMMIT races must not leak).

const sourceUrl = process.env.TEST_DATABASE_URL;
const caPath = process.env.TEST_DATABASE_CA;
if (!sourceUrl || !caPath)
  throw new Error("Real PG17 requires TEST_DATABASE_URL and TEST_DATABASE_CA");

const original = process.cwd();
const REPO_MIGRATIONS = resolve(original, "../packages/db/migrations");
const COMPAT_EXPAND = resolve(original, "fixtures/migrations/compat-expand.sql");
const EXPAND_SUFFIX = "synthetic_expand";

const READINESS_OPTIONS = "-c timezone=UTC -c lock_timeout=1000";
const REPEATABLE_READ_OPTIONS = `${READINESS_OPTIONS} -c default_transaction_isolation=repeatable\\ read`;

type Migration = { version: string; sql: string };
type Scenario = {
  url: string;
  setup: Client;
  oldRoot: string;
  nextRoot: string;
  repoVersions: string[];
  /** The version a later release gives to the compat-expand fixture (next number after the repository set). */
  expandVersion: string;
  expandSql: string;
  close(): Promise<void>;
};

async function inCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const before = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(before);
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

/** A later release's migration runner: DDL and the journal row in one transaction, as runMigrations does. */
async function commitMigration(scenario: Scenario, migration: Migration): Promise<void> {
  const client = new Client({ connectionString: scenario.url });
  await client.connect();
  try {
    await client.query("SET ROLE app_migrator");
    await client.query("SET lock_timeout = '60s'");
    // TST-DB-002: migration and fixture connections are READ COMMITTED.
    expect((await client.query("SHOW transaction_isolation")).rows[0].transaction_isolation).toBe(
      "read committed",
    );
    await client.query("BEGIN");
    try {
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO app.schema_migrations(version, source_hash) VALUES ($1, $2)",
        [migration.version, sha256(migration.sql)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end();
  }
}

/** Like commitMigration, but keeps the transaction open until commit()/rollback() (a delayed COMMIT). */
async function beginHeldMigration(scenario: Scenario, migration: Migration) {
  const client = new Client({ connectionString: scenario.url });
  await client.connect();
  let finished = false;
  try {
    await client.query("SET ROLE app_migrator");
    await client.query("SET lock_timeout = '60s'");
    await client.query("BEGIN");
    await client.query(migration.sql);
    await client.query("INSERT INTO app.schema_migrations(version, source_hash) VALUES ($1, $2)", [
      migration.version,
      sha256(migration.sql),
    ]);
  } catch (error) {
    await client.end();
    throw error;
  }
  const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
  return {
    pid,
    async commit() {
      if (finished) return;
      finished = true;
      try {
        await client.query("COMMIT");
      } finally {
        await client.end();
      }
    },
    async rollback() {
      if (finished) return;
      finished = true;
      try {
        await client.query("ROLLBACK");
      } finally {
        await client.end();
      }
    },
  };
}

async function createScenario(options: { expanded: boolean }): Promise<Scenario> {
  const name = `r39x_compat_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: sourceUrl });
  await admin.connect();
  const scenarioUrl = new URL(sourceUrl as string);
  scenarioUrl.pathname = `/${name}`;
  const url = scenarioUrl.href;
  const roots: string[] = [];
  let setup: Client | undefined;
  const cleanup = async () => {
    await setup?.end().catch(() => undefined);
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
      for (const root of roots) await rm(root, { recursive: true, force: true });
    }
  };
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    await admin.query(`ALTER DATABASE "${name}" SET r39x.environment TO 'test'`);
    setup = new Client({ connectionString: url });
    await setup.connect();
    // The OLD build: only the repository migration set, as `packages/db/migrations`. NEXT is the
    // directory a later release runs migrations from: OLD plus one backward-compatible expand.
    const names = (await readdir(REPO_MIGRATIONS)).filter((file) => file.endsWith(".sql")).sort();
    const repoVersions = names.map((file) => file.slice(0, -4));
    const last = Number(names.at(-1)?.slice(0, 4));
    if (!Number.isInteger(last) || names.length < 3)
      throw new Error("repository migrations must be numbered and at least three");
    const expandVersion = `${String(last + 1).padStart(4, "0")}_${EXPAND_SUFFIX}`;
    const make = async (extra: boolean) => {
      const root = await mkdtemp(join(tmpdir(), "r39x-compat-"));
      roots.push(root);
      const dir = join(root, "packages/db/migrations");
      await mkdir(dir, { recursive: true });
      for (const file of names) await copyFile(join(REPO_MIGRATIONS, file), join(dir, file));
      if (extra) await copyFile(COMPAT_EXPAND, join(dir, `${expandVersion}.sql`));
      return root;
    };
    const oldRoot = await make(false);
    const nextRoot = await make(true);
    // Repository set applied from the repository directory (cwd = tests/).
    await prepareFoundationDatabase(setup);
    await installSyntheticDirectory(setup);
    expect((await setup.query("SHOW transaction_isolation")).rows[0].transaction_isolation).toBe(
      "read committed",
    );
    const expandSql = await readFile(COMPAT_EXPAND, "utf8");
    const scenario: Scenario = {
      url,
      setup,
      oldRoot,
      nextRoot,
      repoVersions,
      expandVersion,
      expandSql,
      close: cleanup,
    };
    if (options.expanded) {
      // The later release: NEXT's runMigrations applies the repository set's successor (one more journal row).
      const migrator = new Client({ connectionString: url });
      await migrator.connect();
      try {
        await migrator.query("SET ROLE app_migrator");
        await inCwd(nextRoot, () => runMigrations(migrator));
      } finally {
        await migrator.end();
      }
    }
    return scenario;
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }
}

function expectations(migrationSetHash: string): ReadinessExpectations {
  return {
    environment: "test",
    environmentMarkerSetting: "r39x.environment",
    migrationSetHash,
    directoryMapping: {
      deploymentConfirmed: true as const,
      providerSchemaVersion: "synthetic-test-v1",
      schema: "synthetic_provider",
      table: "identities",
      subjectColumn: "subject",
      emailColumn: "current_email",
      verifiedColumn: "verified",
    },
  };
}

/** Readiness of the OLD build (cwd = the temporary repository-set copy). */
async function oldBuildReadiness(scenario: Scenario, pool: Pool) {
  const hash = await computeMigrationSetHash(scenario.oldRoot);
  return inCwd(scenario.oldRoot, () => checkReadiness(pool, expectations(hash)));
}

function readinessPool(scenario: Scenario, options = READINESS_OPTIONS, max = 1): Pool {
  return new Pool({ connectionString: scenario.url, max, options });
}

function observe(pool: Pool): LogEvent[] {
  const events: LogEvent[] = [];
  observeDatabase(pool, { log: (event) => events.push(event) });
  return events;
}
const failClosed = (events: readonly LogEvent[]) =>
  events.filter((event) => event.event_name === "security.fail_closed.triggered");
const queryNames = (events: readonly LogEvent[]) =>
  failClosed(events).map((event) => (event as { query_name?: string }).query_name);

/**
 * Wraps the pool `checkReadiness` gets (Proxy, not a patched SDK): the returned client records each
 * statement and, right after the catalog statement's response, awaits `afterCatalog(n)` (n = how many
 * catalog reads this readiness has made). `observeDatabase` must be called on the returned pool.
 */
function instrument(pool: Pool, afterCatalog?: (n: number) => Promise<void>) {
  const statements: string[] = [];
  let catalogReads = 0;
  const textOf = (arg: unknown): string =>
    typeof arg === "string" ? arg : String((arg as { text?: string })?.text ?? "");
  const wrapClient = (client: PoolClient): PoolClient =>
    new Proxy(client, {
      get(target, prop) {
        if (prop === "query")
          return async (...args: unknown[]) => {
            const sql = textOf(args[0]);
            statements.push(sql);
            const result = await (target.query as (...a: unknown[]) => Promise<unknown>)(...args);
            if (sql === catalogQuery) {
              catalogReads++;
              if (afterCatalog) await afterCatalog(catalogReads);
            }
            return result;
          };
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  const proxy = new Proxy(pool, {
    get(target, prop) {
      if (prop === "connect")
        return async (...args: unknown[]) =>
          wrapClient(await (target.connect as (...a: unknown[]) => Promise<PoolClient>)(...args));
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Pool;
  return {
    pool: proxy,
    journalReads: () => statements.filter((sql) => sql.includes("app.schema_migrations")).length,
    catalogReads: () => catalogReads,
    statements,
  };
}

const NOT_NULL_EXPAND = (scenario: Scenario): Migration => ({
  version: scenario.expandVersion,
  sql: `${scenario.expandSql}\nALTER TABLE app.business_profiles ALTER COLUMN display_name SET NOT NULL;`,
});
const compatibleMigrations = (scenario: Scenario): Migration[] => {
  const next = (offset: number, suffix: string) =>
    `${String(Number(scenario.expandVersion.slice(0, 4)) + offset).padStart(4, "0")}_${suffix}`;
  return [
    { version: scenario.expandVersion, sql: scenario.expandSql },
    {
      version: next(1, "synthetic_expand_b"),
      sql: "ALTER TABLE app.business_profiles ADD COLUMN synthetic_expand_b text;",
    },
    {
      version: next(2, "synthetic_expand_c"),
      sql: "CREATE TABLE app.synthetic_expand_c (id bigint GENERATED ALWAYS AS IDENTITY CONSTRAINT pk_synthetic_expand_c PRIMARY KEY); REVOKE ALL ON app.synthetic_expand_c FROM PUBLIC;",
    },
    {
      version: next(3, "synthetic_expand_d"),
      sql: "CREATE INDEX ix_synthetic_expand_items_note ON app.synthetic_expand_items (note);",
    },
  ];
};

const TIMEOUT = 90_000;

describe("old build readiness after a backward-compatible expand (real PostgreSQL 17)", () => {
  let expanded: Scenario;
  beforeAll(async () => {
    expanded = await createScenario({ expanded: true });
  }, TIMEOUT);
  afterAll(async () => {
    await expanded?.close();
  }, TIMEOUT);

  it(
    "TC-INF-HLT-006-001 INF-HLT-006 the old build is Ready after a later expand migration, for the setup, API and Reconciliation identities",
    async () => {
      // Premises: the journal is the repository set plus exactly one later row, and the catalog
      // really contains the expand objects (so exact equality with the old build's catalog cannot hold).
      const journal = (
        await expanded.setup.query(
          'SELECT version FROM app.schema_migrations ORDER BY version COLLATE "C"',
        )
      ).rows.map((row) => row.version);
      expect(journal).toEqual([...expanded.repoVersions, expanded.expandVersion]);
      expect(
        (await expanded.setup.query("SELECT to_regclass('app.synthetic_expand_items') AS name"))
          .rows[0].name,
      ).toBe("app.synthetic_expand_items");

      const pool = readinessPool(expanded);
      const events = observe(pool);
      try {
        expect(await oldBuildReadiness(expanded, pool)).toEqual({ ready: true, failures: [] });
        expect(failClosed(events)).toEqual([]);
      } finally {
        await pool.end();
      }

      const ca = await readFile(caPath as string, "utf8");
      for (const [service, role] of [
        ["api", "app_api_runtime"],
        ["reconciliation-worker", "app_reconciliation_runtime"],
      ] as const) {
        const runtimeUrl = new URL(expanded.url);
        runtimeUrl.username = role;
        runtimeUrl.password = "";
        runtimeUrl.search = "";
        const runtimeEvents: LogEvent[] = [];
        const runtime = createDatabase({
          connectionString: runtimeUrl.href,
          environment: "test",
          service,
          ca,
          logger: { log: (event) => runtimeEvents.push(event) },
        });
        try {
          expect(await oldBuildReadiness(expanded, runtime.pool), service).toEqual({
            ready: true,
            failures: [],
          });
          expect(failClosed(runtimeEvents), service).toEqual([]);
        } finally {
          await runtime.close();
        }
      }
    },
    TIMEOUT,
  );

  it(
    "TC-INF-HLT-006-002 INF-HLT-006 REL-DB-012 removing or changing a required object is Not Ready after the expand, and rolling back restores Ready",
    async () => {
      const pool = readinessPool(expanded);
      const events = observe(pool);
      try {
        const injections: readonly (readonly [string, string])[] = [
          [
            "constraint dropped",
            "ALTER TABLE app.business_profiles DROP CONSTRAINT uq_business_profiles_auth_subject",
          ],
          [
            "check definition changed",
            "ALTER TABLE app.business_profiles DROP CONSTRAINT ck_business_profiles_display_name; ALTER TABLE app.business_profiles ADD CONSTRAINT ck_business_profiles_display_name CHECK (true)",
          ],
          [
            "check re-added NOT VALID",
            "ALTER TABLE app.business_profiles DROP CONSTRAINT ck_business_profiles_display_name; ALTER TABLE app.business_profiles ADD CONSTRAINT ck_business_profiles_display_name CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 80) NOT VALID",
          ],
          ["index dropped", "DROP INDEX app.ux_role_assignments_profile_role_active"],
          [
            "index recreated with another definition",
            "DROP INDEX app.ux_role_assignments_profile_role_active; CREATE INDEX ux_role_assignments_profile_role_active ON app.role_assignments(profile_id,role)",
          ],
          [
            "column DROP NOT NULL",
            "ALTER TABLE app.business_profiles ALTER COLUMN auth_subject DROP NOT NULL",
          ],
          [
            "column DROP DEFAULT",
            "ALTER TABLE app.business_profiles ALTER COLUMN created_at DROP DEFAULT",
          ],
          [
            "column type changed",
            "ALTER TABLE app.business_profiles ALTER COLUMN display_name TYPE varchar(100)",
          ],
          [
            "required column SET NOT NULL",
            "ALTER TABLE app.business_profiles ALTER COLUMN display_name SET NOT NULL",
          ],
          ["table renamed", "ALTER TABLE app.role_assignments RENAME TO missing_role_assignments"],
          [
            "extra NOT NULL column without default on a required table",
            "ALTER TABLE app.business_profiles ADD COLUMN synthetic_not_null_no_default text NOT NULL",
          ],
          [
            "column added by the expand later SET NOT NULL",
            "ALTER TABLE app.business_profiles ALTER COLUMN synthetic_expand_note SET NOT NULL",
          ],
        ];
        for (const [label, injection] of injections) {
          events.length = 0;
          await pool.query("BEGIN");
          try {
            if (injection.includes("SET NOT NULL") && label === "required column SET NOT NULL") {
              // Premise (G-d-11): the SET NOT NULL succeeds, i.e. no row has a NULL display_name.
              expect(
                (
                  await pool.query(
                    "SELECT count(*)::int AS count FROM app.business_profiles WHERE display_name IS NULL",
                  )
                ).rows[0].count,
              ).toBe(0);
            }
            await pool.query(injection);
            const result = await oldBuildReadiness(expanded, pool);
            expect(result.ready, label).toBe(false);
            expect(result.failures, label).toContain("release_schema_contract");
            expect(queryNames(events), label).toContain("readiness.release_schema_contract");
          } finally {
            await pool.query("ROLLBACK");
          }
          events.length = 0;
          expect(await oldBuildReadiness(expanded, pool), label).toEqual({
            ready: true,
            failures: [],
          });
          expect(failClosed(events), label).toEqual([]);
        }

        // Control: additional objects only (no required object touched) stay Ready.
        await pool.query("BEGIN");
        try {
          await pool.query(
            "CREATE INDEX ix_business_profiles_extra_control ON app.business_profiles(display_name); CREATE TABLE app.synthetic_control_items (id int); REVOKE ALL ON app.synthetic_control_items FROM PUBLIC",
          );
          expect(await oldBuildReadiness(expanded, pool)).toEqual({ ready: true, failures: [] });
        } finally {
          await pool.query("ROLLBACK");
        }

        // Auxiliary: a required constraint that is validated later (NOT VALID -> VALIDATE). The
        // repository catalog has no unvalidated constraint, so checkReadiness cannot show this end to
        // end; the real PG17 output is given to the comparison instead (unit TC-005 covers the rest).
        await pool.query("BEGIN");
        try {
          await pool.query(
            "ALTER TABLE app.synthetic_expand_items ADD CONSTRAINT ck_synthetic_expand_items_id CHECK (id > 0) NOT VALID",
          );
          const find = (catalog: Record<string, unknown[][]>) =>
            catalog.constraints?.find((tuple) => tuple[1] === "ck_synthetic_expand_items_id");
          const before = (await pool.query(catalogQuery)).rows[0].catalog as Record<
            string,
            unknown[][]
          >;
          const notValid = find(before);
          expect(notValid, "NOT VALID constraint is in the live catalog").toBeDefined();
          expect(notValid?.[4]).toBe(false);
          expect(String(notValid?.[3]).endsWith(" NOT VALID")).toBe(true);
          const requiredWithIt = structuredClone(requiredCatalog) as unknown as Record<
            string,
            unknown[]
          >;
          requiredWithIt.constraints?.push(notValid as unknown[]);
          await pool.query(
            "ALTER TABLE app.synthetic_expand_items VALIDATE CONSTRAINT ck_synthetic_expand_items_id",
          );
          const after = (await pool.query(catalogQuery)).rows[0].catalog as Record<
            string,
            unknown[][]
          >;
          const validated = find(after);
          expect(validated?.[4]).toBe(true);
          expect(String(validated?.[3]).includes("NOT VALID")).toBe(false);
          expect(catalogSatisfies(after, requiredWithIt, "contains")).toBe(true);
          expect(catalogSatisfies(after, requiredWithIt, "exact")).toBe(false);
        } finally {
          await pool.query("ROLLBACK");
        }
      } finally {
        await pool.end();
      }
    },
    TIMEOUT,
  );

  it(
    "TC-INF-HLT-006-003 INF-HLT-006 a journal whose start differs from the bundled set is Not Ready, later rows are not checked",
    async () => {
      const [first, second, third] = expanded.repoVersions as [string, string, string];
      const pool = readinessPool(expanded);
      const events = observe(pool);
      try {
        const cases: readonly (readonly [string, string, unknown[]])[] = [
          [
            "first row hash altered",
            "UPDATE app.schema_migrations SET source_hash = $1 WHERE version = $2",
            ["a".repeat(64), first],
          ],
          [
            "last bundled row hash altered",
            "UPDATE app.schema_migrations SET source_hash = $1 WHERE version = $2",
            ["a".repeat(64), third],
          ],
          ["first row deleted", "DELETE FROM app.schema_migrations WHERE version = $1", [first]],
          ["middle row deleted", "DELETE FROM app.schema_migrations WHERE version = $1", [second]],
        ];
        for (const [label, sql, params] of cases) {
          events.length = 0;
          await pool.query("BEGIN");
          try {
            await pool.query(sql, params);
            const result = await oldBuildReadiness(expanded, pool);
            expect(result.ready, label).toBe(false);
            expect(result.failures, label).toContain("migration_hash");
            expect(queryNames(events), label).toContain("readiness.migration_hash");
          } finally {
            await pool.query("ROLLBACK");
          }
          events.length = 0;
          expect(await oldBuildReadiness(expanded, pool), label).toEqual({
            ready: true,
            failures: [],
          });
        }

        // A row inserted between two bundled rows. The version is chosen so that it sorts between them
        // in byte order whatever the database collation; the test proves that before using it.
        const inserted = `${first}_z`;
        events.length = 0;
        await pool.query("BEGIN");
        try {
          await pool.query(
            "INSERT INTO app.schema_migrations(version, source_hash) VALUES ($1, $2)",
            [inserted, "b".repeat(64)],
          );
          const order = (
            await pool.query(
              'SELECT version FROM app.schema_migrations ORDER BY version COLLATE "C"',
            )
          ).rows.map((row) => row.version as string);
          expect(order.indexOf(inserted), "inserted row position by byte order").toBe(1);
          expect(order[0]).toBe(first);
          expect(order[2]).toBe(second);
          const result = await oldBuildReadiness(expanded, pool);
          expect(result.ready).toBe(false);
          expect(result.failures).toContain("migration_hash");
          expect(queryNames(events)).toContain("readiness.migration_hash");
        } finally {
          await pool.query("ROLLBACK");
        }
        events.length = 0;
        expect(await oldBuildReadiness(expanded, pool)).toEqual({ ready: true, failures: [] });

        // Control: the old build does not look at rows after its bundled set.
        await pool.query("BEGIN");
        try {
          const changed = await pool.query(
            "UPDATE app.schema_migrations SET source_hash = $1 WHERE version = $2",
            ["c".repeat(64), expanded.expandVersion],
          );
          expect(changed.rowCount).toBe(1);
          expect(await oldBuildReadiness(expanded, pool)).toEqual({ ready: true, failures: [] });
        } finally {
          await pool.query("ROLLBACK");
        }
      } finally {
        await pool.end();
      }
    },
    TIMEOUT,
  );
});

describe("readiness when the journal is behind or the set is the same (real PostgreSQL 17)", () => {
  it(
    "TC-INF-HLT-006-004 INF-HLT-006 a journal shorter than the build's set is Not Ready, and extra objects with the same set are Not Ready",
    async () => {
      const scenario = await createScenario({ expanded: false });
      const pool = readinessPool(scenario);
      const events = observe(pool);
      try {
        // (a) DB at the repository set, build = repository set + one (the next release's build): the
        // journal is behind. Only the journal check fails; the catalog still equals the required one.
        const behind = await inCwd(scenario.nextRoot, async () =>
          checkReadiness(pool, expectations(await computeMigrationSetHash())),
        );
        expect(behind.ready).toBe(false);
        expect(behind.failures).toContain("migration_hash");
        expect(behind.failures).not.toContain("release_schema_contract");
        expect(queryNames(events)).toContain("readiness.migration_hash");

        // The same DB is Ready for the repository-set build (the baseline for (b)).
        events.length = 0;
        expect(await oldBuildReadiness(scenario, pool)).toEqual({ ready: true, failures: [] });

        // (b) Same journal length: the catalog must be exactly the required one.
        await pool.query("BEGIN");
        try {
          await pool.query(
            "CREATE INDEX ix_business_profiles_extra ON app.business_profiles(display_name)",
          );
          const result = await oldBuildReadiness(scenario, pool);
          expect(result.ready).toBe(false);
          expect(result.failures).toContain("release_schema_contract");
          expect(result.failures).not.toContain("migration_hash");
          expect(queryNames(events)).toContain("readiness.release_schema_contract");
        } finally {
          await pool.query("ROLLBACK");
        }
        events.length = 0;
        expect(await oldBuildReadiness(scenario, pool)).toEqual({ ready: true, failures: [] });
      } finally {
        await pool.end();
        await scenario.close();
      }
    },
    TIMEOUT,
  );
});

describe("readiness reads while a migration commits (real PostgreSQL 17)", () => {
  type Plan = (scenario: Scenario) => Migration[];
  /** Runs readiness; after the n-th catalog response, plan[n-1] is committed from another connection. */
  async function readWithCommits(scenario: Scenario, plan: Migration[], options: string) {
    const real = readinessPool(scenario, options);
    const instrumented = instrument(real, async (n) => {
      const migration = plan[n - 1];
      if (migration) await commitMigration(scenario, migration);
    });
    const events = observe(instrumented.pool);
    try {
      const result = await oldBuildReadiness(scenario, instrumented.pool);
      return { result, instrumented, events, real };
    } finally {
      await real.end();
    }
  }
  const journalRows = async (scenario: Scenario) =>
    (await scenario.setup.query("SELECT count(*)::int AS count FROM app.schema_migrations")).rows[0]
      .count as number;

  async function compatibleCommit(options: string) {
    const scenario = await createScenario({ expanded: false });
    try {
      const { result, instrumented, events } = await readWithCommits(
        scenario,
        [{ version: scenario.expandVersion, sql: scenario.expandSql }],
        options,
      );
      expect(await journalRows(scenario), "the migration was committed between the reads").toBe(
        scenario.repoVersions.length + 1,
      );
      expect(instrumented.catalogReads()).toBeGreaterThanOrEqual(2);
      expect(
        instrumented.journalReads(),
        "journal re-read after the commit",
      ).toBeGreaterThanOrEqual(3);
      expect(result).toEqual({ ready: true, failures: [] });
      expect(failClosed(events)).toEqual([]);
      expect(
        instrumented.statements.some((sql) => /^\s*(BEGIN|START\s+TRANSACTION)/i.test(sql)),
      ).toBe(false);
    } finally {
      await scenario.close();
    }
  }
  async function incompatibleCommit(options: string) {
    const scenario = await createScenario({ expanded: false });
    try {
      expect(
        (
          await scenario.setup.query(
            "SELECT count(*)::int AS count FROM app.business_profiles WHERE display_name IS NULL",
          )
        ).rows[0].count,
        "premise: SET NOT NULL can succeed",
      ).toBe(0);
      const { result, instrumented, events } = await readWithCommits(
        scenario,
        [NOT_NULL_EXPAND(scenario)],
        options,
      );
      expect(await journalRows(scenario)).toBe(scenario.repoVersions.length + 1);
      expect(
        (
          await scenario.setup.query(
            "SELECT attnotnull FROM pg_attribute WHERE attrelid = 'app.business_profiles'::regclass AND attname = 'display_name'",
          )
        ).rows[0].attnotnull,
        "premise: the committed migration set the required column NOT NULL",
      ).toBe(true);
      // An old catalog with a new journal must not be combined into Ready.
      expect(result.ready).toBe(false);
      expect(result.failures).toContain("release_schema_contract");
      expect(result.failures).not.toContain("migration_hash");
      expect(queryNames(events)).toContain("readiness.release_schema_contract");
      expect(
        instrumented.statements.some((sql) => /^\s*(BEGIN|START\s+TRANSACTION)/i.test(sql)),
      ).toBe(false);
    } finally {
      await scenario.close();
    }
  }

  it(
    "TC-INF-HLT-006-006 INF-HLT-006 REL-DB-011 a compatible migration committed between the reads leaves the old build Ready",
    async () => {
      await compatibleCommit(READINESS_OPTIONS);
    },
    TIMEOUT,
  );

  it(
    "TC-INF-HLT-006-006 INF-HLT-006 REL-DB-011 an incompatible migration committed between the reads is Not Ready, never an old catalog with a new journal",
    async () => {
      await incompatibleCommit(READINESS_OPTIONS);
    },
    TIMEOUT,
  );

  it(
    "TC-INF-HLT-006-006 INF-HLT-006 REL-DB-011 a commit after every attempt's catalog read exhausts the retry budget as release_schema_contract and the next check is Ready",
    async () => {
      const scenario = await createScenario({ expanded: false });
      try {
        const plan: Plan = compatibleMigrations;
        const migrations = plan(scenario);
        const { result, instrumented, events } = await readWithCommits(
          scenario,
          migrations,
          READINESS_OPTIONS,
        );
        // SPEC-150 section 11: at most four attempts, each ending in a commit between the reads.
        expect(instrumented.catalogReads()).toBe(4);
        expect(await journalRows(scenario)).toBe(scenario.repoVersions.length + 4);
        expect(result.ready).toBe(false);
        expect(result.failures).toContain("release_schema_contract");
        expect(result.failures).not.toContain("migration_hash");
        expect(queryNames(events)).toContain("readiness.release_schema_contract");
        expect(queryNames(events)).not.toContain("readiness.migration_hash");

        // Nothing is committed during the next check: the journal is ahead and the catalog contains
        // the required one, so the old build is Ready again.
        const second = await readWithCommits(scenario, [], READINESS_OPTIONS);
        expect(second.result).toEqual({ ready: true, failures: [] });
      } finally {
        await scenario.close();
      }
    },
    TIMEOUT,
  );

  it(
    "TC-INF-HLT-006-007 INF-HLT-006 TST-DB-002 a repeatable-read readiness session is Ready after a compatible commit between the reads",
    async () => {
      await assertRepeatableReadSession();
      await compatibleCommit(REPEATABLE_READ_OPTIONS);
    },
    TIMEOUT,
  );

  it(
    "TC-INF-HLT-006-007 INF-HLT-006 TST-DB-002 a repeatable-read readiness session is Not Ready after an incompatible commit between the reads",
    async () => {
      await incompatibleCommit(REPEATABLE_READ_OPTIONS);
    },
    TIMEOUT,
  );

  async function assertRepeatableReadSession() {
    // TST-DB-002: only the readiness connection is repeatable read; the others are read committed
    // (commitMigration and createScenario assert that for the migration and fixture connections).
    const scenario = await createScenario({ expanded: false });
    const probe = readinessPool(scenario, REPEATABLE_READ_OPTIONS);
    try {
      expect(
        (await probe.query("SHOW default_transaction_isolation")).rows[0]
          .default_transaction_isolation,
      ).toBe("repeatable read");
      expect((await probe.query("SHOW transaction_isolation")).rows[0].transaction_isolation).toBe(
        "repeatable read",
      );
    } finally {
      await probe.end();
      await scenario.close();
    }
  }
});

describe("readiness while a migration's COMMIT is delayed (real PostgreSQL 17)", () => {
  /**
   * Holds an uncommitted compatible migration, starts readiness, waits for the readiness connection to
   * be seen waiting for a lock (the lock wait is the premise of INF-HLT-006 known constraint (c): if
   * it never happens this test fails), then commits `commitAfterMs` after that first wait.
   */
  async function delayedCommit(commitAfterMs: number) {
    const scenario = await createScenario({ expanded: false });
    const pool = readinessPool(scenario, `${READINESS_OPTIONS}`);
    const events = observe(pool);
    const held = await beginHeldMigration(scenario, {
      version: scenario.expandVersion,
      sql: scenario.expandSql,
    });
    let committedAt: number | undefined;
    let committing: Promise<void> = Promise.resolve();
    try {
      const readiness = oldBuildReadiness(scenario, pool);
      let settledAt: number | undefined;
      readiness.then(
        () => {
          settledAt = performance.now();
        },
        () => {
          settledAt = performance.now();
        },
      );
      // Observe the first lock wait of a backend other than the holder and the fixture session.
      let waitSeenAt: number | undefined;
      const giveUp = performance.now() + 10_000;
      while (waitSeenAt === undefined && settledAt === undefined && performance.now() < giveUp) {
        const waiting = await scenario.setup.query(
          "SELECT pid, query FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid NOT IN (pg_backend_pid(), $1)",
          [held.pid],
        );
        if (waiting.rowCount) waitSeenAt = performance.now();
        else await delay(10);
      }
      if (waitSeenAt !== undefined)
        committing = delay(commitAfterMs).then(async () => {
          committedAt = performance.now();
          await held.commit();
        });
      else await held.rollback();
      const result = await readiness;
      const readinessFinishedBeforeCommit = committedAt === undefined;
      await committing;
      return {
        scenario,
        pool,
        events,
        result,
        waited: waitSeenAt !== undefined,
        readinessFinishedBeforeCommit,
      };
    } catch (error) {
      await held.rollback().catch(() => undefined);
      await pool.end().catch(() => undefined);
      await scenario.close().catch(() => undefined);
      throw error;
    }
  }

  it(
    "TC-INF-HLT-006-008 INF-HLT-006 REL-DB-011 a COMMIT delayed within the retry budget leaves the old build Ready",
    async () => {
      const run = await delayedCommit(500);
      try {
        expect(run.waited, "the readiness connection must have waited for a lock").toBe(true);
        expect(run.result).toEqual({ ready: true, failures: [] });
        expect(failClosed(run.events)).toEqual([]);
      } finally {
        await run.pool.end();
        await run.scenario.close();
      }
    },
    TIMEOUT,
  );

  it(
    "TC-INF-HLT-006-008 INF-HLT-006 REL-DB-011 a COMMIT delayed beyond the retry budget is Not Ready for that check and Ready after the COMMIT",
    async () => {
      const run = await delayedCommit(8000);
      try {
        expect(run.waited, "the readiness connection must have waited for a lock").toBe(true);
        expect(
          run.readinessFinishedBeforeCommit,
          "the check must end (budget exhausted) while the COMMIT is still pending",
        ).toBe(true);
        expect(run.result.ready).toBe(false);
        expect(run.result.failures).toContain("release_schema_contract");
        expect(run.result.failures).not.toContain("migration_hash");
        expect(queryNames(run.events)).toContain("readiness.release_schema_contract");
        // The COMMIT has happened (journal ahead, catalog contains the required one): Ready.
        run.events.length = 0;
        expect(await oldBuildReadiness(run.scenario, run.pool)).toEqual({
          ready: true,
          failures: [],
        });
        expect(failClosed(run.events)).toEqual([]);
      } finally {
        await run.pool.end();
        await run.scenario.close();
      }
    },
    TIMEOUT,
  );
});
