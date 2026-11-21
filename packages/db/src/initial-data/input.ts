import { INITIAL_DATA_TARGETS, type InputColumn } from "./targets.ts";

// Strict validation of the initial data input (SPEC-100 DB-SEED-003, SPEC-180 INF-SEED-002/005).
// The conditions equal the table CHECKs. Nothing is trimmed, upper-cased or defaulted (no guessed
// value). A rejection carries an error code only: never a key name, an index, a value or a parser
// message (INF-SEED-005, TST-UNT-003).

export type InputValue = string | number | null;
/** Every input column of one row, with NULL for an omitted or null nullable column. */
export type InputRow = Readonly<Record<string, InputValue>>;
export type InitialDataInput = {
  readonly event: InputRow;
  readonly entry_ticket_offerings: readonly InputRow[];
};
export type ParseResult =
  | { readonly ok: true; readonly value: InitialDataInput }
  | { readonly ok: false; readonly errorCode: InputErrorCode };
export type InputErrorCode = "INITIAL_DATA_INPUT_MISSING" | "INITIAL_DATA_INPUT_INVALID";

const INVALID: ParseResult = Object.freeze({ ok: false, errorCode: "INITIAL_DATA_INPUT_INVALID" });
const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const daysInMonth = (year: number, month: number): number =>
  month === 2
    ? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
      ? 30
      : 31;

/** Epoch milliseconds, or null when the text is not an RFC 3339 timestamp with an offset. */
function timestampMillis(value: string): number | null {
  const match = TIMESTAMP.exec(value);
  if (match === null) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  )
    return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

const isText = (value: unknown): value is string =>
  typeof value === "string" && !/\p{Surrogate}/u.test(value) && !value.includes("\u0000");

function validValue(column: InputColumn, value: unknown): InputValue | undefined {
  switch (column.kind) {
    case "text":
      return isText(value) && (!column.nonEmpty || value.length > 0) ? value : undefined;
    case "timestamp":
      return typeof value === "string" && timestampMillis(value) !== null ? value : undefined;
    case "currency":
      return typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : undefined;
    case "integer":
      return typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= column.min &&
        value <= column.max
        ? value
        : undefined;
  }
}

function parseRow(
  raw: unknown,
  columns: readonly InputColumn[],
  periods: readonly (readonly [string, string])[],
): InputRow | undefined {
  if (!isRecord(raw)) return undefined;
  const known = new Set(columns.map((column) => column.name));
  if (Object.keys(raw).some((key) => !known.has(key))) return undefined;
  const row: Record<string, InputValue> = {};
  for (const column of columns) {
    const present = Object.hasOwn(raw, column.name) && raw[column.name] !== null;
    if (!present) {
      if (column.required) return undefined;
      row[column.name] = null;
      continue;
    }
    const value = validValue(column, raw[column.name]);
    if (value === undefined) return undefined;
    row[column.name] = value;
  }
  for (const [earlier, later] of periods) {
    const from = row[earlier];
    const to = row[later];
    if (typeof from === "string" && typeof to === "string") {
      const fromMillis = timestampMillis(from);
      const toMillis = timestampMillis(to);
      if (fromMillis === null || toMillis === null || fromMillis >= toMillis) return undefined;
    }
  }
  return row;
}

/** Parses the raw `INITIAL_DATA_SEED_JSON` text. Never throws. */
export function parseInitialDataInput(raw: string | undefined): ParseResult {
  if (raw === undefined || raw === "")
    return Object.freeze({ ok: false, errorCode: "INITIAL_DATA_INPUT_MISSING" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The parser message quotes a fragment of the input; it is dropped on purpose.
    return INVALID;
  }
  if (!isRecord(parsed)) return INVALID;
  const keys = INITIAL_DATA_TARGETS.map((target) => target.key as string);
  const actual = Object.keys(parsed);
  if (actual.length !== keys.length || !keys.every((key) => Object.hasOwn(parsed, key)))
    return INVALID;

  let event: InputRow | undefined;
  const offerings: InputRow[] = [];
  for (const target of INITIAL_DATA_TARGETS) {
    const value = parsed[target.key];
    if (target.cardinality === "one") {
      const row = parseRow(value, target.columns, target.periods);
      if (row === undefined) return INVALID;
      event = row;
    } else {
      if (!Array.isArray(value) || value.length === 0) return INVALID;
      for (const item of value) {
        const row = parseRow(item, target.columns, target.periods);
        if (row === undefined) return INVALID;
        offerings.push(row);
      }
    }
  }
  if (event === undefined) return INVALID;
  return {
    ok: true,
    value: { event, entry_ticket_offerings: offerings },
  };
}
