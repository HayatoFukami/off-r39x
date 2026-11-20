// PR-L2-3 C1. TC-API-009-008 (G1, SQL shape part): createPublicContentRepository (@off-r39x/db) sends one
// plain read statement per call on the pool, with no transaction and no write, the PUBLISHED condition of
// FAQ / Announcement / Sponsor Logo in the SQL (DB-SAL-001, DB-SAL-002), the ORDER BY in the SQL, the
// Announcement ref as a bound parameter (DEV-DB-004) and the DB clock for the Entry judgement
// (statement_timestamp(), SPEC-110 §26.1 API-PUB-005). No PostgreSQL: a recording pool answers with no
// rows, and the result of a call is not asserted here (what the database returns is TC-API-009-005 on a
// real PG17). Driver failures are classified as in the self profile repository (SPEC-110 §50/§51).
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createPublicContentRepository } from "../../packages/db/src/index.ts";

const REF = "00000000-0000-4000-8000-0000000000a1";
const CONTROL = /^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)\b/;

type Sent = { text: string; values: unknown[] };
type QueryArgument = string | { text: string; values?: unknown[]; rowMode?: string };

function recordingPool(failure?: unknown) {
  const sent: Sent[] = [];
  const control: string[] = [];
  const connects: number[] = [];
  const answer = (query: QueryArgument, values: unknown[] = []) => {
    const text = typeof query === "string" ? query : query.text;
    const bound = typeof query === "string" ? values : (query.values ?? values);
    if (CONTROL.test(text)) {
      control.push(text.split(" ")[0] ?? text);
      return { rows: [], rowCount: 0 };
    }
    sent.push({ text, values: bound });
    if (failure !== undefined) throw failure;
    return { rows: [], rowCount: 0 };
  };
  const client = {
    query: async (query: QueryArgument, values?: unknown[]) => answer(query, values),
    on: () => client,
    once: () => client,
    removeListener: () => client,
    release: () => undefined,
  };
  const pool = {
    query: async (query: QueryArgument, values?: unknown[]) => answer(query, values),
    connect: async () => {
      connects.push(1);
      return client;
    },
  };
  return { pool: pool as unknown as Pool, sent, control, connects };
}
/** Lower case, no identifier quotes, single spaces: compares statements, not drizzle's formatting. */
const normalize = (text: string) =>
  text.replaceAll('"', "").replace(/\s+/g, " ").trim().toLowerCase();

const FORBIDDEN =
  /\b(begin|insert|update|delete|truncate|merge|alter|drop|create|grant|for update|for share|for no key update|for key share|on conflict|set local|nextval|pg_advisory\w*)\b/;
const WALL_CLOCKS =
  /\bnow\(\)|current_timestamp|transaction_timestamp|clock_timestamp|localtimestamp/;
const SELECT_ALL = /select\s+\*|[a-z_]\.\*/;

type Repo = ReturnType<typeof createPublicContentRepository>;
type Name = Extract<keyof Repo, string>;
const CALLS: [name: Name, call: (repo: Repo) => Promise<unknown>][] = [
  ["readPublicEvent", (repo) => repo.readPublicEvent()],
  ["listPublishedFaqs", (repo) => repo.listPublishedFaqs()],
  ["listPublishedAnnouncements", (repo) => repo.listPublishedAnnouncements()],
  ["readPublishedAnnouncement", (repo) => repo.readPublishedAnnouncement(REF)],
  ["listEntryOfferings", (repo) => repo.listEntryOfferings()],
  ["listPublishedSponsorLogos", (repo) => repo.listPublishedSponsorLogos()],
];
const callOf = (name: Name) => (CALLS.find(([n]) => n === name) as (typeof CALLS)[number])[1];
async function statementOf(call: (repo: Repo) => Promise<unknown>) {
  const fake = recordingPool();
  await call(createPublicContentRepository(fake.pool)).catch(() => undefined);
  return fake;
}
const textOf = async (name: Name) =>
  normalize((await statementOf(callOf(name))).sent[0]?.text ?? "");
const publishedCondition = (statement: Sent): boolean => {
  const text = normalize(statement.text);
  return (
    /\bstate\s*=\s*'published'/.test(text) ||
    /\bstate in \('published'\)/.test(text) ||
    (/\bstate\s*=\s*\$\d+/.test(text) && statement.values.includes("PUBLISHED"))
  );
};

describe("TC-API-009-008 public content repository: one plain read per call (DEV-DB-002, DEV-DB-003, DEV-DB-008)", () => {
  it.each(CALLS)(
    "%s sends exactly one statement, on the pool, with no transaction, no write and no row lock",
    async (_name, call) => {
      const fake = await statementOf(call);
      expect(fake.sent).toHaveLength(1);
      expect(fake.control).toEqual([]);
      expect(fake.connects).toEqual([]);
      const text = normalize(fake.sent[0]?.text ?? "");
      expect(text).toMatch(/^(select|with)\b/);
      expect(text).not.toMatch(FORBIDDEN);
    },
  );

  it.each(CALLS)("%s lists its columns (no SELECT *)", async (name) => {
    expect(await textOf(name)).not.toMatch(SELECT_ALL);
  });

  it.each(CALLS)(
    "%s reads the public content and sales tables of schema app only",
    async (name) => {
      const text = await textOf(name);
      const tables = [...text.matchAll(/\b(?:from|join)\s+([a-z_]+\.[a-z_]+)/g)].map((m) => m[1]);
      expect(tables.length).toBeGreaterThan(0);
      for (const table of tables)
        expect(
          [
            "app.events",
            "app.faq_items",
            "app.announcements",
            "app.sponsor_logos",
            "app.entry_ticket_offerings",
          ],
          String(table),
        ).toContain(table);
    },
  );
});

describe("TC-API-009-008 the PUBLISHED condition is in the SQL, not in JavaScript (DB-SAL-001, DB-SAL-002, SPEC-110 §26.1 API-PUB-READ-003)", () => {
  it.each([
    ["listPublishedFaqs", "app.faq_items"],
    ["listPublishedAnnouncements", "app.announcements"],
    ["readPublishedAnnouncement", "app.announcements"],
    ["listPublishedSponsorLogos", "app.sponsor_logos"],
  ] as const)(
    "%s filters %s by state = 'PUBLISHED' (a literal or a bound parameter)",
    async (name, table) => {
      const statement = (await statementOf(callOf(name))).sent[0] as Sent;
      expect(normalize(statement.text)).toContain(table);
      expect(publishedCondition(statement)).toBe(true);
      // Neither DRAFT nor ARCHIVED is ever named as a value to select.
      expect(normalize(statement.text)).not.toMatch(/'draft'|'archived'/);
      expect(statement.values).not.toContain("DRAFT");
      expect(statement.values).not.toContain("ARCHIVED");
    },
  );

  it("an Entry Offering has no Publication State: its statement has no state filter on it", async () => {
    expect(await textOf("listEntryOfferings")).not.toMatch(/'published'/);
  });
});

describe("TC-API-009-008 order, bound parameter and DB clock (SPEC-110 §26.1 API-PUB-READ-005, API-PUB-005; DEV-DB-004)", () => {
  it("FAQ: ORDER BY sort_order ASC, public_ref ASC", async () => {
    const text = await textOf("listPublishedFaqs");
    expect(text).toMatch(/order by [^;]*sort_order( asc)?, [^;]*public_ref( asc)?/);
    expect(text).not.toMatch(/sort_order desc|public_ref desc/);
  });
  it("Announcement list: ORDER BY published_at DESC, public_ref DESC", async () => {
    expect(await textOf("listPublishedAnnouncements")).toMatch(
      /order by [^;]*published_at desc[^;]*public_ref desc/,
    );
  });
  it("Entry Offering: ORDER BY created_at ASC, public_ref ASC", async () => {
    const text = await textOf("listEntryOfferings");
    expect(text).toMatch(/order by [^;]*created_at( asc)?, [^;]*public_ref( asc)?/);
    expect(text).not.toMatch(/created_at desc|public_ref desc/);
  });
  it("Sponsor Logo: ORDER BY sort_order ASC, public_ref ASC", async () => {
    const text = await textOf("listPublishedSponsorLogos");
    expect(text).toMatch(/order by [^;]*sort_order( asc)?, [^;]*public_ref( asc)?/);
    expect(text).not.toMatch(/sort_order desc|public_ref desc/);
  });

  it("Announcement detail: the ref is a bound parameter (lower case as given), never in the SQL text", async () => {
    const statement = (await statementOf(callOf("readPublishedAnnouncement"))).sent[0] as Sent;
    expect(statement.values).toContain(REF);
    expect(statement.text.toLowerCase()).not.toContain(REF);
    expect(normalize(statement.text)).toMatch(/public_ref\s*=\s*\$\d+/);
  });
  it("Announcement detail: a hostile ref is a value, not SQL", async () => {
    const hostile = "x'; drop table app.announcements; --";
    const fake = recordingPool();
    await createPublicContentRepository(fake.pool)
      .readPublishedAnnouncement(hostile)
      .catch(() => undefined);
    for (const statement of fake.sent) expect(statement.text).not.toContain("drop table");
  });

  it("Entry Offering: the judgement time is the statement's own statement_timestamp(), no other clock", async () => {
    const text = await textOf("listEntryOfferings");
    expect(text).toContain("statement_timestamp()");
    expect(text).not.toMatch(WALL_CLOCKS);
  });
  it("only the Entry statement reads a clock", async () => {
    for (const [name] of CALLS.filter(([n]) => n !== "listEntryOfferings")) {
      const text = await textOf(name);
      expect(text, name).not.toMatch(WALL_CLOCKS);
      expect(text, name).not.toContain("statement_timestamp");
    }
  });
});

describe("TC-API-009-008 failure classification of a driver rejection (SPEC-110 §50/§51, DEV-DB-003)", () => {
  const noSqlstate = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), {
    code: "ECONNREFUSED",
  });
  const withSqlstate = (code: string) =>
    Object.assign(new Error("synthetic server error"), { code });

  it.each(CALLS)(
    "%s: a rejection without a SQLSTATE (ECONNREFUSED) is { status: 'unavailable' } and does not throw",
    async (_name, call) => {
      const repo = createPublicContentRepository(recordingPool(noSqlstate).pool);
      expect(await call(repo)).toEqual({ status: "unavailable" });
    },
  );

  it.each(["08006", "53300", "57P01"])(
    "%s (connection loss, too many connections, admin shutdown) is { status: 'unavailable' }",
    async (code) => {
      for (const [name, call] of CALLS)
        expect(
          await call(createPublicContentRepository(recordingPool(withSqlstate(code)).pool)),
          name,
        ).toEqual({ status: "unavailable" });
    },
  );

  it.each(["42P01", "23514", "57014"])(
    "%s (a defect, a constraint, a statement timeout) is rethrown, not turned into unavailable or an empty result",
    async (code) => {
      for (const [name, call] of CALLS) {
        const repo = createPublicContentRepository(recordingPool(withSqlstate(code)).pool);
        await expect(call(repo), name).rejects.toMatchObject({ code });
      }
    },
  );
});
