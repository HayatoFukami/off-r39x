import { describe, expect, it } from "vitest";
import type {
  AnnouncementSummary,
  EventInfo,
  Ref,
  UtcInstant,
} from "../../../../apps/web/src/api-client/types.ts";
import {
  buildEventPeriodText,
  buildHomeModel,
  HOME_NEWS_LIMIT,
  HOME_SECTION_ORDER,
  type HomeInputs,
  type HomeSection,
} from "../../../../apps/web/src/features/public/home-model.ts";
import { formatJstDateTime } from "../../../../apps/web/src/presentation/format/datetime.ts";
import { createBackend, okData, type ScenarioPatch } from "../../../harness/mock-backend.ts";
import { ANNOUNCEMENT, MARKER } from "../../../harness/mock-seed.ts";

// Contract: tests/contracts/s4-public.md sections 2.6 (SPEC-050 11.1, 9, 21, 33, BR-EVT-001/002).

async function seedInputs(patch: ScenarioPatch = {}) {
  const backend = createBackend();
  backend.setScenario(patch);
  const { api } = backend;
  const announcements = await api.public.listAnnouncements({ limit: HOME_NEWS_LIMIT });
  return {
    event: await api.public.getEvent(),
    announcements,
    faqs: await api.public.listFaqs(),
  } satisfies HomeInputs;
}

const keysOf = (sections: readonly HomeSection[]): string[] => sections.map((s) => s.key);

function ready(model: ReturnType<typeof buildHomeModel>): readonly HomeSection[] {
  if (model.kind !== "ready") throw new Error(`expected ready but got ${model.kind}`);
  return model.sections;
}

const section = <K extends HomeSection["key"]>(
  sections: readonly HomeSection[],
  key: K,
): Extract<HomeSection, { key: K }> | undefined =>
  sections.find((s): s is Extract<HomeSection, { key: K }> => s.key === key);

const announcement = (n: number, publishedAt: string): AnnouncementSummary => ({
  announcementRef: `ab000000-0000-4000-8000-${String(n).padStart(12, "0")}` as Ref<"announcement">,
  title: `title-${n}`,
  publishedAt: publishedAt as UtcInstant,
  excerpt: `excerpt-${n}`,
});

describe("TC-PG-PUB-001-621 buildEventPeriodText shows set JST values and invents none (SPEC-050 11.1)", () => {
  const start = "2027-03-01T15:30:00Z" as UtcInstant; // 2027/03/02 00:30 JST
  const end = "2027-03-02T09:00:00Z" as UtcInstant; // 2027/03/02 18:00 JST

  it("is null when neither value is set", () => {
    expect(buildEventPeriodText(null, null)).toBeNull();
  });

  it("contains both JST date-times, using the JST date across the UTC date boundary", () => {
    const text = buildEventPeriodText(start, end);
    expect(text).toContain(formatJstDateTime(start));
    expect(text).toContain(formatJstDateTime(end));
    expect(text).toContain("2027/03/02 00:30");
    expect(text).not.toContain("2027/03/01 15:30");
  });

  it("contains only the value that is set when one side is missing", () => {
    const onlyStart = buildEventPeriodText(start, null);
    expect(onlyStart).toContain(formatJstDateTime(start));
    expect(onlyStart).not.toContain("2027/03/02 18:00");
    const onlyEnd = buildEventPeriodText(null, end);
    expect(onlyEnd).toContain(formatJstDateTime(end));
    expect(onlyEnd).not.toContain("2027/03/02 00:30");
  });
});

describe("TC-PG-PUB-001-622 buildHomeModel orders the sections exactly as SPEC-050 11.1 (UF-PUB-001)", () => {
  it("fixes the section order", () => {
    expect(HOME_SECTION_ORDER).toEqual([
      "hero",
      "news",
      "salesShortcut",
      "overview",
      "schedule",
      "venue",
      "notices",
      "faq",
    ]);
    expect(HOME_NEWS_LIMIT).toBe(3);
  });

  it("builds all eight sections in that order from the complete seed", async () => {
    const sections = ready(buildHomeModel(await seedInputs()));
    expect(keysOf(sections)).toEqual([...HOME_SECTION_ORDER]);
  });

  it("puts the event facts in the hero and points the primary CTA at the Entry Ticket sales page", async () => {
    const inputs = await seedInputs();
    const event = okData(inputs.event);
    const hero = section(ready(buildHomeModel(inputs)), "hero");
    expect(hero).toMatchObject({
      key: "hero",
      eventName: event.name,
      venueName: event.venueName,
      ctaHref: "/entry",
    });
    expect(hero?.periodText).toBe(buildEventPeriodText(event.startsAt, event.endsAt));
    expect(hero?.periodText).toContain(formatJstDateTime(event.startsAt as UtcInstant));
  });

  it("lists the three sales shortcuts in Entry, Karaoke, Goods order", async () => {
    const shortcut = section(ready(buildHomeModel(await seedInputs())), "salesShortcut");
    expect(shortcut?.links).toEqual([
      { key: "entry", href: "/entry" },
      { key: "karaoke", href: "/karaoke" },
      { key: "goods", href: "/goods" },
    ]);
  });

  it("shows the newest PUBLISHED announcements with a JST date and a link to the list", async () => {
    const news = section(ready(buildHomeModel(await seedInputs())), "news");
    expect(news?.viewAllHref).toBe("/announcements");
    expect(news?.list.kind).toBe("items");
    if (news?.list.kind !== "items") return;
    expect(news.list.items.map((i) => i.announcementRef)).toEqual([
      ANNOUNCEMENT.latest,
      ANNOUNCEMENT.script,
      ANNOUNCEMENT.older,
    ]);
    for (const item of news.list.items) expect(item.dateText).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
    expect(JSON.stringify(news)).not.toContain(MARKER.draftAnnouncement);
  });

  it("keeps at most HOME_NEWS_LIMIT announcements, newest first, even if the port returns more", async () => {
    const inputs = await seedInputs();
    const many: HomeInputs = {
      ...inputs,
      announcements: {
        kind: "ok",
        data: [
          announcement(1, "2027-01-01T00:00:00Z"),
          announcement(2, "2027-02-05T00:00:00Z"),
          announcement(3, "2027-02-01T00:00:00Z"),
          announcement(4, "2027-02-20T00:00:00Z"),
          announcement(5, "2027-01-15T00:00:00Z"),
        ],
      },
    };
    const news = section(ready(buildHomeModel(many)), "news");
    expect(news?.list.kind === "items" && news.list.items.map((i) => i.title)).toEqual([
      "title-4",
      "title-2",
      "title-3",
    ]);
  });

  it("carries the overview, venue, notices and published FAQs verbatim", async () => {
    const inputs = await seedInputs();
    const event = okData(inputs.event);
    const faqs = okData(inputs.faqs);
    const sections = ready(buildHomeModel(inputs));
    expect(section(sections, "overview")).toEqual({
      key: "overview",
      eventName: event.name,
      overview: event.overview,
    });
    expect(section(sections, "venue")).toEqual({
      key: "venue",
      venueName: event.venueName,
      venueGuide: event.venueGuide,
      accessInfo: event.accessInfo,
    });
    expect(section(sections, "notices")).toEqual({ key: "notices", items: event.notices });
    const faq = section(sections, "faq");
    expect(faq?.list).toEqual({
      kind: "items",
      items: faqs.map((f) => ({ id: f.id, question: f.question, answer: f.answer })),
    });
    expect(faqs.length).toBe(3);
    expect(JSON.stringify(faq)).not.toContain(MARKER.draftFaq);
  });
});

describe("TC-PG-PUB-001-623 buildHomeModel isolates section failures and keeps loading / error apart (SPEC-050 11.1, 21)", () => {
  it("is loading while the event is loading, whatever the other reads say", async () => {
    const inputs = await seedInputs();
    expect(buildHomeModel({ ...inputs, event: { kind: "loading" } })).toEqual({ kind: "loading" });
    expect(
      buildHomeModel({
        event: { kind: "loading" },
        announcements: { kind: "loading" },
        faqs: { kind: "loading" },
      }),
    ).toEqual({ kind: "loading" });
  });

  it("is a page-level error whenever the event read does not succeed, even if everything else did", async () => {
    const inputs = await seedInputs();
    for (const kind of ["unavailable", "not_found", "auth_required", "email_unverified"] as const) {
      expect(buildHomeModel({ ...inputs, event: { kind } }), kind).toEqual({ kind: "error" });
    }
  });

  it("keeps the other sections when only the FAQ read fails", async () => {
    const inputs = await seedInputs();
    const sections = ready(buildHomeModel({ ...inputs, faqs: { kind: "unavailable" } }));
    expect(keysOf(sections)).toEqual([...HOME_SECTION_ORDER]);
    expect(section(sections, "faq")?.list).toEqual({ kind: "unavailable" });
    expect(section(sections, "news")?.list.kind).toBe("items");
    expect(section(sections, "overview")).toBeDefined();
  });

  it("keeps the other sections when only the announcement read fails", async () => {
    const inputs = await seedInputs();
    const sections = ready(buildHomeModel({ ...inputs, announcements: { kind: "unavailable" } }));
    expect(section(sections, "news")?.list).toEqual({ kind: "unavailable" });
    expect(section(sections, "faq")?.list.kind).toBe("items");
  });

  it("shows loading per section while the event is already available", async () => {
    const inputs = await seedInputs();
    const sections = ready(
      buildHomeModel({ ...inputs, announcements: { kind: "loading" }, faqs: { kind: "loading" } }),
    );
    expect(section(sections, "news")?.list).toEqual({ kind: "loading" });
    expect(section(sections, "faq")?.list).toEqual({ kind: "loading" });
  });

  it("uses empty only when announcements / FAQs were read successfully and there are none", async () => {
    const inputs = await seedInputs({ publicFetch: "empty" });
    const sections = ready(buildHomeModel(inputs));
    expect(section(sections, "news")?.list).toEqual({ kind: "empty" });
    expect(section(sections, "faq")?.list).toEqual({ kind: "empty" });
    // The event is not affected by the empty scenario: its sections remain.
    expect(section(sections, "overview")).toBeDefined();
  });

  it("never turns a failed announcement / FAQ read into empty", async () => {
    const inputs = await seedInputs({ publicFetch: "fail" });
    expect(buildHomeModel(inputs)).toEqual({ kind: "error" });
    const eventOk = await seedInputs();
    for (const kind of ["unavailable", "not_found", "auth_required", "email_unverified"] as const) {
      const sections = ready(
        buildHomeModel({ ...eventOk, announcements: { kind }, faqs: { kind } }),
      );
      expect(section(sections, "news")?.list, kind).toEqual({ kind: "unavailable" });
      expect(section(sections, "faq")?.list, kind).toEqual({ kind: "unavailable" });
    }
  });
});

describe("TC-PG-PUB-001-624 buildHomeModel hides unset event facts instead of guessing (SPEC-050 11.1, 33)", () => {
  it("keeps only the hero, news, shortcuts and FAQ when every optional field is null", async () => {
    const inputs = await seedInputs({ eventFields: "missing_optional" });
    const sections = ready(buildHomeModel(inputs));
    expect(keysOf(sections)).toEqual(["hero", "news", "salesShortcut", "faq"]);
    const hero = section(sections, "hero");
    expect(hero?.periodText).toBeNull();
    expect(hero?.venueName).toBeNull();
    expect(hero?.eventName).toBe(okData(inputs.event).name);
  });

  it("invents no placeholder wording for unset values", async () => {
    const model = buildHomeModel(await seedInputs({ eventFields: "missing_optional" }));
    const text = JSON.stringify(model);
    for (const word of ["未設定", "未定", "TBD", "tbd", "N/A", "---"]) {
      expect(text, word).not.toContain(word);
    }
  });

  const base: EventInfo = {
    name: "Event",
    overview: null,
    startsAt: null,
    endsAt: null,
    venueName: null,
    venueGuide: null,
    accessInfo: null,
    notices: null,
  };
  const withEvent = (event: EventInfo): HomeInputs => ({
    event: { kind: "ok", data: event },
    announcements: { kind: "ok", data: [] },
    faqs: { kind: "ok", data: [] },
  });

  it("includes a section as soon as one of its facts is set, and keeps the other facts null", () => {
    const sections = ready(buildHomeModel(withEvent({ ...base, accessInfo: "access text" })));
    expect(keysOf(sections)).toEqual(["hero", "news", "salesShortcut", "venue", "faq"]);
    expect(section(sections, "venue")).toEqual({
      key: "venue",
      venueName: null,
      venueGuide: null,
      accessInfo: "access text",
    });
  });

  it("treats blank strings and an empty notice list as unset", () => {
    const sections = ready(
      buildHomeModel(
        withEvent({ ...base, overview: "   ", venueName: "", venueGuide: "\n", notices: [] }),
      ),
    );
    expect(keysOf(sections)).toEqual(["hero", "news", "salesShortcut", "faq"]);
  });

  it("shows the schedule when only one bound is set, without inventing the other", () => {
    const startsAt = "2027-03-14T01:00:00Z" as UtcInstant;
    const sections = ready(buildHomeModel(withEvent({ ...base, startsAt })));
    expect(keysOf(sections)).toEqual(["hero", "news", "salesShortcut", "schedule", "faq"]);
    expect(section(sections, "schedule")?.periodText).toContain(formatJstDateTime(startsAt));
  });

  it("keeps notices in their original order", () => {
    const notices = ["second rule", "first rule", "third rule"];
    const sections = ready(buildHomeModel(withEvent({ ...base, notices })));
    expect(section(sections, "notices")?.items).toEqual(notices);
  });
});
