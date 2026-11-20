import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import type { MigrationLock } from "../../../packages/db/src/migration-lock.ts";

// PR-SEED harness (SPEC-170 TST-SEED-001..006, SPEC-180 INF-SEED-001..006). Synthetic values only; the
// names, dates and amounts below do not describe any real venue, event or price (DB-SEED-006).

export const SEED_ACTOR_REF = "gha:example-repo:test";
export const SEED_LOCK_NAME = "app:initial-data-seed";

/** A per-run probe that must never reach a log, a stdout line, or an Audit Event column. */
export function newMarker(): string {
  return `SEEDPROBE${randomBytes(8).toString("hex")}`;
}

// Distinctive seven digit numbers: long enough that a UUID or timestamp cannot contain them by chance.
export const PROBE_UNIT_AMOUNT = 7351912;
export const PROBE_CAPACITY = 4817263;

export type InitialDataInput = {
  event: Record<string, unknown>;
  entry_ticket_offerings: Record<string, unknown>[];
};

export const EVENT_INPUT_COLUMNS = [
  "name",
  "summary",
  "starts_at",
  "ends_at",
  "venue_name",
  "venue_details",
  "access_information",
  "participant_notices",
] as const;
export const OFFERING_REQUIRED_COLUMNS = [
  "name",
  "unit_amount",
  "currency",
  "sales_starts_at",
  "sales_ends_at",
  "sales_capacity",
  "purchase_limit",
] as const;
export const OFFERING_OPTIONAL_COLUMNS = [
  "description",
  "checkin_opens_at",
  "checkin_closes_at",
] as const;

/** The `changed_fields` the plan (D-6 (g)) expects: created input columns plus the fixed-value columns. */
export const EVENT_FIXED_FIELDS = ["business_timezone"] as const;
export const OFFERING_FIXED_FIELDS = [
  "sale_control_state",
  "held_quantity",
  "committed_quantity",
] as const;

export function buildInitialDataInput(
  options: {
    /** `full` sets every optional column; `minimal` leaves every nullable column out. */
    variant?: "full" | "minimal";
    offeringCount?: number;
    marker?: string;
    /** Merged over the Event object (use `undefined` to drop a key). */
    event?: Record<string, unknown>;
    /** Merged over the offering at that index. */
    offering?: (index: number) => Record<string, unknown>;
  } = {},
): InitialDataInput {
  const variant = options.variant ?? "full";
  const marker = options.marker ?? newMarker();
  const count = options.offeringCount ?? 2;
  const event: Record<string, unknown> = { name: `${marker} 合成データ イベント` };
  if (variant === "full") {
    Object.assign(event, {
      summary: `${marker} 合成データ 概要`,
      starts_at: "2030-05-10T18:00:00+09:00",
      ends_at: "2030-05-10T21:00:00+09:00",
      venue_name: `${marker} 合成データ 会場`,
      venue_details: `${marker} 合成データ 会場の詳細`,
      access_information: `${marker} 合成データ アクセス`,
      participant_notices: `${marker} 合成データ 注意事項`,
    });
  }
  const offerings = Array.from({ length: count }, (_, index) => {
    const offering: Record<string, unknown> = {
      name: `${marker} 合成データ 入場券 ${index + 1}`,
      unit_amount: PROBE_UNIT_AMOUNT + index,
      currency: "JPY",
      sales_starts_at: "2030-04-01T00:00:00.000Z",
      sales_ends_at: "2030-05-10T08:00:00Z",
      sales_capacity: PROBE_CAPACITY - index,
      purchase_limit: 3,
    };
    if (variant === "full") {
      Object.assign(offering, {
        description: `${marker} 合成データ 入場券の説明 ${index + 1}`,
        checkin_opens_at: "2030-05-10T16:30:00+09:00",
        checkin_closes_at: "2030-05-10T20:30:00+09:00",
      });
    }
    return { ...offering, ...(options.offering?.(index) ?? {}) };
  });
  const merged = { ...event, ...(options.event ?? {}) };
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  for (const offering of offerings)
    for (const key of Object.keys(offering)) if (offering[key] === undefined) delete offering[key];
  return { event: merged, entry_ticket_offerings: offerings };
}

/** Values that must never appear in any output: strings of 8+ characters and numbers of 6+ digits. */
export function sensitiveValues(input: InitialDataInput): string[] {
  const found = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string" && value.length >= 8) found.add(value);
    else if (typeof value === "number" && Math.abs(value) >= 100000) found.add(String(value));
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(input);
  return [...found];
}

/** Plain TCP connection without a password (trust authentication on the test cluster). */
export async function connectAs(role: string, databaseUrl?: string): Promise<Client> {
  const url = new URL(databaseUrl ?? (process.env.TEST_DATABASE_URL as string));
  url.username = role;
  url.password = "";
  url.search = "";
  const client = new Client({ connectionString: url.href, ssl: false });
  // A destroyed fixture socket must not become an unhandled error event.
  client.on("error", () => {});
  await client.connect();
  return client;
}

export async function endQuietly(client: Client | undefined): Promise<void> {
  try {
    await client?.end();
  } catch {
    // already closed by the fault fixture
  }
}

/** Clears the three seeded tables (superuser connection). Other tables are cleared by CASCADE. */
export async function resetInitialData(admin: Client): Promise<void> {
  await admin.query(
    "TRUNCATE app.audit_events, app.entry_ticket_offerings, app.events RESTART IDENTITY CASCADE",
  );
}

/** Whole-table text snapshot (every column) used to prove that nothing changed. */
export async function snapshotSeededTables(admin: Client): Promise<{
  events: string[];
  offerings: string[];
  audit: string[];
}> {
  const text = async (table: string) =>
    (await admin.query(`SELECT t::text AS row FROM ${table} t ORDER BY t.id`)).rows.map(
      (row) => row.row as string,
    );
  return {
    events: await text("app.events"),
    offerings: await text("app.entry_ticket_offerings"),
    audit: await text("app.audit_events"),
  };
}

/** Wraps `client.query` so every SQL text (never a bind value) is recorded. */
export function recordStatements<T extends Client>(client: T, sink: string[] = []): T {
  return new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (property === "query") {
        return (...args: unknown[]) => {
          const first = args[0] as string | { text?: string } | undefined;
          sink.push(typeof first === "string" ? first : (first?.text ?? ""));
          return Reflect.apply(value, target, args);
        };
      }
      return value.bind(target);
    },
  });
}

const ALLOWED_TABLES = new Set(["app.events", "app.entry_ticket_offerings", "app.audit_events"]);

/**
 * INF-SEED-003 / TST-SEED-005 (4): what a recorded statement is allowed to be. Returns the statements
 * (split at `;`) that are outside the allowed forms; an empty array means every statement is allowed.
 */
export function disallowedStatements(recorded: readonly string[]): string[] {
  const bad: string[] = [];
  const lockCall = (text: string) =>
    /^select pg_advisory_(lock|unlock)\(hashtext\('r39x:schema-migration'\)\)( as \w+)?$/.test(
      text,
    ) ||
    /^select pg_advisory_xact_lock\(hashtext\('app:initial-data-seed'\)\)( as \w+)?$/.test(text);
  for (const raw of recorded) {
    for (const part of raw.split(";")) {
      const text = part.replaceAll('"', "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!text) continue;
      let ok = false;
      if (
        /^begin( isolation level read committed)?$/.test(text) ||
        text === "commit" ||
        text === "rollback"
      )
        ok = true;
      else if (/^set( local)? (lock_timeout|statement_timeout|timezone)\b/.test(text)) ok = true;
      else if (/^select current_user( as \w+)?$/.test(text)) ok = true;
      else if (lockCall(text)) ok = true;
      else if (/^(select|insert into)\b/.test(text) && !/\b(update|delete)\b/.test(text)) {
        const tables = [...text.matchAll(/\b(?:from|join|into)\s+([a-z_][a-z0-9_.]*)/g)].map(
          (match) => match[1] as string,
        );
        ok = tables.length > 0 && tables.every((table) => ALLOWED_TABLES.has(table));
        if (text.startsWith("insert into")) ok = ok && tables.length === 1;
      }
      if (!ok) bad.push(text);
    }
  }
  return bad;
}

/** Tables that received an INSERT in the recorded statements. */
export function insertedTables(recorded: readonly string[]): string[] {
  return recorded.flatMap((raw) =>
    raw
      .split(";")
      .map((part) => part.replaceAll('"', "").replace(/\s+/g, " ").trim().toLowerCase())
      .map((text) => /^insert into ([a-z_][a-z0-9_.]*)/.exec(text)?.[1])
      .filter((table): table is string => table !== undefined),
  );
}

/** Index of the first statement that matches, or -1. */
export function firstIndex(recorded: readonly string[], pattern: RegExp): number {
  return recorded.findIndex((text) => pattern.test(text.replaceAll('"', "")));
}

/** All parties wait here until `parties` have arrived (TST-SEED-002 (5): barrier-synchronised start). */
export function barrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release: () => void = () => {};
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived >= parties) release();
    await open;
  };
}

export async function waitUntil(
  condition: () => Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number; label: string },
): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 20_000);
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 25));
  }
  throw new Error(`Timed out waiting for: ${options.label}`);
}

export type RecordedLog = Record<string, unknown>;

/**
 * Runs `acquireMigrationLock` -> `seedInitialData` -> `release` the way the CLI does, against a real
 * PostgreSQL connection as `app_migrator` (or another role).
 */
export async function runSeed(
  options: {
    /** Object -> JSON text, string -> as is, undefined -> `readInput` returns undefined. */
    input?: unknown;
    actorRef?: string | undefined;
    role?: string | undefined;
    openMain?: (() => Promise<Client>) | undefined;
    /** Receives `wrap` so a custom client can join the same statement record. */
    connect?: ((wrap: <T extends Client>(client: T) => T) => Promise<Client>) | undefined;
    statements?: string[] | undefined;
    logs?: RecordedLog[] | undefined;
    /** Runs after the lock is held and before seeding starts. */
    beforeSeed?: (() => Promise<void>) | undefined;
  } = {},
) {
  const statements = options.statements ?? [];
  const logs = options.logs ?? [];
  const wrap = <T extends Client>(client: T) => recordStatements(client, statements);
  const main = wrap(
    await (options.openMain ?? (() => connectAs(options.role ?? "app_migrator")))(),
  );
  let reads = 0;
  const raw =
    options.input === undefined
      ? undefined
      : typeof options.input === "string"
        ? options.input
        : JSON.stringify(options.input);
  // Loaded on use so the fault-fixture helpers above stay importable on their own.
  const { acquireMigrationLock } = await import("../../../packages/db/src/migration-lock.ts");
  const { seedInitialData } = await import("../../../packages/db/src/initial-data/seed.ts");
  let lock: MigrationLock | undefined;
  try {
    lock = await acquireMigrationLock(main);
    await options.beforeSeed?.();
    const outcome = await seedInitialData({
      lock,
      connect: () =>
        options.connect ? options.connect(wrap) : connectAs("app_migrator").then(wrap),
      readInput: () => {
        reads += 1;
        return raw;
      },
      actorRef: options.actorRef ?? SEED_ACTOR_REF,
      logger: { log: (event: object) => void logs.push(event as RecordedLog) },
    });
    return { outcome, reads: () => reads, statements, logs };
  } finally {
    try {
      await lock?.release();
    } catch {
      // the fault fixture may have destroyed the connection
    }
    await endQuietly(main);
  }
}

// ---- CLI ------------------------------------------------------------------------------------------

const CLI_PATH = fileURLToPath(
  new URL("../../../packages/db/src/seed-initial-data-cli.ts", import.meta.url),
);
const CLI_CWD = fileURLToPath(new URL("../../../packages/db", import.meta.url));
const SEED_ENV_KEYS = [
  "APP_ENV",
  "MIGRATION_DATABASE_URL",
  "INITIAL_DATA_SEED_JSON",
  "INITIAL_DATA_SEED_ACTOR_REF",
];

/** The direct app_migrator URL the CLI accepts (port 5432, no query), for the isolated test database. */
export function migratorUrl(overrides: { password?: string } = {}): URL {
  const url = new URL(process.env.TEST_DATABASE_URL as string);
  url.username = "app_migrator";
  url.password = overrides.password ?? "";
  url.search = "";
  return url;
}

/** Starts the CLI in a child process with a controlled environment and collects its output. */
export async function runSeedCli(
  env: Record<string, string | undefined>,
  options: { timeoutMs?: number } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const childEnv: Record<string, string | undefined> = { ...process.env };
  for (const key of SEED_ENV_KEYS) delete childEnv[key];
  childEnv.NODE_EXTRA_CA_CERTS = process.env.TEST_DATABASE_CA;
  for (const [key, value] of Object.entries(env)) childEnv[key] = value;
  for (const key of Object.keys(childEnv)) if (childEnv[key] === undefined) delete childEnv[key];
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH], {
      cwd: CLI_CWD,
      env: childEnv as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("seed CLI did not exit in time"));
    }, options.timeoutMs ?? 90_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** The SeedOutcome fields the tests read, typed loosely so the plan's union can be narrowed by value. */
export type SeedOutcomeShape = {
  outcome: "CREATED" | "NOOP" | "FAILED" | "UNKNOWN_RESULT";
  created?: { events: string[]; entry_ticket_offerings: string[] };
  auditEventIds?: string[];
  operationExecutionId?: string;
  failureClass?: string;
  errorCode?: string;
};

export function shape(outcome: unknown): SeedOutcomeShape {
  return outcome as SeedOutcomeShape;
}
