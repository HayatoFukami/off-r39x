// PR-L2-1b after #71: TC-DB-AUTH-001-010 (G1). provisionCurrentBusinessProfile builds its INSERT ... ON
// CONFLICT and its reselect from the Drizzle table declaration (DEV-DB-004), as the read and update of
// TC-API-007-010 do, and the statements keep their meaning: auth_subject is the only bound value, the
// conflict target is auth_subject and nothing is updated on conflict (DB-AUTH-001, AR-ID-004), the
// reselect is by the same subject, both run in one transaction, and a missing row is never re-created
// (REL-AUTH-005). No PostgreSQL: a recording pool answers in node-postgres's array row mode. What the
// database does with these statements (constraints, privileges, concurrency) is TC-DB-AUTH-001-004/005
// on a real PG17.
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createCurrentProfileRepository } from "../../packages/db/src/index.ts";

const SUBJECT = "00000000-0000-4000-8000-0000000000a1";
const REF = "00000000-0000-4000-8000-0000000000b1";
const PG_TIMESTAMP = "2026-01-02 03:04:05.678912+00";
const ISO = "2026-01-02T03:04:05.678Z";
const CONTROL = /^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)\b/;

type Sent = { text: string; values: unknown[] };
type QueryArgument = string | { text: string; rowMode?: string };

function textOf(query: QueryArgument): string {
  return typeof query === "string" ? query : query.text;
}
/** Lower case, no identifier quotes, single spaces: compares statements, not drizzle's formatting. */
function normalize(text: string): string {
  return text.replaceAll('"', "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Answers the n-th business statement with answers[n] (no rows once the list is used up). */
function recordingPool(answers: unknown[][][]) {
  const sent: Sent[] = [];
  const control: string[] = [];
  const answer = (query: QueryArgument, values: unknown[] = []) => {
    const text = textOf(query);
    if (CONTROL.test(text)) {
      control.push(text.split(" ")[0] ?? text);
      return { rows: [], rowCount: 0 };
    }
    const rows = answers[sent.length] ?? [];
    sent.push({ text, values });
    expect(typeof query === "string" ? undefined : query.rowMode).toBe("array");
    return { rows, rowCount: rows.length };
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
    connect: async () => client,
  };
  return { pool: pool as unknown as Pool, sent, control };
}

const INSERT =
  /^insert into app\.business_profiles \(id, public_ref, auth_subject, display_name, created_at, updated_at\) values \(default, default, \$1, default, default, default\) on conflict \(auth_subject\) do nothing returning public_ref, display_name, updated_at$/;
const RESELECT =
  /^select public_ref, display_name, updated_at from app\.business_profiles where ((app\.)?business_profiles\.)?auth_subject = \$1$/;
const FORBIDDEN = /\b(delete|do update|for update|for share|for no key update|for key share)\b/;

describe("TC-DB-AUTH-001-010 provision statements come from the Drizzle table and keep their meaning (DEV-DB-004, DB-AUTH-001, AR-ID-004, REL-AUTH-005)", () => {
  it("created: one INSERT ... ON CONFLICT (auth_subject) DO NOTHING RETURNING the three columns, auth_subject the only value, inside BEGIN / COMMIT", async () => {
    const fake = recordingPool([[[REF, null, PG_TIMESTAMP]]]);
    expect(
      await createCurrentProfileRepository(fake.pool).provisionCurrentBusinessProfile(SUBJECT),
    ).toEqual({
      status: "created",
      profile: { publicRef: REF, displayName: null, updatedAt: ISO },
    });
    expect(fake.sent).toHaveLength(1);
    const text = normalize(fake.sent[0]?.text ?? "");
    expect(text).toMatch(INSERT);
    expect(text).not.toMatch(FORBIDDEN);
    expect(fake.sent[0]?.values).toEqual([SUBJECT]);
    expect(fake.control).toEqual(["BEGIN", "SET", "COMMIT"]);
  });

  it("existing: the INSERT returns no row, then one reselect by the same subject in the same transaction returns the row unchanged", async () => {
    const fake = recordingPool([[], [[REF, "synthetic name", PG_TIMESTAMP]]]);
    expect(
      await createCurrentProfileRepository(fake.pool).provisionCurrentBusinessProfile(SUBJECT),
    ).toEqual({
      status: "existing",
      profile: { publicRef: REF, displayName: "synthetic name", updatedAt: ISO },
    });
    expect(fake.sent.map((statement) => normalize(statement.text))).toEqual([
      expect.stringMatching(INSERT),
      expect.stringMatching(RESELECT),
    ]);
    for (const statement of fake.sent) {
      expect(normalize(statement.text)).not.toMatch(FORBIDDEN);
      expect(statement.values).toEqual([SUBJECT]);
    }
    expect(fake.control).toEqual(["BEGIN", "SET", "COMMIT"]);
  });

  it("a reselect without exactly one row is never answered as a result and never re-inserts (REL-AUTH-005)", async () => {
    for (const reselect of [
      [],
      [
        [REF, null, PG_TIMESTAMP],
        [REF, null, PG_TIMESTAMP],
      ],
    ]) {
      const fake = recordingPool([[], reselect]);
      await expect(
        createCurrentProfileRepository(fake.pool).provisionCurrentBusinessProfile(SUBJECT),
      ).rejects.toThrow("Business Profile reselect cardinality violation");
      expect(fake.sent).toHaveLength(2);
      expect(fake.control).not.toContain("COMMIT");
    }
  });

  // As TC-API-007-010: updated_at keeps the year node-postgres's timestamptz parser reads.
  it.each([
    ["0001-01-02 03:04:05.678912+00", "0001-01-02T03:04:05.678Z"],
    ["2026-01-02 03:04:05.678912+09", "2026-01-01T18:04:05.678Z"],
  ])("updated_at %s keeps its year and instant: %s", async (pgText, iso) => {
    const created = await createCurrentProfileRepository(
      recordingPool([[[REF, null, pgText]]]).pool,
    ).provisionCurrentBusinessProfile(SUBJECT);
    expect(created).toEqual({
      status: "created",
      profile: { publicRef: REF, displayName: null, updatedAt: iso },
    });
    const existing = await createCurrentProfileRepository(
      recordingPool([[], [[REF, null, pgText]]]).pool,
    ).provisionCurrentBusinessProfile(SUBJECT);
    expect(existing).toEqual({
      status: "existing",
      profile: { publicRef: REF, displayName: null, updatedAt: iso },
    });
  });
});
