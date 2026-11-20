// SPEC-110 §26 / §26.1 API-PUB-001..005 / API-PUB-012 application service. No hono, ApiFailure, routes or
// middleware here (DEV-DEP-001): the route maps these results to HTTP. The service owns the read use
// cases (which store function, what the answer means) and the two pieces of server-made content: the
// Announcement excerpt and the Entry sales state (the latter is a domain rule).
import { evaluatePublicEntryAvailability, type PublicEntryAvailability } from "@off-r39x/domain";

export type PublicEventRecord = {
  publicRef: string;
  name: string;
  summary: string | null;
  startsAt: string | null;
  endsAt: string | null;
  businessTimezone: string;
  venueName: string | null;
  venueDetails: string | null;
  accessInformation: string | null;
  participantNotices: string | null;
};
export type PublicFaqRecord = {
  publicRef: string;
  question: string;
  answer: string;
  sortOrder: number;
};
export type PublicAnnouncementRecord = {
  publicRef: string;
  title: string;
  body: string;
  publishedAt: string | null;
};
export type PublicEntryOfferingRecord = {
  publicRef: string;
  name: string;
  description: string | null;
  unitAmount: string;
  currency: string;
  salesStartsAt: string;
  salesEndsAt: string;
  saleControlState: "ENABLED" | "SUSPENDED";
  purchaseLimit: number;
  hasRemainingCapacity: boolean;
};
export type PublicSponsorLogoRecord = {
  publicRef: string;
  displayName: string;
  imageUrl: string;
  linkUrl: string | null;
  sortOrder: number;
};

/** Port. Structurally satisfied by the @off-r39x/db adapter; this layer does not import db. */
export interface PublicContentStore {
  readPublicEvent(): Promise<
    | { status: "found"; event: PublicEventRecord }
    | { status: "none" }
    | { status: "multiple" }
    | { status: "unavailable" }
  >;
  listPublishedFaqs(): Promise<
    | { status: "ok"; items: PublicFaqRecord[] }
    | { status: "multiple_events" }
    | { status: "unavailable" }
  >;
  listPublishedAnnouncements(): Promise<
    | { status: "ok"; items: PublicAnnouncementRecord[] }
    | { status: "multiple_events" }
    | { status: "unavailable" }
  >;
  readPublishedAnnouncement(
    announcementRef: string,
  ): Promise<
    | { status: "found"; announcement: PublicAnnouncementRecord }
    | { status: "not_found" }
    | { status: "multiple_events" }
    | { status: "unavailable" }
  >;
  listEntryOfferings(): Promise<
    | { status: "ok"; now: string; items: PublicEntryOfferingRecord[] }
    | { status: "multiple_events" }
    | { status: "unavailable" }
  >;
  listPublishedSponsorLogos(): Promise<
    | { status: "ok"; items: PublicSponsorLogoRecord[] }
    | { status: "multiple_events" }
    | { status: "unavailable" }
  >;
}

/**
 * `inconsistent`: the "at most one Event" premise does not hold (API-PUB-READ-002), the route answers
 * 500. `not_found`: no Event (API-PUB-001), or no PUBLISHED Announcement of that ref (API-PUB-004).
 */
export type PublicReadResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_found" }
  | { kind: "inconsistent" }
  | { kind: "database_unavailable" };

export type AnnouncementSummaryRecord = {
  publicRef: string;
  title: string;
  publishedAt: string | null;
  excerpt: string;
  excerptTruncated: boolean;
};
export type EntryOfferingSaleRecord = PublicEntryOfferingRecord & PublicEntryAvailability;

export const EXCERPT_MAX_CODE_POINTS = 100;

/**
 * API-PUB-003 Excerpt: runs of Unicode White_Space (U+0085 included, U+FEFF not; this is not the
 * JavaScript whitespace class) become one U+0020, the leading and trailing U+0020 are removed, then
 * the first 100 code points are kept. No ellipsis, and the cut text is not trimmed again. `truncated`
 * only when the normalized text had more than 100 code points.
 */
export function makeExcerpt(body: string): { excerpt: string; truncated: boolean } {
  const normalized = body.replace(/\p{White_Space}+/gu, " ").replace(/^ | $/g, "");
  const codePoints = Array.from(normalized);
  if (codePoints.length <= EXCERPT_MAX_CODE_POINTS)
    return { excerpt: normalized, truncated: false };
  return { excerpt: codePoints.slice(0, EXCERPT_MAX_CODE_POINTS).join(""), truncated: true };
}

export async function readPublicEvent(
  store: PublicContentStore,
): Promise<PublicReadResult<PublicEventRecord>> {
  const result = await store.readPublicEvent();
  if (result.status === "found") return { kind: "ok", data: result.event };
  if (result.status === "none") return { kind: "not_found" };
  return result.status === "multiple" ? { kind: "inconsistent" } : { kind: "database_unavailable" };
}

export async function listPublishedFaqs(
  store: PublicContentStore,
): Promise<PublicReadResult<PublicFaqRecord[]>> {
  const result = await store.listPublishedFaqs();
  if (result.status === "ok") return { kind: "ok", data: result.items };
  return result.status === "multiple_events"
    ? { kind: "inconsistent" }
    : { kind: "database_unavailable" };
}

export async function listPublishedAnnouncements(
  store: PublicContentStore,
): Promise<PublicReadResult<AnnouncementSummaryRecord[]>> {
  const result = await store.listPublishedAnnouncements();
  if (result.status === "multiple_events") return { kind: "inconsistent" };
  if (result.status === "unavailable") return { kind: "database_unavailable" };
  return {
    kind: "ok",
    data: result.items.map((item) => {
      const { excerpt, truncated } = makeExcerpt(item.body);
      return {
        publicRef: item.publicRef,
        title: item.title,
        publishedAt: item.publishedAt,
        excerpt,
        excerptTruncated: truncated,
      };
    }),
  };
}

export async function readPublishedAnnouncement(
  store: PublicContentStore,
  announcementRef: string,
): Promise<PublicReadResult<PublicAnnouncementRecord>> {
  const result = await store.readPublishedAnnouncement(announcementRef);
  if (result.status === "found") return { kind: "ok", data: result.announcement };
  if (result.status === "not_found") return { kind: "not_found" };
  return result.status === "multiple_events"
    ? { kind: "inconsistent" }
    : { kind: "database_unavailable" };
}

/** `purchaseRouteMounted`: whether an Entry purchase Operation is registered in this release (UCR-110-004). */
export async function listEntryOfferings(
  store: PublicContentStore,
  options: { purchaseRouteMounted: boolean },
): Promise<PublicReadResult<EntryOfferingSaleRecord[]>> {
  const result = await store.listEntryOfferings();
  if (result.status === "multiple_events") return { kind: "inconsistent" };
  if (result.status === "unavailable") return { kind: "database_unavailable" };
  return {
    kind: "ok",
    data: result.items.map((item) => ({
      ...item,
      ...evaluatePublicEntryAvailability({
        now: result.now,
        salesStartsAt: item.salesStartsAt,
        salesEndsAt: item.salesEndsAt,
        saleControlState: item.saleControlState,
        hasRemainingCapacity: item.hasRemainingCapacity,
        purchaseRouteMounted: options.purchaseRouteMounted,
      }),
    })),
  };
}

export async function listPublishedSponsorLogos(
  store: PublicContentStore,
): Promise<PublicReadResult<PublicSponsorLogoRecord[]>> {
  const result = await store.listPublishedSponsorLogos();
  if (result.status === "ok") return { kind: "ok", data: result.items };
  return result.status === "multiple_events"
    ? { kind: "inconsistent" }
    : { kind: "database_unavailable" };
}
