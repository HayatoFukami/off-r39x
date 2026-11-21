import { type Context, type Env, Hono, type MiddlewareHandler } from "hono";
import type { z } from "zod";
import { envelope } from "./envelope.ts";
import {
  type emptyPublicQuerySchema,
  type PublicAnnouncement,
  type PublicAnnouncementList,
  type PublicEntryOfferingList,
  type PublicEvent,
  type PublicFaqList,
  type PublicSponsorLogoList,
  publicAnnouncementListSchema,
  publicAnnouncementSchema,
  publicEntryOfferingListSchema,
  publicEventSchema,
  publicFaqListSchema,
  publicSponsorLogoListSchema,
} from "./schemas/public.ts";

// Hono Input type of the (empty) Query: validated by the injected `query` middleware, which stores the
// value outside Hono's validated data (as validateJson does), so only `in` is declared. The Query is
// optional for hc<AppType>: a client sends none (the only valid Query is empty).
type PublicQueryInput = { in: { query?: z.input<typeof emptyPublicQuerySchema> } };

const EVENT = "/api/v1/public/event";
const FAQS = "/api/v1/public/faqs";
const ANNOUNCEMENTS = "/api/v1/public/announcements";
const ANNOUNCEMENT = "/api/v1/public/announcements/:announcement_ref";
const ENTRY_OFFERINGS = "/api/v1/public/entry-offerings";
const SPONSOR_LOGOS = "/api/v1/public/sponsor-logos";

/**
 * SPEC-110 §26 / §26.1: the six public read Operations (API-PUB-001..005, API-PUB-012), GET only. Every
 * route runs `guard` (fail closed when the store is absent), then `query` (the empty strict Query), then
 * the handler, whose data is checked against the route's strict response schema (DEV-API-002/003).
 * No authentication is part of this namespace (SPEC-110 §6). The server mounts this same builder.
 */
export function createPublicReadRpc<E extends Env>(dependencies: {
  requestId: (c: Context<E>) => string;
  guard: MiddlewareHandler<E>;
  query: MiddlewareHandler<E, string, PublicQueryInput>;
  /** API-PUB-001. */
  event: { load: (c: Context<E>) => Promise<PublicEvent> };
  /** API-PUB-002. */
  faqs: { load: (c: Context<E>) => Promise<PublicFaqList> };
  /** API-PUB-003. */
  announcements: { load: (c: Context<E>) => Promise<PublicAnnouncementList> };
  /** API-PUB-004. The path parameter is validated by the loader's route (announcementRefParamSchema). */
  announcement: {
    load: (c: Context<E, typeof ANNOUNCEMENT, PublicQueryInput>) => Promise<PublicAnnouncement>;
  };
  /** API-PUB-005. */
  entryOfferings: { load: (c: Context<E>) => Promise<PublicEntryOfferingList> };
  /** API-PUB-012. */
  sponsorLogos: { load: (c: Context<E>) => Promise<PublicSponsorLogoList> };
}) {
  const { guard, query, requestId } = dependencies;
  return new Hono<E>()
    .get(EVENT, guard, query, async (c: Context<E, typeof EVENT, PublicQueryInput>) =>
      c.json(envelope(publicEventSchema, await dependencies.event.load(c), requestId(c))),
    )
    .get(FAQS, guard, query, async (c: Context<E, typeof FAQS, PublicQueryInput>) =>
      c.json(envelope(publicFaqListSchema, await dependencies.faqs.load(c), requestId(c))),
    )
    .get(
      ANNOUNCEMENTS,
      guard,
      query,
      async (c: Context<E, typeof ANNOUNCEMENTS, PublicQueryInput>) =>
        c.json(
          envelope(
            publicAnnouncementListSchema,
            await dependencies.announcements.load(c),
            requestId(c),
          ),
        ),
    )
    .get(ANNOUNCEMENT, guard, query, async (c: Context<E, typeof ANNOUNCEMENT, PublicQueryInput>) =>
      c.json(
        envelope(publicAnnouncementSchema, await dependencies.announcement.load(c), requestId(c)),
      ),
    )
    .get(
      ENTRY_OFFERINGS,
      guard,
      query,
      async (c: Context<E, typeof ENTRY_OFFERINGS, PublicQueryInput>) =>
        c.json(
          envelope(
            publicEntryOfferingListSchema,
            await dependencies.entryOfferings.load(c),
            requestId(c),
          ),
        ),
    )
    .get(
      SPONSOR_LOGOS,
      guard,
      query,
      async (c: Context<E, typeof SPONSOR_LOGOS, PublicQueryInput>) =>
        c.json(
          envelope(
            publicSponsorLogoListSchema,
            await dependencies.sponsorLogos.load(c),
            requestId(c),
          ),
        ),
    );
}
