import { describe, expect, it } from "vitest";
import {
  bucketStartHourJst,
  formatBucketLabel,
  formatBusinessDate,
  formatJstDate,
  formatJstDateTime,
  formatJstTime,
  formatJstTimeRange,
  jstDayBoundsUtc,
  parseBusinessDateJst,
  toBusinessDateJst,
} from "../../../../apps/web/src/presentation/format/datetime.ts";
import { jstDate, utc } from "../../../harness/presentation.ts";

// JST = UTC+9 with no daylight saving. The JST business day changes at 15:00:00Z (TST-DAT-007 / 008).

describe("TC-PG-KRK-002-002 toBusinessDateJst at the JST day boundary (half-open, TST-DAT-007)", () => {
  it.each([
    ["just-before", "2027-01-14T14:59:59Z", "2027-01-14"],
    ["just-before (ms)", "2027-01-14T14:59:59.999Z", "2027-01-14"],
    ["exact", "2027-01-14T15:00:00Z", "2027-01-15"],
    ["just-after", "2027-01-14T15:00:01Z", "2027-01-15"],
    ["start of the UTC day", "2027-01-15T00:00:00Z", "2027-01-15"],
    ["end of the JST day", "2027-01-15T14:59:59Z", "2027-01-15"],
    ["year boundary exact", "2026-12-31T15:00:00Z", "2027-01-01"],
    ["leap day exact", "2028-02-28T15:00:00Z", "2028-02-29"],
  ])("%s: %s -> %s", (_name, instant, expected) => {
    expect(toBusinessDateJst(utc(instant))).toBe(expected);
  });
});

describe("TC-PG-KRK-002-002 jstDayBoundsUtc (TST-DAT-007 / 008)", () => {
  it("returns the half-open interval of the JST day as UTC instants", () => {
    expect(jstDayBoundsUtc(jstDate("2027-01-15"))).toEqual({
      start: "2027-01-14T15:00:00Z",
      endExclusive: "2027-01-15T15:00:00Z",
    });
  });

  it("is consistent with toBusinessDateJst on the three boundary points", () => {
    const date = jstDate("2027-03-01");
    const { start, endExclusive } = jstDayBoundsUtc(date);
    const ms = (iso: string) => Date.parse(iso);
    const before = new Date(ms(start) - 1000).toISOString().replace(".000Z", "Z");
    const afterEnd = new Date(ms(endExclusive)).toISOString().replace(".000Z", "Z");
    expect(toBusinessDateJst(utc(before))).not.toBe(date);
    expect(toBusinessDateJst(start)).toBe(date);
    expect(toBusinessDateJst(utc(afterEnd))).not.toBe(date);
    const lastSecond = new Date(ms(endExclusive) - 1000).toISOString().replace(".000Z", "Z");
    expect(toBusinessDateJst(utc(lastSecond))).toBe(date);
  });
});

describe("TC-PG-KRK-002-002 JST display formatting (Asia/Tokyo)", () => {
  it.each([
    ["2027-01-14T14:59:59Z", "2027/01/14 23:59"],
    ["2027-01-14T15:00:00Z", "2027/01/15 00:00"],
    ["2027-01-14T15:00:01Z", "2027/01/15 00:00"],
    ["2027-01-15T00:30:00Z", "2027/01/15 09:30"],
    ["2026-12-31T15:00:00Z", "2027/01/01 00:00"],
    ["2028-02-28T15:00:00Z", "2028/02/29 00:00"],
  ])("formatJstDateTime(%s) = %s", (instant, expected) => {
    expect(formatJstDateTime(utc(instant))).toBe(expected);
  });

  it("splits into date and time parts", () => {
    expect(formatJstDate(utc("2027-01-14T15:00:00Z"))).toBe("2027/01/15");
    expect(formatJstDate(utc("2027-01-14T14:59:59Z"))).toBe("2027/01/14");
    expect(formatJstTime(utc("2027-01-14T15:00:00Z"))).toBe("00:00");
    expect(formatJstTime(utc("2027-01-15T01:05:00Z"))).toBe("10:05");
  });

  it("formats a usage time range", () => {
    expect(formatJstTimeRange(utc("2027-01-15T01:15:00Z"), utc("2027-01-15T01:45:00Z"))).toBe(
      "10:15-10:45",
    );
    expect(formatJstTimeRange(utc("2027-01-14T14:00:00Z"), utc("2027-01-14T15:00:00Z"))).toBe(
      "23:00-00:00",
    );
  });

  it("does not depend on the process time zone", () => {
    const original = process.env.TZ;
    try {
      for (const tz of ["America/Los_Angeles", "Pacific/Kiritimati", "UTC"]) {
        process.env.TZ = tz;
        expect(formatJstDateTime(utc("2027-01-14T15:00:00Z")), tz).toBe("2027/01/15 00:00");
        expect(toBusinessDateJst(utc("2027-01-14T14:59:59Z")), tz).toBe("2027-01-14");
        expect(bucketStartHourJst(utc("2027-01-15T01:00:00Z")), tz).toBe(10);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it.each([
    "2027-01-15T01:00:00+09:00",
    "2027-01-15",
    "2027-01-15T01:00:00",
    "not-a-date",
    "",
    "2027-13-01T00:00:00Z",
    "2027-01-15T25:00:00Z",
  ])("rejects the invalid UTC instant %j", (value) => {
    expect(() => formatJstDateTime(utc(value))).toThrow(/Invalid UTC instant/);
    expect(() => toBusinessDateJst(utc(value))).toThrow(/Invalid UTC instant/);
  });
});

describe("TC-PG-KRK-002-002 formatBusinessDate / parseBusinessDateJst", () => {
  it.each([
    ["2027-01-01", "2027/01/01(金)"],
    ["2027-01-02", "2027/01/02(土)"],
    ["2027-01-03", "2027/01/03(日)"],
    ["2027-01-04", "2027/01/04(月)"],
    ["2027-01-05", "2027/01/05(火)"],
    ["2027-01-06", "2027/01/06(水)"],
    ["2027-01-07", "2027/01/07(木)"],
  ])("formatBusinessDate(%s) = %s", (date, expected) => {
    expect(formatBusinessDate(jstDate(date))).toBe(expected);
  });

  it("rejects a malformed business date when formatting", () => {
    expect(() => formatBusinessDate(jstDate("2027-02-30"))).toThrow(/Invalid business date/);
  });

  it.each(["2027-01-15", "2028-02-29", "2027-12-31", "2027-02-28"])("accepts %s", (value) => {
    expect(parseBusinessDateJst(value)).toBe(value);
  });

  it.each([
    "2027-1-5",
    "20270115",
    "2027-02-29",
    "2027-13-01",
    "2027-00-10",
    "2027-01-32",
    "2027-01-00",
    "2027-01-15T00:00:00Z",
    "",
    " 2027-01-15",
    "2027-01-15 ",
    "abcd-ef-gh",
  ])("rejects %j", (value) => {
    expect(parseBusinessDateJst(value)).toBeNull();
  });
});

describe("TC-PG-KRK-002-002 one-hour bucket helpers (SPEC-050 13.2, half-open)", () => {
  it.each([
    ["2027-01-15T00:59:59Z", 9, "09:00-10:00"],
    ["2027-01-15T01:00:00Z", 10, "10:00-11:00"],
    ["2027-01-15T01:59:59Z", 10, "10:00-11:00"],
    ["2027-01-15T02:00:00Z", 11, "11:00-12:00"],
    ["2027-01-14T14:00:00Z", 23, "23:00-24:00"],
    ["2027-01-14T14:59:59Z", 23, "23:00-24:00"],
    ["2027-01-14T15:00:00Z", 0, "00:00-01:00"],
  ])("%s belongs to hour %s (%s)", (instant, hour, label) => {
    expect(bucketStartHourJst(utc(instant))).toBe(hour);
    expect(formatBucketLabel(utc(instant))).toBe(label);
  });
});
