import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  catalogSatisfies,
  compareJournal,
  readSchemaState,
} from "../../packages/db/src/readiness.ts";
import { catalogQuery, requiredCatalog } from "../../packages/db/src/schema-contract.ts";
import { syntheticSqlstateError } from "../harness/db/fake-pool.ts";

// Pure functions and the read loop of the backward-compatible readiness (SPEC-180 INF-HLT-006,
// UCR-180-003). No database: the real-PostgreSQL behavior is in db/ops-readiness-compat.test.ts.

type Tuple = readonly unknown[];
type Catalog = Record<string, Tuple[]>;
const KEYS = ["schemas", "tables", "columns", "constraints", "indexes", "sequences"] as const;

const repoCatalog = (): Catalog => structuredClone(requiredCatalog) as unknown as Catalog;
const emptyCatalog = (): Catalog => Object.fromEntries(KEYS.map((key) => [key, []])) as Catalog;
const withKeys = (keys: Record<string, Tuple[]>): Catalog => ({ ...emptyCatalog(), ...keys });
const required = (catalog: Catalog) => catalog as unknown as Record<string, unknown[]>;

describe("TC-INF-HLT-006-005 compareJournal (INF-HLT-006 1, 2, 3, 4)", () => {
  const set = [
    { version: "0001_a", hash: "h1" },
    { version: "0002_b", hash: "h2" },
    { version: "0003_c", hash: "h3" },
  ];
  const row = (version: string, source_hash: string) => ({ version, source_hash });
  type Row = ReturnType<typeof row>;
  const same: [Row, Row, Row] = [row("0001_a", "h1"), row("0002_b", "h2"), row("0003_c", "h3")];

  it("TC-INF-HLT-006-005 classifies an empty journal as behind", () => {
    expect(compareJournal([], set)).toBe("behind");
  });
  it("TC-INF-HLT-006-005 classifies a journal equal to the set as same", () => {
    expect(compareJournal(same, set)).toBe("same");
  });
  it("TC-INF-HLT-006-005 classifies rows appended after the set as ahead", () => {
    expect(compareJournal([...same, row("0004_d", "h4")], set)).toBe("ahead");
    expect(compareJournal([...same, row("0004_d", "h4"), row("0005_e", "h5")], set)).toBe("ahead");
  });
  it("TC-INF-HLT-006-005 classifies a short journal whose rows match the set start as behind", () => {
    expect(compareJournal(same.slice(0, 2), set)).toBe("behind");
    expect(compareJournal(same.slice(0, 1), set)).toBe("behind");
  });
  it("TC-INF-HLT-006-005 classifies a differing hash, version, inserted row or missing row as mismatch", () => {
    // First row hash differs.
    expect(compareJournal([row("0001_a", "x"), ...same.slice(1)], set)).toBe("mismatch");
    // Last bundled row hash differs, even with a later row after it.
    expect(
      compareJournal([...same.slice(0, 2), row("0003_c", "x"), row("0004_d", "h4")], set),
    ).toBe("mismatch");
    // Version differs, hash equal.
    expect(compareJournal([row("0001_z", "h1"), ...same.slice(1)], set)).toBe("mismatch");
    // A row inserted between bundled rows.
    expect(compareJournal([same[0], row("0001_a_z", "hz"), same[1], same[2]], set)).toBe(
      "mismatch",
    );
    // A bundled row missing in the middle (journal as long as the set).
    expect(compareJournal([same[0], same[2], row("0004_d", "h4")], set)).toBe("mismatch");
    // The first row missing.
    expect(compareJournal(same.slice(1), set)).toBe("mismatch");
    expect(compareJournal([...same.slice(1), row("0004_d", "h4")], set)).toBe("mismatch");
  });
  it("TC-INF-HLT-006-005 does not reorder either side", () => {
    expect(compareJournal([same[1], same[0], same[2]], set)).toBe("mismatch");
  });
});

describe("TC-INF-HLT-006-005 catalogSatisfies contains (INF-HLT-006 4)", () => {
  it("TC-INF-HLT-006-005 accepts an identical catalog and additional tuples, in any order", () => {
    const live = repoCatalog();
    expect(catalogSatisfies(live, required(repoCatalog()), "contains")).toBe(true);
    for (const key of KEYS) live[key]?.push(["synthetic", `extra_${key}`]);
    expect(catalogSatisfies(live, required(repoCatalog()), "contains")).toBe(true);
    for (const key of KEYS) live[key]?.reverse();
    expect(catalogSatisfies(live, required(repoCatalog()), "contains")).toBe(true);
  });
  it("TC-INF-HLT-006-005 rejects a missing required tuple in every key", () => {
    for (const key of KEYS) {
      const live = repoCatalog();
      expect(live[key]?.length, key).toBeGreaterThan(0);
      live[key]?.pop();
      expect(catalogSatisfies(live, required(repoCatalog()), "contains"), key).toBe(false);
    }
  });
  it("TC-INF-HLT-006-005 rejects a one-element difference in a required tuple", () => {
    // indisvalid true -> false
    let live = repoCatalog();
    let tuple = live.indexes?.[0] as unknown[];
    tuple[2] = false;
    expect(catalogSatisfies(live, required(repoCatalog()), "contains")).toBe(false);
    // default expression changed
    live = repoCatalog();
    tuple = live.columns?.find((t) => typeof t[6] === "string") as unknown[];
    expect(tuple).toBeDefined();
    tuple[6] = "'changed'::text";
    expect(catalogSatisfies(live, required(repoCatalog()), "contains")).toBe(false);
    // SET NOT NULL on a required nullable column (attnotnull false -> true)
    live = repoCatalog();
    tuple = live.columns?.find((t) => t[3] === false) as unknown[];
    expect(tuple).toBeDefined();
    tuple[3] = true;
    expect(catalogSatisfies(live, required(repoCatalog()), "contains")).toBe(false);
    // column type changed
    live = repoCatalog();
    tuple = live.columns?.[0] as unknown[];
    tuple[2] = "synthetic_other_type";
    expect(catalogSatisfies(live, required(repoCatalog()), "contains")).toBe(false);
    // table owner changed
    live = repoCatalog();
    tuple = live.tables?.[0] as unknown[];
    tuple[2] = "synthetic_other_owner";
    expect(catalogSatisfies(live, required(repoCatalog()), "contains")).toBe(false);
  });
  it("TC-INF-HLT-006-005 treats a null key as an empty list and rejects a non-object or missing key", () => {
    const live = repoCatalog() as unknown as Record<string, unknown>;
    live.sequences = null;
    expect(catalogSatisfies(live, required(repoCatalog()), "contains")).toBe(false);
    expect(
      catalogSatisfies(
        { ...emptyCatalog(), sequences: null },
        required(emptyCatalog()),
        "contains",
      ),
    ).toBe(true);
    expect(
      catalogSatisfies(
        { ...emptyCatalog(), sequences: null },
        required(withKeys({ sequences: [] })),
        "contains",
      ),
    ).toBe(true);
    for (const value of [null, undefined, "catalog", 5, true])
      expect(catalogSatisfies(value, required(repoCatalog()), "contains")).toBe(false);
    const missing = repoCatalog() as unknown as Record<string, unknown>;
    delete missing.indexes;
    expect(catalogSatisfies(missing, required(repoCatalog()), "contains")).toBe(false);
  });
});

describe("TC-INF-HLT-006-005 catalogSatisfies convalidated (G-d-11)", () => {
  const notValid = ["t", "c", "c", "CHECK ((x > 0)) NOT VALID", false, false, false];
  const validated = ["t", "c", "c", "CHECK ((x > 0))", true, false, false];
  const check = (requiredTuple: Tuple, liveTuple: Tuple, mode: "exact" | "contains") =>
    catalogSatisfies(
      withKeys({ constraints: [liveTuple] }),
      required(withKeys({ constraints: [requiredTuple] })),
      mode,
    );

  it("TC-INF-HLT-006-005 (i) accepts a required NOT VALID constraint that is now validated", () => {
    expect(check(notValid, validated, "contains")).toBe(true);
    expect(
      check(
        ["t", "c", "c", "CHECK (x > 0) NOT VALID", false, false, false],
        ["t", "c", "c", "CHECK (x > 0)", true, false, false],
        "contains",
      ),
    ).toBe(true);
  });
  it("TC-INF-HLT-006-005 (ii) rejects a required validated constraint that is now NOT VALID", () => {
    expect(check(validated, notValid, "contains")).toBe(false);
    expect(
      check(validated, ["t", "c", "c", "CHECK ((x > 0))", false, false, false], "contains"),
    ).toBe(false);
  });
  it("TC-INF-HLT-006-005 (iii) rejects a validated constraint whose body, type or deferral differs", () => {
    expect(
      check(notValid, ["t", "c", "c", "CHECK ((x > 1))", true, false, false], "contains"),
    ).toBe(false);
    expect(
      check(notValid, ["t", "c", "u", "CHECK ((x > 0))", true, false, false], "contains"),
    ).toBe(false);
    expect(check(notValid, ["t", "c", "c", "CHECK ((x > 0))", true, true, false], "contains")).toBe(
      false,
    );
    expect(check(notValid, ["t", "c", "c", "CHECK ((x > 0))", true, false, true], "contains")).toBe(
      false,
    );
    expect(
      check(notValid, ["t", "d", "c", "CHECK ((x > 0))", true, false, false], "contains"),
    ).toBe(false);
    expect(
      check(notValid, ["u", "c", "c", "CHECK ((x > 0))", true, false, false], "contains"),
    ).toBe(false);
  });
  it("TC-INF-HLT-006-005 (iv) rejects when the live definition still ends in NOT VALID or the required one does not", () => {
    expect(
      check(notValid, ["t", "c", "c", "CHECK ((x > 0)) NOT VALID", true, false, false], "contains"),
    ).toBe(false);
    // required says unvalidated but its definition carries no NOT VALID suffix
    expect(
      check(["t", "c", "c", "CHECK ((x > 0))", false, false, false], validated, "contains"),
    ).toBe(false);
  });
  it("TC-INF-HLT-006-005 (v) never relaxes exact mode", () => {
    expect(check(notValid, validated, "exact")).toBe(false);
    expect(check(notValid, notValid, "exact")).toBe(true);
  });
  it("TC-INF-HLT-006-005 (vi) applies the exception to constraints only", () => {
    const live = repoCatalog();
    const index = live.indexes?.[0] as unknown[];
    const base = repoCatalog();
    (base.indexes?.[0] as unknown[])[2] = false;
    expect(index[2]).toBe(true);
    expect(catalogSatisfies(live, required(base), "contains")).toBe(false);
    // Other key too: a column attribute false -> true is not relaxed.
    const liveColumns = repoCatalog();
    const baseColumns = repoCatalog();
    const nullable = liveColumns.columns?.findIndex((t) => t[3] === false) as number;
    (liveColumns.columns?.[nullable] as unknown[])[3] = true;
    expect(catalogSatisfies(liveColumns, required(baseColumns), "contains")).toBe(false);
  });
});

describe("TC-INF-HLT-006-005 catalogSatisfies added NOT NULL columns (G-d-3)", () => {
  const baseTables = [["t", "r", "owner", false]];
  const baseColumns = [["t", "a", "integer", true, "", "", null]];
  const verdict = (added: Tuple, tables: Tuple[] = baseTables) =>
    catalogSatisfies(
      withKeys({ tables, columns: [...baseColumns, added] }),
      required(withKeys({ tables: baseTables, columns: baseColumns })),
      "contains",
    );

  it("TC-INF-HLT-006-005 rejects a NOT NULL column without default, identity or generation on a required table", () => {
    expect(verdict(["t", "x", "text", true, "", "", null])).toBe(false);
  });
  it("TC-INF-HLT-006-005 accepts an added column with a default, identity, generation or nullability", () => {
    expect(verdict(["t", "x", "text", true, "", "", "'x'::text"])).toBe(true);
    expect(verdict(["t", "x", "bigint", true, "a", "", null])).toBe(true);
    expect(verdict(["t", "x", "bigint", true, "d", "", null])).toBe(true);
    expect(verdict(["t", "x", "integer", true, "", "s", "(a + 1)"])).toBe(true);
    expect(verdict(["t", "x", "text", false, "", "", null])).toBe(true);
  });
  it("TC-INF-HLT-006-005 accepts a NOT NULL column on a table that is not required", () => {
    expect(
      verdict(
        ["other", "x", "text", true, "", "", null],
        [...baseTables, ["other", "r", "owner", false]],
      ),
    ).toBe(true);
  });
  it("TC-INF-HLT-006-005 rejects the not-yet-required column once it is SET NOT NULL (old artifact view)", () => {
    // business_profiles.synthetic_expand_note is not in the required catalog; after a later
    // release made it NOT NULL it is a NOT NULL column without default on a required table.
    const live = repoCatalog();
    live.columns?.push(["business_profiles", "synthetic_expand_note", "text", true, "", "", null]);
    expect(catalogSatisfies(live, required(repoCatalog()), "contains")).toBe(false);
    const nullable = repoCatalog();
    nullable.columns?.push([
      "business_profiles",
      "synthetic_expand_note",
      "text",
      false,
      "",
      "",
      null,
    ]);
    expect(catalogSatisfies(nullable, required(repoCatalog()), "contains")).toBe(true);
  });
});

describe("TC-INF-HLT-006-005 catalogSatisfies exact", () => {
  it("TC-INF-HLT-006-005 keeps the strict equality: an additional tuple or a reordering is not equal", () => {
    expect(catalogSatisfies(repoCatalog(), required(repoCatalog()), "exact")).toBe(true);
    const extra = repoCatalog();
    extra.indexes?.push(["synthetic", "CREATE INDEX synthetic", true, true, true]);
    expect(catalogSatisfies(extra, required(repoCatalog()), "exact")).toBe(false);
    const removed = repoCatalog();
    removed.constraints?.pop();
    expect(catalogSatisfies(removed, required(repoCatalog()), "exact")).toBe(false);
    const nulled = repoCatalog() as unknown as Record<string, unknown>;
    nulled.sequences = null;
    expect(catalogSatisfies(nulled, required(repoCatalog()), "exact")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// readSchemaState: journal -> catalog -> journal, outside a transaction, one SPEC-150 section 11
// 55P03 retry budget (4 attempts, 50 ms full jitter, 5 s from the first attempt).
// ---------------------------------------------------------------------------------------------

type Step = "ok" | "mismatch" | "55P03" | "other";
const T0 = 5_000_000;
const JOURNAL_A = [{ version: "0001_a", source_hash: "h1" }];
const JOURNAL_B = [
  { version: "0001_a", source_hash: "h1" },
  { version: "0002_b", source_hash: "h2" },
];
const CATALOG = { schemas: [["app", "owner"]] };

function fakeClient(
  /** One entry per attempt: which read fails/differs, and what `now` becomes during the attempt. */
  attempts: readonly { step: Step; at?: "journal1" | "catalog" | "journal2"; now?: number }[],
  clock: { now: number },
) {
  const queries: string[] = [];
  let attempt = -1;
  // The read the next journal statement is: the loop reads journal, catalog, journal.
  let next: "journal1" | "journal2" = "journal1";
  const other = Object.assign(new Error("synthetic-other"), { code: "XX000" });
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql !== catalogQuery && !/app\.schema_migrations/.test(sql))
        throw new Error(`unexpected statement: ${sql}`);
      const kind: "journal1" | "catalog" | "journal2" = sql === catalogQuery ? "catalog" : next;
      if (kind === "journal1") attempt++;
      const plan = attempts[attempt] ?? { step: "ok" as Step };
      const target = plan.at ?? "journal1";
      if (plan.now !== undefined && kind === target) clock.now = plan.now;
      if (kind === target && (plan.step === "55P03" || plan.step === "other")) {
        next = "journal1"; // a failed read starts a new attempt
        throw plan.step === "55P03" ? syntheticSqlstateError("55P03") : other;
      }
      if (kind === "journal1") next = "journal2";
      if (kind === "journal2") next = "journal1";
      if (kind === "catalog") return { rows: [{ catalog: CATALOG }], rowCount: 1 };
      if (kind === "journal2" && plan.step === "mismatch")
        return { rows: JOURNAL_B, rowCount: JOURNAL_B.length };
      return { rows: JOURNAL_A, rowCount: JOURNAL_A.length };
    },
  };
  return { client: client as never, queries, other, attempts: () => attempt + 1 };
}

describe("TC-INF-HLT-006-009 readSchemaState retry budget (REL-DB-011, INF-HLT-006)", () => {
  const clock = { now: T0 };
  const drive = async <T>(promise: Promise<T>): Promise<T> => {
    let settled = false;
    const tracked = promise.finally(() => {
      settled = true;
    });
    tracked.catch(() => undefined);
    // Sleeps between attempts use the faked timer; `now` is controlled by the scenario, so the
    // timer is advanced without moving the clock the budget is measured on.
    while (!settled) await vi.advanceTimersByTimeAsync(500);
    return tracked;
  };
  const run = async (client: unknown) => {
    clock.now = T0;
    return drive(readSchemaState(client as never));
  };

  const useFake = () => {
    clock.now = T0;
    vi.spyOn(performance, "now").mockImplementation(() => clock.now);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  };
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const noBegin = (queries: readonly string[]) =>
    expect(queries.filter((sql) => /^\s*(BEGIN|START\s+TRANSACTION)/i.test(sql))).toEqual([]);

  it("TC-INF-HLT-006-009 reads journal, catalog, journal in this order, with no BEGIN, and returns the consistent state", async () => {
    useFake();
    const { client, queries } = fakeClient([{ step: "ok" }], clock);
    const state = await run(client);
    expect(state).toEqual({ status: "consistent", journal: JOURNAL_A, catalog: CATALOG });
    expect(queries).toHaveLength(3);
    expect(queries[0]).toMatch(/app\.schema_migrations/);
    expect(queries[0]).toMatch(/ORDER BY version COLLATE "C"/);
    expect(queries[1]).toBe(catalogQuery);
    expect(queries[2]).toBe(queries[0]);
    noBegin(queries);
  });

  it("TC-INF-HLT-006-009 stops after four attempts when every attempt hits 55P03", async () => {
    useFake();
    for (const at of ["journal1", "catalog", "journal2"] as const) {
      const fake = fakeClient(Array(8).fill({ step: "55P03", at }), clock);
      expect(await run(fake.client), at).toEqual({ status: "exhausted" });
      expect(fake.attempts(), at).toBe(4);
      noBegin(fake.queries);
    }
  });

  it("TC-INF-HLT-006-009 returns consistent when the fourth attempt succeeds after three 55P03", async () => {
    useFake();
    const fake = fakeClient(
      [
        { step: "55P03" },
        { step: "55P03", at: "catalog" },
        { step: "55P03", at: "journal2" },
        { step: "ok" },
      ],
      clock,
    );
    expect(await run(fake.client)).toEqual({
      status: "consistent",
      journal: JOURNAL_A,
      catalog: CATALOG,
    });
    expect(fake.attempts()).toBe(4);
    // The last attempt is a whole journal, catalog, journal read.
    expect(fake.queries.slice(-3)).toEqual([fake.queries[0], catalogQuery, fake.queries[0]]);
    noBegin(fake.queries);
  });

  it("TC-INF-HLT-006-009 treats a journal mismatch as a retry and shares one budget with 55P03", async () => {
    useFake();
    // mismatch, then consistent
    let fake = fakeClient([{ step: "mismatch", at: "journal2" }, { step: "ok" }], clock);
    expect((await run(fake.client)).status).toBe("consistent");
    expect(fake.attempts()).toBe(2);
    // mismatch, 55P03, mismatch, consistent: four attempts in total, not four per cause
    fake = fakeClient(
      [
        { step: "mismatch", at: "journal2" },
        { step: "55P03", at: "catalog" },
        { step: "mismatch", at: "journal2" },
        { step: "ok" },
      ],
      clock,
    );
    expect((await run(fake.client)).status).toBe("consistent");
    expect(fake.attempts()).toBe(4);
    // mismatch, mismatch, 55P03, mismatch: exhausted after the fourth attempt, no fifth
    fake = fakeClient(
      [
        { step: "mismatch", at: "journal2" },
        { step: "mismatch", at: "journal2" },
        { step: "55P03", at: "journal2" },
        { step: "mismatch", at: "journal2" },
        { step: "ok" },
      ],
      clock,
    );
    expect(await run(fake.client)).toEqual({ status: "exhausted" });
    expect(fake.attempts()).toBe(4);
    // every attempt mismatches
    fake = fakeClient(Array(8).fill({ step: "mismatch", at: "journal2" }), clock);
    expect(await run(fake.client)).toEqual({ status: "exhausted" });
    expect(fake.attempts()).toBe(4);
    noBegin(fake.queries);
  });

  it("TC-INF-HLT-006-009 does not read again when the next delay would pass the 5 s budget", async () => {
    useFake();
    // Control: 100 ms of the 5 s are left, the first delay (25 ms with random 0.5) fits.
    let fake = fakeClient([{ step: "55P03", now: T0 + 4900 }, { step: "ok" }], clock);
    expect((await run(fake.client)).status).toBe("consistent");
    expect(fake.attempts()).toBe(2);
    // 10 ms are left, the delay does not fit: exhausted after the first attempt (fewer than four).
    fake = fakeClient([{ step: "55P03", now: T0 + 4990 }, { step: "ok" }], clock);
    expect(await run(fake.client)).toEqual({ status: "exhausted" });
    expect(fake.attempts()).toBe(1);
    // Same for a journal mismatch (it uses the same budget).
    fake = fakeClient(
      [{ step: "mismatch", at: "journal2", now: T0 + 4990 }, { step: "ok" }],
      clock,
    );
    expect(await run(fake.client)).toEqual({ status: "exhausted" });
    expect(fake.attempts()).toBe(1);
  });

  it("TC-INF-HLT-006-009 returns exhausted when a later attempt ends after 5 s even though it is consistent", async () => {
    useFake();
    const fake = fakeClient(
      [{ step: "55P03" }, { step: "ok", now: T0 + 5001, at: "journal2" }],
      clock,
    );
    expect(await run(fake.client)).toEqual({ status: "exhausted" });
    expect(fake.attempts()).toBe(2);
    // Control: the same second attempt finishing inside the budget is consistent.
    const inside = fakeClient(
      [{ step: "55P03" }, { step: "ok", now: T0 + 4000, at: "journal2" }],
      clock,
    );
    expect((await run(inside.client)).status).toBe("consistent");
  });

  it("TC-INF-HLT-006-009 does not cut the first attempt even if it runs past 5 s", async () => {
    useFake();
    const fake = fakeClient([{ step: "ok", now: T0 + 7000, at: "journal2" }], clock);
    expect((await run(fake.client)).status).toBe("consistent");
  });

  it("TC-INF-HLT-006-009 rethrows an error that is not 55P03", async () => {
    useFake();
    for (const at of ["journal1", "catalog", "journal2"] as const) {
      const fake = fakeClient([{ step: "other", at }], clock);
      clock.now = T0;
      await expect(drive(readSchemaState(fake.client)), at).rejects.toBe(fake.other);
      expect(fake.attempts(), at).toBe(1);
    }
    // After a 55P03 retry the other error is still rethrown, not retried.
    const later = fakeClient([{ step: "55P03" }, { step: "other", at: "catalog" }], clock);
    clock.now = T0;
    await expect(drive(readSchemaState(later.client))).rejects.toBe(later.other);
    expect(later.attempts()).toBe(2);
  });
});
