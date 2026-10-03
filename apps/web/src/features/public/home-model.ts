import type { AnnouncementSummary, EventInfo, FaqItem, UtcInstant } from "../../api-client/types";
import {
  ANNOUNCEMENTS_HREF,
  ENTRY_HREF,
  GOODS_HREF,
  KARAOKE_HREF,
} from "../../config/public-routes";
import {
  type ListState,
  type Loadable,
  toListState,
} from "../../presentation/components/list-state";
import { copy } from "../../presentation/copy/ja";
import { formatJstDateTime } from "../../presentation/format/datetime";
import { type AnnouncementListItem, buildAnnouncementListModel } from "./announcement-model";

// View model for PG-PUB-001 (SPEC-050 11.1). Unset facts hide their section: nothing is guessed (SPEC-050 33).

export const HOME_NEWS_LIMIT = 3;

export const HOME_SECTION_ORDER = [
  "hero",
  "news",
  "salesShortcut",
  "overview",
  "schedule",
  "venue",
  "notices",
  "faq",
] as const;

export type HomeSectionKey = (typeof HOME_SECTION_ORDER)[number];

export type HomeInputs = {
  event: Loadable<EventInfo>;
  announcements: Loadable<readonly AnnouncementSummary[]>;
  faqs: Loadable<readonly FaqItem[]>;
};

export type HomeSection =
  | {
      key: "hero";
      eventName: string;
      periodText: string | null;
      venueName: string | null;
      ctaHref: string;
    }
  | { key: "news"; list: ListState<AnnouncementListItem>; viewAllHref: string }
  | {
      key: "salesShortcut";
      links: readonly { key: "entry" | "karaoke" | "goods"; href: string }[];
    }
  | { key: "overview"; eventName: string; overview: string }
  | { key: "schedule"; periodText: string }
  | {
      key: "venue";
      venueName: string | null;
      venueGuide: string | null;
      accessInfo: string | null;
    }
  | { key: "notices"; items: readonly string[] }
  | { key: "faq"; list: ListState<{ id: string; question: string; answer: string }> };

export type HomeModel =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; sections: readonly HomeSection[] };

export function buildEventPeriodText(
  startsAt: UtcInstant | null,
  endsAt: UtcInstant | null,
): string | null {
  if (startsAt !== null && endsAt !== null) {
    return copy.home.period.range(formatJstDateTime(startsAt), formatJstDateTime(endsAt));
  }
  if (startsAt !== null) return copy.home.period.from(formatJstDateTime(startsAt));
  if (endsAt !== null) return copy.home.period.until(formatJstDateTime(endsAt));
  return null;
}

function present(value: string | null): string | null {
  return value !== null && value.trim() !== "" ? value : null;
}

function buildReadySections(event: EventInfo, inputs: HomeInputs): HomeSection[] {
  const periodText = buildEventPeriodText(event.startsAt, event.endsAt);
  const venueName = present(event.venueName);
  const venueGuide = present(event.venueGuide);
  const accessInfo = present(event.accessInfo);
  const overview = present(event.overview);

  const sections: HomeSection[] = [
    { key: "hero", eventName: event.name, periodText, venueName, ctaHref: ENTRY_HREF },
    {
      key: "news",
      list: buildAnnouncementListModel(inputs.announcements, { limit: HOME_NEWS_LIMIT }),
      viewAllHref: ANNOUNCEMENTS_HREF,
    },
    {
      key: "salesShortcut",
      links: [
        { key: "entry", href: ENTRY_HREF },
        { key: "karaoke", href: KARAOKE_HREF },
        { key: "goods", href: GOODS_HREF },
      ],
    },
  ];
  if (overview !== null) sections.push({ key: "overview", eventName: event.name, overview });
  if (periodText !== null) sections.push({ key: "schedule", periodText });
  if (venueName !== null || venueGuide !== null || accessInfo !== null) {
    sections.push({ key: "venue", venueName, venueGuide, accessInfo });
  }
  if (event.notices !== null && event.notices.length > 0) {
    sections.push({ key: "notices", items: event.notices });
  }
  sections.push({
    key: "faq",
    list: toListState(inputs.faqs, (f) => ({ id: f.id, question: f.question, answer: f.answer })),
  });
  return sections;
}

export function buildHomeModel(inputs: HomeInputs): HomeModel {
  const { event } = inputs;
  if (event.kind === "loading") return { kind: "loading" };
  // The event read decides the page: any failure is a page-level error, never an empty page.
  if (event.kind !== "ok") return { kind: "error" };
  return { kind: "ready", sections: buildReadySections(event.data, inputs) };
}
