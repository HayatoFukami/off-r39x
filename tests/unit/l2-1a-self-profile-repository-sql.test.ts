// TC-API-007-010 (PR #66 round 6): the self profile repository builds its SELECT and UPDATE ... RETURNING
// from the Drizzle table declaration (DEV-DB-004: raw SQL only where Drizzle cannot express the
// statement), and the statements keep their meaning: the row is selected by the verified Auth Subject
// only, the UPDATE sets display_name and updated_at = transaction_timestamp() in the same statement
// (DB-TIM-003), the same three columns come back, and there is no INSERT, ON CONFLICT, DELETE or row
// lock. No PostgreSQL: a recording pool answers in node-postgres's array row mode. What the database
// does with these statements (constraints, privileges, timestamps) is TC-API-007-005 on a real PG17.
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createCurrentProfileRepository } from "../../packages/db/src/index.ts";

const SUBJECT = "00000000-0000-4000-8000-0000000000a1";
const REF = "00000000-0000-4000-8000-0000000000b1";
// node-postgres text form of a timestamptz with microseconds; the response truncates to milliseconds.
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

function recordingPool(rows: unknown[][]) {
  const sent: Sent[] = [];
  const control: string[] = [];
  const releases: unknown[] = [];
  const answer = (query: QueryArgument, values: unknown[] = []) => {
    const text = textOf(query);
    if (CONTROL.test(text)) {
      control.push(text.split(" ")[0] ?? text);
      return { rows: [], rowCount: 0 };
    }
    sent.push({ text, values });
    // Drizzle asks for array rows when it maps selected fields.
    expect(typeof query === "string" ? undefined : query.rowMode).toBe("array");
    return { rows, rowCount: rows.length };
  };
  const client = {
    query: async (query: QueryArgument, values?: unknown[]) => answer(query, values),
    on: () => client,
    once: () => client,
    removeListener: () => client,
    release: (destroy?: unknown) => {
      releases.push(destroy);
    },
  };
  const pool = {
    query: async (query: QueryArgument, values?: unknown[]) => answer(query, values),
    connect: async () => client,
  };
  return { pool: pool as unknown as Pool, sent, control, releases };
}

const FORBIDDEN =
  /\b(insert|on conflict|delete|for update|for share|for no key update|for key share)\b/;

describe("TC-API-007-010 self profile repository statements come from the Drizzle table and keep their meaning (DEV-DB-004, DB-TIM-003, AR-OWN-006)", () => {
  it("read: one SELECT of public_ref, display_name, updated_at by auth_subject, mapped to the profile", async () => {
    const fake = recordingPool([[REF, "synthetic name", PG_TIMESTAMP]]);
    const repo = createCurrentProfileRepository(fake.pool);
    expect(await repo.readCurrentBusinessProfile(SUBJECT)).toEqual({
      status: "found",
      profile: { publicRef: REF, displayName: "synthetic name", updatedAt: ISO },
    });
    expect(fake.sent).toHaveLength(1);
    const [statement] = fake.sent;
    const text = normalize(statement?.text ?? "");
    expect(text).toMatch(
      /^select public_ref, display_name, updated_at from app\.business_profiles where ((app\.)?business_profiles\.)?auth_subject = \$1$/,
    );
    expect(text).not.toMatch(FORBIDDEN);
    expect(statement?.values).toEqual([SUBJECT]);
    // A plain read on the pool: no transaction is opened for it.
    expect(fake.control).toEqual([]);
  });

  it("read: no row is not_found, and a NULL display name stays null", async () => {
    expect(
      await createCurrentProfileRepository(recordingPool([]).pool).readCurrentBusinessProfile(
        SUBJECT,
      ),
    ).toEqual({ status: "not_found" });
    expect(
      await createCurrentProfileRepository(
        recordingPool([[REF, null, PG_TIMESTAMP]]).pool,
      ).readCurrentBusinessProfile(SUBJECT),
    ).toEqual({ status: "found", profile: { publicRef: REF, displayName: null, updatedAt: ISO } });
  });

  it("read: more than one row is a cardinality violation, not a result", async () => {
    const fake = recordingPool([
      [REF, null, PG_TIMESTAMP],
      [REF, null, PG_TIMESTAMP],
    ]);
    await expect(
      createCurrentProfileRepository(fake.pool).readCurrentBusinessProfile(SUBJECT),
    ).rejects.toThrow("Business Profile cardinality violation");
  });

  it("update: one UPDATE setting display_name and updated_at = transaction_timestamp() by auth_subject, RETURNING the three columns, inside BEGIN / COMMIT", async () => {
    const fake = recordingPool([[REF, "synthetic name", PG_TIMESTAMP]]);
    const repo = createCurrentProfileRepository(fake.pool);
    expect(await repo.updateCurrentBusinessProfile(SUBJECT, "synthetic name")).toEqual({
      status: "updated",
      profile: { publicRef: REF, displayName: "synthetic name", updatedAt: ISO },
    });
    expect(fake.sent).toHaveLength(1);
    const [statement] = fake.sent;
    const text = normalize(statement?.text ?? "");
    expect(text).toMatch(
      /^update app\.business_profiles set display_name = \$1, updated_at = transaction_timestamp\(\) where ((app\.)?business_profiles\.)?auth_subject = \$2 returning public_ref, display_name, updated_at$/,
    );
    expect(text).not.toMatch(FORBIDDEN);
    expect(statement?.values).toEqual(["synthetic name", SUBJECT]);
    expect(fake.control).toEqual(["BEGIN", "SET", "COMMIT"]);
    expect(fake.releases).toEqual([false]);
  });

  it("update: null clears the name, no row is not_found, and several rows are a cardinality violation", async () => {
    const cleared = recordingPool([[REF, null, PG_TIMESTAMP]]);
    expect(
      await createCurrentProfileRepository(cleared.pool).updateCurrentBusinessProfile(
        SUBJECT,
        null,
      ),
    ).toEqual({
      status: "updated",
      profile: { publicRef: REF, displayName: null, updatedAt: ISO },
    });
    expect(cleared.sent[0]?.values).toEqual([null, SUBJECT]);

    expect(
      await createCurrentProfileRepository(recordingPool([]).pool).updateCurrentBusinessProfile(
        SUBJECT,
        "synthetic name",
      ),
    ).toEqual({ status: "not_found" });

    await expect(
      createCurrentProfileRepository(
        recordingPool([
          [REF, null, PG_TIMESTAMP],
          [REF, null, PG_TIMESTAMP],
        ]).pool,
      ).updateCurrentBusinessProfile(SUBJECT, "synthetic name"),
    ).rejects.toThrow("Business Profile cardinality violation");
  });

  // PR #71 review: drizzle's own timestamptz mapping is `new Date(text)`, which reads a year below
  // 0100 as 19xx / 20xx (V8's legacy date parsing). updated_at must keep its year as node-postgres's
  // own timestamptz parser does, on read and on update.
  it.each([
    ["0001-01-02 03:04:05.678912+00", "0001-01-02T03:04:05.678Z"],
    ["0099-12-31 23:59:59.999+00", "0099-12-31T23:59:59.999Z"],
    ["1000-01-01 00:00:00+00", "1000-01-01T00:00:00.000Z"],
    ["2026-01-02 03:04:05.678912+09", "2026-01-01T18:04:05.678Z"],
  ])("updated_at %s keeps its year and instant: %s", async (pgText, iso) => {
    const read = await createCurrentProfileRepository(
      recordingPool([[REF, null, pgText]]).pool,
    ).readCurrentBusinessProfile(SUBJECT);
    expect(read).toEqual({
      status: "found",
      profile: { publicRef: REF, displayName: null, updatedAt: iso },
    });
    const updated = await createCurrentProfileRepository(
      recordingPool([[REF, null, pgText]]).pool,
    ).updateCurrentBusinessProfile(SUBJECT, null);
    expect(updated).toEqual({
      status: "updated",
      profile: { publicRef: REF, displayName: null, updatedAt: iso },
    });
  });

  // PR #71 review: drizzle wraps only the driver's rejection in DrizzleQueryError; an error while it
  // maps a row the database did answer is thrown as it is. Such an error is a code defect, not a DB
  // outage, so the read must not type it as unavailable (503) just because it has no SQLSTATE: both
  // read and update throw it, and the HTTP boundary answers 500 on GET and PATCH alike.
  it("an error while drizzle maps the answered rows is thrown on read and update, not typed as unavailable", async () => {
    // A row that is not an array makes drizzle's row mapping throw a TypeError without a code.
    const read = createCurrentProfileRepository(recordingPool([null as unknown as unknown[]]).pool);
    const readError = await read.readCurrentBusinessProfile(SUBJECT).then(
      (value) => ({ resolved: value }),
      (error: unknown) => error,
    );
    expect(readError).toBeInstanceOf(TypeError);
    expect(readError).not.toHaveProperty("code");

    const update = createCurrentProfileRepository(
      recordingPool([null as unknown as unknown[]]).pool,
    );
    await expect(update.updateCurrentBusinessProfile(SUBJECT, "x")).rejects.toBeInstanceOf(
      TypeError,
    );
  });

  it("a driver error keeps its SQLSTATE through Drizzle: 23514 on the UPDATE is rethrown as the driver's own error", async () => {
    const failure = Object.assign(new Error("synthetic-check-violation"), { code: "23514" });
    const fake = recordingPool([]);
    const pool = fake.pool as unknown as {
      connect: () => Promise<{ query: (q: QueryArgument) => Promise<unknown> }>;
    };
    const connect = pool.connect;
    pool.connect = async () => {
      const client = await connect();
      const query = client.query;
      client.query = async (q: QueryArgument) => {
        if (!CONTROL.test(textOf(q))) throw failure;
        return query(q);
      };
      return client;
    };
    await expect(
      createCurrentProfileRepository(fake.pool).updateCurrentBusinessProfile(SUBJECT, "x"),
    ).rejects.toBe(failure);
  });
});
