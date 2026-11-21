import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROUTES } from "../../apps/api/src/api/routes.ts";
import { parseInitialDataInput } from "../../packages/db/src/initial-data/input.ts";
import {
  classifySeedFailure,
  outcomeExitCode,
  outcomeLogFields,
} from "../../packages/db/src/initial-data/seed.ts";
import { createLogger, EVENT_NAMES } from "../../packages/observability/src/index.ts";
import {
  buildInitialDataInput,
  type InitialDataInput,
  newMarker,
  sensitiveValues,
} from "../harness/db/initial-data.ts";

// PR-SEED C1 (SPEC-170 §22.1 TST-SEED-001/003/005, SPEC-100 §13.5 DB-SEED-003, SPEC-180 §45.3
// INF-SEED-001/002/004/005/006). Input values are synthetic. Every rejection must carry an error code
// only: no input value, key name or parser message (INF-SEED-005, TST-UNT-003).

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const INVALID = { ok: false, errorCode: "INITIAL_DATA_INPUT_INVALID" };
const MISSING = { ok: false, errorCode: "INITIAL_DATA_INPUT_MISSING" };

type Mutator = (input: InitialDataInput) => unknown;
const offering0 = (input: InitialDataInput) =>
  input.entry_ticket_offerings[0] as Record<string, unknown>;

function expectRejected(raw: string | undefined, expected: object, secrets: string[]) {
  const result = parseInitialDataInput(raw);
  expect(result).toEqual(expected);
  expect(Object.keys(result).sort()).toEqual(["errorCode", "ok"]);
  const text = JSON.stringify(result);
  for (const secret of secrets) expect(text).not.toContain(secret);
}

describe("TC-TST-SEED-001-004 fields the command never accepts as input (DB-SEED-003)", () => {
  const forbidden: [string, unknown][] = [
    ["sale_control_state", "ENABLED"],
    ["held_quantity", 0],
    ["committed_quantity", 0],
    ["id", 1],
    ["public_ref", "00000000-0000-4000-8000-000000000001"],
    ["event_id", 1],
    ["business_timezone", "Asia/Tokyo"],
    ["created_at", "2030-01-01T00:00:00Z"],
    ["updated_at", "2030-01-01T00:00:00Z"],
  ];

  it("TC-TST-SEED-001-004 the baseline input is accepted, so each rejection below is caused by the key", () => {
    expect(parseInitialDataInput(JSON.stringify(buildInitialDataInput())).ok).toBe(true);
  });

  for (const [key, value] of forbidden) {
    it(`TC-TST-SEED-001-004 ${key} in the Event object is rejected without echoing the value`, () => {
      const input = buildInitialDataInput();
      input.event[key] = value;
      expectRejected(JSON.stringify(input), INVALID, [...sensitiveValues(input)]);
    });
    it(`TC-TST-SEED-001-004 ${key} in an Offering object is rejected without echoing the value`, () => {
      const input = buildInitialDataInput();
      offering0(input)[key] = value;
      expectRejected(JSON.stringify(input), INVALID, [...sensitiveValues(input)]);
    });
  }

  it("TC-TST-SEED-001-004 the second Offering is validated as strictly as the first", () => {
    const input = buildInitialDataInput();
    (input.entry_ticket_offerings[1] as Record<string, unknown>).sale_control_state = "ENABLED";
    expectRejected(JSON.stringify(input), INVALID, sensitiveValues(input));
  });
});

describe("TC-TST-SEED-003-001 input validation (DB-SEED-003: strict, same conditions as the CHECKs)", () => {
  const accepted: [string, Mutator][] = [
    ["every column set", () => buildInitialDataInput()],
    ["nullable columns left out", () => buildInitialDataInput({ variant: "minimal" })],
    [
      "nullable columns explicitly null",
      () =>
        buildInitialDataInput({
          event: {
            summary: null,
            starts_at: null,
            ends_at: null,
            venue_name: null,
            venue_details: null,
            access_information: null,
            participant_notices: null,
          },
          offering: () => ({ description: null, checkin_opens_at: null, checkin_closes_at: null }),
          variant: "minimal",
        }),
    ],
    [
      "a numeric offset and a millisecond fraction",
      () =>
        buildInitialDataInput({
          event: { starts_at: "2030-05-10T18:00:00.5+09:00", ends_at: "2030-05-10T21:00:00.123Z" },
        }),
    ],
    [
      "zero amount and capacity at the column limits",
      () =>
        buildInitialDataInput({
          offering: () => ({ unit_amount: 0, sales_capacity: 0, purchase_limit: 2147483647 }),
        }),
    ],
    [
      "capacity at the int4 maximum",
      () => buildInitialDataInput({ offering: () => ({ sales_capacity: 2147483647 }) }),
    ],
    [
      "an Event with only the start",
      () => buildInitialDataInput({ event: { ends_at: undefined } }),
    ],
    ["one Offering", () => buildInitialDataInput({ offeringCount: 1 })],
    // No CHECK on entry_ticket_offerings.name requires a non-empty value (DB-SEED-003: only the
    // database's own conditions are enforced; ck_events_name covers the Event name alone).
    [
      "an empty Offering name (the database has no such CHECK)",
      () => buildInitialDataInput({ offering: () => ({ name: "" }) }),
    ],
    ["many Offerings (no upper bound)", () => buildInitialDataInput({ offeringCount: 120 })],
  ];
  for (const [label, build] of accepted) {
    it(`TC-TST-SEED-003-001 accepts ${label}`, () => {
      const result = parseInitialDataInput(JSON.stringify(build(buildInitialDataInput())));
      expect(result.ok).toBe(true);
    });
  }

  const rejected: [string, Mutator][] = [
    ["an unknown top-level key", (i) => ({ ...i, extra: true })],
    ["an unknown Event key", (i) => ({ ...i, event: { ...i.event, extra: true } })],
    [
      "an unknown Offering key",
      (i) => ({
        ...i,
        entry_ticket_offerings: [
          { ...offering0(i), extra: true },
          ...i.entry_ticket_offerings.slice(1),
        ],
      }),
    ],
    ["a missing event", (i) => ({ entry_ticket_offerings: i.entry_ticket_offerings })],
    ["missing entry_ticket_offerings", (i) => ({ event: i.event })],
    ["an empty Offering array", (i) => ({ ...i, entry_ticket_offerings: [] })],
    [
      "an Offering object instead of an array",
      (i) => ({ ...i, entry_ticket_offerings: offering0(i) }),
    ],
    ["a string instead of the Offering array", (i) => ({ ...i, entry_ticket_offerings: "none" })],
    ["a non-object Offering element", (i) => ({ ...i, entry_ticket_offerings: [offering0(i), 3] })],
    ["a null Offering element", (i) => ({ ...i, entry_ticket_offerings: [null] })],
    ["an Event array", (i) => ({ ...i, event: [i.event] })],
    ["a null Event", (i) => ({ ...i, event: null })],
    ["an empty Event name", (i) => ({ ...i, event: { ...i.event, name: "" } })],
    ["a numeric Event name", (i) => ({ ...i, event: { ...i.event, name: 7 } })],
    ["a null Event name", (i) => ({ ...i, event: { ...i.event, name: null } })],
    [
      "an Event name that is a lone surrogate",
      (i) => ({ ...i, event: { ...i.event, name: "\ud800" } }),
    ],
    [
      "a lone surrogate in an optional Event text",
      (i) => ({ ...i, event: { ...i.event, venue_details: "x\udc00y" } }),
    ],
    [
      "a lone surrogate in an Offering description",
      (i) => ({ ...i, entry_ticket_offerings: [{ ...offering0(i), description: "\ud83d" }] }),
    ],
    [
      "an Event name containing a NUL character (PostgreSQL text cannot hold it)",
      (i) => ({ ...i, event: { ...i.event, name: "a\u0000b" } }),
    ],
    [
      "a NUL character in an Offering description",
      (i) => ({ ...i, entry_ticket_offerings: [{ ...offering0(i), description: "x\u0000y" }] }),
    ],
    [
      "an Event whose starts_at equals ends_at",
      (i) => ({
        ...i,
        event: { ...i.event, starts_at: "2030-05-10T18:00:00Z", ends_at: "2030-05-10T18:00:00Z" },
      }),
    ],
    [
      "an Event whose starts_at is after ends_at",
      (i) => ({
        ...i,
        event: { ...i.event, starts_at: "2030-05-10T18:00:00Z", ends_at: "2030-05-10T17:59:59Z" },
      }),
    ],
    [
      "an Event period equal only after the offsets are applied",
      (i) => ({
        ...i,
        event: {
          ...i.event,
          starts_at: "2030-05-10T18:00:00+09:00",
          ends_at: "2030-05-10T09:00:00Z",
        },
      }),
    ],
    [
      "sales_starts_at equal to sales_ends_at",
      (i) => ({
        ...i,
        entry_ticket_offerings: [
          {
            ...offering0(i),
            sales_starts_at: "2030-04-01T00:00:00Z",
            sales_ends_at: "2030-04-01T00:00:00Z",
          },
        ],
      }),
    ],
    [
      "sales_starts_at after sales_ends_at",
      (i) => ({
        ...i,
        entry_ticket_offerings: [
          {
            ...offering0(i),
            sales_starts_at: "2030-05-01T00:00:00Z",
            sales_ends_at: "2030-04-01T00:00:00Z",
          },
        ],
      }),
    ],
    [
      "checkin_opens_at equal to checkin_closes_at",
      (i) => ({
        ...i,
        entry_ticket_offerings: [
          {
            ...offering0(i),
            checkin_opens_at: "2030-05-10T16:30:00Z",
            checkin_closes_at: "2030-05-10T16:30:00Z",
          },
        ],
      }),
    ],
    [
      "checkin_opens_at after checkin_closes_at",
      (i) => ({
        ...i,
        entry_ticket_offerings: [
          {
            ...offering0(i),
            checkin_opens_at: "2030-05-10T17:30:00Z",
            checkin_closes_at: "2030-05-10T16:30:00Z",
          },
        ],
      }),
    ],
    ["a negative unit_amount", (i) => offeringWith(i, { unit_amount: -1 })],
    ["a negative sales_capacity", (i) => offeringWith(i, { sales_capacity: -1 })],
    ["a zero purchase_limit", (i) => offeringWith(i, { purchase_limit: 0 })],
    ["a purchase_limit above int4", (i) => offeringWith(i, { purchase_limit: 2147483648 })],
    ["a sales_capacity above int4", (i) => offeringWith(i, { sales_capacity: 2147483648 })],
    ["a fractional unit_amount", (i) => offeringWith(i, { unit_amount: 1.5 })],
    ["a string unit_amount", (i) => offeringWith(i, { unit_amount: "7351912" })],
    ["a null unit_amount", (i) => offeringWith(i, { unit_amount: null })],
    ["a boolean purchase_limit", (i) => offeringWith(i, { purchase_limit: true })],
    ["a lowercase currency", (i) => offeringWith(i, { currency: "jpy" })],
    ["a four letter currency", (i) => offeringWith(i, { currency: "JPYX" })],
    ["a two letter currency", (i) => offeringWith(i, { currency: "JP" })],
    ["a numeric currency", (i) => offeringWith(i, { currency: 392 })],
    ["a null Offering name", (i) => offeringWith(i, { name: null })],
    [
      "a timestamp without an offset",
      (i) => offeringWith(i, { sales_starts_at: "2030-04-01T00:00:00" }),
    ],
    ["a date-only timestamp", (i) => offeringWith(i, { sales_starts_at: "2030-04-01" })],
    [
      "a non-existent calendar date",
      (i) => offeringWith(i, { sales_starts_at: "2030-13-40T00:00:00Z" }),
    ],
    [
      "a fraction with more than three digits",
      (i) => offeringWith(i, { sales_starts_at: "2030-04-01T00:00:00.1234Z" }),
    ],
    ["a numeric timestamp", (i) => offeringWith(i, { sales_starts_at: 1900000000000 })],
    [
      "a timestamp with surrounding spaces",
      (i) => offeringWith(i, { sales_ends_at: " 2030-05-10T08:00:00Z" }),
    ],
  ];
  for (const [label, build] of rejected) {
    it(`TC-TST-SEED-003-001 rejects ${label} with an error code only`, () => {
      const base = buildInitialDataInput({ marker: newMarker() });
      const raw = JSON.stringify(build(base));
      expectRejected(raw, INVALID, sensitiveValues(base));
    });
  }

  it("TC-TST-SEED-003-001 rejects an integer beyond Number.MAX_SAFE_INTEGER", () => {
    const base = buildInitialDataInput();
    const raw = JSON.stringify(base).replace(/"unit_amount":\d+/, '"unit_amount":9007199254740993');
    expect(raw).toContain("9007199254740993");
    expectRejected(raw, INVALID, sensitiveValues(base));
  });

  it("TC-TST-SEED-003-001 rejects a __proto__ key (own property created by JSON.parse)", () => {
    const base = buildInitialDataInput();
    const raw = JSON.stringify(base).replace('"event":{', '"event":{"__proto__":{"polluted":1},');
    expect(raw).toContain("__proto__");
    expectRejected(raw, INVALID, sensitiveValues(base));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("TC-TST-SEED-003-001 text that is not JSON is rejected and the parser message is not carried", () => {
    const marker = newMarker();
    for (const raw of [
      "not json {",
      `{"event": ${marker}`,
      `{"event":{"name":"${marker}",}`,
      "[]",
      "null",
      "3",
      '"text"',
      "true",
    ]) {
      expectRejected(raw, INVALID, [marker, "JSON", "position", "Unexpected", "token"]);
    }
  });

  it("TC-TST-SEED-003-001 an absent or empty input is reported as missing, not invalid (INF-SEED-004)", () => {
    expectRejected(undefined, MISSING, []);
    expectRejected("", MISSING, []);
  });
});

function offeringWith(input: InitialDataInput, patch: Record<string, unknown>): unknown {
  return {
    ...input,
    entry_ticket_offerings: [
      { ...offering0(input), ...patch },
      ...input.entry_ticket_offerings.slice(1),
    ],
  };
}

describe("TC-TST-SEED-005-001 the repository example is synthetic (DB-SEED-006, INF-SEED-002)", () => {
  const path = `${REPO}packages/db/seed/initial-data.example.json`;
  const text = readFileSync(path, "utf8");
  const example = JSON.parse(text) as InitialDataInput;
  const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;

  it("TC-TST-SEED-005-001 parses with the command's own strict parser: one Event, Offerings", () => {
    expect(parseInitialDataInput(text).ok).toBe(true);
    expect(Object.keys(example).sort()).toEqual(["entry_ticket_offerings", "event"]);
    expect(example.entry_ticket_offerings.length).toBeGreaterThanOrEqual(2);
  });

  it("TC-TST-SEED-005-001 every free-text value says it is synthetic data and sits in a fictional year", () => {
    const strings: [string, string][] = [];
    const visit = (path: string, value: unknown) => {
      if (typeof value === "string") strings.push([path, value]);
      else if (Array.isArray(value))
        for (const [index, item] of value.entries()) visit(`${path}[${index}]`, item);
      else if (value && typeof value === "object")
        for (const [key, item] of Object.entries(value)) visit(`${path}.${key}`, item);
    };
    visit("$", example);
    expect(strings.length).toBeGreaterThan(4);
    for (const [path, value] of strings) {
      if (TIMESTAMP.test(value)) {
        expect(value, path).toMatch(/^2030-/);
      } else if (!/^[A-Z]{3}$/.test(value)) {
        expect(value, path).toContain("合成データ");
      }
    }
  });

  it("TC-TST-SEED-005-001 holds no URL, no phone-number shape, and only reserved e-mail domains", () => {
    expect(text).not.toMatch(/https?:\/\//i);
    expect(text).not.toMatch(/\b0\d{1,4}-\d{1,4}-\d{3,4}\b/);
    expect(text).not.toMatch(/\+\d{1,3}[ -]?\d{2,4}[ -]?\d{3,4}/);
    for (const match of text.matchAll(/[\w.+-]+@([\w.-]+)/g)) {
      expect(match[1], "e-mail domain").toMatch(
        /(^|\.)(example\.(com|net|org)|[a-z]+\.(test|invalid|example))$/i,
      );
    }
  });
});

describe("TC-TST-SEED-005-003 no migration inserts an Event or an Entry Ticket Offering (INF-SEED-001, DB-SEED-007)", () => {
  const INSERT_TARGET =
    /\binsert\s+into\s+(?:"?app"?\s*\.\s*)?"?(events|entry_ticket_offerings)"?(?![\w])/i;
  const stripComments = (sql: string) =>
    sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

  it("TC-TST-SEED-005-003 the detector matches the spellings it must catch and ignores comments", () => {
    for (const sample of [
      "INSERT INTO app.events (name) VALUES ('x')",
      'insert   into\n  "app"."events" (name) values (\'x\')',
      'Insert Into app . "entry_ticket_offerings" DEFAULT VALUES',
      "INSERT INTO entry_ticket_offerings (name) VALUES ('x')",
    ])
      expect(stripComments(sample)).toMatch(INSERT_TARGET);
    for (const sample of [
      "-- INSERT INTO app.events (name) VALUES ('x')",
      "/* INSERT INTO app.events */ SELECT 1",
      "INSERT INTO app.events_archive (name) VALUES ('x')",
    ])
      expect(stripComments(sample)).not.toMatch(INSERT_TARGET);
  });

  it("TC-TST-SEED-005-003 the committed migrations contain no such INSERT", () => {
    const dir = `${REPO}packages/db/migrations`;
    const files = readdirSync(dir).filter((name) => name.endsWith(".sql"));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const file of files) {
      const sql = stripComments(readFileSync(`${dir}/${file}`, "utf8"));
      expect(sql, file).not.toMatch(INSERT_TARGET);
    }
  });
});

describe("TC-TST-SEED-005-005 the Business API has no Event or Offering creation route (INF-SEED-001, INF-SEED-006)", () => {
  it("TC-TST-SEED-005-005 admin event and entry-offerings routes expose only GET and PATCH", () => {
    for (const route of ROUTES) {
      if (
        route.path === "/api/v1/admin/event" ||
        route.path.startsWith("/api/v1/admin/event/") ||
        route.path === "/api/v1/admin/entry-offerings" ||
        route.path.startsWith("/api/v1/admin/entry-offerings/")
      )
        expect(["GET", "PATCH"], `${route.method} ${route.path}`).toContain(route.method);
    }
  });

  it("TC-TST-SEED-005-005 no registered route creates or replaces an event or an offering", () => {
    for (const route of ROUTES) {
      if (/(^|\/)(events?|entry-offerings?)(\/|$)/.test(route.path))
        expect(["POST", "PUT", "DELETE"], `${route.method} ${route.path}`).not.toContain(
          route.method,
        );
    }
  });
});

describe("TC-TST-SEED-005-006 the result to exit code and log correspondence (INF-SEED-004, INF-SEED-005)", () => {
  const EXECUTION_ID = "00000000-0000-4000-8000-000000000a01";
  // Superset shapes: the fields the plan names for each outcome. `outcome` names the variant.
  const outcomes = {
    CREATED: {
      outcome: "CREATED",
      created: { events: ["00000000-0000-4000-8000-000000000b01"], entry_ticket_offerings: [] },
      auditEventIds: ["00000000-0000-4000-8000-000000000c01"],
      operationExecutionId: EXECUTION_ID,
    },
    NOOP: { outcome: "NOOP" },
    FAILED_PERMANENT: {
      outcome: "FAILED",
      failureClass: "PERMANENT_FAILURE",
      errorCode: "INITIAL_DATA_INPUT_INVALID",
    },
    FAILED_TEMPORARY: {
      outcome: "FAILED",
      failureClass: "TEMPORARY_FAILURE",
      errorCode: "DATABASE_TEMPORARY_FAILURE",
    },
    FAILED_CONSISTENCY: {
      outcome: "FAILED",
      failureClass: "CONSISTENCY_FAILURE",
      errorCode: "INITIAL_DATA_EVENT_NOT_UNIQUE",
    },
    UNKNOWN_RESULT: { outcome: "UNKNOWN_RESULT", errorCode: "COMMIT_RESULT_UNKNOWN" },
  };
  type Arg = Parameters<typeof outcomeExitCode>[0];
  const exit = (key: keyof typeof outcomes) => outcomeExitCode(outcomes[key] as unknown as Arg);
  const fields = (key: keyof typeof outcomes) => outcomeLogFields(outcomes[key] as unknown as Arg);

  it("TC-TST-SEED-005-006 CREATED and NOOP exit 0, FAILED exits 2, UNKNOWN_RESULT exits 3", () => {
    expect(exit("CREATED")).toBe(0);
    expect(exit("NOOP")).toBe(0);
    for (const key of ["FAILED_PERMANENT", "FAILED_TEMPORARY", "FAILED_CONSISTENCY"] as const)
      expect(exit(key)).toBe(2);
    expect(exit("UNKNOWN_RESULT")).toBe(3);
  });

  it("TC-TST-SEED-005-006 FAILED and UNKNOWN_RESULT are non-zero, differ, and avoid 1 (the Node crash code)", () => {
    const failed = exit("FAILED_PERMANENT");
    const unknown = exit("UNKNOWN_RESULT");
    expect(failed).not.toBe(unknown);
    for (const code of [failed, unknown]) {
      expect(code).not.toBe(0);
      expect(code).not.toBe(1);
    }
  });

  it("TC-TST-SEED-005-006 result, failure_class and level follow INF-SEED-005 and SPEC-160 §17", () => {
    expect(fields("CREATED")).toMatchObject({
      result: "SUCCESS",
      failure_class: "SUCCESS",
      level: "INFO",
    });
    expect(fields("NOOP")).toMatchObject({ result: "NOOP", failure_class: null, level: "INFO" });
    expect(fields("FAILED_PERMANENT")).toMatchObject({
      result: "FAILED",
      failure_class: "PERMANENT_FAILURE",
      level: "ERROR",
    });
    expect(fields("FAILED_TEMPORARY")).toMatchObject({
      result: "FAILED",
      failure_class: "TEMPORARY_FAILURE",
      level: "ERROR",
    });
    expect(fields("FAILED_CONSISTENCY")).toMatchObject({
      result: "FAILED",
      failure_class: "CONSISTENCY_FAILURE",
      level: "ERROR",
    });
    expect(fields("UNKNOWN_RESULT")).toMatchObject({
      result: "PENDING",
      failure_class: "UNKNOWN_RESULT",
      level: "WARN",
    });
  });
});

describe("TC-TST-SEED-005-007 the completion event name is in the logger registry (SPEC-160 §16, OBS-LOG-003)", () => {
  it("TC-TST-SEED-005-007 EVENT_NAMES lists provision.initial_data_seed.completed once, in the three-segment form", () => {
    const name = "provision.initial_data_seed.completed";
    expect(
      (EVENT_NAMES as readonly string[]).filter((candidate) => candidate === name),
    ).toHaveLength(1);
    expect(name).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
  });

  it("TC-TST-SEED-005-007 the strict logger accepts the completion record with the command's common fields", () => {
    const lines: string[] = [];
    const logger = createLogger(
      {
        service: "RECOVERY",
        environment: "test",
        actor_type: "INFRASTRUCTURE_OPERATOR",
        actor_ref: "gha:example-repo:test",
      },
      (line) => void lines.push(line),
    );
    logger.log({
      event_name: "provision.initial_data_seed.completed",
      level: "INFO",
      result: "SUCCESS",
      failure_class: "SUCCESS",
      is_retry: false,
      operation_id: "PROVISION.INITIAL_DATA_SEED",
      operation_execution_id: "00000000-0000-4000-8000-000000000a02",
      duration_ms: 12,
      attempt_number: 1,
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      event_name: "provision.initial_data_seed.completed",
      service: "RECOVERY",
      operation_id: "PROVISION.INITIAL_DATA_SEED",
      actor_type: "INFRASTRUCTURE_OPERATOR",
      schema_version: 1,
    });
  });
});

describe("TC-TST-SEED-003-007 failure classification of a rolled-back attempt (plan v1.2 section 6, F-4, REL-DB-002)", () => {
  // Retryable states (40001, 40P01, 55P03) and an unknown COMMIT result are handled before this function.
  const PERMANENT_AUDIT = { failureClass: "PERMANENT_FAILURE", errorCode: "AUDIT_WRITE_FAILED" };
  const TEMPORARY_AUDIT = { failureClass: "TEMPORARY_FAILURE", errorCode: "AUDIT_WRITE_FAILED" };
  const CONSTRAINT = {
    failureClass: "PERMANENT_FAILURE",
    errorCode: "INITIAL_DATA_CONSTRAINT_REJECTED",
  };
  const UNEXPECTED = {
    failureClass: "TEMPORARY_FAILURE",
    errorCode: "UNEXPECTED_INTERNAL_ERROR",
  };
  const cases: ["statement" | "audit", string | undefined, object][] = [
    ["audit", "23514", PERMANENT_AUDIT],
    ["audit", "23505", PERMANENT_AUDIT],
    ["audit", "42501", PERMANENT_AUDIT],
    ["audit", "08006", TEMPORARY_AUDIT],
    ["audit", "57P01", TEMPORARY_AUDIT],
    // After a successful ROLLBACK, no SQLSTATE means the failure came from outside the database
    // (plan v1.2 section 6): permanent. Only connection-class states are temporary.
    ["audit", undefined, PERMANENT_AUDIT],
    ["statement", "23505", CONSTRAINT],
    ["statement", "23514", CONSTRAINT],
    ["statement", "23503", CONSTRAINT],
    ["statement", "23P01", CONSTRAINT],
    ["statement", "22P02", UNEXPECTED],
    ["statement", "22008", UNEXPECTED],
    ["statement", "22021", UNEXPECTED],
    ["statement", undefined, UNEXPECTED],
  ];
  for (const [stage, sqlstate, expected] of cases) {
    it(`TC-TST-SEED-003-007 ${stage} stage with ${sqlstate ?? "no SQLSTATE"} is ${JSON.stringify(expected)}`, () => {
      expect(classifySeedFailure(stage, sqlstate)).toEqual(expected);
    });
  }
});
