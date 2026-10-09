import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENTS_HREF,
  announcementHref,
  ENTRY_HREF,
  GOODS_HREF,
  goodsHref,
  KARAOKE_HREF,
  karaokeDayHref,
  karaokeSlotHref,
} from "../../../../apps/web/src/config/public-routes.ts";
import {
  parseAnnouncementRef,
  parseBusinessDateParam,
} from "../../../../apps/web/src/features/public/route-params.ts";
import { ANNOUNCEMENT, D1, GOODS, SLOT } from "../../../harness/mock-seed.ts";

// Contract: tests/contracts/s4-public.md sections 2.1 and 2.2 (SPEC-050 5.2, 11.3, 13.2).

describe("TC-PG-PUB-003-602 parseAnnouncementRef accepts only canonical lowercase UUIDs", () => {
  it("returns the seed announcement refs unchanged", () => {
    for (const ref of Object.values(ANNOUNCEMENT)) expect(parseAnnouncementRef(ref)).toBe(ref);
  });

  it("rejects non-UUIDs, uppercase, padded and encoded values", () => {
    for (const raw of [
      "",
      "latest",
      "not-a-uuid",
      "ab000000-0000-4000-8000-00000000000",
      "ab000000-0000-4000-8000-0000000000011",
      "AB000000-0000-4000-8000-000000000001",
      " ab000000-0000-4000-8000-000000000001",
      "ab000000-0000-4000-8000-000000000001 ",
      "ab000000-0000-4000-8000-00000000000g",
      "ab000000%2D0000-4000-8000-000000000001",
      "ab000000-0000-4000-8000-000000000001/../x",
      "ab00000000004000800000000000000001",
    ]) {
      expect(parseAnnouncementRef(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

describe("TC-PG-KRK-002-604 parseBusinessDateParam accepts only real YYYY-MM-DD calendar dates", () => {
  it("accepts valid dates including a leap day", () => {
    for (const raw of ["2027-03-08", D1, "2028-02-29", "2027-12-31"]) {
      expect(parseBusinessDateParam(raw), raw).toBe(raw);
    }
  });

  it("rejects impossible, malformed and padded values", () => {
    for (const raw of [
      "",
      "2027-02-30",
      "2027-02-29",
      "2027-13-01",
      "2027-00-10",
      "2027-03-00",
      "2027-3-8",
      "20270308",
      "2027/03/08",
      "2027-03-08 ",
      " 2027-03-08",
      "2027-03-08T00:00:00Z",
      "２０２７-03-08",
      "abc",
      "0000-01-01",
    ]) {
      expect(parseBusinessDateParam(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

describe("TC-PG-PUB-003-603 public route hrefs are fixed by SPEC-050 and never point at admin / staff / dev", () => {
  it("builds the section and detail hrefs", () => {
    expect(ANNOUNCEMENTS_HREF).toBe("/announcements");
    expect(ENTRY_HREF).toBe("/entry");
    expect(KARAOKE_HREF).toBe("/karaoke");
    expect(GOODS_HREF).toBe("/goods");
    expect(announcementHref(ANNOUNCEMENT.latest)).toBe(`/announcements/${ANNOUNCEMENT.latest}`);
    expect(karaokeDayHref(D1)).toBe(`/karaoke/schedule/${D1}`);
    expect(karaokeSlotHref(SLOT.d1_1000)).toBe(`/karaoke/slots/${SLOT.d1_1000}`);
    expect(goodsHref(GOODS.tshirt)).toBe("/goods/a0000000-0000-4000-8000-000000000001");
  });

  it("starts with a single slash and avoids forbidden areas", () => {
    for (const href of [
      ANNOUNCEMENTS_HREF,
      ENTRY_HREF,
      KARAOKE_HREF,
      GOODS_HREF,
      announcementHref(ANNOUNCEMENT.latest),
      karaokeDayHref(D1),
      karaokeSlotHref(SLOT.d1_1000),
    ]) {
      expect(href.startsWith("/") && !href.startsWith("//"), href).toBe(true);
      expect(href).not.toMatch(/^\/(admin|staff|dev)(\/|$)/);
    }
  });
});
