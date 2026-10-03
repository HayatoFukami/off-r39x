import type { BusinessDateJst, UtcInstant } from "../../api-client/types";

// JST is UTC+9 with no daylight saving. All arithmetic is UTC-based and never reads local time.

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const BUSINESS_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

function instantMs(instant: UtcInstant): number {
  const ms = UTC_INSTANT.test(instant) ? Date.parse(instant) : Number.NaN;
  if (!Number.isFinite(ms)) {
    throw new RangeError("Invalid UTC instant");
  }
  return ms;
}

/** A Date whose UTC accessors read JST wall-clock fields. */
function jstFields(instant: UtcInstant): Date {
  return new Date(instantMs(instant) + JST_OFFSET_MS);
}

function dateOnly(d: Date): string {
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function toUtcString(ms: number): UtcInstant {
  return new Date(ms).toISOString().replace(".000Z", "Z") as UtcInstant;
}

export function toBusinessDateJst(instant: UtcInstant): BusinessDateJst {
  return dateOnly(jstFields(instant)) as BusinessDateJst;
}

function dayStartMs(date: string): number | null {
  const match = BUSINESS_DATE.exec(date);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

export function parseBusinessDateJst(input: string): BusinessDateJst | null {
  return dayStartMs(input) === null ? null : (input as BusinessDateJst);
}

export function jstDayBoundsUtc(date: BusinessDateJst): {
  start: UtcInstant;
  endExclusive: UtcInstant;
} {
  const ms = dayStartMs(date);
  if (ms === null) {
    throw new RangeError("Invalid business date");
  }
  const start = ms - JST_OFFSET_MS;
  return { start: toUtcString(start), endExclusive: toUtcString(start + DAY_MS) };
}

function timePart(d: Date): string {
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function formatJstDate(instant: UtcInstant): string {
  return dateOnly(jstFields(instant)).replaceAll("-", "/");
}

export function formatJstTime(instant: UtcInstant): string {
  return timePart(jstFields(instant));
}

export function formatJstDateTime(instant: UtcInstant): string {
  const d = jstFields(instant);
  return `${dateOnly(d).replaceAll("-", "/")} ${timePart(d)}`;
}

export function formatJstTimeRange(start: UtcInstant, end: UtcInstant): string {
  return `${formatJstTime(start)}-${formatJstTime(end)}`;
}

export function formatBusinessDate(date: BusinessDateJst): string {
  const ms = dayStartMs(date);
  if (ms === null) {
    throw new RangeError("Invalid business date");
  }
  const weekday = WEEKDAYS[new Date(ms).getUTCDay()];
  return `${date.replaceAll("-", "/")}(${weekday ?? ""})`;
}

export function bucketStartHourJst(instant: UtcInstant): number {
  return jstFields(instant).getUTCHours();
}

export function formatBucketLabel(instant: UtcInstant): string {
  const hour = bucketStartHourJst(instant);
  return `${pad(hour)}:00-${pad(hour + 1)}:00`;
}
