import type { Announcement, AnnouncementSummary, Ref, UtcInstant } from "../../api-client/types";
import { ANNOUNCEMENTS_HREF, announcementHref } from "../../config/public-routes";
import { HOME_HREF } from "../../config/site";
import {
  type ListState,
  type Loadable,
  toListState,
} from "../../presentation/components/list-state";
import { formatJstDate } from "../../presentation/format/datetime";

// View models for PG-PUB-002 / PG-PUB-003 (SPEC-050 11.2, 11.3). Pure: no I/O.

export type AnnouncementListItem = {
  announcementRef: Ref<"announcement">;
  href: string;
  title: string;
  excerpt: string;
  dateText: string;
  publishedAt: UtcInstant;
};

export function toAnnouncementListItem(s: AnnouncementSummary): AnnouncementListItem {
  return {
    announcementRef: s.announcementRef,
    href: announcementHref(s.announcementRef),
    title: s.title,
    excerpt: s.excerpt,
    dateText: formatJstDate(s.publishedAt),
    publishedAt: s.publishedAt,
  };
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("limit must be an integer >= 1");
  }
}

/** Newest first (stable for equal instants); `limit` is applied after sorting. */
export function buildAnnouncementListModel(
  input: Loadable<readonly AnnouncementSummary[]>,
  opts: { limit?: number } = {},
): ListState<AnnouncementListItem> {
  if (opts.limit !== undefined) assertLimit(opts.limit);
  const limit = opts.limit;
  const sorted: Loadable<readonly AnnouncementSummary[]> =
    input.kind === "ok"
      ? {
          kind: "ok",
          data: [...input.data]
            .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
            .slice(0, limit),
        }
      : input;
  return toListState(sorted, toAnnouncementListItem);
}

export type AnnouncementDetailModel =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "unavailable" }
  | {
      kind: "ready";
      announcementRef: Ref<"announcement">;
      title: string;
      dateText: string;
      publishedAt: UtcInstant;
      body: string;
      listHref: string;
      homeHref: string;
    };

export function buildAnnouncementDetailModel(
  input: Loadable<Announcement>,
): AnnouncementDetailModel {
  switch (input.kind) {
    case "loading":
      return { kind: "loading" };
    case "not_found":
      return { kind: "not_found" };
    case "unavailable":
    case "auth_required":
    case "email_unverified":
      // A failure is not Not Found (SPEC-050 11.3).
      return { kind: "unavailable" };
    case "ok":
      return {
        kind: "ready",
        announcementRef: input.data.announcementRef,
        title: input.data.title,
        dateText: formatJstDate(input.data.publishedAt),
        publishedAt: input.data.publishedAt,
        body: input.data.body, // original text: never trimmed or escaped
        listHref: ANNOUNCEMENTS_HREF,
        homeHref: HOME_HREF,
      };
    default: {
      const unreachable: never = input;
      return unreachable;
    }
  }
}
