import { describe, expect, it } from "vitest";
import type {
  AnnouncementSummary,
  Ref,
  UtcInstant,
} from "../../../../apps/web/src/api-client/types.ts";
import {
  buildAnnouncementDetailModel,
  buildAnnouncementListModel,
  toAnnouncementListItem,
} from "../../../../apps/web/src/features/public/announcement-model.ts";
import { formatJstDate } from "../../../../apps/web/src/presentation/format/datetime.ts";
import { createBackend, okData } from "../../../harness/mock-backend.ts";
import { ANNOUNCEMENT, MARKER } from "../../../harness/mock-seed.ts";

// Contract: tests/contracts/s4-public.md section 2.5 (SPEC-050 11.2, 11.3, SEC-WEB-017/018, INV-010-08).

const summary = (n: number, publishedAt: string): AnnouncementSummary => ({
  announcementRef: `ab000000-0000-4000-8000-${String(n).padStart(12, "0")}` as Ref<"announcement">,
  title: `title-${n}`,
  publishedAt: publishedAt as UtcInstant,
  excerpt: `excerpt-${n}`,
});

describe("TC-PG-PUB-002-602 announcement list model (SPEC-050 11.2)", () => {
  it("maps a summary to a list item with the JST date and the detail href", () => {
    const item = toAnnouncementListItem(summary(1, "2027-02-28T15:30:00Z"));
    expect(item).toMatchObject({
      announcementRef: "ab000000-0000-4000-8000-000000000001",
      href: "/announcements/ab000000-0000-4000-8000-000000000001",
      title: "title-1",
      excerpt: "excerpt-1",
      publishedAt: "2027-02-28T15:30:00Z",
    });
    // 15:30 UTC on 02-28 is 00:30 JST on 03-01: the date text must be the JST date.
    expect(item.dateText).toBe("2027/03/01");
    expect(item.dateText).toBe(formatJstDate("2027-02-28T15:30:00Z" as UtcInstant));
  });

  it("lists the seed's PUBLISHED announcements newest first and never a draft or archived one", async () => {
    const { api } = createBackend();
    const model = buildAnnouncementListModel({
      kind: "ok",
      data: okData(await api.public.listAnnouncements()),
    });
    expect(model.kind).toBe("items");
    if (model.kind !== "items") return;
    expect(model.items.map((i) => i.announcementRef)).toEqual([
      ANNOUNCEMENT.latest,
      ANNOUNCEMENT.script,
      ANNOUNCEMENT.older,
    ]);
    const text = JSON.stringify(model);
    expect(text).not.toContain(MARKER.draftAnnouncement);
    expect(text).not.toContain(MARKER.archivedAnnouncement);
  });

  it("sorts defensively by publishedAt descending, keeping input order for equal instants", () => {
    const model = buildAnnouncementListModel({
      kind: "ok",
      data: [
        summary(1, "2027-01-01T00:00:00Z"),
        summary(2, "2027-03-01T00:00:00Z"),
        summary(3, "2027-03-01T00:00:00Z"),
        summary(4, "2027-02-01T00:00:00Z"),
      ],
    });
    expect(model.kind === "items" && model.items.map((i) => i.title)).toEqual([
      "title-2",
      "title-3",
      "title-4",
      "title-1",
    ]);
  });

  it("applies limit after sorting and rejects a non-positive or fractional limit", () => {
    const data = [
      summary(1, "2027-01-01T00:00:00Z"),
      summary(2, "2027-03-01T00:00:00Z"),
      summary(3, "2027-02-01T00:00:00Z"),
    ];
    const model = buildAnnouncementListModel({ kind: "ok", data }, { limit: 2 });
    expect(model.kind === "items" && model.items.map((i) => i.title)).toEqual([
      "title-2",
      "title-3",
    ]);
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      expect(
        () => buildAnnouncementListModel({ kind: "ok", data }, { limit }),
        String(limit),
      ).toThrow(RangeError);
    }
  });

  it("keeps empty, loading and unavailable apart", () => {
    expect(buildAnnouncementListModel({ kind: "ok", data: [] })).toEqual({ kind: "empty" });
    expect(buildAnnouncementListModel({ kind: "loading" })).toEqual({ kind: "loading" });
    expect(buildAnnouncementListModel({ kind: "unavailable" })).toEqual({ kind: "unavailable" });
  });
});

describe("TC-PG-PUB-003-601 announcement detail model (SPEC-050 11.3, SEC-WEB-017/018)", () => {
  it("is ready with the body kept verbatim, markup included (no escaping, trimming or stripping)", async () => {
    const { api } = createBackend();
    const announcement = okData(await api.public.getAnnouncement(ANNOUNCEMENT.script));
    expect(announcement.body).toContain(MARKER.scriptMarkup);
    const model = buildAnnouncementDetailModel({ kind: "ok", data: announcement });
    expect(model).toMatchObject({
      kind: "ready",
      announcementRef: ANNOUNCEMENT.script,
      title: announcement.title,
      body: announcement.body,
      listHref: "/announcements",
      homeHref: "/",
    });
    if (model.kind === "ready") {
      expect(model.dateText).toBe(formatJstDate(announcement.publishedAt));
      expect(model.body).toContain(MARKER.scriptMarkup);
    }
  });

  it("does not alter whitespace or newlines in the body", () => {
    const body = "  line1\n\n  <b>line2</b>\t\n";
    const model = buildAnnouncementDetailModel({
      kind: "ok",
      data: { ...summary(1, "2027-03-01T00:00:00Z"), body },
    });
    expect(model.kind === "ready" && model.body).toBe(body);
  });

  it("separates Not Found from a fetch failure (SPEC-050 11.3)", () => {
    expect(buildAnnouncementDetailModel({ kind: "not_found" })).toEqual({ kind: "not_found" });
    for (const kind of ["unavailable", "auth_required", "email_unverified"] as const) {
      expect(buildAnnouncementDetailModel({ kind }), kind).toEqual({ kind: "unavailable" });
    }
    expect(buildAnnouncementDetailModel({ kind: "loading" })).toEqual({ kind: "loading" });
  });

  it("is Not Found for the draft and archived refs of the seed (nothing leaks into the model)", async () => {
    const { api } = createBackend();
    for (const ref of [ANNOUNCEMENT.draft, ANNOUNCEMENT.archived]) {
      const model = buildAnnouncementDetailModel(await api.public.getAnnouncement(ref));
      expect(model, ref).toEqual({ kind: "not_found" });
    }
  });
});
